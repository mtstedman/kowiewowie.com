(() => {
    'use strict';

    const VERSION = 5;
    const SIZE = VERSION * 4 + 17;
    const DATA_CODEWORDS = 108;
    const EC_CODEWORDS = 26;
    const MAX_BYTES = 106;
    const QUIET_ZONE = 4;
    const SCALE = 4;
    const textEncoder = new TextEncoder();

    function normalizeTarget(rawTarget) {
        const raw = typeof rawTarget === 'string' ? rawTarget.trim() : '';
        if (raw === '') {
            throw new Error('Missing QR target');
        }

        const url = new URL(raw, window.location.origin);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Unsupported QR target');
        }

        return url.href;
    }

    function gfMultiply(left, right) {
        let result = 0;
        let x = left;
        let y = right;

        while (y !== 0) {
            if ((y & 1) !== 0) {
                result ^= x;
            }
            x <<= 1;
            if ((x & 0x100) !== 0) {
                x ^= 0x11D;
            }
            y >>>= 1;
        }

        return result;
    }

    function reedSolomonDivisor(degree) {
        const result = new Array(degree).fill(0);
        result[degree - 1] = 1;
        let root = 1;

        for (let index = 0; index < degree; index++) {
            for (let coefficient = 0; coefficient < degree; coefficient++) {
                result[coefficient] = gfMultiply(result[coefficient], root);
                if (coefficient + 1 < degree) {
                    result[coefficient] ^= result[coefficient + 1];
                }
            }
            root = gfMultiply(root, 0x02);
        }

        return result;
    }

    function reedSolomonRemainder(data, degree) {
        const divisor = reedSolomonDivisor(degree);
        const result = new Array(degree).fill(0);

        data.forEach((byte) => {
            const factor = byte ^ result.shift();
            result.push(0);
            divisor.forEach((coefficient, index) => {
                result[index] ^= gfMultiply(coefficient, factor);
            });
        });

        return result;
    }

    function encodeData(value) {
        const bytes = Array.from(textEncoder.encode(value));
        if (bytes.length > MAX_BYTES) {
            throw new Error('QR target is too long');
        }

        const bits = [];
        const pushBits = (number, length) => {
            for (let bit = length - 1; bit >= 0; bit--) {
                bits.push((number >>> bit) & 1);
            }
        };

        pushBits(0x04, 4);
        pushBits(bytes.length, 8);
        bytes.forEach((byte) => pushBits(byte, 8));

        const capacityBits = DATA_CODEWORDS * 8;
        const terminatorLength = Math.min(4, capacityBits - bits.length);
        pushBits(0, terminatorLength);
        while (bits.length % 8 !== 0) {
            bits.push(0);
        }

        const dataCodewords = [];
        for (let index = 0; index < bits.length; index += 8) {
            dataCodewords.push(Number.parseInt(bits.slice(index, index + 8).join(''), 2));
        }

        for (let pad = 0; dataCodewords.length < DATA_CODEWORDS; pad++) {
            dataCodewords.push(pad % 2 === 0 ? 0xEC : 0x11);
        }

        return dataCodewords.concat(reedSolomonRemainder(dataCodewords, EC_CODEWORDS));
    }

    function createMatrix() {
        return {
            modules: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false)),
            reserved: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false))
        };
    }

    function setFunctionModule(qr, x, y, dark) {
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
            return;
        }
        qr.modules[y][x] = dark;
        qr.reserved[y][x] = true;
    }

    function drawFinder(qr, centerX, centerY) {
        for (let y = -4; y <= 4; y++) {
            for (let x = -4; x <= 4; x++) {
                const distance = Math.max(Math.abs(x), Math.abs(y));
                const dark = distance !== 2 && distance !== 4;
                setFunctionModule(qr, centerX + x, centerY + y, dark);
            }
        }
    }

    function drawAlignment(qr, centerX, centerY) {
        for (let y = -2; y <= 2; y++) {
            for (let x = -2; x <= 2; x++) {
                const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
                setFunctionModule(qr, centerX + x, centerY + y, dark);
            }
        }
    }

    function reserveFormatAreas(qr) {
        for (let index = 0; index <= 5; index++) {
            setFunctionModule(qr, 8, index, false);
            setFunctionModule(qr, index, 8, false);
        }
        setFunctionModule(qr, 8, 7, false);
        setFunctionModule(qr, 8, 8, false);
        setFunctionModule(qr, 7, 8, false);

        for (let index = 9; index < 15; index++) {
            setFunctionModule(qr, 14 - index, 8, false);
        }
        for (let index = 0; index < 8; index++) {
            setFunctionModule(qr, SIZE - 1 - index, 8, false);
        }
        for (let index = 8; index < 15; index++) {
            setFunctionModule(qr, 8, SIZE - 15 + index, false);
        }
    }

    function setupPatterns() {
        const qr = createMatrix();
        drawFinder(qr, 3, 3);
        drawFinder(qr, SIZE - 4, 3);
        drawFinder(qr, 3, SIZE - 4);
        drawAlignment(qr, 30, 30);

        for (let index = 8; index < SIZE - 8; index++) {
            const dark = index % 2 === 0;
            setFunctionModule(qr, index, 6, dark);
            setFunctionModule(qr, 6, index, dark);
        }

        reserveFormatAreas(qr);
        setFunctionModule(qr, 8, SIZE - 8, true);
        return qr;
    }

    function maskBit(mask, x, y) {
        switch (mask) {
            case 0:
                return (x + y) % 2 === 0;
            case 1:
                return y % 2 === 0;
            case 2:
                return x % 3 === 0;
            case 3:
                return (x + y) % 3 === 0;
            case 4:
                return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
            case 5:
                return ((x * y) % 2) + ((x * y) % 3) === 0;
            case 6:
                return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            case 7:
                return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            default:
                return false;
        }
    }

    function drawFormatBits(qr, mask) {
        const errorCorrectionLevel = 1;
        const data = (errorCorrectionLevel << 3) | mask;
        let remainder = data;
        for (let index = 0; index < 10; index++) {
            remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
        }
        const bits = ((data << 10) | remainder) ^ 0x5412;
        const bitAt = (index) => ((bits >>> index) & 1) !== 0;

        for (let index = 0; index <= 5; index++) {
            setFunctionModule(qr, 8, index, bitAt(index));
            setFunctionModule(qr, index, 8, bitAt(index));
        }
        setFunctionModule(qr, 8, 7, bitAt(6));
        setFunctionModule(qr, 8, 8, bitAt(7));
        setFunctionModule(qr, 7, 8, bitAt(8));

        for (let index = 9; index < 15; index++) {
            setFunctionModule(qr, 14 - index, 8, bitAt(index));
        }
        for (let index = 0; index < 8; index++) {
            setFunctionModule(qr, SIZE - 1 - index, 8, bitAt(index));
        }
        for (let index = 8; index < 15; index++) {
            setFunctionModule(qr, 8, SIZE - 15 + index, bitAt(index));
        }
        setFunctionModule(qr, 8, SIZE - 8, true);
    }

    function placeData(qr, codewords, mask) {
        const bits = [];
        codewords.forEach((codeword) => {
            for (let bit = 7; bit >= 0; bit--) {
                bits.push((codeword >>> bit) & 1);
            }
        });

        let bitIndex = 0;
        let upward = true;
        for (let right = SIZE - 1; right >= 1; right -= 2) {
            if (right === 6) {
                right--;
            }
            for (let vertical = 0; vertical < SIZE; vertical++) {
                const y = upward ? SIZE - 1 - vertical : vertical;
                for (let offset = 0; offset < 2; offset++) {
                    const x = right - offset;
                    if (qr.reserved[y][x]) {
                        continue;
                    }
                    let dark = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
                    bitIndex++;
                    if (maskBit(mask, x, y)) {
                        dark = !dark;
                    }
                    qr.modules[y][x] = dark;
                }
            }
            upward = !upward;
        }
    }

    function penaltyForLine(line) {
        let penalty = 0;
        let runColor = line[0];
        let runLength = 1;

        for (let index = 1; index < line.length; index++) {
            if (line[index] === runColor) {
                runLength++;
            } else {
                if (runLength >= 5) {
                    penalty += 3 + runLength - 5;
                }
                runColor = line[index];
                runLength = 1;
            }
        }
        if (runLength >= 5) {
            penalty += 3 + runLength - 5;
        }

        return penalty;
    }

    function finderPenaltyForLine(line) {
        let penalty = 0;
        const pattern = [true, false, true, true, true, false, true, false, false, false, false];
        const reversePattern = pattern.slice().reverse();

        for (let index = 0; index <= line.length - pattern.length; index++) {
            const window = line.slice(index, index + pattern.length);
            if (pattern.every((value, offset) => window[offset] === value) || reversePattern.every((value, offset) => window[offset] === value)) {
                penalty += 40;
            }
        }

        return penalty;
    }

    function scoreMatrix(modules) {
        let penalty = 0;
        let darkCount = 0;

        for (let y = 0; y < SIZE; y++) {
            penalty += penaltyForLine(modules[y]);
            penalty += finderPenaltyForLine(modules[y]);
            for (let x = 0; x < SIZE; x++) {
                if (modules[y][x]) {
                    darkCount++;
                }
                if (x + 1 < SIZE && y + 1 < SIZE) {
                    const color = modules[y][x];
                    if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) {
                        penalty += 3;
                    }
                }
            }
        }

        for (let x = 0; x < SIZE; x++) {
            const column = modules.map((row) => row[x]);
            penalty += penaltyForLine(column);
            penalty += finderPenaltyForLine(column);
        }

        const total = SIZE * SIZE;
        const percent = (darkCount * 100) / total;
        penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;
        return penalty;
    }

    function cloneQr(qr) {
        return {
            modules: qr.modules.map((row) => row.slice()),
            reserved: qr.reserved.map((row) => row.slice())
        };
    }

    function makeQr(value) {
        const codewords = encodeData(value);
        const base = setupPatterns();
        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (let mask = 0; mask < 8; mask++) {
            const candidate = cloneQr(base);
            placeData(candidate, codewords, mask);
            drawFormatBits(candidate, mask);
            const score = scoreMatrix(candidate.modules);
            if (score < bestScore) {
                best = candidate.modules;
                bestScore = score;
            }
        }

        return best;
    }

    function renderCanvas(modules, title) {
        const moduleCount = modules.length;
        const canvasSize = (moduleCount + QUIET_ZONE * 2) * SCALE;
        const canvas = document.createElement('canvas');
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', title || 'QR code');

        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvasSize, canvasSize);
        context.fillStyle = '#000000';

        modules.forEach((row, y) => {
            row.forEach((dark, x) => {
                if (dark) {
                    context.fillRect((x + QUIET_ZONE) * SCALE, (y + QUIET_ZONE) * SCALE, SCALE, SCALE);
                }
            });
        });

        return canvas;
    }

    function renderQr(container) {
        try {
            const target = normalizeTarget(container.dataset.qrTarget);
            const modules = makeQr(target);
            const title = typeof container.dataset.qrTitle === 'string' ? container.dataset.qrTitle : '';
            container.replaceChildren(renderCanvas(modules, title));
            container.dataset.qrRendered = 'true';
        } catch (error) {
            container.classList.add('is-invalid');
            container.textContent = error instanceof Error ? error.message : 'QR unavailable';
        }
    }

    document.querySelectorAll('[data-qr-code]').forEach(renderQr);
})();

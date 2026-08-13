import { COLORS, createPieceFromFen } from './pieces.js';

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function emptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
}

export function squareToCoords(square) {
    if (typeof square !== 'string' || !/^[a-h][1-8]$/.test(square)) {
        throw new Error(`Invalid chess square: ${square}`);
    }

    return {
        row: 8 - Number(square[1]),
        col: square.charCodeAt(0) - 97,
    };
}

export function coordsToSquare(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) {
        throw new Error(`Invalid board coordinates: ${row}, ${col}`);
    }

    return `${String.fromCharCode(97 + col)}${8 - row}`;
}

function parseActiveColor(field) {
    if (field === 'w') {
        return COLORS.WHITE;
    }
    if (field === 'b') {
        return COLORS.BLACK;
    }
    throw new Error(`Invalid FEN active color: ${field}`);
}

function serializeActiveColor(color) {
    if (color === COLORS.WHITE) {
        return 'w';
    }
    if (color === COLORS.BLACK) {
        return 'b';
    }
    throw new Error(`Invalid active color: ${color}`);
}

function parseCastling(field) {
    if (field === '-') {
        return {
            white: { kingSide: false, queenSide: false },
            black: { kingSide: false, queenSide: false },
        };
    }

    if (!/^[KQkq]+$/.test(field) || new Set(field).size !== field.length) {
        throw new Error(`Invalid FEN castling field: ${field}`);
    }

    return {
        white: { kingSide: field.includes('K'), queenSide: field.includes('Q') },
        black: { kingSide: field.includes('k'), queenSide: field.includes('q') },
    };
}

function serializeCastling(castling) {
    const value = [
        castling?.white?.kingSide ? 'K' : '',
        castling?.white?.queenSide ? 'Q' : '',
        castling?.black?.kingSide ? 'k' : '',
        castling?.black?.queenSide ? 'q' : '',
    ].join('');

    return value || '-';
}

function parsePlacement(field) {
    const rows = field.split('/');
    if (rows.length !== 8) {
        throw new Error('FEN placement must contain 8 ranks.');
    }

    const board = emptyBoard();
    rows.forEach((rank, row) => {
        let col = 0;
        for (const char of rank) {
            if (/^[1-8]$/.test(char)) {
                col += Number(char);
                continue;
            }

            if (!/^[pnbrqkPNBRQK]$/.test(char)) {
                throw new Error(`Invalid FEN piece symbol: ${char}`);
            }

            if (col > 7) {
                throw new Error(`Too many squares in FEN rank: ${rank}`);
            }
            board[row][col] = createPieceFromFen(char);
            col += 1;
        }

        if (col !== 8) {
            throw new Error(`FEN rank does not contain 8 squares: ${rank}`);
        }
    });

    return board;
}

function serializePlacement(board) {
    return board.map((rank) => {
        let empty = 0;
        let output = '';

        for (const piece of rank) {
            if (piece === null) {
                empty += 1;
                continue;
            }

            if (empty > 0) {
                output += String(empty);
                empty = 0;
            }
            output += piece.fenSymbol;
        }

        return output + (empty > 0 ? String(empty) : '');
    }).join('/');
}

export function cloneBoard(board) {
    return board.map((rank) => rank.map((piece) => piece === null ? null : piece.clone()));
}

export function parseFen(fen = STARTING_FEN) {
    if (typeof fen !== 'string') {
        throw new Error('FEN must be a string.');
    }

    const fields = fen.trim().split(/\s+/);
    if (fields.length !== 6) {
        throw new Error('FEN must contain 6 fields.');
    }

    const [placement, activeColor, castling, enPassant, halfmoveClock, fullmoveNumber] = fields;
    if (enPassant !== '-' && !/^[a-h][36]$/.test(enPassant)) {
        throw new Error(`Invalid FEN en-passant square: ${enPassant}`);
    }

    const halfmove = Number(halfmoveClock);
    const fullmove = Number(fullmoveNumber);
    if (!Number.isInteger(halfmove) || halfmove < 0) {
        throw new Error(`Invalid FEN halfmove clock: ${halfmoveClock}`);
    }
    if (!Number.isInteger(fullmove) || fullmove < 1) {
        throw new Error(`Invalid FEN fullmove number: ${fullmoveNumber}`);
    }

    return {
        board: parsePlacement(placement),
        activeColor: parseActiveColor(activeColor),
        castling: parseCastling(castling),
        enPassant,
        enPassantSquare: enPassant === '-' ? null : squareToCoords(enPassant),
        halfmoveClock: halfmove,
        fullmoveNumber: fullmove,
    };
}

export function serializeFen(state) {
    return [
        serializePlacement(state.board),
        serializeActiveColor(state.activeColor),
        serializeCastling(state.castling),
        state.enPassant || '-',
        String(state.halfmoveClock ?? 0),
        String(state.fullmoveNumber ?? 1),
    ].join(' ');
}

export const COLORS = Object.freeze({
    WHITE: 'white',
    BLACK: 'black',
});

export const PIECE_TYPES = Object.freeze({
    PAWN: 'pawn',
    KNIGHT: 'knight',
    BISHOP: 'bishop',
    ROOK: 'rook',
    QUEEN: 'queen',
    KING: 'king',
});

const FEN_SYMBOLS = Object.freeze({
    pawn: 'p',
    knight: 'n',
    bishop: 'b',
    rook: 'r',
    queen: 'q',
    king: 'k',
});

export function oppositeColor(color) {
    return color === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
}

export function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function emptyOrEnemy(board, row, col, color) {
    const occupant = board[row][col];
    return occupant === null || occupant.color !== color;
}

function move(row, col, extra = {}) {
    return { row, col, ...extra };
}

function rayMoves(board, from, color, directions) {
    const moves = [];

    for (const [rowStep, colStep] of directions) {
        let row = from.row + rowStep;
        let col = from.col + colStep;

        while (inBounds(row, col)) {
            const occupant = board[row][col];
            if (occupant === null) {
                moves.push(move(row, col));
            } else {
                if (occupant.color !== color) {
                    moves.push(move(row, col, { capture: true }));
                }
                break;
            }

            row += rowStep;
            col += colStep;
        }
    }

    return moves;
}

export class Piece {
    constructor(color) {
        if (color !== COLORS.WHITE && color !== COLORS.BLACK) {
            throw new Error(`Invalid piece color: ${color}`);
        }
        this.color = color;
    }

    get type() {
        throw new Error('Piece subclasses must define type.');
    }

    get displayName() {
        return `${this.color}-${this.type}`;
    }

    get imageName() {
        return this.displayName;
    }

    get displayImageName() {
        return this.displayName;
    }

    get fenSymbol() {
        const symbol = FEN_SYMBOLS[this.type];
        return this.color === COLORS.WHITE ? symbol.toUpperCase() : symbol;
    }

    pseudoMoves() {
        throw new Error('Piece subclasses must implement pseudoMoves().');
    }

    clone() {
        return new this.constructor(this.color);
    }
}

export class Pawn extends Piece {
    get type() {
        return PIECE_TYPES.PAWN;
    }

    pseudoMoves(board, from, state = {}) {
        const moves = [];
        const direction = this.color === COLORS.WHITE ? -1 : 1;
        const startRow = this.color === COLORS.WHITE ? 6 : 1;
        const promotionRow = this.color === COLORS.WHITE ? 0 : 7;
        const enPassantRow = this.color === COLORS.WHITE ? 3 : 4;
        const oneForward = from.row + direction;

        if (inBounds(oneForward, from.col) && board[oneForward][from.col] === null) {
            moves.push(move(oneForward, from.col, {
                promotion: oneForward === promotionRow,
            }));

            const twoForward = from.row + direction * 2;
            if (from.row === startRow && board[twoForward][from.col] === null) {
                moves.push(move(twoForward, from.col, { doubleStep: true }));
            }
        }

        for (const colStep of [-1, 1]) {
            const row = from.row + direction;
            const col = from.col + colStep;
            if (!inBounds(row, col)) {
                continue;
            }

            const occupant = board[row][col];
            if (occupant !== null && occupant.color !== this.color) {
                moves.push(move(row, col, {
                    capture: true,
                    promotion: row === promotionRow,
                }));
            }

            const capturedPawn = board[from.row][col];
            if (
                from.row === enPassantRow
                && occupant === null
                && state.enPassantSquare
                && state.enPassantSquare.row === row
                && state.enPassantSquare.col === col
                && capturedPawn !== null
                && capturedPawn.color !== this.color
                && capturedPawn.type === PIECE_TYPES.PAWN
            ) {
                moves.push(move(row, col, { capture: true, enPassant: true }));
            }
        }

        return moves;
    }
}

export class Knight extends Piece {
    get type() {
        return PIECE_TYPES.KNIGHT;
    }

    pseudoMoves(board, from) {
        return [
            [-2, -1], [-2, 1], [-1, -2], [-1, 2],
            [1, -2], [1, 2], [2, -1], [2, 1],
        ]
            .map(([rowStep, colStep]) => [from.row + rowStep, from.col + colStep])
            .filter(([row, col]) => inBounds(row, col) && emptyOrEnemy(board, row, col, this.color))
            .map(([row, col]) => move(row, col, { capture: board[row][col] !== null }));
    }
}

export class Bishop extends Piece {
    get type() {
        return PIECE_TYPES.BISHOP;
    }

    pseudoMoves(board, from) {
        return rayMoves(board, from, this.color, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
    }
}

export class Rook extends Piece {
    get type() {
        return PIECE_TYPES.ROOK;
    }

    pseudoMoves(board, from) {
        return rayMoves(board, from, this.color, [[-1, 0], [0, 1], [1, 0], [0, -1]]);
    }
}

export class Queen extends Piece {
    get type() {
        return PIECE_TYPES.QUEEN;
    }

    pseudoMoves(board, from) {
        return rayMoves(board, from, this.color, [
            [-1, -1], [-1, 0], [-1, 1], [0, 1],
            [1, 1], [1, 0], [1, -1], [0, -1],
        ]);
    }
}

export class King extends Piece {
    get type() {
        return PIECE_TYPES.KING;
    }

    pseudoMoves(board, from, state = {}) {
        const moves = [
            [-1, -1], [-1, 0], [-1, 1], [0, 1],
            [1, 1], [1, 0], [1, -1], [0, -1],
        ]
            .map(([rowStep, colStep]) => [from.row + rowStep, from.col + colStep])
            .filter(([row, col]) => inBounds(row, col) && emptyOrEnemy(board, row, col, this.color))
            .map(([row, col]) => move(row, col, { capture: board[row][col] !== null }));

        const rights = state.castling?.[this.color] || {};
        const homeRow = this.color === COLORS.WHITE ? 7 : 0;
        if (from.row === homeRow && from.col === 4) {
            const kingSideRook = board[homeRow][7];
            const queenSideRook = board[homeRow][0];
            if (
                rights.kingSide
                && kingSideRook?.color === this.color
                && kingSideRook.type === PIECE_TYPES.ROOK
                && board[homeRow][5] === null
                && board[homeRow][6] === null
            ) {
                moves.push(move(homeRow, 6, { castle: 'kingSide' }));
            }
            if (
                rights.queenSide
                && queenSideRook?.color === this.color
                && queenSideRook.type === PIECE_TYPES.ROOK
                && board[homeRow][1] === null
                && board[homeRow][2] === null
                && board[homeRow][3] === null
            ) {
                moves.push(move(homeRow, 2, { castle: 'queenSide' }));
            }
        }

        return moves;
    }
}

export function createPiece(type, color) {
    switch (type.toLowerCase()) {
        case PIECE_TYPES.PAWN:
            return new Pawn(color);
        case PIECE_TYPES.KNIGHT:
            return new Knight(color);
        case PIECE_TYPES.BISHOP:
            return new Bishop(color);
        case PIECE_TYPES.ROOK:
            return new Rook(color);
        case PIECE_TYPES.QUEEN:
            return new Queen(color);
        case PIECE_TYPES.KING:
            return new King(color);
        default:
            throw new Error(`Unknown piece type: ${type}`);
    }
}

export function createPieceFromFen(symbol) {
    const color = symbol === symbol.toUpperCase() ? COLORS.WHITE : COLORS.BLACK;
    const typeBySymbol = {
        p: PIECE_TYPES.PAWN,
        n: PIECE_TYPES.KNIGHT,
        b: PIECE_TYPES.BISHOP,
        r: PIECE_TYPES.ROOK,
        q: PIECE_TYPES.QUEEN,
        k: PIECE_TYPES.KING,
    };
    const type = typeBySymbol[symbol.toLowerCase()];
    if (!type) {
        throw new Error(`Invalid FEN piece symbol: ${symbol}`);
    }
    return createPiece(type, color);
}

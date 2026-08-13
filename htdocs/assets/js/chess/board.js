import { COLORS, PIECE_TYPES, Queen, Rook, Bishop, Knight, oppositeColor } from './pieces.js';
import { STARTING_FEN, cloneBoard, coordsToSquare, parseFen, serializeFen, squareToCoords } from './fen.js';

const PROMOTION_PIECES = Object.freeze({
    queen: Queen,
    rook: Rook,
    bishop: Bishop,
    knight: Knight,
});

function cloneCastling(castling) {
    return {
        white: {
            kingSide: Boolean(castling?.white?.kingSide),
            queenSide: Boolean(castling?.white?.queenSide),
        },
        black: {
            kingSide: Boolean(castling?.black?.kingSide),
            queenSide: Boolean(castling?.black?.queenSide),
        },
    };
}

function cloneState(state) {
    return {
        board: cloneBoard(state.board),
        activeColor: state.activeColor,
        castling: cloneCastling(state.castling),
        enPassant: state.enPassant || '-',
        enPassantSquare: state.enPassantSquare ? { ...state.enPassantSquare } : null,
        halfmoveClock: state.halfmoveClock ?? 0,
        fullmoveNumber: state.fullmoveNumber ?? 1,
    };
}

function normalizeSquare(squareOrCoords) {
    if (typeof squareOrCoords === 'string') {
        return squareToCoords(squareOrCoords);
    }

    if (
        squareOrCoords
        && Number.isInteger(squareOrCoords.row)
        && Number.isInteger(squareOrCoords.col)
        && squareOrCoords.row >= 0
        && squareOrCoords.row < 8
        && squareOrCoords.col >= 0
        && squareOrCoords.col < 8
    ) {
        return { row: squareOrCoords.row, col: squareOrCoords.col };
    }

    throw new Error(`Invalid square: ${squareOrCoords}`);
}

function decorateMove(from, move, board) {
    return {
        from: coordsToSquare(from.row, from.col),
        to: coordsToSquare(move.row, move.col),
        fromRow: from.row,
        fromCol: from.col,
        row: move.row,
        col: move.col,
        capture: Boolean(move.capture || board[move.row][move.col]),
        promotion: Boolean(move.promotion),
        castle: move.castle || null,
        enPassant: Boolean(move.enPassant),
        doubleStep: Boolean(move.doubleStep),
    };
}

function clearCastlingForRookSquare(castling, row, col) {
    if (row === 7 && col === 0) {
        castling.white.queenSide = false;
    } else if (row === 7 && col === 7) {
        castling.white.kingSide = false;
    } else if (row === 0 && col === 0) {
        castling.black.queenSide = false;
    } else if (row === 0 && col === 7) {
        castling.black.kingSide = false;
    }
}

export class Board {
    constructor(stateOrFen = STARTING_FEN) {
        this.state = typeof stateOrFen === 'string' ? parseFen(stateOrFen) : cloneState(stateOrFen);
        this.validateKings(this.state.board);
    }

    static fromFen(fen) {
        return new Board(fen);
    }

    toFen() {
        return serializeFen(this.state);
    }

    get board() {
        return this.state.board;
    }

    get activeColor() {
        return this.state.activeColor;
    }

    getPiece(square) {
        const { row, col } = normalizeSquare(square);
        return this.state.board[row][col];
    }

    setPiece(square, piece) {
        const { row, col } = normalizeSquare(square);
        this.state.board[row][col] = piece;
    }

    candidateLegalMoves(square) {
        const from = normalizeSquare(square);
        const piece = this.state.board[from.row][from.col];
        if (piece === null || piece.color !== this.state.activeColor) {
            return [];
        }

        return this.pseudoMovesFrom(from)
            .filter((move) => this.isMoveLegal(from, move))
            .map((move) => decorateMove(from, move, this.state.board));
    }

    pseudoMovesFrom(square) {
        const from = normalizeSquare(square);
        const piece = this.state.board[from.row][from.col];
        if (piece === null) {
            return [];
        }

        return piece.pseudoMoves(this.state.board, from, this.state);
    }

    isMoveLegal(fromSquare, move) {
        const from = normalizeSquare(fromSquare);
        const piece = this.state.board[from.row][from.col];
        if (piece === null) {
            return false;
        }

        const destination = this.state.board[move.row][move.col];
        if (destination?.type === PIECE_TYPES.KING) {
            return false;
        }

        if (move.castle && !this.canCastleThrough(piece.color, move.castle)) {
            return false;
        }

        const nextBoard = this.boardAfterMove(from, move);
        return !this.isKingInCheck(piece.color, nextBoard);
    }

    boardAfterMove(fromSquare, move, promotionType = PIECE_TYPES.QUEEN) {
        const from = normalizeSquare(fromSquare);
        const board = cloneBoard(this.state.board);
        const piece = board[from.row][from.col];
        if (piece === null) {
            throw new Error('Cannot move from an empty square.');
        }

        board[from.row][from.col] = null;

        if (move.enPassant) {
            const capturedPawnRow = piece.color === COLORS.WHITE ? move.row + 1 : move.row - 1;
            board[capturedPawnRow][move.col] = null;
        }

        if (move.castle) {
            const homeRow = piece.color === COLORS.WHITE ? 7 : 0;
            if (move.castle === 'kingSide') {
                board[homeRow][5] = board[homeRow][7];
                board[homeRow][7] = null;
            } else {
                board[homeRow][3] = board[homeRow][0];
                board[homeRow][0] = null;
            }
        }

        board[move.row][move.col] = move.promotion ? this.createPromotionPiece(piece.color, promotionType) : piece;
        return board;
    }

    applyMove(fromSquare, toSquare, options = {}) {
        const from = normalizeSquare(fromSquare);
        const to = normalizeSquare(toSquare);
        const legalMove = this.candidateLegalMoves(from).find((move) => move.row === to.row && move.col === to.col);
        if (!legalMove) {
            throw new Error(`Illegal move: ${coordsToSquare(from.row, from.col)} to ${coordsToSquare(to.row, to.col)}`);
        }

        const piece = this.state.board[from.row][from.col];
        const captured = legalMove.enPassant
            ? this.state.board[piece.color === COLORS.WHITE ? to.row + 1 : to.row - 1][to.col]
            : this.state.board[to.row][to.col];

        this.state.board = this.boardAfterMove(from, legalMove, options.promotion || PIECE_TYPES.QUEEN);
        this.updateCastlingRights(piece, from, to, captured);
        this.state.enPassant = legalMove.doubleStep
            ? coordsToSquare((from.row + to.row) / 2, from.col)
            : '-';
        this.state.enPassantSquare = this.state.enPassant === '-' ? null : squareToCoords(this.state.enPassant);
        this.state.halfmoveClock = piece.type === PIECE_TYPES.PAWN || captured ? 0 : this.state.halfmoveClock + 1;
        if (piece.color === COLORS.BLACK) {
            this.state.fullmoveNumber += 1;
        }
        this.state.activeColor = oppositeColor(piece.color);

        return legalMove;
    }

    isKingInCheck(color, board = this.state.board) {
        const king = this.findKing(color, board);
        if (!king) {
            throw new Error(`Invalid board state: missing ${color} king.`);
        }

        return this.isSquareAttacked(king, oppositeColor(color), board);
    }

    isSquareAttacked(square, byColor, board = this.state.board) {
        const target = normalizeSquare(square);

        for (let row = 0; row < 8; row += 1) {
            for (let col = 0; col < 8; col += 1) {
                const piece = board[row][col];
                if (piece === null || piece.color !== byColor) {
                    continue;
                }

                if (this.pieceAttacksSquare(piece, { row, col }, target, board)) {
                    return true;
                }
            }
        }

        return false;
    }

    pieceAttacksSquare(piece, from, target, board) {
        if (piece.type === PIECE_TYPES.PAWN) {
            const direction = piece.color === COLORS.WHITE ? -1 : 1;
            return target.row === from.row + direction && Math.abs(target.col - from.col) === 1;
        }

        if (piece.type === PIECE_TYPES.KING) {
            return Math.max(Math.abs(target.row - from.row), Math.abs(target.col - from.col)) === 1;
        }

        return piece.pseudoMoves(board, from, { ...this.state, board, castling: null, enPassantSquare: null })
            .some((move) => move.row === target.row && move.col === target.col);
    }

    findKing(color, board = this.state.board) {
        for (let row = 0; row < 8; row += 1) {
            for (let col = 0; col < 8; col += 1) {
                const piece = board[row][col];
                if (piece !== null && piece.color === color && piece.type === PIECE_TYPES.KING) {
                    return { row, col };
                }
            }
        }

        return null;
    }

    validateKings(board = this.state.board) {
        for (const color of [COLORS.WHITE, COLORS.BLACK]) {
            const kingCount = this.countKings(color, board);
            if (kingCount !== 1) {
                throw new Error(`Invalid board state: expected exactly one ${color} king, found ${kingCount}.`);
            }
        }
    }

    countKings(color, board = this.state.board) {
        let count = 0;

        for (let row = 0; row < 8; row += 1) {
            for (let col = 0; col < 8; col += 1) {
                const piece = board[row][col];
                if (piece !== null && piece.color === color && piece.type === PIECE_TYPES.KING) {
                    count += 1;
                }
            }
        }

        return count;
    }

    canCastleThrough(color, side) {
        const homeRow = color === COLORS.WHITE ? 7 : 0;
        const opponent = oppositeColor(color);
        const path = side === 'kingSide'
            ? [{ row: homeRow, col: 4 }, { row: homeRow, col: 5 }, { row: homeRow, col: 6 }]
            : [{ row: homeRow, col: 4 }, { row: homeRow, col: 3 }, { row: homeRow, col: 2 }];

        return path.every((square) => !this.isSquareAttacked(square, opponent));
    }

    createPromotionPiece(color, promotionType) {
        const PieceClass = PROMOTION_PIECES[promotionType] || Queen;
        return new PieceClass(color);
    }

    updateCastlingRights(piece, from, to, captured) {
        if (piece.type === PIECE_TYPES.KING) {
            this.state.castling[piece.color].kingSide = false;
            this.state.castling[piece.color].queenSide = false;
        }

        if (piece.type === PIECE_TYPES.ROOK) {
            clearCastlingForRookSquare(this.state.castling, from.row, from.col);
        }

        if (captured?.type === PIECE_TYPES.ROOK) {
            clearCastlingForRookSquare(this.state.castling, to.row, to.col);
        }
    }
}

export { STARTING_FEN, parseFen, serializeFen, squareToCoords, coordsToSquare };

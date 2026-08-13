import { getGame, getPromotionOptions, listMoves, submitMove, updateProfile } from './chess-api.js';

const BOARD_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const BOARD_RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
const POLL_MS = 5000;
const PROMOTION_NAMES = Object.freeze({
    q: 'Queen',
    r: 'Rook',
    b: 'Bishop',
    n: 'Knight',
});
const PIECE_NAMES = Object.freeze({
    p: 'pawn',
    r: 'rook',
    n: 'knight',
    b: 'bishop',
    q: 'queen',
    k: 'king',
});
const PIECE_ASSETS = Object.freeze({
    P: '/assets/chess/white-pawn.png',
    R: '/assets/chess/white-rook.png',
    N: '/assets/chess/white-knight.png',
    B: '/assets/chess/white-bishop.png',
    Q: '/assets/chess/white-queen.png',
    K: '/assets/chess/white-king.png',
    p: '/assets/chess/black-pawn.png',
    r: '/assets/chess/black-rook.png',
    n: '/assets/chess/black-knight.png',
    b: '/assets/chess/black-bishop.png',
    q: '/assets/chess/black-queen.png',
    k: '/assets/chess/black-king.png',
});

const elements = {
    root: document.querySelector('[data-chess-game]'),
    summary: document.getElementById('chess-game-summary'),
    error: document.getElementById('chess-game-error'),
    turnStatus: document.getElementById('chess-turn-status'),
    ruleStatus: document.getElementById('chess-rule-status'),
    controlStatus: document.getElementById('chess-control-status'),
    board: document.getElementById('chess-board'),
    boardMessage: document.getElementById('chess-board-message'),
    whitePlayer: document.getElementById('chess-white-player'),
    blackPlayer: document.getElementById('chess-black-player'),
    viewerPlayer: document.getElementById('chess-viewer-player'),
    currentName: document.getElementById('chess-current-name'),
    profileForm: document.getElementById('chess-profile-form'),
    displayName: document.getElementById('chess-display-name'),
    saveNameButton: document.getElementById('chess-save-name-button'),
    profileMessage: document.getElementById('chess-profile-message'),
    moveList: document.getElementById('chess-move-list'),
    promotionDialog: document.getElementById('chess-promotion-dialog'),
    promotionOptions: document.getElementById('chess-promotion-options'),
    promotionCancel: document.getElementById('chess-promotion-cancel'),
};

const state = {
    gameId: '',
    game: null,
    moves: [],
    board: new Map(),
    selectedSquare: '',
    pendingMove: null,
    promotionFocusReturn: null,
    pollTimer: 0,
    isLoading: false,
    isSubmitting: false,
    savedDisplayName: '',
};

const titleCase = (value) => {
    const normalized = String(value || '').replace(/[_-]+/g, ' ').trim();
    return normalized === '' ? 'Unknown' : normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const setMessage = (element, message = '', tone = '') => {
    element.textContent = message;
    element.dataset.tone = tone;
};

const errorMessage = (error, fallback) => {
    if (error && typeof error.message === 'string' && error.message.trim() !== '') {
        return error.message;
    }

    return fallback;
};

const normalizeUuid = (value) => String(value || '').trim().toLowerCase();

const readGameId = () => {
    const params = new URLSearchParams(window.location.search);
    const id = normalizeUuid(params.get('id'));
    return /^[a-f0-9-]{36}$/.test(id) ? id : '';
};

const squareName = (fileIndex, rankIndex) => `${BOARD_FILES[fileIndex]}${BOARD_RANKS[rankIndex]}`;

const isWhitePiece = (piece) => piece.toUpperCase() === piece;

const pieceColor = (piece) => (isWhitePiece(piece) ? 'white' : 'black');

const pieceName = (piece) => `${pieceColor(piece)} ${PIECE_NAMES[piece.toLowerCase()] || 'piece'}`;

const parseFen = (fen) => {
    const placement = String(fen || '').split(' ')[0] || '';
    const ranks = placement.split('/');
    const board = new Map();

    ranks.slice(0, 8).forEach((rank, rankIndex) => {
        let fileIndex = 0;
        Array.from(rank).forEach((token) => {
            const emptyCount = Number.parseInt(token, 10);
            if (Number.isInteger(emptyCount) && emptyCount > 0) {
                fileIndex += emptyCount;
                return;
            }

            if (fileIndex < 8 && Object.prototype.hasOwnProperty.call(PIECE_ASSETS, token)) {
                board.set(squareName(fileIndex, rankIndex), token);
            }
            fileIndex += 1;
        });
    });

    return board;
};

const legalMoves = () => (Array.isArray(state.game?.legal_moves) ? state.game.legal_moves : []);

const legalMovesFrom = (square) => legalMoves().filter((move) => move?.from === square);

const legalMovesTo = (from, to) => legalMovesFrom(from).filter((move) => move?.to === to);

const viewerSeatColor = () => {
    const color = state.game?.viewer?.seat_color;
    return color === 'white' || color === 'black' ? color : '';
};

const viewerControlsTurn = () => state.game?.viewer?.controls_current_turn === true;

const canSelectSquare = (square) => {
    if (!viewerControlsTurn()) {
        return false;
    }

    const piece = state.board.get(square);
    return Boolean(piece && pieceColor(piece) === viewerSeatColor() && legalMovesFrom(square).length > 0);
};

const findPlayer = (color) => {
    if (!Array.isArray(state.game?.players)) {
        return null;
    }

    return state.game.players.find((player) => player?.color === color) || null;
};

const viewerPlayer = () => {
    if (!Array.isArray(state.game?.players)) {
        return null;
    }

    return state.game.players.find((player) => player?.viewer_controls_seat === true) || null;
};

const deriveDisplayName = () => {
    if (state.savedDisplayName !== '') {
        return state.savedDisplayName;
    }

    const player = viewerPlayer();
    const name = typeof player?.display_name === 'string' ? player.display_name.trim() : '';
    return name !== '' ? name : 'Guest player';
};

const setVisibleIdentity = (name) => {
    const visibleName = typeof name === 'string' && name.trim() !== '' ? name.trim() : deriveDisplayName();
    elements.currentName.textContent = visibleName;
    elements.viewerPlayer.textContent = viewerSeatColor() ? `${visibleName} (${titleCase(viewerSeatColor())})` : visibleName;
};

const renderError = (message) => {
    elements.error.hidden = false;
    elements.error.textContent = message;
    elements.root.dataset.state = 'error';
    setMessage(elements.boardMessage, message, 'error');
};

const clearError = () => {
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.root.dataset.state = 'ready';
};

const renderBoard = () => {
    const targets = state.selectedSquare ? new Set(legalMovesFrom(state.selectedSquare).map((move) => move.to)) : new Set();
    elements.board.replaceChildren();

    BOARD_RANKS.forEach((rank, rankIndex) => {
        BOARD_FILES.forEach((file, fileIndex) => {
            const square = `${file}${rank}`;
            const piece = state.board.get(square) || '';
            const button = document.createElement('button');
            button.className = `chess-square ${(fileIndex + rankIndex) % 2 === 0 ? 'chess-square-light' : 'chess-square-dark'}`;
            button.type = 'button';
            button.dataset.square = square;
            button.setAttribute('role', 'gridcell');
            button.setAttribute('aria-label', piece ? `${square}: ${pieceName(piece)}` : `${square}: empty`);

            if (square === state.selectedSquare) {
                button.classList.add('chess-square-selected');
                button.setAttribute('aria-selected', 'true');
            }

            if (targets.has(square)) {
                button.classList.add('chess-square-target');
            }

            if (!viewerControlsTurn() || (!canSelectSquare(square) && !targets.has(square))) {
                button.disabled = true;
            }

            if (piece) {
                const image = document.createElement('img');
                image.className = 'chess-piece';
                image.src = PIECE_ASSETS[piece];
                image.alt = pieceName(piece);
                image.draggable = false;
                button.append(image);
            }

            elements.board.append(button);
        });
    });
};

const renderStatus = () => {
    const sideToMove = state.game?.position?.side_to_move || '';
    const rules = state.game?.rules_state || {};
    const result = rules.result && rules.result !== '*' ? ` (${rules.result})` : '';
    const check = rules.in_check === true ? ' in check' : '';
    const moveText = sideToMove ? `${titleCase(sideToMove)} to move${check}` : 'Turn unavailable';
    const statusText = `${titleCase(rules.status || state.game?.status)}${result}`;

    elements.summary.textContent = `${moveText}. ${statusText}.`;
    elements.turnStatus.textContent = moveText;
    elements.ruleStatus.textContent = rules.draw_reason ? `${statusText}: ${titleCase(rules.draw_reason)}` : statusText;

    if (viewerControlsTurn()) {
        elements.controlStatus.textContent = 'Your move';
    } else if (viewerSeatColor()) {
        elements.controlStatus.textContent = `Playing ${titleCase(viewerSeatColor())}`;
    } else {
        elements.controlStatus.textContent = 'Spectating';
    }
};

const renderPlayers = () => {
    const white = findPlayer('white');
    const black = findPlayer('black');
    elements.whitePlayer.textContent = white?.display_name || 'White';
    elements.blackPlayer.textContent = black?.display_name || 'Black';
    setVisibleIdentity();
};

const renderMoves = () => {
    elements.moveList.replaceChildren();

    if (state.moves.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'lede';
        empty.textContent = 'No moves yet.';
        elements.moveList.append(empty);
        return;
    }

    state.moves.forEach((move) => {
        const row = document.createElement('div');
        row.className = 'chess-move-row';

        const ply = document.createElement('strong');
        ply.textContent = Number.isInteger(move?.ply) ? String(move.ply) : '-';

        const description = document.createElement('span');
        const player = move?.player?.display_name || titleCase(move?.player?.color);
        const notation = move?.san || move?.uci || 'Move';
        description.textContent = `${player}: ${notation}`;

        row.append(ply, description);
        elements.moveList.append(row);
    });
};

const renderGame = () => {
    if (!state.game) {
        return;
    }

    state.board = parseFen(state.game?.position?.fen || '');
    renderStatus();
    renderPlayers();
    renderMoves();
    renderBoard();
};

const normalizeMoves = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    return [];
};

const refresh = async ({ quiet = false } = {}) => {
    if (state.isLoading || state.isSubmitting || state.gameId === '') {
        return;
    }

    state.isLoading = true;
    if (!quiet) {
        setMessage(elements.boardMessage, 'Loading game...', 'neutral');
    }

    try {
        const [game, movesPayload] = await Promise.all([
            getGame(state.gameId),
            listMoves(state.gameId),
        ]);
        state.game = game;
        state.moves = normalizeMoves(movesPayload);
        state.selectedSquare = '';
        clearError();
        renderGame();
        if (!quiet) {
            setMessage(elements.boardMessage, viewerControlsTurn() ? 'Your move.' : 'Board updated.', 'success');
        }
    } catch (error) {
        const notFound = error?.status === 404;
        renderError(notFound ? 'That chess game was not found.' : errorMessage(error, 'The chess game could not be loaded.'));
    } finally {
        state.isLoading = false;
    }
};

const createClientMoveId = () => {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
        const random = Math.floor(Math.random() * 16);
        const value = token === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
};

const choosePromotion = (moves) => new Promise((resolve) => {
    elements.promotionOptions.replaceChildren();
    state.pendingMove = { moves, resolve };
    state.promotionFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    moves.forEach((move) => {
        const promotion = typeof move?.promotion === 'string' ? move.promotion : '';
        if (promotion === '') {
            return;
        }

        const button = document.createElement('button');
        button.className = 'chess-button chess-button-small';
        button.type = 'button';
        button.dataset.promotion = promotion;
        button.textContent = PROMOTION_NAMES[promotion] || titleCase(promotion);
        button.setAttribute('aria-label', `Promote to ${button.textContent}`);
        elements.promotionOptions.append(button);
    });

    elements.promotionDialog.hidden = false;
    elements.promotionOptions.querySelector('button')?.focus();
});

const closePromotionDialog = (value = null) => {
    if (state.pendingMove?.resolve) {
        state.pendingMove.resolve(value);
    }
    const focusReturn = state.promotionFocusReturn;
    state.pendingMove = null;
    state.promotionFocusReturn = null;
    elements.promotionDialog.hidden = true;
    elements.promotionOptions.replaceChildren();
    if (focusReturn && document.contains(focusReturn) && !focusReturn.disabled) {
        focusReturn.focus();
    }
};

const promotionMovesFor = async (from, to, fallbackMoves) => {
    try {
        const options = await getPromotionOptions(state.gameId, { from, to });
        if (Array.isArray(options) && options.length > 0) {
            return options;
        }
    } catch (error) {
        setMessage(elements.boardMessage, errorMessage(error, 'Promotion options could not be loaded.'), 'error');
    }

    return fallbackMoves.filter((move) => move?.promotion);
};

const submitSelectedMove = async (move) => {
    state.isSubmitting = true;
    setMessage(elements.boardMessage, 'Submitting move...', 'neutral');

    try {
        const payload = {
            uci: move.uci,
            client_move_id: createClientMoveId(),
        };
        if (move.promotion) {
            payload.promotion = move.promotion;
        }

        state.game = await submitMove(state.gameId, payload);
        state.moves = normalizeMoves(await listMoves(state.gameId));
        state.selectedSquare = '';
        clearError();
        renderGame();
        setMessage(elements.boardMessage, 'Move accepted.', 'success');
    } catch (error) {
        setMessage(elements.boardMessage, errorMessage(error, 'That move could not be submitted.'), 'error');
        state.isSubmitting = false;
        await refresh({ quiet: true });
    } finally {
        state.isSubmitting = false;
    }
};

const selectTarget = async (from, to) => {
    const matches = legalMovesTo(from, to);
    if (matches.length === 0) {
        state.selectedSquare = canSelectSquare(to) ? to : '';
        renderBoard();
        return;
    }

    let move = matches.find((candidate) => !candidate?.promotion) || matches[0];
    const promotionCandidates = matches.filter((candidate) => candidate?.promotion);
    if (promotionCandidates.length > 0) {
        const options = await promotionMovesFor(from, to, promotionCandidates);
        const selectedPromotion = await choosePromotion(options);
        if (!selectedPromotion) {
            setMessage(elements.boardMessage, 'Promotion canceled.', 'neutral');
            return;
        }
        move = options.find((candidate) => candidate?.promotion === selectedPromotion) || promotionCandidates[0];
    }

    await submitSelectedMove(move);
};

const handleBoardClick = (event) => {
    const squareElement = event.target.closest('.chess-square');
    if (!squareElement || state.isSubmitting || !viewerControlsTurn()) {
        return;
    }

    const square = squareElement.dataset.square || '';
    if (state.selectedSquare === '') {
        if (canSelectSquare(square)) {
            state.selectedSquare = square;
            setMessage(elements.boardMessage, `Selected ${square}.`, 'neutral');
            renderBoard();
        }
        return;
    }

    selectTarget(state.selectedSquare, square);
};

const handlePromotionClick = (event) => {
    const button = event.target.closest('button[data-promotion]');
    if (!button) {
        return;
    }

    closePromotionDialog(button.dataset.promotion || null);
};

const handlePromotionKeydown = (event) => {
    if (event.key === 'Escape' && !elements.promotionDialog.hidden) {
        event.preventDefault();
        closePromotionDialog(null);
    }
};

const handleProfileSave = async (event) => {
    event.preventDefault();
    const displayName = elements.displayName.value.trim();

    if (displayName === '') {
        setMessage(elements.profileMessage, 'Enter a display name before saving.', 'error');
        return;
    }

    elements.saveNameButton.disabled = true;
    setMessage(elements.profileMessage, 'Saving name...', 'neutral');

    try {
        const profile = await updateProfile(displayName);
        state.savedDisplayName = typeof profile?.display_name === 'string' ? profile.display_name : displayName;
        setVisibleIdentity(state.savedDisplayName);
        elements.displayName.value = '';
        setMessage(elements.profileMessage, 'Name saved.', 'success');
        await refresh({ quiet: true });
    } catch (error) {
        setMessage(elements.profileMessage, errorMessage(error, 'The display name could not be saved.'), 'error');
    } finally {
        elements.saveNameButton.disabled = false;
    }
};

const startPolling = () => {
    window.clearInterval(state.pollTimer);
    if (document.hidden || state.gameId === '') {
        return;
    }

    state.pollTimer = window.setInterval(() => refresh({ quiet: true }), POLL_MS);
};

const stopPolling = () => {
    window.clearInterval(state.pollTimer);
    state.pollTimer = 0;
};

const handleVisibilityChange = () => {
    if (document.hidden) {
        stopPolling();
        return;
    }

    refresh({ quiet: true });
    startPolling();
};

const init = () => {
    state.gameId = readGameId();
    if (state.gameId === '') {
        renderError('Open a chess game with a valid game id.');
        return;
    }

    elements.board.addEventListener('click', handleBoardClick);
    elements.profileForm.addEventListener('submit', handleProfileSave);
    elements.promotionOptions.addEventListener('click', handlePromotionClick);
    elements.promotionCancel.addEventListener('click', () => closePromotionDialog(null));
    document.addEventListener('keydown', handlePromotionKeydown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', stopPolling);

    refresh();
    startPolling();
};

init();

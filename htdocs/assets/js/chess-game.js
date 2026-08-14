import { cancelTakeback, getGame, getProfile, getPromotionOptions, listMoves, requestTakeback, resignGame, submitMove, updateProfile } from './chess-api.js';

const BOARD_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const BOARD_RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
const POLL_MS = 5000;
const NOTIFICATION_STORAGE_KEY = 'wowie.chess.moveNotificationsEnabled';
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

const chessDocument = typeof document === 'undefined' ? null : document;
let elements = {};

const resolveElements = () => {
    const currentDocument = typeof document === 'undefined' ? null : document;

    return {
        root: currentDocument?.querySelector('[data-chess-game]') || null,
        summary: currentDocument?.getElementById('chess-game-summary') || null,
        error: currentDocument?.getElementById('chess-game-error') || null,
        turnStatus: currentDocument?.getElementById('chess-turn-status') || null,
        ruleStatus: currentDocument?.getElementById('chess-rule-status') || null,
        controlStatus: currentDocument?.getElementById('chess-control-status') || null,
        openingStatus: currentDocument?.getElementById('chess-opening-status') || null,
        takebackButton: currentDocument?.getElementById('chess-takeback-button') || null,
        resignButton: currentDocument?.getElementById('chess-resign-button') || null,
        fullscreenToggle: currentDocument?.getElementById('chess-fullscreen-toggle') || null,
        fullscreenExit: currentDocument?.getElementById('chess-fullscreen-exit') || null,
        board: currentDocument?.getElementById('chess-board') || null,
        boardMessage: currentDocument?.getElementById('chess-board-message') || null,
        whitePlayer: currentDocument?.getElementById('chess-white-player') || null,
        blackPlayer: currentDocument?.getElementById('chess-black-player') || null,
        viewerPlayer: currentDocument?.getElementById('chess-viewer-player') || null,
        currentName: currentDocument?.getElementById('chess-current-name') || null,
        profileForm: currentDocument?.getElementById('chess-profile-form') || null,
        displayName: currentDocument?.getElementById('chess-display-name') || null,
        saveNameButton: currentDocument?.getElementById('chess-save-name-button') || null,
        notificationToggle: currentDocument?.getElementById('chess-move-notifications') || null,
        notificationMessage: currentDocument?.getElementById('chess-notification-message') || null,
        profileMessage: currentDocument?.getElementById('chess-profile-message') || null,
        moveList: currentDocument?.getElementById('chess-move-list') || null,
        promotionDialog: currentDocument?.getElementById('chess-promotion-dialog') || null,
        promotionOptions: currentDocument?.getElementById('chess-promotion-options') || null,
        promotionCancel: currentDocument?.getElementById('chess-promotion-cancel') || null,
    };
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
    isBoardFullscreen: false,
    notificationsEnabled: false,
    lastNotifiedPly: 0,
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

const ensureOpeningStatusElement = () => {
    if (elements.openingStatus instanceof HTMLElement) {
        return elements.openingStatus;
    }

    const statusRow = elements.turnStatus?.parentElement;
    if (!(statusRow instanceof HTMLElement)) {
        return null;
    }

    const openingStatus = document.createElement('span');
    openingStatus.className = 'chess-status-pill';
    openingStatus.id = 'chess-opening-status';
    openingStatus.hidden = true;
    statusRow.insertBefore(openingStatus, elements.takebackButton || null);
    elements.openingStatus = openingStatus;
    return openingStatus;
};

export const formatOpening = (opening) => {
    if (!opening || typeof opening !== 'object' || opening.on_book !== true) {
        return {
            label: 'Off book',
            onBook: false,
            tone: 'neutral',
        };
    }

    const ecoCode = typeof opening.eco_code === 'string' ? opening.eco_code.trim() : '';
    const name = typeof opening.name === 'string' ? opening.name.trim() : '';
    let label = 'On book';
    if (ecoCode !== '' && name !== '') {
        label = `[${ecoCode}] ${name}`;
    } else if (ecoCode !== '') {
        label = `[${ecoCode}]`;
    } else if (name !== '') {
        label = name;
    }

    return {
        label,
        onBook: true,
        tone: 'success',
    };
};

const renderOpeningStatus = () => {
    const openingStatus = ensureOpeningStatusElement();
    if (!(openingStatus instanceof HTMLElement)) {
        return;
    }

    const opening = formatOpening(state.game?.opening);
    openingStatus.hidden = false;
    openingStatus.setAttribute('aria-label', `Opening: ${opening.label}`);
    setMessage(openingStatus, opening.label, opening.tone);
};

const errorMessage = (error, fallback) => {
    if (error && typeof error.message === 'string' && error.message.trim() !== '') {
        return error.message;
    }

    return fallback;
};

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const normalizeUuid = (value) => String(value || '').trim().toLowerCase();

const notificationsSupported = () => 'Notification' in window;

const readNotificationPreference = () => {
    try {
        return window.localStorage.getItem(NOTIFICATION_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const writeNotificationPreference = (isEnabled) => {
    try {
        window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, isEnabled ? 'true' : 'false');
    } catch {
        // Storage can be unavailable in private modes; keep the in-memory choice for this page.
    }
};

const setNotificationsEnabled = (isEnabled, { persist = true, message = '', tone = '' } = {}) => {
    state.notificationsEnabled = isEnabled;
    elements.notificationToggle.checked = isEnabled;
    if (persist) {
        writeNotificationPreference(isEnabled);
    }
    setMessage(elements.notificationMessage, message, tone);
};

const disableNotifications = (message) => {
    setNotificationsEnabled(false, { message, tone: 'error' });
};

const restoreNotificationPreference = () => {
    if (!readNotificationPreference()) {
        setNotificationsEnabled(false, { persist: false });
        return;
    }

    setNotificationsEnabled(true, { persist: false });
    if (!notificationsSupported()) {
        disableNotifications('Browser notifications are not supported on this device.');
        return;
    }

    if (Notification.permission !== 'granted') {
        disableNotifications('Move notifications need browser permission. Turn them on again to allow alerts.');
    }
};

const handleNotificationToggle = async () => {
    if (!elements.notificationToggle.checked) {
        setNotificationsEnabled(false, { message: 'Move notifications disabled.', tone: 'neutral' });
        return;
    }

    if (!notificationsSupported()) {
        disableNotifications('Browser notifications are not supported on this device.');
        return;
    }

    if (Notification.permission === 'denied') {
        disableNotifications('Browser notification permission is blocked.');
        return;
    }

    if (Notification.permission !== 'granted') {
        setMessage(elements.notificationMessage, 'Allow notifications in your browser to enable move alerts.', 'neutral');
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                disableNotifications('Browser notification permission was not granted.');
                return;
            }
        } catch {
            disableNotifications('Browser notification permission could not be requested.');
            return;
        }
    }

    setNotificationsEnabled(true, { message: 'Move notifications enabled.', tone: 'success' });
};

const readGameId = () => {
    const params = new URLSearchParams(window.location.search);
    const id = normalizeUuid(params.get('id'));
    return UUID_PATTERN.test(id) ? id : '';
};

const squareName = (fileIndex, rankIndex) => `${BOARD_FILES[fileIndex]}${BOARD_RANKS[rankIndex]}`;

const isWhitePiece = (piece) => piece.toUpperCase() === piece;

const pieceColor = (piece) => (isWhitePiece(piece) ? 'white' : 'black');

const normalizeSideToMove = (sideToMove) => {
    if (sideToMove === 'w') {
        return 'white';
    }
    if (sideToMove === 'b') {
        return 'black';
    }
    return sideToMove === 'white' || sideToMove === 'black' ? sideToMove : '';
};

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

const gameAllowsPlayerActions = () => ['waiting', 'active'].includes(String(state.game?.status || '')) && viewerSeatColor() !== '';

const takebackCandidate = () => state.game?.pending_takeback
    || state.game?.takeback_offer
    || state.game?.takeback
    || state.game?.pendingTakeback
    || null;

const normalizeTakebackColor = (value) => normalizeSideToMove(value) || '';

const pendingTakeback = () => {
    const candidate = takebackCandidate();
    if (!candidate) {
        return null;
    }

    if (typeof candidate === 'string') {
        const requestedBy = normalizeTakebackColor(candidate);
        return requestedBy ? { requestedBy } : null;
    }

    if (typeof candidate !== 'object') {
        return null;
    }

    const requestedBy = normalizeTakebackColor(
        candidate.requested_by_color
            || candidate.requesting_color
            || candidate.requested_by
            || candidate.requestedBy
            || candidate.color
            || candidate.seat_color
            || candidate.player_color,
    );

    return requestedBy ? { requestedBy } : null;
};

const canSelectSquare = (square) => {
    if (!viewerControlsTurn()) {
        return false;
    }

    const sideToMove = normalizeSideToMove(state.game?.position?.side_to_move);
    const piece = state.board.get(square);
    return Boolean(piece && pieceColor(piece) === sideToMove && legalMovesFrom(square).length > 0);
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

const renderActionControls = () => {
    const seatColor = viewerSeatColor();
    const canAct = gameAllowsPlayerActions();
    const offer = pendingTakeback();
    const takebackAction = offer ? (offer.requestedBy === seatColor ? 'cancel' : 'accept') : 'request';

    elements.resignButton.hidden = !canAct;
    elements.resignButton.disabled = state.isSubmitting;
    elements.takebackButton.hidden = !canAct;
    elements.takebackButton.disabled = state.isSubmitting;
    elements.takebackButton.dataset.action = takebackAction;
    elements.takebackButton.textContent = takebackAction === 'cancel'
        ? 'Cancel takeback'
        : (takebackAction === 'accept' ? 'Accept takeback' : 'Takeback');
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
    const sideToMove = normalizeSideToMove(state.game?.position?.side_to_move);
    const rules = state.game?.rules_state || {};
    const result = rules.result && rules.result !== '*' ? ` (${rules.result})` : '';
    const check = rules.in_check === true ? ' in check' : '';
    const moveText = sideToMove ? `${titleCase(sideToMove)} to move${check}` : 'Turn unavailable';
    const statusText = `${titleCase(rules.status || state.game?.status)}${result}`;
    const seatColor = viewerSeatColor();
    const offer = pendingTakeback();

    elements.summary.textContent = `${moveText}. ${statusText}.`;
    elements.turnStatus.textContent = moveText;
    elements.ruleStatus.textContent = rules.draw_reason ? `${statusText}: ${titleCase(rules.draw_reason)}` : statusText;

    if (offer) {
        const requester = titleCase(offer.requestedBy);
        if (offer.requestedBy === seatColor) {
            elements.controlStatus.textContent = `Takeback requested by ${requester}`;
            setMessage(elements.boardMessage, 'Takeback requested. Awaiting opponent response.', 'neutral');
        } else {
            elements.controlStatus.textContent = `${requester} requested a takeback`;
            setMessage(elements.boardMessage, `${requester} requested a takeback.`, 'neutral');
        }
    } else if (viewerControlsTurn()) {
        elements.controlStatus.textContent = 'Your move';
    } else if (seatColor) {
        elements.controlStatus.textContent = `Playing ${titleCase(seatColor)}`;
    } else {
        elements.controlStatus.textContent = 'Spectating';
    }

    renderActionControls();
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
    renderOpeningStatus();
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

const currentPly = (game) => {
    const ply = Number(game?.current_ply);
    return Number.isInteger(ply) && ply >= 0 ? ply : null;
};

const moveForPly = (ply) => state.moves.find((move) => Number(move?.ply) === ply) || null;

const notifyOpponentMove = (ply) => {
    if (!state.notificationsEnabled || state.lastNotifiedPly === ply || !notificationsSupported() || Notification.permission !== 'granted') {
        return;
    }

    const move = moveForPly(ply);
    const player = move?.player?.display_name || titleCase(move?.player?.color);
    const notation = move?.san || move?.uci || 'Move played';
    state.lastNotifiedPly = ply;

    try {
        new Notification(`${player} moved`, {
            body: `${notation}. Your move.`,
        });
    } catch {
        disableNotifications('Move notifications could not be shown by this browser.');
    }
};

const maybeNotifyOpponentMove = (previousPly, previousControlsTurn) => {
    const newPly = currentPly(state.game);
    if (previousPly === null || newPly === null || newPly <= previousPly) {
        return;
    }

    if (!previousControlsTurn && viewerControlsTurn()) {
        notifyOpponentMove(newPly);
    }
};

const refresh = async ({ quiet = false } = {}) => {
    if (state.isLoading || state.isSubmitting || state.gameId === '') {
        return;
    }

    state.isLoading = true;
    if (!quiet) {
        setMessage(elements.boardMessage, 'Loading game...', 'neutral');
    }

    const previousPly = currentPly(state.game);
    const previousControlsTurn = viewerControlsTurn();

    try {
        const [game, movesPayload] = await Promise.all([
            getGame(state.gameId),
            listMoves(state.gameId),
        ]);
        state.game = game;
        state.moves = normalizeMoves(movesPayload);
        state.selectedSquare = '';
        maybeNotifyOpponentMove(previousPly, previousControlsTurn);
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
        renderActionControls();
    }
};

const refreshAfterGameAction = async (game, successMessage) => {
    if (game && typeof game === 'object') {
        state.game = game;
        state.moves = normalizeMoves(await listMoves(state.gameId));
        state.selectedSquare = '';
        clearError();
        renderGame();
        setMessage(elements.boardMessage, successMessage, 'success');
        return;
    }

    state.isSubmitting = false;
    await refresh({ quiet: true });
    setMessage(elements.boardMessage, successMessage, 'success');
};

const handleResign = async () => {
    const color = viewerSeatColor();
    if (!gameAllowsPlayerActions() || state.isSubmitting || color === '') {
        return;
    }

    if (!window.confirm('Resign this chess game?')) {
        return;
    }

    state.isSubmitting = true;
    renderActionControls();
    setMessage(elements.boardMessage, 'Resigning game...', 'neutral');

    try {
        await refreshAfterGameAction(await resignGame(state.gameId, { color }), 'Game resigned.');
    } catch (error) {
        setMessage(elements.boardMessage, errorMessage(error, 'The game could not be resigned.'), 'error');
        state.isSubmitting = false;
        await refresh({ quiet: true });
    } finally {
        state.isSubmitting = false;
        renderActionControls();
    }
};

const handleTakeback = async () => {
    if (!gameAllowsPlayerActions() || state.isSubmitting) {
        return;
    }

    const action = ['accept', 'cancel'].includes(elements.takebackButton.dataset.action) ? elements.takebackButton.dataset.action : 'request';
    state.isSubmitting = true;
    renderActionControls();
    setMessage(elements.boardMessage, action === 'cancel' ? 'Canceling takeback...' : `${titleCase(action)}ing takeback...`, 'neutral');

    try {
        const game = action === 'cancel'
            ? await cancelTakeback(state.gameId)
            : await requestTakeback(state.gameId);
        await refreshAfterGameAction(game, action === 'cancel' ? 'Takeback canceled.' : `Takeback ${action === 'accept' ? 'accepted' : 'submitted'}.`);
    } catch (error) {
        setMessage(elements.boardMessage, errorMessage(error, 'The takeback request could not be submitted.'), 'error');
        state.isSubmitting = false;
        await refresh({ quiet: true });
    } finally {
        state.isSubmitting = false;
        renderActionControls();
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

const setBoardFullscreen = (isFullscreen) => {
    state.isBoardFullscreen = isFullscreen;
    elements.root.dataset.boardFullscreen = isFullscreen ? 'true' : 'false';
    elements.fullscreenToggle.setAttribute('aria-expanded', isFullscreen ? 'true' : 'false');
};

const handleFullscreenToggle = () => {
    setBoardFullscreen(!state.isBoardFullscreen);
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

    if (square === state.selectedSquare) {
        state.selectedSquare = '';
        setMessage(elements.boardMessage, '', 'neutral');
        renderBoard();
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
    if (state.gameId === '') {
        return;
    }

    state.pollTimer = window.setInterval(() => refresh({ quiet: true }), POLL_MS);
};

const stopPolling = () => {
    window.clearInterval(state.pollTimer);
    state.pollTimer = 0;
};

const handleVisibilityChange = () => {
    if (state.gameId === '') {
        stopPolling();
        return;
    }

    if (!document.hidden) {
        refresh({ quiet: true });
    }
    startPolling();
};

const seedProfileName = async () => {
    try {
        const profile = await getProfile();
        const displayName = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
        if (displayName !== '' && state.savedDisplayName === '') {
            state.savedDisplayName = displayName;
            setVisibleIdentity(displayName);
        }
    } catch (error) {
        // Keep the seat-derived name as the fallback when profile lookup is unavailable.
    }
};

const init = () => {
    elements = resolveElements();

    setBoardFullscreen(false);
    restoreNotificationPreference();
    state.gameId = readGameId();
    if (state.gameId === '') {
        renderError('Open a chess game with a valid game id.');
        return;
    }

    elements.board.addEventListener('click', handleBoardClick);
    elements.resignButton.addEventListener('click', handleResign);
    elements.takebackButton.addEventListener('click', handleTakeback);
    elements.fullscreenToggle.addEventListener('click', handleFullscreenToggle);
    elements.fullscreenExit.addEventListener('click', () => setBoardFullscreen(false));
    elements.profileForm.addEventListener('submit', handleProfileSave);
    elements.notificationToggle.addEventListener('change', handleNotificationToggle);
    elements.promotionOptions.addEventListener('click', handlePromotionClick);
    elements.promotionCancel.addEventListener('click', () => closePromotionDialog(null));
    document.addEventListener('keydown', handlePromotionKeydown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', stopPolling);

    seedProfileName();
    refresh();
    startPolling();
};

const handleInitializationFailure = (error) => {
    elements = resolveElements();
    console.error('Chess game initialization failed.', error);

    if (elements.error && elements.root && elements.boardMessage) {
        renderError('Chess could not finish loading. The board controls were not initialized.');
    }
};

const boot = () => {
    try {
        init();
    } catch (error) {
        handleInitializationFailure(error);
    }
};

if (chessDocument !== null) {
    if (chessDocument.readyState === 'loading') {
        chessDocument.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
}

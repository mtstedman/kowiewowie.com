import { createInviteLink, getGame, markReady, resignGame, submitMove, submitSetup } from './stratego-api.js';
import { ARMY_SIZE, HIDDEN_ART, HIDDEN_GLYPH, PIECES, PIECE_GLYPHS, RANK_ORDER, isRankCode, rankBadge, rankLabel } from './stratego-pieces.js';

const FILES = 'abcdefghij';
const SIZE = 10;
const POLL_MS = 5000;
const NOTIFICATION_STORAGE_KEY = 'wowie.stratego.moveNotificationsEnabled';
const INVITE_STORAGE_PREFIX = 'wowie.stratego.invite.';
const SETUP_ROWS = Object.freeze({
    red: Object.freeze([0, 1, 2, 3]),
    blue: Object.freeze([6, 7, 8, 9]),
});
const GAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const API_ERROR_MESSAGES = Object.freeze({
    not_your_turn: 'It is not your turn yet. Wait for your opponent to move.',
    state_conflict: 'The board changed before your move landed. The latest position is now shown.',
    game_not_active: 'This game is not accepting that action right now.',
    seat_required: 'Only seated players can do that.',
    game_not_found: 'That Stratego game was not found.',
    game_not_waiting: 'This game is no longer waiting for an opponent.',
    seat_unavailable: 'This game no longer has an open seat.',
});
const KEY_DELTAS = Object.freeze({
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
});

const strategoDocument = typeof document === 'undefined' ? null : document;

/** @type {any} */
let elements = null;

const state = {
    gameId: '',
    game: null,
    view: null,
    signature: '',
    selectedSquare: '',
    focusSquare: '',
    draft: new Map(),
    draftDirty: false,
    selectedRank: '',
    inviteUrl: '',
    inviteRequested: false,
    failedArt: new Set(),
    pollTimer: 0,
    isLoading: false,
    isSubmitting: false,
    notificationsEnabled: false,
    lastNotifiedVersion: -1,
};

const resolveElements = () => {
    const byId = (id) => strategoDocument?.getElementById(id) || null;

    return {
        root: strategoDocument?.querySelector('[data-stratego-game]') || null,
        summary: byId('stratego-game-summary'),
        error: byId('stratego-game-error'),
        turnStatus: byId('stratego-turn-status'),
        phaseStatus: byId('stratego-phase-status'),
        seatStatus: byId('stratego-seat-status'),
        resignButton: byId('stratego-resign-button'),
        combatBanner: byId('stratego-combat-banner'),
        board: byId('stratego-board'),
        boardMessage: byId('stratego-board-message'),
        resultSection: byId('stratego-result-section'),
        resultText: byId('stratego-result-text'),
        inviteSection: byId('stratego-invite-section'),
        inviteUrl: byId('stratego-invite-url'),
        copyInviteButton: byId('stratego-copy-invite-button'),
        newInviteButton: byId('stratego-new-invite-button'),
        inviteMessage: byId('stratego-invite-message'),
        setupSection: byId('stratego-setup-section'),
        setupHelp: byId('stratego-setup-help'),
        setupCount: byId('stratego-setup-count'),
        tray: byId('stratego-tray'),
        randomiseButton: byId('stratego-randomise-button'),
        clearButton: byId('stratego-clear-button'),
        readyButton: byId('stratego-ready-button'),
        opponentReady: byId('stratego-opponent-ready'),
        redPlayer: byId('stratego-red-player'),
        bluePlayer: byId('stratego-blue-player'),
        viewerPlayer: byId('stratego-viewer-player'),
        captured: byId('stratego-captured'),
        notificationToggle: byId('stratego-move-notifications'),
        notificationMessage: byId('stratego-notification-message'),
    };
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const titleCase = (value) => {
    const normalized = String(value || '').replace(/[_-]+/g, ' ').trim();
    return normalized === '' ? 'Unknown' : normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const capitalize = (value) => (value === '' ? '' : value.charAt(0).toUpperCase() + value.slice(1));

const setMessage = (element, message = '', tone = '') => {
    if (!element) {
        return;
    }
    element.textContent = message;
    element.dataset.tone = tone;
};

const errorMessage = (error, fallback) => {
    if (error && typeof error.message === 'string' && error.message.trim() !== '') {
        return error.message;
    }

    return fallback;
};

const apiErrorMessage = (error, fallback) => {
    const code = typeof error?.error === 'string' ? error.error : '';
    if (code === 'illegal_move') {
        const rule = typeof error?.details?.rule === 'string' ? error.details.rule : '';
        const prefix = rule === 'invalid_setup' ? 'That setup is not valid' : 'That move is not allowed';
        return `${prefix}: ${errorMessage(error, 'it breaks the rules.')}`;
    }
    if (Object.prototype.hasOwnProperty.call(API_ERROR_MESSAGES, code)) {
        return API_ERROR_MESSAGES[code];
    }

    return errorMessage(error, fallback);
};

const coordsToSquare = (row, col) => `${FILES[col]}${row + 1}`;

const squareToCoords = (square) => {
    const match = /^([a-j])(10|[1-9])$/.exec(String(square || ''));
    if (!match) {
        return null;
    }

    return { row: Number(match[2]) - 1, col: FILES.indexOf(match[1]) };
};

const isLake = (row, col) => (row === 4 || row === 5) && (col === 2 || col === 3 || col === 6 || col === 7);

const opponentOf = (color) => (color === 'red' ? 'blue' : 'red');

const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }

    return copy;
};

const absoluteUrl = (url) => (typeof url === 'string' && url !== '' ? `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}` : '');

/* ------------------------------------------------------------------ */
/* Game state accessors                                                */
/* ------------------------------------------------------------------ */

const gameStatus = () => String(state.game?.status || '');

const viewerSeatColor = () => {
    const color = state.game?.viewer?.seat_color;
    return color === 'red' || color === 'blue' ? color : '';
};

const viewerControlsTurn = () => state.game?.viewer?.controls_current_turn === true && gameStatus() === 'active';

const findPlayer = (color) => (Array.isArray(state.game?.players) ? state.game.players.find((player) => player?.color === color) || null : null);

const playerName = (color) => {
    const player = findPlayer(color);
    const name = typeof player?.display_name === 'string' ? player.display_name.trim() : '';
    return name !== '' ? name : titleCase(color);
};

const playerSeated = (color) => findPlayer(color)?.seated === true;

const isColorReady = (color) => state.view?.ready?.[color] === true || findPlayer(color)?.is_ready === true;

const opponentName = () => {
    const seat = viewerSeatColor();
    if (seat === '') {
        return 'opponent';
    }
    const opponent = opponentOf(seat);
    return playerSeated(opponent) ? playerName(opponent) : 'your opponent';
};

const legalMoves = () => (Array.isArray(state.game?.legal_moves) ? state.game.legal_moves : []);

const legalTargetsFrom = (square) => new Set(legalMoves().filter((move) => move?.from === square).map((move) => move.to));

const isSetupEditing = () => gameStatus() === 'setup' && viewerSeatColor() !== '' && !isColorReady(viewerSeatColor());

const isOwnSetupRow = (row) => {
    const seat = viewerSeatColor();
    return seat !== '' && SETUP_ROWS[seat].includes(row);
};

const remainingCount = (rank) => {
    let placed = 0;
    state.draft.forEach((value) => {
        if (value === rank) {
            placed += 1;
        }
    });

    return isRankCode(rank) ? PIECES[rank].count - placed : 0;
};

const firstAvailableRank = () => RANK_ORDER.find((rank) => remainingCount(rank) > 0) || '';

/** Piece shown on a board square, using the local draft while deploying. */
const pieceAt = (row, col) => {
    if (isSetupEditing()) {
        const rank = state.draft.get(coordsToSquare(row, col));
        return rank ? { color: viewerSeatColor(), rank, hidden: false, revealed: false } : null;
    }

    const piece = state.view?.board?.[row]?.[col];
    return piece && typeof piece === 'object' ? piece : null;
};

const pieceRankVisible = (piece) => piece?.hidden !== true && isRankCode(piece?.rank);

/** Viewer orientation: own rows at the bottom. Spectators see red at the bottom. */
const displayToBoard = (displayRow, displayCol) => (viewerSeatColor() === 'blue'
    ? { row: displayRow, col: SIZE - 1 - displayCol }
    : { row: SIZE - 1 - displayRow, col: displayCol });

const defaultFocusSquare = () => {
    const { row, col } = displayToBoard(SIZE - 1, 0);
    return coordsToSquare(row, col);
};

/* ------------------------------------------------------------------ */
/* Descriptions                                                        */
/* ------------------------------------------------------------------ */

const ownerWord = (color) => {
    const seat = viewerSeatColor();
    if (seat === '') {
        return titleCase(color);
    }

    return color === seat ? 'your' : 'their';
};

const describeCombatant = (combatant) => {
    const color = combatant?.color === 'red' || combatant?.color === 'blue' ? combatant.color : '';
    const owner = color ? ownerWord(color) : 'a';
    return isRankCode(combatant?.rank) ? `${owner} ${rankLabel(combatant.rank)}` : `${owner} hidden piece`;
};

const combatSummary = () => {
    const lastMove = state.view?.last_move;
    if (!lastMove || typeof lastMove !== 'object') {
        return { text: '', tone: '' };
    }

    const attacker = lastMove.attacker || { color: lastMove.color, rank: null };
    const defender = lastMove.defender || null;
    const a = describeCombatant(attacker);
    const d = defender ? describeCombatant(defender) : 'the defender';
    const route = `${lastMove.from || '?'} → ${lastMove.to || '?'}`;
    const seat = viewerSeatColor();
    const attackerMine = seat !== '' && attacker?.color === seat;
    const toneFor = (viewerWon) => (seat === '' ? 'neutral' : (viewerWon ? 'success' : 'error'));

    switch (lastMove.outcome) {
        case 'attacker_wins':
            return { text: `${capitalize(a)} defeated ${d} (${route}).`, tone: toneFor(attackerMine) };
        case 'defender_wins':
            return { text: `${capitalize(d)} defeated ${a} (${route}).`, tone: toneFor(!attackerMine) };
        case 'both_lost':
            return { text: `${capitalize(a)} and ${d} defeated each other (${route}).`, tone: 'neutral' };
        case 'flag_captured':
            return { text: `${capitalize(a)} captured ${d} (${route})!`, tone: toneFor(attackerMine) };
        case 'move':
            return { text: `${capitalize(a)} moved ${route}.`, tone: 'neutral' };
        default:
            return { text: '', tone: '' };
    }
};

const describeSquare = (square, row, col, piece, flags) => {
    const parts = [square];
    if (isLake(row, col)) {
        parts.push('lake');
        return parts.join(', ');
    }

    if (!piece) {
        parts.push('empty');
        if (flags.setupRow) {
            parts.push('your deployment row');
        }
    } else {
        const color = piece.color === 'red' || piece.color === 'blue' ? piece.color : '';
        if (pieceRankVisible(piece)) {
            parts.push(`${ownerWord(color)} ${rankLabel(piece.rank)}`);
            if (piece.revealed === true && color === viewerSeatColor()) {
                parts.push('revealed to opponent');
            }
        } else {
            parts.push(`hidden ${color || 'enemy'} piece`);
        }
    }

    if (flags.selected) {
        parts.push('selected');
    }
    if (flags.target) {
        parts.push(piece ? 'attack target' : 'legal move');
    }
    if (flags.lastMove) {
        parts.push('last move');
    }

    return parts.join(', ');
};

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

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
    if (elements.notificationToggle) {
        elements.notificationToggle.checked = isEnabled;
    }
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
        disableNotifications('Turn alerts need browser permission. Turn them on again to allow alerts.');
    }
};

const handleNotificationToggle = async () => {
    if (!elements.notificationToggle.checked) {
        setNotificationsEnabled(false, { message: 'Turn alerts disabled.', tone: 'neutral' });
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
        setMessage(elements.notificationMessage, 'Allow notifications in your browser to enable turn alerts.', 'neutral');
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

    setNotificationsEnabled(true, { message: 'Turn alerts enabled.', tone: 'success' });
};

const notifyTurn = () => {
    const version = Number(state.game?.state_version);
    if (!state.notificationsEnabled || !notificationsSupported() || Notification.permission !== 'granted' || state.lastNotifiedVersion === version) {
        return;
    }

    state.lastNotifiedVersion = version;
    const summary = combatSummary().text;
    try {
        new Notification('Your turn in Stratego', {
            body: summary !== '' ? summary : `${capitalize(opponentName())} has moved.`,
            tag: `wowie-stratego-${state.gameId}`,
        });
    } catch {
        disableNotifications('Turn alerts could not be shown by this browser.');
    }
};

/* ------------------------------------------------------------------ */
/* Invite links                                                        */
/* ------------------------------------------------------------------ */

const readStoredInvite = () => {
    try {
        return window.localStorage.getItem(`${INVITE_STORAGE_PREFIX}${state.gameId}`) || '';
    } catch {
        return '';
    }
};

const storeInvite = (url) => {
    if (url === '') {
        return;
    }
    state.inviteUrl = url;
    try {
        window.localStorage.setItem(`${INVITE_STORAGE_PREFIX}${state.gameId}`, url);
    } catch {
        // The visible input still lets the player copy the link manually.
    }
};

const requestNewInvite = async ({ automatic = false } = {}) => {
    if (state.isSubmitting || gameStatus() !== 'waiting' || viewerSeatColor() === '') {
        return;
    }

    state.inviteRequested = true;
    elements.newInviteButton.disabled = true;
    setMessage(elements.inviteMessage, 'Creating an invite link...', 'neutral');
    try {
        const link = await createInviteLink(state.gameId);
        const url = absoluteUrl(link?.url);
        if (url === '') {
            throw new Error('The invite link was created without a URL.');
        }
        storeInvite(url);
        renderInvite();
        setMessage(elements.inviteMessage, automatic ? 'Invite link ready. Copy it and send it to your opponent.' : 'New invite link ready.', 'success');
    } catch (error) {
        setMessage(elements.inviteMessage, apiErrorMessage(error, 'The invite link could not be created.'), 'error');
    } finally {
        elements.newInviteButton.disabled = false;
    }
};

const copyWithFallback = (text) => {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', 'readonly');
    helper.className = 'stratego-copy-helper';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    try {
        return document.execCommand('copy');
    } finally {
        helper.remove();
    }
};

const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    if (!copyWithFallback(text)) {
        throw new Error('Copy failed.');
    }
};

const handleCopyInvite = async () => {
    const value = elements.inviteUrl.value;
    if (value === '') {
        setMessage(elements.inviteMessage, 'Create an invite link before copying.', 'error');
        return;
    }

    elements.copyInviteButton.disabled = true;
    try {
        await copyText(value);
        elements.copyInviteButton.textContent = 'Copied';
        setMessage(elements.inviteMessage, 'Invite link copied.', 'success');
    } catch {
        elements.inviteUrl.focus({ preventScroll: true });
        elements.inviteUrl.select();
        setMessage(elements.inviteMessage, 'Copy failed. The link is selected so you can copy it manually.', 'error');
    } finally {
        window.setTimeout(() => {
            elements.copyInviteButton.disabled = elements.inviteUrl.value === '';
            elements.copyInviteButton.textContent = 'Copy';
        }, 1200);
    }
};

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const appendPieceVisual = (container, art, glyph) => {
    const glyphElement = document.createElement('span');
    glyphElement.className = 'stratego-piece-glyph';
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.textContent = glyph;

    if (state.failedArt.has(art)) {
        container.classList.add('piece--no-art');
        container.append(glyphElement);
        return;
    }

    const image = document.createElement('img');
    image.className = 'stratego-piece-art';
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.addEventListener('error', () => {
        state.failedArt.add(art);
        image.remove();
        container.classList.add('piece--no-art');
    }, { once: true });
    image.src = art;
    container.append(image, glyphElement);
};

const renderPieceInto = (container, piece) => {
    const color = piece.color === 'red' || piece.color === 'blue' ? piece.color : '';
    container.classList.add('piece');
    if (color) {
        container.classList.add(`piece--${color}`);
    }

    if (pieceRankVisible(piece)) {
        appendPieceVisual(container, PIECES[piece.rank].art, PIECE_GLYPHS[piece.rank]);
        const badge = document.createElement('span');
        badge.className = 'stratego-rank-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = rankBadge(piece.rank);
        container.append(badge);
        if (piece.revealed === true && color === viewerSeatColor()) {
            container.classList.add('piece--revealed');
        }
        return;
    }

    container.classList.add('piece--hidden');
    appendPieceVisual(container, HIDDEN_ART, HIDDEN_GLYPH);
};

const canSelectSquare = (square) => viewerControlsTurn() && legalTargetsFrom(square).size > 0;

const isCellActionable = (square, row, targets) => {
    if (state.isSubmitting) {
        return false;
    }
    if (isSetupEditing()) {
        return isOwnSetupRow(row);
    }
    if (!viewerControlsTurn()) {
        return false;
    }

    return square === state.selectedSquare || targets.has(square) || canSelectSquare(square);
};

const renderBoard = () => {
    const board = elements.board;
    const hadFocus = board.contains(document.activeElement);
    const targets = state.selectedSquare ? legalTargetsFrom(state.selectedSquare) : new Set();
    const lastMove = state.view?.last_move && !isSetupEditing() ? state.view.last_move : null;
    const status = gameStatus();
    const showSetupRows = (status === 'setup' || status === 'waiting') && viewerSeatColor() !== '';
    const focusCoords = squareToCoords(state.focusSquare);
    if (!focusCoords || isLake(focusCoords.row, focusCoords.col)) {
        state.focusSquare = defaultFocusSquare();
    }

    const rows = [];
    for (let displayRow = 0; displayRow < SIZE; displayRow += 1) {
        const rowElement = document.createElement('div');
        rowElement.className = 'stratego-board-row';
        rowElement.setAttribute('role', 'row');

        for (let displayCol = 0; displayCol < SIZE; displayCol += 1) {
            const { row, col } = displayToBoard(displayRow, displayCol);
            const square = coordsToSquare(row, col);
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'stratego-cell';
            cell.setAttribute('role', 'gridcell');
            cell.dataset.square = square;
            cell.dataset.row = String(displayRow);
            cell.dataset.col = String(displayCol);
            cell.tabIndex = square === state.focusSquare ? 0 : -1;

            if (isLake(row, col)) {
                cell.classList.add('stratego-cell--lake');
                cell.disabled = true;
                cell.setAttribute('aria-label', describeSquare(square, row, col, null, {}));
                rowElement.append(cell);
                continue;
            }

            const piece = pieceAt(row, col);
            const flags = {
                setupRow: showSetupRows && isOwnSetupRow(row),
                selected: square === state.selectedSquare,
                target: targets.has(square),
                lastMove: Boolean(lastMove && (lastMove.from === square || lastMove.to === square)),
            };

            if (flags.setupRow) {
                cell.classList.add('stratego-cell--setup');
            }
            if (flags.selected) {
                cell.classList.add('stratego-cell--selected');
                cell.setAttribute('aria-selected', 'true');
            }
            if (flags.target) {
                cell.classList.add(piece ? 'stratego-cell--attack' : 'stratego-cell--target');
            }
            if (lastMove && lastMove.from === square) {
                cell.classList.add('stratego-cell--last-from');
            }
            if (lastMove && lastMove.to === square) {
                cell.classList.add('stratego-cell--last-to');
            }
            if (!isCellActionable(square, row, targets)) {
                cell.setAttribute('aria-disabled', 'true');
            }
            if (piece) {
                renderPieceInto(cell, piece);
            }

            cell.setAttribute('aria-label', describeSquare(square, row, col, piece, flags));
            rowElement.append(cell);
        }

        rows.push(rowElement);
    }

    board.replaceChildren(...rows);
    board.dataset.orientation = viewerSeatColor() === 'blue' ? 'blue' : 'red';

    if (hadFocus) {
        const focusTarget = board.querySelector(`[data-square="${state.focusSquare}"]`);
        focusTarget?.focus({ preventScroll: true });
    }
};

const renderStatus = () => {
    const status = gameStatus();
    const seat = viewerSeatColor();
    const opponent = seat ? opponentOf(seat) : '';
    let turnText = 'Loading';
    let turnTone = 'neutral';

    if (status === 'waiting') {
        turnText = seat ? 'Waiting for an opponent to join' : 'Waiting for players';
    } else if (status === 'setup') {
        if (seat && !isColorReady(seat)) {
            turnText = 'Deploy your army';
            turnTone = 'go';
        } else if (seat && !isColorReady(opponent)) {
            turnText = `Waiting for ${opponentName()} to deploy`;
        } else {
            turnText = 'Armies deploying';
        }
    } else if (status === 'active') {
        const turn = state.view?.turn === 'red' || state.view?.turn === 'blue' ? state.view.turn : '';
        if (viewerControlsTurn()) {
            turnText = 'Your turn';
            turnTone = 'go';
        } else if (seat) {
            turnText = `Waiting for ${opponentName()}`;
        } else {
            turnText = turn ? `${playerName(turn)} (${titleCase(turn)}) to move` : 'In progress';
        }
    } else if (status === 'finished') {
        const winner = finishedWinner();
        turnText = winner ? (seat ? (winner === seat ? 'You won' : 'You lost') : `${titleCase(winner)} won`) : 'Game over';
        turnTone = seat && winner ? (winner === seat ? 'go' : 'stop') : 'neutral';
    }

    setMessage(elements.turnStatus, turnText, turnTone);

    const moveCount = Number.isInteger(state.view?.move_count) ? state.view.move_count : 0;
    elements.phaseStatus.textContent = status === 'active' || status === 'finished'
        ? `${titleCase(status)} · ${moveCount} ${moveCount === 1 ? 'move' : 'moves'}`
        : titleCase(status || 'loading');
    elements.seatStatus.textContent = seat ? `You: ${titleCase(seat)}` : 'Spectating';
    elements.seatStatus.dataset.color = seat;

    const red = playerSeated('red') ? playerName('red') : 'Open seat';
    const blue = playerSeated('blue') ? playerName('blue') : 'Open seat';
    elements.summary.textContent = `${red} (Red) vs ${blue} (Blue). ${turnText}.`;
    elements.root.dataset.phase = status || 'loading';
    elements.root.dataset.yourTurn = viewerControlsTurn() ? 'true' : 'false';
};

const finishedWinner = () => {
    const winner = state.view?.winner || state.game?.winner_color;
    return winner === 'red' || winner === 'blue' ? winner : '';
};

const renderResult = () => {
    const finished = gameStatus() === 'finished';
    elements.resultSection.hidden = !finished;
    if (!finished) {
        elements.resultText.textContent = '';
        return;
    }

    const seat = viewerSeatColor();
    const winner = finishedWinner();
    if (winner === '') {
        elements.resultText.textContent = 'The game has ended.';
        return;
    }

    const loser = opponentOf(winner);
    const winnerLabel = seat ? (winner === seat ? 'You' : playerName(winner)) : `${playerName(winner)} (${titleCase(winner)})`;
    const loserLabel = seat ? (loser === seat ? 'You' : playerName(loser)) : `${playerName(loser)} (${titleCase(loser)})`;
    const headline = seat ? (winner === seat ? 'Victory! ' : 'Defeat. ') : `${titleCase(winner)} wins. `;
    let reason = '';
    switch (state.view?.end_reason) {
        case 'flag_captured':
            reason = `${winnerLabel} captured the enemy Flag.`;
            break;
        case 'no_moves':
            reason = `${loserLabel} had no movable pieces left.`;
            break;
        case 'resigned':
            reason = `${loserLabel} resigned.`;
            break;
        default:
            reason = `${winnerLabel} won the battle.`;
    }

    elements.resultText.textContent = `${headline}${reason} The full board is revealed.`;
    elements.resultText.dataset.tone = seat ? (winner === seat ? 'success' : 'error') : 'neutral';
};

const renderInvite = () => {
    const show = gameStatus() === 'waiting' && viewerSeatColor() !== '';
    elements.inviteSection.hidden = !show;
    if (!show) {
        return;
    }

    if (state.inviteUrl === '') {
        state.inviteUrl = readStoredInvite();
    }
    elements.inviteUrl.value = state.inviteUrl;
    elements.copyInviteButton.disabled = state.inviteUrl === '';

    if (state.inviteUrl === '' && !state.inviteRequested) {
        void requestNewInvite({ automatic: true });
    }
};

const renderSetup = () => {
    const status = gameStatus();
    const seat = viewerSeatColor();
    const show = status === 'setup' && seat !== '';
    elements.setupSection.hidden = !show;
    if (!show) {
        elements.tray.replaceChildren();
        return;
    }

    const editing = isSetupEditing();
    const placed = editing ? state.draft.size : ARMY_SIZE;
    elements.setupCount.textContent = editing ? `${placed} / ${ARMY_SIZE} placed` : 'Army locked in';
    elements.setupHelp.textContent = editing
        ? 'Pick a piece, then click a square in your four highlighted rows. Click a placed piece to return it to the tray.'
        : 'Your army is locked in. The battle starts as soon as both players are ready.';

    if (editing && (!isRankCode(state.selectedRank) || remainingCount(state.selectedRank) <= 0)) {
        state.selectedRank = firstAvailableRank();
    }

    const items = RANK_ORDER.map((rank) => {
        const remaining = editing ? remainingCount(rank) : 0;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'stratego-tray-item';
        item.dataset.rank = rank;
        item.disabled = !editing || remaining <= 0 || state.isSubmitting;
        item.setAttribute('aria-pressed', editing && rank === state.selectedRank ? 'true' : 'false');
        item.setAttribute('aria-label', `${rankLabel(rank)}: ${remaining} left to place`);

        const token = document.createElement('span');
        token.className = 'stratego-tray-token';
        renderPieceInto(token, { color: seat, rank, hidden: false, revealed: false });

        const name = document.createElement('span');
        name.className = 'stratego-tray-name';
        name.textContent = PIECES[rank].name;

        const count = document.createElement('span');
        count.className = 'stratego-tray-count';
        count.textContent = `×${remaining}`;

        item.append(token, name, count);
        return item;
    });
    elements.tray.replaceChildren(...items);
    elements.tray.hidden = !editing;

    elements.randomiseButton.disabled = !editing || state.isSubmitting || state.draft.size >= ARMY_SIZE;
    elements.clearButton.disabled = !editing || state.isSubmitting || state.draft.size === 0;
    elements.readyButton.disabled = !editing || state.isSubmitting || state.draft.size !== ARMY_SIZE;
    elements.readyButton.textContent = editing ? 'Ready' : 'Ready ✓';

    const opponent = opponentOf(seat);
    let opponentText = '';
    let opponentTone = 'neutral';
    if (!playerSeated(opponent)) {
        opponentText = 'Opponent has not joined yet';
    } else if (isColorReady(opponent)) {
        opponentText = `${playerName(opponent)} is ready`;
        opponentTone = 'go';
    } else {
        opponentText = `${playerName(opponent)} is still deploying`;
    }
    setMessage(elements.opponentReady, opponentText, opponentTone);
};

const renderPlayers = () => {
    const seat = viewerSeatColor();
    const status = gameStatus();
    ['red', 'blue'].forEach((color) => {
        const element = color === 'red' ? elements.redPlayer : elements.bluePlayer;
        if (!playerSeated(color)) {
            element.textContent = 'Open seat';
            return;
        }
        const ready = status === 'setup' ? (isColorReady(color) ? ' · Ready' : ' · Deploying') : '';
        element.textContent = `${playerName(color)}${color === seat ? ' (you)' : ''}${ready}`;
    });
    elements.viewerPlayer.textContent = seat ? `${playerName(seat)} commanding ${titleCase(seat)}` : 'Spectator';
};

const renderCombat = () => {
    const status = gameStatus();
    const { text, tone } = status === 'active' || status === 'finished' ? combatSummary() : { text: '', tone: '' };
    elements.combatBanner.hidden = text === '';
    setMessage(elements.combatBanner, text, tone);
};

const renderCaptured = () => {
    const seat = viewerSeatColor();
    const order = seat ? [seat, opponentOf(seat)] : ['red', 'blue'];
    const groups = order.map((color) => {
        const lost = Array.isArray(state.view?.captured?.[color]) ? state.view.captured[color] : [];
        const group = document.createElement('div');
        group.className = 'stratego-captured-group';

        const heading = document.createElement('h3');
        const who = seat ? (color === seat ? 'You' : playerName(color)) : `${playerName(color)} (${titleCase(color)})`;
        heading.textContent = `${who} lost ${lost.length} ${lost.length === 1 ? 'piece' : 'pieces'}`;
        group.append(heading);

        if (lost.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'stratego-note';
            empty.textContent = 'No casualties yet.';
            group.append(empty);
            return group;
        }

        const list = document.createElement('ul');
        list.className = 'stratego-chip-list';
        RANK_ORDER.forEach((rank) => {
            const count = lost.filter((value) => value === rank).length;
            if (count === 0) {
                return;
            }
            const chip = document.createElement('li');
            chip.className = `stratego-chip stratego-chip--${color}`;
            chip.textContent = count > 1 ? `${rankLabel(rank)} ×${count}` : rankLabel(rank);
            list.append(chip);
        });
        group.append(list);
        return group;
    });

    elements.captured.replaceChildren(...groups);
};

const renderControls = () => {
    const seat = viewerSeatColor();
    const status = gameStatus();
    const canResign = seat !== '' && (status === 'setup' || status === 'active');
    elements.resignButton.hidden = !canResign;
    elements.resignButton.disabled = state.isSubmitting;
};

const renderAll = () => {
    if (!state.game) {
        return;
    }

    renderStatus();
    renderPlayers();
    renderResult();
    renderInvite();
    renderSetup();
    renderCombat();
    renderCaptured();
    renderControls();
    renderBoard();
};

const renderError = (message) => {
    elements.error.hidden = false;
    elements.error.textContent = message;
    if (!state.game) {
        elements.root.dataset.state = 'error';
        elements.summary.textContent = message;
        elements.turnStatus.textContent = 'Unavailable';
    }
    setMessage(elements.boardMessage, message, 'error');
};

const clearError = () => {
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.root.dataset.state = 'ready';
};

/* ------------------------------------------------------------------ */
/* State updates                                                       */
/* ------------------------------------------------------------------ */

const seedDraftFromView = () => {
    const seat = viewerSeatColor();
    state.draft = new Map();
    const board = Array.isArray(state.view?.board) ? state.view.board : [];
    board.forEach((cells, row) => {
        if (!Array.isArray(cells)) {
            return;
        }
        cells.forEach((piece, col) => {
            if (piece && piece.color === seat && isRankCode(piece.rank)) {
                state.draft.set(coordsToSquare(row, col), piece.rank);
            }
        });
    });
    state.draftDirty = false;
};

const gameSignature = (game) => [
    String(game?.status || ''),
    String(game?.state_version ?? ''),
    String(game?.winner_color ?? ''),
    JSON.stringify(game?.players || []),
    JSON.stringify(game?.viewer || {}),
    JSON.stringify(game?.legal_moves || []),
].join('|');

/** Merge a GameJson payload into page state. Returns true when anything visible changed. */
const applyGame = (game) => {
    if (!game || typeof game !== 'object') {
        return false;
    }

    const previousVersion = state.game?.state_version;
    const hasState = game.state && typeof game.state === 'object';
    const next = { ...game };
    if (!hasState && state.view) {
        next.state = state.view;
    }

    const signature = gameSignature(next);
    const firstLoad = state.game === null;
    const changed = firstLoad || signature !== state.signature || (hasState && previousVersion !== game.state_version);
    state.game = next;
    if (firstLoad) {
        state.focusSquare = defaultFocusSquare();
    }
    if (hasState) {
        state.view = game.state;
    }
    state.signature = signature;

    if (typeof game.invite_link?.url === 'string' && game.invite_link.url !== '') {
        storeInvite(absoluteUrl(game.invite_link.url));
    }

    if (previousVersion !== game.state_version) {
        state.selectedSquare = '';
    }

    if (gameStatus() === 'setup' && viewerSeatColor() !== '') {
        if (!isSetupEditing() || !state.draftDirty) {
            seedDraftFromView();
        }
    } else {
        state.draft = new Map();
        state.draftDirty = false;
    }

    return changed;
};

const refresh = async ({ quiet = false, full = false } = {}) => {
    if (state.isLoading || state.isSubmitting || state.gameId === '') {
        return;
    }

    state.isLoading = true;
    elements.root.dataset.loading = 'true';
    if (!quiet) {
        setMessage(elements.boardMessage, 'Loading the battlefield...', 'neutral');
    }

    const hadGame = state.game !== null;
    const previousControlsTurn = viewerControlsTurn();

    try {
        const version = state.game?.state_version;
        const sinceVersion = !full && state.view && Number.isInteger(version) ? version : null;
        const game = await getGame(state.gameId, { sinceVersion });
        const currentVersion = Number(state.game?.state_version);
        if (state.isSubmitting || (Number.isInteger(currentVersion) && Number(game?.state_version) < currentVersion)) {
            // A move or setup action landed while this poll was in flight; its response is newer.
            return;
        }
        const changed = applyGame(game);
        clearError();
        if (changed) {
            renderAll();
        }
        if (hadGame && !previousControlsTurn && viewerControlsTurn()) {
            notifyTurn();
        }
        if (!quiet) {
            setMessage(elements.boardMessage, initialBoardMessage(), 'neutral');
        }
    } catch (error) {
        const notFound = error?.status === 404;
        if (notFound || !state.game) {
            renderError(notFound ? 'That Stratego game was not found.' : apiErrorMessage(error, 'The Stratego game could not be loaded.'));
        } else if (!quiet) {
            setMessage(elements.boardMessage, apiErrorMessage(error, 'The board could not be refreshed.'), 'error');
        }
    } finally {
        state.isLoading = false;
        delete elements.root.dataset.loading;
    }
};

const initialBoardMessage = () => {
    const status = gameStatus();
    const seat = viewerSeatColor();
    if (seat === '') {
        return 'You are watching this game. Hidden pieces stay hidden for spectators.';
    }
    if (status === 'waiting') {
        return 'Send the invite link to your opponent. Setup begins when they join.';
    }
    if (status === 'setup') {
        return isSetupEditing() ? 'Deploy your 40 pieces in your four highlighted rows, then press Ready.' : 'Waiting for your opponent to finish deploying.';
    }
    if (status === 'active') {
        return viewerControlsTurn() ? 'Your turn. Select one of your pieces to see its moves.' : `Waiting for ${opponentName()} to move.`;
    }
    if (status === 'finished') {
        return 'The game is over. Every piece is now revealed.';
    }

    return '';
};

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const handleSetupCell = (square) => {
    const coords = squareToCoords(square);
    if (!coords || !isOwnSetupRow(coords.row)) {
        setMessage(elements.boardMessage, 'Place pieces only in your four highlighted rows.', 'error');
        return;
    }

    if (state.draft.has(square)) {
        const rank = state.draft.get(square);
        state.draft.delete(square);
        state.draftDirty = true;
        state.selectedRank = rank;
        setMessage(elements.boardMessage, `Returned ${rankLabel(rank)} from ${square} to the tray.`, 'neutral');
    } else {
        const rank = isRankCode(state.selectedRank) && remainingCount(state.selectedRank) > 0
            ? state.selectedRank
            : firstAvailableRank();
        if (rank === '') {
            setMessage(elements.boardMessage, 'All 40 pieces are placed. Press Ready when you are happy with your setup.', 'neutral');
            return;
        }
        state.draft.set(square, rank);
        state.draftDirty = true;
        if (remainingCount(rank) <= 0) {
            state.selectedRank = firstAvailableRank();
        }
        setMessage(elements.boardMessage, `Placed ${rankLabel(rank)} on ${square}.`, 'neutral');
    }

    renderSetup();
    renderBoard();
};

const handleTrayClick = (event) => {
    const item = event.target.closest('.stratego-tray-item');
    if (!item || item.disabled || !isSetupEditing()) {
        return;
    }

    state.selectedRank = item.dataset.rank || '';
    setMessage(elements.boardMessage, `${rankLabel(state.selectedRank)} selected. Click a square in your rows to place it.`, 'neutral');
    renderSetup();
};

const ownSetupSquares = () => {
    const seat = viewerSeatColor();
    const squares = [];
    if (seat === '') {
        return squares;
    }
    SETUP_ROWS[seat].forEach((row) => {
        for (let col = 0; col < SIZE; col += 1) {
            squares.push(coordsToSquare(row, col));
        }
    });

    return squares;
};

const handleRandomise = () => {
    if (!isSetupEditing() || state.isSubmitting) {
        return;
    }

    const empty = shuffle(ownSetupSquares().filter((square) => !state.draft.has(square)));
    const remaining = [];
    RANK_ORDER.forEach((rank) => {
        for (let index = remainingCount(rank); index > 0; index -= 1) {
            remaining.push(rank);
        }
    });
    remaining.forEach((rank, index) => {
        if (empty[index]) {
            state.draft.set(empty[index], rank);
        }
    });
    state.draftDirty = true;
    state.selectedRank = firstAvailableRank();
    setMessage(elements.boardMessage, 'Remaining pieces placed at random. Click any piece to return it to the tray.', 'neutral');
    renderSetup();
    renderBoard();
};

const handleClear = () => {
    if (!isSetupEditing() || state.isSubmitting) {
        return;
    }

    state.draft = new Map();
    state.draftDirty = true;
    state.selectedRank = firstAvailableRank();
    setMessage(elements.boardMessage, 'All pieces returned to the tray.', 'neutral');
    renderSetup();
    renderBoard();
};

const handleReady = async () => {
    if (!isSetupEditing() || state.isSubmitting) {
        return;
    }
    if (state.draft.size !== ARMY_SIZE) {
        setMessage(elements.boardMessage, `Place all ${ARMY_SIZE} pieces before pressing Ready.`, 'error');
        return;
    }

    const placements = Array.from(state.draft, ([square, rank]) => ({ square, rank }));
    state.isSubmitting = true;
    renderSetup();
    renderControls();
    setMessage(elements.boardMessage, 'Saving your deployment...', 'neutral');

    try {
        applyGame(await submitSetup(state.gameId, placements));
        state.draftDirty = false;
        applyGame(await markReady(state.gameId));
        clearError();
        setMessage(
            elements.boardMessage,
            gameStatus() === 'active' ? 'Both armies are ready. The battle begins!' : 'Army locked in. Waiting for your opponent to finish deploying.',
            'success',
        );
    } catch (error) {
        setMessage(elements.boardMessage, apiErrorMessage(error, 'Your deployment could not be saved.'), 'error');
        state.isSubmitting = false;
        await refresh({ quiet: true, full: true });
    } finally {
        state.isSubmitting = false;
        renderAll();
    }
};

const submitSelectedMove = async (from, to) => {
    const expectedVersion = Number(state.game?.state_version);
    state.isSubmitting = true;
    renderBoard();
    renderControls();
    setMessage(elements.boardMessage, `Moving ${from} → ${to}...`, 'neutral');

    try {
        /** @type {{ from: string, to: string, expected_version?: number }} */
        const payload = { from, to };
        if (Number.isInteger(expectedVersion)) {
            payload.expected_version = expectedVersion;
        }
        applyGame(await submitMove(state.gameId, payload));
        state.selectedSquare = '';
        clearError();
        state.isSubmitting = false;
        renderAll();
        const summary = combatSummary().text;
        setMessage(elements.boardMessage, summary !== '' ? summary : 'Move made.', 'success');
    } catch (error) {
        state.selectedSquare = '';
        setMessage(elements.boardMessage, apiErrorMessage(error, 'That move could not be submitted.'), 'error');
        state.isSubmitting = false;
        await refresh({ quiet: true, full: true });
        renderAll();
    } finally {
        state.isSubmitting = false;
        renderControls();
    }
};

const handlePlayCell = (square) => {
    const targets = state.selectedSquare ? legalTargetsFrom(state.selectedSquare) : new Set();

    if (state.selectedSquare !== '' && targets.has(square)) {
        void submitSelectedMove(state.selectedSquare, square);
        return;
    }

    if (square === state.selectedSquare) {
        state.selectedSquare = '';
        setMessage(elements.boardMessage, 'Selection cleared.', 'neutral');
        renderBoard();
        return;
    }

    if (canSelectSquare(square)) {
        state.selectedSquare = square;
        const coords = squareToCoords(square);
        const piece = coords ? pieceAt(coords.row, coords.col) : null;
        const count = legalTargetsFrom(square).size;
        setMessage(elements.boardMessage, `Selected ${rankLabel(piece?.rank)} on ${square}. ${count} ${count === 1 ? 'target' : 'targets'} highlighted.`, 'neutral');
        renderBoard();
        return;
    }

    const coords = squareToCoords(square);
    const piece = coords ? pieceAt(coords.row, coords.col) : null;
    if (piece && piece.color === viewerSeatColor()) {
        const immobile = piece.rank === 'B' || piece.rank === 'F';
        setMessage(elements.boardMessage, immobile ? `${rankLabel(piece.rank)}s cannot move.` : `Your ${rankLabel(piece.rank)} has no legal moves right now.`, 'error');
    } else if (state.selectedSquare !== '') {
        setMessage(elements.boardMessage, 'That square is not a legal target. Pick a highlighted square.', 'error');
    }
    if (state.selectedSquare !== '') {
        state.selectedSquare = '';
        renderBoard();
    }
};

const handleBoardClick = (event) => {
    const cell = event.target.closest('.stratego-cell');
    if (!cell || cell.disabled) {
        return;
    }

    const square = cell.dataset.square || '';
    state.focusSquare = square;
    if (state.isSubmitting) {
        return;
    }

    if (isSetupEditing()) {
        handleSetupCell(square);
        return;
    }

    if (gameStatus() === 'active' && viewerControlsTurn()) {
        handlePlayCell(square);
    }
};

const focusCell = (cell) => {
    elements.board.querySelectorAll('.stratego-cell[tabindex="0"]').forEach((other) => {
        other.tabIndex = -1;
    });
    cell.tabIndex = 0;
    state.focusSquare = cell.dataset.square || state.focusSquare;
    cell.focus();
};

const handleBoardKeydown = (event) => {
    const cell = event.target.closest('.stratego-cell');
    if (!cell) {
        return;
    }

    let delta = KEY_DELTAS[event.key];
    let row = Number(cell.dataset.row);
    let col = Number(cell.dataset.col);
    if (event.key === 'Home') {
        col = -1;
        delta = [0, 1];
    } else if (event.key === 'End') {
        col = SIZE;
        delta = [0, -1];
    }
    if (!delta) {
        return;
    }

    event.preventDefault();
    for (;;) {
        row += delta[0];
        col += delta[1];
        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) {
            return;
        }
        const next = elements.board.querySelector(`.stratego-cell[data-row="${row}"][data-col="${col}"]`);
        if (next && !next.disabled) {
            focusCell(next);
            return;
        }
    }
};

const handleBoardFocusIn = (event) => {
    const cell = event.target.closest('.stratego-cell');
    if (!cell || cell.tabIndex === 0) {
        return;
    }
    elements.board.querySelectorAll('.stratego-cell[tabindex="0"]').forEach((other) => {
        other.tabIndex = -1;
    });
    cell.tabIndex = 0;
    state.focusSquare = cell.dataset.square || state.focusSquare;
};

const handleResign = async () => {
    const status = gameStatus();
    if (viewerSeatColor() === '' || state.isSubmitting || (status !== 'setup' && status !== 'active')) {
        return;
    }

    if (!window.confirm('Resign this Stratego game? Your opponent will be declared the winner.')) {
        return;
    }

    state.isSubmitting = true;
    renderControls();
    setMessage(elements.boardMessage, 'Resigning...', 'neutral');

    try {
        applyGame(await resignGame(state.gameId));
        clearError();
        setMessage(elements.boardMessage, 'You resigned. The full board is revealed.', 'neutral');
    } catch (error) {
        setMessage(elements.boardMessage, apiErrorMessage(error, 'The game could not be resigned.'), 'error');
    } finally {
        state.isSubmitting = false;
        renderAll();
    }
};

/* ------------------------------------------------------------------ */
/* Polling and boot                                                    */
/* ------------------------------------------------------------------ */

const startPolling = () => {
    window.clearInterval(state.pollTimer);
    if (state.gameId === '') {
        return;
    }

    state.pollTimer = window.setInterval(() => {
        void refresh({ quiet: true });
    }, POLL_MS);
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
        void refresh({ quiet: true });
    }
    startPolling();
};

const readGameId = () => {
    const id = (new URLSearchParams(window.location.search).get('id') || '').trim();
    return GAME_ID_PATTERN.test(id) ? id : '';
};

const init = () => {
    elements = resolveElements();
    if (!elements.root || !elements.board) {
        throw new Error('Stratego board markup is missing.');
    }

    restoreNotificationPreference();
    state.focusSquare = defaultFocusSquare();
    renderBoard();
    state.gameId = readGameId();
    if (state.gameId === '') {
        renderError('Open a Stratego game from the lobby, or check that the link includes a valid game id.');
        return;
    }

    elements.board.addEventListener('click', handleBoardClick);
    elements.board.addEventListener('keydown', handleBoardKeydown);
    elements.board.addEventListener('focusin', handleBoardFocusIn);
    elements.tray.addEventListener('click', handleTrayClick);
    elements.randomiseButton.addEventListener('click', handleRandomise);
    elements.clearButton.addEventListener('click', handleClear);
    elements.readyButton.addEventListener('click', handleReady);
    elements.resignButton.addEventListener('click', handleResign);
    elements.copyInviteButton.addEventListener('click', handleCopyInvite);
    elements.newInviteButton.addEventListener('click', () => {
        void requestNewInvite();
    });
    elements.notificationToggle.addEventListener('change', handleNotificationToggle);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', stopPolling);

    void refresh({ full: true }).finally(startPolling);
};

const boot = () => {
    try {
        init();
    } catch (error) {
        console.error('Stratego game initialization failed.', error);
        elements = resolveElements();
        if (elements.error && elements.root && elements.boardMessage) {
            renderError('Stratego could not finish loading. The board controls were not initialized.');
        }
    }
};

if (strategoDocument !== null) {
    if (strategoDocument.readyState === 'loading') {
        strategoDocument.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
}

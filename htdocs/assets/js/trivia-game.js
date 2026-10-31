import { TriviaApiError, advanceRound, getRoom, rejoinRoom, replayRoom, startRoom, submitAnswer } from './trivia-api.js';
import {
    ELIMINATION_REVEAL_IMAGE,
    SCENE_FALLBACK_IMAGE,
    answerPayloadForSelection,
    choicesForRound,
    correctAnswersForRound,
    minigameType,
    orderedSelectionCount,
    phasePresentation,
    previewForRound,
    racePositionMap,
    roundType,
    savedSelection,
    selectionMode,
    viewerCanAnswer,
} from './trivia-game-model.js';

const requireElement = (id) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing trivia game element: ${id}`);
    }
    return element;
};

const elements = {
    summary: requireElement('trivia-game-summary'),
    error: requireElement('trivia-game-error'),
    roomStatus: requireElement('trivia-room-status'),
    playerStatus: requireElement('trivia-player-status'),
    answerStatus: requireElement('trivia-answer-status'),
    timer: requireElement('trivia-timer'),
    timerValue: requireElement('trivia-timer-value'),
    roundLabel: requireElement('trivia-round-label'),
    questionText: requireElement('trivia-question-text'),
    roundMessage: requireElement('trivia-round-message'),
    answerForm: requireElement('trivia-answer-form'),
    choiceFieldset: /** @type {HTMLFieldSetElement} */ (requireElement('trivia-choice-fieldset')),
    choiceLegend: requireElement('trivia-choice-legend'),
    choiceGrid: requireElement('trivia-choice-grid'),
    submitButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-submit-answer-button')),
    resultPanel: requireElement('trivia-result-panel'),
    scene: requireElement('trivia-scene'),
    sceneImage: /** @type {HTMLImageElement} */ (requireElement('trivia-scene-image')),
    phaseLabel: requireElement('trivia-phase-label'),
    phaseTitle: requireElement('trivia-phase-title'),
    phaseInstructions: requireElement('trivia-phase-instructions'),
    memoryPreview: requireElement('trivia-memory-preview'),
    memoryPreviewEyebrow: requireElement('trivia-memory-preview-eyebrow'),
    memoryPreviewTitle: requireElement('trivia-memory-preview-title'),
    memorySymbols: requireElement('trivia-memory-symbols'),
    expression: requireElement('trivia-expression'),
    orderControls: requireElement('trivia-order-controls'),
    orderStatus: requireElement('trivia-order-status'),
    undoOrderButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-undo-order-button')),
    clearOrderButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-clear-order-button')),
    viewerCard: requireElement('trivia-viewer-card'),
    viewerAvatar: requireElement('trivia-viewer-avatar'),
    viewerName: requireElement('trivia-viewer-name'),
    viewerRole: requireElement('trivia-viewer-role'),
    viewerLives: requireElement('trivia-viewer-lives'),
    reveal: requireElement('trivia-elimination-reveal'),
    revealBackdrop: requireElement('trivia-elimination-backdrop'),
    revealImage: /** @type {HTMLImageElement} */ (requireElement('trivia-elimination-image')),
    revealLabel: requireElement('trivia-elimination-label'),
    revealTitle: requireElement('trivia-elimination-title'),
    revealSummary: requireElement('trivia-elimination-summary'),
    revealList: requireElement('trivia-elimination-list'),
    revealDismiss: /** @type {HTMLButtonElement} */ (requireElement('trivia-elimination-dismiss')),
    revealCountdown: requireElement('trivia-elimination-countdown'),
    racePanel: requireElement('trivia-race-panel'),
    raceTrack: requireElement('trivia-race-track'),
    hostActions: requireElement('trivia-game-host-actions'),
    startButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-start-game-button')),
    resolveButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-resolve-round-button')),
    advanceButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-advance-round-button')),
    replayButton: /** @type {HTMLButtonElement} */ (requireElement('trivia-replay-game-button')),
    rematchPanel: requireElement('trivia-rematch-panel'),
    rematchInvites: requireElement('trivia-rematch-invites'),
    rematchMessage: requireElement('trivia-rematch-message'),
    roster: requireElement('trivia-game-roster'),
    metaPlayers: requireElement('trivia-meta-players'),
    metaRound: requireElement('trivia-meta-round'),
    metaPhase: requireElement('trivia-meta-phase'),
    metaAnswers: requireElement('trivia-meta-answers'),
    metaViewer: requireElement('trivia-meta-viewer'),
    rejoinSection: requireElement('trivia-rejoin-section'),
    rejoinUrl: /** @type {HTMLInputElement} */ (requireElement('trivia-rejoin-url')),
    copyRejoinButton: requireElement('trivia-copy-rejoin-button'),
    rejoinMessage: requireElement('trivia-rejoin-message'),
};

const state = {
    roomId: new URLSearchParams(window.location.search).get('id') || '',
    room: null,
    selectedAnswers: [],
    lockedRoundId: '',
    lockedAnswers: [],
    pollTimer: null,
    clockTimer: null,
    isRefreshing: false,
    isSubmitting: false,
    isStarting: false,
    isReplaying: false,
    phaseKey: '',
    previewKey: '',
    syncChoices: null,
    revealedRoundIds: new Set(),
    revealTimer: null,
    revealReturnFocus: null,
};

const REVEAL_AUTO_DISMISS_MS = 9000;
const revealStorageKey = (roomId) => `wowie.trivia.reveals.${roomId}`;

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const setMessage = (element, message = '', tone = '') => {
    element.textContent = message;
    element.dataset.tone = tone;
};

const errorMessage = (error, fallback) => error instanceof TriviaApiError && error.message
    ? error.message
    : fallback;

const playerName = (player) => {
    const name = typeof player?.display_name === 'string' ? player.display_name.trim() : '';
    return name || `Seat ${player?.seat_number ?? '?'}`;
};

const players = (room) => Array.isArray(room?.players) ? room.players : [];
const livingPlayers = (room) => players(room).filter((player) => player.status === 'active' && player.is_ghost !== true);
const ghosts = (room) => players(room).filter((player) => player.is_ghost === true);
const viewerPlayer = (room) => players(room).find((player) => player.id === room?.viewer?.player_id) || null;
const viewerAnswer = (room) => room?.round?.viewer_answer && typeof room.round.viewer_answer === 'object'
    ? room.round.viewer_answer
    : { answered: false, answer_text: null, answer_payload: {} };
const viewerHasAnswered = (room) => viewerAnswer(room).answered === true;

const createUuid = () => {
    const browserCrypto = globalThis.crypto;
    if (browserCrypto?.randomUUID) {
        return browserCrypto.randomUUID();
    }
    const randomNibble = () => browserCrypto?.getRandomValues
        ? browserCrypto.getRandomValues(new Uint8Array(1))[0] & 15
        : Math.floor(Math.random() * 16);
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) => (
        Number(character) ^ randomNibble() >> Number(character) / 4
    ).toString(16));
};

const formatTimer = (room) => {
    const closesAt = room?.round?.closes_at ? Date.parse(room.round.closes_at) : NaN;
    if (!Number.isFinite(closesAt) || room?.round?.status !== 'answering' || room?.status !== 'active') {
        return '--';
    }
    return String(Math.max(0, Math.ceil((closesAt - Date.now()) / 1000)));
};

const updateTimer = (room) => {
    const timer = formatTimer(room);
    const windowSeconds = Number(room?.round?.answer_window_seconds) || 0;
    const progress = timer === '--' || windowSeconds <= 0
        ? 0
        : Math.max(0, Math.min(1, Number(timer) / windowSeconds));
    elements.timerValue.textContent = timer;
    elements.timer.dataset.urgent = String(timer !== '--' && Number(timer) <= 5);
    elements.timer.dataset.running = String(timer !== '--');
    elements.timer.style.setProperty('--timer-progress', String(progress));
    return timer;
};

const isTimerClosed = (room) => {
    const closesAt = room?.round?.closes_at ? Date.parse(room.round.closes_at) : NaN;
    return Number.isFinite(closesAt)
        && room?.round?.status === 'answering'
        && room?.status === 'active'
        && closesAt <= Date.now();
};

const rejoinStorageKey = (roomId) => `wowie.trivia.rejoin.${roomId}`;
const readRejoinToken = () => new URLSearchParams(window.location.search).get('rejoin') || '';

const cleanRejoinParam = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('rejoin')) {
        url.searchParams.delete('rejoin');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
};

const persistRejoinLink = (roomId, url) => {
    if (!roomId || !url) {
        return;
    }
    try {
        window.localStorage.setItem(rejoinStorageKey(roomId), url);
    } catch {
        // The visible link remains available as a manual fallback.
    }
};

const showRejoinUrl = (url) => {
    if (!url) {
        return;
    }
    elements.rejoinUrl.value = url;
    elements.rejoinSection.hidden = false;
};

const showStoredRejoinLink = () => {
    try {
        showRejoinUrl(window.localStorage.getItem(rejoinStorageKey(state.roomId)) || '');
    } catch {
        // URL-based rejoin still works when storage is unavailable.
    }
};

const storeApiRejoinLink = (link) => {
    const url = typeof link?.url === 'string' ? new URL(link.url, window.location.origin).toString() : '';
    if (!url) {
        return;
    }
    persistRejoinLink(state.roomId, url);
    showRejoinUrl(url);
};

const copyWithFallback = async (text) => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    elements.rejoinUrl.focus({ preventScroll: true });
    elements.rejoinUrl.select();
    document.execCommand('copy');
};

const absoluteLink = (url) => typeof url === 'string' && url !== ''
    ? new URL(url, window.location.origin).toString()
    : '';

const showRematchInvites = (links) => {
    elements.rematchInvites.replaceChildren();
    const inviteLinks = Array.isArray(links) ? links : [];
    inviteLinks.forEach((link, index) => {
        const url = absoluteLink(link?.url);
        if (!url) {
            return;
        }
        const card = document.createElement('article');
        card.className = 'trivia-invite-card';
        const title = document.createElement('h3');
        title.textContent = `Invite ${index + 1}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = url;
        input.readOnly = true;
        input.setAttribute('aria-label', `Rematch invite ${index + 1}`);
        const button = document.createElement('button');
        button.className = 'trivia-button';
        button.type = 'button';
        button.textContent = 'Copy';
        button.addEventListener('click', async () => {
            try {
                await copyWithFallback(url);
                button.textContent = 'Copied';
                setMessage(elements.rematchMessage, `Invite ${index + 1} copied.`, 'success');
            } catch {
                input.focus({ preventScroll: true });
                input.select();
                setMessage(elements.rematchMessage, 'Copy failed. Select the invite and copy it manually.', 'error');
            }
        });
        card.append(title, input, button);
        elements.rematchInvites.append(card);
    });
    elements.rematchPanel.hidden = elements.rematchInvites.children.length === 0;
};

/**
 * Point an image at a new source; a missing file falls back once to the
 * question-stage art, and a second failure hides the image instead of
 * showing a broken-image icon.
 * @param {HTMLImageElement} image
 * @param {string} src
 */
const setImageSource = (image, src) => {
    image.dataset.fallbackApplied = 'false';
    delete image.dataset.broken;
    image.src = src;
};

/**
 * @param {HTMLImageElement} image
 */
const attachImageFallback = (image) => {
    const handleError = () => {
        if (image.dataset.fallbackApplied !== 'true' && !image.src.endsWith(SCENE_FALLBACK_IMAGE)) {
            image.dataset.fallbackApplied = 'true';
            image.src = SCENE_FALLBACK_IMAGE;
            return;
        }
        image.dataset.broken = 'true';
    };
    image.addEventListener('error', handleError);
    image.addEventListener('load', () => {
        delete image.dataset.broken;
    });
    if (image.getAttribute('src') && image.complete && image.naturalWidth === 0) {
        handleError();
    }
};

const swapSceneImage = (src, alt) => {
    const image = elements.sceneImage;
    const previousSrc = image.currentSrc || image.src;
    elements.scene.querySelectorAll('.trivia-scene-previous').forEach((layer) => layer.remove());
    if (!prefersReducedMotion() && previousSrc && image.complete && image.naturalWidth > 0 && image.dataset.broken !== 'true') {
        const layer = document.createElement('img');
        layer.className = 'trivia-scene-previous';
        layer.src = previousSrc;
        layer.alt = '';
        layer.setAttribute('aria-hidden', 'true');
        image.after(layer);
        let faded = false;
        let safetyTimer = 0;
        const fadeOut = () => {
            if (faded) {
                return;
            }
            faded = true;
            window.clearTimeout(safetyTimer);
            image.removeEventListener('load', fadeOut);
            layer.dataset.leaving = 'true';
            window.setTimeout(() => layer.remove(), 700);
        };
        image.addEventListener('load', fadeOut);
        safetyTimer = window.setTimeout(fadeOut, 2500);
    }
    setImageSource(image, src);
    image.alt = alt;
};

const renderScene = (room) => {
    const presentation = phasePresentation(room);
    const usesPromptImage = room?.status === 'active';
    const promptImage = usesPromptImage && typeof room?.round?.image_url === 'string' ? room.round.image_url.trim() : '';
    const image = promptImage || presentation.image;
    elements.scene.dataset.phase = presentation.key;
    elements.phaseLabel.textContent = presentation.label;
    elements.phaseTitle.textContent = presentation.title;
    elements.phaseInstructions.textContent = presentation.instructions;
    elements.phaseInstructions.dataset.phase = presentation.key;
    if (state.phaseKey !== `${presentation.key}:${image}`) {
        const isMinigameArt = roundType(room) === 'killing_floor' && promptImage === presentation.image;
        swapSceneImage(image, promptImage && !isMinigameArt
            ? `Illustration for ${String(room?.round?.prompt?.question || presentation.title)}.`
            : presentation.alt);
        state.phaseKey = `${presentation.key}:${image}`;
    }
};

const renderExpression = (room) => {
    const expression = phasePresentation(room).expression || '';
    elements.expression.hidden = expression === '' || room?.status === 'waiting';
    if (expression === '') {
        elements.expression.textContent = '';
        return;
    }
    const answer = correctAnswersForRound(room)[0] || '?';
    elements.expression.textContent = `${expression} = ${answer}`;
    elements.expression.dataset.solved = String(answer !== '?');
};

const startingLives = (room) => {
    const value = Math.round(Number(room?.starting_lives));
    return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * Heart glyphs for remaining lives and skulls for lost ones.
 * @returns {HTMLElement | null}
 */
const livesElement = (room, livesRemaining) => {
    const total = startingLives(room);
    const raw = Math.round(Number(livesRemaining));
    if (total === 0 || !Number.isFinite(raw)) {
        return null;
    }
    const remaining = Math.max(0, raw);
    const slots = Math.max(total, remaining);
    const wrap = document.createElement('span');
    wrap.className = 'trivia-lives';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', `${remaining} of ${total} ${total === 1 ? 'life' : 'lives'} left`);
    wrap.title = `${remaining} of ${total} ${total === 1 ? 'life' : 'lives'} left`;
    for (let index = 0; index < slots; index += 1) {
        const glyph = document.createElement('span');
        glyph.className = 'trivia-life';
        glyph.dataset.state = index < remaining ? 'full' : 'lost';
        glyph.textContent = index < remaining ? '♥' : '☠';
        glyph.setAttribute('aria-hidden', 'true');
        wrap.append(glyph);
    }
    return wrap;
};

const playerStanding = (room, player) => {
    if (!player) {
        return 'spectator';
    }
    if (player.id === room?.winner_player_id) {
        return 'escaped';
    }
    if (player.id === room?.body_holder_player_id) {
        return 'body';
    }
    if (player.is_ghost === true) {
        return 'ghost';
    }
    return player.status === 'active' ? 'alive' : 'out';
};

const STANDING_GLYPHS = {
    spectator: '👁',
    escaped: '★',
    body: '⚱',
    ghost: '👻',
    alive: '♥',
    out: '·',
};

const renderViewerCard = (room) => {
    const viewer = viewerPlayer(room);
    const standing = playerStanding(room, viewer);
    elements.viewerCard.dataset.standing = standing;
    elements.viewerAvatar.textContent = STANDING_GLYPHS[standing] || '·';
    elements.viewerName.textContent = viewer ? playerName(viewer) : 'Spectator';
    elements.viewerRole.textContent = {
        spectator: 'Watching from the gallery. Claim an invite or rejoin to play.',
        escaped: 'You escaped the mansion with the body!',
        body: 'You hold the body. Outrun the ghosts to the exit.',
        ghost: 'You are a ghost. Correct answers still haunt your way up the race.',
        alive: 'Alive and answering. Wrong answers cost a life on the Killing Floor.',
        out: 'You have left this table.',
    }[standing] || '';
    const lives = viewer ? livesElement(room, viewer.lives_remaining) : null;
    elements.viewerLives.replaceChildren(...(lives ? [lives] : []));
    elements.viewerLives.hidden = !lives;
};

const renderRoster = (room) => {
    const roomPlayers = players(room);
    elements.roster.replaceChildren();
    if (roomPlayers.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'lede trivia-state-message';
        empty.textContent = 'No players are seated in this room.';
        elements.roster.append(empty);
        return;
    }
    roomPlayers.forEach((player) => {
        const standing = playerStanding(room, player);
        const row = document.createElement('div');
        row.className = 'trivia-roster-row trivia-game-roster-row';
        row.dataset.status = player.status || 'active';
        row.dataset.bodyHolder = String(player.id === room.body_holder_player_id);
        row.dataset.ghost = String(player.is_ghost === true);
        row.dataset.winner = String(player.id === room.winner_player_id);
        row.dataset.viewer = String(player.viewer_controls_player === true);

        const seat = document.createElement('span');
        seat.className = 'trivia-seat-number';
        seat.dataset.standing = standing;
        seat.title = player.is_ghost === true ? `Ghost · seat ${player.seat_number ?? '?'}` : `Seat ${player.seat_number ?? '?'}`;
        seat.textContent = player.is_ghost === true || standing === 'escaped' || standing === 'body'
            ? STANDING_GLYPHS[standing]
            : String(player.seat_number ?? '?');

        const info = document.createElement('span');
        info.className = 'trivia-roster-info';

        const name = document.createElement('strong');
        name.textContent = player.viewer_controls_player ? `${playerName(player)} (you)` : playerName(player);

        const meta = document.createElement('span');
        meta.className = 'trivia-roster-meta';
        if (player.id === room.winner_player_id) {
            meta.textContent = 'Escaped';
        } else if (player.id === room.body_holder_player_id) {
            meta.textContent = `Has the body · ${player.race_position || 0} steps`;
        } else if (player.is_ghost === true) {
            meta.textContent = roundType(room) === 'ghost_race'
                ? `Ghost · ${player.race_position || 0} steps`
                : 'Ghost · still playing';
        } else if (player.role === 'host') {
            meta.textContent = 'Host · alive';
        } else {
            meta.textContent = 'Alive';
        }
        info.append(name, meta);
        const lives = livesElement(room, player.lives_remaining);
        row.append(seat, info, ...(lives ? [lives] : []));
        elements.roster.append(row);
    });
};

const renderRace = (room) => {
    const showRace = roundType(room) === 'ghost_race' || (room?.status === 'finished' && ghosts(room).length > 0);
    elements.racePanel.hidden = !showRace;
    elements.raceTrack.replaceChildren();
    if (!showRace) {
        return;
    }
    const positions = racePositionMap(room);
    const goal = Math.max(1, Number(room?.round?.race_goal || room?.race_goal || 12));
    players(room)
        .filter((player) => player.status !== 'left' && (player.is_ghost === true || player.id === room.body_holder_player_id))
        .sort((left, right) => (positions[right.id] || right.race_position || 0) - (positions[left.id] || left.race_position || 0))
        .forEach((player) => {
            const position = Math.max(0, Number(positions[player.id] ?? player.race_position ?? 0));
            const boundedPosition = Math.min(goal, position);
            const isBodyHolder = player.id === room.body_holder_player_id;
            const role = isBodyHolder ? 'Body' : 'Ghost';
            const row = document.createElement('div');
            row.className = 'trivia-racer';
            row.dataset.bodyHolder = String(isBodyHolder);
            row.dataset.complete = String(position >= goal);
            row.dataset.ghost = String(player.is_ghost === true);

            const name = document.createElement('span');
            name.className = 'trivia-racer-name';
            name.textContent = `${role} · ${playerName(player)}`;

            const meter = document.createElement('span');
            meter.className = 'trivia-racer-meter';
            meter.setAttribute('role', 'progressbar');
            meter.setAttribute('aria-label', `${playerName(player)} race position`);
            meter.setAttribute('aria-valuemin', '0');
            meter.setAttribute('aria-valuemax', String(goal));
            meter.setAttribute('aria-valuenow', String(boundedPosition));
            meter.setAttribute('aria-valuetext', `${role}: ${position} of ${goal}${position >= goal ? ', finished' : ''}`);

            const course = document.createElement('span');
            course.className = 'trivia-racer-course';
            course.setAttribute('aria-hidden', 'true');
            course.style.setProperty('--race-progress', `${Math.min(100, (position / goal) * 100)}%`);

            const marker = document.createElement('span');
            marker.className = 'trivia-racer-marker';
            marker.textContent = isBodyHolder ? '⚱' : '👻';
            course.append(marker);
            meter.append(course);

            const score = document.createElement('span');
            score.className = 'trivia-racer-score';
            score.textContent = `${position}/${goal}`;
            row.append(name, score, meter);
            elements.raceTrack.append(row);
        });
};

const currentSelection = (room) => {
    const saved = savedSelection(room);
    if (saved.length > 0 || viewerHasAnswered(room)) {
        return saved;
    }
    return state.lockedRoundId === room?.round?.id ? state.lockedAnswers : state.selectedAnswers;
};

const answerLegend = (room) => {
    const minigame = minigameType(room);
    if (minigame === 'memory_match') {
        return 'Select every remembered symbol';
    }
    if (minigame === 'key_lock') {
        return 'Choose one key';
    }
    if (minigame === 'poison_chalices') {
        return 'Choose one chalice';
    }
    if (minigame === 'sword_boxes') {
        return 'Choose one box';
    }
    if (minigame === 'crypt_runes') {
        return 'Select every safe rune';
    }
    if (minigame === 'grim_arithmetic') {
        return 'Choose the true answer';
    }
    if (minigame === 'odd_one_out') {
        return 'Choose the one that does not belong';
    }
    if (selectionMode(room) === 'ordered') {
        const count = orderedSelectionCount(room);
        return `Select ${count} symbols in the order they flashed`;
    }
    if (roundType(room) === 'ghost_race') {
        return 'All, some, or none may be correct. Each correct pick or correctly skipped choice moves you one space.';
    }
    if (selectionMode(room) === 'multiple') {
        return 'Select every correct answer';
    }
    return 'Choose an answer';
};

const renderRoundMessage = (room, canAnswer, locked) => {
    const viewer = viewerPlayer(room);
    const closed = isTimerClosed(room);
    const preview = previewForRound(room);
    if (room?.status === 'waiting') {
        const needed = Math.max(0, 2 - livingPlayers(room).length);
        setMessage(elements.roundMessage, needed > 0 ? `Waiting for ${needed} more player${needed === 1 ? '' : 's'}.` : 'Ready for the host to begin.', 'neutral');
    } else if (room?.status === 'finished') {
        const winner = players(room).find((player) => player.id === room.winner_player_id);
        setMessage(elements.roundMessage, winner ? `${playerName(winner)} escaped the mansion.` : 'The mansion kept everyone.', 'success');
    } else if (!viewer) {
        setMessage(elements.roundMessage, 'You are spectating. Claim an invite or use your rejoin link to play.', 'neutral');
    } else if (room?.round?.status === 'resolved') {
        setMessage(elements.roundMessage, 'The result is in. The host can open the next phase.', 'success');
    } else if (locked) {
        setMessage(elements.roundMessage, 'Answer locked. The mansion is waiting on the other players.', 'success');
    } else if (closed) {
        setMessage(elements.roundMessage, 'Time is up. The host can reveal the result.', 'error');
    } else if (preview.kind === 'memory') {
        setMessage(elements.roundMessage, 'Memorize the glowing symbols. Your choices appear when the flash ends.', 'neutral');
    } else if (preview.kind === 'sequence') {
        setMessage(elements.roundMessage, 'Memorize the order. The symbols unlock when the flash ends.', 'neutral');
    } else if (canAnswer) {
        setMessage(elements.roundMessage, room?.viewer?.is_ghost ? 'Ghosts still get a vote. Make it count.' : 'Choose before the timer reaches zero.', 'neutral');
    } else {
        setMessage(elements.roundMessage, 'Watch this round—the mansion did not select you to answer.', 'neutral');
    }
};

const renderMemoryPreview = (room) => {
    const preview = previewForRound(room);
    const key = `${room?.round?.id || ''}:${preview.kind}:${preview.symbols.join('|')}`;
    elements.memoryPreview.hidden = preview.symbols.length === 0;
    elements.memoryPreview.dataset.kind = preview.kind;
    if (state.previewKey === key) {
        return;
    }
    state.previewKey = key;
    const isSequence = preview.kind === 'sequence';
    elements.memoryPreviewEyebrow.textContent = isSequence ? 'Memorize the order' : 'Memorize now';
    elements.memoryPreviewTitle.textContent = isSequence
        ? 'This sequence vanishes in six seconds'
        : 'These symbols vanish in five seconds';
    elements.memorySymbols.replaceChildren();
    preview.symbols.forEach((symbol, index) => {
        const item = document.createElement('strong');
        item.style.setProperty('--preview-index', String(index));
        if (isSequence) {
            const step = document.createElement('span');
            step.className = 'trivia-sequence-step';
            step.textContent = String(index + 1);
            item.append(step, ` ${symbol}`);
        } else {
            item.textContent = symbol;
        }
        elements.memorySymbols.append(item);
    });
};

/** Visual theme for the choice tiles: the mini-game type or the round type. */
const choiceTheme = (room) => roundType(room) === 'killing_floor'
    ? minigameType(room) || 'key_lock'
    : roundType(room);

const isRoundRevealed = (room) => Boolean(room?.round) && (room.round.status === 'resolved' || room?.status === 'finished');

const renderChoices = (room) => {
    const round = room?.round;
    const choices = choicesForRound(room);
    const mode = selectionMode(room);
    const ordered = mode === 'ordered';
    const orderCount = orderedSelectionCount(room);
    const allowsEmptySelection = roundType(room) === 'ghost_race';
    const locked = state.lockedRoundId === round?.id || viewerHasAnswered(room);
    const previewActive = previewForRound(room).symbols.length > 0;
    const canAnswer = viewerCanAnswer(room) && !locked && !isTimerClosed(room) && !previewActive;
    const revealed = isRoundRevealed(room);
    const correctList = correctAnswersForRound(room);
    const correct = new Set(correctList);
    const theme = choiceTheme(room);
    /** @type {{ choice: string, label: HTMLLabelElement, input: HTMLInputElement, badge: HTMLElement, tag: HTMLElement }[]} */
    const tiles = [];

    const updateSubmitButton = () => {
        const count = state.selectedAnswers.length;
        elements.submitButton.disabled = !canAnswer
            || (!allowsEmptySelection && count === 0)
            || state.isSubmitting;
        elements.submitButton.textContent = allowsEmptySelection && count === 0
            ? 'Lock none of these'
            : ordered && count > 0
                ? `Lock order (${count}/${orderCount})`
                : mode === 'multiple' && count > 0
                    ? `Lock ${count} answer${count === 1 ? '' : 's'}`
                    : 'Lock answer';
    };

    const syncTiles = () => {
        const picks = currentSelection(room);
        const full = ordered && picks.length >= orderCount;
        tiles.forEach(({ choice, label, input, badge, tag }) => {
            const pickIndex = picks.indexOf(choice);
            const picked = pickIndex !== -1;
            input.checked = picked;
            input.disabled = !canAnswer || (full && !picked);
            label.dataset.picked = String(picked);
            badge.hidden = !(ordered && picked);
            badge.replaceChildren();
            if (ordered && picked) {
                const hiddenText = document.createElement('span');
                hiddenText.className = 'trivia-visually-hidden';
                hiddenText.textContent = 'pick ';
                badge.append(hiddenText, String(pickIndex + 1));
            }

            let reveal = '';
            let tagText = '';
            if (revealed) {
                const correctIndex = correctList.indexOf(choice);
                const isCorrectChoice = correct.has(choice);
                const pickRight = ordered ? isCorrectChoice && correctIndex === pickIndex : isCorrectChoice;
                if (picked && pickRight) {
                    reveal = 'hit';
                    tagText = 'Your pick ✓';
                } else if (picked) {
                    reveal = 'wrong';
                    tagText = ordered && isCorrectChoice ? `Your pick ✗ · was #${correctIndex + 1}` : 'Your pick ✗';
                } else if (isCorrectChoice) {
                    reveal = 'correct';
                    tagText = ordered ? `Correct #${correctIndex + 1}` : 'Correct';
                } else {
                    reveal = 'plain';
                }
            }
            if (reveal) {
                label.dataset.reveal = reveal;
            } else {
                delete label.dataset.reveal;
            }
            tag.textContent = tagText;
            tag.hidden = tagText === '';
        });

        elements.orderControls.hidden = !ordered || elements.answerForm.hidden;
        elements.undoOrderButton.disabled = !canAnswer || state.selectedAnswers.length === 0;
        elements.clearOrderButton.disabled = !canAnswer || state.selectedAnswers.length === 0;
        elements.orderStatus.textContent = !ordered
            ? ''
            : revealed
                ? `The true order: ${correctList.join(' → ') || 'hidden'}`
                : picks.length >= orderCount
                    ? 'Order complete. Lock it in before the lights go out.'
                    : `${picks.length} of ${orderCount} chosen${picks.length > 0 ? ` · ${picks.join(' → ')}` : ''}`;
        updateSubmitButton();
    };

    elements.choiceGrid.replaceChildren();
    elements.answerForm.hidden = !round || room?.status === 'waiting' || room?.status === 'finished' || choices.length === 0;
    elements.answerForm.dataset.minigame = theme;
    elements.choiceGrid.dataset.minigame = theme;
    elements.choiceGrid.dataset.mode = mode;
    elements.choiceGrid.dataset.revealed = String(revealed);
    elements.choiceLegend.textContent = answerLegend(room);

    choices.forEach((choice, index) => {
        const id = `trivia-choice-${index}`;
        const label = document.createElement('label');
        label.className = 'trivia-choice';
        label.dataset.minigame = theme;
        label.style.setProperty('--choice-index', String(index));
        if (correct.has(choice)) {
            label.dataset.correct = 'true';
        }

        const input = document.createElement('input');
        input.type = mode === 'single' ? 'radio' : 'checkbox';
        input.name = mode === 'single' ? 'trivia-answer' : 'trivia-answer[]';
        input.id = id;
        input.value = choice;
        input.addEventListener('change', () => {
            if (ordered) {
                if (input.checked && state.selectedAnswers.length >= orderCount && !state.selectedAnswers.includes(choice)) {
                    input.checked = false;
                } else {
                    state.selectedAnswers = input.checked
                        ? [...state.selectedAnswers.filter((value) => value !== choice), choice]
                        : state.selectedAnswers.filter((value) => value !== choice);
                }
            } else if (mode === 'multiple') {
                state.selectedAnswers = input.checked
                    ? [...state.selectedAnswers, choice].filter((value, choiceIndex, values) => values.indexOf(value) === choiceIndex)
                    : state.selectedAnswers.filter((value) => value !== choice);
            } else {
                state.selectedAnswers = [choice];
            }
            syncTiles();
        });

        const icon = document.createElement('span');
        icon.className = 'trivia-choice-icon';
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'trivia-choice-text';
        text.textContent = choice;

        const badge = document.createElement('span');
        badge.className = 'trivia-choice-order';
        badge.hidden = true;

        const tag = document.createElement('span');
        tag.className = 'trivia-choice-tag';
        tag.hidden = true;

        label.append(input, icon, text, badge, tag);
        elements.choiceGrid.append(label);
        tiles.push({ choice, label, input, badge, tag });
    });

    elements.choiceFieldset.disabled = !canAnswer;
    state.syncChoices = syncTiles;
    syncTiles();
    renderRoundMessage(room, canAnswer, locked);
};

const handleUndoOrder = () => {
    if (state.selectedAnswers.length === 0) {
        return;
    }
    state.selectedAnswers = state.selectedAnswers.slice(0, -1);
    state.syncChoices?.();
};

const handleClearOrder = () => {
    state.selectedAnswers = [];
    state.syncChoices?.();
};

const appendResultLine = (label, value) => {
    const paragraph = document.createElement('p');
    paragraph.append(`${label}: `);
    const strong = document.createElement('strong');
    strong.textContent = value;
    paragraph.append(strong);
    elements.resultPanel.append(paragraph);
};

const renderResult = (room) => {
    const round = room?.round;
    elements.resultPanel.replaceChildren();
    if (!round || (round.status !== 'resolved' && room.status !== 'finished')) {
        elements.resultPanel.hidden = true;
        return;
    }

    const title = document.createElement('h3');
    title.textContent = room.status === 'finished' ? 'The final verdict' : `${phasePresentation(room).title} result`;
    elements.resultPanel.append(title);

    const answer = viewerAnswer(room);
    if (answer.answered && typeof answer.is_correct === 'boolean') {
        const verdict = document.createElement('p');
        verdict.className = 'trivia-result-verdict';
        verdict.dataset.correct = String(answer.is_correct);
        verdict.textContent = answer.is_correct ? 'You survived this one.' : 'The mansion got you this time.';
        elements.resultPanel.append(verdict);
    }

    const correct = correctAnswersForRound(room);
    if (roundType(room) === 'ghost_race' && correct.length === 0) {
        appendResultLine('Correct answers', 'None of them');
    } else if (correct.length > 0 && selectionMode(room) === 'ordered') {
        appendResultLine('Correct order', correct.join(' → '));
    } else if (correct.length > 0) {
        appendResultLine(correct.length === 1 ? 'Correct answer' : 'Correct answers', correct.join(', '));
    }
    const description = String(round.minigame?.results?.result_description || round.minigame?.payload?.result_description || '').trim();
    if (roundType(room) === 'killing_floor' && description !== '') {
        const explanation = document.createElement('p');
        explanation.textContent = description;
        elements.resultPanel.append(explanation);
    }
    if (roundType(room) === 'trivia' && round.prompt?.explanation) {
        const explanation = document.createElement('p');
        explanation.textContent = round.prompt.explanation;
        elements.resultPanel.append(explanation);
    }
    if (roundType(room) === 'killing_floor') {
        const results = round.minigame?.results || {};
        const ghosted = players(room).filter((player) => Array.isArray(results.ghosted_player_ids) && results.ghosted_player_ids.includes(player.id));
        const bled = players(room).filter((player) => Array.isArray(results.lives_lost_player_ids) && results.lives_lost_player_ids.includes(player.id));
        if (bled.length > 0) {
            appendResultLine('Lost a life', bled.map(playerName).join(', '));
        }
        if (ghosted.length > 0) {
            appendResultLine('New ghosts', ghosted.map(playerName).join(', '));
        }
        const spared = players(room).find((player) => player.id === results.spared_player_id);
        if (spared) {
            appendResultLine('Mansion mercy', `${playerName(spared)} was spared so the party can continue`);
        }
    }
    if (roundType(room) === 'ghost_race' && answer.answered) {
        appendResultLine('Your movement', `${Number(answer.score || 0)} step${Number(answer.score || 0) === 1 ? '' : 's'}`);
        const catcher = players(room).find((player) => player.id === round.race_results?.caught_by_player_id);
        if (catcher) {
            appendResultLine('Body stolen', playerName(catcher));
        }
    }
    if (room.status === 'finished') {
        const winner = players(room).find((player) => player.id === room.winner_player_id);
        appendResultLine('Winner', winner ? playerName(winner) : 'No one');
    }
    elements.resultPanel.hidden = false;
};

const readSeenReveals = () => {
    try {
        const stored = JSON.parse(window.localStorage.getItem(revealStorageKey(state.roomId)) || '[]');
        return Array.isArray(stored) ? stored.map(String) : [];
    } catch {
        return [];
    }
};

const hasSeenReveal = (roundId) => state.revealedRoundIds.has(roundId) || readSeenReveals().includes(roundId);

const markRevealSeen = (roundId) => {
    state.revealedRoundIds.add(roundId);
    try {
        const seen = [...readSeenReveals().filter((id) => id !== roundId), roundId].slice(-40);
        window.localStorage.setItem(revealStorageKey(state.roomId), JSON.stringify(seen));
    } catch {
        // The in-memory set still prevents repeats for this page view.
    }
};

const outcomeKind = (outcome) => {
    if (outcome?.spared === true) {
        return 'spared';
    }
    if (outcome?.ghosted === true) {
        return 'ghosted';
    }
    if (outcome?.lost_life === true) {
        return 'lost_life';
    }
    return 'survived';
};

const OUTCOME_COPY = {
    survived: { glyph: '✔', label: 'Survived' },
    lost_life: { glyph: '♥', label: 'Lost a life' },
    ghosted: { glyph: '👻', label: 'Became a ghost' },
    spared: { glyph: '✧', label: 'Spared by the mansion' },
};

const hideEliminationReveal = () => {
    if (state.revealTimer !== null) {
        window.clearTimeout(state.revealTimer);
        state.revealTimer = null;
    }
    if (elements.reveal.hidden) {
        return;
    }
    elements.reveal.hidden = true;
    delete elements.reveal.dataset.open;
    const returnFocus = state.revealReturnFocus;
    state.revealReturnFocus = null;
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
    }
};

const showEliminationReveal = (room, outcomes) => {
    const viewerId = room?.viewer?.player_id || '';
    const kinds = outcomes.map(outcomeKind);
    const ghostedCount = kinds.filter((kind) => kind === 'ghosted').length;
    const lostCount = kinds.filter((kind) => kind === 'lost_life').length;
    const viewerOutcome = outcomes.find((outcome) => outcome?.player_id && outcome.player_id === viewerId) || null;

    elements.revealLabel.textContent = `Round ${room?.round?.round_number ?? ''} · ${phasePresentation(room).title}`.trim();
    elements.revealTitle.textContent = ghostedCount > 1
        ? 'The mansion claims its victims'
        : ghostedCount === 1
            ? 'The mansion claims a victim'
            : lostCount > 0
                ? 'Blood on the Killing Floor'
                : 'Everyone slipped the trap';
    if (viewerOutcome) {
        const kind = outcomeKind(viewerOutcome);
        const livesLeft = Math.max(0, Number(viewerOutcome.lives_remaining) || 0);
        elements.revealSummary.textContent = {
            survived: 'You survived the trap untouched.',
            lost_life: `You lost a life. ${livesLeft} ${livesLeft === 1 ? 'life remains' : 'lives remain'}.`,
            ghosted: 'You ran out of lives and joined the ghosts. Keep answering to haunt the race.',
            spared: 'The mansion spared you so the party can go on.',
        }[kind];
    } else {
        const survivedCount = kinds.filter((kind) => kind === 'survived').length;
        elements.revealSummary.textContent = `${survivedCount} survived · ${lostCount} lost a life · ${ghostedCount} became ${ghostedCount === 1 ? 'a ghost' : 'ghosts'}.`;
    }

    elements.revealList.replaceChildren();
    outcomes.forEach((outcome, index) => {
        const kind = outcomeKind(outcome);
        const copy = OUTCOME_COPY[kind];
        const item = document.createElement('li');
        item.className = 'trivia-outcome';
        item.dataset.outcome = kind;
        item.dataset.viewer = String(Boolean(viewerId) && outcome?.player_id === viewerId);
        item.style.setProperty('--outcome-index', String(index));

        const glyph = document.createElement('span');
        glyph.className = 'trivia-outcome-glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = copy.glyph;

        const body = document.createElement('span');
        body.className = 'trivia-outcome-body';
        const name = document.createElement('strong');
        const player = players(room).find((candidate) => candidate.id === outcome?.player_id);
        const displayName = String(outcome?.display_name || '').trim() || (player ? playerName(player) : 'Unknown soul');
        name.textContent = item.dataset.viewer === 'true' ? `${displayName} (you)` : displayName;
        const status = document.createElement('span');
        status.className = 'trivia-outcome-status';
        status.textContent = outcome?.answered === false ? `${copy.label} · no answer` : copy.label;
        body.append(name, status);

        item.append(glyph, body);
        const lives = livesElement(room, outcome?.lives_remaining);
        if (lives) {
            item.append(lives);
        }
        elements.revealList.append(item);
    });

    setImageSource(elements.revealImage, ELIMINATION_REVEAL_IMAGE);
    elements.reveal.style.setProperty('--reveal-duration', `${REVEAL_AUTO_DISMISS_MS}ms`);
    elements.revealCountdown.textContent = `Closes in ${Math.round(REVEAL_AUTO_DISMISS_MS / 1000)} seconds`;
    if (elements.reveal.hidden) {
        state.revealReturnFocus = document.activeElement;
    }
    elements.reveal.hidden = false;
    delete elements.reveal.dataset.open;
    // Force a reflow so the entrance animation and countdown bar restart.
    void elements.reveal.offsetWidth;
    elements.reveal.dataset.open = 'true';
    elements.revealDismiss.focus({ preventScroll: true });
    if (state.revealTimer !== null) {
        window.clearTimeout(state.revealTimer);
    }
    state.revealTimer = window.setTimeout(hideEliminationReveal, REVEAL_AUTO_DISMISS_MS);
};

const maybeShowEliminationReveal = (room) => {
    const round = room?.round;
    if (!round || roundType(room) !== 'killing_floor' || round.status !== 'resolved') {
        return;
    }
    const outcomes = Array.isArray(round.minigame?.results?.player_outcomes) ? round.minigame.results.player_outcomes : [];
    const roundId = String(round.id || '');
    if (outcomes.length === 0 || roundId === '' || hasSeenReveal(roundId)) {
        return;
    }
    markRevealSeen(roundId);
    showEliminationReveal(room, outcomes);
};

const renderHostControls = (room) => {
    const isHost = room?.viewer?.is_host === true;
    const roundStatus = room?.round?.status || '';
    const canStart = isHost && room?.status === 'waiting';
    const canResolve = isHost && room?.status === 'active' && roundStatus === 'answering';
    const canAdvance = isHost && room?.status === 'active' && roundStatus === 'resolved';
    const canReplay = isHost && room?.status === 'finished';

    elements.startButton.hidden = !canStart;
    elements.resolveButton.hidden = !canResolve;
    elements.advanceButton.hidden = !canAdvance;
    elements.replayButton.hidden = !canReplay;
    elements.hostActions.hidden = !canStart && !canResolve && !canAdvance && !canReplay;
    elements.startButton.disabled = !canStart || livingPlayers(room).length < 2 || state.isStarting;
    elements.resolveButton.disabled = !canResolve || state.isSubmitting;
    elements.advanceButton.disabled = !canAdvance || state.isSubmitting;
    elements.replayButton.disabled = !canReplay || state.isReplaying;
    elements.resolveButton.textContent = isTimerClosed(room) ? 'Reveal result' : 'Close answers now';
    elements.advanceButton.textContent = roundType(room) === 'ghost_race'
        ? 'Continue the race'
        : roundType(room) === 'killing_floor' ? 'Return upstairs' : 'Open next phase';
};

const handleReplay = async () => {
    if (!state.roomId || state.isReplaying) {
        return;
    }
    state.isReplaying = true;
    elements.replayButton.disabled = true;
    setMessage(elements.roundMessage, 'Preparing a fresh room with the same questions...', 'neutral');
    try {
        const room = await replayRoom(state.roomId);
        state.roomId = room.id;
        const url = new URL(window.location.href);
        url.searchParams.set('id', room.id);
        url.searchParams.delete('rejoin');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        storeApiRejoinLink(room?.rejoin_link);
        showRematchInvites(room?.created_links);
        state.isReplaying = false;
        renderRoom(room);
        setMessage(elements.rematchMessage, 'The rematch room is ready. These raw invites are shown only once.', 'success');
    } catch (error) {
        state.isReplaying = false;
        setMessage(elements.roundMessage, errorMessage(error, 'The rematch room could not be created.'), 'error');
        renderHostControls(state.room);
    }
};

const renderRoom = (room) => {
    const previousRoundId = state.room?.round?.id || '';
    state.room = room;
    const round = room?.round;
    const roomPlayers = players(room);
    const living = livingPlayers(room);
    const roomGhosts = ghosts(room);
    const viewer = viewerPlayer(room);
    const winner = roomPlayers.find((player) => player.id === room?.winner_player_id) || null;

    if ((round?.id || '') !== previousRoundId) {
        state.lockedRoundId = '';
        state.lockedAnswers = [];
        state.selectedAnswers = [];
    }

    elements.error.hidden = true;
    elements.summary.textContent = room.status === 'waiting'
        ? `Waiting for players: ${living.length}/${room.max_players} seats filled.`
        : room.status === 'finished'
            ? `${winner ? `${playerName(winner)} escaped` : 'Nobody escaped'} after ${room.current_round_number} rounds.`
            : roundType(room) === 'ghost_race'
                ? 'The last living player is racing every ghost for the body.'
                : `${living.length} living · ${roomGhosts.length} ghost${roomGhosts.length === 1 ? '' : 's'} · round ${round?.round_number || room.current_round_number || 1}.`;

    elements.roomStatus.textContent = room.status === 'waiting' ? 'Lobby' : room.status === 'finished' ? 'Finished' : 'Mansion live';
    elements.playerStatus.textContent = viewer
        ? viewer.id === room.winner_player_id ? 'Escaped' : viewer.id === room.body_holder_player_id ? 'Body holder' : viewer.is_ghost === true ? 'Ghost' : 'Alive'
        : 'Spectating';
    elements.answerStatus.textContent = room.status === 'finished'
        ? 'Final result'
        : viewerHasAnswered(room) || state.lockedRoundId === round?.id
            ? 'Answer locked'
            : round?.status === 'answering' ? (isTimerClosed(room) ? 'Time up' : 'Answering') : round?.status === 'resolved' ? 'Revealed' : 'Waiting';

    updateTimer(room);
    elements.roundLabel.textContent = round ? `Round ${round.round_number} · ${phasePresentation(room).label}` : 'Waiting room';
    elements.questionText.textContent = roundType(room) === 'killing_floor'
        ? String(round?.prompt_payload?.title || phasePresentation(room).title)
        : round?.prompt?.question || (room.status === 'waiting'
            ? 'Waiting for the host to start once at least two players are seated.'
            : 'No active prompt is available.');

    renderScene(room);
    renderExpression(room);
    renderMemoryPreview(room);
    renderChoices(room);
    renderResult(room);
    renderHostControls(room);
    renderViewerCard(room);
    renderRoster(room);
    renderRace(room);

    elements.metaPlayers.textContent = `${living.length} living · ${roomGhosts.length} ghosts`;
    elements.metaRound.textContent = round ? String(round.round_number) : '--';
    elements.metaPhase.textContent = phasePresentation(room).title;
    elements.metaAnswers.textContent = round?.answers
        ? round.answers.correct === null
            ? `${round.answers.submitted} locked`
            : `${round.answers.submitted} submitted · ${round.answers.correct} correct`
        : '--';
    elements.metaViewer.textContent = viewer
        ? `${playerName(viewer)} · ${viewer.id === room.body_holder_player_id ? 'body holder' : viewer.is_ghost ? 'ghost' : 'living'}`
        : 'Spectator';

    maybeShowEliminationReveal(room);
};

const restoreSeatFromUrl = async () => {
    const token = readRejoinToken();
    if (!token) {
        showStoredRejoinLink();
        return;
    }
    setMessage(elements.rejoinMessage, 'Restoring your trivia seat...', 'neutral');
    try {
        const room = await rejoinRoom(token, state.roomId);
        storeApiRejoinLink(room?.rejoin_link);
        cleanRejoinParam();
        setMessage(elements.rejoinMessage, 'Seat restored. Save this private link for later.', 'success');
    } catch (error) {
        setMessage(elements.rejoinMessage, errorMessage(error, 'That rejoin link could not be restored.'), 'error');
    }
};

const handleCopyRejoin = async () => {
    const value = elements.rejoinUrl.value;
    if (!value) {
        setMessage(elements.rejoinMessage, 'No rejoin link is saved for this browser yet.', 'error');
        return;
    }
    try {
        await copyWithFallback(value);
        elements.copyRejoinButton.textContent = 'Copied';
        setMessage(elements.rejoinMessage, 'Private rejoin link copied.', 'success');
    } catch {
        elements.rejoinUrl.focus({ preventScroll: true });
        elements.rejoinUrl.select();
        setMessage(elements.rejoinMessage, 'Copy failed. Select the link and copy it manually.', 'error');
    }
};

const refreshRoom = async () => {
    if (!state.roomId) {
        elements.error.hidden = false;
        elements.error.textContent = 'No trivia room id was provided. Open a room from the lobby.';
        elements.roomStatus.textContent = 'Not found';
        elements.questionText.textContent = 'Trivia room not found.';
        return;
    }
    if (state.isRefreshing) {
        return;
    }
    state.isRefreshing = true;
    try {
        renderRoom(await getRoom(state.roomId));
    } catch (error) {
        elements.error.hidden = false;
        elements.error.dataset.tone = 'error';
        elements.error.textContent = errorMessage(error, 'This trivia room was not found or is no longer available.');
        elements.roomStatus.textContent = 'Not found';
        elements.playerStatus.textContent = 'Spectating';
        elements.answerStatus.textContent = 'Unavailable';
        elements.timerValue.textContent = '--';
        elements.questionText.textContent = 'Trivia room not found.';
    } finally {
        state.isRefreshing = false;
    }
};

const handleStartRoom = async () => {
    if (!state.roomId || state.isStarting) {
        return;
    }
    state.isStarting = true;
    elements.startButton.disabled = true;
    setMessage(elements.roundMessage, 'Opening the first chamber...', 'neutral');
    try {
        state.lockedRoundId = '';
        state.lockedAnswers = [];
        state.selectedAnswers = [];
        const room = await startRoom(state.roomId);
        state.isStarting = false;
        renderRoom(room);
    } catch (error) {
        state.isStarting = false;
        setMessage(elements.roundMessage, errorMessage(error, 'The trivia game could not be started.'), 'error');
        renderHostControls(state.room);
    }
};

const submitCurrentAnswer = async (event) => {
    event.preventDefault();
    const round = state.room?.round;
    const allowsEmptySelection = roundType(state.room) === 'ghost_race';
    if (!round || (!allowsEmptySelection && state.selectedAnswers.length === 0) || state.isSubmitting || viewerHasAnswered(state.room)) {
        return;
    }
    const submittedRoundId = round.id;
    const submittedAnswers = [...state.selectedAnswers];
    state.isSubmitting = true;
    elements.submitButton.disabled = true;
    setMessage(elements.roundMessage, 'Locking your answer...', 'neutral');
    try {
        const room = await submitAnswer(
            state.roomId,
            answerPayloadForSelection(state.room, submittedAnswers, createUuid()),
        );
        state.isSubmitting = false;
        if (room?.round?.id === submittedRoundId) {
            state.lockedRoundId = submittedRoundId;
            state.lockedAnswers = submittedAnswers;
        } else {
            state.lockedRoundId = '';
            state.lockedAnswers = [];
            state.selectedAnswers = [];
        }
        renderRoom(room);
    } catch (error) {
        state.isSubmitting = false;
        setMessage(elements.roundMessage, errorMessage(error, 'Your answer could not be submitted. It may be late or already locked.'), 'error');
        renderHostControls(state.room);
    }
};

const handleRoundAction = async (action) => {
    if (!state.roomId || state.isSubmitting) {
        return;
    }
    state.isSubmitting = true;
    elements.resolveButton.disabled = true;
    elements.advanceButton.disabled = true;
    setMessage(elements.roundMessage, action === 'resolve' ? 'Asking the mansion for its verdict...' : 'Opening the next chamber...', 'neutral');
    try {
        const room = await advanceRound(state.roomId, action === 'resolve' ? { action, force: true } : { action });
        state.isSubmitting = false;
        if (action === 'advance') {
            state.lockedRoundId = '';
            state.lockedAnswers = [];
            state.selectedAnswers = [];
        }
        renderRoom(room);
    } catch (error) {
        state.isSubmitting = false;
        setMessage(elements.roundMessage, errorMessage(error, 'The round could not be advanced.'), 'error');
        renderHostControls(state.room);
    }
};

elements.answerForm.addEventListener('submit', submitCurrentAnswer);
elements.copyRejoinButton.addEventListener('click', handleCopyRejoin);
elements.startButton.addEventListener('click', handleStartRoom);
elements.resolveButton.addEventListener('click', () => handleRoundAction('resolve'));
elements.advanceButton.addEventListener('click', () => handleRoundAction('advance'));
elements.replayButton.addEventListener('click', handleReplay);
elements.undoOrderButton.addEventListener('click', handleUndoOrder);
elements.clearOrderButton.addEventListener('click', handleClearOrder);
elements.revealDismiss.addEventListener('click', hideEliminationReveal);
elements.revealBackdrop.addEventListener('click', hideEliminationReveal);
document.addEventListener('keydown', (event) => {
    if (elements.reveal.hidden) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        hideEliminationReveal();
    } else if (event.key === 'Tab') {
        event.preventDefault();
        elements.revealDismiss.focus({ preventScroll: true });
    }
});
attachImageFallback(elements.sceneImage);
attachImageFallback(elements.revealImage);

await restoreSeatFromUrl();
await refreshRoom();
state.pollTimer = window.setInterval(refreshRoom, 2500);
state.clockTimer = window.setInterval(() => {
    if (!state.room) {
        return;
    }
    const previousTimer = elements.timerValue.textContent;
    const timer = updateTimer(state.room);
    if (previousTimer !== '0' && timer === '0') {
        renderRoom(state.room);
    } else {
        renderHostControls(state.room);
    }
}, 1000);

window.addEventListener('pagehide', () => {
    window.clearInterval(state.pollTimer);
    window.clearInterval(state.clockTimer);
});

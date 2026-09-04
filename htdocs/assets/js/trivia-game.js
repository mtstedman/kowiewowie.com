import { TriviaApiError, advanceRound, getRoom, rejoinRoom, replayRoom, startRoom, submitAnswer } from './trivia-api.js';
import {
    answerPayloadForSelection,
    choicesForRound,
    correctAnswersForRound,
    minigameType,
    phasePresentation,
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
    choiceFieldset: requireElement('trivia-choice-fieldset'),
    choiceLegend: requireElement('trivia-choice-legend'),
    choiceGrid: requireElement('trivia-choice-grid'),
    submitButton: requireElement('trivia-submit-answer-button'),
    resultPanel: requireElement('trivia-result-panel'),
    scene: requireElement('trivia-scene'),
    sceneImage: requireElement('trivia-scene-image'),
    phaseLabel: requireElement('trivia-phase-label'),
    phaseTitle: requireElement('trivia-phase-title'),
    phaseInstructions: requireElement('trivia-phase-instructions'),
    memoryPreview: requireElement('trivia-memory-preview'),
    memorySymbols: requireElement('trivia-memory-symbols'),
    racePanel: requireElement('trivia-race-panel'),
    raceTrack: requireElement('trivia-race-track'),
    hostActions: requireElement('trivia-game-host-actions'),
    startButton: requireElement('trivia-start-game-button'),
    resolveButton: requireElement('trivia-resolve-round-button'),
    advanceButton: requireElement('trivia-advance-round-button'),
    replayButton: requireElement('trivia-replay-game-button'),
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
    rejoinUrl: requireElement('trivia-rejoin-url'),
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
};

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

const renderScene = (room) => {
    const presentation = phasePresentation(room);
    const promptImage = typeof room?.round?.image_url === 'string' ? room.round.image_url.trim() : '';
    const image = promptImage || presentation.image;
    elements.scene.dataset.phase = presentation.key;
    elements.phaseLabel.textContent = presentation.label;
    elements.phaseTitle.textContent = presentation.title;
    elements.phaseInstructions.textContent = presentation.instructions;
    if (state.phaseKey !== `${presentation.key}:${image}`) {
        elements.sceneImage.src = image;
        elements.sceneImage.alt = promptImage
            ? `Illustration for ${String(room?.round?.prompt?.question || presentation.title)}.`
            : presentation.alt;
        state.phaseKey = `${presentation.key}:${image}`;
    }
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
        const row = document.createElement('div');
        row.className = 'trivia-roster-row';
        row.dataset.status = player.status || 'active';
        row.dataset.bodyHolder = String(player.id === room.body_holder_player_id);

        const seat = document.createElement('span');
        seat.className = 'trivia-seat-number';
        seat.textContent = player.is_ghost === true ? 'G' : String(player.seat_number ?? '?');

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
        row.append(seat, name, meta);
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
            const row = document.createElement('div');
            row.className = 'trivia-racer';
            row.dataset.bodyHolder = String(player.id === room.body_holder_player_id);

            const name = document.createElement('span');
            name.className = 'trivia-racer-name';
            name.textContent = `${player.id === room.body_holder_player_id ? 'Body' : 'Ghost'} · ${playerName(player)}`;

            const meter = document.createElement('span');
            meter.className = 'trivia-racer-meter';
            meter.setAttribute('role', 'progressbar');
            meter.setAttribute('aria-label', `${playerName(player)} race position`);
            meter.setAttribute('aria-valuemin', '0');
            meter.setAttribute('aria-valuemax', String(goal));
            meter.setAttribute('aria-valuenow', String(Math.min(goal, position)));
            const fill = document.createElement('span');
            fill.style.setProperty('--race-progress', `${Math.min(100, (position / goal) * 100)}%`);
            meter.append(fill);

            const score = document.createElement('span');
            score.className = 'trivia-racer-score';
            score.textContent = `${position}/${goal}`;
            row.append(name, meter, score);
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
    if (minigameType(room) === 'memory_match') {
        return 'Select every remembered symbol';
    }
    if (minigameType(room) === 'key_lock') {
        return 'Choose one key';
    }
    if (roundType(room) === 'ghost_race' || selectionMode(room) === 'multiple') {
        return 'Select every correct answer';
    }
    return 'Choose an answer';
};

const renderRoundMessage = (room, canAnswer, locked) => {
    const viewer = viewerPlayer(room);
    const closed = isTimerClosed(room);
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
    } else if (minigameType(room) === 'memory_match' && Array.isArray(room?.round?.minigame?.preview) && room.round.minigame.preview.length > 0) {
        setMessage(elements.roundMessage, 'Memorize the glowing symbols. Your choices appear when the flash ends.', 'neutral');
    } else if (canAnswer) {
        setMessage(elements.roundMessage, room?.viewer?.is_ghost ? 'Ghosts still get a vote. Make it count.' : 'Choose before the timer reaches zero.', 'neutral');
    } else {
        setMessage(elements.roundMessage, 'Watch this round—the mansion did not select you to answer.', 'neutral');
    }
};

const renderMemoryPreview = (room) => {
    const preview = Array.isArray(room?.round?.minigame?.preview) ? room.round.minigame.preview : [];
    elements.memoryPreview.hidden = preview.length === 0;
    elements.memorySymbols.replaceChildren();
    preview.forEach((symbol) => {
        const item = document.createElement('strong');
        item.textContent = String(symbol);
        elements.memorySymbols.append(item);
    });
};

const renderChoices = (room) => {
    const round = room?.round;
    const choices = choicesForRound(room);
    const mode = selectionMode(room);
    const locked = state.lockedRoundId === round?.id || viewerHasAnswered(room);
    const memoryPreviewActive = minigameType(room) === 'memory_match'
        && Array.isArray(round?.minigame?.preview)
        && round.minigame.preview.length > 0;
    const canAnswer = viewerCanAnswer(room) && !locked && !isTimerClosed(room) && !memoryPreviewActive;
    const selected = currentSelection(room);
    const correct = new Set(correctAnswersForRound(room));

    elements.choiceGrid.replaceChildren();
    elements.answerForm.hidden = !round || room?.status === 'waiting' || room?.status === 'finished' || choices.length === 0;
    elements.choiceLegend.textContent = answerLegend(room);

    choices.forEach((choice, index) => {
        const id = `trivia-choice-${index}`;
        const label = document.createElement('label');
        label.className = 'trivia-choice';
        if (correct.has(choice)) {
            label.dataset.correct = 'true';
        }

        const input = document.createElement('input');
        input.type = mode === 'multiple' ? 'checkbox' : 'radio';
        input.name = mode === 'multiple' ? 'trivia-answer[]' : 'trivia-answer';
        input.id = id;
        input.value = choice;
        input.disabled = !canAnswer;
        input.checked = selected.includes(choice);
        input.addEventListener('change', () => {
            if (mode === 'multiple') {
                state.selectedAnswers = input.checked
                    ? [...state.selectedAnswers, choice].filter((value, choiceIndex, values) => values.indexOf(value) === choiceIndex)
                    : state.selectedAnswers.filter((value) => value !== choice);
            } else {
                state.selectedAnswers = [choice];
            }
            elements.submitButton.disabled = state.selectedAnswers.length === 0 || state.isSubmitting;
            elements.submitButton.textContent = mode === 'multiple' && state.selectedAnswers.length > 0
                ? `Lock ${state.selectedAnswers.length} answer${state.selectedAnswers.length === 1 ? '' : 's'}`
                : 'Lock answer';
        });

        const text = document.createElement('span');
        text.textContent = choice;
        label.append(input, text);
        elements.choiceGrid.append(label);
    });

    elements.choiceFieldset.disabled = !canAnswer;
    elements.submitButton.disabled = !canAnswer || state.selectedAnswers.length === 0 || state.isSubmitting;
    elements.submitButton.textContent = mode === 'multiple' && state.selectedAnswers.length > 0
        ? `Lock ${state.selectedAnswers.length} answer${state.selectedAnswers.length === 1 ? '' : 's'}`
        : 'Lock answer';
    renderRoundMessage(room, canAnswer, locked);
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
    if (correct.length > 0) {
        appendResultLine(correct.length === 1 ? 'Correct answer' : 'Correct answers', correct.join(', '));
    }
    if (roundType(room) === 'trivia' && round.prompt?.explanation) {
        const explanation = document.createElement('p');
        explanation.textContent = round.prompt.explanation;
        elements.resultPanel.append(explanation);
    }
    if (roundType(room) === 'killing_floor') {
        const results = round.minigame?.results || {};
        const ghosted = players(room).filter((player) => Array.isArray(results.ghosted_player_ids) && results.ghosted_player_ids.includes(player.id));
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
    const timer = formatTimer(room);

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

    elements.timerValue.textContent = timer;
    elements.timer.dataset.urgent = String(timer !== '--' && Number(timer) <= 5);
    elements.roundLabel.textContent = round ? `Round ${round.round_number} · ${phasePresentation(room).label}` : 'Waiting room';
    elements.questionText.textContent = roundType(room) === 'killing_floor'
        ? String(round?.prompt_payload?.title || phasePresentation(room).title)
        : round?.prompt?.question || (room.status === 'waiting'
            ? 'Waiting for the host to start once at least two players are seated.'
            : 'No active prompt is available.');

    renderScene(room);
    renderMemoryPreview(room);
    renderChoices(room);
    renderResult(room);
    renderHostControls(room);
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
    if (!round || state.selectedAnswers.length === 0 || state.isSubmitting || viewerHasAnswered(state.room)) {
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

await restoreSeatFromUrl();
await refreshRoom();
state.pollTimer = window.setInterval(refreshRoom, 2500);
state.clockTimer = window.setInterval(() => {
    if (!state.room) {
        return;
    }
    const previousTimer = elements.timerValue.textContent;
    const timer = formatTimer(state.room);
    elements.timerValue.textContent = timer;
    elements.timer.dataset.urgent = String(timer !== '--' && Number(timer) <= 5);
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

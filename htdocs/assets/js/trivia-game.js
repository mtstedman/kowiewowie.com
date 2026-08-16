import { TriviaApiError, advanceRound, getRoom, submitAnswer } from './trivia-api.js';

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
    timerValue: requireElement('trivia-timer-value'),
    roundLabel: requireElement('trivia-round-label'),
    questionText: requireElement('trivia-question-text'),
    roundMessage: requireElement('trivia-round-message'),
    answerForm: requireElement('trivia-answer-form'),
    choiceFieldset: requireElement('trivia-choice-fieldset'),
    choiceGrid: requireElement('trivia-choice-grid'),
    submitButton: requireElement('trivia-submit-answer-button'),
    resultPanel: requireElement('trivia-result-panel'),
    hostActions: requireElement('trivia-game-host-actions'),
    resolveButton: requireElement('trivia-resolve-round-button'),
    advanceButton: requireElement('trivia-advance-round-button'),
    roster: requireElement('trivia-game-roster'),
    metaPlayers: requireElement('trivia-meta-players'),
    metaRound: requireElement('trivia-meta-round'),
    metaAnswers: requireElement('trivia-meta-answers'),
    metaViewer: requireElement('trivia-meta-viewer'),
};

const state = {
    roomId: new URLSearchParams(window.location.search).get('id') || '',
    room: null,
    selectedAnswer: '',
    lockedRoundId: '',
    lockedAnswer: '',
    pollTimer: null,
    clockTimer: null,
    isSubmitting: false,
};

const setMessage = (element, message = '', tone = '') => {
    element.textContent = message;
    element.dataset.tone = tone;
};

const errorMessage = (error, fallback) => {
    if (error instanceof TriviaApiError && typeof error.message === 'string' && error.message !== '') {
        return error.message;
    }

    return fallback;
};

const activePlayers = (room) => (Array.isArray(room?.players) ? room.players : [])
    .filter((player) => player.status === 'active');

const viewerPlayer = (room) => {
    const viewerId = room?.viewer?.player_id;
    return Array.isArray(room?.players) ? room.players.find((player) => player.id === viewerId) || null : null;
};

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

const renderRoster = (room) => {
    const players = Array.isArray(room?.players) ? room.players : [];
    elements.roster.replaceChildren();

    if (players.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'lede trivia-state-message';
        empty.textContent = 'No players are seated in this room.';
        elements.roster.append(empty);
        return;
    }

    players.forEach((player) => {
        const row = document.createElement('div');
        row.className = 'trivia-roster-row';
        row.dataset.status = player.status || 'active';

        const seat = document.createElement('span');
        seat.className = 'trivia-seat-number';
        seat.textContent = String(player.seat_number ?? '?');

        const name = document.createElement('strong');
        const displayName = typeof player.display_name === 'string' && player.display_name.trim() !== ''
            ? player.display_name.trim()
            : `Seat ${player.seat_number ?? '?'}`;
        name.textContent = player.viewer_controls_player ? `${displayName} (you)` : displayName;

        const meta = document.createElement('span');
        meta.className = 'trivia-roster-meta';
        if (player.id === room.winner_player_id) {
            meta.textContent = 'Winner';
        } else if (player.status === 'eliminated') {
            meta.textContent = 'Eliminated';
        } else if (player.role === 'host') {
            meta.textContent = 'Host alive';
        } else {
            meta.textContent = 'Alive';
        }

        row.append(seat, name, meta);
        elements.roster.append(row);
    });
};

const renderChoices = (room) => {
    const round = room?.round;
    const choices = Array.isArray(round?.prompt?.choices) ? round.prompt.choices : [];
    const viewer = viewerPlayer(room);
    const isAlive = Boolean(room?.viewer?.is_active);
    const isAnswering = room?.status === 'active' && round?.status === 'answering';
    const secondsLeft = Number.parseInt(formatTimer(room), 10);
    const locked = state.lockedRoundId === round?.id;
    const canAnswer = isAnswering && isAlive && !locked && Number.isFinite(secondsLeft) && secondsLeft > 0;

    elements.choiceGrid.replaceChildren();
    state.selectedAnswer = canAnswer ? state.selectedAnswer : '';

    choices.forEach((choice, index) => {
        const id = `trivia-choice-${index}`;
        const label = document.createElement('label');
        label.className = 'trivia-choice';
        if (round?.prompt?.correct_answer === choice) {
            label.dataset.correct = 'true';
        }

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'trivia-answer';
        input.id = id;
        input.value = choice;
        input.disabled = !canAnswer;
        input.checked = state.selectedAnswer === choice || state.lockedAnswer === choice;
        input.addEventListener('change', () => {
            state.selectedAnswer = choice;
            elements.submitButton.disabled = !canAnswer;
        });

        const text = document.createElement('span');
        text.textContent = choice;

        label.append(input, text);
        elements.choiceGrid.append(label);
    });

    elements.choiceFieldset.disabled = !canAnswer;
    elements.submitButton.disabled = !canAnswer || state.selectedAnswer === '' || state.isSubmitting;

    if (!viewer && room?.status !== 'finished') {
        setMessage(elements.roundMessage, 'You are spectating this room. Claim the shared link in the lobby to play.', 'neutral');
    } else if (!isAlive && room?.status === 'active') {
        setMessage(elements.roundMessage, 'You have been eliminated. You can keep watching the survivors.', 'error');
    } else if (locked) {
        setMessage(elements.roundMessage, `Answer locked: ${state.lockedAnswer}. Waiting for the round to resolve.`, 'success');
    } else if (isAnswering && !canAnswer && isAlive) {
        setMessage(elements.roundMessage, 'The timer closed before an answer was locked.', 'error');
    }
};

const renderResult = (room) => {
    const round = room?.round;
    elements.resultPanel.replaceChildren();

    if (!round || (round.status !== 'resolved' && room.status !== 'finished')) {
        elements.resultPanel.hidden = true;
        return;
    }

    const title = document.createElement('h3');
    title.textContent = room.status === 'finished' ? 'Game finished' : 'Round resolved';

    const answer = document.createElement('p');
    answer.innerHTML = '';
    answer.append('Correct answer: ');
    const strong = document.createElement('strong');
    strong.textContent = round.prompt?.correct_answer || 'Unavailable';
    answer.append(strong);

    const explanation = document.createElement('p');
    explanation.textContent = round.prompt?.explanation || 'No explanation was provided for this prompt.';

    elements.resultPanel.append(title, answer, explanation);
    elements.resultPanel.hidden = false;
};

const renderHostControls = (room) => {
    const isHost = Boolean(room?.viewer?.is_host);
    const roundStatus = room?.round?.status || '';
    elements.hostActions.hidden = !isHost || room?.status === 'finished';
    elements.resolveButton.disabled = !isHost || room?.status !== 'active' || roundStatus !== 'answering';
    elements.advanceButton.disabled = !isHost || room?.status !== 'active' || (roundStatus !== 'resolved' && roundStatus !== 'answering');
};

const renderRoom = (room) => {
    state.room = room;
    const round = room?.round;
    const players = Array.isArray(room?.players) ? room.players : [];
    const alive = activePlayers(room);
    const viewer = viewerPlayer(room);
    const winner = players.find((player) => player.id === room?.winner_player_id) || null;

    elements.error.hidden = true;
    elements.summary.textContent = room.status === 'waiting'
        ? `Waiting for players: ${alive.length}/${room.max_players} seats filled.`
        : room.status === 'finished'
            ? `Finished${winner ? ` with ${winner.display_name} as winner` : ''}.`
            : `Round ${round?.round_number || room.current_round_number || 1} is live.`;

    elements.roomStatus.textContent = room.status === 'waiting' ? 'Waiting' : room.status === 'finished' ? 'Finished' : 'Active';
    elements.playerStatus.textContent = viewer ? (viewer.status === 'active' ? 'Alive' : 'Eliminated') : 'Spectating';
    elements.answerStatus.textContent = state.lockedRoundId === round?.id
        ? 'Answer locked'
        : round?.status === 'answering' ? 'Answering' : round?.status === 'resolved' ? 'Resolved' : 'Waiting';

    elements.timerValue.textContent = formatTimer(room);
    elements.roundLabel.textContent = round ? `Round ${round.round_number}` : 'Waiting room';
    elements.questionText.textContent = round?.prompt?.question || (room.status === 'waiting'
        ? 'Waiting for the host to start once at least two players are seated.'
        : 'No active prompt is available.');

    if (room.status === 'waiting') {
        const needed = Math.max(0, 2 - alive.length);
        setMessage(elements.roundMessage, needed > 0 ? `Waiting for ${needed} more player${needed === 1 ? '' : 's'}.` : 'Ready for the host to start.', 'neutral');
    } else if (room.status === 'finished') {
        setMessage(elements.roundMessage, winner ? `${winner.display_name} survived the table.` : 'The trivia game finished with no single survivor.', 'success');
    } else if (round?.status === 'answering') {
        setMessage(elements.roundMessage, 'Choose before the timer closes. Wrong answers eliminate immediately.', 'neutral');
    } else if (round?.status === 'resolved') {
        setMessage(elements.roundMessage, 'Round resolved. The host can open the next prompt.', 'success');
    }

    renderChoices(room);
    renderResult(room);
    renderHostControls(room);
    renderRoster(room);

    elements.metaPlayers.textContent = `${alive.length}/${room.max_players} alive`;
    elements.metaRound.textContent = round ? String(round.round_number) : '--';
    elements.metaAnswers.textContent = round?.answers ? `${round.answers.submitted} submitted, ${round.answers.correct} correct` : '--';
    elements.metaViewer.textContent = viewer ? `${viewer.display_name}, ${viewer.status}` : 'Spectator';
};

const refreshRoom = async () => {
    if (state.roomId === '') {
        elements.error.hidden = false;
        elements.error.textContent = 'No trivia room id was provided. Open a room from the lobby.';
        elements.roomStatus.textContent = 'Not found';
        elements.questionText.textContent = 'Trivia room not found.';
        return;
    }

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
    }
};

const submitCurrentAnswer = async (event) => {
    event.preventDefault();
    const round = state.room?.round;
    if (!round || state.selectedAnswer === '' || state.isSubmitting) {
        return;
    }

    state.isSubmitting = true;
    elements.submitButton.disabled = true;
    setMessage(elements.roundMessage, 'Locking answer...', 'neutral');

    try {
        const room = await submitAnswer(state.roomId, {
            answer: state.selectedAnswer,
            client_answer_id: createUuid(),
        });
        state.lockedRoundId = round.id;
        state.lockedAnswer = state.selectedAnswer;
        renderRoom(room);
    } catch (error) {
        setMessage(elements.roundMessage, errorMessage(error, 'Your answer could not be submitted. It may be late or already locked.'), 'error');
    } finally {
        state.isSubmitting = false;
    }
};

const handleRoundAction = async (action) => {
    if (state.roomId === '') {
        return;
    }

    elements.resolveButton.disabled = true;
    elements.advanceButton.disabled = true;
    setMessage(elements.roundMessage, action === 'resolve' ? 'Resolving the round...' : 'Opening the next round...', 'neutral');

    try {
        const room = await advanceRound(state.roomId, { action, force: true });
        if (action === 'advance') {
            state.lockedRoundId = '';
            state.lockedAnswer = '';
            state.selectedAnswer = '';
        }
        renderRoom(room);
    } catch (error) {
        setMessage(elements.roundMessage, errorMessage(error, 'The round could not be advanced.'), 'error');
        renderHostControls(state.room);
    }
};

elements.answerForm.addEventListener('submit', submitCurrentAnswer);
elements.resolveButton.addEventListener('click', () => handleRoundAction('resolve'));
elements.advanceButton.addEventListener('click', () => handleRoundAction('advance'));

await refreshRoom();
state.pollTimer = window.setInterval(refreshRoom, 4000);
state.clockTimer = window.setInterval(() => {
    if (state.room) {
        elements.timerValue.textContent = formatTimer(state.room);
        renderHostControls(state.room);
    }
}, 1000);

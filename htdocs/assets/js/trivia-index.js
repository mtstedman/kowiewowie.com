import { TriviaApiError, claimLink, createJoinLink, createRoom, getRoom, listRooms, startRoom } from './trivia-api.js';

const requireElement = (id) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing trivia lobby element: ${id}`);
    }
    return element;
};

const elements = {
    form: requireElement('trivia-new-room-form'),
    maxPlayers: requireElement('trivia-max-players'),
    answerWindow: requireElement('trivia-answer-window'),
    newRoomButton: requireElement('trivia-new-room-button'),
    linkBox: requireElement('trivia-link-box'),
    joinUrl: requireElement('trivia-join-url'),
    copyButton: requireElement('trivia-copy-link-button'),
    openGameLink: requireElement('trivia-open-game-link'),
    inviteList: requireElement('trivia-invite-list'),
    createMessage: requireElement('trivia-create-message'),
    joinMessage: requireElement('trivia-join-message'),
    roomSummary: requireElement('trivia-room-summary'),
    roster: requireElement('trivia-roster'),
    hostActions: requireElement('trivia-host-actions'),
    startButton: requireElement('trivia-start-button'),
    hostGameLink: requireElement('trivia-host-game-link'),
    rosterMessage: requireElement('trivia-roster-message'),
    roomList: requireElement('trivia-room-list'),
};

const state = {
    currentRoom: null,
    joinUrl: '',
    pollTimer: null,
};

const roomHref = (roomId) => `/trivia/game.php?id=${encodeURIComponent(roomId)}`;

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

const normalizeRooms = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    return [];
};

const tokenFromLink = (link) => {
    if (typeof link?.token === 'string' && link.token !== '') {
        return link.token;
    }

    if (typeof link?.url === 'string' && link.url !== '') {
        const url = new URL(link.url, window.location.origin);
        return url.searchParams.get('join') || url.searchParams.get('token') || '';
    }

    return '';
};

const linkUrlFromToken = (token) => {
    const url = new URL('/trivia/', window.location.origin);
    url.searchParams.set('join', token);
    return url.toString();
};

const copyWithFallback = async (text) => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    elements.joinUrl.focus({ preventScroll: true });
    elements.joinUrl.select();
    document.execCommand('copy');
};

const playerLabel = (player) => {
    const name = typeof player?.display_name === 'string' && player.display_name.trim() !== ''
        ? player.display_name.trim()
        : `Seat ${player?.seat_number ?? '?'}`;
    return player?.viewer_controls_player ? `${name} (you)` : name;
};

const activePlayers = (room) => (Array.isArray(room?.players) ? room.players : [])
    .filter((player) => player.status === 'active');

const renderRoster = (room) => {
    const players = Array.isArray(room?.players) ? room.players : [];
    elements.roster.replaceChildren();

    if (players.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'lede trivia-state-message';
        empty.textContent = 'No seats have been claimed yet.';
        elements.roster.append(empty);
        return;
    }

    players.forEach((player) => {
        const row = document.createElement('div');
        row.className = 'trivia-roster-row';
        row.dataset.status = player.status || 'waiting';

        const seat = document.createElement('span');
        seat.className = 'trivia-seat-number';
        seat.textContent = String(player.seat_number ?? '?');

        const name = document.createElement('strong');
        name.textContent = playerLabel(player);

        const meta = document.createElement('span');
        meta.className = 'trivia-roster-meta';
        meta.textContent = player.role === 'host' ? 'Host' : player.status === 'active' ? 'Ready' : 'Eliminated';

        row.append(seat, name, meta);
        elements.roster.append(row);
    });
};

const renderCurrentRoom = (room) => {
    state.currentRoom = room;
    const players = activePlayers(room);
    const needed = Math.max(0, 2 - players.length);
    const isHost = Boolean(room?.viewer?.is_host);
    const gameUrl = roomHref(room.id);

    elements.roomSummary.innerHTML = '';
    const summary = document.createElement('p');
    summary.className = 'lede trivia-state-message';

    if (room.status === 'waiting') {
        summary.textContent = needed > 0
            ? `Waiting for ${needed} more player${needed === 1 ? '' : 's'} before the host can start.`
            : `${players.length} players are seated. The host can start whenever ready.`;
    } else if (room.status === 'active') {
        summary.textContent = 'This room is live. Open the game page to answer the current prompt.';
    } else if (room.status === 'finished') {
        summary.textContent = 'This room has already finished.';
    } else {
        summary.textContent = 'Room state loaded.';
    }

    elements.roomSummary.append(summary);
    renderRoster(room);

    elements.hostActions.hidden = !isHost;
    elements.startButton.disabled = room.status !== 'waiting' || players.length < 2;
    elements.hostGameLink.href = gameUrl;
    elements.openGameLink.href = gameUrl;
    elements.openGameLink.hidden = false;
    setMessage(elements.rosterMessage, isHost ? 'You are hosting this trivia room.' : 'You have claimed a seat in this room.', 'neutral');
};

const refreshCurrentRoom = async () => {
    if (!state.currentRoom?.id) {
        return;
    }

    try {
        renderCurrentRoom(await getRoom(state.currentRoom.id));
    } catch (error) {
        setMessage(elements.rosterMessage, errorMessage(error, 'This trivia room could not be refreshed.'), 'error');
    }
};

const scheduleRoomPolling = () => {
    if (state.pollTimer !== null) {
        window.clearInterval(state.pollTimer);
    }

    state.pollTimer = window.setInterval(refreshCurrentRoom, 5000);
};

const showJoinLink = (url, roomId) => {
    state.joinUrl = url;
    elements.joinUrl.value = url;
    elements.copyButton.textContent = 'Copy link';
    elements.linkBox.hidden = false;
    elements.openGameLink.href = roomHref(roomId);
    elements.openGameLink.hidden = false;
    elements.joinUrl.focus({ preventScroll: true });
    elements.joinUrl.select();
};

const linkUrlFromApiLink = (link) => {
    const token = tokenFromLink(link);
    return token !== '' ? linkUrlFromToken(token) : new URL(link?.url || '/trivia/', window.location.origin).toString();
};

const openSeatNumbers = (room) => {
    const used = new Set((Array.isArray(room?.players) ? room.players : []).map((player) => Number(player.seat_number)));
    const seats = [];
    for (let seat = 1; seat <= Number(room?.max_players || 0); seat += 1) {
        if (!used.has(seat)) {
            seats.push(seat);
        }
    }
    return seats;
};

const showInviteLinks = (links, room) => {
    const urls = links.map(linkUrlFromApiLink).filter((url) => url !== '');
    const seats = openSeatNumbers(room);
    elements.inviteList.replaceChildren();
    elements.inviteList.hidden = urls.length === 0;

    urls.forEach((url, index) => {
        const card = document.createElement('article');
        card.className = 'trivia-invite-card';

        const title = document.createElement('h3');
        title.textContent = `Seat ${seats[index] ?? index + 2} invite`;

        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.value = url;
        input.setAttribute('aria-label', title.textContent);

        const button = document.createElement('button');
        button.className = 'trivia-button';
        button.type = 'button';
        button.textContent = 'Copy';
        button.addEventListener('click', async () => {
            const previousJoinUrl = elements.joinUrl.value;
            try {
                elements.joinUrl.value = url;
                await copyWithFallback(url);
                button.textContent = 'Copied';
                setMessage(elements.createMessage, `${title.textContent} copied.`, 'success');
            } catch (error) {
                setMessage(elements.createMessage, 'Copy failed. Select the invite link and copy it manually.', 'error');
            } finally {
                elements.joinUrl.value = previousJoinUrl;
            }
        });

        card.append(title, input, button);
        elements.inviteList.append(card);
    });
};

const renderRoomList = (rooms) => {
    elements.roomList.replaceChildren();

    if (rooms.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'lede trivia-state-message';
        empty.textContent = 'No browser-tied trivia rooms yet.';
        elements.roomList.append(empty);
        return;
    }

    rooms.forEach((room) => {
        const card = document.createElement('article');
        card.className = 'trivia-room-card';

        const title = document.createElement('h3');
        title.textContent = room.status === 'finished' ? 'Finished trivia room' : 'Trivia room';

        const details = document.createElement('p');
        const playerCount = Array.isArray(room.players) ? room.players.length : 0;
        details.textContent = `${playerCount}/${room.max_players} players, round ${room.current_round_number || 0}, ${room.status}`;

        const link = document.createElement('a');
        link.className = 'trivia-text-link';
        link.href = roomHref(room.id);
        link.textContent = room.status === 'waiting' ? 'Open lobby state' : 'Open game';

        card.append(title, details, link);
        elements.roomList.append(card);
    });
};

const refreshRooms = async () => {
    try {
        const payload = await listRooms({ limit: 20 });
        renderRoomList(normalizeRooms(payload));
    } catch (error) {
        const message = document.createElement('p');
        message.className = 'lede trivia-state-message trivia-state-message-error';
        message.textContent = errorMessage(error, 'Your trivia rooms could not be loaded.');
        elements.roomList.replaceChildren(message);
    }
};

const handleCreateRoom = async (event) => {
    event.preventDefault();
    setMessage(elements.createMessage, 'Creating trivia room...', 'neutral');
    elements.newRoomButton.disabled = true;
    elements.form.setAttribute('aria-busy', 'true');
    elements.linkBox.hidden = true;
    elements.inviteList.replaceChildren();
    elements.inviteList.hidden = true;

    try {
        const room = await createRoom({
            max_players: Number.parseInt(elements.maxPlayers.value, 10),
            answer_window_seconds: Number.parseInt(elements.answerWindow.value, 10),
            create_link: true,
        });
        const createdLinks = Array.isArray(room.created_links) ? [...room.created_links] : [];
        const inviteCount = Math.max(1, Number(room.max_players || 2) - activePlayers(room).length);
        while (createdLinks.length < inviteCount) {
            createdLinks.push(await createJoinLink(room.id, {}));
        }
        showJoinLink(linkUrlFromApiLink(createdLinks[0]), room.id);
        showInviteLinks(createdLinks, room);
        renderCurrentRoom(room);
        scheduleRoomPolling();
        setMessage(elements.createMessage, 'Room created. Copy one invite link for each remaining seat.', 'success');
        await refreshRooms();
    } catch (error) {
        setMessage(elements.createMessage, errorMessage(error, 'The trivia room could not be created.'), 'error');
    } finally {
        elements.newRoomButton.disabled = false;
        elements.form.removeAttribute('aria-busy');
    }
};

const handleCopy = async () => {
    if (state.joinUrl === '') {
        setMessage(elements.createMessage, 'Create a room before copying an invite.', 'error');
        return;
    }

    try {
        await copyWithFallback(state.joinUrl);
        elements.copyButton.textContent = 'Copied';
        setMessage(elements.createMessage, 'Join link copied.', 'success');
    } catch (error) {
        setMessage(elements.createMessage, 'Copy failed. Select the join link and copy it manually.', 'error');
    }
};

const handleStart = async () => {
    if (!state.currentRoom?.id) {
        return;
    }

    elements.startButton.disabled = true;
    setMessage(elements.rosterMessage, 'Starting the trivia game...', 'neutral');

    try {
        const room = await startRoom(state.currentRoom.id);
        renderCurrentRoom(room);
        window.location.assign(roomHref(room.id));
    } catch (error) {
        setMessage(elements.rosterMessage, errorMessage(error, 'The trivia game could not be started.'), 'error');
        elements.startButton.disabled = false;
    }
};

const claimJoinToken = async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join') || params.get('claim') || params.get('token') || '';
    if (token === '') {
        return;
    }

    elements.joinMessage.hidden = false;
    elements.joinMessage.dataset.tone = 'neutral';
    elements.joinMessage.textContent = 'Claiming trivia invite...';

    try {
        const room = await claimLink(token);
        elements.joinMessage.dataset.tone = 'success';
        elements.joinMessage.textContent = room.status === 'finished'
            ? 'You joined the room, but this trivia game has already finished.'
            : 'Seat claimed. Opening the live trivia room...';
        renderCurrentRoom(room);
        scheduleRoomPolling();
        await refreshRooms();
        window.history.replaceState({}, '', '/trivia/');
        window.setTimeout(() => window.location.assign(roomHref(room.id)), 700);
    } catch (error) {
        elements.joinMessage.dataset.tone = 'error';
        elements.joinMessage.textContent = errorMessage(error, 'This trivia invite is invalid, expired, or the room is full.');
    }
};

elements.form.addEventListener('submit', handleCreateRoom);
elements.copyButton.addEventListener('click', handleCopy);
elements.startButton.addEventListener('click', handleStart);

await refreshRooms();
await claimJoinToken();

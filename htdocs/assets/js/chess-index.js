import { claimLink, createChallengeLink, createGame, getProfile, listGames, updateProfile } from './chess-api.js';

const elements = {
    gamesList: document.getElementById('chess-games-list'),
    newGameForm: document.getElementById('chess-new-game-form'),
    gameMode: document.getElementById('chess-game-mode'),
    creatorColor: document.getElementById('chess-creator-color'),
    newGameButton: document.getElementById('chess-new-game-button'),
    createMessage: document.getElementById('chess-create-message'),
    linkBox: document.getElementById('chess-link-box'),
    joinUrl: document.getElementById('chess-join-url'),
    copyLinkButton: document.getElementById('chess-copy-link-button'),
    openGameLink: document.getElementById('chess-open-game-link'),
    profileForm: document.getElementById('chess-profile-form'),
    displayName: document.getElementById('chess-display-name'),
    saveNameButton: document.getElementById('chess-save-name-button'),
    currentName: document.getElementById('chess-current-name'),
    profileMessage: document.getElementById('chess-profile-message'),
    joinMessage: document.getElementById('chess-join-message'),
};

const state = {
    games: [],
    displayName: '',
};

const copyWithFallback = (text) => {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';

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

const titleCase = (value) => {
    const normalized = String(value || '').replace(/[_-]+/g, ' ').trim();
    return normalized === '' ? 'Unknown' : normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const oppositeColor = (color) => (color === 'black' ? 'white' : 'black');

const gameHref = (gameId) => `/chess/game.php?id=${encodeURIComponent(gameId)}`;

const normalizeGames = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    return [];
};

const viewerPlayer = (game) => {
    if (!Array.isArray(game?.players)) {
        return null;
    }

    return game.players.find((player) => player?.viewer_controls_seat === true) || null;
};

const deriveDisplayName = (games) => {
    for (const game of games) {
        const player = viewerPlayer(game);
        const name = typeof player?.display_name === 'string' ? player.display_name.trim() : '';
        if (name !== '') {
            return name;
        }
    }

    return '';
};

const setDisplayName = (name) => {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (normalized !== '') {
        state.displayName = normalized;
    }

    const visibleName = state.displayName || 'Guest player';
    elements.currentName.textContent = visibleName;
    elements.displayName.placeholder = visibleName;
};

const seedProfileName = async () => {
    try {
        const profile = await getProfile();
        const displayName = typeof profile?.display_name === 'string' ? profile.display_name : '';
        setDisplayName(displayName);
    } catch (error) {
        // Keep the games-derived name as the fallback when profile lookup is unavailable.
    }
};

const renderEmpty = () => {
    const paragraph = document.createElement('p');
    paragraph.className = 'lede';
    paragraph.textContent = 'No chess games are tied to this browser yet.';
    elements.gamesList.replaceChildren(paragraph);
};

const renderGames = (games) => {
    elements.gamesList.replaceChildren();

    if (games.length === 0) {
        renderEmpty();
        return;
    }

    const list = document.createElement('div');
    list.className = 'chess-game-grid';

    games.forEach((game) => {
        const gameId = typeof game?.id === 'string' ? game.id : '';
        const players = Array.isArray(game?.players) ? game.players : [];
        const white = players.find((player) => player?.color === 'white');
        const black = players.find((player) => player?.color === 'black');
        const viewer = viewerPlayer(game);

        const article = document.createElement('article');
        article.className = 'chess-game-card';

        const label = document.createElement('span');
        label.className = 'chess-kicker';
        label.textContent = `${titleCase(game?.status)} · ${titleCase(game?.variant)}`;
        article.append(label);

        const heading = document.createElement('h3');
        heading.textContent = `${white?.display_name || 'White'} vs ${black?.display_name || 'Black'}`;
        article.append(heading);

        const meta = document.createElement('dl');
        meta.className = 'chess-game-meta';
        [
            ['You', viewer?.color ? titleCase(viewer.color) : 'Spectator'],
            ['Turn', titleCase(game?.position?.side_to_move)],
            ['Ply', Number.isInteger(game?.current_ply) ? String(game.current_ply) : '0'],
        ].forEach(([term, description]) => {
            const dt = document.createElement('dt');
            dt.textContent = term;
            const dd = document.createElement('dd');
            dd.textContent = description;
            meta.append(dt, dd);
        });
        article.append(meta);

        if (gameId !== '') {
            const link = document.createElement('a');
            link.className = 'chess-button chess-button-small';
            link.href = gameHref(gameId);
            link.textContent = 'Open game';
            article.append(link);
        }

        list.append(article);
    });

    elements.gamesList.append(list);
};

const refreshGames = async () => {
    elements.gamesList.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'lede';
    loading.textContent = 'Loading chess games...';
    elements.gamesList.append(loading);

    try {
        const payload = await listGames();
        const games = normalizeGames(payload);
        state.games = games;
        if (state.displayName === '') {
            setDisplayName(deriveDisplayName(games));
        }
        renderGames(games);
    } catch (error) {
        const paragraph = document.createElement('p');
        paragraph.className = 'lede';
        paragraph.textContent = errorMessage(error, 'Chess games could not be loaded right now.');
        elements.gamesList.replaceChildren(paragraph);
    }
};

const linkUrlFromToken = (token) => {
    const url = new URL('/chess/', window.location.origin);
    url.searchParams.set('join', token);
    return url.toString();
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

const showChallengeLink = (url, gameId) => {
    elements.joinUrl.value = url;
    elements.linkBox.hidden = false;

    if (gameId) {
        elements.openGameLink.href = gameHref(gameId);
        elements.openGameLink.hidden = false;
    } else {
        elements.openGameLink.hidden = true;
    }
};

const handleNewGame = async (event) => {
    event.preventDefault();
    setMessage(elements.createMessage, 'Creating game...', 'neutral');
    elements.newGameButton.disabled = true;
    elements.linkBox.hidden = true;

    const selectedCreatorColor = elements.creatorColor.value;
    const creatorColor = selectedCreatorColor === 'random'
        ? 'random'
        : selectedCreatorColor === 'black' ? 'black' : 'white';
    const gameMode = elements.gameMode.value === 'local' ? 'local' : 'online';

    try {
        const game = await createGame({
            mode: gameMode,
            variant: 'standard',
            creator_color: creatorColor,
        });
        const gameId = typeof game?.id === 'string' ? game.id : '';
        if (gameId === '') {
            throw new Error('The new chess game did not return an id.');
        }

        if (gameMode === 'local') {
            setDisplayName(deriveDisplayName([game]));
            await refreshGames();
            window.location.assign(gameHref(gameId));
            return;
        }

        const viewerSeatColor = game?.viewer?.seat_color;
        const viewerColor = viewerSeatColor === 'black'
            ? 'black'
            : viewerSeatColor === 'white' ? 'white' : creatorColor === 'black' ? 'black' : 'white';
        const linkPayload = await createChallengeLink(gameId, {
            type: 'play',
            seat_color: oppositeColor(viewerColor),
        });
        const link = linkPayload?.link || linkPayload;
        const token = tokenFromLink(link);

        if (token === '') {
            throw new Error('The chess link was created without a join token.');
        }

        showChallengeLink(linkUrlFromToken(token), gameId);
        setDisplayName(deriveDisplayName([game]));
        setMessage(elements.createMessage, 'Challenge link ready.', 'success');
        await refreshGames();
    } catch (error) {
        setMessage(elements.createMessage, errorMessage(error, 'The game could not be created.'), 'error');
    } finally {
        elements.newGameButton.disabled = false;
    }
};

const handleCopy = async () => {
    const value = elements.joinUrl.value;
    if (value === '') {
        return;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
        } else if (!copyWithFallback(value)) {
            throw new Error('Copy failed.');
        }
        setMessage(elements.createMessage, 'Link copied.', 'success');
    } catch (error) {
        if (copyWithFallback(value)) {
            setMessage(elements.createMessage, 'Link copied.', 'success');
            return;
        }
        setMessage(elements.createMessage, 'Copy failed. Select the link and copy it manually.', 'error');
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
        const savedName = typeof profile?.display_name === 'string' ? profile.display_name : displayName;
        setDisplayName(savedName);
        elements.displayName.value = '';
        setMessage(elements.profileMessage, 'Name saved.', 'success');
    } catch (error) {
        setMessage(elements.profileMessage, errorMessage(error, 'The display name could not be saved.'), 'error');
    } finally {
        elements.saveNameButton.disabled = false;
    }
};

const claimJoinToken = async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join') || params.get('claim') || '';
    if (token === '') {
        return false;
    }

    elements.joinMessage.hidden = false;
    elements.joinMessage.textContent = 'Claiming chess challenge...';

    try {
        const game = await claimLink(token);
        if (typeof game?.id !== 'string' || game.id === '') {
            throw new Error('The claimed challenge did not return a game.');
        }
        window.location.assign(gameHref(game.id));
        return true;
    } catch (error) {
        elements.joinMessage.textContent = errorMessage(error, 'That chess challenge could not be claimed.');
        return false;
    }
};

elements.newGameForm.addEventListener('submit', handleNewGame);
elements.copyLinkButton.addEventListener('click', handleCopy);
elements.profileForm.addEventListener('submit', handleProfileSave);

claimJoinToken().then(async (isRedirecting) => {
    if (!isRedirecting) {
        await seedProfileName();
        refreshGames();
    }
});

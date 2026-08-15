import { claimLink, createChallengeLink, createGame, getProfile, listGames, updateProfile } from './chess-api.js';

const initializationFailureMessage = 'Chess could not finish loading. The create-game controls were not initialized.';
let elements;
let initializationError = null;
let initializationGuardInstalled = false;
let initialized = false;

const requireElement = (id) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Chess page initialization failed: missing #${id}.`);
    }

    return element;
};

const resolveElements = () => ({
    gamesList: requireElement('chess-games-list'),
    newGameForm: requireElement('chess-new-game-form'),
    gameMode: requireElement('chess-game-mode'),
    creatorColor: requireElement('chess-creator-color'),
    newGameButton: requireElement('chess-new-game-button'),
    createMessage: requireElement('chess-create-message'),
    linkBox: requireElement('chess-link-box'),
    joinUrl: requireElement('chess-join-url'),
    copyLinkButton: requireElement('chess-copy-link-button'),
    openGameLink: requireElement('chess-open-game-link'),
    profileForm: requireElement('chess-profile-form'),
    displayName: requireElement('chess-display-name'),
    saveNameButton: requireElement('chess-save-name-button'),
    currentName: requireElement('chess-current-name'),
    profileMessage: requireElement('chess-profile-message'),
    joinMessage: requireElement('chess-join-message'),
});

const renderInitializationFailure = () => {
    const gamesList = document.getElementById('chess-games-list');
    if (gamesList) {
        const paragraph = document.createElement('p');
        paragraph.className = 'lede chess-state-message chess-state-message-error';
        paragraph.textContent = initializationFailureMessage;
        gamesList.replaceChildren(paragraph);
    }

    const createMessage = document.getElementById('chess-create-message');
    if (createMessage) {
        createMessage.textContent = initializationFailureMessage;
        createMessage.dataset.tone = 'error';
    }
};

const handleInitializationFailure = (error) => {
    initializationError = error;
    console.error('Chess page initialization failed.', error);
    renderInitializationFailure();
};

const guardNewGameBeforeInitialization = (event) => {
    if (initialized && initializationError === null) {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    renderInitializationFailure();
};

const findNewGameForm = () => {
    try {
        return document.getElementById('chess-new-game-form') || document.querySelector('form.chess-new-game-form');
    } catch (error) {
        return document.querySelector('form.chess-new-game-form');
    }
};

const installNewGameInitializationGuard = () => {
    const newGameForm = findNewGameForm();
    if (newGameForm && !initializationGuardInstalled) {
        newGameForm.addEventListener('submit', guardNewGameBeforeInitialization);
        initializationGuardInstalled = true;
    }
};

const state = {
    games: [],
    displayName: '',
    isRefreshing: false,
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

const clearAttribute = (element, name) => {
    if (typeof element.removeAttribute === 'function') {
        element.removeAttribute(name);
        return;
    }

    if (element.attributes && typeof element.attributes.delete === 'function') {
        element.attributes.delete(name);
    }
    delete element[name];
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

const concreteSeatColor = (color) => (color === 'white' || color === 'black' ? color : '');

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
    paragraph.className = 'lede chess-state-message';
    paragraph.textContent = 'No browser-tied games yet. Start a board to keep it here.';
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
        article.setAttribute('aria-label', `${white?.display_name || 'White'} versus ${black?.display_name || 'Black'}`);

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
            link.setAttribute('aria-label', `Open ${white?.display_name || 'White'} versus ${black?.display_name || 'Black'}`);
            article.append(link);
        }

        list.append(article);
    });

    elements.gamesList.append(list);
};

const refreshGames = async () => {
    if (state.isRefreshing) {
        return;
    }

    state.isRefreshing = true;
    elements.gamesList.setAttribute('aria-busy', 'true');
    elements.gamesList.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'lede chess-state-message chess-state-message-loading';
    loading.textContent = 'Loading your browser-tied games...';
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
        paragraph.className = 'lede chess-state-message chess-state-message-error';
        paragraph.textContent = errorMessage(error, 'Your browser-tied games could not be loaded. Try refreshing in a moment.');
        elements.gamesList.replaceChildren(paragraph);
    } finally {
        state.isRefreshing = false;
        clearAttribute(elements.gamesList, 'aria-busy');
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

const resetChallengeLink = () => {
    elements.joinUrl.value = '';
    elements.copyLinkButton.disabled = true;
    elements.copyLinkButton.textContent = 'Copy link';
    elements.openGameLink.href = '';
    elements.openGameLink.hidden = true;
    elements.linkBox.hidden = true;
};

const showChallengeLink = (url, gameId) => {
    elements.joinUrl.value = url;
    elements.copyLinkButton.disabled = false;
    elements.copyLinkButton.textContent = 'Copy link';
    elements.linkBox.hidden = false;

    if (gameId) {
        elements.openGameLink.href = gameHref(gameId);
        elements.openGameLink.hidden = false;
    } else {
        elements.openGameLink.href = '';
        elements.openGameLink.hidden = true;
    }

    elements.joinUrl.focus({ preventScroll: true });
    elements.joinUrl.select();
};

const handleNewGame = async (event) => {
    event.preventDefault();
    setMessage(elements.createMessage, 'Creating a new board...', 'neutral');
    const originalButtonText = elements.newGameButton.textContent.trim() || 'New game';
    elements.newGameButton.disabled = true;
    elements.newGameButton.textContent = 'Creating...';
    elements.newGameForm.setAttribute('aria-busy', 'true');
    resetChallengeLink();

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
            setMessage(elements.createMessage, 'Local board created. Opening it now...', 'success');
            await refreshGames();
            window.location.assign(gameHref(gameId));
            return;
        }

        const viewerColor = concreteSeatColor(game?.viewer?.seat_color);
        if (viewerColor === '') {
            throw new Error('The new chess game did not return your assigned color.');
        }
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
        setMessage(elements.createMessage, 'Challenge link is ready. Copy it or open your board.', 'success');
        await refreshGames();
    } catch (error) {
        setMessage(elements.createMessage, errorMessage(error, 'The game could not be created.'), 'error');
    } finally {
        elements.newGameButton.disabled = false;
        elements.newGameButton.textContent = originalButtonText;
        clearAttribute(elements.newGameForm, 'aria-busy');
    }
};

const handleCopy = async () => {
    const value = elements.joinUrl.value;
    if (value === '') {
        setMessage(elements.createMessage, 'Create a challenge link before copying.', 'error');
        return;
    }

    elements.copyLinkButton.disabled = true;
    elements.copyLinkButton.textContent = 'Copying...';

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
        } else if (!copyWithFallback(value)) {
            throw new Error('Copy failed.');
        }
        elements.copyLinkButton.textContent = 'Copied';
        setMessage(elements.createMessage, 'Challenge link copied.', 'success');
    } catch (error) {
        if (copyWithFallback(value)) {
            elements.copyLinkButton.textContent = 'Copied';
            setMessage(elements.createMessage, 'Challenge link copied.', 'success');
            return;
        }
        elements.joinUrl.focus({ preventScroll: true });
        elements.joinUrl.select();
        setMessage(elements.createMessage, 'Copy failed. The link is selected so you can copy it manually.', 'error');
    } finally {
        window.setTimeout(() => {
            elements.copyLinkButton.disabled = false;
            elements.copyLinkButton.textContent = 'Copy link';
        }, 1200);
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
    elements.profileForm.setAttribute('aria-busy', 'true');
    setMessage(elements.profileMessage, 'Saving display name...', 'neutral');

    try {
        const profile = await updateProfile(displayName);
        const savedName = typeof profile?.display_name === 'string' ? profile.display_name : displayName;
        setDisplayName(savedName);
        elements.displayName.value = '';
        setMessage(elements.profileMessage, 'Display name saved.', 'success');
    } catch (error) {
        setMessage(elements.profileMessage, errorMessage(error, 'The display name could not be saved.'), 'error');
    } finally {
        elements.saveNameButton.disabled = false;
        clearAttribute(elements.profileForm, 'aria-busy');
    }
};

const claimJoinToken = async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join') || params.get('claim') || '';
    if (token === '') {
        return false;
    }

    elements.joinMessage.hidden = false;
    elements.joinMessage.dataset.tone = 'neutral';
    elements.joinMessage.textContent = 'Claiming chess challenge...';

    try {
        const game = await claimLink(token);
        if (typeof game?.id !== 'string' || game.id === '') {
            throw new Error('The claimed challenge did not return a game.');
        }
        elements.joinMessage.dataset.tone = 'success';
        elements.joinMessage.textContent = 'Challenge claimed. Opening the board...';
        window.location.assign(gameHref(game.id));
        return true;
    } catch (error) {
        elements.joinMessage.dataset.tone = 'error';
        elements.joinMessage.textContent = errorMessage(error, 'That chess challenge could not be claimed.');
        return false;
    }
};

const initializeChessIndex = () => {
    elements = resolveElements();

    elements.newGameForm.addEventListener('submit', handleNewGame);
    elements.copyLinkButton.addEventListener('click', handleCopy);
    elements.profileForm.addEventListener('submit', handleProfileSave);

    initialized = true;
    initializationError = null;

    claimJoinToken().then(async (isRedirecting) => {
        if (!isRedirecting) {
            await seedProfileName();
            refreshGames();
        }
    }).catch(handleInitializationFailure);
};

const boot = () => {
    try {
        installNewGameInitializationGuard();
        initializeChessIndex();
    } catch (error) {
        handleInitializationFailure(error);
    }
};

try {
    installNewGameInitializationGuard();
} catch (error) {
    handleInitializationFailure(error);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

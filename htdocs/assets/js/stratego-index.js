import { claimLink, createGame, listGames } from './stratego-api.js';

const INVITE_STORAGE_PREFIX = 'wowie.stratego.invite.';
const initializationFailureMessage = 'Stratego could not finish loading. The create-game controls were not initialized.';

const JOIN_ERROR_MESSAGES = Object.freeze({
    link_not_found: 'That invite link is not valid. Ask your opponent to send a new one.',
    link_expired: 'That invite link has expired. Ask your opponent to send a new one.',
    link_claimed: 'That invite link has already been used by another player.',
    seat_unavailable: 'That game no longer has an open seat.',
    already_seated: 'You already have a seat in that game. Open it from your games below.',
});

/** @type {any} */
let elements = null;

const state = {
    games: [],
    isRefreshing: false,
    isCreating: false,
};

const requireElement = (id) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Stratego lobby initialization failed: missing #${id}.`);
    }

    return element;
};

const resolveElements = () => ({
    gamesList: requireElement('stratego-games-list'),
    newGameForm: requireElement('stratego-new-game-form'),
    creatorColor: requireElement('stratego-creator-color'),
    newGameButton: requireElement('stratego-new-game-button'),
    createMessage: requireElement('stratego-create-message'),
    inviteBox: requireElement('stratego-invite-box'),
    inviteUrl: requireElement('stratego-invite-url'),
    copyInviteButton: requireElement('stratego-copy-invite-button'),
    openGameLink: requireElement('stratego-open-game-link'),
    joinMessage: requireElement('stratego-join-message'),
});

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

const gameHref = (gameId) => `/stratego/game.php?id=${encodeURIComponent(gameId)}`;

const absoluteUrl = (url) => (typeof url === 'string' && url !== '' ? `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}` : '');

const persistInvite = (gameId, url) => {
    if (!gameId || !url) {
        return;
    }
    try {
        window.localStorage.setItem(`${INVITE_STORAGE_PREFIX}${gameId}`, url);
    } catch {
        // The invite stays visible and copyable even without storage.
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

const normalizeGames = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    return [];
};

const findPlayer = (game, color) => (Array.isArray(game?.players) ? game.players.find((player) => player?.color === color) || null : null);

const playerName = (game, color) => {
    const player = findPlayer(game, color);
    const name = typeof player?.display_name === 'string' ? player.display_name.trim() : '';
    if (player?.seated !== true) {
        return 'Open seat';
    }

    return name !== '' ? name : titleCase(color);
};

const seatColor = (game) => {
    const color = game?.viewer?.seat_color;
    return color === 'red' || color === 'blue' ? color : '';
};

const opponentColor = (color) => (color === 'red' ? 'blue' : 'red');

/** Short status + whose-turn summary for a lobby card. */
export const describeGameTurn = (game) => {
    const status = String(game?.status || '');
    const mine = seatColor(game);
    const opponent = mine ? opponentColor(mine) : '';

    if (status === 'waiting') {
        return mine ? 'Waiting for an opponent to join' : 'Waiting for players';
    }

    if (status === 'setup') {
        const myReady = mine ? findPlayer(game, mine)?.is_ready === true : false;
        const theirReady = opponent ? findPlayer(game, opponent)?.is_ready === true : false;
        if (mine && !myReady) {
            return 'Deploy your army';
        }
        if (mine && !theirReady) {
            return `Waiting for ${playerName(game, opponent)} to deploy`;
        }

        return 'Armies deploying';
    }

    if (status === 'active') {
        if (game?.viewer?.controls_current_turn === true) {
            return 'Your turn';
        }
        const turn = game?.state?.turn === 'red' || game?.state?.turn === 'blue' ? game.state.turn : '';
        if (mine && turn === opponent) {
            return `Waiting for ${playerName(game, opponent)}`;
        }

        return turn ? `${titleCase(turn)} to move` : 'In progress';
    }

    if (status === 'finished') {
        const winner = game?.winner_color === 'red' || game?.winner_color === 'blue' ? game.winner_color : '';
        if (winner === '') {
            return 'Game over';
        }
        if (mine) {
            return winner === mine ? 'You won' : 'You lost';
        }

        return `${titleCase(winner)} won`;
    }

    return titleCase(status);
};

const renderGamesMessage = (message, tone = '') => {
    const paragraph = document.createElement('p');
    paragraph.className = 'stratego-state-message';
    paragraph.dataset.tone = tone;
    paragraph.textContent = message;
    elements.gamesList.replaceChildren(paragraph);
};

const renderGames = (games) => {
    if (games.length === 0) {
        renderGamesMessage('No games yet. Start one above and send the invite link to an opponent.');
        return;
    }

    const list = document.createElement('div');
    list.className = 'stratego-game-grid';

    games.forEach((game) => {
        const gameId = typeof game?.id === 'string' ? game.id : '';
        const red = playerName(game, 'red');
        const blue = playerName(game, 'blue');
        const mine = seatColor(game);
        const turnText = describeGameTurn(game);

        const article = document.createElement('article');
        article.className = 'stratego-game-card';
        article.dataset.status = String(game?.status || '');
        if (game?.viewer?.controls_current_turn === true) {
            article.dataset.yourTurn = 'true';
        }
        article.setAttribute('aria-label', `${red} versus ${blue}`);

        const kicker = document.createElement('span');
        kicker.className = 'stratego-kicker';
        kicker.textContent = titleCase(game?.status);

        const heading = document.createElement('h3');
        heading.textContent = `${red} vs ${blue}`;

        const meta = document.createElement('dl');
        meta.className = 'stratego-meta';
        [
            ['You', mine ? titleCase(mine) : 'Spectator'],
            ['Status', turnText],
        ].forEach(([term, description]) => {
            const dt = document.createElement('dt');
            dt.textContent = term;
            const dd = document.createElement('dd');
            dd.textContent = description;
            meta.append(dt, dd);
        });

        article.append(kicker, heading, meta);

        if (gameId !== '') {
            const link = document.createElement('a');
            link.className = 'stratego-button stratego-button-small';
            link.href = gameHref(gameId);
            link.textContent = game?.viewer?.controls_current_turn === true ? 'Play your turn' : 'Open game';
            link.setAttribute('aria-label', `Open ${red} versus ${blue}`);
            article.append(link);
        }

        list.append(article);
    });

    elements.gamesList.replaceChildren(list);
};

const refreshGames = async () => {
    if (state.isRefreshing) {
        return;
    }

    state.isRefreshing = true;
    elements.gamesList.setAttribute('aria-busy', 'true');

    try {
        const games = normalizeGames(await listGames());
        state.games = games;
        renderGames(games);
    } catch (error) {
        renderGamesMessage(errorMessage(error, 'Your games could not be loaded. Try refreshing in a moment.'), 'error');
    } finally {
        state.isRefreshing = false;
        elements.gamesList.removeAttribute('aria-busy');
    }
};

const resetInvite = () => {
    elements.inviteUrl.value = '';
    elements.copyInviteButton.disabled = true;
    elements.copyInviteButton.textContent = 'Copy';
    elements.openGameLink.setAttribute('href', '/stratego/');
    elements.openGameLink.hidden = true;
    elements.inviteBox.hidden = true;
};

const showInvite = (url, gameId) => {
    elements.inviteUrl.value = url;
    elements.copyInviteButton.disabled = url === '';
    elements.copyInviteButton.textContent = 'Copy';
    elements.inviteBox.hidden = false;
    elements.openGameLink.setAttribute('href', gameHref(gameId));
    elements.openGameLink.hidden = false;

    if (url !== '') {
        elements.inviteUrl.focus({ preventScroll: true });
        elements.inviteUrl.select();
    }
};

const selectedCreatorColor = () => {
    const value = elements.creatorColor.value;
    return value === 'red' || value === 'blue' ? value : 'random';
};

const handleNewGame = async (event) => {
    event.preventDefault();
    if (state.isCreating) {
        return;
    }

    state.isCreating = true;
    elements.newGameButton.disabled = true;
    elements.newGameButton.textContent = 'Creating...';
    elements.newGameForm.setAttribute('aria-busy', 'true');
    setMessage(elements.createMessage, 'Creating a new battlefield...', 'neutral');
    resetInvite();

    try {
        const game = await createGame({ creator_color: selectedCreatorColor() });
        const gameId = typeof game?.id === 'string' ? game.id : '';
        if (gameId === '') {
            throw new Error('The new Stratego game did not return an id.');
        }

        const inviteUrl = absoluteUrl(game?.invite_link?.url);
        persistInvite(gameId, inviteUrl);
        showInvite(inviteUrl, gameId);

        const mine = seatColor(game);
        const colorText = mine ? `You command ${titleCase(mine)}. ` : '';
        setMessage(
            elements.createMessage,
            inviteUrl !== ''
                ? `${colorText}Game created. Copy the invite link and send it to your opponent.`
                : `${colorText}Game created. Open it to create an invite link.`,
            'success',
        );
        await refreshGames();
    } catch (error) {
        setMessage(elements.createMessage, errorMessage(error, 'The game could not be created.'), 'error');
    } finally {
        state.isCreating = false;
        elements.newGameButton.disabled = false;
        elements.newGameButton.textContent = 'New game';
        elements.newGameForm.removeAttribute('aria-busy');
    }
};

const handleCopyInvite = async () => {
    const value = elements.inviteUrl.value;
    if (value === '') {
        setMessage(elements.createMessage, 'Create a game before copying an invite link.', 'error');
        return;
    }

    elements.copyInviteButton.disabled = true;
    try {
        await copyText(value);
        elements.copyInviteButton.textContent = 'Copied';
        setMessage(elements.createMessage, 'Invite link copied.', 'success');
    } catch {
        elements.inviteUrl.focus({ preventScroll: true });
        elements.inviteUrl.select();
        setMessage(elements.createMessage, 'Copy failed. The link is selected so you can copy it manually.', 'error');
    } finally {
        window.setTimeout(() => {
            elements.copyInviteButton.disabled = false;
            elements.copyInviteButton.textContent = 'Copy';
        }, 1200);
    }
};

const cleanJoinParam = () => {
    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('join')) {
            return;
        }
        url.searchParams.delete('join');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
        // Leaving the parameter in place is harmless.
    }
};

const joinErrorMessage = (error) => {
    const code = typeof error?.error === 'string' ? error.error : '';
    if (Object.prototype.hasOwnProperty.call(JOIN_ERROR_MESSAGES, code)) {
        return JOIN_ERROR_MESSAGES[code];
    }

    return errorMessage(error, 'That invite link could not be used.');
};

const claimJoinToken = async () => {
    const token = (new URLSearchParams(window.location.search).get('join') || '').trim();
    if (token === '') {
        return false;
    }

    elements.joinMessage.hidden = false;
    setMessage(elements.joinMessage, 'Joining the game...', 'neutral');

    try {
        const game = await claimLink(token);
        const gameId = typeof game?.id === 'string' ? game.id : '';
        if (gameId === '') {
            throw new Error('The invite was accepted but no game id was returned.');
        }
        setMessage(elements.joinMessage, 'Seat claimed. Opening the board...', 'success');
        window.location.assign(gameHref(gameId));
        return true;
    } catch (error) {
        setMessage(elements.joinMessage, joinErrorMessage(error), 'error');
        cleanJoinParam();
        return false;
    }
};

const renderInitializationFailure = () => {
    const createMessage = document.getElementById('stratego-create-message');
    if (createMessage) {
        createMessage.textContent = initializationFailureMessage;
        createMessage.dataset.tone = 'error';
    }
};

const init = () => {
    elements = resolveElements();
    resetInvite();

    elements.newGameForm.addEventListener('submit', handleNewGame);
    elements.copyInviteButton.addEventListener('click', handleCopyInvite);

    claimJoinToken().then((isRedirecting) => {
        if (!isRedirecting) {
            void refreshGames();
        }
    }).catch((error) => {
        console.error('Stratego lobby initialization failed.', error);
        renderInitializationFailure();
    });
};

const boot = () => {
    try {
        init();
    } catch (error) {
        console.error('Stratego lobby initialization failed.', error);
        renderInitializationFailure();
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

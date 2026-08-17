const API_ROOT = '/api/v1/chess';

export class ChessApiError extends Error {
    constructor({ status = 0, error = 'request_failed', message = 'The chess request failed.', details = null } = {}) {
        super(message);
        this.name = 'ChessApiError';
        this.status = status;
        this.error = error;
        this.details = details;
    }
}

const jsonHeaders = Object.freeze({
    Accept: 'application/json',
    'Content-Type': 'application/json',
});

const buildQuery = (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            query.set(key, String(value));
        }
    });

    const serialized = query.toString();
    return serialized === '' ? '' : `?${serialized}`;
};

const parseJson = async (response) => {
    const text = await response.text();
    if (text === '') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ChessApiError({
            status: response.status,
            error: 'invalid_json',
            message: 'The chess API returned an invalid response.',
        });
    }
};

const unwrapPayload = (payload) => {
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
        if (Object.prototype.hasOwnProperty.call(payload, 'meta')) {
            return {
                data: payload.data,
                meta: payload.meta,
            };
        }

        return payload.data;
    }

    return payload;
};

export const requestChess = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const options = {
        method,
        credentials: 'same-origin',
        headers: {
            ...jsonHeaders,
            ...headers,
        },
    };

    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_ROOT}${path}`, options);
    const payload = await parseJson(response);

    if (!response.ok) {
        throw new ChessApiError({
            status: response.status,
            error: typeof payload?.error === 'string' ? payload.error : 'request_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'The chess request failed.',
            details: payload?.details ?? null,
        });
    }

    return unwrapPayload(payload);
};

export const listGames = ({ limit, offset } = {}) => requestChess(`/games${buildQuery({ limit, offset })}`);

export const createGame = (payload = {}) => requestChess('/games', {
    method: 'POST',
    body: payload,
});

export const getGame = (gameId) => requestChess(`/games/${encodeURIComponent(gameId)}`);

export const createChallengeLink = (gameId, payload) => requestChess(`/games/${encodeURIComponent(gameId)}/links`, {
    method: 'POST',
    body: payload,
});

export const claimLink = (token) => requestChess('/links/claim', {
    method: 'POST',
    body: { token },
});

export const rejoinGame = (token, gameId = '') => {
    const body = gameId === '' ? { token } : { token, game_id: gameId };
    return requestChess(gameId === '' ? '/rejoin' : `/games/${encodeURIComponent(gameId)}/rejoin`, {
        method: 'POST',
        body,
    });
};

export const listMoves = (gameId) => requestChess(`/games/${encodeURIComponent(gameId)}/moves`);

export const submitMove = (gameId, payload) => requestChess(`/games/${encodeURIComponent(gameId)}/moves`, {
    method: 'POST',
    body: payload,
});

export const resignGame = (gameId, payload) => requestChess(`/games/${encodeURIComponent(gameId)}/resign`, {
    method: 'POST',
    body: payload,
});

export const requestTakeback = (gameId) => requestChess(`/games/${encodeURIComponent(gameId)}/takeback`, {
    method: 'POST',
});

export const cancelTakeback = (gameId) => requestChess(`/games/${encodeURIComponent(gameId)}/takeback`, {
    method: 'DELETE',
});

export const getPromotionOptions = (gameId, { from, to } = {}) => requestChess(
    `/games/${encodeURIComponent(gameId)}/moves/promotions${buildQuery({ from, to })}`,
);

export const getProfile = () => requestChess('/profile');

export const updateProfile = (displayName) => requestChess('/profile', {
    method: 'PATCH',
    body: { display_name: displayName },
});

export default Object.freeze({
    requestChess,
    listGames,
    createGame,
    getGame,
    createChallengeLink,
    claimLink,
    rejoinGame,
    listMoves,
    submitMove,
    resignGame,
    requestTakeback,
    cancelTakeback,
    getPromotionOptions,
    getProfile,
    updateProfile,
});

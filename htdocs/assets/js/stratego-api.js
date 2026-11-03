const API_ROOT = '/api/v1/stratego';

export class StrategoApiError extends Error {
    constructor({ status = 0, error = 'request_failed', message = 'The Stratego request failed.', details = null } = {}) {
        super(message);
        this.name = 'StrategoApiError';
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
        throw new StrategoApiError({
            status: response.status,
            error: 'invalid_json',
            message: 'The Stratego API returned an invalid response.',
        });
    }
};

const unwrapPayload = (payload) => {
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data;
    }

    return payload;
};

/**
 * @typedef {object} StrategoRequestOptions
 * @property {string} [method]
 * @property {unknown} [body]
 * @property {Record<string, string>} [headers]
 */

/**
 * @param {string} path
 * @param {StrategoRequestOptions} [requestOptions]
 */
export const requestStratego = async (path, { method = 'GET', body, headers = {} } = {}) => {
    /** @type {RequestInit} */
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
        throw new StrategoApiError({
            status: response.status,
            error: typeof payload?.error === 'string' ? payload.error : 'request_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'The Stratego request failed.',
            details: payload?.details ?? null,
        });
    }

    return unwrapPayload(payload);
};

const gamePath = (gameId) => `/games/${encodeURIComponent(gameId)}`;

/** GET /v1/stratego/games — games where the viewer owns a seat, newest first. */
export const listGames = () => requestStratego('/games');

/**
 * POST /v1/stratego/games
 * @param {{ creator_color?: 'red' | 'blue' | 'random' }} [payload]
 */
export const createGame = (payload = {}) => requestStratego('/games', {
    method: 'POST',
    body: payload,
});

/**
 * GET /v1/stratego/games/{publicId}?since_version=N
 * @param {string} gameId
 * @param {{ sinceVersion?: number | null }} [options]
 */
export const getGame = (gameId, { sinceVersion = null } = {}) => requestStratego(
    `${gamePath(gameId)}${buildQuery({ since_version: Number.isInteger(sinceVersion) ? sinceVersion : undefined })}`,
);

/**
 * POST /v1/stratego/games/{publicId}/links
 * @param {string} gameId
 */
export const createInviteLink = (gameId) => requestStratego(`${gamePath(gameId)}/links`, {
    method: 'POST',
});

/**
 * POST /v1/stratego/links/claim
 * @param {string} token
 */
export const claimLink = (token) => requestStratego('/links/claim', {
    method: 'POST',
    body: { token },
});

/**
 * POST /v1/stratego/games/{publicId}/setup
 * @param {string} gameId
 * @param {Array<{ square: string, rank: string }>} placements
 */
export const submitSetup = (gameId, placements) => requestStratego(`${gamePath(gameId)}/setup`, {
    method: 'POST',
    body: { placements },
});

/**
 * POST /v1/stratego/games/{publicId}/ready
 * @param {string} gameId
 */
export const markReady = (gameId) => requestStratego(`${gamePath(gameId)}/ready`, {
    method: 'POST',
});

/**
 * POST /v1/stratego/games/{publicId}/moves
 * @param {string} gameId
 * @param {{ from: string, to: string, expected_version?: number }} payload
 */
export const submitMove = (gameId, payload) => requestStratego(`${gamePath(gameId)}/moves`, {
    method: 'POST',
    body: payload,
});

/**
 * POST /v1/stratego/games/{publicId}/resign
 * @param {string} gameId
 */
export const resignGame = (gameId) => requestStratego(`${gamePath(gameId)}/resign`, {
    method: 'POST',
});

export default Object.freeze({
    requestStratego,
    listGames,
    createGame,
    getGame,
    createInviteLink,
    claimLink,
    submitSetup,
    markReady,
    submitMove,
    resignGame,
});

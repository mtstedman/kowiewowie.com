const API_ROOT = '/api/v1/risk';

export class RiskApiError extends Error {
    constructor({ status = 0, error = 'request_failed', message = 'The Risk request failed.', details = null } = {}) {
        super(message);
        this.name = 'RiskApiError';
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
        throw new RiskApiError({
            status: response.status,
            error: 'invalid_json',
            message: 'The Risk API returned an invalid response.',
        });
    }
};

const unwrapPayload = (payload) => {
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data;
    }

    return payload;
};

const gamePath = (gameId) => `/games/${encodeURIComponent(String(gameId))}`;

/**
 * Same-origin JSON request against the Risk API. Error bodies are unwrapped into RiskApiError.
 *
 * @param {string} path
 * @param {{method?: string, body?: any, headers?: Record<string, string>}} [options]
 */
export const requestRisk = async (path, { method = 'GET', body, headers = {} } = {}) => {
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

    let response;

    try {
        response = await fetch(`${API_ROOT}${path}`, options);
    } catch (error) {
        throw new RiskApiError({
            status: 0,
            error: 'network_error',
            message: 'The Risk server could not be reached.',
        });
    }

    const payload = await parseJson(response);

    if (!response.ok) {
        throw new RiskApiError({
            status: response.status,
            error: typeof payload?.error === 'string' ? payload.error : 'request_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'The Risk request failed.',
            details: payload?.details ?? null,
        });
    }

    return unwrapPayload(payload);
};

/**
 * @param {{opponent_count?: number}} [options]
 */
export const createGame = ({ opponent_count } = {}) => requestRisk('/games', {
    method: 'POST',
    body: { opponent_count },
});

/**
 * @param {string|null} gameId
 * @param {{sinceVersion?: number}} [options]
 */
export const getGame = (gameId, { sinceVersion } = {}) => requestRisk(
    `${gamePath(gameId)}${buildQuery({ since_version: sinceVersion })}`
);

export const createInviteLink = (gameId) => requestRisk(`${gamePath(gameId)}/links`, {
    method: 'POST',
    body: {},
});

export const claimLink = (token) => requestRisk('/links/claim', {
    method: 'POST',
    body: { token },
});

export const startGame = (gameId) => requestRisk(`${gamePath(gameId)}/start`, {
    method: 'POST',
    body: {},
});

/**
 * @param {string|null} gameId
 * @param {{expected_version?: number, state?: any, finished?: boolean, winner_seat?: number|null}} [options]
 */
export const postState = (gameId, { expected_version, state, finished, winner_seat } = {}) => {
    /** @type {{expected_version: number|undefined, state: any, finished?: boolean, winner_seat?: number}} */
    const body = { expected_version, state };

    if (finished !== undefined) {
        body.finished = Boolean(finished);
    }

    if (winner_seat !== undefined && winner_seat !== null) {
        body.winner_seat = winner_seat;
    }

    return requestRisk(`${gamePath(gameId)}/state`, {
        method: 'POST',
        body,
    });
};

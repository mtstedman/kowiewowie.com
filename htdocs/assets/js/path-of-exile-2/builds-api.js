const API_ROOT = '/api/v1/poe2/builds';

export class Poe2BuildsApiError extends Error {
    /**
     * @param {{ status?: number, error?: string, message?: string, details?: * }} [options]
     */
    constructor({ status = 0, error = 'request_failed', message = 'The saved-build request failed.', details = null } = {}) {
        super(message);
        this.name = 'Poe2BuildsApiError';
        this.status = status;
        this.error = error;
        this.details = details;
    }
}

const jsonHeaders = Object.freeze({
    Accept: 'application/json',
    'Content-Type': 'application/json',
});

const parseJson = async (response) => {
    const text = await response.text();
    if (text === '') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Poe2BuildsApiError({
            status: response.status,
            error: 'invalid_json',
            message: 'The saved-build API returned an invalid response.',
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

/**
 * @param {string} [path]
 * @param {{ method?: string, body?: unknown }} [options]
 */
const requestBuilds = async (path = '', { method = 'GET', body } = {}) => {
    /** @type {RequestInit} */
    const options = {
        method,
        credentials: 'same-origin',
        headers: jsonHeaders,
    };

    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_ROOT}${path}`, options);
    const payload = await parseJson(response);

    if (!response.ok) {
        throw new Poe2BuildsApiError({
            status: response.status,
            error: typeof payload?.error === 'string' ? payload.error : 'request_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'The saved-build request failed.',
            details: payload?.details ?? null,
        });
    }

    return unwrapPayload(payload);
};

export const listBuilds = async () => {
    const result = await requestBuilds();
    return {
        builds: Array.isArray(result?.data) ? result.data : [],
        owner: result?.meta?.owner === 'user' ? 'user' : 'guest',
    };
};

export const createBuild = (input) => requestBuilds('', { method: 'POST', body: input });

export const updateBuild = (id, input) => requestBuilds(`/${encodeURIComponent(id)}`, { method: 'PUT', body: input });

export const deleteBuild = (id) => requestBuilds(`/${encodeURIComponent(id)}`, { method: 'DELETE' });

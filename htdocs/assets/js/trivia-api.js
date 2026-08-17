const API_ROOT = '/api/v1/trivia';

export class TriviaApiError extends Error {
    constructor({ status = 0, error = 'request_failed', message = 'The trivia request failed.', details = null } = {}) {
        super(message);
        this.name = 'TriviaApiError';
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
        throw new TriviaApiError({
            status: response.status,
            error: 'invalid_json',
            message: 'The trivia API returned an invalid response.',
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

export const requestTrivia = async (path, { method = 'GET', body, headers = {} } = {}) => {
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
        throw new TriviaApiError({
            status: response.status,
            error: typeof payload?.error === 'string' ? payload.error : 'request_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'The trivia request failed.',
            details: payload?.details ?? null,
        });
    }

    return unwrapPayload(payload);
};

export const listRooms = ({ limit, offset } = {}) => requestTrivia(`/rooms${buildQuery({ limit, offset })}`);

export const createRoom = (payload = {}) => requestTrivia('/rooms', {
    method: 'POST',
    body: payload,
});

export const getRoom = (roomId) => requestTrivia(`/rooms/${encodeURIComponent(roomId)}`);

export const createJoinLink = (roomId, payload = {}) => requestTrivia(`/rooms/${encodeURIComponent(roomId)}/links`, {
    method: 'POST',
    body: payload,
});

export const claimLink = (token) => requestTrivia('/links/claim', {
    method: 'POST',
    body: { token },
});

export const rejoinRoom = (token, roomId = '') => {
    const body = roomId === '' ? { token } : { token, room_id: roomId };
    return requestTrivia(roomId === '' ? '/rejoin' : `/rooms/${encodeURIComponent(roomId)}/rejoin`, {
        method: 'POST',
        body,
    });
};

export const startRoom = (roomId) => requestTrivia(`/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
});

export const advanceRound = (roomId, payload = {}) => requestTrivia(`/rooms/${encodeURIComponent(roomId)}/rounds/advance`, {
    method: 'POST',
    body: payload,
});

export const submitAnswer = (roomId, payload = {}) => requestTrivia(`/rooms/${encodeURIComponent(roomId)}/answers`, {
    method: 'POST',
    body: payload,
});

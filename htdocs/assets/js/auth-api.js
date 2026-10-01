const AUTH_ROOT = '/api/v1/auth';
const AUTH_MODE_HEADER = 'X-Wowie-Auth-Mode';
const SESSION_LOCK_NAME = 'wowiekowie-account-session';
const ACCESS_TOKEN_SKEW_MS = 30000;

/**
 * Same-origin browser-session client for the public site.
 *
 * Access tokens live only in this module's memory. The long-lived refresh
 * credential stays in the HttpOnly `wowie_refresh` cookie managed by the API,
 * so nothing sensitive is written to browser storage or URLs. Every module
 * importer on a page shares one instance, and all cookie-touching requests run
 * through one queue so a page never issues duplicate bootstrap refreshes.
 */

export class AuthApiError extends Error {
    constructor({ status = 0, error = 'request_failed', message = 'The account request failed.', details = null } = {}) {
        super(message);
        this.name = 'AuthApiError';
        this.status = status;
        this.error = error;
        this.details = details;
    }
}

/**
 * @typedef {object} AccountUser
 * @property {string} id
 * @property {string} email
 * @property {string} display_name
 * @property {readonly string[]} roles
 * @property {string} status
 * @property {string | null} email_verified_at
 * @property {string} created_at
 */

/**
 * @typedef {object} AccountState
 * @property {'idle' | 'loading' | 'signed-out' | 'authenticated' | 'error'} status
 * @property {AccountUser | null} user
 * @property {AuthApiError | null} error
 */

const parseJson = async (response) => {
    const text = await response.text();
    if (text === '') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new AuthApiError({
            status: response.status,
            error: 'invalid_json',
            message: 'The account service returned an invalid response.',
        });
    }
};

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, accessToken?: string }} [requestOptions]
 */
const requestAuth = async (path, { method = 'POST', body, accessToken = '' } = {}) => {
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' };
    /** @type {RequestInit} */
    const options = { method, headers, cache: 'no-store' };

    if (accessToken !== '') {
        headers.Authorization = `Bearer ${accessToken}`;
        options.credentials = 'omit';
    } else {
        headers[AUTH_MODE_HEADER] = 'cookie';
        options.credentials = 'include';
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(`${AUTH_ROOT}${path}`, options);
    } catch (error) {
        throw new AuthApiError({
            status: 0,
            error: 'network_error',
            message: 'The account service could not be reached.',
        });
    }

    const payload = await parseJson(response);
    if (!response.ok) {
        throw new AuthApiError({
            status: response.status,
            error: typeof payload?.error === 'string' ? payload.error : 'request_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'The account request failed.',
            details: payload?.details ?? null,
        });
    }

    return payload;
};

/**
 * @param {unknown} value
 * @returns {AccountUser | null}
 */
const normalizeUser = (value) => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const user = /** @type {Record<string, unknown>} */ (value);
    const id = typeof user.id === 'string' || typeof user.id === 'number' ? String(user.id) : '';
    if (id === '') {
        return null;
    }

    return Object.freeze({
        id,
        email: typeof user.email === 'string' ? user.email : '',
        display_name: typeof user.display_name === 'string' ? user.display_name : '',
        roles: Object.freeze(Array.isArray(user.roles) ? user.roles.map((role) => String(role)) : []),
        status: typeof user.status === 'string' ? user.status : '',
        email_verified_at: typeof user.email_verified_at === 'string' ? user.email_verified_at : null,
        created_at: typeof user.created_at === 'string' ? user.created_at : '',
    });
};

const sessionFromPayload = (payload) => {
    const user = normalizeUser(payload?.user);
    const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
    const expiresIn = Number(payload?.expires_in);

    if (!user || accessToken === '') {
        throw new AuthApiError({
            status: 0,
            error: 'invalid_session',
            message: 'The account service returned an incomplete session.',
        });
    }

    return {
        user,
        accessToken,
        expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0),
    };
};

const toAuthError = (error) => (error instanceof AuthApiError
    ? error
    : new AuthApiError({ status: 0, error: 'request_failed', message: 'The account request failed.' }));

/**
 * Refresh failures that mean "no usable session" rather than "something broke".
 * Origin rejections (403 origin_not_allowed) and server errors stay failures.
 *
 * @param {unknown} error
 */
export const isSignedOutError = (error) => error instanceof AuthApiError
    && (error.status === 401 || (error.status === 403 && error.error === 'account_unavailable'));

/**
 * @param {unknown} error
 */
export const authErrorMessage = (error) => {
    const authError = toAuthError(error);

    switch (authError.error) {
        case 'network_error':
            return 'We could not reach the account service. Check your connection and try again.';
        case 'origin_not_allowed':
            return 'Account sign-in is not available from this address right now.';
        case 'credentials_invalid':
            return 'That email and password do not match an account.';
        case 'account_unavailable':
            return 'This account is not active.';
        case 'registration_disabled':
            return 'New account sign-ups are closed right now.';
        case 'email_in_use':
            return 'An account already exists for that email address. Try signing in instead.';
        case 'invalid_json':
        case 'invalid_session':
            return 'The account service sent an unexpected response. Please try again.';
        default:
            break;
    }

    if (authError.status >= 500) {
        return 'The account service had a problem. Please try again in a moment.';
    }

    return authError.message !== '' ? authError.message : 'The account request failed.';
};

/** @type {{ user: AccountUser, accessToken: string, expiresAt: number } | null} */
let session = null;
/** @type {AccountState} */
let state = Object.freeze({ status: 'idle', user: null, error: null });
/** @type {Set<(state: AccountState) => void>} */
const listeners = new Set();
let operationTail = Promise.resolve();
/** @type {Promise<AccountState> | null} */
let refreshInFlight = null;

/**
 * @param {AccountState['status']} status
 * @param {AccountUser | null} user
 * @param {AuthApiError | null} error
 */
const publish = (status, user, error) => {
    state = Object.freeze({ status, user, error });
    listeners.forEach((listener) => {
        try {
            listener(state);
        } catch (listenerError) {
            // A broken subscriber must not break session bookkeeping for others.
        }
    });
};

/**
 * Serialize cookie-touching requests within the page and, where supported,
 * across same-origin tabs so a rotated refresh cookie is never replayed.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
const enqueue = (task) => {
    const runLocked = () => {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        if (locks && typeof locks.request === 'function') {
            return locks.request(SESSION_LOCK_NAME, () => task());
        }

        return task();
    };
    const run = operationTail.then(runLocked);
    operationTail = run.then(() => undefined, () => undefined);

    return run;
};

const refreshSession = () => {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = enqueue(async () => {
        if (state.status !== 'authenticated') {
            publish('loading', null, null);
        }

        try {
            session = sessionFromPayload(await requestAuth('/refresh'));
            publish('authenticated', session.user, null);
        } catch (error) {
            session = null;
            if (isSignedOutError(error)) {
                publish('signed-out', null, null);
            } else {
                publish('error', null, toAuthError(error));
            }
        }

        return state;
    }).finally(() => {
        refreshInFlight = null;
    });

    return refreshInFlight;
};

/** @returns {AccountState} */
export const getSessionState = () => state;

/**
 * @param {(state: AccountState) => void} listener
 * @returns {() => void}
 */
export const subscribe = (listener) => {
    listeners.add(listener);
    listener(state);

    return () => {
        listeners.delete(listener);
    };
};

/**
 * Restore the session from the HttpOnly refresh cookie once per page. Later
 * callers share the in-flight request or the settled state; pass force to retry
 * after a recoverable error.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<AccountState>}
 */
export const restoreSession = ({ force = false } = {}) => {
    if (refreshInFlight) {
        return refreshInFlight;
    }
    if (!force && state.status !== 'idle') {
        return Promise.resolve(state);
    }

    return refreshSession();
};

/** @returns {Promise<string | null>} */
export const getAccessToken = async () => {
    if (session && session.expiresAt - ACCESS_TOKEN_SKEW_MS > Date.now()) {
        return session.accessToken;
    }
    if (state.status === 'signed-out') {
        return null;
    }

    await refreshSession();

    return session ? session.accessToken : null;
};

/** @returns {Promise<AccountUser | null>} */
export const fetchCurrentUser = async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        return null;
    }

    const payload = await requestAuth('/me', { method: 'GET', accessToken });

    return normalizeUser(payload?.user);
};

/**
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<AccountUser>}
 */
export const login = ({ email, password }) => enqueue(async () => {
    const nextSession = sessionFromPayload(await requestAuth('/login', {
        body: { email, password },
    }));
    session = nextSession;
    publish('authenticated', nextSession.user, null);

    return nextSession.user;
});

/**
 * @param {{ email: string, password: string, displayName: string }} account
 * @returns {Promise<AccountUser>}
 */
export const register = ({ email, password, displayName }) => enqueue(async () => {
    const nextSession = sessionFromPayload(await requestAuth('/register', {
        body: { email, password, display_name: displayName },
    }));
    session = nextSession;
    publish('authenticated', nextSession.user, null);

    return nextSession.user;
});

/**
 * Revoke the cookie's refresh token. In-memory authentication is cleared only
 * after the server confirms; failures propagate and leave state untouched.
 *
 * @returns {Promise<void>}
 */
export const logout = () => enqueue(async () => {
    await requestAuth('/logout');
    session = null;
    publish('signed-out', null, null);
});

export default Object.freeze({
    AuthApiError,
    authErrorMessage,
    fetchCurrentUser,
    getAccessToken,
    getSessionState,
    isSignedOutError,
    login,
    logout,
    register,
    restoreSession,
    subscribe,
});

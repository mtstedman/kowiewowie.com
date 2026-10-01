import {
    authErrorMessage,
    login,
    logout,
    register,
    restoreSession,
    subscribe,
} from './auth-api.js';

/**
 * Accept only same-origin, non-auth paths so return_to can never become an
 * open redirect or a redirect loop back into the login page.
 *
 * @param {string | null} value
 * @returns {string | null}
 */
const safeReturnPath = (value) => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
        return null;
    }

    let url;
    try {
        url = new URL(value, window.location.origin);
    } catch (error) {
        return null;
    }

    if (
        url.origin !== window.location.origin
        || url.pathname === '/login'
        || url.pathname.startsWith('/login/')
        || url.pathname.startsWith('/api/')
    ) {
        return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
};

const focusElement = (element) => {
    if (!element) {
        return;
    }

    try {
        element.focus({ preventScroll: false });
    } catch (error) {
        element.focus();
    }
};

const initLogin = (root) => {
    const statusText = root.querySelector('[data-login-status]');
    const retryButton = /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-login-retry]'));
    const accountPanel = /** @type {HTMLElement | null} */ (root.querySelector('[data-login-account]'));
    const accountTitle = /** @type {HTMLElement | null} */ (root.querySelector('[data-login-account-title]'));
    const accountName = root.querySelector('[data-login-account-name]');
    const accountEmail = root.querySelector('[data-login-account-email]');
    const accountError = /** @type {HTMLElement | null} */ (root.querySelector('[data-login-account-error]'));
    const continueLink = /** @type {HTMLAnchorElement | null} */ (root.querySelector('[data-login-continue]'));
    const logoutButton = /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-login-logout]'));
    const formsPanel = /** @type {HTMLElement | null} */ (root.querySelector('[data-login-forms]'));
    const loginFormTitle = /** @type {HTMLElement | null} */ (root.querySelector('[data-login-form-title]'));
    const forms = /** @type {NodeListOf<HTMLFormElement>} */ (root.querySelectorAll('form[data-login-form]'));
    const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('return_to'));
    let busy = false;

    if (continueLink && returnPath) {
        continueLink.href = returnPath;
    }

    const setStatus = (message) => {
        if (statusText) {
            statusText.textContent = message;
        }
    };
    const showError = (element, message) => {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.hidden = false;
        focusElement(element);
    };
    const clearError = (element) => {
        if (!element) {
            return;
        }

        element.textContent = '';
        element.hidden = true;
    };

    const render = (accountState) => {
        root.setAttribute('data-login-state', accountState.status);

        if (retryButton) {
            retryButton.hidden = accountState.status !== 'error';
        }

        if (accountState.status === 'authenticated' && accountState.user) {
            const user = accountState.user;
            if (accountName) {
                accountName.textContent = user.display_name || 'Not set';
            }
            if (accountEmail) {
                accountEmail.textContent = user.email;
            }
            setStatus(`Signed in as ${user.display_name || user.email}.`);
            if (accountPanel) {
                accountPanel.hidden = false;
            }
            if (formsPanel) {
                formsPanel.hidden = true;
            }
            return;
        }

        if (accountName) {
            accountName.textContent = '';
        }
        if (accountEmail) {
            accountEmail.textContent = '';
        }
        if (accountPanel) {
            accountPanel.hidden = true;
        }
        clearError(accountError);

        if (accountState.status === 'signed-out') {
            setStatus('You are signed out. Sign in or create an account below.');
            if (formsPanel) {
                formsPanel.hidden = false;
            }
            return;
        }

        if (accountState.status === 'error') {
            setStatus(`We could not confirm your session. ${authErrorMessage(accountState.error)}`);
            if (formsPanel) {
                formsPanel.hidden = false;
            }
            return;
        }

        setStatus('Checking whether you are already signed in…');
        if (formsPanel) {
            formsPanel.hidden = true;
        }
    };

    /**
     * @param {HTMLFormElement} form
     * @param {boolean} isBusy
     */
    const setFormBusy = (form, isBusy) => {
        const submit = /** @type {HTMLButtonElement | null} */ (form.querySelector('[data-login-submit]'));
        if (isBusy) {
            form.setAttribute('aria-busy', 'true');
        } else {
            form.removeAttribute('aria-busy');
        }

        if (!submit) {
            return;
        }

        if (isBusy) {
            submit.dataset.idleLabel = submit.textContent || '';
            submit.textContent = submit.getAttribute('data-busy-label') || submit.textContent;
            submit.disabled = true;
        } else {
            submit.textContent = submit.dataset.idleLabel || submit.textContent;
            submit.disabled = false;
        }
    };

    /**
     * @param {HTMLFormElement} form
     */
    const handleSubmit = async (form) => {
        if (busy) {
            return;
        }

        const mode = form.getAttribute('data-login-form');
        const errorElement = /** @type {HTMLElement | null} */ (form.querySelector('[data-login-form-error]'));
        clearError(errorElement);

        const data = new FormData(form);
        const email = String(data.get('email') ?? '').trim();
        const password = String(data.get('password') ?? '');
        const displayName = String(data.get('display_name') ?? '').trim();

        busy = true;
        setFormBusy(form, true);

        try {
            if (mode === 'register') {
                await register({ email, password, displayName });
            } else {
                await login({ email, password });
            }

            form.reset();
            if (returnPath) {
                window.location.assign(returnPath);
                return;
            }
            focusElement(accountTitle);
        } catch (error) {
            const passwordInput = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="password"]'));
            if (passwordInput) {
                passwordInput.value = '';
            }
            showError(errorElement, authErrorMessage(error));
        } finally {
            busy = false;
            setFormBusy(form, false);
        }
    };

    forms.forEach((form) => {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            handleSubmit(form);
        });
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            if (busy) {
                return;
            }

            busy = true;
            clearError(accountError);
            logoutButton.disabled = true;
            logoutButton.setAttribute('aria-busy', 'true');
            setStatus('Signing out…');

            logout()
                .then(() => {
                    setStatus('You are signed out. Sign in or create an account below.');
                    focusElement(loginFormTitle);
                })
                .catch((error) => {
                    setStatus('Sign-out did not finish. You are still signed in.');
                    showError(accountError, `Sign-out failed. ${authErrorMessage(error)}`);
                })
                .finally(() => {
                    busy = false;
                    logoutButton.disabled = false;
                    logoutButton.removeAttribute('aria-busy');
                });
        });
    }

    if (retryButton) {
        retryButton.addEventListener('click', () => {
            retryButton.disabled = true;
            restoreSession({ force: true }).then((accountState) => {
                retryButton.disabled = false;
                if (accountState.status === 'authenticated') {
                    focusElement(accountTitle);
                } else if (accountState.status === 'signed-out') {
                    focusElement(loginFormTitle);
                } else {
                    focusElement(retryButton);
                }
            });
        });
    }

    subscribe(render);
    restoreSession();
};

const loginRoot = document.querySelector('[data-login-root]');

if (loginRoot) {
    initLogin(loginRoot);
}

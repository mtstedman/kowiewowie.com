// Wedding Registry section: save the couple's details once, enroll in the
// Amazon, Target, and Zola registries, open each retailer's official signup
// page, and keep a checklist of each registry's top products. Retailers do not
// accept prefilled signups, so every account is still created on the
// retailer's own site; this page only links out and never handles retailer
// credentials.

/**
 * @typedef {'amazon' | 'target' | 'zola'} RegistryKey
 * @typedef {{ key: string, name: string, brand: string, category: string, url: string }} Product
 * @typedef {{ key: RegistryKey, name: string, tagline: string, signup_url: string, signup_help: string, add_product_help: string, products: Product[] }} Registry
 * @typedef {{ partner_one_name: string, partner_two_name: string, wedding_date: string | null, contact_email: string, shipping_address: string | null, updated_at: string }} Profile
 * @typedef {{ registry_key: RegistryKey, status: 'enrolled', signup_url: string, enrolled_at: string }} Enrollment
 * @typedef {{ registry_key: RegistryKey, product_key: string, status: 'picked' | 'added', updated_at: string }} RegistryPick
 * @typedef {{ registry_key: string, product_key: string, status: 'picked' | 'added' | 'removed' }} PickChange
 * @typedef {Error & { status: number, code: string, fields: Record<string, string> }} ApiError
 * @typedef {'info' | 'success' | 'error'} StatusTone
 * @typedef {{ row: HTMLLIElement, checkbox: HTMLInputElement, addedButton: HTMLButtonElement, stateLabel: HTMLElement }} ProductRefs
 * @typedef {{ registry: Registry, badge: HTMLElement, signupButton: HTMLButtonElement, enrollProductsButton: HTMLButtonElement, summary: HTMLElement, products: Map<string, ProductRefs> }} CardRefs
 */

const API_BASE = '/api/v1/wedding-registry';
// The site header loads this same specifier, so the page shares its one
// session and never spends the refresh cookie twice.
const AUTH_MODULE_URL = '/assets/js/auth-api.js';
/** @type {RegistryKey[]} */
const REGISTRY_KEYS = ['amazon', 'target', 'zola'];
/** @type {Record<string, string>} */
const FIELD_INPUT_IDS = {
    partner_one_name: 'wedding-registry-partner-one',
    partner_two_name: 'wedding-registry-partner-two',
    wedding_date: 'wedding-registry-date',
    contact_email: 'wedding-registry-email',
    shipping_address: 'wedding-registry-address',
};
const NAME_MAX = 120;
const ADDRESS_MAX = 500;

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} [options]
 * @returns {HTMLElementTagNameMap[K]}
 */
const el = (tag, { className = '', text = '', attrs = {} } = {}) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
    return node;
};

/** @param {string} text */
const hiddenText = (text) => el('span', { className: 'public-visually-hidden', text });

/** @param {unknown} value @returns {value is string} */
const isHttpsUrl = (value) => {
    if (typeof value !== 'string') return false;
    try {
        return new URL(value).protocol === 'https:';
    } catch (error) {
        return false;
    }
};

/** @param {string[]} names */
const listText = (names) => (names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** @param {string} iso */
const formatDate = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? iso
        : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

/** @param {string} ymd */
const formatWeddingDate = (ymd) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!match) return ymd;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, string>} [fields]
 * @returns {ApiError}
 */
const apiError = (status, code, message, fields = {}) => Object.assign(new Error(message), { status, code, fields });

/** @param {unknown} value @returns {value is Product} */
const isProduct = (value) => {
    const product = /** @type {Partial<Product> | null} */ (value);
    return !!product
        && typeof product.key === 'string'
        && typeof product.name === 'string'
        && typeof product.url === 'string';
};

/** @param {unknown} value @returns {value is Registry} */
const isRegistry = (value) => {
    const registry = /** @type {Partial<Registry> | null} */ (value);
    return !!registry
        && REGISTRY_KEYS.includes(/** @type {RegistryKey} */ (registry.key))
        && typeof registry.name === 'string'
        && Array.isArray(registry.products);
};

/** @param {unknown} value @returns {Profile | null} */
const normalizeProfile = (value) => {
    const profile = /** @type {Partial<Profile> | null} */ (value);
    if (!profile || typeof profile !== 'object') return null;
    return {
        partner_one_name: typeof profile.partner_one_name === 'string' ? profile.partner_one_name : '',
        partner_two_name: typeof profile.partner_two_name === 'string' ? profile.partner_two_name : '',
        wedding_date: typeof profile.wedding_date === 'string' && profile.wedding_date !== '' ? profile.wedding_date : null,
        contact_email: typeof profile.contact_email === 'string' ? profile.contact_email : '',
        shipping_address: typeof profile.shipping_address === 'string' && profile.shipping_address !== '' ? profile.shipping_address : null,
        updated_at: typeof profile.updated_at === 'string' ? profile.updated_at : '',
    };
};

/** @param {string} registryKey @param {string} productKey */
const pickKey = (registryKey, productKey) => `${registryKey}:${productKey}`;

(() => {
    const form = document.getElementById('wedding-registry-form');
    const fieldset = document.getElementById('wedding-registry-fieldset');
    const statusElement = document.getElementById('wedding-registry-status');
    const loginElement = document.getElementById('wedding-registry-login');
    const registriesElement = document.getElementById('wedding-registry-registries');
    const signupAllButton = document.getElementById('wedding-registry-signup-all');
    const copyButton = document.getElementById('wedding-registry-copy');
    const enrollAllButton = document.getElementById('wedding-registry-enroll-all');
    const copyFallback = document.getElementById('wedding-registry-copy-fallback');
    const copyText = document.getElementById('wedding-registry-copy-text');

    if (
        !(form instanceof HTMLFormElement)
        || !(fieldset instanceof HTMLFieldSetElement)
        || !(statusElement instanceof HTMLElement)
        || !(loginElement instanceof HTMLElement)
        || !(registriesElement instanceof HTMLElement)
        || !(signupAllButton instanceof HTMLButtonElement)
        || !(copyButton instanceof HTMLButtonElement)
        || !(enrollAllButton instanceof HTMLButtonElement)
        || !(copyFallback instanceof HTMLElement)
        || !(copyText instanceof HTMLTextAreaElement)
    ) {
        return;
    }

    /** @type {Map<string, HTMLInputElement | HTMLTextAreaElement>} */
    const fieldInputs = new Map();
    /** @type {Map<string, HTMLElement>} */
    const fieldErrors = new Map();
    for (const [field, id] of Object.entries(FIELD_INPUT_IDS)) {
        const input = document.getElementById(id);
        const error = form.querySelector(`[data-field-error="${field}"]`);
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !(error instanceof HTMLElement)) {
            return;
        }
        fieldInputs.set(field, input);
        fieldErrors.set(field, error);
    }

    const state = {
        /** @type {Registry[]} */
        registries: [],
        catalogFailed: false,
        /** @type {boolean | null} null until the account state is known. */
        signedIn: null,
        /** @type {Profile | null} */
        profile: null,
        /** @type {Map<string, Enrollment>} */
        enrollments: new Map(),
        /** @type {Map<string, RegistryPick>} */
        picks: new Map(),
        dirty: false,
        editVersion: 0,
        busy: false,
        meRequest: 0,
    };
    /** @type {Map<string, CardRefs>} */
    const cards = new Map();

    /** @param {string} message @param {StatusTone} [tone] */
    const setStatus = (message, tone = 'info') => {
        statusElement.textContent = message;
        statusElement.dataset.tone = tone;
    };
    // Account-mode notices never hide a catalog failure the visitor still needs to see.
    /** @param {string} message */
    const announceMode = (message) => {
        if (!state.catalogFailed) setStatus(message);
    };

    /** @param {string} key */
    const registryName = (key) => state.registries.find((registry) => registry.key === key)?.name ?? key;

    // ---- API -----------------------------------------------------------------

    /** @type {Promise<any> | null} */
    let authLoad = null;
    const loadAuth = () => {
        authLoad ??= import(AUTH_MODULE_URL).catch(() => null);
        return authLoad;
    };
    /** @returns {Promise<Record<string, string>>} */
    const authorization = async () => {
        const auth = await loadAuth();
        if (!auth) return {};
        try {
            await auth.restoreSession();
            const token = await auth.getAccessToken();
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch (error) {
            return {};
        }
    };

    /**
     * Calls the wedding registry API and resolves with payload.data.
     *
     * @param {string} path
     * @param {{ method?: string, body?: unknown, authenticated?: boolean }} [options]
     * @returns {Promise<any>}
     */
    const request = async (path, { method = 'GET', body = undefined, authenticated = true } = {}) => {
        /** @type {Record<string, string>} */
        const headers = { Accept: 'application/json', ...(authenticated ? await authorization() : {}) };
        if (authenticated && !headers.Authorization) {
            throw apiError(401, 'unauthenticated', 'Log in to save your wedding registry details.');
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        try {
            response = await fetch(`${API_BASE}${path}`, {
                method,
                headers,
                credentials: 'same-origin',
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch (error) {
            throw apiError(0, 'network_error', 'The wedding registry service could not be reached. Check your connection and try again.');
        }
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }
        if (!response.ok) {
            const fields = payload?.details?.fields;
            throw apiError(
                response.status,
                typeof payload?.error === 'string' ? payload.error : '',
                typeof payload?.message === 'string' && payload.message !== ''
                    ? payload.message
                    : `The wedding registry request failed (HTTP ${response.status}).`,
                fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {}
            );
        }
        return payload?.data;
    };

    /**
     * Surfaces a failed request in the status region; a 401 also switches the
     * page to signed-out mode.
     *
     * @param {unknown} error
     * @param {string} context
     */
    const reportError = (error, context) => {
        const failure = /** @type {Partial<ApiError>} */ (error ?? {});
        if (failure.status === 401) {
            setSignedOut();
            setStatus(`${context} Your session has ended. Log in to sign up.`, 'error');
            return;
        }
        const message = error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
        setStatus(`${context} ${message}`, 'error');
    };

    // ---- State ---------------------------------------------------------------

    /** @param {unknown} list */
    const setEnrollments = (list) => {
        state.enrollments = new Map();
        (Array.isArray(list) ? list : []).forEach((item) => {
            const enrollment = /** @type {Partial<Enrollment> | null} */ (item);
            if (enrollment && REGISTRY_KEYS.includes(/** @type {RegistryKey} */ (enrollment.registry_key))) {
                state.enrollments.set(enrollment.registry_key, /** @type {Enrollment} */ (enrollment));
            }
        });
    };

    /** @param {unknown} list */
    const setPicks = (list) => {
        state.picks = new Map();
        (Array.isArray(list) ? list : []).forEach((item) => {
            const pick = /** @type {Partial<RegistryPick> | null} */ (item);
            if (
                pick
                && typeof pick.registry_key === 'string'
                && typeof pick.product_key === 'string'
                && (pick.status === 'picked' || pick.status === 'added')
            ) {
                state.picks.set(pickKey(pick.registry_key, pick.product_key), /** @type {RegistryPick} */ (pick));
            }
        });
    };

    /** @param {Profile | null} profile */
    const fillForm = (profile) => {
        fieldInputs.forEach((input, field) => {
            const value = profile ? profile[field] : '';
            input.value = typeof value === 'string' ? value : '';
        });
    };

    const clearFieldErrors = () => {
        fieldErrors.forEach((error, field) => {
            error.textContent = '';
            error.hidden = true;
            fieldInputs.get(field)?.removeAttribute('aria-invalid');
        });
    };

    /**
     * @param {Record<string, string>} fields
     * @returns {boolean} whether any message was attached to a form field
     */
    const showFieldErrors = (fields) => {
        clearFieldErrors();
        /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */
        const invalid = [];
        for (const [field, message] of Object.entries(fields)) {
            const error = fieldErrors.get(field);
            const input = fieldInputs.get(field);
            if (!error || !input || typeof message !== 'string') continue;
            error.textContent = message;
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            invalid.push(input);
        }
        if (invalid.length > 0) invalid[0].focus();
        return invalid.length > 0;
    };

    const readForm = () => {
        /** @param {string} field */
        const value = (field) => fieldInputs.get(field)?.value ?? '';
        const weddingDate = value('wedding_date').trim();
        const address = value('shipping_address').trim();
        return {
            partner_one_name: value('partner_one_name').trim(),
            partner_two_name: value('partner_two_name').trim(),
            wedding_date: weddingDate === '' ? null : weddingDate,
            contact_email: value('contact_email').trim(),
            shipping_address: address === '' ? null : address,
        };
    };

    // A quick local check of what the server will validate, used only to
    // decide whether to reserve signup tabs before the requests start.
    const profileLooksReady = () => {
        if (state.profile && !state.dirty) return true;
        const details = readForm();
        return details.partner_one_name !== ''
            && details.partner_one_name.length <= NAME_MAX
            && details.partner_two_name !== ''
            && details.partner_two_name.length <= NAME_MAX
            && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.contact_email)
            && (details.shipping_address === null || details.shipping_address.length <= ADDRESS_MAX);
    };

    const setSignedOut = () => {
        state.meRequest += 1;
        state.signedIn = false;
        state.profile = null;
        state.enrollments = new Map();
        state.picks = new Map();
        state.dirty = false;
        form.reset();
        clearFieldErrors();
        copyText.value = '';
        copyFallback.hidden = true;
        applyMode();
    };

    const applyMode = () => {
        const signedIn = state.signedIn === true;
        fieldset.disabled = !signedIn;
        loginElement.hidden = signedIn;
        renderState();
    };

    /**
     * Runs one change at a time; a click while another change is saving is
     * reported and its control re-synced to the saved state.
     *
     * @param {() => Promise<void>} task
     */
    const runExclusive = async (task) => {
        if (state.signedIn !== true) {
            setStatus('Log in to sign up for registries and save product picks.', 'error');
            renderState();
            return;
        }
        if (state.busy) {
            setStatus('Still saving your last change. Try again in a moment.');
            renderState();
            return;
        }
        state.busy = true;
        form.setAttribute('aria-busy', 'true');
        registriesElement.setAttribute('aria-busy', 'true');
        try {
            await task();
        } catch (error) {
            reportError(error, 'Something went wrong.');
        } finally {
            state.busy = false;
            form.setAttribute('aria-busy', 'false');
            registriesElement.setAttribute('aria-busy', 'false');
            renderState();
        }
    };

    // ---- Rendering -----------------------------------------------------------

    const renderState = () => {
        const signedIn = state.signedIn === true;
        cards.forEach((refs, key) => {
            const enrollment = state.enrollments.get(key);
            if (enrollment) {
                refs.badge.textContent = `Enrolled on ${formatDate(enrollment.enrolled_at)}`;
                refs.badge.dataset.state = 'enrolled';
                refs.badge.hidden = false;
            } else {
                refs.badge.textContent = 'Not signed up yet';
                refs.badge.dataset.state = 'pending';
                refs.badge.hidden = !signedIn;
            }
            refs.signupButton.disabled = !signedIn;
            refs.enrollProductsButton.disabled = !signedIn;

            let picked = 0;
            let added = 0;
            refs.products.forEach((product, productKey) => {
                const pick = state.picks.get(pickKey(key, productKey));
                const isAdded = pick?.status === 'added';
                if (pick) picked += 1;
                if (isAdded) added += 1;
                product.checkbox.checked = !!pick;
                product.checkbox.disabled = !signedIn;
                product.addedButton.disabled = !signedIn;
                product.addedButton.setAttribute('aria-pressed', isAdded ? 'true' : 'false');
                product.row.dataset.state = isAdded ? 'added' : (pick ? 'picked' : 'none');
                product.stateLabel.textContent = isAdded
                    ? `Added on ${refs.registry.name}`
                    : (pick ? 'Picked' : '');
                product.stateLabel.hidden = !pick;
            });
            const total = refs.products.size;
            refs.summary.textContent = signedIn
                ? `${picked} of ${total} picked, ${added} added`
                : `${total} top products`;
        });
    };

    /** @param {Registry} registry @returns {HTMLElement} */
    const buildCard = (registry) => {
        const titleId = `wedding-registry-${registry.key}-title`;
        const card = el('article', {
            className: 'wedding-registry-card',
            attrs: { 'data-registry': registry.key, 'aria-labelledby': titleId },
        });

        const header = el('div', { className: 'wedding-registry-card-header' });
        header.append(
            el('h3', { className: 'wedding-registry-card-title', text: registry.name, attrs: { id: titleId } }),
        );
        const badge = el('p', { className: 'wedding-registry-badge' });
        badge.hidden = true;
        header.append(badge);
        card.append(header);

        if (registry.tagline) {
            card.append(el('p', { className: 'wedding-registry-tagline', text: registry.tagline }));
        }

        const actions = el('div', { className: 'wedding-registry-card-actions' });
        const signupButton = el('button', { className: 'button wedding-registry-primary', attrs: { type: 'button' } });
        signupButton.append('Sign up', hiddenText(` for ${registry.name}`));
        signupButton.disabled = true;
        signupButton.addEventListener('click', () => signUp([registry.key]));
        actions.append(signupButton);
        if (isHttpsUrl(registry.signup_url)) {
            const signupLink = el('a', {
                className: 'text-link wedding-registry-signup-link',
                text: `Open ${registry.name} signup`,
                attrs: { href: registry.signup_url, target: '_blank', rel: 'noopener noreferrer' },
            });
            signupLink.append(hiddenText(' (opens in a new tab)'));
            actions.append(signupLink);
        }
        card.append(actions);

        if (registry.signup_help) {
            card.append(el('p', { className: 'wedding-registry-help', text: registry.signup_help }));
        }

        const productsHeading = el('div', { className: 'wedding-registry-products-heading' });
        const productsTitleId = `wedding-registry-${registry.key}-products-title`;
        productsHeading.append(el('h4', { text: 'Top products', attrs: { id: productsTitleId } }));
        const summary = el('p', { className: 'wedding-registry-products-summary' });
        productsHeading.append(summary);
        card.append(productsHeading);

        const enrollProductsButton = el('button', { className: 'button wedding-registry-enroll-products', attrs: { type: 'button' } });
        enrollProductsButton.append('Enroll in all top products', hiddenText(` on ${registry.name}`));
        enrollProductsButton.disabled = true;
        enrollProductsButton.addEventListener('click', () => enrollProducts([registry]));
        card.append(enrollProductsButton);

        const list = el('ul', { className: 'wedding-registry-products', attrs: { 'aria-labelledby': productsTitleId } });
        /** @type {Map<string, ProductRefs>} */
        const products = new Map();
        registry.products.filter(isProduct).forEach((product) => {
            const row = el('li', { className: 'wedding-registry-product' });
            const pickLabel = el('label', { className: 'wedding-registry-product-pick' });
            const checkbox = el('input', { attrs: { type: 'checkbox' } });
            checkbox.disabled = true;
            const text = el('span', { className: 'wedding-registry-product-text' });
            text.append(el('span', { className: 'wedding-registry-product-name', text: product.name }));
            const meta = [product.brand, product.category].filter((part) => typeof part === 'string' && part !== '').join(' · ');
            if (meta) text.append(el('span', { className: 'wedding-registry-product-meta', text: meta }));
            const stateLabel = el('span', { className: 'wedding-registry-product-state' });
            stateLabel.hidden = true;
            text.append(stateLabel);
            pickLabel.append(checkbox, text);
            row.append(pickLabel);

            const productActions = el('div', { className: 'wedding-registry-product-actions' });
            if (isHttpsUrl(product.url)) {
                const link = el('a', {
                    className: 'text-link wedding-registry-product-link',
                    text: `Open on ${registry.name}`,
                    attrs: { href: product.url, target: '_blank', rel: 'noopener noreferrer' },
                });
                link.append(hiddenText(`: ${product.name} (opens in a new tab)`));
                productActions.append(link);
            }
            const addedButton = el('button', {
                className: 'wedding-registry-added-toggle',
                attrs: { type: 'button', 'aria-pressed': 'false' },
            });
            addedButton.append('Mark as added', hiddenText(`: ${product.name}`));
            addedButton.disabled = true;
            productActions.append(addedButton);
            row.append(productActions);

            checkbox.addEventListener('change', () => {
                const status = checkbox.checked ? 'picked' : 'removed';
                savePicks(
                    [{ registry_key: registry.key, product_key: product.key, status }],
                    status === 'picked'
                        ? `Picked ${product.name} for ${registry.name}. Open it on ${registry.name} to add it to your registry.`
                        : `Removed ${product.name} from your ${registry.name} picks.`
                );
            });
            addedButton.addEventListener('click', () => {
                const current = state.picks.get(pickKey(registry.key, product.key));
                const status = current?.status === 'added' ? 'picked' : 'added';
                savePicks(
                    [{ registry_key: registry.key, product_key: product.key, status }],
                    status === 'added'
                        ? `Marked ${product.name} as added on ${registry.name}.`
                        : `${product.name} is picked but no longer marked as added on ${registry.name}.`
                );
            });

            products.set(product.key, { row, checkbox, addedButton, stateLabel });
            list.append(row);
        });
        card.append(list);

        if (registry.add_product_help) {
            card.append(el('p', { className: 'wedding-registry-help', text: registry.add_product_help }));
        }

        cards.set(registry.key, { registry, badge, signupButton, enrollProductsButton, summary, products });
        return card;
    };

    const buildCards = () => {
        cards.clear();
        registriesElement.replaceChildren(...state.registries.map(buildCard));
        renderState();
    };

    // ---- Actions -------------------------------------------------------------

    /** @returns {Promise<boolean>} */
    const saveProfile = async () => {
        clearFieldErrors();
        const version = state.editVersion;
        try {
            const profile = normalizeProfile(await request('/profile', { method: 'PUT', body: readForm() }));
            if (!profile) {
                throw apiError(0, 'invalid_response', 'The saved details came back incomplete. Reload the page to check them.');
            }
            state.profile = profile;
            if (state.editVersion === version) state.dirty = false;
            return true;
        } catch (error) {
            const failure = /** @type {Partial<ApiError>} */ (error ?? {});
            if (failure.status === 422 && failure.fields && showFieldErrors(failure.fields)) {
                setStatus(`Your details were not saved. ${failure.message} Fix the highlighted fields and try again.`, 'error');
            } else {
                reportError(error, 'Your details were not saved.');
            }
            return false;
        }
    };

    // Signup tabs are reserved synchronously inside the click so popup
    // blockers still see the user's gesture, then sent to each signup_url once
    // enrollment succeeds. The window is opened without the 'noopener' feature
    // only because window.open always returns null with it, which would make a
    // blocked tab undetectable; the opener is severed before navigating, which
    // is what noopener guarantees.
    /** @returns {Window | null} */
    const reserveTab = () => {
        /** @type {Window | null} */
        let tab = null;
        try {
            tab = window.open('about:blank', '_blank');
        } catch (error) {
            tab = null;
        }
        if (tab) {
            try {
                tab.opener = null;
            } catch (error) {
                // The new tab is still about:blank and same-origin here.
            }
        }
        return tab;
    };

    /** @param {Window | null} tab @param {string} url @returns {boolean} */
    const sendTab = (tab, url) => {
        const target = tab ?? reserveTab();
        if (!target) return false;
        try {
            target.location.replace(url);
            return true;
        } catch (error) {
            try {
                target.close();
            } catch (closeError) {
                // Nothing else to clean up.
            }
            return false;
        }
    };

    /** @param {(Window | null)[]} tabs */
    const closeTabs = (tabs) => {
        tabs.forEach((tab) => {
            try {
                tab?.close();
            } catch (error) {
                // Already closed.
            }
        });
    };

    /** @param {RegistryKey[]} keys an empty list means all three */
    const signUp = (keys) => runExclusive(async () => {
        const targets = keys.length > 0 ? keys : state.registries.map((registry) => registry.key);
        const tabs = profileLooksReady() ? targets.map(() => reserveTab()) : [];
        let enrolled = false;
        try {
            setStatus(`Signing you up for ${listText(targets.map(registryName))}…`);
            if (state.dirty || !state.profile) {
                if (!state.dirty && !state.profile) {
                    showFieldErrors({});
                    fieldInputs.get('partner_one_name')?.focus();
                    setStatus('Save your wedding details before signing up for registries: fill in both names and a contact email.', 'error');
                    return;
                }
                if (!(await saveProfile())) return;
            }
            let data;
            try {
                data = await request('/enrollments', {
                    method: 'POST',
                    body: keys.length > 0 ? { registries: keys } : {},
                });
            } catch (error) {
                const failure = /** @type {Partial<ApiError>} */ (error ?? {});
                if (failure.code === 'profile_required') {
                    state.profile = null;
                    fieldInputs.get('partner_one_name')?.focus();
                    setStatus(`${failure.message} Fill in your details and press Save details.`, 'error');
                    return;
                }
                reportError(error, 'You were not signed up.');
                return;
            }
            setEnrollments(data?.enrollments);
            enrolled = true;
            renderState();

            /** @type {string[]} */
            const opened = [];
            /** @type {string[]} */
            const blocked = [];
            targets.forEach((key, index) => {
                const enrollment = state.enrollments.get(key);
                const url = enrollment && isHttpsUrl(enrollment.signup_url)
                    ? enrollment.signup_url
                    : cards.get(key)?.registry.signup_url;
                const name = registryName(key);
                if (isHttpsUrl(url) && sendTab(tabs[index] ?? null, url)) {
                    opened.push(name);
                } else {
                    if (tabs[index]) closeTabs([tabs[index]]);
                    blocked.push(name);
                }
            });
            const parts = [`Signed up for ${listText(targets.map(registryName))} here.`];
            if (opened.length > 0) {
                parts.push(`Opened the ${listText(opened)} signup ${opened.length === 1 ? 'page' : 'pages'} in new tabs.`);
            }
            if (blocked.length > 0) {
                parts.push(`Your browser blocked the ${listText(blocked)} ${blocked.length === 1 ? 'tab' : 'tabs'}; use the Open ${listText(blocked)} signup ${blocked.length === 1 ? 'link' : 'links'} below.`);
            }
            parts.push('Create each account on the retailer\'s site and paste in your details with Copy my details.');
            setStatus(parts.join(' '), blocked.length > 0 ? 'info' : 'success');
        } finally {
            if (!enrolled) closeTabs(tabs);
        }
    });

    /**
     * @param {PickChange[]} changes
     * @param {string} successMessage
     */
    const savePicks = (changes, successMessage) => runExclusive(async () => {
        setStatus('Saving your product picks…');
        try {
            const data = await request('/picks', { method: 'POST', body: { picks: changes } });
            setPicks(data?.picks);
            setStatus(successMessage, 'success');
        } catch (error) {
            reportError(error, 'Your product picks were not saved.');
        }
    });

    // Every catalog product of each registry is posted as picked; one already
    // marked as added keeps that status so the checklist is not reset.
    /** @param {Registry[]} registries */
    const enrollProducts = (registries) => {
        /** @type {PickChange[]} */
        const changes = [];
        for (const registry of registries) {
            for (const product of registry.products.filter(isProduct)) {
                const isAdded = state.picks.get(pickKey(registry.key, product.key))?.status === 'added';
                changes.push({ registry_key: registry.key, product_key: product.key, status: isAdded ? 'added' : 'picked' });
            }
        }
        if (changes.length === 0) {
            setStatus('There are no top products to enroll in yet.', 'error');
            return;
        }
        const names = listText(registries.map((registry) => registry.name));
        savePicks(changes, `Picked every top product on ${names}. Open each product on the retailer's site to add it to your registry.`);
    };

    /** @param {Profile} profile */
    const detailsText = (profile) => {
        const lines = [
            `Partner one: ${profile.partner_one_name}`,
            `Partner two: ${profile.partner_two_name}`,
        ];
        if (profile.wedding_date) lines.push(`Wedding date: ${formatWeddingDate(profile.wedding_date)} (${profile.wedding_date})`);
        lines.push(`Contact email: ${profile.contact_email}`);
        if (profile.shipping_address) lines.push(`Shipping address: ${profile.shipping_address}`);
        return lines.join('\n');
    };

    const copyDetails = async () => {
        if (state.signedIn !== true) {
            setStatus('Log in and save your details to copy them.', 'error');
            return;
        }
        if (!state.profile) {
            setStatus('Save your details first, then copy them into each signup form.', 'error');
            return;
        }
        const text = detailsText(state.profile);
        const unsavedNote = state.dirty ? ' Unsaved changes are not included; press Save details to keep them.' : '';
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
        if (window.isSecureContext && clipboard && typeof clipboard.writeText === 'function') {
            try {
                await clipboard.writeText(text);
                copyFallback.hidden = true;
                setStatus(`Copied your saved details. Paste them into each retailer's signup form.${unsavedNote}`, 'success');
                return;
            } catch (error) {
                // Falls back to the selectable text below.
            }
        }
        copyText.value = text;
        copyFallback.hidden = false;
        copyText.focus();
        copyText.select();
        setStatus(`This browser did not let the page copy automatically. Your saved details are selected in the box below; press Ctrl+C (or Command+C) to copy them.${unsavedNote}`, 'info');
    };

    const loadMe = async () => {
        state.meRequest += 1;
        const ticket = state.meRequest;
        announceMode('Loading your saved details…');
        try {
            const data = await request('/me');
            if (ticket !== state.meRequest || state.signedIn !== true) return;
            state.profile = normalizeProfile(data?.profile);
            setEnrollments(data?.enrollments);
            setPicks(data?.picks);
            if (!state.dirty) {
                fillForm(state.profile);
                clearFieldErrors();
            }
            renderState();
            announceMode(state.profile
                ? 'Your saved details are loaded.'
                : 'Fill in your details, then press Save details or Sign up for all 3.');
        } catch (error) {
            if (ticket !== state.meRequest) return;
            reportError(error, 'Your saved details did not load.');
        }
    };

    const loadCatalog = async () => {
        try {
            const data = await request('/catalog', { authenticated: false });
            const registries = (Array.isArray(data?.registries) ? data.registries : [])
                .filter(isRegistry)
                .sort((a, b) => REGISTRY_KEYS.indexOf(a.key) - REGISTRY_KEYS.indexOf(b.key));
            if (registries.length === 0) {
                throw apiError(0, 'empty_catalog', 'The registry list came back empty.');
            }
            state.registries = registries;
            state.catalogFailed = false;
            buildCards();
        } catch (error) {
            state.catalogFailed = true;
            const message = error instanceof Error && error.message ? error.message : 'Something went wrong.';
            const failure = el('div', { className: 'wedding-registry-placeholder wedding-registry-placeholder-error' });
            failure.append(
                el('h3', { text: 'The registries did not load' }),
                el('p', { text: `${message} Reload the page to try again.` }),
            );
            registriesElement.replaceChildren(failure);
            setStatus(`The registries did not load. ${message} Reload the page to try again.`, 'error');
        } finally {
            registriesElement.setAttribute('aria-busy', 'false');
        }
    };

    // ---- Wiring --------------------------------------------------------------

    form.addEventListener('input', (event) => {
        state.dirty = true;
        state.editVersion += 1;
        const target = event.target;
        fieldErrors.forEach((error, field) => {
            if (fieldInputs.get(field) === target && !error.hidden) {
                error.hidden = true;
                error.textContent = '';
                if (target instanceof HTMLElement) target.removeAttribute('aria-invalid');
            }
        });
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        runExclusive(async () => {
            setStatus('Saving your details…');
            if (await saveProfile()) {
                setStatus('Your details are saved. Use Copy my details to paste them into each signup form.', 'success');
            }
        });
    });

    signupAllButton.addEventListener('click', () => signUp([]));
    enrollAllButton.addEventListener('click', () => enrollProducts(state.registries));
    copyButton.addEventListener('click', () => {
        copyDetails().catch((error) => reportError(error, 'Your details were not copied.'));
    });

    const start = async () => {
        const catalogReady = loadCatalog();
        const auth = await loadAuth();
        await catalogReady;
        if (!auth) {
            state.signedIn = false;
            applyMode();
            setStatus('The account tools did not load, so signing up is unavailable right now. Reload the page to try again.', 'error');
            return;
        }
        auth.subscribe((/** @type {{ status?: string } | null} */ accountState) => {
            const status = accountState?.status;
            if (status === 'authenticated') {
                if (state.signedIn === true) return;
                state.signedIn = true;
                applyMode();
                loadMe();
            } else if (status === 'signed-out') {
                if (state.signedIn === false) return;
                const wasSignedIn = state.signedIn === true;
                setSignedOut();
                announceMode(wasSignedIn
                    ? 'You are signed out. Log in to sign up for registries.'
                    : 'Browse the registries below. Log in to save your details and sign up.');
            } else if (status === 'error' && state.signedIn === null) {
                state.signedIn = false;
                applyMode();
                setStatus('We could not check your account. Use Retry in the header, then sign up.', 'error');
            }
        });
        auth.restoreSession().catch(() => {
            if (state.signedIn === null) {
                state.signedIn = false;
                applyMode();
                setStatus('We could not check your account. Reload the page to try again.', 'error');
            }
        });
    };

    renderState();
    start().catch((error) => reportError(error, 'The wedding registry did not start.'));
})();

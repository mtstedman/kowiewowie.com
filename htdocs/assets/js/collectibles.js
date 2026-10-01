(() => {
    const API_ENDPOINT = '/api/v1/collectibles';
    const PAGE_SIZE = 48;
    const MAX_QUERY_LENGTH = 100;
    const SEARCH_DEBOUNCE_MS = 250;
    const BRANDS = {
        skullpanda: 'SKULLPANDA',
        nommi: 'Nommi',
        'sonny-angel': 'Sonny Angel',
    };
    const SORTS = new Set(['name-asc', 'name-desc', 'price-asc', 'price-desc', 'newest', 'oldest']);

    const form = document.getElementById('collectibles-form');
    const searchInput = document.getElementById('collectibles-search-input');
    const statusElement = document.getElementById('collectibles-status');
    const updatedElement = document.getElementById('collectibles-updated');
    const resultsElement = document.getElementById('collectibles-results');
    const loadMoreButton = document.getElementById('collectibles-load-more');
    const sortSelect = document.getElementById('collectibles-sort');
    const exportButton = document.getElementById('collectibles-export-pdf');

    if (
        !(form instanceof HTMLFormElement)
        || !(searchInput instanceof HTMLInputElement)
        || !(statusElement instanceof HTMLElement)
        || !(updatedElement instanceof HTMLElement)
        || !(resultsElement instanceof HTMLElement)
        || !(loadMoreButton instanceof HTMLButtonElement)
        || !(sortSelect instanceof HTMLSelectElement)
        || !(exportButton instanceof HTMLButtonElement)
    ) {
        return;
    }

    const brandInputs = Array.from(form.querySelectorAll('input[name="brand"]'))
        .filter((input) => input instanceof HTMLInputElement);

    const state = {
        q: '',
        brand: '',
        sort: 'name-asc',
        loaded: 0,
        total: 0,
        requestToken: 0,
        controller: null,
        debounceTimer: 0,
        loading: false,
        disclosureCount: 0,
    };

    const normalizeQuery = (value) => String(value ?? '').trim().slice(0, MAX_QUERY_LENGTH).trim();

    const normalizeBrand = (value) => {
        const brand = String(value ?? '').trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(BRANDS, brand) ? brand : '';
    };

    const normalizeSort = (value) => SORTS.has(String(value ?? '')) ? String(value) : 'name-asc';

    const isHttpsUrl = (value) => {
        if (typeof value !== 'string' || !value.startsWith('https://')) {
            return false;
        }

        try {
            return new URL(value).protocol === 'https:';
        } catch (error) {
            return false;
        }
    };

    const isSafeImageUrl = (value) => isHttpsUrl(value)
        || (typeof value === 'string'
            && /^\/assets\/images\/sonny-angels\/[A-Za-z0-9_./()@%+,&-]+$/.test(value)
            && !value.includes('/../')
            && !value.includes('/./'));

    const formatPrice = (cents, currency) => {
        if (typeof cents !== 'number' || !Number.isFinite(cents) || typeof currency !== 'string' || currency.trim() === '') {
            return null;
        }

        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: currency.trim().toUpperCase(),
            }).format(cents / 100);
        } catch (error) {
            return null;
        }
    };

    const formatTimestamp = (value) => {
        if (typeof value !== 'string' || value === '') {
            return null;
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return null;
        }

        try {
            return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
        } catch (error) {
            return date.toLocaleString();
        }
    };

    const brandLabel = (brand) => {
        const key = normalizeBrand(brand);
        if (key !== '') {
            return BRANDS[key];
        }

        return typeof brand === 'string' && brand.trim() !== '' ? brand.trim() : 'Collectible';
    };

    const createElement = (tagName, className, text) => {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }
        return element;
    };

    const createImage = (url, altText, className) => {
        if (!isSafeImageUrl(url)) {
            return null;
        }

        const image = document.createElement('img');
        image.className = className;
        image.alt = altText;
        image.loading = 'lazy';
        image.decoding = 'async';
        if (isHttpsUrl(url)) {
            image.referrerPolicy = 'no-referrer';
            image.setAttribute('referrerpolicy', 'no-referrer');
        }
        image.addEventListener('error', () => {
            const wrapper = image.parentElement;
            image.remove();
            if (wrapper instanceof HTMLElement && wrapper.dataset.imageWrapper === 'true') {
                wrapper.classList.add('is-missing');
            }
        });
        image.src = url;

        return image;
    };

    const setStatus = (message, tone) => {
        statusElement.textContent = message;
        statusElement.dataset.tone = tone || 'info';
    };

    const setUpdated = (lastSyncedAt) => {
        const formatted = formatTimestamp(lastSyncedAt);
        updatedElement.replaceChildren();

        if (formatted === null) {
            updatedElement.hidden = true;
            return;
        }

        const time = document.createElement('time');
        time.dateTime = lastSyncedAt;
        time.textContent = formatted;
        updatedElement.append('Last updated ', time);
        updatedElement.hidden = false;
    };

    const setLoading = (loading) => {
        state.loading = loading;
        resultsElement.setAttribute('aria-busy', loading ? 'true' : 'false');
        loadMoreButton.disabled = loading;
    };

    const updateLoadMore = (pageCount) => {
        loadMoreButton.hidden = !(state.loaded < state.total && pageCount > 0);
        loadMoreButton.textContent = 'Load more';
    };

    const setDisclosure = (toggle, expanded) => {
        const panelId = toggle.getAttribute('aria-controls');
        const panel = panelId ? document.getElementById(panelId) : null;
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const action = toggle.querySelector('.collectible-variants-action');
        if (action instanceof HTMLElement) {
            action.textContent = expanded ? 'Hide' : 'Show';
        }
        const card = toggle.closest('.collectible-card');
        if (card instanceof HTMLElement) {
            card.classList.toggle('is-expanded', expanded);
        }
        if (panel instanceof HTMLElement) {
            panel.hidden = !expanded;
        }
    };

    const disclosureToggles = () => Array.from(resultsElement.querySelectorAll('.collectible-variants-toggle'))
        .filter((toggle) => toggle instanceof HTMLButtonElement);

    let savedDisclosures = null;

    const expandDisclosuresForPrint = () => {
        if (savedDisclosures !== null) {
            return;
        }
        savedDisclosures = new Map();
        disclosureToggles().forEach((toggle) => {
            savedDisclosures.set(toggle, toggle.getAttribute('aria-expanded') === 'true');
            setDisclosure(toggle, true);
        });
    };

    const restoreDisclosuresAfterPrint = () => {
        if (savedDisclosures === null) {
            return;
        }
        const saved = savedDisclosures;
        savedDisclosures = null;
        disclosureToggles().forEach((toggle) => {
            if (saved.has(toggle)) {
                setDisclosure(toggle, saved.get(toggle) === true);
            }
        });
    };

    const renderVariant = (variant, product, productPrice) => {
        const safeVariant = variant && typeof variant === 'object' ? variant : {};
        const name = typeof safeVariant.name === 'string' && safeVariant.name.trim() !== '' ? safeVariant.name.trim() : 'Unnamed figure';
        const isSecret = safeVariant.is_secret === true;
        const item = createElement('li', 'collectible-variant');

        if (isSecret) {
            item.classList.add('is-secret');
        }

        const imageWrapper = createElement('div', 'collectible-variant-media');
        imageWrapper.dataset.imageWrapper = 'true';
        const image = createImage(
            safeVariant.image_url,
            `${name}${isSecret ? ' secret' : ''} figure from ${product.title}`,
            'collectible-variant-image'
        );
        if (image !== null) {
            imageWrapper.append(image);
        } else {
            imageWrapper.classList.add('is-missing');
        }
        item.append(imageWrapper);

        const body = createElement('div', 'collectible-variant-body');
        body.append(createElement('span', 'collectible-variant-name', name));

        if (isSecret) {
            body.append(createElement('span', 'collectible-secret', 'Secret'));
        }

        const ownPrice = formatPrice(safeVariant.price_cents, safeVariant.currency);
        if (ownPrice !== null) {
            const kind = ['retail', 'asking', 'sold'].includes(safeVariant.price_kind) ? safeVariant.price_kind : '';
            const price = createElement('span', 'collectible-variant-price', `${ownPrice}${kind ? ` ${kind}` : ''}`);
            if (isHttpsUrl(safeVariant.price_source_url)) {
                const source = createElement('a', 'collectible-price-source', 'Price source');
                source.href = safeVariant.price_source_url;
                source.target = '_blank';
                source.rel = 'noopener noreferrer';
                if (typeof safeVariant.price_observed_on === 'string' && safeVariant.price_observed_on !== '') {
                    source.textContent = `${kind || 'price'} · ${safeVariant.price_observed_on}`;
                }
                price.append(' · ', source);
            }
            body.append(price);
        } else if (productPrice !== null) {
            body.append(createElement('span', 'collectible-variant-price is-inherited', `${productPrice} per blind box`));
        }

        item.append(body);
        return item;
    };

    const renderProduct = (product) => {
        const safeProduct = product && typeof product === 'object' ? product : {};
        const title = typeof safeProduct.title === 'string' && safeProduct.title.trim() !== '' ? safeProduct.title.trim() : 'Untitled series';
        const label = brandLabel(safeProduct.brand);
        const variants = Array.isArray(safeProduct.variants) ? safeProduct.variants : [];
        const fallbackPrice = variants
            .filter((variant) => variant && typeof variant === 'object' && typeof variant.price_cents === 'number' && typeof variant.currency === 'string')
            .sort((left, right) => left.price_cents - right.price_cents)[0] || null;
        const productPrice = formatPrice(
            typeof safeProduct.price_cents === 'number' ? safeProduct.price_cents : fallbackPrice?.price_cents,
            typeof safeProduct.currency === 'string' ? safeProduct.currency : fallbackPrice?.currency
        );
        const productPriceKind = ['retail', 'asking', 'sold'].includes(safeProduct.price_kind)
            ? safeProduct.price_kind
            : (fallbackPrice && ['retail', 'asking', 'sold'].includes(fallbackPrice.price_kind) ? fallbackPrice.price_kind : '');
        const priceIsFromVariant = typeof safeProduct.price_cents !== 'number' && fallbackPrice !== null;

        const card = createElement('article', 'collectible-card');
        const brandKey = normalizeBrand(safeProduct.brand);
        if (brandKey !== '') {
            card.dataset.brand = brandKey;
        }

        const header = createElement('div', 'collectible-card-header');
        const mediaWrapper = createElement('div', 'collectible-card-media');
        mediaWrapper.dataset.imageWrapper = 'true';
        const productImage = createImage(safeProduct.image_url, `${title} (${label}) box art`, 'collectible-card-image');
        if (productImage !== null) {
            mediaWrapper.append(productImage);
        } else {
            mediaWrapper.classList.add('is-missing');
        }
        header.append(mediaWrapper);

        const summary = createElement('div', 'collectible-card-summary');
        summary.append(createElement('p', 'eyebrow collectible-brand', label));

        const heading = createElement('h3', 'collectible-title', title);
        heading.tabIndex = -1;
        summary.append(heading);

        if (Number.isInteger(safeProduct.release_year)) {
            summary.append(createElement('p', 'collectible-release', `Released ${safeProduct.release_year}`));
        }

        summary.append(createElement(
            'p',
            productPrice === null ? 'collectible-price is-unavailable' : 'collectible-price',
            productPrice === null
                ? 'Price unavailable'
                : `${priceIsFromVariant ? 'From ' : ''}${productPrice}${productPriceKind ? ` ${productPriceKind}` : ' per blind box'}`
        ));

        if (isHttpsUrl(safeProduct.product_url)) {
            const link = createElement('a', 'text-link collectible-source', 'View source listing');
            link.href = safeProduct.product_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.append(createElement('span', 'collectibles-sr-only', ` for ${title} (opens in a new tab)`));
            summary.append(link);
        }

        header.append(summary);
        card.append(header);

        const variantSection = createElement('div', 'collectible-variants');
        const countLabel = variants.length === 1 ? '1 variant' : `${variants.length} variants`;

        if (variants.length === 0) {
            variantSection.classList.add('is-empty');
            variantSection.append(createElement('h4', 'collectible-variants-title', countLabel));
            variantSection.append(createElement('p', 'collectible-variants-empty', 'No figure variants are listed for this series yet.'));
        } else {
            state.disclosureCount += 1;
            const panelId = `collectible-variants-${state.disclosureCount}`;
            const heading = createElement('h4', 'collectible-variants-title');
            const toggle = createElement('button', 'collectible-variants-toggle');
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-controls', panelId);
            toggle.append(
                createElement('span', 'collectible-variants-action', 'Show'),
                ' ',
                createElement('span', 'collectible-variants-count', countLabel),
                createElement('span', 'collectibles-sr-only', ` in ${title}`)
            );
            const icon = createElement('span', 'collectible-variants-icon');
            icon.setAttribute('aria-hidden', 'true');
            toggle.append(icon);
            heading.append(toggle);
            variantSection.append(heading);

            const panel = createElement('div', 'collectible-variants-panel');
            panel.id = panelId;
            panel.hidden = true;
            const list = createElement('ul', 'collectible-variant-list');
            variants.forEach((variant) => {
                list.append(renderVariant(variant, { title }, productPrice));
            });
            panel.append(list);
            variantSection.append(panel);

            toggle.addEventListener('click', () => {
                setDisclosure(toggle, toggle.getAttribute('aria-expanded') !== 'true');
            });
        }

        card.append(variantSection);
        return card;
    };

    const describeResults = () => {
        const productWord = state.total === 1 ? 'product' : 'products';
        if (state.loaded >= state.total) {
            return `Showing all ${state.total} ${productWord}.`;
        }

        return `Showing ${state.loaded} of ${state.total} ${productWord}.`;
    };

    const emptyMessage = (lastSyncedAt) => {
        if (lastSyncedAt === null || lastSyncedAt === undefined || lastSyncedAt === '') {
            return { text: 'The collectibles catalog has not been synced yet. Check back after the next pull.', tone: 'empty' };
        }

        if (state.q !== '' || state.brand !== '') {
            const parts = [];
            if (state.q !== '') {
                parts.push(`"${state.q}"`);
            }
            if (state.brand !== '') {
                parts.push(`in ${BRANDS[state.brand]}`);
            }
            return { text: `No collectibles match ${parts.join(' ')}. Try a different name or line.`, tone: 'empty' };
        }

        return { text: 'The latest sync found no collectibles on the shelf.', tone: 'empty' };
    };

    const errorMessage = async (response) => {
        if (response.status === 422) {
            try {
                const payload = await response.json();
                if (payload && typeof payload === 'object' && payload.details && typeof payload.details === 'object' && payload.details.brand) {
                    return 'That line filter is not available. Choose All, Skullpanda, Nommi, or Sonny Angel.';
                }
            } catch (error) {
                // Fall through to the generic search message.
            }

            return 'That search could not be used. Try a shorter or simpler search.';
        }

        return 'The collectibles shelf would not load. Try again in a moment.';
    };

    const syncUrl = () => {
        const params = new URLSearchParams(window.location.search);
        params.delete('q');
        params.delete('brand');
        params.delete('sort');
        if (state.q !== '') {
            params.set('q', state.q);
        }
        if (state.brand !== '') {
            params.set('brand', state.brand);
        }
        if (state.sort !== 'name-asc') {
            params.set('sort', state.sort);
        }

        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query !== '' ? `?${query}` : ''}${window.location.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

        if (nextUrl !== currentUrl && window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(null, '', nextUrl);
        }
    };

    const load = async (reset) => {
        state.requestToken += 1;
        const token = state.requestToken;

        if (state.controller !== null) {
            state.controller.abort();
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        state.controller = controller;

        if (reset) {
            state.loaded = 0;
            state.total = 0;
            resultsElement.replaceChildren();
            loadMoreButton.hidden = true;
            syncUrl();
        }

        const offset = state.loaded;
        const params = new URLSearchParams();
        if (state.q !== '') {
            params.set('q', state.q);
        }
        if (state.brand !== '') {
            params.set('brand', state.brand);
        }
        params.set('sort', state.sort);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));

        setLoading(true);
        setStatus(reset ? 'Loading collectibles...' : 'Loading more collectibles...', 'loading');
        if (!reset) {
            loadMoreButton.textContent = 'Loading...';
        }

        try {
            const response = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
                signal: controller !== null ? controller.signal : undefined,
            });

            if (token !== state.requestToken) {
                return;
            }

            if (!response.ok) {
                const message = await errorMessage(response);
                if (token !== state.requestToken) {
                    return;
                }
                throw new Error(message);
            }

            const payload = await response.json();
            if (token !== state.requestToken) {
                return;
            }

            const items = payload && Array.isArray(payload.data) ? payload.data : [];
            const meta = payload && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
            const total = Number.isInteger(meta.total) && meta.total >= 0 ? meta.total : offset + items.length;
            const lastSyncedAt = typeof meta.last_synced_at === 'string' ? meta.last_synced_at : null;

            const fragment = document.createDocumentFragment();
            const newCards = items.map((item) => renderProduct(item));
            newCards.forEach((card) => fragment.append(card));
            resultsElement.append(fragment);

            state.loaded = offset + items.length;
            state.total = Math.max(total, state.loaded);
            setUpdated(lastSyncedAt);
            setLoading(false);
            updateLoadMore(items.length);

            if (state.loaded === 0) {
                const empty = emptyMessage(lastSyncedAt);
                setStatus(empty.text, empty.tone);
                return;
            }

            setStatus(describeResults(), 'success');

            if (!reset && loadMoreButton.hidden && newCards.length > 0) {
                const firstHeading = newCards[0].querySelector('.collectible-title');
                if (firstHeading instanceof HTMLElement) {
                    firstHeading.focus();
                }
            }
        } catch (error) {
            if (token !== state.requestToken) {
                return;
            }

            const message = error instanceof Error && error.name !== 'AbortError' && error.message !== ''
                && !(error instanceof TypeError)
                && !(error instanceof SyntaxError)
                ? error.message
                : 'The collectibles shelf would not load. Try again in a moment.';

            setLoading(false);
            setStatus(message, 'error');
            loadMoreButton.textContent = 'Load more';
            loadMoreButton.hidden = !(state.loaded > 0 && state.loaded < state.total);
        } finally {
            if (token === state.requestToken) {
                state.controller = null;
            }
        }
    };

    const applyFormState = () => {
        const q = normalizeQuery(searchInput.value);
        const checked = brandInputs.find((input) => input.checked);
        const brand = normalizeBrand(checked ? checked.value : '');
        const sort = normalizeSort(sortSelect.value);

        if (q === state.q && brand === state.brand && sort === state.sort && state.loaded > 0) {
            return;
        }

        state.q = q;
        state.brand = brand;
        state.sort = sort;
        load(true);
    };

    const cancelDebounce = () => {
        if (state.debounceTimer !== 0) {
            window.clearTimeout(state.debounceTimer);
            state.debounceTimer = 0;
        }
    };

    searchInput.addEventListener('input', () => {
        cancelDebounce();
        state.debounceTimer = window.setTimeout(() => {
            state.debounceTimer = 0;
            applyFormState();
        }, SEARCH_DEBOUNCE_MS);
    });

    brandInputs.forEach((input) => {
        input.addEventListener('change', () => {
            cancelDebounce();
            applyFormState();
        });
    });

    sortSelect.addEventListener('change', () => {
        cancelDebounce();
        applyFormState();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        cancelDebounce();
        applyFormState();
    });

    loadMoreButton.addEventListener('click', () => {
        if (state.loading || state.loaded >= state.total) {
            return;
        }

        load(false);
    });

    let printTitle = null;
    const restorePrint = () => {
        if (printTitle === null) return;
        document.title = printTitle;
        printTitle = null;
        document.documentElement.classList.remove('collectibles-printing');
        exportButton.disabled = false;
        exportButton.removeAttribute('aria-busy');
        exportButton.textContent = 'Export PDF';
    };
    window.addEventListener('beforeprint', expandDisclosuresForPrint);
    window.addEventListener('afterprint', () => {
        restoreDisclosuresAfterPrint();
        restorePrint();
    });
    exportButton.addEventListener('click', async () => {
        if (state.loading) return;
        exportButton.disabled = true;
        exportButton.setAttribute('aria-busy', 'true');
        exportButton.textContent = 'Preparing PDF…';
        let previousLoaded = -1;
        while (state.loaded < state.total && state.loaded !== previousLoaded) {
            previousLoaded = state.loaded;
            await load(false);
        }
        printTitle = document.title;
        document.title = 'Collectibles catalog';
        document.documentElement.classList.add('collectibles-printing');
        expandDisclosuresForPrint();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.print();
    });

    const initialParams = new URLSearchParams(window.location.search);
    state.q = normalizeQuery(initialParams.get('q'));
    state.brand = normalizeBrand(initialParams.get('brand'));
    state.sort = normalizeSort(initialParams.get('sort'));
    searchInput.value = state.q;
    sortSelect.value = state.sort;
    brandInputs.forEach((input) => {
        input.checked = normalizeBrand(input.value) === state.brand;
    });

    load(true);
})();

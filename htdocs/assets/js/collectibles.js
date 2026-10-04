(() => {
    const API_ENDPOINT = '/api/v1/collectibles';
    const PAGE_SIZE = 48;
    const MAX_QUERY_LENGTH = 100;
    const SEARCH_DEBOUNCE_MS = 250;
    const INVENTORY_STORAGE_KEY = 'collectibles-inventory:v1';
    const INVENTORY_VERSION = 1;
    const INVENTORY_FILTERS = new Set(['all', 'owned', 'missing']);
    const BRANDS = {
        skullpanda: 'SKULLPANDA',
        nommi: 'Nommi',
        'sonny-angel': 'Sonny Angel',
    };
    const SORTS = new Set(['name-asc', 'name-desc', 'price-asc', 'price-desc', 'newest', 'oldest']);

    const inventoryKey = (productId, variantName) => JSON.stringify([String(productId), variantName]);

    const isInventoryKey = (value) => {
        try {
            const parts = JSON.parse(value);
            return Array.isArray(parts)
                && parts.length === 2
                && parts.every((part) => typeof part === 'string');
        } catch (error) {
            return false;
        }
    };

    const parseQuantity = (value) => {
        const text = String(value ?? '').trim();
        if (text === '') {
            return { valid: true, quantity: 0 };
        }
        if (!/^(0|[1-9][0-9]*)$/.test(text)) {
            return { valid: false, quantity: null };
        }
        const quantity = Number(text);
        return Number.isSafeInteger(quantity)
            ? { valid: true, quantity }
            : { valid: false, quantity: null };
    };

    const decodeInventory = (raw) => {
        if (typeof raw !== 'string' || raw === '') {
            return new Map();
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || parsed.version !== INVENTORY_VERSION
            || !parsed.quantities || typeof parsed.quantities !== 'object' || Array.isArray(parsed.quantities)) {
            throw new TypeError('Unsupported inventory data');
        }
        const quantities = new Map();
        Object.entries(parsed.quantities).forEach(([key, value]) => {
            if (isInventoryKey(key) && Number.isSafeInteger(value) && value > 0) {
                quantities.set(key, value);
            }
        });
        return quantities;
    };

    const createInventoryStore = (storage, reportPersistence) => {
        let quantities = new Map();
        let persistent = storage !== null && typeof storage === 'object';

        if (persistent) {
            try {
                const probeKey = `${INVENTORY_STORAGE_KEY}:probe`;
                storage.setItem(probeKey, '1');
                storage.removeItem(probeKey);
                try {
                    quantities = decodeInventory(storage.getItem(INVENTORY_STORAGE_KEY));
                } catch (error) {
                    quantities = new Map();
                }
            } catch (error) {
                persistent = false;
            }
        }

        const report = () => {
            if (typeof reportPersistence === 'function') {
                reportPersistence(persistent);
            }
        };

        const persist = () => {
            if (!persistent) {
                report();
                return;
            }
            const serialized = {};
            quantities.forEach((quantity, key) => {
                if (quantity > 0) {
                    serialized[key] = quantity;
                }
            });
            try {
                storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({
                    version: INVENTORY_VERSION,
                    quantities: serialized,
                }));
            } catch (error) {
                persistent = false;
            }
            report();
        };

        report();
        return {
            get(key) {
                return quantities.get(key) || 0;
            },
            set(key, quantity) {
                if (!Number.isSafeInteger(quantity) || quantity < 0) {
                    return false;
                }
                if (quantity === 0) {
                    quantities.delete(key);
                } else {
                    quantities.set(key, quantity);
                }
                persist();
                return true;
            },
            snapshot() {
                return new Map(quantities);
            },
            isPersistent() {
                return persistent;
            },
        };
    };

    const normalizeInventoryFilter = (value) => INVENTORY_FILTERS.has(String(value)) ? String(value) : 'all';
    const isOwnedQuantity = (quantity) => Number.isSafeInteger(quantity) && quantity > 0;
    const quantityMatchesFilter = (quantity, filter) => filter === 'all'
        || (filter === 'owned' ? isOwnedQuantity(quantity) : quantity === 0);
    const quantityForOwnedToggle = (checked, committedQuantity) => checked
        ? Math.max(1, Number.isSafeInteger(committedQuantity) && committedQuantity >= 0 ? committedQuantity : 0)
        : 0;
    const isThumbnailActivationKey = (key) => key === 'Enter' || key === ' ';
    const setExpandedControl = (control, expanded) => {
        control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        control.classList.toggle('is-expanded', expanded);
        return expanded;
    };
    const partialFailureMessage = (message, loaded, total) => loaded > 0 && loaded < total
        ? `${message} Partial inventory results are shown; retry to finish loading.`
        : message;

    const filterVariantIdentities = (products, filter, getQuantity) => {
        const normalizedFilter = normalizeInventoryFilter(filter);
        const matches = [];
        (Array.isArray(products) ? products : []).forEach((product) => {
            const safeProduct = product && typeof product === 'object' ? product : {};
            (Array.isArray(safeProduct.variants) ? safeProduct.variants : []).forEach((variant) => {
                const identityName = variant && typeof variant.name === 'string' ? variant.name : 'Unnamed figure';
                const key = inventoryKey(safeProduct.id, identityName);
                if (quantityMatchesFilter(getQuantity(key), normalizedFilter)) {
                    matches.push(key);
                }
            });
        });
        return matches;
    };

    const createRequestGate = () => {
        let current = 0;
        return {
            next() {
                current += 1;
                return current;
            },
            isCurrent(token) {
                return token === current;
            },
        };
    };

    const testHooks = /** @type {Window & typeof globalThis & { __collectiblesInventoryTest?: Record<string, unknown> }} */ (window).__collectiblesInventoryTest;
    if (testHooks && typeof testHooks === 'object') {
        Object.assign(testHooks, {
            INVENTORY_STORAGE_KEY,
            INVENTORY_VERSION,
            inventoryKey,
            parseQuantity,
            decodeInventory,
            createInventoryStore,
            normalizeInventoryFilter,
            isOwnedQuantity,
            quantityMatchesFilter,
            quantityForOwnedToggle,
            isThumbnailActivationKey,
            setExpandedControl,
            partialFailureMessage,
            filterVariantIdentities,
            createRequestGate,
        });
    }

    const form = document.getElementById('collectibles-form');
    const searchInput = document.getElementById('collectibles-search-input');
    const statusElement = document.getElementById('collectibles-status');
    const storageStatusElement = document.getElementById('collectibles-storage-status');
    const updatedElement = document.getElementById('collectibles-updated');
    const resultsElement = document.getElementById('collectibles-results');
    const loadMoreButton = document.getElementById('collectibles-load-more');
    const sortSelect = document.getElementById('collectibles-sort');
    const exportButton = document.getElementById('collectibles-export-pdf');

    if (
        !(form instanceof HTMLFormElement)
        || !(searchInput instanceof HTMLInputElement)
        || !(statusElement instanceof HTMLElement)
        || !(storageStatusElement instanceof HTMLElement)
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
    const inventoryFilterInputs = Array.from(form.querySelectorAll('input[name="inventory"]'))
        .filter((input) => input instanceof HTMLInputElement);

    const requestGate = createRequestGate();
    const state = {
        q: '',
        brand: '',
        sort: 'name-asc',
        inventoryFilter: 'all',
        loaded: 0,
        total: 0,
        controller: null,
        debounceTimer: 0,
        loading: false,
        disclosureCount: 0,
        products: [],
        openProducts: new Set(),
        lastSyncedAt: null,
    };

    const setStorageStatus = (persistent) => {
        storageStatusElement.textContent = persistent
            ? 'Inventory is saved in this browser.'
            : 'Inventory changes are kept for this session, but are not saved.';
        storageStatusElement.dataset.saved = persistent ? 'true' : 'false';
    };

    let browserStorage = null;
    try {
        browserStorage = window.localStorage;
    } catch (error) {
        browserStorage = null;
    }
    const inventory = createInventoryStore(browserStorage, setStorageStatus);

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

    const createImage = (url, altText, className, onError) => {
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
            if (typeof onError === 'function') {
                onError(wrapper);
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
            const productKey = card.dataset.productKey;
            if (productKey) {
                if (expanded) state.openProducts.add(productKey);
                else state.openProducts.delete(productKey);
            }
        }
        if (panel instanceof HTMLElement) {
            panel.hidden = !expanded;
        }
    };

    const setThumbnailExpanded = (button, expanded) => {
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
            return;
        }
        setExpandedControl(button, expanded);
        const row = button.closest('.collectible-inventory-row');
        if (row instanceof HTMLElement) {
            row.classList.toggle('is-image-expanded', expanded);
        }
    };

    const disclosureToggles = () => Array.from(resultsElement.querySelectorAll('.collectible-variants-toggle'))
        .filter((toggle) => toggle instanceof HTMLButtonElement);
    const thumbnailToggles = () => Array.from(resultsElement.querySelectorAll('.collectible-thumbnail-toggle'))
        .filter((toggle) => toggle instanceof HTMLButtonElement && !toggle.disabled);

    let savedDisclosures = null;
    let savedThumbnails = null;

    const prepareForPrint = () => {
        if (savedDisclosures === null) {
            savedDisclosures = new Map();
            disclosureToggles().forEach((toggle) => {
                savedDisclosures.set(toggle, toggle.getAttribute('aria-expanded') === 'true');
                setDisclosure(toggle, true);
            });
        }
        if (savedThumbnails === null) {
            savedThumbnails = new Map();
            thumbnailToggles().forEach((toggle) => {
                savedThumbnails.set(toggle, toggle.getAttribute('aria-expanded') === 'true');
                setThumbnailExpanded(toggle, false);
            });
        }
    };

    const restoreAfterPrint = () => {
        if (savedDisclosures !== null) {
            const saved = savedDisclosures;
            savedDisclosures = null;
            disclosureToggles().forEach((toggle) => {
                if (saved.has(toggle)) setDisclosure(toggle, saved.get(toggle) === true);
            });
        }
        if (savedThumbnails !== null) {
            const saved = savedThumbnails;
            savedThumbnails = null;
            thumbnailToggles().forEach((toggle) => {
                if (saved.has(toggle)) setThumbnailExpanded(toggle, saved.get(toggle) === true);
            });
        }
    };

    const visibleInventoryCounts = () => {
        const rows = Array.from(resultsElement.querySelectorAll('.collectible-inventory-row'))
            .filter((row) => row instanceof HTMLElement && !row.hidden);
        const products = new Set();
        rows.forEach((row) => {
            const card = row.closest('.collectible-card');
            if (card instanceof HTMLElement) products.add(card);
        });
        return { figures: rows.length, products: products.size };
    };

    const describeResults = () => {
        if (state.inventoryFilter !== 'all') {
            const counts = visibleInventoryCounts();
            const filterLabel = state.inventoryFilter === 'owned' ? 'owned' : 'missing';
            const figureWord = counts.figures === 1 ? 'figure' : 'figures';
            const productWord = counts.products === 1 ? 'set' : 'sets';
            return counts.figures === 0
                ? `No ${filterLabel} figures match these catalog controls.`
                : `Showing ${counts.figures} ${filterLabel} ${figureWord} across ${counts.products} ${productWord}.`;
        }
        const productWord = state.total === 1 ? 'product' : 'products';
        return state.loaded >= state.total
            ? `Showing all ${state.total} ${productWord}.`
            : `Showing ${state.loaded} of ${state.total} ${productWord}.`;
    };

    const applyInventoryVisibility = () => {
        Array.from(resultsElement.querySelectorAll('.collectible-inventory-row')).forEach((row) => {
            if (!(row instanceof HTMLElement)) return;
            const quantity = Number(row.dataset.quantity || '0');
            row.hidden = !quantityMatchesFilter(quantity, state.inventoryFilter);
        });
        Array.from(resultsElement.querySelectorAll('.collectible-card')).forEach((card) => {
            if (!(card instanceof HTMLElement)) return;
            const rows = Array.from(card.querySelectorAll('.collectible-inventory-row'))
                .filter((row) => row instanceof HTMLElement);
            card.hidden = state.inventoryFilter !== 'all'
                && (rows.length === 0 || rows.every((row) => row.hidden));
        });
        if (!state.loading) {
            setStatus(describeResults(), state.inventoryFilter !== 'all' && visibleInventoryCounts().figures === 0 ? 'empty' : 'success');
        }
    };

    const updateRowQuantity = (row, checkbox, quantityInput, ownedPrint, quantityPrint, quantity) => {
        row.dataset.quantity = String(quantity);
        checkbox.checked = isOwnedQuantity(quantity);
        quantityInput.value = String(quantity);
        quantityInput.dataset.committed = String(quantity);
        quantityInput.removeAttribute('aria-invalid');
        quantityInput.setCustomValidity('');
        ownedPrint.textContent = isOwnedQuantity(quantity) ? 'Yes' : 'No';
        quantityPrint.textContent = String(quantity);
    };

    const renderVariantRow = (variant, product, productPrice) => {
        const safeVariant = variant && typeof variant === 'object' ? variant : {};
        const identityName = typeof safeVariant.name === 'string' ? safeVariant.name : 'Unnamed figure';
        const name = identityName.trim() !== '' ? identityName.trim() : 'Unnamed figure';
        const isSecret = safeVariant.is_secret === true;
        const key = inventoryKey(product.id, identityName);
        const quantity = inventory.get(key);
        const row = createElement('tr', 'collectible-inventory-row');
        row.dataset.inventoryKey = key;
        row.dataset.quantity = String(quantity);
        if (isSecret) row.classList.add('is-secret');

        const imageCell = createElement('td', 'collectible-inventory-thumbnail');
        const imageButton = createElement('button', 'collectible-thumbnail-toggle');
        imageButton.type = 'button';
        imageButton.dataset.imageWrapper = 'true';
        imageButton.setAttribute('aria-expanded', 'false');
        imageButton.setAttribute('aria-label', `Expand thumbnail for ${name} in ${product.title}`);
        const image = createImage(
            safeVariant.image_url,
            `${name}${isSecret ? ' secret' : ''} figure from ${product.title}`,
            'collectible-variant-image',
            () => {
                imageButton.disabled = true;
                imageButton.removeAttribute('aria-expanded');
                imageButton.setAttribute('aria-label', `No image available for ${name} in ${product.title}`);
                imageButton.replaceChildren(createElement('span', 'collectible-image-missing', 'No image'));
            }
        );
        if (image !== null) {
            imageButton.append(image);
            imageButton.addEventListener('click', () => {
                setThumbnailExpanded(imageButton, imageButton.getAttribute('aria-expanded') !== 'true');
            });
            imageButton.addEventListener('keydown', (event) => {
                if (isThumbnailActivationKey(event.key)) {
                    event.preventDefault();
                    setThumbnailExpanded(imageButton, imageButton.getAttribute('aria-expanded') !== 'true');
                }
            });
        } else {
            imageButton.disabled = true;
            imageButton.classList.add('is-missing');
            imageButton.removeAttribute('aria-expanded');
            imageButton.setAttribute('aria-label', `No image available for ${name} in ${product.title}`);
            imageButton.append(createElement('span', 'collectible-image-missing', 'No image'));
        }
        imageCell.append(imageButton);
        row.append(imageCell);

        const nameCell = createElement('th', 'collectible-inventory-name');
        nameCell.scope = 'row';
        nameCell.append(createElement('span', 'collectible-variant-name', name));
        if (isSecret) nameCell.append(createElement('span', 'collectible-secret', 'Secret'));
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
            nameCell.append(price);
        } else if (productPrice !== null) {
            nameCell.append(createElement('span', 'collectible-variant-price is-inherited', `${productPrice} per blind box`));
        }
        row.append(nameCell);

        const ownedCell = createElement('td', 'collectible-inventory-owned');
        const ownedLabel = createElement('label', 'collectible-inventory-owned-control');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isOwnedQuantity(quantity);
        checkbox.setAttribute('aria-label', `Owned: ${name} in ${product.title}`);
        ownedLabel.append(checkbox, createElement('span', 'collectibles-sr-only', `Owned: ${name} in ${product.title}`));
        const ownedPrint = createElement('span', 'collectible-owned-print', isOwnedQuantity(quantity) ? 'Yes' : 'No');
        ownedCell.append(ownedLabel, ownedPrint);
        row.append(ownedCell);

        const quantityCell = createElement('td', 'collectible-inventory-quantity');
        const quantityInput = document.createElement('input');
        quantityInput.type = 'text';
        quantityInput.inputMode = 'numeric';
        quantityInput.pattern = '[0-9]*';
        quantityInput.value = String(quantity);
        quantityInput.dataset.committed = String(quantity);
        quantityInput.autocomplete = 'off';
        quantityInput.setAttribute('aria-label', `Quantity owned: ${name} in ${product.title}`);
        const quantityPrint = createElement('span', 'collectible-quantity-print', quantity);
        quantityCell.append(quantityInput, quantityPrint);
        row.append(quantityCell);

        const commitQuantity = () => {
            const parsed = parseQuantity(quantityInput.value);
            if (!parsed.valid) {
                const previous = Number(quantityInput.dataset.committed || '0');
                quantityInput.value = String(previous);
                quantityInput.setAttribute('aria-invalid', 'true');
                setStatus(`Quantity for ${name} was not changed. Enter a nonnegative whole number.`, 'error');
                return;
            }
            inventory.set(key, parsed.quantity);
            updateRowQuantity(row, checkbox, quantityInput, ownedPrint, quantityPrint, parsed.quantity);
            applyInventoryVisibility();
        };

        checkbox.addEventListener('change', () => {
            const nextQuantity = quantityForOwnedToggle(checkbox.checked, Number(quantityInput.dataset.committed || '0'));
            inventory.set(key, nextQuantity);
            updateRowQuantity(row, checkbox, quantityInput, ownedPrint, quantityPrint, nextQuantity);
            applyInventoryVisibility();
        });
        quantityInput.addEventListener('input', () => {
            quantityInput.removeAttribute('aria-invalid');
            quantityInput.setCustomValidity('');
        });
        quantityInput.addEventListener('change', commitQuantity);
        quantityInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commitQuantity();
            }
        });

        return row;
    };

    const renderProduct = (product) => {
        const safeProduct = product && typeof product === 'object' ? product : {};
        const productId = String(safeProduct.id);
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
        card.dataset.productKey = productId;
        const brandKey = normalizeBrand(safeProduct.brand);
        if (brandKey !== '') card.dataset.brand = brandKey;

        const header = createElement('div', 'collectible-card-header');
        const mediaWrapper = createElement('div', 'collectible-card-media');
        mediaWrapper.dataset.imageWrapper = 'true';
        const productImage = createImage(safeProduct.image_url, `${title} (${label}) box art`, 'collectible-card-image');
        if (productImage !== null) mediaWrapper.append(productImage);
        else mediaWrapper.classList.add('is-missing');
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
            const headingElement = createElement('h4', 'collectible-variants-title');
            const toggle = createElement('button', 'collectible-variants-toggle');
            toggle.type = 'button';
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
            headingElement.append(toggle);
            variantSection.append(headingElement);

            const panel = createElement('div', 'collectible-variants-panel');
            panel.id = panelId;
            const tableWrap = createElement('div', 'collectible-inventory-scroll');
            const table = createElement('table', 'collectible-inventory-table');
            table.append(createElement('caption', 'collectibles-sr-only', `Inventory for ${title}`));
            const tableHead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['Thumbnail', 'Figure', 'Owned', 'Quantity'].forEach((text) => {
                const cell = document.createElement('th');
                cell.scope = 'col';
                cell.textContent = text;
                headerRow.append(cell);
            });
            tableHead.append(headerRow);
            table.append(tableHead);
            const tableBody = document.createElement('tbody');
            variants.forEach((variant) => {
                tableBody.append(renderVariantRow(variant, { id: productId, title }, productPrice));
            });
            table.append(tableBody);
            tableWrap.append(table);
            panel.append(tableWrap);
            variantSection.append(panel);

            const expanded = state.openProducts.has(productId);
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            panel.hidden = !expanded;
            if (expanded) {
                card.classList.add('is-expanded');
                const action = toggle.querySelector('.collectible-variants-action');
                if (action instanceof HTMLElement) action.textContent = 'Hide';
            }
            toggle.addEventListener('click', () => {
                setDisclosure(toggle, toggle.getAttribute('aria-expanded') !== 'true');
            });
        }
        card.append(variantSection);
        return card;
    };

    const renderCatalog = () => {
        state.disclosureCount = 0;
        const fragment = document.createDocumentFragment();
        state.products.forEach((product) => fragment.append(renderProduct(product)));
        resultsElement.replaceChildren(fragment);
        applyInventoryVisibility();
    };

    const emptyMessage = (lastSyncedAt) => {
        if (lastSyncedAt === null || lastSyncedAt === undefined || lastSyncedAt === '') {
            return { text: 'The collectibles catalog has not been synced yet. Check back after the next pull.', tone: 'empty' };
        }
        if (state.q !== '' || state.brand !== '') {
            const parts = [];
            if (state.q !== '') parts.push(`"${state.q}"`);
            if (state.brand !== '') parts.push(`in ${BRANDS[state.brand]}`);
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
        if (state.q !== '') params.set('q', state.q);
        if (state.brand !== '') params.set('brand', state.brand);
        if (state.sort !== 'name-asc') params.set('sort', state.sort);
        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query !== '' ? `?${query}` : ''}${window.location.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextUrl !== currentUrl && window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(null, '', nextUrl);
        }
    };

    const updateLoadMore = (pageCount) => {
        loadMoreButton.hidden = !(state.loaded < state.total && (pageCount > 0 || state.loaded > 0));
        loadMoreButton.textContent = state.inventoryFilter === 'all' ? 'Load more' : 'Finish loading inventory';
    };

    const load = async (reset, completeCatalog = state.inventoryFilter !== 'all') => {
        const token = requestGate.next();
        if (state.controller !== null) state.controller.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        state.controller = controller;

        if (reset) {
            state.loaded = 0;
            state.total = 0;
            state.products = [];
            resultsElement.replaceChildren();
            loadMoreButton.hidden = true;
            syncUrl();
        }

        let pageCount = 0;
        setLoading(true);
        setStatus(reset ? 'Loading collectibles...' : 'Loading more collectibles...', 'loading');
        if (!reset) loadMoreButton.textContent = 'Loading...';

        try {
            do {
                const offset = state.loaded;
                const params = new URLSearchParams();
                if (state.q !== '') params.set('q', state.q);
                if (state.brand !== '') params.set('brand', state.brand);
                params.set('sort', state.sort);
                params.set('limit', String(PAGE_SIZE));
                params.set('offset', String(offset));

                const response = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin',
                    signal: controller !== null ? controller.signal : undefined,
                });
                if (!requestGate.isCurrent(token)) return false;
                if (!response.ok) {
                    const message = await errorMessage(response);
                    if (!requestGate.isCurrent(token)) return false;
                    throw new Error(message);
                }
                const payload = await response.json();
                if (!requestGate.isCurrent(token)) return false;
                const items = payload && Array.isArray(payload.data) ? payload.data : [];
                const meta = payload && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
                const total = Number.isInteger(meta.total) && meta.total >= 0 ? meta.total : offset + items.length;
                state.lastSyncedAt = typeof meta.last_synced_at === 'string' ? meta.last_synced_at : state.lastSyncedAt;
                state.products.push(...items);
                state.loaded = offset + items.length;
                state.total = Math.max(total, state.loaded);
                pageCount = items.length;
                renderCatalog();
                setUpdated(state.lastSyncedAt);
                if (completeCatalog && state.loaded < state.total) {
                    if (items.length === 0) {
                        throw new Error('The collectibles shelf stopped before the inventory filter finished loading.');
                    }
                    setStatus(`Loading all matching products for inventory (${state.loaded} of ${state.total})...`, 'loading');
                }
                if (!completeCatalog || items.length === 0) break;
            } while (state.loaded < state.total);

            if (!requestGate.isCurrent(token)) return false;
            setLoading(false);
            updateLoadMore(pageCount);
            if (state.loaded === 0) {
                const empty = emptyMessage(state.lastSyncedAt);
                setStatus(empty.text, empty.tone);
                return true;
            }
            applyInventoryVisibility();
            return true;
        } catch (error) {
            if (!requestGate.isCurrent(token)) return false;
            const message = error instanceof Error && error.name !== 'AbortError' && error.message !== ''
                && !(error instanceof TypeError) && !(error instanceof SyntaxError)
                ? error.message
                : 'The collectibles shelf would not load. Try again in a moment.';
            setLoading(false);
            setStatus(partialFailureMessage(message, state.loaded, state.total), 'error');
            updateLoadMore(state.loaded > 0 ? 1 : 0);
            return false;
        } finally {
            if (requestGate.isCurrent(token)) state.controller = null;
        }
    };

    const applyFormState = () => {
        const q = normalizeQuery(searchInput.value);
        const checkedBrand = brandInputs.find((input) => input.checked);
        const brand = normalizeBrand(checkedBrand ? checkedBrand.value : '');
        const sort = normalizeSort(sortSelect.value);
        if (q === state.q && brand === state.brand && sort === state.sort && state.loaded > 0) return;
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
    brandInputs.forEach((input) => input.addEventListener('change', () => {
        cancelDebounce();
        applyFormState();
    }));
    inventoryFilterInputs.forEach((input) => input.addEventListener('change', () => {
        if (!input.checked) return;
        cancelDebounce();
        state.inventoryFilter = normalizeInventoryFilter(input.value);
        if (state.loading || (state.inventoryFilter !== 'all' && state.loaded < state.total)) {
            load(true, state.inventoryFilter !== 'all');
        } else {
            applyInventoryVisibility();
            updateLoadMore(1);
        }
    }));
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
        if (state.loading || state.loaded >= state.total) return;
        load(false, state.inventoryFilter !== 'all');
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
    window.addEventListener('beforeprint', prepareForPrint);
    window.addEventListener('afterprint', () => {
        restoreAfterPrint();
        restorePrint();
    });
    exportButton.addEventListener('click', async () => {
        if (state.loading) return;
        exportButton.disabled = true;
        exportButton.setAttribute('aria-busy', 'true');
        exportButton.textContent = 'Preparing PDF…';
        if (state.loaded < state.total) {
            const completed = await load(false, true);
            if (!completed || state.loaded < state.total) {
                restorePrint();
                exportButton.disabled = false;
                exportButton.removeAttribute('aria-busy');
                exportButton.textContent = 'Export PDF';
                return;
            }
        }
        printTitle = document.title;
        document.title = 'Collectibles catalog';
        document.documentElement.classList.add('collectibles-printing');
        prepareForPrint();
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
    inventoryFilterInputs.forEach((input) => {
        input.checked = normalizeInventoryFilter(input.value) === state.inventoryFilter;
    });

    load(true);
})();

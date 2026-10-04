// Production caches static JavaScript for seven days and the page versions
// only this file, so the inventory module carries the first 12 hex digits of
// its own SHA-256; a browser still holding an older copy would otherwise fail
// to link and leave the shelf stuck loading. tests/collectibles-inventory.test.mjs
// fails when the token is stale and prints the expected one. TypeScript cannot
// resolve a query-string specifier, so the namespace is cast to the unversioned
// module's type below.
// @ts-ignore
import * as inventoryModule from './collectibles-inventory.js?v=adcf471780c3';

const {
    INVENTORY_STORAGE_KEY,
    PAGE_SIZE,
    BRANDS,
    inventoryKey,
    parseQuantity,
    createInventoryStore,
    normalizeInventoryFilter,
    isOwnedQuantity,
    quantityMatchesFilter,
    quantityForOwnedToggle,
    isThumbnailActivationKey,
    setExpandedControl,
    partialFailureMessage,
    parseYearList,
    parseIdList,
    requestedYears,
    describeYears,
    yearChoicesFromFacets,
    matchChoices,
    newestFacetYear,
    seriesChoicesFromFacets,
    applyInventoryVisibility,
    catalogRequestParams,
    appendCatalogPage,
    isReleaseExpanded,
    createRequestGate,
    LINE_ORDER,
    lineLabel,
    normalizeLine,
    unclassifiedSeriesId,
    unclassifiedSeriesTitle,
    titleWithoutBrand,
} = /** @type {typeof import('./collectibles-inventory.js')} */ (inventoryModule);

(() => {
    const API_ENDPOINT = '/api/v1/collectibles';
    const MAX_QUERY_LENGTH = 100;
    const SEARCH_DEBOUNCE_MS = 250;
    const SORTS = new Set(['name-asc', 'name-desc', 'price-asc', 'price-desc', 'newest', 'oldest']);

    const form = document.getElementById('collectibles-form');
    const searchInput = document.getElementById('collectibles-search-input');
    const statusElement = document.getElementById('collectibles-status');
    const storageStatusElement = document.getElementById('collectibles-storage-status');
    const updatedElement = document.getElementById('collectibles-updated');
    const resultsElement = document.getElementById('collectibles-results');
    const loadMoreButton = document.getElementById('collectibles-load-more');
    const yearInput = document.getElementById('collectibles-year-input');
    const yearOptions = document.getElementById('collectibles-year-options');
    const yearChips = document.getElementById('collectibles-year-chips');
    const seriesInput = document.getElementById('collectibles-series-input');
    const seriesOptions = document.getElementById('collectibles-series-options');
    const seriesChips = document.getElementById('collectibles-series-chips');
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
        || !(yearInput instanceof HTMLInputElement)
        || !(yearOptions instanceof HTMLElement)
        || !(yearChips instanceof HTMLElement)
        || !(seriesInput instanceof HTMLInputElement)
        || !(seriesOptions instanceof HTMLElement)
        || !(seriesChips instanceof HTMLElement)
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
        // Chosen sets (set ids; older links may carry listing ids).
        releaseIds: [],
        // The visitor's years (null lets the shelf pick: see requestedYears; an
        // empty list means every year), the default batch, and the years the
        // loaded listings were asked for.
        years: null,
        defaultYear: String(new Date().getFullYear()),
        requestYears: [],
        facets: { years: [], series: [] },
        inventoryFilter: 'all',
        loaded: 0,
        total: 0,
        controller: null,
        debounceTimer: 0,
        loading: false,
        disclosureCount: 0,
        releaseCount: 0,
        products: [],
        closedProducts: new Set(),
        // Store listings beside a set card start collapsed; these were opened.
        openedProducts: new Set(),
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
            && (/^\/assets\/images\/sonny-angels\/[A-Za-z0-9_./()@%+,&-]+$/.test(value)
                || /^\/assets\/images\/collectibles\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/.test(value))
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
                if (expanded) {
                    state.closedProducts.delete(productKey);
                    state.openedProducts.add(productKey);
                } else {
                    state.closedProducts.add(productKey);
                    state.openedProducts.delete(productKey);
                }
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
        const blocks = Array.from(resultsElement.querySelectorAll('.collectible-release-block'))
            .filter((block) => block instanceof HTMLElement && !block.hidden);
        const rows = blocks.flatMap((block) => Array.from(block.querySelectorAll('.collectible-inventory-row'))
            .filter((row) => row instanceof HTMLElement && !row.hidden));
        return { figures: rows.length, series: blocks.length };
    };

    const describeResults = () => {
        const counts = visibleInventoryCounts();
        if (state.inventoryFilter !== 'all') {
            const filterLabel = state.inventoryFilter === 'owned' ? 'owned' : 'not owned';
            const figureWord = counts.figures === 1 ? 'figure' : 'figures';
            return counts.figures === 0
                ? `No ${filterLabel} figures match these catalog controls.`
                : `Showing ${counts.figures} ${filterLabel} ${figureWord} across ${counts.series} series.`;
        }
        if (state.releaseIds.length > 0) {
            const figureWord = counts.figures === 1 ? 'figure' : 'figures';
            return counts.series === 0
                ? 'No figures from the chosen series match these catalog controls.'
                : `Showing ${counts.figures} ${figureWord} from ${counts.series === 1 ? 'the chosen series' : `${counts.series} chosen series`}.`;
        }
        const listingWord = state.total === 1 ? 'listing' : 'listings';
        const yearPhrase = describeYears(state.requestYears);
        if (state.loaded >= state.total) {
            return `Showing ${counts.series} series across all ${state.total} ${listingWord}${yearPhrase}.`;
        }
        return `Showing ${counts.series} series across ${state.loaded} of ${state.total} ${listingWord}${yearPhrase}.`;
    };

    const refreshInventoryVisibility = () => {
        applyInventoryVisibility(resultsElement, state, HTMLElement);
        if (!state.loading) {
            const counts = visibleInventoryCounts();
            setStatus(describeResults(), counts.series === 0 ? 'empty' : 'success');
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
        const name = identityName.trim() !== '' ? titleWithoutBrand(identityName, normalizeBrand(product.brand)) : 'Unnamed figure';
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
        // The card shows the listing's price; a figure shows only its own, different one.
        const ownPrice = formatPrice(safeVariant.price_cents, safeVariant.currency);
        if (ownPrice !== null && ownPrice !== productPrice) {
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
        }
        const variantIdentifiers = identifierText(safeVariant);
        if (variantIdentifiers !== '') nameCell.append(createElement('span', 'collectible-identifiers', variantIdentifiers));
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
            refreshInventoryVisibility();
        };

        checkbox.addEventListener('change', () => {
            const nextQuantity = quantityForOwnedToggle(checkbox.checked, Number(quantityInput.dataset.committed || '0'));
            inventory.set(key, nextQuantity);
            updateRowQuantity(row, checkbox, quantityInput, ownedPrint, quantityPrint, nextQuantity);
            refreshInventoryVisibility();
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

    // A store's SKU and the product barcode, when the source publishes them.
    const identifierText = (item) => {
        const parts = [];
        if (typeof item?.sku === 'string' && item.sku.trim() !== '') parts.push(`SKU ${item.sku.trim()}`);
        if (typeof item?.barcode === 'string' && /^[0-9]{8,14}$/.test(item.barcode)) parts.push(`Barcode ${item.barcode}`);
        return parts.join(' · ');
    };

    const seriesIdForProduct = (product) => {
        const safeProduct = product && typeof product === 'object' ? product : {};
        return typeof safeProduct.series_id === 'string' && safeProduct.series_id !== ''
            ? safeProduct.series_id
            : unclassifiedSeriesId(safeProduct);
    };

    // A listing's place inside its set: the set itself first, then what the
    // store sells of it.
    const LISTING_KIND_ORDER = { series: 0, 'whole-set': 1, box: 2, figure: 3, accessory: 4, standalone: 5 };
    const listingKindLabel = (product) => {
        switch (product?.listing_kind) {
            case 'whole-set': return 'Whole set';
            case 'box': return 'Blind box';
            case 'figure': return typeof product.listing_figure === 'string' && product.listing_figure !== ''
                ? `Single figure: ${product.listing_figure}`
                : 'Single figure';
            case 'accessory': return 'Series accessory';
            default: return '';
        }
    };

    const groupProductsBySeries = (products) => {
        const groups = new Map();
        (Array.isArray(products) ? products : []).forEach((product) => {
            const safeProduct = product && typeof product === 'object' ? product : {};
            const id = seriesIdForProduct(safeProduct);
            const unclassified = !(typeof safeProduct.series_id === 'string' && safeProduct.series_id !== '');
            const status = ['complete', 'partial', 'unknown'].includes(safeProduct.series_roster_status)
                ? safeProduct.series_roster_status
                : 'unknown';
            if (!groups.has(id)) {
                groups.set(id, {
                    id,
                    title: !unclassified && typeof safeProduct.series_title === 'string' && safeProduct.series_title.trim() !== ''
                        ? safeProduct.series_title.trim()
                        : unclassifiedSeriesTitle(safeProduct),
                    brand: safeProduct.brand,
                    rosterStatus: unclassified ? 'unknown' : status,
                    unclassified,
                    line: normalizeLine(safeProduct.line) || (unclassified ? 'standalone' : 'figures'),
                    year: null,
                    lineKnown: normalizeLine(safeProduct.line) !== '',
                    products: [],
                });
            }
            const group = groups.get(id);
            group.products.push(safeProduct);
            // The batch: the series' release year, else a listing's own.
            const year = Number.isInteger(safeProduct.series_release_year)
                ? safeProduct.series_release_year
                : (Number.isInteger(safeProduct.release_year) ? safeProduct.release_year : null);
            if (year !== null && !unclassified && (group.year === null || Number.isInteger(safeProduct.series_release_year))) group.year = year;
            const statusPriority = { complete: 0, partial: 1, unknown: 2 };
            if (statusPriority[status] > statusPriority[group.rosterStatus]) group.rosterStatus = status;
        });
        return Array.from(groups.values());
    };

    const seriesRosterText = (group) => {
        const figureCount = group.products.reduce((total, product) => total
            + (Array.isArray(product.variants) ? product.variants.length : 0), 0);
        const listingCount = group.products.length;
        const figureLabel = `${figureCount} listed ${figureCount === 1 ? 'figure' : 'figures'}`;
        const listingLabel = `${listingCount} retail ${listingCount === 1 ? 'listing' : 'listings'}`;
        if (group.unclassified && group.lineKnown) {
            return `Not part of a catalog series: ${listingLabel}.`;
        }
        if (group.unclassified) {
            return `Series membership is unknown. ${figureLabel} ${figureCount === 1 ? 'remains' : 'remain'} visible across ${listingLabel}.`;
        }
        if (group.rosterStatus === 'partial') {
            return `Roster incomplete: ${figureLabel} across ${listingLabel}.`;
        }
        if (group.rosterStatus === 'complete') {
            return figureCount === 0
                ? `Known complete roster: no figures are listed across ${listingLabel}.`
                : `Complete roster: ${figureLabel} across ${listingLabel}.`;
        }
        return `Roster completeness has not been confirmed: ${figureLabel} across ${listingLabel}.`;
    };

    const renderProduct = (product, collapsedByDefault = false) => {
        const safeProduct = product && typeof product === 'object' ? product : {};
        const productId = String(safeProduct.id);
        const title = titleWithoutBrand(
            typeof safeProduct.title === 'string' && safeProduct.title.trim() !== '' ? safeProduct.title.trim() : 'Untitled listing',
            normalizeBrand(safeProduct.brand)
        );
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
        const kindLabel = listingKindLabel(safeProduct);
        if (kindLabel !== '') summary.append(createElement('p', 'collectible-listing-kind', kindLabel));
        const heading = createElement('h4', 'collectible-title', title);
        heading.tabIndex = -1;
        summary.append(heading);
        if (Number.isInteger(safeProduct.release_year)) {
            summary.append(createElement('p', 'collectible-release', `Released ${safeProduct.release_year}`));
        }
        const productIdentifiers = identifierText(safeProduct);
        if (productIdentifiers !== '') summary.append(createElement('p', 'collectible-identifiers', productIdentifiers));
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

        if (variants.length === 0) return card;
        const variantSection = createElement('div', 'collectible-variants');
        const countLabel = variants.length === 1 ? '1 figure' : `${variants.length} figures`;
        state.disclosureCount += 1;
        const panelId = `collectible-variants-${state.disclosureCount}`;
        const headingElement = createElement('h5', 'collectible-variants-title');
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
        // No figure pictures for this listing: drop the column of empty boxes.
        if (!variants.some((variant) => isSafeImageUrl(variant?.image_url))) table.classList.add('has-no-thumbnails');
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
            tableBody.append(renderVariantRow(variant, { id: productId, title, brand: safeProduct.brand }, productPrice));
        });
        table.append(tableBody);
        tableWrap.append(table);
        panel.append(tableWrap);
        variantSection.append(panel);

        const expanded = collapsedByDefault
            ? state.openedProducts.has(productId)
            : isReleaseExpanded(productId, state.closedProducts);
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
        card.append(variantSection);
        return card;
    };

    const renderSeries = (group) => {
        state.releaseCount += 1;
        const releaseBlock = createElement('section', 'collectible-release-block');
        releaseBlock.dataset.releaseId = group.id;
        releaseBlock.dataset.rosterStatus = group.rosterStatus;
        const matchingLegacyProduct = group.products.find((product) => state.releaseIds.includes(String(product.id)));
        releaseBlock.dataset.legacyReleaseId = String(matchingLegacyProduct?.id ?? group.products[0]?.id ?? '');
        if (group.unclassified) releaseBlock.classList.add('is-unclassified');
        const releaseHeadingId = `collectible-release-${state.releaseCount}`;
        releaseBlock.setAttribute('aria-labelledby', releaseHeadingId);
        const releaseHeading = createElement('header', 'collectible-release-heading');
        const releaseTitle = createElement('h3', 'collectible-release-title', group.title);
        releaseTitle.id = releaseHeadingId;
        releaseHeading.append(releaseTitle);
        releaseHeading.append(createElement('p', 'collectible-release-status', seriesRosterText(group)));
        releaseBlock.append(releaseHeading);
        const products = createElement('div', 'collectible-release-products');
        const ordered = group.products
            .map((product, index) => ({ product, index }))
            .sort((left, right) => (LISTING_KIND_ORDER[left.product.listing_kind] ?? 6) - (LISTING_KIND_ORDER[right.product.listing_kind] ?? 6)
                || left.index - right.index)
            .map(({ product }) => product);
        const hasSetCard = ordered.some((product) => product.listing_kind === 'series');
        let listingsHeadingAdded = false;
        ordered.forEach((product) => {
            if (hasSetCard && product.listing_kind !== 'series' && !listingsHeadingAdded) {
                const listingCount = ordered.filter((item) => item.listing_kind !== 'series').length;
                products.append(createElement('p', 'collectible-listings-heading', `Store listings (${listingCount})`));
                listingsHeadingAdded = true;
            }
            const card = renderProduct(product, hasSetCard && product.listing_kind !== 'series');
            if (product.listing_kind === 'series') card.classList.add('is-set-card');
            products.append(card);
        });
        releaseBlock.append(products);
        return releaseBlock;
    };

    const renderCatalog = () => {
        state.disclosureCount = 0;
        state.releaseCount = 0;
        const groups = groupProductsBySeries(state.products);
        if (state.sort === 'name-asc' || state.sort === 'name-desc') {
            const direction = state.sort === 'name-desc' ? -1 : 1;
            groups.sort((left, right) => direction * (left.title.localeCompare(right.title)
                || brandLabel(left.brand).localeCompare(brandLabel(right.brand))
                || left.id.localeCompare(right.id)));
        }
        const fragment = document.createDocumentFragment();
        // Brand, then product line, then batch (release year), then set. The
        // chosen sort orders the sets within each batch.
        const brandOrder = Object.keys(BRANDS);
        const yearDirection = state.sort === 'oldest' ? 1 : -1;
        const sections = new Map();
        groups.forEach((group) => {
            const key = `${normalizeBrand(group.brand)}\u0000${group.line}`;
            if (!sections.has(key)) sections.set(key, { brand: group.brand, line: group.line, groups: [] });
            sections.get(key).groups.push(group);
        });
        Array.from(sections.values())
            .sort((left, right) => (brandOrder.indexOf(normalizeBrand(left.brand)) - brandOrder.indexOf(normalizeBrand(right.brand)))
                || (LINE_ORDER.indexOf(left.line) - LINE_ORDER.indexOf(right.line)))
            .forEach((section) => {
                const lineSection = createElement('section', 'collectible-group collectible-line');
                lineSection.dataset.line = section.line;
                const lineHeadingId = `collectible-line-${normalizeBrand(section.brand)}-${section.line}`;
                lineSection.setAttribute('aria-labelledby', lineHeadingId);
                const lineHeading = createElement('h2', 'collectible-line-title', `${brandLabel(section.brand)}: ${lineLabel(section.line)}`);
                lineHeading.id = lineHeadingId;
                lineSection.append(lineHeading);
                const years = new Map();
                section.groups.forEach((group) => {
                    const yearKey = group.year === null ? 'unknown' : String(group.year);
                    if (!years.has(yearKey)) years.set(yearKey, []);
                    years.get(yearKey).push(group);
                });
                // One requested year, or a line with no dated sets, needs no
                // year labels.
                const yearLabels = state.requestYears.length !== 1 && !(years.size === 1 && years.has('unknown'));
                const yearKeys = Array.from(years.keys())
                    .sort((left, right) => (Number(left === 'unknown') - Number(right === 'unknown')) || yearDirection * (Number(left) - Number(right)));
                yearKeys
                    .forEach((yearKey) => {
                        const yearSection = createElement('div', 'collectible-group collectible-year');
                        yearSection.dataset.year = yearKey;
                        if (yearLabels) yearSection.append(createElement('p', 'collectible-year-title', yearKey === 'unknown' ? 'Release year unknown' : yearKey));
                        years.get(yearKey).forEach((group) => yearSection.append(renderSeries(group)));
                        lineSection.append(yearSection);
                    });
                fragment.append(lineSection);
            });
        resultsElement.replaceChildren(fragment);
        refreshInventoryVisibility();
    };

    const emptyMessage = (lastSyncedAt) => {
        if (lastSyncedAt === null || lastSyncedAt === undefined || lastSyncedAt === '') {
            return { text: 'The collectibles catalog has not been synced yet. Check back after the next pull.', tone: 'empty' };
        }
        if (state.releaseIds.length > 0) {
            return { text: 'No listings in the chosen series match these catalog controls.', tone: 'empty' };
        }
        const elsewhere = yearChoicesFromFacets(state.facets, [])
            .filter((choice) => !state.requestYears.includes(choice.value))
            .map((choice) => (choice.value === 'unknown' ? 'undated listings' : choice.value));
        const hint = state.requestYears.length > 0 && elsewhere.length > 0
            ? ` Other years have matches: ${elsewhere.slice(0, 4).join(', ')}${elsewhere.length > 4 ? ', …' : ''}. Add a year, or clear the years for all of them.`
            : ' Try a different name or line.';
        if (state.q !== '' || state.brand !== '' || state.requestYears.length > 0) {
            const parts = [];
            if (state.q !== '') parts.push(`"${state.q}"`);
            if (state.brand !== '') parts.push(`in ${BRANDS[state.brand]}`);
            const yearPhrase = describeYears(state.requestYears);
            return { text: `No collectibles${parts.length > 0 ? ` match ${parts.join(' ')}` : ''}${yearPhrase}.${hint}`, tone: 'empty' };
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

    // A type-to-filter, multi-select picker (the combobox pattern): chosen
    // values are removable chips, the text box filters a listbox of choices,
    // arrows move, Enter toggles, Escape closes, Backspace drops the last chip.
    const createPicker = ({ input, options, chips, emptyLabel, getChoices, getSelected, onChange }) => {
        let visible = [];
        let active = -1;
        const isOpen = () => !options.hidden;
        const setOpen = (open) => {
            options.hidden = !open;
            input.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open) {
                active = -1;
                input.removeAttribute('aria-activedescendant');
            }
        };
        const toggle = (value) => {
            const selected = getSelected();
            input.value = '';
            onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
        };
        const renderOptions = () => {
            visible = matchChoices(getChoices(), input.value);
            if (active >= visible.length) active = visible.length - 1;
            const chosen = new Set(getSelected());
            const fragment = document.createDocumentFragment();
            visible.forEach((choice, index) => {
                const option = createElement('li', 'collectibles-picker-option');
                option.id = `${options.id}-${index}`;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', chosen.has(choice.value) ? 'true' : 'false');
                option.dataset.value = choice.value;
                if (index === active) option.classList.add('is-active');
                option.append(createElement('span', 'collectibles-picker-label', choice.label));
                if (choice.detail) option.append(createElement('span', 'collectibles-picker-detail', choice.detail));
                // Keep focus in the text box so the list stays open between picks.
                option.addEventListener('mousedown', (event) => event.preventDefault());
                option.addEventListener('click', () => toggle(choice.value));
                fragment.append(option);
            });
            if (visible.length === 0) fragment.append(createElement('li', 'collectibles-picker-empty', 'No matches'));
            options.replaceChildren(fragment);
            if (active >= 0) input.setAttribute('aria-activedescendant', `${options.id}-${active}`);
            else input.removeAttribute('aria-activedescendant');
        };
        const renderChips = () => {
            const labels = new Map(getChoices().map((choice) => [choice.value, choice.label]));
            const fragment = document.createDocumentFragment();
            getSelected().forEach((value) => {
                const label = labels.get(value) ?? value;
                const chip = createElement('button', 'collectibles-picker-chip', label);
                chip.type = 'button';
                chip.dataset.value = value;
                chip.setAttribute('aria-label', `Remove ${label}`);
                chip.addEventListener('click', () => toggle(value));
                fragment.append(chip);
            });
            chips.replaceChildren(fragment);
            input.placeholder = getSelected().length === 0 ? emptyLabel : 'Add more…';
        };
        input.addEventListener('focus', () => {
            renderOptions();
            setOpen(true);
        });
        input.addEventListener('blur', () => setOpen(false));
        input.addEventListener('input', () => {
            active = 0;
            renderOptions();
            setOpen(true);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen(true);
                renderOptions();
                if (visible.length === 0) return;
                const step = event.key === 'ArrowDown' ? 1 : -1;
                active = active < 0 ? (step > 0 ? 0 : visible.length - 1) : (active + step + visible.length) % visible.length;
                renderOptions();
            } else if (event.key === 'Enter') {
                // Never submit the search form from a picker.
                event.preventDefault();
                const target = visible[active] ?? (visible.length === 1 ? visible[0] : null);
                if (isOpen() && target) toggle(target.value);
            } else if (event.key === 'Escape' && isOpen()) {
                event.preventDefault();
                setOpen(false);
            } else if (event.key === 'Backspace' && input.value === '') {
                const selected = getSelected();
                if (selected.length > 0) toggle(selected[selected.length - 1]);
            }
        });
        return {
            render() {
                renderChips();
                if (isOpen()) renderOptions();
            },
        };
    };

    const seriesPickerChoices = () => {
        const choices = seriesChoicesFromFacets(state.facets);
        const counts = new Map();
        choices.forEach((choice) => counts.set(choice.title, (counts.get(choice.title) || 0) + 1));
        return choices.map((choice) => ({
            value: choice.id,
            label: counts.get(choice.title) > 1 ? `${choice.title} (${choice.id})` : choice.title,
            detail: choice.brand,
        }));
    };

    const yearPicker = createPicker({
        input: yearInput,
        options: yearOptions,
        chips: yearChips,
        emptyLabel: 'All years',
        getChoices: () => yearChoicesFromFacets(state.facets, state.requestYears),
        getSelected: () => state.requestYears,
        onChange: (years) => {
            cancelDebounce();
            state.years = years;
            // Sets were listed for the old years.
            state.releaseIds = [];
            load(true);
        },
    });

    const seriesPicker = createPicker({
        input: seriesInput,
        options: seriesOptions,
        chips: seriesChips,
        emptyLabel: 'All series — type to find',
        getChoices: seriesPickerChoices,
        getSelected: () => state.releaseIds,
        onChange: (ids) => {
            cancelDebounce();
            // Keep the years that listed these sets rather than widening to all years.
            if (state.years === null) state.years = [...state.requestYears];
            state.releaseIds = ids;
            load(true);
        },
    });

    const renderPickers = () => {
        yearPicker.render();
        seriesPicker.render();
    };

    const syncUrl = () => {
        const params = new URLSearchParams(window.location.search);
        params.delete('q');
        params.delete('brand');
        params.delete('release');
        params.delete('year');
        params.delete('sort');
        if (state.q !== '') params.set('q', state.q);
        if (state.brand !== '') params.set('brand', state.brand);
        if (state.releaseIds.length > 0) params.set('release', state.releaseIds.join(','));
        if (state.years !== null) params.set('year', state.years.length > 0 ? state.years.join(',') : 'all');
        if (state.sort !== 'name-asc') params.set('sort', state.sort);
        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query !== '' ? `?${query}` : ''}${window.location.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextUrl !== currentUrl && window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(null, '', nextUrl);
        }
    };

    const updateLoadMore = (pageCount) => {
        loadMoreButton.disabled = state.loading;
        loadMoreButton.hidden = !(state.loaded < state.total && (pageCount > 0 || state.loaded > 0));
        loadMoreButton.textContent = 'Finish loading catalog';
    };

    const load = async (reset, completeCatalog = true) => {
        const token = requestGate.next();
        if (state.controller !== null) state.controller.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        state.controller = controller;

        if (reset) {
            state.requestYears = requestedYears(state, state.defaultYear);
            renderPickers();
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
                const params = catalogRequestParams(state.q, state.brand, state.sort, offset, state.requestYears, state.releaseIds);

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
                const meta = payload && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
                state.lastSyncedAt = typeof meta.last_synced_at === 'string' ? meta.last_synced_at : state.lastSyncedAt;
                if (offset === 0) {
                    // The facets describe this search's years and sets; an
                    // older link's listing id comes back as its set's id.
                    state.facets = meta.facets && typeof meta.facets === 'object' ? meta.facets : { years: [], series: [] };
                    if (state.releaseIds.length > 0 && Array.isArray(meta.series)) {
                        state.releaseIds = meta.series.filter((id) => typeof id === 'string' && id !== '');
                    }
                    renderPickers();
                    syncUrl();
                }
                pageCount = appendCatalogPage(state, payload);
                renderCatalog();
                setUpdated(state.lastSyncedAt);
                if (completeCatalog && state.loaded < state.total) {
                    if (pageCount === 0) {
                        throw new Error('The collectibles shelf stopped before the complete catalog finished loading.');
                    }
                    setStatus(`Loading all matching listings (${state.loaded} of ${state.total})...`, 'loading');
                }
                if (!completeCatalog || pageCount === 0) break;
            } while (state.loaded < state.total);

            if (!requestGate.isCurrent(token)) return false;
            setLoading(false);
            updateLoadMore(pageCount);
            // Nothing in the default year yet for this line: show its newest batch.
            const newest = newestFacetYear(state.facets);
            const onDefaultYear = state.years === null && state.requestYears.length === 1 && state.requestYears[0] === state.defaultYear;
            if (reset && state.loaded === 0 && onDefaultYear && newest !== '' && newest !== state.defaultYear) {
                state.defaultYear = newest;
                return load(true, completeCatalog);
            }
            if (state.loaded === 0) {
                const empty = emptyMessage(state.lastSyncedAt);
                setStatus(empty.text, empty.tone);
                return true;
            }
            refreshInventoryVisibility();
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
        if (brand !== state.brand) {
            // Another line has its own sets and its own newest batch.
            state.releaseIds = [];
            state.defaultYear = String(new Date().getFullYear());
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
    brandInputs.forEach((input) => input.addEventListener('change', () => {
        cancelDebounce();
        applyFormState();
    }));
    inventoryFilterInputs.forEach((input) => input.addEventListener('change', () => {
        if (!input.checked) return;
        cancelDebounce();
        state.inventoryFilter = normalizeInventoryFilter(input.value);
        refreshInventoryVisibility();
        if (!state.loading && state.loaded < state.total) load(false, true);
        else updateLoadMore(1);
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
        if (!state.loading && state.loaded < state.total) load(false, true);
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
        window.print();
    });

    const initialParams = new URLSearchParams(window.location.search);
    state.q = normalizeQuery(initialParams.get('q'));
    state.brand = normalizeBrand(initialParams.get('brand'));
    state.releaseIds = parseIdList(initialParams.get('release'));
    state.years = initialParams.has('year') ? parseYearList(initialParams.get('year')) : null;
    state.sort = normalizeSort(initialParams.get('sort'));
    searchInput.value = state.q;
    sortSelect.value = state.sort;
    brandInputs.forEach((input) => {
        input.checked = normalizeBrand(input.value) === state.brand;
    });
    inventoryFilterInputs.forEach((input) => {
        input.checked = normalizeInventoryFilter(input.value) === state.inventoryFilter;
    });

    state.requestYears = requestedYears(state, state.defaultYear);
    renderPickers();
    load(true, true);
})();

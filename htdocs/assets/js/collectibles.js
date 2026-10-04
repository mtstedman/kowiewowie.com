import {
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
    releaseChoicesFromProducts,
    applyInventoryVisibility,
    catalogRequestParams,
    appendCatalogPage,
    isReleaseExpanded,
    createRequestGate,
} from './collectibles-inventory.js';

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
    const releaseSelect = document.getElementById('collectibles-release');
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
        || !(releaseSelect instanceof HTMLSelectElement)
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
    const releaseRequestGate = createRequestGate();
    const state = {
        q: '',
        brand: '',
        sort: 'name-asc',
        releaseId: '',
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
        releaseProducts: [],
        releaseLoaded: 0,
        releaseTotal: 0,
        releaseChoicesComplete: false,
        releaseChoicesLoading: false,
        releaseController: null,
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
                if (expanded) state.closedProducts.delete(productKey);
                else state.closedProducts.add(productKey);
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
        return { figures: rows.length, products: blocks.length };
    };

    const describeResults = () => {
        const counts = visibleInventoryCounts();
        if (state.inventoryFilter !== 'all') {
            const filterLabel = state.inventoryFilter === 'owned' ? 'owned' : 'not owned';
            const figureWord = counts.figures === 1 ? 'figure' : 'figures';
            const productWord = counts.products === 1 ? 'release' : 'releases';
            return counts.figures === 0
                ? `No ${filterLabel} figures match these catalog controls.`
                : `Showing ${counts.figures} ${filterLabel} ${figureWord} across ${counts.products} ${productWord}.`;
        }
        if (state.releaseId !== '') {
            const figureWord = counts.figures === 1 ? 'figure' : 'figures';
            return counts.products === 0
                ? 'No figures from this release match these catalog controls.'
                : `Showing ${counts.figures} ${figureWord} from the selected release.`;
        }
        const productWord = state.total === 1 ? 'release' : 'releases';
        return state.loaded >= state.total
            ? `Showing all ${state.total} ${productWord}.`
            : `Showing ${state.loaded} of ${state.total} ${productWord}.`;
    };

    const refreshInventoryVisibility = () => {
        applyInventoryVisibility(resultsElement, state, HTMLElement);
        if (!state.loading) {
            const counts = visibleInventoryCounts();
            const releaseNotice = state.releaseChoicesComplete
                ? ''
                : (state.releaseChoicesLoading ? ' Release choices are still loading.' : ' Release choices are incomplete; retry to finish loading them.');
            setStatus(`${describeResults()}${releaseNotice}`, !state.releaseChoicesComplete && !state.releaseChoicesLoading
                ? 'error'
                : (counts.products === 0 ? 'empty' : 'success'));
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

        state.releaseCount += 1;
        const releaseBlock = createElement('section', 'collectible-release-block');
        releaseBlock.dataset.releaseId = productId;
        const releaseHeadingId = `collectible-release-${state.releaseCount}`;
        releaseBlock.setAttribute('aria-labelledby', releaseHeadingId);
        const releaseHeading = createElement('header', 'collectible-release-heading');
        releaseHeading.append(createElement('p', 'eyebrow collectible-release-brand', `${label} release`));
        const releaseTitle = createElement('h3', 'collectible-release-title', title);
        releaseTitle.id = releaseHeadingId;
        releaseHeading.append(releaseTitle);
        if (Number.isInteger(safeProduct.release_year)) {
            releaseHeading.append(createElement('p', 'collectible-release-year', `Released ${safeProduct.release_year}`));
        }
        releaseBlock.append(releaseHeading);

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

            const expanded = isReleaseExpanded(productId, state.closedProducts);
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
        releaseBlock.append(card);
        return releaseBlock;
    };

    const renderCatalog = () => {
        state.disclosureCount = 0;
        state.releaseCount = 0;
        const fragment = document.createDocumentFragment();
        state.products.forEach((product) => fragment.append(renderProduct(product)));
        resultsElement.replaceChildren(fragment);
        refreshInventoryVisibility();
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

    const renderReleaseOptions = () => {
        const choices = releaseChoicesFromProducts(state.releaseProducts);
        const duplicateLabels = new Map();
        choices.forEach((choice) => {
            const label = `${choice.title} — ${choice.brand}`;
            duplicateLabels.set(label, (duplicateLabels.get(label) || 0) + 1);
        });
        const fragment = document.createDocumentFragment();
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'All releases';
        fragment.append(allOption);
        choices.forEach((choice) => {
            const option = document.createElement('option');
            option.value = choice.id;
            const label = `${choice.title} — ${choice.brand}`;
            option.textContent = duplicateLabels.get(label) > 1 ? `${label} (${choice.id})` : label;
            fragment.append(option);
        });
        if (!state.releaseChoicesComplete) {
            const progress = document.createElement('option');
            progress.disabled = true;
            progress.textContent = state.releaseChoicesLoading
                ? `Loading complete release list (${state.releaseLoaded}${state.releaseTotal > 0 ? ` of ${state.releaseTotal}` : ''})…`
                : 'Release list incomplete — retry below';
            fragment.append(progress);
        }
        releaseSelect.replaceChildren(fragment);
        releaseSelect.value = choices.some((choice) => choice.id === state.releaseId) ? state.releaseId : '';
        releaseSelect.disabled = !state.releaseChoicesComplete;
        releaseSelect.setAttribute('aria-busy', state.releaseChoicesLoading ? 'true' : 'false');
    };

    const loadReleaseChoices = async (reset) => {
        const token = releaseRequestGate.next();
        if (state.releaseController !== null) state.releaseController.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        state.releaseController = controller;
        if (reset) {
            state.releaseProducts = [];
            state.releaseLoaded = 0;
            state.releaseTotal = 0;
            state.releaseChoicesComplete = false;
        }
        state.releaseChoicesLoading = true;
        renderReleaseOptions();
        updateLoadMore(0);
        try {
            do {
                const offset = state.releaseLoaded;
                const params = new URLSearchParams({
                    sort: 'name-asc',
                    limit: String(PAGE_SIZE),
                    offset: String(offset),
                });
                const response = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
                    headers: { Accept: 'application/json' },
                    signal: controller !== null ? controller.signal : undefined,
                });
                if (!releaseRequestGate.isCurrent(token)) return false;
                if (!response.ok) throw new Error('The release list would not load.');
                const payload = await response.json();
                if (!releaseRequestGate.isCurrent(token)) return false;
                const items = payload && Array.isArray(payload.data) ? payload.data : [];
                const meta = payload && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
                const total = Number.isInteger(meta.total) && meta.total >= 0 ? meta.total : offset + items.length;
                state.releaseProducts.push(...items);
                state.releaseLoaded = offset + items.length;
                state.releaseTotal = Math.max(total, state.releaseLoaded);
                renderReleaseOptions();
                if (state.releaseLoaded < state.releaseTotal && items.length === 0) {
                    throw new Error('The release list stopped before it finished loading.');
                }
            } while (state.releaseLoaded < state.releaseTotal);
            if (!releaseRequestGate.isCurrent(token)) return false;
            state.releaseChoicesComplete = true;
            const choices = releaseChoicesFromProducts(state.releaseProducts);
            if (state.releaseId !== '' && !choices.some((choice) => choice.id === state.releaseId)) {
                state.releaseId = '';
            }
            renderReleaseOptions();
            syncUrl();
            refreshInventoryVisibility();
            updateLoadMore(0);
            return true;
        } catch (error) {
            if (!releaseRequestGate.isCurrent(token)) return false;
            state.releaseChoicesComplete = false;
            renderReleaseOptions();
            updateLoadMore(state.loaded > 0 ? 1 : 0);
            if (!state.loading) refreshInventoryVisibility();
            return false;
        } finally {
            if (releaseRequestGate.isCurrent(token)) {
                state.releaseChoicesLoading = false;
                state.releaseController = null;
                renderReleaseOptions();
                updateLoadMore(state.loaded > 0 ? 1 : 0);
            }
        }
    };

    const syncUrl = () => {
        const params = new URLSearchParams(window.location.search);
        params.delete('q');
        params.delete('brand');
        params.delete('release');
        params.delete('sort');
        if (state.q !== '') params.set('q', state.q);
        if (state.brand !== '') params.set('brand', state.brand);
        if (state.releaseId !== '') params.set('release', state.releaseId);
        if (state.sort !== 'name-asc') params.set('sort', state.sort);
        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query !== '' ? `?${query}` : ''}${window.location.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextUrl !== currentUrl && window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(null, '', nextUrl);
        }
    };

    const updateLoadMore = (pageCount) => {
        if (!state.releaseChoicesComplete) {
            loadMoreButton.hidden = false;
            loadMoreButton.disabled = state.loading || state.releaseChoicesLoading;
            loadMoreButton.textContent = state.releaseChoicesLoading ? 'Loading releases…' : 'Retry loading releases';
            return;
        }
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
                const params = catalogRequestParams(state.q, state.brand, state.sort, offset);

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
                pageCount = appendCatalogPage(state, payload);
                renderCatalog();
                setUpdated(state.lastSyncedAt);
                if (completeCatalog && state.loaded < state.total) {
                    if (pageCount === 0) {
                        throw new Error('The collectibles shelf stopped before the complete catalog finished loading.');
                    }
                    setStatus(`Loading all matching releases (${state.loaded} of ${state.total})...`, 'loading');
                }
                if (!completeCatalog || pageCount === 0) break;
            } while (state.loaded < state.total);

            if (!requestGate.isCurrent(token)) return false;
            setLoading(false);
            updateLoadMore(pageCount);
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
    releaseSelect.addEventListener('change', () => {
        state.releaseId = releaseSelect.value;
        syncUrl();
        refreshInventoryVisibility();
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
    loadMoreButton.addEventListener('click', async () => {
        if (state.loading || state.releaseChoicesLoading) return;
        if (!state.releaseChoicesComplete) {
            await loadReleaseChoices(false);
        }
        if (state.loaded < state.total) load(false, true);
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
    state.releaseId = String(initialParams.get('release') ?? '');
    state.sort = normalizeSort(initialParams.get('sort'));
    searchInput.value = state.q;
    sortSelect.value = state.sort;
    brandInputs.forEach((input) => {
        input.checked = normalizeBrand(input.value) === state.brand;
    });
    inventoryFilterInputs.forEach((input) => {
        input.checked = normalizeInventoryFilter(input.value) === state.inventoryFilter;
    });

    renderReleaseOptions();
    loadReleaseChoices(true);
    load(true, true);
})();

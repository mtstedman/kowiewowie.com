export const INVENTORY_STORAGE_KEY = 'collectibles-inventory:v1';
export const INVENTORY_VERSION = 1;

export const PAGE_SIZE = 48;
const INVENTORY_FILTERS = new Set(['all', 'owned', 'missing']);
export const BRANDS = {
    skullpanda: 'SKULLPANDA',
    nommi: 'Nommi',
    'sonny-angel': 'Sonny Angel',
    'pop-bean': 'POP BEAN',
};

// Every card already sits under its brand's heading and eyebrow, so a store
// title's own brand words ("Nommi …", "MEGA α SKULLPANDA 1000% …", "θSKULLPANDA
// … Plush", "Pop Mart Skullpanda …") are dropped for display, with Pop Mart's
// α/θ marks that cling to them. A brand that ends the title is part of the name
// ("Christmas Presents from Sonny Angel") and stays.
const BRAND_TITLE_PATTERNS = Object.freeze({
    skullpanda: /(?:\bpop\s*mart\s+)?(?:[αθ]\s*)?\bskull\s*panda\b/giu,
    nommi: /(?:\bpop\s*mart\s+)?\bnommi\b/giu,
    'sonny-angel': /(?:\bpop\s*mart\s+)?\bsonny\s*angels?\b/giu,
    'pop-bean': /(?:\bpop\s*mart\s+)?\bpop\s*beans?\b/giu,
});
export const titleWithoutBrand = (title, brand) => {
    const text = typeof title === 'string' ? title.trim() : '';
    const pattern = BRAND_TITLE_PATTERNS[brand];
    if (pattern === undefined || text === '') return text;
    const stripped = text
        .replace(pattern, (match, offset) => (offset + match.length >= text.length && offset > 0 ? match : ' '))
        .replace(/\s+/gu, ' ')
        .replace(/^[\s:;,|\-–—]+/u, '')
        .trim();
    return stripped === '' ? text : stripped;
};

export const inventoryKey = (productId, variantName) => JSON.stringify([String(productId), variantName]);

// Product lines, in shelf order: store-fed brands by format, Sonny Angel by
// its archive family. The API files every listing under one of these.
export const LINE_LABELS = Object.freeze({
    figures: 'Figure series',
    plush: 'Plush series',
    pendants: 'Pendants & charms',
    large: 'MEGA & large',
    accessories: 'Series accessories',
    standalone: 'Standalone pieces',
    regular: 'Regular series',
    limited: 'Limited & seasonal',
    artist: 'Artist Collection',
    hippers: 'HIPPERS',
    master: 'Master Collection',
    other: 'Other',
});
export const LINE_ORDER = Object.freeze(Object.keys(LINE_LABELS));
export const normalizeLine = (value) => (typeof value === 'string' && Object.prototype.hasOwnProperty.call(LINE_LABELS, value) ? value : '');
export const lineLabel = (line) => LINE_LABELS[normalizeLine(line)] ?? 'Other';

// Listings outside any series group by brand and, when the API names it,
// product line ("unclassified:skullpanda:large").
export const unclassifiedSeriesId = (product) => {
    const safeProduct = product && typeof product === 'object' ? product : {};
    const line = normalizeLine(safeProduct.line);
    return `unclassified:${String(safeProduct.brand ?? 'collectible')}${line === '' ? '' : `:${line}`}`;
};
const UNCLASSIFIED_TITLES = Object.freeze({
    figures: 'Other figure series',
    plush: 'Other plush',
    pendants: 'Other pendants & charms',
    large: 'MEGA & large pieces',
    accessories: 'Other series accessories',
    standalone: 'Standalone pieces',
});
export const unclassifiedSeriesTitle = (product) => {
    const line = normalizeLine(product && typeof product === 'object' ? product.line : '');
    if (line === '') return 'Unclassified';
    return UNCLASSIFIED_TITLES[line] ?? `Other ${LINE_LABELS[line].toLowerCase()}`;
};

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

export const parseQuantity = (value) => {
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

export const decodeInventory = (raw) => {
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

export const createInventoryStore = (storage, reportPersistence) => {
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

export const normalizeInventoryFilter = (value) => INVENTORY_FILTERS.has(String(value)) ? String(value) : 'all';
export const isOwnedQuantity = (quantity) => Number.isSafeInteger(quantity) && quantity > 0;
export const quantityMatchesFilter = (quantity, filter) => filter === 'all'
    || (filter === 'owned' ? isOwnedQuantity(quantity) : quantity === 0);
export const quantityForOwnedToggle = (checked, committedQuantity) => checked
    ? Math.max(1, Number.isSafeInteger(committedQuantity) && committedQuantity >= 0 ? committedQuantity : 0)
    : 0;
export const isThumbnailActivationKey = (key) => key === 'Enter' || key === ' ';
export const setExpandedControl = (control, expanded) => {
    control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    control.classList.toggle('is-expanded', expanded);
    return expanded;
};
export const partialFailureMessage = (message, loaded, total) => loaded > 0 && loaded < total
    ? `${message} Partial inventory results are shown; retry to finish loading.`
    : message;

export const normalizeYear = (value) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'all' || text === 'unknown') return text;
    return /^(?:19|20)[0-9]{2}$/.test(text) ? text : '';
};

// A comma list from the URL, normalized and without repeats; for years,
// "all" (or nothing) means no year filter.
export const parseYearList = (value) => Array.from(new Set(String(value ?? '').split(',')
    .map(normalizeYear)
    .filter((year) => year !== '' && year !== 'all')));

export const parseIdList = (value) => Array.from(new Set(String(value ?? '').split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9:._-]{1,200}$/.test(id))));

// The release years the shelf asks the API for (none means every year): the
// visitor's own choice; otherwise every year while searching or opening sets
// from a link; otherwise the default batch (this year, or the newest year
// with listings).
export const requestedYears = (state, defaultYear) => {
    if (state && Array.isArray(state.years)) return state.years;
    if ((state && state.q) || (state && Array.isArray(state.releaseIds) && state.releaseIds.length > 0)) return [];
    const fallback = normalizeYear(defaultYear);
    return fallback === '' || fallback === 'all' ? [] : [fallback];
};

// " from 2025 and 2026", " with no known release year", or "" for every year.
export const describeYears = (years) => {
    const dated = (Array.isArray(years) ? years : []).filter((year) => /^[0-9]{4}$/.test(year)).sort();
    const undated = (Array.isArray(years) ? years : []).includes('unknown');
    const list = dated.length <= 2 ? dated.join(' and ') : `${dated.slice(0, -1).join(', ')}, and ${dated.at(-1)}`;
    if (dated.length === 0) return undated ? ' with no known release year' : '';
    return ` from ${list}${undated ? ' or with no known release year' : ''}`;
};

const facetList = (facets, key) => (facets && typeof facets === 'object' && Array.isArray(facets[key]) ? facets[key] : [])
    .filter((entry) => entry && typeof entry === 'object');

// Year choices from the API's year facets (which ignore the year filter):
// newest first, then undated listings. Empty years are never offered. A stale
// selected year remains visible as a removable chip in the picker itself, but
// does not masquerade as an available choice.
export const yearChoicesFromFacets = (facets) => {
    const years = facetList(facets, 'years');
    const choices = years
        .filter((entry) => Number.isInteger(entry.year) && Number(entry.listings) > 0)
        .map((entry) => ({ value: String(entry.year), label: String(entry.year), detail: `${Number(entry.series) || 0} series` }));
    choices.sort((left, right) => Number(right.value) - Number(left.value));
    const undated = years.find((entry) => entry.year === null && Number(entry.listings) > 0);
    if (undated) choices.push({ value: 'unknown', label: 'Year unknown', detail: `${Number(undated.series) || 0} series` });
    return choices;
};

// Type-to-filter: choices whose label or detail contains the typed text.
export const matchChoices = (choices, text) => {
    const needle = String(text ?? '').trim().toLowerCase();
    if (needle === '') return choices;
    return choices.filter((choice) => `${choice.label} ${choice.detail ?? ''}`.toLowerCase().includes(needle));
};

// The newest year that has listings, for when the default year has none.
export const newestFacetYear = (facets) => {
    const years = facetList(facets, 'years')
        .filter((entry) => Number.isInteger(entry.year) && Number(entry.listings) > 0)
        .map((entry) => entry.year);
    return years.length === 0 ? '' : String(Math.max(...years));
};

// Set choices from the API's set facets (the chosen year, any set).
export const seriesChoicesFromFacets = (facets) => {
    const choices = new Map();
    facetList(facets, 'series').forEach((entry) => {
        const id = typeof entry.id === 'string' ? entry.id : '';
        if (id === '' || choices.has(id)) return;
        const brandKey = String(entry.brand ?? '').trim().toLowerCase();
        choices.set(id, {
            id,
            title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : unclassifiedSeriesTitle(entry),
            brand: Object.prototype.hasOwnProperty.call(BRANDS, brandKey) ? BRANDS[brandKey] : 'Collectible',
        });
    });
    return Array.from(choices.values()).sort((left, right) => left.title.localeCompare(right.title)
        || left.brand.localeCompare(right.brand)
        || left.id.localeCompare(right.id));
};

// A series block belongs to the chosen sets (any, when none are chosen); an
// older link may name one of its listings instead.
export const blockMatchesReleases = (block, releaseIds) => !Array.isArray(releaseIds)
    || releaseIds.length === 0
    || releaseIds.includes(block.dataset.releaseId)
    || releaseIds.includes(block.dataset.legacyReleaseId);

// "You own 12 of 139 figures here, 17 copies in all.": distinct figures owned,
// then every copy, over each figure row's quantity.
export const describeOwnership = (quantities) => {
    const list = Array.isArray(quantities) ? quantities : [];
    if (list.length === 0) return '';
    const owned = list.filter(isOwnedQuantity);
    const copies = owned.reduce((total, quantity) => total + quantity, 0);
    const figures = `You own ${owned.length} of ${list.length} ${list.length === 1 ? 'figure' : 'figures'} here`;
    return owned.length === 0 ? `${figures}.` : `${figures}, ${copies} ${copies === 1 ? 'copy' : 'copies'} in all.`;
};

export const applyInventoryVisibility = (resultsElement, state, HTMLElementClass) => {
    Array.from(resultsElement.querySelectorAll('.collectible-inventory-row')).forEach((row) => {
        if (!(row instanceof HTMLElementClass)) return;
        const quantity = Number(row.dataset.quantity || '0');
        row.hidden = !quantityMatchesFilter(quantity, state.inventoryFilter);
    });
    Array.from(resultsElement.querySelectorAll('.collectible-release-block')).forEach((block) => {
        if (!(block instanceof HTMLElementClass)) return;
        const rows = Array.from(block.querySelectorAll('.collectible-inventory-row'))
            .filter((row) => row instanceof HTMLElementClass);
        const releaseMatches = blockMatchesReleases(block, state.releaseIds);
        const inventoryMatches = state.inventoryFilter === 'all'
            || (rows.length > 0 && rows.some((row) => !row.hidden));
        block.hidden = !releaseMatches || !inventoryMatches;
    });
    // A line or year section shows only while one of its series does.
    Array.from(resultsElement.querySelectorAll('.collectible-group')).forEach((group) => {
        if (!(group instanceof HTMLElementClass)) return;
        const blocks = Array.from(group.querySelectorAll('.collectible-release-block'))
            .filter((block) => block instanceof HTMLElementClass);
        group.hidden = blocks.length > 0 && blocks.every((block) => block.hidden);
    });
};

export const catalogRequestParams = (query, brand, sort, offset, years = [], series = []) => {
    const params = new URLSearchParams();
    if (query !== '') params.set('q', query);
    if (brand !== '') params.set('brand', brand);
    params.set('year', Array.isArray(years) && years.length > 0 ? years.join(',') : 'all');
    if (Array.isArray(series) && series.length > 0) params.set('series', series.join(','));
    params.set('sort', sort);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return params;
};

export const appendCatalogPage = (state, payload) => {
    const offset = state.loaded;
    const items = payload && Array.isArray(payload.data) ? payload.data : [];
    const meta = payload && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
    const total = Number.isInteger(meta.total) && meta.total >= 0 ? meta.total : offset + items.length;
    state.products.push(...items);
    state.loaded = offset + items.length;
    state.total = Math.max(total, state.loaded);
    return items.length;
};

export const isReleaseExpanded = (productId, closedProducts) => !closedProducts
    || typeof closedProducts.has !== 'function'
    || !closedProducts.has(String(productId));

export const createRequestGate = () => {
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

// Spreadsheet export: one row per figure, or per listing that names none, with
// the visitor's owned flag and quantity beside the catalog facts.
export const EXPORT_COLUMNS = Object.freeze([
    'Brand', 'Line', 'Year', 'Series', 'Listing', 'Listing type', 'Figure', 'Secret',
    'Owned', 'Quantity', 'Price', 'Currency', 'Price type', 'SKU', 'Barcode', 'Listing URL',
]);
const EXPORT_LISTING_TYPES = Object.freeze({
    series: 'Series',
    'whole-set': 'Whole set',
    box: 'Blind box',
    figure: 'Single figure',
    accessory: 'Series accessory',
    standalone: 'Standalone',
});

// The catalog half of a row. The context is the set the shelf files the
// listing under (its line, batch year, and title); a null variant is a
// listing with no figures to own. A figure's own price, SKU, and barcode win
// over its listing's.
export const exportRecord = (product, variant, context = {}) => {
    const safeProduct = product && typeof product === 'object' ? product : {};
    const own = variant && typeof variant === 'object' ? variant : null;
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    const brandKey = text(safeProduct.brand).toLowerCase();
    const brand = Object.prototype.hasOwnProperty.call(BRANDS, brandKey) ? brandKey : '';
    const hasPrice = (item) => item !== null && Number.isFinite(item.price_cents) && text(item.currency) !== '';
    const priced = hasPrice(own) ? own : (hasPrice(safeProduct) ? safeProduct : null);
    const identified = own ?? safeProduct;
    const barcode = text(identified.barcode);
    return {
        brand: brand !== '' ? BRANDS[brand] : (text(safeProduct.brand) || 'Collectible'),
        line: lineLabel(context.line ?? safeProduct.line),
        year: Number.isInteger(context.year) ? context.year
            : (Number.isInteger(safeProduct.release_year) ? safeProduct.release_year : null),
        series: text(context.series) || text(safeProduct.series_title),
        listing: titleWithoutBrand(text(safeProduct.title) || 'Untitled listing', brand),
        listingType: EXPORT_LISTING_TYPES[safeProduct.listing_kind] ?? '',
        figure: own === null ? null : (text(own.name) === '' ? 'Unnamed figure' : titleWithoutBrand(text(own.name), brand)),
        secret: own !== null && own.is_secret === true,
        priceCents: priced === null ? null : priced.price_cents,
        currency: priced === null ? '' : text(priced.currency).toUpperCase(),
        priceKind: priced !== null && ['retail', 'asking', 'sold'].includes(priced.price_kind) ? priced.price_kind : '',
        sku: text(identified.sku),
        barcode: /^[0-9]{8,14}$/.test(barcode) ? barcode : '',
        url: text(safeProduct.product_url).startsWith('https://') ? text(safeProduct.product_url) : '',
    };
};

// A record and the visitor's quantity as EXPORT_COLUMNS cells. A listing with
// no figures leaves the figure and ownership cells blank.
export const exportRow = (record, quantity) => {
    const isFigure = record.figure !== null;
    const price = Number.isFinite(record.priceCents) ? (record.priceCents / 100).toFixed(2) : '';
    return [
        record.brand,
        record.line,
        record.year === null ? '' : String(record.year),
        record.series,
        record.listing,
        record.listingType,
        isFigure ? record.figure : '',
        isFigure ? (record.secret ? 'Yes' : 'No') : '',
        isFigure ? (isOwnedQuantity(quantity) ? 'Yes' : 'No') : '',
        isFigure ? String(Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0) : '',
        price,
        price === '' ? '' : record.currency,
        price === '' ? '' : record.priceKind,
        record.sku,
        record.barcode,
        record.url,
    ];
};

// RFC 4180 cells. Text a spreadsheet would run as a formula (a leading =, +,
// -, @, tab, or carriage return) gets an apostrophe so store text stays text.
const csvCell = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// The byte-order mark lets Excel read α, θ, and accented names as UTF-8.
export const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

// "collectibles-nommi-2026-10-05.csv", dated in the visitor's own time zone.
export const exportFilename = (stem, date) => {
    const pad = (value) => String(value).padStart(2, '0');
    return `${stem}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
};

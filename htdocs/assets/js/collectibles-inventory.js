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
        const releaseIds = Array.isArray(state.releaseIds) ? state.releaseIds : [];
        const releaseMatches = releaseIds.length === 0
            || releaseIds.includes(block.dataset.releaseId)
            || releaseIds.includes(block.dataset.legacyReleaseId);
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

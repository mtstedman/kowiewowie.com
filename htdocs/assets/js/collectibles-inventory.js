export const INVENTORY_STORAGE_KEY = 'collectibles-inventory:v1';
export const INVENTORY_VERSION = 1;

export const PAGE_SIZE = 48;
const INVENTORY_FILTERS = new Set(['all', 'owned', 'missing']);
export const BRANDS = {
    skullpanda: 'SKULLPANDA',
    nommi: 'Nommi',
    'sonny-angel': 'Sonny Angel',
};

export const inventoryKey = (productId, variantName) => JSON.stringify([String(productId), variantName]);

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

export const releaseChoicesFromProducts = (products) => {
    const choices = new Map();
    (Array.isArray(products) ? products : []).forEach((product) => {
        const safeProduct = product && typeof product === 'object' ? product : {};
        const id = String(safeProduct.id ?? '');
        if (id === '' || choices.has(id)) return;
        const title = typeof safeProduct.title === 'string' && safeProduct.title.trim() !== ''
            ? safeProduct.title.trim()
            : 'Untitled series';
        choices.set(id, {
            id,
            title,
            brand: Object.prototype.hasOwnProperty.call(BRANDS, String(safeProduct.brand ?? '').trim().toLowerCase())
                ? BRANDS[String(safeProduct.brand).trim().toLowerCase()]
                : (typeof safeProduct.brand === 'string' && safeProduct.brand.trim() !== '' ? safeProduct.brand.trim() : 'Collectible'),
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
        const releaseMatches = state.releaseId === '' || block.dataset.releaseId === state.releaseId;
        const inventoryMatches = state.inventoryFilter === 'all'
            || (rows.length > 0 && rows.some((row) => !row.hidden));
        block.hidden = !releaseMatches || !inventoryMatches;
    });
};

export const catalogRequestParams = (query, brand, sort, offset) => {
    const params = new URLSearchParams();
    if (query !== '') params.set('q', query);
    if (brand !== '') params.set('brand', brand);
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

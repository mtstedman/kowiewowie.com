import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  INVENTORY_STORAGE_KEY,
  inventoryKey,
  parseQuantity,
  decodeInventory,
  createInventoryStore,
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
} from '../htdocs/assets/js/collectibles-inventory.js';

// The page versions only collectibles.js, and production caches static
// JavaScript for a week, so its inventory import must carry the module's own
// content hash or a stale cached copy breaks the whole shelf.
{
  const moduleDir = new URL('../htdocs/assets/js/', import.meta.url);
  const page = await readFile(new URL('collectibles.js', moduleDir), 'utf8');
  const imports = [...page.matchAll(/^import [^;]+ from '(\.\/[^'?]+)(\?v=[^']*)?';$/gm)];
  assert.deepEqual(imports.map(([, path]) => path), ['./collectibles-inventory.js']);
  for (const [, path, query] of imports) {
    const expected = `?v=${createHash('sha256').update(await readFile(new URL(path, moduleDir))).digest('hex').slice(0, 12)}`;
    assert.equal(query, expected, `collectibles.js must import ${path}${expected}`);
  }
}

const pageSource = await readFile(new URL('../htdocs/collectibles/index.php', import.meta.url), 'utf8');
const applicationSource = await readFile(new URL('../htdocs/assets/js/collectibles.js', import.meta.url), 'utf8');
assert.match(pageSource, /<script type="module" src="\/assets\/js\/collectibles\.js/);
assert.match(pageSource, /<label for="collectibles-release">Series<\/label>/);
assert.doesNotMatch(applicationSource, /__collectiblesInventoryTest/);

let activeDocument = null;

class FakeTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentElement = null;
  }

  querySelectorAll() {
    return [];
  }
}

class HTMLElement {
  constructor(className = '', dataset = {}, children = []) {
    this.tagName = 'DIV';
    this.className = className;
    this.dataset = { ...dataset };
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.type = '';
    this.attributes = new Map();
    this.listeners = new Map();
    this._id = '';
    this._textContent = '';
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => classes.add(name));
        this.className = Array.from(classes).join(' ');
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this.className.split(/\s+/).filter((name) => name && !removed.has(name)).join(' ');
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const next = enabled === undefined ? !this.classList.contains(name) : Boolean(enabled);
        if (next) this.classList.add(name);
        else this.classList.remove(name);
        return next;
      },
    };
    this.append(...children);
  }

  set id(value) {
    if (activeDocument && this._id) activeDocument.ids.delete(this._id);
    this._id = String(value);
    if (activeDocument && this._id) activeDocument.ids.set(this._id, this);
  }

  get id() {
    return this._id;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  append(...children) {
    children.forEach((child) => {
      if (child instanceof DocumentFragment) {
        this.append(...child.children);
        child.children = [];
        return;
      }
      const node = child instanceof HTMLElement || child instanceof FakeTextNode
        ? child
        : new FakeTextNode(child);
      node.parentElement = this;
      this.children.push(node);
    });
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    const nextEvent = typeof event === 'string' ? { type: event } : event;
    nextEvent.target = this;
    nextEvent.preventDefault ||= () => { nextEvent.defaultPrevented = true; };
    (this.listeners.get(nextEvent.type) || []).forEach((listener) => listener(nextEvent));
    return !nextEvent.defaultPrevented;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setCustomValidity(message) {
    this.validationMessage = String(message);
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const inputName = selector.match(/^input\[name="([^"]+)"\]$/);
    if (inputName) return this.tagName === 'INPUT' && this.name === inputName[1];
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child instanceof HTMLElement && child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

class HTMLFormElement extends HTMLElement {}
class HTMLInputElement extends HTMLElement {}
class HTMLButtonElement extends HTMLElement {}
class HTMLSelectElement extends HTMLElement {}
class DocumentFragment extends HTMLElement {}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

{
  const assertQuantity = (value, valid, quantity) => {
    const parsed = parseQuantity(value);
    assert.equal(parsed.valid, valid);
    assert.equal(parsed.quantity, quantity);
  };
  assertQuantity('0', true, 0);
  assertQuantity('12', true, 12);
  assertQuantity('', true, 0);
  assertQuantity('  ', true, 0);
  assert.equal(parseQuantity('-1').valid, false);
  assert.equal(parseQuantity('1.5').valid, false);
  assert.equal(parseQuantity('many').valid, false);
  assert.equal(parseQuantity(String(Number.MAX_SAFE_INTEGER + 1)).valid, false);
}

{
  assert.equal(isOwnedQuantity(0), false);
  assert.equal(isOwnedQuantity(1), true);
  assert.equal(quantityForOwnedToggle(true, 0), 1, 'Checking a zero row must set quantity one.');
  assert.equal(quantityForOwnedToggle(true, 4), 4, 'Checking an already positive row must retain its quantity.');
  assert.equal(quantityForOwnedToggle(false, 4), 0, 'Unchecking a row must set quantity zero.');
  assert.equal(quantityMatchesFilter(0, 'all'), true);
  assert.equal(quantityMatchesFilter(3, 'all'), true);
  assert.equal(quantityMatchesFilter(3, 'owned'), true);
  assert.equal(quantityMatchesFilter(0, 'owned'), false);
  assert.equal(quantityMatchesFilter(0, 'missing'), true);
  assert.equal(quantityMatchesFilter(3, 'missing'), false);
}

{
  const storage = new MemoryStorage();
  const persistenceStates = [];
  const first = createInventoryStore(storage, (persistent) => persistenceStates.push(persistent));
  const alphaKey = inventoryKey('set-a', 'Shared figure');
  const betaKey = inventoryKey('set-b', 'Shared figure');
  assert.notEqual(inventoryKey('set|a', 'figure'), inventoryKey('set', 'a|figure'), 'Serialized identities must be collision-safe.');
  first.set(alphaKey, 2);
  first.set(betaKey, 5);

  const second = createInventoryStore(storage, () => {});
  assert.equal(second.get(alphaKey), 2, 'Quantity must survive a browser reload.');
  assert.equal(second.get(betaKey), 5, 'Same-named figures in different sets must remain independent.');
  assert.notEqual(alphaKey, betaKey);
  assert.equal(persistenceStates.at(-1), true);

  const persisted = JSON.parse(storage.getItem(INVENTORY_STORAGE_KEY));
  assert.equal(persisted.version, 1);
  assert.deepEqual(persisted.quantities, { [alphaKey]: 2, [betaKey]: 5 });

  first.set(alphaKey, 0);
  assert.equal(first.get(alphaKey), 0);
  assert.equal(first.snapshot().has(betaKey), true, 'Editing one row must not prune temporarily absent inventory entries.');
}

{
  const malformedStorage = new MemoryStorage({ [INVENTORY_STORAGE_KEY]: '{not json' });
  assert.doesNotThrow(() => createInventoryStore(malformedStorage, () => {}));
  assert.equal(createInventoryStore(malformedStorage, () => {}).snapshot().size, 0);
  assert.throws(() => decodeInventory(JSON.stringify({ version: 99, quantities: {} })));
}

{
  const failedStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  const states = [];
  const store = createInventoryStore(failedStorage, (persistent) => states.push(persistent));
  const key = inventoryKey('offline', 'Session figure');
  assert.equal(store.isPersistent(), false);
  assert.equal(store.set(key, 7), true, 'Storage failure must still permit session editing.');
  assert.equal(store.get(key), 7);
  assert.equal(states.at(-1), false);
}

{
  const pageOne = [
    { id: 'release-a', title: 'Shared title', brand: 'nommi', series_id: 'nommi:shared-a', series_title: 'Shared title', series_roster_status: 'complete', variants: [{ name: 'Alpha' }, { name: 'Beta' }] },
    { id: 'release-c', title: 'Moon Search', brand: 'skullpanda', series_id: 'skullpanda:moon', series_title: 'Moon Search', series_roster_status: 'partial', variants: [{ name: 'Needle' }, { name: 'Star' }] },
  ];
  const pageTwo = [
    { id: 'release-b', title: 'Shared title', brand: 'nommi', series_id: 'nommi:shared-b', series_title: 'Shared title', series_roster_status: 'unknown', variants: [{ name: 'Gamma' }] },
    { id: 'release-d', title: 'Empty Search', brand: 'skullpanda', series_id: 'skullpanda:empty', series_title: 'Empty Search', series_roster_status: 'complete', variants: [] },
  ];
  const completeCatalog = [...pageOne, ...pageTwo];
  const choices = releaseChoicesFromProducts(completeCatalog);
  const closedProducts = new Set();
  assert.equal(isReleaseExpanded('release-a', closedProducts), true, 'Figure inventory must be expanded by default.');
  closedProducts.add('release-a');
  assert.equal(isReleaseExpanded('release-a', closedProducts), false, 'A user may still collapse an expanded release.');
  assert.deepEqual(Array.from(choices, (choice) => choice.id), ['skullpanda:empty', 'skullpanda:moon', 'nommi:shared-a', 'nommi:shared-b']);
  assert.equal(choices.filter((choice) => choice.title === 'Shared title').length, 2, 'Same-titled series must remain distinct by canonical series ID.');
  assert.equal(choices.every((choice) => choice.brand.length > 0), true, 'Release choices must include brand labels.');

  const quantities = new Map([
    [inventoryKey('release-a', 'Alpha'), 2],
    [inventoryKey('release-c', 'Star'), 1],
  ]);
  const fixturePage = (params) => {
    const query = String(params.get('q') || '').toLowerCase();
    const brand = params.get('brand') || '';
    const direction = params.get('sort') === 'name-desc' ? -1 : 1;
    const offset = Number(params.get('offset') || '0');
    const matches = completeCatalog
      .filter((product) => (brand === '' || product.brand === brand)
        && (query === '' || product.title.toLowerCase().includes(query)
          || product.variants.some((variant) => variant.name.toLowerCase().includes(query))))
      .sort((left, right) => direction * (left.title.localeCompare(right.title) || left.id.localeCompare(right.id)));
    return { data: matches.slice(offset, offset + 1), meta: { total: matches.length } };
  };
  const loadFixture = (sort) => {
    const loadState = { products: [], loaded: 0, total: 0 };
    do {
      const params = catalogRequestParams('search', 'skullpanda', sort, loadState.loaded);
      assert.equal(params.get('q'), 'search');
      assert.equal(params.get('brand'), 'skullpanda');
      assert.equal(params.get('sort'), sort);
      assert.equal(params.get('offset'), String(loadState.loaded));
      appendCatalogPage(loadState, fixturePage(params));
    } while (loadState.loaded < loadState.total);
    return loadState.products;
  };
  assert.deepEqual(loadFixture('name-asc').map((product) => product.id), ['release-d', 'release-c']);

  const retryState = { products: [], loaded: 0, total: 0 };
  appendCatalogPage(retryState, fixturePage(catalogRequestParams('search', 'skullpanda', 'name-desc', 0)));
  assert.equal(partialFailureMessage('Load failed.', retryState.loaded, retryState.total), 'Load failed. Partial inventory results are shown; retry to finish loading.');
  appendCatalogPage(retryState, fixturePage(catalogRequestParams('search', 'skullpanda', 'name-desc', retryState.loaded)));
  assert.equal(retryState.loaded, retryState.total, 'Retry must append the remaining API page without discarding partial results.');
  const serverFiltered = retryState.products;
  assert.deepEqual(serverFiltered.map((product) => product.id), ['release-c', 'release-d'], 'Matching releases on later API pages must be retained in server sort order.');

  const rows = new Map();
  const releaseBlocks = serverFiltered.map((product) => {
    const productRows = product.variants.map((variant) => {
      const key = inventoryKey(product.id, variant.name);
      const row = new HTMLElement('collectible-inventory-row', { inventoryKey: key, quantity: String(quantities.get(key) || 0) });
      rows.set(key, row);
      return row;
    });
    return new HTMLElement('collectible-release-block', { releaseId: product.id }, productRows);
  });
  const results = new HTMLElement('collectibles-results', {}, releaseBlocks);
  const visibleReleaseIds = () => releaseBlocks.filter((block) => !block.hidden).map((block) => block.dataset.releaseId);
  const visibleFigureKeys = () => Array.from(rows.values()).filter((row) => !row.hidden).map((row) => row.dataset.inventoryKey);
  const apply = (releaseId, inventoryFilter) => {
    applyInventoryVisibility(results, { releaseId, inventoryFilter }, HTMLElement);
    return visibleReleaseIds();
  };

  assert.deepEqual(apply('', 'all'), ['release-c', 'release-d']);
  assert.equal(visibleFigureKeys().length, 2);
  assert.deepEqual(apply('', 'owned'), ['release-c']);
  assert.deepEqual(visibleFigureKeys(), [inventoryKey('release-c', 'Star')]);
  assert.deepEqual(apply('', 'missing'), ['release-c']);
  assert.deepEqual(visibleFigureKeys(), [inventoryKey('release-c', 'Needle')]);
  assert.deepEqual(apply('release-c', 'all'), ['release-c']);
  assert.deepEqual(apply('release-c', 'owned'), ['release-c']);
  assert.deepEqual(apply('release-c', 'missing'), ['release-c']);
  assert.deepEqual(apply('release-d', 'owned'), [], 'Empty releases must disappear from ownership-filtered results.');

  rows.get(inventoryKey('release-c', 'Star')).dataset.quantity = '0';
  assert.deepEqual(apply('release-c', 'owned'), [], 'Quantity changes must immediately remove a release from Owned results.');
  rows.get(inventoryKey('release-c', 'Needle')).dataset.quantity = '3';
  assert.deepEqual(apply('release-c', 'owned'), ['release-c'], 'Quantity changes must immediately add a release to Owned results.');
}

{
  const gate = createRequestGate();
  const first = gate.next();
  const second = gate.next();
  const loadState = { products: [], loaded: 0, total: 0 };
  if (gate.isCurrent(first)) appendCatalogPage(loadState, { data: [{ id: 'stale' }], meta: { total: 1 } });
  assert.equal(gate.isCurrent(first), false, 'A stale response must not remain current.');
  assert.equal(loadState.loaded, 0, 'A stale response must not replace the newer catalog selection.');
  if (gate.isCurrent(second)) appendCatalogPage(loadState, { data: [{ id: 'current' }], meta: { total: 1 } });
  assert.deepEqual(loadState.products.map((product) => product.id), ['current']);
  assert.equal(
    partialFailureMessage('Load failed.', 48, 96),
    'Load failed. Partial inventory results are shown; retry to finish loading.',
  );
  assert.equal(partialFailureMessage('Load failed.', 0, 96), 'Load failed.');
}

{
  const classes = new Set();
  const control = {
    attributes: new Map(),
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
  };

  assert.equal(isThumbnailActivationKey('Enter'), true);
  assert.equal(isThumbnailActivationKey(' '), true);
  assert.equal(isThumbnailActivationKey('Escape'), false);
  assert.equal(setExpandedControl(control, true), true);
  assert.equal(control.attributes.get('aria-expanded'), 'true');
  assert.equal(classes.has('is-expanded'), true);
  setExpandedControl(control, false);
  assert.equal(control.attributes.get('aria-expanded'), 'false');
  assert.equal(classes.has('is-expanded'), false);
}


{
  class FakeDocument {
    constructor() {
      this.ids = new Map();
      this.title = 'Collectibles';
      this.documentElement = this.createElement('html');
    }

    createElement(tagName) {
      const constructors = {
        form: HTMLFormElement,
        input: HTMLInputElement,
        button: HTMLButtonElement,
        select: HTMLSelectElement,
      };
      const ElementClass = constructors[tagName] || HTMLElement;
      const element = new ElementClass();
      element.tagName = tagName.toUpperCase();
      return element;
    }

    createDocumentFragment() {
      const fragment = new DocumentFragment();
      fragment.tagName = '#FRAGMENT';
      return fragment;
    }

    getElementById(id) {
      return this.ids.get(id) || null;
    }
  }

  const document = new FakeDocument();
  activeDocument = document;
  const element = (tagName, id) => {
    const node = document.createElement(tagName);
    node.id = id;
    return node;
  };
  const form = element('form', 'collectibles-form');
  const searchInput = element('input', 'collectibles-search-input');
  const status = element('p', 'collectibles-status');
  const storageStatus = element('p', 'collectibles-storage-status');
  const updated = element('p', 'collectibles-updated');
  const results = element('div', 'collectibles-results');
  const loadMore = element('button', 'collectibles-load-more');
  const releaseSelect = element('select', 'collectibles-release');
  const sortSelect = element('select', 'collectibles-sort');
  const exportButton = element('button', 'collectibles-export-pdf');
  sortSelect.value = 'name-asc';

  const brandValues = ['', 'skullpanda', 'nommi', 'sonny-angel'];
  const brandInputs = brandValues.map((value, index) => {
    const input = document.createElement('input');
    input.name = 'brand';
    input.value = value;
    input.checked = index === 0;
    return input;
  });
  const inventoryValues = ['all', 'owned', 'missing'];
  const inventoryInputs = inventoryValues.map((value, index) => {
    const input = document.createElement('input');
    input.name = 'inventory';
    input.value = value;
    input.checked = index === 0;
    return input;
  });
  form.append(searchInput, ...brandInputs, releaseSelect, ...inventoryInputs, sortSelect, exportButton);

  const catalog = [
    {
      id: 'sonny-retail-a',
      title: 'Animal Series Rabbit Retail',
      brand: 'sonny-angel',
      series_id: 'sonny-angel:animal-1',
      series_title: 'Animal Series',
      series_roster_status: 'complete',
      variants: [{ name: 'Rabbit' }],
    },
    {
      id: 'skull-retail-a',
      title: 'City of Night First Retail',
      brand: 'skullpanda',
      series_id: 'skullpanda:city',
      series_title: 'City of Night',
      series_roster_status: 'partial',
      series_release_year: 2022,
      line: 'figures',
      listing_kind: 'accessory',
      variants: [{ name: 'Night' }, { name: 'Lantern' }],
    },
    {
      id: 'nommi-retail-a',
      title: 'Shared Dream Retail',
      brand: 'nommi',
      series_id: 'nommi:dream-a',
      series_title: 'Shared Dream',
      series_roster_status: 'unknown',
      variants: [{ name: 'Cloud' }],
    },
    {
      id: 'sonny-retail-b',
      title: 'Animal Series Elephant Retail',
      brand: 'sonny-angel',
      series_id: 'sonny-angel:animal-1',
      series_title: 'Animal Series',
      series_roster_status: 'complete',
      variants: [{ name: 'Elephant' }],
    },
    {
      id: 'skull-retail-b',
      title: 'City of Night Second Edition',
      brand: 'skullpanda',
      series_id: 'skullpanda:city-alt',
      series_title: 'City of Night',
      series_roster_status: 'complete',
      series_release_year: 2023,
      line: 'figures',
      listing_kind: 'series',
      sku: 'PM-CITY-ALT',
      barcode: '6941848212345',
      variants: [{ name: 'Dawn', sku: 'PM-CITY-DAWN', barcode: 'not-a-code' }],
    },
    {
      id: 'nommi-unmapped',
      title: 'Mystery Retail',
      brand: 'nommi',
      series_id: null,
      series_title: null,
      series_roster_status: 'unknown',
      variants: [{ name: 'Mystery' }],
    },
    {
      id: 'nommi-empty',
      title: 'Known Empty Retail',
      brand: 'nommi',
      series_id: 'nommi:known-empty',
      series_title: 'Known Empty',
      series_roster_status: 'complete',
      variants: [],
    },
    {
      id: 'skull-retail-c',
      title: 'City of Night Later Retail',
      brand: 'skullpanda',
      series_id: 'skullpanda:city',
      series_title: 'City of Night',
      series_roster_status: 'partial',
      series_release_year: 2022,
      line: 'figures',
      listing_kind: 'series',
      variants: [{ name: 'Moon' }],
    },
    {
      id: 'nommi-retail-b',
      title: 'Shared Dream Later Retail',
      brand: 'nommi',
      series_id: 'nommi:dream-a',
      series_title: 'Shared Dream',
      series_roster_status: 'unknown',
      variants: [{ name: 'Star' }],
    },
  ];

  const storage = new MemoryStorage({
    [INVENTORY_STORAGE_KEY]: JSON.stringify({
      version: 1,
      quantities: { [inventoryKey('sonny-retail-a', 'Rabbit')]: 2 },
    }),
  });
  const location = {
    pathname: '/collectibles/',
    search: '?release=sonny-retail-b',
    hash: '',
  };
  const windowListeners = new Map();
  let printCalls = 0;
  const window = {
    localStorage: storage,
    location,
    history: {
      replaceState(_state, _title, nextUrl) {
        const parsed = new URL(nextUrl, 'https://example.test');
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    setTimeout,
    clearTimeout,
    print() { printCalls += 1; },
  };

  Object.assign(globalThis, {
    document,
    window,
    HTMLElement,
    HTMLFormElement,
    HTMLInputElement,
    HTMLButtonElement,
    HTMLSelectElement,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  });

  let releaseFailurePending = true;
  const releaseOffsets = [];
  globalThis.fetch = async (requestUrl, options = {}) => {
    const parsed = new URL(requestUrl, 'https://example.test');
    const offset = Number(parsed.searchParams.get('offset') || '0');
    const isCatalogRequest = Object.prototype.hasOwnProperty.call(options, 'credentials');
    if (!isCatalogRequest) {
      releaseOffsets.push(offset);
      if (releaseFailurePending && offset === 2) {
        releaseFailurePending = false;
        return { ok: false, status: 503, json: async () => ({}) };
      }
    }
    const query = isCatalogRequest ? String(parsed.searchParams.get('q') || '').toLowerCase() : '';
    const brand = isCatalogRequest ? String(parsed.searchParams.get('brand') || '') : '';
    const matches = catalog.filter((product) => (brand === '' || product.brand === brand)
      && (query === ''
        || product.title.toLowerCase().includes(query)
        || String(product.series_title || '').toLowerCase().includes(query)
        || product.variants.some((variant) => variant.name.toLowerCase().includes(query))));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: matches.slice(offset, offset + 1),
        meta: { total: matches.length, last_synced_at: '2026-10-04T00:00:00Z' },
      }),
    };
  };

  const waitFor = async (predicate, message) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(message);
  };

  const applicationUrl = new URL('../htdocs/assets/js/collectibles.js', import.meta.url);
  applicationUrl.searchParams.set('integration', String(Date.now()));
  await import(applicationUrl.href);
  await waitFor(
    () => results.getAttribute('aria-busy') === 'false' && results.querySelectorAll('.collectible-release-block').length === 6,
    'The browser application should finish rendering the complete multi-page catalog.',
  );

  const allBlocks = () => results.querySelectorAll('.collectible-release-block');
  const blockBySeries = (seriesId) => allBlocks().find((block) => block.dataset.releaseId === seriesId);
  const sonnyBlock = blockBySeries('sonny-angel:animal-1');
  assert.equal(sonnyBlock.querySelectorAll('.collectible-card').length, 2, 'Sonny Angel listings split across API pages must render in one canonical series group.');
  assert.equal(blockBySeries('skullpanda:city').querySelectorAll('.collectible-card').length, 2, 'Skullpanda listings split across API pages must render in one canonical series group.');
  // Sets sit under brand, product line, and release year; the set's own card
  // leads and store listings follow under their own heading.
  const cityBlock = blockBySeries('skullpanda:city');
  const cityCards = cityBlock.querySelectorAll('.collectible-card');
  assert.equal(cityCards[0].dataset.productKey, 'skull-retail-c', 'The set card must lead its series block.');
  assert.equal(cityBlock.querySelector('.collectible-listings-heading').textContent, 'Store listings (1)');
  assert.equal(cityCards[1].querySelector('.collectible-listing-kind').textContent, 'Series accessory');
  const figureLines = results.querySelectorAll('.collectible-line').filter((section) => section.dataset.line === 'figures');
  assert.ok(figureLines.some((section) => section.querySelectorAll('.collectible-year').some((year) => year.dataset.year === '2022'
    && year.querySelectorAll('.collectible-release-block').includes(cityBlock))), 'City of Night must sit in the 2022 batch of its figure line.');
  // Two dated batches in one line get a jump bar, newest first, linking to
  // each year's section.
  const skullFigures = figureLines.find((section) => section.querySelectorAll('.collectible-release-block').includes(cityBlock));
  const jumpLinks = skullFigures.querySelectorAll('.collectible-year-link');
  assert.deepEqual(jumpLinks.map((link) => link.textContent), ['2023', '2022']);
  const target2022 = skullFigures.querySelectorAll('.collectible-year').find((year) => year.dataset.year === '2022');
  assert.equal(jumpLinks[1].href, `#${target2022.id}`, 'Each jump link must target its year section.');
  // Retail identifiers show on the card and the figure row; a malformed
  // barcode is not shown.
  const cityAltBlock = blockBySeries('skullpanda:city-alt');
  assert.equal(cityAltBlock.querySelector('.collectible-card-summary').querySelector('.collectible-identifiers').textContent, 'SKU PM-CITY-ALT · Barcode 6941848212345');
  assert.equal(cityAltBlock.querySelector('.collectible-inventory-name').querySelector('.collectible-identifiers').textContent, 'SKU PM-CITY-DAWN');
  assert.equal(blockBySeries('nommi:dream-a').querySelectorAll('.collectible-card').length, 2, 'Nommi listings split across API pages must render in one canonical series group.');
  assert.equal(sonnyBlock.dataset.legacyReleaseId, 'sonny-retail-b', 'A legacy product selection must resolve to its containing series while choices are incomplete.');
  assert.equal(sonnyBlock.hidden, false);
  assert.equal(allBlocks().filter((block) => !block.hidden).length, 1, 'The persisted legacy release selection must filter the grouped tree.');
  assert.equal(loadMore.hidden, false);
  assert.match(loadMore.textContent, /Retry loading series/);

  loadMore.dispatchEvent({ type: 'click' });
  await waitFor(() => releaseSelect.disabled === false, 'Retrying must finish the failed multi-page series-choice request.');
  assert.ok(releaseOffsets.filter((offset) => offset === 2).length >= 2, 'The failed release page must be requested again.');
  assert.equal(releaseSelect.value, 'sonny-angel:animal-1', 'Legacy product IDs must normalize to the canonical series ID.');
  assert.match(location.search, /release=sonny-angel%3Aanimal-1/);

  const optionValues = releaseSelect.children.filter((option) => !option.disabled).map((option) => option.value);
  assert.equal(new Set(optionValues).size, optionValues.length, 'Duplicate display titles must retain distinct option identities.');
  assert.ok(optionValues.includes('sonny-angel:animal-1'));
  assert.ok(optionValues.includes('skullpanda:city'));
  assert.ok(optionValues.includes('skullpanda:city-alt'));
  assert.ok(optionValues.includes('nommi:dream-a'));
  assert.ok(optionValues.includes('unclassified:nommi'));
  assert.equal(releaseSelect.children.filter((option) => option.textContent.startsWith('City of Night')).length, 2);

  releaseSelect.value = '';
  releaseSelect.dispatchEvent({ type: 'change' });
  assert.equal(allBlocks().filter((block) => !block.hidden).length, 6);
  assert.match(blockBySeries('skullpanda:city').querySelector('.collectible-release-status').textContent, /Roster incomplete/);
  assert.match(blockBySeries('unclassified:nommi').querySelector('.collectible-release-status').textContent, /Series membership is unknown/);
  assert.match(blockBySeries('nommi:known-empty').querySelector('.collectible-release-status').textContent, /Known complete roster: no figures/);

  exportButton.dispatchEvent({ type: 'click' });
  assert.equal(printCalls, 1, 'PDF export should prepare and print the grouped catalog.');
  assert.equal(results.querySelectorAll('.collectible-variants-toggle').every((toggle) => toggle.getAttribute('aria-expanded') === 'true'), true);
  (windowListeners.get('afterprint') || []).forEach((listener) => listener());
  assert.equal(exportButton.disabled, false);

  const disclosure = sonnyBlock.querySelector('.collectible-variants-toggle');
  const disclosurePanel = document.getElementById(disclosure.getAttribute('aria-controls'));
  assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
  disclosure.dispatchEvent({ type: 'click' });
  assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
  assert.equal(disclosurePanel.hidden, true, 'Grouped disclosure controls must continue to collapse their own retail listing.');

  inventoryInputs.forEach((input) => { input.checked = input.value === 'owned'; });
  inventoryInputs.find((input) => input.value === 'owned').dispatchEvent({ type: 'change' });
  assert.deepEqual(allBlocks().filter((block) => !block.hidden).map((block) => block.dataset.releaseId), ['sonny-angel:animal-1']);
  const rabbitRow = results.querySelectorAll('.collectible-inventory-row')
    .find((row) => row.dataset.inventoryKey === inventoryKey('sonny-retail-a', 'Rabbit'));
  const rabbitQuantity = rabbitRow.querySelectorAll('input').find((input) => input.type === 'text');
  rabbitQuantity.value = '0';
  rabbitQuantity.dispatchEvent({ type: 'change' });
  assert.equal(allBlocks().filter((block) => !block.hidden).length, 0, 'Quantity edits must immediately update grouped Owned filtering.');
  const elephantRow = results.querySelectorAll('.collectible-inventory-row')
    .find((row) => row.dataset.inventoryKey === inventoryKey('sonny-retail-b', 'Elephant'));
  const elephantQuantity = elephantRow.querySelectorAll('input').find((input) => input.type === 'text');
  elephantQuantity.value = '3';
  elephantQuantity.dispatchEvent({ type: 'change' });
  assert.deepEqual(allBlocks().filter((block) => !block.hidden).map((block) => block.dataset.releaseId), ['sonny-angel:animal-1']);
  assert.equal(JSON.parse(storage.getItem(INVENTORY_STORAGE_KEY)).quantities[inventoryKey('sonny-retail-b', 'Elephant')], 3);

  inventoryInputs.forEach((input) => { input.checked = input.value === 'all'; });
  inventoryInputs.find((input) => input.value === 'all').dispatchEvent({ type: 'change' });
  releaseSelect.value = 'skullpanda:city';
  releaseSelect.dispatchEvent({ type: 'change' });
  brandInputs.forEach((input) => { input.checked = input.value === 'nommi'; });
  brandInputs.find((input) => input.value === 'nommi').dispatchEvent({ type: 'change' });
  await waitFor(
    () => results.getAttribute('aria-busy') === 'false' && allBlocks().length === 3,
    'Changing brands should reload the matching catalog groups.',
  );
  assert.equal(releaseSelect.value, '', 'A series from another brand must not remain invisibly selected.');
  assert.equal(releaseSelect.children.filter((option) => !option.disabled).every((option) => option.value === '' || option.textContent.includes('Nommi')), true);

  searchInput.value = 'no-match';
  form.dispatchEvent({ type: 'submit' });
  await waitFor(
    () => results.getAttribute('aria-busy') === 'false' && results.children.length === 0,
    'An empty catalog response should clear the grouped tree.',
  );
  assert.match(status.textContent, /No collectibles match/);
}

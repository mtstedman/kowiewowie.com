import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SCRIPT_PATH = new URL('../htdocs/assets/js/collectibles.js', import.meta.url);
const script = await readFile(SCRIPT_PATH, 'utf8');
const hooks = {};

class HTMLFormElement {}
class HTMLInputElement {}
class HTMLElement {
  constructor(className = '', dataset = {}, children = []) {
    this.className = className;
    this.dataset = { ...dataset };
    this.children = children;
    this.hidden = false;
  }

  querySelectorAll(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : selector;
    return this.children.flatMap((child) => [
      ...(child.className.split(' ').includes(className) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}
class HTMLButtonElement {}
class HTMLSelectElement {}

const document = {
  getElementById: () => null,
};
const window = { __collectiblesInventoryTest: hooks };
window.window = window;
window.document = document;

vm.runInNewContext(script, {
  document,
  window,
  HTMLFormElement,
  HTMLInputElement,
  HTMLElement,
  HTMLButtonElement,
  HTMLSelectElement,
  URLSearchParams,
}, { filename: 'collectibles.js' });

const {
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
  filterVariantIdentities,
  releaseChoicesFromProducts,
  applyInventoryVisibility,
  catalogRequestParams,
  appendCatalogPage,
  isReleaseExpanded,
  createRequestGate,
} = hooks;

assert.equal(typeof createInventoryStore, 'function', 'Production inventory hooks were not initialized.');

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
  const pageOne = [{
    id: 'set-a',
    variants: [
      { id: 10, name: 'Alpha', is_secret: false },
      { id: 11, name: 'Beta', is_secret: true },
    ],
  }];
  const pageTwo = [{
    id: 'set-b',
    variants: [
      { id: 20, name: 'Gamma', is_secret: false },
      { id: 21, name: 'Delta', is_secret: false },
    ],
  }];
  const quantities = new Map([
    [inventoryKey('set-a', 'Beta'), 1],
    [inventoryKey('set-b', 'Gamma'), 3],
  ]);
  const getQuantity = (key) => quantities.get(key) || 0;
  const products = [...pageOne, ...pageTwo];

  assert.equal(filterVariantIdentities(products, 'all', getQuantity).length, 4);
  assert.deepEqual(
    Array.from(filterVariantIdentities(products, 'owned', getQuantity)),
    [inventoryKey('set-a', 'Beta'), inventoryKey('set-b', 'Gamma')],
  );
  assert.deepEqual(
    Array.from(filterVariantIdentities(products, 'missing', getQuantity)),
    [inventoryKey('set-a', 'Alpha'), inventoryKey('set-b', 'Delta')],
  );

  const refreshed = [{
    id: 'set-a',
    variants: [
      { id: 999, name: 'Beta', is_secret: false },
      { id: 998, name: 'Alpha', is_secret: true },
    ],
  }];
  assert.deepEqual(
    Array.from(filterVariantIdentities(refreshed, 'owned', getQuantity)),
    [inventoryKey('set-a', 'Beta')],
    'Reordering variants and changing variant database IDs must not change inventory identity.',
  );
}

{
  const pageOne = [
    { id: 'release-a', title: 'Shared title', brand: 'nommi', variants: [{ name: 'Alpha' }, { name: 'Beta' }] },
    { id: 'release-c', title: 'Moon Search', brand: 'skullpanda', variants: [{ name: 'Needle' }, { name: 'Star' }] },
  ];
  const pageTwo = [
    { id: 'release-b', title: 'Shared title', brand: 'nommi', variants: [{ name: 'Gamma' }] },
    { id: 'release-d', title: 'Empty Search', brand: 'skullpanda', variants: [] },
  ];
  const completeCatalog = [...pageOne, ...pageTwo];
  const choices = releaseChoicesFromProducts(completeCatalog);
  const closedProducts = new Set();
  assert.equal(isReleaseExpanded('release-a', closedProducts), true, 'Figure inventory must be expanded by default.');
  closedProducts.add('release-a');
  assert.equal(isReleaseExpanded('release-a', closedProducts), false, 'A user may still collapse an expanded release.');
  assert.deepEqual(Array.from(choices, (choice) => choice.id), ['release-d', 'release-c', 'release-a', 'release-b']);
  assert.equal(choices.filter((choice) => choice.title === 'Shared title').length, 2, 'Same-titled releases must remain distinct by product ID.');
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

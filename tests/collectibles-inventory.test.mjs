import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  INVENTORY_STORAGE_KEY,
  inventoryKey,
  parseQuantity,
  decodeInventory,
  MAX_QUANTITY,
  legacyInventoryFigures,
  createCollectionStore,
  isOwnedQuantity,
  quantityMatchesFilter,
  quantityForOwnedToggle,
  isThumbnailActivationKey,
  titleWithoutBrand,
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
  describeOwnership,
  describeSetOwnership,
  catalogRequestParams,
  appendCatalogPage,
  isReleaseExpanded,
  createRequestGate,
  EXPORT_COLUMNS,
  exportRecord,
  exportRow,
  toCsv,
  exportFilename,
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

// Cards sit under their brand's heading, so titles drop the brand words.
for (const [brand, title, expected] of [
  ['skullpanda', 'SKULLPANDA The Ink Plum Blossom Series Figures', 'The Ink Plum Blossom Series Figures'],
  ['skullpanda', 'MEGA α SKULLPANDA 1000% Red Crystal', 'MEGA 1000% Red Crystal'],
  ['skullpanda', 'POP ATTACH θ SKULLPANDA Off Mode Series', 'POP ATTACH Off Mode Series'],
  ['skullpanda', "θSKULLPANDA L'impressionnisme Series Plush Doll", "L'impressionnisme Series Plush Doll"],
  ['skullpanda', 'Pop Mart Skullpanda Candy Monster Town Series', 'Candy Monster Town Series'],
  ['skullpanda', 'SKULLPANDA CHEERS TO MYSELF SERIES-Badge Pendant Blind Box', 'CHEERS TO MYSELF SERIES-Badge Pendant Blind Box'],
  ['skullpanda', 'SKULLPANDA', 'SKULLPANDA'],
  ['skullpanda', 'The Attic of Oddities Series Figures', 'The Attic of Oddities Series Figures'],
  ['nommi', 'Nommi About the Childhood Plush Dolls Blind Box Series: Carousel (Confirmed Style)', 'About the Childhood Plush Dolls Blind Box Series: Carousel (Confirmed Style)'],
  ['nommi', 'Nommi: Whole Set', 'Whole Set'],
  ['sonny-angel', 'Christmas Presents from Sonny Angel', 'Christmas Presents from Sonny Angel'],
  ['sonny-angel', 'Sonny Angel Animal Series 3', 'Animal Series 3'],
  ['pop-bean', 'POP BEAN Lucky Cat Series', 'Lucky Cat Series'],
  ['pop-bean', 'Pop Mart Pop Beans Mini Series', 'Mini Series'],
  ['', 'SKULLPANDA Aisling Figure', 'SKULLPANDA Aisling Figure'],
  ['nommi', 'SKULLPANDA Aisling Figure', 'SKULLPANDA Aisling Figure'],
]) {
  assert.equal(titleWithoutBrand(title, brand), expected, `${brand}: ${title}`);
}

// Spreadsheet rows: the set's context, a figure's own price and codes over its
// listing's, quoted cells, and no store text a spreadsheet would run.
{
  const product = {
    id: '7',
    brand: 'skullpanda',
    title: 'SKULLPANDA Dark Maze Series',
    price_cents: 1999,
    currency: 'usd',
    price_kind: 'retail',
    listing_kind: 'series',
    release_year: 2023,
    sku: 'BOX-1',
    barcode: '6941848212345',
    product_url: 'https://example.test/dark-maze',
  };
  const context = { line: 'figures', year: 2022, series: 'Dark Maze' };
  assert.equal(EXPORT_COLUMNS.length, 16);
  assert.deepEqual(
    exportRow(exportRecord(product, { name: 'Lost', is_secret: false }, context), 0),
    ['SKULLPANDA', 'Figure series', '2022', 'Dark Maze', 'Dark Maze Series', 'Series', 'Lost', 'No', 'No', '0', '19.99', 'USD', 'retail', '', '', 'https://example.test/dark-maze'],
    'A figure takes its set\'s line, year, and title, and its listing\'s price.',
  );
  const secret = exportRow(exportRecord(product, {
    name: '=HYPERLINK("x"), the "Secret"',
    is_secret: true,
    price_cents: 9900,
    currency: 'USD',
    price_kind: 'asking',
    sku: 'FIG-9',
    barcode: 'not-a-code',
  }, context), 2);
  assert.deepEqual(secret.slice(6, 15), ['=HYPERLINK("x"), the "Secret"', 'Yes', 'Yes', '2', '99.00', 'USD', 'asking', 'FIG-9', ''],
    'A figure\'s own price and SKU win; a malformed barcode is left out.');
  assert.deepEqual(
    exportRow(exportRecord({ brand: 'nommi', title: 'Nommi Mystery Plush', line: 'plush' }, null), null),
    ['Nommi', 'Plush series', '', '', 'Mystery Plush', '', '', '', '', '', '', '', '', '', '', ''],
    'A listing with no figures leaves the figure and ownership cells blank.',
  );
  const csv = toCsv([EXPORT_COLUMNS, secret]);
  assert.ok(csv.startsWith('\ufeffBrand,Line,Year,Series,'), 'The byte-order mark lets Excel read UTF-8.');
  assert.ok(csv.endsWith('\r\n'));
  assert.match(csv, /,"'=HYPERLINK\(""x""\), the ""Secret""",Yes,Yes,2,99\.00,/, 'Formulas are defused and quotes doubled.');
  assert.equal(toCsv([['-1', '+1', '@a', 'plain', 'a\nb']]), "\ufeff'-1,'+1,'@a,plain,\"a\nb\"\r\n");
  assert.equal(exportFilename('my-collectibles', new Date(2026, 0, 5)), 'my-collectibles-2026-01-05.csv');
}

// The summary's ownership line: distinct figures owned, then every copy.
assert.equal(describeOwnership([]), '', 'No figures, no ownership line.');
assert.equal(describeOwnership([0, 0]), 'You own 0 of 2 figures here.');
assert.equal(describeOwnership([1]), 'You own 1 of 1 figure here, 1 copy in all.');
assert.equal(describeOwnership([2, 0, 3]), 'You own 2 of 3 figures here, 5 copies in all.');
// Each set's own count: copies show only when duplicates add more.
assert.equal(describeSetOwnership([]), '', 'A set with no figures has no count.');
assert.equal(describeSetOwnership([0, 0, 0]), '0 of 3 owned');
assert.equal(describeSetOwnership([1, 1, 0]), '2 of 3 owned');
assert.equal(describeSetOwnership([2, 0, 3]), '2 of 3 owned, 5 copies');

const pageSource = await readFile(new URL('../htdocs/collectibles/index.php', import.meta.url), 'utf8');
const applicationSource = await readFile(new URL('../htdocs/assets/js/collectibles.js', import.meta.url), 'utf8');
assert.match(pageSource, /<script type="module" src="\/assets\/js\/collectibles\.js/);
assert.match(pageSource, /<label for="collectibles-series-input"[^>]*>Series<\/label>/);
assert.match(pageSource, /<label for="collectibles-year-input"[^>]*>Year<\/label>/);
assert.equal((pageSource.match(/role="combobox"/g) || []).length, 2, 'Year and Series are type-to-filter comboboxes, not dropdowns.');
assert.equal((pageSource.match(/aria-multiselectable="true"/g) || []).length, 2, 'Year and Series take several choices.');
assert.doesNotMatch(applicationSource, /__collectiblesInventoryTest/);
['collectibles-export-toggle', 'collectibles-export-csv', 'collectibles-export-collection', 'collectibles-export-pdf']
  .forEach((id) => assert.match(pageSource, new RegExp(`id="${id}"`), `The export menu offers ${id}.`));

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
    this.style = {
      properties: new Map(),
      setProperty(name, value) { this.properties.set(name, String(value)); },
    };
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

  focus() {
    if (activeDocument) activeDocument.activeElement = this;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
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
  assert.equal(parseQuantity(String(MAX_QUANTITY)).valid, true);
  assert.equal(parseQuantity(String(MAX_QUANTITY + 1)).valid, false, 'A collection records up to a million of one figure.');
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

// The saved collection: nothing changes before it loads; a change shows at
// once and saves in order; a failed save returns to the last saved quantity.
{
  const alphaKey = inventoryKey('set-a', 'Shared figure');
  const betaKey = inventoryKey('set-b', 'Shared figure');
  assert.notEqual(inventoryKey('set|a', 'figure'), inventoryKey('set', 'a|figure'), 'Serialized identities must be collision-safe.');
  const server = new Map([[alphaKey, 2]]);
  const listed = () => ({ figures: Array.from(server, ([key, quantity]) => {
    const [product_id, figure_name] = JSON.parse(key);
    return { product_id, figure_name, quantity };
  }) });
  const saves = [];
  const failing = new Set();
  const reverts = [];
  const store = createCollectionStore({
    load: async () => listed(),
    merge: async (figures) => {
      figures.forEach((figure) => {
        const key = inventoryKey(figure.product_id, figure.figure_name);
        server.set(key, Math.max(server.get(key) || 0, figure.quantity));
      });
      return listed();
    },
    save: async (figure) => {
      saves.push(figure);
      await new Promise((resolve) => setImmediate(resolve));
      if (failing.has(figure.quantity)) throw new Error('offline');
      const key = inventoryKey(figure.product_id, figure.figure_name);
      if (figure.quantity === 0) server.delete(key);
      else server.set(key, figure.quantity);
    },
  }, { onRevert: (key, quantity) => reverts.push([key, quantity]) });

  assert.equal(await store.set(alphaKey, 5), false, 'Nothing changes before the collection loads.');
  assert.equal(store.get(alphaKey), 0);
  await store.load();
  assert.equal(store.get(alphaKey), 2, 'The saved collection loads.');
  const first = store.set(betaKey, 5);
  const second = store.set(betaKey, 6);
  assert.equal(store.get(betaKey), 6, 'A change shows at once.');
  assert.deepEqual([await first, await second], [true, true]);
  assert.deepEqual(saves.map((figure) => figure.quantity), [5, 6], 'Saves run in order.');
  assert.deepEqual(saves[0], { product_id: 'set-b', figure_name: 'Shared figure', quantity: 5 });
  assert.equal(server.get(betaKey), 6);

  failing.add(9);
  assert.equal(await store.set(alphaKey, 9), false);
  assert.equal(store.get(alphaKey), 2, 'A failed save returns to the saved quantity.');
  assert.deepEqual(reverts, [[alphaKey, 2]]);
  const superseded = store.set(betaKey, 9);
  const latest = store.set(betaKey, 7);
  assert.deepEqual([await superseded, await latest], [false, true]);
  assert.equal(store.get(betaKey), 7, 'A later change supersedes an earlier failure.');
  assert.equal(reverts.length, 1, 'A superseded failure undoes nothing.');

  assert.equal(await store.set(alphaKey, 0), true);
  assert.equal(server.has(alphaKey), false, 'Zero removes the figure.');
  assert.equal(await store.set(betaKey, MAX_QUANTITY + 1), false);
  assert.equal(await store.set(betaKey, -1), false);
  await store.merge([{ product_id: 'set-c', figure_name: 'New', quantity: 3 }]);
  assert.equal(store.get(inventoryKey('set-c', 'New')), 3, 'A merge returns the whole collection.');
  assert.equal(store.snapshot().get(betaKey), 7);
}

// What an older visit kept in this browser, ready to move into the collection.
{
  const kept = new MemoryStorage({
    [INVENTORY_STORAGE_KEY]: JSON.stringify({
      version: 1,
      quantities: { [inventoryKey('7', 'Moon')]: 2, [inventoryKey('7', 'Sun')]: 0, [inventoryKey('8', 'Big')]: MAX_QUANTITY + 5 },
    }),
  });
  assert.deepEqual(legacyInventoryFigures(kept), [
    { product_id: '7', figure_name: 'Moon', quantity: 2 },
    { product_id: '8', figure_name: 'Big', quantity: MAX_QUANTITY },
  ]);
  assert.deepEqual(legacyInventoryFigures(new MemoryStorage({ [INVENTORY_STORAGE_KEY]: '{not json' })), []);
  assert.deepEqual(legacyInventoryFigures(new MemoryStorage()), []);
  assert.deepEqual(legacyInventoryFigures(null), []);
  assert.deepEqual(legacyInventoryFigures({ getItem() { throw new Error('denied'); } }), []);
  assert.throws(() => decodeInventory(JSON.stringify({ version: 99, quantities: {} })));
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
  const closedProducts = new Set();
  assert.equal(isReleaseExpanded('release-a', closedProducts), true, 'Figure inventory must be expanded by default.');
  closedProducts.add('release-a');
  assert.equal(isReleaseExpanded('release-a', closedProducts), false, 'A user may still collapse an expanded release.');
  const choices = seriesChoicesFromFacets({ series: completeCatalog.map((product) => ({ id: product.series_id, title: product.series_title, brand: product.brand, line: '', year: null, listings: 1 }))
    .concat([{ id: 'unclassified:nommi:pendants', title: null, brand: 'nommi', line: 'pendants', year: null, listings: 2 }, { id: 'nommi:shared-a', title: 'Shared title', brand: 'nommi' }]) });
  assert.deepEqual(Array.from(choices, (choice) => choice.id), ['skullpanda:empty', 'skullpanda:moon', 'unclassified:nommi:pendants', 'nommi:shared-a', 'nommi:shared-b']);
  assert.equal(choices.find((choice) => choice.id === 'unclassified:nommi:pendants').title, 'Other pendants & charms', 'Set-less groups take their line title.');
  assert.equal(choices.filter((choice) => choice.title === 'Shared title').length, 2, 'Same-titled series must remain distinct by canonical series ID.');
  assert.equal(choices.every((choice) => choice.brand.length > 0), true, 'Release choices must include brand labels.');
  assert.deepEqual(seriesChoicesFromFacets(null), []);

  // Years: the visitor's choice wins; searching or opening a set widens to
  // every year; otherwise the default batch.
  assert.deepEqual(parseYearList(' 2026,ALL, unknown,1850,2026, 2025 '), ['2026', 'unknown', '2025']);
  assert.deepEqual(parseYearList('all'), [], '"all" means no year filter.');
  assert.deepEqual(parseIdList('nommi:dream, bad id!,nommi:dream,123'), ['nommi:dream', '123']);
  assert.deepEqual(requestedYears({ years: null, q: '', releaseIds: [] }, '2026'), ['2026']);
  assert.deepEqual(requestedYears({ years: null, q: 'dark maze', releaseIds: [] }, '2026'), [], 'Searching widens to every year.');
  assert.deepEqual(requestedYears({ years: null, q: '', releaseIds: ['skullpanda:city'] }, '2026'), [], 'Sets from a link widen to every year.');
  assert.deepEqual(requestedYears({ years: ['2022', '2024'], q: 'dark maze', releaseIds: [] }, '2026'), ['2022', '2024'], 'Chosen years win.');
  assert.deepEqual(requestedYears({ years: [], q: '', releaseIds: [] }, '2026'), [], 'Clearing every year means all years.');
  assert.deepEqual(['', ' from 2026', ' from 2025 and 2026', ' from 2024, 2025, and 2026', ' with no known release year', ' from 2026 or with no known release year'],
    [[], ['2026'], ['2026', '2025'], ['2026', '2024', '2025'], ['unknown'], ['2026', 'unknown']].map(describeYears));
  const yearFacets = { years: [{ year: 2024, series: 3, listings: 5 }, { year: null, series: 2, listings: 4 }, { year: 2025, series: 1, listings: 1 }] };
  assert.deepEqual(yearChoicesFromFacets(yearFacets).map((choice) => [choice.value, choice.label, choice.detail]), [
    ['2025', '2025', '1 series'], ['2024', '2024', '3 series'], ['unknown', 'Year unknown', '2 series'],
  ], 'Only years with matches are offered, newest first and undated last.');
  assert.deepEqual(yearChoicesFromFacets({ years: [{ year: 2026, series: 0, listings: 0 }, { year: null, series: 0, listings: 0 }] }), [], 'Empty year facets are hidden.');
  assert.deepEqual(yearChoicesFromFacets({}), [], 'No year choices are shown before facets arrive.');
  assert.deepEqual(matchChoices(yearChoicesFromFacets(yearFacets), '202').map((choice) => choice.value), ['2025', '2024']);
  assert.deepEqual(matchChoices(yearChoicesFromFacets(yearFacets), 'UNK').map((choice) => choice.value), ['unknown']);
  assert.deepEqual(matchChoices([{ value: 'a', label: 'City of Night', detail: 'SKULLPANDA' }, { value: 'b', label: 'Dream', detail: 'Nommi' }], 'skull').map((choice) => choice.value), ['a'], 'Typing matches the brand too.');
  assert.equal(newestFacetYear(yearFacets), '2025');
  assert.equal(newestFacetYear({ years: [{ year: null, series: 1, listings: 1 }] }), '');
  const listParams = catalogRequestParams('', 'nommi', 'name-asc', 0, ['2025', '2026'], ['nommi:dream', 'nommi:sky']);
  assert.deepEqual([listParams.get('year'), listParams.get('series')], ['2025,2026', 'nommi:dream,nommi:sky']);
  assert.equal(catalogRequestParams('', '', 'name-asc', 0).get('year'), 'all', 'Callers that name no year ask for every year.');
  assert.equal(catalogRequestParams('', '', 'name-asc', 0, [], []).has('series'), false);

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
    applyInventoryVisibility(results, { releaseIds: releaseId === '' ? [] : [releaseId], inventoryFilter }, HTMLElement);
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
      this.body = this.createElement('body');
      this.activeElement = null;
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
  const yearInput = element('input', 'collectibles-year-input');
  const yearOptions = element('ul', 'collectibles-year-options');
  const yearChips = element('span', 'collectibles-year-chips');
  const seriesInput = element('input', 'collectibles-series-input');
  const seriesOptions = element('ul', 'collectibles-series-options');
  const seriesChips = element('span', 'collectibles-series-chips');
  yearOptions.hidden = true;
  seriesOptions.hidden = true;
  const sortSelect = element('select', 'collectibles-sort');
  const exportButton = element('button', 'collectibles-export-pdf');
  const exportContainer = element('div', 'collectibles-export');
  const exportToggle = element('button', 'collectibles-export-toggle');
  const exportMenu = element('div', 'collectibles-export-menu');
  const exportCsvButton = element('button', 'collectibles-export-csv');
  const exportCsvDetail = element('span', 'collectibles-export-csv-detail');
  const exportCollectionButton = element('button', 'collectibles-export-collection');
  const exportCollectionDetail = element('span', 'collectibles-export-collection-detail');
  exportMenu.hidden = true;
  exportCsvButton.append(exportCsvDetail);
  exportCollectionButton.append(exportCollectionDetail);
  exportMenu.append(exportCsvButton, exportCollectionButton, exportButton);
  exportContainer.append(exportToggle, exportMenu);
  sortSelect.value = 'name-asc';

  const brandValues = ['', 'skullpanda', 'nommi', 'sonny-angel', 'pop-bean'];
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
  form.append(searchInput, ...brandInputs, yearInput, yearOptions, yearChips, seriesInput, seriesOptions, seriesChips, ...inventoryInputs, sortSelect, exportContainer);

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
      variants: [{ name: 'Dawn', sku: 'PM-CITY-DAWN', barcode: 'not-a-code', image_url: '/assets/images/collectibles/skullpanda/city-of-night/dawn.webp' }],
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
    search: '',
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

  // A stand-in for the API: text, brand, year and set filters, one listing
  // per page, and the year/set facets the shelf builds its choices from.
  const yearOf = (product) => (Number.isInteger(product.series_release_year) ? product.series_release_year
    : (Number.isInteger(product.release_year) ? product.release_year : null));
  const groupOf = (product) => product.series_id || `unclassified:${product.brand}${product.line ? `:${product.line}` : ''}`;
  const requests = [];
  // A stand-in for the collection API: this browser's saved figures.
  const savedCollection = new Map();
  const collectionRequests = [];
  let failSaves = false;
  const collectionPayload = () => ({
    data: Array.from(savedCollection, ([key, quantity]) => {
      const [product_id, figure_name] = JSON.parse(key);
      return { product_id, figure_name, quantity };
    }),
    meta: { owner: 'guest', count: savedCollection.size },
  });
  globalThis.fetch = async (requestUrl, options = {}) => {
    const url = new URL(requestUrl, 'https://example.test');
    if (url.pathname.startsWith('/api/v1/collectibles/collection')) {
      const body = options.body ? JSON.parse(options.body) : null;
      collectionRequests.push(`${options.method || 'GET'} ${url.pathname}`);
      if (url.pathname.endsWith('/figures')) {
        if (failSaves) return { ok: false, status: 503, json: async () => ({ error: 'unavailable', message: 'Down.' }) };
        const key = inventoryKey(body.product_id, body.figure_name);
        if (body.quantity === 0) savedCollection.delete(key);
        else savedCollection.set(key, body.quantity);
        return { ok: true, status: 200, json: async () => ({ data: body, meta: { owner: 'guest' } }) };
      }
      if (url.pathname.endsWith('/merge')) {
        body.figures.forEach((figure) => {
          const key = inventoryKey(figure.product_id, figure.figure_name);
          savedCollection.set(key, Math.max(savedCollection.get(key) || 0, figure.quantity));
        });
      }
      return { ok: true, status: 200, json: async () => collectionPayload() };
    }
    const params = url.searchParams;
    requests.push(params);
    const offset = Number(params.get('offset') || '0');
    const query = String(params.get('q') || '').toLowerCase();
    const brand = String(params.get('brand') || '');
    const chosenYears = String(params.get('year') || 'all').split(',').filter((token) => token !== '' && token !== 'all');
    const base = catalog.filter((product) => (brand === '' || product.brand === brand)
      && (query === ''
        || product.title.toLowerCase().includes(query)
        || String(product.series_title || '').toLowerCase().includes(query)
        || product.variants.some((variant) => variant.name.toLowerCase().includes(query))));
    const series = String(params.get('series') || '').split(',').filter(Boolean).map((id) => {
      const legacy = base.find((product) => product.id === id);
      return !base.some((product) => groupOf(product) === id) && legacy ? groupOf(legacy) : id;
    });
    const inYear = (product) => chosenYears.length === 0 || chosenYears.includes(yearOf(product) === null ? 'unknown' : String(yearOf(product)));
    const years = new Map();
    base.forEach((product) => {
      const key = String(yearOf(product));
      if (!years.has(key)) years.set(key, { year: yearOf(product), series: new Set(), listings: 0 });
      years.get(key).series.add(groupOf(product));
      years.get(key).listings += 1;
    });
    const seriesFacets = new Map();
    base.filter(inYear).forEach((product) => {
      if (!seriesFacets.has(groupOf(product))) {
        seriesFacets.set(groupOf(product), { id: groupOf(product), title: product.series_id ? product.series_title : null, brand: product.brand, line: product.line || '', year: yearOf(product), listings: 0 });
      }
      seriesFacets.get(groupOf(product)).listings += 1;
    });
    const matches = base.filter(inYear).filter((product) => series.length === 0 || series.includes(groupOf(product)));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: matches.slice(offset, offset + 1),
        meta: {
          total: matches.length,
          last_synced_at: '2026-10-04T00:00:00Z',
          year: chosenYears.length === 0 ? 'all' : chosenYears.join(','),
          series,
          facets: {
            years: Array.from(years.values()).map((entry) => ({ year: entry.year, series: entry.series.size, listings: entry.listings })),
            series: Array.from(seriesFacets.values()),
          },
        },
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
  const allBlocks = () => results.querySelectorAll('.collectible-release-block');
  const blockBySeries = (seriesId) => allBlocks().find((block) => block.dataset.releaseId === seriesId);
  const settled = () => results.getAttribute('aria-busy') === 'false';
  const thisYear = String(new Date().getFullYear());
  const chipValues = (chips) => chips.children.map((chip) => chip.dataset.value);
  const optionNodes = (options) => options.children.filter((option) => option.dataset && option.dataset.value !== undefined);
  const openPicker = (input) => input.dispatchEvent({ type: 'focus' });
  const pick = (input, options, value) => {
    openPicker(input);
    const option = optionNodes(options).find((node) => node.dataset.value === value);
    assert.ok(option, `The picker should offer ${value}.`);
    option.dispatchEvent({ type: 'click' });
  };
  const typeInto = (input, text) => {
    input.value = text;
    input.dispatchEvent({ type: 'input' });
  };

  // The shelf opens on this year's batch; with nothing listed this year it
  // falls back to the newest year that has listings, without a whole-catalog
  // download.
  await waitFor(() => settled() && requests.length >= 2 && allBlocks().length === 1, 'The shelf should open on the newest batch.');
  assert.equal(requests[0].get('year'), thisYear, 'The first request asks for the current year only.');
  // The collection loads from the server, and what this browser kept before moves into it once.
  assert.deepEqual(collectionRequests, ['GET /api/v1/collectibles/collection', 'POST /api/v1/collectibles/collection/merge']);
  assert.equal(savedCollection.get(inventoryKey('sonny-retail-a', 'Rabbit')), 2);
  assert.equal(storage.getItem(INVENTORY_STORAGE_KEY), null, 'The old browser copy is cleared once moved.');
  assert.equal(storageStatus.textContent, 'Your collection is saved in this browser. Log in to keep it on every device. The figure this browser saved before was added to it.');
  assert.equal(requests[1].get('year'), '2023', 'An empty current year falls back to the newest year with listings.');
  assert.equal(requests.every((params) => params.get('year') !== 'all'), true, 'The default view never asks for every year.');
  assert.deepEqual(chipValues(yearChips), ['2023'], 'The year shows as a removable chip.');
  assert.ok(blockBySeries('skullpanda:city-alt'));
  assert.equal(results.querySelectorAll('.collectible-year-title').length, 0, 'One requested year needs no year labels.');
  assert.match(status.textContent, /from 2023\. You own 0 of 1 figure here\.$/, 'The summary counts the owned figures in view.');
  assert.doesNotMatch(location.search, /year=/, 'An automatic year is not written to the URL.');
  openPicker(yearInput);
  assert.equal(yearOptions.hidden, false);
  assert.equal(yearInput.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(optionNodes(yearOptions).map((option) => option.dataset.value), ['2023', '2022', 'unknown']);
  assert.deepEqual(optionNodes(yearOptions).map((option) => option.getAttribute('aria-selected')), ['true', 'false', 'false']);
  yearInput.dispatchEvent({ type: 'blur' });
  assert.equal(yearOptions.hidden, true);

  // Removing the last year chip means every year.
  yearChips.children[0].dispatchEvent({ type: 'click' });
  await waitFor(() => settled() && allBlocks().length === 6, 'All years should load every matching set.');
  assert.match(status.textContent, / You own 1 of 9 figures here, 2 copies in all\.$/, 'Duplicates count as copies, not figures.');
  // Each set counts its own figures across its listings, with a bar once one is owned.
  const setCount = (seriesId) => blockBySeries(seriesId).querySelector('.collectible-release-owned');
  const setMeter = (seriesId) => blockBySeries(seriesId).querySelector('.collectible-release-meter');
  assert.equal(setCount('sonny-angel:animal-1').textContent, '1 of 2 owned, 2 copies');
  assert.equal(setMeter('sonny-angel:animal-1').hidden, false);
  assert.equal(setMeter('sonny-angel:animal-1').style.properties.get('--owned'), '0.5');
  assert.equal(setCount('skullpanda:city').textContent, '0 of 3 owned');
  assert.equal(setMeter('skullpanda:city').hidden, true, 'No bar until a figure in the set is owned.');
  assert.equal(setCount('nommi:known-empty').hidden, true, 'A set with no figures shows no count.');
  assert.match(location.search, /year=all/);
  assert.equal(requests.at(-1).get('year'), 'all');
  assert.deepEqual(chipValues(yearChips), []);
  assert.equal(yearInput.placeholder, 'All years');

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
  assert.deepEqual(cityBlock.querySelectorAll('.collectible-variants-toggle').map((toggle) => toggle.getAttribute('aria-expanded')), ['false', 'false'],
    'Figure rosters start collapsed so the catalog remains easy to scan.');
  assert.equal(blockBySeries('nommi:known-empty').querySelectorAll('.collectible-variants-toggle').length, 0, 'A listing with no figures shows no figure list.');
  assert.equal(results.querySelectorAll('.collectible-brand').length, 0, 'Cards do not repeat the brand their line heading names.');
  const figureLines = results.querySelectorAll('.collectible-line').filter((section) => section.dataset.line === 'figures');
  assert.ok(figureLines.some((section) => section.querySelectorAll('.collectible-year').some((year) => year.dataset.year === '2022'
    && year.querySelectorAll('.collectible-release-block').includes(cityBlock))), 'City of Night must sit in the 2022 batch of its figure line.');
  assert.ok(results.querySelectorAll('.collectible-year-title').length > 0, 'All years label each batch.');
  assert.equal(results.querySelectorAll('.collectible-year-link').length, 0, 'Years are a filter, not in-page jump links.');
  // Retail identifiers show on the card and the figure row; a malformed
  // barcode is not shown.
  const cityAltBlock = blockBySeries('skullpanda:city-alt');
  assert.equal(cityAltBlock.querySelector('.collectible-card-summary').querySelector('.collectible-identifiers').textContent, 'SKU PM-CITY-ALT · Barcode 6941848212345');
  assert.equal(cityAltBlock.querySelector('.collectible-inventory-name').querySelector('.collectible-identifiers').textContent, 'SKU PM-CITY-DAWN');
  // A set card without box art of its own shows its first figure's picture.
  const standIn = cityAltBlock.querySelector('.collectible-card-media').querySelector('.collectible-card-image');
  assert.equal(standIn.src, '/assets/images/collectibles/skullpanda/city-of-night/dawn.webp');
  assert.equal(standIn.alt, 'Dawn from City of Night Second Edition');
  assert.equal(blockBySeries('nommi:dream-a').querySelector('.collectible-card-media').classList.contains('is-missing'), true,
    'With no picture at all, the card keeps its empty frame.');
  assert.equal(blockBySeries('nommi:dream-a').querySelectorAll('.collectible-card').length, 2, 'Nommi listings split across API pages must render in one canonical series group.');

  openPicker(seriesInput);
  const seriesValues = optionNodes(seriesOptions).map((option) => option.dataset.value);
  assert.equal(new Set(seriesValues).size, seriesValues.length, 'Duplicate display titles must retain distinct option identities.');
  ['sonny-angel:animal-1', 'skullpanda:city', 'skullpanda:city-alt', 'nommi:dream-a', 'unclassified:nommi'].forEach((id) => assert.ok(seriesValues.includes(id), id));
  assert.equal(optionNodes(seriesOptions).filter((option) => option.textContent.startsWith('City of Night')).length, 2);
  typeInto(seriesInput, 'city');
  assert.deepEqual(optionNodes(seriesOptions).map((option) => option.dataset.value).sort(), ['skullpanda:city', 'skullpanda:city-alt'], 'Typing filters the series list.');
  typeInto(seriesInput, 'nommi');
  assert.ok(optionNodes(seriesOptions).every((option) => option.textContent.includes('Nommi')), 'Typing a brand finds its series.');
  typeInto(seriesInput, 'zzz');
  assert.equal(optionNodes(seriesOptions).length, 0);
  assert.equal(seriesOptions.querySelectorAll('.collectibles-picker-empty').length, 1);
  typeInto(seriesInput, '');

  // Several sets at once; Backspace in the empty box drops the last one.
  pick(seriesInput, seriesOptions, 'sonny-angel:animal-1');
  await waitFor(() => settled() && allBlocks().length === 1, 'One chosen set should load alone.');
  pick(seriesInput, seriesOptions, 'skullpanda:city');
  await waitFor(() => settled() && allBlocks().length === 2, 'Two chosen sets should load together.');
  assert.deepEqual(chipValues(seriesChips), ['sonny-angel:animal-1', 'skullpanda:city']);
  assert.equal(requests.at(-1).get('series'), 'sonny-angel:animal-1,skullpanda:city');
  assert.match(location.search, /release=sonny-angel%3Aanimal-1%2Cskullpanda%3Acity/);
  assert.match(status.textContent, /from 2 chosen series/);
  assert.equal(blockBySeries('sonny-angel:animal-1').querySelectorAll('.collectible-card').length, 2);
  seriesInput.dispatchEvent({ type: 'keydown', key: 'Backspace' });
  await waitFor(() => settled() && allBlocks().length === 1 && blockBySeries('sonny-angel:animal-1'), 'Backspace should drop the last set.');
  seriesChips.children[0].dispatchEvent({ type: 'click' });
  await waitFor(() => settled() && allBlocks().length === 6, 'Removing every set should show them all again.');

  // Several years at once, by click or by typing and Enter.
  pick(yearInput, yearOptions, '2022');
  await waitFor(() => settled() && allBlocks().length === 1 && blockBySeries('skullpanda:city'), 'Choosing a year should show only that year.');
  assert.equal(results.querySelectorAll('.collectible-year-title').length, 0);
  pick(yearInput, yearOptions, '2023');
  await waitFor(() => settled() && allBlocks().length === 2, 'Two years should show both batches.');
  assert.deepEqual(chipValues(yearChips), ['2022', '2023']);
  assert.match(location.search, /year=2022%2C2023/);
  assert.match(status.textContent, /from 2022 and 2023/);
  assert.ok(results.querySelectorAll('.collectible-year-title').length > 0, 'Several years label each batch.');
  typeInto(yearInput, '2022');
  const enter = { type: 'keydown', key: 'Enter' };
  yearInput.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true, 'Enter in a picker never submits the search form.');
  await waitFor(() => settled() && allBlocks().length === 1 && blockBySeries('skullpanda:city-alt'), 'Typing a chosen year and Enter removes it.');
  yearChips.children[0].dispatchEvent({ type: 'click' });
  await waitFor(() => settled() && allBlocks().length === 6, 'Returning to all years should reload every set.');
  assert.equal(allBlocks().filter((block) => !block.hidden).length, 6);
  assert.match(blockBySeries('skullpanda:city').querySelector('.collectible-release-status').textContent, /Roster incomplete/);
  assert.match(blockBySeries('unclassified:nommi').querySelector('.collectible-release-status').textContent, /Series membership is unknown/);
  assert.match(blockBySeries('nommi:known-empty').querySelector('.collectible-release-status').textContent, /Known complete roster: no figures/);

  exportToggle.dispatchEvent({ type: 'click' });
  assert.equal(exportMenu.hidden, false, 'Export opens its menu.');
  assert.equal(exportToggle.getAttribute('aria-expanded'), 'true');
  exportButton.dispatchEvent({ type: 'click' });
  assert.equal(printCalls, 1, 'PDF export should prepare and print the grouped catalog.');
  assert.equal(exportMenu.hidden, true, 'Choosing an export closes the menu.');
  assert.equal(document.activeElement, exportToggle, 'Focus returns to the Export button.');
  assert.equal(results.querySelectorAll('.collectible-variants-toggle').every((toggle) => toggle.getAttribute('aria-expanded') === 'true'), true);
  (windowListeners.get('afterprint') || []).forEach((listener) => listener());
  assert.equal(exportButton.disabled, false);

  const disclosure = sonnyBlock.querySelector('.collectible-variants-toggle');
  const disclosurePanel = document.getElementById(disclosure.getAttribute('aria-controls'));
  assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
  disclosure.dispatchEvent({ type: 'click' });
  assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal(disclosurePanel.hidden, false, 'Grouped disclosure controls must continue to open their own figure roster.');

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
  await waitFor(() => savedCollection.get(inventoryKey('sonny-retail-b', 'Elephant')) === 3, 'A quantity edit should be saved.');
  assert.equal(savedCollection.has(inventoryKey('sonny-retail-a', 'Rabbit')), false, 'A quantity of zero removes the saved figure.');
  assert.equal(status.textContent, 'Showing 1 owned figure across 1 series. You own 1 of 9 figures here, 3 copies in all.',
    'Ownership counts the whole search, not just the Owned view, and follows quantity edits.');
  assert.equal(setCount('sonny-angel:animal-1').textContent, '1 of 2 owned, 3 copies', 'A set\'s count follows quantity edits.');

  // A save that fails is undone and reported.
  failSaves = true;
  const elephantOwned = elephantRow.querySelectorAll('input').find((input) => input.type === 'checkbox');
  elephantOwned.checked = false;
  elephantOwned.dispatchEvent({ type: 'change' });
  assert.equal(elephantRow.dataset.quantity, '0', 'The change shows at once.');
  await waitFor(() => elephantRow.dataset.quantity === '3', 'A failed save should be undone.');
  assert.equal(elephantOwned.checked, true);
  assert.equal(status.textContent, "Your change to Elephant wasn't saved, so it was undone. Check your connection and try again.");
  assert.equal(savedCollection.get(inventoryKey('sonny-retail-b', 'Elephant')), 3);
  failSaves = false;

  // Spreadsheet exports: what the shelf shows (here, owned figures only), and
  // every owned figure across the whole catalog.
  const downloads = [];
  const { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = (blob) => `blob:test/${downloads.push({ blob })}`;
  URL.revokeObjectURL = () => {};
  const bodyAppend = document.body.append.bind(document.body);
  document.body.append = (...nodes) => {
    nodes.forEach((node) => { if (node.tagName === 'A') downloads.at(-1).filename = node.download; });
    bodyAppend(...nodes);
  };
  const today = new Date();
  const datePart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const csvLines = async (download) => (await download.blob.text()).replace(/^\ufeff/, '').replace(/\r\n$/, '').split('\r\n');

  exportToggle.dispatchEvent({ type: 'click' });
  assert.equal(exportCsvDetail.textContent, '1 figure from 1 series, with owned and quantity columns.');
  assert.equal(exportCollectionButton.disabled, false);
  exportCsvButton.dispatchEvent({ type: 'click' });
  await waitFor(() => downloads.length === 1 && exportToggle.textContent === 'Export', 'The shown figures should download.');
  assert.equal(downloads[0].filename, `collectibles-all-lines-${datePart}.csv`);
  assert.deepEqual(await csvLines(downloads[0]), [
    EXPORT_COLUMNS.join(','),
    'Sonny Angel,Figure series,,Animal Series,Animal Series Elephant Retail,,Elephant,No,Yes,3,,,,,,',
  ], 'The Owned view exports only the owned figure.');
  assert.match(status.textContent, /^Downloaded collectibles-all-lines-.+\.csv with 1 figure\.$/);

  exportToggle.dispatchEvent({ type: 'click' });
  exportCollectionButton.dispatchEvent({ type: 'click' });
  assert.equal(exportToggle.getAttribute('aria-busy'), 'true', 'The Export button shows it is working.');
  await waitFor(() => downloads.length === 2 && exportToggle.textContent === 'Export', 'The collection should download.');
  const collectionRequest = requests.at(-1);
  assert.equal(collectionRequest.get('year'), 'all', 'The collection reads every year.');
  assert.equal(collectionRequest.get('limit'), '100');
  assert.equal(downloads[1].filename, `my-collectibles-${datePart}.csv`);
  assert.deepEqual((await csvLines(downloads[1])).slice(1), [
    'Sonny Angel,Figure series,,Animal Series,Animal Series Elephant Retail,,Elephant,No,Yes,3,,,,,,',
  ]);
  assert.equal(status.textContent, `Downloaded my-collectibles-${datePart}.csv with 1 owned figure.`);
  assert.equal(exportToggle.getAttribute('aria-busy'), null);
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;

  inventoryInputs.forEach((input) => { input.checked = input.value === 'all'; });
  inventoryInputs.find((input) => input.value === 'all').dispatchEvent({ type: 'change' });
  pick(seriesInput, seriesOptions, 'skullpanda:city');
  await waitFor(() => settled() && allBlocks().length === 1, 'Choosing a set should load just that set.');
  brandInputs.forEach((input) => { input.checked = input.value === 'nommi'; });
  brandInputs.find((input) => input.value === 'nommi').dispatchEvent({ type: 'change' });
  await waitFor(
    () => results.getAttribute('aria-busy') === 'false' && allBlocks().length === 3,
    'Changing brands should reload the matching catalog groups.',
  );
  assert.deepEqual(chipValues(seriesChips), [], 'A series from another brand must not remain invisibly selected.');
  openPicker(seriesInput);
  assert.ok(optionNodes(seriesOptions).length > 0 && optionNodes(seriesOptions).every((option) => option.textContent.includes('Nommi')));
  seriesInput.dispatchEvent({ type: 'blur' });

  searchInput.value = 'no-match';
  form.dispatchEvent({ type: 'submit' });
  await waitFor(
    () => results.getAttribute('aria-busy') === 'false' && results.children.length === 0,
    'An empty catalog response should clear the grouped tree.',
  );
  assert.match(status.textContent, /No collectibles match/);
}

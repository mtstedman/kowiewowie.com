import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

class ClassList {
    constructor(element) {
        this.element = element;
        this.names = new Set();
    }

    contains(name) {
        return this.names.has(name);
    }

    set(value) {
        this.names = new Set(String(value || '').split(/\s+/).filter(Boolean));
        this.sync();
    }

    sync() {
        this.element._className = Array.from(this.names).join(' ');
    }
}

class TestElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.parentElement = null;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.classList = new ClassList(this);
        this._className = '';
        this._id = '';
        this._textContent = '';
        this.value = '';
        this.type = '';
        this.name = '';
        this.placeholder = '';
        this.autocomplete = '';
        this.href = '';
        this.loading = '';
        this.alt = '';
        this.src = '';
    }

    set id(value) {
        this._id = String(value || '');
        if (this._id !== '') {
            this.attributes.set('id', this._id);
            this.ownerDocument?.registerElement(this);
        }
    }

    get id() {
        return this._id;
    }

    set className(value) {
        this.classList.set(value);
        this.attributes.set('class', this._className);
    }

    get className() {
        return this._className;
    }

    set textContent(value) {
        this._textContent = String(value ?? '');
        this.children = [];
    }

    get textContent() {
        return this._textContent;
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes.set(name, stringValue);
        if (name === 'id') {
            this.id = stringValue;
        } else if (name === 'class') {
            this.className = stringValue;
        } else if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this.dataset[key] = stringValue;
        } else {
            this[name] = stringValue;
        }
    }

    getAttribute(name) {
        return this.attributes.get(name) || null;
    }

    append(...nodes) {
        nodes.forEach((node) => {
            if (!(node instanceof TestElement)) {
                return;
            }
            node.parentElement = this;
            this.children.push(node);
            if (node.id !== '') {
                this.ownerDocument?.registerElement(node);
            }
        });
    }

    appendChild(node) {
        this.append(node);
        return node;
    }

    replaceChildren(...nodes) {
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        this._textContent = '';
        this.append(...nodes);
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        event.defaultPrevented ||= false;
        event.preventDefault ||= () => {
            event.defaultPrevented = true;
        };

        (this.listeners.get(event.type) || []).forEach((listener) => listener.call(this, event));
        return !event.defaultPrevented;
    }

    matches(selector) {
        if (selector === '*') {
            return true;
        }
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }
        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }

        const tagAttributeMatch = selector.match(/^([a-z]+)?\[([a-z-]+)(?:="([^"]*)")?\]$/i);
        if (tagAttributeMatch) {
            const [, tagName, attribute, expectedValue] = tagAttributeMatch;
            if (tagName && this.tagName.toLowerCase() !== tagName.toLowerCase()) {
                return false;
            }
            const actualValue = this.getAttribute(attribute);
            return expectedValue === undefined ? actualValue !== null : actualValue === expectedValue;
        }

        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = (node) => {
            node.children.forEach((child) => {
                if (child.matches(selector)) {
                    matches.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        return matches;
    }
}

class TestAnchorElement extends TestElement {}
class TestButtonElement extends TestElement {}
class TestInputElement extends TestElement {}

class TestDocument extends TestElement {
    constructor(url) {
        super('#document', null);
        this.ownerDocument = this;
        this.ids = new Map();
        this.body = new TestElement('body', this);
        this.location = new URL(url);
        this.append(this.body);
    }

    createElement(tagName) {
        if (tagName === 'a') {
            return new TestAnchorElement(tagName, this);
        }
        if (tagName === 'button') {
            return new TestButtonElement(tagName, this);
        }
        if (tagName === 'input') {
            return new TestInputElement(tagName, this);
        }
        return new TestElement(tagName, this);
    }

    registerElement(element) {
        this.ids.set(element.id, element);
    }

    getElementById(id) {
        return this.ids.get(id) || null;
    }

    querySelector(selector) {
        if (selector.startsWith('#')) {
            return this.getElementById(selector.slice(1));
        }
        return this.body.matches(selector) ? this.body : this.body.querySelector(selector);
    }
}

const appendElement = (parent, tagName, { id = '', className = '', dataset = {}, attributes = {}, value = '', type = '', text = '' } = {}) => {
    const element = parent.ownerDocument.createElement(tagName);
    if (id !== '') {
        element.id = id;
    }
    if (className !== '') {
        element.className = className;
    }
    Object.entries(dataset).forEach(([key, dataValue]) => {
        element.dataset[key] = dataValue;
        element.setAttribute(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, dataValue);
    });
    Object.entries(attributes).forEach(([name, attributeValue]) => element.setAttribute(name, attributeValue));
    element.value = value;
    element.type = type;
    element.textContent = text;
    parent.append(element);
    return element;
};

const installBrowserGlobals = ({ url, fetchHandler }) => {
    const document = new TestDocument(url);
    const location = new URL(url);
    const window = { document, location };
    const calls = [];
    const pendingBrowserWork = new Set();
    const trackBrowserWork = (promise) => {
        const tracked = Promise.resolve(promise);
        pendingBrowserWork.add(tracked);
        tracked.then(
            () => pendingBrowserWork.delete(tracked),
            () => pendingBrowserWork.delete(tracked)
        );
        return tracked;
    };
    const flushBrowserWork = async () => {
        for (let idlePasses = 0; idlePasses < 2;) {
            if (pendingBrowserWork.size > 0) {
                await Promise.allSettled(Array.from(pendingBrowserWork));
                idlePasses = 0;
                continue;
            }

            await Promise.resolve();
            idlePasses = pendingBrowserWork.size === 0 ? idlePasses + 1 : 0;
        }
    };
    const fetch = (resource, options = {}) => {
        calls.push({ resource: String(resource), options });
        return trackBrowserWork(Promise.resolve(fetchHandler(String(resource), options)).then((payload) => ({
            ok: payload.ok ?? true,
            status: payload.status ?? 200,
            json: () => trackBrowserWork(Promise.resolve().then(() => payload.body ?? { data: null })),
        })));
    };

    Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: TestElement, configurable: true });
    Object.defineProperty(globalThis, 'HTMLAnchorElement', { value: TestAnchorElement, configurable: true });
    Object.defineProperty(globalThis, 'HTMLButtonElement', { value: TestButtonElement, configurable: true });
    Object.defineProperty(globalThis, 'HTMLInputElement', { value: TestInputElement, configurable: true });
    Object.defineProperty(globalThis, 'fetch', { value: fetch, configurable: true });

    return { document, calls, flushBrowserWork };
};

const importFresh = async (modulePath) => {
    const resolvedPath = require.resolve(modulePath);
    delete require.cache[resolvedPath];
    return require(resolvedPath);
};

const inputEvent = (target) => ({ type: 'input', target, defaultPrevented: false });
const clickEvent = (target) => ({ type: 'click', target, defaultPrevented: false });

const buildVideosDom = (document) => {
    const main = appendElement(document.body, 'main');
    const surface = appendElement(main, 'section', { className: 'videos-surface', attributes: { 'aria-labelledby': 'videos-title' } });
    appendElement(surface, 'h2', { id: 'videos-title', text: 'Latest videos' });
    appendElement(surface, 'input', {
        id: 'videos-search',
        type: 'search',
        attributes: {
            'aria-controls': 'videos-results',
            'aria-describedby': 'videos-results-status',
        },
    });
    const filters = appendElement(surface, 'div', { id: 'videos-filters', className: 'videos-chips', attributes: { 'aria-label': 'Video filters' } });
    appendElement(filters, 'button', {
        className: 'videos-chip is-active',
        dataset: { topic: 'All' },
        attributes: {
            'aria-pressed': 'true',
            'aria-controls': 'videos-results',
            'aria-describedby': 'videos-results-status',
        },
        type: 'button',
        text: 'All',
    });
    appendElement(surface, 'p', {
        id: 'videos-results-status',
        className: 'videos-visually-hidden',
        attributes: {
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
        },
        text: 'Tuning the video shelf...',
    });
    const results = appendElement(surface, 'div', {
        id: 'videos-results',
        attributes: {
            role: 'region',
            'aria-labelledby': 'videos-title',
            'aria-describedby': 'videos-results-status',
        },
    });
    appendElement(results, 'p', { className: 'videos-state', text: 'Tuning the video shelf...' });
};

const collectElements = (root) => {
    const elements = [root];
    root.children.forEach((child) => elements.push(...collectElements(child)));
    return elements;
};

const visibleText = (root) => collectElements(root).map((element) => element.textContent).filter(Boolean).join(' ');

const assertResultsAreNotLive = (document) => {
    const results = document.getElementById('videos-results');
    const liveDescendants = collectElements(results).filter((element) => (
        element.getAttribute('aria-live') !== null
        || element.getAttribute('aria-atomic') !== null
        || element.getAttribute('role') === 'status'
    ));

    assert.equal(results.getAttribute('aria-live'), null, 'results region is not an aria-live container');
    assert.equal(results.getAttribute('aria-atomic'), null, 'results region is not atomic');
    assert.deepEqual(liveDescendants, [], 'results cards and summary do not contain live-region attributes');
};

const videos = [
    {
        slug: 'alpha-launch',
        title: 'Alpha Launch',
        channel_title: 'Mission Control',
        description: 'A test launch overview.',
        tags: ['Space', 'Music'],
        duration_seconds: 90,
        view_count: 1200,
        published_at: '2026-08-01T00:00:00Z',
    },
    {
        slug: 'beta-session',
        title: 'Beta Session',
        channel_title: 'Studio',
        description: 'Live music recording.',
        tags: ['Music'],
        duration_seconds: 180,
        view_count: 50,
        published_at: '2026-07-01T00:00:00Z',
    },
    {
        slug: 'gamma-guide',
        title: 'Gamma Guide',
        channel_title: 'Docs Team',
        description: 'Explainer walkthrough.',
        tags: ['Education'],
        duration_seconds: 240,
        view_count: 5,
        published_at: '2026-06-01T00:00:00Z',
    },
    {
        slug: 'private-draft',
        title: 'Private Draft',
        tags: ['Music'],
        status: 'private',
    },
];

{
    let resolveVideos;
    const videosResponse = new Promise((resolve) => {
        resolveVideos = resolve;
    });
    const { document, calls, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/videos/',
        fetchHandler: async (resource) => {
            assert.equal(resource, '/api/v1/videos');
            return videosResponse;
        },
    });
    buildVideosDom(document);

    await importFresh('../htdocs/assets/js/videos-index.js');

    const status = document.getElementById('videos-results-status');
    const results = document.getElementById('videos-results');
    const search = document.getElementById('videos-search');
    const filters = document.getElementById('videos-filters');

    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.getAttribute('aria-atomic'), 'true');
    assert.equal(status.className, 'videos-visually-hidden');
    assert.equal(status.textContent, 'Tuning the video shelf...', 'loading status is announced before fetch success');
    assert.equal(search.getAttribute('aria-controls'), 'videos-results');
    assert.equal(search.getAttribute('aria-describedby'), 'videos-results-status');
    assertResultsAreNotLive(document);

    resolveVideos({ body: { data: videos } });
    await flushBrowserWork();
    assert.equal(results.querySelectorAll('.videos-grid-item').length, 3, 'fetch success renders published video cards');
    assert.equal(calls.length, 1, 'videos are fetched once during boot');
    assert.equal(status.textContent, '3 videos available. Latest published uploads from the watch drawer.');
    assert.match(visibleText(results), /3 videos available/);
    assert.match(visibleText(results), /Latest published uploads from the watch drawer\./);
    assertResultsAreNotLive(document);

    const musicChip = filters.querySelectorAll('button').find((button) => button.dataset.topic === 'Music');
    assert.ok(musicChip, 'dynamic topic chips are rendered');
    assert.equal(musicChip.getAttribute('aria-controls'), 'videos-results');
    assert.equal(musicChip.getAttribute('aria-describedby'), 'videos-results-status');

    search.value = 'alpha';
    search.dispatchEvent(inputEvent(search));
    assert.equal(results.querySelectorAll('.videos-grid-item').length, 1, 'search rerenders synchronously');
    assert.equal(status.textContent, '1 video found. Searching titles, channels, descriptions, and tags for "alpha".');
    assert.match(visibleText(results), /1 video found/);
    assertResultsAreNotLive(document);

    search.value = '';
    search.dispatchEvent(inputEvent(search));
    filters.dispatchEvent(clickEvent(musicChip));
    assert.equal(results.querySelectorAll('.videos-grid-item').length, 2, 'filter rerenders synchronously');
    assert.equal(status.textContent, '2 videos in Music. Every published video wearing the Music tag.');
    assert.match(visibleText(results), /2 videos in Music/);
    assertResultsAreNotLive(document);

    search.value = 'nomatch';
    search.dispatchEvent(inputEvent(search));
    assert.equal(results.querySelectorAll('.videos-grid-item').length, 0, 'empty search result removes the card grid');
    assert.ok(results.querySelector('.videos-empty-state'), 'empty search result keeps a visible empty state');
    assert.equal(status.textContent, '0 videos found. Filtered to "nomatch" inside Music.');
    assertResultsAreNotLive(document);
}

{
    const { document, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/videos/',
        fetchHandler: async () => ({ body: { data: [] } }),
    });
    buildVideosDom(document);

    await importFresh('../htdocs/assets/js/videos-index.js');
    const status = document.getElementById('videos-results-status');
    const results = document.getElementById('videos-results');

    await flushBrowserWork();
    assert.ok(status.textContent.startsWith('No videos yet.'), 'empty library status is announced after fetch success');
    assert.ok(results.querySelector('.videos-empty-state'), 'empty library keeps a visible empty state');
    assert.equal(status.textContent, 'No videos yet. Fresh uploads will land here when the watch drawer gets stocked.');
    assertResultsAreNotLive(document);
}

{
    const { document, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/videos/',
        fetchHandler: async () => ({ ok: false, status: 503, body: { data: [] } }),
    });
    buildVideosDom(document);

    await importFresh('../htdocs/assets/js/videos-index.js');
    const status = document.getElementById('videos-results-status');
    const results = document.getElementById('videos-results');

    await flushBrowserWork();
    assert.ok(status.textContent.startsWith('Videos unavailable.'), 'error status is announced after fetch failure');
    assert.ok(results.querySelector('.videos-error-state'), 'fetch errors keep a visible error state');
    assert.equal(status.textContent, 'Videos unavailable. The watch drawer would not open. Try again in a moment.');
    assertResultsAreNotLive(document);
}

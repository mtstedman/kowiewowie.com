import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const northeastArrow = String.fromCodePoint(0x2197);

class TestTextNode {
    constructor(text) {
        this.nodeType = 3;
        this.parentElement = null;
        this.textContent = String(text ?? '');
    }
}

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
        this.nodeType = 1;
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.parentElement = null;
        this.childNodes = [];
        this.dataset = {};
        this.attributes = new Map();
        this.classList = new ClassList(this);
        this._className = '';
        this._id = '';
        this._href = '';
        this._rel = '';
        this._target = '';
    }

    get children() {
        return this.childNodes.filter((node) => node instanceof TestElement);
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

    set href(value) {
        this._href = String(value || '');
        if (this._href !== '') {
            this.attributes.set('href', this._href);
        }
    }

    get href() {
        return this._href;
    }

    set rel(value) {
        this._rel = String(value || '');
        if (this._rel !== '') {
            this.attributes.set('rel', this._rel);
        }
    }

    get rel() {
        return this._rel;
    }

    set target(value) {
        this._target = String(value || '');
        if (this._target !== '') {
            this.attributes.set('target', this._target);
        }
    }

    get target() {
        return this._target;
    }

    set textContent(value) {
        this.replaceChildren(String(value ?? ''));
    }

    get textContent() {
        return this.childNodes.map((node) => node.textContent).join('');
    }

    set innerHTML(value) {
        const decoded = String(value ?? '').replaceAll('&nearr;', northeastArrow);
        this.textContent = decoded;
    }

    get innerHTML() {
        return this.textContent;
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes.set(name, stringValue);
        if (name === 'id') {
            this.id = stringValue;
        } else if (name === 'class') {
            this.className = stringValue;
        } else if (name === 'href') {
            this.href = stringValue;
        } else if (name === 'rel') {
            this.rel = stringValue;
        } else if (name === 'target') {
            this.target = stringValue;
        } else if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this.dataset[key] = stringValue;
        }
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    append(...nodes) {
        nodes.forEach((node) => {
            const child = node instanceof TestElement || node instanceof TestTextNode
                ? node
                : new TestTextNode(node);
            child.parentElement = this;
            this.childNodes.push(child);
            if (child instanceof TestElement && child.id !== '') {
                this.ownerDocument?.registerElement(child);
            }
        });
    }

    appendChild(node) {
        this.append(node);
        return node;
    }

    replaceChildren(...nodes) {
        this.childNodes.forEach((child) => {
            child.parentElement = null;
        });
        this.childNodes = [];
        this.append(...nodes);
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

const appendElement = (parent, tagName, { id = '', className = '', attributes = {}, text = '' } = {}) => {
    const element = parent.ownerDocument.createElement(tagName);
    if (id !== '') {
        element.id = id;
    }
    if (className !== '') {
        element.className = className;
    }
    Object.entries(attributes).forEach(([name, attributeValue]) => element.setAttribute(name, attributeValue));
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
            json: () => trackBrowserWork(Promise.resolve().then(() => payload.body ?? [])),
        })));
    };

    Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: TestElement, configurable: true });
    Object.defineProperty(globalThis, 'HTMLAnchorElement', { value: TestAnchorElement, configurable: true });
    Object.defineProperty(globalThis, 'fetch', { value: fetch, configurable: true });

    return { document, calls, flushBrowserWork };
};

const importFresh = async (modulePath) => {
    const resolvedPath = require.resolve(modulePath);
    delete require.cache[resolvedPath];
    return require(resolvedPath);
};

const buildMusicDom = (document) => {
    const main = appendElement(document.body, 'main');
    const section = appendElement(main, 'section', { className: 'foundation', attributes: { 'aria-labelledby': 'music-title' } });
    appendElement(section, 'h2', { id: 'music-title', text: 'Songs list' });
    const musicList = appendElement(section, 'div', { id: 'music-list', attributes: { 'aria-live': 'polite' } });
    appendElement(musicList, 'p', { text: 'Loading songs...' });
};

const normalize = (value) => String(value).replace(/\s+/g, ' ').trim();

const accessibleText = (node) => {
    if (node instanceof TestTextNode) {
        return node.textContent;
    }
    if (node.getAttribute('aria-hidden') === 'true') {
        return '';
    }
    return normalize(node.childNodes.map(accessibleText).join(' '));
};

const computedAccessibleName = (element) => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel !== null && normalize(ariaLabel) !== '') {
        return normalize(ariaLabel);
    }
    return normalize(accessibleText(element));
};

const ownText = (element) => normalize(element.childNodes
    .filter((node) => node instanceof TestTextNode)
    .map((node) => node.textContent)
    .join(''));

const assertSpotifyLink = (link, href) => {
    assert.ok(link instanceof TestAnchorElement, 'Spotify link is an anchor');
    assert.equal(link.className, 'text-link');
    assert.equal(link.getAttribute('href'), href);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(ownText(link), 'Listen on Spotify', 'visible text node remains the Spotify label');

    const arrow = link.querySelector('span[aria-hidden="true"]');
    assert.ok(arrow, 'decorative arrow is rendered');
    assert.equal(arrow.textContent, northeastArrow);
    assert.equal(arrow.getAttribute('aria-hidden'), 'true');
    assert.equal(link.textContent, `Listen on Spotify ${northeastArrow}`, 'plain textContent still includes rendered decorative arrow');
    assert.equal(accessibleText(link), 'Listen on Spotify', 'aria-hidden descendants are excluded from accessible text fallback');
    assert.equal(computedAccessibleName(link), 'Listen on Spotify, opens in a new tab');
    assert.ok(computedAccessibleName(link).includes('Listen on Spotify'));
    assert.ok(computedAccessibleName(link).includes('opens in a new tab'));
    assert.ok(!computedAccessibleName(link).includes(northeastArrow), 'decorative arrow is absent from the accessible name');
};

{
    const songs = [
        { title: 'Alpha', artist: 'The A', spotify_url: 'https://open.spotify.com/track/alpha' },
        { title: 'Empty URL', artist: 'The Empty', spotify_url: '' },
        { title: 'Missing URL', artist: 'The Missing' },
        { title: 'Numeric URL', artist: 'The Numeric', spotify_url: 42 },
        { title: 'Beta', artist: 'The B', spotify_url: 'https://open.spotify.com/track/beta' },
    ];
    const { document, calls, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/music/',
        fetchHandler: async (resource) => {
            assert.equal(resource, '/api/music');
            return { body: songs };
        },
    });
    buildMusicDom(document);

    await importFresh('../htdocs/assets/js/music-index.js');
    await flushBrowserWork();

    const musicList = document.getElementById('music-list');
    const links = musicList.querySelectorAll('a');

    assert.equal(calls.length, 1, 'songs are fetched once during boot');
    assert.equal(musicList.querySelectorAll('article').length, 5, 'all returned songs render cards');
    assert.equal(links.length, 2, 'only non-empty string Spotify URLs render links');
    assertSpotifyLink(links[0], 'https://open.spotify.com/track/alpha');
    assertSpotifyLink(links[1], 'https://open.spotify.com/track/beta');
}

{
    const { document, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/music/',
        fetchHandler: async () => ({ body: [] }),
    });
    buildMusicDom(document);

    await importFresh('../htdocs/assets/js/music-index.js');
    await flushBrowserWork();

    const musicList = document.getElementById('music-list');
    assert.equal(musicList.querySelectorAll('a').length, 0, 'empty API results render no Spotify links');
    assert.equal(musicList.textContent, 'The tiny queue is empty for now.');
}

{
    const { document, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/music/',
        fetchHandler: async () => ({ ok: false, status: 503, body: [] }),
    });
    buildMusicDom(document);

    await importFresh('../htdocs/assets/js/music-index.js');
    await flushBrowserWork();

    const musicList = document.getElementById('music-list');
    assert.equal(musicList.querySelectorAll('a').length, 0, 'HTTP failures render no Spotify links');
    assert.equal(musicList.textContent, 'The tiny queue would not load. Try again in a moment.');
}

{
    const { document, flushBrowserWork } = installBrowserGlobals({
        url: 'https://wowiekowie.com/music/',
        fetchHandler: async () => {
            throw new Error('Network unavailable');
        },
    });
    buildMusicDom(document);

    await importFresh('../htdocs/assets/js/music-index.js');
    await flushBrowserWork();

    const musicList = document.getElementById('music-list');
    assert.equal(musicList.querySelectorAll('a').length, 0, 'fetch failures render no Spotify links');
    assert.equal(musicList.textContent, 'The tiny queue would not load. Try again in a moment.');
}

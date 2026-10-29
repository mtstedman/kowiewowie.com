import assert from 'node:assert/strict';

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
        this.attributes = new Map();
        this.listeners = new Map();
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
        this.attributes.set('href', this._href);
    }

    get href() {
        return this._href;
    }

    set rel(value) {
        this._rel = String(value || '');
        this.attributes.set('rel', this._rel);
    }

    get rel() {
        return this._rel;
    }

    set target(value) {
        this._target = String(value || '');
        this.attributes.set('target', this._target);
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
        throw new Error(`innerHTML must not be used by the books renderer: ${value}`);
    }

    setAttribute(name, value) {
        const stringValue = String(value);
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
        } else {
            this.attributes.set(name, stringValue);
        }
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatch(type) {
        (this.listeners.get(type) || []).forEach((listener) => listener({ type, target: this }));
    }

    append(...nodes) {
        nodes.forEach((node) => {
            const child = node instanceof TestElement || node instanceof TestTextNode
                ? node
                : new TestTextNode(node);
            child.parentElement = this;
            this.childNodes.push(child);
        });
    }

    replaceChildren(...nodes) {
        this.childNodes.forEach((child) => {
            child.parentElement = null;
        });
        this.childNodes = [];
        this.append(...nodes);
    }

    matches(selector) {
        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }
        const tagAttributeMatch = selector.match(/^([a-z0-9]+)?\[([a-z-]+)(?:="([^"]*)")?\]$/i);
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

class TestDocument extends TestElement {
    constructor() {
        super('#document', null);
        this.ownerDocument = this;
        this.ids = new Map();
        this.body = new TestElement('body', this);
        this.append(this.body);
    }

    createElement(tagName) {
        return new TestElement(tagName, this);
    }

    registerElement(element) {
        this.ids.set(element.id, element);
    }

    getElementById(id) {
        return this.ids.get(id) || null;
    }
}

const installBrowserGlobals = (fetchHandler) => {
    const document = new TestDocument();
    const calls = [];
    const pending = new Set();
    const track = (promise) => {
        const tracked = Promise.resolve(promise);
        pending.add(tracked);
        tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
        return tracked;
    };
    const flushBrowserWork = async () => {
        for (let idlePasses = 0; idlePasses < 3;) {
            if (pending.size > 0) {
                await Promise.allSettled(Array.from(pending));
                idlePasses = 0;
                continue;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
            idlePasses = pending.size === 0 ? idlePasses + 1 : 0;
        }
    };
    const fetch = (resource, options = {}) => {
        calls.push({ resource: String(resource), options });
        return track(Promise.resolve(fetchHandler(String(resource), options)).then((payload) => ({
            ok: payload.ok ?? true,
            status: payload.status ?? 200,
            json: () => track(Promise.resolve().then(() => {
                if (payload.invalidJson) {
                    throw new SyntaxError('Unexpected token < in JSON');
                }
                return payload.body;
            })),
        })));
    };

    Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: TestElement, configurable: true });
    Object.defineProperty(globalThis, 'fetch', { value: fetch, configurable: true });

    const main = document.createElement('main');
    const list = document.createElement('div');
    const loading = document.createElement('p');
    list.id = 'books-list';
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-busy', 'true');
    loading.textContent = 'Dusting off the shelf...';
    list.append(loading);
    main.append(list);
    document.body.append(main);

    return { document, calls, flushBrowserWork };
};

let freshImportSequence = 0;
const renderBooksPage = async (fetchHandler) => {
    const browser = installBrowserGlobals(fetchHandler);
    const moduleUrl = new URL('../htdocs/assets/js/books-index.js', import.meta.url);
    moduleUrl.searchParams.set('test-run', String(freshImportSequence++));
    await import(moduleUrl.href);
    await browser.flushBrowserWork();
    return { ...browser, list: browser.document.getElementById('books-list') };
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
const accessibleName = (element) => normalize(element.getAttribute('aria-label') ?? accessibleText(element));

const baseBook = {
    id: '6f1d2c3e-1111-4222-8333-444455556666',
    slug: 'the-left-hand',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    amazon_url: 'https://www.amazon.com/dp/0441478123',
    cover_image_url: 'https://images.example.com/covers/left-hand.jpg',
    price_amount: '12.50',
    price_currency: 'USD',
    overview: 'A lone human emissary arrives on Winter.\n\nHe must cross the ice to survive.',
    status: 'published',
    created_at: '2026-10-01 12:00:00+00',
    updated_at: '2026-10-01 12:00:00+00',
    published_at: '2026-10-01 12:00:00+00',
};

// Populated list: title, author, cover, price, full overview and accessible Amazon link.
{
    const books = [
        baseBook,
        {
            ...baseBook,
            slug: 'free-zine',
            title: 'Free Zine',
            author: null,
            amazon_url: 'https://amzn.to/3xYzAbc',
            price_amount: '0.00',
            price_currency: 'GBP',
            overview: 'Line one\nline two',
        },
    ];
    const { calls, list } = await renderBooksPage(async (resource) => {
        assert.equal(resource, '/api/books');
        return { body: books };
    });

    assert.equal(calls.length, 1, 'books are fetched once during boot');
    assert.equal(list.getAttribute('aria-busy'), 'false', 'loaded list is no longer busy');
    const cards = list.querySelectorAll('article');
    assert.equal(cards.length, 2, 'every published book renders a card');

    const [first, second] = cards;
    const heading = first.querySelector('h3');
    assert.equal(heading.textContent, 'The Left Hand of Darkness');
    assert.equal(first.getAttribute('aria-labelledby'), heading.id, 'card is labelled by its title');
    assert.equal(first.querySelector('.book-author').textContent, 'by Ursula K. Le Guin');
    assert.equal(first.querySelector('.book-price').textContent, 'Price: $12.50');

    const cover = first.querySelector('img');
    assert.equal(cover.getAttribute('src'), 'https://images.example.com/covers/left-hand.jpg');
    assert.equal(cover.getAttribute('alt'), 'Cover of The Left Hand of Darkness');
    assert.equal(cover.getAttribute('width'), '400');
    assert.equal(cover.getAttribute('height'), '600');

    const overviewParagraphs = first.querySelector('.book-overview').querySelectorAll('p');
    assert.deepEqual(
        overviewParagraphs.map((paragraph) => paragraph.textContent),
        ['A lone human emissary arrives on Winter.', 'He must cross the ice to survive.'],
        'complete overview renders as plain-text paragraphs'
    );

    const link = first.querySelector('a');
    assert.equal(link.getAttribute('href'), 'https://www.amazon.com/dp/0441478123');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(accessibleName(link), 'View The Left Hand of Darkness on Amazon, opens in a new tab');
    assert.equal(link.querySelector('span[aria-hidden="true"]').textContent, northeastArrow);

    assert.equal(second.querySelector('.book-author'), null, 'missing author renders no author line');
    assert.equal(second.querySelector('.book-price').textContent, 'Price: £0.00', 'zero price is displayed');
    assert.equal(second.querySelector('.book-overview').querySelector('p').textContent, 'Line one\nline two');
    assert.equal(second.querySelector('a').getAttribute('href'), 'https://amzn.to/3xYzAbc');
}

// Empty list.
{
    const { list } = await renderBooksPage(async () => ({ body: [] }));
    assert.equal(list.querySelectorAll('article').length, 0);
    assert.equal(list.textContent, 'The shelf is empty for now. Check back soon for a new recommendation.');
    assert.equal(list.getAttribute('aria-busy'), 'false');
}

// HTTP failure and network failure.
for (const handler of [
    async () => ({ ok: false, status: 503, body: [] }),
    async () => {
        throw new Error('Network unavailable');
    },
]) {
    const { list } = await renderBooksPage(handler);
    assert.equal(list.querySelectorAll('article').length, 0);
    assert.equal(list.textContent, 'The shelf would not load. Try again in a moment.');
    assert.equal(list.getAttribute('aria-busy'), 'false');
}

// Malformed responses.
for (const payload of [
    { body: { data: [baseBook] } },
    { body: null },
    { body: ['not a book', 7] },
    { invalidJson: true },
]) {
    const { list } = await renderBooksPage(async () => payload);
    assert.equal(list.querySelectorAll('article').length, 0);
    assert.equal(list.textContent, 'The shelf came back scrambled, so nothing is shown. Try again in a moment.');
}

// Unsafe URLs and malicious-looking text stay inert.
{
    const hostileTitle = '<img src=x onerror=alert(1)>';
    const hostileOverview = '<script>alert("pwn")</script>';
    const books = [
        {
            ...baseBook,
            title: hostileTitle,
            overview: hostileOverview,
            amazon_url: 'javascript:alert(1)',
            cover_image_url: 'javascript:alert(1)',
        },
        { ...baseBook, slug: 'http', amazon_url: 'http://www.amazon.com/dp/1', cover_image_url: 'http://images.example.com/a.jpg' },
        { ...baseBook, slug: 'lookalike', amazon_url: 'https://www.amazon.com.evil.example/dp/1', cover_image_url: 'ftp://images.example.com/a.jpg' },
        { ...baseBook, slug: 'creds', amazon_url: 'https://user:pass@www.amazon.com/dp/1', cover_image_url: 'https://user@images.example.com/a.jpg' },
        { ...baseBook, slug: 'port', amazon_url: 'https://www.amazon.com:8443/dp/1', cover_image_url: 'https://images.example.com:8080/a.jpg' },
        { ...baseBook, slug: 'data', amazon_url: 'https://amazon.evil.example/dp/1', cover_image_url: 'data:image/svg+xml,<svg onload=alert(1)>' },
    ];
    const { list } = await renderBooksPage(async () => ({ body: books }));
    const cards = list.querySelectorAll('article');

    assert.equal(cards.length, 6);
    assert.equal(list.querySelectorAll('a').length, 0, 'no unsafe Amazon URL becomes a link');
    assert.equal(list.querySelectorAll('img').length, 0, 'no unsafe cover URL becomes an image');
    assert.equal(cards[0].querySelector('h3').textContent, hostileTitle, 'hostile title renders as literal text');
    assert.equal(cards[0].querySelector('h3').children.length, 0, 'hostile title creates no elements');
    assert.equal(cards[0].querySelector('.book-overview').querySelector('p').textContent, hostileOverview);
    assert.equal(list.querySelectorAll('script').length, 0);
    cards.forEach((card) => {
        assert.ok(card.querySelector('.book-cover-fallback'), 'unsafe cover uses the fallback');
        assert.equal(card.querySelector('.book-link-unavailable').textContent, 'Amazon link unavailable.');
        assert.ok(card.querySelector('.book-overview').textContent !== '', 'overview remains visible');
    });
}

// Price formatting.
{
    const prices = [
        [{ price_amount: '9.5', price_currency: 'USD' }, 'Price: $9.50'],
        [{ price_amount: '0', price_currency: 'USD' }, 'Price: $0.00'],
        [{ price_amount: 0, price_currency: 'EUR' }, 'Price: €0.00'],
        [{ price_amount: '1234.00', price_currency: 'usd' }, 'Price: $1,234.00'],
        [{ price_amount: '1500.00', price_currency: 'JPY' }, 'Price: ¥1,500.00'],
        [{ price_amount: '-3.00', price_currency: 'USD' }, null],
        [{ price_amount: '12.50', price_currency: 'DOLLARS' }, null],
        [{ price_amount: 'free', price_currency: 'USD' }, null],
    ];
    const { list } = await renderBooksPage(async () => ({
        body: prices.map(([fields], index) => ({ ...baseBook, slug: `price-${index}`, ...fields })),
    }));
    const cards = list.querySelectorAll('article');
    prices.forEach(([fields, expected], index) => {
        const price = cards[index].querySelector('.book-price');
        if (expected === null) {
            assert.equal(price, null, `invalid price ${JSON.stringify(fields)} is omitted`);
        } else {
            assert.equal(price.textContent, expected, `price ${JSON.stringify(fields)}`);
        }
    });
}

// Broken cover image falls back without hiding the overview or link.
{
    const { list } = await renderBooksPage(async () => ({ body: [baseBook] }));
    const card = list.querySelector('article');
    const cover = card.querySelector('img');

    cover.dispatch('error');

    assert.equal(card.querySelector('img'), null, 'broken image is removed');
    const fallback = card.querySelector('.book-cover-fallback');
    assert.ok(fallback, 'broken image shows a fallback cover');
    assert.equal(fallback.querySelector('.book-cover-fallback-note').textContent, 'Cover unavailable');
    assert.equal(card.querySelector('.book-overview').querySelectorAll('p').length, 2, 'overview survives a broken cover');
    assert.equal(card.querySelector('a').getAttribute('href'), baseBook.amazon_url, 'Amazon link survives a broken cover');
}

process.stdout.write('Books index renderer regressions passed.\n');

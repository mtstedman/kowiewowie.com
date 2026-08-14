import assert from 'node:assert/strict';

let importCounter = 0;

class ClassList {
    constructor(element) {
        this.element = element;
        this.names = new Set();
    }

    add(...names) {
        names.forEach((name) => this.names.add(name));
        this.sync();
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
        this.style = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.classList = new ClassList(this);
        this._className = '';
        this._id = '';
        this.textContent = '';
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        this.checked = false;
        this.placeholder = '';
        this.href = '';
        this.type = '';
        this.name = '';
    }

    set id(value) {
        this._id = String(value || '');
        if (this._id !== '') {
            this.ownerDocument?.registerElement(this);
        }
    }

    get id() {
        return this._id;
    }

    set className(value) {
        this.classList.set(value);
    }

    get className() {
        return this._className;
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

    insertBefore(node, referenceNode) {
        if (!(node instanceof TestElement)) {
            return null;
        }
        node.parentElement = this;
        const index = this.children.indexOf(referenceNode);
        if (index === -1) {
            this.children.push(node);
        } else {
            this.children.splice(index, 0, node);
        }
        if (node.id !== '') {
            this.ownerDocument?.registerElement(node);
        }
        return node;
    }

    replaceChildren(...nodes) {
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        this.append(...nodes);
    }

    remove() {
        if (!this.parentElement) {
            return;
        }
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
    }

    addEventListener(type, listener, options = {}) {
        const listeners = this.listeners.get(type) || [];
        listeners.push({ listener, once: options?.once === true });
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        event.defaultPrevented ||= false;
        event.preventDefault ||= () => {
            event.defaultPrevented = true;
        };
        event.stopImmediatePropagation ||= () => {
            event.immediatePropagationStopped = true;
        };

        const listeners = [...(this.listeners.get(event.type) || [])];
        listeners.forEach((entry) => {
            if (event.immediatePropagationStopped) {
                return;
            }
            entry.listener.call(this, event);
            if (entry.once) {
                this.listeners.set(event.type, (this.listeners.get(event.type) || []).filter((candidate) => candidate !== entry));
            }
        });
        return !event.defaultPrevented;
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    select() {}

    setSelectionRange() {}

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
        if (selector === '[data-chess-game]') {
            return Object.prototype.hasOwnProperty.call(this.dataset, 'chessGame');
        }
        if (selector.startsWith('[data-square="')) {
            return this.dataset.square === selector.slice(14, -2);
        }
        if (selector === 'button[data-promotion]') {
            return this.tagName === 'BUTTON' && typeof this.dataset.promotion === 'string';
        }
        if (selector === 'button') {
            return this.tagName === 'BUTTON';
        }
        if (selector === 'form.chess-new-game-form') {
            return this.tagName === 'FORM' && this.classList.contains('chess-new-game-form');
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (node.matches(selector)) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
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
    constructor(url) {
        super('#document', null);
        this.ownerDocument = this;
        this.ids = new Map();
        this.readyState = 'loading';
        this.hidden = false;
        this.activeElement = null;
        this.body = new TestElement('body', this);
        this.location = new URL(url);
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

    querySelector(selector) {
        if (selector.startsWith('#')) {
            return this.getElementById(selector.slice(1));
        }
        return this.body.matches(selector) ? this.body : this.body.querySelector(selector);
    }

    contains(element) {
        return element === this.body || this.body.querySelectorAll('*').includes(element);
    }

    execCommand(command) {
        return command === 'copy';
    }
}

const appendElement = (parent, tagName, { id = '', className = '', dataset = {}, value = '', type = '', text = '' } = {}) => {
    const element = parent.ownerDocument.createElement(tagName);
    if (id !== '') {
        element.id = id;
    }
    if (className !== '') {
        element.className = className;
    }
    Object.entries(dataset).forEach(([key, dataValue]) => {
        element.dataset[key] = dataValue;
    });
    element.value = value;
    element.type = type;
    element.textContent = text;
    parent.append(element);
    return element;
};

const installBrowserGlobals = ({ url, fetchHandler }) => {
    const document = new TestDocument(url);
    const location = new URL(url);
    const window = {
        document,
        location: {
            origin: location.origin,
            search: location.search,
            assign: (href) => {
                window.assignedLocation = href;
            },
        },
        isSecureContext: true,
        localStorage: new Map(),
        clearInterval: () => {},
        setInterval: () => 1,
        addEventListener: (...args) => document.addEventListener(...args),
        removeEventListener: () => {},
        crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
        confirm: () => true,
    };
    window.localStorage.getItem = window.localStorage.get.bind(window.localStorage);
    window.localStorage.setItem = window.localStorage.set.bind(window.localStorage);

    const calls = [];
    const fetch = async (resource, options = {}) => {
        calls.push({ resource: String(resource), options });
        const payload = await fetchHandler(String(resource), options);
        return {
            ok: payload.ok ?? true,
            status: payload.status ?? 200,
            text: async () => JSON.stringify(payload.body ?? { data: null }),
        };
    };

    Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: TestElement, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
    Object.defineProperty(globalThis, 'fetch', { value: fetch, configurable: true });
    Object.defineProperty(globalThis, 'Notification', { value: class Notification {}, configurable: true });
    globalThis.Notification.permission = 'denied';
    window.Notification = globalThis.Notification;

    return { document, window, calls };
};

const importFresh = (modulePath) => import(new URL(`${modulePath}?case=${importCounter++}`, import.meta.url).href);

const flushUntil = async (predicate) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) {
            return;
        }
        await Promise.resolve();
    }
    assert.ok(predicate(), 'expected async browser work to finish');
};

const submitEvent = () => ({ type: 'submit', defaultPrevented: false });
const clickEvent = (target) => ({ type: 'click', target, defaultPrevented: false });

const buildLobbyDom = (document) => {
    const root = appendElement(document.body, 'main', { dataset: { chessLobby: '' } });
    const form = appendElement(root, 'form', { id: 'chess-new-game-form', className: 'chess-form chess-new-game-form' });
    appendElement(form, 'select', { id: 'chess-game-mode', value: 'online' });
    appendElement(form, 'select', { id: 'chess-creator-color', value: 'white' });
    appendElement(form, 'button', { id: 'chess-new-game-button', type: 'submit' });
    appendElement(root, 'div', { id: 'chess-games-list' });
    appendElement(root, 'p', { id: 'chess-create-message' });
    appendElement(root, 'div', { id: 'chess-link-box' });
    appendElement(root, 'input', { id: 'chess-join-url' });
    appendElement(root, 'button', { id: 'chess-copy-link-button', type: 'button' });
    appendElement(root, 'a', { id: 'chess-open-game-link' });
    const profile = appendElement(root, 'form', { id: 'chess-profile-form' });
    appendElement(profile, 'input', { id: 'chess-display-name' });
    appendElement(profile, 'button', { id: 'chess-save-name-button', type: 'submit' });
    appendElement(root, 'strong', { id: 'chess-current-name' });
    appendElement(root, 'p', { id: 'chess-profile-message' });
    appendElement(root, 'p', { id: 'chess-join-message' });
    return { form };
};

const gameId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const gamePayload = (sideToMove = 'white') => ({
    id: gameId,
    status: 'active',
    current_ply: sideToMove === 'white' ? 0 : 1,
    viewer: { seat_color: 'white', controls_current_turn: sideToMove === 'white' },
    players: [
        { color: 'white', display_name: 'White player', viewer_controls_seat: true },
        { color: 'black', display_name: 'Black player' },
    ],
    position: {
        side_to_move: sideToMove,
        fen: sideToMove === 'white' ? '8/8/8/8/8/8/4P3/8 w - - 0 1' : '8/8/8/8/4P3/8/8/8 b - - 0 1',
    },
    rules_state: { status: 'active', result: '*' },
    legal_moves: sideToMove === 'white' ? [{ from: 'e2', to: 'e4', uci: 'e2e4' }] : [],
});

const buildGameDom = (document) => {
    const root = appendElement(document.body, 'main', { dataset: { chessGame: '' } });
    appendElement(root, 'p', { id: 'chess-game-summary' });
    appendElement(root, 'p', { id: 'chess-game-error' });
    appendElement(root, 'span', { id: 'chess-turn-status' });
    appendElement(root, 'span', { id: 'chess-rule-status' });
    appendElement(root, 'span', { id: 'chess-control-status' });
    appendElement(root, 'button', { id: 'chess-takeback-button', type: 'button' });
    appendElement(root, 'button', { id: 'chess-resign-button', type: 'button' });
    appendElement(root, 'button', { id: 'chess-fullscreen-toggle', type: 'button' });
    appendElement(root, 'button', { id: 'chess-fullscreen-exit', type: 'button' });
    appendElement(root, 'div', { id: 'chess-board' });
    appendElement(root, 'p', { id: 'chess-board-message' });
    appendElement(root, 'dd', { id: 'chess-white-player' });
    appendElement(root, 'dd', { id: 'chess-black-player' });
    appendElement(root, 'dd', { id: 'chess-viewer-player' });
    const profile = appendElement(root, 'form', { id: 'chess-profile-form' });
    appendElement(profile, 'input', { id: 'chess-display-name' });
    appendElement(profile, 'button', { id: 'chess-save-name-button', type: 'submit' });
    appendElement(root, 'strong', { id: 'chess-current-name' });
    appendElement(root, 'input', { id: 'chess-move-notifications', type: 'checkbox' });
    appendElement(root, 'p', { id: 'chess-notification-message' });
    appendElement(root, 'p', { id: 'chess-profile-message' });
    appendElement(root, 'div', { id: 'chess-move-list' });
    appendElement(root, 'div', { id: 'chess-promotion-dialog' });
    appendElement(root, 'div', { id: 'chess-promotion-options' });
    appendElement(root, 'button', { id: 'chess-promotion-cancel', type: 'button' });
};

{
    const { document, calls } = installBrowserGlobals({
        url: 'https://wowiekowie.com/chess/',
        fetchHandler: async (resource, options) => {
            if (resource === '/api/v1/chess/profile' && options.method === 'GET') {
                return { body: { data: { display_name: 'Browser guest' } } };
            }
            if (resource === '/api/v1/chess/games' && (options.method || 'GET') === 'GET') {
                return { body: { data: [] } };
            }
            if (resource === '/api/v1/chess/games' && options.method === 'POST') {
                return { body: { data: gamePayload() } };
            }
            if (resource === `/api/v1/chess/games/${gameId}/links` && options.method === 'POST') {
                return { body: { data: { link: { token: 'join-token' } } } };
            }
            throw new Error(`unexpected lobby request ${options.method || 'GET'} ${resource}`);
        },
    });
    const { form } = buildLobbyDom(document);

    await importFresh('../htdocs/assets/js/chess-index.js');

    const guardedSubmit = submitEvent();
    form.dispatchEvent(guardedSubmit);
    assert.equal(guardedSubmit.defaultPrevented, true, 'lobby guard prevents native form navigation before full initialization');

    document.readyState = 'interactive';
    document.dispatchEvent({ type: 'DOMContentLoaded' });
    await flushUntil(() => calls.some((call) => call.resource === '/api/v1/chess/games' && (call.options.method || 'GET') === 'GET'));

    const initializedSubmit = submitEvent();
    form.dispatchEvent(initializedSubmit);
    assert.equal(initializedSubmit.defaultPrevented, true, 'lobby submit handler prevents native form navigation after initialization');
    await flushUntil(() => calls.some((call) => call.resource === `/api/v1/chess/games/${gameId}/links` && call.options.method === 'POST'));

    assert.ok(calls.some((call) => call.resource === '/api/v1/chess/profile'), 'lobby loads guest profile through chess API');
    assert.ok(calls.some((call) => call.resource === '/api/v1/chess/games' && call.options.method === 'POST'), 'lobby creates games through chess API');
}

{
    const { document, calls } = installBrowserGlobals({
        url: `https://wowiekowie.com/chess/game.php?id=${gameId}`,
        fetchHandler: async (resource, options) => {
            if (resource === '/api/v1/chess/profile') {
                return { body: { data: { display_name: 'White player' } } };
            }
            if (resource === `/api/v1/chess/games/${gameId}` && (options.method || 'GET') === 'GET') {
                return { body: { data: gamePayload('white') } };
            }
            if (resource === `/api/v1/chess/games/${gameId}/moves` && (options.method || 'GET') === 'GET') {
                return { body: { data: [] } };
            }
            if (resource === `/api/v1/chess/games/${gameId}/moves` && options.method === 'POST') {
                return { body: { data: gamePayload('black') } };
            }
            throw new Error(`unexpected game request ${options.method || 'GET'} ${resource}`);
        },
    });
    buildGameDom(document);

    await importFresh('../htdocs/assets/js/chess-game.js');
    document.readyState = 'interactive';
    document.dispatchEvent({ type: 'DOMContentLoaded' });

    await flushUntil(() => calls.some((call) => call.resource === `/api/v1/chess/games/${gameId}/moves` && (call.options.method || 'GET') === 'GET'));
    assert.ok(calls.some((call) => call.resource === `/api/v1/chess/games/${gameId}` && (call.options.method || 'GET') === 'GET'), 'game boot loads game state through chess API');

    await flushUntil(() => {
        const fromSquare = document.querySelector('[data-square="e2"]');
        const toSquare = document.querySelector('[data-square="e4"]');
        return fromSquare && toSquare && fromSquare.disabled === false;
    });

    const board = document.getElementById('chess-board');
    board.dispatchEvent(clickEvent(document.querySelector('[data-square="e2"]')));
    board.dispatchEvent(clickEvent(document.querySelector('[data-square="e4"]')));

    await flushUntil(() => calls.some((call) => call.resource === `/api/v1/chess/games/${gameId}/moves` && call.options.method === 'POST'));
    assert.ok(calls.filter((call) => call.resource === `/api/v1/chess/games/${gameId}/moves` && (call.options.method || 'GET') === 'GET').length >= 2, 'move submit refreshes move list through chess API');
}

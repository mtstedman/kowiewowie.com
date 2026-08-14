import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SCRIPT_PATH = new URL('../htdocs/assets/js/dongs-index.js', import.meta.url);
const script = await readFile(SCRIPT_PATH, 'utf8');
const successMessage = 'Copied Shrug.';
const failureMessage = 'Could not copy Shrug. Select it and copy it manually.';
const donger = '¯\\_(ツ)_/¯';

class ClassList {
  constructor() {
    this.classes = new Set();
  }

  add(name) {
    this.classes.add(name);
  }

  remove(name) {
    this.classes.delete(name);
  }

  contains(name) {
    return this.classes.has(name);
  }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.value = '';
    this.style = {};
    this.classList = new ClassList();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }

    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  focus() {}

  select() {}

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  contains(target) {
    if (target === this) {
      return true;
    }

    return this.children.some((child) => child.contains(target));
  }

  closest(selector) {
    if (selector === 'button[data-donger]' && this instanceof HTMLButtonElement && this.attributes.has('data-donger')) {
      return this;
    }

    return this.parentNode ? this.parentNode.closest(selector) : null;
  }
}

class HTMLButtonElement extends Element {
  constructor() {
    super('button');
  }
}

const createScenario = ({ clipboard, isSecureContext = true, execCommand = () => true } = {}) => {
  const status = new Element('p');
  status.setAttribute('data-copy-status', '');
  status.setAttribute('role', 'status');

  const button = new HTMLButtonElement();
  button.setAttribute('data-donger', donger);
  button.setAttribute('data-donger-name', 'Shrug');

  const root = new Element('section');
  root.setAttribute('data-donger-library', '');
  root.querySelector = (selector) => (selector === '[data-copy-status]' ? status : null);
  root.appendChild(status);
  root.appendChild(button);

  const body = new Element('body');
  const document = {
    body,
    createElement: (tagName) => new Element(tagName),
    execCommand,
    querySelector: (selector) => (selector === '[data-donger-library]' ? root : null),
  };

  const listeners = new Map();
  root.addEventListener = (eventName, listener) => {
    listeners.set(eventName, listener);
  };

  const errors = [];
  const context = {
    document,
    navigator: clipboard === undefined ? {} : { clipboard },
    window: {
      clearTimeout: () => {},
      isSecureContext,
      setTimeout: () => 1,
    },
    HTMLButtonElement,
    console: {
      error: (...args) => errors.push(args),
      warn: (...args) => errors.push(args),
    },
  };
  context.window.document = document;
  context.window.navigator = context.navigator;
  context.window.HTMLButtonElement = HTMLButtonElement;
  context.window.console = context.console;

  vm.runInNewContext(script, context, { filename: 'dongs-index.js' });

  return {
    body,
    button,
    click: async () => {
      const listener = listeners.get('click');
      assert.equal(typeof listener, 'function');
      await listener({ target: button });
    },
    errors,
    status,
  };
};

{
  const writes = [];
  const scenario = createScenario({
    clipboard: {
      writeText: async (text) => {
        writes.push(text);
      },
    },
  });

  await scenario.click();

  assert.deepEqual(writes, [donger]);
  assert.equal(scenario.status.getAttribute('role'), 'status');
  assert.equal(scenario.status.textContent, successMessage);
  assert.equal(scenario.status.classList.contains('is-visible'), true);
  assert.deepEqual(scenario.errors, []);
}

{
  const scenario = createScenario({
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });

  await scenario.click();

  assert.equal(scenario.status.textContent, failureMessage);
  assert.equal(scenario.status.classList.contains('is-visible'), true);
  assert.deepEqual(scenario.errors, []);
}

{
  const execCalls = [];
  const scenario = createScenario({
    clipboard: undefined,
    isSecureContext: false,
    execCommand: (command) => {
      execCalls.push(command);
      return false;
    },
  });

  await scenario.click();

  assert.deepEqual(execCalls, ['copy']);
  assert.equal(scenario.status.textContent, failureMessage);
  assert.equal(scenario.status.classList.contains('is-visible'), true);
  assert.deepEqual(scenario.errors, []);
  assert.equal(scenario.body.children.some((child) => child.tagName === 'TEXTAREA'), false);
}

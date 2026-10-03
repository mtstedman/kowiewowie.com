(() => {
    'use strict';

    // Progressive enhancement for the guide section editor in /admin/guides.php.
    // Every section item holds exactly one section_heading[] input and one section_body[]
    // textarea, so moving or removing whole items keeps heading/body pairs and order intact.
    const root = document.querySelector('[data-guide-sections]');
    if (!(root instanceof HTMLElement)) {
        return;
    }

    const list = root.querySelector('[data-guide-section-list]');
    const addRow = root.querySelector('[data-guide-section-actions]');
    const addButton = root.querySelector('[data-guide-section-add]');
    const status = root.querySelector('[data-guide-section-status]');
    const undoBox = root.querySelector('[data-guide-section-undo]');
    const undoText = root.querySelector('[data-guide-section-undo-text]');
    const undoButton = root.querySelector('[data-guide-section-undo-button]');
    const emptyNote = root.querySelector('[data-guide-sections-empty]');
    const fallbackNote = root.querySelector('[data-guide-sections-fallback]');

    if (
        !(list instanceof HTMLElement)
        || !(addRow instanceof HTMLElement)
        || !(addButton instanceof HTMLButtonElement)
        || !(status instanceof HTMLElement)
        || !(undoBox instanceof HTMLElement)
        || !(undoText instanceof HTMLElement)
        || !(undoButton instanceof HTMLButtonElement)
    ) {
        return;
    }

    let nextIndex = Number.parseInt(list.dataset.nextIndex || '', 10);
    if (!Number.isFinite(nextIndex)) {
        nextIndex = list.children.length;
    }

    /** @type {{item: HTMLElement, before: Element|null, label: string}|null} */
    let pendingUndo = null;

    /** @returns {HTMLElement[]} */
    const items = () => {
        /** @type {HTMLElement[]} */
        const result = [];
        Array.from(list.children).forEach((child) => {
            if (child instanceof HTMLElement && child.hasAttribute('data-guide-section')) {
                result.push(child);
            }
        });
        return result;
    };

    /** @param {HTMLElement} item */
    const headingOf = (item) => {
        const input = item.querySelector('[data-guide-section-heading]');
        return input instanceof HTMLInputElement ? input : null;
    };

    /** @param {HTMLElement} item */
    const bodyOf = (item) => {
        const textarea = item.querySelector('[data-guide-section-body]');
        return textarea instanceof HTMLTextAreaElement ? textarea : null;
    };

    /** @param {HTMLElement} item */
    const isPopulated = (item) => {
        const heading = headingOf(item);
        const body = bodyOf(item);
        return (heading !== null && heading.value.trim() !== '') || (body !== null && body.value.trim() !== '');
    };

    /** @param {HTMLElement} item @param {number} position */
    const describe = (item, position) => {
        const heading = headingOf(item);
        const text = heading !== null ? heading.value.trim() : '';
        return text !== '' ? `section ${position}, “${text}”` : `section ${position}`;
    };

    /** @param {string} message */
    const announce = (message) => {
        status.textContent = message;
    };

    /** @param {string} action @param {string} text */
    const makeButton = (action, text) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = action === 'remove' ? 'admin-button-secondary admin-button-danger' : 'admin-button-secondary';
        button.dataset.guideSectionAction = action;
        button.textContent = text;
        return button;
    };

    /** @param {HTMLElement} item @param {string} action */
    const actionButton = (item, action) => {
        const button = item.querySelector(`[data-guide-section-action="${action}"]`);
        return button instanceof HTMLButtonElement ? button : null;
    };

    /** @param {HTMLElement} item */
    const enhanceItem = (item) => {
        const tools = item.querySelector('[data-guide-section-tools]');
        if (!(tools instanceof HTMLElement) || tools.dataset.enhanced === 'true') {
            return;
        }
        tools.replaceChildren(
            makeButton('up', 'Move up'),
            makeButton('down', 'Move down'),
            makeButton('remove', 'Remove section'),
        );
        tools.dataset.enhanced = 'true';
        tools.hidden = false;
    };

    const refresh = () => {
        const all = items();
        all.forEach((item, index) => {
            const position = index + 1;
            const legend = item.querySelector('[data-guide-section-legend]');
            if (legend instanceof HTMLElement) {
                legend.textContent = `Section ${position}`;
            }

            const up = actionButton(item, 'up');
            const down = actionButton(item, 'down');
            const remove = actionButton(item, 'remove');
            if (up !== null) {
                up.disabled = index === 0;
                up.setAttribute('aria-label', `Move section ${position} up`);
            }
            if (down !== null) {
                down.disabled = index === all.length - 1;
                down.setAttribute('aria-label', `Move section ${position} down`);
            }
            if (remove !== null) {
                remove.setAttribute('aria-label', `Remove section ${position}`);
            }
        });

        if (emptyNote instanceof HTMLElement) {
            emptyNote.hidden = all.length !== 0;
        }
    };

    const clearUndo = () => {
        pendingUndo = null;
        undoText.textContent = '';
        undoBox.hidden = true;
    };

    /** @param {HTMLElement|undefined} item */
    const focusItem = (item) => {
        const heading = item ? headingOf(item) : null;
        if (heading !== null) {
            heading.focus();
            return;
        }
        addButton.focus();
    };

    /** @param {string} labelText @param {string} name @param {string} id @param {boolean} multiline */
    const makeField = (labelText, name, id, multiline) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'admin-field';
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = labelText;
        const control = document.createElement(multiline ? 'textarea' : 'input');
        control.id = id;
        control.setAttribute('name', name);
        if (control instanceof HTMLTextAreaElement) {
            control.rows = 6;
            control.dataset.guideSectionBody = '';
        } else if (control instanceof HTMLInputElement) {
            control.type = 'text';
            control.dataset.guideSectionHeading = '';
        }
        wrapper.append(label, control);
        return wrapper;
    };

    const createItem = () => {
        const index = nextIndex;
        nextIndex += 1;
        list.dataset.nextIndex = String(nextIndex);

        const item = document.createElement('li');
        item.className = 'admin-guide-section';
        item.dataset.guideSection = '';

        const fieldset = document.createElement('fieldset');
        fieldset.className = 'admin-fieldset admin-guide-section-fields';

        const legend = document.createElement('legend');
        legend.dataset.guideSectionLegend = '';

        const tools = document.createElement('div');
        tools.className = 'admin-action-row admin-guide-section-tools';
        tools.dataset.guideSectionTools = '';

        fieldset.append(
            legend,
            makeField('Heading', 'section_heading[]', `guides-section-heading-${index}`, false),
            makeField('Body', 'section_body[]', `guides-section-body-${index}`, true),
            tools,
        );
        item.append(fieldset);
        enhanceItem(item);
        return item;
    };

    const addSection = () => {
        const item = createItem();
        list.append(item);
        refresh();
        focusItem(item);
        announce(`Added section ${items().length}. Blank sections are skipped when saving.`);
    };

    /** @param {HTMLElement} item */
    const removeSection = (item) => {
        const before = items();
        const index = before.indexOf(item);
        if (index === -1) {
            return;
        }
        const position = index + 1;
        const label = describe(item, position);
        const populated = isPopulated(item);
        const nextSibling = item.nextElementSibling;

        clearUndo();
        item.remove();
        refresh();

        if (populated) {
            pendingUndo = { item, before: nextSibling, label };
            undoText.textContent = `Removed ${label}. It will not be saved unless you undo.`;
            undoBox.hidden = false;
            undoButton.focus();
            announce(`Removed ${label}. Press Undo remove to restore it.`);
            return;
        }

        const remaining = items();
        focusItem(remaining[index] || remaining[index - 1]);
        announce(remaining.length === 0
            ? `Removed empty ${label}. No sections remain; use Add section to start again.`
            : `Removed empty ${label}.`);
    };

    const undoRemove = () => {
        if (pendingUndo === null) {
            return;
        }
        const { item, before, label } = pendingUndo;
        if (before instanceof Element && before.parentElement === list) {
            list.insertBefore(item, before);
        } else {
            list.append(item);
        }
        clearUndo();
        refresh();
        focusItem(item);
        announce(`Restored ${label} as section ${items().indexOf(item) + 1}.`);
    };

    /** @param {HTMLElement} item @param {number} direction @param {HTMLButtonElement} button */
    const moveSection = (item, direction, button) => {
        const all = items();
        const index = all.indexOf(item);
        const targetIndex = index + direction;
        if (index === -1 || targetIndex < 0 || targetIndex >= all.length) {
            return;
        }

        const label = describe(item, index + 1);
        if (direction < 0) {
            list.insertBefore(item, all[targetIndex]);
        } else {
            list.insertBefore(item, all[targetIndex].nextElementSibling);
        }
        refresh();

        const opposite = actionButton(item, direction < 0 ? 'down' : 'up');
        if (!button.disabled) {
            button.focus();
        } else if (opposite !== null && !opposite.disabled) {
            opposite.focus();
        } else {
            focusItem(item);
        }
        announce(`Moved ${label} to position ${targetIndex + 1} of ${all.length}.`);
    };

    // A trailing blank pair is only needed when scripts are off; the Add section button
    // replaces it. Keep it when it is the only section so a new guide starts with one.
    const initial = items();
    const trailing = initial[initial.length - 1];
    if (initial.length > 1 && trailing && !isPopulated(trailing)) {
        trailing.remove();
    }

    items().forEach(enhanceItem);
    refresh();
    if (fallbackNote instanceof HTMLElement) {
        fallbackNote.hidden = true;
    }
    addRow.hidden = false;
    root.dataset.guideSectionsEnhanced = 'true';

    addButton.addEventListener('click', addSection);
    undoButton.addEventListener('click', undoRemove);

    list.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const button = target.closest('[data-guide-section-action]');
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
            return;
        }
        const item = button.closest('[data-guide-section]');
        if (!(item instanceof HTMLElement) || item.parentElement !== list) {
            return;
        }

        const action = button.dataset.guideSectionAction;
        if (action === 'up') {
            moveSection(item, -1, button);
        } else if (action === 'down') {
            moveSection(item, 1, button);
        } else if (action === 'remove') {
            removeSection(item);
        }
    });
})();

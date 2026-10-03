(() => {
    /** @typedef {{name: string, cardId: string, imageUrl: string}} AdminDecksCard */
    /** @typedef {AdminDecksCard & {quantity?: string}} AdminDecksDraggableCard */
    /** @typedef {{scryfall_id: string, name: string, image_url: string, mana_cost: string, type_line: string, set_name: string, set_code: string, collector_number: string}} AdminDecksSearchCard */
    /** @typedef {{headers: {Accept: string}, signal: AbortSignal}} AdminDecksSearchRequestOptions */

    const root = /** @type {HTMLElement|null} */ (document.querySelector('[data-deck-editor]'));
    const form = /** @type {HTMLFormElement|null} */ (document.querySelector('[data-deck-form]'));
    const sectionsRoot = /** @type {HTMLElement|null} */ (document.querySelector('[data-deck-sections]'));
    const addSection = /** @type {HTMLButtonElement|null} */ (document.querySelector('[data-add-section]'));
    const searchInput = /** @type {HTMLInputElement|null} */ (document.querySelector('[data-card-search-input]'));
    const searchResults = /** @type {HTMLElement|null} */ (document.querySelector('[data-card-search-results]'));
    const editorStatus = /** @type {HTMLElement|null} */ (document.querySelector('[data-editor-status]'));
    const cancelEditor = /** @type {HTMLAnchorElement|null} */ (document.querySelector('[data-cancel-editor]'));
    if (!root || !form || !sectionsRoot || !addSection || !searchInput || !searchResults || !editorStatus) {
        return;
    }

    const SEARCH_DEBOUNCE_MS = 250;
    const DRAG_MIME_TYPE = 'application/x-admin-deck-card';
    const ROW_DRAG_MIME_TYPE = 'application/x-admin-deck-row';
    /** @type {number|null} */
    let searchTimer = null;
    let currentRequest = 0;
    let formIsDirty = false;
    /** @type {AbortController|null} */
    let searchController = null;
    /** @type {AdminDecksDraggableCard|null} */
    let draggedCard = null;
    /** @type {HTMLElement|null} */
    let draggedRow = null;

    /** @param {unknown} value */
    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');

    /** @param {string} imageUrl @param {string} name */
    const cardImage = (imageUrl, name) => imageUrl
        ? `<div data-card-image><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} card art" loading="lazy"></div>`
        : '<div data-card-image></div>';

    /** @param {number} sectionIndex @param {number} cardIndex @param {string} [cardId] @param {string} [imageUrl] */
    const hiddenCardFields = (sectionIndex, cardIndex, cardId = '', imageUrl = '') => `
        <input type="hidden" name="deck_sections[${sectionIndex}][cards][${cardIndex}][card_id]" value="${escapeHtml(cardId)}">
        <input type="hidden" name="deck_sections[${sectionIndex}][cards][${cardIndex}][image_url]" value="${escapeHtml(imageUrl)}">`;

    const cardControls = () => `
        <div class="admin-action-row" data-card-controls aria-label="Card ordering controls">
            <button type="button" data-move-card-up>Move up</button>
            <button type="button" data-move-card-down>Move down</button>
            <label>
                <span>Move to section</span>
                <select data-move-card-select></select>
            </label>
            <button type="button" data-move-card-section>Move card</button>
            <button type="button" data-remove-card>Remove card</button>
        </div>`;

    /** @param {number} sectionIndex @param {number} cardIndex @param {string} [quantity] @param {string} [name] @param {string} [cardId] @param {string} [imageUrl] */
    const cardRow = (sectionIndex, cardIndex, quantity = '1', name = '', cardId = '', imageUrl = '') => `
        <div class="admin-form-row" data-card-row data-section-index="${sectionIndex}" data-card-index="${cardIndex}" draggable="true">
            ${cardImage(imageUrl, name)}
            <label>
                <span>Quantity</span>
                <input type="number" min="1" max="999" step="1" name="deck_sections[${sectionIndex}][cards][${cardIndex}][quantity]" value="${escapeHtml(quantity)}" inputmode="numeric" required>
            </label>
            <label>
                <span>Card</span>
                <input name="deck_sections[${sectionIndex}][cards][${cardIndex}][name]" value="${escapeHtml(name)}" required maxlength="255">
            </label>
            ${hiddenCardFields(sectionIndex, cardIndex, cardId, imageUrl)}
            ${cardControls()}
        </div>`;

    /** @param {number} sectionIndex */
    const sectionBlock = (sectionIndex) => `
        <article class="admin-deck-section" data-section data-section-index="${sectionIndex}" data-next-card="1">
            <div class="admin-section-heading">
                <h4 data-section-heading>Section ${sectionIndex + 1}</h4>
                <div class="admin-action-row" aria-label="Section ordering controls">
                    <button type="button" data-move-section-up>Move section up</button>
                    <button type="button" data-move-section-down>Move section down</button>
                    <button type="button" data-remove-section>Remove section</button>
                </div>
            </div>
            <label>
                <span>Section name</span>
                <input name="deck_sections[${sectionIndex}][name]" required maxlength="120">
            </label>
            <div data-card-list aria-label="Cards in this section">${cardRow(sectionIndex, 0)}</div>
            <button type="button" data-add-card>Add blank card row</button>
        </article>`;

    /** @param {unknown} value */
    const normalizeQuantity = (value) => {
        const quantity = Number.parseInt(String(value), 10);
        if (!Number.isFinite(quantity) || quantity < 1) {
            return '1';
        }
        return String(Math.min(quantity, 999));
    };

    const sections = () => Array.from(sectionsRoot.querySelectorAll('[data-section]'))
        .filter((section) => section instanceof HTMLElement);

    /** @param {HTMLElement} section @param {number} fallbackIndex */
    const sectionLabel = (section, fallbackIndex) => {
        const input = Array.from(section.querySelectorAll('input[name$="[name]"]'))
            .find((candidate) => candidate instanceof HTMLInputElement && !candidate.closest('[data-card-row]'));
        const name = input instanceof HTMLInputElement ? input.value.trim() : '';
        return name !== '' ? name : `Section ${fallbackIndex + 1}`;
    };

    const sectionOptions = () => sections().map((section, index) => {
        const sectionIndex = section.dataset.sectionIndex || String(index);
        return `<option value="${escapeHtml(sectionIndex)}">${escapeHtml(sectionLabel(section, index))}</option>`;
    }).join('');

    /** @param {HTMLElement} list */
    const cardRows = (list) => Array.from(list.querySelectorAll(':scope > [data-card-row]'))
        .filter((row) => row instanceof HTMLElement);

    /** @param {HTMLElement} row */
    const cardName = (row) => {
        const input = row.querySelector('input[name$="[name]"]');
        return input instanceof HTMLInputElement && input.value.trim() !== '' ? input.value.trim() : 'Blank card';
    };

    /** @param {HTMLElement} row */
    const rowIsPopulated = (row) => {
        const nameInput = row.querySelector('input[name$="[name]"]');
        const cardIdInput = row.querySelector('input[name$="[card_id]"]');
        return (nameInput instanceof HTMLInputElement && nameInput.value.trim() !== '')
            || (cardIdInput instanceof HTMLInputElement && cardIdInput.value.trim() !== '');
    };

    /** @param {HTMLElement} list */
    const removeSoleBlankRow = (list) => {
        const rows = cardRows(list);
        if (rows.length === 1 && !rowIsPopulated(rows[0])) {
            rows[0].remove();
        }
    };

    /** @param {HTMLElement} section */
    const sectionIsPopulated = (section) => {
        const nameInput = Array.from(section.querySelectorAll('input[name$="[name]"]'))
            .find((candidate) => candidate instanceof HTMLInputElement && !candidate.closest('[data-card-row]'));
        const list = section.querySelector('[data-card-list]');
        return (nameInput instanceof HTMLInputElement && nameInput.value.trim() !== '')
            || (list instanceof HTMLElement && cardRows(list).some(rowIsPopulated));
    };

    /** @param {string} message @param {HTMLElement|null} [focusTarget] */
    const announce = (message, focusTarget = null) => {
        editorStatus.textContent = message;
        if (focusTarget) {
            window.requestAnimationFrame(() => focusTarget.focus());
        }
    };

    const markDirty = () => {
        formIsDirty = true;
    };

    /** @param {HTMLInputElement} input */
    const fieldNameFromInput = (input) => {
        const match = input.name.match(/\[cards\]\[\d+\]\[([^\]]+)\]$/);
        return match ? match[1] : '';
    };

    /** @param {HTMLElement} list */
    const refreshEmptyCardState = (list) => {
        const existing = list.querySelector('[data-empty-card-list]');
        const rows = cardRows(list);
        if (rows.length === 0 && !existing) {
            list.insertAdjacentHTML('beforeend', '<p data-empty-card-list>No cards in this section yet. Add a blank row or search for a card.</p>');
        } else if (rows.length > 0) {
            existing?.remove();
        }
    };

    const refreshControls = () => {
        const allSections = sections();
        const options = sectionOptions();

        searchResults.querySelectorAll('[data-add-section-select]').forEach((select) => {
            if (!(select instanceof HTMLSelectElement)) {
                return;
            }
            const selectedValue = select.value;
            select.innerHTML = options;
            if (Array.from(select.options).some((option) => option.value === selectedValue)) {
                select.value = selectedValue;
            }
        });

        allSections.forEach((section, sectionIndex) => {
            const heading = section.querySelector('[data-section-heading]');
            if (heading) {
                heading.textContent = `${sectionLabel(section, sectionIndex)} — section ${sectionIndex + 1}`;
            }
            const sectionName = sectionLabel(section, sectionIndex);
            const list = section.querySelector('[data-card-list]');
            if (list instanceof HTMLElement) {
                list.setAttribute('aria-label', `Cards in ${sectionName}`);
                const rows = cardRows(list);
                rows.forEach((row, cardIndex) => {
                    const up = row.querySelector('[data-move-card-up]');
                    const down = row.querySelector('[data-move-card-down]');
                    const moveSelect = row.querySelector('[data-move-card-select]');
                    const moveButton = row.querySelector('[data-move-card-section]');
                    if (up instanceof HTMLButtonElement) {
                        up.disabled = cardIndex === 0;
                    }
                    if (down instanceof HTMLButtonElement) {
                        down.disabled = cardIndex === rows.length - 1;
                    }
                    if (moveSelect instanceof HTMLSelectElement) {
                        const previous = moveSelect.value;
                        moveSelect.innerHTML = options;
                        const currentValue = String(sectionIndex);
                        if (Array.from(moveSelect.options).some((option) => option.value === previous && previous !== currentValue)) {
                            moveSelect.value = previous;
                        } else {
                            const other = Array.from(moveSelect.options).find((option) => option.value !== currentValue);
                            moveSelect.value = other?.value || currentValue;
                        }
                        moveSelect.disabled = allSections.length < 2;
                    }
                    if (moveButton instanceof HTMLButtonElement) {
                        moveButton.disabled = allSections.length < 2;
                    }
                });
                refreshEmptyCardState(list);
            }

            const sectionUp = section.querySelector('[data-move-section-up]');
            const sectionDown = section.querySelector('[data-move-section-down]');
            const removeSection = section.querySelector('[data-remove-section]');
            if (sectionUp instanceof HTMLButtonElement) {
                sectionUp.disabled = sectionIndex === 0;
            }
            if (sectionDown instanceof HTMLButtonElement) {
                sectionDown.disabled = sectionIndex === allSections.length - 1;
            }
            if (removeSection instanceof HTMLButtonElement) {
                removeSection.disabled = allSections.length === 1;
                removeSection.title = allSections.length === 1 ? 'A deck must keep at least one section.' : '';
            }
        });
    };

    const refreshDeckIndices = () => {
        sections().forEach((section, sectionIndex) => {
            section.dataset.sectionIndex = String(sectionIndex);
            const sectionNameInput = Array.from(section.querySelectorAll('input[name$="[name]"]'))
                .find((input) => input instanceof HTMLInputElement && !input.closest('[data-card-row]'));
            if (sectionNameInput instanceof HTMLInputElement) {
                sectionNameInput.name = `deck_sections[${sectionIndex}][name]`;
            }

            const list = section.querySelector('[data-card-list]');
            if (!(list instanceof HTMLElement)) {
                section.dataset.nextCard = '0';
                return;
            }

            cardRows(list).forEach((row, cardIndex) => {
                row.dataset.sectionIndex = String(sectionIndex);
                row.dataset.cardIndex = String(cardIndex);
                row.setAttribute('draggable', 'true');
                row.querySelectorAll('input[name]').forEach((input) => {
                    if (!(input instanceof HTMLInputElement)) {
                        return;
                    }
                    const fieldName = fieldNameFromInput(input);
                    if (fieldName !== '') {
                        input.name = `deck_sections[${sectionIndex}][cards][${cardIndex}][${fieldName}]`;
                    }
                });
            });
            section.dataset.nextCard = String(cardRows(list).length);
        });
        sectionsRoot.dataset.nextSection = String(sections().length);
        refreshControls();
    };

    /** @param {string} sectionIndex */
    const findSection = (sectionIndex) => sections()
        .find((section) => (section.dataset.sectionIndex || '') === sectionIndex) || sections()[0] || null;

    /** @param {HTMLElement} row */
    const cardNameInput = (row) => {
        const input = row.querySelector('input[name$="[name]"]');
        return input instanceof HTMLInputElement ? input : null;
    };

    /** @param {HTMLElement} section */
    const sectionNameInput = (section) => {
        const input = Array.from(section.querySelectorAll('input[name$="[name]"]'))
            .find((candidate) => candidate instanceof HTMLInputElement && !candidate.closest('[data-card-row]'));
        return input instanceof HTMLInputElement ? input : null;
    };

    /** @param {HTMLElement} result @returns {AdminDecksCard} */
    const cardFromResult = (result) => ({
        name: result.dataset.cardName || '',
        cardId: result.dataset.cardId || '',
        imageUrl: result.dataset.imageUrl || '',
    });

    /** @param {HTMLElement} result */
    const searchResultQuantity = (result) => {
        const input = result.querySelector('[data-add-quantity]');
        return normalizeQuantity(input instanceof HTMLInputElement ? input.value : '1');
    };

    /** @param {AdminDecksSearchCard} card */
    const printingDetail = (card) => {
        const details = [];
        const setCode = card.set_code ? card.set_code.toUpperCase() : '';
        const set = [card.set_name, setCode ? `(${setCode})` : ''].filter(Boolean).join(' ');
        if (set !== '') {
            details.push(set);
        }
        if (card.collector_number) {
            details.push(`#${card.collector_number}`);
        }
        if (card.mana_cost) {
            details.push(card.mana_cost);
        }
        return details.join(' · ');
    };

    /** @param {string} state @param {string} message @param {boolean} [busy] */
    const renderSearchState = (state, message, busy = false) => {
        searchResults.dataset.searchState = state;
        searchResults.setAttribute('aria-busy', busy ? 'true' : 'false');
        searchResults.innerHTML = `<p>${escapeHtml(message)}</p>`;
    };

    /** @param {AdminDecksSearchCard[]} cards */
    const renderSearchResults = (cards) => {
        searchResults.setAttribute('aria-busy', 'false');
        if (cards.length === 0) {
            renderSearchState('empty', 'No cards found. Try a shorter name or another printing.');
            return;
        }

        const options = sectionOptions();
        searchResults.dataset.searchState = 'success';
        searchResults.innerHTML = `<p>${cards.length} card result${cards.length === 1 ? '' : 's'} found.</p>${cards.map((card, index) => `
            <article
                data-search-result
                data-result-index="${index}"
                data-card-id="${escapeHtml(card.scryfall_id)}"
                data-card-name="${escapeHtml(card.name)}"
                data-image-url="${escapeHtml(card.image_url || '')}"
                draggable="true"
            >
                ${cardImage(card.image_url || '', card.name)}
                <div>
                    <strong>${escapeHtml(card.name)}</strong>
                    <p>${escapeHtml(card.type_line || '')}</p>
                    <p>${escapeHtml(printingDetail(card))}</p>
                </div>
                <div class="admin-form-row">
                    <label>
                        <span>Destination section</span>
                        <select data-add-section-select>${options}</select>
                    </label>
                    <label>
                        <span>Quantity</span>
                        <input type="number" min="1" max="999" step="1" value="1" data-add-quantity>
                    </label>
                    <button type="button" data-add-search-result>Add ${escapeHtml(card.name)}</button>
                </div>
            </article>`).join('')}`;
    };

    /** @param {HTMLElement} section @param {AdminDecksCard} card @param {string} [quantity] @param {HTMLElement|null} [beforeRow] */
    const insertCardIntoSection = (section, card, quantity = '1', beforeRow = null) => {
        const list = section.querySelector('[data-card-list]');
        if (!(list instanceof HTMLElement)) {
            return null;
        }

        removeSoleBlankRow(list);
        list.querySelector('[data-empty-card-list]')?.remove();

        const sectionIndex = Number(section.dataset.sectionIndex || '0');
        const cardIndex = cardRows(list).length;
        list.insertAdjacentHTML('beforeend', cardRow(sectionIndex, cardIndex, normalizeQuantity(quantity), card.name, card.cardId, card.imageUrl));
        const insertedRow = list.lastElementChild;
        if (insertedRow instanceof HTMLElement && beforeRow instanceof HTMLElement && beforeRow.parentElement === list) {
            list.insertBefore(insertedRow, beforeRow);
        }
        refreshDeckIndices();
        markDirty();
        return insertedRow instanceof HTMLElement ? insertedRow : null;
    };

    /** @param {HTMLElement} list @param {number} clientY */
    const rowAfterPointer = (list, clientY) => cardRows(list).find((row) => {
        if (row === draggedRow) {
            return false;
        }
        const box = row.getBoundingClientRect();
        return clientY < box.top + (box.height / 2);
    }) || null;

    /** @param {string} query */
    const searchCards = async (query) => {
        const requestId = ++currentRequest;
        if (searchController) {
            searchController.abort();
        }
        searchController = new AbortController();
        renderSearchState('loading', `Searching for “${query}”…`, true);

        try {
            const response = await fetch(`/api/v1/magic/cards/search?q=${encodeURIComponent(query)}`, /** @type {AdminDecksSearchRequestOptions} */ ({
                headers: { Accept: 'application/json' },
                signal: searchController.signal,
            }));
            if (!response.ok) {
                throw new Error(`Search failed with status ${response.status}`);
            }

            const payload = await response.json();
            if (requestId !== currentRequest) {
                return;
            }

            const cards = Array.isArray(payload)
                ? payload.map((card) => ({
                    scryfall_id: typeof card?.scryfall_id === 'string' ? card.scryfall_id : '',
                    name: typeof card?.name === 'string' ? card.name : '',
                    image_url: typeof card?.image_url === 'string' ? card.image_url : '',
                    mana_cost: typeof card?.mana_cost === 'string' ? card.mana_cost : '',
                    type_line: typeof card?.type_line === 'string' ? card.type_line : '',
                    set_name: typeof card?.set_name === 'string' ? card.set_name : '',
                    set_code: typeof card?.set_code === 'string' ? card.set_code : '',
                    collector_number: typeof card?.collector_number === 'string' ? card.collector_number : '',
                })).filter((card) => card.scryfall_id !== '' && card.name !== '')
                : [];
            renderSearchResults(cards);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            if (requestId !== currentRequest) {
                return;
            }
            renderSearchState('error', 'Card search failed. Check your connection and try the search again.');
        }
    };

    renderSearchState('idle', 'Search for a card to add it to a section.');
    refreshDeckIndices();

    form.addEventListener('input', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && !target.closest('[data-card-search-results], [data-card-search-input]')) {
            markDirty();
        }
        if (target instanceof HTMLInputElement && target.matches('[name$="[name]"]')) {
            refreshControls();
        }
    });
    form.addEventListener('change', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && !target.closest('[data-card-search-results], [data-card-search-input]')) {
            markDirty();
        }
    });
    form.addEventListener('submit', () => {
        formIsDirty = false;
    });

    cancelEditor?.addEventListener('click', (event) => {
        if (formIsDirty && !window.confirm('Discard the unsaved deck changes in this editor?')) {
            event.preventDefault();
        }
    });

    addSection.addEventListener('click', () => {
        const index = sections().length;
        sectionsRoot.insertAdjacentHTML('beforeend', sectionBlock(index));
        refreshDeckIndices();
        markDirty();
        const newSection = sections()[sections().length - 1];
        const input = newSection ? sectionNameInput(newSection) : null;
        announce(`Section ${index + 1} added. Name the new section.`, input);
    });

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (searchTimer !== null) {
            window.clearTimeout(searchTimer);
        }

        if (query === '') {
            if (searchController) {
                searchController.abort();
            }
            currentRequest += 1;
            renderSearchState('idle', 'Search for a card to add it to a section.');
            return;
        }

        searchTimer = window.setTimeout(() => searchCards(query), SEARCH_DEBOUNCE_MS);
    });

    root.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const addResultButton = target.closest('[data-add-search-result]');
        if (addResultButton instanceof HTMLButtonElement) {
            const result = addResultButton.closest('[data-search-result]');
            const sectionSelect = result?.querySelector('[data-add-section-select]');
            const section = sectionSelect instanceof HTMLSelectElement ? findSection(sectionSelect.value) : null;
            if (!(result instanceof HTMLElement) || !(section instanceof HTMLElement)) {
                announce('Choose an available destination section before adding the card.');
                return;
            }
            const card = cardFromResult(result);
            const row = insertCardIntoSection(section, card, searchResultQuantity(result));
            announce(`${card.name} added to ${sectionLabel(section, sections().indexOf(section))}.`, row ? cardNameInput(row) : null);
            return;
        }

        const addCardButton = target.closest('[data-add-card]');
        if (addCardButton instanceof HTMLButtonElement) {
            const section = addCardButton.closest('[data-section]');
            if (!(section instanceof HTMLElement)) {
                return;
            }
            const row = insertCardIntoSection(section, { name: '', cardId: '', imageUrl: '' });
            announce(`Blank card row added to ${sectionLabel(section, sections().indexOf(section))}.`, row ? cardNameInput(row) : null);
            return;
        }

        const moveCardUp = target.closest('[data-move-card-up]');
        const moveCardDown = target.closest('[data-move-card-down]');
        if (moveCardUp instanceof HTMLButtonElement || moveCardDown instanceof HTMLButtonElement) {
            const row = target.closest('[data-card-row]');
            const list = row?.parentElement;
            if (!(row instanceof HTMLElement) || !(list instanceof HTMLElement)) {
                return;
            }
            const rows = cardRows(list);
            const index = rows.indexOf(row);
            const destination = moveCardUp ? index - 1 : index + 1;
            if (destination < 0 || destination >= rows.length) {
                return;
            }
            if (moveCardUp) {
                list.insertBefore(row, rows[destination]);
            } else {
                list.insertBefore(rows[destination], row);
            }
            refreshDeckIndices();
            markDirty();
            const button = row.querySelector(moveCardUp ? '[data-move-card-up]' : '[data-move-card-down]');
            announce(`${cardName(row)} moved to position ${destination + 1}.`, button instanceof HTMLElement ? button : null);
            return;
        }

        const moveCardSection = target.closest('[data-move-card-section]');
        if (moveCardSection instanceof HTMLButtonElement) {
            const row = moveCardSection.closest('[data-card-row]');
            const select = row?.querySelector('[data-move-card-select]');
            const destination = select instanceof HTMLSelectElement ? findSection(select.value) : null;
            const destinationList = destination?.querySelector('[data-card-list]');
            if (!(row instanceof HTMLElement) || !(destination instanceof HTMLElement) || !(destinationList instanceof HTMLElement)) {
                return;
            }
            if (row.closest('[data-section]') === destination) {
                announce(`${cardName(row)} is already in ${sectionLabel(destination, sections().indexOf(destination))}.`, moveCardSection);
                return;
            }
            removeSoleBlankRow(destinationList);
            destinationList.querySelector('[data-empty-card-list]')?.remove();
            destinationList.appendChild(row);
            refreshDeckIndices();
            markDirty();
            const movedButton = row.querySelector('[data-move-card-section]');
            announce(`${cardName(row)} moved to ${sectionLabel(destination, sections().indexOf(destination))}.`, movedButton instanceof HTMLElement ? movedButton : null);
            return;
        }

        const removeCard = target.closest('[data-remove-card]');
        if (removeCard instanceof HTMLButtonElement) {
            const row = removeCard.closest('[data-card-row]');
            const section = row?.closest('[data-section]');
            if (!(row instanceof HTMLElement) || !(section instanceof HTMLElement)) {
                return;
            }
            const name = cardName(row);
            if (rowIsPopulated(row) && !window.confirm(`Remove ${name} from this deck?`)) {
                return;
            }
            row.remove();
            refreshDeckIndices();
            markDirty();
            const addButton = section.querySelector('[data-add-card]');
            announce(`${name} removed.`, addButton instanceof HTMLElement ? addButton : null);
            return;
        }

        const sectionUp = target.closest('[data-move-section-up]');
        const sectionDown = target.closest('[data-move-section-down]');
        if (sectionUp instanceof HTMLButtonElement || sectionDown instanceof HTMLButtonElement) {
            const section = target.closest('[data-section]');
            if (!(section instanceof HTMLElement)) {
                return;
            }
            const allSections = sections();
            const index = allSections.indexOf(section);
            const destination = sectionUp ? index - 1 : index + 1;
            if (destination < 0 || destination >= allSections.length) {
                return;
            }
            if (sectionUp) {
                sectionsRoot.insertBefore(section, allSections[destination]);
            } else {
                sectionsRoot.insertBefore(allSections[destination], section);
            }
            refreshDeckIndices();
            markDirty();
            const button = section.querySelector(sectionUp ? '[data-move-section-up]' : '[data-move-section-down]');
            announce(`${sectionLabel(section, destination)} moved to section position ${destination + 1}.`, button instanceof HTMLElement ? button : null);
            return;
        }

        const removeSection = target.closest('[data-remove-section]');
        if (removeSection instanceof HTMLButtonElement) {
            const section = removeSection.closest('[data-section]');
            if (!(section instanceof HTMLElement) || sections().length === 1) {
                return;
            }
            const name = sectionLabel(section, sections().indexOf(section));
            if (sectionIsPopulated(section) && !window.confirm(`Remove the ${name} section and all of its cards?`)) {
                return;
            }
            const allSections = sections();
            const oldIndex = allSections.indexOf(section);
            section.remove();
            refreshDeckIndices();
            markDirty();
            const remaining = sections();
            const focusSection = remaining[Math.min(oldIndex, remaining.length - 1)];
            announce(`${name} section removed.`, focusSection ? sectionNameInput(focusSection) : null);
        }
    });

    root.addEventListener('dragstart', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.closest('button, input, select, textarea')) {
            return;
        }

        draggedCard = null;
        draggedRow = null;
        const result = target.closest('[data-search-result]');
        if (result instanceof HTMLElement) {
            draggedCard = { ...cardFromResult(result), quantity: searchResultQuantity(result) };
            if (event.dataTransfer && draggedCard.name !== '' && draggedCard.cardId !== '') {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(draggedCard));
                event.dataTransfer.setData('text/plain', draggedCard.name);
            }
            return;
        }

        const row = target.closest('[data-card-row]');
        if (!(row instanceof HTMLElement) || !sectionsRoot.contains(row)) {
            return;
        }
        draggedRow = row;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(ROW_DRAG_MIME_TYPE, 'move');
            event.dataTransfer.setData('text/plain', 'Move deck row');
        }
    });

    root.addEventListener('dragend', () => {
        draggedCard = null;
        draggedRow = null;
    });

    root.addEventListener('dragover', (event) => {
        const target = event.target;
        const list = target instanceof HTMLElement ? target.closest('[data-card-list]') : null;
        if (!(list instanceof HTMLElement)) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = draggedRow instanceof HTMLElement ? 'move' : 'copy';
        }
    });

    root.addEventListener('drop', (event) => {
        const target = event.target;
        const list = target instanceof HTMLElement ? target.closest('[data-card-list]') : null;
        const section = list?.closest('[data-section]');
        if (!(list instanceof HTMLElement) || !(section instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        const beforeRow = rowAfterPointer(list, event.clientY);
        if (draggedRow instanceof HTMLElement) {
            const name = cardName(draggedRow);
            removeSoleBlankRow(list);
            list.querySelector('[data-empty-card-list]')?.remove();
            if (beforeRow instanceof HTMLElement && beforeRow.parentElement === list) {
                list.insertBefore(draggedRow, beforeRow);
            } else {
                list.appendChild(draggedRow);
            }
            refreshDeckIndices();
            markDirty();
            announce(`${name} moved to ${sectionLabel(section, sections().indexOf(section))}.`, cardNameInput(draggedRow));
            return;
        }

        let droppedCard = draggedCard;
        const payload = event.dataTransfer?.getData(DRAG_MIME_TYPE) || '';
        if (payload !== '') {
            try {
                const parsed = JSON.parse(payload);
                if (parsed && typeof parsed.name === 'string' && typeof parsed.cardId === 'string' && typeof parsed.imageUrl === 'string') {
                    droppedCard = {
                        name: parsed.name,
                        cardId: parsed.cardId,
                        imageUrl: parsed.imageUrl,
                        quantity: normalizeQuantity(parsed.quantity || '1'),
                    };
                }
            } catch (_error) {
                droppedCard = draggedCard;
            }
        }
        if (!droppedCard || droppedCard.name === '') {
            return;
        }
        const inserted = insertCardIntoSection(section, droppedCard, droppedCard.quantity || '1', beforeRow);
        announce(`${droppedCard.name} added to ${sectionLabel(section, sections().indexOf(section))}.`, inserted ? cardNameInput(inserted) : null);
    });
})();

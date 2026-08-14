(() => {
    const root = document.querySelector('[data-deck-editor]');
    const sectionsRoot = document.querySelector('[data-deck-sections]');
    const addSection = document.querySelector('[data-add-section]');
    const searchInput = document.querySelector('[data-card-search-input]');
    const searchResults = document.querySelector('[data-card-search-results]');
    if (!root || !sectionsRoot || !addSection || !searchInput || !searchResults) {
        return;
    }

    const SEARCH_DEBOUNCE_MS = 250;
    const DRAG_MIME_TYPE = 'application/x-admin-deck-card';
    let searchTimer = null;
    let currentRequest = 0;
    let searchController = null;
    let draggedCard = null;

    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const cardImage = (imageUrl, name) => imageUrl
        ? `<div data-card-image><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} card art" loading="lazy"></div>`
        : '<div data-card-image></div>';

    const hiddenCardFields = (sectionIndex, cardIndex, cardId = '', imageUrl = '') => `
        <input type="hidden" name="deck_sections[${sectionIndex}][cards][${cardIndex}][card_id]" value="${escapeHtml(cardId)}">
        <input type="hidden" name="deck_sections[${sectionIndex}][cards][${cardIndex}][image_url]" value="${escapeHtml(imageUrl)}">`;

    const cardRow = (sectionIndex, cardIndex, quantity = '', name = '', cardId = '', imageUrl = '') => `
        <div class="admin-form-row" data-card-row>
            ${cardImage(imageUrl, name)}
            <label>
                <span>Quantity</span>
                <input name="deck_sections[${sectionIndex}][cards][${cardIndex}][quantity]" value="${escapeHtml(quantity)}" inputmode="numeric" required>
            </label>
            <label>
                <span>Card</span>
                <input name="deck_sections[${sectionIndex}][cards][${cardIndex}][name]" value="${escapeHtml(name)}" required maxlength="255">
            </label>
            ${hiddenCardFields(sectionIndex, cardIndex, cardId, imageUrl)}
            <button type="button" data-remove-card>Remove card</button>
        </div>`;

    const sectionBlock = (sectionIndex) => `
        <div class="admin-deck-section" data-section data-section-index="${sectionIndex}" data-next-card="1">
            <label>
                <span>Section name</span>
                <input name="deck_sections[${sectionIndex}][name]" required maxlength="120">
            </label>
            <div data-card-list>${cardRow(sectionIndex, 0, '1', '', '', '')}</div>
            <button type="button" data-add-card>Add blank card row</button>
            <button type="button" data-remove-section>Remove section</button>
        </div>`;

    const normalizeQuantity = (value) => {
        const quantity = Number.parseInt(String(value), 10);
        if (!Number.isFinite(quantity) || quantity < 1) {
            return '1';
        }
        return String(Math.min(quantity, 999));
    };

    const sections = () => Array.from(sectionsRoot.querySelectorAll('[data-section]'))
        .filter((section) => section instanceof HTMLElement);

    const sectionLabel = (section, fallbackIndex) => {
        const input = section.querySelector('input[name$="[name]"]');
        const name = input instanceof HTMLInputElement ? input.value.trim() : '';
        return name !== '' ? name : `Section ${fallbackIndex + 1}`;
    };

    const sectionOptions = () => sections().map((section, index) => {
        const sectionIndex = section.dataset.sectionIndex || String(index);
        return `<option value="${escapeHtml(sectionIndex)}">${escapeHtml(sectionLabel(section, index))}</option>`;
    }).join('');

    const refreshSearchResultSectionOptions = () => {
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
    };

    const findSection = (sectionIndex) => sections()
        .find((section) => (section.dataset.sectionIndex || '') === sectionIndex) || sections()[0] || null;

    const cardFromResult = (result) => ({
        name: result.dataset.cardName || '',
        cardId: result.dataset.cardId || '',
        imageUrl: result.dataset.imageUrl || '',
    });

    const searchResultQuantity = (result) => {
        const input = result.querySelector('[data-add-quantity]');
        return normalizeQuantity(input instanceof HTMLInputElement ? input.value : '1');
    };

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
        return details.join(' - ');
    };

    const renderSearchResults = (cards, message = '') => {
        if (message !== '') {
            searchResults.innerHTML = `<p>${escapeHtml(message)}</p>`;
            return;
        }

        if (cards.length === 0) {
            searchResults.innerHTML = '<p>No cards found. Try a shorter name or another printing.</p>';
            return;
        }

        const options = sectionOptions();
        searchResults.innerHTML = cards.map((card, index) => `
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
                <div>
                    <label>
                        <span>Section</span>
                        <select data-add-section-select>${options}</select>
                    </label>
                    <label>
                        <span>Quantity</span>
                        <input type="number" min="1" max="999" step="1" value="1" data-add-quantity>
                    </label>
                    <button type="button" data-add-search-result>Add card to deck</button>
                </div>
            </article>`).join('');
    };

    const clearSearchResults = (message = 'Search for a card, then add it to a section or drag it into the list.') => {
        searchResults.innerHTML = `<p>${escapeHtml(message)}</p>`;
    };

    const insertCardIntoSection = (section, card, quantity = '1') => {
        const list = section.querySelector('[data-card-list]');
        if (!(list instanceof HTMLElement)) {
            return;
        }

        const sectionIndex = Number(section.dataset.sectionIndex || '0');
        const cardIndex = Number(section.dataset.nextCard || '0');
        list.insertAdjacentHTML('beforeend', cardRow(sectionIndex, cardIndex, normalizeQuantity(quantity), card.name, card.cardId, card.imageUrl));
        section.dataset.nextCard = String(cardIndex + 1);
    };

    const searchCards = async (query) => {
        const requestId = ++currentRequest;
        if (searchController) {
            searchController.abort();
        }
        searchController = new AbortController();
        renderSearchResults([], 'Searching...');

        try {
            const response = await fetch(`/api/v1/magic/cards/search?q=${encodeURIComponent(query)}`, {
                headers: {
                    Accept: 'application/json',
                },
                signal: searchController.signal,
            });
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
            clearSearchResults('Card search is unavailable right now.');
        }
    };

    clearSearchResults();

    addSection.addEventListener('click', () => {
        const index = Number(sectionsRoot.dataset.nextSection || '0');
        sectionsRoot.insertAdjacentHTML('beforeend', sectionBlock(index));
        sectionsRoot.dataset.nextSection = String(index + 1);
        refreshSearchResultSectionOptions();
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
            clearSearchResults();
            return;
        }

        searchTimer = window.setTimeout(() => {
            searchCards(query);
        }, SEARCH_DEBOUNCE_MS);
    });

    root.addEventListener('input', (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.matches('[name$="[name]"]')) {
            refreshSearchResultSectionOptions();
        }
    });

    root.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const addResultButton = target.closest('[data-add-search-result]');
        if (addResultButton instanceof HTMLElement) {
            const result = addResultButton.closest('[data-search-result]');
            if (!(result instanceof HTMLElement)) {
                return;
            }
            const sectionSelect = result.querySelector('[data-add-section-select]');
            const sectionIndex = sectionSelect instanceof HTMLSelectElement ? sectionSelect.value : '';
            const section = findSection(sectionIndex);
            if (!(section instanceof HTMLElement)) {
                return;
            }
            insertCardIntoSection(section, cardFromResult(result), searchResultQuantity(result));
            return;
        }

        if (target.matches('[data-add-card]')) {
            const section = target.closest('[data-section]');
            if (!(section instanceof HTMLElement)) {
                return;
            }
            insertCardIntoSection(section, {
                name: '',
                cardId: '',
                imageUrl: '',
            });
        }

        if (target.matches('[data-remove-card]')) {
            target.closest('[data-card-row]')?.remove();
        }

        if (target.matches('[data-remove-section]')) {
            target.closest('[data-section]')?.remove();
            refreshSearchResultSectionOptions();
        }
    });

    root.addEventListener('dragstart', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.closest('button, input, select, textarea')) {
            return;
        }

        const result = target.closest('[data-search-result]');
        if (!(result instanceof HTMLElement)) {
            return;
        }

        draggedCard = {
            ...cardFromResult(result),
            quantity: searchResultQuantity(result),
        };

        if (event.dataTransfer && draggedCard.name !== '' && draggedCard.cardId !== '') {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(draggedCard));
            event.dataTransfer.setData('text/plain', draggedCard.name);
        }
    });

    root.addEventListener('dragend', () => {
        draggedCard = null;
    });

    root.addEventListener('dragover', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const list = target.closest('[data-card-list]');
        if (!(list instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    });

    root.addEventListener('drop', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const list = target.closest('[data-card-list]');
        const section = target.closest('[data-section]');
        if (!(list instanceof HTMLElement) || !(section instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();

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

        insertCardIntoSection(section, droppedCard, droppedCard.quantity || '1');
    });
})();

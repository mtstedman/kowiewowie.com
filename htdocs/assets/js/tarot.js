(() => {
    'use strict';

    const data = window.TarotData;
    const app = document.querySelector('[data-tarot-app]');

    if (!app) {
        return;
    }

    if (!data || !Array.isArray(data.TAROT_CARDS) || !Array.isArray(data.TAROT_SPREADS)) {
        const loadError = document.getElementById('tarot-load-error');

        if (loadError) {
            loadError.hidden = false;
        }

        return;
    }

    const CARDS = data.TAROT_CARDS;
    const SPREADS = data.TAROT_SPREADS;
    const SUITS = Array.isArray(data.TAROT_SUITS) ? data.TAROT_SUITS : [];
    const ORIENTATIONS = data.TAROT_ORIENTATIONS || {
        upright: { id: 'upright', label: 'Upright' },
        reversed: { id: 'reversed', label: 'Reversed' },
    };
    const CARD_BACK_IMAGE = data.CARD_BACK_IMAGE;

    const SUIT_GLYPHS = {
        major: '★',
        wands: '♣',
        cups: '♥',
        swords: '♠',
        pentacles: '♦',
    };
    const DEFAULT_GLYPH = '✦';

    const ROMAN_NUMERALS = [
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];

    /* ---------- helpers ---------- */

    const el = (tag, className, text) => {
        const node = document.createElement(tag);

        if (className) {
            node.className = className;
        }

        if (text !== undefined && text !== null) {
            node.textContent = String(text);
        }

        return node;
    };

    const toRoman = (value) => {
        if (value === 0) {
            return '0';
        }

        let remaining = value;
        let result = '';

        ROMAN_NUMERALS.forEach(([amount, numeral]) => {
            while (remaining >= amount) {
                result += numeral;
                remaining -= amount;
            }
        });

        return result;
    };

    const groupKeyFor = (card) => (card.arcana === 'major' ? 'major' : card.suit || 'minor');

    const glyphFor = (card) => SUIT_GLYPHS[groupKeyFor(card)] || DEFAULT_GLYPH;

    const suitNameFor = (suitId) => {
        const suit = SUITS.find((entry) => entry.id === suitId);

        return suit ? suit.name : suitId;
    };

    const arcanaLabelFor = (card) => (card.arcana === 'major' ? 'Major Arcana' : `${suitNameFor(card.suit)}, Minor Arcana`);

    const numberLabelFor = (card) => (card.arcana === 'major' ? toRoman(card.number) : String(card.number));

    const altTextFor = (card, reversed) => (
        `${card.name} tarot card (${arcanaLabelFor(card)})${reversed ? ', reversed' : ''}`
    );

    const orientationKey = (reversed) => (reversed ? 'reversed' : 'upright');

    const orientationLabel = (reversed) => {
        const frame = ORIENTATIONS[orientationKey(reversed)];

        return frame && frame.label ? frame.label : (reversed ? 'Reversed' : 'Upright');
    };

    const randomIndex = (limit) => {
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            const buffer = new Uint32Array(1);
            const ceiling = Math.floor(0x100000000 / limit) * limit;
            let value;

            do {
                window.crypto.getRandomValues(buffer);
                value = buffer[0];
            } while (value >= ceiling);

            return value % limit;
        }

        return Math.floor(Math.random() * limit);
    };

    const shuffled = (items) => {
        const deck = items.slice();

        for (let index = deck.length - 1; index > 0; index -= 1) {
            const swap = randomIndex(index + 1);
            [deck[index], deck[swap]] = [deck[swap], deck[index]];
        }

        return deck;
    };

    const meaningFor = (card, spread, position, reversed) => {
        if (typeof data.tarotMeaningFor !== 'function') {
            return reversed ? card.reversedMeaning : card.uprightMeaning;
        }

        return data.tarotMeaningFor(card.slug, spread.id, position.id, orientationKey(reversed))
            || (reversed ? card.reversedMeaning : card.uprightMeaning);
    };

    /**
     * Builds a card face: the data-driven image with a styled fallback that
     * takes over (name + suit glyph) if the art is missing or fails to load.
     */
    const createCardFace = (card, options = {}) => {
        const reversed = Boolean(options.reversed);
        const face = el('span', 'tarot-card-face');
        face.dataset.group = groupKeyFor(card);

        const fallback = el('span', 'tarot-card-fallback');
        fallback.setAttribute('aria-hidden', 'true');
        fallback.append(
            el('span', 'tarot-card-fallback-number', numberLabelFor(card)),
            el('span', 'tarot-card-fallback-glyph', glyphFor(card)),
            el('span', 'tarot-card-fallback-name', card.name),
        );
        face.append(fallback);

        const image = document.createElement('img');
        image.className = 'tarot-card-image';
        image.alt = altTextFor(card, reversed);
        image.decoding = 'async';

        if (options.lazy !== false) {
            image.loading = 'lazy';
        }

        image.addEventListener('error', () => {
            face.classList.add('is-fallback');
            fallback.removeAttribute('aria-hidden');
            fallback.setAttribute('role', 'img');
            fallback.setAttribute('aria-label', image.alt);
            image.remove();
        }, { once: true });
        image.addEventListener('load', () => {
            face.classList.add('is-loaded');
        }, { once: true });

        image.src = card.image;
        face.append(image);

        return face;
    };

    const createCardBack = () => {
        const back = el('span', 'tarot-card-back');
        back.setAttribute('aria-hidden', 'true');
        back.append(el('span', 'tarot-card-back-glyph', DEFAULT_GLYPH));

        if (CARD_BACK_IMAGE) {
            const image = document.createElement('img');
            image.className = 'tarot-card-back-image';
            image.alt = '';
            image.decoding = 'async';
            image.addEventListener('error', () => {
                image.remove();
            }, { once: true });
            image.src = CARD_BACK_IMAGE;
            back.append(image);
        }

        return back;
    };

    const renderKeywords = (list, keywords) => {
        list.replaceChildren(...(keywords || []).map((keyword) => el('li', null, keyword)));
    };

    /* ---------- card groups ---------- */

    const groups = [
        {
            id: 'major',
            name: 'Major Arcana',
            cards: CARDS.filter((card) => card.arcana === 'major'),
        },
        ...SUITS.map((suit) => ({
            id: suit.id,
            name: suit.name,
            element: suit.element,
            cards: CARDS.filter((card) => card.arcana !== 'major' && card.suit === suit.id),
        })),
    ];

    const groupedSlugs = new Set(groups.flatMap((group) => group.cards.map((card) => card.slug)));
    const ungrouped = CARDS.filter((card) => !groupedSlugs.has(card.slug));

    if (ungrouped.length > 0) {
        groups.push({ id: 'other', name: 'Other cards', cards: ungrouped });
    }

    const findCard = (slug) => (typeof data.getCard === 'function'
        ? data.getCard(slug)
        : CARDS.find((card) => card.slug === slug) || null);

    const findSpread = (spreadId) => (typeof data.getSpread === 'function'
        ? data.getSpread(spreadId)
        : SPREADS.find((spread) => spread.id === spreadId) || null);

    /* ---------- meaning map explorer ---------- */

    const mapForm = document.getElementById('tarot-map-form');
    const mapCardSelect = document.getElementById('tarot-map-card');
    const mapSpreadSelect = document.getElementById('tarot-map-spread');
    const mapPositionSelect = document.getElementById('tarot-map-position');
    const mapOrientationGroup = document.getElementById('tarot-map-orientation');
    const mapPreview = document.getElementById('tarot-map-card-preview');
    const mapResultTitle = document.getElementById('tarot-map-result-title');
    const mapKeywords = document.getElementById('tarot-map-keywords');
    const mapMeaning = document.getElementById('tarot-map-meaning');

    const populatePositions = () => {
        const spread = findSpread(mapSpreadSelect.value);
        const previous = mapPositionSelect.value;
        const positions = spread ? spread.positions : [];

        mapPositionSelect.replaceChildren(...positions.map((position, index) => {
            const option = el('option', null, `${index + 1}. ${position.name}`);
            option.value = position.id;
            return option;
        }));

        if (positions.some((position) => position.id === previous)) {
            mapPositionSelect.value = previous;
        }
    };

    const selectedOrientationReversed = () => {
        const checked = mapOrientationGroup.querySelector('input[name="orientation"]:checked');

        return Boolean(checked && checked.value === 'reversed');
    };

    const renderMeaningMap = () => {
        const card = findCard(mapCardSelect.value);
        const spread = findSpread(mapSpreadSelect.value);
        const position = spread
            ? spread.positions.find((entry) => entry.id === mapPositionSelect.value) || null
            : null;

        if (!card || !spread || !position) {
            mapPreview.replaceChildren();
            mapResultTitle.textContent = '';
            renderKeywords(mapKeywords, []);
            mapMeaning.textContent = 'Choose a card, spread, and position to see its meaning.';
            return;
        }

        const reversed = selectedOrientationReversed();
        const frame = el('span', `tarot-card tarot-card-static${reversed ? ' is-reversed' : ''}`);
        frame.append(createCardFace(card, { reversed, lazy: false }));
        mapPreview.replaceChildren(frame);

        mapResultTitle.textContent = `${card.name} · ${position.name} · ${orientationLabel(reversed)}`;
        renderKeywords(mapKeywords, card.keywords);
        mapMeaning.textContent = meaningFor(card, spread, position, reversed);
    };

    const setupMeaningMap = () => {
        groups.forEach((group) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.name;
            group.cards.forEach((card) => {
                const option = el('option', null, card.name);
                option.value = card.slug;
                optgroup.append(option);
            });
            mapCardSelect.append(optgroup);
        });

        SPREADS.forEach((spread) => {
            const option = el('option', null, spread.name);
            option.value = spread.id;
            mapSpreadSelect.append(option);
        });

        ['upright', 'reversed'].forEach((key, index) => {
            const label = el('label', 'tarot-orientation-option');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'orientation';
            input.value = key;
            input.checked = index === 0;
            label.append(input, el('span', null, orientationLabel(key === 'reversed')));
            mapOrientationGroup.append(label);
        });

        populatePositions();

        mapForm.addEventListener('submit', (event) => {
            event.preventDefault();
        });
        mapSpreadSelect.addEventListener('change', () => {
            populatePositions();
            renderMeaningMap();
        });
        mapCardSelect.addEventListener('change', renderMeaningMap);
        mapPositionSelect.addEventListener('change', renderMeaningMap);
        mapOrientationGroup.addEventListener('change', renderMeaningMap);

        renderMeaningMap();
    };

    const showInMeaningMap = (slug) => {
        if (!findCard(slug)) {
            return;
        }

        mapCardSelect.value = slug;
        renderMeaningMap();

        const heading = document.getElementById('tarot-map-title');

        if (heading) {
            heading.scrollIntoView({ block: 'start' });
        }

        mapCardSelect.focus({ preventScroll: true });
    };

    /* ---------- deck gallery + detail dialog ---------- */

    const galleryRoot = document.getElementById('tarot-gallery-groups');
    const dialog = document.getElementById('tarot-card-dialog');
    const dialogCard = document.getElementById('tarot-dialog-card');
    const dialogEyebrow = document.getElementById('tarot-dialog-eyebrow');
    const dialogTitle = document.getElementById('tarot-dialog-title');
    const dialogKeywords = document.getElementById('tarot-dialog-keywords');
    const dialogUpright = document.getElementById('tarot-dialog-upright');
    const dialogReversed = document.getElementById('tarot-dialog-reversed');
    const dialogClose = document.getElementById('tarot-dialog-close');
    const dialogMapButton = document.getElementById('tarot-dialog-map-button');
    let dialogSlug = null;
    let dialogReturnFocus = null;

    const closeDialog = () => {
        if (typeof dialog.close === 'function') {
            if (dialog.open) {
                dialog.close();
            }
        } else {
            dialog.removeAttribute('open');
            dialog.dispatchEvent(new Event('close'));
        }
    };

    const openCardDetail = (card, trigger) => {
        dialogSlug = card.slug;
        dialogReturnFocus = trigger || null;

        const frame = el('span', 'tarot-card tarot-card-static tarot-card-large');
        frame.append(createCardFace(card, { lazy: false }));
        dialogCard.replaceChildren(frame);

        const elementNote = card.arcana === 'major'
            ? `Major Arcana ${numberLabelFor(card)}`
            : `${suitNameFor(card.suit)} · ${card.number} of 14`;
        dialogEyebrow.textContent = elementNote;
        dialogTitle.textContent = card.name;
        renderKeywords(dialogKeywords, card.keywords);
        dialogUpright.textContent = card.uprightMeaning;
        dialogReversed.textContent = card.reversedMeaning;

        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) {
                dialog.showModal();
            }
        } else {
            dialog.setAttribute('open', '');
        }

        dialogClose.focus();
    };

    const setupGallery = () => {
        const fragment = document.createDocumentFragment();

        groups.forEach((group) => {
            const section = el('section', 'tarot-gallery-group');
            const headingId = `tarot-group-${group.id}`;
            section.dataset.group = group.id;
            section.setAttribute('aria-labelledby', headingId);

            const heading = el('h3', 'tarot-gallery-group-title');
            heading.id = headingId;
            heading.append(
                el('span', 'tarot-gallery-group-glyph', SUIT_GLYPHS[group.id] || DEFAULT_GLYPH),
                el('span', null, group.name),
                el('span', 'tarot-gallery-group-count', `${group.cards.length} cards${group.element ? ` · ${group.element}` : ''}`),
            );
            heading.firstChild.setAttribute('aria-hidden', 'true');

            const list = el('ul', 'tarot-gallery-grid');

            group.cards.forEach((card) => {
                const item = el('li', 'tarot-gallery-item');
                const button = el('button', 'tarot-gallery-card');
                button.type = 'button';
                button.dataset.slug = card.slug;

                const frame = el('span', 'tarot-card tarot-card-static');
                frame.append(createCardFace(card));
                button.append(frame, el('span', 'tarot-gallery-card-name', card.name));
                item.append(button);
                list.append(item);
            });

            section.append(heading, list);
            fragment.append(section);
        });

        galleryRoot.replaceChildren(fragment);

        galleryRoot.addEventListener('click', (event) => {
            const button = event.target.closest('.tarot-gallery-card');

            if (!button) {
                return;
            }

            const card = findCard(button.dataset.slug);

            if (card) {
                openCardDetail(card, button);
            }
        });

        dialogClose.addEventListener('click', closeDialog);
        dialogMapButton.addEventListener('click', () => {
            const slug = dialogSlug;
            dialogReturnFocus = null;
            closeDialog();
            showInMeaningMap(slug);
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                closeDialog();
            }
        });
        dialog.addEventListener('close', () => {
            if (dialogReturnFocus && document.contains(dialogReturnFocus)) {
                dialogReturnFocus.focus();
            }

            dialogReturnFocus = null;
        });
    };

    /* ---------- spreads / dealing ---------- */

    const spreadOptionsRoot = document.getElementById('tarot-spread-options');
    const spreadDescription = document.getElementById('tarot-spread-description');
    const dealButton = document.getElementById('tarot-deal-button');
    const revealAllButton = document.getElementById('tarot-reveal-all-button');
    const dealStatus = document.getElementById('tarot-deal-status');
    const board = document.getElementById('tarot-board');
    const readingsList = document.getElementById('tarot-readings-list');

    const state = {
        spreadId: SPREADS.length > 0 ? SPREADS[0].id : null,
        deal: [],
    };

    const currentSpread = () => findSpread(state.spreadId);

    const layoutSlot = (slot, position, index) => {
        const layout = position.layout || {};
        const row = Number(layout.row) || 1;
        const col = Number(layout.col) || index + 1;
        const rotate = Number(layout.rotate) || 0;

        slot.style.gridRow = String(row);
        slot.style.gridColumn = String(col);

        if (rotate !== 0) {
            slot.classList.add('is-crossing');
            slot.style.setProperty('--tarot-slot-rotate', `${rotate}deg`);
            slot.style.zIndex = String(2 + index);
        } else {
            slot.style.zIndex = '1';
        }
    };

    const applyBoardGrid = (spread) => {
        const rows = (spread.grid && Number(spread.grid.rows))
            || Math.max(1, ...spread.positions.map((position) => Number(position.layout && position.layout.row) || 1));
        const cols = (spread.grid && Number(spread.grid.cols))
            || Math.max(1, ...spread.positions.map((position, index) => Number(position.layout && position.layout.col) || index + 1));

        board.style.setProperty('--tarot-rows', String(rows));
        board.style.setProperty('--tarot-cols', String(cols));
        board.dataset.spread = spread.id;
        board.classList.toggle('has-crossing', spread.positions.some((position) => (
            position.layout && Number(position.layout.rotate)
        )));
    };

    const renderReadingItem = (item, entry, index) => {
        const { position, card, reversed, revealed } = entry;
        const spread = currentSpread();

        item.replaceChildren();
        item.classList.toggle('is-revealed', revealed);

        const header = el('div', 'tarot-reading-header');
        header.append(
            el('span', 'tarot-reading-number', index + 1),
            el('strong', 'tarot-reading-position', position.name),
        );
        item.append(header);

        if (!revealed) {
            item.append(el('p', 'tarot-reading-hidden', 'Face down — select the card on the table to reveal it.'));
            return;
        }

        const cardLine = el('p', 'tarot-reading-card');
        cardLine.append(
            el('span', null, card.name),
            el('span', `tarot-orientation-badge${reversed ? ' is-reversed' : ''}`, orientationLabel(reversed)),
        );
        item.append(cardLine, el('p', 'tarot-reading-meaning', meaningFor(card, spread, position, reversed)));
    };

    const updateRevealState = () => {
        const total = state.deal.length;
        const revealed = state.deal.filter((entry) => entry.revealed).length;

        revealAllButton.disabled = total === 0 || revealed === total;

        if (total === 0) {
            return;
        }

        dealStatus.textContent = revealed === total
            ? `All ${total} card${total === 1 ? '' : 's'} revealed.`
            : `${revealed} of ${total} card${total === 1 ? '' : 's'} revealed. Select a face-down card to turn it over.`;
    };

    const revealEntry = (index) => {
        const entry = state.deal[index];

        if (!entry || entry.revealed) {
            return;
        }

        entry.revealed = true;

        const slot = board.querySelector(`[data-slot-index="${index}"]`);

        if (slot) {
            slot.classList.add('is-revealed');
            slot.setAttribute('aria-pressed', 'true');
            slot.setAttribute(
                'aria-label',
                `Position ${index + 1}, ${entry.position.name}: ${entry.card.name}, ${orientationLabel(entry.reversed).toLowerCase()}`,
            );
        }

        const item = readingsList.children[index];

        if (item) {
            renderReadingItem(item, entry, index);
        }

        updateRevealState();
    };

    const renderEmptyBoard = (spread) => {
        applyBoardGrid(spread);
        board.replaceChildren(...spread.positions.map((position, index) => {
            const slot = el('div', 'tarot-slot tarot-slot-empty');
            layoutSlot(slot, position, index);
            slot.append(el('span', 'tarot-slot-number', index + 1));
            slot.title = position.name;
            return slot;
        }));

        readingsList.replaceChildren(...spread.positions.map((position, index) => {
            const item = el('li', 'tarot-reading');
            const header = el('div', 'tarot-reading-header');
            header.append(
                el('span', 'tarot-reading-number', index + 1),
                el('strong', 'tarot-reading-position', position.name),
            );
            item.append(header, el('p', 'tarot-reading-hidden', position.positionMeaning));
            return item;
        }));
    };

    const selectSpread = (spreadId) => {
        const spread = findSpread(spreadId);

        if (!spread) {
            return;
        }

        state.spreadId = spread.id;
        state.deal = [];
        spreadDescription.textContent = `${spread.description} (${spread.positions.length} card${spread.positions.length === 1 ? '' : 's'})`;
        renderEmptyBoard(spread);
        revealAllButton.disabled = true;
        dealStatus.textContent = `${spread.name} selected. Shuffle and deal to lay the cards face-down.`;
    };

    const deal = () => {
        const spread = currentSpread();

        if (!spread) {
            return;
        }

        const deck = shuffled(CARDS);

        state.deal = spread.positions.map((position, index) => ({
            position,
            card: deck[index],
            reversed: randomIndex(2) === 1,
            revealed: false,
        }));

        applyBoardGrid(spread);
        board.replaceChildren(...state.deal.map((entry, index) => {
            const slot = el('button', 'tarot-slot tarot-card-flip');
            slot.type = 'button';
            slot.dataset.slotIndex = String(index);
            slot.setAttribute('aria-pressed', 'false');
            slot.setAttribute('aria-label', `Position ${index + 1}, ${entry.position.name}: face down. Select to reveal.`);
            slot.title = entry.position.name;
            slot.style.setProperty('--tarot-deal-delay', `${index * 70}ms`);
            layoutSlot(slot, entry.position, index);

            const inner = el('span', 'tarot-card-inner');
            const back = createCardBack();
            const front = el('span', `tarot-card-front${entry.reversed ? ' is-reversed' : ''}`);
            const footer = el('span', 'tarot-card-footer', entry.card.name);
            footer.setAttribute('aria-hidden', 'true');
            front.append(createCardFace(entry.card, { reversed: entry.reversed, lazy: false }), footer);
            inner.append(back, front);

            slot.append(inner, el('span', 'tarot-slot-number', index + 1));
            return slot;
        }));

        readingsList.replaceChildren(...state.deal.map((entry, index) => {
            const item = el('li', 'tarot-reading');
            renderReadingItem(item, entry, index);
            return item;
        }));

        dealButton.textContent = 'Shuffle & deal again';
        dealStatus.textContent = `Dealt ${state.deal.length} card${state.deal.length === 1 ? '' : 's'} face-down for ${spread.name}.`;
        updateRevealState();
    };

    const setupSpreads = () => {
        SPREADS.forEach((spread, index) => {
            const label = el('label', 'tarot-spread-option');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'tarot-spread';
            input.value = spread.id;
            input.checked = index === 0;

            const text = el('span', 'tarot-spread-option-text');
            text.append(
                el('strong', null, spread.name),
                el('span', null, `${spread.positions.length} card${spread.positions.length === 1 ? '' : 's'}`),
            );
            label.append(input, text);
            spreadOptionsRoot.append(label);
        });

        spreadOptionsRoot.addEventListener('change', (event) => {
            if (event.target && event.target.name === 'tarot-spread') {
                selectSpread(event.target.value);
            }
        });

        board.addEventListener('click', (event) => {
            const slot = event.target.closest('.tarot-card-flip');

            if (slot && board.contains(slot)) {
                revealEntry(Number(slot.dataset.slotIndex));
            }
        });

        dealButton.addEventListener('click', deal);
        revealAllButton.addEventListener('click', () => {
            state.deal.forEach((entry, index) => {
                revealEntry(index);
            });
        });

        if (state.spreadId) {
            selectSpread(state.spreadId);
        } else {
            dealButton.disabled = true;
            dealStatus.textContent = 'No spreads are available.';
        }
    };

    setupGallery();
    setupSpreads();
    setupMeaningMap();
})();

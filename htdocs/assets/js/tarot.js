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

    /* ---------- view tabs (dealer / deck / meaning map) ---------- */

    const tabList = app.querySelector('[data-tarot-tabs]');
    const tabs = tabList ? Array.from(tabList.querySelectorAll('[role="tab"]')) : [];

    const panelForTab = (tab) => document.getElementById(tab.getAttribute('aria-controls') || '');

    const activateTab = (tab, moveFocus) => {
        if (!tab || !tabs.includes(tab)) {
            return;
        }

        tabs.forEach((entry) => {
            const selected = entry === tab;
            const panel = panelForTab(entry);

            entry.setAttribute('aria-selected', selected ? 'true' : 'false');
            entry.tabIndex = selected ? 0 : -1;

            if (panel) {
                panel.hidden = !selected;
            }
        });

        if (moveFocus) {
            tab.focus();
        }
    };

    const activateTabContaining = (node) => {
        const panel = node ? node.closest('[role="tabpanel"]') : null;

        if (!panel) {
            return;
        }

        activateTab(tabs.find((tab) => panelForTab(tab) === panel), false);
    };

    const setupTabs = () => {
        if (!tabList || tabs.length === 0) {
            return;
        }

        tabList.addEventListener('click', (event) => {
            const tab = event.target.closest('[role="tab"]');

            if (tab) {
                activateTab(tab, false);
            }
        });

        tabList.addEventListener('keydown', (event) => {
            const current = event.target.closest('[role="tab"]');
            const index = tabs.indexOf(current);

            if (index === -1) {
                return;
            }

            let next = null;

            switch (event.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                    next = tabs[(index + 1) % tabs.length];
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    next = tabs[(index - 1 + tabs.length) % tabs.length];
                    break;
                case 'Home':
                    next = tabs[0];
                    break;
                case 'End':
                    next = tabs[tabs.length - 1];
                    break;
                default:
                    return;
            }

            event.preventDefault();
            activateTab(next, true);
        });
    };

    const showInMeaningMap = (slug) => {
        if (!findCard(slug)) {
            return;
        }

        mapCardSelect.value = slug;
        renderMeaningMap();

        const heading = document.getElementById('tarot-map-title');

        activateTabContaining(heading || mapCardSelect);

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
    const dealStatus = document.getElementById('tarot-deal-status');
    const board = document.getElementById('tarot-board');
    const readingsList = document.getElementById('tarot-readings-list');
    const fan = document.getElementById('tarot-fan');
    const modeOptionsRoot = document.getElementById('tarot-mode-options');
    const deckStage = document.getElementById('tarot-deck-stage');
    const deckStack = document.getElementById('tarot-deck-stack');
    const deckMeta = document.getElementById('tarot-deck-meta');
    const shuffleButton = document.getElementById('tarot-shuffle-button');
    const cutButton = document.getElementById('tarot-cut-button');
    const autoDealButton = document.getElementById('tarot-auto-deal-button');
    const spreadLayout = document.getElementById('tarot-spread-layout');
    const spreadControls = document.getElementById('tarot-spread-controls');
    const controlsToggle = document.getElementById('tarot-controls-toggle');

    /* Collapsing hides every setup control but keeps the deal status live region
       (a hidden live region is never announced) and the re-expand toggle. */
    const collapsibleControls = spreadControls
        ? Array.from(spreadControls.children).filter((node) => node !== dealStatus && node !== controlsToggle)
        : [];

    const setControlsCollapsed = (collapsed, { moveFocus = false } = {}) => {
        if (!spreadLayout || !spreadControls || !controlsToggle) {
            return;
        }

        const active = document.activeElement;
        const focusWasInControls = Boolean(active) && spreadControls.contains(active) && active !== controlsToggle;
        const focusWasOnToggle = active === controlsToggle;

        spreadLayout.classList.toggle('is-collapsed', collapsed);
        collapsibleControls.forEach((node) => {
            node.hidden = collapsed;
        });
        controlsToggle.hidden = !collapsed;
        controlsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

        if (collapsed && focusWasInControls) {
            controlsToggle.focus({ preventScroll: true });
        } else if (!collapsed && (moveFocus || focusWasOnToggle)) {
            dealButton.focus({ preventScroll: true });
        }
    };

    /* Deal modes: 'shuffle' (primary: shuffle/cut, then auto-deal) or 'fan' (pick card by card). */
    const DEAL_MODES = ['shuffle', 'fan'];
    const DECK_STACK_LAYERS = 7;
    const DECK_ANIMATION_MS = 760;

    /*
     * deal:     placed entries, in spread position order (index === position index).
     * deck:     the shuffled 78-card deck backing the face-down fan (empty until shuffled).
     * nextPick: index of the spread position the next picked card lands in.
     * mode:     'shuffle' (shuffle/cut stage, then auto-deal; the default) or 'fan' (pick card by card).
     * shuffles/cuts: how many times the deck on the shuffle stage has been shuffled or cut.
     */
    const state = {
        spreadId: SPREADS.length > 0 ? SPREADS[0].id : null,
        deal: [],
        deck: [],
        nextPick: 0,
        mode: 'shuffle',
        shuffles: 0,
        cuts: 0,
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

    /* Cards are turned over in deal order: the lowest-index face-down entry is next. */
    const nextRevealIndex = () => state.deal.findIndex((entry) => entry && !entry.revealed);

    /* Highlights the next card to reveal and marks every other face-down card as out of order. */
    const refreshRevealOrder = () => {
        const next = nextRevealIndex();

        board.querySelectorAll('.tarot-card-flip').forEach((slot) => {
            const index = Number(slot.dataset.slotIndex);
            const entry = state.deal[index];
            const faceDown = Boolean(entry) && !entry.revealed;
            const isNext = faceDown && index === next;
            const outOfOrder = faceDown && !isNext;

            slot.classList.toggle('is-next-reveal', isNext);
            slot.classList.toggle('is-out-of-order', outOfOrder);

            if (isNext) {
                slot.setAttribute('aria-current', 'step');
            } else {
                slot.removeAttribute('aria-current');
            }

            if (outOfOrder) {
                slot.setAttribute('aria-disabled', 'true');
            } else {
                slot.removeAttribute('aria-disabled');
            }
        });
    };

    const updateRevealState = () => {
        const spread = currentSpread();
        const total = state.deal.length;
        const revealed = state.deal.filter((entry) => entry.revealed).length;

        refreshRevealOrder();

        if (!spread || state.deck.length === 0) {
            return;
        }

        const slotCount = spread.positions.length;

        if (state.nextPick < slotCount) {
            const position = spread.positions[state.nextPick];
            dealStatus.textContent = `Pick a card for position ${state.nextPick + 1}: ${position.name}. `
                + `${total} of ${slotCount} placed.`;
            return;
        }

        const nextIndex = nextRevealIndex();
        const nextEntry = state.deal[nextIndex];
        const nextHint = nextEntry
            ? `Turn over position ${nextIndex + 1}: ${nextEntry.position.name} next.`
            : 'Select a face-down card to turn it over.';

        dealStatus.textContent = revealed === total
            ? `All ${total} card${total === 1 ? '' : 's'} revealed.`
            : `${revealed} of ${total} card${total === 1 ? '' : 's'} revealed. ${nextHint}`;
    };

    /*
     * Once a board card has finished turning over, mark it settled so the CSS drops
     * its 3D flip context and the card rests as flat 2D content (crossing cards
     * would otherwise stay warped/blurry). With no running flip transition (e.g.
     * prefers-reduced-motion), it settles immediately.
     */
    const settleWhenFlipped = (slot) => {
        const inner = slot.querySelector('.tarot-card-inner');
        const settle = () => {
            slot.classList.add('is-settled');
        };

        if (!inner) {
            settle();
            return;
        }

        if (typeof inner.getAnimations === 'function') {
            const flip = inner.getAnimations().find((animation) => animation.transitionProperty === 'transform');

            if (flip) {
                flip.finished.then(settle, settle);
            } else {
                settle();
            }

            return;
        }

        const onFlipEnd = (event) => {
            if (event.target === inner && event.propertyName === 'transform') {
                inner.removeEventListener('transitionend', onFlipEnd);
                settle();
            }
        };

        inner.addEventListener('transitionend', onFlipEnd);
    };

    const revealEntry = (index) => {
        const entry = state.deal[index];

        // Out-of-order flips are blocked: only the lowest-index face-down card may turn over.
        // Nothing turns over while a paced deal is still laying cards down.
        if (isDealing || !entry || entry.revealed || index !== nextRevealIndex()) {
            return false;
        }

        entry.revealed = true;

        const slot = board.querySelector(`[data-slot-index="${index}"]`);

        if (slot) {
            slot.classList.add('is-revealed');
            settleWhenFlipped(slot);
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
        return true;
    };

    /* ---------- hero reveal dialog (single reveals once the spread is filled) ---------- */

    const heroDialog = document.getElementById('tarot-reading-dialog');
    const heroCard = document.getElementById('tarot-reveal-card');
    const heroEyebrow = document.getElementById('tarot-reveal-eyebrow');
    const heroName = document.getElementById('tarot-reveal-name');
    const heroOrientation = document.getElementById('tarot-reveal-orientation');
    const heroPositionLabel = document.getElementById('tarot-reveal-position-label');
    const heroPosition = document.getElementById('tarot-reveal-position');
    const heroInterpretation = document.getElementById('tarot-reveal-interpretation');
    const heroClose = document.getElementById('tarot-reveal-close');
    let heroReturnFocus = null;

    const isDealComplete = () => {
        const spread = currentSpread();

        return Boolean(spread) && spread.positions.length > 0 && state.nextPick >= spread.positions.length;
    };

    const closeReadingHero = () => {
        if (typeof heroDialog.close === 'function') {
            if (heroDialog.open) {
                heroDialog.close();
            }
        } else {
            heroDialog.removeAttribute('open');
            heroDialog.dispatchEvent(new Event('close'));
        }
    };

    const openReadingHero = (index) => {
        const entry = state.deal[index];
        const spread = currentSpread();

        if (!heroDialog || !entry || !spread || heroDialog.hasAttribute('open')) {
            return;
        }

        const { position, card, reversed } = entry;
        heroReturnFocus = board.querySelector(`[data-slot-index="${index}"]`);

        const frame = el('span', `tarot-card tarot-card-static tarot-card-large tarot-reveal-card-frame${reversed ? ' is-reversed' : ''}`);
        frame.append(createCardFace(card, { reversed, lazy: false }));
        heroCard.replaceChildren(frame);

        heroEyebrow.textContent = `${spread.name} · Position ${index + 1}`;
        heroName.textContent = card.name;
        heroOrientation.textContent = orientationLabel(reversed);
        heroOrientation.classList.toggle('is-reversed', reversed);
        heroPositionLabel.textContent = `Position: ${position.name}`;
        heroPosition.textContent = position.positionMeaning || '';
        heroInterpretation.textContent = meaningFor(card, spread, position, reversed);

        if (typeof heroDialog.showModal === 'function') {
            if (!heroDialog.open) {
                heroDialog.showModal();
            }
        } else {
            heroDialog.setAttribute('open', '');
        }

        heroClose.focus();
    };

    const renderEmptyBoard = (spread) => {
        applyBoardGrid(spread);
        board.replaceChildren(...spread.positions.map((position, index) => {
            const slot = el('div', 'tarot-slot tarot-slot-empty');
            slot.dataset.slotIndex = String(index);
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

    /* Marks the next unfilled spot (traditional positions[] order) as the pick target. */
    const highlightNextSlot = () => {
        board.querySelectorAll('.tarot-slot.is-next').forEach((slot) => {
            slot.classList.remove('is-next');
            slot.removeAttribute('aria-current');
        });

        const spread = currentSpread();

        if (!spread || state.deck.length === 0 || state.nextPick >= spread.positions.length) {
            return;
        }

        const slot = board.querySelector(`.tarot-slot-empty[data-slot-index="${state.nextPick}"]`);

        if (slot) {
            slot.classList.add('is-next');
            slot.setAttribute('aria-current', 'step');
        }
    };

    const clearFan = () => {
        fan.replaceChildren();
        fan.hidden = true;
    };

    const labelFanCards = () => {
        const spread = currentSpread();
        const position = spread ? spread.positions[state.nextPick] : null;
        const total = state.deck.length;

        fan.querySelectorAll('.tarot-fan-card').forEach((button) => {
            const number = Number(button.dataset.deckIndex) + 1;
            button.setAttribute('aria-label', position
                ? `Face-down card ${number} of ${total} — pick to place in Position ${state.nextPick + 1}, ${position.name}`
                : `Face-down card ${number} of ${total}`);
        });
    };

    /* Fans the shuffled deck out face-down: card backs only, no faces are built here. */
    const renderFan = () => {
        const count = state.deck.length;

        fan.replaceChildren(...state.deck.map((card, index) => {
            const button = el('button', 'tarot-fan-card');
            button.type = 'button';
            button.dataset.deckIndex = String(index);
            button.style.setProperty('--tarot-fan-t', count > 1 ? (index / (count - 1) - 0.5).toFixed(4) : '0');
            button.style.setProperty('--tarot-fan-delay', `${index * 6}ms`);
            button.append(createCardBack());
            return button;
        }));

        fan.hidden = count === 0;
        labelFanCards();
    };

    /* A placed, face-down board card; the front face is built only now, at placement. */
    const createPlacedSlot = (entry, index) => {
        const slot = el('button', 'tarot-slot tarot-card-flip');
        slot.type = 'button';
        slot.dataset.slotIndex = String(index);
        slot.setAttribute('aria-pressed', 'false');
        slot.setAttribute('aria-label', `Position ${index + 1}, ${entry.position.name}: face down. Select to reveal.`);
        slot.title = entry.position.name;
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
    };

    const prefersReducedMotion = () => typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* Aims a placed card's lay-down animation so it travels from sourceRect into targetRect. */
    const aimLayDown = (slot, sourceRect, targetRect) => {
        const dx = (sourceRect.left + sourceRect.width / 2) - (targetRect.left + targetRect.width / 2);
        const dy = (sourceRect.top + sourceRect.height / 2) - (targetRect.top + targetRect.height / 2);
        // Tilt the card a little with its sideways travel, as if carried across by hand.
        const tilt = Math.max(-14, Math.min(14, dx / 30));

        slot.style.setProperty('--tarot-deal-from-x', `${Math.round(dx)}px`);
        slot.style.setProperty('--tarot-deal-from-y', `${Math.round(dy)}px`);
        slot.style.setProperty('--tarot-deal-tilt', `${tilt.toFixed(1)}deg`);
        slot.classList.add('is-dealing');
        // Carry the card above everything already on the table while it travels.
        slot.style.zIndex = '30';
    };

    /* Runs done once the slot's lay-down animation ends (at once when it doesn't run). */
    const whenLaidDown = (slot, done) => {
        if (typeof slot.getAnimations === 'function') {
            const lay = slot.getAnimations().find((animation) => animation.animationName === 'tarot-deal-lay');

            if (lay) {
                lay.finished.then(done, done);
            } else {
                done();
            }

            return;
        }

        window.setTimeout(done, DEAL_LAY_MS);
    };

    /*
     * Lays a face-down card into its board spot. With a sourceRect it visibly travels
     * from there (the deck, the fan, or the table edge) and settles; onLanded runs
     * once it rests. Without motion it lands immediately.
     */
    const placeSlot = (entry, index, sourceRect, onLanded) => {
        const slot = createPlacedSlot(entry, index);
        const restingZ = slot.style.zIndex;
        const emptySlot = board.querySelector(`[data-slot-index="${index}"]`);
        const animate = Boolean(sourceRect && emptySlot) && !prefersReducedMotion();

        if (animate) {
            aimLayDown(slot, sourceRect, emptySlot.getBoundingClientRect());
        }

        if (emptySlot) {
            emptySlot.replaceWith(slot);
        } else {
            board.append(slot);
        }

        const item = readingsList.children[index];

        if (item) {
            renderReadingItem(item, entry, index);
        }

        const landed = () => {
            slot.classList.remove('is-dealing');
            slot.style.zIndex = restingZ;
            DEAL_FLIGHT_PROPS.forEach((property) => {
                slot.style.removeProperty(property);
            });

            if (onLanded) {
                onLanded();
            }
        };

        if (animate) {
            whenLaidDown(slot, landed);
        } else {
            landed();
        }

        return slot;
    };

    /* ---------- shuffle & cut deck stage (primary deal mode) ---------- */

    let deckAnimationTimer = 0;

    /* Shuffle loop: reshuffle every 2-3 seconds until the user presses Stop or the deck stage closes. */
    const SHUFFLE_LOOP_MIN_MS = 2000;
    const SHUFFLE_LOOP_MAX_MS = 3000;
    let shuffleLoopTimer = 0;
    let isShuffleLooping = false;

    /*
     * Paced deal: one card is laid per DEAL_STEP_MS in spread position order.
     * isDealing locks the controls; dealRun invalidates a cancelled sequence.
     */
    const DEAL_STEP_MS = 640;
    const DEAL_LAY_MS = 560;
    const DEAL_FLIGHT_PROPS = ['--tarot-deal-from-x', '--tarot-deal-from-y', '--tarot-deal-tilt'];
    let isDealing = false;
    let dealTimer = 0;
    let dealRun = 0;
    let shuffleLoopCount = 0;

    const stopDeckAnimation = () => {
        window.clearTimeout(deckAnimationTimer);
        deckAnimationTimer = 0;

        if (deckStack) {
            deckStack.classList.remove('is-shuffling', 'is-cutting');
        }
    };

    /* Restarts the named animation even when it is triggered again mid-play. */
    const playDeckAnimation = (className) => {
        if (!deckStack) {
            return;
        }

        stopDeckAnimation();
        void deckStack.offsetWidth;
        deckStack.classList.add(className);
        deckAnimationTimer = window.setTimeout(stopDeckAnimation, DECK_ANIMATION_MS);
    };

    const renderDeckStack = () => {
        if (!deckStack) {
            return;
        }

        const topPacketStart = Math.ceil(DECK_STACK_LAYERS / 2);

        deckStack.replaceChildren(...Array.from({ length: DECK_STACK_LAYERS }, (unused, layer) => {
            const card = el('span', 'tarot-deck-card');
            card.dataset.packet = layer >= topPacketStart ? 'top' : 'bottom';
            card.style.setProperty('--tarot-stack-i', String(layer));
            card.append(createCardBack());
            return card;
        }));
    };

    const updateDeckMeta = () => {
        const spread = currentSpread();
        const count = spread ? spread.positions.length : 0;

        if (deckMeta) {
            deckMeta.textContent = `${state.deck.length} cards · shuffled ${state.shuffles} `
                + `time${state.shuffles === 1 ? '' : 's'} · cut ${state.cuts} time${state.cuts === 1 ? '' : 's'}`;
        }

        if (autoDealButton) {
            autoDealButton.textContent = `Deal ${count} card${count === 1 ? '' : 's'}`;
            autoDealButton.disabled = isDealing || isShuffleLooping || count === 0 || state.deck.length < count;
        }
    };

    /* While the shuffle loop runs, the Shuffle button becomes Stop and Cut/Deal wait until it stops. */
    const setShuffleControl = (looping) => {
        if (shuffleButton) {
            shuffleButton.textContent = looping ? 'Stop' : 'Shuffle';
            shuffleButton.classList.toggle('is-looping', looping);

            if (looping) {
                shuffleButton.setAttribute('aria-label', 'Stop shuffling');
            } else {
                shuffleButton.removeAttribute('aria-label');
            }
        }

        if (cutButton) {
            cutButton.disabled = looping;
        }
    };

    const stopShuffleLoop = (announce) => {
        window.clearTimeout(shuffleLoopTimer);
        shuffleLoopTimer = 0;

        if (!isShuffleLooping) {
            return;
        }

        isShuffleLooping = false;
        stopDeckAnimation();
        setShuffleControl(false);
        updateDeckMeta();

        if (announce) {
            dealStatus.textContent = `Stopped shuffling after ${shuffleLoopCount} shuffle${shuffleLoopCount === 1 ? '' : 's'} `
                + `(${state.shuffles} so far). Cut if you like, or deal when it feels right.`;
        }
    };

    const showDeckStage = () => {
        if (!deckStage) {
            return;
        }

        renderDeckStack();
        updateDeckMeta();
        deckStage.hidden = false;
    };

    /* Locks every control that could re-enter or corrupt a paced deal while it runs. */
    const setDealLocked = (locked) => {
        isDealing = locked;
        dealButton.disabled = locked;

        [spreadOptionsRoot, modeOptionsRoot].forEach((root) => {
            if (root) {
                root.querySelectorAll('input').forEach((input) => {
                    input.disabled = locked;
                });
            }
        });

        [shuffleButton, cutButton].forEach((button) => {
            if (button) {
                button.disabled = locked;
            }
        });

        board.setAttribute('aria-busy', locked ? 'true' : 'false');
        updateDeckMeta();
    };

    const cancelDealSequence = () => {
        dealRun += 1;
        window.clearTimeout(dealTimer);
        dealTimer = 0;

        if (isDealing) {
            setDealLocked(false);
        }
    };

    /* Where dealt cards come from: the deck on the stage, else the near edge of the table. */
    const dealSourceRect = () => {
        if (deckStack && deckStage && !deckStage.hidden) {
            const rect = deckStack.getBoundingClientRect();

            if (rect.width > 0 && rect.height > 0) {
                return rect;
            }
        }

        const boardRect = board.getBoundingClientRect();
        return {
            left: boardRect.left + boardRect.width / 2,
            top: boardRect.bottom + 48,
            width: 0,
            height: 0,
        };
    };

    const hideDeckStage = () => {
        stopShuffleLoop(false);
        stopDeckAnimation();

        if (deckStage) {
            deckStage.hidden = true;
        }
    };

    const resetTable = (spread) => {
        cancelDealSequence();
        state.deal = [];
        state.deck = [];
        state.nextPick = 0;
        state.shuffles = 0;
        state.cuts = 0;
        clearFan();
        hideDeckStage();
        renderEmptyBoard(spread);
    };

    const selectSpread = (spreadId) => {
        const spread = findSpread(spreadId);

        if (!spread) {
            return;
        }

        state.spreadId = spread.id;
        spreadDescription.textContent = `${spread.description} (${spread.positions.length} card${spread.positions.length === 1 ? '' : 's'})`;

        // Both modes start from the empty layout preview; clicking "Shuffle & deal" starts the draw.
        setControlsCollapsed(false);
        resetTable(spread);
        dealButton.textContent = 'Shuffle & deal';
        dealStatus.textContent = state.mode === 'fan'
            ? `${spread.name} selected. Click Shuffle & deal to fan the deck out face-down, then pick a card for each spot.`
            : `${spread.name} selected. Click Shuffle & deal to set out a fresh face-down deck, then shuffle, cut, and deal it into the spread.`;
    };

    /* Step 1: shuffle the full deck and fan it out; nothing is placed yet. */
    const deal = () => {
        const spread = currentSpread();

        if (!spread || isDealing) {
            return;
        }

        // Tuck the setup panel away so the card field takes the whole view.
        setControlsCollapsed(true);

        if (state.mode !== 'fan') {
            const tableInUse = state.deck.length > 0 || state.deal.length > 0;
            gatherDeck(tableInUse ? 'Table cleared.' : 'Deck gathered.');
            dealButton.textContent = 'Gather a fresh deck';
            return;
        }

        resetTable(spread);
        state.deck = shuffled(CARDS);
        renderFan();
        highlightNextSlot();

        dealButton.textContent = 'Shuffle & deal again';
        updateRevealState();
        dealStatus.textContent = `Shuffled ${state.deck.length} cards into a face-down fan. ${dealStatus.textContent}`;
    };

    /* Step 2: a picked fan card lands face-down in the highlighted spot. */
    const pickCard = (button) => {
        const spread = currentSpread();

        if (!spread || !fan.contains(button)) {
            return;
        }

        const index = state.nextPick;
        const position = spread.positions[index];
        const card = state.deck[Number(button.dataset.deckIndex)];

        if (!position || !card) {
            return;
        }

        const entry = {
            position,
            card,
            reversed: randomIndex(2) === 1,
            revealed: false,
        };

        state.deal.push(entry);
        state.nextPick = index + 1;

        const hadFocus = document.activeElement === button;
        const neighbor = button.nextElementSibling || button.previousElementSibling;
        // The card is laid down from where it was picked out of the fan.
        const sourceRect = button.getBoundingClientRect();
        button.remove();

        const complete = state.nextPick >= spread.positions.length;

        // Settle the fan first so the target spot is measured where it will rest.
        if (complete) {
            clearFan();
        } else {
            labelFanCards();
        }

        const slot = placeSlot(entry, index, sourceRect);

        highlightNextSlot();
        updateRevealState();

        if (hadFocus) {
            if (complete) {
                const firstHidden = board.querySelector('.tarot-card-flip:not(.is-revealed)') || slot;
                firstHidden.focus();
            } else if (neighbor && fan.contains(neighbor)) {
                neighbor.focus();
            }
        }
    };

    const isDeckStageActive = () => state.mode !== 'fan'
        && Boolean(deckStage)
        && !deckStage.hidden
        && state.deal.length === 0
        && state.deck.length > 0;

    /* Shuffle mode, step 1: clear the table and set a fresh face-down deck on the stage. */
    const gatherDeck = (prefix) => {
        const spread = currentSpread();

        if (!spread) {
            return;
        }

        resetTable(spread);
        state.deck = shuffled(CARDS);
        showDeckStage();

        const count = spread.positions.length;
        dealStatus.textContent = `${prefix} A fresh ${state.deck.length}-card deck waits face-down. `
            + `Shuffle or cut as many times as you like, then deal ${count} card${count === 1 ? '' : 's'}.`;
    };

    /* Shuffle mode: one Fisher-Yates reshuffle of the current deck order, with the riffle animation. */
    const randomizeDeck = () => {
        state.deck = shuffled(state.deck);
        state.shuffles += 1;
        shuffleLoopCount += 1;
        playDeckAnimation('is-shuffling');
        updateDeckMeta();
    };

    const scheduleShuffleCycle = () => {
        window.clearTimeout(shuffleLoopTimer);
        const delay = SHUFFLE_LOOP_MIN_MS + randomIndex(SHUFFLE_LOOP_MAX_MS - SHUFFLE_LOOP_MIN_MS + 1);
        shuffleLoopTimer = window.setTimeout(runShuffleCycle, delay);
    };

    const runShuffleCycle = () => {
        shuffleLoopTimer = 0;

        if (!isShuffleLooping) {
            return;
        }

        if (!isDeckStageActive()) {
            stopShuffleLoop(false);
            return;
        }

        randomizeDeck();
        scheduleShuffleCycle();
    };

    const startShuffleLoop = () => {
        if (isShuffleLooping || !isDeckStageActive()) {
            return;
        }

        isShuffleLooping = true;
        shuffleLoopCount = 0;
        setShuffleControl(true);
        randomizeDeck();
        dealStatus.textContent = 'Shuffling the deck. It keeps reshuffling every few seconds until you press Stop.';
        scheduleShuffleCycle();
    };

    /* Shuffle mode: Shuffle starts a continuous reshuffle loop; pressing it again (Stop) ends the loop. */
    const shuffleDeck = () => {
        if (isShuffleLooping) {
            stopShuffleLoop(true);
            return;
        }

        startShuffleLoop();
    };

    /* Shuffle mode: split the deck near the middle and restack the bottom packet over the top. */
    const cutDeck = () => {
        if (isShuffleLooping || !isDeckStageActive() || state.deck.length < 2) {
            return;
        }

        const total = state.deck.length;
        const margin = Math.max(1, Math.floor(total / 4));
        const point = margin + randomIndex(Math.max(1, total - margin * 2 + 1));
        const top = state.deck.slice(0, point);
        const bottom = state.deck.slice(point);

        state.deck = bottom.concat(top);
        state.cuts += 1;
        playDeckAnimation('is-cutting');
        updateDeckMeta();
        dealStatus.textContent = `Cut the deck at card ${point}: the bottom ${bottom.length} cards now sit on top of the other ${top.length}. `
            + 'Shuffle or cut again, or deal when it feels right.';
    };

    /* Shuffle mode, step 2: deal from the top of the deck into every position, in order, face-down. */
    const autoDeal = () => {
        const spread = currentSpread();

        if (!spread || isDealing || isShuffleLooping || !isDeckStageActive()) {
            return;
        }

        const count = spread.positions.length;

        if (count === 0 || state.deck.length < count) {
            return;
        }

        const hadFocus = deckStage.contains(document.activeElement);
        const entries = spread.positions.map((position, index) => ({
            position,
            card: state.deck[index],
            reversed: randomIndex(2) === 1,
            revealed: false,
        }));
        const paced = !prefersReducedMotion();
        const run = dealRun + 1;
        dealRun = run;

        setDealLocked(true);
        dealStatus.textContent = `Dealing ${count} card${count === 1 ? '' : 's'} face-down from the top of the deck, `
            + 'one position at a time.';

        // Runs once the last card has settled; status and focus wait for it.
        const finish = () => {
            if (run !== dealRun) {
                return;
            }

            dealTimer = 0;
            hideDeckStage();
            setDealLocked(false);
            highlightNextSlot();
            updateRevealState();
            dealStatus.textContent = `Dealt ${count} card${count === 1 ? '' : 's'} face-down from the top of the deck. ${dealStatus.textContent}`;

            if (hadFocus) {
                const active = document.activeElement;
                const focusIdle = !active || active === document.body || !document.contains(active) || deckStage.contains(active);
                const firstHidden = board.querySelector('.tarot-card-flip:not(.is-revealed)');

                if (focusIdle && firstHidden) {
                    firstHidden.focus();
                }
            }
        };

        // Takes the top card and lays it in the next position, in spread.positions order.
        const dealOne = (index) => {
            if (run !== dealRun) {
                return;
            }

            const entry = entries[index];
            const last = index === count - 1;

            state.deal.push(entry);
            state.deck = state.deck.slice(1);
            state.nextPick = index + 1;
            updateDeckMeta();
            highlightNextSlot();

            const slot = placeSlot(entry, index, paced ? dealSourceRect() : null, last ? finish : null);

            // Not operable until the whole deal has landed (refreshRevealOrder then clears this).
            if (isDealing) {
                slot.setAttribute('aria-disabled', 'true');
            }

            if (!last && paced) {
                dealTimer = window.setTimeout(() => {
                    dealOne(index + 1);
                }, DEAL_STEP_MS);
            }
        };

        if (paced) {
            dealOne(0);
        } else {
            entries.forEach((entry, index) => {
                dealOne(index);
            });
        }
    };

    const setDealMode = (mode) => {
        if (isDealing || !DEAL_MODES.includes(mode) || mode === state.mode) {
            return;
        }

        state.mode = mode;

        if (!currentSpread()) {
            return;
        }

        selectSpread(state.spreadId);
        dealStatus.textContent = `${mode === 'fan' ? 'Switched to picking from a fan.' : 'Switched to shuffle & cut.'} ${dealStatus.textContent}`;
    };

    const setupSpreads = () => {
        SPREADS.forEach((spread, index) => {
            const label = el('label', 'tarot-spread-option');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'tarot-spread';
            input.value = spread.id;
            input.checked = index === 0;

            // Compact chip: name + card count. The selected spread's full description is
            // shown once below the row (#tarot-spread-description) so the row stays tidy.
            const text = el('span', 'tarot-spread-option-text');
            text.append(
                el('strong', null, spread.name),
                el('span', null, `${spread.positions.length} card${spread.positions.length === 1 ? '' : 's'}`),
            );
            if (spread.description) {
                label.title = spread.description;
            }
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
                const index = Number(slot.dataset.slotIndex);

                // Only a single reveal after every position is filled opens the hero view.
                if (revealEntry(index) && isDealComplete()) {
                    openReadingHero(index);
                }
            }
        });

        if (heroDialog) {
            heroClose.addEventListener('click', closeReadingHero);
            heroDialog.addEventListener('click', (event) => {
                if (event.target === heroDialog) {
                    closeReadingHero();
                }
            });
            heroDialog.addEventListener('close', () => {
                if (heroReturnFocus && document.contains(heroReturnFocus)) {
                    heroReturnFocus.focus();
                }

                heroReturnFocus = null;
            });
        }

        fan.addEventListener('click', (event) => {
            // A double-click would otherwise pick the card under the pointer twice.
            if (event.detail > 1) {
                return;
            }

            const button = event.target.closest('.tarot-fan-card');

            if (button && fan.contains(button)) {
                pickCard(button);
            }
        });

        dealButton.addEventListener('click', deal);

        if (controlsToggle) {
            controlsToggle.addEventListener('click', () => {
                setControlsCollapsed(false, { moveFocus: true });
            });
        }

        if (modeOptionsRoot) {
            // Always open in the primary shuffle & cut mode, even if the browser restored a radio.
            modeOptionsRoot.querySelectorAll('input[name="tarot-deal-mode"]').forEach((input) => {
                input.checked = input.value === state.mode;
            });

            modeOptionsRoot.addEventListener('change', (event) => {
                if (event.target && event.target.name === 'tarot-deal-mode') {
                    setDealMode(event.target.value);
                }
            });
        }

        if (shuffleButton) {
            shuffleButton.addEventListener('click', shuffleDeck);
        }

        if (cutButton) {
            cutButton.addEventListener('click', cutDeck);
        }

        if (autoDealButton) {
            autoDealButton.addEventListener('click', autoDeal);
        }

        if (state.spreadId) {
            selectSpread(state.spreadId);
        } else {
            dealButton.disabled = true;
            dealStatus.textContent = 'No spreads are available.';
        }
    };

    setupTabs();
    setupGallery();
    setupSpreads();
    setupMeaningMap();
})();

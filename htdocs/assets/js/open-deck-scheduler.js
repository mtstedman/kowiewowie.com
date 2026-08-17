(() => {
    const slotsRoot = document.querySelector('[data-open-deck-slots]');
    const statusNode = document.querySelector('[data-open-deck-status]');
    const refreshButton = document.querySelector('[data-open-deck-refresh]');

    if (!(slotsRoot instanceof HTMLElement) || !(statusNode instanceof HTMLElement)) {
        return;
    }

    const apiBase = '/api/v1/open-deck/slots';
    let slots = [];

    const setStatus = (message, tone = 'neutral') => {
        statusNode.textContent = message;
        statusNode.dataset.tone = tone;
        statusNode.hidden = message === '';
    };

    const clearStatus = () => setStatus('');

    const safeText = (value, fallback = '') => {
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
        return fallback;
    };

    const toCount = (value) => Number.isInteger(value) ? value : 0;

    const formatDateTime = (value) => {
        const raw = safeText(value);
        if (raw === '') {
            return 'Time not set';
        }

        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) {
            return raw;
        }

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    };

    const appendText = (parent, tagName, text, className) => {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = text;
        parent.append(element);
        return element;
    };

    const normalizeSlots = (payload) => {
        const data = payload && typeof payload === 'object' ? payload.data : null;
        return Array.isArray(data) ? data.filter((slot) => slot && typeof slot === 'object') : [];
    };

    const extractErrorMessage = async (response) => {
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (payload && typeof payload === 'object') {
            const apiError = payload.error;
            if (apiError && typeof apiError === 'object') {
                const message = safeText(apiError.message);
                const code = safeText(apiError.code);
                if (message !== '' && code !== '') {
                    return `${message} (${code})`;
                }
                if (message !== '') {
                    return message;
                }
                if (code !== '') {
                    return `The request failed: ${code}.`;
                }
            }

            const message = safeText(payload.message);
            if (message !== '') {
                return message;
            }
        }

        if (response.status === 409) {
            return 'That vote or nomination conflicts with the current slot state.';
        }
        if (response.status === 422 || response.status === 400) {
            return 'Check the highlighted form fields and try again.';
        }
        return 'The open deck scheduler could not save that change.';
    };

    const requestJson = async (url, options = {}) => {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            ...options,
        });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response));
        }

        return response.json();
    };

    const slotState = (slot) => {
        const status = safeText(slot.status, 'open').toLowerCase();
        const hasEvictions = Array.isArray(slot.nominations)
            && slot.nominations.some((nomination) => safeText(nomination.status).toLowerCase() === 'evicted');

        if (status === 'closed') {
            return { label: 'Closed', className: 'is-closed' };
        }
        if (status === 'filled') {
            return { label: 'Filled', className: 'is-filled' };
        }
        if (hasEvictions) {
            return { label: 'Reopened after eviction', className: 'is-evicted' };
        }

        const start = new Date(safeText(slot.start_at));
        if (!Number.isNaN(start.getTime()) && start.getTime() > Date.now()) {
            return { label: 'Upcoming', className: 'is-upcoming' };
        }

        return { label: 'Open', className: 'is-open' };
    };

    const replaceSlot = (updatedSlot) => {
        if (!updatedSlot || typeof updatedSlot !== 'object') {
            return;
        }

        const updatedId = safeText(updatedSlot.id);
        if (updatedId === '') {
            return;
        }

        const index = slots.findIndex((slot) => safeText(slot.id) === updatedId);
        if (index === -1) {
            slots = [...slots, updatedSlot];
        } else {
            slots = slots.map((slot, slotIndex) => slotIndex === index ? updatedSlot : slot);
        }
    };

    const renderWinner = (slot, card) => {
        const status = safeText(slot.status, 'open').toLowerCase();
        const winner = slot.filled_nomination && typeof slot.filled_nomination === 'object'
            ? slot.filled_nomination
            : slot.current_winner;

        const panel = document.createElement('div');
        panel.className = 'open-deck-winner';
        card.append(panel);

        if (!winner || typeof winner !== 'object') {
            appendText(panel, 'p', status === 'filled' ? 'Filled set unavailable.' : 'No leading set yet.', 'open-deck-winner-label');
            appendText(panel, 'p', 'Nominate a set to start the voting stack.', 'open-deck-muted');
            return;
        }

        appendText(panel, 'p', status === 'filled' ? 'Winning set' : 'Current leader', 'open-deck-winner-label');
        appendText(panel, 'h3', safeText(winner.set_name, 'Untitled set'), 'open-deck-winner-name');
        appendText(
            panel,
            'p',
            `${toCount(winner.fill_vote_count)} fill vote${toCount(winner.fill_vote_count) === 1 ? '' : 's'} / ${toCount(winner.eviction_vote_count)} eviction vote${toCount(winner.eviction_vote_count) === 1 ? '' : 's'}`,
            'open-deck-muted'
        );
    };

    const createInput = (name, placeholder, autocomplete) => {
        const input = document.createElement('input');
        input.name = name;
        input.type = 'text';
        input.placeholder = placeholder;
        input.autocomplete = autocomplete;
        input.required = true;
        input.maxLength = 120;
        return input;
    };

    const renderNominationForm = (slot, card) => {
        if (safeText(slot.status, 'open').toLowerCase() !== 'open') {
            return;
        }

        const form = document.createElement('form');
        form.className = 'open-deck-form open-deck-nomination-form';
        form.dataset.action = 'nominate';
        form.dataset.slotId = safeText(slot.id);

        appendText(form, 'h3', 'Nominate a set', 'open-deck-form-title');

        const setLabel = document.createElement('label');
        appendText(setLabel, 'span', 'Set name', 'open-deck-field-label');
        setLabel.append(createInput('set_name', 'Set name', 'off'));
        form.append(setLabel);

        const voterLabel = document.createElement('label');
        appendText(voterLabel, 'span', 'Your name', 'open-deck-field-label');
        const voterInput = createInput('nominated_by', 'Name for the nomination', 'name');
        voterInput.required = false;
        voterLabel.append(voterInput);
        form.append(voterLabel);

        const button = document.createElement('button');
        button.className = 'button';
        button.type = 'submit';
        button.textContent = 'Nominate set';
        form.append(button);

        card.append(form);
    };

    const renderFillVoteForm = (slot, nomination, row) => {
        if (safeText(slot.status, 'open').toLowerCase() !== 'open' || safeText(nomination.status).toLowerCase() !== 'eligible') {
            return;
        }

        const form = document.createElement('form');
        form.className = 'open-deck-inline-form';
        form.dataset.action = 'fill-vote';
        form.dataset.slotId = safeText(slot.id);
        form.dataset.nominationId = safeText(nomination.id);

        form.append(createInput('voter_identity', 'Your name', 'name'));

        const button = document.createElement('button');
        button.className = 'button open-deck-small-button';
        button.type = 'submit';
        button.textContent = 'Vote';
        form.append(button);

        row.append(form);
    };

    const renderEvictionForm = (slot, card) => {
        const filled = slot.filled_nomination && typeof slot.filled_nomination === 'object' ? slot.filled_nomination : null;
        if (safeText(slot.status).toLowerCase() !== 'filled' || filled === null) {
            return;
        }

        const form = document.createElement('form');
        form.className = 'open-deck-form open-deck-eviction-form';
        form.dataset.action = 'eviction-vote';
        form.dataset.slotId = safeText(slot.id);
        form.dataset.nominationId = safeText(filled.id);

        appendText(form, 'h3', 'Eviction vote', 'open-deck-form-title');
        appendText(
            form,
            'p',
            `${toCount(filled.eviction_vote_count)} of ${toCount(slot.eviction_vote_threshold)} votes to evict ${safeText(filled.set_name, 'this set')}.`,
            'open-deck-muted'
        );

        const voterLabel = document.createElement('label');
        appendText(voterLabel, 'span', 'Your name', 'open-deck-field-label');
        voterLabel.append(createInput('voter_identity', 'Name for the eviction vote', 'name'));
        form.append(voterLabel);

        const button = document.createElement('button');
        button.className = 'button';
        button.type = 'submit';
        button.textContent = 'Vote to evict';
        form.append(button);

        card.append(form);
    };

    const renderNominations = (slot, card) => {
        const nominations = Array.isArray(slot.nominations)
            ? slot.nominations.filter((nomination) => nomination && typeof nomination === 'object')
            : [];

        const section = document.createElement('div');
        section.className = 'open-deck-nominations';
        appendText(section, 'h3', 'Nominated sets', 'open-deck-list-title');

        if (nominations.length === 0) {
            appendText(section, 'p', 'No sets have been nominated for this slot yet.', 'open-deck-empty');
            card.append(section);
            return;
        }

        const list = document.createElement('div');
        list.className = 'open-deck-nomination-list';

        nominations.forEach((nomination) => {
            const row = document.createElement('article');
            row.className = `open-deck-nomination is-${safeText(nomination.status, 'eligible').toLowerCase()}`;

            const copy = document.createElement('div');
            copy.className = 'open-deck-nomination-copy';
            appendText(copy, 'h4', safeText(nomination.set_name, 'Untitled set'), 'open-deck-nomination-title');

            const byline = safeText(nomination.nominated_by) === ''
                ? 'Nominated anonymously'
                : `Nominated by ${safeText(nomination.nominated_by)}`;
            appendText(copy, 'p', byline, 'open-deck-muted');
            appendText(
                copy,
                'p',
                `${toCount(nomination.fill_vote_count)} fill vote${toCount(nomination.fill_vote_count) === 1 ? '' : 's'} / ${toCount(nomination.eviction_vote_count)} eviction vote${toCount(nomination.eviction_vote_count) === 1 ? '' : 's'} / ${safeText(nomination.status, 'eligible')}`,
                'open-deck-muted'
            );
            row.append(copy);

            renderFillVoteForm(slot, nomination, row);
            list.append(row);
        });

        section.append(list);
        card.append(section);
    };

    const renderSlot = (slot) => {
        const state = slotState(slot);
        const card = document.createElement('article');
        card.className = `open-deck-slot ${state.className}`;

        const header = document.createElement('header');
        header.className = 'open-deck-slot-header';
        const titleWrap = document.createElement('div');
        appendText(titleWrap, 'p', `${formatDateTime(slot.start_at)} to ${formatDateTime(slot.end_at)}`, 'open-deck-slot-time');
        appendText(titleWrap, 'h3', state.label, 'open-deck-slot-title');
        header.append(titleWrap);
        appendText(header, 'span', state.label, 'open-deck-state-pill');
        card.append(header);

        renderWinner(slot, card);
        renderNominations(slot, card);
        renderNominationForm(slot, card);
        renderEvictionForm(slot, card);

        return card;
    };

    const render = () => {
        slotsRoot.replaceChildren();

        if (slots.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'open-deck-empty-state';
            appendText(empty, 'h3', 'No open deck times are scheduled yet.');
            appendText(empty, 'p', 'Check back when the next table slot is posted.');
            slotsRoot.append(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        slots.forEach((slot) => fragment.append(renderSlot(slot)));
        slotsRoot.append(fragment);
    };

    const loadSlots = async () => {
        setStatus('Loading open deck times...');
        if (refreshButton instanceof HTMLButtonElement) {
            refreshButton.disabled = true;
        }

        try {
            slots = normalizeSlots(await requestJson(`${apiBase}?limit=100`));
            render();
            setStatus(slots.length === 0 ? 'No open deck times are scheduled yet.' : `Loaded ${slots.length} open deck slot${slots.length === 1 ? '' : 's'}.`, slots.length === 0 ? 'neutral' : 'success');
        } catch (error) {
            slotsRoot.replaceChildren();
            const errorState = document.createElement('div');
            errorState.className = 'open-deck-error-state';
            appendText(errorState, 'h3', 'The schedule did not load.');
            appendText(errorState, 'p', error instanceof Error ? error.message : 'Try again in a moment.');
            slotsRoot.append(errorState);
            setStatus('Unable to load open deck times.', 'error');
        } finally {
            if (refreshButton instanceof HTMLButtonElement) {
                refreshButton.disabled = false;
            }
        }
    };

    const submitForm = async (form) => {
        const action = form.dataset.action || '';
        const slotId = safeText(form.dataset.slotId);
        if (slotId === '') {
            setStatus('This slot is missing its identifier.', 'error');
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
        }
        clearStatus();

        try {
            const formData = new FormData(form);
            let endpoint = '';
            let body = {};

            if (action === 'nominate') {
                endpoint = `${apiBase}/${encodeURIComponent(slotId)}/nominations`;
                body = {
                    set_name: safeText(formData.get('set_name')),
                };
                const nominatedBy = safeText(formData.get('nominated_by'));
                if (nominatedBy !== '') {
                    body.nominated_by = nominatedBy;
                }
            } else if (action === 'fill-vote') {
                endpoint = `${apiBase}/${encodeURIComponent(slotId)}/votes`;
                body = {
                    nomination_id: safeText(form.dataset.nominationId),
                    voter_identity: safeText(formData.get('voter_identity')),
                };
            } else if (action === 'eviction-vote') {
                endpoint = `${apiBase}/${encodeURIComponent(slotId)}/eviction-votes`;
                body = {
                    nomination_id: safeText(form.dataset.nominationId),
                    voter_identity: safeText(formData.get('voter_identity')),
                };
            } else {
                throw new Error('This scheduler action is not recognized.');
            }

            const payload = await requestJson(endpoint, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (payload && typeof payload === 'object') {
                replaceSlot(payload.data);
            }
            render();
            setStatus('Saved. The schedule has been updated.', 'success');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'The open deck scheduler could not save that change.', 'error');
        } finally {
            if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
            }
        }
    };

    slotsRoot.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) {
            return;
        }

        event.preventDefault();
        submitForm(form);
    });

    if (refreshButton instanceof HTMLButtonElement) {
        refreshButton.addEventListener('click', () => {
            loadSlots();
        });
    }

    loadSlots();
})();

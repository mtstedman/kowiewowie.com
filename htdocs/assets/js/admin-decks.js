(() => {
    const root = document.querySelector('[data-deck-sections]');
    const addSection = document.querySelector('[data-add-section]');
    if (!root || !addSection) {
        return;
    }

    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const cardRow = (sectionIndex, cardIndex, quantity = '', name = '') => `
        <div class="admin-form-row" data-card-row>
            <label>
                <span>Quantity</span>
                <input name="deck_sections[${sectionIndex}][cards][${cardIndex}][quantity]" value="${escapeHtml(quantity)}" inputmode="numeric" required>
            </label>
            <label>
                <span>Card</span>
                <input name="deck_sections[${sectionIndex}][cards][${cardIndex}][name]" value="${escapeHtml(name)}" required maxlength="255">
            </label>
            <button type="button" data-remove-card>Remove</button>
        </div>`;

    const sectionBlock = (sectionIndex) => `
        <div class="admin-deck-section" data-section data-section-index="${sectionIndex}" data-next-card="1">
            <label>
                <span>Section name</span>
                <input name="deck_sections[${sectionIndex}][name]" required maxlength="120">
            </label>
            <div data-card-list>${cardRow(sectionIndex, 0, '1', '')}</div>
            <button type="button" data-add-card>Add card</button>
            <button type="button" data-remove-section>Remove section</button>
        </div>`;

    addSection.addEventListener('click', () => {
        const index = Number(root.dataset.nextSection || '0');
        root.insertAdjacentHTML('beforeend', sectionBlock(index));
        root.dataset.nextSection = String(index + 1);
    });

    root.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.matches('[data-add-card]')) {
            const section = target.closest('[data-section]');
            const list = section ? section.querySelector('[data-card-list]') : null;
            if (!section || !list) {
                return;
            }
            const sectionIndex = Number(section.dataset.sectionIndex || '0');
            const cardIndex = Number(section.dataset.nextCard || '0');
            list.insertAdjacentHTML('beforeend', cardRow(sectionIndex, cardIndex, '1', ''));
            section.dataset.nextCard = String(cardIndex + 1);
        }

        if (target.matches('[data-remove-card]')) {
            target.closest('[data-card-row]')?.remove();
        }

        if (target.matches('[data-remove-section]')) {
            target.closest('[data-section]')?.remove();
        }
    });
})();

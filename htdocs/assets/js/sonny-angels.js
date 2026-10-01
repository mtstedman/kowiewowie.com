(() => {
  const root = document.querySelector('[data-sa-catalog]');
  if (!root) return;

  // Images can fail before this deferred script runs, or later as they lazy-load.
  /** @param {HTMLImageElement} image */
  const updateImage = (image) => {
    if (!image.complete) return;
    const fallback = image.parentElement?.querySelector('.sa-image-placeholder');
    const failed = image.naturalWidth === 0;
    image.hidden = failed;
    if (fallback instanceof HTMLElement) {
      fallback.hidden = !failed;
      if (failed) fallback.textContent = 'Image unavailable';
    }
  };
  root.querySelectorAll('[data-sa-image]').forEach((image) => {
    if (!(image instanceof HTMLImageElement)) return;
    image.addEventListener('load', () => updateImage(image));
    image.addEventListener('error', () => updateImage(image));
    updateImage(image);
  });

  const form = root.querySelector('[data-sa-form]');
  const query = root.querySelector('[data-sa-query]');
  const family = root.querySelector('[data-sa-family]');
  const series = root.querySelector('[data-sa-series]');
  const count = root.querySelector('[data-sa-count]');
  const empty = root.querySelector('[data-sa-empty]');
  if (!(form instanceof HTMLFormElement) || !(query instanceof HTMLInputElement)
      || !(family instanceof HTMLSelectElement) || !(series instanceof HTMLSelectElement)
      || !(count instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

  /** @param {string} value */
  const normalize = (value) => value.normalize('NFKC').toLocaleLowerCase().trim();
  const groups = Array.from(root.querySelectorAll('[data-sa-group]')).flatMap((element) => {
    if (!(element instanceof HTMLElement)) return [];
    const cards = Array.from(element.querySelectorAll('[data-sa-card]')).flatMap((card) => {
      if (!(card instanceof HTMLElement)) return [];
      return [{ element: card, search: normalize(card.dataset.search || '') }];
    });
    return [{ element, cards, search: normalize(element.dataset.search || '') }];
  });
  const total = groups.reduce((sum, group) => sum + group.cards.length, 0);

  const render = () => {
    const terms = normalize(query.value).split(/\s+/).filter(Boolean);
    let figuresShown = 0;
    let seriesShown = 0;
    groups.forEach((group) => {
      const allowed = (!family.value || group.element.dataset.family === family.value)
        && (!series.value || group.element.dataset.series === series.value);
      let matches = 0;
      group.cards.forEach((card) => {
        const visible = allowed && terms.every((term) => card.search.includes(term));
        card.element.hidden = !visible;
        if (visible) matches += 1;
      });
      // Series with missing lineups are real catalog entries, not invented figures.
      const visible = allowed && (group.cards.length > 0
        ? matches > 0 : terms.every((term) => group.search.includes(term)));
      group.element.hidden = !visible;
      figuresShown += matches;
      if (visible) seriesShown += 1;
    });
    count.textContent = `${figuresShown} of ${total} figures · ${seriesShown} of ${groups.length} series. Series without documented figures may also appear.`;
    empty.hidden = seriesShown !== 0;
  };

  const syncSeriesOptions = () => {
    Array.from(series.options).forEach((option) => {
      const available = !option.value || !family.value || option.dataset.family === family.value;
      option.disabled = !available;
      option.hidden = !available;
    });
    if (series.selectedOptions[0]?.disabled) series.value = '';
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    render();
    query.focus();
  });
  query.addEventListener('input', render);
  family.addEventListener('change', () => {
    syncSeriesOptions();
    render();
  });
  series.addEventListener('change', render);
  root.querySelectorAll('[data-sa-clear]').forEach((button) => {
    button.addEventListener('click', () => {
      query.value = '';
      family.value = '';
      series.value = '';
      syncSeriesOptions();
      render();
      query.focus();
    });
  });

  syncSeriesOptions();
  render();
  form.hidden = false;
})();

(() => {
  const root = document.querySelector('[data-donger-library]');

  if (!root) {
    return;
  }

  const form = root.querySelector('[data-donger-search-form]');
  const input = root.querySelector('[data-donger-search-input]');
  const clearButton = root.querySelector('[data-donger-search-clear]');
  const status = root.querySelector('[data-donger-search-status]');
  const emptyState = root.querySelector('[data-donger-search-empty]');
  const categories = Array.from(root.querySelectorAll('.donger-category'));
  const buttons = Array.from(root.querySelectorAll('button[data-donger]'));
  const totalCount = buttons.length;

  if (!(input instanceof HTMLInputElement) || !form || !clearButton || !status || !emptyState) {
    return;
  }

  const normalize = (value) => value.trim().toLocaleLowerCase();

  const render = () => {
    const query = normalize(input.value);
    let matchCount = 0;

    buttons.forEach((button) => {
      const searchableText = normalize([
        button.getAttribute('data-donger-name') || '',
        button.getAttribute('data-donger') || '',
      ].join(' '));
      const isMatch = query === '' || searchableText.includes(query);

      button.hidden = !isMatch;

      if (isMatch) {
        matchCount += 1;
      }
    });

    categories.forEach((category) => {
      const hasVisibleButtons = category.querySelector('button[data-donger]:not([hidden])');
      category.hidden = !hasVisibleButtons;
    });

    clearButton.disabled = query === '';
    emptyState.hidden = matchCount !== 0;

    if (query === '') {
      status.textContent = `Showing all ${totalCount} dongers.`;
      return;
    }

    if (matchCount === 0) {
      status.textContent = `No dongers matched "${input.value}".`;
      return;
    }

    status.textContent = `Showing ${matchCount} dongers matching "${input.value}".`;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    input.focus();
  });

  input.addEventListener('input', render);
  clearButton.addEventListener('click', () => {
    input.value = '';
    render();
    input.focus();
  });

  render();
})();
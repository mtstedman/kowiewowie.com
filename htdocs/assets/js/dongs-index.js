(() => {
  const root = document.querySelector('[data-donger-library]');

  if (!root) {
    return;
  }

  const status = root.querySelector('[data-copy-status]');
  let hideTimer = 0;

  const announce = (message) => {
    if (!status) {
      return;
    }

    status.textContent = message;
    status.classList.add('is-visible');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      status.textContent = '';
      status.classList.remove('is-visible');
    }, 1800);
  };

  const copyWithFallback = (text) => {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';

    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    try {
      return document.execCommand('copy');
    } finally {
      helper.remove();
    }
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    return copyWithFallback(text);
  };

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-donger]');

    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) {
      return;
    }

    const text = button.getAttribute('data-donger') || '';
    const name = button.getAttribute('data-donger-name') || 'donger';

    if (!text) {
      return;
    }

    try {
      const copied = await copyText(text);

      if (!copied) {
        announce(`Could not copy ${name}. Select it and copy it manually.`);
        return;
      }

      announce(`Copied ${name}.`);
    } catch {
      announce(`Could not copy ${name}. Select it and copy it manually.`);
    }
  });
})();

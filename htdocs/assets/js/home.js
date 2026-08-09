(() => {
    const button = document.querySelector('[data-silly-button]');
    const output = document.querySelector('[data-silly-output]');

    if (!(button instanceof HTMLButtonElement) || !(output instanceof HTMLElement)) {
        return;
    }

    const messages = [
        'Current mood: politely tap-dancing through the source code.',
        'Status: one tiny idea wearing a party hat.',
        'Desk forecast: scattered snacks with a chance of excellent tabs.',
        'Now serving: pocket-sized nonsense, locally sourced.',
        'Alert: the recipe drawer just winked.'
    ];

    let messageIndex = 0;

    button.addEventListener('click', () => {
        messageIndex = (messageIndex + 1) % messages.length;
        output.textContent = messages[messageIndex];
    });
})();

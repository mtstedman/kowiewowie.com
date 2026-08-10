(() => {
    const target = document.querySelector('[data-counter-9-11], [data-911-counter], #counter-9-11, #counter-911');

    if (!(target instanceof HTMLElement)) {
        return;
    }

    const startTime = new Date('2001-09-11T09:03:11-04:00');
    const secondInMilliseconds = 1000;
    const minuteInMilliseconds = 60 * secondInMilliseconds;
    const hourInMilliseconds = 60 * minuteInMilliseconds;
    const dayInMilliseconds = 24 * hourInMilliseconds;
    const yearInDays = 365.2425;

    const formatNumber = (value) => new Intl.NumberFormat('en-US').format(value);

    const getElapsedParts = (now) => {
        const elapsedMilliseconds = Math.max(0, now.getTime() - startTime.getTime());
        const totalDays = Math.floor(elapsedMilliseconds / dayInMilliseconds);
        const totalSeconds = Math.floor(elapsedMilliseconds / secondInMilliseconds);
        const years = Math.floor(totalDays / yearInDays);
        const remainingDays = Math.floor(totalDays - (years * yearInDays));
        const hours = Math.floor((elapsedMilliseconds % dayInMilliseconds) / hourInMilliseconds);
        const minutes = Math.floor((elapsedMilliseconds % hourInMilliseconds) / minuteInMilliseconds);
        const seconds = totalSeconds % 60;

        return {
            totalDays,
            years,
            remainingDays,
            hours,
            minutes,
            seconds
        };
    };

    const renderCounter = () => {
        const now = new Date();
        const elapsed = getElapsedParts(now);
        const formattedCounter = `${formatNumber(elapsed.totalDays)} days (${formatNumber(elapsed.years)} years, ${formatNumber(elapsed.remainingDays)} days, ${String(elapsed.hours).padStart(2, '0')}:${String(elapsed.minutes).padStart(2, '0')}:${String(elapsed.seconds).padStart(2, '0')})`;

        target.textContent = formattedCounter;
        target.setAttribute('datetime', now.toISOString());
        target.setAttribute('title', `Elapsed since ${startTime.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    };

    renderCounter();
    window.setInterval(renderCounter, secondInMilliseconds);
})();

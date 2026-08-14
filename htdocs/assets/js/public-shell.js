(() => {
    'use strict';

    const skipLinks = document.querySelectorAll('.skip-link[href^="#"]');

    skipLinks.forEach((link) => {
        link.addEventListener('click', (event) => {
            const targetId = link.hash.slice(1);
            const target = targetId ? document.getElementById(targetId) : null;

            if (!target) {
                return;
            }

            event.preventDefault();
            target.scrollIntoView({ block: 'start' });

            try {
                target.focus({ preventScroll: true });
            } catch (error) {
                target.focus();
            }

            if (window.history && typeof window.history.pushState === 'function') {
                window.history.pushState(null, '', `#${targetId}`);
            } else {
                window.location.hash = targetId;
            }
        });
    });

    const selector = [
        '.site-header',
        '.foundation',
        '.feature-grid > article',
        '.aside',
        '.bio-section',
        '.counter-9-11',
        '.videos-surface',
        '.videos-card',
        '.videos-watch-meta',
        '.videos-channel-row',
        '.videos-description-card',
        '.videos-related',
        '.videos-related-item',
        '.videos-player',
        '.videos-error-state'
    ].join(', ');
    const panels = document.querySelectorAll(selector);
    const easeFactor = 0.18;
    const settleThreshold = 0.1;

    if (panels.length === 0) {
        return;
    }

    const clampPercent = (value) => Math.max(0, Math.min(100, value));
    const setShimmerPosition = (panel, x, y) => {
        const xPosition = `${x}%`;
        const yPosition = `${y}%`;

        panel.style.setProperty('--glass-x', xPosition);
        panel.style.setProperty('--glass-y', yPosition);
        panel.style.setProperty('--glass-mx', xPosition);
        panel.style.setProperty('--glass-my', yPosition);
    };
    const ensureAnimation = (panelState) => {
        if (panelState.frameId !== null) {
            return;
        }

        const step = () => {
            const deltaX = panelState.targetX - panelState.currentX;
            const deltaY = panelState.targetY - panelState.currentY;

            if (Math.abs(deltaX) <= settleThreshold && Math.abs(deltaY) <= settleThreshold) {
                panelState.currentX = panelState.targetX;
                panelState.currentY = panelState.targetY;
                setShimmerPosition(panelState.panel, panelState.currentX, panelState.currentY);
                panelState.frameId = null;
                return;
            }

            panelState.currentX += deltaX * easeFactor;
            panelState.currentY += deltaY * easeFactor;
            setShimmerPosition(panelState.panel, panelState.currentX, panelState.currentY);
            panelState.frameId = window.requestAnimationFrame(step);
        };

        panelState.frameId = window.requestAnimationFrame(step);
    };
    const updateShimmer = (panelState, event) => {
        const bounds = panelState.panel.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) {
            return;
        }

        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;
        panelState.targetX = clampPercent(x);
        panelState.targetY = clampPercent(y);
        panelState.panel.style.setProperty('--glass-shimmer-alpha', '1');
        ensureAnimation(panelState);
    };

    const resetShimmer = (panelState) => {
        panelState.targetX = 50;
        panelState.targetY = 50;
        panelState.currentX = 50;
        panelState.currentY = 50;

        if (panelState.frameId !== null) {
            window.cancelAnimationFrame(panelState.frameId);
            panelState.frameId = null;
        }

        setShimmerPosition(panelState.panel, 50, 50);
        panelState.panel.style.setProperty('--glass-shimmer-alpha', '0');
    };

    panels.forEach((panel) => {
        const panelState = {
            panel,
            currentX: 50,
            currentY: 50,
            targetX: 50,
            targetY: 50,
            frameId: null
        };

        panel.addEventListener('mousemove', (event) => {
            updateShimmer(panelState, event);
        });
        panel.addEventListener('mouseenter', (event) => {
            updateShimmer(panelState, event);
        });
        panel.addEventListener('mouseleave', () => {
            resetShimmer(panelState);
        });
    });
})();

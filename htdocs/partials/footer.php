<?php

declare(strict_types=1);
?>
<footer>
    <span>© <?= htmlspecialchars($year, ENT_QUOTES, 'UTF-8') ?> wowiekowie.com</span>
    <span class="footer-note">Developer, builder, and occasional movie-watcher.</span>
</footer>

<script>
    (() => {
        const selector = [
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

        if (panels.length === 0) {
            return;
        }

        const updateShimmer = (panel, event) => {
            const bounds = panel.getBoundingClientRect();
            if (bounds.width === 0 || bounds.height === 0) {
                return;
            }

            const x = ((event.clientX - bounds.left) / bounds.width) * 100;
            const y = ((event.clientY - bounds.top) / bounds.height) * 100;
            const boundedX = Math.max(0, Math.min(100, x));
            const boundedY = Math.max(0, Math.min(100, y));

            panel.style.setProperty('--glass-mx', `${boundedX}%`);
            panel.style.setProperty('--glass-my', `${boundedY}%`);
            panel.style.setProperty('--glass-shimmer-alpha', '1');
        };

        const resetShimmer = (panel) => {
            panel.style.setProperty('--glass-mx', '50%');
            panel.style.setProperty('--glass-my', '50%');
            panel.style.setProperty('--glass-shimmer-alpha', '0');
        };

        panels.forEach((panel) => {
            panel.addEventListener('mousemove', (event) => {
                updateShimmer(panel, event);
            });
            panel.addEventListener('mouseenter', (event) => {
                updateShimmer(panel, event);
            });
            panel.addEventListener('mouseleave', () => {
                resetShimmer(panel);
            });
        });
    })();
</script>

<?php

declare(strict_types=1);

$pageTitle = $pageTitle ?? 'wowiekowie.com';
$metaDescription = $metaDescription ?? 'A personal site for recipes, decks, games, music, and experiments.';
$pageStyles = $pageStyles ?? [];
$stylesheetPath = __DIR__ . '/../assets/styles.css';
$stylesheetVersion = is_file($stylesheetPath) ? (string) filemtime($stylesheetPath) : '1';
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
    <meta name="description" content="<?= htmlspecialchars($metaDescription, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="/assets/styles.css?v=<?= rawurlencode($stylesheetVersion) ?>">
<?php
foreach ($pageStyles as $pageStyleHref) {
    $pageStylePath = dirname(__DIR__) . $pageStyleHref;
    $pageStyleVersion = is_file($pageStylePath) ? (string) filemtime($pageStylePath) : '1';
    echo '    <link rel="stylesheet" href="'
        . htmlspecialchars($pageStyleHref, ENT_QUOTES, 'UTF-8')
        . '?v='
        . rawurlencode($pageStyleVersion)
        . '">' . PHP_EOL;
}
?>
    <style>
        :root {
            --glass-panel-bg: rgba(255, 255, 255, 0.18);
            --glass-panel-bg-strong: rgba(255, 255, 255, 0.34);
            --glass-panel-border: rgba(255, 255, 255, 0.38);
            --glass-panel-shadow: rgba(15, 23, 42, 0.22);
            --glass-panel-highlight: rgba(255, 255, 255, 0.55);
            --glass-panel-falloff: rgba(255, 255, 255, 0);
        }

        .foundation,
        .feature-grid > article,
        .aside,
        .bio-section,
        .counter-9-11,
        .videos-surface,
        .videos-card,
        .videos-watch-meta,
        .videos-channel-row,
        .videos-description-card,
        .videos-related,
        .videos-related-item,
        .videos-player,
        .videos-error-state {
            --glass-mx: 50%;
            --glass-my: 50%;
            --glass-shimmer-alpha: 0;
            position: relative;
            isolation: isolate;
            overflow: hidden;
            border: 1px solid var(--glass-panel-border);
            background:
                linear-gradient(180deg, var(--glass-panel-bg-strong), var(--glass-panel-bg)),
                rgba(255, 255, 255, 0.08);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            backdrop-filter: blur(24px) saturate(180%);
            box-shadow:
                0 20px 45px -28px var(--glass-panel-shadow),
                inset 0 1px 0 rgba(255, 255, 255, 0.5);
            transition:
                border-color 180ms ease,
                box-shadow 180ms ease,
                background 180ms ease,
                transform 180ms ease;
        }

        .foundation::after,
        .feature-grid > article::after,
        .aside::after,
        .bio-section::after,
        .counter-9-11::after,
        .videos-surface::after,
        .videos-card::after,
        .videos-watch-meta::after,
        .videos-channel-row::after,
        .videos-description-card::after,
        .videos-related::after,
        .videos-related-item::after,
        .videos-player::after,
        .videos-error-state::after {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 0;
            opacity: var(--glass-shimmer-alpha);
            background:
                radial-gradient(circle at var(--glass-mx) var(--glass-my), var(--glass-panel-highlight) 0, rgba(255, 255, 255, 0.28) 16%, var(--glass-panel-falloff) 42%),
                linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0) 42%);
            transition: opacity 140ms ease;
        }

        .foundation > *,
        .feature-grid > article > *,
        .aside > *,
        .bio-section > *,
        .counter-9-11 > *,
        .videos-surface > *,
        .videos-card > *,
        .videos-watch-meta > *,
        .videos-channel-row > *,
        .videos-description-card > *,
        .videos-related > *,
        .videos-related-item > *,
        .videos-player > *,
        .videos-error-state > * {
            position: relative;
            z-index: 1;
        }

        .foundation:hover,
        .feature-grid > article:hover,
        .aside:hover,
        .bio-section:hover,
        .counter-9-11:hover,
        .videos-surface:hover,
        .videos-card:hover,
        .videos-watch-meta:hover,
        .videos-channel-row:hover,
        .videos-description-card:hover,
        .videos-related:hover,
        .videos-related-item:hover,
        .videos-player:hover,
        .videos-error-state:hover {
            border-color: rgba(255, 255, 255, 0.52);
            box-shadow:
                0 28px 55px -30px rgba(15, 23, 42, 0.32),
                inset 0 1px 0 rgba(255, 255, 255, 0.62);
        }
    </style>
</head>

<?php

declare(strict_types=1);

$pageTitle = $pageTitle ?? 'wowiekowie.com';
$metaDescription = $metaDescription ?? 'A personal site for recipes, decks, games, music, and experiments.';
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
</head>

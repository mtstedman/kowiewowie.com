<?php

declare(strict_types=1);

require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

admin_render_page(
    'Dashboard',
    static function (): void {
        $sections = [
            ['href' => '/admin/recipes.php', 'label' => 'Recipes', 'description' => 'Tune kitchen notes, status, images, ingredients, and steps.'],
            ['href' => '/admin/decks.php', 'label' => 'Decks', 'description' => 'Shape Magic deck lists, sections, cards, and publishing details.'],
            ['href' => '/admin/guides.php', 'label' => 'Guides', 'description' => 'Polish Magic guides, summaries, sections, and launch timing.'],
            ['href' => '/admin/games.php', 'label' => 'Games', 'description' => 'Keep game pages crisp, findable, and ready to play.'],
            ['href' => '/admin/music.php', 'label' => 'Music', 'description' => 'Curate tracks, artists, Spotify links, notes, and status.'],
            ['href' => '/admin/videos.php', 'label' => 'Videos', 'description' => 'Prep YouTube entries, thumbnails, tags, and publication details.'],
        ];
        ?>
        <section class="admin-hero" aria-labelledby="admin-title">
            <p class="admin-eyebrow">Content cockpit</p>
            <h1 id="admin-title">Pick a shelf to tidy.</h1>
            <p>Fast paths for the bits visitors actually see. Draft carefully, publish deliberately, keep the weird polished.</p>
        </section>

        <section class="admin-section-grid" aria-label="Content managers">
            <?php foreach ($sections as $section): ?>
                <a class="admin-card" href="<?= htmlspecialchars($section['href'], ENT_QUOTES, 'UTF-8') ?>">
                    <span><?= htmlspecialchars($section['label'], ENT_QUOTES, 'UTF-8') ?></span>
                    <small><?= htmlspecialchars($section['description'], ENT_QUOTES, 'UTF-8') ?></small>
                </a>
            <?php endforeach; ?>
        </section>
        <?php
    },
    $user,
);

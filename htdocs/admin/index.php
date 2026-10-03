<?php

declare(strict_types=1);

require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

admin_render_page(
    'Dashboard',
    static function (): void {
        $sections = [
            ['href' => '/admin/recipes.php', 'label' => 'Recipes', 'category' => 'Kitchen', 'description' => 'Tune kitchen notes, images, ingredients, steps, and publishing status.'],
            ['href' => '/admin/decks.php', 'label' => 'Decks', 'category' => 'Magic', 'description' => 'Shape deck lists, ordered sections, card rows, and public details.'],
            ['href' => '/admin/guides.php', 'label' => 'Guides', 'category' => 'Magic', 'description' => 'Polish deck guides, summaries, sections, launch dates, and QR labels.'],
            ['href' => '/admin/games.php', 'label' => 'Games', 'category' => 'Arcade', 'description' => 'Keep game pages crisp, findable, and ready for visitors to play.'],
            ['href' => '/admin/music.php', 'label' => 'Music', 'category' => 'Listening shelf', 'description' => 'Curate tracks, artists, Spotify links, notes, and publication status.'],
            ['href' => '/admin/videos.php', 'label' => 'Videos', 'category' => 'Watch shelf', 'description' => 'Prepare YouTube entries, thumbnails, tags, counts, and publication details.'],
        ];
        ?>
        <section class="admin-hero admin-dashboard-hero" aria-labelledby="admin-title">
            <div>
                <p class="admin-eyebrow">Content control room</p>
                <h1 id="admin-title">Keep every shelf ready for company.</h1>
            </div>
            <p>Choose a manager to create, review, publish, or retire the things visitors see. Draft carefully, publish deliberately, keep the weird polished.</p>
        </section>

        <section class="admin-section-grid" aria-labelledby="admin-managers-title">
            <h2 class="admin-visually-hidden" id="admin-managers-title">Content managers</h2>
            <?php foreach ($sections as $section): ?>
                <a class="admin-card" href="<?= htmlspecialchars((string) ($section['href'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
                    <span class="admin-card-kicker"><?= htmlspecialchars((string) ($section['category'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
                    <span class="admin-card-title">
                        <strong><?= htmlspecialchars((string) ($section['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?></strong>
                        <span aria-hidden="true">&rarr;</span>
                    </span>
                    <small><?= htmlspecialchars((string) ($section['description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></small>
                </a>
            <?php endforeach; ?>
        </section>
        <?php
    },
    $user,
);

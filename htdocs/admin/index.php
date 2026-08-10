<?php

declare(strict_types=1);

require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

admin_render_page(
    'Dashboard',
    static function (): void {
        $sections = [
            ['href' => '/admin/recipes.php', 'label' => 'Recipes', 'description' => 'Manage recipe entries and publication details.'],
            ['href' => '/admin/decks.php', 'label' => 'Decks', 'description' => 'Manage Magic deck lists and deck metadata.'],
            ['href' => '/admin/guides.php', 'label' => 'Guides', 'description' => 'Manage Magic guides and supporting content.'],
            ['href' => '/admin/games.php', 'label' => 'Games', 'description' => 'Manage game pages and launch details.'],
            ['href' => '/admin/music.php', 'label' => 'Music', 'description' => 'Manage music entries and links.'],
        ];
        ?>
        <section class="admin-hero" aria-labelledby="admin-title">
            <p class="admin-eyebrow">Content management</p>
            <h1 id="admin-title">Admin dashboard</h1>
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

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
            [
                'label' => 'Magic',
                'description' => 'Manage Magic decks and deck-playing guides together.',
                'children' => [
                    ['href' => '/admin/decks.php', 'label' => 'Decks', 'description' => 'Shape deck lists, sections, cards, and publishing details.'],
                    ['href' => '/admin/guides.php', 'label' => 'Guides', 'description' => 'Polish deck-playing guides, summaries, sections, and launch timing.'],
                ],
            ],
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
                <?php $children = $section['children'] ?? null; ?>
                <?php if (is_array($children)): ?>
                    <section class="admin-card admin-card-group" aria-labelledby="admin-card-<?= htmlspecialchars(strtolower((string) ($section['label'] ?? 'group')), ENT_QUOTES, 'UTF-8') ?>">
                        <span id="admin-card-<?= htmlspecialchars(strtolower((string) ($section['label'] ?? 'group')), ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars((string) ($section['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
                        <small><?= htmlspecialchars((string) ($section['description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></small>
                        <div class="admin-card-subsections">
                            <?php foreach ($children as $child): ?>
                                <?php if (!is_array($child)) { continue; } ?>
                                <a class="admin-subcard" href="<?= htmlspecialchars((string) ($child['href'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
                                    <strong><?= htmlspecialchars((string) ($child['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?></strong>
                                    <small><?= htmlspecialchars((string) ($child['description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></small>
                                </a>
                            <?php endforeach; ?>
                        </div>
                    </section>
                <?php else: ?>
                    <a class="admin-card" href="<?= htmlspecialchars((string) ($section['href'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
                        <span><?= htmlspecialchars((string) ($section['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
                        <small><?= htmlspecialchars((string) ($section['description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></small>
                    </a>
                <?php endif; ?>
            <?php endforeach; ?>
        </section>
        <?php
    },
    $user,
);

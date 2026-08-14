<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();

/** @param mixed $value */
function admin_guides_h($value): string
{
    return htmlspecialchars(is_scalar($value) ? (string) $value : '', ENT_QUOTES, 'UTF-8');
}

/** @param array<string, mixed> $user */
function admin_guides_actor_id(array $user): ?string
{
    $id = $user['id'] ?? null;
    return is_scalar($id) && (string) $id !== '' ? (string) $id : null;
}

function admin_guides_public_url(string $path): string
{
    $host = is_scalar($_SERVER['HTTP_HOST'] ?? null) ? trim((string) $_SERVER['HTTP_HOST']) : '';
    $scheme = 'https';
    if ($host !== '' && (($_SERVER['HTTPS'] ?? '') === '' || ($_SERVER['HTTPS'] ?? '') === 'off')) {
        $scheme = 'http';
    }
    if ($host === '') {
        $host = 'wowiekowie.com';
    }

    return $scheme . '://' . $host . '/' . ltrim($path, '/');
}

/** @return array{slug: string, title: string, deck_slug: string, summary: string, status: string, published: ?string, sections: list<array{heading: string, body: string}>} */
function admin_guides_input_from_post(): array
{
    $headings = $_POST['section_heading'] ?? [];
    $bodies = $_POST['section_body'] ?? [];
    $sections = [];

    if (is_array($headings) && is_array($bodies)) {
        $count = max(count($headings), count($bodies));
        for ($index = 0; $index < $count; $index++) {
            $heading = $headings[$index] ?? '';
            $body = $bodies[$index] ?? '';
            $heading = is_scalar($heading) ? trim((string) $heading) : '';
            $body = is_scalar($body) ? trim((string) $body) : '';
            if ($heading === '' && $body === '') {
                continue;
            }
            $sections[] = [
                'heading' => $heading,
                'body' => $body,
            ];
        }
    }

    $published = $_POST['published'] ?? null;
    $existingSlug = $_POST['existing_slug'] ?? '';
    $postedSlug = $_POST['slug'] ?? '';

    return [
        'slug' => is_scalar($existingSlug) && (string) $existingSlug !== ''
            ? (string) $existingSlug
            : (is_scalar($postedSlug) ? trim((string) $postedSlug) : ''),
        'title' => is_scalar($_POST['title'] ?? null) ? trim((string) $_POST['title']) : '',
        'deck_slug' => is_scalar($_POST['deck_slug'] ?? null) ? trim((string) $_POST['deck_slug']) : '',
        'summary' => is_scalar($_POST['summary'] ?? null) ? trim((string) $_POST['summary']) : '',
        'status' => is_scalar($_POST['status'] ?? null) ? (string) $_POST['status'] : 'draft',
        'published' => is_scalar($published) && trim((string) $published) !== '' ? trim((string) $published) : null,
        'sections' => $sections,
    ];
}

/** @param array<string, mixed> $guide */
function admin_guides_sections(array $guide): array
{
    $sections = $guide['sections'] ?? [];
    return is_array($sections) && $sections !== [] ? $sections : [['heading' => '', 'body' => '']];
}

$error = null;
$notice = null;
$editing = null;
$formGuide = [
    'slug' => '',
    'title' => '',
    'deck_slug' => '',
    'summary' => '',
    'status' => 'draft',
    'published' => '',
    'sections' => [['heading' => '', 'body' => '']],
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = is_scalar($_POST['action'] ?? null) ? (string) $_POST['action'] : '';

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $error = 'The form expired. Please try again.';
    } elseif ($action === 'delete') {
        $slug = is_scalar($_POST['slug'] ?? null) ? (string) $_POST['slug'] : '';
        try {
            $repository->delete('guides', $slug);
            $notice = 'Guide sent back to the archives.';
        } catch (Throwable $exception) {
            $error = $exception->getMessage();
        }
    } elseif ($action === 'save') {
        $formGuide = admin_guides_input_from_post();
        $existingSlug = is_scalar($_POST['existing_slug'] ?? null) ? (string) $_POST['existing_slug'] : '';
        $editing = $existingSlug !== '' ? $existingSlug : null;
        try {
            $result = $repository->save('guides', $formGuide, admin_guides_actor_id($user));
            $notice = $result['created'] ? 'Guide added to the map.' : 'Guide notes sharpened.';
            $editing = null;
            $formGuide = [
                'slug' => '',
                'title' => '',
                'deck_slug' => '',
                'summary' => '',
                'status' => 'draft',
                'published' => '',
                'sections' => [['heading' => '', 'body' => '']],
            ];
        } catch (Throwable $exception) {
            $error = $exception->getMessage();
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && isset($_GET['edit'])) {
    $editing = is_scalar($_GET['edit']) ? (string) $_GET['edit'] : '';
    try {
        $formGuide = $repository->find('guides', $editing, true);
    } catch (Throwable $exception) {
        $editing = null;
        $error = $exception->getMessage();
    }
}

try {
    $guides = $repository->list('guides', 100, 0, true);
} catch (Throwable $exception) {
    $guides = [];
    $error ??= $exception->getMessage();
}

$qrScriptPath = dirname(__DIR__) . '/assets/js/admin-guide-qrcodes.js';
$qrScriptVersion = is_file($qrScriptPath) ? (string) filemtime($qrScriptPath) : '1';

admin_render_page(
    'Guides',
    static function () use ($guides, $editing, $formGuide, $error, $notice, $qrScriptVersion): void {
        $sections = admin_guides_sections($formGuide);
        ?>
        <section class="admin-hero" aria-labelledby="guides-title">
            <p class="admin-eyebrow">Guide library</p>
            <h1 id="guides-title">Guides with a clean trail.</h1>
            <p>Pair decks with concise summaries, ordered sections, and publish dates that make sense.</p>
        </section>

        <?php if ($notice !== null): ?>
            <section class="admin-panel" role="status">
                <p><?= admin_guides_h($notice) ?></p>
            </section>
        <?php endif; ?>

        <?php if ($error !== null): ?>
            <section class="admin-panel" role="alert">
                <p><?= admin_guides_h($error) ?></p>
            </section>
        <?php endif; ?>

        <section class="admin-panel" aria-labelledby="guide-form-title">
            <h2 id="guide-form-title"><?= $editing !== null ? 'Edit guide' : 'Add guide' ?></h2>
            <p>Keep each section focused; headings are the trail markers and body copy is the route.</p>
            <form method="post" action="/admin/guides.php">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <input type="hidden" name="existing_slug" value="<?= $editing !== null ? admin_guides_h($editing) : '' ?>">

                <label class="admin-field" for="slug">
                    <span>Slug</span>
                    <small>Lowercase words and hyphens; this stays locked while editing.</small>
                    <input id="slug" name="slug" type="text" value="<?= admin_guides_h($formGuide['slug'] ?? '') ?>" <?= $editing !== null ? 'readonly' : '' ?> required>
                </label>

                <label class="admin-field" for="title">
                    <span>Title</span>
                    <input id="title" name="title" type="text" value="<?= admin_guides_h($formGuide['title'] ?? '') ?>" required>
                </label>

                <label class="admin-field" for="deck_slug">
                    <span>Deck slug</span>
                    <small>Connect this guide to the deck it teaches.</small>
                    <input id="deck_slug" name="deck_slug" type="text" value="<?= admin_guides_h($formGuide['deck_slug'] ?? '') ?>" required>
                </label>

                <label class="admin-field" for="summary">
                    <span>Summary</span>
                    <small>Set the quick trailhead copy shown before the sections.</small>
                    <textarea id="summary" name="summary" rows="4" required><?= admin_guides_h($formGuide['summary'] ?? '') ?></textarea>
                </label>

                <label class="admin-field" for="status">
                    <span>Status</span>
                    <select id="status" name="status">
                        <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                            <option value="<?= admin_guides_h($status) ?>" <?= ($formGuide['status'] ?? 'draft') === $status ? 'selected' : '' ?>><?= admin_guides_h(ucfirst($status)) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <label class="admin-field" for="published">
                    <span>Published date</span>
                    <small>Optional date for when this guide should appear fresh.</small>
                    <input id="published" name="published" type="date" value="<?= admin_guides_h($formGuide['published'] ?? '') ?>">
                </label>

                <h3>Sections</h3>
                <?php foreach ($sections as $index => $section): ?>
                    <fieldset>
                        <legend>Section <?= (int) $index + 1 ?></legend>
                        <label class="admin-field" for="section_heading_<?= (int) $index ?>">
                            <span>Heading</span>
                            <input id="section_heading_<?= (int) $index ?>" name="section_heading[]" type="text" value="<?= admin_guides_h(is_array($section) ? ($section['heading'] ?? '') : '') ?>" required>
                        </label>
                        <label class="admin-field" for="section_body_<?= (int) $index ?>">
                            <span>Body</span>
                            <textarea id="section_body_<?= (int) $index ?>" name="section_body[]" rows="6" required><?= admin_guides_h(is_array($section) ? ($section['body'] ?? '') : '') ?></textarea>
                        </label>
                    </fieldset>
                <?php endforeach; ?>
                <fieldset>
                    <legend>New section</legend>
                    <label class="admin-field" for="section_heading_new">
                        <span>Heading</span>
                        <input id="section_heading_new" name="section_heading[]" type="text" value="">
                    </label>
                    <label class="admin-field" for="section_body_new">
                        <span>Body</span>
                        <textarea id="section_body_new" name="section_body[]" rows="6"></textarea>
                    </label>
                </fieldset>

                <div class="admin-action-row">
                    <button type="submit"><?= $editing !== null ? 'Update guide' : 'Create guide' ?></button>
                    <?php if ($editing !== null): ?>
                        <a class="admin-button admin-button-secondary" href="/admin/guides.php">Cancel editing</a>
                    <?php endif; ?>
                </div>
            </form>
        </section>

        <section class="admin-panel" aria-labelledby="guide-list-title">
            <h2 id="guide-list-title">Guide shelf</h2>
            <p>Check publish state, slug, and last update before opening a guide for edits.</p>
            <?php if ($guides === []): ?>
                <p>No guides yet. Draft the first trail marker above.</p>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Status</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Updated</th>
                        <th scope="col">Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($guides as $guide): ?>
                        <?php $slug = is_scalar($guide['slug'] ?? null) ? (string) $guide['slug'] : ''; ?>
                        <tr>
                            <td><?= admin_guides_h($guide['title'] ?? '') ?></td>
                            <td><?= admin_guides_h($guide['status'] ?? '') ?></td>
                            <td><?= admin_guides_h($slug) ?></td>
                            <td><?= admin_guides_h($guide['updated_at'] ?? '') ?></td>
                            <td>
                                <a class="admin-button admin-button-secondary" href="/admin/guides.php?edit=<?= rawurlencode($slug) ?>">Edit guide</a>
                                <form method="post" action="/admin/guides.php" class="admin-inline-form" onsubmit="return confirm('Delete this guide?');">
                                    <?= admin_csrf_field() ?>
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="slug" value="<?= admin_guides_h($slug) ?>">
                                    <button type="submit">Delete guide</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
            <?php endif; ?>
        </section>

        <?php if ($guides !== []): ?>
            <section class="admin-panel admin-qr-panel" aria-labelledby="guide-qr-title">
                <div class="admin-print-heading">
                    <p class="admin-eyebrow">Print labels</p>
                    <h2 id="guide-qr-title">Deck box QR labels</h2>
                    <p>Print one guide label for the deck box, plus the decklist label when the guide has a linked deck slug.</p>
                </div>
                <div class="admin-qr-label-grid">
                    <?php foreach ($guides as $guide): ?>
                        <?php
                        $guideSlug = is_scalar($guide['slug'] ?? null) ? (string) $guide['slug'] : '';
                        if ($guideSlug === '') {
                            continue;
                        }
                        $deckSlug = is_scalar($guide['deck_slug'] ?? null) ? (string) $guide['deck_slug'] : '';
                        $guideTitle = is_scalar($guide['title'] ?? null) && (string) $guide['title'] !== '' ? (string) $guide['title'] : $guideSlug;
                        $guideUrl = admin_guides_public_url('/decks/guide.php?slug=' . rawurlencode($guideSlug));
                        $deckUrl = $deckSlug !== '' ? admin_guides_public_url('/decks/deck.php?slug=' . rawurlencode($deckSlug)) : null;
                        ?>
                        <article class="admin-qr-label" aria-label="<?= admin_guides_h($guideTitle) ?> QR labels">
                            <header class="admin-qr-label-header">
                                <h3><?= admin_guides_h($guideTitle) ?></h3>
                                <p>Deck box scan labels</p>
                            </header>
                            <div class="admin-qr-pair">
                                <div class="admin-qr-item">
                                    <h4>Guide</h4>
                                    <div class="admin-qr-code" data-qr-code data-qr-target="<?= admin_guides_h($guideUrl) ?>" data-qr-title="<?= admin_guides_h($guideTitle) ?> guide QR">
                                        <span class="admin-qr-fallback">QR unavailable</span>
                                    </div>
                                    <p><?= admin_guides_h($guideUrl) ?></p>
                                </div>
                                <?php if ($deckUrl !== null): ?>
                                    <div class="admin-qr-item">
                                        <h4>Decklist</h4>
                                        <div class="admin-qr-code" data-qr-code data-qr-target="<?= admin_guides_h($deckUrl) ?>" data-qr-title="<?= admin_guides_h($guideTitle) ?> decklist QR">
                                            <span class="admin-qr-fallback">QR unavailable</span>
                                        </div>
                                        <p><?= admin_guides_h($deckUrl) ?></p>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </article>
                    <?php endforeach; ?>
                </div>
            </section>
        <?php endif; ?>

        <script src="/assets/js/admin-guide-qrcodes.js?v=<?= rawurlencode($qrScriptVersion) ?>" defer></script>
        <?php
    },
    $user,
);

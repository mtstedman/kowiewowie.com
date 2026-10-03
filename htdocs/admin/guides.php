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

/**
 * Sections for the editor form: the guide's saved (non-blank) sections in order, followed by
 * one blank pair so the form can add another section without JavaScript. Blank pairs are
 * skipped by admin_guides_input_from_post() when saving.
 *
 * @param array<string, mixed> $guide
 * @return list<array{heading: string, body: string}>
 */
function admin_guides_sections(array $guide): array
{
    $sections = [];
    $stored = $guide['sections'] ?? [];
    if (is_array($stored)) {
        foreach ($stored as $section) {
            if (!is_array($section)) {
                continue;
            }
            $heading = is_scalar($section['heading'] ?? null) ? (string) $section['heading'] : '';
            $body = is_scalar($section['body'] ?? null) ? (string) $section['body'] : '';
            if (trim($heading) === '' && trim($body) === '') {
                continue;
            }
            $sections[] = ['heading' => $heading, 'body' => $body];
        }
    }

    $sections[] = ['heading' => '', 'body' => ''];

    return $sections;
}

/** @return array<string, mixed> */
function admin_guides_blank(): array
{
    return [
        'slug' => '',
        'title' => '',
        'deck_slug' => '',
        'summary' => '',
        'status' => 'draft',
        'published' => '',
        'sections' => [],
    ];
}

function admin_guides_redirect(string $result): void
{
    header('Location: /admin/guides.php?' . http_build_query(['result' => $result]), true, 303);
    exit;
}

function admin_guides_status_option(string $value, string $label, string $current): void
{
    ?>
    <option value="<?= admin_guides_h($value) ?>"<?= $current === $value ? ' selected' : '' ?>><?= admin_guides_h($label) ?></option>
    <?php
}

/**
 * @param mixed $status
 * @return array{0: string, 1: string, 2: string} [css key, label, visitor-facing meaning]
 */
function admin_guides_status_text($status): array
{
    $status = is_scalar($status) ? (string) $status : '';

    return match ($status) {
        'draft' => ['draft', 'Draft', 'Hidden from visitors'],
        'published' => ['published', 'Published', 'Visible on the public site'],
        'archived' => ['archived', 'Archived', 'Hidden from visitors, kept for reference'],
        default => ['unknown', $status !== '' ? $status : 'Unknown', 'Unrecognised status'],
    };
}

/** @param array<string, mixed> $guide */
function admin_guides_name(array $guide): string
{
    foreach (['title', 'slug'] as $key) {
        $value = $guide[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }

    return 'Untitled guide';
}

function admin_guides_count_text(int $count): string
{
    if ($count === 0) {
        return 'No guides yet.';
    }
    if ($count >= 100) {
        return 'Showing the first ' . $count . ' guides.';
    }

    return $count === 1 ? 'Showing 1 guide.' : 'Showing ' . $count . ' guides.';
}

/** @param array<string, mixed> $guide */
function admin_guides_section_count(array $guide): int
{
    $sections = $guide['sections'] ?? null;

    return is_array($sections) ? count($sections) : 0;
}

$errors = [];
$notice = null;
$editing = null;
$mode = 'browse';
$failedAction = null;
$deleteGuide = null;
$formGuide = admin_guides_blank();

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Guide created.';
} elseif ($result === 'updated') {
    $notice = 'Guide changes saved.';
} elseif ($result === 'deleted') {
    $notice = 'Guide deleted.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = is_scalar($_POST['action'] ?? null) ? (string) $_POST['action'] : '';
    $failedAction = $action;

    if ($action === 'save') {
        $formGuide = admin_guides_input_from_post();
        $existingSlug = is_scalar($_POST['existing_slug'] ?? null) ? (string) $_POST['existing_slug'] : '';
        $editing = $existingSlug !== '' ? $existingSlug : null;
        $mode = $editing !== null ? 'edit' : 'create';
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'The form expired. Please try again.';
    } elseif ($action === 'delete') {
        $slug = is_scalar($_POST['slug'] ?? null) ? (string) $_POST['slug'] : '';
        try {
            $repository->delete('guides', $slug);
            admin_guides_redirect('deleted');
        } catch (Throwable $exception) {
            $errors[] = $exception->getMessage();
        }
    } elseif ($action === 'save') {
        try {
            $saveResult = $repository->save('guides', $formGuide, admin_guides_actor_id($user));
            admin_guides_redirect($saveResult['created'] ? 'created' : 'updated');
        } catch (Throwable $exception) {
            $errors[] = $exception->getMessage();
        }
    } else {
        $errors[] = 'Unknown guide action.';
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $edit = is_scalar($_GET['edit'] ?? null) ? trim((string) $_GET['edit']) : '';
    $delete = is_scalar($_GET['delete'] ?? null) ? trim((string) $_GET['delete']) : '';
    if ($edit !== '') {
        try {
            $formGuide = $repository->find('guides', $edit, true);
            $editing = is_scalar($formGuide['slug'] ?? null) && (string) $formGuide['slug'] !== '' ? (string) $formGuide['slug'] : $edit;
            $mode = 'edit';
        } catch (Throwable $exception) {
            $editing = null;
            $formGuide = admin_guides_blank();
            $errors[] = $exception->getMessage();
            $failedAction = 'load';
        }
    } elseif ($delete !== '') {
        try {
            $deleteGuide = $repository->find('guides', $delete, true);
            $mode = 'delete';
        } catch (Throwable $exception) {
            $errors[] = $exception->getMessage();
            $failedAction = 'load';
        }
    } elseif (($_GET['new'] ?? null) === '1') {
        $mode = 'create';
    }
}

try {
    $guides = $repository->list('guides', 100, 0, true);
} catch (Throwable $exception) {
    $guides = [];
    $errors[] = $exception->getMessage();
}

$qrScriptPath = dirname(__DIR__) . '/assets/js/admin-guide-qrcodes.js';
$qrScriptVersion = is_file($qrScriptPath) ? (string) filemtime($qrScriptPath) : '1';
$editorScriptPath = dirname(__DIR__) . '/assets/js/admin-guides.js';
$editorScriptVersion = is_file($editorScriptPath) ? (string) filemtime($editorScriptPath) : '1';

admin_render_page(
    'Guides',
    static function () use ($guides, $editing, $formGuide, $errors, $notice, $mode, $failedAction, $deleteGuide, $qrScriptVersion, $editorScriptVersion): void {
        $isEditor = $mode === 'create' || $mode === 'edit';
        $sections = admin_guides_sections($formGuide);
        $editorName = admin_guides_name($formGuide);
        $currentStatus = is_scalar($formGuide['status'] ?? null) ? (string) $formGuide['status'] : 'draft';
        $deleteSlug = $deleteGuide !== null && is_scalar($deleteGuide['slug'] ?? null) ? (string) $deleteGuide['slug'] : '';

        if ($failedAction === 'save') {
            $errorTitle = 'Guide not saved';
            $errorHelp = 'Nothing was saved. Your entries, including every section, are still in the form below; fix the problems listed and save again.';
        } elseif ($failedAction === 'delete') {
            $errorTitle = 'Guide not deleted';
            $errorHelp = 'The guide was left unchanged. Check the list below and try again.';
        } else {
            $errorTitle = 'Something needs attention';
            $errorHelp = 'Return to the guide list and try again. If the problem continues, refresh the page.';
        }
        ?>
        <section class="admin-hero" aria-labelledby="guides-title">
            <p class="admin-eyebrow">Content manager</p>
            <h1 id="guides-title">Guides</h1>
            <p>Pair decks with concise summaries, ordered sections, and publish dates that make sense.</p>
        </section>

        <?php if ($notice !== null): ?>
            <div class="admin-panel admin-notice admin-notice-success" role="status">
                <p><?= admin_guides_h($notice) ?></p>
            </div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel admin-notice admin-notice-error" role="alert" aria-labelledby="guides-errors-title">
                <h2 id="guides-errors-title"><?= admin_guides_h($errorTitle) ?></h2>
                <p><?= admin_guides_h($errorHelp) ?></p>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_guides_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($mode === 'delete' && $deleteGuide !== null): ?>
            <?php $deleteName = admin_guides_name($deleteGuide); ?>
            <section class="admin-panel admin-confirm" id="guides-delete" aria-labelledby="guides-delete-title">
                <p class="admin-eyebrow">Confirm deletion</p>
                <h2 id="guides-delete-title">Delete &ldquo;<?= admin_guides_h($deleteName) ?>&rdquo;?</h2>
                <p>This permanently removes the guide <code><?= admin_guides_h($deleteSlug) ?></code> and all of its sections from the admin and the public site. Printed QR labels for this guide will stop working. It cannot be undone.</p>
                <p>To hide it from visitors but keep it, <a href="/admin/guides.php?<?= admin_guides_h(http_build_query(['edit' => $deleteSlug])) ?>#guides-editor">edit the guide</a> and set its status to Archived instead.</p>
                <form method="post" action="/admin/guides.php" class="admin-form admin-confirm-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="slug" value="<?= admin_guides_h($deleteSlug) ?>">
                    <div class="admin-action-row">
                        <button type="submit" class="admin-button-danger">Delete &ldquo;<?= admin_guides_h($deleteName) ?>&rdquo;</button>
                        <a class="admin-button admin-button-secondary" href="/admin/guides.php">Cancel, keep guide</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <?php if ($isEditor): ?>
            <section class="admin-panel admin-editor" id="guides-editor" aria-labelledby="guides-form-title">
                <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Editing guide' : 'New guide' ?></p>
                <h2 id="guides-form-title">
                    <?php if ($mode === 'edit'): ?>
                        Edit &ldquo;<?= admin_guides_h($editorName) ?>&rdquo;
                    <?php else: ?>
                        Add a guide
                    <?php endif; ?>
                </h2>
                <p>Fields marked required must be filled in before saving. Keep each section focused; headings are the trail markers and body copy is the route.</p>
                <form method="post" action="/admin/guides.php" class="admin-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="save">
                    <input type="hidden" name="existing_slug" value="<?= $editing !== null ? admin_guides_h($editing) : '' ?>">

                    <fieldset class="admin-fieldset">
                        <legend>Basics</legend>

                        <?php if ($editing !== null): ?>
                            <div class="admin-field admin-field-locked">
                                <span class="admin-field-label">Slug (locked)</span>
                                <p class="admin-locked-value"><code><?= admin_guides_h($editing) ?></code></p>
                                <small>Slugs are locked after creation so guide links and printed QR labels keep working. To use a different URL, create a new guide and delete this one.</small>
                            </div>
                        <?php else: ?>
                            <div class="admin-field">
                                <label for="guides-slug">Slug <span class="admin-required">(required)</span></label>
                                <small id="guides-slug-help">Lowercase letters, numbers, and single hyphens, for example <code>mono-red-primer</code>. This becomes the guide URL and is locked once the guide is created.</small>
                                <input id="guides-slug" name="slug" type="text" value="<?= admin_guides_h($formGuide['slug'] ?? '') ?>" required aria-describedby="guides-slug-help">
                            </div>
                        <?php endif; ?>

                        <div class="admin-field">
                            <label for="guides-title-input">Title <span class="admin-required">(required)</span></label>
                            <input id="guides-title-input" name="title" type="text" value="<?= admin_guides_h($formGuide['title'] ?? '') ?>" required>
                        </div>

                        <div class="admin-field">
                            <label for="guides-summary">Summary <span class="admin-required">(required)</span></label>
                            <small id="guides-summary-help">The quick trailhead copy shown before the sections.</small>
                            <textarea id="guides-summary" name="summary" rows="4" required aria-describedby="guides-summary-help"><?= admin_guides_h($formGuide['summary'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Deck link</legend>

                        <div class="admin-field">
                            <label for="guides-deck-slug">Deck slug <span class="admin-required">(required)</span></label>
                            <small id="guides-deck-slug-help">The slug of the deck this guide teaches. It links the guide to its decklist and adds a decklist QR label.</small>
                            <input id="guides-deck-slug" name="deck_slug" type="text" value="<?= admin_guides_h($formGuide['deck_slug'] ?? '') ?>" required aria-describedby="guides-deck-slug-help">
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset admin-guide-sections" data-guide-sections aria-describedby="guides-sections-help">
                        <legend>Sections</legend>
                        <small id="guides-sections-help">Sections appear on the guide in the order shown. A section with both heading and body left blank is skipped when saving.</small>
                        <p class="admin-guide-sections-fallback" data-guide-sections-fallback>To remove a section, clear both its heading and body. To add a section, fill in the blank one at the end; after saving, another blank section is offered.</p>

                        <ol class="admin-guide-section-list" data-guide-section-list data-next-index="<?= count($sections) ?>">
                            <?php foreach ($sections as $index => $section): ?>
                                <?php $isTrailingBlank = $index === count($sections) - 1; ?>
                                <li class="admin-guide-section" data-guide-section>
                                    <fieldset class="admin-fieldset admin-guide-section-fields">
                                        <legend data-guide-section-legend><?= $isTrailingBlank ? 'New section (optional)' : 'Section ' . ((int) $index + 1) ?></legend>
                                        <div class="admin-field">
                                            <label for="guides-section-heading-<?= (int) $index ?>">Heading</label>
                                            <input id="guides-section-heading-<?= (int) $index ?>" name="section_heading[]" type="text" value="<?= admin_guides_h($section['heading']) ?>" data-guide-section-heading>
                                        </div>
                                        <div class="admin-field">
                                            <label for="guides-section-body-<?= (int) $index ?>">Body</label>
                                            <textarea id="guides-section-body-<?= (int) $index ?>" name="section_body[]" rows="6" data-guide-section-body><?= admin_guides_h($section['body']) ?></textarea>
                                        </div>
                                        <div class="admin-action-row admin-guide-section-tools" data-guide-section-tools hidden></div>
                                    </fieldset>
                                </li>
                            <?php endforeach; ?>
                        </ol>

                        <p class="admin-empty admin-guide-sections-empty" data-guide-sections-empty hidden>No sections yet. Add a section to start the guide.</p>

                        <div class="admin-notice admin-guide-section-undo" data-guide-section-undo hidden>
                            <p data-guide-section-undo-text></p>
                            <button type="button" class="admin-button-secondary" data-guide-section-undo-button>Undo remove</button>
                        </div>

                        <div class="admin-action-row" data-guide-section-actions hidden>
                            <button type="button" class="admin-button-secondary" data-guide-section-add>Add section</button>
                        </div>

                        <p class="admin-guide-section-status" data-guide-section-status role="status" aria-live="polite"></p>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Publishing</legend>

                        <div class="admin-field">
                            <label for="guides-status">Status</label>
                            <small id="guides-status-help">Draft and Archived guides are hidden from visitors. Published guides appear on the public site.</small>
                            <select id="guides-status" name="status" aria-describedby="guides-status-help">
                                <?php admin_guides_status_option('draft', 'Draft - Hidden from visitors', $currentStatus); ?>
                                <?php admin_guides_status_option('published', 'Published - Visible on the public site', $currentStatus); ?>
                                <?php admin_guides_status_option('archived', 'Archived - Hidden from visitors, kept for reference', $currentStatus); ?>
                            </select>
                        </div>

                        <div class="admin-field">
                            <label for="guides-published">Published date <span class="admin-optional">(optional)</span></label>
                            <small id="guides-published-help">The date shown on the guide. Leave blank if it has no publish date yet.</small>
                            <input id="guides-published" name="published" type="date" value="<?= admin_guides_h($formGuide['published'] ?? '') ?>" aria-describedby="guides-published-help">
                        </div>
                    </fieldset>

                    <div class="admin-action-row">
                        <button type="submit"><?= $mode === 'edit' ? 'Save changes' : 'Create guide' ?></button>
                        <a class="admin-button admin-button-secondary" href="/admin/guides.php">Cancel</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <section class="admin-panel admin-records" id="guides-list" aria-labelledby="guides-list-title">
            <div class="admin-records-header">
                <div>
                    <h2 id="guides-list-title">All guides</h2>
                    <p id="guides-list-count"><?= admin_guides_h(admin_guides_count_text(count($guides))) ?></p>
                </div>
                <?php if ($mode !== 'create' && $guides !== []): ?>
                    <a class="admin-button" href="/admin/guides.php?new=1#guides-editor">Add guide</a>
                <?php endif; ?>
            </div>

            <?php if ($guides === []): ?>
                <div class="admin-empty">
                    <?php if ($mode === 'create'): ?>
                        <p>Fill in the form above to add the first guide.</p>
                    <?php else: ?>
                        <p>The guide library is empty. Add a guide to start the trail.</p>
                        <a class="admin-button" href="/admin/guides.php?new=1#guides-editor">Add the first guide</a>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table admin-records-table" aria-labelledby="guides-list-title" aria-describedby="guides-list-count">
                    <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Deck</th>
                        <th scope="col">Status</th>
                        <th scope="col">Sections</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Updated</th>
                        <th scope="col">Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($guides as $guide): ?>
                        <?php
                        $slug = is_scalar($guide['slug'] ?? null) ? (string) $guide['slug'] : '';
                        $name = admin_guides_name($guide);
                        $deckSlug = is_scalar($guide['deck_slug'] ?? null) ? (string) $guide['deck_slug'] : '';
                        [$statusKey, $statusLabel, $statusMeaning] = admin_guides_status_text($guide['status'] ?? '');
                        $isCurrent = ($mode === 'edit' && $slug === $editing) || ($mode === 'delete' && $slug === $deleteSlug);
                        ?>
                        <tr<?= $isCurrent ? ' class="admin-record-current" aria-current="true"' : '' ?>>
                            <th scope="row" class="admin-record-title"><?= admin_guides_h($name) ?></th>
                            <td><?= $deckSlug !== '' ? '<code>' . admin_guides_h($deckSlug) . '</code>' : 'No deck linked' ?></td>
                            <td>
                                <span class="admin-status admin-status-<?= admin_guides_h($statusKey) ?>"><?= admin_guides_h($statusLabel) ?></span>
                                <small class="admin-status-help"><?= admin_guides_h($statusMeaning) ?></small>
                            </td>
                            <td><?= admin_guides_section_count($guide) ?></td>
                            <td><code><?= admin_guides_h($slug) ?></code></td>
                            <td><?= admin_guides_h($guide['updated_at'] ?? '') ?></td>
                            <td class="admin-record-actions">
                                <a class="admin-button admin-button-secondary" href="/admin/guides.php?<?= admin_guides_h(http_build_query(['edit' => $slug])) ?>#guides-editor" aria-label="Edit guide &ldquo;<?= admin_guides_h($name) ?>&rdquo;">Edit</a>
                                <a class="admin-button admin-button-secondary admin-button-danger" href="/admin/guides.php?<?= admin_guides_h(http_build_query(['delete' => $slug])) ?>#guides-delete" aria-label="Delete guide &ldquo;<?= admin_guides_h($name) ?>&rdquo;">Delete</a>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
                <p class="admin-records-footnote">Need deck box labels? <a href="#guides-qr">Print QR labels</a> for every guide below.</p>
            <?php endif; ?>
        </section>

        <?php if ($guides !== []): ?>
            <section class="admin-panel admin-qr-panel" id="guides-qr" aria-labelledby="guide-qr-title" aria-describedby="guide-qr-help" data-qr-panel>
                <div class="admin-print-heading">
                    <p class="admin-eyebrow">Secondary tool &middot; Print labels</p>
                    <h2 id="guide-qr-title">Deck box QR labels</h2>
                    <p id="guide-qr-help">Print one guide label for the deck box, plus a decklist label when the guide has a linked deck slug. Each label also shows its link in plain text.</p>
                </div>
                <div class="admin-action-row admin-qr-actions" data-qr-actions hidden>
                    <button type="button" data-qr-print>Print labels</button>
                </div>
                <p class="admin-qr-status" data-qr-status role="status" aria-live="polite"></p>
                <noscript>
                    <p class="admin-qr-status">QR codes and the Print labels button need JavaScript. The plain-text link under each label still works, and you can print this page from your browser menu.</p>
                </noscript>
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
                                        <span class="admin-qr-fallback">QR code not generated; use the link below.</span>
                                    </div>
                                    <p><?= admin_guides_h($guideUrl) ?></p>
                                </div>
                                <?php if ($deckUrl !== null): ?>
                                    <div class="admin-qr-item">
                                        <h4>Decklist</h4>
                                        <div class="admin-qr-code" data-qr-code data-qr-target="<?= admin_guides_h($deckUrl) ?>" data-qr-title="<?= admin_guides_h($guideTitle) ?> decklist QR">
                                            <span class="admin-qr-fallback">QR code not generated; use the link below.</span>
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

        <?php if ($isEditor): ?>
            <script src="/assets/js/admin-guides.js?v=<?= rawurlencode($editorScriptVersion) ?>" defer></script>
        <?php endif; ?>
        <script src="/assets/js/admin-guide-qrcodes.js?v=<?= rawurlencode($qrScriptVersion) ?>" defer></script>
        <?php
    },
    $user,
);

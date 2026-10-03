<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$errors = [];
$notice = null;
$musicEntries = [];
$editingSlug = null;

/** @param mixed $value */
function admin_music_h($value): string
{
    return htmlspecialchars(is_scalar($value) ? (string) $value : '', ENT_QUOTES, 'UTF-8');
}

/** @return array<string, mixed> */
function admin_music_blank(): array
{
    return [
        'slug' => '',
        'title' => '',
        'artist' => '',
        'spotify_url' => '',
        'notes' => '',
        'status' => 'draft',
    ];
}

/** @param array<string, mixed> $source @return array<string, mixed> */
function admin_music_input_from_post(array $source, ?string $fixedSlug): array
{
    return [
        'slug' => $fixedSlug ?? ($source['slug'] ?? ''),
        'title' => $source['title'] ?? '',
        'artist' => $source['artist'] ?? '',
        'spotify_url' => $source['spotify_url'] ?? '',
        'notes' => $source['notes'] ?? '',
        'status' => $source['status'] ?? 'draft',
    ];
}

/** @param array<string, mixed> $user */
function admin_music_actor_id(array $user): ?string
{
    foreach (['id', 'user_id', 'sub'] as $key) {
        $value = $user[$key] ?? null;
        if (is_scalar($value) && (string) $value !== '') {
            return (string) $value;
        }
    }

    return null;
}

function admin_music_redirect(string $result): void
{
    header('Location: /admin/music.php?' . http_build_query(['result' => $result]), true, 303);
    exit;
}

function admin_music_status_option(string $value, string $label, string $current): void
{
    ?>
    <option value="<?= admin_music_h($value) ?>"<?= $current === $value ? ' selected' : '' ?>><?= admin_music_h($label) ?></option>
    <?php
}

/**
 * @param mixed $status
 * @return array{0: string, 1: string, 2: string} [css key, label, visitor-facing meaning]
 */
function admin_music_status_text($status): array
{
    $status = is_scalar($status) ? (string) $status : '';

    return match ($status) {
        'draft' => ['draft', 'Draft', 'Hidden from visitors'],
        'published' => ['published', 'Published', 'Visible on the public site'],
        'archived' => ['archived', 'Archived', 'Hidden from visitors, kept for reference'],
        default => ['unknown', $status !== '' ? $status : 'Unknown', 'Unrecognised status'],
    };
}

/** @param array<string, mixed> $entry */
function admin_music_name(array $entry): string
{
    foreach (['title', 'slug'] as $key) {
        $value = $entry[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }

    return 'Untitled track';
}

function admin_music_count_text(int $count): string
{
    if ($count === 0) {
        return 'No music entries yet.';
    }
    if ($count >= 100) {
        return 'Showing the first ' . $count . ' music entries.';
    }

    return $count === 1 ? 'Showing 1 music entry.' : 'Showing ' . $count . ' music entries.';
}

$formMusic = admin_music_blank();
$mode = 'browse';
$failedAction = null;
$deleteMusic = null;

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Music entry created.';
} elseif ($result === 'updated') {
    $notice = 'Music entry changes saved.';
} elseif ($result === 'deleted') {
    $notice = 'Music entry deleted.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $failedAction = $action;

    if ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formMusic = admin_music_input_from_post($_POST, $editingSlug);
        $mode = $editingSlug === null ? 'create' : 'edit';
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        try {
            if ($editingSlug !== null) {
                $repository->find('music', $editingSlug, true);
            }
            $repository->save('music', $formMusic, admin_music_actor_id($user));
            admin_music_redirect($editingSlug === null ? 'created' : 'updated');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } elseif ($action === 'delete') {
        $slug = trim(is_string($_POST['slug'] ?? null) ? $_POST['slug'] : '');

        try {
            $repository->delete('music', $slug);
            admin_music_redirect('deleted');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } else {
        $errors[] = 'Unknown music action.';
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $edit = trim(is_string($_GET['edit'] ?? null) ? $_GET['edit'] : '');
    $delete = trim(is_string($_GET['delete'] ?? null) ? $_GET['delete'] : '');
    if ($edit !== '') {
        try {
            $formMusic = $repository->find('music', $edit, true);
            $editingSlug = is_scalar($formMusic['slug'] ?? null) ? (string) $formMusic['slug'] : $edit;
            $mode = 'edit';
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $failedAction = 'load';
        }
    } elseif ($delete !== '') {
        try {
            $deleteMusic = $repository->find('music', $delete, true);
            $mode = 'delete';
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $failedAction = 'load';
        }
    } elseif (($_GET['new'] ?? null) === '1') {
        $mode = 'create';
    }
}

try {
    $musicEntries = $repository->list('music', 100, 0, true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Music',
    static function () use ($musicEntries, $formMusic, $editingSlug, $errors, $notice, $mode, $failedAction, $deleteMusic): void {
        $isEditor = $mode === 'create' || $mode === 'edit';
        $editorName = admin_music_name($formMusic);
        $currentStatus = is_scalar($formMusic['status'] ?? null) ? (string) $formMusic['status'] : 'draft';
        $deleteSlug = $deleteMusic !== null && is_scalar($deleteMusic['slug'] ?? null) ? (string) $deleteMusic['slug'] : '';

        if ($failedAction === 'save') {
            $errorTitle = 'Music entry not saved';
            $errorHelp = 'Nothing was saved. Your entries are still in the form below; fix the problems listed and save again.';
        } elseif ($failedAction === 'delete') {
            $errorTitle = 'Music entry not deleted';
            $errorHelp = 'The entry was left unchanged. Check the list below and try again.';
        } else {
            $errorTitle = 'Something needs attention';
            $errorHelp = 'Return to the music list and try again. If the problem continues, refresh the page.';
        }
        ?>
        <section class="admin-hero" aria-labelledby="music-title">
            <p class="admin-eyebrow">Content manager</p>
            <h1 id="music-title">Music</h1>
            <p>Curate the tracks, artists, Spotify links, and notes shown on the public music shelf.</p>
        </section>

        <?php if ($notice !== null): ?>
            <div class="admin-panel admin-notice admin-notice-success" role="status">
                <p><?= admin_music_h($notice) ?></p>
            </div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel admin-notice admin-notice-error" role="alert" aria-labelledby="music-errors-title">
                <h2 id="music-errors-title"><?= admin_music_h($errorTitle) ?></h2>
                <p><?= admin_music_h($errorHelp) ?></p>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_music_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($mode === 'delete' && $deleteMusic !== null): ?>
            <?php $deleteName = admin_music_name($deleteMusic); ?>
            <section class="admin-panel admin-confirm" id="music-delete" aria-labelledby="music-delete-title">
                <p class="admin-eyebrow">Confirm deletion</p>
                <h2 id="music-delete-title">Delete &ldquo;<?= admin_music_h($deleteName) ?>&rdquo;?</h2>
                <p>This permanently removes the music entry <code><?= admin_music_h($deleteSlug) ?></code> from the admin and the public site. It cannot be undone.</p>
                <p>To hide it from visitors but keep it, <a href="/admin/music.php?<?= admin_music_h(http_build_query(['edit' => $deleteSlug])) ?>#music-editor">edit the entry</a> and set its status to Archived instead.</p>
                <form method="post" action="/admin/music.php" class="admin-form admin-confirm-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="slug" value="<?= admin_music_h($deleteSlug) ?>">
                    <div class="admin-action-row">
                        <button type="submit" class="admin-button-danger">Delete &ldquo;<?= admin_music_h($deleteName) ?>&rdquo;</button>
                        <a class="admin-button admin-button-secondary" href="/admin/music.php">Cancel, keep entry</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <?php if ($isEditor): ?>
            <section class="admin-panel admin-editor" id="music-editor" aria-labelledby="music-form-title">
                <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Editing music entry' : 'New music entry' ?></p>
                <h2 id="music-form-title">
                    <?php if ($mode === 'edit'): ?>
                        Edit &ldquo;<?= admin_music_h($editorName) ?>&rdquo;
                    <?php else: ?>
                        Add a music entry
                    <?php endif; ?>
                </h2>
                <p>Fields marked required must be filled in before saving.</p>
                <form method="post" action="/admin/music.php" class="admin-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="save">
                    <input type="hidden" name="original_slug" value="<?= admin_music_h($editingSlug ?? '') ?>">

                    <fieldset class="admin-fieldset">
                        <legend>Track</legend>

                        <?php if ($editingSlug !== null): ?>
                            <div class="admin-field admin-field-locked">
                                <span class="admin-field-label">Slug (locked)</span>
                                <p class="admin-locked-value"><code><?= admin_music_h($editingSlug) ?></code></p>
                                <small>Slugs are locked after creation so existing links keep working. To use a different URL, create a new entry and delete this one.</small>
                            </div>
                        <?php else: ?>
                            <div class="admin-field">
                                <label for="music-slug">Slug <span class="admin-required">(required)</span></label>
                                <small id="music-slug-help">Lowercase letters, numbers, and hyphens, for example <code>artist-song-title</code>. This is the entry's stable handle and is locked once the entry is created.</small>
                                <input id="music-slug" name="slug" value="<?= admin_music_h($formMusic['slug'] ?? '') ?>" required aria-describedby="music-slug-help">
                            </div>
                        <?php endif; ?>

                        <div class="admin-field">
                            <label for="music-title-input">Title <span class="admin-required">(required)</span></label>
                            <input id="music-title-input" name="title" value="<?= admin_music_h($formMusic['title'] ?? '') ?>" required>
                        </div>

                        <div class="admin-field">
                            <label for="music-artist">Artist <span class="admin-required">(required)</span></label>
                            <input id="music-artist" name="artist" value="<?= admin_music_h($formMusic['artist'] ?? '') ?>" required>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Listening link and notes</legend>

                        <div class="admin-field">
                            <label for="music-spotify-url">Spotify URL <span class="admin-required">(required)</span></label>
                            <small id="music-spotify-url-help">Paste the full track, album, or playlist URL visitors should open, starting with https://.</small>
                            <input id="music-spotify-url" name="spotify_url" type="url" value="<?= admin_music_h($formMusic['spotify_url'] ?? '') ?>" required aria-describedby="music-spotify-url-help">
                        </div>

                        <div class="admin-field">
                            <label for="music-notes">Notes <span class="admin-optional">(optional)</span></label>
                            <small id="music-notes-help">Why the track belongs here, or when it is best played.</small>
                            <textarea id="music-notes" name="notes" rows="5" aria-describedby="music-notes-help"><?= admin_music_h($formMusic['notes'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Publishing</legend>

                        <div class="admin-field">
                            <label for="music-status">Status</label>
                            <small id="music-status-help">Draft and Archived entries are hidden from visitors. Published entries appear on the public music shelf.</small>
                            <select id="music-status" name="status" aria-describedby="music-status-help">
                                <?php admin_music_status_option('draft', 'Draft - Hidden from visitors', $currentStatus); ?>
                                <?php admin_music_status_option('published', 'Published - Visible on the public site', $currentStatus); ?>
                                <?php admin_music_status_option('archived', 'Archived - Hidden from visitors, kept for reference', $currentStatus); ?>
                            </select>
                        </div>
                    </fieldset>

                    <div class="admin-action-row">
                        <button type="submit"><?= $mode === 'edit' ? 'Save changes' : 'Create music entry' ?></button>
                        <a class="admin-button admin-button-secondary" href="/admin/music.php">Cancel</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <section class="admin-panel admin-records" id="music-list" aria-labelledby="music-list-title">
            <div class="admin-records-header">
                <div>
                    <h2 id="music-list-title">All music entries</h2>
                    <p id="music-list-count"><?= admin_music_h(admin_music_count_text(count($musicEntries))) ?></p>
                </div>
                <?php if ($mode !== 'create' && $musicEntries !== []): ?>
                    <a class="admin-button" href="/admin/music.php?new=1#music-editor">Add music entry</a>
                <?php endif; ?>
            </div>

            <?php if ($musicEntries === []): ?>
                <div class="admin-empty">
                    <?php if ($mode === 'create'): ?>
                        <p>Fill in the form above to add the first music entry.</p>
                    <?php else: ?>
                        <p>The listening shelf is empty. Add a track to start the queue.</p>
                        <a class="admin-button" href="/admin/music.php?new=1#music-editor">Add the first music entry</a>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table admin-records-table" aria-labelledby="music-list-title" aria-describedby="music-list-count">
                    <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Artist</th>
                        <th scope="col">Status</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($musicEntries as $entry): ?>
                        <?php
                        $slug = is_scalar($entry['slug'] ?? null) ? (string) $entry['slug'] : '';
                        $name = admin_music_name($entry);
                        [$statusKey, $statusLabel, $statusMeaning] = admin_music_status_text($entry['status'] ?? '');
                        $isCurrent = ($mode === 'edit' && $slug === $editingSlug) || ($mode === 'delete' && $slug === $deleteSlug);
                        ?>
                        <tr<?= $isCurrent ? ' class="admin-record-current" aria-current="true"' : '' ?>>
                            <th scope="row" class="admin-record-title"><?= admin_music_h($name) ?></th>
                            <td><?= admin_music_h($entry['artist'] ?? '') ?></td>
                            <td>
                                <span class="admin-status admin-status-<?= admin_music_h($statusKey) ?>"><?= admin_music_h($statusLabel) ?></span>
                                <small class="admin-status-help"><?= admin_music_h($statusMeaning) ?></small>
                            </td>
                            <td><code><?= admin_music_h($slug) ?></code></td>
                            <td class="admin-record-actions">
                                <a class="admin-button admin-button-secondary" href="/admin/music.php?<?= admin_music_h(http_build_query(['edit' => $slug])) ?>#music-editor" aria-label="Edit music entry &ldquo;<?= admin_music_h($name) ?>&rdquo;">Edit</a>
                                <a class="admin-button admin-button-secondary admin-button-danger" href="/admin/music.php?<?= admin_music_h(http_build_query(['delete' => $slug])) ?>#music-delete" aria-label="Delete music entry &ldquo;<?= admin_music_h($name) ?>&rdquo;">Delete</a>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
            <?php endif; ?>
        </section>
        <?php
    },
    $user,
);

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

$formMusic = admin_music_blank();

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Music entry created.';
} elseif ($result === 'updated') {
    $notice = 'Music entry updated.';
} elseif ($result === 'deleted') {
    $notice = 'Music entry deleted.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formMusic = admin_music_input_from_post($_POST, $editingSlug);

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
    if ($edit !== '') {
        try {
            $formMusic = $repository->find('music', $edit, true);
            $editingSlug = is_scalar($formMusic['slug'] ?? null) ? (string) $formMusic['slug'] : $edit;
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    }
}

try {
    $musicEntries = $repository->list('music', 100, 0, true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Music',
    static function () use ($musicEntries, $formMusic, $editingSlug, $errors, $notice): void {
        $formTitle = $editingSlug === null ? 'Add music entry' : 'Edit music entry';
        $submitLabel = $editingSlug === null ? 'Create music entry' : 'Update music entry';
        $currentStatus = is_scalar($formMusic['status'] ?? null) ? (string) $formMusic['status'] : 'draft';
        ?>
        <section class="admin-hero" aria-labelledby="music-title">
            <p class="admin-eyebrow">Content management</p>
            <h1 id="music-title">Music</h1>
        </section>

        <?php if ($notice !== null): ?>
            <section class="admin-panel" role="status">
                <p><?= admin_music_h($notice) ?></p>
            </section>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <section class="admin-panel" role="alert" aria-labelledby="music-errors-title">
                <h2 id="music-errors-title">Unable to save changes</h2>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_music_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </section>
        <?php endif; ?>

        <section class="admin-panel" aria-labelledby="music-list-title">
            <h2 id="music-list-title">Existing music</h2>
            <?php if ($musicEntries === []): ?>
                <p>No music entries have been created yet.</p>
            <?php else: ?>
                <table>
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
                        <?php $slug = is_scalar($entry['slug'] ?? null) ? (string) $entry['slug'] : ''; ?>
                        <tr>
                            <td><?= admin_music_h($entry['title'] ?? '') ?></td>
                            <td><?= admin_music_h($entry['artist'] ?? '') ?></td>
                            <td><?= admin_music_h($entry['status'] ?? '') ?></td>
                            <td><code><?= admin_music_h($slug) ?></code></td>
                            <td>
                                <a class="admin-button" href="/admin/music.php?<?= http_build_query(['edit' => $slug]) ?>">Edit</a>
                                <form method="post" class="admin-inline-form">
                                    <?= admin_csrf_field() ?>
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="slug" value="<?= admin_music_h($slug) ?>">
                                    <button type="submit">Delete</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </section>

        <section class="admin-panel" aria-labelledby="music-form-title">
            <h2 id="music-form-title"><?= admin_music_h($formTitle) ?></h2>
            <form method="post" class="admin-form">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <input type="hidden" name="original_slug" value="<?= admin_music_h($editingSlug ?? '') ?>">

                <label>
                    Slug
                    <input name="slug" value="<?= admin_music_h($formMusic['slug'] ?? '') ?>"<?= $editingSlug === null ? ' required' : ' readonly' ?>>
                </label>

                <label>
                    Title
                    <input name="title" value="<?= admin_music_h($formMusic['title'] ?? '') ?>" required>
                </label>

                <label>
                    Artist
                    <input name="artist" value="<?= admin_music_h($formMusic['artist'] ?? '') ?>" required>
                </label>

                <label>
                    Spotify URL
                    <input name="spotify_url" type="url" value="<?= admin_music_h($formMusic['spotify_url'] ?? '') ?>" required>
                </label>

                <label>
                    Notes
                    <textarea name="notes" rows="5"><?= admin_music_h($formMusic['notes'] ?? '') ?></textarea>
                </label>

                <label>
                    Status
                    <select name="status">
                        <?php admin_music_status_option('draft', 'Draft', $currentStatus); ?>
                        <?php admin_music_status_option('published', 'Published', $currentStatus); ?>
                        <?php admin_music_status_option('archived', 'Archived', $currentStatus); ?>
                    </select>
                </label>

                <button type="submit"><?= admin_music_h($submitLabel) ?></button>
                <?php if ($editingSlug !== null): ?>
                    <a class="admin-button" href="/admin/music.php">Cancel</a>
                <?php endif; ?>
            </form>
        </section>
        <?php
    },
    $user,
);

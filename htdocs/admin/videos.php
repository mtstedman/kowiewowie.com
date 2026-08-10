<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

admin_bootstrap_start_session();

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$errors = [];
$notice = null;
$videoEntries = [];
$editingSlug = null;

/** @param mixed $value */
function admin_videos_h($value): string
{
    return htmlspecialchars(is_scalar($value) ? (string) $value : '', ENT_QUOTES, 'UTF-8');
}

/** @return array<string, mixed> */
function admin_videos_blank(): array
{
    return [
        'slug' => '',
        'title' => '',
        'description' => '',
        'youtube_id' => '',
        'channel_title' => '',
        'thumbnail_url' => '',
        'duration_seconds' => '',
        'view_count' => '0',
        'tags' => '',
        'status' => 'draft',
        'published_at' => '',
    ];
}

/** @param array<string, mixed> $source @return array<string, mixed> */
function admin_videos_input_from_post(array $source, ?string $fixedSlug): array
{
    return [
        'slug' => $fixedSlug ?? ($source['slug'] ?? ''),
        'title' => $source['title'] ?? '',
        'description' => $source['description'] ?? '',
        'youtube_id' => $source['youtube_id'] ?? '',
        'channel_title' => $source['channel_title'] ?? '',
        'thumbnail_url' => $source['thumbnail_url'] ?? '',
        'duration_seconds' => $source['duration_seconds'] ?? '',
        'view_count' => $source['view_count'] ?? '0',
        'tags' => $source['tags'] ?? '',
        'status' => $source['status'] ?? 'draft',
        'published_at' => $source['published_at'] ?? '',
    ];
}

/** @param array<string, mixed> $entry @return array<string, mixed> */
function admin_videos_form_from_entry(array $entry): array
{
    $tags = $entry['tags'] ?? [];
    $publishedAt = $entry['published_at'] ?? '';

    return [
        'slug' => $entry['slug'] ?? '',
        'title' => $entry['title'] ?? '',
        'description' => $entry['description'] ?? '',
        'youtube_id' => $entry['youtube_id'] ?? '',
        'channel_title' => $entry['channel_title'] ?? '',
        'thumbnail_url' => $entry['thumbnail_url'] ?? '',
        'duration_seconds' => $entry['duration_seconds'] === null ? '' : (string) $entry['duration_seconds'],
        'view_count' => (string) ($entry['view_count'] ?? 0),
        'tags' => is_array($tags) ? implode(', ', array_map(static fn ($tag): string => is_scalar($tag) ? trim((string) $tag) : '', $tags)) : '',
        'status' => $entry['status'] ?? 'draft',
        'published_at' => is_scalar($publishedAt) ? (string) $publishedAt : '',
    ];
}

/** @param array<string, mixed> $user */
function admin_videos_actor_id(array $user): ?string
{
    foreach (['id', 'user_id', 'sub'] as $key) {
        $value = $user[$key] ?? null;
        if (is_scalar($value) && (string) $value !== '') {
            return (string) $value;
        }
    }

    return null;
}

function admin_videos_redirect(string $result): void
{
    header('Location: /admin/videos.php?' . http_build_query(['result' => $result]), true, 303);
    exit;
}

function admin_videos_status_option(string $value, string $label, string $current): void
{
    ?>
    <option value="<?= admin_videos_h($value) ?>"<?= $current === $value ? ' selected' : '' ?>><?= admin_videos_h($label) ?></option>
    <?php
}

function admin_videos_parse_nullable_int(string $value, string $field): ?int
{
    $trimmed = trim($value);
    if ($trimmed === '') {
        return null;
    }
    if (!preg_match('/^\d+$/', $trimmed)) {
        throw new InvalidArgumentException("{$field} must be a non-negative integer.");
    }

    return (int) $trimmed;
}

function admin_videos_parse_view_count(string $value): int
{
    $trimmed = trim($value);
    if ($trimmed === '') {
        return 0;
    }
    if (!preg_match('/^\d+$/', $trimmed)) {
        throw new InvalidArgumentException('view_count must be a non-negative integer.');
    }

    return (int) $trimmed;
}

/** @return list<string> */
function admin_videos_parse_tags(string $value): array
{
    $parts = preg_split('/[\r\n,]+/', $value) ?: [];
    $tags = [];
    foreach ($parts as $part) {
        $tag = trim($part);
        if ($tag !== '') {
            $tags[] = $tag;
        }
    }

    return $tags;
}

/** @param array<string, mixed> $formVideo @return array<string, mixed> */
function admin_videos_payload_from_form(array $formVideo): array
{
    $payload = $formVideo;
    $payload['duration_seconds'] = admin_videos_parse_nullable_int((string) ($formVideo['duration_seconds'] ?? ''), 'duration_seconds');
    $payload['view_count'] = admin_videos_parse_view_count((string) ($formVideo['view_count'] ?? '0'));
    $payload['tags'] = admin_videos_parse_tags((string) ($formVideo['tags'] ?? ''));

    return $payload;
}

$formVideo = admin_videos_blank();

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Video created.';
} elseif ($result === 'updated') {
    $notice = 'Video updated.';
} elseif ($result === 'deleted') {
    $notice = 'Video deleted.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formVideo = admin_videos_input_from_post($_POST, $editingSlug);

        try {
            if ($editingSlug !== null) {
                $repository->find('videos', $editingSlug, true);
            }
            $repository->save('videos', admin_videos_payload_from_form($formVideo), admin_videos_actor_id($user));
            admin_videos_redirect($editingSlug === null ? 'created' : 'updated');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } elseif ($action === 'delete') {
        $slug = trim(is_string($_POST['slug'] ?? null) ? $_POST['slug'] : '');

        try {
            $repository->delete('videos', $slug);
            admin_videos_redirect('deleted');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } else {
        $errors[] = 'Unknown video action.';
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $edit = trim(is_string($_GET['edit'] ?? null) ? $_GET['edit'] : '');
    if ($edit !== '') {
        try {
            $formVideo = admin_videos_form_from_entry($repository->find('videos', $edit, true));
            $editingSlug = is_scalar($formVideo['slug'] ?? null) ? (string) $formVideo['slug'] : $edit;
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    }
}

try {
    $videoEntries = $repository->list('videos', includeUnpublished: true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Videos',
    static function () use ($videoEntries, $formVideo, $editingSlug, $errors, $notice): void {
        $formTitle = $editingSlug === null ? 'Add video' : 'Edit video';
        $submitLabel = $editingSlug === null ? 'Create video' : 'Update video';
        $currentStatus = is_scalar($formVideo['status'] ?? null) ? (string) $formVideo['status'] : 'draft';
        ?>
        <section class="admin-hero" aria-labelledby="videos-title">
            <p class="admin-eyebrow">Content management</p>
            <h1 id="videos-title">Videos</h1>
        </section>

        <?php if ($notice !== null): ?>
            <section class="admin-panel" role="status">
                <p><?= admin_videos_h($notice) ?></p>
            </section>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <section class="admin-panel" role="alert" aria-labelledby="videos-errors-title">
                <h2 id="videos-errors-title">Unable to save changes</h2>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_videos_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </section>
        <?php endif; ?>

        <section class="admin-panel" aria-labelledby="videos-list-title">
            <h2 id="videos-list-title">Existing videos</h2>
            <?php if ($videoEntries === []): ?>
                <p>No videos have been created yet.</p>
            <?php else: ?>
                <table>
                    <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Channel</th>
                        <th scope="col">Status</th>
                        <th scope="col">Published</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($videoEntries as $entry): ?>
                        <?php $slug = is_scalar($entry['slug'] ?? null) ? (string) $entry['slug'] : ''; ?>
                        <tr>
                            <td><?= admin_videos_h($entry['title'] ?? '') ?></td>
                            <td><?= admin_videos_h($entry['channel_title'] ?? '') ?></td>
                            <td><?= admin_videos_h($entry['status'] ?? '') ?></td>
                            <td><?= admin_videos_h($entry['published_at'] ?? '') ?></td>
                            <td><code><?= admin_videos_h($slug) ?></code></td>
                            <td>
                                <a class="admin-button" href="/admin/videos.php?<?= http_build_query(['edit' => $slug]) ?>">Edit</a>
                                <form method="post" class="admin-inline-form">
                                    <?= admin_csrf_field() ?>
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="slug" value="<?= admin_videos_h($slug) ?>">
                                    <button type="submit">Delete</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </section>

        <section class="admin-panel" aria-labelledby="videos-form-title">
            <h2 id="videos-form-title"><?= admin_videos_h($formTitle) ?></h2>
            <form method="post" class="admin-form">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <input type="hidden" name="original_slug" value="<?= admin_videos_h($editingSlug ?? '') ?>">

                <label>
                    Slug
                    <input name="slug" value="<?= admin_videos_h($formVideo['slug'] ?? '') ?>"<?= $editingSlug === null ? ' required' : ' readonly' ?>>
                </label>

                <label>
                    Title
                    <input name="title" value="<?= admin_videos_h($formVideo['title'] ?? '') ?>" required>
                </label>

                <label>
                    Description
                    <textarea name="description" rows="5"><?= admin_videos_h($formVideo['description'] ?? '') ?></textarea>
                </label>

                <label>
                    YouTube ID or URL
                    <input name="youtube_id" value="<?= admin_videos_h($formVideo['youtube_id'] ?? '') ?>" required>
                </label>

                <label>
                    Channel title
                    <input name="channel_title" value="<?= admin_videos_h($formVideo['channel_title'] ?? '') ?>" required>
                </label>

                <label>
                    Thumbnail URL
                    <input name="thumbnail_url" type="url" value="<?= admin_videos_h($formVideo['thumbnail_url'] ?? '') ?>">
                </label>

                <label>
                    Duration seconds
                    <input name="duration_seconds" type="number" min="0" step="1" value="<?= admin_videos_h($formVideo['duration_seconds'] ?? '') ?>">
                </label>

                <label>
                    View count
                    <input name="view_count" type="number" min="0" step="1" value="<?= admin_videos_h($formVideo['view_count'] ?? '0') ?>">
                </label>

                <label>
                    Tags
                    <textarea name="tags" rows="3"><?= admin_videos_h($formVideo['tags'] ?? '') ?></textarea>
                </label>

                <label>
                    Status
                    <select name="status">
                        <?php admin_videos_status_option('draft', 'Draft', $currentStatus); ?>
                        <?php admin_videos_status_option('published', 'Published', $currentStatus); ?>
                        <?php admin_videos_status_option('archived', 'Archived', $currentStatus); ?>
                    </select>
                </label>

                <label>
                    Published date
                    <input name="published_at" value="<?= admin_videos_h($formVideo['published_at'] ?? '') ?>" readonly>
                </label>

                <button type="submit"><?= admin_videos_h($submitLabel) ?></button>
                <?php if ($editingSlug !== null): ?>
                    <a class="admin-button" href="/admin/videos.php">Cancel</a>
                <?php endif; ?>
            </form>
        </section>
        <?php
    },
    $user,
);

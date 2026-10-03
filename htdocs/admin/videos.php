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

/**
 * @param mixed $status
 * @return array{0: string, 1: string, 2: string} [css key, label, visitor-facing meaning]
 */
function admin_videos_status_text($status): array
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
function admin_videos_name(array $entry): string
{
    foreach (['title', 'slug'] as $key) {
        $value = $entry[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }

    return 'Untitled video';
}

function admin_videos_count_text(int $count): string
{
    if ($count === 0) {
        return 'No videos yet.';
    }
    if ($count >= 100) {
        return 'Showing the first ' . $count . ' videos.';
    }

    return $count === 1 ? 'Showing 1 video.' : 'Showing ' . $count . ' videos.';
}

$formVideo = admin_videos_blank();
$mode = 'browse';
$failedAction = null;
$deleteVideo = null;

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Video created.';
} elseif ($result === 'updated') {
    $notice = 'Video changes saved.';
} elseif ($result === 'deleted') {
    $notice = 'Video deleted.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $failedAction = $action;

    if ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formVideo = admin_videos_input_from_post($_POST, $editingSlug);
        $mode = $editingSlug === null ? 'create' : 'edit';
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
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
    $delete = trim(is_string($_GET['delete'] ?? null) ? $_GET['delete'] : '');
    if ($edit !== '') {
        try {
            $formVideo = admin_videos_form_from_entry($repository->find('videos', $edit, true));
            $editingSlug = is_scalar($formVideo['slug'] ?? null) ? (string) $formVideo['slug'] : $edit;
            $mode = 'edit';
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $failedAction = 'load';
        }
    } elseif ($delete !== '') {
        try {
            $deleteVideo = $repository->find('videos', $delete, true);
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
    $videoEntries = $repository->list('videos', includeUnpublished: true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Videos',
    static function () use ($videoEntries, $formVideo, $editingSlug, $errors, $notice, $mode, $failedAction, $deleteVideo): void {
        $isEditor = $mode === 'create' || $mode === 'edit';
        $editorName = admin_videos_name($formVideo);
        $currentStatus = is_scalar($formVideo['status'] ?? null) ? (string) $formVideo['status'] : 'draft';
        $publishedAt = is_scalar($formVideo['published_at'] ?? null) ? trim((string) $formVideo['published_at']) : '';
        $deleteSlug = $deleteVideo !== null && is_scalar($deleteVideo['slug'] ?? null) ? (string) $deleteVideo['slug'] : '';

        if ($failedAction === 'save') {
            $errorTitle = 'Video not saved';
            $errorHelp = 'Nothing was saved. Your entries are still in the form below; fix the problems listed and save again.';
        } elseif ($failedAction === 'delete') {
            $errorTitle = 'Video not deleted';
            $errorHelp = 'The video was left unchanged. Check the list below and try again.';
        } else {
            $errorTitle = 'Something needs attention';
            $errorHelp = 'Return to the video list and try again. If the problem continues, refresh the page.';
        }
        ?>
        <section class="admin-hero" aria-labelledby="videos-title">
            <p class="admin-eyebrow">Content manager</p>
            <h1 id="videos-title">Videos</h1>
            <p>Prepare YouTube sources, thumbnails, tags, and counts for the public video library.</p>
        </section>

        <?php if ($notice !== null): ?>
            <div class="admin-panel admin-notice admin-notice-success" role="status">
                <p><?= admin_videos_h($notice) ?></p>
            </div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel admin-notice admin-notice-error" role="alert" aria-labelledby="videos-errors-title">
                <h2 id="videos-errors-title"><?= admin_videos_h($errorTitle) ?></h2>
                <p><?= admin_videos_h($errorHelp) ?></p>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_videos_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($mode === 'delete' && $deleteVideo !== null): ?>
            <?php $deleteName = admin_videos_name($deleteVideo); ?>
            <section class="admin-panel admin-confirm" id="videos-delete" aria-labelledby="videos-delete-title">
                <p class="admin-eyebrow">Confirm deletion</p>
                <h2 id="videos-delete-title">Delete &ldquo;<?= admin_videos_h($deleteName) ?>&rdquo;?</h2>
                <p>This permanently removes the video <code><?= admin_videos_h($deleteSlug) ?></code> from the admin and the public site. It cannot be undone.</p>
                <p>To hide it from visitors but keep it, <a href="/admin/videos.php?<?= admin_videos_h(http_build_query(['edit' => $deleteSlug])) ?>#videos-editor">edit the video</a> and set its status to Archived instead.</p>
                <form method="post" action="/admin/videos.php" class="admin-form admin-confirm-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="slug" value="<?= admin_videos_h($deleteSlug) ?>">
                    <div class="admin-action-row">
                        <button type="submit" class="admin-button-danger">Delete &ldquo;<?= admin_videos_h($deleteName) ?>&rdquo;</button>
                        <a class="admin-button admin-button-secondary" href="/admin/videos.php">Cancel, keep video</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <?php if ($isEditor): ?>
            <section class="admin-panel admin-editor" id="videos-editor" aria-labelledby="videos-form-title">
                <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Editing video' : 'New video' ?></p>
                <h2 id="videos-form-title">
                    <?php if ($mode === 'edit'): ?>
                        Edit &ldquo;<?= admin_videos_h($editorName) ?>&rdquo;
                    <?php else: ?>
                        Add a video
                    <?php endif; ?>
                </h2>
                <p>Fields marked required must be filled in before saving. Leave optional numbers blank when unknown.</p>
                <form method="post" action="/admin/videos.php" class="admin-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="save">
                    <input type="hidden" name="original_slug" value="<?= admin_videos_h($editingSlug ?? '') ?>">
                    <input type="hidden" name="published_at" value="<?= admin_videos_h($publishedAt) ?>">

                    <fieldset class="admin-fieldset">
                        <legend>Basics</legend>

                        <?php if ($editingSlug !== null): ?>
                            <div class="admin-field admin-field-locked">
                                <span class="admin-field-label">Slug (locked)</span>
                                <p class="admin-locked-value"><code><?= admin_videos_h($editingSlug) ?></code></p>
                                <small>Slugs are locked after creation so existing watch-page links keep working. To use a different URL, create a new video and delete this one.</small>
                            </div>
                        <?php else: ?>
                            <div class="admin-field">
                                <label for="videos-slug">Slug <span class="admin-required">(required)</span></label>
                                <small id="videos-slug-help">Lowercase letters, numbers, and single hyphens, for example <code>launch-trailer</code>. This becomes the watch-page URL and is locked once the video is created.</small>
                                <input id="videos-slug" name="slug" value="<?= admin_videos_h($formVideo['slug'] ?? '') ?>" required aria-describedby="videos-slug-help">
                            </div>
                        <?php endif; ?>

                        <div class="admin-field">
                            <label for="videos-title-input">Title <span class="admin-required">(required)</span></label>
                            <input id="videos-title-input" name="title" value="<?= admin_videos_h($formVideo['title'] ?? '') ?>" required>
                        </div>

                        <div class="admin-field">
                            <label for="videos-description">Description <span class="admin-optional">(optional)</span></label>
                            <small id="videos-description-help">Shown on the watch page below the player.</small>
                            <textarea id="videos-description" name="description" rows="5" aria-describedby="videos-description-help"><?= admin_videos_h($formVideo['description'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>YouTube source</legend>

                        <div class="admin-field">
                            <label for="videos-youtube-id">YouTube ID or URL <span class="admin-required">(required)</span></label>
                            <small id="videos-youtube-id-help">Paste either the video ID or a full YouTube URL.</small>
                            <input id="videos-youtube-id" name="youtube_id" value="<?= admin_videos_h($formVideo['youtube_id'] ?? '') ?>" required aria-describedby="videos-youtube-id-help">
                        </div>

                        <div class="admin-field">
                            <label for="videos-channel-title">Channel title <span class="admin-required">(required)</span></label>
                            <input id="videos-channel-title" name="channel_title" value="<?= admin_videos_h($formVideo['channel_title'] ?? '') ?>" required>
                        </div>

                        <div class="admin-field">
                            <label for="videos-thumbnail-url">Thumbnail URL <span class="admin-optional">(optional)</span></label>
                            <small id="videos-thumbnail-url-help">Full image address starting with https://. Leave blank if there is no custom thumbnail.</small>
                            <input id="videos-thumbnail-url" name="thumbnail_url" type="url" value="<?= admin_videos_h($formVideo['thumbnail_url'] ?? '') ?>" aria-describedby="videos-thumbnail-url-help">
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Details</legend>

                        <div class="admin-field">
                            <label for="videos-duration-seconds">Duration in seconds <span class="admin-optional">(optional)</span></label>
                            <small id="videos-duration-seconds-help">Whole seconds only, for example 245 for 4:05. Leave blank if the runtime is unknown.</small>
                            <input id="videos-duration-seconds" name="duration_seconds" type="number" min="0" step="1" value="<?= admin_videos_h($formVideo['duration_seconds'] ?? '') ?>" aria-describedby="videos-duration-seconds-help">
                        </div>

                        <div class="admin-field">
                            <label for="videos-view-count">View count <span class="admin-optional">(optional)</span></label>
                            <small id="videos-view-count-help">Whole number, no commas. Blank saves as zero.</small>
                            <input id="videos-view-count" name="view_count" type="number" min="0" step="1" value="<?= admin_videos_h($formVideo['view_count'] ?? '0') ?>" aria-describedby="videos-view-count-help">
                        </div>

                        <div class="admin-field">
                            <label for="videos-tags">Tags <span class="admin-optional">(optional)</span></label>
                            <small id="videos-tags-help">Separate tags with commas or line breaks.</small>
                            <textarea id="videos-tags" name="tags" rows="3" aria-describedby="videos-tags-help"><?= admin_videos_h($formVideo['tags'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Publishing</legend>

                        <div class="admin-field">
                            <label for="videos-status">Status</label>
                            <small id="videos-status-help">Draft and Archived videos are hidden from visitors. Published videos appear in the public video library.</small>
                            <select id="videos-status" name="status" aria-describedby="videos-status-help">
                                <?php admin_videos_status_option('draft', 'Draft - Hidden from visitors', $currentStatus); ?>
                                <?php admin_videos_status_option('published', 'Published - Visible on the public site', $currentStatus); ?>
                                <?php admin_videos_status_option('archived', 'Archived - Hidden from visitors, kept for reference', $currentStatus); ?>
                            </select>
                        </div>

                        <div class="admin-field admin-field-locked">
                            <span class="admin-field-label">Publication time (set automatically)</span>
                            <p class="admin-locked-value"><?= $publishedAt !== '' ? '<time>' . admin_videos_h($publishedAt) . '</time>' : 'Not published yet' ?></p>
                            <small>The site records this the first time the video is saved as Published. Later saves keep the original time, even if the status changes, so it cannot be edited here.</small>
                        </div>
                    </fieldset>

                    <div class="admin-action-row">
                        <button type="submit"><?= $mode === 'edit' ? 'Save changes' : 'Create video' ?></button>
                        <a class="admin-button admin-button-secondary" href="/admin/videos.php">Cancel</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <section class="admin-panel admin-records" id="videos-list" aria-labelledby="videos-list-title">
            <div class="admin-records-header">
                <div>
                    <h2 id="videos-list-title">All videos</h2>
                    <p id="videos-list-count"><?= admin_videos_h(admin_videos_count_text(count($videoEntries))) ?></p>
                </div>
                <?php if ($mode !== 'create' && $videoEntries !== []): ?>
                    <a class="admin-button" href="/admin/videos.php?new=1#videos-editor">Add video</a>
                <?php endif; ?>
            </div>

            <?php if ($videoEntries === []): ?>
                <div class="admin-empty">
                    <?php if ($mode === 'create'): ?>
                        <p>Fill in the form above to add the first video.</p>
                    <?php else: ?>
                        <p>The video library is empty. Add a video to start the reel.</p>
                        <a class="admin-button" href="/admin/videos.php?new=1#videos-editor">Add the first video</a>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table admin-records-table" aria-labelledby="videos-list-title" aria-describedby="videos-list-count">
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
                        <?php
                        $slug = is_scalar($entry['slug'] ?? null) ? (string) $entry['slug'] : '';
                        $name = admin_videos_name($entry);
                        [$statusKey, $statusLabel, $statusMeaning] = admin_videos_status_text($entry['status'] ?? '');
                        $entryPublishedAt = is_scalar($entry['published_at'] ?? null) ? trim((string) $entry['published_at']) : '';
                        $isCurrent = ($mode === 'edit' && $slug === $editingSlug) || ($mode === 'delete' && $slug === $deleteSlug);
                        ?>
                        <tr<?= $isCurrent ? ' class="admin-record-current" aria-current="true"' : '' ?>>
                            <th scope="row" class="admin-record-title"><?= admin_videos_h($name) ?></th>
                            <td><?= admin_videos_h($entry['channel_title'] ?? '') ?></td>
                            <td>
                                <span class="admin-status admin-status-<?= admin_videos_h($statusKey) ?>"><?= admin_videos_h($statusLabel) ?></span>
                                <small class="admin-status-help"><?= admin_videos_h($statusMeaning) ?></small>
                            </td>
                            <td><?= $entryPublishedAt !== '' ? '<time>' . admin_videos_h($entryPublishedAt) . '</time>' : 'Not yet' ?></td>
                            <td><code><?= admin_videos_h($slug) ?></code></td>
                            <td class="admin-record-actions">
                                <a class="admin-button admin-button-secondary" href="/admin/videos.php?<?= admin_videos_h(http_build_query(['edit' => $slug])) ?>#videos-editor" aria-label="Edit video &ldquo;<?= admin_videos_h($name) ?>&rdquo;">Edit</a>
                                <a class="admin-button admin-button-secondary admin-button-danger" href="/admin/videos.php?<?= admin_videos_h(http_build_query(['delete' => $slug])) ?>#videos-delete" aria-label="Delete video &ldquo;<?= admin_videos_h($name) ?>&rdquo;">Delete</a>
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

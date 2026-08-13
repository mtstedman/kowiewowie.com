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
            $notice = 'Guide deleted.';
        } catch (Throwable $exception) {
            $error = $exception->getMessage();
        }
    } elseif ($action === 'save') {
        $formGuide = admin_guides_input_from_post();
        $existingSlug = is_scalar($_POST['existing_slug'] ?? null) ? (string) $_POST['existing_slug'] : '';
        $editing = $existingSlug !== '' ? $existingSlug : null;
        try {
            $result = $repository->save('guides', $formGuide, admin_guides_actor_id($user));
            $notice = $result['created'] ? 'Guide created.' : 'Guide updated.';
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

admin_render_page(
    'Guides',
    static function () use ($guides, $editing, $formGuide, $error, $notice): void {
        $sections = admin_guides_sections($formGuide);
        ?>
        <section class="admin-hero" aria-labelledby="guides-title">
            <p class="admin-eyebrow">Content management</p>
            <h1 id="guides-title">Guides</h1>
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
            <form method="post" action="/admin/guides.php">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <input type="hidden" name="existing_slug" value="<?= $editing !== null ? admin_guides_h($editing) : '' ?>">

                <p>
                    <label for="slug">Slug</label><br>
                    <input id="slug" name="slug" type="text" value="<?= admin_guides_h($formGuide['slug'] ?? '') ?>" <?= $editing !== null ? 'readonly' : '' ?> required>
                </p>
                <p>
                    <label for="title">Title</label><br>
                    <input id="title" name="title" type="text" value="<?= admin_guides_h($formGuide['title'] ?? '') ?>" required>
                </p>
                <p>
                    <label for="deck_slug">Deck slug</label><br>
                    <input id="deck_slug" name="deck_slug" type="text" value="<?= admin_guides_h($formGuide['deck_slug'] ?? '') ?>" required>
                </p>
                <p>
                    <label for="summary">Summary</label><br>
                    <textarea id="summary" name="summary" rows="4" required><?= admin_guides_h($formGuide['summary'] ?? '') ?></textarea>
                </p>
                <p>
                    <label for="status">Status</label><br>
                    <select id="status" name="status">
                        <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                            <option value="<?= admin_guides_h($status) ?>" <?= ($formGuide['status'] ?? 'draft') === $status ? 'selected' : '' ?>><?= admin_guides_h(ucfirst($status)) ?></option>
                        <?php endforeach; ?>
                    </select>
                </p>
                <p>
                    <label for="published">Published date</label><br>
                    <input id="published" name="published" type="date" value="<?= admin_guides_h($formGuide['published'] ?? '') ?>">
                </p>

                <h3>Sections</h3>
                <?php foreach ($sections as $index => $section): ?>
                    <fieldset>
                        <legend>Section <?= (int) $index + 1 ?></legend>
                        <p>
                            <label for="section_heading_<?= (int) $index ?>">Heading</label><br>
                            <input id="section_heading_<?= (int) $index ?>" name="section_heading[]" type="text" value="<?= admin_guides_h(is_array($section) ? ($section['heading'] ?? '') : '') ?>" required>
                        </p>
                        <p>
                            <label for="section_body_<?= (int) $index ?>">Body</label><br>
                            <textarea id="section_body_<?= (int) $index ?>" name="section_body[]" rows="6" required><?= admin_guides_h(is_array($section) ? ($section['body'] ?? '') : '') ?></textarea>
                        </p>
                    </fieldset>
                <?php endforeach; ?>
                <fieldset>
                    <legend>New section</legend>
                    <p>
                        <label for="section_heading_new">Heading</label><br>
                        <input id="section_heading_new" name="section_heading[]" type="text" value="">
                    </p>
                    <p>
                        <label for="section_body_new">Body</label><br>
                        <textarea id="section_body_new" name="section_body[]" rows="6"></textarea>
                    </p>
                </fieldset>

                <p>
                    <button type="submit"><?= $editing !== null ? 'Update guide' : 'Create guide' ?></button>
                    <?php if ($editing !== null): ?>
                        <a href="/admin/guides.php">Cancel</a>
                    <?php endif; ?>
                </p>
            </form>
        </section>

        <section class="admin-panel" aria-labelledby="guide-list-title">
            <h2 id="guide-list-title">Existing guides</h2>
            <?php if ($guides === []): ?>
                <p>No guides found.</p>
            <?php else: ?>
                <table>
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
                                <a href="/admin/guides.php?edit=<?= rawurlencode($slug) ?>">Edit</a>
                                <form method="post" action="/admin/guides.php" onsubmit="return confirm('Delete this guide?');">
                                    <?= admin_csrf_field() ?>
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="slug" value="<?= admin_guides_h($slug) ?>">
                                    <button type="submit">Delete</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </section>
        <?php
    },
    $user,
);

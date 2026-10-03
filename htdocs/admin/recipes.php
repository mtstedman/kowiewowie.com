<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$errors = [];
$notice = null;
$recipes = [];
$editingSlug = null;

/** @param mixed $value */
function admin_recipe_text($value): string
{
    return htmlspecialchars(is_scalar($value) ? (string) $value : '', ENT_QUOTES, 'UTF-8');
}

/** @param mixed $value */
function admin_recipe_lines($value): string
{
    if (!is_array($value)) {
        return is_scalar($value) ? (string) $value : '';
    }

    return implode("\n", array_map(static fn ($item): string => is_scalar($item) ? (string) $item : '', $value));
}

/** @param mixed $value @return list<string> */
function admin_recipe_list_from_text($value): array
{
    if (!is_string($value)) {
        return [];
    }

    $lines = preg_split('/\R/u', $value) ?: [];
    $items = [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line !== '') {
            $items[] = $line;
        }
    }

    return $items;
}

/** @return array<string, mixed> */
function admin_recipe_blank(): array
{
    return [
        'slug' => '',
        'title' => '',
        'summary' => '',
        'image' => '',
        'ingredients' => [],
        'instructions' => [],
        'status' => 'draft',
    ];
}

/** @param array<string, mixed> $source @return array<string, mixed> */
function admin_recipe_input_from_post(array $source, ?string $fixedSlug): array
{
    return [
        'slug' => $fixedSlug ?? ($source['slug'] ?? ''),
        'title' => $source['title'] ?? '',
        'summary' => $source['summary'] ?? '',
        'image' => $source['image'] ?? '',
        'ingredients' => admin_recipe_list_from_text($source['ingredients'] ?? ''),
        'instructions' => admin_recipe_list_from_text($source['instructions'] ?? ''),
        'status' => $source['status'] ?? 'draft',
    ];
}

/** @param array<string, mixed> $user */
function admin_recipe_actor_id(array $user): ?string
{
    foreach (['id', 'user_id', 'sub'] as $key) {
        $value = $user[$key] ?? null;
        if (is_scalar($value) && (string) $value !== '') {
            return (string) $value;
        }
    }

    return null;
}

function admin_recipe_redirect(string $result): void
{
    header('Location: /admin/recipes.php?' . http_build_query(['result' => $result]), true, 303);
    exit;
}

/**
 * @param mixed $status
 * @return array{0: string, 1: string, 2: string} [css key, label, visitor-facing meaning]
 */
function admin_recipe_status_text($status): array
{
    $status = is_scalar($status) ? (string) $status : '';

    return match ($status) {
        'draft' => ['draft', 'Draft', 'Hidden from visitors'],
        'published' => ['published', 'Published', 'Visible on the public site'],
        'archived' => ['archived', 'Archived', 'Hidden from visitors, kept for reference'],
        default => ['unknown', $status !== '' ? $status : 'Unknown', 'Unrecognised status'],
    };
}

/** @param array<string, mixed> $recipe */
function admin_recipe_name(array $recipe): string
{
    foreach (['title', 'slug'] as $key) {
        $value = $recipe[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }

    return 'Untitled recipe';
}

function admin_recipe_count_text(int $count): string
{
    if ($count === 0) {
        return 'No recipes yet.';
    }
    if ($count >= 100) {
        return 'Showing the first ' . $count . ' recipes.';
    }

    return $count === 1 ? 'Showing 1 recipe.' : 'Showing ' . $count . ' recipes.';
}

$formRecipe = admin_recipe_blank();
$mode = 'browse';
$failedAction = null;
$deleteRecipe = null;

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Recipe created.';
} elseif ($result === 'updated') {
    $notice = 'Recipe changes saved.';
} elseif ($result === 'deleted') {
    $notice = 'Recipe deleted.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $failedAction = $action;

    if ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formRecipe = admin_recipe_input_from_post($_POST, $editingSlug);
        $mode = $editingSlug === null ? 'create' : 'edit';
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        try {
            $repository->save('recipes', $formRecipe, admin_recipe_actor_id($user));
            admin_recipe_redirect($editingSlug === null ? 'created' : 'updated');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } elseif ($action === 'delete') {
        $slug = trim(is_string($_POST['slug'] ?? null) ? $_POST['slug'] : '');

        try {
            $repository->delete('recipes', $slug);
            admin_recipe_redirect('deleted');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } else {
        $errors[] = 'Unknown recipe action.';
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $edit = trim(is_string($_GET['edit'] ?? null) ? $_GET['edit'] : '');
    $delete = trim(is_string($_GET['delete'] ?? null) ? $_GET['delete'] : '');
    if ($edit !== '') {
        try {
            $formRecipe = $repository->find('recipes', $edit, true);
            $editingSlug = is_scalar($formRecipe['slug'] ?? null) ? (string) $formRecipe['slug'] : $edit;
            $mode = 'edit';
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $failedAction = 'load';
        }
    } elseif ($delete !== '') {
        try {
            $deleteRecipe = $repository->find('recipes', $delete, true);
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
    $recipes = $repository->list('recipes', 100, 0, true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Recipes',
    static function () use ($recipes, $formRecipe, $editingSlug, $errors, $notice, $mode, $failedAction, $deleteRecipe): void {
        $isEditor = $mode === 'create' || $mode === 'edit';
        $editorName = admin_recipe_name($formRecipe);
        $currentStatus = is_scalar($formRecipe['status'] ?? null) ? (string) $formRecipe['status'] : 'draft';
        $deleteSlug = $deleteRecipe !== null && is_scalar($deleteRecipe['slug'] ?? null) ? (string) $deleteRecipe['slug'] : '';

        if ($failedAction === 'save') {
            $errorTitle = 'Recipe not saved';
            $errorHelp = 'Nothing was saved. Your entries are still in the form below; fix the problems listed and save again.';
        } elseif ($failedAction === 'delete') {
            $errorTitle = 'Recipe not deleted';
            $errorHelp = 'The recipe was left unchanged. Check the list below and try again.';
        } else {
            $errorTitle = 'Something needs attention';
            $errorHelp = 'Return to the recipe list and try again. If the problem continues, refresh the page.';
        }
        ?>
        <section class="admin-hero" aria-labelledby="recipes-title">
            <p class="admin-eyebrow">Content manager</p>
            <h1 id="recipes-title">Recipes</h1>
            <p>Write, publish, and retire the recipes shown on the public recipe pages.</p>
        </section>

        <?php if ($notice !== null): ?>
            <div class="admin-panel admin-notice admin-notice-success" role="status">
                <p><?= admin_recipe_text($notice) ?></p>
            </div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel admin-notice admin-notice-error" role="alert" aria-labelledby="recipe-errors-title">
                <h2 id="recipe-errors-title"><?= admin_recipe_text($errorTitle) ?></h2>
                <p><?= admin_recipe_text($errorHelp) ?></p>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_recipe_text($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($mode === 'delete' && $deleteRecipe !== null): ?>
            <?php $deleteName = admin_recipe_name($deleteRecipe); ?>
            <section class="admin-panel admin-confirm" id="recipe-delete" aria-labelledby="recipe-delete-title">
                <p class="admin-eyebrow">Confirm deletion</p>
                <h2 id="recipe-delete-title">Delete &ldquo;<?= admin_recipe_text($deleteName) ?>&rdquo;?</h2>
                <p>This permanently removes the recipe <code><?= admin_recipe_text($deleteSlug) ?></code> from the admin and the public site. It cannot be undone.</p>
                <p>To hide it from visitors but keep it, <a href="/admin/recipes.php?<?= admin_recipe_text(http_build_query(['edit' => $deleteSlug])) ?>#recipe-editor">edit the recipe</a> and set its status to Archived instead.</p>
                <form method="post" action="/admin/recipes.php" class="admin-form admin-confirm-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="slug" value="<?= admin_recipe_text($deleteSlug) ?>">
                    <div class="admin-action-row">
                        <button type="submit" class="admin-button-danger">Delete &ldquo;<?= admin_recipe_text($deleteName) ?>&rdquo;</button>
                        <a class="admin-button admin-button-secondary" href="/admin/recipes.php">Cancel, keep recipe</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <?php if ($isEditor): ?>
            <section class="admin-panel admin-editor" id="recipe-editor" aria-labelledby="recipe-form-title">
                <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Editing recipe' : 'New recipe' ?></p>
                <h2 id="recipe-form-title">
                    <?php if ($mode === 'edit'): ?>
                        Edit &ldquo;<?= admin_recipe_text($editorName) ?>&rdquo;
                    <?php else: ?>
                        Add a recipe
                    <?php endif; ?>
                </h2>
                <p>Fields marked required must be filled in before saving.</p>
                <form method="post" action="/admin/recipes.php" class="admin-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="save">
                    <?php if ($editingSlug !== null): ?>
                        <input type="hidden" name="original_slug" value="<?= admin_recipe_text($editingSlug) ?>">
                    <?php endif; ?>

                    <fieldset class="admin-fieldset">
                        <legend>Basics</legend>

                        <?php if ($editingSlug !== null): ?>
                            <div class="admin-field admin-field-locked">
                                <span class="admin-field-label">Slug (locked)</span>
                                <p class="admin-locked-value"><code><?= admin_recipe_text($editingSlug) ?></code></p>
                                <small>Slugs are locked after creation so existing links keep working. To use a different URL, create a new recipe and delete this one.</small>
                            </div>
                        <?php else: ?>
                            <div class="admin-field">
                                <label for="recipe-slug">Slug <span class="admin-required">(required)</span></label>
                                <small id="recipe-slug-help">Lowercase letters, numbers, and single hyphens, for example <code>weeknight-chili</code>. This becomes the recipe URL and is locked once the recipe is created.</small>
                                <input
                                    id="recipe-slug"
                                    type="text"
                                    name="slug"
                                    value="<?= admin_recipe_text($formRecipe['slug'] ?? '') ?>"
                                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                                    maxlength="160"
                                    required
                                    aria-describedby="recipe-slug-help"
                                >
                            </div>
                        <?php endif; ?>

                        <div class="admin-field">
                            <label for="recipe-title">Title <span class="admin-required">(required)</span></label>
                            <input id="recipe-title" type="text" name="title" value="<?= admin_recipe_text($formRecipe['title'] ?? '') ?>" maxlength="255" required>
                        </div>

                        <div class="admin-field">
                            <label for="recipe-summary">Summary <span class="admin-required">(required)</span></label>
                            <small id="recipe-summary-help">A friendly sentence or two shown in the recipe list and at the top of the recipe page.</small>
                            <textarea id="recipe-summary" name="summary" rows="4" maxlength="2000" required aria-describedby="recipe-summary-help"><?= admin_recipe_text($formRecipe['summary'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Ingredients and steps</legend>

                        <div class="admin-field">
                            <label for="recipe-ingredients">Ingredients <span class="admin-required">(required)</span></label>
                            <small id="recipe-ingredients-help">One ingredient per line. Blank lines are ignored.</small>
                            <textarea id="recipe-ingredients" name="ingredients" rows="8" required aria-describedby="recipe-ingredients-help"><?= admin_recipe_text(admin_recipe_lines($formRecipe['ingredients'] ?? [])) ?></textarea>
                        </div>

                        <div class="admin-field">
                            <label for="recipe-instructions">Instructions <span class="admin-required">(required)</span></label>
                            <small id="recipe-instructions-help">One step per line, in cooking order. Blank lines are ignored.</small>
                            <textarea id="recipe-instructions" name="instructions" rows="8" required aria-describedby="recipe-instructions-help"><?= admin_recipe_text(admin_recipe_lines($formRecipe['instructions'] ?? [])) ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Photo</legend>

                        <div class="admin-field">
                            <label for="recipe-image">Image URL <span class="admin-optional">(optional)</span></label>
                            <small id="recipe-image-help">Full web address of a photo, starting with https://. Leave blank for no image.</small>
                            <input id="recipe-image" type="url" name="image" value="<?= admin_recipe_text($formRecipe['image'] ?? '') ?>" maxlength="2000" aria-describedby="recipe-image-help">
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Publishing</legend>

                        <div class="admin-field">
                            <label for="recipe-status">Status</label>
                            <small id="recipe-status-help">Draft and Archived recipes are hidden from visitors. Published recipes appear on the public site.</small>
                            <select id="recipe-status" name="status" required aria-describedby="recipe-status-help">
                                <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                                    <?php [, $statusLabel, $statusMeaning] = admin_recipe_status_text($status); ?>
                                    <option value="<?= admin_recipe_text($status) ?>"<?= $currentStatus === $status ? ' selected' : '' ?>><?= admin_recipe_text($statusLabel . ' - ' . $statusMeaning) ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                    </fieldset>

                    <div class="admin-action-row">
                        <button type="submit"><?= $mode === 'edit' ? 'Save changes' : 'Create recipe' ?></button>
                        <a class="admin-button admin-button-secondary" href="/admin/recipes.php">Cancel</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <section class="admin-panel admin-records" id="recipe-list" aria-labelledby="recipe-list-title">
            <div class="admin-records-header">
                <div>
                    <h2 id="recipe-list-title">All recipes</h2>
                    <p id="recipe-list-count"><?= admin_recipe_text(admin_recipe_count_text(count($recipes))) ?></p>
                </div>
                <?php if ($mode !== 'create' && $recipes !== []): ?>
                    <a class="admin-button" href="/admin/recipes.php?new=1#recipe-editor">Add recipe</a>
                <?php endif; ?>
            </div>

            <?php if ($recipes === []): ?>
                <div class="admin-empty">
                    <?php if ($mode === 'create'): ?>
                        <p>Fill in the form above to add the first recipe.</p>
                    <?php else: ?>
                        <p>The recipe drawer is empty. Add a recipe to start the collection.</p>
                        <a class="admin-button" href="/admin/recipes.php?new=1#recipe-editor">Add the first recipe</a>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table admin-records-table" aria-labelledby="recipe-list-title" aria-describedby="recipe-list-count">
                    <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Status</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($recipes as $recipe): ?>
                        <?php
                        $slug = is_scalar($recipe['slug'] ?? null) ? (string) $recipe['slug'] : '';
                        $name = admin_recipe_name($recipe);
                        [$statusKey, $statusLabel, $statusMeaning] = admin_recipe_status_text($recipe['status'] ?? '');
                        $isCurrent = ($mode === 'edit' && $slug === $editingSlug) || ($mode === 'delete' && $slug === $deleteSlug);
                        ?>
                        <tr<?= $isCurrent ? ' class="admin-record-current" aria-current="true"' : '' ?>>
                            <th scope="row" class="admin-record-title"><?= admin_recipe_text($name) ?></th>
                            <td>
                                <span class="admin-status admin-status-<?= admin_recipe_text($statusKey) ?>"><?= admin_recipe_text($statusLabel) ?></span>
                                <small class="admin-status-help"><?= admin_recipe_text($statusMeaning) ?></small>
                            </td>
                            <td><code><?= admin_recipe_text($slug) ?></code></td>
                            <td class="admin-record-actions">
                                <a class="admin-button admin-button-secondary" href="/admin/recipes.php?<?= admin_recipe_text(http_build_query(['edit' => $slug])) ?>#recipe-editor" aria-label="Edit recipe &ldquo;<?= admin_recipe_text($name) ?>&rdquo;">Edit</a>
                                <a class="admin-button admin-button-secondary admin-button-danger" href="/admin/recipes.php?<?= admin_recipe_text(http_build_query(['delete' => $slug])) ?>#recipe-delete" aria-label="Delete recipe &ldquo;<?= admin_recipe_text($name) ?>&rdquo;">Delete</a>
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

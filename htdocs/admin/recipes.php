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

$formRecipe = admin_recipe_blank();

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Recipe tucked into the cookbook.';
} elseif ($result === 'updated') {
    $notice = 'Recipe refreshed and ready for another taste.';
} elseif ($result === 'deleted') {
    $notice = 'Recipe removed from the shelf.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formRecipe = admin_recipe_input_from_post($_POST, $editingSlug);

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
    if ($edit !== '') {
        try {
            $formRecipe = $repository->find('recipes', $edit, true);
            $editingSlug = is_scalar($formRecipe['slug'] ?? null) ? (string) $formRecipe['slug'] : $edit;
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    }
}

try {
    $recipes = $repository->list('recipes', 100, 0, true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Recipes',
    static function () use ($recipes, $formRecipe, $editingSlug, $errors, $notice): void {
        $formTitle = $editingSlug === null ? 'Add recipe' : 'Edit recipe';
        $submitLabel = $editingSlug === null ? 'Create recipe' : 'Update recipe';
        ?>
        <section class="admin-hero" aria-labelledby="recipes-title">
            <p class="admin-eyebrow">Recipe drawer</p>
            <h1 id="recipes-title">Recipes that behave on repeat.</h1>
            <p>Manage slugs, summaries, ingredients, steps, images, and publication status without making the pantry blink.</p>
        </section>

        <?php if ($notice !== null): ?>
            <section class="admin-panel" role="status">
                <p><?= admin_recipe_text($notice) ?></p>
            </section>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <section class="admin-panel" role="alert" aria-labelledby="recipe-errors-title">
                <h2 id="recipe-errors-title">Unable to save changes</h2>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_recipe_text($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </section>
        <?php endif; ?>

        <section class="admin-panel" aria-labelledby="recipe-list-title">
            <h2 id="recipe-list-title">Recipe shelf</h2>
            <p>Scan what is live, drafted, or archived before stirring in edits.</p>
            <?php if ($recipes === []): ?>
                <p>No recipes yet. Add the first keeper below.</p>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table">
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
                        <?php $slug = is_scalar($recipe['slug'] ?? null) ? (string) $recipe['slug'] : ''; ?>
                        <tr>
                            <td><?= admin_recipe_text($recipe['title'] ?? '') ?></td>
                            <td><?= admin_recipe_text($recipe['status'] ?? '') ?></td>
                            <td><?= admin_recipe_text($slug) ?></td>
                            <td>
                                <a class="admin-button admin-button-secondary" href="/admin/recipes.php?<?= http_build_query(['edit' => $slug]) ?>">Edit recipe</a>
                                <form method="post" action="/admin/recipes.php" class="admin-inline-form">
                                    <?= admin_csrf_field() ?>
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="slug" value="<?= admin_recipe_text($slug) ?>">
                                    <button type="submit">Delete recipe</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
            <?php endif; ?>
        </section>

        <section class="admin-panel" aria-labelledby="recipe-form-title">
            <h2 id="recipe-form-title"><?= admin_recipe_text($formTitle) ?></h2>
            <p>Keep the public page concise: a friendly summary, one ingredient per line, and steps in order.</p>
            <form method="post" action="/admin/recipes.php">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <?php if ($editingSlug !== null): ?>
                    <input type="hidden" name="original_slug" value="<?= admin_recipe_text($editingSlug) ?>">
                <?php endif; ?>

                <label>
                    <span>Slug</span>
                    <small>Lowercase words and hyphens only; this becomes the recipe URL.</small>
                    <input
                        type="text"
                        name="slug"
                        value="<?= admin_recipe_text($formRecipe['slug'] ?? '') ?>"
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        maxlength="160"
                        required
                        <?= $editingSlug !== null ? 'readonly' : '' ?>
                    >
                </label>

                <label>
                    Title
                    <input type="text" name="title" value="<?= admin_recipe_text($formRecipe['title'] ?? '') ?>" maxlength="255" required>
                </label>

                <label>
                    Summary
                    <textarea name="summary" rows="4" maxlength="2000" required><?= admin_recipe_text($formRecipe['summary'] ?? '') ?></textarea>
                </label>

                <label>
                    Image URL
                    <input type="url" name="image" value="<?= admin_recipe_text($formRecipe['image'] ?? '') ?>" maxlength="2000">
                </label>

                <label>
                    <span>Ingredients</span>
                    <small>One item per line so the public recipe stays easy to scan.</small>
                    <textarea name="ingredients" rows="8" required><?= admin_recipe_text(admin_recipe_lines($formRecipe['ingredients'] ?? [])) ?></textarea>
                </label>

                <label>
                    <span>Instructions</span>
                    <small>One step per line; keep each move crisp enough to cook from.</small>
                    <textarea name="instructions" rows="8" required><?= admin_recipe_text(admin_recipe_lines($formRecipe['instructions'] ?? [])) ?></textarea>
                </label>

                <label>
                    Status
                    <select name="status" required>
                        <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                            <option value="<?= admin_recipe_text($status) ?>" <?= ($formRecipe['status'] ?? 'draft') === $status ? 'selected' : '' ?>>
                                <?= admin_recipe_text(ucfirst($status)) ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <div class="admin-action-row">
                    <button type="submit"><?= admin_recipe_text($submitLabel) ?></button>
                    <?php if ($editingSlug !== null): ?>
                        <a class="admin-button admin-button-secondary" href="/admin/recipes.php">Cancel editing</a>
                    <?php endif; ?>
                </div>
            </form>
        </section>
        <?php
    },
    $user,
);

<?php

declare(strict_types=1);

use Wowie\Api\ApiException;

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$messages = [];
$errors = [];
$editing = false;
$editSlug = is_string($_GET['edit'] ?? null) ? trim($_GET['edit']) : '';
$formGame = null;

/** @param mixed $value */
function admin_games_h($value): string
{
    return htmlspecialchars(is_scalar($value) ? (string) $value : '', ENT_QUOTES, 'UTF-8');
}

/** @return list<string> */
function admin_games_lines(mixed $value): array
{
    if (is_array($value)) {
        $lines = $value;
    } else {
        $lines = preg_split('/\R/', is_string($value) ? $value : '') ?: [];
    }

    $result = [];
    foreach ($lines as $line) {
        if (!is_string($line)) {
            continue;
        }
        $line = trim($line);
        if ($line !== '') {
            $result[] = $line;
        }
    }

    return $result;
}

/** @param array<string, mixed> $game */
function admin_games_notes_text(array $game): string
{
    $notes = $game['strategyNotes'] ?? [];
    if (!is_array($notes)) {
        return '';
    }

    return implode("\n", admin_games_lines($notes));
}

/** @return array<string, mixed> */
function admin_games_post_input(bool $isEdit): array
{
    return [
        'slug' => $isEdit ? (string) ($_POST['original_slug'] ?? '') : (string) ($_POST['slug'] ?? ''),
        'name' => (string) ($_POST['name'] ?? ''),
        'shortDescription' => (string) ($_POST['shortDescription'] ?? ''),
        'strategyNotes' => admin_games_lines($_POST['strategyNotes'] ?? ''),
        'status' => (string) ($_POST['status'] ?? 'draft'),
    ];
}

function admin_games_actor_id(array $user): ?string
{
    $id = $user['id'] ?? null;
    return is_scalar($id) ? (string) $id : null;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        $isEdit = ($_POST['form_mode'] ?? '') === 'edit';
        $input = admin_games_post_input($isEdit);

        try {
            if ($isEdit) {
                $repository->find('games', $input['slug'], true);
            }
            $result = $repository->save('games', $input, admin_games_actor_id($user));
            $_SESSION['admin_games_message'] = ($result['created'] ? 'Added' : 'Updated') . ' game "' . $result['item']['name'] . '".';
            header('Location: /admin/games.php', true, 303);
            exit;
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $editing = $isEdit;
            $editSlug = $isEdit ? $input['slug'] : '';
            $formGame = $input;
        }
    } elseif ($action === 'delete') {
        $slug = is_string($_POST['slug'] ?? null) ? trim($_POST['slug']) : '';

        try {
            $repository->delete('games', $slug);
            $_SESSION['admin_games_message'] = 'Removed game "' . $slug . '" from the arcade shelf.';
            header('Location: /admin/games.php', true, 303);
            exit;
        } catch (Throwable $error) {
            $errors[] = $error instanceof ApiException && $error->status === 404 ? 'That game no longer exists.' : $error->getMessage();
        }
    } else {
        $errors[] = 'Unknown form action.';
    }
}

if (isset($_SESSION['admin_games_message']) && is_string($_SESSION['admin_games_message'])) {
    $messages[] = $_SESSION['admin_games_message'];
    unset($_SESSION['admin_games_message']);
}

if ($formGame === null && $editSlug !== '') {
    try {
        $formGame = $repository->find('games', $editSlug, true);
        $editing = true;
    } catch (Throwable $error) {
        $errors[] = $error instanceof ApiException && $error->status === 404 ? 'That game could not be found for editing.' : $error->getMessage();
        $editSlug = '';
    }
}

$games = $repository->list('games', 100, 0, true);

admin_render_page(
    'Games',
    static function () use ($games, $messages, $errors, $editing, $editSlug, $formGame): void {
        $formGame ??= [
            'slug' => '',
            'name' => '',
            'shortDescription' => '',
            'strategyNotes' => [],
            'status' => 'draft',
        ];
        $formTitle = $editing ? 'Edit game' : 'Add game';
        ?>
        <section class="admin-hero" aria-labelledby="games-title">
            <p class="admin-eyebrow">Arcade shelf</p>
            <h1 id="games-title">Games ready for button-mashing.</h1>
            <p>Keep names, summaries, notes, and status tidy so each public game page launches cleanly.</p>
        </section>

        <?php foreach ($messages as $message): ?>
            <div class="admin-panel" role="status">
                <p><?= admin_games_h($message) ?></p>
            </div>
        <?php endforeach; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel" role="alert">
                <h2>Could not save changes</h2>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_games_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <section class="admin-panel" aria-labelledby="game-form-title">
            <h2 id="game-form-title"><?= admin_games_h($formTitle) ?></h2>
            <p>Describe the game quickly, then use notes for strategy, quirks, or launch context.</p>
            <form method="post" action="/admin/games.php<?= $editing ? '?edit=' . rawurlencode($editSlug) : '' ?>">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <input type="hidden" name="form_mode" value="<?= $editing ? 'edit' : 'add' ?>">
                <?php if ($editing): ?>
                    <input type="hidden" name="original_slug" value="<?= admin_games_h($editSlug) ?>">
                <?php endif; ?>

                <label class="admin-field" for="game-slug">
                    <span>Slug</span>
                    <small>Lowercase words and hyphens; this stays locked while editing.</small>
                    <input id="game-slug" name="slug" type="text" value="<?= admin_games_h($editing ? $editSlug : ($formGame['slug'] ?? '')) ?>" required maxlength="160" pattern="[a-z0-9]+(-[a-z0-9]+)*"<?= $editing ? ' readonly' : '' ?>>
                </label>

                <label class="admin-field" for="game-name">
                    <span>Name</span>
                    <input id="game-name" name="name" type="text" value="<?= admin_games_h($formGame['name'] ?? '') ?>" required maxlength="255">
                </label>

                <label class="admin-field" for="game-description">
                    <span>Short description</span>
                    <small>The quick pitch shown before players press start.</small>
                    <textarea id="game-description" name="shortDescription" rows="4" required maxlength="2000"><?= admin_games_h($formGame['shortDescription'] ?? '') ?></textarea>
                </label>

                <label class="admin-field" for="game-notes">
                    <span>Strategy notes</span>
                    <small>One note per line for tips, quirks, or launch context.</small>
                    <textarea id="game-notes" name="strategyNotes" rows="5"><?= admin_games_h(admin_games_notes_text($formGame)) ?></textarea>
                </label>

                <label class="admin-field" for="game-status">
                    <span>Status</span>
                    <select id="game-status" name="status" required>
                        <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                            <option value="<?= $status ?>"<?= ($formGame['status'] ?? 'draft') === $status ? ' selected' : '' ?>><?= ucfirst($status) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <div class="admin-action-row">
                    <button type="submit"><?= $editing ? 'Update game' : 'Create game' ?></button>
                    <?php if ($editing): ?>
                        <a class="admin-button admin-button-secondary" href="/admin/games.php">Cancel editing</a>
                    <?php endif; ?>
                </div>
            </form>
        </section>

        <section class="admin-panel" aria-labelledby="games-list-title">
            <h2 id="games-list-title">Game cabinet</h2>
            <p>Review slugs and status before opening a game for edits.</p>
            <?php if ($games === []): ?>
                <p>No games yet. Add the first playable thing above.</p>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th scope="col">Title</th>
                            <th scope="col">Slug</th>
                            <th scope="col">Status</th>
                            <th scope="col">Updated</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($games as $game): ?>
                            <tr>
                                <td><?= admin_games_h($game['name'] ?? '') ?></td>
                                <td><?= admin_games_h($game['slug'] ?? '') ?></td>
                                <td><?= admin_games_h($game['status'] ?? '') ?></td>
                                <td><?= admin_games_h($game['updated_at'] ?? '') ?></td>
                                <td>
                                    <a class="admin-button admin-button-secondary" href="/admin/games.php?edit=<?= rawurlencode((string) ($game['slug'] ?? '')) ?>">Edit game</a>
                                    <form method="post" action="/admin/games.php" class="admin-inline-form">
                                        <?= admin_csrf_field() ?>
                                        <input type="hidden" name="action" value="delete">
                                        <input type="hidden" name="slug" value="<?= admin_games_h($game['slug'] ?? '') ?>">
                                        <button type="submit">Delete game</button>
                                    </form>
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

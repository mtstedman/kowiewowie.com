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

/**
 * @param mixed $status
 * @return array{0: string, 1: string, 2: string} [css key, label, visitor-facing meaning]
 */
function admin_games_status_text($status): array
{
    $status = is_scalar($status) ? (string) $status : '';

    return match ($status) {
        'draft' => ['draft', 'Draft', 'Hidden from visitors'],
        'published' => ['published', 'Published', 'Visible on the public site'],
        'archived' => ['archived', 'Archived', 'Hidden from visitors, kept for reference'],
        default => ['unknown', $status !== '' ? $status : 'Unknown', 'Unrecognised status'],
    };
}

/** @param array<string, mixed> $game */
function admin_games_name(array $game): string
{
    foreach (['name', 'slug'] as $key) {
        $value = $game[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }

    return 'Untitled game';
}

function admin_games_count_text(int $count): string
{
    if ($count === 0) {
        return 'No games yet.';
    }
    if ($count >= 100) {
        return 'Showing the first ' . $count . ' games.';
    }

    return $count === 1 ? 'Showing 1 game.' : 'Showing ' . $count . ' games.';
}

$mode = 'browse';
$failedAction = null;
$deleteGame = null;
$games = [];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $failedAction = $action;

    if ($action === 'save') {
        $isEdit = ($_POST['form_mode'] ?? '') === 'edit';
        $input = admin_games_post_input($isEdit);
        $editing = $isEdit;
        $editSlug = $isEdit ? $input['slug'] : '';
        $formGame = $input;
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
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
        $failedAction ??= 'load';
    }
}

if ($formGame !== null) {
    $mode = $editing ? 'edit' : 'create';
} elseif (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $deleteSlug = is_string($_GET['delete'] ?? null) ? trim($_GET['delete']) : '';
    if ($deleteSlug !== '') {
        try {
            $deleteGame = $repository->find('games', $deleteSlug, true);
            $mode = 'delete';
        } catch (Throwable $error) {
            $errors[] = $error instanceof ApiException && $error->status === 404 ? 'That game no longer exists.' : $error->getMessage();
            $failedAction = 'load';
        }
    } elseif ($editSlug === '' && ($_GET['new'] ?? null) === '1') {
        $mode = 'create';
    }
}

try {
    $games = $repository->list('games', 100, 0, true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Games',
    static function () use ($games, $messages, $errors, $editing, $editSlug, $formGame, $mode, $failedAction, $deleteGame): void {
        $formGame ??= [
            'slug' => '',
            'name' => '',
            'shortDescription' => '',
            'strategyNotes' => [],
            'status' => 'draft',
        ];
        $isEditor = $mode === 'create' || $mode === 'edit';
        $editorName = admin_games_name($editing ? ['name' => $formGame['name'] ?? '', 'slug' => $editSlug] : $formGame);
        $currentStatus = is_scalar($formGame['status'] ?? null) ? (string) $formGame['status'] : 'draft';
        $deleteSlug = $deleteGame !== null && is_scalar($deleteGame['slug'] ?? null) ? (string) $deleteGame['slug'] : '';

        if ($failedAction === 'save') {
            $errorTitle = 'Game not saved';
            $errorHelp = 'Nothing was saved. Your entries are still in the form below; fix the problems listed and save again.';
        } elseif ($failedAction === 'delete') {
            $errorTitle = 'Game not deleted';
            $errorHelp = 'Nothing was deleted. Check the list below and try again.';
        } else {
            $errorTitle = 'Something needs attention';
            $errorHelp = 'Return to the game list and try again. If the problem continues, refresh the page.';
        }
        ?>
        <section class="admin-hero" aria-labelledby="games-title">
            <p class="admin-eyebrow">Content manager</p>
            <h1 id="games-title">Games</h1>
            <p>Keep names, pitches, strategy notes, and status tidy so each public game page launches cleanly.</p>
        </section>

        <?php foreach ($messages as $message): ?>
            <div class="admin-panel admin-notice admin-notice-success" role="status">
                <p><?= admin_games_h($message) ?></p>
            </div>
        <?php endforeach; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel admin-notice admin-notice-error" role="alert" aria-labelledby="games-errors-title">
                <h2 id="games-errors-title"><?= admin_games_h($errorTitle) ?></h2>
                <p><?= admin_games_h($errorHelp) ?></p>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_games_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($mode === 'delete' && $deleteGame !== null): ?>
            <?php $deleteName = admin_games_name($deleteGame); ?>
            <section class="admin-panel admin-confirm" id="game-delete" aria-labelledby="game-delete-title">
                <p class="admin-eyebrow">Confirm deletion</p>
                <h2 id="game-delete-title">Delete &ldquo;<?= admin_games_h($deleteName) ?>&rdquo;?</h2>
                <p>This permanently removes the game <code><?= admin_games_h($deleteSlug) ?></code> from the admin and the public site. It cannot be undone.</p>
                <p>To hide it from visitors but keep it, <a href="/admin/games.php?edit=<?= rawurlencode($deleteSlug) ?>#game-editor">edit the game</a> and set its status to Archived instead.</p>
                <form method="post" action="/admin/games.php" class="admin-form admin-confirm-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="slug" value="<?= admin_games_h($deleteSlug) ?>">
                    <div class="admin-action-row">
                        <button type="submit" class="admin-button-danger">Delete &ldquo;<?= admin_games_h($deleteName) ?>&rdquo;</button>
                        <a class="admin-button admin-button-secondary" href="/admin/games.php">Cancel, keep game</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <?php if ($isEditor): ?>
            <section class="admin-panel admin-editor" id="game-editor" aria-labelledby="game-form-title">
                <p class="admin-eyebrow"><?= $editing ? 'Editing game' : 'New game' ?></p>
                <h2 id="game-form-title">
                    <?php if ($editing): ?>
                        Edit &ldquo;<?= admin_games_h($editorName) ?>&rdquo;
                    <?php else: ?>
                        Add a game
                    <?php endif; ?>
                </h2>
                <p>Fields marked required must be filled in before saving.</p>
                <form method="post" action="/admin/games.php<?= $editing ? '?edit=' . rawurlencode($editSlug) : '' ?>" class="admin-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="save">
                    <input type="hidden" name="form_mode" value="<?= $editing ? 'edit' : 'add' ?>">
                    <?php if ($editing): ?>
                        <input type="hidden" name="original_slug" value="<?= admin_games_h($editSlug) ?>">
                    <?php endif; ?>

                    <fieldset class="admin-fieldset">
                        <legend>Basics</legend>

                        <?php if ($editing): ?>
                            <div class="admin-field admin-field-locked">
                                <span class="admin-field-label">Slug (locked)</span>
                                <p class="admin-locked-value"><code><?= admin_games_h($editSlug) ?></code></p>
                                <small>Slugs are locked after creation so existing game links keep working. To use a different URL, create a new game and delete this one.</small>
                            </div>
                        <?php else: ?>
                            <div class="admin-field">
                                <label for="game-slug">Slug <span class="admin-required">(required)</span></label>
                                <small id="game-slug-help">Lowercase letters, numbers, and single hyphens, for example <code>space-dodger</code>. This becomes the game URL and is locked once the game is created.</small>
                                <input id="game-slug" name="slug" type="text" value="<?= admin_games_h($formGame['slug'] ?? '') ?>" required maxlength="160" pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="game-slug-help">
                            </div>
                        <?php endif; ?>

                        <div class="admin-field">
                            <label for="game-name">Name <span class="admin-required">(required)</span></label>
                            <input id="game-name" name="name" type="text" value="<?= admin_games_h($formGame['name'] ?? '') ?>" required maxlength="255">
                        </div>

                        <div class="admin-field">
                            <label for="game-description">Short description <span class="admin-required">(required)</span></label>
                            <small id="game-description-help">The quick pitch shown before players press start.</small>
                            <textarea id="game-description" name="shortDescription" rows="4" required maxlength="2000" aria-describedby="game-description-help"><?= admin_games_h($formGame['shortDescription'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Strategy</legend>

                        <div class="admin-field">
                            <label for="game-notes">Strategy notes <span class="admin-optional">(optional)</span></label>
                            <small id="game-notes-help">One note per line for tips, quirks, or launch context. Blank lines are ignored.</small>
                            <textarea id="game-notes" name="strategyNotes" rows="5" aria-describedby="game-notes-help"><?= admin_games_h(admin_games_notes_text($formGame)) ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Publishing</legend>

                        <div class="admin-field">
                            <label for="game-status">Status</label>
                            <small id="game-status-help">Draft and Archived games are hidden from visitors. Published games appear on the public site.</small>
                            <select id="game-status" name="status" required aria-describedby="game-status-help">
                                <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                                    <?php [, $statusLabel, $statusMeaning] = admin_games_status_text($status); ?>
                                    <option value="<?= $status ?>"<?= $currentStatus === $status ? ' selected' : '' ?>><?= admin_games_h($statusLabel . ' - ' . $statusMeaning) ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                    </fieldset>

                    <div class="admin-action-row">
                        <button type="submit"><?= $editing ? 'Save changes' : 'Create game' ?></button>
                        <a class="admin-button admin-button-secondary" href="/admin/games.php">Cancel</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <section class="admin-panel admin-records" id="games-list" aria-labelledby="games-list-title">
            <div class="admin-records-header">
                <div>
                    <h2 id="games-list-title">All games</h2>
                    <p id="games-list-count"><?= admin_games_h(admin_games_count_text(count($games))) ?></p>
                </div>
                <?php if ($mode !== 'create' && $games !== []): ?>
                    <a class="admin-button" href="/admin/games.php?new=1#game-editor">Add game</a>
                <?php endif; ?>
            </div>

            <?php if ($games === []): ?>
                <div class="admin-empty">
                    <?php if ($mode === 'create'): ?>
                        <p>Fill in the form above to add the first game.</p>
                    <?php else: ?>
                        <p>The arcade shelf is empty. Add a game to get the first cabinet running.</p>
                        <a class="admin-button" href="/admin/games.php?new=1#game-editor">Add the first game</a>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table admin-records-table" aria-labelledby="games-list-title" aria-describedby="games-list-count">
                    <thead>
                        <tr>
                            <th scope="col">Name</th>
                            <th scope="col">Status</th>
                            <th scope="col">Slug</th>
                            <th scope="col">Updated</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($games as $game): ?>
                            <?php
                            $slug = is_scalar($game['slug'] ?? null) ? (string) $game['slug'] : '';
                            $name = admin_games_name($game);
                            [$statusKey, $statusLabel, $statusMeaning] = admin_games_status_text($game['status'] ?? '');
                            $isCurrent = ($mode === 'edit' && $slug === $editSlug) || ($mode === 'delete' && $slug === $deleteSlug);
                            ?>
                            <tr<?= $isCurrent ? ' class="admin-record-current" aria-current="true"' : '' ?>>
                                <th scope="row" class="admin-record-title"><?= admin_games_h($name) ?></th>
                                <td>
                                    <span class="admin-status admin-status-<?= admin_games_h($statusKey) ?>"><?= admin_games_h($statusLabel) ?></span>
                                    <small class="admin-status-help"><?= admin_games_h($statusMeaning) ?></small>
                                </td>
                                <td><code><?= admin_games_h($slug) ?></code></td>
                                <td><?= admin_games_h($game['updated_at'] ?? '') ?></td>
                                <td class="admin-record-actions">
                                    <a class="admin-button admin-button-secondary" href="/admin/games.php?edit=<?= rawurlencode($slug) ?>#game-editor" aria-label="Edit game &ldquo;<?= admin_games_h($name) ?>&rdquo;">Edit</a>
                                    <a class="admin-button admin-button-secondary admin-button-danger" href="/admin/games.php?delete=<?= rawurlencode($slug) ?>#game-delete" aria-label="Delete game &ldquo;<?= admin_games_h($name) ?>&rdquo;">Delete</a>
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

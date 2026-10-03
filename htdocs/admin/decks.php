<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$notice = null;
$errors = [];
$mode = 'add';
$formDeck = admin_decks_blank_deck();

$resultNotice = is_string($_GET['result'] ?? null) ? $_GET['result'] : '';
if ($resultNotice === 'created') {
    $notice = 'Deck added to the binder. You can keep editing it below.';
} elseif ($resultNotice === 'updated') {
    $notice = 'Deck changes saved.';
} elseif ($resultNotice === 'deleted') {
    $notice = 'Deck removed from the binder.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $postAction = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $originalSlug = '';
    if ($postAction === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $formDeck = admin_decks_input_from_post($originalSlug !== '' ? $originalSlug : null);
        $mode = $originalSlug !== '' ? 'edit' : 'add';
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Reload the page and try again.';
    } elseif ($postAction === 'save') {
        try {
            $result = $repository->save('decks', $formDeck, admin_decks_actor_id($user));
            $savedDeck = is_array($result['item'] ?? null) ? $result['item'] : $formDeck;
            $savedSlug = trim(admin_decks_string($savedDeck['slug'] ?? $formDeck['slug'] ?? ''));
            admin_decks_redirect($mode === 'edit' ? 'updated' : 'created', $savedSlug !== '' ? $savedSlug : null);
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } elseif ($postAction === 'delete') {
        $slug = trim(is_string($_POST['slug'] ?? null) ? $_POST['slug'] : '');

        try {
            if ($slug === '') {
                throw new RuntimeException('Choose a deck to delete.');
            }
            $repository->delete('decks', $slug);
            admin_decks_redirect('deleted');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } else {
        $errors[] = 'Choose a valid deck action.';
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $requestedAction = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';
    $requestedSlug = trim(is_string($_GET['slug'] ?? null) ? $_GET['slug'] : '');

    if ($requestedAction === 'edit' && $requestedSlug !== '') {
        $mode = 'edit';
        try {
            $formDeck = $repository->find('decks', $requestedSlug, true);
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $mode = 'add';
            $formDeck = admin_decks_blank_deck();
        }
    }
}

try {
    $decks = $repository->list('decks', 100, 0, true);
} catch (Throwable $error) {
    $decks = [];
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Decks',
    static function () use ($decks, $errors, $notice, $mode, $formDeck): void {
        ?>
        <section class="admin-hero" aria-labelledby="decks-title">
            <p class="admin-eyebrow">Deck forge</p>
            <h1 id="decks-title">Decks with tidy piles.</h1>
            <p>Manage metadata, strategy notes, sections, and card rows before anything hits the public table.</p>
        </section>

        <?php if ($notice !== null): ?>
            <div class="admin-alert admin-alert-success" role="status" tabindex="-1"><?= admin_decks_h($notice) ?></div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <section class="admin-alert admin-alert-error" role="alert" aria-labelledby="deck-errors-title" tabindex="-1">
                <h2 id="deck-errors-title">Unable to save changes</h2>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_decks_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
                <p>Your deck details and card order are still in the editor below.</p>
            </section>
        <?php endif; ?>

        <section class="admin-panel" aria-labelledby="deck-list-title">
            <div class="admin-section-heading">
                <div>
                    <p class="admin-eyebrow">Browse</p>
                    <h2 id="deck-list-title">Deck binder</h2>
                    <p>Review each deck's name, publishing state, and stable URL before editing.</p>
                </div>
                <a class="admin-button admin-button-secondary" href="<?= $mode === 'edit' ? '/admin/decks.php#deck-form-title' : '#deck-form-title' ?>"><?= $mode === 'edit' ? 'Create another deck' : 'Create a deck' ?></a>
            </div>
            <?php if ($decks === []): ?>
                <p>No decks yet. Use the editor below to build the first list.</p>
            <?php else: ?>
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th scope="col">Deck</th>
                                <th scope="col">Status</th>
                                <th scope="col">Slug</th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($decks as $deck): ?>
                                <?php $slug = admin_decks_string($deck['slug'] ?? ''); ?>
                                <tr>
                                    <td>
                                        <strong><?= admin_decks_h(admin_decks_title($deck)) ?></strong>
                                        <small><?= admin_decks_h($deck['format'] ?? '') ?></small>
                                    </td>
                                    <td><?= admin_decks_h($deck['status'] ?? '') ?></td>
                                    <td><code><?= admin_decks_h($slug) ?></code></td>
                                    <td>
                                        <a class="admin-button admin-button-secondary" href="/admin/decks.php?action=edit&amp;slug=<?= rawurlencode($slug) ?>#deck-form-title">Edit deck</a>
                                        <form method="post" class="admin-inline-form" onsubmit="return confirm('Delete this deck permanently?');">
                                            <?= admin_csrf_field() ?>
                                            <input type="hidden" name="action" value="delete">
                                            <input type="hidden" name="slug" value="<?= admin_decks_h($slug) ?>">
                                            <button type="submit">Delete deck</button>
                                        </form>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            <?php endif; ?>
        </section>

        <section class="admin-panel" aria-labelledby="deck-form-title">
            <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Tune up' : 'New build' ?></p>
            <h2 id="deck-form-title"><?= $mode === 'edit' ? 'Edit ' . admin_decks_h(admin_decks_title($formDeck)) : 'Create a deck' ?></h2>
            <p>Set the public details first, then organize cards into ordered sections. Changes are not published until you save.</p>

            <form method="post" class="admin-form" data-deck-form>
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <?php if ($mode === 'edit'): ?>
                    <input type="hidden" name="original_slug" value="<?= admin_decks_h($formDeck['slug'] ?? '') ?>">
                <?php endif; ?>

                <fieldset>
                    <legend>Identity and publishing</legend>
                    <p>These fields identify the deck in the admin list and on its public page.</p>
                    <label>
                        <span>Slug</span>
                        <small>Stable URL handle; edit mode locks it to protect existing links.</small>
                        <input name="slug" value="<?= admin_decks_h($formDeck['slug'] ?? '') ?>" required maxlength="160"<?= $mode === 'edit' ? ' readonly' : '' ?>>
                    </label>
                    <label>
                        <span>Name</span>
                        <input name="name" value="<?= admin_decks_h($formDeck['name'] ?? '') ?>" required maxlength="255">
                    </label>
                    <label>
                        <span>Game type</span>
                        <small>Examples: Modern, Commander, or Standard.</small>
                        <input name="format" value="<?= admin_decks_h($formDeck['format'] ?? '') ?>" required maxlength="120">
                    </label>
                    <label>
                        <span>Status</span>
                        <select name="status">
                            <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                                <option value="<?= admin_decks_h($status) ?>"<?= admin_decks_string($formDeck['status'] ?? 'draft') === $status ? ' selected' : '' ?>><?= admin_decks_h(ucfirst($status)) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </fieldset>

                <fieldset>
                    <legend>Deck overview</legend>
                    <label>
                        <span>Colors</span>
                        <small>Comma or slash separated, like W/U or blue, black.</small>
                        <input name="colors" value="<?= admin_decks_h(admin_decks_colors_text($formDeck['colors'] ?? [])) ?>" maxlength="255">
                    </label>
                    <label>
                        <span>Commander</span>
                        <input name="commander" value="<?= admin_decks_h($formDeck['commander'] ?? '') ?>" maxlength="255">
                    </label>
                    <label>
                        <span>Summary</span>
                        <textarea name="summary" rows="4" required><?= admin_decks_h($formDeck['summary'] ?? '') ?></textarea>
                    </label>
                    <label>
                        <span>Strategy</span>
                        <textarea name="strategy" rows="8" required><?= admin_decks_h($formDeck['strategy'] ?? '') ?></textarea>
                    </label>
                </fieldset>

                <fieldset>
                    <legend>Decklist sections and cards</legend>
                    <p>Drag card rows with a pointer, or use the move controls on each row and section.</p>
                    <div data-deck-editor>
                        <div class="admin-alert" data-editor-status role="status" aria-live="polite" tabindex="-1">Deck editor ready.</div>
                        <section aria-labelledby="card-search-title">
                            <h3 id="card-search-title">Find a card</h3>
                            <label>
                                <span>Search cards</span>
                                <small>Results include quantity and destination controls. You can also drag a result into a section.</small>
                                <input type="search" data-card-search-input placeholder="Search cards by name" autocomplete="off" spellcheck="false">
                            </label>
                            <div data-card-search-results aria-live="polite" aria-busy="false"></div>
                        </section>
                        <section aria-labelledby="deck-sections-title">
                            <h3 id="deck-sections-title">Ordered deck sections</h3>
                            <div data-deck-sections data-next-section="<?= admin_decks_section_count($formDeck['decklist'] ?? []) ?>">
                                <?php admin_decks_render_sections($formDeck['decklist'] ?? []); ?>
                            </div>
                            <button type="button" data-add-section>Add section</button>
                        </section>
                    </div>
                </fieldset>

                <div class="admin-action-row">
                    <button type="submit"><?= $mode === 'edit' ? 'Save deck changes' : 'Create deck' ?></button>
                    <a class="admin-button admin-button-secondary" href="/admin/decks.php" data-cancel-editor><?= $mode === 'edit' ? 'Cancel editing' : 'Cancel and clear' ?></a>
                </div>
            </form>
        </section>

        <script src="/assets/js/admin-decks.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/admin-decks.js') ?>"></script>
        <?php
    },
    $user,
);

function admin_decks_redirect(string $result, ?string $slug = null): void
{
    $query = ['result' => $result];
    if ($slug !== null && $slug !== '') {
        $query['action'] = 'edit';
        $query['slug'] = $slug;
    }

    header('Location: /admin/decks.php?' . http_build_query($query) . ($slug !== null ? '#deck-form-title' : ''), true, 303);
    exit;
}

/** @return array<string, mixed> */
function admin_decks_blank_deck(): array
{
    return [
        'slug' => '',
        'name' => '',
        'format' => '',
        'colors' => [],
        'commander' => '',
        'status' => 'draft',
        'summary' => '',
        'strategy' => '',
        'decklist' => ['Mainboard' => [[
            'quantity' => 1,
            'name' => '',
            'card_id' => null,
            'image_url' => null,
        ]]],
    ];
}

/** @return array<string, mixed> */
function admin_decks_input_from_post(?string $lockedSlug): array
{
    $colors = [];
    $colorsText = trim(admin_decks_post_string('colors'));
    if ($colorsText !== '') {
        $colors = array_values(array_filter(
            array_map('trim', preg_split('/[,\/]+/', $colorsText) ?: []),
            static fn (string $color): bool => $color !== '',
        ));
    }

    return [
        'slug' => $lockedSlug ?? admin_decks_post_string('slug'),
        'name' => admin_decks_post_string('name'),
        'format' => admin_decks_post_string('format'),
        'colors' => $colors,
        'commander' => admin_decks_post_string('commander'),
        'status' => admin_decks_post_string('status', 'draft'),
        'summary' => admin_decks_post_string('summary'),
        'strategy' => admin_decks_post_string('strategy'),
        'decklist' => admin_decks_post_decklist(),
    ];
}

function admin_decks_post_string(string $key, string $default = ''): string
{
    $value = $_POST[$key] ?? $default;
    return is_scalar($value) ? trim((string) $value) : $default;
}

/** @return array<string, list<array{quantity: int, name: string, card_id: ?string, image_url: ?string}>> */
function admin_decks_post_decklist(): array
{
    $decklist = [];
    $sections = $_POST['deck_sections'] ?? [];
    if (!is_array($sections)) {
        return $decklist;
    }

    foreach ($sections as $sectionData) {
        if (!is_array($sectionData)) {
            continue;
        }

        $sectionName = trim(is_string($sectionData['name'] ?? null) ? $sectionData['name'] : '');
        $cards = [];
        $cardRows = $sectionData['cards'] ?? [];
        if (is_array($cardRows)) {
            foreach ($cardRows as $cardRow) {
                if (!is_array($cardRow)) {
                    continue;
                }

                $quantityText = trim(is_scalar($cardRow['quantity'] ?? null) ? (string) $cardRow['quantity'] : '');
                $cardName = trim(is_string($cardRow['name'] ?? null) ? $cardRow['name'] : '');
                $cardId = trim(is_string($cardRow['card_id'] ?? null) ? $cardRow['card_id'] : '');
                $imageUrl = trim(is_string($cardRow['image_url'] ?? null) ? $cardRow['image_url'] : '');
                if ($cardName === '' && $cardId === '') {
                    continue;
                }
                $cards[] = [
                    'quantity' => (int) $quantityText,
                    'name' => $cardName,
                    'card_id' => $cardId !== '' ? $cardId : null,
                    'image_url' => $imageUrl !== '' ? $imageUrl : null,
                ];
            }
        }

        if ($sectionName !== '' || $cards !== []) {
            $decklist[$sectionName] = $cards;
        }
    }

    return $decklist;
}

/** @param array<string, mixed> $user */
function admin_decks_actor_id(array $user): ?string
{
    $id = $user['id'] ?? $user['user_id'] ?? null;
    return is_scalar($id) ? (string) $id : null;
}

function admin_decks_h(mixed $value): string
{
    return htmlspecialchars(admin_decks_string($value), ENT_QUOTES, 'UTF-8');
}

function admin_decks_string(mixed $value): string
{
    return is_scalar($value) ? (string) $value : '';
}

/** @param array<string, mixed> $deck */
function admin_decks_title(array $deck): string
{
    $name = admin_decks_string($deck['name'] ?? '');
    return $name !== '' ? $name : admin_decks_string($deck['title'] ?? 'Untitled deck');
}

function admin_decks_colors_text(mixed $colors): string
{
    if (!is_array($colors)) {
        return '';
    }

    return implode(', ', array_map('admin_decks_string', $colors));
}

function admin_decks_section_count(mixed $decklist): int
{
    if (!is_array($decklist) || $decklist === []) {
        return 1;
    }

    return count($decklist);
}

function admin_decks_render_sections(mixed $decklist): void
{
    if (!is_array($decklist) || $decklist === []) {
        $decklist = ['Mainboard' => [[
            'quantity' => 1,
            'name' => '',
            'card_id' => null,
            'image_url' => null,
        ]]];
    }

    $sectionIndex = 0;
    foreach ($decklist as $sectionName => $cards) {
        if (!is_array($cards) || $cards === []) {
            $cards = [[
                'quantity' => 1,
                'name' => '',
                'card_id' => null,
                'image_url' => null,
            ]];
        }
        ?>
        <article class="admin-deck-section" data-section data-section-index="<?= $sectionIndex ?>" data-next-card="<?= count($cards) ?>">
            <div class="admin-section-heading">
                <h4 data-section-heading>Section <?= $sectionIndex + 1 ?></h4>
                <div class="admin-action-row" aria-label="Section ordering controls">
                    <button type="button" data-move-section-up>Move section up</button>
                    <button type="button" data-move-section-down>Move section down</button>
                    <button type="button" data-remove-section>Remove section</button>
                </div>
            </div>
            <label>
                <span>Section name</span>
                <input name="deck_sections[<?= $sectionIndex ?>][name]" value="<?= admin_decks_h($sectionName) ?>" required maxlength="120">
            </label>
            <div data-card-list aria-label="Cards in <?= admin_decks_h($sectionName !== '' ? $sectionName : 'this section') ?>">
                <?php foreach (array_values($cards) as $cardIndex => $card): ?>
                    <?php
                    $quantity = '1';
                    $name = '';
                    $cardId = '';
                    $imageUrl = '';
                    if (is_array($card)) {
                        $quantity = admin_decks_string($card['quantity'] ?? '1');
                        $name = admin_decks_string($card['name'] ?? '');
                        $cardId = admin_decks_string($card['card_id'] ?? '');
                        $imageUrl = admin_decks_string($card['image_url'] ?? '');
                    } elseif (is_scalar($card)) {
                        $name = (string) $card;
                    }
                    ?>
                    <div class="admin-form-row" data-card-row data-section-index="<?= $sectionIndex ?>" data-card-index="<?= $cardIndex ?>" draggable="true">
                        <div data-card-image>
                            <?php if ($imageUrl !== ''): ?>
                                <img src="<?= admin_decks_h($imageUrl) ?>" alt="<?= admin_decks_h($name) ?> card art" loading="lazy">
                            <?php endif; ?>
                        </div>
                        <label>
                            <span>Quantity</span>
                            <input type="number" min="1" max="999" step="1" name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][quantity]" value="<?= admin_decks_h($quantity) ?>" inputmode="numeric" required>
                        </label>
                        <label>
                            <span>Card</span>
                            <input name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][name]" value="<?= admin_decks_h($name) ?>" required maxlength="255">
                        </label>
                        <input type="hidden" name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][card_id]" value="<?= admin_decks_h($cardId) ?>">
                        <input type="hidden" name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][image_url]" value="<?= admin_decks_h($imageUrl) ?>">
                        <div class="admin-action-row" data-card-controls aria-label="Card ordering controls">
                            <button type="button" data-move-card-up>Move up</button>
                            <button type="button" data-move-card-down>Move down</button>
                            <label>
                                <span>Move to section</span>
                                <select data-move-card-select></select>
                            </label>
                            <button type="button" data-move-card-section>Move card</button>
                            <button type="button" data-remove-card>Remove card</button>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
            <button type="button" data-add-card>Add blank card row</button>
        </article>
        <?php
        ++$sectionIndex;
    }
}

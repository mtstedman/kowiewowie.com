<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/layout.php';

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$messages = [];
$errors = [];
$mode = 'add';
$formDeck = admin_decks_blank_deck();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Reload the page and try again.';
    } else {
        $postAction = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';

        if ($postAction === 'save') {
            $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
            $formDeck = admin_decks_input_from_post($originalSlug !== '' ? $originalSlug : null);
            $mode = $originalSlug !== '' ? 'edit' : 'add';

            try {
                $result = $repository->save('decks', $formDeck, admin_decks_actor_id($user));
                $formDeck = is_array($result['item'] ?? null) ? $result['item'] : $formDeck;
                $messages[] = $mode === 'edit' ? 'Deck updated.' : 'Deck created.';
                if ($mode === 'add') {
                    $formDeck = admin_decks_blank_deck();
                }
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
                $messages[] = 'Deck deleted.';
            } catch (Throwable $error) {
                $errors[] = $error->getMessage();
            }
        }
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
    static function () use ($decks, $errors, $messages, $mode, $formDeck): void {
        ?>
        <section class="admin-panel" aria-labelledby="decks-title">
            <p class="admin-eyebrow">Content</p>
            <h1 id="decks-title">Decks</h1>

            <?php foreach ($messages as $message): ?>
                <div class="admin-alert admin-alert-success" role="status"><?= admin_decks_h($message) ?></div>
            <?php endforeach; ?>

            <?php foreach ($errors as $error): ?>
                <div class="admin-alert admin-alert-error" role="alert"><?= admin_decks_h($error) ?></div>
            <?php endforeach; ?>

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
                        <?php if ($decks === []): ?>
                            <tr>
                                <td colspan="4">No decks have been created yet.</td>
                            </tr>
                        <?php endif; ?>
                        <?php foreach ($decks as $deck): ?>
                            <?php $slug = admin_decks_string($deck['slug'] ?? ''); ?>
                            <tr>
                                <td><?= admin_decks_h(admin_decks_title($deck)) ?></td>
                                <td><?= admin_decks_h($deck['status'] ?? '') ?></td>
                                <td><?= admin_decks_h($slug) ?></td>
                                <td>
                                    <a href="/admin/decks.php?action=edit&amp;slug=<?= rawurlencode($slug) ?>">Edit</a>
                                    <form method="post" class="admin-inline-form" onsubmit="return confirm('Delete this deck?');">
                                        <?= admin_csrf_field() ?>
                                        <input type="hidden" name="action" value="delete">
                                        <input type="hidden" name="slug" value="<?= admin_decks_h($slug) ?>">
                                        <button type="submit">Delete</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>

        <section class="admin-panel" aria-labelledby="deck-form-title">
            <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Edit' : 'Add' ?></p>
            <h2 id="deck-form-title"><?= $mode === 'edit' ? 'Edit deck' : 'Add deck' ?></h2>

            <form method="post" class="admin-form">
                <?= admin_csrf_field() ?>
                <input type="hidden" name="action" value="save">
                <?php if ($mode === 'edit'): ?>
                    <input type="hidden" name="original_slug" value="<?= admin_decks_h($formDeck['slug'] ?? '') ?>">
                <?php endif; ?>

                <label>
                    <span>Slug</span>
                    <input name="slug" value="<?= admin_decks_h($formDeck['slug'] ?? '') ?>" required maxlength="160"<?= $mode === 'edit' ? ' readonly' : '' ?>>
                </label>

                <label>
                    <span>Name</span>
                    <input name="name" value="<?= admin_decks_h($formDeck['name'] ?? '') ?>" required maxlength="255">
                </label>

                <label>
                    <span>Format</span>
                    <input name="format" value="<?= admin_decks_h($formDeck['format'] ?? '') ?>" required maxlength="120">
                </label>

                <label>
                    <span>Colors</span>
                    <input name="colors" value="<?= admin_decks_h(admin_decks_colors_text($formDeck['colors'] ?? [])) ?>" maxlength="255">
                </label>

                <label>
                    <span>Commander</span>
                    <input name="commander" value="<?= admin_decks_h($formDeck['commander'] ?? '') ?>" maxlength="255">
                </label>

                <label>
                    <span>Status</span>
                    <select name="status">
                        <?php foreach (['draft', 'published', 'archived'] as $status): ?>
                            <option value="<?= admin_decks_h($status) ?>"<?= admin_decks_string($formDeck['status'] ?? 'draft') === $status ? ' selected' : '' ?>><?= admin_decks_h($status) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <label>
                    <span>Summary</span>
                    <textarea name="summary" rows="4" required><?= admin_decks_h($formDeck['summary'] ?? '') ?></textarea>
                </label>

                <label>
                    <span>Strategy</span>
                    <textarea name="strategy" rows="8" required><?= admin_decks_h($formDeck['strategy'] ?? '') ?></textarea>
                </label>

                <fieldset>
                    <legend>Decklist</legend>
                    <div data-deck-editor>
                        <label>
                            <span>Search cards</span>
                            <input type="search" data-card-search-input placeholder="Search Scryfall cards" autocomplete="off" spellcheck="false">
                        </label>
                        <div data-card-search-results aria-live="polite"></div>
                        <div data-deck-sections data-next-section="<?= admin_decks_section_count($formDeck['decklist'] ?? []) ?>">
                            <?php admin_decks_render_sections($formDeck['decklist'] ?? []); ?>
                        </div>
                    </div>
                    <button type="button" data-add-section>Add section</button>
                </fieldset>

                <button type="submit"><?= $mode === 'edit' ? 'Update deck' : 'Create deck' ?></button>
                <?php if ($mode === 'edit'): ?>
                    <a href="/admin/decks.php">Cancel edit</a>
                <?php endif; ?>
            </form>
        </section>

        <script src="/assets/js/admin-decks.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/admin-decks.js') ?>"></script>
        <?php
    },
    $user,
);

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
                if ($quantityText === '' && $cardName === '') {
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
        <div class="admin-deck-section" data-section data-section-index="<?= $sectionIndex ?>" data-next-card="<?= count($cards) ?>">
            <label>
                <span>Section name</span>
                <input name="deck_sections[<?= $sectionIndex ?>][name]" value="<?= admin_decks_h($sectionName) ?>" required maxlength="120">
            </label>
            <div data-card-list>
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
                    <div class="admin-form-row" data-card-row>
                        <div data-card-image>
                            <?php if ($imageUrl !== ''): ?>
                                <img src="<?= admin_decks_h($imageUrl) ?>" alt="<?= admin_decks_h($name) ?> card art" loading="lazy">
                            <?php endif; ?>
                        </div>
                        <label>
                            <span>Quantity</span>
                            <input name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][quantity]" value="<?= admin_decks_h($quantity) ?>" inputmode="numeric" required>
                        </label>
                        <label>
                            <span>Card</span>
                            <input name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][name]" value="<?= admin_decks_h($name) ?>" required maxlength="255">
                        </label>
                        <input type="hidden" name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][card_id]" value="<?= admin_decks_h($cardId) ?>">
                        <input type="hidden" name="deck_sections[<?= $sectionIndex ?>][cards][<?= $cardIndex ?>][image_url]" value="<?= admin_decks_h($imageUrl) ?>">
                        <button type="button" data-remove-card>Remove</button>
                    </div>
                <?php endforeach; ?>
            </div>
            <button type="button" data-add-card>Add card</button>
            <button type="button" data-remove-section>Remove section</button>
        </div>
        <?php
        ++$sectionIndex;
    }
}

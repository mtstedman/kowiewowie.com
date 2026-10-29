<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

/** @param mixed $value */
function admin_books_h($value): string
{
    return htmlspecialchars(is_scalar($value) ? (string) $value : '', ENT_QUOTES, 'UTF-8');
}

/** @return array<string, mixed> */
function admin_books_blank(): array
{
    return [
        'slug' => '',
        'title' => '',
        'author' => '',
        'amazon_url' => '',
        'cover_image_url' => '',
        'price_amount' => '',
        'price_currency' => 'USD',
        'overview' => '',
        'status' => 'draft',
    ];
}

function admin_books_suggest_slug(string $title): string
{
    $ascii = function_exists('iconv') ? iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $title) : $title;
    $ascii = is_string($ascii) ? strtolower($ascii) : strtolower($title);
    $ascii = str_replace(["'", '’'], '', $ascii);
    $slug = preg_replace('/[^a-z0-9]+/', '-', $ascii);
    $slug = trim(is_string($slug) ? $slug : '', '-');
    $slug = substr($slug, 0, 160);

    return trim($slug, '-');
}

/** @param array<string, mixed> $source @return array<string, mixed> */
function admin_books_input_from_post(array $source, ?string $fixedSlug): array
{
    $title = $source['title'] ?? '';
    $slug = $fixedSlug ?? ($source['slug'] ?? '');
    if ($fixedSlug === null && is_scalar($slug) && trim((string) $slug) === '' && is_scalar($title)) {
        $slug = admin_books_suggest_slug((string) $title);
    }

    return [
        'slug' => $slug,
        'title' => $title,
        'author' => $source['author'] ?? '',
        'amazon_url' => $source['amazon_url'] ?? '',
        'cover_image_url' => $source['cover_image_url'] ?? '',
        'price_amount' => $source['price_amount'] ?? '',
        'price_currency' => $source['price_currency'] ?? 'USD',
        'overview' => $source['overview'] ?? '',
        'status' => $source['status'] ?? 'draft',
    ];
}

/** @param array<string, mixed> $user */
function admin_books_actor_id(array $user): ?string
{
    foreach (['id', 'user_id', 'sub'] as $key) {
        $value = $user[$key] ?? null;
        if (is_scalar($value) && (string) $value !== '') {
            return (string) $value;
        }
    }

    return null;
}

function admin_books_redirect(string $result): void
{
    header('Location: /admin/books.php?' . http_build_query(['result' => $result]), true, 303);
    exit;
}

function admin_books_status_option(string $value, string $label, string $current): void
{
    ?>
    <option value="<?= admin_books_h($value) ?>"<?= $current === $value ? ' selected' : '' ?>><?= admin_books_h($label) ?></option>
    <?php
}

/**
 * @param mixed $status
 * @return array{0: string, 1: string, 2: string}
 */
function admin_books_status_text($status): array
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
function admin_books_name(array $entry): string
{
    foreach (['title', 'slug'] as $key) {
        $value = $entry[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }

    return 'Untitled book';
}

function admin_books_count_text(int $count): string
{
    if ($count === 0) {
        return 'No book recommendations yet.';
    }
    if ($count >= 100) {
        return 'Showing the first ' . $count . ' book recommendations.';
    }

    return $count === 1 ? 'Showing 1 book recommendation.' : 'Showing ' . $count . ' book recommendations.';
}

if (defined('ADMIN_BOOKS_HELPERS_ONLY')) {
    return;
}

$user = admin_require_user();
admin_require_admin($user);

$repository = admin_content_repository();
$errors = [];
$notice = null;
$bookEntries = [];
$editingSlug = null;
$formBook = admin_books_blank();
$mode = 'browse';
$failedAction = null;
$deleteBook = null;

$result = $_GET['result'] ?? null;
if ($result === 'created') {
    $notice = 'Book recommendation created.';
} elseif ($result === 'updated') {
    $notice = 'Book recommendation changes saved.';
} elseif ($result === 'deleted') {
    $notice = 'Book recommendation deleted.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    $failedAction = $action;

    if ($action === 'save') {
        $originalSlug = trim(is_string($_POST['original_slug'] ?? null) ? $_POST['original_slug'] : '');
        $editingSlug = $originalSlug !== '' ? $originalSlug : null;
        $formBook = admin_books_input_from_post($_POST, $editingSlug);
        $mode = $editingSlug === null ? 'create' : 'edit';
    }

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $errors[] = 'Your session token expired. Please try again.';
    } elseif ($action === 'save') {
        try {
            if ($editingSlug !== null) {
                $repository->find('books', $editingSlug, true);
            }
            $repository->save('books', $formBook, admin_books_actor_id($user));
            admin_books_redirect($editingSlug === null ? 'created' : 'updated');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } elseif ($action === 'delete') {
        $slug = trim(is_string($_POST['slug'] ?? null) ? $_POST['slug'] : '');

        try {
            $repository->delete('books', $slug);
            admin_books_redirect('deleted');
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    } else {
        $errors[] = 'Unknown books action.';
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $edit = trim(is_string($_GET['edit'] ?? null) ? $_GET['edit'] : '');
    $delete = trim(is_string($_GET['delete'] ?? null) ? $_GET['delete'] : '');
    if ($edit !== '') {
        try {
            $formBook = $repository->find('books', $edit, true);
            $editingSlug = is_scalar($formBook['slug'] ?? null) ? (string) $formBook['slug'] : $edit;
            $mode = 'edit';
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
            $failedAction = 'load';
        }
    } elseif ($delete !== '') {
        try {
            $deleteBook = $repository->find('books', $delete, true);
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
    $bookEntries = $repository->list('books', 100, 0, true);
} catch (Throwable $error) {
    $errors[] = $error->getMessage();
}

admin_render_page(
    'Books',
    static function () use ($bookEntries, $formBook, $editingSlug, $errors, $notice, $mode, $failedAction, $deleteBook): void {
        $isEditor = $mode === 'create' || $mode === 'edit';
        $editorName = admin_books_name($formBook);
        $currentStatus = is_scalar($formBook['status'] ?? null) ? (string) $formBook['status'] : 'draft';
        $deleteSlug = $deleteBook !== null && is_scalar($deleteBook['slug'] ?? null) ? (string) $deleteBook['slug'] : '';

        if ($failedAction === 'save') {
            $errorTitle = 'Book recommendation not saved';
            $errorHelp = 'Nothing was saved. Your entries are still in the form below; fix the problems listed and save again.';
        } elseif ($failedAction === 'delete') {
            $errorTitle = 'Book recommendation not deleted';
            $errorHelp = 'The recommendation was left unchanged. Check the list below and try again.';
        } else {
            $errorTitle = 'Something needs attention';
            $errorHelp = 'Return to the books list and try again. If the problem continues, refresh the page.';
        }
        ?>
        <section class="admin-hero" aria-labelledby="books-title">
            <p class="admin-eyebrow">Content manager</p>
            <h1 id="books-title">Books</h1>
            <p>Recommend books with an Amazon link. You enter and maintain the cover, price, currency, and overview yourself; nothing is fetched from Amazon, and the stored price may differ when Amazon changes its listing.</p>
        </section>

        <?php if ($notice !== null): ?>
            <div class="admin-panel admin-notice admin-notice-success" role="status">
                <p><?= admin_books_h($notice) ?></p>
            </div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <div class="admin-panel admin-notice admin-notice-error" role="alert" aria-labelledby="books-errors-title">
                <h2 id="books-errors-title"><?= admin_books_h($errorTitle) ?></h2>
                <p><?= admin_books_h($errorHelp) ?></p>
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?= admin_books_h($error) ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($mode === 'delete' && $deleteBook !== null): ?>
            <?php $deleteName = admin_books_name($deleteBook); ?>
            <section class="admin-panel admin-confirm" id="books-delete" aria-labelledby="books-delete-title">
                <p class="admin-eyebrow">Confirm deletion</p>
                <h2 id="books-delete-title">Delete &ldquo;<?= admin_books_h($deleteName) ?>&rdquo;?</h2>
                <p>This permanently removes the book recommendation <code><?= admin_books_h($deleteSlug) ?></code> from the admin and the public API. It cannot be undone.</p>
                <p>To hide it from visitors but keep it, <a href="/admin/books.php?<?= admin_books_h(http_build_query(['edit' => $deleteSlug])) ?>#books-editor">edit the recommendation</a> and set its status to Archived instead.</p>
                <form method="post" action="/admin/books.php" class="admin-form admin-confirm-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="slug" value="<?= admin_books_h($deleteSlug) ?>">
                    <div class="admin-action-row">
                        <button type="submit" class="admin-button-danger">Delete &ldquo;<?= admin_books_h($deleteName) ?>&rdquo;</button>
                        <a class="admin-button admin-button-secondary" href="/admin/books.php">Cancel, keep recommendation</a>
                    </div>
                </form>
            </section>
        <?php endif; ?>

        <?php if ($isEditor): ?>
            <section class="admin-panel admin-editor" id="books-editor" aria-labelledby="books-form-title">
                <p class="admin-eyebrow"><?= $mode === 'edit' ? 'Editing book recommendation' : 'New book recommendation' ?></p>
                <h2 id="books-form-title">
                    <?php if ($mode === 'edit'): ?>
                        Edit &ldquo;<?= admin_books_h($editorName) ?>&rdquo;
                    <?php else: ?>
                        Add a book recommendation
                    <?php endif; ?>
                </h2>
                <p>Fields marked required must be filled in before saving. Cover, price, currency, and overview are manually entered metadata and can be corrected whenever the listing changes.</p>
                <form method="post" action="/admin/books.php" class="admin-form">
                    <?= admin_csrf_field() ?>
                    <input type="hidden" name="action" value="save">
                    <input type="hidden" name="original_slug" value="<?= admin_books_h($editingSlug ?? '') ?>">

                    <fieldset class="admin-fieldset">
                        <legend>Book</legend>

                        <?php if ($editingSlug !== null): ?>
                            <div class="admin-field admin-field-locked">
                                <span class="admin-field-label">Slug (locked)</span>
                                <p class="admin-locked-value"><code><?= admin_books_h($editingSlug) ?></code></p>
                                <small>Slugs are locked after creation so existing links keep working. Correct the suggested slug before creating the recommendation.</small>
                            </div>
                        <?php else: ?>
                            <div class="admin-field">
                                <label for="books-slug">Slug <span class="admin-required">(required)</span></label>
                                <small id="books-slug-help">A suggestion is generated from the title. Correct it before saving if needed; use lowercase letters, numbers, and hyphens.</small>
                                <input id="books-slug" name="slug" value="<?= admin_books_h($formBook['slug'] ?? '') ?>" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="160" aria-describedby="books-slug-help">
                                <button type="button" class="admin-button admin-button-secondary" id="books-slug-suggest">Suggest from title</button>
                            </div>
                        <?php endif; ?>

                        <div class="admin-field">
                            <label for="books-title-input">Title <span class="admin-required">(required)</span></label>
                            <input id="books-title-input" name="title" value="<?= admin_books_h($formBook['title'] ?? '') ?>" required maxlength="255">
                        </div>

                        <div class="admin-field">
                            <label for="books-author">Author <span class="admin-optional">(optional)</span></label>
                            <input id="books-author" name="author" value="<?= admin_books_h($formBook['author'] ?? '') ?>" maxlength="255">
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Recommendation details</legend>

                        <div class="admin-field">
                            <label for="books-amazon-url">Amazon URL <span class="admin-required">(required)</span></label>
                            <small id="books-amazon-url-help">Paste a genuine HTTPS Amazon marketplace or amzn.to link. The server does not open or resolve it.</small>
                            <input id="books-amazon-url" name="amazon_url" type="url" value="<?= admin_books_h($formBook['amazon_url'] ?? '') ?>" required maxlength="2000" aria-describedby="books-amazon-url-help">
                        </div>

                        <div class="admin-field">
                            <label for="books-cover-url">Cover image URL <span class="admin-required">(required)</span></label>
                            <small id="books-cover-url-help">Enter the direct HTTPS cover image URL yourself. It is stored exactly as recommendation metadata.</small>
                            <input id="books-cover-url" name="cover_image_url" type="url" value="<?= admin_books_h($formBook['cover_image_url'] ?? '') ?>" required maxlength="2000" aria-describedby="books-cover-url-help">
                        </div>

                        <div class="admin-field">
                            <label for="books-price-amount">Price amount <span class="admin-required">(required)</span></label>
                            <small id="books-price-help">Enter the displayed amount manually, for example 17.99. Amazon may change its price later, so update this stored value when needed.</small>
                            <input id="books-price-amount" name="price_amount" inputmode="decimal" value="<?= admin_books_h($formBook['price_amount'] ?? '') ?>" required pattern="[0-9]{1,10}(?:\.[0-9]{1,2})?" aria-describedby="books-price-help">
                        </div>

                        <div class="admin-field">
                            <label for="books-price-currency">Currency <span class="admin-required">(required)</span></label>
                            <small id="books-currency-help">Use an uppercase three-letter code such as USD, GBP, or CAD.</small>
                            <input id="books-price-currency" name="price_currency" value="<?= admin_books_h($formBook['price_currency'] ?? '') ?>" required pattern="[A-Z]{3}" maxlength="3" aria-describedby="books-currency-help">
                        </div>

                        <div class="admin-field">
                            <label for="books-overview">Overview <span class="admin-required">(required)</span></label>
                            <small id="books-overview-help">Enter a plain-text back-cover style overview yourself. HTML is not supported.</small>
                            <textarea id="books-overview" name="overview" rows="8" required maxlength="20000" aria-describedby="books-overview-help"><?= admin_books_h($formBook['overview'] ?? '') ?></textarea>
                        </div>
                    </fieldset>

                    <fieldset class="admin-fieldset">
                        <legend>Publishing</legend>

                        <div class="admin-field">
                            <label for="books-status">Status</label>
                            <small id="books-status-help">Draft and Archived recommendations are hidden from visitors. Published recommendations appear through the public books API.</small>
                            <select id="books-status" name="status" aria-describedby="books-status-help">
                                <?php admin_books_status_option('draft', 'Draft - Hidden from visitors', $currentStatus); ?>
                                <?php admin_books_status_option('published', 'Published - Visible on the public site', $currentStatus); ?>
                                <?php admin_books_status_option('archived', 'Archived - Hidden from visitors, kept for reference', $currentStatus); ?>
                            </select>
                        </div>
                    </fieldset>

                    <div class="admin-action-row">
                        <button type="submit"><?= $mode === 'edit' ? 'Save changes' : 'Create book recommendation' ?></button>
                        <a class="admin-button admin-button-secondary" href="/admin/books.php">Cancel</a>
                    </div>
                </form>
            </section>

            <?php if ($editingSlug === null): ?>
                <script>
                    (() => {
                        const title = document.getElementById('books-title-input');
                        const slug = document.getElementById('books-slug');
                        const suggest = document.getElementById('books-slug-suggest');
                        if (!title || !slug || !suggest) return;
                        let slugWasEdited = slug.value !== '';
                        const slugify = (value) => value.normalize('NFKD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .toLowerCase()
                            .replace(/['’]/g, '')
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-+|-+$/g, '')
                            .slice(0, 160)
                            .replace(/-+$/g, '');
                        title.addEventListener('input', () => {
                            if (!slugWasEdited) slug.value = slugify(title.value);
                        });
                        slug.addEventListener('input', () => { slugWasEdited = true; });
                        suggest.addEventListener('click', () => {
                            slug.value = slugify(title.value);
                            slugWasEdited = true;
                            slug.focus();
                        });
                    })();
                </script>
            <?php endif; ?>
        <?php endif; ?>

        <section class="admin-panel admin-records" id="books-list" aria-labelledby="books-list-title">
            <div class="admin-records-header">
                <div>
                    <h2 id="books-list-title">All book recommendations</h2>
                    <p id="books-list-count"><?= admin_books_h(admin_books_count_text(count($bookEntries))) ?></p>
                </div>
                <?php if ($mode !== 'create' && $bookEntries !== []): ?>
                    <a class="admin-button" href="/admin/books.php?new=1#books-editor">Add book recommendation</a>
                <?php endif; ?>
            </div>

            <?php if ($bookEntries === []): ?>
                <div class="admin-empty">
                    <?php if ($mode === 'create'): ?>
                        <p>Fill in the form above to add the first book recommendation.</p>
                    <?php else: ?>
                        <p>The reading shelf is empty. Add a book to start the stack.</p>
                        <a class="admin-button" href="/admin/books.php?new=1#books-editor">Add the first book recommendation</a>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="admin-table-wrap">
                <table class="admin-table admin-records-table" aria-labelledby="books-list-title" aria-describedby="books-list-count">
                    <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Author</th>
                        <th scope="col">Price</th>
                        <th scope="col">Status</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($bookEntries as $entry): ?>
                        <?php
                        $slug = is_scalar($entry['slug'] ?? null) ? (string) $entry['slug'] : '';
                        $name = admin_books_name($entry);
                        [$statusKey, $statusLabel, $statusMeaning] = admin_books_status_text($entry['status'] ?? '');
                        $isCurrent = ($mode === 'edit' && $slug === $editingSlug) || ($mode === 'delete' && $slug === $deleteSlug);
                        $price = trim((string) ($entry['price_currency'] ?? '') . ' ' . (string) ($entry['price_amount'] ?? ''));
                        ?>
                        <tr<?= $isCurrent ? ' class="admin-record-current" aria-current="true"' : '' ?>>
                            <th scope="row" class="admin-record-title"><?= admin_books_h($name) ?></th>
                            <td><?= admin_books_h($entry['author'] ?? '') ?></td>
                            <td><?= admin_books_h($price) ?></td>
                            <td>
                                <span class="admin-status admin-status-<?= admin_books_h($statusKey) ?>"><?= admin_books_h($statusLabel) ?></span>
                                <small class="admin-status-help"><?= admin_books_h($statusMeaning) ?></small>
                            </td>
                            <td><code><?= admin_books_h($slug) ?></code></td>
                            <td class="admin-record-actions">
                                <a class="admin-button admin-button-secondary" href="/admin/books.php?<?= admin_books_h(http_build_query(['edit' => $slug])) ?>#books-editor" aria-label="Edit book recommendation &ldquo;<?= admin_books_h($name) ?>&rdquo;">Edit</a>
                                <a class="admin-button admin-button-secondary admin-button-danger" href="/admin/books.php?<?= admin_books_h(http_build_query(['delete' => $slug])) ?>#books-delete" aria-label="Delete book recommendation &ldquo;<?= admin_books_h($name) ?>&rdquo;">Delete</a>
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

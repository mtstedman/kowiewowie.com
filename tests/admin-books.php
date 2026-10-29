#!/usr/bin/env php
<?php

declare(strict_types=1);

// Focused source-and-helper regressions for the standalone Books admin manager. The helper-only
// load avoids a database connection while exercising the exact form mapping and escaping code.

/** @var list<string> $failures */
$failures = [];

function adminBooksCheck(bool $condition, string $message): void
{
    global $failures;
    if (!$condition) {
        $failures[] = $message;
    }
}

function adminBooksContains(string $source, string $fragment, string $message): void
{
    adminBooksCheck(str_contains($source, $fragment), $message);
}

function adminBooksOrder(string $source, string $before, string $after, string $message): void
{
    $beforePosition = strpos($source, $before);
    $afterPosition = strpos($source, $after);
    adminBooksCheck(
        $beforePosition !== false && $afterPosition !== false && $beforePosition < $afterPosition,
        $message,
    );
}

$root = dirname(__DIR__);
$managerPath = $root . '/htdocs/admin/books.php';
$manager = (string) file_get_contents($managerPath);
$layout = (string) file_get_contents($root . '/htdocs/admin/layout.php');
$dashboard = (string) file_get_contents($root . '/htdocs/admin/index.php');

define('ADMIN_BOOKS_HELPERS_ONLY', true);
require $managerPath;

// Authentication and authorization must finish before the repository can be constructed or used.
adminBooksCheck(admin_current_user() === null, 'An anonymous session has no admin user.');
adminBooksCheck(!admin_user_is_admin(['roles' => ['member']]), 'A non-admin role is denied management access.');
adminBooksCheck(admin_user_is_admin(['roles' => ['admin']]), 'The shared role check accepts an administrator.');
adminBooksOrder($manager, '$user = admin_require_user();', 'admin_require_admin($user);', 'Books requires a signed-in user before checking the admin role.');
adminBooksOrder($manager, 'admin_require_admin($user);', '$repository = admin_content_repository();', 'Books denies non-admin users before repository construction.');

// Both mutation paths share the CSRF guard, and neither write can occur before it.
adminBooksContains($manager, "if (!admin_verify_csrf_token(\$_POST['csrf_token'] ?? null))", 'Books checks the submitted CSRF token.');
adminBooksOrder($manager, "if (!admin_verify_csrf_token(\$_POST['csrf_token'] ?? null))", "\$repository->save('books'", 'CSRF rejection happens before save.');
adminBooksOrder($manager, "if (!admin_verify_csrf_token(\$_POST['csrf_token'] ?? null))", "\$repository->delete('books'", 'CSRF rejection happens before delete.');
adminBooksContains($manager, "\$errors[] = 'Your session token expired. Please try again.';", 'Invalid CSRF tokens produce an understandable error.');
$csrfToken = admin_csrf_token();
adminBooksCheck(admin_verify_csrf_token($csrfToken), 'The shared CSRF check accepts the current token.');
adminBooksCheck(!admin_verify_csrf_token(null), 'The shared CSRF check rejects a missing token.');
adminBooksCheck(!admin_verify_csrf_token($csrfToken . '-invalid'), 'The shared CSRF check rejects an invalid token.');
adminBooksCheck(substr_count($manager, 'admin_csrf_field()') >= 2, 'Save and delete forms both render the shared CSRF field.');

// Every editable shared-contract field maps from POST, while edit mode keeps the stored slug.
$posted = [
    'slug' => '',
    'title' => 'The Left Hand of Darkness',
    'author' => 'Ursula K. Le Guin',
    'amazon_url' => 'https://www.amazon.com/dp/0441478123',
    'cover_image_url' => 'https://images.example.test/left-hand.jpg',
    'price_amount' => '17.99',
    'price_currency' => 'USD',
    'overview' => "A visitor crosses the ice.\nPlain text only.",
    'status' => 'published',
];
$created = admin_books_input_from_post($posted, null);
adminBooksCheck(
    $created === array_replace($posted, ['slug' => 'the-left-hand-of-darkness']),
    'Create mapping preserves every submitted field and generates a suggested slug from the title.',
);
$edited = admin_books_input_from_post(array_replace($posted, [
    'slug' => 'attempted-change',
    'title' => 'A corrected title',
    'price_amount' => '18.50',
    'status' => 'archived',
]), 'the-left-hand-of-darkness');
adminBooksCheck($edited['slug'] === 'the-left-hand-of-darkness', 'Edit mapping keeps the existing stable slug.');
adminBooksCheck($edited['title'] === 'A corrected title', 'Edit mapping accepts corrected title metadata.');
adminBooksCheck($edited['price_amount'] === '18.50', 'Edit mapping accepts corrected price metadata.');
adminBooksCheck($edited['status'] === 'archived', 'Edit mapping accepts archived status.');
adminBooksCheck(admin_books_suggest_slug('  A Wizard’s Guide!  ') === 'a-wizards-guide', 'Slug suggestions are lowercase URL handles.');

// Failed saves retain the submitted state in the editor and escape values and errors on output.
foreach (['slug', 'title', 'author', 'amazon_url', 'cover_image_url', 'price_amount', 'price_currency', 'overview'] as $field) {
    adminBooksContains($manager, "admin_books_h(\$formBook['{$field}'] ?? '')", "The {$field} value is retained and escaped in the form.");
}
adminBooksContains($manager, "\$formBook = admin_books_input_from_post(\$_POST, \$editingSlug);", 'Submitted state is captured before validation or storage.');
adminBooksOrder($manager, "\$formBook = admin_books_input_from_post(\$_POST, \$editingSlug);", "if (!admin_verify_csrf_token(\$_POST['csrf_token'] ?? null))", 'Submitted state is preserved even when CSRF validation fails.');
adminBooksContains($manager, '<li><?= admin_books_h($error) ?></li>', 'Storage and validation errors are escaped.');
adminBooksCheck(admin_books_h('<script>alert("x")</script>') === '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;', 'Escaping protects preserved values.');

// Existing records load unpublished data for editing, then save through the books repository contract.
adminBooksContains($manager, "\$repository->find('books', \$edit, true)", 'Edit mode loads the selected unpublished book.');
adminBooksContains($manager, "\$repository->find('books', \$editingSlug, true)", 'Saving an edit verifies the existing book.');
adminBooksContains($manager, "\$repository->save('books', \$formBook, admin_books_actor_id(\$user))", 'Saves map to the shared books repository contract.');
adminBooksContains($manager, "\$repository->list('books', 100, 0, true)", 'The manager lists draft, published, and archived books.');
adminBooksContains($manager, "\$repository->delete('books', \$slug)", 'Deletes map to the shared books repository contract.');

foreach (['title', 'author', 'amazon_url', 'cover_image_url', 'price_amount', 'price_currency', 'overview', 'status'] as $field) {
    adminBooksContains($manager, 'name="' . $field . '"', "The manager labels and submits {$field}.");
}
adminBooksContains($manager, 'stored price may differ when Amazon changes its listing', 'The manager explains that stored Amazon prices can change.');
adminBooksContains($manager, 'Cover, price, currency, and overview are manually entered metadata', 'The manager explains which metadata admins supply.');
adminBooksContains($manager, 'id="books-slug-suggest"', 'The create form offers an editable title-based slug suggestion.');

adminBooksContains($layout, "['href' => '/admin/books.php', 'label' => 'Books']", 'Shared admin navigation links to Books.');
adminBooksContains($dashboard, "['href' => '/admin/books.php', 'label' => 'Books'", 'The dashboard links to Books.');

if ($failures !== []) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

fwrite(STDOUT, 'Admin books regressions passed.' . PHP_EOL);

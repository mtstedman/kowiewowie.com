#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Database\Database;

require __DIR__ . '/../api/bootstrap.php';

$options = getopt('', ['email:', 'role:', 'remove']);
$email = mb_strtolower(trim((string) ($options['email'] ?? '')));
$role = trim((string) ($options['role'] ?? ''));
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || !in_array($role, ['user', 'editor', 'admin'], true)) {
    fwrite(STDERR, "Usage: php database/grant-role.php --email user@example.com --role admin [--remove]\n");
    exit(2);
}

$config = Config::load(dirname(__DIR__));
$pdo = Database::connect($config);
if (array_key_exists('remove', $options)) {
    if ($role === 'user') {
        fwrite(STDERR, "The baseline user role cannot be removed.\n");
        exit(2);
    }
    $statement = $pdo->prepare('UPDATE users SET roles = array_remove(roles, :role) WHERE lower(email) = lower(:email) RETURNING roles');
} else {
    $statement = $pdo->prepare(<<<'SQL'
        UPDATE users
        SET roles = CASE WHEN :role = ANY(roles) THEN roles ELSE array_append(roles, :role) END
        WHERE lower(email) = lower(:email)
        RETURNING roles
    SQL);
}
$statement->execute(['email' => $email, 'role' => $role]);
$roles = $statement->fetchColumn();
if ($roles === false) {
    fwrite(STDERR, "No user exists for {$email}. Register the account first.\n");
    exit(1);
}

fwrite(STDOUT, "Updated {$email}: {$roles}\n");


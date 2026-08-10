<?php

declare(strict_types=1);

namespace Wowie\Api\Content;

use Wowie\Api\ApiException;

function requiredString(array $input, string $field, int $maxLength = 255): string
{
    $value = trim(is_string($input[$field] ?? null) ? $input[$field] : '');
    if ($value === '' || mb_strlen($value) > $maxLength) {
        throw new ApiException(422, 'validation_failed', "{$field} must contain between 1 and {$maxLength} characters.");
    }

    return $value;
}

function optionalString(array $input, string $field, int $maxLength = 10_000): ?string
{
    if (!array_key_exists($field, $input) || $input[$field] === null) {
        return null;
    }
    if (!is_string($input[$field]) || mb_strlen($input[$field]) > $maxLength) {
        throw new ApiException(422, 'validation_failed', "{$field} must be a string no longer than {$maxLength} characters.");
    }

    return trim($input[$field]);
}

function requiredSlug(array $input): string
{
    $slug = requiredString($input, 'slug', 160);
    if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
        throw new ApiException(422, 'validation_failed', 'slug must use lowercase letters, numbers, and single hyphens.');
    }

    return $slug;
}

/** @return list<string> */
function stringList(array $input, string $field, int $itemMaxLength = 2_000): array
{
    $value = $input[$field] ?? null;
    if (!is_array($value) || !array_is_list($value)) {
        throw new ApiException(422, 'validation_failed', "{$field} must be a JSON array.");
    }

    $result = [];
    foreach ($value as $item) {
        if (!is_string($item) || trim($item) === '' || mb_strlen($item) > $itemMaxLength) {
            throw new ApiException(422, 'validation_failed', "Every {$field} item must be a non-empty string no longer than {$itemMaxLength} characters.");
        }
        $result[] = trim($item);
    }

    return $result;
}

function contentStatus(array $input, string $default = 'draft'): string
{
    $status = is_string($input['status'] ?? null) ? $input['status'] : $default;
    if (!in_array($status, ['draft', 'published', 'archived'], true)) {
        throw new ApiException(422, 'validation_failed', 'status must be draft, published, or archived.');
    }

    return $status;
}

/** @return list<array<string, mixed>> */
function objectList(array $input, string $field): array
{
    $value = $input[$field] ?? null;
    if (!is_array($value) || !array_is_list($value)) {
        throw new ApiException(422, 'validation_failed', "{$field} must be a JSON array of objects.");
    }
    foreach ($value as $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ApiException(422, 'validation_failed', "Every {$field} item must be an object.");
        }
    }

    return $value;
}


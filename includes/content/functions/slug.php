<?php

declare(strict_types=1);

namespace Wowie\Api\Content;

function slugify(string $value): string
{
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
    $normalized = strtolower(is_string($ascii) ? $ascii : $value);
    $normalized = preg_replace('/[^a-z0-9]+/', '-', $normalized) ?? '';

    return trim($normalized, '-');
}


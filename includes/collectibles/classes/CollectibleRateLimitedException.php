<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use RuntimeException;

/**
 * A store asked us to slow down (HTTP 429, or a 503 that persisted). The
 * client never retries a 429 itself; the refresher backs the source off,
 * honoring the store's Retry-After when it sent one.
 */
final class CollectibleRateLimitedException extends RuntimeException
{
    public function __construct(string $message, int $status, public readonly ?int $retryAfterSeconds)
    {
        parent::__construct($message, $status);
    }
}

<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

/**
 * When each store-fed collectibles source may be refreshed again.
 *
 * Careful by design: a source refreshes at most once per interval (a day, two
 * for Pop Mart, whose run reads every product page), and a store that refuses
 * us is left alone for a long, growing while. A rate limit (HTTP 429/503)
 * backs off 12h, 24h, 48h ... up to 7 days, never less than the store's own
 * Retry-After; any other failure backs off 2h, 4h ... up to 2 days. Every wait
 * gets up to 20% random jitter so runs never fall into lockstep.
 *
 * State is a plain array (persisted as JSON by the refresh command):
 *   source_key => {last_attempt_at, last_success_at, consecutive_failures,
 *                  next_allowed_at, last_status, last_error}
 */
final class CollectiblesRefreshScheduler
{
    public const DEFAULT_INTERVAL_SECONDS = 20 * 3600;
    /** Per-source success intervals; Pop Mart reads ~100 pages a run. */
    public const INTERVAL_SECONDS = [
        PopMartCollectionSource::SOURCE_KEY => 44 * 3600,
        PopMartCollectionSource::POP_BEAN_SOURCE_KEY => 44 * 3600,
    ];
    public const RATE_LIMIT_BACKOFF_SECONDS = 12 * 3600;
    public const RATE_LIMIT_BACKOFF_CAP_SECONDS = 7 * 86400;
    public const FAILURE_BACKOFF_SECONDS = 2 * 3600;
    public const FAILURE_BACKOFF_CAP_SECONDS = 2 * 86400;
    public const JITTER_FRACTION = 0.2;

    /** @var array<string, array<string, mixed>> */
    private array $state;

    /**
     * @param array<string, mixed> $state
     * @param \Closure(): float $random a float in [0, 1)
     */
    public function __construct(array $state, private readonly int $now, private readonly \Closure $random)
    {
        $this->state = [];
        foreach ($state as $sourceKey => $entry) {
            if (is_string($sourceKey) && is_array($entry)) $this->state[$sourceKey] = $entry;
        }
    }

    public function isDue(string $sourceKey): bool
    {
        return $this->now >= (int) ($this->state[$sourceKey]['next_allowed_at'] ?? 0);
    }

    public function nextAllowedAt(string $sourceKey): int
    {
        return (int) ($this->state[$sourceKey]['next_allowed_at'] ?? 0);
    }

    /**
     * Record one sync result and schedule the source's next allowed run.
     *
     * @param array{status: string, error?: ?string, rate_limited?: bool, retry_after?: ?int} $result
     * @return array<string, mixed> the source's new state entry
     */
    public function record(string $sourceKey, array $result): array
    {
        $entry = $this->state[$sourceKey] ?? [];
        $entry['last_attempt_at'] = $this->now;
        if ($result['status'] === 'ok') {
            $entry['last_success_at'] = $this->now;
            $entry['consecutive_failures'] = 0;
            $entry['last_status'] = 'ok';
            $entry['last_error'] = null;
            $wait = self::INTERVAL_SECONDS[$sourceKey] ?? self::DEFAULT_INTERVAL_SECONDS;
        } else {
            $failures = (int) ($entry['consecutive_failures'] ?? 0) + 1;
            $entry['consecutive_failures'] = $failures;
            $rateLimited = ($result['rate_limited'] ?? false) === true;
            $entry['last_status'] = $rateLimited ? 'rate-limited' : 'failed';
            $entry['last_error'] = isset($result['error']) ? mb_substr((string) $result['error'], 0, 300) : null;
            [$base, $cap] = $rateLimited
                ? [self::RATE_LIMIT_BACKOFF_SECONDS, self::RATE_LIMIT_BACKOFF_CAP_SECONDS]
                : [self::FAILURE_BACKOFF_SECONDS, self::FAILURE_BACKOFF_CAP_SECONDS];
            $wait = (int) min($cap, $base * (2 ** min($failures - 1, 16)));
            if ($rateLimited && is_int($result['retry_after'] ?? null)) $wait = max($wait, $result['retry_after']);
        }
        $wait += (int) floor($wait * self::JITTER_FRACTION * ($this->random)());
        $entry['next_allowed_at'] = $this->now + $wait;
        return $this->state[$sourceKey] = $entry;
    }

    /** @return array<string, array<string, mixed>> */
    public function state(): array
    {
        return $this->state;
    }
}

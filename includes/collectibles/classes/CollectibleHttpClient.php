<?php

declare(strict_types=1);

namespace Wowie\Api\Collectibles;

use InvalidArgumentException;
use RuntimeException;

/**
 * Minimal HTTPS GET client for the collectibles catalog sync.
 *
 * Requests are restricted to an explicit host allowlist, spaced at least one
 * second apart per host, and retried a bounded number of times when the remote
 * host answers 429 or 503. Failures raise a RuntimeException whose code is the
 * HTTP status (0 when no response was received).
 */
final class CollectibleHttpClient
{
    public const ACCEPT_HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';
    public const ACCEPT_JSON = 'application/json';

    private const USER_AGENT = 'wowiekowie-collectibles-sync/1.0 (+https://wowiekowie.com)';
    private const CONNECT_TIMEOUT_SECONDS = 5;
    private const TOTAL_TIMEOUT_SECONDS = 20;
    /** Polite defaults: seconds between requests to one host, plus random jitter. */
    public const DEFAULT_MIN_HOST_INTERVAL_SECONDS = 5.0;
    public const DEFAULT_HOST_JITTER_SECONDS = 3.0;
    private const MAX_REDIRECTS = 3;
    /** A 503 is retried once, never sooner than this. A 429 is never retried. */
    private const SERVICE_UNAVAILABLE_RETRY_SECONDS = 30;
    private const MAX_RETRY_DELAY_SECONDS = 120;
    private const MAX_BODY_BYTES = 16777216;

    /** @var array<string, true> */
    private array $allowedHosts = [];

    /** @var array<string, float> */
    private array $lastRequestAt = [];

    /**
     * @param list<string> $allowedHosts Hard-coded source hosts this client may contact.
     * @param ?\Closure(string, string): array{status: int, body: ?string, headers: array<string, string>, error: string} $transport for tests
     * @param ?\Closure(float): void $sleeper for tests
     * @param ?\Closure(): float $random a float in [0, 1), for tests
     */
    public function __construct(
        array $allowedHosts,
        private readonly float $minHostIntervalSeconds = self::DEFAULT_MIN_HOST_INTERVAL_SECONDS,
        private readonly float $hostJitterSeconds = self::DEFAULT_HOST_JITTER_SECONDS,
        private readonly ?\Closure $transport = null,
        private readonly ?\Closure $sleeper = null,
        private readonly ?\Closure $random = null,
    ) {
        foreach ($allowedHosts as $host) {
            $host = is_string($host) ? strtolower(trim($host)) : '';
            if ($host === '' || preg_match('/^[a-z0-9.-]+$/', $host) !== 1) {
                throw new InvalidArgumentException('Collectible source hosts must be plain host names.');
            }
            $this->allowedHosts[$host] = true;
        }

        if ($this->allowedHosts === []) {
            throw new InvalidArgumentException('At least one collectible source host is required.');
        }
    }

    /**
     * Fetch a URL and return the response body.
     *
     * @throws RuntimeException carrying the HTTP status as its code
     */
    public function get(string $url, string $accept = self::ACCEPT_HTML): string
    {
        if (!in_array($accept, [self::ACCEPT_HTML, self::ACCEPT_JSON], true)) {
            throw new InvalidArgumentException('Unsupported Accept header for a collectible source request.');
        }

        $currentUrl = $url;
        $serviceRetried = false;
        $redirects = 0;

        // Bounded: every pass either returns, throws, or consumes one of the
        // limited retry/redirect allowances.
        while (true) {
            $host = $this->assertAllowedUrl($currentUrl);
            $label = $this->describe($currentUrl);

            $this->waitForHost($host);
            $response = $this->execute($currentUrl, $accept);
            $this->lastRequestAt[$host] = microtime(true);

            $status = $response['status'];
            if ($response['body'] === null) {
                error_log("Collectible source request to {$label} failed with HTTP {$status}: {$response['error']}");
                throw new RuntimeException("Request to {$label} failed: {$response['error']}", $status);
            }

            // A store asking us to slow down gets no immediate retry: the
            // source stops and the refresher backs off (Retry-After honored).
            // A 503 may be a blip, so it gets one patient retry.
            if ($status === 429 || $status === 503) {
                $retryAfter = $this->retryAfterSeconds($response['headers']['retry-after'] ?? null);
                if ($status === 503 && !$serviceRetried && ($retryAfter ?? 0) <= self::MAX_RETRY_DELAY_SECONDS) {
                    $serviceRetried = true;
                    $this->pause((float) max(self::SERVICE_UNAVAILABLE_RETRY_SECONDS, $retryAfter ?? 0));
                    continue;
                }
                error_log("Collectible source request to {$label} was rate limited with HTTP {$status}" . ($retryAfter === null ? '' : " (Retry-After {$retryAfter}s)") . '.');
                throw new CollectibleRateLimitedException(
                    "Request to {$label} was rate limited (HTTP {$status}); not retrying.",
                    $status,
                    $retryAfter,
                );
            }

            if (in_array($status, [301, 302, 303, 307, 308], true)) {
                $target = $this->resolveSameHostRedirect($host, $response['headers']['location'] ?? null);
                if ($target === null || $redirects >= self::MAX_REDIRECTS) {
                    error_log("Collectible source request to {$label} was redirected (HTTP {$status}) off-host or too many times.");
                    throw new RuntimeException(
                        "Request to {$label} was redirected to another host or too many times (HTTP {$status}).",
                        $status,
                    );
                }

                $redirects++;
                $currentUrl = $target;
                continue;
            }

            if ($status < 200 || $status >= 300) {
                error_log("Collectible source request to {$label} failed with HTTP {$status}.");
                throw new RuntimeException("Request to {$label} failed with HTTP {$status}.", $status);
            }

            return $response['body'];
        }
    }

    /**
     * @return array{status: int, body: ?string, headers: array<string, string>, error: string}
     */
    private function execute(string $url, string $accept): array
    {
        if ($this->transport !== null) return ($this->transport)($url, $accept);
        $curl = curl_init($url);
        if ($curl === false) {
            return ['status' => 0, 'body' => null, 'headers' => [], 'error' => 'curl could not be initialized'];
        }

        $headers = [];
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
            CURLOPT_TIMEOUT => self::TOTAL_TIMEOUT_SECONDS,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_ENCODING => '',
            CURLOPT_MAXFILESIZE => self::MAX_BODY_BYTES,
            CURLOPT_HTTPHEADER => ['Accept: ' . $accept, 'Accept-Language: en-US,en;q=0.9'],
            CURLOPT_USERAGENT => self::USER_AGENT,
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$headers): int {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
                }

                return strlen($line);
            },
        ]);

        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);

        if (!is_string($body)) {
            return [
                'status' => $status,
                'body' => null,
                'headers' => $headers,
                'error' => $error !== '' ? $error : 'no response body was received',
            ];
        }

        if (strlen($body) > self::MAX_BODY_BYTES) {
            return ['status' => $status, 'body' => null, 'headers' => $headers, 'error' => 'the response body was too large'];
        }

        return ['status' => $status, 'body' => $body, 'headers' => $headers, 'error' => $error];
    }

    /**
     * Validate that a URL is plain HTTPS on an allowlisted host and return the host.
     */
    private function assertAllowedUrl(string $url): string
    {
        $parts = parse_url($url);
        $host = is_array($parts) && is_string($parts['host'] ?? null) ? strtolower($parts['host']) : '';

        if (
            !is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || (isset($parts['port']) && $parts['port'] !== 443)
        ) {
            throw new RuntimeException('Collectible sources must be fetched from plain HTTPS URLs.');
        }

        if (!isset($this->allowedHosts[$host])) {
            throw new RuntimeException("The host {$host} is not a configured collectible source.");
        }

        return $host;
    }

    /**
     * Resolve a redirect target, refusing anything that leaves the current host.
     */
    private function resolveSameHostRedirect(string $host, ?string $location): ?string
    {
        if ($location === null || $location === '') {
            return null;
        }

        if (str_starts_with($location, '//')) {
            $location = 'https:' . $location;
        } elseif (str_starts_with($location, '/')) {
            $location = 'https://' . $host . $location;
        }

        $parts = parse_url($location);
        if (
            !is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || !is_string($parts['host'] ?? null)
            || strtolower($parts['host']) !== $host
        ) {
            return null;
        }

        return $location;
    }

    /** Seconds the store asked us to wait (Retry-After), or null when it did not say. */
    private function retryAfterSeconds(?string $retryAfter): ?int
    {
        if ($retryAfter === null) return null;
        $retryAfter = trim($retryAfter);
        if (preg_match('/^\d{1,9}$/', $retryAfter) === 1) return max(1, (int) $retryAfter);
        $timestamp = strtotime($retryAfter);
        return $timestamp === false ? null : max(1, $timestamp - time());
    }

    private function waitForHost(string $host): void
    {
        if (!isset($this->lastRequestAt[$host])) {
            return;
        }

        $jitter = $this->hostJitterSeconds * ($this->random !== null ? ($this->random)() : mt_rand() / (mt_getrandmax() + 1));
        $this->pause($this->minHostIntervalSeconds + $jitter - (microtime(true) - $this->lastRequestAt[$host]));
    }

    private function pause(float $seconds): void
    {
        if ($seconds <= 0) return;
        if ($this->sleeper !== null) {
            ($this->sleeper)($seconds);
            return;
        }
        usleep((int) ceil($seconds * 1000000));
    }

    private function describe(string $url): string
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return 'collectible source';
        }

        return ($parts['host'] ?? 'collectible source') . ($parts['path'] ?? '');
    }
}

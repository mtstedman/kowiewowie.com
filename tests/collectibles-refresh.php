<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectibleHttpClient;
use Wowie\Api\Collectibles\CollectibleRateLimitedException;
use Wowie\Api\Collectibles\CollectiblesRefreshScheduler;
use Wowie\Api\Collectibles\CollectiblesRepository;
use Wowie\Api\Collectibles\CollectiblesSync;
use Wowie\Api\Collectibles\ShopifyCollectionSource;

require __DIR__ . '/../api/bootstrap.php';

// The scheduled refresher must never hammer a store: these pin its pacing,
// its refusal handling, and its backoff schedule without touching a network.
$failures = [];
$assertSame = static function (mixed $expected, mixed $actual, string $message) use (&$failures): void {
    if ($expected !== $actual) $failures[] = $message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true);
};
$hour = 3600;
$now = 1_800_000_000;
$noJitter = static fn (): float => 0.0;

// --- scheduler ------------------------------------------------------------
$scheduler = new CollectiblesRefreshScheduler([], $now, $noJitter);
$assertSame(true, $scheduler->isDue('toysez-nommi'), 'a never-run source is due');
$assertSame($now + 20 * $hour, $scheduler->record('toysez-nommi', ['status' => 'ok'])['next_allowed_at'], 'success waits a day (less 4h slack)');
$assertSame(false, $scheduler->isDue('toysez-nommi'), 'a just-refreshed source is not due');
$assertSame($now + 44 * $hour, $scheduler->record('popmart-us', ['status' => 'ok'])['next_allowed_at'], 'Pop Mart, ~100 pages a run, waits two days');

$limited = ['status' => 'failed', 'error' => 'HTTP 429', 'rate_limited' => true, 'retry_after' => null];
$waits = [];
for ($attempt = 0; $attempt < 6; $attempt++) $waits[] = ($scheduler->record('toysez-nommi', $limited)['next_allowed_at'] - $now) / $hour;
$assertSame([12, 24, 48, 96, 168, 168], $waits, 'rate limits back off 12h doubling to a 7-day cap');
$assertSame('rate-limited', $scheduler->state()['toysez-nommi']['last_status'], 'rate-limited status recorded');
$assertSame(6, $scheduler->state()['toysez-nommi']['consecutive_failures'], 'consecutive refusals counted');
$assertSame($now + 20 * $hour, $scheduler->record('toysez-nommi', ['status' => 'ok'])['next_allowed_at'], 'a success resets the backoff');
$assertSame(0, $scheduler->state()['toysez-nommi']['consecutive_failures'], 'failures reset after success');

$retryAfter = ['status' => 'failed', 'rate_limited' => true, 'retry_after' => 10 * 86400];
$assertSame($now + 10 * 86400, (new CollectiblesRefreshScheduler([], $now, $noJitter))->record('x', $retryAfter)['next_allowed_at'], "the store's longer Retry-After wins");
$broken = ['status' => 'failed', 'error' => 'parse error'];
$fresh = new CollectiblesRefreshScheduler([], $now, $noJitter);
$assertSame([2, 4, 8], [($fresh->record('x', $broken)['next_allowed_at'] - $now) / $hour, ($fresh->record('x', $broken)['next_allowed_at'] - $now) / $hour, ($fresh->record('x', $broken)['next_allowed_at'] - $now) / $hour], 'other failures back off 2h doubling');
$jittered = (new CollectiblesRefreshScheduler([], $now, static fn (): float => 0.999))->record('toysez-nommi', ['status' => 'ok'])['next_allowed_at'] - $now;
$assertSame(true, $jittered > 20 * $hour && $jittered <= 24 * $hour, 'jitter adds at most 20%');
$restored = new CollectiblesRefreshScheduler(['toysez-nommi' => ['next_allowed_at' => $now + 5]], $now, $noJitter);
$assertSame(false, $restored->isDue('toysez-nommi'), 'persisted state is honored');

// --- polite HTTP client ---------------------------------------------------
$fakeClient = static function (array $responses, array &$requests, array &$sleeps): CollectibleHttpClient {
    return new CollectibleHttpClient(
        ['shop.example'],
        transport: static function (string $url) use (&$responses, &$requests): array {
            $requests[] = $url;
            return array_shift($responses) ?? ['status' => 200, 'body' => '{}', 'headers' => [], 'error' => ''];
        },
        sleeper: static function (float $seconds) use (&$sleeps): void { $sleeps[] = $seconds; },
        random: static fn (): float => 0.5,
    );
};
$ok = ['status' => 200, 'body' => '{"products":[]}', 'headers' => [], 'error' => ''];

$requests = []; $sleeps = [];
$client = $fakeClient([['status' => 429, 'body' => '', 'headers' => ['retry-after' => '3600'], 'error' => '']], $requests, $sleeps);
try {
    $client->get('https://shop.example/products.json', CollectibleHttpClient::ACCEPT_JSON);
    $failures[] = 'a 429 must throw';
} catch (CollectibleRateLimitedException $error) {
    $assertSame([429, 3600], [$error->getCode(), $error->retryAfterSeconds], '429 carries its Retry-After');
}
$assertSame(1, count($requests), 'a 429 is never retried');
$assertSame([], $sleeps, 'a 429 is not waited out in-process');

$requests = []; $sleeps = [];
$client = $fakeClient([['status' => 503, 'body' => '', 'headers' => [], 'error' => ''], $ok], $requests, $sleeps);
$assertSame('{"products":[]}', $client->get('https://shop.example/a', CollectibleHttpClient::ACCEPT_JSON), 'a 503 blip is retried once');
$assertSame(2, count($requests), 'one retry after a 503');
$assertSame(true, ($sleeps[0] ?? 0) >= 30, 'the 503 retry waits at least 30 seconds');

$requests = []; $sleeps = [];
$client = $fakeClient([['status' => 503, 'body' => '', 'headers' => [], 'error' => ''], ['status' => 503, 'body' => '', 'headers' => [], 'error' => '']], $requests, $sleeps);
try {
    $client->get('https://shop.example/a', CollectibleHttpClient::ACCEPT_JSON);
    $failures[] = 'a persistent 503 must throw';
} catch (CollectibleRateLimitedException $error) {
    $assertSame(503, $error->getCode(), 'persistent 503 is treated as a refusal');
}
$assertSame(2, count($requests), 'a persistent 503 is tried at most twice');

$requests = []; $sleeps = [];
$client = $fakeClient([$ok, $ok], $requests, $sleeps);
$client->get('https://shop.example/a', CollectibleHttpClient::ACCEPT_JSON);
$client->get('https://shop.example/b', CollectibleHttpClient::ACCEPT_JSON);
$assertSame(true, count($sleeps) === 1 && $sleeps[0] > 6.0 && $sleeps[0] <= 6.5, 'requests to one host are spaced 5s plus jitter (got ' . json_encode($sleeps) . ')');

// --- a refused store reaches the scheduler as rate limited ----------------
$requests = []; $sleeps = [];
$refusing = $fakeClient([['status' => 429, 'body' => '', 'headers' => ['retry-after' => '7200'], 'error' => '']], $requests, $sleeps);
$source = new ShopifyCollectionSource($refusing, 'toysez-nommi', 'nommi', 'https://shop.example/collections/nommi', 'USD', 'nommi');
$pdo = new PDO('sqlite::memory:');
$result = (new CollectiblesSync(new CollectiblesRepository($pdo), [$source]))->run()[0];
$assertSame(['failed', true, 7200], [$result['status'], $result['rate_limited'], $result['retry_after']], 'sync result marks the refusal');
$assertSame(1, count($requests), 'the refused source stops after one request');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}
fwrite(STDOUT, "collectibles refresher regressions passed\n");

#!/usr/bin/env php
<?php

declare(strict_types=1);

// Saved-build compatibility and inventory checks run against a temporary shadow of the build
// table. The inventory migration is applied to that shadow, never to the configured schema.

use Wowie\Api\Application;
use Wowie\Api\Auth\JwtService;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;

require __DIR__ . '/../api/bootstrap.php';

function assertSameValue(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException("{$message}: expected " . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

/** @param array<string, string> $headers */
function send(Application $application, string $method, string $path, ?string $rawBody = null, array $headers = []): Response
{
    return $application->handle(new Request(
        $method,
        $path,
        ['origin' => 'https://wowiekowie.com', 'content-type' => 'application/json'] + array_change_key_case($headers, CASE_LOWER),
        [],
        $rawBody ?? '',
        '127.0.0.1',
    ));
}

/** @param array<string, mixed> $extra */
function buildBody(array $extra = []): string
{
    return json_encode([
        'character_name' => 'Considered',
        'build_name' => 'Considered',
        'class_id' => 'Witch',
        'ascendancy_id' => null,
        'tree_version' => '0.5.5',
        'allocated_node_ids' => ['100'],
        'must_have_node_ids' => ['200'],
    ] + $extra, JSON_THROW_ON_ERROR);
}

/** @return array<string, mixed> */
function inventoryItem(string $slot = 'main_hand'): array
{
    return [
        'slot' => $slot,
        'name' => '  Ashen Staff  ',
        'equipped' => true,
        'armour' => 0,
        'evasion' => 12,
        'energy_shield' => 34,
        'weapon' => [
            'physical_min' => 10,
            'physical_max' => 20,
            'attacks_per_second' => 1.25,
        ],
    ];
}

/** @param mixed $inventory */
function assertInventoryRejected(Application $application, string $buildId, mixed $inventory, string $label): void
{
    $post = send($application, 'POST', '/v1/poe2/builds', buildBody(['inventory' => $inventory]));
    assertSameValue(422, $post->status, "{$label} rejected on create");
    assertSameValue(true, isset($post->payload['details']['inventory']), "{$label} create error names inventory");

    $put = send($application, 'PUT', '/v1/poe2/builds/' . $buildId, buildBody(['inventory' => $inventory]));
    assertSameValue(422, $put->status, "{$label} rejected on update");
    assertSameValue(true, isset($put->payload['details']['inventory']), "{$label} update error names inventory");
}

function quoteIdentifier(string $identifier): string
{
    return '"' . str_replace('"', '""', $identifier) . '"';
}

$config = Config::load(dirname(__DIR__));
$pdo = Database::connect($config);
$schema = (string) $pdo->query('SELECT current_schema()')->fetchColumn();
$productionTable = quoteIdentifier($schema) . '.poe2_saved_builds';
$productionCount = (int) $pdo->query('SELECT count(*) FROM ' . $productionTable)->fetchColumn();

// Copy the current pre- or post-migration shape, remove inventory from the copy when present,
// then prove the checked-in migration can add it and backfill the legacy rows in isolation.
$pdo->exec('CREATE TEMP TABLE poe2_saved_builds (LIKE ' . $productionTable . ' INCLUDING ALL) ON COMMIT PRESERVE ROWS');
$pdo->exec('ALTER TABLE pg_temp.poe2_saved_builds DROP COLUMN IF EXISTS inventory');
$pdo->exec("INSERT INTO pg_temp.poe2_saved_builds (character_name, build_name, class_id, tree_version, guest_profile_id)"
    . " VALUES ('Legacy', 'Legacy', 'Witch', '0.5.5', gen_random_uuid())");
$migration = file_get_contents(__DIR__ . '/../docs/postgres/updates/022_poe2_inventory.sql');
if (!is_string($migration) || trim($migration) === '') {
    throw new RuntimeException('The inventory migration is missing.');
}
$pdo->exec($migration);
assertSameValue('[]', $pdo->query("SELECT inventory::text FROM pg_temp.poe2_saved_builds WHERE build_name = 'Legacy'")->fetchColumn(), 'migration backfills legacy inventory');
$pdo->exec("DELETE FROM pg_temp.poe2_saved_builds WHERE build_name = 'Legacy'");

$application = new Application($config, $pdo);
$guestHashes = [];
$userId = null;

/** @return array{token: string, id: string} */
$newGuest = static function (string $name) use ($pdo, &$guestHashes): array {
    $token = bin2hex(random_bytes(32));
    $hash = hash('sha256', $token);
    $guestHashes[] = $hash;
    $statement = $pdo->prepare('INSERT INTO chess_guest_profiles (cookie_token_hash, display_name) VALUES (:hash, :name) RETURNING id');
    $statement->execute(['hash' => $hash, 'name' => $name]);

    return ['token' => $token, 'id' => (string) $statement->fetchColumn()];
};

try {
    $owner = $newGuest('Inventory Owner');
    $other = $newGuest('Inventory Other');
    $_COOKIE = ['wowie_chess_guest' => $owner['token']];

    // Legacy create defaults both optional fields without requiring the production migration.
    $legacy = send($application, 'POST', '/v1/poe2/builds', buildBody());
    assertSameValue(201, $legacy->status, 'legacy create');
    assertSameValue([], $legacy->payload['data']['considered_node_ids'], 'default considered list');
    assertSameValue([], $legacy->payload['data']['inventory'], 'default inventory');

    $expectedInventory = [inventoryItem()];
    $expectedInventory[0]['name'] = 'Ashen Staff';
    $created = send($application, 'POST', '/v1/poe2/builds', buildBody([
        'considered_node_ids' => ['300', '301'],
        'inventory' => [inventoryItem()],
    ]));
    assertSameValue(201, $created->status, 'create with inventory');
    $id = (string) $created->payload['data']['id'];
    assertSameValue(['300', '301'], $created->payload['data']['considered_node_ids'], 'stored considered list');
    assertSameValue($expectedInventory, $created->payload['data']['inventory'], 'canonical inventory on create');
    assertSameValue($expectedInventory, send($application, 'GET', '/v1/poe2/builds/' . $id)->payload['data']['inventory'], 'inventory read back');

    $listed = send($application, 'GET', '/v1/poe2/builds');
    assertSameValue(2, $listed->payload['meta']['count'], 'owner build count');
    $listedById = array_column($listed->payload['data'], null, 'id');
    assertSameValue($expectedInventory, $listedById[$id]['inventory'], 'inventory in list');

    // Missing optional fields preserve stored values; explicit empty lists clear them.
    $kept = send($application, 'PUT', '/v1/poe2/builds/' . $id, buildBody());
    assertSameValue(200, $kept->status, 'legacy update');
    assertSameValue(['300', '301'], $kept->payload['data']['considered_node_ids'], 'considered kept by legacy update');
    assertSameValue($expectedInventory, $kept->payload['data']['inventory'], 'inventory kept by legacy update');
    $cleared = send($application, 'PUT', '/v1/poe2/builds/' . $id, buildBody([
        'considered_node_ids' => [],
        'inventory' => [],
    ]));
    assertSameValue([], $cleared->payload['data']['considered_node_ids'], 'considered cleared by empty list');
    assertSameValue([], $cleared->payload['data']['inventory'], 'inventory cleared by empty list');

    // Put valid inventory back so rejected updates can prove that validation is atomic.
    $restored = send($application, 'PUT', '/v1/poe2/builds/' . $id, buildBody(['inventory' => [inventoryItem()]]));
    assertSameValue($expectedInventory, $restored->payload['data']['inventory'], 'inventory restored');

    $missing = inventoryItem();
    unset($missing['name']);
    $extra = inventoryItem();
    $extra['rarity'] = 'rare';
    $duplicate = inventoryItem('helmet');
    $badBoolean = inventoryItem();
    $badBoolean['equipped'] = 1;
    $badNumber = inventoryItem();
    $badNumber['armour'] = 1.5;
    $badText = inventoryItem();
    $badText['name'] = "bad\0name";
    $badWeaponShape = inventoryItem();
    $badWeaponShape['weapon'] = ['physical_min' => 1, 'physical_max' => 2];
    $reversedWeapon = inventoryItem();
    $reversedWeapon['weapon']['physical_min'] = 21;
    $outOfRangeWeapon = inventoryItem();
    $outOfRangeWeapon['weapon']['physical_max'] = 1_000_001;
    $badAttackSpeed = inventoryItem();
    $badAttackSpeed['weapon']['attacks_per_second'] = 0;
    $offHandWeapon = inventoryItem('off_hand');

    $invalidInventories = [
        'null inventory' => null,
        'object inventory' => (object) ['0' => inventoryItem()],
        'malformed item' => [[]],
        'missing item field' => [$missing],
        'extra item field' => [$extra],
        'unknown slot' => [inventoryItem('cape')],
        'duplicate slot' => [$duplicate, $duplicate],
        'invalid boolean' => [$badBoolean],
        'invalid defence number' => [$badNumber],
        'invalid item text' => [$badText],
        'malformed weapon' => [$badWeaponShape],
        'reversed weapon damage' => [$reversedWeapon],
        'out-of-range weapon damage' => [$outOfRangeWeapon],
        'out-of-range attack speed' => [$badAttackSpeed],
        'weapon outside main hand' => [$offHandWeapon],
    ];
    foreach ($invalidInventories as $label => $inventory) {
        assertInventoryRejected($application, $id, $inventory, $label);
    }
    assertSameValue($expectedInventory, send($application, 'GET', '/v1/poe2/builds/' . $id)->payload['data']['inventory'], 'invalid updates leave inventory unchanged');

    // Existing node lists still preserve their wire-level distinction between arrays and objects.
    $nodeObject = str_replace(
        '"considered_node_ids":["300"]',
        '"considered_node_ids":{"0":"300"}',
        buildBody(['considered_node_ids' => ['300']]),
    );
    $invalidNodeList = send($application, 'POST', '/v1/poe2/builds', $nodeObject);
    assertSameValue(422, $invalidNodeList->status, 'considered object rejected');
    assertSameValue(true, isset($invalidNodeList->payload['details']['considered_node_ids']), 'considered error names field');

    // A second owner sees neither reads nor updates for this build.
    $_COOKIE = ['wowie_chess_guest' => $other['token']];
    assertSameValue(404, send($application, 'GET', '/v1/poe2/builds/' . $id)->status, 'cross-owner read rejected');
    assertSameValue(404, send($application, 'PUT', '/v1/poe2/builds/' . $id, buildBody(['inventory' => []]))->status, 'cross-owner update rejected');

    // Listing while signed in adopts the guest rows without changing their inventory.
    $email = 'poe2-inventory-' . bin2hex(random_bytes(8)) . '@example.test';
    $user = $pdo->prepare("INSERT INTO users (email, display_name) VALUES (:email, 'Inventory User') RETURNING id");
    $user->execute(['email' => $email]);
    $userId = (string) $user->fetchColumn();
    $accessToken = (new JwtService($config))->issue($userId, []);
    $_COOKIE = ['wowie_chess_guest' => $owner['token']];
    $adopted = send($application, 'GET', '/v1/poe2/builds', null, ['authorization' => 'Bearer ' . $accessToken]);
    assertSameValue(200, $adopted->status, 'adoption list status');
    assertSameValue(2, $adopted->payload['meta']['adopted_from_guest'] ?? null, 'guest builds adopted');
    $adoptedById = array_column($adopted->payload['data'], null, 'id');
    assertSameValue($expectedInventory, $adoptedById[$id]['inventory'], 'adoption retains inventory');

    assertSameValue($productionCount, (int) $pdo->query('SELECT count(*) FROM ' . $productionTable)->fetchColumn(), 'configured build table unchanged');
    echo "PoE2 considered-passive and inventory checks passed.\n";
} finally {
    $_COOKIE = [];
    if ($userId !== null) {
        $pdo->prepare('DELETE FROM users WHERE id = :id')->execute(['id' => $userId]);
    }
    foreach ($guestHashes as $hash) {
        $pdo->prepare('DELETE FROM chess_guest_profiles WHERE cookie_token_hash = :hash')->execute(['hash' => $hash]);
    }
    $pdo->exec('DROP TABLE IF EXISTS pg_temp.poe2_saved_builds');
}

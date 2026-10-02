<?php

declare(strict_types=1);

namespace Wowie\Api\Poe2;

use PDO;
use RuntimeException;
use stdClass;
use Throwable;

/**
 * Imports a pinned Path of Exile 2 passive-tree export (GGG's data.json) into the
 * poe2_tree_* tables. Provenance and field semantics are recorded in
 * database/data/poe2-passive-tree/SOURCE.md.
 *
 * The import is structural: identifiers, coordinates and references are checked so the
 * tables never hold a dangling row, and every export fact the planner's rule model reads
 * is kept. Rule semantics stay in htdocs/assets/js/path-of-exile-2/tree-data.js, which
 * validates the API payload that Poe2TreeRepository builds from these tables.
 */
final class Poe2TreeImporter
{
    /** Bump when the stored rows change for the same export, so deploys re-import it. */
    public const IMPORTER_REVISION = 1;

    private const ROOT_KEY = 'root';
    private const NODE_KEY_PATTERN = '/\A(?:0|[1-9][0-9]{0,9})\z/';
    private const MAX_ID = 2147483647;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array{status: 'imported'|'unchanged', version: string, nodes: int, edges: int}
     */
    public function importFromManifest(string $manifestPath): array
    {
        $manifestJson = @file_get_contents($manifestPath);
        if ($manifestJson === false) {
            throw $this->error("could not read {$manifestPath}.");
        }
        try {
            $manifest = json_decode($manifestJson, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw $this->error("{$manifestPath} is not valid JSON: {$error->getMessage()}");
        }
        if (!is_array($manifest)) {
            throw $this->error("{$manifestPath} must be a JSON object.");
        }
        $file = $manifest['file'] ?? null;
        if (!is_string($file) || preg_match('/\A[A-Za-z0-9._-]+\z/', $file) !== 1 || str_starts_with($file, '.')) {
            throw $this->error("{$manifestPath} \"file\" must name a file in the same directory.");
        }
        $exportPath = dirname($manifestPath) . '/' . $file;
        $exportJson = @file_get_contents($exportPath);
        if ($exportJson === false) {
            throw $this->error("could not read {$exportPath}.");
        }

        return $this->import([
            'version' => $manifest['version'] ?? null,
            'url' => $manifest['url'] ?? null,
            'commit' => $manifest['commit'] ?? null,
            'sha256' => $manifest['sha256'] ?? null,
        ], $exportJson);
    }

    /**
     * Stores the export under its version and makes that version current. Re-importing the
     * same bytes with the same importer revision changes nothing.
     *
     * @param array<string, mixed> $source version, url, commit and sha256 of the pinned export
     * @return array{status: 'imported'|'unchanged', version: string, nodes: int, edges: int}
     */
    public function import(array $source, string $exportJson): array
    {
        $source = $this->readSource($source);
        $digest = hash('sha256', $exportJson);
        if (!hash_equals($source['sha256'], $digest)) {
            throw $this->error("the export's SHA-256 {$digest} does not match the pinned {$source['sha256']}.");
        }
        try {
            $export = json_decode($exportJson, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw $this->error("the export is not valid JSON: {$error->getMessage()}");
        }
        $rows = $this->readExport($export);
        $summary = [
            'version' => $source['version'],
            'nodes' => count($rows['nodes']),
            'edges' => count($rows['edges']),
        ];

        $ownsTransaction = !$this->pdo->inTransaction();
        if ($ownsTransaction) {
            $this->pdo->beginTransaction();
        }
        try {
            $this->pdo->query("SELECT pg_advisory_xact_lock(hashtext('poe2_tree_import'))");

            $existing = $this->pdo->prepare(
                'SELECT source_sha256, importer_revision FROM poe2_tree_versions WHERE version = :version FOR UPDATE'
            );
            $existing->execute(['version' => $source['version']]);
            $row = $existing->fetch(PDO::FETCH_ASSOC);
            $unchanged = is_array($row)
                && $row['source_sha256'] === $source['sha256']
                && (int) $row['importer_revision'] === self::IMPORTER_REVISION;

            if (!$unchanged) {
                $this->pdo->prepare('DELETE FROM poe2_tree_versions WHERE version = :version')
                    ->execute(['version' => $source['version']]);
                $this->pdo->prepare(
                    'INSERT INTO poe2_tree_versions (version, source_url, source_commit, source_sha256, importer_revision)'
                    . ' VALUES (:version, :url, :commit, :sha256, :revision)'
                )->execute([
                    'version' => $source['version'],
                    'url' => $source['url'],
                    'commit' => $source['commit'],
                    'sha256' => $source['sha256'],
                    'revision' => self::IMPORTER_REVISION,
                ]);
                $this->insertRows($source['version'], $rows);
            }

            // The partial unique index allows one current row, so clear before setting.
            $this->pdo->prepare('UPDATE poe2_tree_versions SET is_current = false WHERE is_current AND version <> :version')
                ->execute(['version' => $source['version']]);
            $this->pdo->prepare('UPDATE poe2_tree_versions SET is_current = true WHERE version = :version AND NOT is_current')
                ->execute(['version' => $source['version']]);

            if ($ownsTransaction) {
                $this->pdo->commit();
            }
        } catch (Throwable $error) {
            if ($ownsTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return ['status' => $unchanged ? 'unchanged' : 'imported'] + $summary;
    }

    /**
     * @param array<string, mixed> $source
     * @return array{version: string, url: string, commit: string, sha256: string}
     */
    private function readSource(array $source): array
    {
        $patterns = [
            'version' => '/\A[0-9A-Za-z][0-9A-Za-z._-]{0,31}\z/',
            'url' => '#\Ahttps://\S+\z#',
            'commit' => '/\A[a-f0-9]{40}\z/',
            'sha256' => '/\A[a-f0-9]{64}\z/',
        ];
        $read = [];
        foreach ($patterns as $field => $pattern) {
            $value = $source[$field] ?? null;
            if (!is_string($value) || preg_match($pattern, $value) !== 1) {
                throw $this->error("the source \"{$field}\" is missing or malformed.");
            }
            $read[$field] = $value;
        }

        return $read;
    }

    /**
     * @return array{classes: list<array<string, mixed>>, ascendancies: list<array<string, mixed>>,
     *   nodes: list<array<string, mixed>>, edges: list<array<string, mixed>>,
     *   unlocks: list<array<string, mixed>>, keystones: list<array<string, mixed>>,
     *   overrides: list<array<string, mixed>>, classPairs: list<array<string, mixed>>,
     *   ascendancyPairs: list<array<string, mixed>>}
     */
    private function readExport(mixed $export): array
    {
        if (!$export instanceof stdClass) {
            throw $this->error('the export must be a JSON object.');
        }
        $rawNodes = $export->nodes ?? null;
        if (!$rawNodes instanceof stdClass) {
            throw $this->error('"nodes" must be an object keyed by node ID.');
        }
        $rawEdges = $export->edges ?? null;
        if (!is_array($rawEdges)) {
            throw $this->error('"edges" must be an array.');
        }
        $rawClasses = $export->classes ?? null;
        if (!is_array($rawClasses)) {
            throw $this->error('"classes" must be an array.');
        }
        $rawOverrides = $export->skillOverrides ?? new stdClass();
        if (!$rawOverrides instanceof stdClass) {
            throw $this->error('"skillOverrides" must be an object keyed by override ID.');
        }

        // ---- Identity first, so every reference below can be resolved -----------
        /** @var array<int, stdClass> $nodesById */
        $nodesById = [];
        foreach (get_object_vars($rawNodes) as $key => $node) {
            $key = (string) $key;
            if (!$node instanceof stdClass) {
                throw $this->error("node {$key} must be an object.");
            }
            if ($key === self::ROOT_KEY) {
                continue;
            }
            $nodesById[$this->readId($key, "node key {$key}")] = $node;
        }
        if ($nodesById === []) {
            throw $this->error('"nodes" contains no passive nodes.');
        }

        // ---- Skill overrides -------------------------------------------------------
        $overrides = [];
        $overrideIds = [];
        foreach (get_object_vars($rawOverrides) as $key => $entry) {
            $overrideId = $this->readId((string) $key, "skillOverrides key {$key}");
            if (is_array($entry) && count($entry) > 0) {
                $entry = $entry[0];
            }
            if (!$entry instanceof stdClass) {
                throw $this->error("\"skillOverrides\" entry {$overrideId} must be an object.");
            }
            $overrides[] = [
                'override_id' => $overrideId,
                'export_id' => $this->optionalString($entry, 'id', "\"skillOverrides\" entry {$overrideId}"),
                'name' => $this->optionalString($entry, 'name', "\"skillOverrides\" entry {$overrideId}"),
                'stats' => property_exists($entry, 'stats') && $entry->stats !== null
                    ? $this->stringList($entry->stats, "\"skillOverrides\" entry {$overrideId} \"stats\"")
                    : null,
                'ascendancy_id' => $this->optionalString($entry, 'ascendancyId', "\"skillOverrides\" entry {$overrideId}"),
            ];
            $overrideIds[$overrideId] = true;
        }

        // ---- Classes, ascendancies and their override pairs ------------------------
        $classes = [];
        $ascendancies = [];
        $classPairs = [];
        $ascendancyPairs = [];
        $classNames = [];
        $ascendancyIds = [];
        foreach (array_values($rawClasses) as $classIndex => $class) {
            if (!$class instanceof stdClass) {
                throw $this->error("class #{$classIndex} must be an object.");
            }
            $name = $class->name ?? null;
            if (!is_string($name) || $name === '') {
                throw $this->error("class #{$classIndex} has no name.");
            }
            if (isset($classNames[$name])) {
                throw $this->error("class name \"{$name}\" is declared more than once.");
            }
            $classNames[$name] = true;
            if (!is_array($class->ascendancies ?? null)) {
                throw $this->error("class \"{$name}\" \"ascendancies\" must be an array.");
            }
            $classes[] = ['class_index' => $classIndex, 'name' => $name, 'start_node_id' => null];
            foreach ($this->overridePairs($class, "class \"{$name}\"", $overrideIds) as [$nodeId, $overrideId]) {
                $classPairs[] = ['class_index' => $classIndex, 'node_id' => $nodeId, 'override_id' => $overrideId];
            }

            foreach (array_values($class->ascendancies) as $position => $ascendancy) {
                $context = "class \"{$name}\" ascendancy #{$position}";
                if (!$ascendancy instanceof stdClass) {
                    throw $this->error("{$context} must be an object.");
                }
                $ascendancyId = $ascendancy->id ?? null;
                if (!is_string($ascendancyId) || $ascendancyId === '') {
                    throw $this->error("{$context} has a malformed ID.");
                }
                if (isset($ascendancyIds[$ascendancyId])) {
                    throw $this->error("ascendancy ID \"{$ascendancyId}\" is declared more than once.");
                }
                $ascendancyIds[$ascendancyId] = true;
                $ascendancies[] = [
                    'ascendancy_id' => $ascendancyId,
                    'class_index' => $classIndex,
                    'position' => $position,
                    'name' => $this->optionalString($ascendancy, 'name', "ascendancy \"{$ascendancyId}\""),
                ];
                foreach ($this->overridePairs($ascendancy, "ascendancy \"{$ascendancyId}\"", $overrideIds) as [$nodeId, $overrideId]) {
                    $ascendancyPairs[] = ['ascendancy_id' => $ascendancyId, 'node_id' => $nodeId, 'override_id' => $overrideId];
                }
            }
        }

        // ---- Nodes ----------------------------------------------------------------
        $nodes = [];
        $unlocks = [];
        $keystones = [];
        foreach ($nodesById as $nodeId => $node) {
            $context = "node {$nodeId}";
            $skill = $node->skill ?? null;
            if ((!is_int($skill) && !is_string($skill)) || (string) $skill !== (string) $nodeId) {
                throw $this->error("{$context} has a missing or mismatched \"skill\" ID; it must equal its key.");
            }
            $x = $node->x ?? null;
            $y = $node->y ?? null;
            if (!$this->isFiniteNumber($x) || !$this->isFiniteNumber($y)) {
                throw $this->error("{$context} has malformed coordinates.");
            }

            $kind = $this->nodeKind($node);
            $exportId = null;
            if ($kind !== 'placeholder') {
                $rawId = $node->id ?? null;
                if (!is_string($rawId) && !is_int($rawId)) {
                    throw $this->error("{$context} has a malformed \"id\".");
                }
                $exportId = (string) $rawId;
            }

            if (property_exists($node, 'classStartIndex') && $node->classStartIndex !== null) {
                if (!is_array($node->classStartIndex)) {
                    throw $this->error("{$context} \"classStartIndex\" must be an array.");
                }
                foreach ($node->classStartIndex as $classIndex) {
                    if (!is_int($classIndex) || !isset($classes[$classIndex])) {
                        throw $this->error("{$context} \"classStartIndex\" does not reference a class.");
                    }
                    if ($classes[$classIndex]['start_node_id'] !== null) {
                        throw $this->error("class index {$classIndex} has more than one start node.");
                    }
                    $classes[$classIndex]['start_node_id'] = $nodeId;
                }
            }

            $unlockAscendancyId = null;
            if (property_exists($node, 'unlockConstraint') && $node->unlockConstraint !== null) {
                $constraint = $node->unlockConstraint;
                if (!$constraint instanceof stdClass) {
                    throw $this->error("{$context} \"unlockConstraint\" must be an object.");
                }
                $required = $constraint->nodes ?? [];
                if (!is_array($required)) {
                    throw $this->error("{$context} \"unlockConstraint.nodes\" must be an array.");
                }
                foreach (array_values($required) as $position => $value) {
                    $unlocks[] = [
                        'node_id' => $nodeId,
                        'position' => $position,
                        'required_node_id' => $this->nodeRef($value, $nodesById, "{$context} \"unlockConstraint\""),
                    ];
                }
                $ascendancy = $constraint->ascendancy ?? null;
                if ($ascendancy !== null) {
                    if (!is_string($ascendancy) || !isset($ascendancyIds[$ascendancy])) {
                        throw $this->error("{$context} \"unlockConstraint\" references an unknown ascendancy.");
                    }
                    $unlockAscendancyId = $ascendancy;
                }
            }

            if (property_exists($node, 'keystonesInRadius') && $node->keystonesInRadius !== null) {
                if (!is_array($node->keystonesInRadius)) {
                    throw $this->error("{$context} \"keystonesInRadius\" must be an array.");
                }
                foreach (array_values($node->keystonesInRadius) as $position => $value) {
                    $keystones[] = [
                        'node_id' => $nodeId,
                        'position' => $position,
                        'keystone_node_id' => $this->nodeRef($value, $nodesById, "{$context} \"keystonesInRadius\""),
                    ];
                }
            }

            $ascendancyId = $this->optionalString($node, 'ascendancyId', $context);
            $nodes[] = [
                'node_id' => $nodeId,
                'export_id' => $exportId,
                'kind' => $kind,
                'name' => $this->optionalString($node, 'name', $context) ?? '',
                'stats' => property_exists($node, 'stats') && $node->stats !== null
                    ? $this->stringList($node->stats, "{$context} \"stats\"")
                    : [],
                'x' => $x,
                'y' => $y,
                'ascendancy_id' => $ascendancyId === '' ? null : $ascendancyId,
                'is_free' => ($node->isFree ?? null) === true,
                'is_multiple_choice' => ($node->isMultipleChoice ?? null) === true,
                'multiple_choice_parent_id' => ($node->isMultipleChoiceOption ?? null) === true
                    ? $this->choiceParent($nodeId, $node, $nodesById)
                    : null,
                'unlock_ascendancy_id' => $unlockAscendancyId,
            ];
        }

        // ---- Edges: the official connection list, minus the synthetic root --------
        $edges = [];
        foreach (array_values($rawEdges) as $edgeIndex => $edge) {
            if (!$edge instanceof stdClass) {
                throw $this->error("edge #{$edgeIndex} must be an object.");
            }
            $from = $this->nodeRef($edge->from ?? null, $nodesById, "edge #{$edgeIndex} \"from\"", true);
            $to = $this->nodeRef($edge->to ?? null, $nodesById, "edge #{$edgeIndex} \"to\"", true);
            if ($from === null || $to === null) {
                continue;
            }
            $orbit = $edge->orbit ?? null;
            if ($orbit !== null && !is_int($orbit)) {
                throw $this->error("edge #{$edgeIndex} has a malformed \"orbit\".");
            }
            $orbitX = $edge->orbitX ?? null;
            $orbitY = $edge->orbitY ?? null;
            // An arc needs both centre coordinates; a lone one draws nothing either way.
            $hasCentre = $this->isFiniteNumber($orbitX) && $this->isFiniteNumber($orbitY);
            $edges[] = [
                'edge_index' => $edgeIndex,
                'from_node_id' => $from,
                'to_node_id' => $to,
                'orbit' => $orbit,
                'orbit_x' => $hasCentre ? $orbitX : null,
                'orbit_y' => $hasCentre ? $orbitY : null,
            ];
        }

        return [
            'classes' => $classes,
            'ascendancies' => $ascendancies,
            'nodes' => $nodes,
            'edges' => $edges,
            'unlocks' => $unlocks,
            'keystones' => $keystones,
            'overrides' => $overrides,
            'classPairs' => $classPairs,
            'ascendancyPairs' => $ascendancyPairs,
        ];
    }

    /**
     * @param array<string, list<array<string, mixed>>> $rows
     */
    private function insertRows(string $version, array $rows): void
    {
        // Each table is written by one statement that expands a JSON array of rows.
        $this->insertJson($version, 'poe2_tree_classes', $rows['classes'], [
            'class_index' => 'smallint',
            'name' => 'text',
            'start_node_id' => 'integer',
        ]);
        $this->insertJson($version, 'poe2_tree_ascendancies', $rows['ascendancies'], [
            'ascendancy_id' => 'text',
            'class_index' => 'smallint',
            'position' => 'smallint',
            'name' => 'text',
        ]);
        $this->insertJson($version, 'poe2_tree_nodes', $rows['nodes'], [
            'node_id' => 'integer',
            'export_id' => 'text',
            'kind' => 'text',
            'name' => 'text',
            'stats' => 'text[]',
            'x' => 'double precision',
            'y' => 'double precision',
            'ascendancy_id' => 'text',
            'is_free' => 'boolean',
            'is_multiple_choice' => 'boolean',
            'multiple_choice_parent_id' => 'integer',
            'unlock_ascendancy_id' => 'text',
        ]);
        $this->insertJson($version, 'poe2_tree_edges', $rows['edges'], [
            'edge_index' => 'integer',
            'from_node_id' => 'integer',
            'to_node_id' => 'integer',
            'orbit' => 'integer',
            'orbit_x' => 'double precision',
            'orbit_y' => 'double precision',
        ]);
        $this->insertJson($version, 'poe2_tree_node_unlock_requirements', $rows['unlocks'], [
            'node_id' => 'integer',
            'position' => 'smallint',
            'required_node_id' => 'integer',
        ]);
        $this->insertJson($version, 'poe2_tree_node_keystones_in_radius', $rows['keystones'], [
            'node_id' => 'integer',
            'position' => 'smallint',
            'keystone_node_id' => 'integer',
        ]);
        $this->insertJson($version, 'poe2_tree_skill_overrides', $rows['overrides'], [
            'override_id' => 'integer',
            'export_id' => 'text',
            'name' => 'text',
            'stats' => 'text[]',
            'ascendancy_id' => 'text',
        ]);
        $this->insertJson($version, 'poe2_tree_class_override_pairs', $rows['classPairs'], [
            'class_index' => 'smallint',
            'node_id' => 'integer',
            'override_id' => 'integer',
        ]);
        $this->insertJson($version, 'poe2_tree_ascendancy_override_pairs', $rows['ascendancyPairs'], [
            'ascendancy_id' => 'text',
            'node_id' => 'integer',
            'override_id' => 'integer',
        ]);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param array<string, string> $columns column name => SQL type; names and types are constants
     */
    private function insertJson(string $version, string $table, array $rows, array $columns): void
    {
        if ($rows === []) {
            return;
        }
        $definitions = [];
        $values = [];
        foreach ($columns as $column => $type) {
            if ($type === 'text[]') {
                // jsonb_to_recordset has no text[] input, so arrays arrive as jsonb.
                $definitions[] = "{$column} jsonb";
                $values[] = "CASE WHEN r.{$column} IS NULL THEN NULL ELSE ARRAY("
                    . "SELECT element.value FROM jsonb_array_elements_text(r.{$column}) WITH ORDINALITY AS element(value, ordinal)"
                    . ' ORDER BY element.ordinal) END';
            } else {
                $definitions[] = "{$column} {$type}";
                $values[] = "r.{$column}";
            }
        }
        $statement = $this->pdo->prepare(
            "INSERT INTO {$table} (tree_version, " . implode(', ', array_keys($columns)) . ')'
            . ' SELECT :version, ' . implode(', ', $values)
            . ' FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(' . implode(', ', $definitions) . ')'
        );
        $statement->execute([
            'version' => $version,
            'rows' => json_encode($rows, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION),
        ]);
        if ($statement->rowCount() !== count($rows)) {
            throw $this->error("{$table} stored {$statement->rowCount()} of " . count($rows) . ' rows.');
        }
    }

    /** Same precedence as nodeKind() in tree-data.js. */
    private function nodeKind(stdClass $node): string
    {
        if (property_exists($node, 'id') && $node->id === null) {
            return 'placeholder';
        }
        if (is_array($node->classStartIndex ?? null) && count($node->classStartIndex) > 0) {
            return 'classStart';
        }
        foreach ([
            'isAscendancyStart' => 'ascendancyStart',
            'isMastery' => 'mastery',
            'isKeystone' => 'keystone',
            'isJewelSocket' => 'jewelSocket',
            'isNotable' => 'notable',
        ] as $flag => $kind) {
            if (($node->{$flag} ?? null) === true) {
                return $kind;
            }
        }

        return 'small';
    }

    /**
     * An option names its hub in multipleChoiceParent; exports that omit it fall back to
     * the single multiple-choice neighbour, as tree-data.js does.
     *
     * @param array<int, stdClass> $nodesById
     */
    private function choiceParent(int $nodeId, stdClass $node, array $nodesById): int
    {
        $context = "multiple-choice option {$nodeId}";
        $parentId = null;
        if (property_exists($node, 'multipleChoiceParent') && $node->multipleChoiceParent !== null) {
            $parentId = $this->nodeRef($node->multipleChoiceParent, $nodesById, "{$context} \"multipleChoiceParent\"");
        } else {
            $candidates = [];
            foreach (['in', 'out'] as $direction) {
                $list = $node->{$direction} ?? [];
                if (!is_array($list)) {
                    throw $this->error("node {$nodeId} \"{$direction}\" must be an array.");
                }
                foreach ($list as $value) {
                    $neighbourId = $this->nodeRef($value, $nodesById, "node {$nodeId} \"{$direction}\"", true);
                    if ($neighbourId !== null && ($nodesById[$neighbourId]->isMultipleChoice ?? null) === true) {
                        $candidates[$neighbourId] = true;
                    }
                }
            }
            if (count($candidates) === 1) {
                $parentId = array_key_first($candidates);
            }
        }
        if ($parentId === null || ($nodesById[$parentId]->isMultipleChoice ?? null) !== true) {
            throw $this->error("{$context} does not identify exactly one \"isMultipleChoice\" parent node.");
        }

        return $parentId;
    }

    /**
     * @param array<int, true> $overrideIds
     * @return list<array{0: int, 1: int}> node ID and override ID; the node may be absent from "nodes"
     */
    private function overridePairs(stdClass $owner, string $context, array $overrideIds): array
    {
        $value = $owner->overridePairs ?? null;
        if ($value === null || $value === []) {
            return [];
        }
        if (!$value instanceof stdClass) {
            throw $this->error("{$context} \"overridePairs\" must be an object map of node ID to override ID.");
        }
        $pairs = [];
        foreach (get_object_vars($value) as $nodeKey => $overrideValue) {
            $nodeId = $this->readId((string) $nodeKey, "{$context} \"overridePairs\" key {$nodeKey}");
            $overrideId = is_int($overrideValue) || is_string($overrideValue)
                ? $this->readId((string) $overrideValue, "{$context} \"overridePairs\" value")
                : null;
            if ($overrideId === null || !isset($overrideIds[$overrideId])) {
                throw $this->error("{$context} \"overridePairs\" maps node {$nodeId} to an override missing from \"skillOverrides\".");
            }
            $pairs[] = [$nodeId, $overrideId];
        }

        return $pairs;
    }

    /**
     * @param array<int, stdClass> $nodesById
     * @return ($allowRoot is true ? int|null : int) null for the synthetic root when allowed
     */
    private function nodeRef(mixed $value, array $nodesById, string $context, bool $allowRoot = false): ?int
    {
        if ($allowRoot && $value === self::ROOT_KEY) {
            return null;
        }
        $id = null;
        if (is_int($value) && $value >= 0) {
            $id = $value;
        } elseif (is_string($value) && preg_match(self::NODE_KEY_PATTERN, $value) === 1) {
            $id = (int) $value;
        }
        if ($id === null || !isset($nodesById[$id])) {
            throw $this->error("{$context} references missing node " . json_encode($value) . '.');
        }

        return $id;
    }

    private function readId(string $value, string $context): int
    {
        if (preg_match(self::NODE_KEY_PATTERN, $value) !== 1 || (int) $value > self::MAX_ID) {
            throw $this->error("{$context} is not a non-negative integer ID.");
        }

        return (int) $value;
    }

    private function optionalString(stdClass $object, string $field, string $context): ?string
    {
        $value = $object->{$field} ?? null;
        if ($value !== null && !is_string($value)) {
            throw $this->error("{$context} has a malformed \"{$field}\".");
        }

        return $value;
    }

    /** @return list<string> */
    private function stringList(mixed $value, string $context): array
    {
        if (!is_array($value)) {
            throw $this->error("{$context} must be an array of strings.");
        }
        foreach ($value as $entry) {
            if (!is_string($entry)) {
                throw $this->error("{$context} contains a non-string entry.");
            }
        }

        return array_values($value);
    }

    private function isFiniteNumber(mixed $value): bool
    {
        return is_int($value) || (is_float($value) && is_finite($value));
    }

    private function error(string $message): RuntimeException
    {
        return new RuntimeException("PoE2 passive tree import: {$message}");
    }
}

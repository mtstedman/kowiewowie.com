<?php

declare(strict_types=1);

namespace Wowie\Api\Poe2;

use PDO;

/**
 * Reads the imported Path of Exile 2 passive tree (poe2_tree_* tables).
 *
 * payload() returns the tree in the field layout of GGG's export (classes, nodes, edges,
 * skillOverrides), trimmed to the fields the planner's rule model reads, so
 * htdocs/assets/js/path-of-exile-2/tree-data.js stays the single interpreter of the
 * allocation rules. Art, icon paths, orbit groups and the duplicated per-node in/out
 * lists are not stored; the edge list carries every connection.
 */
final class Poe2TreeRepository
{
    /** Bump when payload() changes shape for the same imported rows, to invalidate ETags. */
    private const PAYLOAD_REVISION = 1;

    private const KIND_FLAGS = [
        'ascendancyStart' => 'isAscendancyStart',
        'mastery' => 'isMastery',
        'keystone' => 'isKeystone',
        'jewelSocket' => 'isJewelSocket',
        'notable' => 'isNotable',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array{version: string, source_url: string, source_commit: string, source_sha256: string,
     *   importer_revision: int}|null
     */
    public function current(): ?array
    {
        $row = $this->pdo->query(
            'SELECT version, source_url, source_commit, source_sha256, importer_revision'
            . ' FROM poe2_tree_versions WHERE is_current'
        )->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }
        $row['importer_revision'] = (int) $row['importer_revision'];

        return $row;
    }

    /**
     * A strong validator for one imported version; the rows behind it never change.
     *
     * @param array{version: string, source_sha256: string, importer_revision: int} $version
     */
    public function etag(array $version): string
    {
        return sprintf(
            '"poe2-tree-%s-%s-%d.%d"',
            $version['version'],
            substr($version['source_sha256'], 0, 16),
            $version['importer_revision'],
            self::PAYLOAD_REVISION,
        );
    }

    /**
     * @param array{version: string, source_url: string, source_commit: string, source_sha256: string} $version
     * @return array<string, mixed>
     */
    public function payload(array $version): array
    {
        $treeVersion = $version['version'];

        $overrides = [];
        foreach ($this->rows(
            'SELECT override_id, export_id, name, array_to_json(stats) AS stats, ascendancy_id'
            . ' FROM poe2_tree_skill_overrides WHERE tree_version = :version ORDER BY override_id',
            $treeVersion,
        ) as $row) {
            $entry = ['skill' => (int) $row['override_id']];
            foreach (['export_id' => 'id', 'name' => 'name', 'ascendancy_id' => 'ascendancyId'] as $column => $field) {
                if ($row[$column] !== null) {
                    $entry[$field] = $row[$column];
                }
            }
            if ($row['stats'] !== null) {
                $entry['stats'] = $this->decodeList($row['stats']);
            }
            $overrides[(string) $row['override_id']] = $entry;
        }

        $classPairs = [];
        foreach ($this->rows(
            'SELECT class_index, node_id, override_id FROM poe2_tree_class_override_pairs'
            . ' WHERE tree_version = :version ORDER BY class_index, node_id',
            $treeVersion,
        ) as $row) {
            $classPairs[(int) $row['class_index']][(string) $row['node_id']] = (int) $row['override_id'];
        }
        $ascendancyPairs = [];
        foreach ($this->rows(
            'SELECT ascendancy_id, node_id, override_id FROM poe2_tree_ascendancy_override_pairs'
            . ' WHERE tree_version = :version ORDER BY ascendancy_id, node_id',
            $treeVersion,
        ) as $row) {
            $ascendancyPairs[$row['ascendancy_id']][(string) $row['node_id']] = (int) $row['override_id'];
        }

        $ascendanciesByClass = [];
        foreach ($this->rows(
            'SELECT ascendancy_id, class_index, name FROM poe2_tree_ascendancies'
            . ' WHERE tree_version = :version ORDER BY class_index, position',
            $treeVersion,
        ) as $row) {
            $ascendancy = ['id' => $row['ascendancy_id'], 'name' => $row['name']];
            if (isset($ascendancyPairs[$row['ascendancy_id']])) {
                $ascendancy['overridePairs'] = (object) $ascendancyPairs[$row['ascendancy_id']];
            }
            $ascendanciesByClass[(int) $row['class_index']][] = $ascendancy;
        }

        $classes = [];
        $classStarts = [];
        foreach ($this->rows(
            'SELECT class_index, name, start_node_id FROM poe2_tree_classes'
            . ' WHERE tree_version = :version ORDER BY class_index',
            $treeVersion,
        ) as $row) {
            $classIndex = (int) $row['class_index'];
            $class = ['name' => $row['name'], 'ascendancies' => $ascendanciesByClass[$classIndex] ?? []];
            if (isset($classPairs[$classIndex])) {
                $class['overridePairs'] = (object) $classPairs[$classIndex];
            }
            $classes[] = $class;
            if ($row['start_node_id'] !== null) {
                $classStarts[(int) $row['start_node_id']][] = $classIndex;
            }
        }

        $unlockNodes = [];
        foreach ($this->rows(
            'SELECT node_id, required_node_id FROM poe2_tree_node_unlock_requirements'
            . ' WHERE tree_version = :version ORDER BY node_id, position',
            $treeVersion,
        ) as $row) {
            $unlockNodes[(int) $row['node_id']][] = (int) $row['required_node_id'];
        }
        $keystonesInRadius = [];
        foreach ($this->rows(
            'SELECT node_id, keystone_node_id FROM poe2_tree_node_keystones_in_radius'
            . ' WHERE tree_version = :version ORDER BY node_id, position',
            $treeVersion,
        ) as $row) {
            $keystonesInRadius[(int) $row['node_id']][] = (int) $row['keystone_node_id'];
        }

        $nodes = [];
        foreach ($this->rows(
            'SELECT node_id, export_id, kind, name, array_to_json(stats) AS stats, x, y, ascendancy_id,'
            . ' is_free, is_multiple_choice, multiple_choice_parent_id, unlock_ascendancy_id'
            . ' FROM poe2_tree_nodes WHERE tree_version = :version ORDER BY node_id',
            $treeVersion,
        ) as $row) {
            $nodeId = (int) $row['node_id'];
            $node = [
                'skill' => $nodeId,
                'id' => $row['export_id'],
                'name' => $row['name'],
                'stats' => $this->decodeList($row['stats']),
                'x' => (float) $row['x'],
                'y' => (float) $row['y'],
            ];
            if ($row['ascendancy_id'] !== null) {
                $node['ascendancyId'] = $row['ascendancy_id'];
            }
            if (isset(self::KIND_FLAGS[$row['kind']])) {
                $node[self::KIND_FLAGS[$row['kind']]] = true;
            }
            if (isset($classStarts[$nodeId])) {
                $node['classStartIndex'] = $classStarts[$nodeId];
            }
            if ($this->flag($row['is_free'])) {
                $node['isFree'] = true;
            }
            if ($this->flag($row['is_multiple_choice'])) {
                $node['isMultipleChoice'] = true;
            }
            if ($row['multiple_choice_parent_id'] !== null) {
                $node['isMultipleChoiceOption'] = true;
                $node['multipleChoiceParent'] = (int) $row['multiple_choice_parent_id'];
            }
            if ($row['unlock_ascendancy_id'] !== null || isset($unlockNodes[$nodeId])) {
                $constraint = ['nodes' => $unlockNodes[$nodeId] ?? []];
                if ($row['unlock_ascendancy_id'] !== null) {
                    $constraint['ascendancy'] = $row['unlock_ascendancy_id'];
                }
                $node['unlockConstraint'] = $constraint;
            }
            if (isset($keystonesInRadius[$nodeId])) {
                $node['keystonesInRadius'] = $keystonesInRadius[$nodeId];
            }
            $nodes[(string) $nodeId] = $node;
        }

        $edges = [];
        foreach ($this->rows(
            'SELECT from_node_id, to_node_id, orbit, orbit_x, orbit_y FROM poe2_tree_edges'
            . ' WHERE tree_version = :version ORDER BY edge_index',
            $treeVersion,
        ) as $row) {
            $edge = ['from' => (int) $row['from_node_id'], 'to' => (int) $row['to_node_id']];
            if ($row['orbit'] !== null) {
                $edge['orbit'] = (int) $row['orbit'];
            }
            if ($row['orbit_x'] !== null) {
                $edge['orbitX'] = (float) $row['orbit_x'];
                $edge['orbitY'] = (float) $row['orbit_y'];
            }
            $edges[] = $edge;
        }

        return [
            'version' => $treeVersion,
            'source' => [
                'url' => $version['source_url'],
                'commit' => $version['source_commit'],
                'sha256' => $version['source_sha256'],
            ],
            'tree' => [
                'classes' => $classes,
                'nodes' => (object) $nodes,
                'edges' => $edges,
                'skillOverrides' => (object) $overrides,
            ],
        ];
    }

    /** @return list<array<string, mixed>> */
    private function rows(string $sql, string $treeVersion): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute(['version' => $treeVersion]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    /** @return list<string> */
    private function decodeList(string $json): array
    {
        $list = json_decode($json, true, 4, JSON_THROW_ON_ERROR);

        return is_array($list) ? $list : [];
    }

    private function flag(mixed $value): bool
    {
        return $value === true || $value === 't' || $value === 1;
    }
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAllocationModel, normalizeTree } from '../htdocs/assets/js/path-of-exile-2/tree-data.js';
import { findMinimalRoute } from '../htdocs/assets/js/path-of-exile-2/optimizer.js';

// tests/poe2-tree-api.php writes GET /v1/poe2/tree to POE2_TREE_PAYLOAD and runs this file.
const payloadPath = process.env.POE2_TREE_PAYLOAD;
const skip = payloadPath ? false : 'run through tests/poe2-tree-api.php, which supplies POE2_TREE_PAYLOAD';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

test('the API payload builds the same tree and allocation models as the pinned export', { skip }, () => {
  const { data } = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const source = readJson(new URL('../database/data/poe2-passive-tree/source.json', import.meta.url));
  const raw = readJson(new URL('../database/data/poe2-passive-tree/data.json', import.meta.url));
  assert.deepEqual(data.source, { url: source.url, commit: source.commit, sha256: source.sha256 });

  const fromApi = normalizeTree(data.tree, { version: data.version, url: data.source.url, commit: data.source.commit });
  const fromExport = normalizeTree(raw, { version: source.version, url: source.url, commit: source.commit });
  for (const key of ['version', 'source', 'classes', 'nodes', 'edges', 'edgeArcs', 'skippedOverridePairs']) {
    assert.deepEqual(fromApi[key], fromExport[key], `TreeData.${key}`);
  }

  for (const classOption of fromExport.classes) {
    for (const ascendancyId of [null, ...classOption.ascendancies.map((ascendancy) => ascendancy.id)]) {
      const label = `${classOption.id}/${ascendancyId ?? 'none'}`;
      const apiModel = buildAllocationModel(fromApi, classOption.id, ascendancyId);
      const exportModel = buildAllocationModel(fromExport, classOption.id, ascendancyId);
      for (const key of ['nodes', 'edges', 'edgeArcs', 'rootIds', 'routeRules']) {
        assert.deepEqual(apiModel[key], exportModel[key], `${label} model.${key}`);
      }
      // Free nodes and choice options are charged identically.
      const everyId = exportModel.nodes.map((node) => node.id);
      assert.deepEqual(apiModel.pointCost(everyId), exportModel.pointCost(everyId), `${label} pointCost`);

      // Walk outward from the start and compare what each model allows next.
      const allocated = [];
      for (let step = 0; step < 30; step += 1) {
        const expected = [...exportModel.availableNodeIds(allocated)].sort();
        assert.deepEqual([...apiModel.availableNodeIds(allocated)].sort(), expected, `${label} availability at step ${step}`);
        if (expected.length === 0) break;
        allocated.push(expected[(step * 7) % expected.length]);
      }
    }
  }

  // Oracle's Entwined Realities plus a keystone exercises keystonesInRadius.
  const exportOracle = buildAllocationModel(fromExport, 'Druid', 'Druid1');
  const apiOracle = buildAllocationModel(fromApi, 'Druid', 'Druid1');
  const route = findMinimalRoute(exportOracle, ['32905', '47759']);
  assert.equal(route.ok, true, route.reason);
  assert.deepEqual(
    [...apiOracle.availableNodeIds(route.nodeIds)].sort(),
    [...exportOracle.availableNodeIds(route.nodeIds)].sort(),
    'Oracle disconnected-allocation availability',
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAllocationModel, normalizeTree } from '../htdocs/assets/js/path-of-exile-2/tree-data.js';
import { findMinimalRoute, MAX_MUST_HAVES } from '../htdocs/assets/js/path-of-exile-2/optimizer.js';
import { performance } from 'node:perf_hooks';

const TREE_TEXT = readFileSync(new URL('../htdocs/assets/data/path-of-exile-2/tree.json', import.meta.url), 'utf8');
const TREE_ERROR = { name: 'Error', message: /^PoE2 passive tree:/ };

// analyzeRaw caches by object identity, so every case gets its own parse.
const freshRaw = () => JSON.parse(TREE_TEXT);

const overrideOwners = (raw) => {
  const owners = [];
  for (const rawClass of raw.classes) {
    owners.push({ label: rawClass.name, record: rawClass });
    for (const ascendancy of rawClass.ascendancies) owners.push({ label: ascendancy.id, record: ascendancy });
  }
  return owners;
};

const danglingPairs = (raw) => {
  const found = [];
  for (const { label, record } of overrideOwners(raw)) {
    const pairs = record.overridePairs;
    if (pairs === null || typeof pairs !== 'object' || Array.isArray(pairs)) continue;
    for (const key of Object.keys(pairs)) {
      if (!Object.hasOwn(raw.nodes, key)) found.push({ owner: label, key });
    }
  }
  return found;
};

const druidOf = (raw) => raw.classes.find((rawClass) => rawClass.name === 'Druid');

const unusedId = (record) => {
  let id = 900000000;
  while (Object.hasOwn(record, String(id))) id += 1;
  return String(id);
};

const firstOverrideId = (raw) => Object.keys(raw.skillOverrides)[0];

const allModels = (data) => {
  const models = [];
  for (const option of data.classes) {
    for (const ascendancyId of [null, ...option.ascendancies.map((ascendancy) => ascendancy.id)]) {
      models.push({ classId: option.id, ascendancyId, model: buildAllocationModel(data, option.id, ascendancyId) });
    }
  }
  return models;
};

test('the installed export normalizes and skips exactly the two dangling Druid overridePairs', () => {
  const raw = freshRaw();
  const dangling = danglingPairs(raw);
  assert.equal(dangling.length, 2);
  assert.ok(dangling.every((pair) => pair.owner === 'Druid'));
  assert.ok(dangling.some((pair) => pair.key === '19680'));

  const data = normalizeTree(raw);
  assert.ok(data.classes.length > 0);
  assert.ok(data.classes.some((option) => option.id === 'Druid'));
  assert.equal(data.skippedOverridePairs, 2);
  assert.ok(Number.isInteger(data.skippedOverridePairs));
});

test('every offered class and ascendancy builds a usable allocation model', () => {
  const data = normalizeTree(freshRaw());
  for (const { classId, ascendancyId, model } of allModels(data)) {
    const label = `${classId} / ${ascendancyId}`;
    const ids = new Set(model.nodes.map((node) => node.id));
    assert.ok(model.rootIds.length > 0, label);
    for (const rootId of model.rootIds) assert.ok(ids.has(rootId), `${label}: root ${rootId} is not a model node`);
    assert.deepEqual(model.validateAllocation([]), { valid: true, reason: null }, label);
    assert.deepEqual(model.pointCost([]), { passive: 0, ascendancy: 0 }, label);
  }
});

test('an export without dangling overridePairs reports zero skipped', () => {
  const raw = freshRaw();
  for (const { owner, key } of danglingPairs(raw)) {
    const record = overrideOwners(raw).find((candidate) => candidate.label === owner).record;
    delete record.overridePairs[key];
  }
  assert.equal(danglingPairs(raw).length, 0);
  assert.equal(normalizeTree(raw).skippedOverridePairs, 0);
});

test('a skipped pair never contributes an override name or stats', () => {
  const raw = freshRaw();
  const sentinelId = unusedId(raw.skillOverrides);
  const sentinel = 'SKIPPED OVERRIDE SENTINEL';
  raw.skillOverrides[sentinelId] = { name: sentinel, stats: [`${sentinel} STAT`] };
  const dangling = danglingPairs(raw);
  for (const { key } of dangling) druidOf(raw).overridePairs[key] = Number(sentinelId);

  const data = normalizeTree(raw);
  assert.equal(data.skippedOverridePairs, dangling.length);
  const skippedKeys = new Set(dangling.map((pair) => pair.key));
  for (const { classId, ascendancyId, model } of allModels(data)) {
    for (const node of model.nodes) {
      const label = `${classId} / ${ascendancyId} node ${node.id}`;
      assert.ok(!skippedKeys.has(node.id), label);
      assert.notEqual(node.name, sentinel, label);
      assert.ok(node.stats.every((stat) => !stat.includes(sentinel)), label);
    }
  }
});

test('a dangling overridePairs key still has its override value validated', () => {
  const raw = freshRaw();
  const [{ key }] = danglingPairs(raw);
  druidOf(raw).overridePairs[key] = Number(unusedId(raw.skillOverrides));
  assert.throws(() => normalizeTree(raw), TREE_ERROR);
});

test('an override ID missing from skillOverrides still throws', () => {
  const raw = freshRaw();
  const druid = druidOf(raw);
  const [presentKey] = Object.keys(druid.overridePairs).filter((key) => Object.hasOwn(raw.nodes, key));
  druid.overridePairs[presentKey] = Number(unusedId(raw.skillOverrides));
  assert.throws(() => normalizeTree(raw), TREE_ERROR);
});

test('a malformed skillOverrides entry still throws', () => {
  const raw = freshRaw();
  const druid = druidOf(raw);
  const [presentKey] = Object.keys(druid.overridePairs).filter((key) => Object.hasOwn(raw.nodes, key));
  raw.skillOverrides[String(druid.overridePairs[presentKey])] = 'not an object';
  assert.throws(() => normalizeTree(raw), TREE_ERROR);
});

test('an overridePairs that is a non-object or a non-empty array still throws', () => {
  for (const value of [5, 'pairs', true, [1]]) {
    const raw = freshRaw();
    druidOf(raw).overridePairs = value;
    assert.throws(() => normalizeTree(raw), TREE_ERROR, `overridePairs ${JSON.stringify(value)}`);
  }
});

test('a malformed or root overridePairs key still throws', () => {
  for (const key of ['root', 'abc', '-1', '01', '1.5', '']) {
    const raw = freshRaw();
    druidOf(raw).overridePairs[key] = Number(firstOverrideId(raw));
    assert.throws(() => normalizeTree(raw), TREE_ERROR, `overridePairs key ${JSON.stringify(key)}`);
  }
});

test('an edge to a missing node still throws', () => {
  const raw = freshRaw();
  const [existingId] = Object.keys(raw.nodes).filter((key) => key !== 'root');
  raw.edges.push({ from: Number(existingId), to: Number(unusedId(raw.nodes)) });
  assert.throws(() => normalizeTree(raw), TREE_ERROR);
});

for (const direction of ['in', 'out']) {
  test(`a node "${direction}" reference to a missing node still throws`, () => {
    const raw = freshRaw();
    const [existingId] = Object.keys(raw.nodes).filter((key) => key !== 'root');
    const node = raw.nodes[existingId];
    node[direction] = [...(Array.isArray(node[direction]) ? node[direction] : []), unusedId(raw.nodes)];
    assert.throws(() => normalizeTree(raw), TREE_ERROR);
  });
}

// Independent support traversal: deliberately does not use optimizer metadata.
function supportDistances(model, allowed = null) {
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const neighbours = new Map(model.nodes.map((node) => [node.id, []]));
  for (const [a, b] of model.edges) {
    neighbours.get(a).push(b);
    neighbours.get(b).push(a);
  }
  const distances = new Map(model.rootIds.map((id) => [id, 0]));
  const queue = model.rootIds.slice();
  for (let head = 0; head < queue.length; head += 1) {
    const from = queue[head];
    for (const to of neighbours.get(from)) {
      if (distances.has(to) || (allowed !== null && !allowed.has(to))) continue;
      if (nodes.get(to).domain === 'ascendancy' && nodes.get(from).domain !== 'ascendancy') continue;
      distances.set(to, distances.get(from) + 1);
      queue.push(to);
    }
  }
  return distances;
}

function assertRoute(model, mustHaves, result = findMinimalRoute(model, mustHaves)) {
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, null);
  const allocated = new Set(result.nodeIds);
  assert.equal(allocated.size, result.nodeIds.length);
  for (const root of model.rootIds) assert.ok(!allocated.has(root));
  for (const id of mustHaves) {
    if (!model.rootIds.includes(id)) assert.ok(allocated.has(id), `missing must-have ${id}`);
  }
  const validation = model.validateAllocation(result.nodeIds);
  assert.equal(validation.valid, true, validation.reason);
  const connected = supportDistances(model, allocated);
  for (const id of allocated) assert.ok(connected.has(id), `disconnected node ${id}`);
  assert.deepEqual(result.pointCost, model.pointCost(result.nodeIds));
  return result;
}

function assertRouteFailure(model, mustHaves) {
  let result;
  assert.doesNotThrow(() => { result = findMinimalRoute(model, mustHaves); });
  assert.equal(result.ok, false);
  assert.deepEqual(result.nodeIds, []);
  assert.equal(result.pointCost, null);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  return result;
}

function syntheticExport() {
  const nodes = {};
  for (let id = 0; id <= 14; id += 1) {
    nodes[id] = { skill: id, name: `Node ${id}`, x: id * 10, y: id % 3, stats: [] };
  }
  nodes[0].classStartIndex = [0];
  nodes[5].isMultipleChoice = true;
  for (const id of [6, 7]) {
    nodes[id].isMultipleChoiceOption = true;
    nodes[id].multipleChoiceParent = 5;
  }
  nodes[8].unlockConstraint = { nodes: [4] };
  for (const id of [10, 11, 12, 13]) nodes[id].ascendancyId = 'Test1';
  nodes[10].isAscendancyStart = true;
  nodes[11].isFree = true;
  return {
    classes: [{ name: 'Test', ascendancies: [{ id: 'Test1', name: 'Test ascendancy' }] }],
    nodes,
    edges: [
      [0, 1], [1, 2], [1, 3], [2, 4], [3, 5], [5, 6], [5, 7],
      [1, 8], [6, 9], [4, 9], [10, 11], [11, 12], [12, 13], [1, 13],
    ].map(([from, to]) => ({ from, to })),
  };
}

function syntheticModel(raw = syntheticExport(), ascendancy = null) {
  return buildAllocationModel(normalizeTree(raw), 'Test', ascendancy);
}

function bruteMinimum(model, mustHaves) {
  const nodes = model.nodes.filter((node) => !model.rootIds.includes(node.id));
  let minimum = Infinity;
  for (let mask = 0; mask < 2 ** nodes.length; mask += 1) {
    const ids = nodes.filter((node, index) => mask & (2 ** index)).map((node) => node.id);
    if (ids.length >= minimum || mustHaves.some((id) => !ids.includes(id))) continue;
    if (!model.validateAllocation(ids).valid) continue;
    const connected = supportDistances(model, new Set(ids));
    if (ids.every((id) => connected.has(id))) minimum = ids.length;
  }
  return minimum;
}

const optimizerData = normalizeTree(freshRaw());
const mainModel = buildAllocationModel(optimizerData, 'Witch', null);
const mainDistances = supportDistances(mainModel);
const mainCandidates = mainModel.nodes.filter((node) => mainDistances.has(node.id) && !mainModel.rootIds.includes(node.id));

function regionTargets(model) {
  const reachable = supportDistances(model);
  const candidates = model.nodes.filter((node) => node.domain === 'passive'
    && reachable.has(node.id) && !model.rootIds.includes(node.id));
  const targets = new Set();
  for (const axis of ['x', 'y']) {
    const ordered = candidates.slice().sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
    targets.add(ordered[0].id);
    targets.add(ordered.at(-1).id);
  }
  assert.ok(targets.size >= 3);
  return [...targets];
}

test('optimizer single real passive matches an independent shortest path', () => {
  const target = mainCandidates.filter((node) => mainDistances.get(node.id) >= 5)
    .sort((a, b) => mainDistances.get(a.id) - mainDistances.get(b.id) || a.id.localeCompare(b.id))[0];
  assert.ok(target);
  assert.equal(mainModel.routeRules.prerequisites[target.id], undefined);
  const result = assertRoute(mainModel, [target.id]);
  assert.equal(result.nodeIds.length, mainDistances.get(target.id));
  assert.deepEqual(findMinimalRoute(mainModel, [target.id, target.id, ...mainModel.rootIds]), result);
});

test('optimizer connects real main-tree passives in different regions deterministically', () => {
  const targets = regionTargets(mainModel);
  const before = JSON.stringify({ nodes: mainModel.nodes, edges: mainModel.edges, roots: mainModel.rootIds, rules: mainModel.routeRules });
  const result = assertRoute(mainModel, targets);
  assert.deepEqual(findMinimalRoute(mainModel, targets), result);
  assert.deepEqual(findMinimalRoute(mainModel, targets.slice().reverse()), result);
  assert.equal(JSON.stringify({ nodes: mainModel.nodes, edges: mainModel.edges, roots: mainModel.rootIds, rules: mainModel.routeRules }), before);
});

test('optimizer connects a real main-tree passive and an ascendancy passive', () => {
  const model = buildAllocationModel(optimizerData, 'Witch', 'Witch1');
  const distances = supportDistances(model);
  const ascendancy = model.nodes.filter((node) => node.domain === 'ascendancy' && distances.get(node.id) >= 2)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  assert.ok(ascendancy);
  assertRoute(model, [regionTargets(model)[0], ascendancy.id]);
});

test('optimizer handles the maximum real-tree must-have count within ten seconds', () => {
  assert.ok(Number.isInteger(MAX_MUST_HAVES));
  assert.ok(MAX_MUST_HAVES >= 8);
  const targets = mainCandidates.slice().sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_MUST_HAVES).map((node) => node.id);
  assert.equal(targets.length, MAX_MUST_HAVES);
  const start = performance.now();
  const result = findMinimalRoute(mainModel, targets);
  const elapsed = performance.now() - start;
  assertRoute(mainModel, targets, result);
  assert.ok(elapsed < 10000, `maximum-size search took ${elapsed}ms`);
});

test('optimizer empty and root-only input returns zero cost', () => {
  const model = syntheticModel(syntheticExport(), 'Test1');
  const expected = { ok: true, nodeIds: [], pointCost: { passive: 0, ascendancy: 0 }, reason: null };
  assert.deepEqual(findMinimalRoute(model, []), expected);
  assert.deepEqual(findMinimalRoute(model, [...model.rootIds, ...model.rootIds]), expected);
});

test('optimizer rejects malformed, unavailable, over-limit, incompatible and unreachable inputs', () => {
  const model = syntheticModel();
  for (const input of [null, {}, '1', [1], ['0', null], ['missing'], ['6', '7'], ['14']]) {
    assertRouteFailure(model, input);
  }
  const tooMany = mainCandidates.slice(0, MAX_MUST_HAVES + 1).map((node) => node.id);
  assert.ok(assertRouteFailure(mainModel, tooMany).reason.includes(String(MAX_MUST_HAVES)));
  assertRouteFailure(null, []);
});

test('optimizer matches exhaustive minima on a branching export with choices and prerequisites', () => {
  const model = syntheticModel();
  for (const targets of [['8'], ['6'], ['6', '9'], ['7', '9'], ['4', '8'], ['8', '9'], ['2', '3', '9']]) {
    const minimum = bruteMinimum(model, targets);
    assert.ok(Number.isFinite(minimum));
    const result = assertRoute(model, targets);
    assert.equal(result.nodeIds.length, minimum, targets.join(', '));
  }
});

test('optimizer counts free nodes and options as nodes, and preserves one-way ascendancy support', () => {
  const model = syntheticModel(syntheticExport(), 'Test1');
  for (const targets of [['13'], ['12', '9'], ['6', '13']]) {
    const result = assertRoute(model, targets);
    assert.equal(result.nodeIds.length, bruteMinimum(model, targets));
  }
  const ascendancy = assertRoute(model, ['13']);
  assert.deepEqual(ascendancy.nodeIds, ['11', '12', '13']);
  assert.deepEqual(ascendancy.pointCost, { passive: 0, ascendancy: 2 });
  const choice = assertRoute(syntheticModel(), ['6']);
  assert.equal(choice.nodeIds.length, 4);
  assert.equal(choice.pointCost.passive, 3);
});

test('optimizer handles requirements and choice conflicts introduced by intermediate route nodes', () => {
  const raw = syntheticExport();
  raw.nodes[2].unlockConstraint = { nodes: [7] };
  const model = syntheticModel(raw);
  for (const targets of [['4'], ['4', '6']]) {
    const result = assertRoute(model, targets);
    assert.equal(result.nodeIds.length, bruteMinimum(model, targets));
  }
  const incompatible = syntheticExport();
  incompatible.nodes[8].unlockConstraint = { nodes: [6, 7] };
  assertRouteFailure(syntheticModel(incompatible), ['8']);
});

test('optimizer searches past a shortest connection with an impossible allocation order', () => {
  const raw = syntheticExport();
  raw.nodes[1].unlockConstraint = { nodes: [2] };
  raw.edges.push({ from: 0, to: 3 }, { from: 3, to: 2 });
  const model = syntheticModel(raw);
  const result = assertRoute(model, ['2']);
  assert.equal(result.nodeIds.length, bruteMinimum(model, ['2']));
  assert.deepEqual(result.nodeIds, ['2', '3']);
});

test('optimizer never uses the Oracle disconnected-allocation shortcut to omit a path', () => {
  const raw = syntheticExport();
  raw.nodes[12].stats = ['Non-Keystone Passive Skills in Medium Radius of allocated Keystone Passive Skills can be allocated without being connected to your tree'];
  raw.nodes[2].isKeystone = true;
  raw.nodes[14].keystonesInRadius = [2];
  const model = syntheticModel(raw, 'Test1');
  assert.equal(model.validateAllocation(['1', '2', '11', '12', '14']).valid, true);
  assertRouteFailure(model, ['14']);
});

test('routing metadata is a frozen snapshot and proof limits fail without a heuristic route', () => {
  const model = syntheticModel();
  assert.ok(Object.isFrozen(model.routeRules));
  assert.ok(Object.isFrozen(model.routeRules.prerequisites));
  assert.ok(Object.isFrozen(model.routeRules.prerequisites['8']));
  assert.ok(Object.isFrozen(model.routeRules.choiceParents));
  assert.ok(Object.isFrozen(model.routeRules.supportEdges));
  assert.ok(model.routeRules.supportEdges.every(Object.isFrozen));
  assertRouteFailure({ ...model, routeRules: undefined }, ['1']);

  const raw = syntheticExport();
  const prerequisites = [];
  for (let id = 20; id < 37; id += 1) {
    raw.nodes[id] = { skill: id, x: id, y: 0, stats: [] };
    raw.edges.push({ from: 0, to: id });
    prerequisites.push(id);
  }
  raw.nodes[8].unlockConstraint = { nodes: prerequisites };
  const limited = assertRouteFailure(syntheticModel(raw), ['8']);
  assert.match(limited.reason, /minimum.*cannot be guaranteed/i);
});

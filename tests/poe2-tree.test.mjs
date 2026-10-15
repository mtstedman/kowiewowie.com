import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAllocationModel, normalizeTree, summarizeRouteBonuses } from '../htdocs/assets/js/path-of-exile-2/tree-data.js';
import { findMinimalRoute } from '../htdocs/assets/js/path-of-exile-2/optimizer.js';
import { calculateInventoryStats, InventoryError, normalizeInventory } from '../htdocs/assets/js/path-of-exile-2/inventory.js';
import { performance } from 'node:perf_hooks';

// The pinned export is the database import source; the page loads it from the API.
const TREE_TEXT = readFileSync(new URL('../database/data/poe2-passive-tree/data.json', import.meta.url), 'utf8');
const TREE_ERROR = { name: 'Error', message: /^PoE2 passive tree:/ };

test('planner imports every module under its content hash so cached modules cannot drift', () => {
  const moduleDir = new URL('../htdocs/assets/js/path-of-exile-2/', import.meta.url);
  const planner = readFileSync(new URL('planner.js', moduleDir), 'utf8');
  const imports = [...planner.matchAll(/^import [^;]+ from '(\.\/[^'?]+)(\?v=[^']*)?';$/gm)];
  assert.deepEqual(imports.map(([, path]) => path).sort(), ['./build-code.js', './builds-api.js', './inventory.js', './optimizer.js', './tree-art.js', './tree-data.js']);
  for (const [, path, query] of imports) {
    const expected = `?v=${createHash('sha256').update(readFileSync(new URL(path, moduleDir))).digest('hex').slice(0, 12)}`;
    assert.equal(query, expected, `planner.js must import ${path}${expected}`);
  }
});

// analyzeRaw caches by object identity, so every case gets its own parse.
const freshRaw = () => JSON.parse(TREE_TEXT);

test('normalizeTree takes version and source only from the caller', () => {
  const unversioned = normalizeTree(freshRaw());
  assert.equal(unversioned.version, null);
  assert.equal(unversioned.source, null);
  const versioned = normalizeTree(freshRaw(), { version: '0.5.5', url: 'https://example.test/data.json', commit: 'abc' });
  assert.equal(versioned.version, '0.5.5');
  assert.deepEqual(versioned.source, { url: 'https://example.test/data.json', commit: 'abc' });
  assert.throws(() => normalizeTree(freshRaw(), { version: '', url: '', commit: '' }), TREE_ERROR);
});

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

test('optimizer solves eight real-tree must-haves exactly within ten seconds', () => {
  const targets = mainCandidates.slice().sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 8).map((node) => node.id);
  assert.equal(targets.length, 8);
  const start = performance.now();
  const result = findMinimalRoute(mainModel, targets);
  const elapsed = performance.now() - start;
  assertRoute(mainModel, targets, result);
  assert.equal(result.exact, true);
  assert.ok(elapsed < 10000, `eight-target search took ${elapsed}ms`);
});

test('optimizer empty and root-only input returns zero cost', () => {
  const model = syntheticModel(syntheticExport(), 'Test1');
  const expected = { ok: true, nodeIds: [], pointCost: { passive: 0, ascendancy: 0 }, reason: null };
  assert.deepEqual(findMinimalRoute(model, []), expected);
  assert.deepEqual(findMinimalRoute(model, [...model.rootIds, ...model.rootIds]), expected);
});

test('optimizer rejects malformed, unavailable, incompatible and unreachable inputs', () => {
  const model = syntheticModel();
  for (const input of [null, {}, '1', [1], ['0', null], ['missing'], ['6', '7'], ['14']]) {
    assertRouteFailure(model, input);
  }
  assertRouteFailure(null, []);
});

test('optimizer routes a large real-tree must-have set within ten seconds', () => {
  const rules = mainModel.routeRules;
  // Plain passives only, so the targets are mutually compatible.
  const targets = mainCandidates
    .filter((node) => rules.choiceParents[node.id] === undefined && rules.prerequisites[node.id] === undefined)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 24).map((node) => node.id);
  assert.equal(targets.length, 24);
  const start = performance.now();
  const result = findMinimalRoute(mainModel, targets);
  const elapsed = performance.now() - start;
  assertRoute(mainModel, targets, result);
  assert.equal(typeof result.exact, 'boolean');
  assert.ok(elapsed < 10000, `large-set search took ${elapsed}ms`);
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

test('routing metadata is a frozen snapshot and oversized forced sets take a disclosed fallback route', () => {
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
  const result = assertRoute(syntheticModel(raw), ['8']);
  for (const id of ['8', ...prerequisites.map(String)]) {
    assert.ok(result.nodeIds.includes(id), `missing ${id}`);
  }
  assert.equal(result.exact, false);
});

// ---- Route bonus summary -------------------------------------------------

const EMPTY_SUMMARY = { totals: [], unsummed: [], keystones: [], notables: [] };
const BONUS_NUMBER = /(?<![\w.])[+-]?\d+(?:\.\d+)?(?![\d.])/g;
const bonusNumbers = (line) => line.match(BONUS_NUMBER) || [];
const bonusWording = (line) => line.replace(BONUS_NUMBER, (match) => (/^[+-]/.test(match) ? '±#' : '#'));
const statLines = (node) => node.stats.flatMap((stat) => stat.split(/\r?\n/)).filter((line) => line.trim() !== '');

// Independent check that every allocated line is represented: single-number
// lines by a total of the same wording whose value is the sum, the rest
// verbatim with their exact occurrence count.
function assertLinesAccounted(summary, nodes) {
  const sums = new Map();
  const verbatim = new Map();
  for (const node of nodes) {
    for (const line of statLines(node)) {
      const numbers = bonusNumbers(line);
      if (numbers.length === 1) {
        const key = bonusWording(line);
        sums.set(key, (sums.get(key) || 0) + Number(numbers[0]));
      } else {
        verbatim.set(line, (verbatim.get(line) || 0) + 1);
      }
    }
  }
  assert.equal(summary.totals.length, sums.size);
  for (const total of summary.totals) {
    const key = bonusWording(total);
    assert.ok(sums.has(key), `unexpected total ${total}`);
    const [number] = bonusNumbers(total);
    assert.ok(Math.abs(Number(number) - sums.get(key)) < 1e-9, `${total} should total ${sums.get(key)}`);
  }
  assert.deepEqual(
    summary.unsummed.slice().sort((a, b) => (a.text < b.text ? -1 : 1)),
    Array.from(verbatim, ([text, count]) => ({ text, count })).sort((a, b) => (a.text < b.text ? -1 : 1)),
  );
}

const namedOf = (nodes, kind) => nodes.filter((node) => node.kind === kind)
  .map((node) => ({ id: node.id, name: node.name }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));

function formatSum(line, times) {
  const [number] = bonusNumbers(line);
  const index = line.search(BONUS_NUMBER);
  const decimals = number.includes('.') ? number.length - number.indexOf('.') - 1 : 0;
  const total = Number((Number(number) * times).toFixed(decimals)) + 0;
  const signed = /^[+-]/.test(number);
  return `${line.slice(0, index)}${signed && total >= 0 ? '+' : ''}${total}${line.slice(index + number.length)}`;
}

const bonusData = normalizeTree(freshRaw());
const bonusClassIds = bonusData.classes.slice(0, 2).map((option) => option.id);

test('route bonus summary covers at least two real classes', () => {
  assert.equal(bonusClassIds.length, 2);
  assert.notEqual(bonusClassIds[0], bonusClassIds[1]);
});

for (const classId of bonusClassIds) {
  test(`route bonus summary: ${classId} empty route returns four empty arrays`, () => {
    const model = buildAllocationModel(bonusData, classId, null);
    assert.deepEqual(summarizeRouteBonuses(model, []), EMPTY_SUMMARY);
  });

  test(`route bonus summary: ${classId} sums repeated real single-number stats`, () => {
    const model = buildAllocationModel(bonusData, classId, null);
    const groups = new Map();
    for (const node of model.nodes) {
      if (node.kind !== 'small' || model.rootIds.includes(node.id)) continue;
      const lines = statLines(node);
      if (lines.length !== 1 || bonusNumbers(lines[0]).length !== 1) continue;
      if (!groups.has(lines[0])) groups.set(lines[0], []);
      groups.get(lines[0]).push(node.id);
    }
    const [line, ids] = Array.from(groups).filter(([, members]) => members.length >= 3)
      .sort(([a], [b]) => (a < b ? -1 : 1))[0] || [];
    assert.ok(line, `${classId} has a single-number stat repeated on three small passives`);
    const chosen = ids.slice().sort().slice(0, 3);
    const summary = summarizeRouteBonuses(model, chosen);
    assert.deepEqual(summary, { totals: [formatSum(line, 3)], unsummed: [], keystones: [], notables: [] });
  });

  test(`route bonus summary: ${classId} real route with a keystone and a notable includes travel nodes`, () => {
    const model = buildAllocationModel(bonusData, classId, null);
    const distances = supportDistances(model);
    const pick = (kind, minimum) => model.nodes
      .filter((node) => node.kind === kind && node.domain === 'passive' && distances.get(node.id) >= minimum
        && model.routeRules.prerequisites[node.id] === undefined && model.routeRules.choiceParents[node.id] === undefined)
      .sort((a, b) => distances.get(a.id) - distances.get(b.id) || (a.id < b.id ? -1 : 1))[0];
    const keystone = pick('keystone', 1);
    const notable = pick('notable', 2);
    assert.ok(keystone && notable, `${classId} has a reachable keystone and notable`);
    const route = assertRoute(model, [keystone.id, notable.id]);
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    const allocated = route.nodeIds.map((id) => byId.get(id));
    const travel = allocated.filter((node) => node.kind === 'small' && statLines(node).length > 0);
    assert.ok(travel.length > 0, 'route has travel passives with stats');

    const summary = summarizeRouteBonuses(model, route.nodeIds);
    assert.ok(summary.keystones.some((entry) => entry.id === keystone.id && entry.name === keystone.name));
    assert.ok(summary.notables.some((entry) => entry.id === notable.id && entry.name === notable.name));
    assert.deepEqual(summary.keystones, namedOf(allocated, 'keystone'));
    assert.deepEqual(summary.notables, namedOf(allocated, 'notable'));
    assertLinesAccounted(summary, allocated);

    // Removing the travel nodes must change the totals: their stats are counted.
    const travelIds = new Set(travel.map((node) => node.id));
    const withoutTravel = summarizeRouteBonuses(model, route.nodeIds.filter((id) => !travelIds.has(id)));
    assert.notDeepEqual({ totals: withoutTravel.totals, unsummed: withoutTravel.unsummed },
      { totals: summary.totals, unsummed: summary.unsummed });
    assert.deepEqual(summarizeRouteBonuses(model, route.nodeIds.slice().reverse()), summary);
  });
}

test('route bonus summary uses real resolved override stats and names', () => {
  const baseById = new Map(bonusData.nodes.map((node) => [node.id, node]));
  let checked = 0;
  for (const { classId, ascendancyId, model } of allModels(bonusData)) {
    const node = model.nodes.find((candidate) => !model.rootIds.includes(candidate.id)
      && candidate.stats.length > 0
      && JSON.stringify(candidate.stats) !== JSON.stringify(baseById.get(candidate.id).stats));
    if (!node) continue;
    checked += 1;
    const label = `${classId} / ${ascendancyId} node ${node.id}`;
    const summary = summarizeRouteBonuses(model, [node.id]);
    assertLinesAccounted(summary, [node]);
    const named = node.kind === 'keystone' ? summary.keystones : node.kind === 'notable' ? summary.notables : [];
    if (node.kind === 'keystone' || node.kind === 'notable') assert.deepEqual(named, [{ id: node.id, name: node.name }], label);
    const resolved = new Set(statLines(node));
    for (const line of statLines(baseById.get(node.id))) {
      if (resolved.has(line)) continue;
      assert.ok(!summary.unsummed.some((entry) => entry.text === line), `${label}: base line ${line} leaked`);
    }
  }
  assert.ok(checked > 0, 'the installed export resolves at least one override');
});

function bonusExport() {
  const raw = syntheticExport();
  raw.nodes[1].stats = ['+10 to Strength', '8% increased Attack Speed', 'Adds 1 to 5 Fire Damage'];
  raw.nodes[2].stats = ['+10 to Strength', '12% increased Attack Speed', 'Cannot be Stunned'];
  raw.nodes[2].name = 'Zeta Notable';
  raw.nodes[2].isNotable = true;
  raw.nodes[3].stats = ['+10 to Strength', '-4% to Fire Resistance', '+1.5% to Fire Resistance',
    'Adds 1 to 5 Fire Damage', '10% reduced Attack Speed'];
  raw.nodes[3].name = 'Alpha Notable';
  raw.nodes[3].isNotable = true;
  raw.nodes[4].stats = ['+5 to Dexterity', '0.2% of Damage Leeched as Life', 'Cannot be Stunned'];
  raw.nodes[4].name = 'Keystone Four';
  raw.nodes[4].isKeystone = true;
  return raw;
}

test('route bonus summary sums matching wording, keeps fallbacks and orders attributes first', () => {
  const model = syntheticModel(bonusExport());
  const input = Object.freeze(['4', '2', '1', '3', '2', '4', '1']);
  const before = JSON.stringify(model.nodes);
  const summary = summarizeRouteBonuses(model, input);
  assert.deepEqual(summary, {
    totals: [
      '+5 to Dexterity',
      '+30 to Strength',
      '10% increased Attack Speed',
      '0.2% of Damage Leeched as Life',
      '-2.5% to Fire Resistance',
    ],
    unsummed: [
      { text: 'Adds 1 to 5 Fire Damage', count: 2 },
      { text: 'Cannot be Stunned', count: 2 },
    ],
    keystones: [{ id: '4', name: 'Keystone Four' }],
    notables: [{ id: '3', name: 'Alpha Notable' }, { id: '2', name: 'Zeta Notable' }],
  });
  assert.deepEqual(input, ['4', '2', '1', '3', '2', '4', '1']);
  assert.equal(JSON.stringify(model.nodes), before);
  assert.deepEqual(summarizeRouteBonuses(model, ['1', '2', '3', '4']), summary);
  assert.deepEqual(summarizeRouteBonuses(model, input), summary);
});

test('route bonus summary nets opposite wordings: increased/reduced and faster/slower add, more/less multiply', () => {
  const raw = syntheticExport();
  raw.nodes[1].stats = ['4% [FasterESRechargeStart|faster start of Energy Shield Recharge]', '10% increased Mana Regeneration Rate',
    '20% more Damage', '15% more Armour', '10% reduced Skill Effect Duration'];
  raw.nodes[2].stats = ['6% [FasterESRechargeStart|faster start of Energy Shield Recharge]', '25% reduced Mana Regeneration Rate',
    '10% less Damage', '15% less Armour', '10% increased Skill Effect Duration'];
  raw.nodes[3].stats = ['20% [FasterESRechargeStart|slower start of Energy Shield Recharge]',
    '10% increased Damage against Enemies with less Life'];
  const summary = summarizeRouteBonuses(syntheticModel(raw), ['1', '2', '3']);
  // Only the word right after the number sets direction: "with less Life" stays wording.
  assert.deepEqual(summary.totals, [
    '10% [FasterESRechargeStart|slower start of Energy Shield Recharge]',
    '10% increased Damage against Enemies with less Life',
    '0% increased Skill Effect Duration',
    '2.25% less Armour',
    '8% more Damage',
    '15% reduced Mana Regeneration Rate',
  ]);
  // The net flips back to the positive wording once it is ahead.
  assert.deepEqual(summarizeRouteBonuses(syntheticModel(raw), ['1', '2']).totals.filter((line) => /Recharge/.test(line)),
    ['10% [FasterESRechargeStart|faster start of Energy Shield Recharge]']);
});

test('route bonus summary resolves class and ascendancy overrides from the model', () => {
  const raw = bonusExport();
  raw.skillOverrides = {
    100: { name: 'Class Override', stats: ['+7 to Dexterity', 'Class Only Effect'] },
    101: { name: 'Ascendancy Override', stats: ['+3 to Intelligence'] },
  };
  raw.classes[0].overridePairs = { 1: 100 };
  raw.classes[0].ascendancies[0].overridePairs = { 1: 101 };
  raw.nodes[1].isNotable = true;
  const classModel = syntheticModel(raw);
  assert.deepEqual(summarizeRouteBonuses(classModel, ['1']), {
    totals: ['+7 to Dexterity'],
    unsummed: [{ text: 'Class Only Effect', count: 1 }],
    keystones: [],
    notables: [{ id: '1', name: 'Class Override' }],
  });
  const ascendancyModel = syntheticModel(raw, 'Test1');
  assert.deepEqual(summarizeRouteBonuses(ascendancyModel, ['1', '1']), {
    totals: ['+3 to Intelligence'],
    unsummed: [],
    keystones: [],
    notables: [{ id: '1', name: 'Ascendancy Override' }],
  });
});

test('route bonus summary includes free allocated passives and rejects unknown input', () => {
  const raw = syntheticExport();
  raw.nodes[11].stats = ['+4 to Intelligence'];
  raw.nodes[12].stats = ['+4 to Intelligence'];
  const model = syntheticModel(raw, 'Test1');
  assert.deepEqual(summarizeRouteBonuses(model, ['11', '12']).totals, ['+8 to Intelligence']);
  assert.throws(() => summarizeRouteBonuses(model, ['missing']), TREE_ERROR);
  assert.throws(() => summarizeRouteBonuses(model, null), TypeError);
  assert.throws(() => summarizeRouteBonuses(model, [1]), TypeError);
});

// ---- Inventory normalization and equipment estimates --------------------

const INVENTORY_SLOTS = [
  'main_hand', 'off_hand', 'helmet', 'body_armour', 'gloves',
  'boots', 'belt', 'amulet', 'ring_1', 'ring_2',
];

const inventoryItem = (slot, overrides = {}) => ({
  slot,
  name: '',
  equipped: true,
  armour: 0,
  evasion: 0,
  energy_shield: 0,
  weapon: null,
  ...overrides,
});

const weaponItem = (overrides = {}) => inventoryItem('main_hand', {
  name: 'Test weapon',
  weapon: { physical_min: 100, physical_max: 200, attacks_per_second: 2 },
  ...overrides,
});

const metricsByKey = (comparison) => Object.fromEntries(comparison.metrics.map((metric) => [metric.key, metric]));
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('inventory normalization accepts every slot, trims names, copies values, and defaults undefined', () => {
  assert.deepEqual(normalizeInventory(undefined), []);
  const input = INVENTORY_SLOTS.map((slot, index) => inventoryItem(slot, {
    name: index === 0 ? '  Wand 🪄  ' : '',
    equipped: index % 2 === 0,
    armour: index,
    evasion: index + 1,
    energy_shield: index + 2,
    weapon: slot === 'main_hand' ? { physical_min: 10, physical_max: 20, attacks_per_second: 1.25 } : null,
  }));
  const before = JSON.stringify(input);
  const normalized = normalizeInventory(input);
  assert.equal(normalized.length, 10);
  assert.deepEqual(normalized.map((item) => item.slot), INVENTORY_SLOTS);
  assert.equal(normalized[0].name, 'Wand 🪄');
  assert.notEqual(normalized, input);
  assert.notEqual(normalized[0], input[0]);
  assert.notEqual(normalized[0].weapon, input[0].weapon);
  assert.equal(JSON.stringify(input), before);
});

test('inventory normalization rejects malformed containers, duplicate slots, missing fields, and unknown fields', () => {
  for (const value of [null, {}, 'inventory', 4, true]) {
    assert.throws(() => normalizeInventory(value), InventoryError);
  }
  assert.throws(() => normalizeInventory(Array(11).fill(null)), InventoryError);
  assert.throws(() => normalizeInventory([inventoryItem('helmet'), inventoryItem('helmet')]), InventoryError);
  assert.throws(() => normalizeInventory([[]]), InventoryError);

  const fields = ['slot', 'name', 'equipped', 'armour', 'evasion', 'energy_shield', 'weapon'];
  for (const field of fields) {
    const item = inventoryItem('helmet');
    delete item[field];
    assert.throws(() => normalizeInventory([item]), InventoryError, `missing ${field}`);
  }
  assert.throws(() => normalizeInventory([{ ...inventoryItem('helmet'), rarity: 'rare' }]), InventoryError);
  assert.throws(() => normalizeInventory([inventoryItem('helmet', { slot: 'hat' })]), InventoryError);
});

test('inventory normalization rejects invalid text, booleans, and bounded numeric fields', () => {
  assert.doesNotThrow(() => normalizeInventory([inventoryItem('helmet', { name: '😀'.repeat(80) })]));
  for (const name of ['😀'.repeat(81), 'bad\u0000name', 12]) {
    assert.throws(() => normalizeInventory([inventoryItem('helmet', { name })]), InventoryError);
  }
  assert.throws(() => normalizeInventory([inventoryItem('helmet', { equipped: 1 })]), InventoryError);
  for (const field of ['armour', 'evasion', 'energy_shield']) {
    for (const value of ['1', NaN, Infinity, -1, 1_000_001, 1.5]) {
      assert.throws(() => normalizeInventory([inventoryItem('helmet', { [field]: value })]), InventoryError,
        `${field} ${String(value)}`);
    }
  }
});

test('inventory normalization validates weapon shape, ordering, placement, and attack speed', () => {
  assert.deepEqual(normalizeInventory([weaponItem()])[0].weapon,
    { physical_min: 100, physical_max: 200, attacks_per_second: 2 });
  assert.throws(() => normalizeInventory([inventoryItem('off_hand', {
    weapon: { physical_min: 1, physical_max: 2, attacks_per_second: 1 },
  })]), InventoryError);
  assert.throws(() => normalizeInventory([weaponItem({
    weapon: { physical_min: 201, physical_max: 200, attacks_per_second: 1 },
  })]), InventoryError);

  for (const field of ['physical_min', 'physical_max', 'attacks_per_second']) {
    const missing = { physical_min: 1, physical_max: 2, attacks_per_second: 1 };
    delete missing[field];
    assert.throws(() => normalizeInventory([weaponItem({ weapon: missing })]), InventoryError, `missing ${field}`);
  }
  assert.throws(() => normalizeInventory([weaponItem({
    weapon: { physical_min: 1, physical_max: 2, attacks_per_second: 1, elemental_min: 4 },
  })]), InventoryError);
  for (const value of ['2', NaN, Infinity, -1, 0, 101]) {
    assert.throws(() => normalizeInventory([weaponItem({
      weapon: { physical_min: 1, physical_max: 2, attacks_per_second: value },
    })]), InventoryError, `attacks_per_second ${String(value)}`);
  }
  for (const field of ['physical_min', 'physical_max']) {
    for (const value of ['1', NaN, Infinity, -1, 1_000_001, 1.5]) {
      const weapon = { physical_min: 1, physical_max: 2, attacks_per_second: 1 };
      weapon[field] = value;
      assert.throws(() => normalizeInventory([weaponItem({ weapon })]), InventoryError, `${field} ${String(value)}`);
    }
  }
});

test('inventory estimate uses equipped defenses and only the equipped main-hand weapon', () => {
  const inventory = normalizeInventory([
    weaponItem({ armour: 10 }),
    inventoryItem('helmet', { armour: 90, evasion: 50, energy_shield: 25 }),
    inventoryItem('body_armour', { equipped: false, armour: 900, evasion: 900, energy_shield: 900 }),
  ]);
  const result = calculateInventoryStats(inventory, [], []);
  assert.deepEqual(result, {
    metrics: [
      { key: 'armour', baseline: 100, total: 100, delta: 0 },
      { key: 'evasion', baseline: 50, total: 50, delta: 0 },
      { key: 'energy_shield', baseline: 25, total: 25, delta: 0 },
      { key: 'physical_min', baseline: 100, total: 100, delta: 0 },
      { key: 'physical_max', baseline: 200, total: 200, delta: 0 },
      { key: 'attacks_per_second', baseline: 2, total: 2, delta: 0 },
      { key: 'physical_dps', baseline: 300, total: 300, delta: 0 },
    ],
    applied: [],
    unsupported: [],
  });

  const absent = calculateInventoryStats(normalizeInventory([
    weaponItem({ equipped: false }), inventoryItem('helmet'),
  ]), [], []);
  assert.deepEqual(absent.metrics.slice(3), [
    { key: 'physical_min', baseline: null, total: null, delta: null },
    { key: 'physical_max', baseline: null, total: null, delta: null },
    { key: 'attacks_per_second', baseline: null, total: null, delta: null },
    { key: 'physical_dps', baseline: null, total: null, delta: null },
  ]);
  assert.deepEqual(calculateInventoryStats([], [], []).metrics.slice(0, 3).map((metric) => metric.total), [0, 0, 0]);
});

test('pinned Armour and Physical Damage wording produces the documented estimates', () => {
  const armourNode = bonusData.nodes.find((node) => node.stats.includes('20% increased [Armour]'));
  const physicalNode = bonusData.nodes.find((node) => node.stats.includes('12% increased [Physical] Damage'));
  assert.ok(armourNode, 'pinned export contains 20% increased Armour');
  assert.ok(physicalNode, 'pinned export contains 12% increased Physical Damage');
  const inventory = normalizeInventory([
    weaponItem(),
    inventoryItem('body_armour', { armour: 1000 }),
  ]);
  const result = calculateInventoryStats(inventory, [armourNode, physicalNode], [armourNode.id, physicalNode.id]);
  const metrics = metricsByKey(result);
  assert.equal(metrics.armour.total, 1200);
  assert.equal(metrics.physical_min.total, 112);
  assert.equal(metrics.physical_max.total, 224);
  assert.equal(metrics.physical_dps.total, 336);
  assert.deepEqual(result.unsupported, [{
    node_id: physicalNode.id,
    node_name: physicalNode.name,
    text: '12% increased [Lightning] Damage',
  }]);
});

test('each supported target applies increased, reduced, more, and less without intermediate rounding', () => {
  const cases = [
    ['Armour', ['armour']],
    ['Evasion', ['evasion']],
    ['Evasion Rating', ['evasion']],
    ['maximum Energy Shield', ['energy_shield']],
    ['Physical Damage', ['physical_min', 'physical_max']],
    ['Attack Speed', ['attacks_per_second']],
    ['Armour, Evasion and Energy Shield', ['armour', 'evasion', 'energy_shield']],
  ];
  const operations = { increased: 1.2, reduced: 0.8, more: 1.2, less: 0.8 };
  const inventory = normalizeInventory([
    weaponItem(), inventoryItem('body_armour', { armour: 100, evasion: 100, energy_shield: 100 }),
  ]);
  for (const [target, keys] of cases) {
    for (const [operation, factor] of Object.entries(operations)) {
      const node = { id: `${target}-${operation}`, name: 'Template', stats: [`20% ${operation} ${target}`], kind: 'small' };
      const result = calculateInventoryStats(inventory, [node], [node.id, node.id]);
      const metrics = metricsByKey(result);
      for (const key of keys) closeTo(metrics[key].total, metrics[key].baseline * factor);
      assert.deepEqual(result.applied, [{ node_id: node.id, node_name: 'Template', text: node.stats[0] }]);
      assert.deepEqual(result.unsupported, []);
    }
  }

  const stacked = [
    { id: 'a', name: 'A', stats: ['20% increased Armour', '50% more Armour'], kind: 'small' },
    { id: 'b', name: 'B', stats: ['10% reduced Armour', '20% less Armour'], kind: 'small' },
  ];
  const total = metricsByKey(calculateInventoryStats(inventory, stacked, ['a', 'b'])).armour.total;
  closeTo(total, 132);
  const preciseWeapon = normalizeInventory([weaponItem({
    weapon: { physical_min: 1, physical_max: 2, attacks_per_second: 1.234 },
  })]);
  const speed = { id: 'speed', name: 'Speed', stats: ['10% increased Attack Speed'], kind: 'small' };
  const preciseAps = metricsByKey(calculateInventoryStats(preciseWeapon, [speed], ['speed'])).attacks_per_second.total;
  closeTo(preciseAps, 1.3574);
  assert.notEqual(preciseAps, Number(preciseAps.toFixed(2)));
  assert.equal(metricsByKey(calculateInventoryStats([], stacked, ['a', 'b'])).armour.total, 0);
});


test('equal increased and reduced inventory modifiers cancel to the equipment baseline', () => {
  const inventory = normalizeInventory([
    inventoryItem('body_armour', { armour: 100 }),
  ]);
  const nodes = [
    { id: 'increase', name: 'Increase', stats: ['20% increased Armour'], kind: 'small' },
    { id: 'reduce', name: 'Reduce', stats: ['20% reduced Armour'], kind: 'small' },
  ];
  const armour = metricsByKey(calculateInventoryStats(inventory, nodes, ['increase', 'reduce'])).armour;
  assert.deepEqual(armour, { key: 'armour', baseline: 100, total: 100, delta: 0 });
});

test('inventory estimate strips GGG markup and keeps unsupported mechanics with provenance', () => {
  const nodes = [
    { id: 'travel', name: 'Travel', stats: ['10% increased [Armour], [Evasion] and [EnergyShield|Energy Shield]'], kind: 'small' },
    { id: 'conditional', name: 'Conditional', stats: ['20% increased Armour while Stationary'], kind: 'notable' },
    { id: 'weapon', name: 'Bow node', stats: ['20% increased Physical Damage with Bows'], kind: 'small' },
    { id: 'local', name: 'Local', stats: ['50% more Armour from Equipped Body Armour'], kind: 'notable' },
    { id: 'conversion', name: 'Conversion', stats: ['Convert 20% of Evasion Rating to Armour'], kind: 'notable' },
    { id: 'keystone', name: 'Keystone', stats: ['100% more Armour'], kind: 'keystone' },
    { id: 'unallocated', name: 'Selected only', stats: ['100% more Armour'], kind: 'small' },
  ];
  const allocated = nodes.slice(0, -1).map((node) => node.id);
  const result = calculateInventoryStats(
    normalizeInventory([inventoryItem('body_armour', { armour: 100, evasion: 100, energy_shield: 100 })]),
    nodes,
    allocated,
  );
  assert.deepEqual(result.metrics.slice(0, 3).map((metric) => metric.total), [110, 110, 110]);
  assert.deepEqual(result.applied, [{
    node_id: 'travel',
    node_name: 'Travel',
    text: '10% increased [Armour], [Evasion] and [EnergyShield|Energy Shield]',
  }]);
  assert.deepEqual(result.unsupported, nodes.slice(1, -1).map((node) => ({
    node_id: node.id, node_name: node.name, text: node.stats[0],
  })));
});

test('inventory estimate uses resolved class and ascendancy stats and does not mutate inputs', () => {
  const raw = syntheticExport();
  raw.nodes[1].stats = ['10% increased Armour'];
  raw.skillOverrides = {
    100: { name: 'Class armour', stats: ['20% increased Armour'] },
    101: { name: 'Ascendancy armour', stats: ['30% increased Armour'] },
  };
  raw.classes[0].overridePairs = { 1: 100 };
  raw.classes[0].ascendancies[0].overridePairs = { 1: 101 };
  const classModel = syntheticModel(raw);
  const ascendancyModel = syntheticModel(raw, 'Test1');
  const inventory = normalizeInventory([inventoryItem('body_armour', { armour: 100 })]);
  const before = JSON.stringify({ inventory, classNodes: classModel.nodes, ascendancyNodes: ascendancyModel.nodes });
  assert.equal(metricsByKey(calculateInventoryStats(inventory, classModel.nodes, ['1'])).armour.total, 120);
  assert.equal(metricsByKey(calculateInventoryStats(inventory, ascendancyModel.nodes, ['1'])).armour.total, 130);
  assert.equal(JSON.stringify({ inventory, classNodes: classModel.nodes, ascendancyNodes: ascendancyModel.nodes }), before);
});

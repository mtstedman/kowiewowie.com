import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAllocationModel, normalizeTree, summarizeRouteBonuses } from '../htdocs/assets/js/path-of-exile-2/tree-data.js';
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
      '20% increased Attack Speed',
      '0.2% of Damage Leeched as Life',
      '10% reduced Attack Speed',
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

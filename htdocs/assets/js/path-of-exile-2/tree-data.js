/**
 * Path of Exile 2 passive-tree model (shared contract `poe2-tree-model`).
 *
 * Consumes the pinned official export installed at
 * /assets/data/path-of-exile-2/tree.json without modifying it. Provenance,
 * the evidence behind every exclusion and the allocation-rule semantics
 * implemented here are recorded in
 * htdocs/assets/data/path-of-exile-2/SOURCE.md — keep the two in step.
 *
 * Exports (and nothing else):
 *   loadTree(url?)                                  -> Promise<TreeData>
 *   normalizeTree(raw)                              -> TreeData
 *   buildAllocationModel(data, classId, ascendancyId) -> AllocationModel
 *
 * @typedef {{id: string, name: string, ascendancies: {id: string, name: string}[]}} ClassOption
 * @typedef {{id: string, name: string, stats: string[], x: number, y: number, kind: string,
 *   domain: 'passive'|'ascendancy', ascendancyId: string|null}} PassiveNode
 * @typedef {{version: string, source: {url: string, commit: string}, classes: ClassOption[],
 *   nodes: PassiveNode[], edges: [string, string][], skippedOverridePairs: number,
 *   raw: Record<string, unknown>}} TreeData
 * @typedef {Readonly<{prerequisites: Readonly<Record<string, readonly string[]>>,
 *   choiceParents: Readonly<Record<string, string>>,
 *   supportEdges: readonly (readonly string[])[]}>} RouteRules
 * @typedef {{nodes: PassiveNode[], edges: [string, string][], rootIds: string[],
 *   routeRules: RouteRules,
 *   canAllocate(allocatedNodeIds: string[], nodeId: string): boolean,
 *   availableNodeIds(allocatedNodeIds: string[]): Set<string>,
 *   validateAllocation(allocatedNodeIds: string[]): {valid: boolean, reason: string|null},
 *   pointCost(allocatedNodeIds: string[]): {passive: number, ascendancy: number}}} AllocationModel
 *
 * PassiveNode.kind is one of: 'classStart', 'ascendancyStart', 'keystone',
 * 'notable', 'jewelSocket', 'small', 'mastery' (image-only cluster art, never
 * allocatable) or 'placeholder' (unreleased node exported with `"id": null`).
 */

// The export carries no version field of its own, so the pinned identity lives
// here and must be updated together with tree.json (see SOURCE.md, "Refresh").
const PINNED_SOURCE = Object.freeze({
  version: '0.5.5',
  url: 'https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36/data.json',
  commit: 'bd87e6512c92b868542eddfb1ba4ea8b6dc2da36',
});

const DEFAULT_TREE_URL = '/assets/data/path-of-exile-2/tree.json';

// Synthetic hub that joins the six class starts. It has no skill hash and no
// coordinates, so it is never a PassiveNode and never traversable.
const ROOT_KEY = 'root';

const NODE_KEY_PATTERN = /^(?:0|[1-9][0-9]*)$/;

// Stat text of the ascendancy notable that lets nodes be allocated without a
// connecting path (Oracle's "Entwined Realities" in the pinned export). The
// affected nodes are listed by the export itself in `keystonesInRadius`.
const DISCONNECTED_ALLOCATION_PATTERN =
  /Passive Skills in \S+ Radius of allocated Keystone Passive Skills can be allocated without being connected to your tree/i;

const STEP_OK = 0;
const STEP_NEEDS_PREREQUISITE = 1;
const STEP_NEEDS_CHOICE_PARENT = 2;
const STEP_NOT_CONNECTED = 3;

/** raw export object -> derived, validated analysis (never structured-cloned). */
const analysisCache = new WeakMap();

function fail(message) {
  throw new Error(`PoE2 passive tree: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function describe(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return String(value);
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch (error) {
    return String(value);
  }
}

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function readStringList(value, context) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${context} must be an array of strings.`);
  for (const entry of value) {
    if (typeof entry !== 'string') fail(`${context} contains a non-string entry ${describe(entry)}.`);
  }
  return value.slice();
}

function nodeKind(rawNode) {
  if (rawNode.id === null) return 'placeholder';
  if (Array.isArray(rawNode.classStartIndex) && rawNode.classStartIndex.length > 0) return 'classStart';
  if (rawNode.isAscendancyStart === true) return 'ascendancyStart';
  if (rawNode.isMastery === true) return 'mastery';
  if (rawNode.isKeystone === true) return 'keystone';
  if (rawNode.isJewelSocket === true) return 'jewelSocket';
  if (rawNode.isNotable === true) return 'notable';
  return 'small';
}

/**
 * Validate the raw export and derive everything the public API needs. The
 * result is cached per raw object; a structured-cloned TreeData simply pays
 * for the analysis once more in its new realm.
 */
function analyzeRaw(raw) {
  if (!isRecord(raw)) fail('the export must be a JSON object.');
  const cached = analysisCache.get(raw);
  if (cached) return cached;

  const rawNodes = raw.nodes;
  if (!isRecord(rawNodes)) fail('"nodes" must be an object keyed by node ID.');
  if (!Array.isArray(raw.edges)) fail('"edges" must be an array.');
  if (!Array.isArray(raw.classes)) fail('"classes" must be an array.');
  const skillOverrides = raw.skillOverrides === undefined || raw.skillOverrides === null ? {} : raw.skillOverrides;
  if (!isRecord(skillOverrides)) fail('"skillOverrides" must be an object keyed by override ID.');

  const nodeRef = (value, context) => {
    let id = null;
    if (typeof value === 'string') id = value;
    else if (Number.isInteger(value)) id = String(value);
    if (id === null || !hasOwn(rawNodes, id)) fail(`${context} references missing node ${describe(value)}.`);
    return id;
  };

  // ---- Nodes: identity, coordinates, names and stats -----------------------
  /** @type {PassiveNode[]} */
  const nodes = [];
  const nodeById = new Map();
  const startByClassIndex = new Map();
  const ascendancyStartById = new Map();
  const ascendanciesWithNodes = new Set();

  for (const [key, rawNode] of Object.entries(rawNodes)) {
    if (!isRecord(rawNode)) fail(`node ${describe(key)} must be an object.`);
    if (key === ROOT_KEY) continue;
    if (!NODE_KEY_PATTERN.test(key)) {
      fail(`malformed node ID ${describe(key)}; expected a non-negative integer skill hash.`);
    }
    if (rawNode.skill === undefined || rawNode.skill === null) {
      fail(`node ${key} is missing its "skill" ID; every non-root node must carry "skill" equal to its key.`);
    }
    if ((typeof rawNode.skill !== 'number' && typeof rawNode.skill !== 'string') || String(rawNode.skill) !== key) {
      fail(`node ${key} has a mismatched "skill" ID ${describe(rawNode.skill)}; expected ${key}.`);
    }
    const { x, y } = rawNode;
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      fail(`node ${key} has malformed coordinates (x=${describe(x)}, y=${describe(y)}).`);
    }
    let name = '';
    if (typeof rawNode.name === 'string') name = rawNode.name;
    else if (rawNode.name !== undefined && rawNode.name !== null) {
      fail(`node ${key} has a malformed name ${describe(rawNode.name)}.`);
    }
    let ascendancyId = null;
    if (typeof rawNode.ascendancyId === 'string') {
      if (rawNode.ascendancyId !== '') ascendancyId = rawNode.ascendancyId;
    } else if (rawNode.ascendancyId !== undefined && rawNode.ascendancyId !== null) {
      fail(`node ${key} has a malformed ascendancyId ${describe(rawNode.ascendancyId)}.`);
    }
    const kind = nodeKind(rawNode);
    const node = {
      id: key,
      name,
      stats: readStringList(rawNode.stats, `node ${key} "stats"`),
      x,
      y,
      kind,
      domain: /** @type {PassiveNode['domain']} */ (ascendancyId === null ? 'passive' : 'ascendancy'),
      ascendancyId,
    };
    nodes.push(node);
    nodeById.set(key, node);

    if (rawNode.classStartIndex !== undefined && rawNode.classStartIndex !== null) {
      if (!Array.isArray(rawNode.classStartIndex)) fail(`node ${key} "classStartIndex" must be an array.`);
      for (const classIndex of rawNode.classStartIndex) {
        if (!Number.isInteger(classIndex) || classIndex < 0 || classIndex >= raw.classes.length) {
          fail(`node ${key} "classStartIndex" ${describe(classIndex)} does not reference a class.`);
        }
        if (startByClassIndex.has(classIndex)) {
          fail(`class index ${classIndex} has more than one start node (${startByClassIndex.get(classIndex)} and ${key}).`);
        }
        startByClassIndex.set(classIndex, key);
      }
    }
    if (ascendancyId !== null && kind !== 'placeholder') {
      ascendanciesWithNodes.add(ascendancyId);
      if (kind === 'ascendancyStart') {
        if (ascendancyStartById.has(ascendancyId)) {
          fail(`ascendancy "${ascendancyId}" has more than one start node (${ascendancyStartById.get(ascendancyId)} and ${key}).`);
        }
        ascendancyStartById.set(ascendancyId, key);
      }
    }
  }
  if (nodes.length === 0) fail('"nodes" contains no passive nodes.');

  // ---- Classes, ascendancies and their override maps -----------------------
  // `overridePairs` is exported as `[]` when empty and as an object map
  // (original node ID -> skillOverrides ID) otherwise. A well-formed node ID
  // that is absent from "nodes" is a dangling optional reference (the pinned
  // export has two, on Druid): its override is still validated, but the pair
  // is skipped and counted rather than failing the whole tree (see SOURCE.md).
  let skippedOverridePairs = 0;
  const readOverridePairs = (value, context) => {
    const pairs = new Map();
    if (value === undefined || value === null) return pairs;
    if (Array.isArray(value)) {
      if (value.length > 0) fail(`${context} "overridePairs" must be an object map of node ID to override ID.`);
      return pairs;
    }
    if (!isRecord(value)) fail(`${context} "overridePairs" must be an object map of node ID to override ID.`);
    for (const [nodeKey, overrideValue] of Object.entries(value)) {
      if (nodeKey === ROOT_KEY || !NODE_KEY_PATTERN.test(nodeKey)) {
        fail(`${context} "overridePairs" references missing node ${describe(nodeKey)}.`);
      }
      const dangling = !hasOwn(rawNodes, nodeKey);
      const overrideId = typeof overrideValue === 'string' || Number.isInteger(overrideValue) ? String(overrideValue) : null;
      if (overrideId === null || !hasOwn(skillOverrides, overrideId)) {
        fail(`${context} "overridePairs" maps node ${nodeKey} to ${describe(overrideValue)}, which is missing from "skillOverrides".`);
      }
      let entry = skillOverrides[overrideId];
      if (Array.isArray(entry)) [entry] = entry;
      if (!isRecord(entry)) fail(`"skillOverrides" entry ${overrideId} must be an object.`);
      if (entry.name !== undefined && entry.name !== null && typeof entry.name !== 'string') {
        fail(`"skillOverrides" entry ${overrideId} has a malformed name ${describe(entry.name)}.`);
      }
      const stats = entry.stats === undefined || entry.stats === null
        ? null
        : readStringList(entry.stats, `"skillOverrides" entry ${overrideId} "stats"`);
      if (dangling) {
        skippedOverridePairs += 1;
        continue;
      }
      pairs.set(nodeKey, {
        name: typeof entry.name === 'string' ? entry.name : null,
        stats,
      });
    }
    return pairs;
  };

  const knownAscendancyIds = new Set();
  const classRecords = raw.classes.map((rawClass, classIndex) => {
    if (!isRecord(rawClass)) fail(`class #${classIndex} must be an object.`);
    if (typeof rawClass.name !== 'string' || rawClass.name === '') fail(`class #${classIndex} has no name.`);
    if (!Array.isArray(rawClass.ascendancies)) fail(`class "${rawClass.name}" "ascendancies" must be an array.`);
    const ascendancies = rawClass.ascendancies.map((rawAscendancy, ascendancyIndex) => {
      const context = `class "${rawClass.name}" ascendancy #${ascendancyIndex}`;
      if (!isRecord(rawAscendancy)) fail(`${context} must be an object.`);
      if (typeof rawAscendancy.id !== 'string' || rawAscendancy.id === '') {
        fail(`${context} has a malformed ID ${describe(rawAscendancy.id)}.`);
      }
      if (knownAscendancyIds.has(rawAscendancy.id)) fail(`ascendancy ID "${rawAscendancy.id}" is declared more than once.`);
      knownAscendancyIds.add(rawAscendancy.id);
      if (rawAscendancy.name !== undefined && rawAscendancy.name !== null && typeof rawAscendancy.name !== 'string') {
        fail(`ascendancy "${rawAscendancy.id}" has a malformed name ${describe(rawAscendancy.name)}.`);
      }
      return {
        id: rawAscendancy.id,
        name: typeof rawAscendancy.name === 'string' ? rawAscendancy.name : null,
        pairs: readOverridePairs(rawAscendancy.overridePairs, `ascendancy "${rawAscendancy.id}"`),
      };
    });
    return {
      index: classIndex,
      name: rawClass.name,
      pairs: readOverridePairs(rawClass.overridePairs, `class "${rawClass.name}"`),
      ascendancies,
    };
  });

  // ---- Dangling references and rule metadata -------------------------------
  const constraints = new Map();
  const keystonesInRadius = new Map();
  for (const node of nodes) {
    const rawNode = rawNodes[node.id];
    for (const direction of ['in', 'out']) {
      const list = rawNode[direction];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) fail(`node ${node.id} "${direction}" must be an array.`);
      for (const value of list) nodeRef(value, `node ${node.id} "${direction}"`);
    }

    if (rawNode.unlockConstraint !== undefined && rawNode.unlockConstraint !== null) {
      const constraint = rawNode.unlockConstraint;
      if (!isRecord(constraint)) fail(`node ${node.id} "unlockConstraint" must be an object.`);
      const required = constraint.nodes === undefined || constraint.nodes === null ? [] : constraint.nodes;
      if (!Array.isArray(required)) fail(`node ${node.id} "unlockConstraint.nodes" must be an array.`);
      let ascendancy = null;
      if (constraint.ascendancy !== undefined && constraint.ascendancy !== null) {
        if (typeof constraint.ascendancy !== 'string' || !knownAscendancyIds.has(constraint.ascendancy)) {
          fail(`node ${node.id} "unlockConstraint" references unknown ascendancy ${describe(constraint.ascendancy)}.`);
        }
        ascendancy = constraint.ascendancy;
      }
      constraints.set(node.id, {
        nodes: required.map((value) => {
          const id = nodeRef(value, `node ${node.id} "unlockConstraint"`);
          if (id === ROOT_KEY) fail(`node ${node.id} "unlockConstraint" references the synthetic root.`);
          return id;
        }),
        ascendancy,
      });
    }

    if (rawNode.keystonesInRadius !== undefined && rawNode.keystonesInRadius !== null) {
      if (!Array.isArray(rawNode.keystonesInRadius)) fail(`node ${node.id} "keystonesInRadius" must be an array.`);
      keystonesInRadius.set(
        node.id,
        rawNode.keystonesInRadius.map((value) => nodeRef(value, `node ${node.id} "keystonesInRadius"`)),
      );
    }
  }

  // Multiple-choice options name their hub explicitly (`multipleChoiceParent`);
  // the flagged-neighbour fallback only covers exports that omit the field.
  const choiceParents = new Map();
  for (const node of nodes) {
    const rawNode = rawNodes[node.id];
    if (rawNode.isMultipleChoiceOption !== true) continue;
    let parentId = null;
    if (rawNode.multipleChoiceParent !== undefined && rawNode.multipleChoiceParent !== null) {
      parentId = nodeRef(rawNode.multipleChoiceParent, `node ${node.id} "multipleChoiceParent"`);
    } else {
      const candidates = new Set();
      for (const direction of ['in', 'out']) {
        for (const value of rawNode[direction] || []) {
          const neighbourId = String(value);
          if (rawNodes[neighbourId].isMultipleChoice === true) candidates.add(neighbourId);
        }
      }
      if (candidates.size === 1) [parentId] = candidates;
    }
    if (parentId === null || parentId === ROOT_KEY || rawNodes[parentId].isMultipleChoice !== true) {
      fail(`multiple-choice option ${node.id} does not identify exactly one "isMultipleChoice" parent node.`);
    }
    choiceParents.set(node.id, parentId);
  }

  // ---- Edges: official connection list, minus the synthetic root -----------
  /** @type {[string, string][]} */
  const edges = [];
  raw.edges.forEach((edge, edgeIndex) => {
    if (!isRecord(edge)) fail(`edge #${edgeIndex} must be an object.`);
    const from = nodeRef(edge.from, `edge #${edgeIndex} "from"`);
    const to = nodeRef(edge.to, `edge #${edgeIndex} "to"`);
    if (from === ROOT_KEY || to === ROOT_KEY) return;
    edges.push([from, to]);
  });

  // ---- Offered classes and ascendancies -------------------------------------
  // Evidence for every exclusion is documented in SOURCE.md:
  //   * a class with no offered ascendancy is an unreleased placeholder;
  //   * an ascendancy with a null/empty name is an unreleased placeholder;
  //   * a named ascendancy without graph nodes of its own is offered only as a
  //     variant when all of its overridePairs target the nodes of exactly one
  //     released sibling ascendancy (Abyssal Lich -> Lich in the pinned export).
  const classes = [];
  const classInfoById = new Map();
  for (const record of classRecords) {
    const offered = [];
    const ascendancyInfo = new Map();
    for (const ascendancy of record.ascendancies) {
      if (ascendancy.name === null || ascendancy.name.trim() === '') continue;
      let hostId = null;
      if (ascendanciesWithNodes.has(ascendancy.id)) {
        hostId = ascendancy.id;
      } else if (ascendancy.pairs.size > 0) {
        const hosts = new Set();
        for (const nodeKey of ascendancy.pairs.keys()) {
          const target = nodeById.get(nodeKey);
          hosts.add(target ? target.ascendancyId : null);
        }
        const [onlyHost] = hosts;
        const sibling = record.ascendancies.find((candidate) => candidate.id === onlyHost);
        if (
          hosts.size === 1 && typeof onlyHost === 'string' && sibling && sibling.name !== null
          && sibling.name.trim() !== '' && ascendanciesWithNodes.has(onlyHost)
        ) {
          hostId = onlyHost;
        }
      }
      if (hostId === null) continue;
      const startId = ascendancyStartById.get(hostId);
      if (startId === undefined) fail(`ascendancy "${hostId}" has passive nodes but no ascendancy start node.`);
      offered.push({ id: ascendancy.id, name: ascendancy.name });
      ascendancyInfo.set(ascendancy.id, {
        id: ascendancy.id,
        name: ascendancy.name,
        hostId,
        startId,
        pairs: ascendancy.pairs,
      });
    }
    if (offered.length === 0) continue;
    const startId = startByClassIndex.get(record.index);
    if (startId === undefined) fail(`class "${record.name}" has released ascendancies but no class start node.`);
    if (classInfoById.has(record.name)) fail(`class name "${record.name}" is declared more than once.`);
    classes.push({ id: record.name, name: record.name, ascendancies: offered });
    classInfoById.set(record.name, {
      id: record.name,
      name: record.name,
      startId,
      pairs: record.pairs,
      ascendancies: ascendancyInfo,
    });
  }

  const analysis = {
    rawNodes,
    nodes,
    nodeById,
    edges,
    classes,
    classInfoById,
    constraints,
    keystonesInRadius,
    choiceParents,
    skippedOverridePairs,
  };
  analysisCache.set(raw, analysis);
  return analysis;
}

/**
 * Fetch and normalize the same-origin pinned export.
 *
 * @param {string} [url]
 * @returns {Promise<TreeData>}
 */
export async function loadTree(url = DEFAULT_TREE_URL) {
  const target = typeof url === 'string' ? url : String(url);
  if (target === '') fail('loadTree requires a non-empty URL.');
  let response;
  try {
    response = await fetch(target, { credentials: 'same-origin' });
  } catch (error) {
    throw new Error(`PoE2 passive tree: could not load ${target}: ${messageOf(error)}`, { cause: error });
  }
  if (!response || !response.ok) {
    const status = response ? `HTTP ${response.status} ${response.statusText || ''}`.trim() : 'no response';
    throw new Error(`PoE2 passive tree: could not load ${target}: ${status}.`);
  }
  let raw;
  try {
    raw = await response.json();
  } catch (error) {
    throw new Error(`PoE2 passive tree: ${target} is not valid JSON: ${messageOf(error)}`, { cause: error });
  }
  return normalizeTree(raw);
}

/**
 * Normalize the official export into structured-cloneable TreeData.
 *
 * Every keyed node except the coordinate-less synthetic "root" is kept under
 * its upstream numeric ID with its official coordinates, name and stats.
 * `edges` is the official connection list minus the six root edges. `raw` is
 * the untouched export (class/ascendancy overrides and rule metadata live
 * there); use buildAllocationModel() rather than interpreting it.
 *
 * @param {Record<string, unknown>} raw
 * @returns {TreeData}
 */
export function normalizeTree(raw) {
  const analysis = analyzeRaw(raw);
  return {
    version: PINNED_SOURCE.version,
    source: { url: PINNED_SOURCE.url, commit: PINNED_SOURCE.commit },
    classes: analysis.classes.map((option) => ({
      id: option.id,
      name: option.name,
      ascendancies: option.ascendancies.map((ascendancy) => ({ id: ascendancy.id, name: ascendancy.name })),
    })),
    nodes: analysis.nodes.map((node) => ({ ...node, stats: node.stats.slice() })),
    edges: analysis.edges.map((edge) => [edge[0], edge[1]]),
    skippedOverridePairs: analysis.skippedOverridePairs,
    raw,
  };
}

/**
 * Build the allocation rules for one class and (optionally) one ascendancy.
 * Ordinary shared allocations only: weapon-set allocations are not modelled.
 *
 * @param {TreeData} data
 * @param {string} classId        a ClassOption.id from data.classes
 * @param {string|null} ascendancyId  an ascendancy id of that class, or null when unchosen
 * @returns {AllocationModel}
 */
export function buildAllocationModel(data, classId, ascendancyId) {
  if (
    !isRecord(data) || !isRecord(data.raw) || !Array.isArray(data.nodes)
    || !Array.isArray(data.edges) || !Array.isArray(data.classes)
  ) {
    fail('buildAllocationModel requires the TreeData returned by normalizeTree() or loadTree().');
  }
  const analysis = analyzeRaw(data.raw);
  const { rawNodes } = analysis;

  if (typeof classId !== 'string') fail(`class ID must be a string, received ${describe(classId)}.`);
  const classInfo = analysis.classInfoById.get(classId);
  if (!classInfo) {
    fail(`unknown class ${describe(classId)}; available classes: ${[...analysis.classInfoById.keys()].join(', ') || 'none'}.`);
  }
  let ascendancyInfo = null;
  if (ascendancyId !== null && ascendancyId !== undefined) {
    if (typeof ascendancyId !== 'string') fail(`ascendancy ID must be a string or null, received ${describe(ascendancyId)}.`);
    ascendancyInfo = classInfo.ascendancies.get(ascendancyId) || null;
    if (ascendancyInfo === null) {
      fail(
        `unknown ascendancy ${describe(ascendancyId)} for class "${classInfo.name}"; `
        + `available ascendancies: ${[...classInfo.ascendancies.keys()].join(', ')}.`,
      );
    }
  }
  const selectedAscendancyId = ascendancyInfo ? ascendancyInfo.id : null;
  const hostAscendancyId = ascendancyInfo ? ascendancyInfo.hostId : null;
  const buildLabel = ascendancyInfo
    ? `${classInfo.name} (${ascendancyInfo.name})`
    : `${classInfo.name} (no ascendancy)`;

  // ---- Membership: the passives that exist for this class/ascendancy -------
  /** @type {Map<string, PassiveNode>} */
  const members = new Map();
  for (const base of data.nodes) {
    if (!isRecord(base) || typeof base.id !== 'string' || base.id === ROOT_KEY || !isRecord(rawNodes[base.id])) {
      fail(`TreeData node ${describe(base && base.id)} does not exist in the export.`);
    }
    if (base.kind === 'placeholder' || base.kind === 'mastery') continue;
    if (base.domain === 'ascendancy') {
      if (base.ascendancyId !== hostAscendancyId) continue;
    } else if (base.kind === 'classStart' && base.id !== classInfo.startId) {
      continue;
    }
    const constraint = analysis.constraints.get(base.id);
    if (
      constraint && constraint.ascendancy !== null
      && constraint.ascendancy !== selectedAscendancyId && constraint.ascendancy !== hostAscendancyId
    ) {
      continue;
    }

    // Replacement name/stats sit on the ORIGINAL node: identity, position and
    // connections are never swapped. The ascendancy override wins over the class one.
    const override = (ascendancyInfo && ascendancyInfo.pairs.get(base.id)) || classInfo.pairs.get(base.id) || null;
    let name = typeof base.name === 'string' ? base.name : '';
    let stats = Array.isArray(base.stats) ? base.stats : [];
    if (override) {
      if (override.name !== null) name = override.name;
      if (override.stats !== null) stats = override.stats;
    }
    // Start nodes are exported under legacy labels ("WITCH", "SIX",
    // "Necromancer"); the model shows the selected class/ascendancy name.
    if (base.id === classInfo.startId) name = classInfo.name;
    else if (ascendancyInfo && base.id === ascendancyInfo.startId) name = ascendancyInfo.name;

    members.set(base.id, {
      id: base.id,
      name,
      stats: stats.slice(),
      x: base.x,
      y: base.y,
      kind: base.kind,
      domain: base.domain === 'ascendancy' ? 'ascendancy' : 'passive',
      ascendancyId: base.domain === 'ascendancy' ? selectedAscendancyId : null,
    });
  }

  // A node whose prerequisite or multiple-choice hub is not part of this build
  // can never be unlocked, so it is not offered either (applied transitively).
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const id of members.keys()) {
      const constraint = analysis.constraints.get(id);
      const parentId = analysis.choiceParents.get(id);
      if (
        (constraint && constraint.nodes.some((requiredId) => !members.has(requiredId)))
        || (parentId !== undefined && !members.has(parentId))
      ) {
        members.delete(id);
        pruned = true;
      }
    }
  }

  const rootIds = ascendancyInfo ? [classInfo.startId, ascendancyInfo.startId] : [classInfo.startId];
  for (const rootId of rootIds) {
    if (!members.has(rootId)) fail(`start node ${rootId} for ${buildLabel} is missing from TreeData.`);
  }
  const rootSet = new Set(rootIds);

  // ---- Connections among members -------------------------------------------
  /** @type {[string, string][]} */
  const edges = [];
  const neighbours = new Map();
  for (const id of members.keys()) neighbours.set(id, []);
  const seenEdges = new Set();
  for (const edge of data.edges) {
    if (!Array.isArray(edge) || edge.length !== 2) fail(`TreeData edge ${describe(edge)} is malformed.`);
    const [from, to] = edge;
    if (!members.has(from) || !members.has(to) || from === to) continue;
    const edgeKey = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    edges.push([from, to]);
    neighbours.get(from).push(to);
    neighbours.get(to).push(from);
  }

  // ---- Rule metadata --------------------------------------------------------
  const constraintOf = new Map();
  const parentOf = new Map();
  const optionsOf = new Map();
  const dependentsOf = new Map();
  const addDependent = (requiredId, dependentId) => {
    const list = dependentsOf.get(requiredId);
    if (list) list.push(dependentId);
    else dependentsOf.set(requiredId, [dependentId]);
  };
  for (const id of members.keys()) {
    if (rootSet.has(id)) continue;
    const constraint = analysis.constraints.get(id);
    if (constraint && constraint.nodes.length > 0) {
      constraintOf.set(id, constraint.nodes);
      for (const requiredId of constraint.nodes) addDependent(requiredId, id);
    }
    const parentId = analysis.choiceParents.get(id);
    if (parentId !== undefined) {
      parentOf.set(id, parentId);
      addDependent(parentId, id);
      const options = optionsOf.get(parentId);
      if (options) options.push(id);
      else optionsOf.set(parentId, [id]);
    }
  }

  // `isFree` is honoured only in the pattern verified in the pinned export: an
  // ascendancy passive wired directly to its own ascendancy start. Such a node
  // costs no point but is still an ordinary node (connected, prerequisites
  // enforced, never an independent root). Any other use fails closed.
  const freeIds = new Set();
  for (const [id, node] of members) {
    if (rootSet.has(id) || rawNodes[id].isFree !== true) continue;
    const verifiedPattern = node.domain === 'ascendancy' && ascendancyInfo !== null
      && neighbours.get(id).includes(ascendancyInfo.startId);
    if (!verifiedPattern) {
      fail(
        `node ${id} ("${node.name}") is flagged "isFree" outside the verified pattern `
        + '(ascendancy passive adjacent to its ascendancy start); its cost semantics must be reviewed (see SOURCE.md).',
      );
    }
    freeIds.add(id);
  }

  // Disconnected allocation (Oracle "Entwined Realities"): once the granting
  // ascendancy notable and a keystone are allocated, the non-keystone passives
  // the export lists as `keystonesInRadius` of that keystone need no path.
  let disconnectGrantId = null;
  for (const [id, node] of members) {
    if (node.domain === 'ascendancy' && node.stats.some((stat) => DISCONNECTED_ALLOCATION_PATTERN.test(stat))) {
      disconnectGrantId = id;
      break;
    }
  }
  const radiusKeystones = new Map();
  const keystoneIds = new Set();
  if (disconnectGrantId !== null) {
    for (const [id, node] of members) {
      if (node.kind === 'keystone') keystoneIds.add(id);
    }
    for (const [id, node] of members) {
      if (node.domain !== 'passive' || node.kind === 'keystone' || rootSet.has(id)) continue;
      const listed = analysis.keystonesInRadius.get(id);
      if (!listed) continue;
      const inRadius = listed.filter((keystoneId) => keystoneIds.has(keystoneId));
      if (inRadius.length > 0) radiusKeystones.set(id, inRadius);
    }
  }

  const label = (id) => {
    const node = members.get(id);
    return node && node.name !== '' ? `"${node.name}" (${id})` : `node ${id}`;
  };

  // An ascendancy passive must hang off the ascendancy tree itself; a main-tree
  // passive may hang off the class start, another main-tree passive, or an
  // allocated ascendancy passive the export wires into the main tree
  // (Pathfinder's "Path of the Warrior/Sorceress" options).
  const supports = (fromId, toNode) => toNode.domain !== 'ascendancy' || members.get(fromId).domain === 'ascendancy';

  const hasConnectedSupport = (node, connected) => {
    for (const neighbourId of neighbours.get(node.id)) {
      if (connected.has(neighbourId) && supports(neighbourId, node)) return true;
    }
    return false;
  };

  const canAllocateDisconnected = (node, connected) => {
    if (disconnectGrantId === null || !connected.has(disconnectGrantId)) return false;
    const inRadius = radiusKeystones.get(node.id);
    return inRadius !== undefined && inRadius.some((keystoneId) => connected.has(keystoneId));
  };

  const stepStatus = (node, realized, connected) => {
    const required = constraintOf.get(node.id);
    if (required) {
      for (const requiredId of required) {
        if (!realized.has(requiredId)) return STEP_NEEDS_PREREQUISITE;
      }
    }
    const parentId = parentOf.get(node.id);
    if (parentId !== undefined && !realized.has(parentId)) return STEP_NEEDS_CHOICE_PARENT;
    if (hasConnectedSupport(node, connected) || canAllocateDisconnected(node, connected)) return STEP_OK;
    return STEP_NOT_CONNECTED;
  };

  const describeBlock = (node, realized, connected) => {
    const status = stepStatus(node, realized, connected);
    if (status === STEP_NEEDS_PREREQUISITE) {
      const missing = constraintOf.get(node.id).filter((requiredId) => !realized.has(requiredId));
      return `${label(node.id)} requires ${missing.map(label).join(', ')} to be allocated first.`;
    }
    if (status === STEP_NEEDS_CHOICE_PARENT) {
      return `${label(node.id)} is an option of ${label(parentOf.get(node.id))}, which must be allocated first.`;
    }
    return `${label(node.id)} is not connected to the allocated tree for ${buildLabel}.`;
  };

  /**
   * Replay an allocation in some legal order. Every rule is monotone once the
   * one-option-per-hub check is done on the whole set, so the greedy fixed
   * point reaches every node that any legal order could reach.
   *
   * `realized`  = roots + nodes that could legally be allocated.
   * `connected` = roots + realized nodes joined to a start by allocated nodes
   *               (nodes taken through disconnected allocation are realized
   *               but do not extend the tree).
   * `remaining` = nodes no legal order can reach.
   */
  const realize = (allocated) => {
    const realized = new Set(rootIds);
    const connected = new Set(rootIds);
    const remaining = new Set(allocated);
    const queue = rootIds.slice();

    const attempt = (id) => {
      if (!remaining.has(id)) return;
      const node = members.get(id);
      if (stepStatus(node, realized, connected) !== STEP_OK) return;
      remaining.delete(id);
      realized.add(id);
      if (hasConnectedSupport(node, connected)) connected.add(id);
      queue.push(id);
    };

    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head];
      if (connected.has(id)) {
        for (const neighbourId of neighbours.get(id)) {
          if (remaining.has(neighbourId)) {
            attempt(neighbourId);
          } else if (
            realized.has(neighbourId) && !connected.has(neighbourId) && supports(id, members.get(neighbourId))
          ) {
            connected.add(neighbourId);
            queue.push(neighbourId);
          }
        }
        if (
          disconnectGrantId !== null && remaining.size > 0
          && (id === disconnectGrantId || keystoneIds.has(id))
        ) {
          for (const pendingId of Array.from(remaining)) attempt(pendingId);
        }
      }
      const dependents = dependentsOf.get(id);
      if (dependents) {
        for (const dependentId of dependents) attempt(dependentId);
      }
    }
    return { realized, connected, remaining };
  };

  /** Distinct, known, non-root IDs in input order; roots are implicit and free. */
  const readAllocation = (allocatedNodeIds) => {
    if (!Array.isArray(allocatedNodeIds)) {
      return { error: 'allocatedNodeIds must be an array of node ID strings.', ids: [], unknown: null };
    }
    const seen = new Set();
    const ids = [];
    let unknown = null;
    for (const id of allocatedNodeIds) {
      if (typeof id !== 'string') {
        return { error: `allocatedNodeIds contains a non-string node ID ${describe(id)}.`, ids: [], unknown: null };
      }
      if (seen.has(id)) continue;
      seen.add(id);
      if (!members.has(id)) {
        if (unknown === null) unknown = id;
        continue;
      }
      if (!rootSet.has(id)) ids.push(id);
    }
    return { error: null, ids, unknown };
  };

  /**
   * Whether `nodeId` is a legal next allocation on top of `allocatedNodeIds`.
   * False for unknown nodes, implicit starts, already-allocated nodes and
   * malformed input. IDs in the allocation that are not part of this build are
   * ignored here; validateAllocation() reports them.
   */
  const canAllocate = (allocatedNodeIds, nodeId) => {
    const parsed = readAllocation(allocatedNodeIds);
    if (parsed.error !== null || typeof nodeId !== 'string') return false;
    const node = members.get(nodeId);
    if (!node || rootSet.has(nodeId)) return false;
    const allocated = new Set(parsed.ids);
    if (allocated.has(nodeId)) return false;
    const parentId = parentOf.get(nodeId);
    if (parentId !== undefined) {
      for (const siblingId of optionsOf.get(parentId)) {
        if (siblingId !== nodeId && allocated.has(siblingId)) return false;
      }
    }
    const { realized, connected } = realize(allocated);
    return stepStatus(node, realized, connected) === STEP_OK;
  };

  /**
   * Every node that is a legal next allocation on top of `allocatedNodeIds`:
   * exactly the IDs for which canAllocate(allocatedNodeIds, id) is true, found
   * with one parse and one replay of the allocation instead of one per node.
   * Empty for malformed input; like canAllocate(), IDs in the allocation that
   * are not part of this build are ignored.
   */
  const availableNodeIds = (allocatedNodeIds) => {
    const available = new Set();
    const parsed = readAllocation(allocatedNodeIds);
    if (parsed.error !== null) return available;
    const allocated = new Set(parsed.ids);
    // A hub with an allocated option offers none of its other options.
    const decidedHubs = new Set();
    for (const id of allocated) {
      const parentId = parentOf.get(id);
      if (parentId !== undefined) decidedHubs.add(parentId);
    }
    const { realized, connected } = realize(allocated);
    for (const [id, node] of members) {
      if (rootSet.has(id) || allocated.has(id)) continue;
      const parentId = parentOf.get(id);
      if (parentId !== undefined && decidedHubs.has(parentId)) continue;
      if (stepStatus(node, realized, connected) === STEP_OK) available.add(id);
    }
    return available;
  };

  /**
   * Complete legality: every ID belongs to this build, at most one option per
   * multiple-choice hub, and the whole set can be allocated in some legal order
   * from the implicit starts. Never throws.
   */
  const validateAllocation = (allocatedNodeIds) => {
    const parsed = readAllocation(allocatedNodeIds);
    if (parsed.error !== null) return { valid: false, reason: parsed.error };
    if (parsed.unknown !== null) {
      return { valid: false, reason: `Node ${parsed.unknown} is not available to ${buildLabel}.` };
    }
    const allocated = new Set(parsed.ids);
    for (const [hubId, options] of optionsOf) {
      const chosen = options.filter((optionId) => allocated.has(optionId));
      if (chosen.length > 1) {
        return {
          valid: false,
          reason: `${label(hubId)} allows only one option, but ${chosen.map(label).join(' and ')} are allocated.`,
        };
      }
    }
    const { realized, connected, remaining } = realize(allocated);
    if (remaining.size > 0) {
      const blockedId = parsed.ids.find((id) => remaining.has(id));
      return { valid: false, reason: describeBlock(members.get(blockedId), realized, connected) };
    }
    return { valid: true, reason: null };
  };

  /**
   * Points spent, counting each distinct paid node once in its own currency.
   * Implicit starts, verified `isFree` ascendancy passives and multiple-choice
   * options (their hub carries the point) cost nothing. Throws on malformed
   * input or IDs that are not part of this build.
   */
  const pointCost = (allocatedNodeIds) => {
    const parsed = readAllocation(allocatedNodeIds);
    if (parsed.error !== null) throw new TypeError(`PoE2 passive tree: pointCost: ${parsed.error}`);
    if (parsed.unknown !== null) fail(`pointCost: node ${parsed.unknown} is not available to ${buildLabel}.`);
    let passive = 0;
    let ascendancy = 0;
    for (const id of parsed.ids) {
      if (freeIds.has(id) || parentOf.has(id)) continue;
      if (members.get(id).domain === 'ascendancy') ascendancy += 1;
      else passive += 1;
    }
    return { passive, ascendancy };
  };

  // Frozen snapshots keep routing consumers out of the mutable rule closures.
  const routeRules = Object.freeze({
    prerequisites: Object.freeze(Object.fromEntries(
      Array.from(constraintOf, ([id, required]) => [id, Object.freeze(required.slice())]),
    )),
    choiceParents: Object.freeze(Object.fromEntries(parentOf)),
    supportEdges: Object.freeze(edges.flatMap(([from, to]) => {
      const directed = [];
      if (supports(from, members.get(to))) directed.push(Object.freeze([from, to]));
      if (supports(to, members.get(from))) directed.push(Object.freeze([to, from]));
      return directed;
    })),
  });

  return {
    nodes: Array.from(members.values()),
    edges,
    rootIds: rootIds.slice(),
    routeRules,
    canAllocate,
    availableNodeIds,
    validateAllocation,
    pointCost,
  };
}

// One stat number: an optional explicit sign (not glued to a preceding word,
// so "Non-Keystone" or "x-2" stay text) followed by an integer or decimal.
const STAT_NUMBER_PATTERN = /(?<![\w.])([+-]?)(\d+(?:\.\d+)?)(?![\d.])/g;
const ATTRIBUTE_LINE_PATTERN = /^[+-]?\d+(?:\.\d+)?%? (?:increased |reduced )?(?:to )?(?:all )?(?:Strength|Dexterity|Intelligence|Attributes)\b/;

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareStatLines(a, b) {
  const attributeOrder = Number(!ATTRIBUTE_LINE_PATTERN.test(a)) - Number(!ATTRIBUTE_LINE_PATTERN.test(b));
  if (attributeOrder !== 0) return attributeOrder;
  const wordingA = a.replace(STAT_NUMBER_PATTERN, '#').toLowerCase();
  const wordingB = b.replace(STAT_NUMBER_PATTERN, '#').toLowerCase();
  return compareText(wordingA, wordingB) || compareText(a, b);
}

/**
 * Net bonuses of an allocation. Every distinct allocated node contributes its
 * resolved (override-applied) stats from `model.nodes`. Lines holding exactly
 * one number are summed with other lines of identical wording; lines with no
 * number or several numbers are kept verbatim and counted. Keystones and
 * notables are also listed by name; their stats still count above.
 *
 * @param {ReturnType<typeof buildAllocationModel>} model
 * @param {readonly string[]} nodeIds
 * @returns {{ totals: string[], unsummed: { text: string, count: number }[],
 *   keystones: { id: string, name: string }[], notables: { id: string, name: string }[] }}
 */
export function summarizeRouteBonuses(model, nodeIds) {
  if (!isRecord(model) || !Array.isArray(model.nodes)) {
    throw new TypeError('PoE2 passive tree: summarizeRouteBonuses: model must be an allocation model.');
  }
  if (!Array.isArray(nodeIds)) {
    throw new TypeError('PoE2 passive tree: summarizeRouteBonuses: node IDs must be an array.');
  }
  for (const id of nodeIds) {
    if (typeof id !== 'string') {
      throw new TypeError(`PoE2 passive tree: summarizeRouteBonuses: node ID ${describe(id)} is not a string.`);
    }
  }
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const sums = new Map();
  const verbatim = new Map();
  const keystones = [];
  const notables = [];

  for (const id of nodeIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodesById.get(id);
    if (node === undefined) fail(`summarizeRouteBonuses: node ${id} is not part of this allocation model.`);
    if (node.kind === 'keystone') keystones.push({ id, name: node.name });
    else if (node.kind === 'notable') notables.push({ id, name: node.name });

    for (const stat of Array.isArray(node.stats) ? node.stats : []) {
      if (typeof stat !== 'string') continue;
      for (const line of stat.split(/\r?\n/)) {
        if (line.trim() === '') continue;
        const numbers = Array.from(line.matchAll(STAT_NUMBER_PATTERN));
        if (numbers.length !== 1) {
          verbatim.set(line, (verbatim.get(line) || 0) + 1);
          continue;
        }
        const [match, sign, digits] = numbers[0];
        const signed = sign !== '';
        const before = line.slice(0, numbers[0].index);
        const after = line.slice(numbers[0].index + match.length);
        const key = `${signed ? '±' : ''}\u0000${before}\u0000${after}`;
        const decimals = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0;
        const value = Number(digits) * (sign === '-' ? -1 : 1);
        const entry = sums.get(key);
        if (entry) {
          entry.total += value;
          entry.decimals = Math.max(entry.decimals, decimals);
        } else {
          sums.set(key, { before, after, signed, total: value, decimals });
        }
      }
    }
  }

  const totals = Array.from(sums.values(), ({ before, after, signed, total, decimals }) => {
    const rounded = Number(total.toFixed(decimals)) + 0;
    const number = String(rounded);
    return `${before}${signed && rounded >= 0 ? '+' : ''}${number}${after}`;
  }).sort(compareStatLines);
  const unsummed = Array.from(verbatim, ([text, count]) => ({ text, count }))
    .sort((a, b) => compareStatLines(a.text, b.text));
  const byName = (a, b) => compareText(a.name, b.name) || compareText(a.id, b.id);
  keystones.sort(byName);
  notables.sort(byName);
  return { totals, unsummed, keystones, notables };
}

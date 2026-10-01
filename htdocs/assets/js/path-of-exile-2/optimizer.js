/**
 * Node-count routing; point cost is reported separately from the objective.
 * The exact search runs first. When it cannot finish inside its limits the
 * route comes from a polynomial heuristic and is disclosed with `exact: false`.
 */

/**
 * @typedef {object} RouteResult
 * @property {boolean} ok
 * @property {string[]} nodeIds Sorted route node IDs, without the starts.
 * @property {any} pointCost `model.pointCost(nodeIds)`, or null on failure.
 * @property {string | null} reason Why no route was returned, or null.
 * @property {boolean} [exact] True when the route is proven shortest, false
 *   when it comes from the heuristic fallback. Absent on failure and when
 *   nothing needs routing.
 */

const INF = 0x3fffffff;
const MAX_TERMINALS = 16;
const MAX_STATES = 6000000;
const MAX_WORK = 120000000;
const MAX_BRANCHES = 256;
const NO_ROUTE = 'The must-have nodes cannot coexist or cannot be reached by a legal connected route.';

const failure = (reason) => ({ ok: false, nodeIds: [], pointCost: null, reason });

/** Raised when the exact search runs out of room; triggers the heuristic fallback. */
class SearchLimitError extends Error {}

/** Whether the Steiner DP refuses this many terminals on this many vertices. */
const exceedsStateLimit = (terminalCount, vertexCount) => terminalCount > MAX_TERMINALS
  || (2 ** terminalCount) * vertexCount > MAX_STATES;

function spend(budget, amount) {
  budget.work -= amount;
  if (budget.work < 0) {
    throw new SearchLimitError('The exact search limit was reached; a minimum route cannot be guaranteed.');
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(distance, vertex) {
    const item = [distance, vertex];
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(item, this.items[parent])) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  less(a, b) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.less(this.items[child + 1], this.items[child])) child += 1;
        if (!this.less(this.items[child], last)) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

/**
 * Directed, node-weighted Dreyfus-Wagner DP. D[S,v] includes v's weight and
 * connects v to every terminal in S. Merge subsets at v, then propagate costs
 * backwards along support edges. A zero-weight super-root reaches both starts.
 * Any feasible directed connection has an arborescence, which decomposes into
 * precisely these path and split operations; thus this is an exact lower bound
 * when prerequisite/order/choice constraints are temporarily relaxed.
 */
function steiner(graph, terminals, excluded, budget) {
  const { ids, indexOf, incoming, weight, root } = graph;
  const count = ids.length;
  if (exceedsStateLimit(terminals.length, count)) {
    throw new SearchLimitError('Too many forced prerequisites for the exact search; a minimum route cannot be guaranteed.');
  }
  const masks = 2 ** terminals.length;
  const blocked = new Uint8Array(count);
  for (const id of excluded) blocked[indexOf.get(id)] = 1;
  const costs = new Array(masks);
  const traces = new Array(masks);

  for (let mask = 1; mask < masks; mask += 1) {
    spend(budget, count);
    const cost = new Int32Array(count).fill(INF);
    // Positive: next vertex + 1; negative: split mask; zero: terminal seed.
    const trace = new Int32Array(count);
    costs[mask] = cost;
    traces[mask] = trace;
    if ((mask & (mask - 1)) === 0) {
      const terminal = indexOf.get(terminals[31 - Math.clz32(mask)]);
      cost[terminal] = weight[terminal];
    } else {
      for (let left = (mask - 1) & mask; left > 0; left = (left - 1) & mask) {
        const right = mask ^ left;
        if (left > right) continue;
        spend(budget, count);
        const a = costs[left];
        const b = costs[right];
        for (let vertex = 0; vertex < count; vertex += 1) {
          if (blocked[vertex] || a[vertex] === INF || b[vertex] === INF) continue;
          const joined = a[vertex] + b[vertex] - weight[vertex];
          if (joined < cost[vertex]) {
            cost[vertex] = joined;
            trace[vertex] = -left;
          }
        }
      }
    }

    const heap = new MinHeap();
    for (let vertex = 0; vertex < count; vertex += 1) {
      if (!blocked[vertex] && cost[vertex] < INF) heap.push(cost[vertex], vertex);
    }
    while (heap.items.length > 0) {
      const [distance, vertex] = heap.pop();
      if (distance !== cost[vertex]) continue;
      spend(budget, incoming[vertex].length + 1);
      for (const previous of incoming[vertex]) {
        if (blocked[previous]) continue;
        const nextCost = distance + weight[previous];
        if (nextCost < cost[previous]) {
          cost[previous] = nextCost;
          trace[previous] = vertex + 1;
          heap.push(nextCost, previous);
        }
      }
    }
  }

  const full = masks - 1;
  if (costs[full][root] === INF) return null;
  const selected = new Set();
  const visited = new Set();
  const pending = [[full, root]];
  while (pending.length > 0) {
    const [mask, vertex] = pending.pop();
    const key = mask * count + vertex;
    if (visited.has(key)) continue;
    visited.add(key);
    if (weight[vertex] !== 0) selected.add(ids[vertex]);
    const trace = traces[mask][vertex];
    if (trace > 0) pending.push([mask, trace - 1]);
    else if (trace < 0) pending.push([-trace, vertex], [mask ^ -trace, vertex]);
  }
  const nodeIds = [...selected].sort();
  if (nodeIds.length !== costs[full][root]) {
    throw new Error('The route minimum could not be certified.');
  }
  return nodeIds;
}

/**
 * Exact search: branch over prerequisite, choice and allocation-order
 * constraints and solve each branch with the Steiner DP. It only ever returns a
 * proven minimum or a proven failure; when it runs out of room it throws
 * SearchLimitError instead of returning an incumbent.
 */
function exactRoute({ model, graph, rules, prerequisites, known, roots, forced: closed }) {
  const budget = { work: MAX_WORK };
  const pending = [{ forced: new Set(closed), excluded: new Set() }];
  const seen = new Set();
  let best = null;
  let branches = 0;

  while (pending.length > 0) {
    const { forced, excluded } = pending.pop();
    // Close all mandatory requirements before solving or pruning this branch.
    for (const id of forced) {
      for (const dependency of prerequisites(id)) {
        if (!known.has(dependency)) return failure(`Node ${id} requires an unavailable node.`);
        if (!roots.has(dependency)) forced.add(dependency);
      }
    }
    if ([...forced].some((id) => excluded.has(id))) continue;
    const choices = new Map();
    let conflict = false;
    for (const id of forced) {
      const parent = rules.choiceParents[id];
      if (parent === undefined) continue;
      if (choices.has(parent) && choices.get(parent) !== id) conflict = true;
      choices.set(parent, id);
    }
    if (conflict || (best !== null && forced.size >= best.length)) continue;
    const terminals = [...forced].sort();
    const key = JSON.stringify([terminals, [...excluded].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (++branches > MAX_BRANCHES) {
      throw new SearchLimitError('The exact constraint search limit was reached; a minimum route cannot be guaranteed.');
    }
    const candidate = steiner(graph, terminals, excluded, budget);
    if (candidate === null || (best !== null && candidate.length >= best.length)) continue;
    const selected = new Set(candidate);
    const chosen = new Map();
    let incompatible = null;
    let missing = null;
    for (const id of candidate) {
      const parent = rules.choiceParents[id];
      if (parent !== undefined) {
        if (chosen.has(parent)) incompatible = [chosen.get(parent), id];
        chosen.set(parent, id);
      }
      if (prerequisites(id).some((dependency) => !roots.has(dependency) && !selected.has(dependency))) missing = id;
    }
    const exclude = (id) => {
      if (!forced.has(id)) pending.push({ forced: new Set(forced), excluded: new Set([...excluded, id]) });
    };
    const include = (extra) => pending.push({ forced: new Set([...forced, ...extra]), excluded: new Set(excluded) });
    if (incompatible !== null) {
      // Every feasible route omits at least one of these mutually exclusive options.
      for (const id of incompatible) exclude(id);
    } else if (missing !== null) {
      // Every feasible route either omits this node or includes all its requirements.
      exclude(missing);
      include([missing]);
    } else if (model.validateAllocation(candidate).valid) {
      // The DP reconstruction supplies support paths for every node, including
      // Oracle nodes. No disconnected-allocation shortcut is used in the graph.
      best = candidate;
    } else {
      // A closed set can still have an impossible allocation order. Cover all
      // alternatives: omit a candidate node, or extend the entire candidate.
      // Every connected strict superset contains a support-boundary node.
      const boundary = new Set();
      for (const [from, to] of rules.supportEdges) {
        if ((selected.has(from) || roots.has(from)) && !selected.has(to)
          && !roots.has(to) && !excluded.has(to)) boundary.add(to);
      }
      for (const id of [...boundary].sort()) include([...candidate, id]);
      for (const id of candidate) exclude(id);
    }
  }
  if (best === null) return failure(NO_ROUTE);
  return { ok: true, nodeIds: best, pointCost: model.pointCost(best), reason: null, exact: true };
}

/**
 * Polynomial fallback for inputs the exact search cannot finish. The route is
 * grown in a legal allocation order: each round a breadth-first search from the
 * nodes already taken finds the nearest required node whose own requirements
 * are taken (ties by ID) and takes the path to it. Rounds escalate only when
 * the cheaper one reaches nothing: level 0 crosses nodes that are allocatable
 * as things stand, level 1 may commit one option of an undecided choice hub,
 * and level 2 looks through locked nodes to learn which extra node to require.
 * A final pruning pass leaves a legal route that no single optional node can
 * be removed from. It is short, but not proven shortest.
 */
function heuristicRoute({ model, graph, rules, prerequisites, roots, required }) {
  const { ids, indexOf } = graph;
  const count = ids.length - 1; // Real nodes only; the super-root is not used here.
  const outgoing = Array.from({ length: count }, () => []);
  for (const [from, to] of rules.supportEdges) outgoing[indexOf.get(from)].push(indexOf.get(to));
  for (const neighbours of outgoing) neighbours.sort((a, b) => a - b);

  // Per node: what must be taken first, its choice hub, and the hub's options.
  const needs = [];
  const hub = new Int32Array(count).fill(-1);
  const broken = new Uint8Array(count); // Requires a node outside the model.
  const options = new Map();
  for (let v = 0; v < count; v += 1) {
    const list = [];
    for (const dependency of prerequisites(ids[v])) {
      const index = indexOf.get(dependency);
      if (index === undefined) broken[v] = 1;
      else list.push(index);
    }
    needs.push(list);
    const parent = indexOf.get(rules.choiceParents[ids[v]]);
    if (parent === undefined) continue;
    hub[v] = parent;
    if (options.has(parent)) options.get(parent).push(v);
    else options.set(parent, [v]);
  }

  const inTree = new Uint8Array(count); // Starts plus every node taken so far.
  const pending = new Uint8Array(count); // Required, not taken yet.
  const blocked = new Uint8Array(count); // Sibling of a chosen option.
  const chosen = new Int32Array(count).fill(-1); // Hub index -> its one option.
  const order = [];
  let pendingCount = 0;
  for (const id of roots) inTree[indexOf.get(id)] = 1;

  const met = (v) => needs[v].every((need) => inTree[need] === 1);

  // Settle `v` as its hub's one option; false when another option already is.
  const choose = (v) => {
    const parent = hub[v];
    if (parent === -1) return true;
    if (chosen[parent] !== -1) return chosen[parent] === v;
    chosen[parent] = v;
    for (const sibling of options.get(parent)) {
      if (sibling !== v) blocked[sibling] = 1;
    }
    return true;
  };

  // Require `start` and everything it needs; returns a failure reason or null.
  const force = (start) => {
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop();
      if (inTree[v] || pending[v]) continue;
      if (broken[v]) return `Node ${ids[v]} requires an unavailable node.`;
      if (blocked[v] || !choose(v)) return NO_ROUTE;
      pending[v] = 1;
      pendingCount += 1;
      for (const need of needs[v]) stack.push(need);
    }
    return null;
  };

  const take = (v) => {
    inTree[v] = 1;
    order.push(v);
    if (pending[v]) {
      pending[v] = 0;
      pendingCount -= 1;
    }
  };

  const passable = (v, level) => {
    if (blocked[v] || broken[v]) return false;
    if (level === 2) return true;
    if (!met(v)) return false;
    return hub[v] === -1 || chosen[hub[v]] === v || (level === 1 && chosen[hub[v]] === -1);
  };

  const distance = new Int32Array(count);
  const previous = new Int32Array(count);
  const queue = new Int32Array(count);
  const search = (level) => {
    distance.fill(-1);
    let tail = 0;
    for (let v = 0; v < count; v += 1) {
      if (!inTree[v]) continue;
      distance[v] = 0;
      queue[tail] = v;
      tail += 1;
    }
    for (let head = 0; head < tail; head += 1) {
      const from = queue[head];
      for (const to of outgoing[from]) {
        if (distance[to] !== -1 || !passable(to, level)) continue;
        distance[to] = distance[from] + 1;
        previous[to] = from;
        queue[tail] = to;
        tail += 1;
      }
    }
  };

  // The searched path from the taken nodes to `target`, nearest node first.
  const pathTo = (target) => {
    const path = [];
    for (let v = target; !inTree[v]; v = previous[v]) path.push(v);
    return path.reverse();
  };

  for (const id of [...required].sort()) {
    const reason = force(indexOf.get(id));
    if (reason !== null) return failure(reason);
  }

  while (pendingCount > 0) {
    let progressed = false;
    for (let level = 0; level <= 2 && !progressed; level += 1) {
      search(level);
      const targets = [];
      for (let v = 0; v < count; v += 1) {
        if (pending[v] && distance[v] > 0 && met(v)) targets.push(v);
      }
      if (targets.length === 0) continue;
      targets.sort((a, b) => distance[a] - distance[b] || a - b);
      if (level < 2) {
        for (const v of pathTo(targets[0])) {
          const commits = hub[v] !== -1 && chosen[hub[v]] === -1;
          if (commits) choose(v);
          take(v);
          // Committing a hub blocks its other options, so search again.
          if (commits) break;
        }
        progressed = true;
      } else {
        for (const target of targets) {
          const locked = pathTo(target).find((v) => !pending[v] && (hub[v] !== -1 || !met(v)));
          if (locked === undefined) continue;
          const reason = force(locked);
          if (reason !== null) return failure(reason);
          progressed = true;
          break;
        }
      }
    }
    if (!progressed) return failure(NO_ROUTE);
  }

  let route = order.map((v) => ids[v]);
  if (!model.validateAllocation(route).valid) return failure(NO_ROUTE);

  // Support connectivity is checked on its own so that a disconnected-allocation
  // rule in the model can never be used to drop a path, as in the exact search.
  const member = new Uint8Array(count);
  const connected = (nodeIds) => {
    member.fill(0);
    for (const id of nodeIds) member[indexOf.get(id)] = 1;
    let tail = 0;
    for (const id of roots) {
      queue[tail] = indexOf.get(id);
      tail += 1;
    }
    let reached = 0;
    for (let head = 0; head < tail; head += 1) {
      for (const to of outgoing[queue[head]]) {
        if (!member[to]) continue;
        member[to] = 0;
        reached += 1;
        queue[tail] = to;
        tail += 1;
      }
    }
    return reached === nodeIds.length;
  };

  // Pruning pass, latest additions first, repeated until nothing more can go:
  // removing one node can make an earlier one removable.
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = route.length - 1; index >= 0; index -= 1) {
      if (required.has(route[index])) continue;
      const trial = route.slice(0, index).concat(route.slice(index + 1));
      if (connected(trial) && model.validateAllocation(trial).valid) {
        route = trial;
        changed = true;
      }
    }
  }

  const nodeIds = route.sort();
  return { ok: true, nodeIds, pointCost: model.pointCost(nodeIds), reason: null, exact: false };
}

function solve(model, mustHaveNodeIds) {
  if (!Array.isArray(mustHaveNodeIds)) return failure('Must-have node IDs must be an array.');
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.rootIds)
    || typeof model.validateAllocation !== 'function' || typeof model.pointCost !== 'function') {
    return failure('A valid allocation model is required.');
  }
  const known = new Set(model.nodes.map((node) => node.id));
  const roots = new Set(model.rootIds);
  if (roots.size === 0 || [...roots].some((id) => !known.has(id))) return failure('The model has no valid starts.');
  const required = new Set();
  for (const id of mustHaveNodeIds) {
    if (typeof id !== 'string') return failure('Every must-have node ID must be a string.');
    if (!known.has(id)) return failure(`Node ${id} is not available in this model.`);
    if (!roots.has(id)) required.add(id);
  }
  if (required.size === 0) return { ok: true, nodeIds: [], pointCost: model.pointCost([]), reason: null };

  const rules = model.routeRules;
  if (!rules || !rules.prerequisites || !rules.choiceParents || !Array.isArray(rules.supportEdges)) {
    return failure('The model is missing routing rules; a minimum route cannot be guaranteed.');
  }
  const prerequisites = (id) => [
    ...(rules.prerequisites[id] || []),
    ...(rules.choiceParents[id] === undefined ? [] : [rules.choiceParents[id]]),
  ];
  const ids = [...known].sort();
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const root = ids.length;
  ids.push(null); // Internal super-root; never emitted or passed to the model.
  const incoming = ids.map(() => []);
  for (const [from, to] of rules.supportEdges) incoming[indexOf.get(to)].push(indexOf.get(from));
  for (const id of roots) incoming[indexOf.get(id)].push(root);
  for (const neighbours of incoming) neighbours.sort((a, b) => a - b);
  const weight = ids.map((id) => id === null || roots.has(id) ? 0 : 1);
  const graph = { ids, indexOf, incoming, weight, root };

  // The must-haves plus everything they transitively require: the fewest
  // terminals any branch of the exact search has to connect.
  const forced = new Set(required);
  for (const id of forced) {
    for (const dependency of prerequisites(id)) {
      if (!known.has(dependency)) return failure(`Node ${id} requires an unavailable node.`);
      if (!roots.has(dependency)) forced.add(dependency);
    }
  }
  const context = { model, graph, rules, prerequisites, known, roots, required, forced };

  // Skip the exact attempt when it is certain to exceed the state limit, so a
  // large set does not burn the whole work budget before falling back.
  if (!exceedsStateLimit(forced.size, ids.length)) {
    try {
      return exactRoute(context);
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    }
  }
  return heuristicRoute(context);
}

/**
 * The exact search is always tried first and its result carries `exact: true`.
 * When the proof search cannot finish, the route comes from the heuristic
 * fallback and is disclosed with `exact: false`; it is never passed off as a
 * minimum. Never throws: every failure is `{ ok: false, ..., reason }`.
 *
 * @param {any} model
 * @param {any} mustHaveNodeIds
 * @returns {RouteResult}
 */
export function findMinimalRoute(model, mustHaveNodeIds) {
  try {
    return solve(model, mustHaveNodeIds);
  } catch (error) {
    return failure(error instanceof Error && error.message ? error.message : 'A route could not be computed for this input.');
  }
}

/**
 * Connect a target to an existing allocation without removing any owned nodes.
 * Uses the route solver with owned nodes as free starts and returns additions only.
 */
export function findConnection(model, allocatedNodeIds, targetNodeId) {
  const fail = (reason) => ({ ...failure(reason), exact: false });
  try {
    if (!Array.isArray(allocatedNodeIds)) return fail('Allocated node IDs must be an array.');
    if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.rootIds)
      || typeof model.validateAllocation !== 'function' || typeof model.pointCost !== 'function') {
      return fail('A valid allocation model is required.');
    }
    if (model.nodes.some((node) => !node || typeof node.id !== 'string')) {
      return fail('Every model node must have a string ID.');
    }
    const known = new Set(model.nodes.map((node) => node.id));
    const roots = new Set(model.rootIds);
    if (known.size !== model.nodes.length) return fail('Model node IDs must be unique.');
    if (roots.size === 0 || [...roots].some((id) => typeof id !== 'string' || !known.has(id))) {
      return fail('The model has no valid starts.');
    }
    for (const id of [...allocatedNodeIds, targetNodeId]) {
      if (typeof id !== 'string') return fail('Every allocation and target node ID must be a string.');
      if (!known.has(id)) return fail(`Node ${id} is not available in this model.`);
    }
    const rules = model.routeRules;
    if (!rules || !rules.prerequisites || typeof rules.prerequisites !== 'object'
      || Array.isArray(rules.prerequisites) || !rules.choiceParents
      || typeof rules.choiceParents !== 'object' || Array.isArray(rules.choiceParents)
      || !Array.isArray(rules.supportEdges)) {
      return fail('The model is missing valid routing rules.');
    }
    if (Object.values(rules.prerequisites).some((needs) => !Array.isArray(needs)
      || needs.some((id) => typeof id !== 'string'))
      || Object.values(rules.choiceParents).some((id) => typeof id !== 'string')
      || rules.supportEdges.some((edge) => !Array.isArray(edge) || edge.length !== 2
        || edge.some((id) => typeof id !== 'string' || !known.has(id)))) {
      return fail('The model has malformed routing rules.');
    }
    const allocated = [...new Set(allocatedNodeIds)].sort();
    const validation = model.validateAllocation(allocated);
    if (!validation.valid) return fail(validation.reason || 'The current allocation is not legal.');
    const owned = new Set([...roots, ...allocated]);
    const chosen = new Map();
    for (const id of owned) {
      const parent = rules.choiceParents[id];
      if (parent === undefined) continue;
      if (chosen.has(parent) && chosen.get(parent) !== id) {
        return fail(`Node ${parent} allows only one option.`);
      }
      chosen.set(parent, id);
    }
    if (owned.has(targetNodeId)) {
      return { ok: true, nodeIds: [], pointCost: model.pointCost([]), reason: null, exact: true };
    }

    // An owned option permanently rules out its siblings, including when one
    // would otherwise be used as a connector or a connector's prerequisite.
    const blocked = new Set();
    for (const id of known) {
      const parent = rules.choiceParents[id];
      if (chosen.has(parent) && chosen.get(parent) !== id) blocked.add(id);
    }
    if (blocked.has(targetNodeId)) return fail('That node conflicts with an already allocated choice option.');
    const connectionModel = {
      nodes: model.nodes.filter((node) => !blocked.has(node.id)),
      rootIds: [...owned].sort(),
      routeRules: {
        ...rules,
        supportEdges: rules.supportEdges.filter(([from, to]) => !blocked.has(from) && !blocked.has(to)),
      },
      validateAllocation: (nodeIds) => model.validateAllocation([...allocated, ...nodeIds]),
      pointCost: (nodeIds) => model.pointCost(nodeIds),
    };
    const result = solve(connectionModel, [targetNodeId]);
    if (!result.ok) return fail(result.reason || NO_ROUTE);
    return { ...result, exact: result.exact === true };
  } catch (error) {
    return fail(error instanceof Error && error.message ? error.message : 'A connection could not be computed for this input.');
  }
}

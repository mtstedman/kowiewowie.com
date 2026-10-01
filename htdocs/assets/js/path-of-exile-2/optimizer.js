/** Exact node-count routing; point cost is reported separately from the objective. */
export const MAX_MUST_HAVES = 8;

const INF = 0x3fffffff;
const MAX_STATES = 6000000;
const MAX_WORK = 120000000;
const MAX_BRANCHES = 256;

const failure = (reason) => ({ ok: false, nodeIds: [], pointCost: null, reason });

function spend(budget, amount) {
  budget.work -= amount;
  if (budget.work < 0) {
    throw new Error('The exact search limit was reached; a minimum route cannot be guaranteed.');
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
  if (terminals.length > 16 || (2 ** terminals.length) * count > MAX_STATES) {
    throw new Error('Too many forced prerequisites for the exact search; a minimum route cannot be guaranteed.');
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
  if (required.size > MAX_MUST_HAVES) return failure(`Choose at most ${MAX_MUST_HAVES} distinct must-have nodes.`);
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
  const budget = { work: MAX_WORK };
  const pending = [{ forced: required, excluded: new Set() }];
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
    if (++branches > MAX_BRANCHES) throw new Error('The exact constraint search limit was reached; a minimum route cannot be guaranteed.');
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
  if (best === null) return failure('The must-have nodes cannot coexist or cannot be reached by a legal connected route.');
  return { ok: true, nodeIds: best, pointCost: model.pointCost(best), reason: null };
}

/** Never return a heuristic incumbent when the proof search is incomplete. */
export function findMinimalRoute(model, mustHaveNodeIds) {
  try {
    return solve(model, mustHaveNodeIds);
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'A minimum route could not be guaranteed for this input.');
  }
}

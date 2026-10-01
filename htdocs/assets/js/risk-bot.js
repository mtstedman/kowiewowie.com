import {
    NEUTRAL_ID,
    SETUP_ARMY_CAP,
    applyAction,
    cloneState,
    compareRolls,
    continentDefinitions,
    findValidSets,
    legalActions,
    reinforcementBreakdown,
    tradeValue
} from './risk-model.js';

/** @typedef {import('./risk-model.js').ModelState} ModelState */
/** @typedef {import('./risk-model.js').Territory} Territory */
/** @typedef {import('./risk-model.js').Config} Config */
/** @typedef {import('./risk-model.js').Action} Action */
/** @typedef {{timeBudgetMs?: number, maxDepth?: number, rng?: () => number}} SearchOptions */
/** @typedef {{attackerLosses: number, defenderLosses: number, probability: number, rolls: number[]}} RoundOutcome */
/** @typedef {{armies: number, defenders: number, probability: number, dice: number, outcome: RoundOutcome|null}} BattleLeaf */
/** @typedef {{action: Action, reserve: number, order: number}} Move */
/** @typedef {{state: ModelState, probability: number}} Branch */
/** @typedef {{[seat: string]: number}} Scores */
/**
 * @typedef {{deadline: number, root: string, depth: number,
 *   battles: Map<string, BattleLeaf[]>, evaluations: WeakMap<ModelState, Scores>}} Search
 */

const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
const expired = Symbol('Risk search deadline');
/** @param {Search} search */
const checkDeadline = (search) => {
    if (now() >= search.deadline) {
        throw expired;
    }
};

/* Enumerate the finite dice sample spaces once. compareRolls owns ties and losses;
 * the stored rolls are witnesses, replayed through applyAction, never samples.
 * Each table's denominators are exactly 6 ** (attackDice + defendDice).
 */
/** @type {Map<string, RoundOutcome[]>} */
const roundTables = new Map();
for (let attackDice = 1; attackDice <= 3; attackDice += 1) {
    for (let defendDice = 1; defendDice <= 2; defendDice += 1) {
        /** @type {Map<string, RoundOutcome>} */
        const outcomes = new Map();
        const combinations = 6 ** (attackDice + defendDice);
        for (let code = 0; code < combinations; code += 1) {
            let remaining = code;
            const rolls = [];
            for (let die = 0; die < attackDice + defendDice; die += 1) {
                rolls.push(remaining % 6 + 1);
                remaining = Math.floor(remaining / 6);
            }
            const result = compareRolls(rolls.slice(0, attackDice), rolls.slice(attackDice));
            const key = `${result.attackerLosses}:${result.defenderLosses}`;
            const previous = outcomes.get(key);
            if (previous) {
                previous.probability += 1;
            } else {
                outcomes.set(key, {
                    attackerLosses: result.attackerLosses,
                    defenderLosses: result.defenderLosses,
                    probability: 1,
                    rolls
                });
            }
        }
        const table = Array.from(outcomes.values());
        table.forEach((outcome) => { outcome.probability /= combinations; });
        roundTables.set(`${attackDice}:${defendDice}`, table);
    }
}

/** @param {ModelState} state @param {string} id @returns {Territory} */
const territoryAt = (state, id) => {
    const territory = state.territories.find((candidate) => candidate.id === id);
    if (!territory) {
        throw new Error(`Unknown Risk territory: ${id}`);
    }
    return territory;
};

/** @param {Territory} territory @param {Map<string, Territory>} board */
const enemiesOf = (territory, board) => territory.neighbors
    .map((id) => board.get(id))
    .filter((other) => other && other.owner !== territory.owner);

/** @param {Territory} territory @param {Map<string, Territory>} board */
const incomingForce = (territory, board) => enemiesOf(territory, board)
    .reduce((largest, other) => other && other.owner !== NEUTRAL_ID
        ? Math.max(largest, other.armies - 1) : largest, 0);

/** @param {ModelState} state @param {string} seat */
const nextCardValue = (state, seat) => {
    const hand = state.hands[seat] || [];
    const sets = findValidSets(hand);
    if (state.config.cardMode === 'fixed') {
        // Seven is a positional estimate for an incomplete future set, not a trade rule.
        return sets.length ? sets.reduce((best, cards) => Math.max(best,
            tradeValue(state.setsTraded, state.config.cardMode, cards)), 0) : 7;
    }
    const replies = state.players.filter((player) => !state.eliminated.includes(player)).length - 1;
    return 0.75 * tradeValue(state.setsTraded, state.config.cardMode)
        + 0.25 * tradeValue(state.setsTraded + replies, state.config.cardMode);
};

/** Static max^n utilities: every active seat values its own position and resists
 * the strongest rival as well as the rest of the table. Neutral has no utility
 * and is never a decision node.
 * @param {ModelState} state @param {Search} search @returns {Scores}
 */
const evaluate = (state, search) => {
    checkDeadline(search);
    const cached = search.evaluations.get(state);
    if (cached) {
        return cached;
    }
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    /** @type {Scores} */
    const position = {};
    /** @type {Scores} */
    const scores = {};
    for (const seat of state.players) {
        const owned = state.territories.filter((territory) => territory.owner === seat);
        if (!owned.length) {
            position[seat] = 0;
            continue;
        }
        const income = reinforcementBreakdown(state, seat);
        let value = owned.length * 1.8 + income.total * 4.5;
        for (const territory of owned) {
            const enemies = enemiesOf(territory, board);
            const threat = incomingForce(territory, board);
            value += territory.armies * 1.25;
            if (!enemies.length) {
                value -= Math.max(0, territory.armies - 1) * 0.24;
            } else {
                value -= Math.min(territory.armies + 2,
                    Math.max(0, threat - territory.armies + 1)) * 0.75;
                value += Math.min(territory.armies - 1, threat) * 0.12;
            }
        }
        for (const continent of continentDefinitions) {
            const members = state.territories.filter((territory) => territory.continent === continent.id);
            const count = members.filter((territory) => territory.owner === seat).length;
            if (count && count < members.length) {
                value += continent.bonus * 2.5 * (count / members.length) ** 4;
            }
        }
        const hand = state.hands[seat] || [];
        const cardValue = nextCardValue(state, seat);
        value += hand.length * cardValue * 0.25;
        if (findValidSets(hand).length) {
            value += cardValue * 0.2;
        }
        if (state.current === seat) {
            value += state.reinforcementRemaining * 1.25;
            if (state.conqueredThisTurn) {
                value += cardValue * 0.25;
            }
        }
        // A nearly eliminated rival is valuable particularly when it holds cards.
        for (const rival of state.players) {
            if (rival === seat) {
                continue;
            }
            const remaining = state.territories.filter((territory) => territory.owner === rival);
            if (!remaining.length || remaining.length > 3) {
                continue;
            }
            let force = 0;
            let resistance = 0;
            const stacks = new Set();
            for (const target of remaining) {
                resistance += target.armies + 1;
                for (const id of target.neighbors) {
                    const source = board.get(id);
                    if (source && source.owner === seat && !stacks.has(id)) {
                        stacks.add(id);
                        force += Math.max(0, source.armies - 1);
                    }
                }
            }
            const reward = 4 + (state.hands[rival] || []).length * cardValue / 3;
            value += reward * Math.min(1, force / Math.max(1, resistance)) / (remaining.length + 1);
        }
        position[seat] = value;
    }
    for (const seat of state.players) {
        if (state.winner) {
            scores[seat] = state.winner === seat ? 1000000 : -1000000;
        } else if (!position[seat]) {
            scores[seat] = -1000000;
        } else {
            const rivals = state.players.filter((other) => other !== seat && position[other] > 0)
                .map((other) => position[other]);
            scores[seat] = position[seat] - (rivals.length
                ? Math.max(...rivals) * 0.55 + rivals.reduce((sum, value) => sum + value, 0) * 0.45 / rivals.length
                : 0);
        }
    }
    search.evaluations.set(state, scores);
    return scores;
};

/** Exact absorbing combat distribution. This is forward dynamic programming on
 * (attacker armies, defender armies); each round decreases one or both axes.
 * Summing leaves with defenders === 0 gives the conquest probability. We retain
 * the final dice count as well, because it determines the model's move-in minimum.
 * @param {number} armies @param {number} defenders @param {number} reserve
 * @param {number} firstDice @param {Search} search @returns {BattleLeaf[]}
 */
const battleDistribution = (armies, defenders, reserve, firstDice, search) => {
    const cacheKey = `${armies}:${defenders}:${reserve}:${firstDice}`;
    const cached = search.battles.get(cacheKey);
    if (cached) {
        return cached;
    }
    /** @type {Map<number, Map<number, number>>} */
    const rows = new Map([[armies, new Map([[defenders, 1]])]]);
    /** @type {Map<string, BattleLeaf>} */
    const leaves = new Map();
    /** @param {number} a @param {number} d @param {number} probability
     * @param {number} dice @param {RoundOutcome|null} outcome */
    const absorb = (a, d, probability, dice, outcome) => {
        const key = `${a}:${d}:${dice}`;
        const previous = leaves.get(key);
        if (previous) {
            previous.probability += probability;
        } else {
            leaves.set(key, { armies: a, defenders: d, probability, dice, outcome });
        }
    };
    for (let a = armies; a >= 1; a -= 1) {
        checkDeadline(search);
        const row = rows.get(a);
        if (!row) {
            continue;
        }
        for (let d = defenders; d >= 1; d -= 1) {
            if (d % 32 === 0) {
                checkDeadline(search);
            }
            const mass = row.get(d);
            if (!mass) {
                continue;
            }
            if (a <= reserve || a < 2) {
                absorb(a, d, mass, 0, null);
                continue;
            }
            const dice = a === armies && d === defenders ? firstDice : Math.min(3, a - 1);
            const outcomes = roundTables.get(`${dice}:${Math.min(2, d)}`) || [];
            for (const outcome of outcomes) {
                const nextA = a - outcome.attackerLosses;
                const nextD = d - outcome.defenderLosses;
                const probability = mass * outcome.probability;
                if (nextD === 0) {
                    absorb(nextA, 0, probability, dice, outcome);
                } else {
                    let nextRow = rows.get(nextA);
                    if (!nextRow) {
                        nextRow = new Map();
                        rows.set(nextA, nextRow);
                    }
                    nextRow.set(nextD, (nextRow.get(nextD) || 0) + probability);
                }
            }
        }
        rows.delete(a);
    }
    const result = Array.from(leaves.values());
    search.battles.set(cacheKey, result);
    return result;
};

/** Replay an exact dice outcome through the rules engine.
 * @param {ModelState} state @param {Action} action @param {RoundOutcome} outcome
 */
const applyOutcome = (state, action, outcome) => {
    let index = 0;
    return applyAction(state, action, () => (outcome.rolls[index++] - 0.5) / 6);
};

/** @param {ModelState} state @param {Territory} target @param {string} seat */
const targetValue = (state, target, seat) => {
    const members = state.territories.filter((territory) => territory.continent === target.continent);
    const bonus = continentDefinitions.find((continent) => continent.id === target.continent)?.bonus || 0;
    const own = members.filter((territory) => territory.owner === seat).length;
    let value = 3 + bonus * (own + 1) / members.length;
    if (own === members.length - 1) {
        value += bonus * 7;
    }
    if (target.owner !== NEUTRAL_ID && members.every((territory) => territory.owner === target.owner)) {
        value += bonus * 5;
    }
    if (!state.conqueredThisTurn) {
        value += nextCardValue(state, seat) / 3;
    }
    if (state.players.includes(target.owner)
        && state.territories.filter((territory) => territory.owner === target.owner).length === 1) {
        value += 14 + (state.hands[target.owner] || []).length * nextCardValue(state, seat) / 3;
    }
    return value;
};

/** Candidate reinforcement destinations serve either an attack or border defence.
 * @param {ModelState} state @param {Territory} territory @param {number} count
 * @param {Map<string, Territory>} board
 */
const placementValue = (state, territory, count, board) => {
    const enemies = enemiesOf(territory, board);
    const defence = Math.min(count, Math.max(0, incomingForce(territory, board) + 1 - territory.armies));
    let attack = 0;
    for (const target of enemies) {
        if (target) {
            const before = territory.armies - 1 - target.armies * 1.2;
            const after = before + count;
            const gain = 1 / (1 + Math.exp(-after / 2)) - 1 / (1 + Math.exp(-before / 2));
            attack = Math.max(attack, gain * targetValue(state, target, state.current));
        }
    }
    return attack + defence * 1.3 + Math.min(count, 5) * (enemies.length ? 0.3 : -0.3);
};

/** Candidate ordering is cheap; chance-weighted evaluation follows before search.
 * The pass action is always retained, even if outside the beam.
 * @param {ModelState} state @param {Action[]} actions @param {number} width
 * @param {number} campaigns @param {Search} search @returns {Move[]}
 */
const candidates = (state, actions, width, campaigns, search) => {
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    /** @type {Move[]} */
    const moves = [];
    /** @type {Move|null} */
    let pass = null;
    for (let index = 0; index < actions.length; index += 1) {
        if (index % 32 === 0) {
            checkDeadline(search);
        }
        const action = actions[index];
        let order = 0;
        if (action.type === 'end-attack' || action.type === 'end-turn') {
            pass = { action, reserve: 1, order: 0 };
            continue;
        }
        if (action.type === 'attack') {
            if (campaigns <= 0) {
                continue;
            }
            const source = territoryAt(state, action.sourceId);
            const target = territoryAt(state, action.targetId);
            if (action.dice !== Math.min(3, source.armies - 1)) {
                continue;
            }
            const margin = source.armies - 1 - target.armies * 1.15;
            order = targetValue(state, target, state.current) / (1 + Math.exp(-margin / 2))
                - Math.min(source.armies - 1, target.armies) * 0.85;
            const reserve = Math.min(source.armies - 1,
                Math.max(1, Math.ceil(incomingForce(source, board) * 0.65)));
            if (reserve > 1) {
                moves.push({ action, reserve, order: order - 0.1 });
            }
        } else if (action.type === 'place') {
            const total = state.reinforcementRemaining;
            if (action.count !== total && action.count !== Math.ceil(total / 2)) {
                continue;
            }
            order = placementValue(state, territoryAt(state, action.territoryId), action.count, board);
        } else if (action.type === 'trade') {
            const cards = (state.hands[state.current] || []).filter((card) => action.cardIds.includes(card.id));
            order = tradeValue(state.setsTraded, state.config.cardMode, cards) * 1.3;
            if (action.bonusTerritoryId) {
                order += placementValue(state, territoryAt(state, action.bonusTerritoryId), 2, board);
            }
        } else if (action.type === 'occupy') {
            const pending = state.pendingConquest;
            if (!pending || (action.count !== pending.min && action.count !== pending.max
                && action.count !== Math.round((pending.min + pending.max) / 2))) {
                continue;
            }
            const source = territoryAt(state, pending.sourceId);
            const target = territoryAt(state, pending.targetId);
            const extra = action.count - pending.min;
            order = placementValue(state, target, extra, board)
                - Math.max(0, incomingForce(source, board) + 1 - source.armies + extra) * 0.9;
            if (!enemiesOf(source, board).length) {
                order += extra * 0.3;
            }
        } else if (action.type === 'fortify') {
            const source = territoryAt(state, action.sourceId);
            const target = territoryAt(state, action.targetId);
            order = placementValue(state, target, action.count, board)
                - Math.max(0, incomingForce(source, board) + 1 - source.armies + action.count) * 1.3;
            if (!enemiesOf(source, board).length) {
                order += action.count * 0.3;
            }
        }
        moves.push({ action, reserve: 1, order });
    }
    moves.sort((first, second) => second.order - first.order);
    const selected = moves.slice(0, width);
    if (pass) {
        selected.push(pass);
    }
    return selected;
};

/** Finish a split reinforcement plan with a second, strategically selected stack.
 * The returned first action still belongs to legalActions; subsequent calls can
 * reconsider the remainder after the real caller applies it.
 * @param {ModelState} state @param {Action} first @param {Search} search
 */
const finishPlacement = (state, first, search) => {
    if (first.type !== 'place' || state.phase !== 'reinforce') {
        return;
    }
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    const placements = legalActions(state).filter((action) => action.type === 'place'
        && action.count === state.reinforcementRemaining);
    let best = placements[0];
    let bestValue = -Infinity;
    for (const action of placements) {
        checkDeadline(search);
        if (action.type !== 'place') {
            continue;
        }
        const value = placementValue(state, territoryAt(state, action.territoryId), action.count, board);
        if (value > bestValue) {
            best = action;
            bestValue = value;
        }
    }
    if (best) {
        applyAction(state, best, () => 0.5);
    }
};

/** Produce all campaign outcomes with their exact mass. Only casualty counts are
 * materialized by the DP; the final winning roll goes through applyAction so
 * occupation, elimination, captured cards and victory remain model-owned rules.
 * @param {ModelState} state @param {Move} move @param {Search} search @returns {Branch[]}
 */
const branches = (state, move, search) => {
    checkDeadline(search);
    const action = move.action;
    if (action.type !== 'attack') {
        const child = applyAction(cloneState(state), action, () => 0.5);
        finishPlacement(child, action, search);
        return [{ state: child, probability: 1 }];
    }
    const source = territoryAt(state, action.sourceId);
    const target = territoryAt(state, action.targetId);
    const distribution = battleDistribution(source.armies, target.armies, move.reserve, action.dice, search);
    return distribution.map((leaf) => {
        checkDeadline(search);
        const child = cloneState(state);
        const attacker = territoryAt(child, action.sourceId);
        const defender = territoryAt(child, action.targetId);
        attacker.armies = leaf.armies;
        defender.armies = leaf.defenders;
        if (leaf.outcome) {
            attacker.armies += leaf.outcome.attackerLosses;
            defender.armies += leaf.outcome.defenderLosses;
            applyOutcome(child, { ...action, dice: leaf.dice }, leaf.outcome);
        }
        return { state: child, probability: leaf.probability };
    });
};

/** Finish mandatory occupation before a static horizon. A conquest should be
 * evaluated with a useful legal move-in, rather than the compulsory minimum that
 * applyAttack moves immediately. This is itself a small max^n decision node.
 * @param {ModelState} state @param {Search} search @returns {Scores}
 */
const horizon = (state, search) => {
    if (state.phase !== 'conquer') {
        return evaluate(state, search);
    }
    const moves = candidates(state, legalActions(state), 3, 0, search);
    let best = evaluate(state, search);
    let bestValue = -Infinity;
    for (const move of moves) {
        checkDeadline(search);
        const child = applyAction(cloneState(state), move.action, () => 0.5);
        const value = evaluate(child, search);
        if (value[state.current] > bestValue) {
            bestValue = value[state.current];
            best = value;
        }
    }
    return best;
};

/** @param {ModelState} state @returns {Scores} */
const zeroScores = (state) => {
    /** @type {Scores} */
    const scores = {};
    state.players.forEach((seat) => { scores[seat] = 0; });
    return scores;
};

/** @param {Scores} into @param {Scores} value @param {number} probability */
const addScores = (into, value, probability) => {
    for (const seat of Object.keys(into)) {
        into[seat] += probability * value[seat];
    }
};

/** @typedef {{move: Move, outcomes: Branch[], scores: Scores}} RankedMove */
/** @param {ModelState} state @param {Move[]} moves @param {Search} search @returns {RankedMove[]} */
const rankMoves = (state, moves, search) => {
    const ranked = moves.map((move) => {
        const outcomes = branches(state, move, search);
        const scores = zeroScores(state);
        for (const outcome of outcomes) {
            addScores(scores, horizon(outcome.state, search), outcome.probability);
        }
        return { move, outcomes, scores };
    });
    ranked.sort((first, second) => second.scores[state.current] - first.scores[state.current]);
    return ranked;
};

/** A full turn horizon includes the acting seat and each surviving opponent.
 * Beam width and campaigns per turn grow with each iteration. At chance nodes,
 * low-ranked probability branches have a static horizon; their exact probability
 * mass is STILL included. More probable branches receive the deeper turn search.
 * This selective expectimax avoids exponential dice trees without random sampling
 * or renormalizing away unfavourable outcomes.
 * @param {ModelState} state @param {Set<string>} remainingSeats
 * @param {number} campaigns @param {Search} search @returns {Scores}
 */
const searchPosition = (state, remainingSeats, campaigns, search) => {
    checkDeadline(search);
    if (state.winner || !remainingSeats.has(state.current)) {
        return evaluate(state, search);
    }
    const legal = legalActions(state);
    const moves = candidates(state, legal, Math.min(5, search.depth + 1), campaigns, search);
    if (!moves.length) {
        return evaluate(state, search);
    }
    const ranked = rankMoves(state, moves, search);
    // A narrow principal variation establishes a complete reply round first.
    // Later iterations widen max^n decision nodes as well as chance continuations.
    const beam = ranked.slice(0, Math.min(3, search.depth));
    /** @type {Scores|null} */
    let best = null;
    for (const entry of beam) {
        const value = searchMove(state, entry, remainingSeats, campaigns, search);
        if (!best || value[state.current] > best[state.current]) {
            best = value;
        }
    }
    return best || evaluate(state, search);
};

/** @param {ModelState} state @param {RankedMove} entry @param {Set<string>} remainingSeats
 * @param {number} campaigns @param {Search} search @returns {Scores}
 */
const searchMove = (state, entry, remainingSeats, campaigns, search) => {
    const action = entry.move.action;
    const nextSeats = new Set(remainingSeats);
    if (action.type === 'end-turn') {
        nextSeats.delete(state.current);
    }
    const nextCampaigns = action.type === 'end-turn' ? search.depth
        : campaigns - (action.type === 'attack' ? 1 : 0);
    const outcomes = entry.outcomes.slice().sort((first, second) => second.probability - first.probability);
    const value = zeroScores(state);
    for (let index = 0; index < outcomes.length; index += 1) {
        checkDeadline(search);
        const outcome = outcomes[index];
        const scores = index < search.depth
            ? searchPosition(outcome.state, nextSeats, nextCampaigns, search)
            : horizon(outcome.state, search);
        addScores(value, scores, outcome.probability);
    }
    return value;
};

/** Choose one legal action without changing the caller's state. maxDepth bounds
 * campaigns per turn and beam widening, not individual dice rolls. Use a finite
 * maxDepth with timeBudgetMs: Infinity for reproducible, purely depth-bound play.
 * Each real attack removes at least one army, placements consume a finite pool,
 * trades consume three cards and fortification is single-use: repeated calls
 * therefore cannot cycle within a turn.
 * @param {ModelState} state @param {string} seat @param {SearchOptions} [options]
 * @returns {Action}
 */
export const chooseBotAction = (state, seat, options = {}) => {
    const started = now();
    if (state.current !== seat) {
        throw new Error('The bot can only choose for the current Risk seat.');
    }
    const legal = legalActions(state);
    if (!legal.length) {
        throw new Error('There is no legal action in this Risk state.');
    }
    const budget = options.timeBudgetMs === Infinity ? Infinity
        : Number.isFinite(options.timeBudgetMs) ? Math.max(0, Number(options.timeBudgetMs)) : 250;
    const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(0, Math.floor(Number(options.maxDepth))) : 4;
    const rng = options.rng || Math.random;
    /** @type {Search} */
    const search = { deadline: started + budget, root: seat, depth: 1,
        battles: new Map(), evaluations: new WeakMap() };
    let best = legal.find((action) => action.type === 'end-attack' || action.type === 'end-turn') || legal[0];
    if (legal.length === 1) {
        return best;
    }
    try {
        const moves = candidates(state, legal, 10, Math.max(1, maxDepth), search);
        // Score the pass first so even an interrupted first iteration compares
        // completed campaigns against stopping, rather than attacking by default.
        moves.sort((first, second) => Number(second.action.type === 'end-attack'
            || second.action.type === 'end-turn') - Number(first.action.type === 'end-attack'
            || first.action.type === 'end-turn'));
        /** @type {RankedMove[]} */
        const ranked = [];
        let shallowValue = -Infinity;
        for (const move of moves) {
            const entry = rankMoves(state, [move], search)[0];
            ranked.push(entry);
            if (entry.scores[seat] > shallowValue + 1e-9) {
                shallowValue = entry.scores[seat];
                best = entry.move.action;
            }
        }
        ranked.sort((first, second) => second.scores[seat] - first.scores[seat]);
        const remainingSeats = new Set(state.players.filter((player) => !state.eliminated.includes(player)));
        for (let depth = 1; depth <= maxDepth; depth += 1) {
            search.depth = depth;
            let iterationBest = best;
            let bestValue = -Infinity;
            let ties = 0;
            const rootBeam = ranked.slice(0, 3 + depth * 2);
            const pass = ranked.find((entry) => entry.move.action.type === 'end-attack'
                || entry.move.action.type === 'end-turn');
            if (pass && !rootBeam.includes(pass)) {
                rootBeam.push(pass);
            }
            for (const entry of rootBeam) {
                const value = searchMove(state, entry, remainingSeats, depth, search)[seat];
                if (value > bestValue + 1e-9) {
                    bestValue = value;
                    iterationBest = entry.move.action;
                    ties = 1;
                } else if (Math.abs(value - bestValue) <= 1e-9) {
                    ties += 1;
                    if (rng() < 1 / ties) {
                        iterationBest = entry.move.action;
                    }
                }
            }
            // Publish only complete iterations: compare actions at the same horizon.
            best = iterationBest;
        }
    } catch (error) {
        if (error !== expired) {
            throw error;
        }
    }
    return best;
};

/** Evaluate manual setup placements on copies. Diminishing defensive returns and
 * an explicit stacking cost spread armies among useful borders. Neutral placements
 * obstruct opponents, but neutral armies never contribute an attacking threat.
 * @param {Territory[]} territories @param {string} seat @param {'own'|'neutral'} target
 * @param {Config} config @param {() => number} [rng] @returns {string}
 */
export const chooseSetupPlacement = (territories, seat, target, config, rng = Math.random) => {
    const owner = target === 'neutral' ? NEUTRAL_ID : seat;
    const owned = territories.filter((territory) => territory.owner === owner);
    const underCap = owned.filter((territory) => territory.armies < SETUP_ARMY_CAP);
    const candidates = underCap.length ? underCap : owned;
    if (!candidates.length) {
        throw new Error(`No setup territory is owned by ${owner}.`);
    }
    let best = candidates[0].id;
    let bestValue = -Infinity;
    let ties = 0;
    for (const candidate of candidates) {
        const placed = { ...candidate, armies: candidate.armies + 1 };
        const board = new Map(territories.map((territory) => [territory.id,
            territory.id === candidate.id ? placed : territory]));
        const neighbors = placed.neighbors.map((id) => board.get(id)).filter((territory) => territory);
        let value = -candidate.armies * 1.4;
        if (target === 'neutral') {
            for (const neighbor of neighbors) {
                if (!neighbor || neighbor.owner === NEUTRAL_ID) {
                    continue;
                }
                const benefit = (1 + Math.min(neighbor.armies, placed.armies) / placed.armies);
                value += neighbor.owner === seat ? -benefit * 1.5 : benefit;
            }
        } else {
            const hostile = neighbors.filter((neighbor) => neighbor && neighbor.owner !== seat);
            const threat = incomingForce(placed, board);
            value += hostile.length * 0.8 + Math.min(1, Math.max(0, threat + 1 - candidate.armies)) * 2;
            const members = territories.filter((territory) => territory.continent === placed.continent);
            const share = members.filter((territory) => territory.owner === seat).length / members.length;
            const bonus = continentDefinitions.find((continent) => continent.id === placed.continent)?.bonus || 0;
            value += share * share * bonus / placed.armies;
            for (const neighbor of hostile) {
                if (neighbor) {
                    value += Math.min(1, placed.armies / (neighbor.armies + 1))
                        * (config.cardMode === 'incremental' ? 0.7 : 0.6);
                }
            }
        }
        if (value > bestValue + 1e-9) {
            bestValue = value;
            best = candidate.id;
            ties = 1;
        } else if (Math.abs(value - bestValue) <= 1e-9) {
            ties += 1;
            if (rng() < 1 / ties) {
                best = candidate.id;
            }
        }
    }
    return best;
};

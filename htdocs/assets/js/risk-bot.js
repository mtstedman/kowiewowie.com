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
/** @typedef {{action: Action, reserve: number, order: number, protected?: boolean}} Move */
/** @typedef {{sourceId: string, targetId: string, probability: number, value: number}} Campaign */
/** @typedef {{state: ModelState, probability: number}} Branch */
/** @typedef {{[seat: string]: number}} Scores */
/**
 * @typedef {{deadline: number, root: string, depth: number, rng: () => number,
 *   battles: Map<string, BattleLeaf[]>, evaluations: Map<string, Scores>,
 *   campaigns: Map<string, Campaign[]>}} Search
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

/** Canonical, per-search keys include every rule field, including card order in the
 * draw pile. Territory and hand order do not distinguish equivalent positions.
 * @param {ModelState} state
 */
const stateKey = (state) => JSON.stringify([
    Object.entries(state.config).sort(([a], [b]) => a.localeCompare(b)),
    state.players, state.eliminated.slice().sort(), state.current, state.phase,
    state.territories.map((territory) => [territory.id, territory.owner, territory.armies,
        territory.continent, territory.neighbors.slice().sort()])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    Object.keys(state.hands).sort().map((seat) => [seat,
        state.hands[seat].slice().sort((a, b) => a.id.localeCompare(b.id))]),
    state.deck, state.discard, state.setsTraded, state.reinforcementRemaining,
    state.pictureBonusUsed, state.conqueredThisTurn, state.fortifiedThisTurn,
    state.pendingConquest, state.winner
]);

/** Project one reinforcement pool per opponent, never one pool per adjacent stack.
 * The optional-trade likelihood is a tunable positional estimate.
 * @param {ModelState} state @returns {Map<string, number>}
 */
const projectedIncome = (state) => new Map(state.players.map((seat) => {
    const hand = state.hands[seat] || [];
    const trade = findValidSets(hand).length ? nextCardValue(state, seat) * (hand.length >= 5 ? 1 : 0.75) : 0;
    return [seat, reinforcementBreakdown(state, seat).total + trade];
}));

/** @param {Territory} territory @param {Map<string, Territory>} board
 * @param {Map<string, number>} income @returns {Map<string, number>}
 */
const incomingForce = (territory, board, income) => {
    /** @type {Map<string, number>} */
    const forces = new Map();
    for (const other of enemiesOf(territory, board)) {
        if (other && other.owner !== NEUTRAL_ID) {
            forces.set(other.owner, (forces.get(other.owner) || 0) + Math.max(0, other.armies - 1));
        }
    }
    for (const [owner, force] of forces) {
        forces.set(owner, force + (income.get(owner) || 0));
    }
    return forces;
};

/** Exact combat conditional on a projected force. Fractional income is a mixture
 * of the two adjacent integer forces, not a fractional dice state.
 * @param {number} force @param {number} defenders @param {Search} search
 */
const conquestProbability = (force, defenders, search) => {
    const low = Math.max(0, Math.floor(force));
    const fraction = Math.max(0, force - low);
    /** @param {number} available */
    const win = (available) => available < 1 ? 0
        : battleDistribution(available + 1, defenders, 1, Math.min(3, available), search)
            .reduce((sum, leaf) => sum + (leaf.defenders === 0 ? leaf.probability : 0), 0);
    return win(low) * (1 - fraction) + (fraction ? win(low + 1) * fraction : 0);
};

/** @param {Territory} territory @param {Map<string, Territory>} board
 * @param {Map<string, number>} income @param {Search} search
 */
const breachProbabilities = (territory, board, income, search) => new Map(
    Array.from(incomingForce(territory, board, income), ([owner, force]) =>
        [owner, conquestProbability(force, territory.armies, search)]));

/** @param {Territory[]} members @param {Map<string, Territory>} board */
const borderCount = (members, board) => Math.max(1, members.filter((territory) =>
    territory.neighbors.some((id) => board.get(id)?.continent !== territory.continent)).length);

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

/** Bounded simple paths carry the entire survivor distribution into the next
 * battle, leaving one garrison behind at every conquest. Search bounds limit
 * which paths are considered, never their dice probabilities.
 * @param {ModelState} state @param {string} seat @param {Search} search
 * @returns {Campaign[]}
 */
const campaignPlans = (state, seat, search) => {
    const key = `${seat}:${stateKey(state)}`;
    const cached = search.campaigns.get(key);
    if (cached) {
        return cached;
    }
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    /** @type {{targets: Territory[], reward: number}[]} */
    const goals = [];
    for (const rival of state.players) {
        if (rival === seat) {
            continue;
        }
        const targets = state.territories.filter((territory) => territory.owner === rival);
        if (targets.length && targets.length <= 6) {
            goals.push({ targets, reward: 14 + targets.length * 1.8
                + (state.hands[rival] || []).length * nextCardValue(state, seat) / 3 });
        }
    }
    for (const continent of continentDefinitions) {
        const members = state.territories.filter((territory) => territory.continent === continent.id);
        const targets = members.filter((territory) => territory.owner !== seat);
        if (targets.length && targets.length <= 6) {
            goals.push({ targets, reward: targets.length * 1.8
                + continent.bonus * 4.5 / Math.sqrt(borderCount(members, board)) });
        }
    }
    /** @type {Campaign[]} */
    const plans = [];
    for (const goal of goals) {
        let visited = 0;
        /** @type {Campaign[]} */
        const completed = [];
        const targetIds = new Set(goal.targets.map((territory) => territory.id));
        const sources = state.territories.filter((territory) => territory.owner === seat && territory.armies > 2)
            .sort((a, b) => b.armies - a.armies || a.id.localeCompare(b.id));
        for (const source of sources) {
            /** @param {Territory} current @param {string[]} path
             * @param {Map<number, number>} survivors
             */
            const extend = (current, path, survivors) => {
                checkDeadline(search);
                if (visited >= 96) {
                    return;
                }
                for (const id of current.neighbors) {
                    const target = board.get(id);
                    if (!target || !targetIds.has(id) || path.includes(id)) {
                        continue;
                    }
                    visited += 1;
                    /** @type {Map<number, number>} */
                    const next = new Map();
                    for (const [armies, mass] of survivors) {
                        if (armies < 2) {
                            continue;
                        }
                        for (const leaf of battleDistribution(armies, target.armies, 1, Math.min(3, armies - 1), search)) {
                            if (!leaf.defenders) {
                                const moved = leaf.armies - 1;
                                next.set(moved, (next.get(moved) || 0) + mass * leaf.probability);
                            }
                        }
                    }
                    const nextPath = [...path, id];
                    if (nextPath.length === goal.targets.length) {
                        const probability = Array.from(next.values()).reduce((sum, mass) => sum + mass, 0);
                        const survivorsExpected = Array.from(next).reduce((sum, [armies, mass]) =>
                            sum + (armies + nextPath.length) * mass, 0);
                        completed.push({ sourceId: source.id, targetId: nextPath[0], probability,
                            value: probability * goal.reward - (source.armies - survivorsExpected) * 0.8 });
                    } else if (next.size) {
                        extend(target, nextPath, next);
                    }
                    if (visited >= 96) {
                        break;
                    }
                }
            };
            extend(source, [], new Map([[source.armies, 1]]));
            if (visited >= 96) {
                break;
            }
        }
        completed.sort((a, b) => b.value - a.value);
        if (completed.length) {
            plans.push(completed[0]);
        }
    }
    plans.sort((a, b) => b.value - a.value);
    search.campaigns.set(key, plans);
    return plans;
};

/** Static max^n utilities: every active seat values its own position and resists
 * the strongest rival as well as the rest of the table. Neutral has no utility
 * and is never a decision node.
 * @param {ModelState} state @param {Search} search @returns {Scores}
 */
const evaluate = (state, search) => {
    checkDeadline(search);
    const key = stateKey(state);
    const cached = search.evaluations.get(key);
    if (cached) {
        return cached;
    }
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    const incomeBySeat = projectedIncome(state);
    /** @type {Map<string, {target: Territory, probability: number, value: number}>} */
    const replies = new Map();
    for (const territory of state.territories) {
        if (territory.owner === NEUTRAL_ID) {
            continue;
        }
        const members = state.territories.filter((member) => member.continent === territory.continent);
        const bonus = members.every((member) => member.owner === territory.owner)
            ? (continentDefinitions.find((continent) => continent.id === territory.continent)?.bonus || 0)
                / Math.sqrt(borderCount(members, board)) : 0;
        for (const [rival, probability] of breachProbabilities(territory, board, incomeBySeat, search)) {
            const value = probability * (1.8 + territory.armies * 0.35 + bonus * 4.5);
            if (value > (replies.get(rival)?.value || 0)) {
                replies.set(rival, { target: territory, probability, value });
            }
        }
    }
    /** @type {Scores} */
    const breaking = Object.fromEntries(state.players.map((seat) => [seat, 0]));
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
        checkDeadline(search);
        const income = reinforcementBreakdown(state, seat);
        let value = owned.length * 1.8 + income.base * 4.5;
        for (const territory of owned) {
            value += territory.armies * 1.25;
            if (!enemiesOf(territory, board).length) {
                value -= Math.max(0, territory.armies - 1) * 0.24;
            }
        }
        // Each opponent commits its projected pool to its single best breach,
        // including the value of breaking a continent when choosing that reply.
        for (const reply of replies.values()) {
            if (reply.target.owner === seat) {
                value -= reply.probability * (1.8 + reply.target.armies * 0.35);
            }
        }
        for (const continent of continentDefinitions) {
            const members = state.territories.filter((territory) => territory.continent === continent.id);
            const count = members.filter((territory) => territory.owner === seat).length;
            const defensibility = 1 / Math.sqrt(borderCount(members, board));
            if (count && count === members.length) {
                let retained = 1;
                for (const rival of state.players) {
                    if (rival === seat) {
                        continue;
                    }
                    const reply = replies.get(rival);
                    const breach = reply && reply.target.owner === seat && reply.target.continent === continent.id
                        ? reply.probability : 0;
                    // P(no border falls) under the selected one-breach replies.
                    // Independence between opponents is a tunable approximation.
                    retained *= 1 - breach;
                    breaking[rival] = Math.max(breaking[rival], continent.bonus * defensibility * breach * 2);
                }
                value += continent.bonus * 4.5 * defensibility * retained;
            } else if (count) {
                value += continent.bonus * 2.5 * defensibility * (count / members.length) ** 4;
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
        const campaign = campaignPlans(state, seat, search)[0];
        const canContinue = state.current === seat && (state.phase === 'attack'
            || state.phase === 'reinforce' || state.phase === 'conquer');
        value += Math.max(0, campaign?.value || 0) * (canContinue ? 0.8 : 0.25);
        position[seat] = value;
    }
    for (const seat of state.players) {
        if (position[seat]) {
            position[seat] += breaking[seat];
        }
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
    checkDeadline(search);
    search.evaluations.set(key, scores);
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
    checkDeadline(search);
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
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    const bonus = (continentDefinitions.find((continent) => continent.id === target.continent)?.bonus || 0)
        / Math.sqrt(borderCount(members, board));
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

/** Candidate reinforcement destinations use the same exact hold probabilities
 * and bonus-per-border weighting as the leaf evaluation.
 * @param {ModelState} state @param {Territory} territory @param {number} count
 * @param {Map<string, Territory>} board @param {Search} search
 * @param {Map<string, number>} [income]
 */
const placementValue = (state, territory, count, board, search, income = projectedIncome(state)) => {
    const enemies = enemiesOf(territory, board);
    let beforeHold = 1;
    let afterHold = 1;
    for (const force of incomingForce(territory, board, income).values()) {
        beforeHold *= 1 - conquestProbability(force, territory.armies, search);
        afterHold *= 1 - conquestProbability(force, territory.armies + count, search);
    }
    const members = state.territories.filter((member) => member.continent === territory.continent);
    const bonus = continentDefinitions.find((continent) => continent.id === territory.continent)?.bonus || 0;
    const share = members.filter((member) => member.owner === territory.owner).length / members.length;
    const defence = (afterHold - beforeHold) * (territory.armies * 0.35 + 1.8
        + bonus * 4.5 * share ** 4 / Math.sqrt(borderCount(members, board)));
    let attack = 0;
    for (const target of enemies) {
        if (target) {
            const gain = conquestProbability(territory.armies + count - 1, target.armies, search)
                - conquestProbability(territory.armies - 1, target.armies, search);
            attack = Math.max(attack, gain * targetValue(state, target, territory.owner));
        }
    }
    return attack + defence + Math.min(count, 5) * (enemies.length ? 0.3 : -0.3);
};

/** Candidate ordering is cheap; chance-weighted evaluation follows before search.
 * The pass action is always retained, even if outside the beam.
 * @param {ModelState} state @param {Action[]} actions @param {number} width
 * @param {number} campaigns @param {Search} search @returns {Move[]}
 */
const candidates = (state, actions, width, campaigns, search) => {
    const board = new Map(state.territories.map((territory) => [territory.id, territory]));
    const income = projectedIncome(state);
    const plans = state.phase === 'attack' && campaigns > 0 ? campaignPlans(state, state.current, search) : [];
    /** @type {Move[]} */
    const moves = [];
    /** @type {Move|null} */
    let pass = null;
    /** @type {Move|null} */
    let bestBreak = null;
    let breakValue = -Infinity;
    for (let index = 0; index < actions.length; index += 1) {
        checkDeadline(search);
        const action = actions[index];
        let order = 0;
        let protectedMove = false;
        if (action.type === 'end-attack' || action.type === 'end-turn') {
            pass = { action, reserve: 1, order: state.phase === 'fortify'
                ? evaluate(state, search)[state.current] : 0 };
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
            const win = conquestProbability(source.armies - 1, target.armies, search);
            const plan = plans.find((candidate) => candidate.sourceId === source.id && candidate.targetId === target.id);
            order = win * targetValue(state, target, state.current)
                - Math.min(source.armies - 1, target.armies) * 0.85 + Math.max(0, plan?.value || 0);
            protectedMove = !!plans[0] && plans[0].sourceId === source.id && plans[0].targetId === target.id;
            const members = state.territories.filter((territory) => territory.continent === target.continent);
            if (target.owner !== NEUTRAL_ID && members.every((territory) => territory.owner === target.owner)) {
                const bonus = continentDefinitions.find((continent) => continent.id === target.continent)?.bonus || 0;
                const value = win * bonus / Math.sqrt(borderCount(members, board));
                if (value > breakValue) {
                    breakValue = value;
                    bestBreak = { action, reserve: 1, order, protected: true };
                }
            }
            const threat = Math.max(0, ...incomingForce(source, board, income).values());
            const reserve = Math.min(source.armies - 1, Math.max(1, Math.ceil(threat * 0.65)));
            if (reserve > 1) {
                moves.push({ action, reserve, order: order - 0.1 });
            }
        } else if (action.type === 'place') {
            const total = state.reinforcementRemaining;
            if (action.count !== total && action.count !== Math.ceil(total / 2)) {
                continue;
            }
            order = placementValue(state, territoryAt(state, action.territoryId), action.count, board, search, income);
        } else if (action.type === 'trade') {
            const child = applyAction(cloneState(state), action, () => 0.5);
            finishPlacement(child, action, search);
            // The held hand retains its nextCardValue, including incremental
            // escalation. Compare that position with actually investing this trade.
            order = evaluate(child, search)[state.current] - evaluate(state, search)[state.current];
        } else if (action.type === 'occupy') {
            const pending = state.pendingConquest;
            if (!pending || (action.count !== pending.min && action.count !== pending.max
                && action.count !== Math.round((pending.min + pending.max) / 2))) {
                continue;
            }
            order = evaluate(applyAction(cloneState(state), action, () => 0.5), search)[state.current];
        } else if (action.type === 'fortify') {
            order = evaluate(applyAction(cloneState(state), action, () => 0.5), search)[state.current];
        }
        moves.push({ action, reserve: 1, order, protected: protectedMove });
    }
    moves.sort((first, second) => second.order - first.order);
    // Retain both sides of optional trade timing, plus strategic attack entries.
    const bestTrade = moves.find((move) => move.action.type === 'trade');
    const bestHold = moves.find((move) => move.action.type === 'place');
    if (bestTrade) {
        bestTrade.protected = true;
    }
    if (bestTrade && bestHold) {
        bestHold.protected = true;
    }
    if (bestBreak) {
        const action = bestBreak.action;
        const match = moves.find((move) => move.action === action && move.reserve === 1);
        if (match) {
            match.protected = true;
        }
    }
    const selected = moves.slice(0, width);
    for (const move of moves) {
        if (move.protected && !selected.includes(move)) {
            selected.push(move);
        }
    }
    if (pass) {
        selected.push(pass);
    }
    checkDeadline(search);
    return selected;
};

/** Finish a split reinforcement plan with a second, strategically selected stack.
 * The returned first action still belongs to legalActions; subsequent calls can
 * reconsider the remainder after the real caller applies it.
 * @param {ModelState} state @param {Action} first @param {Search} search
 */
const finishPlacement = (state, first, search) => {
    if ((first.type !== 'place' && first.type !== 'trade') || state.phase !== 'reinforce') {
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
        const value = placementValue(state, territoryAt(state, action.territoryId), action.count, board, search);
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
        const child = applyAction(cloneState(state), action, search.rng);
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
    for (const entry of ranked) {
        if (entry.move.protected && !beam.includes(entry)) {
            beam.push(entry);
        }
    }
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
    const search = { deadline: started + budget, root: seat, depth: 1, rng,
        battles: new Map(), evaluations: new Map(), campaigns: new Map() };
    let best = legal.find((action) => action.type === 'end-attack' || action.type === 'end-turn') || legal[0];
    if (legal.length === 1) {
        return best;
    }
    try {
        const moves = candidates(state, legal, 10, Math.max(1, maxDepth), search);
        if (state.phase === 'fortify') {
            // Every legal transfer was evaluated after moving both stacks; compare
            // with keeping the current board, before another seat receives income.
            moves.sort((a, b) => b.order - a.order);
            return moves[0].action;
        }
        if (state.phase === 'attack') {
            // A completed tactical ordering is the depth-zero fallback. It already
            // includes exact conquest odds and complete chained campaign odds.
            best = moves.reduce((chosen, move) => move.order > chosen.order ? move : chosen).action;
        }
        const trade = moves.find((move) => move.action.type === 'trade');
        const hold = moves.find((move) => move.action.type === 'place');
        const ordered = trade && hold ? [trade, hold, ...moves.filter((move) => move !== trade && move !== hold)] : moves;
        /** @type {RankedMove[]} */
        const ranked = [];
        // Complete successively wider depth-zero iterations. A short budget can
        // keep a fully evaluated narrow beam; optional trading first compares both
        // trading and holding. An interrupted widening never replaces that result.
        const widths = Array.from(new Set([trade && hold ? 2 : 1, Math.min(3, ordered.length), ordered.length]));
        for (const width of widths) {
            while (ranked.length < width) {
                ranked.push(rankMoves(state, [ordered[ranked.length]], search)[0]);
            }
            checkDeadline(search);
            best = ranked.reduce((chosen, entry) => entry.scores[seat] > chosen.scores[seat] ? entry : chosen).move.action;
        }
        ranked.sort((a, b) => b.scores[seat] - a.scores[seat]);
        const previousValues = new Map(ranked.map((entry) => [entry, entry.scores[seat]]));
        const remainingSeats = new Set(state.players.filter((player) => !state.eliminated.includes(player)));
        for (let depth = 1; depth <= maxDepth; depth += 1) {
            search.depth = depth;
            let iterationBest = best;
            let bestValue = -Infinity;
            let ties = 0;
            const rootBeam = ranked.slice(0, 3 + depth * 2);
            for (const entry of ranked) {
                if ((entry.move.protected || entry.move.action.type === 'end-attack'
                    || entry.move.action.type === 'end-turn') && !rootBeam.includes(entry)) {
                    rootBeam.push(entry);
                }
            }
            const iterationValues = new Map(previousValues);
            for (const entry of rootBeam) {
                const value = searchMove(state, entry, remainingSeats, depth, search)[seat];
                iterationValues.set(entry, value);
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
            checkDeadline(search);
            // Publish actions AND ordering only after the complete iteration.
            best = iterationBest;
            for (const [entry, value] of iterationValues) {
                previousValues.set(entry, value);
            }
            ranked.sort((a, b) => (previousValues.get(b) ?? -Infinity) - (previousValues.get(a) ?? -Infinity));
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
    const choices = underCap.length ? underCap : owned;
    if (!choices.length) {
        throw new Error(`No setup territory is owned by ${owner}.`);
    }
    const players = Array.from(new Set(territories.map((territory) => territory.owner)))
        .filter((player) => player !== NEUTRAL_ID);
    /** @type {ModelState} */
    const state = { config, players, eliminated: [], current: seat, phase: 'reinforce', territories,
        hands: Object.fromEntries(players.map((player) => [player, []])), deck: [], discard: [], setsTraded: 0,
        reinforcementRemaining: 0, pictureBonusUsed: false, conqueredThisTurn: false,
        fortifiedThisTurn: false, pendingConquest: null, winner: null };
    /** @type {Search} */
    const search = { deadline: now() + 250, root: seat, depth: 1, rng,
        battles: new Map(), evaluations: new Map(), campaigns: new Map() };
    const board = new Map(territories.map((territory) => [territory.id, territory]));
    const income = projectedIncome(state);
    let best = choices[0].id;
    let bestValue = -Infinity;
    let ties = 0;
    try {
        for (const candidate of choices) {
            checkDeadline(search);
            let value = -candidate.armies * 0.25;
            if (target === 'neutral') {
                for (const [rival, force] of incomingForce(candidate, board, income)) {
                    const obstruction = conquestProbability(force, candidate.armies, search)
                        - conquestProbability(force, candidate.armies + 1, search);
                    value += obstruction * (rival === seat ? -6 : 4);
                }
            } else {
                value += placementValue(state, candidate, 1, board, search, income);
                const members = territories.filter((territory) => territory.continent === candidate.continent);
                const share = members.filter((territory) => territory.owner === seat).length / members.length;
                const bonus = continentDefinitions.find((continent) => continent.id === candidate.continent)?.bonus || 0;
                value += share ** 4 * bonus / Math.sqrt(borderCount(members, board)) / (candidate.armies + 1);
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
    } catch (error) {
        if (error !== expired) {
            throw error;
        }
    }
    return best;
};

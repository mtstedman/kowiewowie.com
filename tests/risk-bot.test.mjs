import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chooseBotAction } from '../htdocs/assets/js/risk-bot.js';
import { applyAction, cloneState, legalActions, territoryCatalog } from '../htdocs/assets/js/risk-model.js';

const seededRng = (seed) => {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0x100000000;
    };
};

const territory = (id, owner, armies, neighbors, continent = 'test') => ({
    id,
    name: id,
    short: id,
    owner,
    armies,
    neighbors: neighbors.slice(),
    continent,
    marker: [0, 0],
    card: 'infantry',
});

const stateOf = ({ phase, territories, reinforcementRemaining = 0, hands = {}, pendingConquest = null,
    players = ['ai', 'human'], eliminated = [], current = 'ai' }) => ({
    config: { botCount: 1, placement: 'random', cardMode: 'incremental' },
    players,
    eliminated,
    current,
    phase,
    territories,
    hands: { ...Object.fromEntries(players.map((seat) => [seat, []])), ...hands },
    deck: [],
    discard: [],
    setsTraded: 0,
    reinforcementRemaining,
    pictureBonusUsed: false,
    conqueredThisTurn: false,
    fortifiedThisTurn: false,
    pendingConquest,
    winner: null,
});

const containsAction = (actions, selected) => actions.some((action) => {
    try {
        assert.deepEqual(action, selected);
        return true;
    } catch {
        return false;
    }
});

const chooseLegal = (state, seed = 7, options = {}) => {
    const selected = chooseBotAction(state, state.current, {
        timeBudgetMs: 35,
        maxDepth: 2,
        rng: seededRng(seed),
        ...options,
    });
    const legal = legalActions(state);
    assert.ok(containsAction(legal, selected), `bot returned a non-legal ${selected.type} action`);
    assert.doesNotThrow(() => applyAction(cloneState(state), selected, seededRng(seed + 100)));
    return selected;
};

// Script every normal turn phase, including mandatory trade, through the same
// legality/applyAction gate used by the game UI.
const scriptedStates = [
    stateOf({
        phase: 'reinforce',
        reinforcementRemaining: 4,
        territories: [
            territory('a', 'ai', 3, ['b', 'c']),
            territory('b', 'ai', 1, ['a']),
            territory('c', 'human', 4, ['a']),
        ],
    }),
    stateOf({
        phase: 'attack',
        territories: [territory('a', 'ai', 7, ['b']), territory('b', 'human', 2, ['a'])],
    }),
    stateOf({
        phase: 'conquer',
        pendingConquest: { sourceId: 'a', targetId: 'b', min: 2, max: 6 },
        territories: [territory('a', 'ai', 5, ['b', 'c']), territory('b', 'ai', 2, ['a', 'c']),
            territory('c', 'human', 2, ['a', 'b'])],
    }),
    stateOf({
        phase: 'fortify',
        territories: [territory('a', 'ai', 5, ['b', 'c']), territory('b', 'ai', 1, ['a']),
            territory('c', 'human', 5, ['a'])],
    }),
    stateOf({
        phase: 'reinforce',
        reinforcementRemaining: 3,
        hands: {
            ai: [
                { id: 'i1', territoryId: null, type: 'infantry' },
                { id: 'i2', territoryId: null, type: 'infantry' },
                { id: 'i3', territoryId: null, type: 'infantry' },
                { id: 'c1', territoryId: null, type: 'cavalry' },
                { id: 'a1', territoryId: null, type: 'artillery' },
            ],
        },
        territories: [territory('a', 'ai', 3, ['b']), territory('b', 'human', 3, ['a'])],
    }),
];
scriptedStates.forEach((state, index) => chooseLegal(state, 20 + index));

const elimination = stateOf({
    phase: 'attack',
    hands: { human: [{ id: 'captured', territoryId: null, type: 'wild' }] },
    territories: [territory('stronghold', 'ai', 14, ['last-redoubt']),
        territory('last-redoubt', 'human', 1, ['stronghold'])],
});
const eliminationAction = chooseLegal(elimination, 81, { timeBudgetMs: 90 });
assert.equal(eliminationAction.type, 'attack', 'overwhelming elimination should be searched');
assert.equal(eliminationAction.targetId, 'last-redoubt');

const hopeless = stateOf({
    phase: 'attack',
    territories: [territory('outpost', 'ai', 2, ['fortress']), territory('fortress', 'human', 10, ['outpost'])],
});
const hopelessAction = chooseLegal(hopeless, 91, { timeBudgetMs: 60 });
assert.equal(hopelessAction.type, 'end-attack', 'bot should decline a hopeless attack');

const forcedTrade = scriptedStates[4];
const tradeAction = chooseLegal(forcedTrade, 101, { timeBudgetMs: 60 });
assert.equal(tradeAction.type, 'trade', 'five cards with a valid set must be traded');

const australia = territoryCatalog.filter((entry) => entry.continent === 'australia');
const missing = australia[0];
const sourceId = missing.neighbors.find((id) => australia.some((entry) => entry.id === id));
assert.ok(sourceId, 'Australia fixture needs an internal adjacency');
const continentState = stateOf({
    phase: 'attack',
    territories: territoryCatalog.map((entry) => {
        const inAustralia = entry.continent === 'australia';
        const owner = entry.id === missing.id || !inAustralia ? 'human' : 'ai';
        const armies = entry.id === sourceId ? 16 : entry.id === missing.id ? 1 : owner === 'human' ? 20 : 2;
        return { ...entry, owner, armies, neighbors: entry.neighbors.slice() };
    }),
});
const continentAction = chooseLegal(continentState, 111, { timeBudgetMs: 160, maxDepth: 3 });
assert.equal(continentAction.type, 'attack', 'overwhelming continent completion should attack');
assert.equal(continentAction.targetId, missing.id, 'bot should take the final continent territory');

const timeBudgetMs = 20;
const timingToleranceMs = 50;
const timedStart = performance.now();
chooseLegal(hopeless, 121, { timeBudgetMs, maxDepth: 8 });
const timedElapsed = performance.now() - timedStart;
assert.ok(timedElapsed <= timeBudgetMs + timingToleranceMs,
    `${timeBudgetMs}ms search took ${timedElapsed.toFixed(1)}ms`);

const deterministicOptions = { timeBudgetMs: Infinity, maxDepth: 1 };
const first = chooseBotAction(cloneState(hopeless), 'ai', { ...deterministicOptions, rng: seededRng(777) });
const second = chooseBotAction(cloneState(hopeless), 'ai', { ...deterministicOptions, rng: seededRng(777) });
assert.deepEqual(first, second, 'same state and seeded rng must select the same action');

// AI can spend its reserve fortifying the one-army gate against Red. A
// paranoid reply assumes Red attacks that gate solely to hurt AI; Max-n predicts
// Red's much stronger self-interested capture of Blue's one-army prize, so AI
// keeps the reserve in place and ends its turn instead of making that fortification.
const strategicThreePlayer = stateOf({
    phase: 'fortify',
    players: ['ai', 'red', 'blue'],
    territories: [
        territory('ai-red-gate', 'ai', 1, ['ai-reserve', 'red-army']),
        territory('ai-reserve', 'ai', 7, ['ai-red-gate']),
        territory('red-army', 'red', 8, ['ai-red-gate', 'blue-prize']),
        territory('blue-prize', 'blue', 1, ['red-army', 'blue-home']),
        territory('blue-home', 'blue', 8, ['blue-prize']),
    ],
});
const strategicSnapshot = structuredClone(strategicThreePlayer);
const strategicAction = chooseLegal(strategicThreePlayer, 501, { timeBudgetMs: Infinity, maxDepth: 1 });
assert.equal(strategicAction.type, 'end-turn',
    'Max-n should decline a fortification aimed at an opponent who benefits more by attacking a rival');
assert.deepEqual(strategicThreePlayer, strategicSnapshot, 'multiplayer search must not mutate its input state');

// The exact combat distribution should favor the high-probability capture, not
// the superficially larger but very unlikely battle on the other frontier.
const stochasticThreePlayer = stateOf({
    phase: 'attack',
    players: ['ai', 'red', 'blue'],
    territories: [
        territory('army', 'ai', 10, ['red-outpost', 'blue-fortress']),
        territory('red-outpost', 'red', 2, ['army']),
        territory('blue-fortress', 'blue', 9, ['army']),
    ],
});
const stochasticAction = chooseLegal(stochasticThreePlayer, 502,
    { timeBudgetMs: Infinity, maxDepth: 1 });
assert.equal(stochasticAction.type, 'attack', 'expected utility should retain the favorable stochastic attack');
assert.equal(stochasticAction.targetId, 'red-outpost');

// Every winning combat leaf eliminates Red before occupation and continuation.
// Max-n must keep Red's terminal utility in the vector while Blue remains active.
const multiplayerElimination = stateOf({
    phase: 'attack',
    players: ['ai', 'red', 'blue'],
    hands: { red: [{ id: 'red-card', territoryId: null, type: 'wild' }] },
    territories: [
        territory('eliminator', 'ai', 15, ['red-last']),
        territory('red-last', 'red', 1, ['eliminator', 'blue-home']),
        territory('blue-home', 'blue', 7, ['red-last']),
    ],
});
const eliminationSnapshot = structuredClone(multiplayerElimination);
const multiplayerEliminationAction = chooseLegal(multiplayerElimination, 503,
    { timeBudgetMs: Infinity, maxDepth: 1 });
assert.equal(multiplayerEliminationAction.type, 'attack', 'Max-n should search through an elimination continuation');
assert.equal(multiplayerEliminationAction.targetId, 'red-last');
assert.deepEqual(multiplayerElimination, eliminationSnapshot, 'elimination search must leave the supplied state unchanged');

const multiplayerDeterministicOptions = { timeBudgetMs: Infinity, maxDepth: 1 };
const multiplayerFirst = chooseBotAction(cloneState(stochasticThreePlayer), 'ai',
    { ...multiplayerDeterministicOptions, rng: seededRng(9001) });
const multiplayerSecond = chooseBotAction(cloneState(stochasticThreePlayer), 'ai',
    { ...multiplayerDeterministicOptions, rng: seededRng(9001) });
assert.deepEqual(multiplayerFirst, multiplayerSecond,
    'depth-bounded Max-n must be deterministic with the same seeded rng');

const deadlineAction = chooseBotAction(cloneState(strategicThreePlayer), 'ai', {
    timeBudgetMs: 0,
    maxDepth: 8,
    rng: seededRng(504),
});
assert.ok(containsAction(legalActions(strategicThreePlayer), deadlineAction),
    'an expired multiplayer search must return its legal fallback');

console.log('Risk bot regressions passed.');

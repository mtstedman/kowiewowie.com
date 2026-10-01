/*
 * Risk rules model.
 *
 * DOM-free, state-parameterised rules shared by the browser UI and the bots.
 * Nothing here touches window, document or timers, so a bot can clone a state
 * and simulate on the copy. Every random function takes `rng: () => number`
 * returning a value in [0, 1) and defaults to Math.random.
 */

/**
 * @typedef {'infantry'|'cavalry'|'artillery'} CardType
 */

/**
 * @typedef {{
 *   botCount: number,
 *   placement: 'random'|'manual',
 *   cardMode: 'incremental'|'fixed'
 * }} Config
 */

/**
 * @typedef {{
 *   id: string,
 *   territoryId: string|null,
 *   type: 'infantry'|'cavalry'|'artillery'|'wild'
 * }} Card
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   short: string,
 *   continent: string,
 *   marker: number[],
 *   neighbors: string[],
 *   card: CardType,
 *   owner: string,
 *   armies: number
 * }} Territory
 */

/**
 * @typedef {{sourceId: string, targetId: string, min: number, max: number}} PendingConquest
 */

/**
 * @typedef {{
 *   config: Config,
 *   players: string[],
 *   eliminated: string[],
 *   current: string,
 *   phase: 'reinforce'|'attack'|'conquer'|'fortify'|'gameover',
 *   territories: Territory[],
 *   hands: {[seat: string]: Card[]},
 *   deck: Card[],
 *   discard: Card[],
 *   setsTraded: number,
 *   reinforcementRemaining: number,
 *   pictureBonusUsed: boolean,
 *   conqueredThisTurn: boolean,
 *   fortifiedThisTurn: boolean,
 *   pendingConquest: PendingConquest|null,
 *   winner: string|null
 * }} ModelState
 */

/**
 * @typedef {{type: 'trade', cardIds: string[], bonusTerritoryId?: string}
 *   | {type: 'place', territoryId: string, count: number}
 *   | {type: 'attack', sourceId: string, targetId: string, dice: number}
 *   | {type: 'occupy', count: number}
 *   | {type: 'end-attack'}
 *   | {type: 'fortify', sourceId: string, targetId: string, count: number}
 *   | {type: 'end-turn'}} Action
 */

/* ------------------------------------------------------------------
 * Canonical board data: six continents, 42 territories, 83 links.
 * ------------------------------------------------------------------ */

export const continentDefinitions = [
    { id: 'north-america', name: 'North America', bonus: 5, color: '#d9aa4f' },
    { id: 'south-america', name: 'South America', bonus: 2, color: '#c8674a' },
    { id: 'europe', name: 'Europe', bonus: 5, color: '#6f8fd0' },
    { id: 'africa', name: 'Africa', bonus: 3, color: '#a97d52' },
    { id: 'asia', name: 'Asia', bonus: 7, color: '#7aa95a' },
    { id: 'australia', name: 'Australia', bonus: 2, color: '#a56fb2' }
];

const territoryDefinitions = [
    { id: 'alaska', name: 'Alaska', short: 'Alaska', continent: 'north-america', marker: [58, 112] },
    { id: 'northwest-territory', name: 'Northwest Territory', short: 'N.W. Territory', continent: 'north-america', marker: [172, 98] },
    { id: 'greenland', name: 'Greenland', short: 'Greenland', continent: 'north-america', marker: [328, 68] },
    { id: 'alberta', name: 'Alberta', short: 'Alberta', continent: 'north-america', marker: [134, 176] },
    { id: 'ontario', name: 'Ontario', short: 'Ontario', continent: 'north-america', marker: [206, 176] },
    { id: 'quebec', name: 'Quebec', short: 'Quebec', continent: 'north-america', marker: [272, 170] },
    { id: 'western-united-states', name: 'Western United States', short: 'W. United States', continent: 'north-america', marker: [146, 254] },
    { id: 'eastern-united-states', name: 'Eastern United States', short: 'E. United States', continent: 'north-america', marker: [226, 252] },
    { id: 'central-america', name: 'Central America', short: 'C. America', continent: 'north-america', marker: [168, 318] },
    { id: 'venezuela', name: 'Venezuela', short: 'Venezuela', continent: 'south-america', marker: [254, 392] },
    { id: 'peru', name: 'Peru', short: 'Peru', continent: 'south-america', marker: [236, 452] },
    { id: 'brazil', name: 'Brazil', short: 'Brazil', continent: 'south-america', marker: [306, 462] },
    { id: 'argentina', name: 'Argentina', short: 'Argentina', continent: 'south-america', marker: [268, 566] },
    { id: 'iceland', name: 'Iceland', short: 'Iceland', continent: 'europe', marker: [416, 97] },
    { id: 'great-britain', name: 'Great Britain', short: 'Great Britain', continent: 'europe', marker: [437, 164] },
    { id: 'scandinavia', name: 'Scandinavia', short: 'Scandinavia', continent: 'europe', marker: [512, 104] },
    { id: 'northern-europe', name: 'Northern Europe', short: 'N. Europe', continent: 'europe', marker: [508, 196] },
    { id: 'western-europe', name: 'Western Europe', short: 'W. Europe', continent: 'europe', marker: [466, 256] },
    { id: 'southern-europe', name: 'Southern Europe', short: 'S. Europe', continent: 'europe', marker: [526, 246] },
    { id: 'ukraine', name: 'Ukraine', short: 'Ukraine', continent: 'europe', marker: [592, 148] },
    { id: 'north-africa', name: 'North Africa', short: 'N. Africa', continent: 'africa', marker: [470, 358] },
    { id: 'egypt', name: 'Egypt', short: 'Egypt', continent: 'africa', marker: [550, 328] },
    { id: 'east-africa', name: 'East Africa', short: 'E. Africa', continent: 'africa', marker: [568, 412] },
    { id: 'congo', name: 'Congo', short: 'Congo', continent: 'africa', marker: [512, 452] },
    { id: 'south-africa', name: 'South Africa', short: 'S. Africa', continent: 'africa', marker: [532, 528] },
    { id: 'madagascar', name: 'Madagascar', short: 'Madagascar', continent: 'africa', marker: [600, 522] },
    { id: 'ural', name: 'Ural', short: 'Ural', continent: 'asia', marker: [666, 124] },
    { id: 'siberia', name: 'Siberia', short: 'Siberia', continent: 'asia', marker: [736, 112] },
    { id: 'yakutsk', name: 'Yakutsk', short: 'Yakutsk', continent: 'asia', marker: [810, 82] },
    { id: 'kamchatka', name: 'Kamchatka', short: 'Kamchatka', continent: 'asia', marker: [914, 94] },
    { id: 'irkutsk', name: 'Irkutsk', short: 'Irkutsk', continent: 'asia', marker: [812, 138] },
    { id: 'mongolia', name: 'Mongolia', short: 'Mongolia', continent: 'asia', marker: [834, 196] },
    { id: 'japan', name: 'Japan', short: 'Japan', continent: 'asia', marker: [927, 208] },
    { id: 'afghanistan', name: 'Afghanistan', short: 'Afghanistan', continent: 'asia', marker: [666, 224] },
    { id: 'china', name: 'China', short: 'China', continent: 'asia', marker: [776, 262] },
    { id: 'middle-east', name: 'Middle East', short: 'Middle East', continent: 'asia', marker: [612, 292] },
    { id: 'india', name: 'India', short: 'India', continent: 'asia', marker: [706, 318] },
    { id: 'siam', name: 'Siam', short: 'Siam', continent: 'asia', marker: [768, 354] },
    { id: 'indonesia', name: 'Indonesia', short: 'Indonesia', continent: 'australia', marker: [830, 454] },
    { id: 'new-guinea', name: 'New Guinea', short: 'New Guinea', continent: 'australia', marker: [926, 446] },
    { id: 'western-australia', name: 'Western Australia', short: 'W. Australia', continent: 'australia', marker: [866, 556] },
    { id: 'eastern-australia', name: 'Eastern Australia', short: 'E. Australia', continent: 'australia', marker: [932, 556] }
];

// Undirected canonical links; neighbor lists are derived so adjacency is always symmetric.
const adjacencyLinks = [
    ['alaska', 'northwest-territory'], ['alaska', 'alberta'], ['alaska', 'kamchatka'],
    ['northwest-territory', 'alberta'], ['northwest-territory', 'ontario'], ['northwest-territory', 'greenland'],
    ['greenland', 'ontario'], ['greenland', 'quebec'], ['greenland', 'iceland'],
    ['alberta', 'ontario'], ['alberta', 'western-united-states'],
    ['ontario', 'quebec'], ['ontario', 'western-united-states'], ['ontario', 'eastern-united-states'],
    ['quebec', 'eastern-united-states'],
    ['western-united-states', 'eastern-united-states'], ['western-united-states', 'central-america'],
    ['eastern-united-states', 'central-america'],
    ['central-america', 'venezuela'],
    ['venezuela', 'peru'], ['venezuela', 'brazil'],
    ['peru', 'brazil'], ['peru', 'argentina'],
    ['brazil', 'argentina'], ['brazil', 'north-africa'],
    ['iceland', 'great-britain'], ['iceland', 'scandinavia'],
    ['great-britain', 'scandinavia'], ['great-britain', 'northern-europe'], ['great-britain', 'western-europe'],
    ['scandinavia', 'northern-europe'], ['scandinavia', 'ukraine'],
    ['northern-europe', 'western-europe'], ['northern-europe', 'southern-europe'], ['northern-europe', 'ukraine'],
    ['western-europe', 'southern-europe'], ['western-europe', 'north-africa'],
    ['southern-europe', 'ukraine'], ['southern-europe', 'north-africa'], ['southern-europe', 'egypt'], ['southern-europe', 'middle-east'],
    ['ukraine', 'ural'], ['ukraine', 'afghanistan'], ['ukraine', 'middle-east'],
    ['north-africa', 'egypt'], ['north-africa', 'east-africa'], ['north-africa', 'congo'],
    ['egypt', 'east-africa'], ['egypt', 'middle-east'],
    ['east-africa', 'congo'], ['east-africa', 'south-africa'], ['east-africa', 'madagascar'], ['east-africa', 'middle-east'],
    ['congo', 'south-africa'],
    ['south-africa', 'madagascar'],
    ['ural', 'siberia'], ['ural', 'china'], ['ural', 'afghanistan'],
    ['siberia', 'yakutsk'], ['siberia', 'irkutsk'], ['siberia', 'mongolia'], ['siberia', 'china'],
    ['yakutsk', 'irkutsk'], ['yakutsk', 'kamchatka'],
    ['kamchatka', 'irkutsk'], ['kamchatka', 'mongolia'], ['kamchatka', 'japan'],
    ['irkutsk', 'mongolia'],
    ['mongolia', 'japan'], ['mongolia', 'china'],
    ['afghanistan', 'china'], ['afghanistan', 'india'], ['afghanistan', 'middle-east'],
    ['china', 'india'], ['china', 'siam'],
    ['middle-east', 'india'],
    ['india', 'siam'],
    ['siam', 'indonesia'],
    ['indonesia', 'new-guinea'], ['indonesia', 'western-australia'],
    ['new-guinea', 'western-australia'], ['new-guinea', 'eastern-australia'],
    ['western-australia', 'eastern-australia']
];

/** @type {CardType[]} */
export const cardTypes = ['infantry', 'cavalry', 'artillery'];

/** @type {Map<string, Set<string>>} */
const neighborMap = new Map();

territoryDefinitions.forEach((territory) => {
    neighborMap.set(territory.id, new Set());
});

adjacencyLinks.forEach(([first, second]) => {
    neighborMap.get(first).add(second);
    neighborMap.get(second).add(first);
});

export const territoryCatalog = territoryDefinitions.map((territory, index) => ({
    ...territory,
    neighbors: Array.from(neighborMap.get(territory.id)),
    card: cardTypes[index % cardTypes.length]
}));

/** @type {Map<string, number>} */
const catalogIndex = new Map();

territoryCatalog.forEach((territory, index) => {
    catalogIndex.set(territory.id, index);
});

/** @type {Map<string, string[]>} */
const continentMembers = new Map();

continentDefinitions.forEach((continent) => {
    continentMembers.set(
        continent.id,
        territoryCatalog.filter((territory) => territory.continent === continent.id).map((territory) => territory.id)
    );
});

/* ------------------------------------------------------------------
 * Seats, setup constants and configuration.
 * ------------------------------------------------------------------ */

export const PLAYER_IDS = ['human', 'ai', 'ai2', 'ai3', 'ai4', 'ai5'];
export const NEUTRAL_ID = 'neutral';
export const SETUP_ARMY_CAP = 4;

const DEAL_PER_COLOR = 14;
const TRADE_SCHEDULE = [4, 6, 8, 10, 12, 15];

/** @type {{[setType: string]: number}} */
const FIXED_TRADE_VALUES = { infantry: 4, cavalry: 6, artillery: 8, mixed: 10 };

/**
 * Starting armies per seat: 2 -> 40, 3 -> 35, 4 -> 30, 5 -> 25, 6 -> 20.
 *
 * @param {number} seatCount
 * @returns {number}
 */
export const startingArmies = (seatCount) => {
    const seats = Math.max(2, Math.min(PLAYER_IDS.length, Math.floor(Number(seatCount)) || 2));

    return 50 - seats * 5;
};

/**
 * Fill in defaults and replace invalid values with the defaults
 * {botCount: 2, placement: 'random', cardMode: 'incremental'}.
 *
 * @param {any} [partial]
 * @returns {Config}
 */
export const normalizeConfig = (partial) => {
    const source = partial && typeof partial === 'object' ? partial : {};
    const rawCount = typeof source.botCount === 'string' && source.botCount.trim() !== ''
        ? Number(source.botCount)
        : source.botCount;
    const botCount = Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= PLAYER_IDS.length - 1
        ? rawCount
        : 2;

    return {
        botCount,
        placement: source.placement === 'manual' ? 'manual' : 'random',
        cardMode: source.cardMode === 'fixed' ? 'fixed' : 'incremental'
    };
};

/* ------------------------------------------------------------------
 * Random helpers. All randomness flows through the supplied rng.
 * ------------------------------------------------------------------ */

/**
 * @param {() => number} rng
 * @param {number} length
 * @returns {number}
 */
const randomIndex = (rng, length) => {
    const index = Math.floor(rng() * length);

    return Number.isFinite(index) ? Math.max(0, Math.min(length - 1, index)) : 0;
};

/**
 * Fisher-Yates shuffle returning a new array.
 *
 * @template T
 * @param {T[]} items
 * @param {() => number} rng
 * @returns {T[]}
 */
const shuffle = (items, rng) => {
    const copy = items.slice();

    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = randomIndex(rng, index + 1);
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }

    return copy;
};

/**
 * @param {() => number} rng
 * @returns {number}
 */
const rollDie = (rng) => randomIndex(rng, 6) + 1;

/**
 * @param {number} count
 * @param {() => number} rng
 * @returns {number[]}
 */
const rollDice = (count, rng) => Array.from({ length: count }, () => rollDie(rng));

/* ------------------------------------------------------------------
 * Cards: deck, set validation and trade value.
 * ------------------------------------------------------------------ */

/**
 * 42 territory cards plus two wilds, shuffled.
 *
 * @param {() => number} [rng]
 * @returns {Card[]}
 */
export const buildDeck = (rng = Math.random) => {
    /** @type {Card[]} */
    const cards = [
        ...territoryCatalog.map((territory) => ({
            id: `card-${territory.id}`,
            territoryId: territory.id,
            type: territory.card
        })),
        { id: 'wild-1', territoryId: null, type: 'wild' },
        { id: 'wild-2', territoryId: null, type: 'wild' }
    ];

    return shuffle(cards, rng);
};

/**
 * A set is three of a kind, one of each type, or any two cards with a wild.
 *
 * @param {Card[]} cards
 * @returns {boolean}
 */
export const isValidSet = (cards) => {
    if (!Array.isArray(cards) || cards.length !== 3 || cards.some((card) => !card) || new Set(cards).size !== 3) {
        return false;
    }

    if (cards.some((card) => card.type === 'wild')) {
        return true;
    }

    const types = new Set(cards.map((card) => card.type));
    return types.size === 1 || types.size === 3;
};

/**
 * @param {Card[]} hand
 * @returns {Card[][]}
 */
export const findValidSets = (hand) => {
    /** @type {Card[][]} */
    const sets = [];

    if (!Array.isArray(hand)) {
        return sets;
    }

    for (let first = 0; first < hand.length; first += 1) {
        for (let second = first + 1; second < hand.length; second += 1) {
            for (let third = second + 1; third < hand.length; third += 1) {
                const cards = [hand[first], hand[second], hand[third]];

                if (isValidSet(cards)) {
                    sets.push(cards);
                }
            }
        }
    }

    return sets;
};

/**
 * Fixed-mode value of a set by type; wilds resolve to the best value. 0 when the cards are not a set.
 *
 * @param {Card[]} cards
 * @returns {number}
 */
const fixedSetValue = (cards) => {
    if (!isValidSet(cards)) {
        return 0;
    }

    /** @type {{[type: string]: number}} */
    const counts = { infantry: 0, cavalry: 0, artillery: 0 };
    let wilds = 0;

    cards.forEach((card) => {
        if (card.type === 'wild') {
            wilds += 1;
        } else if (counts[card.type] !== undefined) {
            counts[card.type] += 1;
        }
    });

    const distinctTypes = cardTypes.filter((type) => counts[type] > 0).length;
    let best = 0;

    // One of each is reachable whenever the non-wild cards are all different types.
    if (distinctTypes === cards.length - wilds) {
        best = FIXED_TRADE_VALUES.mixed;
    }

    cardTypes.forEach((type) => {
        if (counts[type] + wilds === cards.length) {
            best = Math.max(best, FIXED_TRADE_VALUES[type]);
        }
    });

    return best;
};

/**
 * Armies paid for a set.
 * 'incremental': shared escalating schedule 4, 6, 8, 10, 12, 15, then +5 per further set.
 * 'fixed': 4 (3 infantry), 6 (3 cavalry), 8 (3 artillery), 10 (one of each); wilds take the best value.
 *
 * @param {number} setsTraded
 * @param {'incremental'|'fixed'} [cardMode]
 * @param {Card[]} [cards]
 * @returns {number}
 */
export const tradeValue = (setsTraded, cardMode = 'incremental', cards = undefined) => {
    if (cardMode === 'fixed') {
        return fixedSetValue(cards);
    }

    const traded = Math.max(0, Math.floor(Number(setsTraded)) || 0);

    return traded < TRADE_SCHEDULE.length
        ? TRADE_SCHEDULE[traded]
        : TRADE_SCHEDULE[TRADE_SCHEDULE.length - 1] + (traded - TRADE_SCHEDULE.length + 1) * 5;
};

/* ------------------------------------------------------------------
 * Setup: deal and capped random army distribution.
 * ------------------------------------------------------------------ */

/**
 * Deal the board with one army per territory.
 * botCount 1 keeps the two-player variant: 14 territories each to human, ai and neutral.
 * botCount 2-5 deals all 42 territories round-robin over a shuffled list, with no neutral.
 * setupPool is each owner's starting armies minus the territories it was dealt.
 *
 * @param {any} [config]
 * @param {() => number} [rng]
 * @returns {{players: string[], territories: Territory[], setupPool: {[owner: string]: number}, firstPlayer: string}}
 */
export const createGame = (config, rng = Math.random) => {
    const normalized = normalizeConfig(config);
    const players = PLAYER_IDS.slice(0, normalized.botCount + 1);
    const withNeutral = normalized.botCount === 1;
    const owners = withNeutral ? [...players, NEUTRAL_ID] : players;
    const armiesPerOwner = startingArmies(players.length);

    /** @type {Map<string, string>} */
    const dealtOwners = new Map();

    shuffle(territoryCatalog.map((territory) => territory.id), rng).forEach((id, index) => {
        dealtOwners.set(
            id,
            withNeutral ? owners[Math.floor(index / DEAL_PER_COLOR)] : owners[index % owners.length]
        );
    });

    const territories = territoryCatalog.map((territory) => ({
        ...territory,
        owner: dealtOwners.get(territory.id),
        armies: 1
    }));

    /** @type {{[owner: string]: number}} */
    const setupPool = {};

    owners.forEach((owner) => {
        setupPool[owner] = armiesPerOwner - territories.filter((territory) => territory.owner === owner).length;
    });

    const firstPlayer = players[randomIndex(rng, players.length)];

    return { players, territories, setupPool, firstPlayer };
};

/**
 * Spread `count` armies over `owner`'s territories, one at a time, each onto a uniformly random
 * owned territory that is still below `cap`. Mutates `territories`. Stops early when no owned
 * tile is under the cap.
 *
 * @param {Territory[]} territories
 * @param {string} owner
 * @param {number} count
 * @param {() => number} [rng]
 * @param {number} [cap]
 * @returns {number} armies actually placed
 */
export const distributeSetupArmies = (territories, owner, count, rng = Math.random, cap = SETUP_ARMY_CAP) => {
    const wanted = Math.max(0, Math.floor(Number(count)) || 0);
    const open = territories.filter((territory) => territory.owner === owner && territory.armies < cap);
    let placed = 0;

    while (placed < wanted && open.length > 0) {
        const index = randomIndex(rng, open.length);
        const territory = open[index];

        territory.armies += 1;
        placed += 1;

        if (territory.armies >= cap) {
            open.splice(index, 1);
        }
    }

    return placed;
};

/* ------------------------------------------------------------------
 * State queries.
 * ------------------------------------------------------------------ */

/**
 * @param {ModelState} state
 * @param {string|null|undefined} id
 * @returns {Territory|null}
 */
const territoryOf = (state, id) => {
    if (!id) {
        return null;
    }

    const index = catalogIndex.get(id);
    const direct = index === undefined ? undefined : state.territories[index];

    if (direct && direct.id === id) {
        return direct;
    }

    return state.territories.find((territory) => territory.id === id) || null;
};

/**
 * @param {ModelState} state
 * @param {string} owner
 * @returns {Territory[]}
 */
const ownedBy = (state, owner) => state.territories.filter((territory) => territory.owner === owner);

/**
 * @param {ModelState} state
 * @param {string} seat
 * @returns {boolean}
 */
const isEliminated = (state, seat) => Array.isArray(state.eliminated) && state.eliminated.includes(seat);

/**
 * @param {ModelState} state
 * @param {string} seat
 * @returns {Card[]}
 */
const handOf = (state, seat) => (state.hands && Array.isArray(state.hands[seat]) ? state.hands[seat] : []);

/**
 * Like handOf, but guarantees the returned array is stored on the state.
 *
 * @param {ModelState} state
 * @param {string} seat
 * @returns {Card[]}
 */
const writableHand = (state, seat) => {
    if (!state.hands) {
        state.hands = {};
    }

    if (!Array.isArray(state.hands[seat])) {
        state.hands[seat] = [];
    }

    return state.hands[seat];
};

/**
 * @param {ModelState} state
 * @returns {'incremental'|'fixed'}
 */
const cardModeOf = (state) => (state.config && state.config.cardMode === 'fixed' ? 'fixed' : 'incremental');

/**
 * @param {ModelState} state
 * @param {string} seat
 * @param {Territory} territory
 * @returns {Territory[]}
 */
const hostileNeighbors = (state, seat, territory) => territory.neighbors
    .map((id) => territoryOf(state, id))
    .filter((neighbor) => neighbor && neighbor.owner !== seat);

/**
 * @param {Territory|null} source
 * @returns {number}
 */
const maxAttackDice = (source) => (source ? Math.max(0, Math.min(3, source.armies - 1)) : 0);

/**
 * @param {Territory|null} target
 * @returns {number}
 */
const maxDefendDice = (target) => (target ? Math.max(0, Math.min(2, target.armies)) : 0);

/**
 * A seat holding five or more cards must trade before placing armies.
 *
 * @param {ModelState} state
 * @param {string} seat
 * @returns {boolean}
 */
const mustTrade = (state, seat) => {
    const hand = handOf(state, seat);

    return hand.length >= 5 && findValidSets(hand).length > 0;
};

/**
 * Continents fully owned by `seat`.
 *
 * @param {ModelState} state
 * @param {string} seat
 */
export const controlledContinents = (state, seat) => continentDefinitions.filter((continent) => (
    continentMembers.get(continent.id).every((id) => territoryOf(state, id)?.owner === seat)
));

/**
 * Reinforcements for `seat`: territories / 3 rounded down, minimum 3, plus continent bonuses.
 *
 * @param {ModelState} state
 * @param {string} seat
 */
export const reinforcementBreakdown = (state, seat) => {
    const territoryCount = ownedBy(state, seat).length;
    const base = Math.max(3, Math.floor(territoryCount / 3));
    const continents = controlledContinents(state, seat);
    const bonus = continents.reduce((sum, continent) => sum + continent.bonus, 0);

    return {
        territoryCount,
        base,
        continents,
        bonus,
        total: base + bonus
    };
};

/**
 * Ids of every territory reachable from `sourceId` through territories of the same owner,
 * including `sourceId` itself. Empty when the territory does not exist.
 *
 * @param {ModelState} state
 * @param {string} sourceId
 * @returns {Set<string>}
 */
export const connectedOwned = (state, sourceId) => {
    const start = territoryOf(state, sourceId);
    /** @type {Set<string>} */
    const reached = new Set();

    if (!start) {
        return reached;
    }

    const owner = start.owner;
    const queue = [start.id];
    reached.add(start.id);

    while (queue.length > 0) {
        const current = territoryOf(state, queue.shift());

        current.neighbors.forEach((neighborId) => {
            if (!reached.has(neighborId) && territoryOf(state, neighborId)?.owner === owner) {
                reached.add(neighborId);
                queue.push(neighborId);
            }
        });
    }

    return reached;
};

/**
 * Pair the highest dice; ties go to the defender.
 *
 * @param {number[]} attackRolls
 * @param {number[]} defendRolls
 */
export const compareRolls = (attackRolls, defendRolls) => {
    const attack = attackRolls.slice().sort((first, second) => second - first);
    const defend = defendRolls.slice().sort((first, second) => second - first);
    const pairs = [];

    for (let index = 0; index < Math.min(attack.length, defend.length); index += 1) {
        pairs.push({
            attack: attack[index],
            defend: defend[index],
            winner: attack[index] > defend[index] ? 'attacker' : 'defender'
        });
    }

    return {
        attack,
        defend,
        pairs,
        attackerLosses: pairs.filter((pair) => pair.winner === 'defender').length,
        defenderLosses: pairs.filter((pair) => pair.winner === 'attacker').length
    };
};

/**
 * The seat that moves after `seat`, skipping eliminated seats. Returns `seat` when no other
 * seat remains.
 *
 * @param {ModelState} state
 * @param {string} seat
 * @returns {string}
 */
export const nextSeat = (state, seat) => {
    const players = Array.isArray(state.players) ? state.players : [];
    const start = players.indexOf(seat);

    for (let step = 1; step <= players.length; step += 1) {
        const candidate = players[(start + step) % players.length];

        if (!isEliminated(state, candidate)) {
            return candidate;
        }
    }

    return seat;
};

/**
 * Independent copy of the model fields of `state`. Mutating the copy never affects the original.
 * Static catalog data on territories (neighbors, marker) is shared by reference.
 *
 * @param {ModelState} state
 * @returns {ModelState}
 */
export const cloneState = (state) => {
    /** @param {Card} card */
    const copyCard = (card) => ({ ...card });
    /** @type {{[seat: string]: Card[]}} */
    const hands = {};

    Object.keys(state.hands || {}).forEach((seat) => {
        hands[seat] = handOf(state, seat).map(copyCard);
    });

    return {
        config: { ...state.config },
        players: (state.players || []).slice(),
        eliminated: (state.eliminated || []).slice(),
        current: state.current,
        phase: state.phase,
        territories: state.territories.map((territory) => ({ ...territory })),
        hands,
        deck: (state.deck || []).map(copyCard),
        discard: (state.discard || []).map(copyCard),
        setsTraded: state.setsTraded,
        reinforcementRemaining: state.reinforcementRemaining,
        pictureBonusUsed: state.pictureBonusUsed,
        conqueredThisTurn: state.conqueredThisTurn,
        fortifiedThisTurn: state.fortifiedThisTurn,
        pendingConquest: state.pendingConquest ? { ...state.pendingConquest } : null,
        winner: state.winner
    };
};

/* ------------------------------------------------------------------
 * Pictured-card bonus: deterministic default choice.
 * ------------------------------------------------------------------ */

/**
 * @param {ModelState} state
 * @param {string} seat
 * @param {string} continentId
 * @returns {number}
 */
const continentShare = (state, seat, continentId) => {
    const members = continentMembers.get(continentId) || [];
    const owned = members.filter((id) => territoryOf(state, id)?.owner === seat).length;

    return members.length > 0 ? owned / members.length : 0;
};

/**
 * Same scoring the browser game uses to pick the pictured-card bonus territory. Rival pressure
 * counts every hostile seat; neutral armies are ignored, as in the two-player variant.
 *
 * @param {ModelState} state
 * @param {string} seat
 * @param {Territory} territory
 * @returns {number}
 */
const bonusScore = (state, seat, territory) => {
    const hostile = hostileNeighbors(state, seat, territory);

    if (hostile.length === 0) {
        return -100 - territory.armies;
    }

    const weakestHostile = Math.min(...hostile.map((neighbor) => neighbor.armies));
    const pressure = hostile
        .filter((neighbor) => neighbor.owner !== NEUTRAL_ID)
        .reduce((sum, neighbor) => sum + neighbor.armies, 0);

    return continentShare(state, seat, territory.continent) * 12
        + pressure * 0.5
        + hostile.length
        + (territory.armies > weakestHostile ? 2 : 0)
        - territory.armies * 0.35;
};

/**
 * Territories pictured on `cards` that `seat` owns, in card order.
 *
 * @param {ModelState} state
 * @param {string} seat
 * @param {Card[]} cards
 * @returns {Territory[]}
 */
const picturedOwned = (state, seat, cards) => {
    /** @type {Territory[]} */
    const pictured = [];

    cards.forEach((card) => {
        const territory = territoryOf(state, card.territoryId);

        if (territory && territory.owner === seat && !pictured.includes(territory)) {
            pictured.push(territory);
        }
    });

    return pictured;
};

/**
 * First highest-scoring territory, or null for an empty list.
 *
 * @param {ModelState} state
 * @param {string} seat
 * @param {Territory[]} candidates
 * @returns {Territory|null}
 */
const bestBonusTerritory = (state, seat, candidates) => {
    /** @type {Territory|null} */
    let best = null;
    let bestValue = -Infinity;

    candidates.forEach((territory) => {
        const value = bonusScore(state, seat, territory);

        if (best === null || value > bestValue) {
            best = territory;
            bestValue = value;
        }
    });

    return best;
};

/* ------------------------------------------------------------------
 * Legal actions.
 * ------------------------------------------------------------------ */

/**
 * Representative army counts between 1 and `max`: one, about half, and all.
 *
 * @param {number} max
 * @returns {number[]}
 */
const representativeCounts = (max) => {
    /** @type {number[]} */
    const counts = [];

    [1, Math.ceil(max / 2), max].forEach((count) => {
        if (count >= 1 && count <= max && !counts.includes(count)) {
            counts.push(count);
        }
    });

    return counts;
};

/**
 * Actions the current seat may take. Every returned action is accepted by applyAction.
 *
 * Trades, attacks (every dice count), occupation moves and phase endings are listed exhaustively.
 * Army counts for 'place' and 'fortify' are a representative subset (one, about half, all) to keep
 * the branching factor searchable; applyAction accepts any count inside the legal range.
 * With five or more cards in the reinforce phase only trades are returned.
 *
 * @param {ModelState} state
 * @returns {Action[]}
 */
export const legalActions = (state) => {
    /** @type {Action[]} */
    const actions = [];

    if (!state || state.winner || state.phase === 'gameover') {
        return actions;
    }

    const seat = state.current;

    if (state.phase === 'reinforce') {
        findValidSets(handOf(state, seat)).forEach((cards) => {
            const cardIds = cards.map((card) => card.id);
            const pictured = state.pictureBonusUsed ? [] : picturedOwned(state, seat, cards);

            if (pictured.length > 1) {
                pictured.forEach((territory) => {
                    actions.push({ type: 'trade', cardIds: cardIds.slice(), bonusTerritoryId: territory.id });
                });
            } else {
                actions.push({ type: 'trade', cardIds });
            }
        });

        if (mustTrade(state, seat)) {
            return actions;
        }

        if (state.reinforcementRemaining > 0) {
            const counts = representativeCounts(state.reinforcementRemaining);

            ownedBy(state, seat).forEach((territory) => {
                counts.forEach((count) => {
                    actions.push({ type: 'place', territoryId: territory.id, count });
                });
            });
        }

        return actions;
    }

    if (state.phase === 'attack') {
        if (state.pendingConquest) {
            return actions;
        }

        ownedBy(state, seat).forEach((source) => {
            const maxDice = maxAttackDice(source);

            if (source.armies < 2 || maxDice < 1) {
                return;
            }

            hostileNeighbors(state, seat, source).forEach((target) => {
                for (let dice = maxDice; dice >= 1; dice -= 1) {
                    actions.push({ type: 'attack', sourceId: source.id, targetId: target.id, dice });
                }
            });
        });

        actions.push({ type: 'end-attack' });
        return actions;
    }

    if (state.phase === 'conquer') {
        const pending = state.pendingConquest;

        if (pending) {
            for (let count = pending.min; count <= pending.max; count += 1) {
                actions.push({ type: 'occupy', count });
            }
        }

        return actions;
    }

    if (state.phase === 'fortify') {
        if (!state.fortifiedThisTurn) {
            /** @type {Set<string>} */
            const grouped = new Set();

            ownedBy(state, seat).forEach((start) => {
                if (grouped.has(start.id)) {
                    return;
                }

                const group = Array.from(connectedOwned(state, start.id));

                group.forEach((id) => grouped.add(id));

                if (group.length < 2) {
                    return;
                }

                group.forEach((sourceId) => {
                    const source = territoryOf(state, sourceId);

                    if (!source || source.armies < 2) {
                        return;
                    }

                    const counts = representativeCounts(source.armies - 1);

                    group.forEach((targetId) => {
                        if (targetId === sourceId) {
                            return;
                        }

                        counts.forEach((count) => {
                            actions.push({ type: 'fortify', sourceId, targetId, count });
                        });
                    });
                });
            });
        }

        actions.push({ type: 'end-turn' });
    }

    return actions;
};

/* ------------------------------------------------------------------
 * Action effects. Each validates fully before mutating, so a rejected
 * action leaves the state untouched.
 * ------------------------------------------------------------------ */

/**
 * @param {ModelState} state
 * @param {string} seat
 * @param {() => number} rng
 * @returns {Card|null}
 */
const drawCard = (state, seat, rng) => {
    if (!Array.isArray(state.deck)) {
        state.deck = [];
    }

    if (!Array.isArray(state.discard)) {
        state.discard = [];
    }

    if (state.deck.length === 0 && state.discard.length > 0) {
        state.deck = shuffle(state.discard, rng);
        state.discard = [];
    }

    const card = state.deck.pop() || null;

    if (card) {
        writableHand(state, seat).push(card);
    }

    return card;
};

/**
 * @param {ModelState} state
 * @param {string} seat
 */
const beginTurn = (state, seat) => {
    state.current = seat;
    state.phase = 'reinforce';
    state.conqueredThisTurn = false;
    state.fortifiedThisTurn = false;
    state.pictureBonusUsed = false;
    state.pendingConquest = null;
    state.reinforcementRemaining = reinforcementBreakdown(state, seat).total;
};

/**
 * Handle a seat that just lost its last territory: list it as eliminated, hand its cards to the
 * conqueror and end the game when a single seat remains.
 *
 * @param {ModelState} state
 * @param {string} conqueror
 * @param {string} defender
 * @returns {boolean} true when this elimination ended the game (winner set, phase 'gameover').
 */
const resolveElimination = (state, conqueror, defender) => {
    const players = Array.isArray(state.players) ? state.players : [];

    if (defender === conqueror || !players.includes(defender) || isEliminated(state, defender)) {
        return false;
    }

    if (state.territories.some((territory) => territory.owner === defender)) {
        return false;
    }

    if (!Array.isArray(state.eliminated)) {
        state.eliminated = [];
    }

    state.eliminated.push(defender);

    const captured = handOf(state, defender);

    if (captured.length > 0) {
        writableHand(state, conqueror).push(...captured);
    }

    writableHand(state, defender);
    state.hands[defender] = [];

    const remaining = players.filter((seat) => !isEliminated(state, seat));

    if (remaining.length === 1) {
        state.winner = remaining[0];
        state.phase = 'gameover';
        state.pendingConquest = null;
        state.reinforcementRemaining = 0;

        return true;
    }

    return false;
};

/**
 * @param {ModelState} state
 * @param {any} action
 */
const applyTrade = (state, action) => {
    const seat = state.current;

    if (state.phase !== 'reinforce') {
        throw new Error('Cards can only be traded during the reinforcement phase.');
    }

    const hand = writableHand(state, seat);
    const cardIds = Array.isArray(action.cardIds) ? action.cardIds : [];
    const cards = cardIds.map((cardId) => hand.find((card) => card.id === cardId) || null);

    if (cards.length !== 3 || cards.some((card) => !card)) {
        throw new Error('Select exactly three cards from your hand.');
    }

    if (!isValidSet(cards)) {
        throw new Error('A set is three of a kind, one of each type, or any two cards with a wild.');
    }

    // The +2 pictured-territory bonus applies once per turn; a requested territory is only
    // consulted while that bonus is still available.
    /** @type {Territory|null} */
    let bonusTerritory = null;

    if (!state.pictureBonusUsed) {
        const pictured = picturedOwned(state, seat, cards);
        const requested = action.bonusTerritoryId;

        if (requested !== undefined && requested !== null) {
            bonusTerritory = pictured.find((territory) => territory.id === requested) || null;

            if (!bonusTerritory) {
                throw new Error('The bonus armies can only go on a territory you own that is pictured on a traded card.');
            }
        } else {
            bonusTerritory = bestBonusTerritory(state, seat, pictured);
        }
    }

    const value = tradeValue(state.setsTraded, cardModeOf(state), cards);

    if (!Array.isArray(state.discard)) {
        state.discard = [];
    }

    state.setsTraded = (Number(state.setsTraded) || 0) + 1;
    state.hands[seat] = hand.filter((card) => !cards.includes(card));
    state.discard.push(...cards);
    state.reinforcementRemaining += value;

    if (bonusTerritory) {
        bonusTerritory.armies += 2;
        state.pictureBonusUsed = true;
    }
};

/**
 * @param {ModelState} state
 * @param {any} action
 */
const applyPlace = (state, action) => {
    const seat = state.current;

    if (state.phase !== 'reinforce') {
        throw new Error('Reinforcements can only be placed during the reinforcement phase.');
    }

    if (mustTrade(state, seat)) {
        throw new Error(`${seat} holds ${handOf(state, seat).length} cards and must trade a set first.`);
    }

    const territory = territoryOf(state, action.territoryId);

    if (!territory || territory.owner !== seat) {
        throw new Error('Reinforcements can only be placed on territory you own.');
    }

    const count = action.count;

    if (!Number.isInteger(count) || count < 1 || count > state.reinforcementRemaining) {
        throw new Error(state.reinforcementRemaining > 0
            ? `Place between 1 and ${state.reinforcementRemaining} armies.`
            : 'No reinforcements remain to place.');
    }

    territory.armies += count;
    state.reinforcementRemaining -= count;

    // The attack phase opens as soon as the last reinforcement is placed.
    if (state.reinforcementRemaining === 0) {
        state.phase = 'attack';
    }
};

/**
 * Dice are rolled as Math.floor(rng() * 6) + 1, all attack dice first and then the defend dice.
 *
 * @param {ModelState} state
 * @param {any} action
 * @param {() => number} rng
 * @param {{defendDice?: number}} options
 */
const applyAttack = (state, action, rng, options) => {
    const seat = state.current;

    if (state.phase !== 'attack') {
        throw new Error('Attacks are only allowed during the attack phase.');
    }

    if (state.pendingConquest) {
        throw new Error('Finish the current battle first.');
    }

    const source = territoryOf(state, action.sourceId);
    const target = territoryOf(state, action.targetId);

    if (!source || source.owner !== seat) {
        throw new Error('Choose an attacking territory you own.');
    }

    if (source.armies < 2) {
        throw new Error(`${source.name} needs at least two armies to attack.`);
    }

    if (!target) {
        throw new Error('Choose a target territory.');
    }

    if (target.owner === seat) {
        throw new Error('You cannot attack your own territory.');
    }

    if (!source.neighbors.includes(target.id)) {
        throw new Error(`${target.name} is not adjacent to ${source.name}.`);
    }

    const attackDice = action.dice;

    if (!Number.isInteger(attackDice) || attackDice < 1 || attackDice > maxAttackDice(source)) {
        throw new Error(`${source.name} can roll between 1 and ${maxAttackDice(source)} attack dice.`);
    }

    // The defender rolls as many dice as it can unless a smaller valid count is requested.
    const defendLimit = maxDefendDice(target);
    const requestedDefend = options ? options.defendDice : undefined;
    const defendDice = Number.isInteger(requestedDefend) && requestedDefend >= 1
        ? Math.min(requestedDefend, defendLimit)
        : defendLimit;
    const outcome = compareRolls(rollDice(attackDice, rng), rollDice(defendDice, rng));

    source.armies -= outcome.attackerLosses;
    target.armies -= outcome.defenderLosses;

    if (target.armies > 0) {
        return;
    }

    // The minimum (dice rolled) moves in immediately so no territory is ever left empty.
    const available = source.armies - 1;
    const defender = target.owner;

    target.owner = seat;
    target.armies = attackDice;
    source.armies -= attackDice;
    state.conqueredThisTurn = true;

    // state.phase is narrowed to 'attack' here, so the game-over outcome is reported explicitly.
    if (resolveElimination(state, seat, defender)) {
        return;
    }

    state.pendingConquest = {
        sourceId: source.id,
        targetId: target.id,
        min: attackDice,
        max: available
    };
    state.phase = 'conquer';
};

/**
 * @param {ModelState} state
 * @param {any} action
 */
const applyOccupy = (state, action) => {
    const pending = state.pendingConquest;

    if (!pending || state.phase !== 'conquer') {
        throw new Error('No conquest move is pending.');
    }

    const count = action.count;

    if (!Number.isInteger(count) || count < pending.min || count > pending.max) {
        throw new Error(`Move between ${pending.min} and ${pending.max} armies.`);
    }

    const source = territoryOf(state, pending.sourceId);
    const target = territoryOf(state, pending.targetId);

    if (!source || !target) {
        throw new Error('No conquest move is pending.');
    }

    const extra = count - pending.min;

    source.armies -= extra;
    target.armies += extra;
    state.pendingConquest = null;
    state.phase = 'attack';
};

/**
 * @param {ModelState} state
 */
const applyEndAttack = (state) => {
    if (state.phase !== 'attack' || state.pendingConquest) {
        throw new Error('The attack phase can only be ended during the attack phase.');
    }

    state.phase = 'fortify';
};

/**
 * @param {ModelState} state
 * @param {any} action
 */
const applyFortify = (state, action) => {
    const seat = state.current;

    if (state.phase !== 'fortify') {
        throw new Error('Fortification is only allowed during the fortify phase.');
    }

    if (state.fortifiedThisTurn) {
        throw new Error('You have already fortified this turn.');
    }

    const source = territoryOf(state, action.sourceId);
    const target = territoryOf(state, action.targetId);

    if (!source || source.owner !== seat) {
        throw new Error('Choose a territory you own to move armies from.');
    }

    if (source.armies < 2) {
        throw new Error(`${source.name} must keep at least one army, so it has none to spare.`);
    }

    if (!target || target.owner !== seat || target.id === source.id) {
        throw new Error('Choose a different territory you own as the destination.');
    }

    if (!connectedOwned(state, source.id).has(target.id)) {
        throw new Error(`${target.name} is not connected to ${source.name} through your own territories.`);
    }

    const count = action.count;

    if (!Number.isInteger(count) || count < 1 || count > source.armies - 1) {
        throw new Error(`Move between 1 and ${source.armies - 1} armies.`);
    }

    source.armies -= count;
    target.armies += count;
    state.fortifiedThisTurn = true;
};

/**
 * @param {ModelState} state
 * @param {() => number} rng
 */
const applyEndTurn = (state, rng) => {
    if (state.phase !== 'fortify') {
        throw new Error('The turn can only be ended during the fortify phase.');
    }

    const seat = state.current;

    // One card per turn, and only after at least one conquest that turn.
    if (state.conqueredThisTurn) {
        drawCard(state, seat, rng);
    }

    beginTurn(state, nextSeat(state, seat));
};

/**
 * Apply `action` for the current seat and return the same, mutated state.
 * Throws an Error (leaving the state unchanged) when the action is not legal.
 *
 * Phases advance reinforce -> attack (once every reinforcement is placed) -> conquer (only while
 * a conquest move is pending) -> fortify -> the next seat's reinforce.
 *
 * Randomness: an attack rolls each die as Math.floor(rng() * 6) + 1, attack dice first and then
 * defend dice; 'end-turn' uses rng only to reshuffle the discard pile into an empty deck.
 * options.defendDice lets the defender roll fewer dice; it is clamped to what the target can roll.
 *
 * @param {ModelState} state
 * @param {Action} action
 * @param {() => number} [rng]
 * @param {{defendDice?: number}} [options]
 * @returns {ModelState}
 */
export const applyAction = (state, action, rng = Math.random, options = {}) => {
    /** @type {any} */
    const input = action;

    if (!input || typeof input !== 'object') {
        throw new Error('An action object is required.');
    }

    if (state.winner || state.phase === 'gameover') {
        throw new Error('The game is over.');
    }

    if (input.type === 'trade') {
        applyTrade(state, input);
    } else if (input.type === 'place') {
        applyPlace(state, input);
    } else if (input.type === 'attack') {
        applyAttack(state, input, rng, options || {});
    } else if (input.type === 'occupy') {
        applyOccupy(state, input);
    } else if (input.type === 'end-attack') {
        applyEndAttack(state);
    } else if (input.type === 'fortify') {
        applyFortify(state, input);
    } else if (input.type === 'end-turn') {
        applyEndTurn(state, rng);
    } else {
        throw new Error(`Unknown action type: ${String(input.type)}`);
    }

    return state;
};

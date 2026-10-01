(() => {
    'use strict';

    const root = document.querySelector('[data-risk-game]');

    if (!root) {
        return;
    }

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const avatarCatalogElement = document.getElementById('risk-avatar-catalog');
    const avatarCatalog = (() => {
        if (!avatarCatalogElement) {
            return [];
        }

        try {
            const catalog = JSON.parse(avatarCatalogElement.textContent);

            return Array.isArray(catalog)
                ? catalog.filter((avatar) => (
                    typeof avatar?.name === 'string' && typeof avatar?.text === 'string'
                ))
                : [];
        } catch {
            return [];
        }
    })();

    /* ------------------------------------------------------------------
     * Canonical board data: six continents, 42 territories, 83 links.
     * ------------------------------------------------------------------ */

    const continentDefinitions = [
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

    const cardTypes = ['infantry', 'cavalry', 'artillery'];
    const cardTypeLabels = {
        infantry: 'Infantry',
        cavalry: 'Cavalry',
        artillery: 'Artillery',
        wild: 'Wild'
    };

    const neighborMap = new Map();

    territoryDefinitions.forEach((territory) => {
        neighborMap.set(territory.id, new Set());
    });

    adjacencyLinks.forEach(([first, second]) => {
        neighborMap.get(first).add(second);
        neighborMap.get(second).add(first);
    });

    const territoryCatalog = territoryDefinitions.map((territory, index) => ({
        ...territory,
        neighbors: Array.from(neighborMap.get(territory.id)),
        card: cardTypes[index % cardTypes.length]
    }));
    const territoryIds = new Set(territoryCatalog.map((territory) => territory.id));
    const continentById = new Map();
    const continentMembers = new Map();

    continentDefinitions.forEach((continent) => {
        continentById.set(continent.id, continent);
        continentMembers.set(
            continent.id,
            territoryCatalog.filter((territory) => territory.continent === continent.id).map((territory) => territory.id)
        );
    });

    const STARTING_ARMIES = 40;
    const DEAL_PER_COLOR = 14;
    const TRADE_SCHEDULE = [4, 6, 8, 10, 12, 15];
    const AI_ATTACK_LIMIT = 80;

    /* ------------------------------------------------------------------
     * DOM contract.
     * ------------------------------------------------------------------ */

    const byElementId = (id) => document.getElementById(id);

    const elements = {
        map: byElementId('risk-map'),
        status: byElementId('risk-status-message'),
        turn: byElementId('risk-turn-value'),
        phase: byElementId('risk-phase-value'),
        reinforcements: byElementId('risk-reinforcements-value'),
        humanCount: byElementId('risk-human-count'),
        aiCount: byElementId('risk-ai-count'),
        neutralCount: byElementId('risk-neutral-count'),
        humanCards: byElementId('risk-human-cards'),
        aiCards: byElementId('risk-ai-cards'),
        humanAvatarName: byElementId('risk-human-avatar-name'),
        humanAvatarFace: byElementId('risk-human-avatar-face'),
        aiAvatarName: byElementId('risk-ai-avatar-name'),
        aiAvatarFace: byElementId('risk-ai-avatar-face'),
        selection: byElementId('risk-territory-card'),
        selectionFigure: byElementId('risk-selection-figure'),
        selectionArt: byElementId('risk-selection-art'),
        selectionShape: byElementId('risk-selection-shape'),
        selectionCaption: byElementId('risk-selection-caption'),
        log: byElementId('risk-log'),
        startButton: byElementId('risk-start-button'),
        endButton: byElementId('risk-end-button'),
        reinforceButton: byElementId('risk-reinforce-button'),
        autoSetupButton: byElementId('risk-auto-setup-button'),
        attackDiceGroup: byElementId('risk-attack-dice-options'),
        attackButton: byElementId('risk-attack-button'),
        conquestPanel: byElementId('risk-conquest-panel'),
        conquestHelp: byElementId('risk-conquest-help'),
        conquestCount: byElementId('risk-conquest-count'),
        conquestButton: byElementId('risk-conquest-button'),
        defensePanel: byElementId('risk-defense-panel'),
        defenseHelp: byElementId('risk-defense-help'),
        defendOneButton: byElementId('risk-defend-one-button'),
        defendTwoButton: byElementId('risk-defend-two-button'),
        autoDefend: byElementId('risk-auto-defend'),
        fortifyCount: byElementId('risk-fortify-count'),
        fortifyButton: byElementId('risk-fortify-button'),
        hand: byElementId('risk-hand'),
        handHelp: byElementId('risk-hand-help'),
        tradeValue: byElementId('risk-trade-value'),
        tradeButton: byElementId('risk-trade-button'),
        diceTray: byElementId('risk-dice-tray'),
        attackDiceLabel: byElementId('risk-dice-attack-label'),
        attackDiceRow: byElementId('risk-dice-attack'),
        defendDiceLabel: byElementId('risk-dice-defend-label'),
        defendDiceRow: byElementId('risk-dice-defend'),
        diceComparisons: byElementId('risk-dice-comparisons'),
        diceResult: byElementId('risk-dice-result')
    };

    if (Object.values(elements).some((element) => !element)) {
        return;
    }

    const asButton = (element) => /** @type {HTMLButtonElement} */ (element);
    const asInput = (element) => /** @type {HTMLInputElement} */ (element);
    const attackDiceInputs = Array.from(elements.attackDiceGroup.querySelectorAll('input[name="risk-attack-dice"]')).map(asInput);

    const ownerLabels = {
        human: 'Player',
        ai: 'Browser',
        neutral: 'Neutral'
    };

    const ownerShapeLabels = {
        human: 'circle marker',
        ai: 'diamond marker',
        neutral: 'square marker'
    };

    const phaseLabels = {
        idle: 'Ready',
        setup: 'Setup',
        reinforce: 'Reinforce',
        attack: 'Attack',
        conquer: 'Move in',
        fortify: 'Fortify',
        gameover: 'Game over'
    };

    const markerShapes = {
        human: 'M-13 0a13 13 0 1 0 26 0a13 13 0 1 0 -26 0Z',
        ai: 'M0 -16L16 0L0 16L-16 0Z',
        neutral: 'M-12 -12H12V12H-12Z',
        none: 'M-11 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0Z'
    };

    /* ------------------------------------------------------------------
     * State and runtime (timers are tokenised so restart cancels them).
     * ------------------------------------------------------------------ */

    const createState = () => ({
        active: false,
        phase: 'idle',
        current: 'human',
        firstPlayer: 'human',
        turn: 0,
        territories: [],
        setupPool: { human: 0, ai: 0, neutral: 0 },
        setupStep: null,
        autoSetupHuman: false,
        reinforcementRemaining: 0,
        deck: [],
        discard: [],
        hands: { human: [], ai: [] },
        setsTraded: 0,
        selectedCardIds: [],
        pictureBonusUsed: false,
        conqueredThisTurn: false,
        fortifiedThisTurn: false,
        attacksThisTurn: 0,
        sourceId: null,
        targetId: null,
        detailId: null,
        attackDice: 3,
        autoDefend: false,
        pendingConquest: null,
        pendingDefense: null,
        battle: null,
        busy: false,
        winner: null,
        message: 'Start a new game to deal the world.',
        log: [],
        avatars: {
            human: null,
            ai: null
        }
    });

    let state = createState();

    const runtime = {
        token: 0,
        timers: /** @type {Set<number>} */ (new Set()),
        rollInterval: 0,
        battleCounter: 0,
        diceKey: '',
        figureKey: ''
    };

    const schedule = (callback, delay) => {
        const token = runtime.token;
        const timerId = window.setTimeout(() => {
            runtime.timers.delete(timerId);

            if (token === runtime.token) {
                callback();
            }
        }, Math.max(0, delay));

        runtime.timers.add(timerId);
    };

    const stopRollingFaces = () => {
        if (runtime.rollInterval) {
            window.clearInterval(runtime.rollInterval);
            runtime.rollInterval = 0;
        }
    };

    const cancelPending = () => {
        runtime.token += 1;
        runtime.timers.forEach((timerId) => window.clearTimeout(timerId));
        runtime.timers.clear();
        stopRollingFaces();
    };

    const reducedMotion = () => (
        typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    const pace = (milliseconds) => (reducedMotion() ? Math.min(milliseconds, 160) : milliseconds);

    /* ------------------------------------------------------------------
     * Small helpers.
     * ------------------------------------------------------------------ */

    const byId = (id) => (id ? state.territories.find((territory) => territory.id === id) || null : null);
    const opponentOf = (player) => (player === 'human' ? 'ai' : 'human');
    const ownedBy = (owner) => state.territories.filter((territory) => territory.owner === owner);
    const isNeighbor = (territory, neighborId) => Boolean(territory && territory.neighbors.includes(neighborId));
    const ownerLabel = (owner) => ownerLabels[owner] || 'Unassigned';
    const pluralArmy = (count) => `${count} arm${count === 1 ? 'y' : 'ies'}`;
    const diceLabel = (count) => `${count} ${count === 1 ? 'die' : 'dice'}`;
    const continentName = (territory) => continentById.get(territory.continent)?.name || '';
    const hostileNeighbors = (player, territory) => territory.neighbors
        .map(byId)
        .filter((neighbor) => neighbor && neighbor.owner !== player);

    const shuffle = (items) => {
        const copy = items.slice();

        for (let index = copy.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
        }

        return copy;
    };

    const addLog = (message) => {
        state.log.unshift(message);
        state.log = state.log.slice(0, 40);
    };

    const createText = (tagName, className, text) => {
        const node = document.createElement(tagName);

        if (className) {
            node.className = className;
        }

        node.textContent = text;
        return node;
    };

    const createSvg = (tagName, attributes) => {
        const node = /** @type {SVGElement} */ (document.createElementNS(svgNamespace, String(tagName)));

        Object.entries(attributes || {}).forEach(([name, value]) => {
            node.setAttribute(name, String(value));
        });

        return node;
    };

    const chooseAvatars = () => {
        if (avatarCatalog.length < 2) {
            return { human: null, ai: null };
        }

        const humanIndex = Math.floor(Math.random() * avatarCatalog.length);
        let aiIndex = Math.floor(Math.random() * (avatarCatalog.length - 1));

        if (aiIndex >= humanIndex) {
            aiIndex += 1;
        }

        return {
            human: avatarCatalog[humanIndex],
            ai: avatarCatalog[aiIndex]
        };
    };

    /* ------------------------------------------------------------------
     * Shared rules: reinforcements, cards, combat, fortification.
     * Human and browser actions both go through these functions.
     * ------------------------------------------------------------------ */

    const controlledContinents = (player) => continentDefinitions.filter((continent) => (
        continentMembers.get(continent.id).every((id) => byId(id)?.owner === player)
    ));

    const reinforcementBreakdown = (player) => {
        const territoryCount = ownedBy(player).length;
        const base = Math.max(3, Math.floor(territoryCount / 3));
        const continents = controlledContinents(player);
        const bonus = continents.reduce((sum, continent) => sum + continent.bonus, 0);

        return {
            territoryCount,
            base,
            continents,
            bonus,
            total: base + bonus
        };
    };

    const describeBreakdown = (breakdown) => {
        const parts = [`${breakdown.territoryCount} territories → ${breakdown.base}`];

        breakdown.continents.forEach((continent) => {
            parts.push(`${continent.name} +${continent.bonus}`);
        });

        return parts.join(', ');
    };

    const tradeValue = (setsTraded) => (
        setsTraded < TRADE_SCHEDULE.length
            ? TRADE_SCHEDULE[setsTraded]
            : TRADE_SCHEDULE[TRADE_SCHEDULE.length - 1] + (setsTraded - TRADE_SCHEDULE.length + 1) * 5
    );

    const buildDeck = () => shuffle([
        ...territoryCatalog.map((territory) => ({
            id: `card-${territory.id}`,
            territoryId: territory.id,
            type: territory.card
        })),
        { id: 'wild-1', territoryId: null, type: 'wild' },
        { id: 'wild-2', territoryId: null, type: 'wild' }
    ]);

    const isValidSet = (cards) => {
        if (cards.length !== 3 || new Set(cards).size !== 3) {
            return false;
        }

        if (cards.some((card) => card.type === 'wild')) {
            return true;
        }

        const types = new Set(cards.map((card) => card.type));
        return types.size === 1 || types.size === 3;
    };

    const findValidSets = (hand) => {
        const sets = [];

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

    const describeCard = (card) => {
        const territory = territoryCatalog.find((entry) => entry.id === card.territoryId);
        return territory ? `${territory.name} (${cardTypeLabels[card.type]})` : 'Wild';
    };

    const drawCard = (player) => {
        if (state.deck.length === 0 && state.discard.length > 0) {
            state.deck = shuffle(state.discard);
            state.discard = [];
            addLog('The discard pile is reshuffled into the card deck.');
        }

        const card = state.deck.pop() || null;

        if (card) {
            state.hands[player].push(card);
        }

        return card;
    };

    const territoryPressure = (player, territory) => hostileNeighbors(player, territory)
        .filter((neighbor) => neighbor.owner === opponentOf(player))
        .reduce((sum, neighbor) => sum + neighbor.armies, 0);

    const continentShare = (player, continentId) => {
        const members = continentMembers.get(continentId);
        const owned = members.filter((id) => byId(id)?.owner === player).length;
        return owned / members.length;
    };

    // Same scoring is used for the pictured-card bonus of both players and for browser placement.
    const placementScore = (player, territory) => {
        const hostile = hostileNeighbors(player, territory);

        if (hostile.length === 0) {
            return -100 - territory.armies;
        }

        const weakestHostile = Math.min(...hostile.map((neighbor) => neighbor.armies));

        return continentShare(player, territory.continent) * 12
            + territoryPressure(player, territory) * 0.5
            + hostile.length
            + (territory.armies > weakestHostile ? 2 : 0)
            - territory.armies * 0.35;
    };

    const bestBy = (items, score) => items.reduce((best, item) => {
        const value = score(item);
        return !best || value > best.value ? { item, value } : best;
    }, null)?.item || null;

    const tradeError = (player, cards) => {
        if (!state.active || state.current !== player || state.phase !== 'reinforce') {
            return 'Cards can only be traded during your reinforcement phase.';
        }

        if (state.busy) {
            return 'Wait for the current action to finish.';
        }

        const hand = state.hands[player];

        if (cards.length !== 3 || cards.some((card) => !card || !hand.includes(card))) {
            return 'Select exactly three cards from your hand.';
        }

        if (!isValidSet(cards)) {
            return 'A set is three of a kind, one of each type, or any two cards with a wild.';
        }

        return '';
    };

    const tradeCards = (player, cardIds) => {
        const hand = state.hands[player];
        const cards = cardIds.map((cardId) => hand.find((card) => card.id === cardId) || null);
        const error = tradeError(player, cards);

        if (error) {
            return error;
        }

        const value = tradeValue(state.setsTraded);
        state.setsTraded += 1;
        state.hands[player] = hand.filter((card) => !cards.includes(card));
        state.discard.push(...cards);
        state.reinforcementRemaining += value;

        let bonusText = '';

        if (!state.pictureBonusUsed) {
            const pictured = cards
                .map((card) => byId(card.territoryId))
                .filter((territory) => territory && territory.owner === player);
            const chosen = bestBy(pictured, (territory) => placementScore(player, territory));

            if (chosen) {
                chosen.armies += 2;
                state.pictureBonusUsed = true;
                bonusText = ` +2 armies placed on pictured ${chosen.name}.`;
            }
        }

        const description = player === 'human'
            ? cards.map(describeCard).join(', ')
            : 'a set';
        addLog(`${ownerLabel(player)} trades ${description} for ${pluralArmy(value)}.${bonusText}`);
        return '';
    };

    const placeReinforcement = (player, territory, count) => {
        if (!state.active || state.current !== player || state.phase !== 'reinforce') {
            return 'Reinforcements can only be placed during your reinforcement phase.';
        }

        if (state.busy) {
            return 'Wait for the current action to finish.';
        }

        if (state.hands[player].length >= 5) {
            return `${ownerLabel(player)} holds ${state.hands[player].length} cards and must trade a set first.`;
        }

        if (!territory || territory.owner !== player) {
            return 'Reinforcements can only be placed on territory you own.';
        }

        if (!Number.isInteger(count) || count < 1 || count > state.reinforcementRemaining) {
            return state.reinforcementRemaining > 0
                ? `Place between 1 and ${state.reinforcementRemaining} armies.`
                : 'No reinforcements remain to place.';
        }

        territory.armies += count;
        state.reinforcementRemaining -= count;
        return '';
    };

    const rollDie = () => Math.floor(Math.random() * 6) + 1;
    const rollDice = (count) => Array.from({ length: count }, rollDie);
    const maxAttackDice = (source) => (source ? Math.max(0, Math.min(3, source.armies - 1)) : 0);
    const maxDefendDice = (target) => (target ? Math.max(0, Math.min(2, target.armies)) : 0);

    const compareRolls = (attackRolls, defendRolls) => {
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

    const legalAttackTargets = (player, source) => (
        source && source.owner === player && source.armies > 1
            ? hostileNeighbors(player, source)
            : []
    );

    const hasLegalAttack = (player) => ownedBy(player).some((territory) => legalAttackTargets(player, territory).length > 0);

    const attackError = (player, source, target, dice) => {
        if (!state.active || state.current !== player) {
            return 'It is not your turn.';
        }

        if (state.phase !== 'attack') {
            return 'Attacks are only allowed during the attack phase.';
        }

        if (state.busy || state.pendingConquest || state.pendingDefense) {
            return 'Finish the current battle first.';
        }

        if (!source || source.owner !== player) {
            return 'Choose an attacking territory you own.';
        }

        if (source.armies < 2) {
            return `${source.name} needs at least two armies to attack.`;
        }

        if (!target) {
            return 'Choose a highlighted target territory.';
        }

        if (target.owner === player) {
            return 'You cannot attack your own territory.';
        }

        if (!isNeighbor(source, target.id)) {
            return `${target.name} is not adjacent to ${source.name}.`;
        }

        if (!Number.isInteger(dice) || dice < 1 || dice > maxAttackDice(source)) {
            return `${source.name} can roll between 1 and ${maxAttackDice(source)} attack dice.`;
        }

        return '';
    };

    const connectedOwned = (player, startId) => {
        const start = byId(startId);
        const reached = new Set();

        if (!start || start.owner !== player) {
            return reached;
        }

        const queue = [start.id];
        reached.add(start.id);

        while (queue.length > 0) {
            const current = byId(queue.shift());

            current.neighbors.forEach((neighborId) => {
                if (!reached.has(neighborId) && byId(neighborId)?.owner === player) {
                    reached.add(neighborId);
                    queue.push(neighborId);
                }
            });
        }

        return reached;
    };

    const fortifyError = (player, source, target, count) => {
        if (!state.active || state.current !== player || state.phase !== 'fortify') {
            return 'Fortification is only allowed during your fortify phase.';
        }

        if (state.busy) {
            return 'Wait for the current action to finish.';
        }

        if (state.fortifiedThisTurn) {
            return 'You have already fortified this turn.';
        }

        if (!source || source.owner !== player) {
            return 'Choose a territory you own to move armies from.';
        }

        if (source.armies < 2) {
            return `${source.name} must keep at least one army, so it has none to spare.`;
        }

        if (!target || target.owner !== player || target.id === source.id) {
            return 'Choose a different highlighted territory you own as the destination.';
        }

        if (!connectedOwned(player, source.id).has(target.id)) {
            return `${target.name} is not connected to ${source.name} through your own territories.`;
        }

        if (!Number.isInteger(count) || count < 1 || count > source.armies - 1) {
            return `Move between 1 and ${source.armies - 1} armies.`;
        }

        return '';
    };

    const performFortify = (player, source, target, count) => {
        const error = fortifyError(player, source, target, count);

        if (error) {
            return error;
        }

        source.armies -= count;
        target.armies += count;
        state.fortifiedThisTurn = true;
        addLog(`${ownerLabel(player)} fortifies ${target.name} with ${pluralArmy(count)} from ${source.name}.`);
        return '';
    };

    const moveIntoConquest = (player, count) => {
        const pending = state.pendingConquest;

        if (!pending || pending.player !== player || state.phase !== 'conquer') {
            return 'No conquest move is pending.';
        }

        if (!Number.isInteger(count) || count < pending.min || count > pending.max) {
            return `Move between ${pending.min} and ${pending.max} armies.`;
        }

        const source = byId(pending.sourceId);
        const target = byId(pending.targetId);
        const extra = count - pending.min;

        source.armies -= extra;
        target.armies += extra;
        state.pendingConquest = null;
        state.phase = 'attack';
        addLog(`${ownerLabel(player)} moves ${pluralArmy(count)} from ${source.name} into ${target.name}.`);
        return '';
    };

    /* ------------------------------------------------------------------
     * Setup: random deal, then 2 own + 1 neutral army per placement step.
     * ------------------------------------------------------------------ */

    const setupPrompt = () => {
        const step = state.setupStep;
        const ownLeft = step.ownNeeded - step.own;
        const neutralLeft = step.neutralNeeded - step.neutral;
        const parts = [];

        if (ownLeft > 0) {
            parts.push(`${pluralArmy(ownLeft)} on your territories (circles)`);
        }

        if (neutralLeft > 0) {
            parts.push(`${pluralArmy(neutralLeft)} on a neutral territory (squares)`);
        }

        return `Setup: place ${parts.join(' and ')}. ${state.setupPool.human} of your setup armies remain.`;
    };

    const placeSetupArmy = (player, territory) => {
        if (!state.active || state.phase !== 'setup' || state.current !== player || !state.setupStep) {
            return 'Setup placement is not available now.';
        }

        const step = state.setupStep;

        if (!territory) {
            return 'Choose a territory.';
        }

        if (territory.owner === player) {
            if (step.own >= step.ownNeeded) {
                return 'Your own armies for this step are placed. Now place one neutral army.';
            }

            territory.armies += 1;
            state.setupPool[player] -= 1;
            step.own += 1;
            return '';
        }

        if (territory.owner === 'neutral') {
            if (step.neutral >= step.neutralNeeded) {
                return 'The neutral army for this step is placed. Now place your own armies.';
            }

            territory.armies += 1;
            state.setupPool.neutral -= 1;
            step.neutral += 1;
            return '';
        }

        return 'During setup, place armies on your own territories or on neutral territories.';
    };

    const setupStepComplete = () => Boolean(state.setupStep)
        && state.setupStep.own >= state.setupStep.ownNeeded
        && state.setupStep.neutral >= state.setupStep.neutralNeeded;

    const pickNeutralPlacement = (player) => bestBy(ownedBy('neutral'), (territory) => {
        const opponent = opponentOf(player);
        const opponentNeighbors = territory.neighbors.filter((id) => byId(id)?.owner === opponent).length;
        const ownNeighbors = territory.neighbors.filter((id) => byId(id)?.owner === player).length;

        return opponentNeighbors * 2
            + continentShare(opponent, territory.continent) * 5
            - ownNeighbors * 1.5
            - territory.armies * 0.25
            + Math.random() * 0.5;
    });

    const pickPlacementTerritory = (player) => bestBy(
        ownedBy(player),
        (territory) => placementScore(player, territory) + Math.random() * 0.3
    );

    const beginSetupStep = (player) => {
        state.current = player;
        state.setupStep = {
            own: 0,
            neutral: 0,
            ownNeeded: Math.min(2, state.setupPool[player]),
            neutralNeeded: Math.min(1, state.setupPool.neutral)
        };
        state.sourceId = null;
        state.targetId = null;

        if (player === 'ai' || state.autoSetupHuman) {
            state.message = player === 'ai'
                ? 'Browser is placing two of its armies and one neutral army.'
                : 'Auto-placing your setup armies.';
            render();
            schedule(() => autoSetupStep(player), pace(player === 'ai' ? 380 : 140));
            return;
        }

        state.message = setupPrompt();
        render();
    };

    const startPlay = () => {
        state.setupStep = null;
        state.deck = buildDeck();
        state.discard = [];
        state.hands = { human: [], ai: [] };
        state.setsTraded = 0;
        addLog(`Setup complete: every color has ${STARTING_ARMIES} armies. ${ownerLabel(state.firstPlayer)} moves first.`);
        beginTurn(state.firstPlayer);
    };

    const finishSetupStep = (player) => {
        if (state.setupPool.human <= 0 && state.setupPool.ai <= 0) {
            startPlay();
            return;
        }

        const next = state.setupPool[opponentOf(player)] > 0 ? opponentOf(player) : player;
        beginSetupStep(next);
    };

    const autoSetupStep = (player) => {
        if (!state.active || state.phase !== 'setup' || state.current !== player) {
            return;
        }

        const step = state.setupStep;

        while (step.own < step.ownNeeded) {
            if (placeSetupArmy(player, pickPlacementTerritory(player))) {
                break;
            }
        }

        while (step.neutral < step.neutralNeeded) {
            if (placeSetupArmy(player, pickNeutralPlacement(player))) {
                break;
            }
        }

        finishSetupStep(player);
    };

    const startGame = () => {
        cancelPending();

        const preferences = {
            attackDice: state.attackDice,
            autoDefend: state.autoDefend
        };

        state = createState();
        Object.assign(state, preferences);
        state.avatars = chooseAvatars();
        state.active = true;
        state.phase = 'setup';

        const owners = ['human', 'ai', 'neutral'];
        const dealtOwners = new Map();

        shuffle(territoryCatalog.map((territory) => territory.id)).forEach((id, index) => {
            dealtOwners.set(id, owners[Math.floor(index / DEAL_PER_COLOR)]);
        });

        state.territories = territoryCatalog.map((territory) => ({
            ...territory,
            owner: dealtOwners.get(territory.id),
            armies: 1
        }));
        state.setupPool = {
            human: STARTING_ARMIES - DEAL_PER_COLOR,
            ai: STARTING_ARMIES - DEAL_PER_COLOR,
            neutral: STARTING_ARMIES - DEAL_PER_COLOR
        };
        state.firstPlayer = Math.random() < 0.5 ? 'human' : 'ai';
        addLog(`New game: 14 territories each dealt to Player, Browser and Neutral. ${ownerLabel(state.firstPlayer)} places first.`);
        beginSetupStep(state.firstPlayer);
    };

    /* ------------------------------------------------------------------
     * Turn flow.
     * ------------------------------------------------------------------ */

    const humanReinforcePrompt = () => {
        const handSize = state.hands.human.length;

        if (handSize >= 5) {
            return `You hold ${handSize} cards: trade a set before placing armies (mandatory at five or more).`;
        }

        if (state.reinforcementRemaining > 0) {
            return `Place ${pluralArmy(state.reinforcementRemaining)}: click your territories to add one at a time, or select one and use Place all here.`;
        }

        return 'All armies placed. Trade another set or press Begin attacks.';
    };

    const enterAttackPhase = (player) => {
        state.phase = 'attack';
        state.targetId = null;

        if (player === 'human') {
            state.sourceId = null;
            state.message = hasLegalAttack('human')
                ? 'Attack phase: select one of your territories with two or more armies, then a highlighted target.'
                : 'Attack phase: you have no legal attacks. Press End attacks to fortify.';
        }
    };

    const beginTurn = (player) => {
        state.current = player;
        state.turn += 1;
        state.phase = 'reinforce';
        state.conqueredThisTurn = false;
        state.fortifiedThisTurn = false;
        state.pictureBonusUsed = false;
        state.attacksThisTurn = 0;
        state.selectedCardIds = [];
        state.sourceId = null;
        state.targetId = null;
        state.pendingConquest = null;
        state.pendingDefense = null;

        const breakdown = reinforcementBreakdown(player);
        state.reinforcementRemaining = breakdown.total;
        addLog(`Turn ${state.turn}: ${ownerLabel(player)} receives ${pluralArmy(breakdown.total)} (${describeBreakdown(breakdown)}).`);

        if (player === 'ai') {
            state.message = 'Browser is reinforcing.';
            render();
            schedule(aiStep, pace(650));
            return;
        }

        state.message = `Your turn. ${humanReinforcePrompt()}`;
        render();
    };

    const endTurn = (player) => {
        if (!state.active || state.phase === 'gameover' || state.current !== player) {
            return;
        }

        if (state.conqueredThisTurn) {
            const card = drawCard(player);

            if (!card) {
                addLog('No cards remain to draw.');
            } else if (player === 'human') {
                addLog(`Player earns a card for conquering this turn: ${describeCard(card)}.`);
            } else {
                addLog('Browser earns a card for conquering this turn.');
            }
        }

        beginTurn(opponentOf(player));
    };

    const declareVictory = (winner) => {
        cancelPending();
        state.phase = 'gameover';
        state.active = false;
        state.winner = winner;
        state.busy = false;
        state.pendingConquest = null;
        state.pendingDefense = null;
        state.reinforcementRemaining = 0;
        state.targetId = null;

        const neutralLeft = ownedBy('neutral').length;
        const neutralNote = neutralLeft > 0
            ? ` ${neutralLeft} neutral ${neutralLeft === 1 ? 'territory remains' : 'territories remain'}, which this variant does not require you to conquer.`
            : '';

        state.message = winner === 'human'
            ? `Victory! You eliminated the Browser.${neutralNote}`
            : 'Defeat. The Browser eliminated your last army. Start a new game for a rematch.';
        addLog(state.message);
        render();
    };

    /* ------------------------------------------------------------------
     * Battles: rolls are committed up front, revealed after the animation.
     * ------------------------------------------------------------------ */

    const startRollingFaces = () => {
        stopRollingFaces();

        if (reducedMotion()) {
            return;
        }

        runtime.rollInterval = window.setInterval(() => {
            elements.diceTray.querySelectorAll('.risk-die.is-rolling').forEach((die) => {
                die.setAttribute('data-value', String(rollDie()));
            });
        }, 90);
    };

    const commitBattle = (onComplete) => {
        stopRollingFaces();

        const battle = state.battle;

        if (!battle || !battle.rolling) {
            return;
        }

        const source = byId(battle.sourceId);
        const target = byId(battle.targetId);
        const outcome = battle.outcome;

        source.armies -= outcome.attackerLosses;
        target.armies -= outcome.defenderLosses;
        battle.rolling = false;
        state.busy = false;

        let summary = `${ownerLabel(battle.attacker)} rolled ${outcome.attack.join(', ')} against ${ownerLabel(battle.defender)} ${outcome.defend.join(', ')} at ${target.name}: attacker loses ${outcome.attackerLosses}, defender loses ${outcome.defenderLosses}.`;

        if (target.armies <= 0) {
            // The minimum (dice rolled) moves in immediately so no territory is ever left empty.
            const available = source.armies - 1;

            target.owner = battle.attacker;
            target.armies = battle.attackDice;
            source.armies -= battle.attackDice;
            battle.conquered = true;
            state.conqueredThisTurn = true;
            summary += ` ${target.name} is conquered.`;
            addLog(summary);

            if (ownedBy(opponentOf(battle.attacker)).length === 0) {
                declareVictory(battle.attacker);
                return;
            }

            state.pendingConquest = {
                player: battle.attacker,
                sourceId: source.id,
                targetId: target.id,
                min: battle.attackDice,
                max: available
            };
            state.phase = 'conquer';
            state.message = battle.attacker === 'human'
                ? `${summary} Move between ${state.pendingConquest.min} and ${state.pendingConquest.max} armies in.`
                : summary;
        } else {
            addLog(summary);
            state.message = summary;
        }

        render();

        if (typeof onComplete === 'function') {
            onComplete();
        }
    };

    const rollBattle = (player, source, target, attackDice, defendDice, onComplete) => {
        const outcome = compareRolls(rollDice(attackDice), rollDice(defendDice));

        runtime.battleCounter += 1;
        state.busy = true;
        state.sourceId = source.id;
        state.targetId = target.id;
        state.battle = {
            id: runtime.battleCounter,
            rolling: true,
            attacker: player,
            defender: target.owner,
            sourceId: source.id,
            targetId: target.id,
            sourceName: source.name,
            targetName: target.name,
            attackDice,
            defendDice,
            outcome,
            conquered: false
        };
        state.message = `${ownerLabel(player)} rolls ${diceLabel(attackDice)} from ${source.name} against ${diceLabel(defendDice)} on ${target.name}…`;
        render();
        startRollingFaces();
        schedule(() => commitBattle(onComplete), reducedMotion() ? 120 : 1100);
    };

    const launchBattle = (player, source, target, attackDice, onComplete) => {
        const error = attackError(player, source, target, attackDice);

        if (error) {
            return error;
        }

        const defendMax = maxDefendDice(target);

        if (target.owner === 'human' && defendMax > 1 && !state.autoDefend) {
            state.pendingDefense = {
                player,
                sourceId: source.id,
                targetId: target.id,
                attackDice,
                onComplete
            };
            state.sourceId = source.id;
            state.targetId = target.id;
            state.message = `${source.name} attacks your ${target.name} with ${diceLabel(attackDice)}. Choose your defense dice.`;
            render();
            return '';
        }

        rollBattle(player, source, target, attackDice, defendMax, onComplete);
        return '';
    };

    const chooseDefense = (dice) => {
        const pending = state.pendingDefense;

        if (!pending || state.busy) {
            return;
        }

        const source = byId(pending.sourceId);
        const target = byId(pending.targetId);

        if (!Number.isInteger(dice) || dice < 1 || dice > maxDefendDice(target)) {
            state.message = `${target.name} can defend with 1 to ${maxDefendDice(target)} dice.`;
            render();
            return;
        }

        state.pendingDefense = null;
        rollBattle(pending.player, source, target, pending.attackDice, dice, pending.onComplete);
    };

    /* ------------------------------------------------------------------
     * Browser player: same rule functions, bounded heuristics.
     * ------------------------------------------------------------------ */

    const chooseAiSet = (sets) => bestBy(sets, (cards) => (
        cards.filter((card) => byId(card.territoryId)?.owner === 'ai').length * 2
        - cards.filter((card) => card.type === 'wild').length * 3
    ));

    const chooseAiAttack = () => {
        const needCard = !state.conqueredThisTurn;
        let best = null;

        ownedBy('ai').forEach((source) => {
            legalAttackTargets('ai', source).forEach((target) => {
                const advantage = source.armies - target.armies;
                const easyCard = needCard && target.armies === 1 && source.armies >= 2;

                if (!easyCard && (source.armies < 3 || advantage < 2)) {
                    return;
                }

                const score = advantage * 2
                    + (target.owner === 'human' ? 3 : 0)
                    + continentShare('ai', target.continent) * 8
                    + (target.armies === 1 ? 2 : 0)
                    + (easyCard ? 4 : 0);

                if (!best || score > best.score) {
                    best = { source, target, score };
                }
            });
        });

        return best;
    };

    const aiConquestCount = (pending) => {
        const source = byId(pending.sourceId);
        const sourceStillThreatened = hostileNeighbors('ai', source).length > 0;

        if (!sourceStillThreatened) {
            return pending.max;
        }

        return Math.max(pending.min, Math.min(pending.max, Math.ceil(pending.max * 2 / 3)));
    };

    const aiReinforce = () => {
        let guard = 0;

        while (guard < 8) {
            guard += 1;
            const sets = findValidSets(state.hands.ai);

            if (sets.length === 0 || tradeCards('ai', chooseAiSet(sets).map((card) => card.id))) {
                break;
            }
        }

        const placements = new Map();

        while (state.reinforcementRemaining > 0) {
            const territory = pickPlacementTerritory('ai');

            if (placeReinforcement('ai', territory, 1)) {
                break;
            }

            placements.set(territory.name, (placements.get(territory.name) || 0) + 1);
        }

        if (placements.size > 0) {
            addLog(`Browser deploys: ${Array.from(placements).map(([name, count]) => `${name} +${count}`).join(', ')}.`);
        }

        enterAttackPhase('ai');
        state.message = 'Browser is choosing attacks.';
        render();
        schedule(aiStep, pace(700));
    };

    const afterAiBattle = () => {
        if (!state.active || state.current !== 'ai') {
            return;
        }

        if (state.phase === 'conquer' && state.pendingConquest) {
            moveIntoConquest('ai', aiConquestCount(state.pendingConquest));
            render();
        }

        schedule(aiStep, pace(750));
    };

    const aiAttack = () => {
        const move = state.attacksThisTurn < AI_ATTACK_LIMIT ? chooseAiAttack() : null;

        if (!move) {
            addLog(state.attacksThisTurn === 0
                ? 'Browser makes no attacks this turn.'
                : `Browser ends its attacks after ${state.attacksThisTurn} ${state.attacksThisTurn === 1 ? 'battle' : 'battles'}.`);
            state.phase = 'fortify';
            state.sourceId = null;
            state.targetId = null;
            state.message = 'Browser is fortifying.';
            render();
            schedule(aiStep, pace(500));
            return;
        }

        state.attacksThisTurn += 1;
        const error = launchBattle('ai', move.source, move.target, maxAttackDice(move.source), afterAiBattle);

        if (error) {
            state.phase = 'fortify';
            schedule(aiStep, pace(300));
        }
    };

    const aiFortify = () => {
        let best = null;

        ownedBy('ai')
            .filter((source) => source.armies > 1 && hostileNeighbors('ai', source).length === 0)
            .forEach((source) => {
                connectedOwned('ai', source.id).forEach((targetId) => {
                    const target = byId(targetId);
                    const hostileCount = hostileNeighbors('ai', target).length;

                    if (targetId === source.id || hostileCount === 0) {
                        return;
                    }

                    const score = territoryPressure('ai', target) + hostileCount + source.armies;

                    if (!best || score > best.score) {
                        best = { source, target, score };
                    }
                });
            });

        if (!best || performFortify('ai', best.source, best.target, best.source.armies - 1)) {
            addLog('Browser skips fortification.');
        }

        endTurn('ai');
    };

    const aiStep = () => {
        if (!state.active || state.current !== 'ai' || state.busy || state.pendingDefense) {
            return;
        }

        if (state.phase === 'reinforce') {
            aiReinforce();
            return;
        }

        if (state.phase === 'attack') {
            aiAttack();
            return;
        }

        if (state.phase === 'fortify') {
            aiFortify();
        }
    };

    /* ------------------------------------------------------------------
     * Human input.
     * ------------------------------------------------------------------ */

    const handleSetupClick = (territory) => {
        const error = placeSetupArmy('human', territory);

        if (error) {
            state.message = error;
            render();
            return;
        }

        if (setupStepComplete()) {
            finishSetupStep('human');
            return;
        }

        state.message = setupPrompt();
        render();
    };

    const afterHumanPlacement = () => {
        if (state.reinforcementRemaining === 0 && findValidSets(state.hands.human).length === 0) {
            enterAttackPhase('human');
        } else {
            state.message = humanReinforcePrompt();
        }

        render();
    };

    const handleReinforceClick = (territory) => {
        const error = placeReinforcement('human', territory, 1);

        if (error) {
            state.message = error;
            render();
            return;
        }

        state.sourceId = territory.id;
        afterHumanPlacement();
    };

    const handleAttackSelection = (territory) => {
        const source = byId(state.sourceId);

        if (territory.owner === 'human') {
            state.sourceId = territory.id;
            state.targetId = null;

            const targets = legalAttackTargets('human', territory);
            state.message = territory.armies < 2
                ? `${territory.name} needs at least two armies to attack.`
                : targets.length > 0
                    ? `${territory.name} selected. Choose one of ${targets.length} highlighted targets.`
                    : `${territory.name} has no hostile neighbors.`;
            return;
        }

        if (!source || source.owner !== 'human') {
            state.message = 'Select one of your territories as the attacker first.';
            return;
        }

        const error = attackError('human', source, territory, Math.max(1, maxAttackDice(source)));

        if (error) {
            state.targetId = null;
            state.message = error;
            return;
        }

        state.targetId = territory.id;
        state.message = `${source.name} → ${territory.name} (${ownerLabel(territory.owner)}, ${pluralArmy(territory.armies)}). Choose attack dice and press Roll attack.`;
    };

    const handleFortifySelection = (territory) => {
        const source = byId(state.sourceId);

        if (territory.owner !== 'human') {
            state.message = 'Fortify only between territories you own.';
            return;
        }

        if (source && territory.id === source.id) {
            state.sourceId = null;
            state.targetId = null;
            state.message = 'Fortify source cleared. Select a territory with spare armies.';
            return;
        }

        if (!source || source.owner !== 'human' || source.armies < 2) {
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = territory.armies > 1
                ? `${territory.name} selected. Highlighted territories are connected through your land.`
                : `${territory.name} has no spare armies to move. Pick a territory with two or more.`;
            return;
        }

        if (!connectedOwned('human', source.id).has(territory.id)) {
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = `${territory.name} is not connected to ${source.name} through your territory, so it is now the source.`;
            return;
        }

        state.targetId = territory.id;
        state.message = `Choose how many armies move from ${source.name} to ${territory.name}, then press Fortify.`;
    };

    const selectTerritory = (territoryId) => {
        const territory = byId(territoryId);

        if (!territory) {
            return;
        }

        state.detailId = territory.id;

        if (!state.active) {
            state.message = state.phase === 'gameover'
                ? `Game over. Viewing ${territory.name}. Start a new game to play again.`
                : 'Start a new game to deal the world.';
            render();
            return;
        }

        if (state.current !== 'human') {
            state.message = state.pendingDefense
                ? 'Choose your defense dice first.'
                : `The Browser is taking its turn. Viewing ${territory.name}.`;
            render();
            return;
        }

        if (state.busy) {
            state.message = 'The dice are still rolling.';
            render();
            return;
        }

        if (state.phase === 'setup') {
            handleSetupClick(territory);
            return;
        }

        if (state.phase === 'reinforce') {
            handleReinforceClick(territory);
            return;
        }

        if (state.phase === 'attack') {
            handleAttackSelection(territory);
        } else if (state.phase === 'conquer') {
            state.message = 'Move armies into the conquered territory before doing anything else.';
        } else if (state.phase === 'fortify') {
            handleFortifySelection(territory);
        }

        render();
    };

    const effectiveAttackDice = (source) => Math.min(state.attackDice, maxAttackDice(source));

    const afterHumanBattle = () => {
        if (state.phase !== 'attack') {
            return;
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);

        if (!source || !target || attackError('human', source, target, Math.max(1, maxAttackDice(source)))) {
            state.targetId = null;
        }

        render();
    };

    const humanAttack = () => {
        if (state.current !== 'human' || state.busy) {
            return;
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const error = launchBattle('human', source, target, effectiveAttackDice(source), afterHumanBattle);

        if (error) {
            state.message = error;
            render();
        }
    };

    const confirmConquest = () => {
        const pending = state.pendingConquest;

        if (!pending || pending.player !== 'human' || state.busy) {
            return;
        }

        const error = moveIntoConquest('human', asInput(elements.conquestCount).valueAsNumber);

        if (error) {
            state.message = error;
            render();
            return;
        }

        const source = byId(pending.sourceId);
        state.targetId = null;
        state.message = hasLegalAttack('human')
            ? `Armies moved. ${source.armies > 1 ? `${source.name} can keep attacking, or ` : ''}select another attacker or press End attacks.`
            : 'Armies moved. No legal attacks remain; press End attacks to fortify.';
        render();
    };

    const humanFortify = () => {
        if (state.current !== 'human') {
            return;
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const error = performFortify('human', source, target, asInput(elements.fortifyCount).valueAsNumber);

        if (error) {
            state.message = error;
            render();
            return;
        }

        endTurn('human');
    };

    const placeAllReinforcements = () => {
        if (state.current !== 'human') {
            return;
        }

        const territory = byId(state.sourceId);
        const error = placeReinforcement('human', territory, state.reinforcementRemaining);

        if (error) {
            state.message = error;
            render();
            return;
        }

        afterHumanPlacement();
    };

    const humanTrade = () => {
        const error = tradeCards('human', state.selectedCardIds);

        if (error) {
            state.message = error;
        } else {
            state.selectedCardIds = [];
            state.message = humanReinforcePrompt();
        }

        render();
    };

    const toggleCard = (cardId) => {
        if (!state.active || state.current !== 'human' || !state.hands.human.some((card) => card.id === cardId)) {
            return;
        }

        if (state.selectedCardIds.includes(cardId)) {
            state.selectedCardIds = state.selectedCardIds.filter((id) => id !== cardId);
        } else {
            state.selectedCardIds = [...state.selectedCardIds, cardId].slice(-3);
        }

        render();
    };

    const advancePhase = () => {
        if (!state.active || state.current !== 'human' || state.busy || state.pendingConquest) {
            return;
        }

        if (state.phase === 'reinforce') {
            if (state.hands.human.length >= 5 || state.reinforcementRemaining > 0) {
                state.message = humanReinforcePrompt();
            } else {
                enterAttackPhase('human');
            }

            render();
            return;
        }

        if (state.phase === 'attack') {
            state.phase = 'fortify';
            state.targetId = null;
            state.message = 'Fortify (optional, once): select a territory with spare armies, then a highlighted connected territory. Or press End turn.';
            render();
            return;
        }

        if (state.phase === 'fortify') {
            addLog('Player ends the turn without fortifying.');
            endTurn('human');
        }
    };

    const enableAutoSetup = () => {
        if (!state.active || state.phase !== 'setup') {
            return;
        }

        state.autoSetupHuman = true;

        if (state.current === 'human') {
            autoSetupStep('human');
        } else {
            render();
        }
    };

    /* ------------------------------------------------------------------
     * Board construction: inline vector board, one marker per rules entry.
     * ------------------------------------------------------------------ */

    let boardSvg = /** @type {SVGSVGElement} */ (elements.map.querySelector('svg'));

    if (!boardSvg) {
        boardSvg = /** @type {SVGSVGElement} */ (createSvg('svg', { viewBox: '0 0 1000 700' }));
        boardSvg.append(createSvg('rect', { width: 1000, height: 700, fill: '#0b2635' }));
        elements.map.append(boardSvg);
        elements.map.classList.add('is-fallback');
    }

    boardSvg.classList.add('risk-board-svg');
    boardSvg.removeAttribute('aria-labelledby');
    boardSvg.setAttribute('role', 'group');
    boardSvg.setAttribute('aria-label', 'Classic Risk world board, 42 territories. Each marker is a selectable territory.');

    const landPaths = new Map();

    boardSvg.querySelectorAll('[data-territory]').forEach((path) => {
        const id = path.getAttribute('data-territory');

        if (territoryIds.has(id) && !landPaths.has(id)) {
            landPaths.set(id, path);
        } else {
            path.removeAttribute('data-territory');
        }
    });

    const markerLayer = createSvg('g', { class: 'risk-marker-layer' });
    const markers = new Map();

    territoryCatalog.forEach((territory) => {
        const [x, y] = territory.marker;
        const group = createSvg('g', {
            class: 'risk-marker',
            transform: `translate(${x} ${y})`,
            tabindex: 0,
            role: 'button',
            'data-territory': territory.id
        });
        const ring = createSvg('circle', { class: 'risk-marker-ring', r: 20 });
        const shape = createSvg('path', { class: 'risk-marker-shape', d: markerShapes.none });
        const count = createSvg('text', { class: 'risk-marker-count', 'text-anchor': 'middle', y: 4.5 });
        const badge = createSvg('text', { class: 'risk-marker-badge', 'text-anchor': 'middle', y: -22 });
        const name = createSvg('text', { class: 'risk-marker-name', 'text-anchor': 'middle', y: 28 });

        name.textContent = territory.short;
        group.append(ring, shape, count, badge, name);
        group.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectTerritory(territory.id);
            }
        });
        markerLayer.append(group);
        markers.set(territory.id, { group, shape, count, badge });
    });

    boardSvg.append(markerLayer);
    boardSvg.addEventListener('click', (event) => {
        const hit = /** @type {Element} */ (event.target).closest('[data-territory]');

        if (hit) {
            selectTerritory(hit.getAttribute('data-territory'));
        }
    });

    /* ------------------------------------------------------------------
     * Rendering.
     * ------------------------------------------------------------------ */

    const computeHighlights = () => {
        const legal = new Set();
        const placeable = new Set();

        if (!state.active || state.current !== 'human' || state.busy) {
            return { legal, placeable };
        }

        const source = byId(state.sourceId);

        if (state.phase === 'setup' && state.setupStep) {
            const step = state.setupStep;

            state.territories.forEach((territory) => {
                if ((territory.owner === 'human' && step.own < step.ownNeeded)
                    || (territory.owner === 'neutral' && step.neutral < step.neutralNeeded)) {
                    placeable.add(territory.id);
                }
            });
        } else if (state.phase === 'reinforce' && state.reinforcementRemaining > 0 && state.hands.human.length < 5) {
            ownedBy('human').forEach((territory) => placeable.add(territory.id));
        } else if (state.phase === 'attack' && source) {
            legalAttackTargets('human', source).forEach((territory) => legal.add(territory.id));
        } else if (state.phase === 'fortify' && source && source.owner === 'human' && source.armies > 1 && !state.fortifiedThisTurn) {
            connectedOwned('human', source.id).forEach((id) => {
                if (id !== source.id) {
                    legal.add(id);
                }
            });
        }

        return { legal, placeable };
    };

    const territoryAriaLabel = (territory, role, isLegal, isPlaceable) => {
        const parts = [`${territory.name}, ${continentName(territory)}`];

        parts.push(territory.owner
            ? `${ownerLabel(territory.owner)}, ${pluralArmy(territory.armies)}`
            : 'not dealt yet');

        if (role === 'source') {
            parts.push('selected source');
        } else if (role === 'target') {
            parts.push('selected target');
        }

        if (isLegal) {
            parts.push('legal destination');
        }

        if (isPlaceable) {
            parts.push('can receive armies');
        }

        return parts.join('. ');
    };

    const renderMap = () => {
        const { legal, placeable } = computeHighlights();

        state.territories.forEach((territory) => {
            const marker = markers.get(territory.id);
            const path = landPaths.get(territory.id);
            const role = territory.id === state.sourceId
                ? 'source'
                : territory.id === state.targetId ? 'target' : '';
            const isLegal = legal.has(territory.id);
            const isPlaceable = placeable.has(territory.id);
            const classes = [
                `owner-${territory.owner || 'none'}`,
                role ? `is-${role}` : '',
                isLegal ? 'is-legal' : '',
                isPlaceable ? 'is-placeable' : '',
                territory.id === state.detailId ? 'is-detail' : ''
            ].filter(Boolean).join(' ');

            if (path) {
                path.setAttribute('class', `risk-land ${classes}`);

                if (role || isLegal) {
                    path.parentNode.appendChild(path);
                }
            }

            marker.group.setAttribute('class', `risk-marker ${classes}`);
            marker.group.setAttribute('aria-label', territoryAriaLabel(territory, role, isLegal, isPlaceable));
            marker.group.setAttribute('aria-pressed', role ? 'true' : 'false');
            marker.shape.setAttribute('d', markerShapes[territory.owner] || markerShapes.none);
            marker.count.textContent = territory.owner ? String(territory.armies) : '–';
            marker.badge.textContent = role === 'source' ? 'FROM' : role === 'target' ? 'TO' : '';
        });

        boardSvg.classList.toggle('is-waiting', state.active && (state.current !== 'human' || state.busy));
    };

    const renderSelectionFigure = (territory) => {
        const key = territory ? `${territory.id}:${territory.owner || 'none'}` : 'none';

        if (key === runtime.figureKey) {
            return;
        }

        runtime.figureKey = key;
        elements.selectionShape.replaceChildren();
        elements.selectionFigure.classList.toggle('has-territory', Boolean(territory));

        if (!territory) {
            elements.selectionCaption.textContent = 'Select a territory';
            return;
        }

        const continent = continentById.get(territory.continent);
        const ownerClass = `owner-${territory.owner || 'none'}`;
        const path = landPaths.get(territory.id);
        let drawn = false;

        if (path) {
            try {
                const box = /** @type {SVGGraphicsElement} */ (path).getBBox();

                if (box.width > 0 && box.height > 0) {
                    const pad = Math.max(box.width, box.height) * 0.12 + 3;
                    const clone = /** @type {Element} */ (path.cloneNode(false));

                    clone.removeAttribute('id');
                    clone.removeAttribute('data-territory');
                    clone.setAttribute('class', `risk-selection-land ${ownerClass}`);
                    clone.setAttribute('fill', continent?.color || '#8fb876');
                    elements.selectionShape.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
                    elements.selectionShape.append(clone);
                    drawn = true;
                }
            } catch {
                drawn = false;
            }
        }

        if (!drawn) {
            elements.selectionShape.setAttribute('viewBox', '-20 -20 40 40');
            elements.selectionShape.append(createSvg('path', {
                class: `risk-selection-land ${ownerClass}`,
                d: markerShapes[territory.owner] || markerShapes.none,
                fill: continent?.color || '#8fb876'
            }));
        }

        elements.selectionCaption.textContent = `${territory.name} · ${continent?.name || ''}`;
    };

    const selectionHelpText = (focus) => {
        if (!state.active) {
            return state.phase === 'gameover' ? 'Game over. Start a new game to play again.' : 'Start a new game to deal the world.';
        }

        if (state.current !== 'human') {
            return state.pendingDefense ? 'Choose your defense dice in the command panel.' : 'The Browser is playing its turn.';
        }

        if (state.phase === 'setup') {
            return 'Click your territories (circles) for your two armies and a neutral territory (square) for the neutral army.';
        }

        if (state.phase === 'reinforce') {
            return focus.owner === 'human' ? 'Click to add one army here, or use Place all here.' : 'Reinforcements go on your own territories.';
        }

        if (state.phase === 'attack') {
            return state.targetId ? 'Choose attack dice and press Roll attack.' : 'Pick an attacker with two or more armies, then a highlighted target.';
        }

        if (state.phase === 'conquer') {
            return 'Choose how many armies move into the conquered territory.';
        }

        if (state.phase === 'fortify') {
            return state.targetId ? 'Set the number of armies and press Fortify.' : 'Pick a source with spare armies, then a highlighted connected territory.';
        }

        return '';
    };

    const renderSelection = () => {
        const focus = byId(state.detailId) || byId(state.sourceId);
        renderSelectionFigure(focus);

        if (!focus) {
            elements.selection.textContent = state.active ? 'Select a territory on the map.' : 'No territory selected.';
            return;
        }

        const continent = continentById.get(focus.continent);
        const members = continentMembers.get(focus.continent);
        const humanOwned = members.filter((id) => byId(id)?.owner === 'human').length;
        const aiOwned = members.filter((id) => byId(id)?.owner === 'ai').length;
        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const wrapper = document.createElement('div');
        const list = document.createElement('dl');
        const help = document.createElement('p');

        list.className = 'risk-selection-list';

        const rows = [
            ['Territory', focus.name],
            ['Continent', `${continent.name} (+${continent.bonus} for all ${members.length})`],
            ['Control', focus.owner ? `Player ${humanOwned}/${members.length}, Browser ${aiOwned}/${members.length}` : 'Not dealt yet'],
            ['Owner', focus.owner ? `${ownerLabel(focus.owner)} (${ownerShapeLabels[focus.owner]})` : 'Unassigned'],
            ['Armies', focus.owner ? pluralArmy(focus.armies) : '–'],
            ['Card', cardTypeLabels[focus.card]],
            ['Neighbors', focus.neighbors.map((neighborId) => {
                const neighbor = byId(neighborId);
                return neighbor?.owner ? `${neighbor.name} (${ownerLabel(neighbor.owner)} ${neighbor.armies})` : neighbor?.name || neighborId;
            }).join(', ')]
        ];

        if (source) {
            rows.push(['From', `${source.name} (${pluralArmy(source.armies)})`]);
        }

        if (target) {
            rows.push(['To', `${target.name} (${ownerLabel(target.owner)}, ${pluralArmy(target.armies)})`]);
        }

        rows.forEach(([term, description]) => {
            const row = document.createElement('div');
            row.append(createText('dt', '', term), createText('dd', '', description));
            list.append(row);
        });

        help.className = 'risk-selection-help';
        help.textContent = selectionHelpText(focus);
        wrapper.append(list, help);
        elements.selection.replaceChildren(wrapper);
    };

    const createDie = (value, className) => {
        const die = document.createElement('span');

        die.className = `risk-die ${className}`.trim();
        die.setAttribute('data-value', value ? String(value) : '');
        die.setAttribute('aria-hidden', 'true');

        for (let index = 0; index < 9; index += 1) {
            die.append(document.createElement('i'));
        }

        return die;
    };

    const renderDice = () => {
        const battle = state.battle;
        const key = battle ? `${battle.id}:${battle.rolling ? 'rolling' : 'done'}` : 'none';

        if (key === runtime.diceKey) {
            return;
        }

        runtime.diceKey = key;
        elements.diceTray.classList.toggle('is-rolling', Boolean(battle?.rolling));

        if (!battle) {
            elements.attackDiceLabel.textContent = 'Attacker';
            elements.defendDiceLabel.textContent = 'Defender';
            elements.attackDiceRow.replaceChildren(...[1, 2, 3].map(() => createDie(0, 'risk-die-attack is-idle')));
            elements.defendDiceRow.replaceChildren(...[1, 2].map(() => createDie(0, 'risk-die-defend is-idle')));
            elements.diceComparisons.replaceChildren();
            elements.diceResult.textContent = 'No battle yet. Attack and defense dice appear here.';
            return;
        }

        const outcome = battle.outcome;
        elements.attackDiceLabel.textContent = `${ownerLabel(battle.attacker)} attacks from ${battle.sourceName} (${diceLabel(battle.attackDice)})`;
        elements.defendDiceLabel.textContent = `${ownerLabel(battle.defender)} defends ${battle.targetName} (${diceLabel(battle.defendDice)})`;

        if (battle.rolling) {
            const face = () => (reducedMotion() ? 0 : rollDie());
            elements.attackDiceRow.replaceChildren(...outcome.attack.map(() => createDie(face(), 'risk-die-attack is-rolling')));
            elements.defendDiceRow.replaceChildren(...outcome.defend.map(() => createDie(face(), 'risk-die-defend is-rolling')));
            elements.diceComparisons.replaceChildren();
            elements.diceResult.textContent = `Rolling ${diceLabel(battle.attackDice)} against ${diceLabel(battle.defendDice)}…`;
            return;
        }

        const dieState = (index, side) => {
            const pair = outcome.pairs[index];

            if (!pair) {
                return 'is-unused';
            }

            return pair.winner === side ? 'is-win' : 'is-loss';
        };

        elements.attackDiceRow.replaceChildren(...outcome.attack.map((value, index) => (
            createDie(value, `risk-die-attack ${dieState(index, 'attacker')}`)
        )));
        elements.defendDiceRow.replaceChildren(...outcome.defend.map((value, index) => (
            createDie(value, `risk-die-defend ${dieState(index, 'defender')}`)
        )));
        elements.diceComparisons.replaceChildren(...outcome.pairs.map((pair, index) => {
            const verdict = pair.winner === 'attacker'
                ? 'defender loses 1'
                : pair.attack === pair.defend ? 'tie goes to defender, attacker loses 1' : 'attacker loses 1';
            return createText('li', '', `Pair ${index + 1}: ${pair.attack} vs ${pair.defend} — ${verdict}`);
        }));

        const unused = outcome.attack.length - outcome.pairs.length;
        elements.diceResult.textContent = [
            `${ownerLabel(battle.attacker)} rolled ${outcome.attack.join(', ')}.`,
            `${ownerLabel(battle.defender)} rolled ${outcome.defend.join(', ')}.`,
            unused > 0 ? `${unused} lowest attack ${unused === 1 ? 'die is' : 'dice are'} not compared.` : '',
            `Attacker loses ${outcome.attackerLosses}, defender loses ${outcome.defenderLosses}.`,
            battle.conquered ? `${battle.targetName} conquered.` : ''
        ].filter(Boolean).join(' ');
    };

    const renderHand = () => {
        const hand = state.hands.human;
        const selectedCards = state.selectedCardIds
            .map((cardId) => hand.find((card) => card.id === cardId))
            .filter(Boolean);

        // The hand is rebuilt on every render, so keyboard focus is carried over by card id.
        const activeElement = document.activeElement;
        const focusedCardId = activeElement && elements.hand.contains(activeElement)
            ? activeElement.getAttribute('data-card-id')
            : null;
        let focusTarget = null;

        if (hand.length === 0) {
            elements.hand.replaceChildren(createText(
                'li',
                'risk-hand-empty',
                state.active ? 'No cards yet. Conquer a territory during your turn to earn one.' : 'Cards appear here during play.'
            ));
        } else {
            elements.hand.replaceChildren(...hand.map((card) => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                const territory = byId(card.territoryId);
                const selected = state.selectedCardIds.includes(card.id);

                button.type = 'button';
                button.className = `risk-card risk-card-${card.type}`;
                button.dataset.cardId = card.id;

                if (card.id === focusedCardId) {
                    focusTarget = button;
                }

                button.setAttribute('aria-pressed', selected ? 'true' : 'false');
                button.append(
                    createText('span', 'risk-card-type', cardTypeLabels[card.type]),
                    createText('span', 'risk-card-name', territory ? territory.name : 'Wild card')
                );

                if (territory && territory.owner === 'human') {
                    button.append(createText('span', 'risk-card-owned', 'You own it: +2'));
                }

                item.append(button);
                return item;
            }));
        }

        if (focusTarget) {
            focusTarget.focus();
        }

        const value = tradeValue(state.setsTraded);
        elements.tradeValue.textContent = `Next set: ${pluralArmy(value)} (${state.setsTraded} ${state.setsTraded === 1 ? 'set' : 'sets'} traded so far)`;

        if (hand.length >= 5 && state.current === 'human' && state.phase === 'reinforce') {
            elements.handHelp.textContent = 'Five or more cards: you must trade a set now.';
        } else if (selectedCards.length === 3) {
            elements.handHelp.textContent = isValidSet(selectedCards)
                ? 'Valid set selected.'
                : 'Not a valid set: use three of a kind, one of each, or include a wild.';
        } else {
            elements.handHelp.textContent = 'Select three cards to trade during reinforcement.';
        }
    };

    const renderControls = () => {
        const humanTurn = state.active && state.current === 'human' && !state.busy;
        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const handSize = state.hands.human.length;
        const selectedCards = state.selectedCardIds
            .map((cardId) => state.hands.human.find((card) => card.id === cardId))
            .filter(Boolean);

        elements.startButton.textContent = state.active ? 'Restart game' : 'New game';

        asButton(elements.autoSetupButton).disabled = !(state.active && state.phase === 'setup' && !state.autoSetupHuman);
        asButton(elements.reinforceButton).disabled = !(
            humanTurn
            && state.phase === 'reinforce'
            && state.reinforcementRemaining > 0
            && handSize < 5
            && source
            && source.owner === 'human'
        );

        const endLabels = {
            reinforce: 'Begin attacks',
            attack: 'End attacks',
            conquer: 'End attacks',
            fortify: 'End turn'
        };
        elements.endButton.textContent = state.current === 'human' && endLabels[state.phase] ? endLabels[state.phase] : 'End phase';
        asButton(elements.endButton).disabled = !(
            humanTurn
            && ((state.phase === 'reinforce' && state.reinforcementRemaining === 0 && handSize < 5)
                || state.phase === 'attack'
                || state.phase === 'fortify')
        );

        const maxDice = maxAttackDice(source && source.owner === 'human' ? source : null);
        const chosenDice = maxDice > 0 ? Math.min(state.attackDice, maxDice) : state.attackDice;
        const attackPhase = humanTurn && state.phase === 'attack';

        attackDiceInputs.forEach((input) => {
            const value = Number(input.value);
            input.disabled = !attackPhase || maxDice < value;
            input.checked = value === chosenDice;
        });
        asButton(elements.attackButton).disabled = !attackPhase
            || Boolean(attackError('human', source, target, effectiveAttackDice(source)));

        const fortifyInput = asInput(elements.fortifyCount);
        const fortifyReady = humanTurn
            && state.phase === 'fortify'
            && !fortifyError('human', source, target, 1);
        const fortifyMax = source && source.owner === 'human' ? Math.max(1, source.armies - 1) : 1;

        fortifyInput.max = String(fortifyMax);
        fortifyInput.disabled = !fortifyReady;

        if (!fortifyReady || !Number.isInteger(fortifyInput.valueAsNumber) || fortifyInput.valueAsNumber > fortifyMax || fortifyInput.valueAsNumber < 1) {
            fortifyInput.value = String(fortifyMax);
        }

        asButton(elements.fortifyButton).disabled = !fortifyReady;

        const pendingConquest = state.pendingConquest && state.pendingConquest.player === 'human' ? state.pendingConquest : null;
        const conquestInput = asInput(elements.conquestCount);
        const conquestKey = pendingConquest ? `${pendingConquest.targetId}:${pendingConquest.min}:${pendingConquest.max}` : '';

        elements.conquestPanel.hidden = !pendingConquest;

        if (pendingConquest && conquestInput.dataset.key !== conquestKey) {
            conquestInput.dataset.key = conquestKey;
            conquestInput.min = String(pendingConquest.min);
            conquestInput.max = String(pendingConquest.max);
            conquestInput.value = String(pendingConquest.max);
            elements.conquestHelp.textContent = `Move ${pendingConquest.min} to ${pendingConquest.max} armies from ${byId(pendingConquest.sourceId).name} into ${byId(pendingConquest.targetId).name}. At least as many as the dice you rolled.`;
        } else if (!pendingConquest) {
            conquestInput.dataset.key = '';
        }

        const pendingDefense = state.pendingDefense;
        elements.defensePanel.hidden = !pendingDefense;

        if (pendingDefense) {
            const attacker = byId(pendingDefense.sourceId);
            const defender = byId(pendingDefense.targetId);
            elements.defenseHelp.textContent = `${attacker.name} rolls ${diceLabel(pendingDefense.attackDice)} against your ${defender.name} (${pluralArmy(defender.armies)}). Ties go to you.`;
            asButton(elements.defendTwoButton).disabled = maxDefendDice(defender) < 2;
        }

        asInput(elements.autoDefend).checked = state.autoDefend;
        asButton(elements.tradeButton).disabled = !(
            humanTurn
            && state.phase === 'reinforce'
            && selectedCards.length === 3
            && isValidSet(selectedCards)
        );
    };

    const renderSummary = () => {
        elements.turn.textContent = String(state.turn);
        elements.phase.textContent = state.active
            ? `${ownerLabel(state.current)}: ${phaseLabels[state.phase] || 'Ready'}`
            : phaseLabels[state.phase] || 'Ready';
        elements.reinforcements.textContent = String(state.phase === 'setup'
            ? state.setupPool.human
            : state.current === 'human' ? state.reinforcementRemaining : 0);
        elements.humanCount.textContent = String(ownedBy('human').length);
        elements.aiCount.textContent = String(ownedBy('ai').length);
        elements.neutralCount.textContent = String(ownedBy('neutral').length);
        elements.humanCards.textContent = String(state.hands.human.length);
        elements.aiCards.textContent = String(state.hands.ai.length);
        elements.humanAvatarName.textContent = state.avatars.human?.name || 'Assigned when a game starts';
        elements.humanAvatarFace.textContent = state.avatars.human?.text || '—';
        elements.aiAvatarName.textContent = state.avatars.ai?.name || 'Assigned when a game starts';
        elements.aiAvatarFace.textContent = state.avatars.ai?.text || '—';
        elements.status.textContent = state.message;
    };

    const renderLog = () => {
        if (state.log.length === 0) {
            elements.log.replaceChildren(createText('li', '', 'No battles yet.'));
            return;
        }

        elements.log.replaceChildren(...state.log.map((entry) => createText('li', '', entry)));
    };

    const render = () => {
        renderSummary();
        renderControls();
        renderMap();
        renderSelection();
        renderHand();
        renderDice();
        renderLog();
    };

    /* ------------------------------------------------------------------
     * Wiring.
     * ------------------------------------------------------------------ */

    const artImage = /** @type {HTMLImageElement} */ (elements.selectionArt);
    const markArtMissing = () => elements.selectionFigure.classList.add('is-art-missing');

    artImage.addEventListener('error', markArtMissing);

    if (artImage.complete && artImage.naturalWidth === 0 && artImage.getAttribute('src')) {
        markArtMissing();
    }

    elements.startButton.addEventListener('click', startGame);
    elements.endButton.addEventListener('click', advancePhase);
    elements.reinforceButton.addEventListener('click', placeAllReinforcements);
    elements.autoSetupButton.addEventListener('click', enableAutoSetup);
    elements.attackButton.addEventListener('click', humanAttack);
    elements.conquestButton.addEventListener('click', confirmConquest);
    elements.fortifyButton.addEventListener('click', humanFortify);
    elements.tradeButton.addEventListener('click', humanTrade);
    elements.defendOneButton.addEventListener('click', () => chooseDefense(1));
    elements.defendTwoButton.addEventListener('click', () => chooseDefense(2));
    elements.autoDefend.addEventListener('change', () => {
        state.autoDefend = asInput(elements.autoDefend).checked;

        if (state.autoDefend && state.pendingDefense) {
            chooseDefense(maxDefendDice(byId(state.pendingDefense.targetId)));
            return;
        }

        render();
    });
    attackDiceInputs.forEach((input) => {
        input.addEventListener('change', () => {
            if (input.checked) {
                state.attackDice = Number(input.value);
                render();
            }
        });
    });
    elements.hand.addEventListener('click', (event) => {
        const button = /** @type {Element} */ (event.target).closest('[data-card-id]');

        if (button) {
            toggleCard(button.getAttribute('data-card-id'));
        }
    });
    elements.conquestCount.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmConquest();
        }
    });

    state.territories = territoryCatalog.map((territory) => ({
        ...territory,
        owner: null,
        armies: 0
    }));

    render();
})();

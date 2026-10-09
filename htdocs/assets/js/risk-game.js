import {
    territoryCatalog,
    continentDefinitions,
    cardTypes,
    buildDeck,
    isValidSet,
    findValidSets,
    tradeValue,
    compareRolls,
    normalizeConfig,
    createGame,
    distributeSetupArmies,
    startingArmies,
    PLAYER_IDS,
    NEUTRAL_ID,
    SETUP_ARMY_CAP
} from './risk-model.js';
import { chooseBotAction, chooseSetupPlacement } from './risk-bot.js';
import * as riskApi from './risk-api.js';

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
     * Board data and card rules come from the shared rules model.
     * ------------------------------------------------------------------ */

    const cardTypeLabels = {
        infantry: 'Infantry',
        cavalry: 'Cavalry',
        artillery: 'Artillery',
        wild: 'Wild'
    };

    // Card artwork is decorative and keyed by card type; a drawn emblem stands in while it loads or if it fails.
    const CARD_ART_ROOT = '/assets/img/risk-cards/';
    const cardArtType = (type) => (Object.prototype.hasOwnProperty.call(cardTypeLabels, type) ? type : 'wild');
    const cardArtUrl = (type) => `${CARD_ART_ROOT}${cardArtType(type)}.png`;
    const cardEmblems = {
        infantry: '♟',
        cavalry: '♞',
        artillery: '✸',
        wild: '★'
    };

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

    const FIXED_VALUE_TABLE = `Fixed values: 3 ${cardTypeLabels[cardTypes[0]]} 4, 3 ${cardTypeLabels[cardTypes[1]]} 6, 3 ${cardTypeLabels[cardTypes[2]]} 8, one of each 10; wilds count as the best.`;
    const AI_ATTACK_LIMIT = 80;
    const AI_TIME_BUDGET_MS = 250;

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
        scoreboardSeats: byElementId('risk-scoreboard-seats'),
        legendOwners: byElementId('risk-legend-owners'),
        selection: byElementId('risk-territory-card'),
        selectionFigure: byElementId('risk-selection-figure'),
        selectionArt: byElementId('risk-selection-art'),
        selectionShape: byElementId('risk-selection-shape'),
        selectionCaption: byElementId('risk-selection-caption'),
        log: byElementId('risk-log'),
        startButton: byElementId('risk-start-button'),
        endButton: byElementId('risk-end-button'),
        commandPanel: /** @type {HTMLElement} */ (root.querySelector('.risk-command-panel')),
        phaseStepper: byElementId('risk-phase-stepper'),
        turnGuidance: byElementId('risk-turn-guidance'),
        reinforceButton: byElementId('risk-reinforce-button'),
        autoSetupButton: byElementId('risk-auto-setup-button'),
        opponentCount: byElementId('risk-opponent-count'),
        placementGroup: byElementId('risk-placement-options'),
        cardModeGroup: byElementId('risk-card-mode-options'),
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
        diceResult: byElementId('risk-dice-result'),
        inviteButton: byElementId('risk-invite-button'),
        lobbyPanel: byElementId('risk-lobby-panel'),
        lobbyTitle: byElementId('risk-lobby-title'),
        lobbyStatus: byElementId('risk-lobby-status'),
        lobbyInvite: byElementId('risk-lobby-invite'),
        inviteUrl: byElementId('risk-invite-url'),
        inviteCopyButton: byElementId('risk-invite-copy-button'),
        lobbyRoster: byElementId('risk-lobby-roster'),
        lobbyNote: byElementId('risk-lobby-note'),
        lobbyStartButton: byElementId('risk-lobby-start-button'),
        lobbyLeaveButton: byElementId('risk-lobby-leave-button')
    };

    if (Object.values(elements).some((element) => !element)) {
        return;
    }

    // Optional: lets the host fetch the invite link again after a failed request.
    const inviteRetryButton = byElementId('risk-invite-retry-button');

    // Optional guidance and feedback regions: the game still runs if a page omits them.
    const objectiveElements = {
        title: byElementId('risk-objective-title'),
        text: byElementId('risk-objective-text'),
        blocker: byElementId('risk-objective-blocker')
    };

    // Optional layout and accessibility helpers; each is skipped when the page omits it.
    const uxElements = {
        announcer: byElementId('risk-announcer'),
        reserveOwner: byElementId('risk-reinforcements-owner'),
        setupPanel: byElementId('risk-setup-panel'),
        setupSummary: byElementId('risk-setup-summary'),
        setupNote: byElementId('risk-setup-note'),
        startNote: byElementId('risk-start-note'),
        mapHint: byElementId('risk-map-hint')
    };
    const feedbackBox = byElementId('risk-feedback');

    const asButton = (element) => /** @type {HTMLButtonElement} */ (element);
    const asInput = (element) => /** @type {HTMLInputElement} */ (element);
    const phaseSteps = /** @type {HTMLElement[]} */ (Array.from(elements.phaseStepper.querySelectorAll('[data-phase]')));
    const phasePanels = /** @type {HTMLElement[]} */ (Array.from(elements.commandPanel.querySelectorAll('[data-risk-phase-panel]')));
    const attackDiceInputs = Array.from(elements.attackDiceGroup.querySelectorAll('input[name="risk-attack-dice"]')).map(asInput);
    const placementInputs = Array.from(elements.placementGroup.querySelectorAll('input[name="risk-placement"]')).map(asInput);
    const cardModeInputs = Array.from(elements.cardModeGroup.querySelectorAll('input[name="risk-card-mode"]')).map(asInput);
    const opponentSelect = /** @type {HTMLSelectElement} */ (elements.opponentCount);
    const checkedValue = (inputs) => inputs.find((input) => input.checked)?.value;

    // Startup settings are read only when a new game starts; the radios keep their values across games.
    const readSetupConfig = () => normalizeConfig({
        botCount: opponentSelect.value,
        placement: checkedValue(placementInputs),
        cardMode: checkedValue(cardModeInputs)
    });

    // Every owner has a label, a text glyph and a marker shape, so ownership never depends on colour alone.
    // Seat labels come from state.seats; glyphs and shapes are fixed per seat number.
    const NEUTRAL_LABEL = 'Neutral';

    const ownerGlyphs = {
        1: '●',
        2: '◆',
        3: '▲',
        4: '★',
        5: '▼',
        6: '✚',
        neutral: '■'
    };

    const ownerShapeNames = {
        1: 'circle',
        2: 'diamond',
        3: 'triangle',
        4: 'star',
        5: 'inverted triangle',
        6: 'cross',
        neutral: 'square'
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
        1: 'M-13 0a13 13 0 1 0 26 0a13 13 0 1 0 -26 0Z',
        2: 'M0 -16L16 0L0 16L-16 0Z',
        3: 'M0 -18L17 12H-17Z',
        4: 'M0 -18L5.6 -7.7L17.1 -5.6L9 2.9L10.6 14.6L0 9.5L-10.6 14.6L-9 2.9L-17.1 -5.6L-5.6 -7.7Z',
        5: 'M0 18L17 -12H-17Z',
        6: 'M-6 -16H6V-6H16V6H6V16H-6V6H-16V-6H-6Z',
        neutral: 'M-12 -12H12V12H-12Z',
        none: 'M-11 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0Z'
    };

    /** @type {Record<string, string>} */
    const pieceArt = {
        1: '/assets/img/risk/pieces/seat-1.png',
        2: '/assets/img/risk/pieces/seat-2.png',
        3: '/assets/img/risk/pieces/seat-3.png',
        4: '/assets/img/risk/pieces/seat-4.png',
        5: '/assets/img/risk/pieces/seat-5.png',
        6: '/assets/img/risk/pieces/seat-6.png',
        neutral: '/assets/img/risk/pieces/neutral.png'
    };

    /* ------------------------------------------------------------------
     * State and runtime (timers are tokenised so restart cancels them).
     * ------------------------------------------------------------------ */

    // risk.css colours each seat number through an owner-<key> class; keys are listed in seat order.
    const seatStyleKeys = PLAYER_IDS;

    // Local roster in turn order: seat 1 is the human, seats 2..N+1 are bots.
    const localRoster = (opponents) => {
        const roster = [{ seat: 1, kind: 'human', name: 'Player' }];

        for (let index = 1; index <= opponents; index += 1) {
            roster.push({ seat: index + 1, kind: 'bot', name: `Bot ${index}` });
        }

        return roster;
    };

    // A roster seats 2 to 6 distinct seat numbers, each a human or a bot.
    const isValidRoster = (roster) => Array.isArray(roster)
        && roster.length >= 2
        && roster.length <= PLAYER_IDS.length
        && roster.every((entry) => (
            Boolean(entry)
            && Number.isInteger(entry.seat)
            && entry.seat >= 1
            && entry.seat <= PLAYER_IDS.length
            && (entry.kind === 'human' || entry.kind === 'bot')
        ))
        && new Set(roster.map((entry) => entry.seat)).size === roster.length;

    // Seats in turn order plus the per-seat containers keyed by seat number: a hand, an avatar
    // slot and a setup pool for every seat.
    const createSeatState = (roster) => {
        /** @type {{[seat: string]: any[]}} */
        const hands = {};
        /** @type {{[seat: string]: {name: string, text: string}|null}} */
        const avatars = {};
        /** @type {{[owner: string]: number}} */
        const setupPool = {};
        /** @type {{seat: number, kind: string, name: string, eliminated: boolean}[]} */
        const seats = roster.map((entry) => ({
            seat: entry.seat,
            kind: entry.kind === 'human' ? 'human' : 'bot',
            name: String(entry.name || `Seat ${entry.seat}`),
            eliminated: false
        }));

        seats.forEach(({ seat }) => {
            hands[seat] = [];
            avatars[seat] = null;
            setupPool[seat] = 0;
        });

        return {
            seats,
            hands,
            avatars,
            setupPool
        };
    };

    // The whole game state is plain data (JSON-serializable); timers, DOM nodes and callbacks live in runtime.
    const createState = (config = readSetupConfig(), roster = localRoster(config.botCount)) => ({
        config,
        ...createSeatState(roster),
        active: false,
        phase: 'idle',
        current_seat: roster[0].seat,
        firstPlayer: roster[0].seat,
        turn: 0,
        territories: [],
        setupStep: null,
        autoSetupHuman: false,
        reinforcementRemaining: 0,
        deck: [],
        discard: [],
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
        log: []
    });

    let state = createState();

    const runtime = {
        token: 0,
        timers: /** @type {Set<number>} */ (new Set()),
        // Seat controlled by this browser (1 in local games).
        localSeat: 1,
        // Continuation of a battle that is waiting for the local defense choice.
        /** @type {(() => void)|null|undefined} */
        defenseDone: null,
        rollInterval: 0,
        battleCounter: 0,
        diceKey: '',
        figureKey: '',
        legendKey: '',
        // Transient, event-driven feedback. Every entry is cleared by cancelPending.
        /** @type {Map<string, {kind: string, serial: number}>} */
        fx: new Map(),
        fxSerial: 0,
        feedbackSerial: 0,
        /** @type {Map<Element, {className: string, serial: number}>} */
        pulses: new Map(),
        pulseSerial: 0,
        /** @type {Set<string>} */
        freshCardIds: new Set(),
        // Card buttons persist across renders so focus and running effects survive unrelated rerenders.
        /** @type {Map<string, {item: HTMLElement, button: HTMLButtonElement, owned: HTMLElement}>} */
        cardNodes: new Map(),
        /** @type {Set<string>} */
        missingArt: new Set(),
        // Accessible announcements and decision focus survive restarts so nothing is repeated.
        /** @type {string|null} */
        announcedPhase: null,
        announcedMessage: '',
        decision: '',
        /** @type {{key: string, text: string}|null} */
        guidanceOverride: null,
        /** @type {string|null} */
        phaseAdvanceConfirmation: null,
        /** @type {HTMLElement|null} */
        decisionReturn: null
    };

    /* ------------------------------------------------------------------
     * Online play: the server holds one shared state. Only the authorized
     * writer mutates and posts it; every other browser re-renders from polls.
     * ------------------------------------------------------------------ */

    const ONLINE_GAME_KEY = 'wowie.risk.game';
    // Prefix for the host's stored invite link, one entry per waiting game id.
    const INVITE_URL_KEY_PREFIX = 'wowie.risk.invite.';
    const POLL_MS = 2500;
    const BOT_TAKEOVER_MS = 20000;
    // Per-browser view and input state; it is stripped from every posted snapshot.
    const TRANSIENT_STATE_KEYS = ['selectedCardIds', 'sourceId', 'targetId', 'detailId', 'busy', 'attackDice', 'autoDefend', 'pendingDefense', 'message'];

    const online = {
        /** @type {string|null} */
        gameId: null,
        // Last Game JSON from the API, without its state payload.
        /** @type {any} */
        game: null,
        isHost: false,
        // True once this browser holds the shared game state (dealt here or received from the server).
        playing: false,
        // state_version of the state this browser holds.
        version: 0,
        // Bumped on leave so late responses from an earlier game are ignored.
        session: 0,
        pollTimer: 0,
        polling: false,
        requesting: false,
        posting: false,
        /** @type {{state: any, finished: boolean, winner: any}|null} */
        queued: null,
        lastKey: '',
        lastAdvanceAt: 0,
        botDriver: false,
        resyncing: false,
        needsResync: false,
        deals: 0,
        // Auto-place for this browser's own seat; never posted.
        autoSetup: false,
        // The lobby's invite link (absolute); also kept in localStorage per game so reloads reuse it.
        inviteUrl: '',
        // True while the host's invite-link request is in flight; inviteFailed shows the retry button.
        inviteRequesting: false,
        inviteFailed: false,
        notice: '',
        noticeKind: '',
        lobbyKey: ''
    };

    const isOnline = () => online.playing;

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

    // Drops every transient effect so a restart or game over never shows stale feedback.
    const clearEffects = () => {
        runtime.fx.clear();
        runtime.pulses.forEach((pulse, element) => element.classList.remove(pulse.className));
        runtime.pulses.clear();
        runtime.freshCardIds.clear();
        runtime.cardNodes.clear();
        runtime.feedbackSerial += 1;

        if (feedbackBox) {
            feedbackBox.className = 'risk-feedback';
            feedbackBox.textContent = '';
        }
    };

    const cancelPending = () => {
        runtime.token += 1;
        runtime.timers.forEach((timerId) => window.clearTimeout(timerId));
        runtime.timers.clear();
        runtime.defenseDone = null;
        runtime.guidanceOverride = null;
        runtime.phaseAdvanceConfirmation = null;
        stopRollingFaces();
        clearEffects();
    };

    const reducedMotion = () => (
        typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    const pace = (milliseconds) => (reducedMotion() ? Math.min(milliseconds, 160) : milliseconds);

    /* ------------------------------------------------------------------
     * Event feedback. Effects are started only by game events, expire on
     * tokenised timers, and fall back to static styling under reduced motion.
     * ------------------------------------------------------------------ */

    const fxDurations = {
        place: 900,
        loss: 1000,
        conquer: 1400
    };

    // Restarts a CSS animation on an element that may already carry the class.
    const restartClass = (element, className) => {
        element.classList.remove(className);
        void element.getBoundingClientRect();
        element.classList.add(className);
    };

    const pulseElement = (element, className, duration) => {
        if (!element) {
            return;
        }

        const previous = runtime.pulses.get(element);

        if (previous && previous.className !== className) {
            element.classList.remove(previous.className);
        }

        runtime.pulseSerial += 1;
        const serial = runtime.pulseSerial;

        runtime.pulses.set(element, { className, serial });
        restartClass(element, className);
        schedule(() => {
            if (runtime.pulses.get(element)?.serial === serial) {
                runtime.pulses.delete(element);
                element.classList.remove(className);
            }
        }, duration);
    };

    // Marks a territory marker for a brief effect; renderMap applies the class.
    const flashTerritory = (territoryId, kind) => {
        if (!territoryId) {
            return;
        }

        const previous = runtime.fx.get(territoryId);
        const marker = markers.get(territoryId);

        if (previous && marker) {
            marker.group.classList.remove(`is-fx-${previous.kind}`);
            void marker.group.getBoundingClientRect();
        }

        runtime.fxSerial += 1;
        const serial = runtime.fxSerial;

        runtime.fx.set(territoryId, { kind, serial });
        schedule(() => {
            if (runtime.fx.get(territoryId)?.serial === serial) {
                runtime.fx.delete(territoryId);
                renderMap();
            }
        }, fxDurations[kind] || 900);
    };

    const showFeedback = (kind, text) => {
        if (!feedbackBox) {
            return;
        }

        runtime.feedbackSerial += 1;
        const serial = runtime.feedbackSerial;

        feedbackBox.textContent = text;
        feedbackBox.className = 'risk-feedback';
        restartClass(feedbackBox, `is-${kind}`);
        schedule(() => {
            if (runtime.feedbackSerial === serial) {
                feedbackBox.className = 'risk-feedback';
                feedbackBox.textContent = '';
            }
        }, kind === 'draw' ? 3600 : 2800);
    };

    /* ------------------------------------------------------------------
     * Small helpers.
     * ------------------------------------------------------------------ */

    const byId = (id) => (id ? state.territories.find((territory) => territory.id === id) || null : null);
    const seatEntry = (seat) => state.seats.find((entry) => entry.seat === seat) || null;
    const seatNumbers = () => state.seats.map((entry) => entry.seat);
    const isBot = (seat) => seatEntry(seat)?.kind === 'bot';
    const isEliminated = (seat) => Boolean(seatEntry(seat)?.eliminated);
    const activeSeats = () => seatNumbers().filter((seat) => !isEliminated(seat));
    // Human input is live only on the local seat's own turn, and only when a human sits there.
    const isLocalTurn = () => state.current_seat === runtime.localSeat && seatEntry(runtime.localSeat)?.kind === 'human';
    // Online, the host drives the bot seats; another human takes over only after a stall.
    const isBotDriver = () => !isOnline() || online.isHost || online.botDriver;
    // Whether this browser may act for a seat: always in local games, online only as its writer.
    const canDriveSeat = (seat) => !isOnline() || (isBot(seat) ? isBotDriver() : seat === runtime.localSeat);
    // Auto-place covers the local human's setup; online it only ever covers this browser's own seat.
    const autoSetupActive = () => (isOnline() ? online.autoSetup : state.autoSetupHuman);
    const autoSetupFor = (seat) => (isOnline() ? seat === runtime.localSeat && online.autoSetup : state.autoSetupHuman);
    // Turn order is cyclic and skips eliminated seats.
    const seatAfter = (seat) => {
        const order = seatNumbers();
        const start = order.indexOf(seat);

        for (let step = 1; step <= order.length; step += 1) {
            const candidate = order[(start + step) % order.length];

            if (!isEliminated(candidate)) {
                return candidate;
            }
        }

        return seat;
    };
    // risk-model.js and risk-bot.js name seats by PLAYER_IDS in turn order; the page uses seat numbers.
    const modelIdOf = (owner) => {
        const index = state.seats.findIndex((entry) => entry.seat === owner);

        return index >= 0 ? PLAYER_IDS[index] : owner;
    };
    const modelTerritories = () => state.territories.map((territory) => ({ ...territory, owner: modelIdOf(territory.owner) }));
    // Class suffix for an owner: risk.css styles each seat number as owner-<key>.
    const ownerKey = (owner) => {
        if (owner === NEUTRAL_ID) {
            return NEUTRAL_ID;
        }

        return seatStyleKeys[owner - 1] || 'none';
    };
    // The neutral army only exists in the two-seat game (one bot).
    const hasNeutral = () => seatNumbers().length === 2;
    const boardOwners = () => (hasNeutral() ? [...seatNumbers(), NEUTRAL_ID] : seatNumbers().slice());
    const joinList = (items) => (items.length > 1
        ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
        : items.join(''));
    const ownedBy = (owner) => state.territories.filter((territory) => territory.owner === owner);
    const isNeighbor = (territory, neighborId) => Boolean(territory && territory.neighbors.includes(neighborId));
    const ownerLabel = (owner) => (owner === NEUTRAL_ID ? NEUTRAL_LABEL : seatEntry(owner)?.name || 'Unassigned');
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

    // Distinct avatars when the catalog covers every seat. A smaller catalog is reused in
    // rotation, and an empty one leaves every seat without an avatar.
    const chooseAvatars = (players) => {
        const pool = shuffle(avatarCatalog);
        /** @type {{[seat: string]: {name: string, text: string}|null}} */
        const avatars = {};

        players.forEach((seat, index) => {
            avatars[seat] = pool.length > 0 ? pool[index % pool.length] : null;
        });

        return avatars;
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
        .filter((neighbor) => neighbor.owner !== NEUTRAL_ID)
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
        if (!state.active || state.current_seat !== player || state.phase !== 'reinforce') {
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

    const tradeCards = (player, cardIds, bonusTerritoryId) => {
        const hand = state.hands[player];
        const cards = cardIds.map((cardId) => hand.find((card) => card.id === cardId) || null);
        const error = tradeError(player, cards);

        if (error) {
            return error;
        }

        let chosenBonus = null;

        if (!state.pictureBonusUsed) {
            const pictured = cards
                .map((card) => byId(card.territoryId))
                .filter((territory) => territory && territory.owner === player);

            if (bonusTerritoryId !== undefined && bonusTerritoryId !== null) {
                chosenBonus = pictured.find((territory) => territory.id === bonusTerritoryId) || null;

                if (!chosenBonus) {
                    return 'The bonus armies can only go on a territory you own that is pictured on a traded card.';
                }
            } else {
                chosenBonus = bestBy(pictured, (territory) => placementScore(player, territory));
            }
        }

        const value = tradeValue(state.setsTraded, state.config.cardMode, cards);
        state.setsTraded += 1;
        state.hands[player] = hand.filter((card) => !cards.includes(card));
        state.discard.push(...cards);
        state.reinforcementRemaining += value;

        let bonusText = '';

        if (chosenBonus) {
            chosenBonus.armies += 2;
            state.pictureBonusUsed = true;
            bonusText = ` +2 armies placed on pictured ${chosenBonus.name}.`;
        }

        const description = player === runtime.localSeat
            ? cards.map(describeCard).join(', ')
            : 'a set';
        addLog(`${ownerLabel(player)} trades ${description} for ${pluralArmy(value)}.${bonusText}`);
        return '';
    };

    const placeReinforcement = (player, territory, count) => {
        if (!state.active || state.current_seat !== player || state.phase !== 'reinforce') {
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


    const legalAttackTargets = (player, source) => (
        source && source.owner === player && source.armies > 1
            ? hostileNeighbors(player, source)
            : []
    );

    const hasLegalAttack = (player) => ownedBy(player).some((territory) => legalAttackTargets(player, territory).length > 0);

    const attackError = (player, source, target, dice) => {
        if (!state.active || state.current_seat !== player) {
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

    const canFortifyFrom = (player, territory) => (
        territory.owner === player
        && territory.armies > 1
        && connectedOwned(player, territory.id).size > 1
    );

    const hasLegalFortify = (player) => (
        !state.fortifiedThisTurn
        && ownedBy(player).some((territory) => canFortifyFrom(player, territory))
    );

    const fortifyError = (player, source, target, count) => {
        if (!state.active || state.current_seat !== player || state.phase !== 'fortify') {
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
     * Setup: random deal, then seats take turns placing 2 own armies per
     * step, plus 1 neutral army while the neutral exists (one-bot game).
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

        return `Setup: place ${parts.join(' and ')}. ${state.setupPool[runtime.localSeat]} of your setup armies remain.`;
    };

    const placeSetupArmy = (player, territory) => {
        if (!state.active || state.phase !== 'setup' || state.current_seat !== player || !state.setupStep) {
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

        if (territory.owner === NEUTRAL_ID) {
            if (step.neutral >= step.neutralNeeded) {
                return 'The neutral army for this step is placed. Now place your own armies.';
            }

            territory.armies += 1;
            state.setupPool[NEUTRAL_ID] -= 1;
            step.neutral += 1;
            return '';
        }

        return hasNeutral()
            ? 'During setup, place armies on your own territories or on neutral territories.'
            : 'During setup, place armies on your own territories.';
    };

    const setupStepComplete = () => Boolean(state.setupStep)
        && state.setupStep.own >= state.setupStep.ownNeeded
        && state.setupStep.neutral >= state.setupStep.neutralNeeded;

    const beginSetupStep = (player) => {
        state.current_seat = player;
        state.setupStep = {
            own: 0,
            neutral: 0,
            ownNeeded: Math.max(0, Math.min(2, state.setupPool[player] || 0)),
            neutralNeeded: Math.max(0, Math.min(1, state.setupPool[NEUTRAL_ID] || 0))
        };
        state.sourceId = null;
        state.targetId = null;

        if (isBot(player) || autoSetupFor(player)) {
            const step = state.setupStep;
            const botParts = [`${step.ownNeeded === 1 ? 'one' : 'two'} of its armies`];

            if (step.neutralNeeded > 0) {
                botParts.push('one neutral army');
            }

            state.message = isBot(player)
                ? `${ownerLabel(player)} is placing ${botParts.join(' and ')}.`
                : 'Auto-placing your setup armies.';
            render();
            // A fuller table steps faster so the rotation back to the player stays short.
            schedule(
                () => autoSetupStep(player),
                pace(isBot(player) ? Math.max(120, Math.round(380 / (seatNumbers().length - 1))) : 140)
            );
            return;
        }

        state.message = player === runtime.localSeat
            ? setupPrompt()
            : `${ownerLabel(player)} is placing setup armies.`;
        render();
    };

    const startPlay = () => {
        state.setupStep = null;
        state.deck = buildDeck();
        state.discard = [];
        state.hands = createSeatState(state.seats).hands;
        state.setsTraded = 0;
        addLog(`Setup complete: every color has ${startingArmies(seatNumbers().length)} armies. ${ownerLabel(state.firstPlayer)} moves first.`);
        beginTurn(state.firstPlayer);
    };

    // Rotates to the next seat in turn order that still has setup armies; play starts once
    // every seat's pool is empty.
    const finishSetupStep = (player) => {
        const order = seatNumbers();
        const start = order.indexOf(player);
        let next = null;

        for (let offset = 1; offset <= order.length && !next; offset += 1) {
            const candidate = order[(start + offset) % order.length];

            if (state.setupPool[candidate] > 0) {
                next = candidate;
            }
        }

        if (!next) {
            startPlay();
            return;
        }

        beginSetupStep(next);
    };

    // Uniformly random territory of owner under the setup cap; if none is under it, the one with the fewest armies.
    const pickCappedRandom = (owner) => {
        const owned = ownedBy(owner);

        if (owned.length === 0) {
            return null;
        }

        const open = owned.filter((territory) => territory.armies < SETUP_ARMY_CAP);

        if (open.length > 0) {
            return open[Math.floor(Math.random() * open.length)];
        }

        return owned.reduce((fewest, territory) => (territory.armies < fewest.armies ? territory : fewest));
    };

    const autoSetupStep = (player) => {
        if (!state.active || state.phase !== 'setup' || state.current_seat !== player || !canDriveSeat(player)) {
            return;
        }

        const step = state.setupStep;
        const pickOwn = !isBot(player)
            ? () => pickCappedRandom(player)
            : () => byId(chooseSetupPlacement(modelTerritories(), modelIdOf(player), 'own', state.config));
        const pickNeutral = !isBot(player)
            ? () => pickCappedRandom(NEUTRAL_ID)
            : () => byId(chooseSetupPlacement(modelTerritories(), modelIdOf(player), 'neutral', state.config));

        while (step.own < step.ownNeeded) {
            if (placeSetupArmy(player, pickOwn())) {
                break;
            }
        }

        while (step.neutral < step.neutralNeeded) {
            if (placeSetupArmy(player, pickNeutral())) {
                break;
            }
        }

        finishSetupStep(player);
    };

    const describeDeal = () => {
        const owners = boardOwners();
        const counts = owners.map((owner) => ownedBy(owner).length);

        return counts.every((count) => count === counts[0])
            ? `${counts[0]} territories each dealt to ${joinList(owners.map(ownerLabel))}`
            : `all ${state.territories.length} territories dealt to ${joinList(owners.map((owner, index) => `${ownerLabel(owner)} (${counts[index]})`))}`;
    };

    // roster: [{seat: 1..6, kind: 'human'|'bot', name}] in turn order. Local games pass seat 1 as
    // the human and seats 2..N+1 as bots.
    const startGame = (roster) => {
        cancelPending();

        const preferences = {
            attackDice: state.attackDice,
            autoDefend: state.autoDefend
        };
        const seated = isValidRoster(roster) ? roster : localRoster(readSetupConfig().botCount);
        const config = normalizeConfig({ ...readSetupConfig(), botCount: seated.length - 1 });

        // The model owns the deal: one army per territory, setup pools and the first seat. It names
        // seats by its own ids in turn order, which are mapped onto the roster's seat numbers here.
        const game = createGame(config);
        const seatOf = (id) => (id === NEUTRAL_ID ? NEUTRAL_ID : seated[PLAYER_IDS.indexOf(id)].seat);

        state = createState(config, seated);
        Object.assign(state, preferences);
        state.avatars = chooseAvatars(seatNumbers());
        state.active = true;
        state.phase = 'setup';
        state.territories = game.territories.map((territory) => ({ ...territory, owner: seatOf(territory.owner) }));
        state.setupPool = {};
        Object.keys(game.setupPool).forEach((id) => {
            state.setupPool[seatOf(id)] = game.setupPool[id];
        });
        state.firstPlayer = seatOf(game.firstPlayer);
        state.current_seat = state.firstPlayer;

        // Setup folds away during play so the turn controls sit right under the objective.
        if (uxElements.setupPanel instanceof HTMLDetailsElement) {
            uxElements.setupPanel.open = false;
        }

        if (config.placement === 'random') {
            boardOwners().forEach((owner) => {
                state.setupPool[owner] -= distributeSetupArmies(state.territories, /** @type {any} */ (owner), state.setupPool[owner]);
            });
            addLog(`New game: ${describeDeal()}, and every remaining army placed at random (at most ${SETUP_ARMY_CAP} per territory).`);
            startPlay();
            return;
        }

        addLog(`New game: ${describeDeal()}. ${ownerLabel(state.firstPlayer)} places first.`);
        beginSetupStep(state.firstPlayer);
    };

    /* ------------------------------------------------------------------
     * Turn flow.
     * ------------------------------------------------------------------ */

    const humanReinforcePrompt = () => {
        const handSize = state.hands[runtime.localSeat].length;

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

        if (player === runtime.localSeat) {
            state.sourceId = null;
            state.message = hasLegalAttack(runtime.localSeat)
                ? 'Attack phase: select one of your territories with two or more armies, then a highlighted target.'
                : 'Attack phase: you have no legal attacks. Press End attacks to fortify.';
        }
    };

    const beginTurn = (player) => {
        state.current_seat = player;
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

        if (isBot(player)) {
            state.message = `${ownerLabel(player)} is reinforcing.`;
            render();
            schedule(() => aiStep(player), pace(650));
            return;
        }

        state.message = player === runtime.localSeat
            ? `Your turn. ${humanReinforcePrompt()}`
            : `${ownerLabel(player)} is reinforcing.`;
        render();
    };

    const endTurn = (player) => {
        if (!state.active || state.phase === 'gameover' || state.current_seat !== player) {
            return;
        }

        if (state.conqueredThisTurn) {
            const card = drawCard(player);

            if (!card) {
                addLog('No cards remain to draw.');
            } else if (player === runtime.localSeat) {
                // The shared online log never names a drawn card; only its owner sees it in their hand.
                addLog(isOnline()
                    ? `${ownerLabel(player)} earns a card for conquering this turn.`
                    : `Player earns a card for conquering this turn: ${describeCard(card)}.`);
                // The new card deals into the hand once; the flag expires on a cancellable timer.
                runtime.freshCardIds.add(card.id);
                schedule(() => {
                    runtime.freshCardIds.delete(card.id);
                    runtime.cardNodes.get(card.id)?.button.classList.remove('is-dealt');
                }, 1400);
                showFeedback('draw', `New card: ${describeCard(card)}. It waits in your hand for a set.`);
            } else {
                addLog(`${ownerLabel(player)} earns a card for conquering this turn.`);
            }
        }

        beginTurn(seatAfter(player));
    };

    // An eliminated seat leaves the rotation and its cards go to the seat that conquered it.
    // A resulting hand of five or more is traded at the start of the conqueror's next turn.
    const eliminateSeat = (seat, conqueror) => {
        const captured = state.hands[seat] || [];

        const entry = seatEntry(seat);

        if (entry) {
            entry.eliminated = true;
        }

        state.hands[conqueror].push(...captured);
        state.hands[seat] = [];

        const cardNote = captured.length > 0
            ? `${ownerLabel(conqueror)} captures its ${captured.length} ${captured.length === 1 ? 'card' : 'cards'}.`
            : 'It held no cards to capture.';
        const note = `${ownerLabel(seat)} is eliminated. ${cardNote}`;

        addLog(note);
        return note;
    };

    // Ends the game: clears pending decisions and timers. `winner` is null when no single seat has won.
    const finishGame = (winner, message) => {
        cancelPending();
        state.phase = 'gameover';
        state.active = false;
        state.winner = winner;
        state.busy = false;
        state.pendingConquest = null;
        state.pendingDefense = null;
        state.reinforcementRemaining = 0;
        state.targetId = null;
        state.message = message;
        addLog(message);

        if (uxElements.setupPanel instanceof HTMLDetailsElement) {
            uxElements.setupPanel.open = true;
        }

        render();
    };

    // The player is out. Only a genuine last active seat is recorded as the winner.
    const declareDefeat = (conqueror) => {
        const survivors = activeSeats();
        const winner = survivors.length === 1 ? survivors[0] : null;
        const outcome = winner
            ? ` ${winner === conqueror ? 'It is' : `${ownerLabel(winner)} is`} the last seat standing.`
            : ` ${survivors.length} bots are still in play, so no overall winner is declared.`;

        finishGame(winner, `Defeat. ${ownerLabel(conqueror)} eliminated your last army.${outcome} Press New game for a rematch.`);
    };

    const declareVictory = (winner) => {
        // Online the message is shared by every seat, so it names the winner instead of addressing one viewer.
        if (isOnline()) {
            finishGame(winner, `${ownerLabel(winner)} wins: the last seat standing.`);
            return;
        }

        const neutralLeft = ownedBy(NEUTRAL_ID).length;
        const neutralNote = neutralLeft > 0
            ? ` ${neutralLeft} neutral ${neutralLeft === 1 ? 'territory remains' : 'territories remain'}, which this variant does not require you to conquer.`
            : '';
        const rivals = seatNumbers().filter((seat) => seat !== runtime.localSeat);

        finishGame(winner, winner === runtime.localSeat
            ? `Victory! ${rivals.length === 1 ? `You eliminated ${ownerLabel(rivals[0])}.` : `You are the last seat standing: all ${rivals.length} bots are eliminated.`}${neutralNote}`
            : `Defeat. ${ownerLabel(winner)} is the last seat standing. Press New game for a rematch.`);
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

        if (outcome.attackerLosses > 0) {
            flashTerritory(source.id, 'loss');
        }

        if (outcome.defenderLosses > 0 && target.armies > 0) {
            flashTerritory(target.id, 'loss');
        }

        const humanAttacking = battle.attacker === runtime.localSeat;
        const humanInvolved = humanAttacking || battle.defender === runtime.localSeat;

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

            if (battle.defender !== NEUTRAL_ID && ownedBy(battle.defender).length === 0) {
                summary += ` ${eliminateSeat(battle.defender, battle.attacker)}`;
            }

            // Defeat as soon as the player is eliminated; a winner only once a single seat remains.
            // Online, an eliminated seat drops out while the others play on to a single winner.
            if (!isOnline() && isEliminated(runtime.localSeat)) {
                declareDefeat(battle.attacker);
                return;
            }

            if (activeSeats().length === 1) {
                declareVictory(activeSeats()[0]);
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
            state.message = battle.attacker === runtime.localSeat
                ? `${summary} Move between ${state.pendingConquest.min} and ${state.pendingConquest.max} armies in.`
                : summary;
            flashTerritory(target.id, 'conquer');

            if (humanAttacking) {
                showFeedback('conquer', `${target.name} conquered! You will draw a card when your turn ends.`);
            } else if (battle.defender === runtime.localSeat) {
                showFeedback('loss', `${ownerLabel(battle.attacker)} captured your ${target.name}.`);
            }
        } else {
            addLog(summary);
            state.message = summary;

            if (humanInvolved) {
                const yourLosses = humanAttacking ? outcome.attackerLosses : outcome.defenderLosses;
                const theirLosses = humanAttacking ? outcome.defenderLosses : outcome.attackerLosses;
                const rival = humanAttacking ? battle.defender : battle.attacker;

                showFeedback(
                    yourLosses > theirLosses ? 'loss' : 'hit',
                    `Battle at ${target.name}: you lose ${yourLosses}, ${ownerLabel(rival)} loses ${theirLosses}.`
                );
            }
        }

        render();

        if (typeof onComplete === 'function') {
            onComplete();
        }
    };

    const isSpectatorBattle = (battle) => Boolean(battle)
        && seatNumbers().length > 2
        && battle.attacker !== runtime.localSeat
        && battle.defender !== runtime.localSeat;

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
        // With several bots, battles that do not involve the player resolve faster.
        schedule(() => commitBattle(onComplete), reducedMotion() ? 120 : isSpectatorBattle(state.battle) ? 600 : 1100);
    };

    const launchBattle = (player, source, target, attackDice, onComplete) => {
        const error = attackError(player, source, target, attackDice);

        if (error) {
            return error;
        }

        const defendMax = maxDefendDice(target);

        // Only a human at this browser is asked for defense dice; every other defender rolls the maximum.
        // Online games always defend automatically with the maximum dice.
        if (!isOnline() && target.owner === runtime.localSeat && !isBot(target.owner) && defendMax > 1 && !state.autoDefend) {
            state.pendingDefense = {
                player,
                sourceId: source.id,
                targetId: target.id,
                attackDice
            };
            runtime.defenseDone = onComplete;
            state.sourceId = source.id;
            state.targetId = target.id;
            state.message = `${ownerLabel(player)} attacks your ${target.name} from ${source.name} with ${diceLabel(attackDice)}. Choose your defense dice.`;
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

        const onComplete = runtime.defenseDone;

        state.pendingDefense = null;
        runtime.defenseDone = null;
        rollBattle(pending.player, source, target, pending.attackDice, dice, onComplete);
    };

    /* ------------------------------------------------------------------
     * Bot seats: bounded game-tree decisions applied through UI rules.
     * Every bot seat runs the same driver with its own seat id.
     * ------------------------------------------------------------------ */

    // The bot reads a detached copy of the game in the model's own seat ids.
    const botSnapshot = () => {
        /** @type {{[seat: string]: any[]}} */
        const hands = {};

        state.seats.forEach((entry) => {
            hands[modelIdOf(entry.seat)] = state.hands[entry.seat] || [];
        });

        return JSON.parse(JSON.stringify({
            config: state.config,
            players: state.seats.map((entry) => modelIdOf(entry.seat)),
            eliminated: state.seats.filter((entry) => entry.eliminated).map((entry) => modelIdOf(entry.seat)),
            current: modelIdOf(state.current_seat),
            phase: state.phase,
            territories: modelTerritories(),
            hands,
            deck: state.deck,
            discard: state.discard,
            setsTraded: state.setsTraded,
            reinforcementRemaining: state.reinforcementRemaining,
            pictureBonusUsed: state.pictureBonusUsed,
            conqueredThisTurn: state.conqueredThisTurn,
            fortifiedThisTurn: state.fortifiedThisTurn,
            pendingConquest: state.pendingConquest ? {
                sourceId: state.pendingConquest.sourceId,
                targetId: state.pendingConquest.targetId,
                min: state.pendingConquest.min,
                max: state.pendingConquest.max
            } : null,
            winner: state.winner === null ? null : modelIdOf(state.winner)
        }));
    };

    const scheduleAiStep = (seat, delay) => {
        schedule(() => aiStep(seat), pace(delay));
    };

    const beginAiAttackPhase = (seat) => {
        enterAttackPhase(seat);
        state.message = `${ownerLabel(seat)} is choosing attacks.`;
        render();
        scheduleAiStep(seat, 500);
    };

    const endAiAttackPhase = (seat, message = '') => {
        if (message) {
            addLog(message);
        } else {
            addLog(state.attacksThisTurn === 0
                ? `${ownerLabel(seat)} makes no attacks this turn.`
                : `${ownerLabel(seat)} ends its attacks after ${state.attacksThisTurn} ${state.attacksThisTurn === 1 ? 'battle' : 'battles'}.`);
        }

        state.pendingConquest = null;
        state.phase = 'fortify';
        state.sourceId = null;
        state.targetId = null;
        state.message = `${ownerLabel(seat)} is fortifying.`;
        render();
        scheduleAiStep(seat, 500);
    };

    const rejectBotAction = (seat) => {
        if (!state.active || state.current_seat !== seat) {
            return;
        }

        if (state.phase === 'reinforce') {
            addLog(`${ownerLabel(seat)} abandons a rejected reinforcement action and starts attacking.`);
            beginAiAttackPhase(seat);
            return;
        }

        if (state.phase === 'attack' || state.phase === 'conquer') {
            endAiAttackPhase(seat, `${ownerLabel(seat)} ends its attacks after a chosen action was rejected.`);
            return;
        }

        if (state.phase === 'fortify') {
            addLog(`${ownerLabel(seat)} ends its turn after a chosen fortification was rejected.`);
            endTurn(seat);
        }
    };

    const afterAiBattle = (seat) => {
        if (!state.active || state.current_seat !== seat) {
            return;
        }

        scheduleAiStep(seat, isSpectatorBattle(state.battle) ? 450 : 750);
    };

    const applyBotAction = (seat, action) => {
        let error = '';

        if (action.type === 'trade') {
            error = tradeCards(seat, action.cardIds, action.bonusTerritoryId);
        } else if (action.type === 'place') {
            const territory = byId(action.territoryId);
            error = placeReinforcement(seat, territory, action.count);

            if (!error) {
                addLog(`${ownerLabel(seat)} deploys ${pluralArmy(action.count)} to ${territory.name}.`);
                flashTerritory(territory.id, 'place');
            }
        } else if (action.type === 'attack') {
            if (state.attacksThisTurn >= AI_ATTACK_LIMIT) {
                endAiAttackPhase(seat, `${ownerLabel(seat)} reaches the ${AI_ATTACK_LIMIT}-battle limit and ends its attacks.`);
                return;
            }

            state.attacksThisTurn += 1;
            error = launchBattle(
                seat,
                byId(action.sourceId),
                byId(action.targetId),
                action.dice,
                () => afterAiBattle(seat)
            );

            if (!error) {
                return;
            }
        } else if (action.type === 'occupy') {
            error = moveIntoConquest(seat, action.count);
        } else if (action.type === 'end-attack') {
            endAiAttackPhase(seat);
            return;
        } else if (action.type === 'fortify') {
            error = performFortify(
                seat,
                byId(action.sourceId),
                byId(action.targetId),
                action.count
            );
        } else if (action.type === 'end-turn') {
            endTurn(seat);
            return;
        } else {
            error = `${ownerLabel(seat)} chose an unsupported action.`;
        }

        if (error) {
            rejectBotAction(seat);
            return;
        }

        render();

        if (state.phase === 'reinforce' && state.reinforcementRemaining === 0) {
            beginAiAttackPhase(seat);
            return;
        }

        scheduleAiStep(seat, action.type === 'occupy' ? 600 : 350);
    };

    const aiStep = (seat) => {
        // Only the bot driver ever steps a bot seat; other browsers wait for its posted state.
        if (!state.active || state.current_seat !== seat || state.busy || state.pendingDefense || !canDriveSeat(seat)) {
            return;
        }

        if (state.phase === 'attack' && state.attacksThisTurn >= AI_ATTACK_LIMIT) {
            endAiAttackPhase(seat, `${ownerLabel(seat)} reaches the ${AI_ATTACK_LIMIT}-battle limit and ends its attacks.`);
            return;
        }

        if (state.phase === 'reinforce' && state.reinforcementRemaining === 0) {
            beginAiAttackPhase(seat);
            return;
        }

        if (!['reinforce', 'attack', 'conquer', 'fortify'].includes(state.phase)) {
            return;
        }

        state.message = `${ownerLabel(seat)} is thinking…`;
        render();

        schedule(() => {
            if (!state.active || state.current_seat !== seat || state.busy || state.pendingDefense || !canDriveSeat(seat)) {
                return;
            }

            try {
                const action = chooseBotAction(botSnapshot(), modelIdOf(seat), { timeBudgetMs: AI_TIME_BUDGET_MS });
                applyBotAction(seat, action);
            } catch (error) {
                rejectBotAction(seat);
            }
        }, pace(80));
    };

    /* ------------------------------------------------------------------
     * Human input.
     * ------------------------------------------------------------------ */

    const guidanceContextKey = () => JSON.stringify([
        state.phase,
        state.current_seat,
        state.turn,
        state.reinforcementRemaining,
        (state.hands[runtime.localSeat] || []).length,
        state.sourceId,
        state.targetId,
        state.setupStep?.own,
        state.setupStep?.neutral,
        state.pendingConquest?.targetId
    ]);

    const setGuidanceReason = (text) => {
        runtime.guidanceOverride = { key: guidanceContextKey(), text };
    };

    const clearGuidanceReason = () => {
        runtime.guidanceOverride = null;
    };

    const cancelPhaseAdvanceConfirmation = () => {
        const hadConfirmation = Boolean(runtime.phaseAdvanceConfirmation);
        runtime.phaseAdvanceConfirmation = null;
        clearGuidanceReason();

        if (hadConfirmation) {
            setText(elements.endButton, state.phase === 'attack' ? 'End attacks' : state.phase === 'fortify' ? 'End turn' : 'End phase');
            setText(elements.turnGuidance, guidanceForState());
        }
    };

    const handleSetupClick = (territory) => {
        const error = placeSetupArmy(runtime.localSeat, territory);

        if (error) {
            setGuidanceReason(error);
            render();
            return;
        }

        clearGuidanceReason();
        flashTerritory(territory.id, 'place');

        if (setupStepComplete()) {
            finishSetupStep(runtime.localSeat);
            return;
        }

        state.message = setupPrompt();
        render();
    };

    const afterHumanPlacement = () => {
        if (state.reinforcementRemaining === 0 && findValidSets(state.hands[runtime.localSeat]).length === 0) {
            enterAttackPhase(runtime.localSeat);
        } else {
            state.message = humanReinforcePrompt();
        }

        render();
    };

    const handleReinforceClick = (territory) => {
        const error = placeReinforcement(runtime.localSeat, territory, 1);

        if (error) {
            setGuidanceReason(error);
            render();
            return;
        }

        clearGuidanceReason();
        state.sourceId = territory.id;
        flashTerritory(territory.id, 'place');
        pulseElement(elements.reinforcements, 'is-fx-tick', 600);
        afterHumanPlacement();
    };

    const handleAttackSelection = (territory) => {
        const source = byId(state.sourceId);

        if (source && territory.id === source.id) {
            state.sourceId = null;
            state.targetId = null;
            clearGuidanceReason();
            return;
        }

        if (territory.owner === runtime.localSeat) {
            if (territory.armies < 2) {
                setGuidanceReason(`${territory.name} needs at least two armies to attack.`);
                return;
            }

            const targets = legalAttackTargets(runtime.localSeat, territory);

            if (targets.length === 0) {
                setGuidanceReason(`${territory.name} has no adjacent enemy territory to attack.`);
                return;
            }

            clearGuidanceReason();
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = `${territory.name} selected. Choose one of ${targets.length} highlighted targets.`;
            return;
        }

        if (!source || source.owner !== runtime.localSeat) {
            setGuidanceReason('Pick a territory you own with at least two armies before choosing an enemy.');
            return;
        }

        const error = attackError(runtime.localSeat, source, territory, Math.max(1, maxAttackDice(source)));

        if (error) {
            setGuidanceReason(error);
            return;
        }

        clearGuidanceReason();
        state.targetId = territory.id;
        state.message = `${source.name} → ${territory.name} (${ownerLabel(territory.owner)}, ${pluralArmy(territory.armies)}). Choose attack dice and press Roll attack.`;
    };

    const handleFortifySelection = (territory) => {
        const source = byId(state.sourceId);

        if (territory.owner !== runtime.localSeat) {
            setGuidanceReason('Fortify only between territories you own.');
            return;
        }

        if (source && territory.id === source.id) {
            state.sourceId = null;
            state.targetId = null;
            clearGuidanceReason();
            return;
        }

        if (!source || source.owner !== runtime.localSeat) {
            if (territory.armies < 2) {
                setGuidanceReason(`${territory.name} needs at least two armies before it can be a fortify source.`);
                return;
            }

            clearGuidanceReason();
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = `${territory.name} selected. Highlighted territories are connected through your land.`;
            return;
        }

        if (!connectedOwned(runtime.localSeat, source.id).has(territory.id)) {
            setGuidanceReason(`${territory.name} is not connected to ${source.name} through territory you own.`);
            return;
        }

        clearGuidanceReason();
        state.targetId = territory.id;
        state.message = `Choose how many armies move from ${source.name} to ${territory.name}, then press Fortify.`;
    };

    const selectTerritory = (territoryId) => {
        const territory = byId(territoryId);

        if (!territory) {
            return;
        }

        cancelPhaseAdvanceConfirmation();
        state.detailId = territory.id;

        if (!state.active) {
            state.message = state.phase === 'gameover'
                ? `Game over. Viewing ${territory.name}. Start a new game to play again.`
                : 'Start a new game to deal the world.';
            render();
            return;
        }

        if (state.current_seat !== runtime.localSeat) {
            state.message = state.pendingDefense
                ? 'Choose your defense dice first.'
                : `${ownerLabel(state.current_seat)} is taking its turn. Viewing ${territory.name}.`;
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
            setGuidanceReason('Choose how many armies move into the conquered territory before selecting another territory.');
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

        if (!source || !target || attackError(runtime.localSeat, source, target, Math.max(1, maxAttackDice(source)))) {
            state.targetId = null;
        }

        render();
    };

    const humanAttack = () => {
        if (state.current_seat !== runtime.localSeat || state.busy) {
            return;
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const error = launchBattle(runtime.localSeat, source, target, effectiveAttackDice(source), afterHumanBattle);

        if (error) {
            state.message = error;
            render();
        }
    };

    const confirmConquest = () => {
        const pending = state.pendingConquest;

        if (!pending || pending.player !== runtime.localSeat || state.busy) {
            return;
        }

        const error = moveIntoConquest(runtime.localSeat, asInput(elements.conquestCount).valueAsNumber);

        if (error) {
            state.message = error;
            render();
            return;
        }

        const source = byId(pending.sourceId);
        state.targetId = null;
        state.message = hasLegalAttack(runtime.localSeat)
            ? `Armies moved. ${source.armies > 1 ? `${source.name} can keep attacking, or ` : ''}select another attacker or press End attacks.`
            : 'Armies moved. No legal attacks remain; press End attacks to fortify.';
        render();
    };

    const humanFortify = () => {
        if (state.current_seat !== runtime.localSeat) {
            return;
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const error = performFortify(runtime.localSeat, source, target, asInput(elements.fortifyCount).valueAsNumber);

        if (error) {
            state.message = error;
            render();
            return;
        }

        endTurn(runtime.localSeat);
    };

    const placeAllReinforcements = () => {
        if (state.current_seat !== runtime.localSeat) {
            return;
        }

        const territory = byId(state.sourceId);
        const error = placeReinforcement(runtime.localSeat, territory, state.reinforcementRemaining);

        if (error) {
            state.message = error;
            render();
            return;
        }

        flashTerritory(territory.id, 'place');
        pulseElement(elements.reinforcements, 'is-fx-tick', 600);
        afterHumanPlacement();
    };

    const selectedHumanCards = () => state.selectedCardIds
        .map((cardId) => state.hands[runtime.localSeat].find((card) => card.id === cardId))
        .filter(Boolean);

    const humanTrade = () => {
        const before = state.reinforcementRemaining;
        const error = tradeCards(runtime.localSeat, state.selectedCardIds);

        if (error) {
            state.message = error;
        } else {
            state.selectedCardIds = [];
            state.message = humanReinforcePrompt();
        }

        render();

        if (!error) {
            showFeedback('trade', `Set traded: +${pluralArmy(state.reinforcementRemaining - before)} to deploy.`);
            pulseElement(elements.reinforcements, 'is-fx-tick', 700);
        }
    };

    const toggleCard = (cardId) => {
        if (!state.active || state.current_seat !== runtime.localSeat || !state.hands[runtime.localSeat].some((card) => card.id === cardId)) {
            return;
        }

        if (state.selectedCardIds.includes(cardId)) {
            state.selectedCardIds = state.selectedCardIds.filter((id) => id !== cardId);
        } else {
            state.selectedCardIds = [...state.selectedCardIds, cardId].slice(-3);
        }

        render();

        const node = runtime.cardNodes.get(cardId);

        if (node) {
            pulseElement(node.button, 'is-fx-pick', 320);
        }

        const selected = selectedHumanCards();

        if (selected.length === 3) {
            if (isValidSet(selected)) {
                const value = tradeValue(state.setsTraded, state.config.cardMode, selected);
                showFeedback('set', `Valid set: worth ${pluralArmy(value)}. ${state.phase === 'reinforce' ? 'Press Trade selected set.' : 'Trade it during your reinforcement phase.'}`);
            } else {
                showFeedback('invalid', 'Not a set: use three of a kind, one of each type, or two cards with a wild.');
            }
        }
    };

    const advancePhase = () => {
        if (!state.active || state.current_seat !== runtime.localSeat || state.busy || state.pendingConquest) {
            return;
        }

        if (state.phase === 'reinforce') {
            cancelPhaseAdvanceConfirmation();

            if (state.hands[runtime.localSeat].length >= 5 || state.reinforcementRemaining > 0) {
                state.message = humanReinforcePrompt();
            } else {
                enterAttackPhase(runtime.localSeat);
            }

            render();
            return;
        }

        const confirmationKey = guidanceContextKey();

        if (state.phase === 'attack') {
            if (hasLegalAttack(runtime.localSeat) && runtime.phaseAdvanceConfirmation !== confirmationKey) {
                runtime.phaseAdvanceConfirmation = confirmationKey;
                setGuidanceReason('You still have a legal attack. Press Confirm: end attacks to skip it.');
                render();
                return;
            }

            cancelPhaseAdvanceConfirmation();
            state.phase = 'fortify';
            state.sourceId = null;
            state.targetId = null;
            state.message = 'Fortify (optional, once): select a territory with spare armies, then a highlighted connected territory. Or press End turn.';
            render();
            return;
        }

        if (state.phase === 'fortify') {
            if (hasLegalFortify(runtime.localSeat) && runtime.phaseAdvanceConfirmation !== confirmationKey) {
                runtime.phaseAdvanceConfirmation = confirmationKey;
                setGuidanceReason('You can still fortify once. Press Confirm: end turn to skip it.');
                render();
                return;
            }

            cancelPhaseAdvanceConfirmation();
            addLog(`${ownerLabel(runtime.localSeat)} ends the turn without fortifying.`);
            endTurn(runtime.localSeat);
        }
    };

    const enableAutoSetup = () => {
        if (!state.active || state.phase !== 'setup') {
            return;
        }

        // Online the choice stays in this browser and covers only its own seat.
        if (isOnline()) {
            online.autoSetup = true;

            if (state.current_seat === runtime.localSeat && !state.busy) {
                autoSetupStep(runtime.localSeat);
            } else {
                render();
            }

            return;
        }

        state.autoSetupHuman = true;

        if (state.current_seat === runtime.localSeat) {
            autoSetupStep(runtime.localSeat);
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
        const art = createSvg('image', {
            class: 'risk-marker-art',
            x: -21,
            y: -21,
            width: 42,
            height: 42,
            preserveAspectRatio: 'xMidYMid meet'
        });
        const shape = createSvg('path', { class: 'risk-marker-shape', d: markerShapes.none });
        const count = createSvg('text', { class: 'risk-marker-count', 'text-anchor': 'middle', y: 4.5 });
        const badge = createSvg('text', { class: 'risk-marker-badge', 'text-anchor': 'middle', y: -22 });
        const name = createSvg('text', { class: 'risk-marker-name', 'text-anchor': 'middle', y: 28 });

        name.textContent = territory.short;
        art.addEventListener('load', () => group.classList.remove('is-art-missing'));
        art.addEventListener('error', () => group.classList.add('is-art-missing'));
        group.append(ring, art, shape, count, badge, name);
        group.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectTerritory(territory.id);
            }
        });
        markerLayer.append(group);
        markers.set(territory.id, { group, art, shape, count, badge });
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
        const candidates = new Set();

        if (!state.active || state.current_seat !== runtime.localSeat || state.busy) {
            return { legal, placeable, candidates };
        }

        const source = byId(state.sourceId);

        if (state.phase === 'setup' && state.setupStep) {
            const step = state.setupStep;

            state.territories.forEach((territory) => {
                if ((territory.owner === runtime.localSeat && step.own < step.ownNeeded)
                    || (territory.owner === 'neutral' && step.neutral < step.neutralNeeded)) {
                    placeable.add(territory.id);
                }
            });
        } else if (state.phase === 'reinforce' && state.reinforcementRemaining > 0 && state.hands[runtime.localSeat].length < 5) {
            ownedBy(runtime.localSeat).forEach((territory) => placeable.add(territory.id));
        } else if (state.phase === 'attack' && source) {
            legalAttackTargets(runtime.localSeat, source).forEach((territory) => legal.add(territory.id));
        } else if (state.phase === 'attack') {
            ownedBy(runtime.localSeat).forEach((territory) => {
                if (legalAttackTargets(runtime.localSeat, territory).length > 0) {
                    candidates.add(territory.id);
                }
            });
        } else if (state.phase === 'fortify' && source && source.owner === runtime.localSeat && source.armies > 1 && !state.fortifiedThisTurn) {
            connectedOwned(runtime.localSeat, source.id).forEach((id) => {
                if (id !== source.id) {
                    legal.add(id);
                }
            });
        } else if (state.phase === 'fortify' && !state.fortifiedThisTurn) {
            ownedBy(runtime.localSeat).forEach((territory) => {
                if (canFortifyFrom(runtime.localSeat, territory)) {
                    candidates.add(territory.id);
                }
            });
        }

        return { legal, placeable, candidates };
    };

    const territoryAriaLabel = (territory, role, isLegal, isPlaceable, isCandidate) => {
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

        if (isCandidate) {
            parts.push(state.phase === 'fortify' ? 'can fortify from here' : 'can attack from here');
        }

        return parts.join('. ');
    };

    const renderMap = () => {
        const { legal, placeable, candidates } = computeHighlights();

        state.territories.forEach((territory) => {
            const marker = markers.get(territory.id);
            const path = landPaths.get(territory.id);
            const role = territory.id === state.sourceId
                ? 'source'
                : territory.id === state.targetId ? 'target' : '';
            const isLegal = legal.has(territory.id);
            const isPlaceable = placeable.has(territory.id);
            const isCandidate = candidates.has(territory.id);
            const artHref = territory.owner ? pieceArt[territory.owner] : '';
            const artMissing = artHref
                && marker.art.getAttribute('href') === artHref
                && marker.group.classList.contains('is-art-missing');
            const classes = [
                `owner-${ownerKey(territory.owner)}`,
                role ? `is-${role}` : '',
                isLegal ? 'is-legal' : '',
                isPlaceable ? 'is-placeable' : '',
                isCandidate ? 'is-candidate' : '',
                territory.id === state.detailId ? 'is-detail' : '',
                artHref ? 'has-art' : '',
                artMissing ? 'is-art-missing' : '',
                runtime.fx.has(territory.id) ? `is-fx-${runtime.fx.get(territory.id).kind}` : ''
            ].filter(Boolean).join(' ');

            if (path) {
                path.setAttribute('class', `risk-land ${classes}`);

                if (role || isLegal) {
                    path.parentNode.appendChild(path);
                }
            }

            marker.group.setAttribute('class', `risk-marker ${classes}`);
            marker.group.setAttribute('aria-label', territoryAriaLabel(territory, role, isLegal, isPlaceable, isCandidate));
            marker.group.setAttribute('aria-pressed', role ? 'true' : 'false');
            marker.shape.setAttribute('d', markerShapes[territory.owner] || markerShapes.none);

            if (artHref) {
                marker.art.setAttribute('href', artHref);
            } else {
                marker.art.removeAttribute('href');
            }

            marker.count.textContent = territory.owner ? String(territory.armies) : '–';
            marker.badge.textContent = role === 'source' ? 'FROM' : role === 'target' ? 'TO' : '';
        });

        boardSvg.classList.toggle('is-waiting', state.active && (state.current_seat !== runtime.localSeat || state.busy));
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
        const ownerClass = `owner-${ownerKey(territory.owner)}`;
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

        if (state.current_seat !== runtime.localSeat) {
            return state.pendingDefense ? 'Choose your defense dice in the command panel.' : `${ownerLabel(state.current_seat)} is playing its turn.`;
        }

        if (state.phase === 'setup') {
            return hasNeutral()
                ? 'Click your territories (circles) for your two armies and a neutral territory (square) for the neutral army.'
                : 'Click your territories (circles) to place your two armies for this step.';
        }

        if (state.phase === 'reinforce') {
            return focus.owner === runtime.localSeat ? 'Click to add one army here, or use Place all here.' : 'Reinforcements go on your own territories.';
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
        const ownedCount = (owner) => members.filter((id) => byId(id)?.owner === owner).length;
        // A full table lists only the seats present in this continent, always including the player.
        const controlSeats = seatNumbers().length > 2
            ? seatNumbers().filter((seat) => seat === runtime.localSeat || ownedCount(seat) > 0)
            : seatNumbers();
        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const wrapper = document.createElement('div');
        const list = document.createElement('dl');
        const help = document.createElement('p');

        list.className = 'risk-selection-list';

        const rows = [
            ['Territory', focus.name],
            ['Continent', `${continent.name} (+${continent.bonus} for all ${members.length})`],
            ['Control', focus.owner ? controlSeats.map((seat) => `${ownerLabel(seat)} ${ownedCount(seat)}/${members.length}`).join(', ') : 'Not dealt yet'],
            ['Owner', focus.owner ? `${ownerLabel(focus.owner)} (${ownerShapeNames[focus.owner]} marker)` : 'Unassigned'],
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

    // A portrait card: decorative art (or its emblem fallback) under readable type, name and bonus text.
    const createCardNode = (card) => {
        const type = cardArtType(card.type);
        const territory = byId(card.territoryId);
        const item = document.createElement('li');
        const button = document.createElement('button');
        const art = document.createElement('span');
        const body = document.createElement('span');
        const owned = createText('span', 'risk-card-owned', 'You own it: +2');
        const emblem = createText('span', 'risk-card-emblem', cardEmblems[type]);

        item.className = 'risk-hand-slot';
        button.type = 'button';
        button.className = `risk-card risk-card-${card.type}`;
        button.dataset.cardId = card.id;
        art.className = 'risk-card-art';
        art.setAttribute('aria-hidden', 'true');
        art.append(emblem);

        if (runtime.missingArt.has(type)) {
            button.classList.add('is-art-missing');
        } else {
            const image = document.createElement('img');

            image.className = 'risk-card-image';
            image.alt = '';
            image.decoding = 'async';
            image.draggable = false;
            image.addEventListener('load', () => {
                button.classList.add('is-art-loaded');
            });
            image.addEventListener('error', () => {
                runtime.missingArt.add(type);
                button.classList.add('is-art-missing');
                image.remove();
            });
            image.src = cardArtUrl(type);
            art.append(image);
        }

        body.className = 'risk-card-body';
        body.append(
            createText('span', 'risk-card-name', territory ? territory.name : 'Wild card'),
            owned
        );
        button.append(
            createText('span', 'risk-card-type', cardTypeLabels[type]),
            art,
            body
        );

        if (runtime.freshCardIds.has(card.id)) {
            button.classList.add('is-dealt');
        }

        item.append(button);
        return { item, button, owned };
    };

    const renderHand = () => {
        const hand = state.hands[runtime.localSeat];
        const selectedCards = state.selectedCardIds
            .map((cardId) => hand.find((card) => card.id === cardId))
            .filter(Boolean);

        // The hand is rebuilt on every render, so keyboard focus is carried over by card id.
        const activeElement = document.activeElement;
        const focusedCardId = activeElement && elements.hand.contains(activeElement)
            ? activeElement.getAttribute('data-card-id')
            : null;
        let focusTarget = null;
        const fullSelection = selectedCards.length === 3;
        const validSelection = fullSelection && isValidSet(selectedCards);

        if (hand.length === 0) {
            runtime.cardNodes.clear();
            elements.hand.replaceChildren(createText(
                'li',
                'risk-hand-empty',
                state.active ? 'No cards yet. Conquer a territory during your turn to earn one.' : 'Cards appear here during play.'
            ));
        } else {
            const held = new Set(hand.map((card) => card.id));

            runtime.cardNodes.forEach((_node, cardId) => {
                if (!held.has(cardId)) {
                    runtime.cardNodes.delete(cardId);
                }
            });

            const items = hand.map((card) => {
                let node = runtime.cardNodes.get(card.id);

                if (!node) {
                    node = createCardNode(card);
                    runtime.cardNodes.set(card.id, node);
                }

                const territory = byId(card.territoryId);
                const selected = state.selectedCardIds.includes(card.id);
                const owned = Boolean(territory && territory.owner === runtime.localSeat);

                node.button.setAttribute('aria-pressed', selected ? 'true' : 'false');
                node.button.classList.toggle('is-owned', owned);
                node.button.classList.toggle('is-set-valid', selected && validSelection);
                node.button.classList.toggle('is-set-invalid', selected && fullSelection && !validSelection);
                node.owned.hidden = !owned;

                if (card.id === focusedCardId) {
                    focusTarget = node.button;
                }

                return node.item;
            });
            const current = Array.from(elements.hand.children);

            // Only reorder the list when the hand itself changed, so unrelated renders do not restart effects.
            if (current.length !== items.length || current.some((child, index) => child !== items[index])) {
                elements.hand.replaceChildren(...items);
            }
        }

        if (focusTarget && document.activeElement !== focusTarget) {
            focusTarget.focus();
        }

        if (state.config.cardMode === 'fixed') {
            elements.tradeValue.textContent = selectedCards.length === 3 && isValidSet(selectedCards)
                ? `Selected set: ${pluralArmy(tradeValue(state.setsTraded, 'fixed', selectedCards))}. ${FIXED_VALUE_TABLE}`
                : `Next set: by type. ${FIXED_VALUE_TABLE}`;
        } else {
            const value = tradeValue(state.setsTraded, state.config.cardMode);
            elements.tradeValue.textContent = `Next set: ${pluralArmy(value)} (${state.setsTraded} ${state.setsTraded === 1 ? 'set' : 'sets'} traded so far)`;
        }

        if (hand.length >= 5 && state.current_seat === runtime.localSeat && state.phase === 'reinforce') {
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
        const humanTurn = state.active && isLocalTurn() && !state.busy && !online.resyncing;
        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const handSize = (state.hands[runtime.localSeat] || []).length;
        const pendingConquest = state.pendingConquest && state.pendingConquest.player === runtime.localSeat ? state.pendingConquest : null;
        const selectedCards = state.selectedCardIds
            .map((cardId) => state.hands[runtime.localSeat].find((card) => card.id === cardId))
            .filter(Boolean);

        // Starting is the primary action between games; restarting mid-game is a secondary, clearly named one.
        // While an online lobby or game is open, the start button leaves it for a local game against bots.
        const onlineOpen = Boolean(online.gameId);

        setText(elements.startButton, onlineOpen ? 'New local game' : state.active ? 'Restart game' : 'New game');
        elements.startButton.classList.toggle('risk-button-primary', !state.active && !onlineOpen);
        elements.startButton.classList.toggle('risk-button-restart', state.active || onlineOpen);
        asButton(elements.inviteButton).disabled = online.requesting;

        asButton(elements.autoSetupButton).disabled = !(
            state.active
            && state.phase === 'setup'
            && !autoSetupActive()
            && (!isOnline() || (isLocalTurn() && !online.resyncing && (state.setupPool[runtime.localSeat] || 0) > 0))
        );
        asButton(elements.reinforceButton).disabled = !(
            humanTurn
            && state.phase === 'reinforce'
            && state.reinforcementRemaining > 0
            && handSize < 5
            && source
            && source.owner === runtime.localSeat
        );

        const endLabels = {
            reinforce: 'Begin attacks',
            attack: 'End attacks',
            conquer: 'End attacks',
            fortify: 'End turn'
        };
        const confirmationPending = runtime.phaseAdvanceConfirmation === guidanceContextKey();

        if (runtime.phaseAdvanceConfirmation && !confirmationPending) {
            runtime.phaseAdvanceConfirmation = null;
        }

        const endLabel = state.current_seat === runtime.localSeat && endLabels[state.phase]
            ? confirmationPending
                ? state.phase === 'attack' ? 'Confirm: end attacks' : 'Confirm: end turn'
                : endLabels[state.phase]
            : 'End phase';

        setText(elements.endButton, endLabel);
        asButton(elements.endButton).disabled = !(
            humanTurn
            && ((state.phase === 'reinforce' && state.reinforcementRemaining === 0 && handSize < 5)
                || (state.phase === 'attack' && !pendingConquest)
                || state.phase === 'fortify')
        );

        const endBlockedReason = humanTurn && state.phase === 'reinforce' && handSize >= 5
            ? 'Trade a card set before placing armies or beginning attacks.'
            : humanTurn && state.phase === 'reinforce' && state.reinforcementRemaining > 0
                ? `Place all ${state.reinforcementRemaining} remaining armies before beginning attacks.`
                : humanTurn && (state.phase === 'conquer' || pendingConquest)
                    ? 'Move armies into the conquered territory before ending attacks.'
                    : '';

        if (endBlockedReason) {
            elements.endButton.title = endBlockedReason;
            elements.endButton.setAttribute('aria-describedby', elements.turnGuidance.id);
        } else {
            elements.endButton.removeAttribute('title');
            elements.endButton.removeAttribute('aria-describedby');
        }

        const maxDice = maxAttackDice(source && source.owner === runtime.localSeat ? source : null);
        const chosenDice = maxDice > 0 ? Math.min(state.attackDice, maxDice) : state.attackDice;
        const attackPhase = humanTurn && state.phase === 'attack' && !pendingConquest;

        attackDiceInputs.forEach((input) => {
            const value = Number(input.value);
            const label = input.closest('label');
            input.disabled = !attackPhase || maxDice < value;
            input.checked = value === chosenDice;

            if (input.disabled) {
                label?.setAttribute('title', `Needs at least ${value + 1} armies in the source`);
            } else {
                label?.removeAttribute('title');
            }
        });
        asButton(elements.attackButton).disabled = !attackPhase
            || Boolean(attackError(runtime.localSeat, source, target, effectiveAttackDice(source)));

        const fortifyInput = asInput(elements.fortifyCount);
        const fortifyReady = humanTurn
            && state.phase === 'fortify'
            && !fortifyError(runtime.localSeat, source, target, 1);
        const fortifyMax = source && source.owner === runtime.localSeat ? Math.max(1, source.armies - 1) : 1;

        fortifyInput.max = String(fortifyMax);
        fortifyInput.disabled = !fortifyReady;

        if (!fortifyReady || !Number.isInteger(fortifyInput.valueAsNumber) || fortifyInput.valueAsNumber > fortifyMax || fortifyInput.valueAsNumber < 1) {
            fortifyInput.value = String(fortifyMax);
        }

        asButton(elements.fortifyButton).disabled = !fortifyReady;
        setText(elements.fortifyButton, state.phase === 'fortify' ? 'Fortify & end turn' : 'Fortify');

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
            elements.defenseHelp.textContent = `${ownerLabel(pendingDefense.player)} rolls ${diceLabel(pendingDefense.attackDice)} from ${attacker.name} against your ${defender.name} (${pluralArmy(defender.armies)}). Ties go to you.`;
            asButton(elements.defendTwoButton).disabled = maxDefendDice(defender) < 2;
        }

        asInput(elements.autoDefend).checked = state.autoDefend || isOnline();
        // Online defense is always automatic with the maximum dice, so the preference only applies locally.
        asInput(elements.autoDefend).disabled = isOnline();
        asButton(elements.tradeButton).disabled = !(
            humanTurn
            && state.phase === 'reinforce'
            && selectedCards.length === 3
            && isValidSet(selectedCards)
        );
    };

    const createGlyph = (owner, className) => {
        const glyph = createText('span', className, ownerGlyphs[owner] || '');

        glyph.setAttribute('aria-hidden', 'true');
        return glyph;
    };

    // One scoreboard entry per seat in turn order, plus the neutral army in the one-bot game.
    const renderScoreboard = () => {
        elements.scoreboardSeats.replaceChildren(...boardOwners().map((owner) => {
            const entry = document.createElement('span');
            const label = ownerLabel(owner);
            const eliminated = isEliminated(owner);

            entry.append(
                createGlyph(owner, 'risk-owner-glyph'),
                createText('strong', '', String(ownedBy(owner).length)),
                ` ${label}`
            );

            if (owner === NEUTRAL_ID) {
                entry.className = `owner-${ownerKey(owner)}`;
                return entry;
            }

            entry.className = [
                'risk-scoreboard-side',
                `owner-${ownerKey(owner)}`,
                eliminated ? 'is-eliminated' : '',
                state.active && state.current_seat === owner ? 'is-current' : ''
            ].filter(Boolean).join(' ');

            const cards = document.createElement('span');

            cards.className = 'risk-scoreboard-cards';
            cards.append(createText('strong', '', String(state.hands[owner]?.length || 0)), ' cards');
            entry.append(cards);

            if (eliminated) {
                entry.append(createText('span', 'risk-scoreboard-eliminated', '✕ Eliminated'));
            }

            const avatar = state.avatars[owner];
            const avatarBox = document.createElement('span');
            const avatarName = document.createElement('span');
            const avatarFace = createText('span', 'risk-scoreboard-avatar-face', avatar?.text || '—');

            avatarBox.className = 'risk-scoreboard-avatar';
            avatarName.className = 'risk-scoreboard-avatar-name';
            avatarName.append(
                'Avatar: ',
                createText('span', '', avatar?.name || (state.phase === 'idle' ? 'Assigned when a game starts' : 'None available'))
            );
            avatarFace.setAttribute('aria-label', `${label} avatar face`);
            avatarBox.append(avatarName, avatarFace);
            entry.append(avatarBox);

            return entry;
        }));
    };

    // The legend lists the owners in play; it is rebuilt only when the seats change.
    const renderLegend = () => {
        const owners = boardOwners();
        const key = owners.join(',');

        if (key === runtime.legendKey) {
            return;
        }

        runtime.legendKey = key;
        elements.legendOwners.replaceChildren(...owners.map((owner) => {
            const item = document.createElement('span');

            item.append(
                createGlyph(owner, `risk-owner-glyph owner-${ownerKey(owner)}`),
                ` ${ownerLabel(owner)} ${ownerShapeNames[owner]}`
            );
            return item;
        }));
    };

    const setText = (element, text) => {
        if (element && element.textContent !== text) {
            element.textContent = text;
        }
    };

    const ownerPossessive = (seat) => (seat === runtime.localSeat ? 'Your' : `${ownerLabel(seat)}'s`);

    const describeConfig = (config) => [
        `${config.botCount} ${config.botCount === 1 ? 'bot' : 'bots'}`,
        `${config.placement === 'manual' ? 'Manual' : 'Random'} placement`,
        `${config.cardMode === 'fixed' ? 'Fixed' : 'Incremental'} cards`
    ].join(' · ');

    // The reserve counter always names the seat whose armies it counts.
    const reserveFor = () => {
        if (state.active && state.phase === 'setup') {
            const seat = state.current_seat && state.setupPool[state.current_seat] !== undefined ? state.current_seat : runtime.localSeat;

            return { count: state.setupPool[seat] || 0, label: `${ownerPossessive(seat)} setup armies to place` };
        }

        if (state.active && state.current_seat) {
            return { count: state.reinforcementRemaining, label: `${ownerPossessive(state.current_seat)} armies to place` };
        }

        return { count: 0, label: 'Armies to place' };
    };

    const renderSummary = () => {
        const reserve = reserveFor();
        const phase = phaseLabels[state.phase] || 'Ready';

        setText(elements.turn, String(state.turn));
        setText(elements.phase, state.active && state.current_seat
            ? `${state.current_seat === runtime.localSeat ? 'Your turn' : `${ownerLabel(state.current_seat)}'s turn`} · ${phase}`
            : phase);
        setText(elements.reinforcements, String(reserve.count));
        setText(uxElements.reserveOwner, reserve.label);
        setText(elements.status, state.message);
        renderScoreboard();
        renderLegend();
    };

    const renderLog = () => {
        if (state.log.length === 0) {
            elements.log.replaceChildren(createText('li', '', 'No battles yet.'));
            return;
        }

        elements.log.replaceChildren(...state.log.map((entry) => createText('li', '', entry)));
    };

    // The current objective plus, when the next relevant action is unavailable, the reason why.
    const objectiveFor = () => {
        if (state.phase === 'gameover' && isOnline()) {
            return state.winner === runtime.localSeat
                ? { title: 'Victory', text: 'You are the last seat standing. Press Invite players to set up a rematch.', blocker: '' }
                : {
                    title: 'Defeat',
                    text: `${state.winner ? ownerLabel(state.winner) : 'Another seat'} is the last seat standing. Press Invite players to set up a rematch.`,
                    blocker: ''
                };
        }

        if (state.phase === 'gameover') {
            if (state.winner === runtime.localSeat) {
                return { title: 'Victory', text: 'You hold the table. Adjust Game setup if you like, then press New game to play again.', blocker: '' };
            }

            const botsLeft = activeSeats().filter((seat) => seat !== runtime.localSeat).length;

            return {
                title: 'Defeat',
                text: state.winner
                    ? `You were eliminated and ${ownerLabel(state.winner)} is the last seat standing. Adjust Game setup if you like, then press New game for a rematch.`
                    : `You were eliminated with ${botsLeft} bots still in play, so no overall winner was decided. Adjust Game setup if you like, then press New game for a rematch.`,
                blocker: ''
            };
        }

        if (!state.active && online.gameId && !isOnline()) {
            return {
                title: 'Online lobby',
                text: online.isHost
                    ? 'Copy the invite link and send it to your friends: each friend who opens it takes the next open seat. Press Start game when everyone is in; open seats become bots.'
                    : 'You have a seat. The game begins when the host presses Start game; open seats become bots.',
                blocker: ''
            };
        }

        if (!state.active) {
            return {
                title: 'Ready to play',
                text: 'Choose your Game setup above, then press New game to deal the world.',
                blocker: ''
            };
        }

        if (state.pendingDefense) {
            const attacker = byId(state.pendingDefense.sourceId);
            const defender = byId(state.pendingDefense.targetId);

            return {
                title: 'Defend',
                text: attacker && defender
                    ? `${ownerLabel(attacker.owner)} attacks ${defender.name} from ${attacker.name}. Choose your defense dice.`
                    : 'You are under attack. Choose your defense dice.',
                blocker: 'The battle waits for your defense choice.'
            };
        }

        if (state.phase === 'setup') {
            const pool = state.setupPool[runtime.localSeat];

            if (autoSetupActive()) {
                return { title: 'Setup', text: 'Auto-place is spreading your remaining armies.', blocker: '' };
            }

            return {
                title: 'Setup: place your armies',
                text: pool > 0
                    ? `Click one of your territories to add an army. ${pluralArmy(pool)} left to place, or press Auto-place setup.`
                    : 'Your armies are placed. The other seats are finishing setup.',
                blocker: state.current_seat !== runtime.localSeat || state.busy
                    ? `Waiting for ${ownerLabel(state.current_seat)} to place.`
                    : ''
            };
        }

        if (state.current_seat !== runtime.localSeat) {
            return {
                title: `${ownerLabel(state.current_seat)}: ${phaseLabels[state.phase] || 'Turn'}`,
                text: isOnline()
                    ? 'Watch the map and dice tray. Other players\' moves appear within a few seconds, and you defend with the most dice allowed.'
                    : 'Watch the map and dice tray. You choose defense dice if a bot attacks you.',
                blocker: 'Your controls unlock when your turn begins.'
            };
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const ownSource = source && source.owner === runtime.localSeat ? source : null;
        const endLabel = elements.endButton.textContent;
        const rolling = state.busy ? 'Wait for the dice to settle.' : '';

        if (state.phase === 'reinforce') {
            if (state.hands[runtime.localSeat].length >= 5) {
                return {
                    title: 'Reinforce: trade a set',
                    text: 'You hold five or more cards. Select three that form a set, then press Trade selected set.',
                    blocker: 'Placing armies is locked until you trade a set.'
                };
            }

            if (state.reinforcementRemaining > 0) {
                return {
                    title: 'Reinforce',
                    text: `Deploy ${pluralArmy(state.reinforcementRemaining)}: click your territories one army at a time, or select one and press Place all here.`,
                    blocker: `${endLabel} unlocks once every army is deployed.`
                };
            }

            return { title: 'Reinforce', text: `All armies deployed. Press ${endLabel} to continue.`, blocker: rolling };
        }

        if (state.phase === 'conquer' && state.pendingConquest) {
            const conquered = byId(state.pendingConquest.targetId);

            return {
                title: 'Move in',
                text: `Move ${state.pendingConquest.min} to ${state.pendingConquest.max} armies into ${conquered ? conquered.name : 'the conquered territory'}, then press Move armies.`,
                blocker: 'Attacks resume after you move in.'
            };
        }

        if (state.phase === 'attack') {
            if (rolling) {
                return { title: 'Attack', text: 'The dice are rolling.', blocker: rolling };
            }

            if (!ownSource) {
                return {
                    title: 'Attack',
                    text: `Select one of your territories with 2 or more armies, then a neighbouring enemy. Or press ${endLabel}.`,
                    blocker: hasLegalAttack(runtime.localSeat)
                        ? 'Roll attack unlocks once you pick an attacker and a target.'
                        : `No attack is possible: none of your territories has spare armies beside an enemy. Press ${endLabel}.`
                };
            }

            if (!target) {
                return {
                    title: 'Attack',
                    text: `Attacking from ${ownSource.name}. Choose an enemy territory with a dashed ring.`,
                    blocker: ownSource.armies < 2
                        ? `${ownSource.name} needs at least 2 armies to attack.`
                        : 'Roll attack unlocks once you choose a target.'
                };
            }

            return {
                title: 'Attack',
                text: `${ownSource.name} against ${target.name}. Choose your dice and press Roll attack.`,
                blocker: attackError(runtime.localSeat, ownSource, target, effectiveAttackDice(ownSource)) || ''
            };
        }

        if (state.phase === 'fortify') {
            if (!ownSource) {
                return {
                    title: 'Fortify',
                    text: `Optional: move armies between two connected territories of yours, or press ${endLabel}.`,
                    blocker: 'Fortify unlocks once you pick a source and a destination.'
                };
            }

            if (!target) {
                return {
                    title: 'Fortify',
                    text: `Moving from ${ownSource.name}. Choose a connected territory of yours, or press ${endLabel}.`,
                    blocker: ownSource.armies < 2
                        ? `${ownSource.name} needs at least 2 armies to move any.`
                        : 'Fortify unlocks once you choose a destination.'
                };
            }

            return {
                title: 'Fortify',
                text: `Set how many armies move from ${ownSource.name} to ${target.name}, then press Fortify.`,
                blocker: fortifyError(runtime.localSeat, ownSource, target, 1) || ''
            };
        }

        return { title: phaseLabels[state.phase] || 'Ready', text: state.message, blocker: rolling };
    };

    const renderObjective = () => {
        const { title, text, blocker } = objectiveElements;

        if (!title || !text || !blocker) {
            return;
        }

        const objective = objectiveFor();

        // Text is only written when it changes, so unrelated rerenders leave the region untouched.
        if (title.textContent !== objective.title) {
            title.textContent = objective.title;
        }

        if (text.textContent !== objective.text) {
            text.textContent = objective.text;
        }

        if (blocker.textContent !== objective.blocker) {
            blocker.textContent = objective.blocker;
        }

        blocker.hidden = objective.blocker === '';
    };

    const renderSetupInfo = () => {
        const next = readSetupConfig();
        const current = state.config;
        const changed = state.active && Boolean(current) && (
            next.botCount !== current.botCount
            || next.placement !== current.placement
            || next.cardMode !== current.cardMode
        );

        setText(uxElements.setupSummary, describeConfig(next));
        setText(uxElements.setupNote, !state.active
            ? 'These settings are used when you press New game.'
            : changed
                ? `Changed settings apply to the next game. This game keeps ${describeConfig(current)}; press Restart game to switch now.`
                : 'Changes apply to the next game, not the one in progress.');
        setText(uxElements.startNote, online.gameId
            ? 'New local game leaves the online game and deals a game against bots with the setup below.'
            : state.active
                ? 'Restart game abandons this game and deals a new one with the setup below.'
                : 'New game deals the world with the setup below.');

        if (uxElements.setupNote) {
            uxElements.setupNote.classList.toggle('is-changed', changed);
        }
    };

    const guidanceForState = () => {
        if (state.phase === 'gameover') {
            return state.winner
                ? `${ownerLabel(state.winner)} wins the game.`
                : 'The game is over with no winner decided.';
        }

        if (!state.active || state.phase === 'idle') {
            return 'Choose your game setup and start a new game.';
        }

        if (state.pendingDefense) {
            const territory = byId(state.pendingDefense.targetId);

            return `Choose defense dice for ${territory ? territory.name : 'your territory'}.`;
        }

        if (!isLocalTurn()) {
            return `Waiting for ${ownerLabel(state.current_seat)}…`;
        }

        if (online.resyncing) {
            return 'Waiting for the latest online game state…';
        }

        if (state.busy) {
            return 'Waiting for the dice to finish rolling…';
        }

        const override = runtime.guidanceOverride;

        if (override && override.key === guidanceContextKey()) {
            return override.text;
        }

        if (override) {
            runtime.guidanceOverride = null;
        }

        const handSize = (state.hands[runtime.localSeat] || []).length;
        const source = byId(state.sourceId);
        const target = byId(state.targetId);

        if (state.phase === 'setup') {
            const step = state.setupStep;
            const ownLeft = step ? Math.max(0, step.ownNeeded - step.own) : 0;
            const neutralLeft = step ? Math.max(0, step.neutralNeeded - step.neutral) : 0;

            if (ownLeft > 0) {
                const remaining = state.setupPool[runtime.localSeat] || ownLeft;

                return `Place ${remaining} more ${remaining === 1 ? 'army' : 'armies'}: click one of your territories.`;
            }

            if (neutralLeft > 0) {
                return `Place ${neutralLeft} more neutral ${neutralLeft === 1 ? 'army' : 'armies'}: click a neutral territory.`;
            }

            return 'Your setup armies are placed; wait for the next setup step.';
        }

        if (state.phase === 'reinforce') {
            if (handSize >= 5) {
                return `You hold ${handSize} cards — trade a set before placing.`;
            }

            return `Reinforce: click your territories to place ${state.reinforcementRemaining} remaining ${state.reinforcementRemaining === 1 ? 'army' : 'armies'}, or use Place all here.`;
        }

        if (state.phase === 'attack') {
            if (source && source.owner === runtime.localSeat && source.armies < 2) {
                return `${source.name} needs at least 2 armies to attack. Pick another highlighted territory.`;
            }

            if (!source || source.owner !== runtime.localSeat) {
                return 'Attack: pick one of your highlighted territories, then an enemy neighbour.';
            }

            return target
                ? `Attack: choose dice, then roll ${source.name} against ${target.name}.`
                : `Attack: pick a highlighted enemy neighbour of ${source.name}, or End attacks.`;
        }

        if (state.phase === 'conquer') {
            const target = byId(state.pendingConquest?.targetId);

            return `Choose how many armies move into ${target ? target.name : 'the conquered territory'}.`;
        }

        if (state.phase === 'fortify') {
            if (!source || source.owner !== runtime.localSeat) {
                return 'Fortify (once): pick a highlighted territory with spare armies, then a connected territory, or press End turn.';
            }

            if (source.armies < 2) {
                return `${source.name} needs at least 2 armies to fortify. Pick another highlighted territory.`;
            }

            return target
                ? `Fortify: choose how many armies move from ${source.name} to ${target.name}, then press Fortify & end turn.`
                : `Fortify: pick a connected territory you own for armies from ${source.name}, or press End turn.`;
        }

        return 'Follow the current game prompt to continue.';
    };

    const renderPhaseUi = () => {
        const phases = ['setup', 'reinforce', 'attack', 'fortify'];
        const activePhase = state.phase === 'conquer' ? 'attack' : state.phase;
        const activeIndex = phases.indexOf(activePhase);
        const showTurnProgress = state.active && isLocalTurn() && activeIndex !== -1;

        elements.commandPanel.dataset.phase = state.phase;

        phaseSteps.forEach((step) => {
            const phase = step.dataset.phase;
            const index = phases.indexOf(phase);
            const active = showTurnProgress && phase === activePhase;
            const done = showTurnProgress && index !== -1 && index < activeIndex;

            step.classList.toggle('is-active', active);
            step.classList.toggle('is-done', done);

            if (active) {
                step.setAttribute('aria-current', 'step');
            } else {
                step.removeAttribute('aria-current');
            }
        });

        phasePanels.forEach((panel) => {
            const phasesForPanel = (panel.dataset.riskPhasePanel || '')
                .split(',')
                .map((phase) => phase.trim());
            const hasOpenDecision = (panel.contains(elements.defensePanel) && !elements.defensePanel.hidden)
                || (panel.contains(elements.conquestPanel) && !elements.conquestPanel.hidden);
            const isBattlePanel = panel.contains(elements.diceTray);
            const shouldShow = !state.active
                || phasesForPanel.includes(state.phase)
                || hasOpenDecision
                || (!isLocalTurn() && isBattlePanel);

            if (!shouldShow && panel.contains(document.activeElement)) {
                if (!asButton(elements.endButton).disabled) {
                    elements.endButton.focus();
                } else {
                    elements.turnGuidance.tabIndex = -1;
                    elements.turnGuidance.focus();
                }
            }

            panel.hidden = !shouldShow;
        });

        setText(elements.turnGuidance, guidanceForState());
    };

    // One polite announcement per change: the phase line when the turn or phase changes, then the new message.
    const announce = () => {
        const region = uxElements.announcer;
        const phaseKey = state.active ? `${state.current_seat}:${state.phase}` : state.phase;

        if (!region) {
            return;
        }

        if (runtime.announcedPhase === null) {
            // The initial page state is already on screen; nothing to announce on load.
            runtime.announcedPhase = phaseKey;
            runtime.announcedMessage = state.message;
            return;
        }

        const parts = [];

        if (phaseKey !== runtime.announcedPhase) {
            runtime.announcedPhase = phaseKey;
            parts.push(elements.phase.textContent);
        }

        if (state.message !== runtime.announcedMessage) {
            runtime.announcedMessage = state.message;

            if (state.message) {
                parts.push(state.message);
            }
        }

        if (parts.length > 0) {
            region.textContent = parts.join('. ');
        }
    };

    const canFocus = (element) => element instanceof HTMLElement
        && element.isConnected
        && !element.closest('[hidden]')
        && !(/** @type {HTMLButtonElement} */ (element).disabled);

    // Focus moves into a conquest or defense decision only when it first appears, and returns once it resolves.
    const syncDecisionFocus = () => {
        const decision = !elements.defensePanel.hidden
            ? 'defense'
            : !elements.conquestPanel.hidden ? 'conquest' : '';
        const active = document.activeElement;
        const hiddenPhasePanel = phasePanels.find((panel) => panel.hidden && active instanceof Node && panel.contains(active));

        if (hiddenPhasePanel) {
            elements.turnGuidance.setAttribute('tabindex', '-1');
            const next = [elements.endButton, elements.turnGuidance].find(canFocus);

            if (next) {
                next.focus();
            }
        }

        if (decision === runtime.decision) {
            return;
        }

        const previousPanel = runtime.decision === 'defense'
            ? elements.defensePanel
            : runtime.decision === 'conquest' ? elements.conquestPanel : null;
        const focusWasInPanel = hiddenPhasePanel === undefined
            && previousPanel !== null
            && (!active || active === document.body || previousPanel.contains(active));

        runtime.decision = decision;

        if (decision) {
            if (previousPanel === null) {
                runtime.decisionReturn = active instanceof HTMLElement && active !== document.body ? active : null;
            }

            if (decision === 'defense') {
                (canFocus(elements.defendTwoButton) ? elements.defendTwoButton : elements.defendOneButton).focus();
            } else {
                const input = asInput(elements.conquestCount);

                input.focus();
                input.select();
            }

            return;
        }

        const returnTo = runtime.decisionReturn;

        runtime.decisionReturn = null;

        if (!focusWasInPanel) {
            return;
        }

        // After the game ends the next sensible step is a new game; otherwise go back where the player was.
        const candidates = state.active
            ? [returnTo, elements.attackButton, elements.endButton, elements.autoDefend, elements.startButton]
            : [elements.startButton];
        const next = candidates.find(canFocus);

        if (next) {
            next.focus();
        }
    };

    const render = () => {
        renderSummary();
        renderControls();
        renderPhaseUi();
        renderSetupInfo();
        renderObjective();
        renderMap();
        renderSelection();
        renderHand();
        renderDice();
        renderLog();
        announce();
        syncDecisionFocus();
        renderLobby();
        syncOnlineState();
    };

    /* ------------------------------------------------------------------
     * Online play: lobby, polling and state sync.
     * ------------------------------------------------------------------ */

    const onlineErrorMessages = {
        identity_required: 'Your browser could not be identified for online play. Allow cookies for this site, reload the page and try again.',
        link_not_found: 'This invite link is not valid. Ask the host for a new one.',
        link_revoked: 'This invite link was withdrawn by the host.',
        link_expired: 'This invite link has expired. Ask the host for a new one.',
        join_closed: 'This game has already started, so its invite link can no longer be used.',
        game_full: 'This game is full: every seat is already taken.',
        game_not_found: 'That online game could not be found.',
        host_required: 'Only the host can do that.',
        game_not_waiting: 'The game has already started.',
        seat_required: 'You do not have a seat in this game.',
        game_not_active: 'The game is not in progress.',
        not_your_turn: 'It was not your turn, so the move was not saved. Loading the latest table.',
        state_conflict: 'Another move reached the server first. Loading the latest table.',
        state_too_large: 'The game is too large to save online.',
        network_error: 'The game server could not be reached. Retrying…'
    };

    const onlineErrorText = (error) => {
        const code = error && typeof error.error === 'string' ? error.error : '';

        if (Object.prototype.hasOwnProperty.call(onlineErrorMessages, code)) {
            return onlineErrorMessages[code];
        }

        return error && typeof error.message === 'string' && error.message
            ? error.message
            : 'The online game request failed.';
    };

    const showOnlineNotice = (text, kind = '') => {
        online.notice = text;
        online.noticeKind = kind;
    };

    const clearConnectionNotice = () => {
        if (online.noticeKind === 'connection') {
            showOnlineNotice('');
        }
    };

    const rememberOnlineGame = (gameId) => {
        try {
            if (gameId) {
                window.localStorage.setItem(ONLINE_GAME_KEY, gameId);
            } else {
                window.localStorage.removeItem(ONLINE_GAME_KEY);
            }
        } catch {
            // Storage can be unavailable (private mode); the ?game= link still resumes the game.
        }
    };

    const rememberedOnlineGame = () => {
        try {
            return window.localStorage.getItem(ONLINE_GAME_KEY) || '';
        } catch {
            return '';
        }
    };

    // One invite link per lobby: the host's link is stored per game id so a reload or resume reuses it.
    const rememberInviteUrl = (gameId, url) => {
        if (!gameId) {
            return;
        }

        try {
            if (url) {
                window.localStorage.setItem(`${INVITE_URL_KEY_PREFIX}${gameId}`, url);
            } else {
                window.localStorage.removeItem(`${INVITE_URL_KEY_PREFIX}${gameId}`);
            }
        } catch {
            // Storage can be unavailable (private mode); the host then gets a fresh link on reload.
        }
    };

    const rememberedInviteUrl = (gameId) => {
        if (!gameId) {
            return '';
        }

        try {
            return window.localStorage.getItem(`${INVITE_URL_KEY_PREFIX}${gameId}`) || '';
        } catch {
            return '';
        }
    };

    // Keeps ?game=<id> in the address bar so a reload returns to the same game; ?join= never stays.
    const setPageGameParam = (gameId) => {
        const url = new URL(window.location.href);

        url.searchParams.delete('join');

        if (gameId) {
            url.searchParams.set('game', gameId);
        } else {
            url.searchParams.delete('game');
        }

        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    };

    const blankTerritories = () => territoryCatalog.map((territory) => ({
        ...territory,
        owner: null,
        armies: 0
    }));

    // Back to the idle table between games; the attack and defense preferences are kept.
    const resetTable = () => {
        cancelPending();

        const preferences = {
            attackDice: state.attackDice,
            autoDefend: state.autoDefend
        };

        state = createState();
        Object.assign(state, preferences);
        state.territories = blankTerritories();
        runtime.localSeat = 1;
    };

    const stopPolling = () => {
        if (online.pollTimer) {
            window.clearInterval(online.pollTimer);
            online.pollTimer = 0;
        }
    };

    const startPolling = () => {
        stopPolling();
        online.pollTimer = window.setInterval(() => {
            pollOnlineGame();
        }, POLL_MS);
    };

    // Stops polling and forgets the online game. Returns whether one was open.
    const leaveOnlineGame = () => {
        const wasOpen = Boolean(online.gameId);
        const session = online.session + 1;

        // Leaving the lobby forgets its stored invite link; links already shared keep working.
        rememberInviteUrl(online.gameId, '');
        stopPolling();
        Object.assign(online, {
            gameId: null,
            game: null,
            isHost: false,
            playing: false,
            version: 0,
            session,
            polling: false,
            requesting: false,
            posting: false,
            queued: null,
            lastKey: '',
            lastAdvanceAt: 0,
            botDriver: false,
            resyncing: false,
            needsResync: false,
            deals: 0,
            autoSetup: false,
            inviteUrl: '',
            inviteRequesting: false,
            inviteFailed: false,
            notice: '',
            noticeKind: '',
            lobbyKey: ''
        });
        rememberOnlineGame('');

        if (wasOpen) {
            setPageGameParam('');
        }

        return wasOpen;
    };

    const isClosedStatus = (status) => status === 'finished' || status === 'abandoned';

    const playerAtSeat = (seat) => (Array.isArray(online.game?.players)
        ? online.game.players.find((player) => player.seat === seat) || null
        : null);

    // The shared state with every per-browser field removed: this is exactly what gets posted.
    const serializableState = () => {
        const snapshot = JSON.parse(JSON.stringify(state));

        TRANSIENT_STATE_KEYS.forEach((key) => {
            delete snapshot[key];
        });

        return snapshot;
    };

    // Status line for this viewer; the writer's own message is never shared.
    const onlineMessage = () => {
        if (state.phase === 'gameover') {
            if (state.winner === runtime.localSeat) {
                return 'Victory! You are the last seat standing.';
            }

            return state.winner ? `Game over. ${ownerLabel(state.winner)} is the last seat standing.` : 'Game over.';
        }

        if (!state.active) {
            return 'Waiting for the game to begin.';
        }

        if (isLocalTurn()) {
            if (state.phase === 'setup' && state.setupStep) {
                return setupPrompt();
            }

            if (state.phase === 'reinforce') {
                return `Your turn. ${humanReinforcePrompt()}`;
            }

            if (state.phase === 'attack') {
                return hasLegalAttack(runtime.localSeat)
                    ? 'Attack phase: select one of your territories with two or more armies, then a highlighted target.'
                    : 'Attack phase: you have no legal attacks. Press End attacks to fortify.';
            }

            if (state.phase === 'conquer' && state.pendingConquest) {
                return `Move between ${state.pendingConquest.min} and ${state.pendingConquest.max} armies into the conquered territory.`;
            }

            if (state.phase === 'fortify') {
                return 'Fortify (optional, once): select a territory with spare armies, then a highlighted connected territory. Or press End turn.';
            }
        }

        const latest = state.log[0];

        return `${ownerLabel(state.current_seat)} is playing: ${phaseLabels[state.phase] || 'Turn'}.${latest ? ` ${latest}` : ''}`;
    };

    // Starts the next step for whichever seat this browser drives (a bot seat or its own auto-placed setup).
    const resumeOnlineTurn = () => {
        if (!isOnline() || !state.active || online.resyncing) {
            return;
        }

        const seat = state.current_seat;

        if (!canDriveSeat(seat)) {
            return;
        }

        if (isBot(seat)) {
            if (state.phase === 'setup') {
                schedule(() => autoSetupStep(seat), pace(300));
            } else {
                scheduleAiStep(seat, 450);
            }

            return;
        }

        if (state.phase === 'setup' && online.autoSetup) {
            schedule(() => autoSetupStep(seat), pace(140));
        }
    };

    // Replaces the local game with a server snapshot and re-renders it for this viewer.
    const applyRemoteState = (remote, version) => {
        if (!Array.isArray(remote.seats) || remote.seats.length < 2 || !Array.isArray(remote.territories)) {
            showOnlineNotice('The online game sent a table this page cannot read.');
            return false;
        }

        cancelPending();

        const firstSnapshot = !online.playing;
        const keep = {
            attackDice: state.attackDice,
            autoDefend: state.autoDefend,
            detailId: state.detailId,
            selectedCardIds: state.selectedCardIds
        };
        const before = new Map(state.territories.map((territory) => [territory.id, territory]));
        const roster = remote.seats.map((entry) => ({ seat: entry.seat, kind: entry.kind, name: entry.name }));

        runtime.localSeat = online.game?.viewer_seat;
        state = {
            ...createState(remote.config || readSetupConfig(), roster),
            ...JSON.parse(JSON.stringify(remote)),
            selectedCardIds: [],
            sourceId: null,
            targetId: null,
            detailId: keep.detailId,
            busy: false,
            attackDice: keep.attackDice,
            autoDefend: keep.autoDefend,
            pendingDefense: null,
            message: ''
        };

        if (!Array.isArray(state.hands[runtime.localSeat])) {
            state.hands[runtime.localSeat] = [];
        }

        const hand = state.hands[runtime.localSeat];

        state.selectedCardIds = keep.selectedCardIds.filter((cardId) => hand.some((card) => card.id === cardId));

        if (state.battle) {
            state.battle.rolling = false;
        }

        online.playing = true;
        online.version = version;
        online.lastAdvanceAt = Date.now();

        // Someone else advanced the game, so a non-host hands bot driving back.
        if (!online.isHost) {
            online.botDriver = false;
        }

        runtime.diceKey = '';
        state.message = onlineMessage();
        online.lastKey = JSON.stringify(serializableState());

        if (firstSnapshot) {
            if (uxElements.setupPanel instanceof HTMLDetailsElement) {
                uxElements.setupPanel.open = state.phase === 'gameover';
            }
        } else {
            state.territories.forEach((territory) => {
                const previous = before.get(territory.id);

                if (!previous || !previous.owner) {
                    return;
                }

                if (previous.owner !== territory.owner) {
                    flashTerritory(territory.id, 'conquer');
                } else if (territory.armies > previous.armies) {
                    flashTerritory(territory.id, 'place');
                } else if (territory.armies < previous.armies) {
                    flashTerritory(territory.id, 'loss');
                }
            });
        }

        render();
        resumeOnlineTurn();
        return true;
    };

    // The host deals once the server reports the game active with no state yet.
    const dealOnlineGame = (game) => {
        const players = Array.isArray(game.players) ? game.players : [];
        const roster = players.map((player) => ({
            seat: Number(player.seat),
            kind: player.kind === 'human' ? 'human' : 'bot',
            name: String(player.display_name || `Seat ${player.seat}`)
        }));

        if (!isValidRoster(roster)) {
            showOnlineNotice('The online roster is incomplete, so the world could not be dealt.');
            return;
        }

        online.deals += 1;
        online.playing = true;
        online.version = Number.isInteger(game.state_version) ? game.state_version : 0;
        online.lastKey = '';
        online.lastAdvanceAt = Date.now();
        online.autoSetup = false;
        runtime.localSeat = game.viewer_seat;
        startGame(roster);
    };

    // Takes in a Game from any endpoint: lobby details, a newer shared state, or the cue to deal.
    const receiveGame = (game, { force = false } = {}) => {
        if (!game || typeof game !== 'object' || !online.gameId || game.id !== online.gameId) {
            return;
        }

        online.game = { ...game, state: null };
        online.isHost = Boolean(game.viewer_is_host);
        clearConnectionNotice();

        // Once the game leaves the waiting state its invite link is no longer needed in this browser.
        if (game.status !== 'waiting') {
            rememberInviteUrl(game.id, '');
        }

        if (!Number.isInteger(game.viewer_seat)) {
            const wasPlaying = isOnline();

            leaveOnlineGame();

            if (wasPlaying) {
                resetTable();
            }

            showOnlineNotice('You do not have a seat in that online game.');
            render();
            return;
        }

        const version = Number.isInteger(game.state_version) ? game.state_version : 0;
        const remoteState = game.state_included && game.state && typeof game.state === 'object' ? game.state : null;
        const idle = !online.posting && !online.queued;

        if (remoteState && (force || (idle && version > online.version))) {
            applyRemoteState(remoteState, version);
        } else if (force && !remoteState && online.playing && version === 0) {
            // The first deal never reached the server: drop it so the host can deal again.
            resetTable();
            online.playing = false;
            online.lastKey = '';
        }

        if (game.status === 'active' && version === 0 && !remoteState && !online.playing && online.isHost && online.deals < 2) {
            dealOnlineGame(game);
        }

        if (isClosedStatus(game.status)) {
            stopPolling();
            rememberOnlineGame('');

            if (game.status === 'abandoned') {
                showOnlineNotice('This online game was abandoned.');
            }
        }

        render();
    };

    // A non-host human takes over the bot seats once the bot turn has stalled for 20 seconds.
    const checkBotTakeover = () => {
        if (!isOnline() || online.isHost || online.botDriver || !state.active || !isBot(state.current_seat)) {
            return;
        }

        if (online.posting || online.queued || Date.now() - online.lastAdvanceAt < BOT_TAKEOVER_MS) {
            return;
        }

        online.botDriver = true;
        showOnlineNotice('The host has gone quiet, so this browser is now playing the bot seats.');
        renderLobby();
        resumeOnlineTurn();
    };

    // Throws away local changes and reloads the server's state after a rejected write.
    const resyncOnlineGame = async (error) => {
        const session = online.session;

        cancelPending();
        online.queued = null;
        online.resyncing = true;
        showOnlineNotice(onlineErrorText(error));
        render();

        try {
            const game = await riskApi.getGame(online.gameId);

            if (session !== online.session) {
                return;
            }

            online.resyncing = false;
            online.needsResync = false;
            receiveGame(game, { force: true });
        } catch (fetchError) {
            if (session !== online.session) {
                return;
            }

            online.resyncing = false;
            online.needsResync = true;
            showOnlineNotice(onlineErrorText(fetchError), 'connection');
            render();
        }
    };

    // One post in flight at a time; later snapshots replace any queued one and go out next.
    const flushOnlinePost = async () => {
        if (online.posting || !online.queued || !online.gameId || online.resyncing) {
            return;
        }

        const job = online.queued;
        const session = online.session;
        /** @type {{expected_version: number, state: any, finished?: boolean, winner_seat?: number}} */
        const payload = { expected_version: online.version, state: job.state };

        if (job.finished) {
            payload.finished = true;

            if (Number.isInteger(job.winner)) {
                payload.winner_seat = job.winner;
            }
        }

        online.queued = null;
        online.posting = true;

        try {
            const game = await riskApi.postState(online.gameId, payload);

            if (session !== online.session) {
                return;
            }

            online.posting = false;
            online.version = Number.isInteger(game?.state_version) ? game.state_version : online.version + 1;
            online.lastAdvanceAt = Date.now();

            if (game && typeof game === 'object') {
                online.game = { ...online.game, ...game, state: null };
            }

            clearConnectionNotice();

            if (isClosedStatus(game?.status) && !online.queued) {
                stopPolling();
                rememberOnlineGame('');
            }

            renderLobby();
            flushOnlinePost();
        } catch (error) {
            if (session !== online.session) {
                return;
            }

            online.posting = false;

            if (error && error.status === 0) {
                // Unreachable server: keep the newest snapshot and retry on the next poll tick.
                online.queued = online.queued || job;
                showOnlineNotice(onlineErrorText(error), 'connection');
                renderLobby();
                return;
            }

            resyncOnlineGame(error);
        }
    };

    // Called after every render: a changed shared state means this browser (the writer) committed a move.
    const syncOnlineState = () => {
        if (!isOnline() || !online.gameId || online.resyncing || state.busy || state.phase === 'idle') {
            return;
        }

        const snapshot = serializableState();
        const key = JSON.stringify(snapshot);

        if (key === online.lastKey) {
            return;
        }

        online.lastKey = key;
        online.queued = {
            state: snapshot,
            finished: state.phase === 'gameover',
            winner: state.winner
        };
        flushOnlinePost();
    };

    const pollOnlineGame = async () => {
        if (!online.gameId || online.polling || online.resyncing) {
            return;
        }

        if (online.queued && !online.posting) {
            flushOnlinePost();
        }

        const session = online.session;
        const force = online.needsResync;

        online.polling = true;

        try {
            const game = await riskApi.getGame(online.gameId, { sinceVersion: force ? undefined : online.version });

            if (session !== online.session) {
                return;
            }

            online.polling = false;
            online.needsResync = false;
            receiveGame(game, { force });
            checkBotTakeover();
        } catch (error) {
            if (session !== online.session) {
                return;
            }

            online.polling = false;

            if (error && (error.status === 404 || error.status === 403)) {
                const wasPlaying = isOnline();

                leaveOnlineGame();

                if (wasPlaying) {
                    resetTable();
                }

                showOnlineNotice(onlineErrorText(error));
                render();
                return;
            }

            showOnlineNotice(onlineErrorText(error), 'connection');
            renderLobby();
        }
    };

    // Keeps the absolute invite URL in memory and, for a known game, in storage for later reloads.
    const setInviteUrl = (url, gameId = online.gameId) => {
        online.inviteUrl = typeof url === 'string' && url !== ''
            ? new URL(url, window.location.origin).href
            : '';

        if (online.inviteUrl !== '') {
            rememberInviteUrl(gameId, online.inviteUrl);
        }
    };

    // Asks the server for an invite link; only used when this browser has none stored for the lobby.
    const requestInviteLink = async () => {
        if (!online.gameId || online.inviteRequesting) {
            return;
        }

        const session = online.session;

        online.inviteRequesting = true;
        online.inviteFailed = false;
        renderLobby();

        try {
            const link = await riskApi.createInviteLink(online.gameId);

            if (session !== online.session) {
                return;
            }

            online.inviteRequesting = false;
            setInviteUrl(link?.url);
            online.inviteFailed = online.inviteUrl === '';

            if (online.inviteFailed) {
                showOnlineNotice('The invite link could not be created. Press Try again to get it.', 'invite');
            } else if (online.noticeKind === 'invite') {
                showOnlineNotice('');
            }
        } catch (error) {
            if (session !== online.session) {
                return;
            }

            online.inviteRequesting = false;
            online.inviteFailed = true;
            showOnlineNotice(`${onlineErrorText(error)} Press Try again to get the invite link.`, 'invite');
        }

        renderLobby();
    };

    // Opens a lobby or game returned by create, claim or resume, and starts polling it.
    const enterOnlineGame = (game) => {
        if (!game || typeof game.id !== 'string' || game.id === '') {
            showOnlineNotice('The online game could not be opened.');
            render();
            return;
        }

        online.gameId = game.id;
        online.version = 0;
        rememberOnlineGame(game.id);
        setPageGameParam(game.id);

        // A host resuming a waiting lobby reuses its stored link instead of minting another one.
        if (game.status === 'waiting' && game.viewer_is_host && online.inviteUrl === '') {
            online.inviteUrl = rememberedInviteUrl(game.id);
        }

        receiveGame(game, { force: true });

        if (!online.gameId) {
            return;
        }

        if (game.status === 'waiting' && game.viewer_is_host && online.inviteUrl === '') {
            requestInviteLink();
        }

        if (!isClosedStatus(game.status)) {
            startPolling();
        }
    };

    // Invite players: abandon any current game and open a lobby with one seat per selected opponent.
    const createOnlineGame = async () => {
        if (online.requesting) {
            return;
        }

        leaveOnlineGame();
        resetTable();

        const session = online.session;

        online.requesting = true;
        showOnlineNotice('Creating an online game…');
        render();

        try {
            const game = await riskApi.createGame({ opponent_count: Number(opponentSelect.value) });

            if (session !== online.session) {
                return;
            }

            online.requesting = false;
            showOnlineNotice('');
            setInviteUrl(game?.invite_link?.url, typeof game?.id === 'string' ? game.id : null);
            enterOnlineGame(game);

            if (canFocus(elements.inviteCopyButton)) {
                elements.inviteCopyButton.focus();
            }
        } catch (error) {
            if (session !== online.session) {
                return;
            }

            online.requesting = false;
            showOnlineNotice(onlineErrorText(error));
            render();
        }
    };

    const startOnlineGame = async () => {
        if (!online.gameId || !online.isHost || online.requesting) {
            return;
        }

        const session = online.session;

        online.requesting = true;
        showOnlineNotice('Starting the game…');
        renderLobby();

        try {
            const game = await riskApi.startGame(online.gameId);

            if (session !== online.session) {
                return;
            }

            online.requesting = false;
            showOnlineNotice('');
            receiveGame(game);
        } catch (error) {
            if (session !== online.session) {
                return;
            }

            online.requesting = false;
            showOnlineNotice(onlineErrorText(error));
            renderLobby();
        }
    };

    const copyInviteLink = async () => {
        const input = asInput(elements.inviteUrl);

        if (!input.value) {
            return;
        }

        try {
            await navigator.clipboard.writeText(input.value);
            showOnlineNotice('Invite link copied. Send it to your friends: each friend who opens it takes the next open seat.');
        } catch {
            input.focus();
            input.select();
            showOnlineNotice('Copying is blocked here. The link is selected: press Ctrl+C (or ⌘C) to copy it.');
        }

        renderLobby();
    };

    // On load: claim a ?join= token, or resume ?game=<id> or the remembered game.
    const initOnline = async () => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('join') || '';
        const linkedGame = params.get('game') || '';
        const requested = linkedGame || rememberedOnlineGame();
        const session = online.session;

        if (token) {
            // The token leaves the address bar before it is used.
            setPageGameParam(linkedGame);
            online.requesting = true;
            showOnlineNotice('Joining the online game…');
            render();

            try {
                const game = await riskApi.claimLink(token);

                if (session !== online.session) {
                    return;
                }

                online.requesting = false;
                showOnlineNotice('');
                enterOnlineGame(game);
            } catch (error) {
                if (session !== online.session) {
                    return;
                }

                online.requesting = false;
                showOnlineNotice(onlineErrorText(error));
                render();
            }

            return;
        }

        if (!requested) {
            return;
        }

        online.requesting = true;
        showOnlineNotice('Reconnecting to your online game…');
        render();

        try {
            const game = await riskApi.getGame(requested);

            if (session !== online.session) {
                return;
            }

            online.requesting = false;
            showOnlineNotice('');
            enterOnlineGame(game);
        } catch (error) {
            if (session !== online.session) {
                return;
            }

            online.requesting = false;

            if (error && (error.status === 404 || error.status === 403)) {
                rememberOnlineGame('');

                if (linkedGame) {
                    setPageGameParam('');
                }
            }

            // A stale remembered game is dropped quietly; an explicit link explains what went wrong.
            showOnlineNotice(linkedGame || error?.status === 0 ? onlineErrorText(error) : '');
            render();
        }
    };

    const lobbyStatusText = () => {
        if (online.notice) {
            return online.notice;
        }

        const game = online.game;

        if (!game) {
            return '';
        }

        const viewer = playerAtSeat(game.viewer_seat);
        const seatText = viewer ? `You are seat ${viewer.seat} (${viewer.display_name}).` : '';
        const players = Array.isArray(game.players) ? game.players : [];

        if (game.status === 'waiting') {
            const host = players.find((player) => player.is_host);
            const taken = players.length;

            return online.isHost
                ? `${taken} of ${game.seat_count} seats taken. Press Start game when everyone is in; open seats become bots.`
                : `${seatText} Waiting for ${host ? host.display_name : 'the host'} to press Start game.`;
        }

        if (game.status === 'active') {
            if (!online.playing) {
                return online.isHost ? 'Dealing the world…' : 'The host is dealing the world…';
            }

            return `Online game in progress. ${seatText}${online.botDriver ? ' This browser is playing the bot seats.' : ''}`;
        }

        if (game.status === 'finished') {
            const winner = playerAtSeat(game.winner_seat);

            return winner ? `Game over. ${winner.display_name} won.` : 'Game over.';
        }

        return 'This online game is closed.';
    };

    // Seats 1..seat_count: claimed seats show their player, open ones are filled by bots at the start.
    const renderLobbyRoster = (game) => {
        const players = Array.isArray(game?.players) ? game.players : [];
        const seatCount = Number.isInteger(game?.seat_count) ? game.seat_count : players.length;
        const status = game?.status || '';
        const key = JSON.stringify([seatCount, status, players.map((player) => [
            player.seat,
            player.kind,
            player.display_name,
            player.is_host,
            player.is_viewer
        ])]);

        if (key === online.lobbyKey) {
            return;
        }

        online.lobbyKey = key;

        const items = [];

        for (let seat = 1; seat <= seatCount; seat += 1) {
            const player = players.find((entry) => entry.seat === seat);
            const item = document.createElement('li');

            item.className = `risk-lobby-seat owner-${ownerKey(seat)}`;
            item.append(createGlyph(seat, 'risk-owner-glyph'));

            if (!player) {
                item.classList.add('is-open');
                item.append(
                    createText('span', 'risk-lobby-seat-name', `Seat ${seat}: open`),
                    createText('span', 'risk-lobby-tag', status === 'waiting' ? 'Bot if still empty' : 'Open')
                );
            } else {
                item.append(createText('span', 'risk-lobby-seat-name', `Seat ${seat}: ${player.display_name}`));
                item.append(createText('span', 'risk-lobby-tag', player.kind === 'bot' ? 'Bot' : 'Player'));

                if (player.is_host) {
                    item.append(createText('span', 'risk-lobby-tag', 'Host'));
                }

                if (player.is_viewer) {
                    item.classList.add('is-viewer');
                    item.append(createText('span', 'risk-lobby-tag', 'You'));
                }
            }

            items.push(item);
        }

        elements.lobbyRoster.replaceChildren(...items);
    };

    const renderLobby = () => {
        const game = online.game;
        const visible = Boolean(online.gameId) || online.notice !== '';

        elements.lobbyPanel.hidden = !visible;
        asButton(elements.inviteButton).disabled = online.requesting;

        if (!visible) {
            online.lobbyKey = '';
            return;
        }

        const status = game?.status || '';
        const waiting = status === 'waiting';
        const urlInput = asInput(elements.inviteUrl);
        const startButton = asButton(elements.lobbyStartButton);

        setText(elements.lobbyTitle, waiting
            ? 'Online lobby'
            : status === 'finished' ? 'Online game over' : 'Online game');
        setText(elements.lobbyStatus, lobbyStatusText());

        elements.lobbyInvite.hidden = !(waiting && online.isHost && online.inviteUrl !== '');

        if (urlInput.value !== online.inviteUrl) {
            urlInput.value = online.inviteUrl;
        }

        if (inviteRetryButton) {
            const retryButton = asButton(inviteRetryButton);

            retryButton.hidden = !(waiting && online.isHost && online.inviteUrl === '' && (online.inviteFailed || online.inviteRequesting));
            retryButton.disabled = online.inviteRequesting;
            setText(retryButton, online.inviteRequesting ? 'Getting invite link…' : 'Try again');
        }

        // Link-sharing steps are for the host; a joiner only needs to know what happens next.
        setText(elements.lobbyNote, online.isHost
            ? 'Copy the invite link and send it to your friends: each friend who opens it takes the next open seat. When you press Start game, open seats become bots.'
            : 'You have a seat. When the host presses Start game, open seats become bots and the game begins.');
        elements.lobbyNote.hidden = !waiting;
        startButton.hidden = !(waiting && online.isHost);
        startButton.disabled = online.requesting;
        setText(elements.lobbyLeaveButton, !online.gameId
            ? 'Close'
            : waiting ? 'Leave lobby' : 'Leave online game');
        renderLobbyRoster(game);
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

    root.addEventListener('click', (event) => {
        const target = /** @type {Element|null} */ (event.target);

        if (runtime.phaseAdvanceConfirmation && !target?.closest('#risk-end-button')) {
            cancelPhaseAdvanceConfirmation();
        }
    }, true);
    root.addEventListener('change', () => {
        if (runtime.phaseAdvanceConfirmation) {
            cancelPhaseAdvanceConfirmation();
        }
    }, true);

    // Local game: seat 1 is the human at this browser, every other seat is a bot. Starting one leaves
    // any online lobby or game, stops polling and forgets the remembered online game.
    elements.startButton.addEventListener('click', () => {
        leaveOnlineGame();
        runtime.localSeat = 1;
        startGame(localRoster(readSetupConfig().botCount));
    });
    elements.inviteButton.addEventListener('click', () => {
        createOnlineGame();
    });
    elements.inviteCopyButton.addEventListener('click', () => {
        copyInviteLink();
    });
    inviteRetryButton?.addEventListener('click', () => {
        requestInviteLink();
    });
    elements.inviteUrl.addEventListener('focus', () => {
        asInput(elements.inviteUrl).select();
    });
    elements.lobbyStartButton.addEventListener('click', () => {
        startOnlineGame();
    });
    elements.lobbyLeaveButton.addEventListener('click', () => {
        const wasPlaying = isOnline();

        leaveOnlineGame();

        if (wasPlaying) {
            resetTable();
        }

        render();
        elements.inviteButton.focus();
    });
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
    opponentSelect.addEventListener('change', () => {
        // Before the first game, the scoreboard previews the seats the next game will have.
        if (state.phase === 'idle') {
            state.config = readSetupConfig();
            Object.assign(state, createSeatState(localRoster(state.config.botCount)));
            render();
        }
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
    // Setup choices only describe the next game; the notes say so as soon as a choice changes.
    [opponentSelect, ...placementInputs, ...cardModeInputs].forEach((input) => {
        input.addEventListener('change', renderSetupInfo);
    });

    // The scroll hint appears only while the board is wider than its frame.
    const updateMapHint = () => {
        const hint = uxElements.mapHint;

        if (!hint) {
            return;
        }

        const scrollable = elements.map.scrollWidth - elements.map.clientWidth > 2;

        hint.hidden = !scrollable;
        elements.map.classList.toggle('is-scrollable', scrollable);
    };

    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(updateMapHint).observe(elements.map);
    } else {
        window.addEventListener('resize', updateMapHint);
    }

    window.requestAnimationFrame(updateMapHint);

    state.territories = blankTerritories();

    render();
    // Online play only touches the network when the page was opened with ?join= or ?game=, or a game is remembered.
    initOnline();
})();

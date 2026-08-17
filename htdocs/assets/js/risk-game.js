(() => {
    'use strict';

    const root = document.querySelector('[data-risk-game]');

    if (!root) {
        return;
    }

    const mapAsset = '/assets/img/risk-map.svg';
    const emblemAsset = '/assets/img/risk-emblems.svg';
    const svgNamespace = 'http://www.w3.org/2000/svg';

    const territoryDefinitions = [
        { id: 'northreach', name: 'North Reach', region: 'Frost Belt', neighbors: ['westwatch', 'ironpass', 'stormbay'], position: [36, 14], emblem: 'mountain' },
        { id: 'westwatch', name: 'Westwatch', region: 'Frost Belt', neighbors: ['northreach', 'ironpass', 'greenvale'], position: [18, 28], emblem: 'fortress' },
        { id: 'ironpass', name: 'Iron Pass', region: 'Highlands', neighbors: ['northreach', 'westwatch', 'stormbay', 'greenvale', 'dustplain'], position: [39, 33], emblem: 'mountain' },
        { id: 'stormbay', name: 'Storm Bay', region: 'Highlands', neighbors: ['northreach', 'ironpass', 'embercoast'], position: [63, 24], emblem: 'harbor' },
        { id: 'greenvale', name: 'Greenvale', region: 'Heartland', neighbors: ['westwatch', 'ironpass', 'dustplain', 'sunfield'], position: [23, 49], emblem: 'field' },
        { id: 'dustplain', name: 'Dustplain', region: 'Heartland', neighbors: ['ironpass', 'greenvale', 'embercoast', 'sunfield', 'obsidian'], position: [49, 50], emblem: 'field' },
        { id: 'embercoast', name: 'Ember Coast', region: 'Coast', neighbors: ['stormbay', 'dustplain', 'obsidian'], position: [75, 47], emblem: 'harbor' },
        { id: 'sunfield', name: 'Sunfield', region: 'Southlands', neighbors: ['greenvale', 'dustplain', 'lowlands'], position: [30, 69], emblem: 'field' },
        { id: 'obsidian', name: 'Obsidian Gate', region: 'Southlands', neighbors: ['dustplain', 'embercoast', 'lowlands', 'citadel'], position: [59, 69], emblem: 'fortress' },
        { id: 'lowlands', name: 'Lowlands', region: 'Riverlands', neighbors: ['sunfield', 'obsidian', 'harbor', 'citadel'], position: [46, 84], emblem: 'field' },
        { id: 'harbor', name: 'Free Harbor', region: 'Riverlands', neighbors: ['lowlands', 'citadel'], position: [13, 88], emblem: 'harbor' },
        { id: 'citadel', name: 'Last Citadel', region: 'Riverlands', neighbors: ['obsidian', 'lowlands', 'harbor'], position: [69, 86], emblem: 'fortress' }
    ];

    const elements = {
        map: document.getElementById('risk-map'),
        status: document.getElementById('risk-status-message'),
        turn: document.getElementById('risk-turn-value'),
        phase: document.getElementById('risk-phase-value'),
        reinforcements: document.getElementById('risk-reinforcements-value'),
        humanCount: document.getElementById('risk-human-count'),
        aiCount: document.getElementById('risk-ai-count'),
        selection: document.getElementById('risk-territory-card'),
        log: document.getElementById('risk-log'),
        startButton: document.getElementById('risk-start-button'),
        reinforceButton: document.getElementById('risk-reinforce-button'),
        attackButton: document.getElementById('risk-attack-button'),
        fortifyButton: document.getElementById('risk-fortify-button'),
        endButton: document.getElementById('risk-end-button')
    };

    if (Object.values(elements).some((element) => !element)) {
        return;
    }

    const ownerLabels = {
        human: 'Player',
        ai: 'Browser',
        neutral: 'Unclaimed'
    };

    const phaseLabels = {
        setup: 'Ready',
        reinforce: 'Reinforce',
        attack: 'Attack',
        fortify: 'Fortify',
        gameover: 'Game over'
    };

    const state = {
        active: false,
        territories: [],
        current: 'human',
        phase: 'setup',
        turn: 0,
        reinforcementRemaining: 0,
        sourceId: null,
        targetId: null,
        message: 'Start a new game to deploy armies.',
        log: [],
        aiTimer: null
    };

    const byId = (id) => state.territories.find((territory) => territory.id === id) || null;
    const opponentOf = (player) => player === 'human' ? 'ai' : 'human';
    const ownedBy = (player) => state.territories.filter((territory) => territory.owner === player);
    const isNeighbor = (territory, neighborId) => territory?.neighbors.includes(neighborId) || false;
    const ownerLabel = (owner) => ownerLabels[owner] || 'Unknown';
    const pluralArmy = (count) => `${count} arm${count === 1 ? 'y' : 'ies'}`;

    const addLog = (message) => {
        state.log.unshift(message);
        state.log = state.log.slice(0, 12);
    };

    const calculateReinforcements = (player) => Math.max(3, Math.floor(ownedBy(player).length / 3));

    const rollDie = () => Math.floor(Math.random() * 6) + 1;

    const bestRoll = (diceCount) => {
        const rolls = Array.from({ length: Math.max(1, diceCount) }, rollDie);
        return Math.max(...rolls);
    };

    const borderTerritories = (player) => ownedBy(player).filter((territory) => (
        territory.neighbors.some((neighborId) => {
            const neighbor = byId(neighborId);
            return neighbor && neighbor.owner !== player;
        })
    ));

    const weakestBorderTerritory = (player) => {
        const borders = borderTerritories(player);
        const candidates = borders.length > 0 ? borders : ownedBy(player);

        return candidates.reduce((weakest, territory) => {
            if (!weakest || territory.armies < weakest.armies) {
                return territory;
            }

            return weakest;
        }, null);
    };

    const adjacentEnemies = (source, player) => source.neighbors
        .map(byId)
        .filter((territory) => territory && territory.owner === opponentOf(player));

    const hasLegalAttack = (player) => ownedBy(player).some((territory) => (
        territory.armies > 1 && adjacentEnemies(territory, player).length > 0
    ));

    const createText = (tagName, className, text) => {
        const node = document.createElement(tagName);
        if (className) {
            node.className = className;
        }
        node.textContent = text;
        return node;
    };

    const createEmblem = (territory) => {
        const svg = document.createElementNS(svgNamespace, 'svg');
        const use = document.createElementNS(svgNamespace, 'use');

        svg.classList.add('risk-territory-emblem');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('viewBox', '0 0 32 32');
        use.setAttribute('href', `${emblemAsset}#emblem-${territory.emblem}`);
        svg.append(use);

        return svg;
    };

    const clearAiTimer = () => {
        if (state.aiTimer) {
            window.clearTimeout(state.aiTimer);
            state.aiTimer = null;
        }
    };

    const selectDefaultTerritory = (player) => {
        state.sourceId = weakestBorderTerritory(player)?.id || ownedBy(player)[0]?.id || null;
        state.targetId = null;
    };

    const startGame = () => {
        clearAiTimer();
        state.active = true;
        state.territories = territoryDefinitions.map((territory, index) => ({
            ...territory,
            owner: index % 2 === 0 ? 'human' : 'ai',
            armies: index % 3 === 0 ? 3 : 2
        }));
        state.current = 'human';
        state.phase = 'reinforce';
        state.turn = 1;
        state.reinforcementRemaining = calculateReinforcements('human');
        state.message = 'Deploy reinforcements to your territories, then attack adjacent browser territory.';
        state.log = [];
        selectDefaultTerritory('human');
        addLog('New game started. Player takes the first reinforcement phase.');
        render();
    };

    const selectTerritory = (territoryId) => {
        const territory = byId(territoryId);

        if (!territory) {
            return;
        }

        if (!state.active) {
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = 'Start a new game before issuing orders.';
            render();
            return;
        }

        if (state.current !== 'human') {
            state.message = 'The browser is taking its turn.';
            render();
            return;
        }

        if (state.phase === 'gameover') {
            render();
            return;
        }

        if (state.phase === 'reinforce') {
            if (territory.owner !== 'human') {
                state.message = 'Reinforcements can only be placed on your territory.';
            } else {
                state.sourceId = territory.id;
                state.targetId = null;
                state.message = `${territory.name} selected. Use Reinforce to add one army.`;
            }
            render();
            return;
        }

        if (state.phase === 'attack') {
            handleAttackSelection(territory);
            render();
            return;
        }

        if (state.phase === 'fortify') {
            handleFortifySelection(territory);
            render();
        }
    };

    const handleAttackSelection = (territory) => {
        const source = byId(state.sourceId);

        if (territory.owner === 'human') {
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = territory.armies > 1
                ? `${territory.name} is ready to attack. Pick an adjacent browser territory.`
                : `${territory.name} needs more than one army to attack.`;
            return;
        }

        if (!source || source.owner !== 'human' || source.armies <= 1) {
            state.message = 'Select one of your territories with at least two armies before choosing a target.';
            state.targetId = null;
            return;
        }

        if (territory.owner !== 'ai') {
            state.message = 'Only browser territories can be attacked.';
            state.targetId = null;
            return;
        }

        if (!isNeighbor(source, territory.id)) {
            state.message = `${territory.name} is not adjacent to ${source.name}.`;
            state.targetId = null;
            return;
        }

        state.targetId = territory.id;
        state.message = `${source.name} will attack ${territory.name}.`;
    };

    const handleFortifySelection = (territory) => {
        const source = byId(state.sourceId);

        if (territory.owner !== 'human') {
            state.message = 'Fortify by moving between adjacent territories you own.';
            return;
        }

        if (!source || source.owner !== 'human' || territory.id === source.id) {
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = territory.armies > 1
                ? `${territory.name} selected. Pick an adjacent territory you own.`
                : `${territory.name} needs more than one army to send a fortification.`;
            return;
        }

        if (!isNeighbor(source, territory.id)) {
            state.sourceId = territory.id;
            state.targetId = null;
            state.message = `${territory.name} selected. Fortification targets must be adjacent.`;
            return;
        }

        state.targetId = territory.id;
        state.message = `${source.name} will fortify ${territory.name}.`;
    };

    const reinforce = () => {
        const source = byId(state.sourceId);

        if (!state.active || state.current !== 'human' || state.phase !== 'reinforce') {
            return;
        }

        if (!source || source.owner !== 'human') {
            state.message = 'Select one of your territories to receive reinforcements.';
            render();
            return;
        }

        source.armies += 1;
        state.reinforcementRemaining -= 1;
        addLog(`Player reinforces ${source.name}.`);

        if (state.reinforcementRemaining <= 0) {
            state.phase = 'attack';
            state.reinforcementRemaining = 0;
            state.message = hasLegalAttack('human')
                ? 'Reinforcement complete. Select an attacking territory, then an adjacent target.'
                : 'Reinforcement complete. You have no legal attacks, so end the turn or fortify.';
        } else {
            state.message = `${state.reinforcementRemaining} reinforcement${state.reinforcementRemaining === 1 ? '' : 's'} remaining.`;
        }

        render();
    };

    const attack = () => {
        const source = byId(state.sourceId);
        const target = byId(state.targetId);

        if (!state.active || state.current !== 'human' || state.phase !== 'attack') {
            return;
        }

        if (!source || source.owner !== 'human' || source.armies <= 1) {
            state.message = 'Select one of your territories with at least two armies.';
            render();
            return;
        }

        if (!target || target.owner !== 'ai' || !isNeighbor(source, target.id)) {
            state.message = 'Select an adjacent browser territory to attack.';
            render();
            return;
        }

        resolveBattle('human', source, target);

        if (source.armies <= 1 || target.owner === 'human') {
            state.targetId = null;
        }

        if (!checkVictory()) {
            render();
        }
    };

    const fortify = () => {
        if (!state.active || state.current !== 'human') {
            return;
        }

        if (state.phase === 'attack') {
            state.phase = 'fortify';
            state.targetId = null;
            state.message = 'Fortify phase. Select a territory with spare armies, then an adjacent territory you own.';
            render();
            return;
        }

        const source = byId(state.sourceId);
        const target = byId(state.targetId);

        if (state.phase !== 'fortify') {
            return;
        }

        if (!source || source.owner !== 'human' || source.armies <= 1) {
            state.message = 'Select one of your territories with at least two armies.';
            render();
            return;
        }

        if (!target || target.owner !== 'human' || !isNeighbor(source, target.id)) {
            state.message = 'Select an adjacent territory you own as the fortification target.';
            render();
            return;
        }

        source.armies -= 1;
        target.armies += 1;
        addLog(`Player moves one army from ${source.name} to ${target.name}.`);
        state.message = `${target.name} fortified. Browser turn begins.`;
        endHumanTurn();
    };

    const endHumanTurn = () => {
        if (!state.active || state.current !== 'human' || state.phase === 'gameover') {
            return;
        }

        if (state.phase === 'reinforce') {
            state.message = 'Place all reinforcements before ending the turn.';
            render();
            return;
        }

        state.current = 'ai';
        state.phase = 'reinforce';
        state.reinforcementRemaining = 0;
        state.sourceId = null;
        state.targetId = null;
        state.message = 'Browser is taking its turn.';
        render();
        clearAiTimer();
        state.aiTimer = window.setTimeout(runAiTurn, 550);
    };

    const resolveBattle = (player, source, target) => {
        const attackerDice = Math.min(3, source.armies - 1);
        const defenderDice = Math.min(2, target.armies);
        const attackRoll = bestRoll(attackerDice);
        const defendRoll = bestRoll(defenderDice);
        const attackerName = ownerLabel(player);

        if (attackRoll > defendRoll) {
            target.armies -= 1;

            if (target.armies <= 0) {
                target.owner = player;
                target.armies = 1;
                source.armies = Math.max(1, source.armies - 1);
                state.message = `${attackerName} conquers ${target.name} from ${source.name}.`;
                addLog(`${attackerName} rolls ${attackRoll} over ${defendRoll} and takes ${target.name}.`);
                return;
            }

            state.message = `${attackerName} wins the roll at ${target.name}.`;
            addLog(`${attackerName} rolls ${attackRoll} over ${defendRoll}; ${target.name} loses one army.`);
            return;
        }

        source.armies = Math.max(1, source.armies - 1);
        state.message = `${attackerName} loses one army attacking ${target.name}.`;
        addLog(`${attackerName} rolls ${attackRoll} against ${defendRoll}; ${source.name} loses one army.`);
    };

    const checkVictory = () => {
        const humanCount = ownedBy('human').length;
        const aiCount = ownedBy('ai').length;

        if (humanCount > 0 && aiCount > 0) {
            return false;
        }

        clearAiTimer();
        state.active = false;
        state.phase = 'gameover';
        state.reinforcementRemaining = 0;
        state.sourceId = null;
        state.targetId = null;
        state.message = humanCount > 0
            ? 'Player controls every territory. Victory.'
            : 'Browser controls every territory. Start a new game for a rematch.';
        addLog(state.message);
        render();
        return true;
    };

    const findAiAttack = () => {
        const candidates = ownedBy('ai')
            .filter((territory) => territory.armies > 1)
            .map((territory) => ({
                source: territory,
                targets: adjacentEnemies(territory, 'ai')
            }))
            .filter((move) => move.targets.length > 0);

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => b.source.armies - a.source.armies || a.targets.length - b.targets.length);
        const move = candidates[0];
        move.targets.sort((a, b) => a.armies - b.armies);

        return {
            source: move.source,
            target: move.targets[0]
        };
    };

    const runAiTurn = () => {
        state.aiTimer = null;

        if (!state.active || state.phase === 'gameover' || state.current !== 'ai') {
            return;
        }

        const reinforcements = calculateReinforcements('ai');

        for (let index = 0; index < reinforcements; index += 1) {
            const target = weakestBorderTerritory('ai');
            if (target) {
                target.armies += 1;
            }
        }

        addLog(`Browser deploys ${reinforcements} reinforcement${reinforcements === 1 ? '' : 's'}.`);
        state.phase = 'attack';

        let attackCount = 0;
        while (attackCount < 4) {
            const move = findAiAttack();

            if (!move) {
                break;
            }

            resolveBattle('ai', move.source, move.target);
            attackCount += 1;

            if (checkVictory()) {
                return;
            }

            if (!hasLegalAttack('ai') || Math.random() < 0.35) {
                break;
            }
        }

        if (attackCount === 0) {
            addLog('Browser has no legal attacks and yields the turn.');
        } else {
            addLog(`Browser ends its attack phase after ${attackCount} attack${attackCount === 1 ? '' : 's'}.`);
        }

        state.current = 'human';
        state.turn += 1;
        state.phase = 'reinforce';
        state.reinforcementRemaining = calculateReinforcements('human');
        selectDefaultTerritory('human');
        state.message = `Your turn. Place ${state.reinforcementRemaining} reinforcement${state.reinforcementRemaining === 1 ? '' : 's'}.`;
        addLog('Player turn begins.');
        render();
    };

    const territoryStateClass = (territory) => {
        const isSelected = territory.id === state.sourceId;
        const isTargeted = territory.id === state.targetId;
        const source = byId(state.sourceId);
        const isAttackTarget = state.phase === 'attack'
            && source
            && source.owner === 'human'
            && source.armies > 1
            && territory.owner === 'ai'
            && isNeighbor(source, territory.id);
        const isFortifyTarget = state.phase === 'fortify'
            && source
            && source.owner === 'human'
            && source.armies > 1
            && territory.owner === 'human'
            && territory.id !== source.id
            && isNeighbor(source, territory.id);

        return [
            'risk-territory',
            `owner-${territory.owner}`,
            isSelected ? 'is-selected' : '',
            isTargeted ? 'is-targeted' : '',
            isAttackTarget || isFortifyTarget ? 'is-actionable' : '',
            state.current === 'ai' ? 'is-disabled' : ''
        ].filter(Boolean).join(' ');
    };

    const renderTerritory = (territory) => {
        const button = document.createElement('button');
        const label = document.createElement('span');
        const name = createText('span', 'risk-territory-name', territory.name);
        const meta = createText('span', 'risk-territory-meta', territory.region);
        const armies = createText('span', 'risk-territory-armies', String(territory.armies));

        label.className = 'risk-territory-label';
        label.append(name, meta);

        button.type = 'button';
        button.className = territoryStateClass(territory);
        button.dataset.territory = territory.id;
        button.style.setProperty('--x', `${territory.position[0]}%`);
        button.style.setProperty('--y', `${territory.position[1]}%`);
        button.setAttribute('aria-pressed', territory.id === state.sourceId || territory.id === state.targetId ? 'true' : 'false');
        button.setAttribute('aria-label', `${territory.name}, ${ownerLabel(territory.owner)}, ${pluralArmy(territory.armies)}, ${territory.region}`);
        button.disabled = state.current === 'ai';
        button.addEventListener('click', () => selectTerritory(territory.id));

        button.append(createEmblem(territory), label, armies);

        return button;
    };

    const renderMap = () => {
        const mapImage = document.createElement('img');
        const layer = document.createElement('div');

        mapImage.className = 'risk-map-art';
        mapImage.src = mapAsset;
        mapImage.alt = '';
        mapImage.decoding = 'async';
        mapImage.setAttribute('aria-hidden', 'true');

        layer.className = 'risk-territory-layer';
        layer.append(...state.territories.map(renderTerritory));

        elements.map.replaceChildren(mapImage, layer);
    };

    const renderSelection = () => {
        const source = byId(state.sourceId);
        const target = byId(state.targetId);

        if (!source) {
            elements.selection.textContent = state.active ? 'Select a territory on the map.' : 'No territory selected.';
            return;
        }

        const wrapper = document.createElement('div');
        const list = document.createElement('dl');
        const help = document.createElement('p');

        list.className = 'risk-selection-list';

        const rows = [
            ['Territory', source.name],
            ['Owner', ownerLabel(source.owner)],
            ['Armies', pluralArmy(source.armies)],
            ['Neighbors', source.neighbors.map((neighborId) => byId(neighborId)?.name || neighborId).join(', ')]
        ];

        if (target) {
            rows.push(['Target', `${target.name} (${pluralArmy(target.armies)})`]);
        }

        rows.forEach(([term, description]) => {
            const row = document.createElement('div');
            row.append(createText('dt', '', term), createText('dd', '', description));
            list.append(row);
        });

        help.className = 'risk-selection-help';
        help.textContent = selectionHelpText(source, target);
        wrapper.append(list, help);
        elements.selection.replaceChildren(wrapper);
    };

    const selectionHelpText = (source, target) => {
        if (state.phase === 'reinforce') {
            return source.owner === 'human' ? 'Reinforce this territory or select another one you own.' : 'Select one of your territories to reinforce.';
        }

        if (state.phase === 'attack') {
            if (target) {
                return 'Attack is ready.';
            }

            return source.owner === 'human' && source.armies > 1
                ? 'Select an adjacent browser territory as the target.'
                : 'Pick one of your territories with at least two armies.';
        }

        if (state.phase === 'fortify') {
            if (target) {
                return 'Fortification is ready.';
            }

            return source.owner === 'human' && source.armies > 1
                ? 'Select an adjacent territory you own as the target.'
                : 'Pick one of your territories with at least two armies.';
        }

        return state.phase === 'gameover' ? 'Start a new game to play again.' : 'Start a new game to deploy armies.';
    };

    const renderLog = () => {
        if (state.log.length === 0) {
            elements.log.replaceChildren(createText('li', '', 'No battles yet.'));
            return;
        }

        elements.log.replaceChildren(...state.log.map((entry) => createText('li', '', entry)));
    };

    const renderControls = () => {
        const source = byId(state.sourceId);
        const target = byId(state.targetId);
        const isHumanTurn = state.active && state.current === 'human' && state.phase !== 'gameover';
        const canReinforce = isHumanTurn
            && state.phase === 'reinforce'
            && state.reinforcementRemaining > 0
            && source
            && source.owner === 'human';
        const canAttack = isHumanTurn
            && state.phase === 'attack'
            && source
            && source.owner === 'human'
            && source.armies > 1
            && target
            && target.owner === 'ai'
            && isNeighbor(source, target.id);
        const canEnterFortify = isHumanTurn && state.phase === 'attack';
        const canFortify = isHumanTurn
            && state.phase === 'fortify'
            && source
            && target
            && source.owner === 'human'
            && target.owner === 'human'
            && source.armies > 1
            && isNeighbor(source, target.id);

        elements.startButton.textContent = state.active ? 'Restart game' : 'New game';
        elements.reinforceButton.disabled = !canReinforce;
        elements.attackButton.disabled = !canAttack;
        elements.fortifyButton.disabled = !(canEnterFortify || canFortify);
        elements.fortifyButton.textContent = state.phase === 'fortify' ? 'Fortify' : 'Fortify phase';
        elements.endButton.disabled = !isHumanTurn || state.phase === 'reinforce';
    };

    const renderSummary = () => {
        elements.turn.textContent = String(state.turn);
        elements.phase.textContent = state.current === 'ai' && state.phase !== 'gameover'
            ? 'Browser turn'
            : phaseLabels[state.phase] || 'Ready';
        elements.reinforcements.textContent = String(state.reinforcementRemaining);
        elements.humanCount.textContent = String(ownedBy('human').length);
        elements.aiCount.textContent = String(ownedBy('ai').length);
        elements.status.textContent = state.message;
    };

    const render = () => {
        renderSummary();
        renderControls();
        renderMap();
        renderSelection();
        renderLog();
    };

    elements.startButton.addEventListener('click', startGame);
    elements.reinforceButton.addEventListener('click', reinforce);
    elements.attackButton.addEventListener('click', attack);
    elements.fortifyButton.addEventListener('click', fortify);
    elements.endButton.addEventListener('click', endHumanTurn);

    state.territories = territoryDefinitions.map((territory) => ({
        ...territory,
        owner: 'neutral',
        armies: 0
    }));

    render();
})();

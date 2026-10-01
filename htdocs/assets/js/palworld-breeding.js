(function () {
    'use strict';

    const form = document.getElementById('palworld-form');
    if (!form) return;

    const controls = document.getElementById('palworld-controls');
    const loadStatus = document.getElementById('palworld-load-status');
    const routeStatus = document.getElementById('palworld-route-status');
    const summary = document.getElementById('palworld-route-summary');
    const tree = document.getElementById('palworld-route-tree');
    const routeHelp = document.getElementById('palworld-route-help');
    const results = document.querySelector('.palworld-results');
    const sourceList = document.getElementById('palworld-sources');
    const addSourceButton = document.getElementById('palworld-add-source');
    const submitButton = document.getElementById('palworld-find-route');
    const excludedList = document.getElementById('palworld-excluded-list');
    const traitInputs = Array.from(document.querySelectorAll('.palworld-trait-fields select'));
    const sources = [];
    const excluded = new Set();
    const eggFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    let dataset;
    let manifest;
    let spriteImage;
    let targetPicker;
    let nextSourceId = 0;
    let routeGeneration = 0;
    let attempted = false;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(text, handler, className) {
        const node = element('button', className, text);
        node.type = 'button';
        node.addEventListener('click', handler);
        return node;
    }

    function palFor(key) {
        return dataset.pals[dataset.indexByKey[key]];
    }

    function thumbnail(key) {
        const node = element('span', 'palworld-thumbnail');
        node.setAttribute('aria-hidden', 'true');
        const sprite = manifest.sprites[key];
        if (!sprite || !Number.isInteger(sprite.index) || sprite.index < 0 || sprite.index >= manifest.columns * manifest.rows) {
            node.classList.add('palworld-thumbnail-missing');
            node.textContent = '?';
            return node;
        }
        const scale = 48 / manifest.cell;
        const column = sprite.index % manifest.columns;
        const row = Math.floor(sprite.index / manifest.columns);
        node.style.backgroundImage = 'url(' + JSON.stringify(spriteImage) + ')';
        node.style.backgroundSize = (manifest.columns * manifest.cell * scale) + 'px ' + (manifest.rows * manifest.cell * scale) + 'px';
        node.style.backgroundPosition = (-column * manifest.cell * scale) + 'px ' + (-row * manifest.cell * scale) + 'px';
        return node;
    }

    function palIdentity(key) {
        const pal = palFor(key);
        const identity = element('span', 'palworld-pal-identity');
        identity.append(thumbnail(key), element('span', '', pal ? pal.name : key));
        return identity;
    }

    function clearRoute() {
        tree.replaceChildren();
        summary.replaceChildren();
        summary.hidden = true;
        routeHelp.hidden = true;
    }

    function invalidate() {
        routeGeneration += 1;
        results.setAttribute('aria-busy', 'false');
        submitButton.disabled = false;
        if (!attempted) return;
        clearRoute();
        routeStatus.textContent = 'Inputs changed. Find a breeding route with your updated plan.';
    }

    // Native buttons keep the searchable picker usable with Tab and Enter.
    // Arrow keys also move between matches without requiring a custom combobox.
    function createPicker(host, id, labelText) {
        const wrapper = element('div', 'palworld-picker');
        const label = element('label', '', labelText);
        label.htmlFor = id;
        const input = element('input');
        input.type = 'search';
        input.id = id;
        input.autocomplete = 'off';
        input.placeholder = 'Search by name or Paldeck number';
        input.setAttribute('aria-controls', id + '-matches');
        const hint = element('p', 'palworld-help', 'Type to filter, then choose a pal. Use Tab or Arrow Down to reach matches.');
        hint.id = id + '-help';
        input.setAttribute('aria-describedby', hint.id);
        const count = element('p', 'palworld-picker-count');
        count.setAttribute('role', 'status');
        const matches = element('ul', 'palworld-picker-matches');
        matches.id = id + '-matches';
        matches.setAttribute('aria-label', labelText + ' matches');
        matches.hidden = true;
        const selected = element('div', 'palworld-picker-selected');
        const picker = { key: '', input: input };
        const entries = dataset.pals.map(function (pal) {
            const item = element('li');
            const choice = button('', function () {
                picker.key = pal.key;
                input.value = pal.name;
                selected.replaceChildren(palIdentity(pal.key));
                input.focus();
                matches.hidden = true;
                count.textContent = pal.name + ' selected.';
                invalidate();
            });
            choice.append(palIdentity(pal.key));
            if (pal.paldexNo !== null) choice.append(element('span', 'palworld-pal-number', '#' + pal.paldexNo));
            item.append(choice);
            matches.append(item);
            return { item: item, choice: choice, search: (pal.name + ' ' + pal.internalName + ' ' + (pal.paldexNo === null ? '' : pal.paldexNo)).toLowerCase() };
        });

        function filter() {
            const query = input.value.trim().toLowerCase();
            let visible = 0;
            entries.forEach(function (entry) {
                entry.item.hidden = !entry.search.includes(query);
                if (!entry.item.hidden) visible += 1;
            });
            matches.hidden = false;
            count.textContent = visible ? visible + ' matching pals.' : 'No matching pals. Try another name.';
        }

        input.addEventListener('focus', filter);
        input.addEventListener('input', function () {
            picker.key = '';
            selected.replaceChildren();
            filter();
        });
        input.addEventListener('keydown', function (event) {
            if (event.key === 'ArrowDown' || (event.key === 'Enter' && !matches.hidden)) {
                event.preventDefault();
                filter();
                const first = entries.find(function (entry) { return !entry.item.hidden; });
                if (first) first.choice.focus();
            } else if (event.key === 'Escape') {
                matches.hidden = true;
            }
        });
        matches.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                input.focus();
                matches.hidden = true;
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const visible = entries.filter(function (entry) { return !entry.item.hidden; });
            const current = visible.findIndex(function (entry) { return entry.choice === document.activeElement; });
            let next = current + (event.key === 'ArrowUp' ? -1 : 1);
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = visible.length - 1;
            if (visible.length) visible[Math.max(0, Math.min(next, visible.length - 1))].choice.focus();
        });
        wrapper.addEventListener('focusout', function (event) {
            if (!wrapper.contains(event.relatedTarget)) matches.hidden = true;
        });
        wrapper.append(label, input, hint, count, matches, selected);
        host.append(wrapper);
        return picker;
    }

    function refreshSourceTraits(source) {
        source.traitChoices.replaceChildren();
        let count = 0;
        traitInputs.forEach(function (input, index) {
            const trait = input.value.trim();
            if (!trait) {
                source.traitSlots.delete(index);
                return;
            }
            count += 1;
            const label = element('label', 'palworld-checkbox');
            const checkbox = element('input');
            checkbox.type = 'checkbox';
            checkbox.checked = source.traitSlots.has(index);
            checkbox.addEventListener('change', function () {
                if (checkbox.checked) source.traitSlots.add(index);
                else source.traitSlots.delete(index);
            });
            label.append(checkbox, element('span', '', trait));
            source.traitChoices.append(label);
        });
        if (!count) source.traitChoices.append(element('p', 'palworld-help', 'Choose your wanted traits from the dropdowns above to mark the ones this pal carries.'));
    }

    function addSource(focus) {
        const number = ++nextSourceId;
        const id = 'palworld-source-' + number;
        const row = element('fieldset', 'palworld-source');
        row.append(element('legend', '', 'Owned pal ' + number));
        const picker = createPicker(row, id + '-species', 'Species for owned pal ' + number);
        const traits = element('fieldset', 'palworld-source-traits');
        traits.append(element('legend', '', 'Wanted traits carried'));
        const traitChoices = element('div', 'palworld-trait-choices');
        traits.append(traitChoices);
        const source = { id: id, row: row, picker: picker, traitChoices: traitChoices, traitSlots: new Set() };
        const remove = button('Remove owned pal ' + number, function () {
            const index = sources.indexOf(source);
            sources.splice(index, 1);
            row.remove();
            invalidate();
            const next = sources[index] || sources[index - 1];
            if (next) next.picker.input.focus();
            else addSourceButton.focus();
        }, 'palworld-remove');
        row.append(traits, remove);
        sources.push(source);
        sourceList.append(row);
        refreshSourceTraits(source);
        invalidate();
        if (focus) picker.input.focus();
    }

    function renderExcluded() {
        excludedList.replaceChildren();
        document.getElementById('palworld-excluded-empty').hidden = excluded.size > 0;
        excluded.forEach(function (key) {
            const item = element('li');
            const name = palFor(key).name;
            const restore = button('Restore ' + name, function () {
                excluded.delete(key);
                renderExcluded();
                runRoute();
                routeStatus.focus();
            });
            item.append(palIdentity(key), restore);
            excludedList.append(item);
        });
    }

    // Each branch is an <li> holding the pal's card followed by an ordered list of
    // its two parents, so the accessible hierarchy matches the drawn tree.
    function renderNode(node, isTarget) {
        const item = element('li', 'palworld-tree-branch');
        const card = element('article', 'palworld-node palworld-node-' + node.type + (isTarget ? ' palworld-node-target' : ''));
        const typeLabel = node.type === 'breed' ? 'Breed' : node.type === 'source' ? 'Owned pal' : 'Helper pal';
        card.append(element('p', 'palworld-node-type', isTarget ? 'Target · ' + typeLabel : typeLabel));
        const heading = element('h4', 'palworld-node-heading');
        heading.append(palIdentity(node.pal));
        card.append(heading);
        const chips = element('ul', 'palworld-chips');
        chips.setAttribute('aria-label', 'Wanted traits carried');
        const traits = node.type === 'helper' ? [] : node.traits;
        traits.forEach(function (trait) { chips.append(element('li', 'palworld-chip', trait)); });
        if (!traits.length) chips.append(element('li', 'palworld-chip palworld-chip-empty', 'No wanted traits'));
        card.append(chips);
        if (node.type === 'breed') {
            card.append(element('p', 'palworld-eggs', eggFormat.format(node.expectedEggs) + ' expected eggs'));
        } else if (node.type === 'helper') {
            const excludeButton = button("Don't have", function () {
                excluded.add(node.pal);
                renderExcluded();
                runRoute();
                routeStatus.focus();
            });
            excludeButton.setAttribute('aria-label', "Don't have " + palFor(node.pal).name + ' as a helper');
            card.append(excludeButton);
        }
        item.append(card);
        if (node.type === 'breed') {
            const parents = element('ol', 'palworld-parents');
            parents.setAttribute('aria-label', 'Parents bred together for ' + palFor(node.pal).name);
            node.parents.forEach(function (parent) { parents.append(renderNode(parent, false)); });
            item.append(parents);
        }
        return item;
    }

    function runRoute() {
        if (!dataset) return;
        attempted = true;
        const generation = ++routeGeneration;
        const labels = traitInputs.map(function (input) { return input.value.trim(); });
        const request = {
            target: targetPicker.key,
            traits: labels.filter(Boolean),
            sources: sources.map(function (source) {
                return {
                    id: source.id,
                    pal: source.picker.key,
                    traits: Array.from(source.traitSlots).map(function (index) { return labels[index]; }).filter(Boolean)
                };
            }),
            excluded: Array.from(excluded)
        };
        clearRoute();
        routeStatus.textContent = 'Finding a breeding route…';
        results.setAttribute('aria-busy', 'true');
        submitButton.disabled = true;
        // Give the busy state a chance to paint before the synchronous engine runs.
        window.requestAnimationFrame(function () {
            window.setTimeout(function () {
                if (generation !== routeGeneration) return;
                try {
                    const result = globalThis.PalworldBreeding.findRoute(dataset, request);
                    if (!result.ok) {
                        routeStatus.textContent = result.message;
                        return;
                    }
                    summary.append(
                        element('p', '', eggFormat.format(result.totalEggs) + ' total expected eggs'),
                        element('p', '', result.stepCount + (result.stepCount === 1 ? ' breeding step' : ' breeding steps'))
                    );
                    summary.hidden = false;
                    const root = element('ol', 'palworld-tree');
                    root.setAttribute('aria-label', 'Breeding route: the target first, then each pal followed by the two parents bred together to make it');
                    root.append(renderNode(result.root, true));
                    tree.append(root);
                    routeHelp.hidden = false;
                    routeStatus.textContent = 'Route ready. ' + eggFormat.format(result.totalEggs) + ' total expected eggs across ' + result.stepCount + (result.stepCount === 1 ? ' breeding step' : ' breeding steps') + '. The target is at the top of the tree; follow each branch down to the two parents you breed together.';
                } catch (error) {
                    clearRoute();
                    routeStatus.textContent = 'Unable to find a route: ' + (error instanceof Error ? error.message : 'Please try again.');
                } finally {
                    results.setAttribute('aria-busy', 'false');
                    submitButton.disabled = false;
                }
            }, 0);
        });
    }

    // Passive trait display names from Pal Calc's db.json: English name per entry,
    // de-duplicated and sorted case-insensitively.
    function passiveTraitNames(db) {
        const raw = db && db.PassiveSkills;
        const entries = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
        const names = new Set();
        entries.forEach(function (entry) {
            if (!entry || typeof entry !== 'object') return;
            const localized = entry.LocalizedNames && typeof entry.LocalizedNames === 'object' ? entry.LocalizedNames.en : undefined;
            const name = typeof localized === 'string' && localized.trim() ? localized : entry.Name;
            if (typeof name === 'string' && name.trim()) names.add(name.trim());
        });
        return Array.from(names).sort(function (a, b) {
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });
    }

    function populateTraitSelects(names) {
        traitInputs.forEach(function (select) {
            const blank = element('option', '', 'No trait');
            blank.value = '';
            const options = names.map(function (name) {
                const option = element('option', '', name);
                option.value = name;
                return option;
            });
            select.replaceChildren(blank, ...options);
            select.value = '';
        });
    }

    async function fetchJson(path) {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Could not load ' + path.split('/').pop() + ' (HTTP ' + response.status + ').');
        return response.json();
    }

    async function load() {
        try {
            const engine = globalThis.PalworldBreeding;
            if (!engine) throw new Error('The breeding engine did not load.');
            const data = await Promise.all([
                fetchJson('/assets/data/palworld/palcalc-db.json'),
                fetchJson('/assets/data/palworld/palcalc-breeding.json'),
                fetchJson('/assets/data/palworld/pal-thumbnails.json')
            ]);
            manifest = data[2];
            if (!manifest || !manifest.sprites || typeof manifest.sprites !== 'object' ||
                typeof manifest.image !== 'string' || !manifest.image.startsWith('/') ||
                !Number.isInteger(manifest.cell) || manifest.cell <= 0 ||
                !Number.isInteger(manifest.columns) || manifest.columns <= 0 ||
                !Number.isInteger(manifest.rows) || manifest.rows <= 0) {
                throw new Error('The thumbnail manifest is unusable.');
            }
            const imageUrl = new URL(manifest.image, window.location.origin);
            if (imageUrl.origin !== window.location.origin) throw new Error('Thumbnails must be hosted on this site.');
            spriteImage = imageUrl.href;
            const traitNames = passiveTraitNames(data[0]);
            if (!traitNames.length) throw new Error('The breeding data lists no passive traits.');
            dataset = engine.buildDataset(data[0], data[1]);
            populateTraitSelects(traitNames);
            document.getElementById('palworld-data-version').textContent = dataset.version;
            targetPicker = createPicker(document.getElementById('palworld-target-picker'), 'palworld-target', 'Search target pal');
            addSource(false);
            controls.disabled = false;
            loadStatus.textContent = 'Ready. ' + dataset.pals.length + ' pals available.';
        } catch (error) {
            controls.disabled = true;
            loadStatus.classList.add('palworld-error');
            loadStatus.textContent = 'Unable to load the planner: ' + (error instanceof Error ? error.message : 'An unexpected error occurred.') + ' Reload this page to try again.';
            document.getElementById('palworld-data-version').textContent = 'unavailable';
        }
    }

    routeStatus.tabIndex = -1;
    tree.tabIndex = 0;
    tree.setAttribute('role', 'region');
    tree.setAttribute('aria-label', 'Breeding tree; scroll to explore wider or deeper branches');
    tree.setAttribute('aria-describedby', routeHelp.id);
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        runRoute();
    });
    form.addEventListener('input', invalidate);
    traitInputs.forEach(function (input, index) {
        let previous = input.value;
        input.addEventListener('change', function () {
            // A different trait in this slot must not inherit the old trait's checkmarks.
            if (input.value !== previous) {
                sources.forEach(function (source) { source.traitSlots.delete(index); });
                previous = input.value;
            }
            sources.forEach(refreshSourceTraits);
        });
    });
    addSourceButton.addEventListener('click', function () { addSource(true); });
    load();
}());

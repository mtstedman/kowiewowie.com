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
    let palSearchIndex = null;
    let treeResizeObserver = null;

    const PICKER_BATCH = 30;
    const DATA_PATH = '/assets/data/palworld/';
    const DATA_FILES = ['palcalc-db.json', 'palcalc-breeding.json', 'pal-thumbnails.json'];
    const CACHE_DB = 'wowiekowie-palworld';
    const CACHE_STORE = 'datasets';
    const CACHE_KEY = 'breeding-data';
    const CACHE_OPEN_TIMEOUT = 3000;
    const CACHE_READ_TIMEOUT = 6000;
    const CACHE_WRITE_TIMEOUT = 20000;

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
        tree.scrollLeft = 0;
        tree.scrollTop = 0;
        summary.replaceChildren();
        summary.hidden = true;
        routeHelp.hidden = true;
    }

    function fitRoute() {
        const stage = tree.firstElementChild;
        const root = stage && stage.firstElementChild;
        if (!stage || !root) return;
        const styles = window.getComputedStyle(tree);
        const innerWidth = tree.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
        const naturalWidth = root.scrollWidth;
        const naturalHeight = root.scrollHeight;
        if (innerWidth <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return;
        const scale = Math.min(1, Math.max(0.6, innerWidth / naturalWidth));
        root.style.setProperty('--palworld-tree-scale', String(scale));
        stage.style.setProperty('width', (naturalWidth * scale) + 'px');
        stage.style.setProperty('height', (naturalHeight * scale) + 'px');
    }

    function invalidate() {
        routeGeneration += 1;
        results.setAttribute('aria-busy', 'false');
        submitButton.disabled = false;
        if (!attempted) return;
        clearRoute();
        routeStatus.textContent = 'Inputs changed. Find a breeding route with your updated plan.';
    }

    // Search text for every pal, built once on first use. It holds strings only;
    // choice elements are created per batch while a picker is open.
    function palSearch() {
        if (!palSearchIndex) {
            palSearchIndex = dataset.pals.map(function (pal) {
                return { pal: pal, search: (pal.name + ' ' + pal.internalName + ' ' + (pal.paldexNo === null ? '' : pal.paldexNo)).toLowerCase() };
            });
        }
        return palSearchIndex;
    }

    // Native buttons keep the searchable picker usable with Tab and Enter.
    // Arrow keys also move between matches without requiring a custom combobox.
    // Matches are rendered in batches of PICKER_BATCH as the list is scrolled or
    // navigated, and removed again when the list closes.
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
        const moreItem = element('li', 'palworld-picker-more');
        let found = [];
        let choices = [];
        let generation = 0;

        function close() {
            generation += 1;
            matches.hidden = true;
            matches.replaceChildren();
            found = [];
            choices = [];
        }

        function choose(pal) {
            picker.key = pal.key;
            input.value = pal.name;
            selected.replaceChildren(palIdentity(pal.key));
            input.focus();
            close();
            count.textContent = pal.name + ' selected.';
            invalidate();
        }

        // Appends the next batch of matches. The "show more" row stays last until
        // every match is rendered, so nothing is cut off without a way to reach it.
        function renderBatch() {
            const start = choices.length;
            const end = Math.min(start + PICKER_BATCH, found.length);
            if (end === start) return;
            const moreFocused = document.activeElement === moreButton;
            const fragment = document.createDocumentFragment();
            found.slice(start, end).forEach(function (entry) {
                const pal = entry.pal;
                const item = element('li');
                const choice = button('', function () { choose(pal); });
                choice.append(palIdentity(pal.key));
                if (pal.paldexNo !== null) choice.append(element('span', 'palworld-pal-number', '#' + pal.paldexNo));
                item.append(choice);
                fragment.append(item);
                choices.push(choice);
            });
            matches.insertBefore(fragment, moreItem.parentNode === matches ? moreItem : null);
            const remaining = found.length - end;
            if (remaining) {
                moreButton.textContent = 'Show more pals (' + remaining + ' not shown yet)';
                if (moreItem.parentNode !== matches) matches.append(moreItem);
            }
            // Keep keyboard focus inside the list when the row it was on moves on or goes away.
            if (moreFocused) choices[start].focus();
            if (!remaining) moreItem.remove();
        }

        // Renders the rest one batch per task, then moves focus to the last match.
        function renderRemaining(token) {
            renderBatch();
            if (choices.length < found.length) {
                window.setTimeout(function () {
                    if (token === generation) renderRemaining(token);
                }, 0);
            } else if (choices.length && matches.contains(document.activeElement)) {
                choices[choices.length - 1].focus();
            }
        }

        const moreButton = button('', function () {
            const start = choices.length;
            renderBatch();
            if (choices[start]) choices[start].focus();
        });
        moreItem.append(moreButton);

        function filter() {
            const query = input.value.trim().toLowerCase();
            generation += 1;
            found = palSearch().filter(function (entry) { return entry.search.includes(query); });
            choices = [];
            matches.replaceChildren();
            matches.scrollTop = 0;
            matches.hidden = false;
            renderBatch();
            if (!found.length) count.textContent = 'No matching pals. Try another name.';
            else count.textContent = found.length + ' matching pals.' + (choices.length < found.length ? ' More load as you scroll or arrow down.' : '');
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
                if (choices.length) choices[0].focus();
            } else if (event.key === 'Escape') {
                close();
            }
        });
        matches.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                input.focus();
                close();
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'End') {
                renderRemaining(generation);
                return;
            }
            const onMore = document.activeElement === moreButton;
            const current = choices.indexOf(document.activeElement);
            let next = 0;
            if (event.key === 'ArrowUp') next = onMore ? choices.length - 1 : current - 1;
            else if (event.key === 'ArrowDown') next = onMore ? choices.length : current + 1;
            // Stepping past the last rendered match pulls in the next batch first.
            if (next >= choices.length) renderBatch();
            if (choices.length) choices[Math.max(0, Math.min(next, choices.length - 1))].focus();
        });
        matches.addEventListener('scroll', function () {
            if (matches.hidden || choices.length >= found.length) return;
            if (matches.scrollTop + matches.clientHeight >= matches.scrollHeight - 96) renderBatch();
        });
        wrapper.addEventListener('focusout', function (event) {
            if (!wrapper.contains(event.relatedTarget)) close();
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
    function renderNode(node, isTarget, showEmptyTraitChip) {
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
        if (!traits.length && showEmptyTraitChip) chips.append(element('li', 'palworld-chip palworld-chip-empty', 'No wanted traits'));
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
            node.parents.forEach(function (parent) { parents.append(renderNode(parent, false, showEmptyTraitChip)); });
            item.append(parents);
        }
        return item;
    }

    function runRoute() {
        if (!dataset) return;
        attempted = true;
        const generation = ++routeGeneration;
        const labels = traitInputs.map(function (input) { return input.value.trim(); });
        const wantedTraits = labels.filter(Boolean);
        const request = {
            target: targetPicker.key,
            traits: wantedTraits,
            sources: sources.filter(function (source) {
                return wantedTraits.length || source.picker.key;
            }).map(function (source) {
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
                    const stage = element('div', 'palworld-tree-stage');
                    const root = element('ol', 'palworld-tree');
                    root.setAttribute('aria-label', 'Breeding route: the target first, then each pal followed by the two parents bred together to make it');
                    root.append(renderNode(result.root, true, wantedTraits.length > 0));
                    stage.append(root);
                    tree.append(stage);
                    fitRoute();
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

    // Lets a status message paint before synchronous parsing; the timer covers background tabs.
    function yieldToPaint() {
        return new Promise(function (resolve) {
            let done = false;
            function finish() {
                if (done) return;
                done = true;
                resolve();
            }
            window.requestAnimationFrame(function () { window.setTimeout(finish, 0); });
            window.setTimeout(finish, 120);
        });
    }

    // The server-derived revision covers all three JSON inputs. Without usable
    // metadata the planner still works, it just downloads on every visit.
    function cacheConfig() {
        const revision = form.dataset.palworldRevision || '';
        const format = form.dataset.palworldCacheFormat || '';
        if (!/^[a-f0-9]{16,64}$/.test(revision) || !/^[1-9][0-9]{0,5}$/.test(format)) return null;
        return { revision: revision, format: Number(format) };
    }

    // Every cache step is bounded: a missing, blocked, hung or failing store
    // rejects so the caller can fall back to the network.
    function openCache() {
        return new Promise(function (resolve, reject) {
            let done = false;
            let timer = 0;
            function fail(error) {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                reject(error);
            }
            timer = window.setTimeout(function () { fail(new Error('Opening the saved data timed out.')); }, CACHE_OPEN_TIMEOUT);
            let request;
            try {
                const factory = window.indexedDB;
                if (!factory) {
                    fail(new Error('Browser storage is unavailable.'));
                    return;
                }
                request = factory.open(CACHE_DB, 1);
            } catch (error) {
                fail(error);
                return;
            }
            request.onupgradeneeded = function () {
                const db = request.result;
                if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
            };
            request.onblocked = function () { fail(new Error('Browser storage is blocked.')); };
            request.onerror = function (event) {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                fail(request.error || new Error('Browser storage could not be opened.'));
            };
            request.onsuccess = function () {
                const db = request.result;
                if (done) {
                    // Opened after we gave up: release it so it cannot block later opens.
                    db.close();
                    return;
                }
                done = true;
                window.clearTimeout(timer);
                db.onversionchange = function () { db.close(); };
                resolve(db);
            };
        });
    }

    // Runs one transaction and resolves with the kept value only after it commits.
    function cacheTransaction(mode, timeout, work) {
        return openCache().then(function (db) {
            return new Promise(function (resolve, reject) {
                let done = false;
                let result;
                let transaction = null;
                let timer = 0;
                function finish(error) {
                    if (done) return;
                    done = true;
                    window.clearTimeout(timer);
                    try { db.close(); } catch (closeError) { /* already closed */ }
                    if (error) reject(error);
                    else resolve(result);
                }
                timer = window.setTimeout(function () {
                    try { if (transaction) transaction.abort(); } catch (abortError) { /* already finished */ }
                    finish(new Error('Browser storage timed out.'));
                }, timeout);
                try {
                    transaction = db.transaction(CACHE_STORE, mode);
                    transaction.oncomplete = function () { finish(null); };
                    transaction.onabort = function () { finish(transaction.error || new Error('Browser storage aborted the request.')); };
                    transaction.onerror = function () { finish(transaction.error || new Error('Browser storage failed.')); };
                    work(transaction.objectStore(CACHE_STORE), function (value) { result = value; });
                } catch (error) {
                    finish(error);
                }
            });
        });
    }

    function clearCache() {
        cacheTransaction('readwrite', CACHE_WRITE_TIMEOUT, function (store) { store.clear(); }).catch(function () {});
    }

    // Resolves with the three raw JSON texts for this revision, or null. Never rejects.
    function readCache(cache) {
        return cacheTransaction('readonly', CACHE_READ_TIMEOUT, function (store, keep) {
            const request = store.get(CACHE_KEY);
            request.onsuccess = function () { keep(request.result); };
        }).then(function (record) {
            if (record === undefined || record === null) return null;
            if (typeof record !== 'object' || record.format !== cache.format || record.revision !== cache.revision ||
                typeof record.db !== 'string' || typeof record.breeding !== 'string' || typeof record.thumbnails !== 'string') {
                // Another revision or an unreadable shape: remove it rather than keep stale data around.
                clearCache();
                return null;
            }
            return [record.db, record.breeding, record.thumbnails];
        }).catch(function () { return null; });
    }

    // One record in one transaction, so a revision is either stored whole or not at all.
    function writeCache(cache, texts) {
        return cacheTransaction('readwrite', CACHE_WRITE_TIMEOUT, function (store) {
            store.clear();
            store.put({
                format: cache.format,
                revision: cache.revision,
                savedAt: Date.now(),
                db: texts[0],
                breeding: texts[1],
                thumbnails: texts[2]
            }, CACHE_KEY);
        });
    }

    function downloadSize() {
        const bytes = Number(form.dataset.palworldDataBytes);
        return Number.isFinite(bytes) && bytes > 0 ? 'about ' + (bytes / 1000000).toFixed(1) + ' MB' : 'several MB';
    }

    function dataUrl(name, revision) {
        return DATA_PATH + name + (revision ? '?v=' + encodeURIComponent(revision) : '');
    }

    async function fetchText(name, revision) {
        const response = await fetch(dataUrl(name, revision));
        if (!response.ok) throw new Error('Could not load ' + name + ' (HTTP ' + response.status + ').');
        return response.text();
    }

    // Bytes that crossed the network for the three bulk requests. Resource Timing gives
    // what the browser actually transferred (headers plus compressed body, 0 when its own
    // HTTP cache answered). Where an entry is missing, the uncompressed payload size stands
    // in as an upper bound and the result is labelled as an estimate.
    function measureTransfer(revision, texts) {
        let bytes = 0;
        let measured = true;
        DATA_FILES.forEach(function (name, index) {
            let size = null;
            try {
                const url = new URL(dataUrl(name, revision), window.location.href).href;
                const entries = performance.getEntriesByName(url, 'resource');
                const entry = entries[entries.length - 1];
                if (entry && Number.isFinite(entry.transferSize)) size = entry.transferSize;
            } catch (error) {
                size = null;
            }
            if (size === null) {
                measured = false;
                size = new Blob([texts[index]]).size;
            }
            bytes += size;
        });
        return { bytes: bytes, measure: measured ? 'resource-timing' : 'payload-size-estimate' };
    }

    function download(revision) {
        const size = downloadSize();
        let received = 0;
        let active = true;
        function report() {
            if (!active) return;
            loadStatus.textContent = 'Downloading breeding data (' + size + '): ' + received + ' of ' + DATA_FILES.length + ' files received…';
        }
        report();
        return Promise.all(DATA_FILES.map(function (name) {
            return fetchText(name, revision).then(function (text) {
                received += 1;
                report();
                return text;
            });
        })).then(function (texts) {
            active = false;
            return texts;
        }, function (error) {
            active = false;
            throw error;
        });
    }

    function parsePayloads(texts) {
        return texts.map(function (text, index) {
            try {
                return JSON.parse(text);
            } catch (error) {
                throw new Error(DATA_FILES[index] + ' is not valid JSON.');
            }
        });
    }

    // Validates the three payloads and builds the dataset without touching page state,
    // so unusable cached data can be discarded before anything is shown.
    function prepare(engine, data) {
        const sprites = data[2];
        if (!sprites || !sprites.sprites || typeof sprites.sprites !== 'object' ||
            typeof sprites.image !== 'string' || !sprites.image.startsWith('/') ||
            !Number.isInteger(sprites.cell) || sprites.cell <= 0 ||
            !Number.isInteger(sprites.columns) || sprites.columns <= 0 ||
            !Number.isInteger(sprites.rows) || sprites.rows <= 0) {
            throw new Error('The thumbnail manifest is unusable.');
        }
        const imageUrl = new URL(sprites.image, window.location.origin);
        if (imageUrl.origin !== window.location.origin) throw new Error('Thumbnails must be hosted on this site.');
        const traitNames = passiveTraitNames(data[0]);
        if (!traitNames.length) throw new Error('The breeding data lists no passive traits.');
        return {
            manifest: sprites,
            spriteImage: imageUrl.href,
            traitNames: traitNames,
            dataset: engine.buildDataset(data[0], data[1])
        };
    }

    async function load() {
        try {
            const engine = globalThis.PalworldBreeding;
            if (!engine) throw new Error('The breeding engine did not load.');
            const cache = cacheConfig();
            let ready = null;
            let downloaded = null;
            if (cache) {
                loadStatus.textContent = 'Checking this browser for saved breeding data…';
                const saved = await readCache(cache);
                if (saved) {
                    loadStatus.textContent = 'Loading breeding data saved in this browser…';
                    await yieldToPaint();
                    try {
                        ready = prepare(engine, parsePayloads(saved));
                    } catch (error) {
                        // Corrupt or incompatible saved data: drop it and download a fresh set.
                        ready = null;
                        clearCache();
                    }
                }
            }
            if (!ready) {
                downloaded = await download(cache ? cache.revision : '');
                loadStatus.textContent = 'Download complete. Preparing the planner…';
                await yieldToPaint();
                ready = prepare(engine, parsePayloads(downloaded));
            }
            manifest = ready.manifest;
            spriteImage = ready.spriteImage;
            dataset = ready.dataset;
            populateTraitSelects(ready.traitNames);
            document.getElementById('palworld-data-version').textContent = dataset.version;
            targetPicker = createPicker(document.getElementById('palworld-target-picker'), 'palworld-target', 'Search target pal');
            addSource(false);
            controls.disabled = false;
            // Startup measurements: where the data came from, when controls became usable, and
            // how many bytes the three bulk requests transferred (0 when no request was made).
            form.dataset.palworldLoadSource = downloaded ? 'network' : 'cache';
            form.dataset.palworldReadyMs = String(Math.round(performance.now()));
            const transfer = downloaded
                ? measureTransfer(cache ? cache.revision : '', downloaded)
                : { bytes: 0, measure: 'no-request' };
            form.dataset.palworldTransferredBytes = String(transfer.bytes);
            form.dataset.palworldTransferMeasure = transfer.measure;
            const readyText = 'Ready. ' + dataset.pals.length + ' pals available.';
            if (!downloaded) {
                loadStatus.textContent = readyText + ' Loaded from data saved in this browser.';
                return;
            }
            loadStatus.textContent = readyText;
            if (!cache) return;
            // Only a fully downloaded and validated set is saved, and only after the controls are usable.
            window.setTimeout(function () {
                writeCache(cache, downloaded).then(function () {
                    loadStatus.textContent = readyText + ' Saved in this browser, so the next visit skips the download.';
                }, function () {
                    loadStatus.textContent = readyText + ' This browser could not save the data, so the next visit downloads it again.';
                });
            }, 0);
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
    tree.setAttribute('aria-label', 'Breeding tree; wide routes shrink to fit when possible and scroll sideways when needed');
    tree.setAttribute('aria-describedby', routeHelp.id);
    if ('ResizeObserver' in globalThis) {
        treeResizeObserver = new ResizeObserver(fitRoute);
        treeResizeObserver.observe(tree);
    } else {
        window.addEventListener('resize', fitRoute);
    }
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

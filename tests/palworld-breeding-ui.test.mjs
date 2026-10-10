import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';

const script = await readFile(new URL('../htdocs/assets/js/palworld-breeding.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../htdocs/assets/css/palworld.css', import.meta.url), 'utf8');

const success = (root = { type: 'source', pal: 'lamball', traits: [] }) => ({
    kind: 'result',
    value: { ok: true, root, totalEggs: 1, stepCount: 1 },
});

async function planner(viewport = { width: 1280, height: 800 }) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.route('http://planner.test/**', (route) => route.fulfill({ body: '<!doctype html><title>Planner test</title>' }));
    await page.goto('http://planner.test/');
    await page.setContent(`
        <style>
            :root { --space-xs: .5rem; --space-sm: .75rem; --space-md: 1rem; --space-lg: 1.5rem; --step--1: .875rem; --step-1: 1.15rem; --step-2: 1.4rem; --ink: #202020; --ink-soft: #626262; --accent: #9b3d16; --panel: #fff; --paper: #f7f3eb; }
            * { box-sizing: border-box; }
            body { margin: 0; color: var(--ink); font-family: sans-serif; }
            button, input, select { font: inherit; }
            .page-shell { width: min(100% - 24px, 1360px); margin-inline: auto; }
            .public-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
            ${styles}
        </style>
        <main class="page-shell palworld-shell">
            <p id="palworld-load-status" class="palworld-notice"></p>
            <div class="palworld-view-switch" role="tablist" aria-label="Breeding planner view">
                <button id="palworld-view-setup" type="button" role="tab" aria-selected="true" aria-controls="palworld-form">Setup</button>
                <button id="palworld-view-route" type="button" role="tab" aria-selected="false" aria-controls="palworld-results" disabled>Route</button>
            </div>
            <div class="palworld-layout" data-mobile-view="setup">
                <form id="palworld-form" class="palworld-panel palworld-bar" data-palworld-cache-format="1" data-palworld-data-bytes="1">
                    <div class="palworld-panel-heading">
                        <div><p class="eyebrow">Setup</p><h2 id="palworld-plan-title">Build your breeding plan</h2></div>
                        <button id="palworld-show-route" type="button" disabled>Return to route</button>
                    </div>
                    <fieldset id="palworld-controls" class="palworld-controls" disabled>
                        <legend class="public-visually-hidden">Breeding plan inputs</legend>
                        <details class="palworld-setup-step" open>
                            <summary><span>1 Target Pal</span><span id="palworld-target-summary" class="palworld-step-summary">Not selected</span></summary>
                            <div class="palworld-step-body"><div id="palworld-target-picker"></div></div>
                        </details>
                        <details id="palworld-addons" class="palworld-setup-step" open>
                            <summary><span>2 Desired passives</span><span id="palworld-addons-summary" class="palworld-step-summary">None selected</span></summary>
                            <div class="palworld-step-body"><div class="palworld-trait-fields">
                                <label>Passive 1<select><option value="">No passive</option></select></label>
                                <label>Passive 2<select><option value="">No passive</option></select></label>
                                <label>Passive 3<select><option value="">No passive</option></select></label>
                                <label>Passive 4<select><option value="">No passive</option></select></label>
                            </div></div>
                        </details>
                        <details class="palworld-setup-step palworld-owned" open>
                            <summary><span>3 Owned Pals</span><span id="palworld-owned-summary" class="palworld-step-summary">1 row</span></summary>
                            <div class="palworld-step-body">
                                <div class="palworld-source-collection" role="group" aria-label="Owned Pal collection">
                                    <div class="palworld-source-scroller"><div id="palworld-sources" class="palworld-sources"></div></div>
                                    <button id="palworld-add-source" type="button">Add another owned Pal</button>
                                </div>
                            </div>
                        </details>
                        <div class="palworld-actions"><p>Ready with these choices?</p><button id="palworld-find-route" class="palworld-primary" type="submit">Find route</button></div>
                    </fieldset>
                </form>
                <section id="palworld-results" class="palworld-panel palworld-results" data-route-state="empty" aria-busy="false" hidden>
                    <div class="palworld-panel-heading"><div><p class="eyebrow">Route</p><h2 id="palworld-results-title" tabindex="-1">Breeding route result</h2></div><button id="palworld-edit-setup" type="button">Edit setup</button></div>
                    <p id="palworld-route-status"></p>
                    <div id="palworld-route-tree"></div>
                    <footer id="palworld-route-summary" hidden></footer>
                    <section class="palworld-exclusions" hidden><p id="palworld-excluded-empty">No helpers excluded.</p><ul id="palworld-excluded-list"></ul></section>
                </section>
            </div>
            <span id="palworld-data-version"></span>
        </main>
    `);
    await page.evaluate(() => {
        const pals = [
            { key: 'lamball', name: 'Lamball', internalName: 'SheepBall', paldexNo: 1 },
            { key: 'cattiva', name: 'Cattiva', internalName: 'PinkCat', paldexNo: 2 },
            { key: 'chikipi', name: 'Chikipi', internalName: 'ChickenPal', paldexNo: 3 },
        ];
        window.__routeResults = [];
        window.__requests = [];
        window.PalworldBreeding = {
            buildDataset() { return { version: 'test', pals, indexByKey: Object.fromEntries(pals.map((pal, index) => [pal.key, index])) }; },
            findRoute(dataset, request) {
                window.__requests.push(JSON.parse(JSON.stringify(request)));
                const next = window.__routeResults.shift();
                if (!next) throw new Error('No queued test route.');
                if (next.kind === 'throw') throw new Error(next.message);
                return next.value;
            },
        };
        const payloads = {
            'palcalc-db.json': JSON.stringify({ PassiveSkills: [{ Rank: 4, IsStandardPassiveSkill: true, LocalizedNames: { en: 'Swift' } }] }),
            'palcalc-breeding.json': '{}',
            'pal-thumbnails.json': JSON.stringify({ image: '/sprite.png', cell: 48, columns: 3, rows: 1, sprites: { lamball: { index: 0 }, cattiva: { index: 1 }, chikipi: { index: 2 } } }),
        };
        window.fetch = async (url) => {
            const name = String(url).split('/').pop().split('?')[0];
            return { ok: true, text: async () => payloads[name] };
        };
    });
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => !document.getElementById('palworld-controls').disabled);
    return { browser, page };
}

async function queue(page, ...results) {
    await page.evaluate((items) => window.__routeResults.push(...items), results);
}

async function submitAndWait(page, text = 'Breeding route ready.') {
    await page.locator('#palworld-find-route').click();
    await page.waitForFunction((expected) => document.getElementById('palworld-route-status').textContent === expected, text);
}

test('results reveal, become stale without losing the route, and update from current setup', async (t) => {
    const { browser, page } = await planner();
    t.after(() => browser.close());

    const results = page.locator('.palworld-results');
    assert.equal(await results.isHidden(), true);
    assert.equal(await page.locator('#palworld-find-route').textContent(), 'Find route');

    await queue(page, success());
    await submitAndWait(page);
    assert.equal(await results.isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'palworld-results-title');
    assert.equal(await results.getAttribute('data-route-state'), 'current');
    assert.equal(await page.locator('#palworld-route-tree .palworld-node').count(), 1);

    const target = page.locator('#palworld-target');
    await target.fill('new target');
    assert.equal(await results.getAttribute('data-route-state'), 'stale');
    assert.equal(await page.locator('#palworld-find-route').textContent(), 'Update route');
    assert.equal(await page.locator('#palworld-route-tree .palworld-node').count(), 1);
    assert.equal(await page.locator('#palworld-route-tree').getAttribute('inert'), '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'palworld-target');

    await queue(page, success({ type: 'source', pal: 'cattiva', traits: [] }));
    await submitAndWait(page);
    assert.equal(await results.getAttribute('data-route-state'), 'current');
    assert.equal(await page.locator('#palworld-find-route').textContent(), 'Find route');
    assert.match(await page.locator('#palworld-route-tree').textContent(), /Cattiva/);
});

test('cancelled work cannot reveal an obsolete result and a failed attempt can be retried', async (t) => {
    const { browser, page } = await planner();
    t.after(() => browser.close());

    await queue(page, success());
    await page.evaluate(() => {
        document.getElementById('palworld-form').requestSubmit();
        const input = document.getElementById('palworld-target');
        input.value = 'changed before work';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('.palworld-results').isHidden(), true);
    assert.equal(await page.evaluate(() => window.__requests.length), 0);
    await page.evaluate(() => { window.__routeResults = []; });

    await queue(page, { kind: 'throw', message: 'test failure' });
    await submitAndWait(page, 'Unable to find a route: test failure');
    assert.equal(await page.locator('#palworld-find-route').isEnabled(), true);
    assert.equal(await page.locator('.palworld-results').getAttribute('data-route-state'), 'outcome');

    await queue(page, success());
    await submitAndWait(page);
    assert.equal(await page.locator('.palworld-results').getAttribute('data-route-state'), 'current');
});

test('owned row labels and removal focus stay sequential while helper changes reroute', async (t) => {
    const { browser, page } = await planner();
    t.after(() => browser.close());

    await page.locator('#palworld-add-source').click();
    await page.evaluate(() => document.activeElement.blur());
    await page.locator('#palworld-add-source').click();
    assert.deepEqual(await page.locator('.palworld-source > legend').allTextContents(), ['Owned Pal 1', 'Owned Pal 2', 'Owned Pal 3']);
    const stableThirdId = await page.locator('.palworld-source input[type="search"]').nth(2).getAttribute('id');
    await page.locator('.palworld-remove').nth(1).click();
    assert.deepEqual(await page.locator('.palworld-source > legend').allTextContents(), ['Owned Pal 1', 'Owned Pal 2']);
    assert.equal(await page.evaluate(() => document.activeElement.id), stableThirdId);
    assert.equal(await page.locator('.palworld-remove').nth(1).textContent(), 'Remove owned Pal 2');

    await page.locator('#palworld-target').fill('Lamball');
    await page.locator('#palworld-target-matches button').first().click();
    await page.locator('#' + stableThirdId).fill('Cattiva');
    await page.locator('#' + stableThirdId + '-matches button').first().click();

    await queue(
        page,
        success({ type: 'helper', pal: 'cattiva', traits: [] }),
        success(),
        success({ type: 'helper', pal: 'cattiva', traits: [] }),
    );
    await submitAndWait(page);
    await page.getByRole('button', { name: "Don't have Cattiva as a helper" }).click();
    await page.waitForFunction(() => window.__requests.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__requests[1].excluded), ['cattiva']);
    await page.getByRole('button', { name: 'Restore Cattiva' }).click();
    await page.waitForFunction(() => window.__requests.length === 3);
    assert.deepEqual(await page.evaluate(() => window.__requests[2].excluded), []);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'palworld-route-status');
});


test('desktop workspace keeps setup beside the route and bounds a large owned collection', async (t) => {
    const { browser, page } = await planner({ width: 1280, height: 800 });
    t.after(() => browser.close());

    await page.evaluate(() => {
        const add = document.getElementById('palworld-add-source');
        for (let index = 0; index < 11; index += 1) add.click();
        document.activeElement.blur();
    });
    const collection = await page.locator('.palworld-source-scroller').evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        bottom: node.getBoundingClientRect().bottom,
    }));
    const action = await page.locator('#palworld-find-route').boundingBox();
    assert.equal(await page.locator('.palworld-source').count(), 12);
    assert.equal(await page.locator('.palworld-remove').count(), 12);
    assert.ok(collection.clientHeight <= 352);
    assert.ok(collection.scrollHeight > collection.clientHeight);
    assert.ok(action.y >= collection.bottom);

    await queue(page, success());
    await submitAndWait(page);
    const geometry = await page.evaluate(() => {
        const setup = document.getElementById('palworld-form').getBoundingClientRect();
        const route = document.getElementById('palworld-results').getBoundingClientRect();
        const heading = document.getElementById('palworld-results-title').getBoundingClientRect();
        const tree = document.getElementById('palworld-route-tree').getBoundingClientRect();
        return {
            adjacent: setup.right <= route.left + 1,
            aligned: Math.abs(setup.top - route.top) < 2,
            headingVisible: heading.top >= 0 && heading.bottom <= innerHeight,
            treeStarted: tree.top >= 0 && tree.top < innerHeight,
            noDocumentOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
    });
    assert.deepEqual(geometry, { adjacent: true, aligned: true, headingVisible: true, treeStarted: true, noDocumentOverflow: true });
});

test('picker menus stay viewport-bound without growing the document', async (t) => {
    const { browser, page } = await planner({ width: 390, height: 844 });
    t.after(() => browser.close());

    const targetHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.locator('#palworld-target').focus();
    await page.locator('#palworld-target').fill('a');
    const targetMenu = await page.locator('#palworld-target-matches').boundingBox();
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), targetHeight);
    assert.ok(targetMenu.y >= 0 && targetMenu.y + targetMenu.height <= 844);
    await page.locator('#palworld-target').press('Escape');
    assert.equal(await page.locator('#palworld-target').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'palworld-target');

    await page.evaluate(() => {
        const add = document.getElementById('palworld-add-source');
        for (let index = 0; index < 11; index += 1) add.click();
        const scroller = document.querySelector('.palworld-source-scroller');
        scroller.scrollTop = scroller.scrollHeight;
    });
    const ownedInput = page.locator('.palworld-source input[type="search"]').last();
    await ownedInput.focus();
    await ownedInput.fill('a');
    const ownedMenu = await page.locator('.palworld-source .palworld-picker-matches').last().boundingBox();
    assert.ok(ownedMenu.y >= 0 && ownedMenu.y + ownedMenu.height <= 844);
    assert.equal(await page.locator('.palworld-source').count(), 12);
});

test('mobile submission opens Route and setup navigation preserves a stale route and values', async (t) => {
    const { browser, page } = await planner({ width: 390, height: 844 });
    t.after(() => browser.close());

    await page.locator('#palworld-target').fill('Lamball');
    await page.locator('#palworld-target-matches button').first().click();
    await queue(page, success());
    await submitAndWait(page);
    assert.equal(await page.locator('.palworld-layout').getAttribute('data-mobile-view'), 'route');
    assert.equal(await page.locator('#palworld-form').isVisible(), false);
    assert.equal(await page.locator('#palworld-results').isVisible(), true);

    await page.locator('#palworld-edit-setup').click();
    assert.equal(await page.locator('.palworld-layout').getAttribute('data-mobile-view'), 'setup');
    assert.equal(await page.locator('#palworld-target').inputValue(), 'Lamball');
    await page.locator('#palworld-target').fill('Cattiva');
    await page.locator('#palworld-target-matches button').first().click();
    assert.equal(await page.locator('#palworld-results').getAttribute('data-route-state'), 'stale');
    assert.equal(await page.locator('#palworld-find-route').textContent(), 'Update route');

    await page.locator('#palworld-show-route').click();
    assert.equal(await page.locator('#palworld-route-tree .palworld-node').count(), 1);
    await page.locator('#palworld-view-setup').click();
    const targetDetails = page.locator('.palworld-setup-step').first();
    await targetDetails.locator('summary').click();
    assert.equal(await targetDetails.getAttribute('open'), null);
    await targetDetails.locator('summary').click();
    assert.equal(await page.locator('#palworld-target').inputValue(), 'Cattiva');

    await queue(page, success({ type: 'source', pal: 'cattiva', traits: [] }));
    await submitAndWait(page);
    assert.equal(await page.locator('.palworld-layout').getAttribute('data-mobile-view'), 'route');
    assert.equal(await page.locator('#palworld-results').getAttribute('data-route-state'), 'current');
    assert.match(await page.locator('#palworld-route-tree').textContent(), /Cattiva/);
});

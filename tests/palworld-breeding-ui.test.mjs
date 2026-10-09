import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';

const script = await readFile(new URL('../htdocs/assets/js/palworld-breeding.js', import.meta.url), 'utf8');

const success = (root = { type: 'source', pal: 'lamball', traits: [] }) => ({
    kind: 'result',
    value: { ok: true, root, totalEggs: 1, stepCount: 1 },
});

async function planner() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.route('http://planner.test/**', (route) => route.fulfill({ body: '<!doctype html><title>Planner test</title>' }));
    await page.goto('http://planner.test/');
    await page.setContent(`
        <p id="palworld-load-status"></p>
        <form id="palworld-form" data-palworld-cache-format="1" data-palworld-data-bytes="1">
            <fieldset id="palworld-controls" disabled>
                <div id="palworld-target-picker"></div>
                <div id="palworld-addons-summary"></div>
                <div class="palworld-trait-fields">
                    <select><option value="">No passive</option></select>
                    <select><option value="">No passive</option></select>
                    <select><option value="">No passive</option></select>
                    <select><option value="">No passive</option></select>
                </div>
                <div id="palworld-sources"></div>
                <button id="palworld-add-source" type="button">Add another owned Pal</button>
                <button id="palworld-find-route" type="submit">Find route</button>
            </fieldset>
        </form>
        <section class="palworld-results" data-route-state="empty" aria-busy="false" hidden>
            <h2 id="palworld-results-title" tabindex="-1">Breeding route result</h2>
            <p id="palworld-route-status"></p>
            <div id="palworld-route-tree"></div>
            <footer id="palworld-route-summary" hidden></footer>
            <section class="palworld-exclusions" hidden>
                <p id="palworld-excluded-empty">No helpers excluded.</p>
                <ul id="palworld-excluded-list"></ul>
            </section>
        </section>
        <span id="palworld-data-version"></span>
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
            buildDataset() {
                return {
                    version: 'test',
                    pals,
                    indexByKey: Object.fromEntries(pals.map((pal, index) => [pal.key, index])),
                };
            },
            findRoute(dataset, request) {
                window.__requests.push(JSON.parse(JSON.stringify(request)));
                const next = window.__routeResults.shift();
                if (!next) throw new Error('No queued test route.');
                if (next.kind === 'throw') throw new Error(next.message);
                return next.value;
            },
        };
        const payloads = {
            'palcalc-db.json': JSON.stringify({
                PassiveSkills: [{ Rank: 4, IsStandardPassiveSkill: true, LocalizedNames: { en: 'Swift' } }],
            }),
            'palcalc-breeding.json': '{}',
            'pal-thumbnails.json': JSON.stringify({
                image: '/sprite.png', cell: 48, columns: 3, rows: 1,
                sprites: {
                    lamball: { index: 0 }, cattiva: { index: 1 }, chikipi: { index: 2 },
                },
            }),
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

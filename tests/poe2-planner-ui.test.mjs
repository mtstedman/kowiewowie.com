import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';

const template = await readFile(new URL('../htdocs/path-of-exile-2/index.php', import.meta.url), 'utf8');
const styles = await readFile(new URL('../htdocs/assets/css/path-of-exile-2.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../htdocs/assets/js/path-of-exile-2/planner.js', import.meta.url), 'utf8');
const main = template.match(/<main class="poe2-page">[\s\S]*?<\/main>/)?.[0];
assert.ok(main, 'POE2 planner main template should be available to the browser fixture');
const script = `
const treeData = window.__poe2Modules.treeData;
const optimizer = window.__poe2Modules.optimizer;
const buildsApi = window.__poe2Modules.buildsApi;
const buildCode = window.__poe2Modules.buildCode;
const treeArt = window.__poe2Modules.treeArt;
${source.replace(/\/\/ @ts-ignore\nimport[^;]+;\n/g, '')}
`;

const routeSuccess = (nodeIds = ['target']) => ({ ok: true, exact: true, nodeIds, pointCost: { passive: nodeIds.length, ascendancy: 0 } });

async function planner(viewport = { width: 1280, height: 800 }) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.route('http://planner.test/**', (route) => route.fulfill({ body: '<!doctype html><title>Planner test</title>' }));
    await page.goto('http://planner.test/');
    await page.setContent(`
        <style>
            :root { --ink: #f5f5f5; --ink-soft: #d8d8d8; --muted: #a8a8a8; --surface-edge: #4a4a4a; --surface-edge-strong: #777; --surface-highlight: rgba(255,255,255,.12); }
            * { box-sizing: border-box; }
            html, body { margin: 0; background: #080d16; font-family: sans-serif; }
            body { overflow-x: hidden; }
            .page-shell { margin-inline: auto; }
            .public-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
            .eyebrow { color: #e7bd68; font-size: .75rem; text-transform: uppercase; }
            ${styles}
        </style>
        <div class="page-shell poe2-shell">${main}</div>
    `);
    await page.evaluate(() => {
        const nodes = [
            { id: 'root', name: 'Warrior start', kind: 'classStart', domain: 'passive', x: 0, y: 0, stats: [] },
            { id: 'target', name: 'Brute Strength', kind: 'small', domain: 'passive', x: 220, y: 0, stats: ['+5 to Strength'] },
            { id: 'second', name: 'Iron Path', kind: 'small', domain: 'passive', x: 440, y: 0, stats: ['+5% Armour'] },
        ];
        const data = { version: 'fixture', classes: [
            { id: 'warrior', name: 'Warrior', ascendancies: [{ id: 'titan', name: 'Titan' }] },
            { id: 'ranger', name: 'Ranger', ascendancies: [] },
        ] };
        const model = {
            nodes,
            edges: [['root', 'target'], ['target', 'second']],
            rootIds: ['root'],
            availableNodeIds(allocated) { const set = new Set(allocated); return new Set(set.has('target') ? ['second'] : ['target']); },
            validateAllocation() { return { valid: true }; },
            pointCost(allocated) { return { passive: allocated.length, ascendancy: 0 }; },
        };
        window.__routeResults = [];
        window.__poe2Modules = {
            treeData: {
                async loadTree() { return data; },
                buildAllocationModel() { return model; },
                summarizeRouteBonuses() { return { totals: [], unsummed: [], keystones: [], notables: [] }; },
            },
            optimizer: {
                findMinimalRoute() {
                    const next = window.__routeResults.shift();
                    if (!next) throw new Error('No queued fixture route.');
                    if (next.throw) throw new Error(next.throw);
                    return next;
                },
                findConnection(currentModel, allocated, nodeId) {
                    return { ok: true, nodeIds: nodeId === 'second' && !allocated.includes('target') ? ['target', 'second'] : [nodeId] };
                },
            },
            buildsApi: {
                async listBuilds() { return { builds: [], owner: 'guest', adoptedFromGuest: 0, guestBuildsRemaining: 0 }; },
                async createBuild(input) { return input; },
                async updateBuild(id, input) { return { id, ...input }; },
                async deleteBuild() {},
            },
            buildCode: {
                async encodeBuildCode() { return 'fixture-code'; },
                async decodeBuildCode() { throw new Error('Not used by this fixture.'); },
                extractBuildCode() { return null; },
            },
            treeArt: { TREE_ART: {
                scale: 1,
                images: {
                    background: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' },
                    groupBackground: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', w: 1, h: 1 },
                    frame: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', w: 1, h: 1 },
                    classes: {},
                },
                classes: {}, startRing: [0, 0, 1, 1], nodeIcons: {}, icons: [],
                frames: { PSSkillFrame: [0, 0, 1, 1], PSSkillFrameHighlighted: [0, 0, 1, 1], PSSkillFrameActive: [0, 0, 1, 1] },
            } },
        };
    });
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => !document.getElementById('poe2-build-controls').disabled);
    return { browser, page };
}

async function selectBySearch(page, name) {
    await page.locator('#poe2-node-query').fill(name);
    await page.locator('#poe2-search').evaluate((form) => form.requestSubmit());
    await page.waitForFunction((expected) => document.getElementById('poe2-details-title').textContent === expected, name);
}

async function queue(page, ...results) {
    await page.evaluate((items) => window.__routeResults.push(...items), results);
}

test('workflow copy, interaction guidance, and reset consequences are explicit', async (t) => {
    const { browser, page } = await planner();
    t.after(() => browser.close());

    assert.match(await page.locator('#poe2-build-title').textContent(), /Set up/);
    assert.match(await page.locator('#poe2-must-have-title').textContent(), /Compute/);
    assert.match(await page.locator('#poe2-build-reset-help').textContent(), /resets allocations, marked nodes, considered nodes, and the current route/);
    assert.equal(await page.locator('#poe2-tree').getAttribute('aria-describedby'), 'poe2-tree-guidance');
    const guidance = await page.locator('#poe2-tree-guidance').textContent();
    assert.match(guidance, /auto-connects a legal path/);
    assert.match(guidance, /removes it and any nodes left disconnected/);
    assert.match(guidance, /Enter or Space/);
    assert.match(guidance, /arrow keys to pan, \+\/− to zoom, and 0 to fit/);

    const geometry = await page.evaluate(() => {
        const left = document.querySelector('.poe2-controls').getBoundingClientRect();
        const center = document.querySelector('.poe2-tree-panel').getBoundingClientRect();
        const right = document.querySelector('.poe2-details').getBoundingClientRect();
        return { adjacent: left.right <= center.left + 2 && center.right <= right.left + 2, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    assert.deepEqual(geometry, { adjacent: true, overflow: false });
});

test('mobile selected-node actions stay reachable beside the tree without horizontal overflow', async (t) => {
    const { browser, page } = await planner({ width: 390, height: 844 });
    t.after(() => browser.close());

    await selectBySearch(page, 'Brute Strength');
    const actionArea = page.locator('.poe2-compact-actions');
    assert.equal(await actionArea.isVisible(), true);
    assert.equal(await page.locator('#poe2-compact-title').textContent(), 'Brute Strength');
    assert.deepEqual(await actionArea.getByRole('button').allTextContents(), ['Allocate', 'Must-have', 'Consider']);
    const reachability = await actionArea.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const tree = node.closest('.poe2-tree-panel').getBoundingClientRect();
        return {
            insideTree: box.top >= tree.top && box.bottom <= tree.bottom,
            touchTargets: [...node.querySelectorAll('button')].every((button) => button.getBoundingClientRect().height >= 44),
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
    });
    assert.deepEqual(reachability, { insideTree: true, touchTargets: true, overflow: false });
    await page.locator('#poe2-compact-toggle-must-have').click();
    assert.equal(await page.locator('#poe2-compact-toggle-must-have').getAttribute('aria-pressed'), 'true');
});

test('route action paints busy feedback, reports outcomes, and updates stale output', async (t) => {
    const { browser, page } = await planner();
    t.after(() => browser.close());

    await selectBySearch(page, 'Brute Strength');
    await page.locator('#poe2-toggle-must-have').click();
    await queue(page, routeSuccess());
    await page.locator('#poe2-find-route').click({ noWaitAfter: true });
    assert.equal(await page.locator('.poe2-must-haves').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#poe2-find-route').textContent(), 'Computing…');
    assert.equal(await page.locator('#poe2-find-route').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('poe2-route-status').textContent.startsWith('Shortest route found'));
    assert.equal(await page.locator('.poe2-must-haves').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#poe2-find-route').isEnabled(), true);

    await selectBySearch(page, 'Iron Path');
    await page.locator('#poe2-toggle-must-have').click();
    assert.equal(await page.locator('#poe2-find-route').textContent(), 'Update route');
    assert.match(await page.locator('#poe2-route-status').textContent(), /out of date/);
    assert.match(await page.locator('#poe2-route-summary').textContent(), /out of date/);

    await queue(page, routeSuccess(['target', 'second']));
    await page.locator('#poe2-find-route').click();
    await page.waitForFunction(() => document.getElementById('poe2-route-status').textContent.includes('2 nodes allocated'));
    assert.equal(await page.locator('#poe2-find-route').textContent(), 'Find route');
    assert.equal(await page.locator('#poe2-route-summary').getAttribute('class'), 'poe2-route-summary');

    await page.locator('#poe2-toggle-must-have').click();
    await queue(page, { ok: false, reason: 'Fixture route is impossible.' });
    await page.locator('#poe2-find-route').click();
    await page.waitForFunction(() => document.getElementById('poe2-route-status').textContent === 'Fixture route is impossible.');
    assert.equal(await page.locator('#poe2-route-status').getAttribute('class'), 'poe2-route-status is-error');
    assert.match(await page.locator('#poe2-status').textContent(), /Fixture route is impossible/);
    assert.equal(await page.locator('#poe2-find-route').isEnabled(), true);
});

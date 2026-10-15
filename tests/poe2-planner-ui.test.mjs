import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';

const template = await readFile(new URL('../htdocs/path-of-exile-2/index.php', import.meta.url), 'utf8');
const styles = await readFile(new URL('../htdocs/assets/css/path-of-exile-2.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../htdocs/assets/js/path-of-exile-2/planner.js', import.meta.url), 'utf8');
const inventorySource = await readFile(new URL('../htdocs/assets/js/path-of-exile-2/inventory.js', import.meta.url), 'utf8');
const buildCodeSource = await readFile(new URL('../htdocs/assets/js/path-of-exile-2/build-code.js', import.meta.url), 'utf8');
const main = template.match(/<main class="poe2-page">[\s\S]*?<\/main>/)?.[0];
assert.ok(main, 'POE2 planner main template should be available to the browser fixture');
const executableInventory = inventorySource.replaceAll('export class ', 'class ').replaceAll('export function ', 'function ');
const executableBuildCode = buildCodeSource
    .replace(/\/\/ @ts-ignore\nimport[^;]+;\n/g, '')
    .replaceAll('export class ', 'class ')
    .replaceAll('export async function ', 'async function ')
    .replaceAll('export function ', 'function ');
const script = `
const inventoryModule = (() => {
    ${executableInventory}
    return { InventoryError, normalizeInventory, calculateInventoryStats };
})();
const buildCode = (() => {
    ${executableBuildCode}
    return { BuildCodeError, encodeBuildCode, decodeBuildCode, extractBuildCode };
})();
window.__poe2BuildCode = buildCode;
const treeData = window.__poe2Modules.treeData;
const optimizer = window.__poe2Modules.optimizer;
const buildsApi = window.__poe2Modules.buildsApi;
const treeArt = window.__poe2Modules.treeArt;
${source.replace(/\/\/ @ts-ignore\nimport[^;]+;\n/g, '')}
`;

const routeSuccess = (nodeIds = ['target']) => ({ ok: true, exact: true, nodeIds, pointCost: { passive: nodeIds.length, ascendancy: 0 } });

async function planner(viewport = { width: 1280, height: 800 }) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
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
            { id: 'target', name: 'Brute Strength', kind: 'small', domain: 'passive', x: 220, y: 0, stats: ['10% increased Physical Damage', 'Gain 5 Rage on Hit'] },
            { id: 'second', name: 'Iron Path', kind: 'small', domain: 'passive', x: 440, y: 0, stats: ['20% increased Armour'] },
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
        window.__savedBuilds = [];
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
                async listBuilds() { return { builds: structuredClone(window.__savedBuilds), owner: 'guest', adoptedFromGuest: 0, guestBuildsRemaining: 0 }; },
                async createBuild(input) {
                    const build = { ...structuredClone(input), id: 'build-' + (window.__savedBuilds.length + 1), owner: 'guest', updated_at: new Date().toISOString() };
                    window.__savedBuilds.unshift(build);
                    return structuredClone(build);
                },
                async updateBuild(id, input) {
                    const build = { ...structuredClone(input), id, owner: 'guest', updated_at: new Date().toISOString() };
                    window.__savedBuilds = [build, ...window.__savedBuilds.filter((candidate) => candidate.id !== id)];
                    return structuredClone(build);
                },
                async deleteBuild(id) { window.__savedBuilds = window.__savedBuilds.filter((build) => build.id !== id); },
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
    try {
        await page.waitForFunction(() => !document.getElementById('poe2-build-controls').disabled, null, { timeout: 5000 });
    } catch (error) {
        await browser.close();
        throw new Error(`Planner fixture did not initialize: ${pageErrors.join(' | ') || error.message}`);
    }
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


async function addEquipment(page, label, slot, values = {}) {
    await page.getByRole('button', { name: `Add item to ${label}` }).click();
    const form = page.locator(`.poe2-inventory-form[data-slot="${slot}"]`);
    if (values.name !== undefined) await form.locator('[name="name"]').fill(values.name);
    if (values.armour !== undefined) await form.locator('[name="armour"]').fill(String(values.armour));
    if (values.evasion !== undefined) await form.locator('[name="evasion"]').fill(String(values.evasion));
    if (values.energyShield !== undefined) await form.locator('[name="energy_shield"]').fill(String(values.energyShield));
    if (values.weapon) {
        await form.locator('[name="has_weapon"]').check();
        await form.locator('[name="physical_min"]').fill(String(values.weapon.minimum));
        await form.locator('[name="physical_max"]').fill(String(values.weapon.maximum));
        await form.locator('[name="attacks_per_second"]').fill(String(values.weapon.speed));
    }
    await form.getByRole('button', { name: 'Apply values' }).click();
    return form;
}

async function comparisonValues(page, metric) {
    return page.locator('#poe2-inventory-comparison tbody tr').filter({ hasText: metric }).locator('td').allTextContents();
}

test('equipment edits, allocated passives, save/load, and share/import stay joined', async (t) => {
    const { browser, page } = await planner();
    t.after(() => browser.close());

    await addEquipment(page, 'Body armour', 'body_armour', { name: '<Plate & Mail>', armour: 100, evasion: 25, energyShield: 10 });
    await addEquipment(page, 'Main hand', 'main_hand', {
        name: 'Training Axe',
        weapon: { minimum: 10, maximum: 20, speed: 2 },
    });
    assert.deepEqual(await comparisonValues(page, 'Armour'), ['100', '100', '0']);
    assert.deepEqual(await comparisonValues(page, 'Physical DPS'), ['30', '30', '0']);
    assert.equal(await page.locator('.poe2-inventory-slot img').count(), 0, 'item names must stay text-safe');
    const armourInput = page.locator('.poe2-inventory-form[data-slot="body_armour"] [name="armour"]');
    await armourInput.fill('');
    assert.match(await page.locator('#poe2-inventory-status').textContent(), /last valid estimate/i);
    assert.deepEqual(await comparisonValues(page, 'Armour'), ['100', '100', '0']);
    await armourInput.fill('100');

    await selectBySearch(page, 'Brute Strength');
    await page.locator('#poe2-toggle-must-have').click();
    assert.deepEqual(await comparisonValues(page, 'Physical DPS'), ['30', '30', '0']);
    await page.locator('#poe2-toggle-must-have').click();
    await page.locator('#poe2-toggle-node').click();
    await selectBySearch(page, 'Iron Path');
    await page.locator('#poe2-toggle-node').click();
    assert.deepEqual(await comparisonValues(page, 'Armour'), ['100', '120', '+20']);
    assert.deepEqual(await comparisonValues(page, 'Physical DPS'), ['30', '33', '+3']);
    assert.match(await page.locator('#poe2-inventory-sources').textContent(), /Brute Strength: 10% increased Physical Damage/);
    assert.match(await page.locator('#poe2-inventory-sources').textContent(), /Brute Strength: Gain 5 Rage on Hit/);

    await page.locator('#poe2-toggle-node').click();
    await selectBySearch(page, 'Brute Strength');
    await page.locator('#poe2-toggle-node').click();
    assert.deepEqual(await comparisonValues(page, 'Armour'), ['100', '100', '0']);
    assert.deepEqual(await comparisonValues(page, 'Physical DPS'), ['30', '30', '0']);

    const bodySlot = page.locator('.poe2-inventory-form[data-slot="body_armour"]').locator('..');
    await bodySlot.getByRole('button', { name: /Unequip/ }).click();
    assert.deepEqual(await comparisonValues(page, 'Armour'), ['0', '0', '0']);
    await bodySlot.getByRole('button', { name: /Equip/ }).click();

    await page.locator('summary').filter({ hasText: 'Saved builds' }).click();
    await page.locator('#poe2-character-name').fill('Fixture hero');
    await page.locator('#poe2-build-name').fill('Equipment build');
    await page.locator('#poe2-saved-build-form').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => window.__savedBuilds.length === 1);
    assert.equal(await page.evaluate(() => window.__savedBuilds[0].inventory.length), 2);

    await page.locator('.poe2-inventory-form[data-slot="body_armour"]').locator('..').getByRole('button', { name: /Remove/ }).click();
    await page.locator('.poe2-inventory-form[data-slot="main_hand"]').locator('..').getByRole('button', { name: /Remove/ }).click();
    await page.getByRole('button', { name: /Load Equipment build/ }).click();
    assert.equal(await page.locator('.poe2-inventory-form[data-slot="body_armour"] [name="armour"]').inputValue(), '100');
    assert.deepEqual(await comparisonValues(page, 'Physical DPS'), ['30', '30', '0']);

    await page.locator('summary').filter({ hasText: 'Share build' }).click();
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { async writeText(text) { window.__copiedBuild = text; } },
        });
    });
    await page.locator('#poe2-copy-code').click();
    await page.waitForFunction(() => typeof window.__copiedBuild === 'string'
        || document.getElementById('poe2-import-code').value.startsWith('poe2b1.'));
    const code = await page.evaluate(() => window.__copiedBuild || document.getElementById('poe2-import-code').value);
    assert.match(code, /^poe2b1\./);
    await page.locator('.poe2-inventory-form[data-slot="body_armour"]').locator('..').getByRole('button', { name: /Remove/ }).click();
    await page.locator('#poe2-import-code').fill(code);
    await page.locator('#poe2-import-build').click();
    await page.waitForFunction(() => document.querySelector('.poe2-inventory-form[data-slot="body_armour"]'));
    assert.equal(await page.locator('.poe2-inventory-form[data-slot="body_armour"] [name="armour"]').inputValue(), '100');
});

test('legacy and malformed imports handle equipment safely on mobile', async (t) => {
    const { browser, page } = await planner({ width: 390, height: 844 });
    t.after(() => browser.close());

    const addBody = page.getByRole('button', { name: 'Add item to Body armour' });
    await addBody.focus();
    await page.keyboard.press('Enter');
    const bodyForm = page.locator('.poe2-inventory-form[data-slot="body_armour"]');
    await bodyForm.locator('[name="armour"]').fill('75');
    await bodyForm.getByRole('button', { name: 'Apply values' }).click();

    const legacy = await page.evaluate(() => window.__poe2BuildCode.encodeBuildCode({
        class_id: 'warrior',
        ascendancy_id: null,
        tree_version: 'fixture',
        allocated_node_ids: [],
        must_have_node_ids: [],
        considered_node_ids: [],
        character_name: '',
        build_name: '',
    }));
    await page.locator('summary').filter({ hasText: 'Share build' }).click();
    await page.locator('#poe2-import-code').fill(legacy);
    await page.locator('#poe2-import-build').click();
    await page.waitForFunction(() => !document.querySelector('.poe2-inventory-form[data-slot="body_armour"]'));
    assert.match(await page.locator('#poe2-inventory-comparison').textContent(), /No equipment entered/);
    assert.match(await page.locator('#poe2-inventory-comparison').textContent(), /No equipped main-hand weapon/);

    await addEquipment(page, 'Body armour', 'body_armour', { armour: 75 });
    const malformed = await page.evaluate(async () => {
        const payload = {
            v: 1, c: 'warrior', a: null, t: 'fixture', n: [], m: [], k: [],
            i: [{ slot: 'helmet' }],
        };
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        const compressed = new Uint8Array(await new Response(
            new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')),
        ).arrayBuffer());
        let binary = '';
        for (const byte of compressed) binary += String.fromCharCode(byte);
        return 'poe2b1.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    });
    await page.locator('#poe2-import-code').fill(malformed);
    await page.locator('#poe2-import-build').click();
    await page.waitForFunction(() => document.getElementById('poe2-share-status').classList.contains('is-error'));
    assert.match(await page.locator('#poe2-share-status').textContent(), /invalid inventory/i);
    assert.equal(await page.locator('.poe2-inventory-form[data-slot="body_armour"] [name="armour"]').inputValue(), '75');
    assert.deepEqual(await comparisonValues(page, 'Armour'), ['75', '75', '0']);

    const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        touchTargets: [...document.querySelectorAll('.poe2-inventory button')]
            .every((button) => button.getBoundingClientRect().height >= 44),
    }));
    assert.deepEqual(layout, { overflow: false, touchTargets: true });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { BuildCodeError, decodeBuildCode, encodeBuildCode, extractBuildCode } from '../htdocs/assets/js/path-of-exile-2/build-code.js';

const INVENTORY = Object.freeze([
  Object.freeze({
    slot: 'main_hand', name: 'Ashen Staff', equipped: true, armour: 0, evasion: 0, energy_shield: 12,
    weapon: Object.freeze({ physical_min: 18, physical_max: 31, attacks_per_second: 1.25 }),
  }),
  Object.freeze({
    slot: 'body_armour', name: 'Spare Robe', equipped: false, armour: 7, evasion: 11, energy_shield: 43,
    weapon: null,
  }),
]);

const BUILD = Object.freeze({
  class_id: 'Witch',
  ascendancy_id: 'Witch1',
  tree_version: '0.5.5',
  allocated_node_ids: ['36302', '2254', '10694'],
  must_have_node_ids: ['36302'],
  considered_node_ids: ['55835', '4739'],
  character_name: 'Ashka',
  build_name: 'Infernal caster',
  inventory: INVENTORY,
});

const ITEM = Object.freeze({
  slot: 'helmet', name: 'Iron Crown', equipped: true, armour: 20, evasion: 0, energy_shield: 5, weapon: null,
});

const rejects = (promise, pattern) => assert.rejects(promise, (error) => error instanceof BuildCodeError && pattern.test(error.message));

/** A raw code around arbitrary JSON, for malformed-payload cases. */
async function codeFor(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const deflated = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let binary = '';
  for (const byte of deflated) binary += String.fromCharCode(byte);
  return `poe2b1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

test('a build survives encoding, as a bare code or inside a share link', async () => {
  const code = await encodeBuildCode(BUILD);
  assert.match(code, /^poe2b1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeBuildCode(code), BUILD);
  assert.deepEqual(await decodeBuildCode(`  https://wowiekowie.com/path-of-exile-2/#build=${code}\n`), BUILD);
  assert.deepEqual(await decodeBuildCode(`https://wowiekowie.com/path-of-exile-2/?x=1&build=${code}`), BUILD);
});

test('a large build stays short enough to send as a link', async () => {
  const allocated = Array.from({ length: 130 }, (_, index) => String(10000 + index * 397));
  const code = await encodeBuildCode({ ...BUILD, allocated_node_ids: allocated });
  assert.ok(code.length < 1200, `code length ${code.length}`);
  assert.deepEqual((await decodeBuildCode(code)).allocated_node_ids, allocated);
});

test('empty inventories and legacy links decode with an empty inventory', async () => {
  assert.deepEqual((await decodeBuildCode(await encodeBuildCode({ ...BUILD, inventory: [] }))).inventory, []);
  const legacy = await codeFor({ v: 1, t: '0.5.5', c: 'Witch', n: ['1'], m: [], k: [] });
  assert.deepEqual((await decodeBuildCode(legacy)).inventory, []);
});

test('optional fields default and names are kept only when clean', async () => {
  const decoded = await decodeBuildCode(await codeFor({ v: 1, c: 'Ranger', bn: 'x'.repeat(81), cn: 'Line\nbreak' }));
  assert.deepEqual(decoded, {
    class_id: 'Ranger', ascendancy_id: null, tree_version: '', allocated_node_ids: [], must_have_node_ids: [],
    considered_node_ids: [], character_name: '', build_name: '', inventory: [],
  });
});

test('duplicates collapse and a must-have is never also considered', async () => {
  const decoded = await decodeBuildCode(await codeFor({ v: 1, c: 'Witch', n: ['1', '1', '2'], m: ['3'], k: ['3', '4'] }));
  assert.deepEqual(decoded.allocated_node_ids, ['1', '2']);
  assert.deepEqual(decoded.considered_node_ids, ['4']);
});

test('text that is not a code is refused before decoding', async () => {
  assert.equal(extractBuildCode('https://example.com/'), null);
  await rejects(decodeBuildCode(''), /Paste a build code/);
  await rejects(decodeBuildCode('hello'), /Paste a build code/);
  await rejects(decodeBuildCode('poe2b1.not*base64'), /characters a code never has/);
  await rejects(decodeBuildCode('poe2b1.AAAA'), /damaged/);
  await rejects(decodeBuildCode(`poe2b1.${'A'.repeat(20000)}`), /too large/);
});

test('payloads that fail validation are refused', async () => {
  await rejects(decodeBuildCode(await codeFor('not json')), /damaged/);
  await rejects(decodeBuildCode(await codeFor([1, 2])), /unsupported version/);
  await rejects(decodeBuildCode(await codeFor({ v: 2, c: 'Witch' })), /unsupported version/);
  await rejects(decodeBuildCode(await codeFor({ v: 1 })), /names no class/);
  await rejects(decodeBuildCode(await codeFor({ v: 1, c: 'Witch', a: 7 })), /invalid ascendancy/);
  await rejects(decodeBuildCode(await codeFor({ v: 1, c: 'Witch', n: ['ok', 'bad id'] })), /invalid allocation list/);
  await rejects(decodeBuildCode(await codeFor({ v: 1, c: 'Witch', m: 'x' })), /invalid must-have list/);
  await rejects(decodeBuildCode(await codeFor({ v: 1, c: 'Witch', k: Array.from({ length: 2049 }, (_, i) => String(i)) })), /invalid considered list/);
});

test('invalid inventory payloads are refused through BuildCodeError', async () => {
  const invalid = [
    null,
    Array.from({ length: 11 }, (_, index) => ({ ...ITEM, slot: index === 0 ? 'helmet' : `slot_${index}` })),
    [{ ...ITEM, equipped: 'yes' }],
    [{ ...ITEM, name: 'x'.repeat(81) }],
    [{ ...ITEM, armour: -1 }],
    [ITEM, { ...ITEM }],
    [{ ...ITEM, slot: 'helmet', weapon: { physical_min: 1, physical_max: 2, attacks_per_second: 1 } }],
    [{ ...ITEM, slot: 'main_hand', weapon: { physical_min: 3, physical_max: 2, attacks_per_second: 0 } }],
  ];
  for (const inventory of invalid) {
    await rejects(decodeBuildCode(await codeFor({ v: 1, c: 'Witch', i: inventory })), /invalid inventory/);
  }
  await rejects(encodeBuildCode({ ...BUILD, inventory: [{ ...ITEM, evasion: Infinity }] }), /invalid inventory/);
});

test('encoding refuses a payload that its decoder size bound would reject', async () => {
  const allocated = Array.from({ length: 2048 }, (_, index) => `${index.toString(36).padStart(4, '0')}${'x'.repeat(28)}`);
  await rejects(encodeBuildCode({ ...BUILD, allocated_node_ids: allocated }), /too large/);
});

test('a code that inflates past the size limit is refused while inflating', async () => {
  // About 1 MB of JSON compresses to a code well under the code-length limit.
  const bomb = await codeFor({ v: 1, c: 'Witch', bn: 'a'.repeat(1_000_000) });
  assert.ok(bomb.length < 16_384, `bomb code length ${bomb.length}`);
  await rejects(decodeBuildCode(bomb), /too large/);
});

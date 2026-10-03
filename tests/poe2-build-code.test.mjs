import assert from 'node:assert/strict';
import test from 'node:test';
import { BuildCodeError, decodeBuildCode, encodeBuildCode, extractBuildCode } from '../htdocs/assets/js/path-of-exile-2/build-code.js';

const BUILD = Object.freeze({
  class_id: 'Witch',
  ascendancy_id: 'Witch1',
  tree_version: '0.5.5',
  allocated_node_ids: ['36302', '2254', '10694'],
  must_have_node_ids: ['36302'],
  considered_node_ids: ['55835', '4739'],
  character_name: 'Ashka',
  build_name: 'Infernal caster',
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

test('optional fields default and names are kept only when clean', async () => {
  const decoded = await decodeBuildCode(await codeFor({ v: 1, c: 'Ranger', bn: 'x'.repeat(81), cn: 'Line\nbreak' }));
  assert.deepEqual(decoded, {
    class_id: 'Ranger', ascendancy_id: null, tree_version: '', allocated_node_ids: [], must_have_node_ids: [],
    considered_node_ids: [], character_name: '', build_name: '',
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

test('a code that inflates past the size limit is refused while inflating', async () => {
  // About 1 MB of JSON compresses to a code well under the code-length limit.
  const bomb = await codeFor({ v: 1, c: 'Witch', bn: 'a'.repeat(1_000_000) });
  assert.ok(bomb.length < 16_384, `bomb code length ${bomb.length}`);
  await rejects(decodeBuildCode(bomb), /too large/);
});

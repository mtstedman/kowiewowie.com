import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { buildTreeArt, MANIFEST_PATH } from '../database/build-poe2-tree-art.mjs';
import { TREE_ART } from '../htdocs/assets/js/path-of-exile-2/tree-art.js';

const DESCRIPTOR_DIR = new URL('../database/data/poe2-passive-tree/assets/', import.meta.url);
const IMAGE_DIR = new URL('../htdocs/assets/img/path-of-exile-2/', import.meta.url);
const pins = JSON.parse(readFileSync(new URL('art-source.json', DESCRIPTOR_DIR), 'utf8'));
const sha256 = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');

test('the committed art manifest matches what the generator builds', () => {
  assert.equal(readFileSync(MANIFEST_PATH, 'utf8'), buildTreeArt(), 'run node database/build-poe2-tree-art.mjs');
});

test('every vendored sheet and descriptor is pinned and unmodified', () => {
  const served = readdirSync(IMAGE_DIR).filter((file) => file.endsWith('.webp'));
  const descriptors = readdirSync(DESCRIPTOR_DIR).filter((file) => file.endsWith('.json') && file !== 'art-source.json');
  assert.deepEqual([...served, ...descriptors].sort(), Object.keys(pins.files).sort());
  for (const file of served) assert.equal(sha256(new URL(file, IMAGE_DIR)), pins.files[file], file);
  for (const file of descriptors) assert.equal(sha256(new URL(file, DESCRIPTOR_DIR)), pins.files[file], file);
});

test('manifest image URLs are same-origin and carry their content hash', () => {
  const images = [
    TREE_ART.images.skills, TREE_ART.images.skillsDisabled, TREE_ART.images.frame,
    TREE_ART.images.groupBackground, TREE_ART.images.background, ...Object.values(TREE_ART.images.classes),
  ];
  for (const image of images) {
    const match = /^\/assets\/img\/path-of-exile-2\/([a-z-]+\.webp)\?v=([0-9a-f]{12})$/.exec(image.url);
    assert.ok(match, image.url);
    assert.equal(match[2], pins.files[match[1]].slice(0, 12), image.url);
  }
});

test('every drawable passive in the export has an icon, and every icon fits its sheet', () => {
  const data = JSON.parse(readFileSync(new URL('../database/data/poe2-passive-tree/data.json', import.meta.url), 'utf8'));
  const missing = Object.entries(data.nodes)
    .filter(([, node]) => node.id !== null && node.icon && !node.isMastery && !node.isJewelSocket && !node.isAscendancyStart
      && !(Array.isArray(node.classStartIndex) && node.classStartIndex.length > 0))
    .filter(([key]) => TREE_ART.nodeIcons[key] === undefined)
    .map(([key]) => key);
  assert.deepEqual(missing, []);
  const { w, h } = TREE_ART.images.skills;
  for (const [x, y, iconW, iconH] of TREE_ART.icons) assert.ok(x + iconW <= w && y + iconH <= h);
});

test('every playable class and ascendancy has art and a recorded cluster centre', () => {
  const data = JSON.parse(readFileSync(new URL('../database/data/poe2-passive-tree/data.json', import.meta.url), 'utf8'));
  for (const option of data.classes.filter((entry) => (entry.ascendancies || []).length > 0)) {
    const art = TREE_ART.classes[option.name];
    assert.ok(art, `${option.name} has class art`);
    for (const ascendancy of option.ascendancies) {
      const placed = art.ascendancies[ascendancy.id];
      assert.ok(placed, `${ascendancy.id} has art`);
      // Export coordinates put each cluster beyond the main tree; the planner moves it to the origin.
      assert.ok(Math.hypot(placed.x, placed.y) > 12000, `${ascendancy.id} records its cluster centre`);
    }
  }
});

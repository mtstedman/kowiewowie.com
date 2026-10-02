#!/usr/bin/env node
// Builds htdocs/assets/js/path-of-exile-2/tree-art.js, the planner's art manifest, from the
// pinned GGG export (data.json) and the sprite-sheet descriptors vendored beside it. The
// sheets themselves are served unmodified from htdocs/assets/img/path-of-exile-2/.
//
//   node database/build-poe2-tree-art.mjs          write the manifest
//   node database/build-poe2-tree-art.mjs --check  exit 1 when the committed manifest is stale

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const DATA_DIR = new URL('database/data/poe2-passive-tree/', ROOT);
const DESCRIPTOR_DIR = new URL('assets/', DATA_DIR);
const IMAGE_DIR = new URL('htdocs/assets/img/path-of-exile-2/', ROOT);
const IMAGE_URL = '/assets/img/path-of-exile-2/';
export const MANIFEST_PATH = new URL('htdocs/assets/js/path-of-exile-2/tree-art.js', ROOT);

// Frames the planner draws, by node family and allocation state.
const FRAME_NAMES = [
  'PSSkillFrame', 'PSSkillFrameHighlighted', 'PSSkillFrameActive',
  'NotableFrameUnallocated', 'NotableFrameCanAllocate', 'NotableFrameAllocated',
  'KeystoneFrameUnallocated', 'KeystoneFrameCanAllocate', 'KeystoneFrameAllocated',
  'JewelFrameUnallocated', 'JewelFrameCanAllocate', 'JewelFrameAllocated',
  'AscendancyFrameNormalUnallocated', 'AscendancyFrameNormalCanAllocate', 'AscendancyFrameNormalAllocated',
  'AscendancyFrameNotableUnallocated', 'AscendancyFrameNotableCanAllocate', 'AscendancyFrameNotableAllocated',
  'AscendancyStartNode',
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rect = ({ frame }) => [frame.x, frame.y, frame.w, frame.h];
const round = (value) => Math.round(value * 10) / 10;

function fail(message) {
  throw new Error(`PoE2 tree art: ${message}`);
}

function verifiedBytes(dir, file, pins) {
  const bytes = readFileSync(new URL(file, dir));
  if (!pins[file]) fail(`${file} is not pinned in assets/art-source.json.`);
  if (sha256(bytes) !== pins[file]) fail(`${file} does not match its pinned SHA-256.`);
  return bytes;
}

function loadSheet(name, pins) {
  const descriptor = JSON.parse(verifiedBytes(DESCRIPTOR_DIR, `${name}.json`, pins).toString('utf8'));
  const image = verifiedBytes(IMAGE_DIR, descriptor.meta.image, pins);
  if (descriptor.meta.image !== `${name}.webp`) fail(`${name}.json describes ${descriptor.meta.image}.`);
  if (Number(descriptor.meta.scale) !== 0.5) fail(`${name}.json has scale ${descriptor.meta.scale}; the planner assumes 0.5.`);
  return {
    frames: descriptor.frames,
    image: {
      url: `${IMAGE_URL}${descriptor.meta.image}?v=${sha256(image).slice(0, 12)}`,
      w: descriptor.meta.size.w,
      h: descriptor.meta.size.h,
    },
  };
}

function iconCategory(node) {
  if (node.isKeystone) return 'keystone';
  if (node.isNotable) return 'notable';
  return 'normal';
}

function drawsIcon(node) {
  return node.id !== null && !node.isMastery && !node.isJewelSocket && !node.isAscendancyStart
    && !(Array.isArray(node.classStartIndex) && node.classStartIndex.length > 0) && Boolean(node.icon);
}

/** @returns {string} the manifest module source */
export function buildTreeArt() {
  const pins = JSON.parse(readFileSync(new URL('art-source.json', DESCRIPTOR_DIR), 'utf8'));
  const source = JSON.parse(readFileSync(new URL('source.json', DATA_DIR), 'utf8'));
  if (pins.commit !== source.commit) fail('art-source.json and source.json pin different upstream commits.');
  const data = JSON.parse(verifiedBytes(DATA_DIR, 'data.json', { 'data.json': source.sha256 }).toString('utf8'));

  const skills = loadSheet('skills', pins.files);
  const skillsDisabled = loadSheet('skills-disabled', pins.files);
  const frame = loadSheet('frame', pins.files);
  const groupBackground = loadSheet('group-background', pins.files);
  const background = loadSheet('background', pins.files);

  // One rectangle per icon serves both sheets: the inactive sheet repeats the active layout.
  const icons = [];
  const iconIndex = new Map();
  const nodeIcons = {};
  for (const key of Object.keys(data.nodes).sort((a, b) => Number(a) - Number(b))) {
    const node = data.nodes[key];
    if (!drawsIcon(node)) continue;
    const category = iconCategory(node);
    const active = skills.frames[`${category}Active:${node.icon}`];
    const inactive = skillsDisabled.frames[`${category}Inactive:${node.icon}`];
    if (!active || !inactive) fail(`node ${key} icon ${node.icon} is missing from the ${category} sheets.`);
    if (JSON.stringify(active.frame) !== JSON.stringify(inactive.frame)) fail(`node ${key} icon differs between sheets.`);
    const iconKey = `${category}:${node.icon}`;
    if (!iconIndex.has(iconKey)) {
      iconIndex.set(iconKey, icons.length);
      icons.push(rect(active));
    }
    nodeIcons[key] = iconIndex.get(iconKey);
  }

  const frames = {};
  for (const name of FRAME_NAMES) {
    const entry = frame.frames[`frame:${name}`];
    if (!entry) fail(`frame.json has no ${name}.`);
    frames[name] = rect(entry);
  }
  const startRing = groupBackground.frames['startNode:MainCircle'];
  const backgroundTile = background.frames['background:Background2'];
  if (!startRing || !backgroundTile) fail('the start ring or background tile frame is missing.');

  // Class sheets hold the base illustration as Class0, then each ascendancy in export order,
  // each pre-cut to a circle that fills the start ring at the tree origin. For an ascendancy
  // the manifest also records its cluster centre in export coordinates (start node moved by
  // the ascendancy offset); the planner draws the cluster moved so that point is the origin.
  const startById = new Map(Object.entries(data.nodes)
    .filter(([, node]) => node.isAscendancyStart && node.ascendancyId)
    .map(([, node]) => [node.ascendancyId, node]));
  const classSheets = {};
  const classes = {};
  for (const option of data.classes) {
    const file = `background-${option.name.toLowerCase()}`;
    if (!pins.files[`${file}.json`]) continue;
    const sheet = loadSheet(file, pins.files);
    const frameFor = (index) => sheet.frames[`class${option.name}:Class${index}`];
    if (!frameFor(0)) fail(`${file}.json has no base illustration.`);
    classSheets[option.name] = sheet.image;
    const ascendancies = {};
    const byId = new Map((option.ascendancies || []).map((ascendancy) => [ascendancy.id, ascendancy]));
    for (const [index, ascendancy] of (option.ascendancies || []).entries()) {
      const art = frameFor(index + 1);
      // An ascendancy without nodes (e.g. Abyssal Lich) overrides a sibling's nodes and is
      // drawn over that sibling's cluster, matching tree-data.js's host resolution.
      let host = ascendancy;
      if (!startById.has(ascendancy.id)) {
        const hosts = new Set(Object.keys(ascendancy.overridePairs || {}).map((key) => data.nodes[key]?.ascendancyId));
        const [onlyHost] = hosts;
        host = hosts.size === 1 && byId.has(onlyHost) ? byId.get(onlyHost) : null;
      }
      const start = host && startById.get(host.id);
      if (!art || !start) continue;
      ascendancies[ascendancy.id] = {
        rect: rect(art),
        x: round(start.x + Number(host.offsetX || 0)),
        y: round(start.y + Number(host.offsetY || 0)),
      };
    }
    classes[option.name] = { base: { rect: rect(frameFor(0)) }, ascendancies };
  }

  const manifest = {
    version: source.version,
    commit: source.commit,
    // Sheet pixels per world unit: a 34px icon covers 68 world units.
    scale: 0.5,
    images: {
      skills: skills.image,
      skillsDisabled: skillsDisabled.image,
      frame: frame.image,
      groupBackground: groupBackground.image,
      background: background.image,
      classes: classSheets,
    },
    frames,
    startRing: rect(startRing),
    backgroundTile: rect(backgroundTile),
    classes,
    icons,
    nodeIcons,
  };
  return [
    '// Generated by database/build-poe2-tree-art.mjs from the pinned GGG passive-tree export.',
    '// Do not edit: run `node database/build-poe2-tree-art.mjs` after changing the pinned art.',
    `export const TREE_ART = Object.freeze(${JSON.stringify(manifest)});`,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = buildTreeArt();
  if (process.argv.includes('--check')) {
    const current = readFileSync(MANIFEST_PATH, 'utf8');
    if (current !== text) {
      console.error('tree-art.js is stale; run node database/build-poe2-tree-art.mjs');
      process.exit(1);
    }
    console.log('tree-art.js is up to date.');
  } else {
    writeFileSync(MANIFEST_PATH, text);
    console.log(`wrote ${fileURLToPath(MANIFEST_PATH)} (${text.length} bytes)`);
  }
}

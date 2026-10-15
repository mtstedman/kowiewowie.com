/**
 * Equipment data and passive-aware estimates for the Path of Exile 2 planner.
 *
 * These calculations intentionally start with the values displayed on equipped
 * items. They do not include character base stats, skills, enemies, or other
 * parts of the game simulation.
 */

/** @typedef {'main_hand'|'off_hand'|'helmet'|'body_armour'|'gloves'|'boots'|'belt'|'amulet'|'ring_1'|'ring_2'} InventorySlot */
/** @typedef {{physical_min: number, physical_max: number, attacks_per_second: number}} InventoryWeapon */
/** @typedef {{slot: InventorySlot, name: string, equipped: boolean, armour: number, evasion: number,
 *   energy_shield: number, weapon: InventoryWeapon|null}} InventoryItem */
/** @typedef {'armour'|'evasion'|'energy_shield'|'physical_min'|'physical_max'|'attacks_per_second'|'physical_dps'} MetricKey */
/** @typedef {{id: string, name: string, stats: string[], kind: string}} PassiveNode */
/** @typedef {{node_id: string, node_name: string, text: string}} ModifierSource */
/** @typedef {{key: MetricKey, baseline: number|null, total: number|null, delta: number|null}} InventoryMetric */
/** @typedef {{metrics: InventoryMetric[], applied: ModifierSource[], unsupported: ModifierSource[]}} InventoryComparison */

/** @type {Set<InventorySlot>} */
const INVENTORY_SLOTS = new Set([
  'main_hand',
  'off_hand',
  'helmet',
  'body_armour',
  'gloves',
  'boots',
  'belt',
  'amulet',
  'ring_1',
  'ring_2',
]);

const ITEM_FIELDS = ['slot', 'name', 'equipped', 'armour', 'evasion', 'energy_shield', 'weapon'];
const WEAPON_FIELDS = ['physical_min', 'physical_max', 'attacks_per_second'];
const MAX_ITEM_VALUE = 1_000_000;
const MAX_ATTACKS_PER_SECOND = 100;
const CONTROL_CHARACTER = /\p{Cc}/u;

/** @type {MetricKey[]} */
const METRIC_KEYS = [
  'armour',
  'evasion',
  'energy_shield',
  'physical_min',
  'physical_max',
  'attacks_per_second',
  'physical_dps',
];

const DEFENSE_KEYS = ['armour', 'evasion', 'energy_shield'];

/** An invalid inventory payload. */
export class InventoryError extends Error {
  constructor(message) {
    super(`PoE2 inventory: ${message}`);
    this.name = 'InventoryError';
  }
}

/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new InventoryError(message);
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireExactFields(value, fields, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown field "${key}".`);
  }
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) fail(`${label} is missing field "${key}".`);
  }
}

function finiteNumber(value, label, maximum, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number.`);
  }
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer.`);
  if (value < 0 || value > maximum) fail(`${label} must be between 0 and ${maximum}.`);
  return value;
}

function normalizeWeapon(value, slot, label) {
  if (value === null) return null;
  if (slot !== 'main_hand') fail(`${label} may only be set for the main_hand slot.`);
  requireExactFields(value, WEAPON_FIELDS, label);
  const physicalMin = finiteNumber(value.physical_min, `${label}.physical_min`, MAX_ITEM_VALUE, true);
  const physicalMax = finiteNumber(value.physical_max, `${label}.physical_max`, MAX_ITEM_VALUE, true);
  const attacksPerSecond = finiteNumber(
    value.attacks_per_second,
    `${label}.attacks_per_second`,
    MAX_ATTACKS_PER_SECOND,
  );
  if (attacksPerSecond === 0) fail(`${label}.attacks_per_second must be greater than 0.`);
  if (physicalMin > physicalMax) fail(`${label}.physical_min must not exceed physical_max.`);
  return {
    physical_min: physicalMin,
    physical_max: physicalMax,
    attacks_per_second: attacksPerSecond,
  };
}

/**
 * Validate and copy persisted equipment data.
 *
 * @param {unknown} value
 * @returns {InventoryItem[]}
 */
export function normalizeInventory(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('inventory must be an array.');
  const items = /** @type {unknown[]} */ (value);
  if (items.length > INVENTORY_SLOTS.size) fail('inventory may contain at most 10 items.');

  /** @type {Set<InventorySlot>} */
  const slots = new Set();
  return items.map((item, index) => {
    const label = `item ${index}`;
    requireExactFields(item, ITEM_FIELDS, label);
    const record = /** @type {Record<string, unknown>} */ (item);

    if (typeof record.slot !== 'string' || !INVENTORY_SLOTS.has(/** @type {InventorySlot} */ (record.slot))) {
      fail(`${label}.slot is not a supported inventory slot.`);
    }
    const slot = /** @type {InventorySlot} */ (record.slot);
    if (slots.has(slot)) fail(`${label}.slot duplicates "${slot}".`);
    slots.add(slot);

    const rawName = record.name;
    if (typeof rawName !== 'string') fail(`${label}.name must be a string.`);
    const name = /** @type {string} */ (rawName).trim();
    if ([...name].length > 80) fail(`${label}.name may contain at most 80 Unicode code points.`);
    if (CONTROL_CHARACTER.test(name)) fail(`${label}.name must not contain control characters.`);
    const rawEquipped = record.equipped;
    if (typeof rawEquipped !== 'boolean') fail(`${label}.equipped must be a boolean.`);
    const equipped = /** @type {boolean} */ (rawEquipped);

    return {
      slot,
      name,
      equipped,
      armour: finiteNumber(record.armour, `${label}.armour`, MAX_ITEM_VALUE, true),
      evasion: finiteNumber(record.evasion, `${label}.evasion`, MAX_ITEM_VALUE, true),
      energy_shield: finiteNumber(record.energy_shield, `${label}.energy_shield`, MAX_ITEM_VALUE, true),
      weapon: normalizeWeapon(record.weapon, slot, `${label}.weapon`),
    };
  });
}

const stripStatMarkup = (text) => text.replace(
  /\[([^\]|]+)(?:\|([^\]]+))?\]/g,
  (_match, token, display) => display === undefined ? token : display,
);

const MODIFIER = /^(\d+(?:\.\d+)?)% (increased|reduced|more|less) (Armour|Evasion(?: Rating)?|maximum Energy Shield|Physical Damage|Attack Speed|Armour, Evasion and Energy Shield)$/;

const TARGET_KEYS = {
  Armour: ['armour'],
  Evasion: ['evasion'],
  'Evasion Rating': ['evasion'],
  'maximum Energy Shield': ['energy_shield'],
  'Physical Damage': ['physical_min', 'physical_max'],
  'Attack Speed': ['attacks_per_second'],
  'Armour, Evasion and Energy Shield': DEFENSE_KEYS,
};

const newBucket = () => ({ additive: 0, factors: [] });

function applyModifier(bucket, operation, percentage) {
  if (operation === 'increased') bucket.additive += percentage;
  else if (operation === 'reduced') bucket.additive -= percentage;
  else if (operation === 'more') bucket.factors.push(100 + percentage);
  else bucket.factors.push(100 - percentage);
}

function modifiedValue(baseline, bucket) {
  let value = baseline * Math.max(0, 100 + bucket.additive) / 100;
  for (const factor of bucket.factors) value = value * factor / 100;
  return value;
}

const sourceFor = (node, text) => ({ node_id: node.id, node_name: node.name, text });

/**
 * Apply the small set of unconditional global passive templates supported by
 * the equipment estimate. Inputs are treated as immutable.
 *
 * @param {InventoryItem[]} inventory normalized inventory items
 * @param {PassiveNode[]} nodes resolved model nodes
 * @param {Iterable<string>} allocatedNodeIds allocated node IDs
 * @returns {InventoryComparison}
 */
export function calculateInventoryStats(inventory, nodes, allocatedNodeIds) {
  const baseline = { armour: 0, evasion: 0, energy_shield: 0 };
  let weapon = null;
  for (const item of inventory) {
    if (!item.equipped) continue;
    for (const key of DEFENSE_KEYS) baseline[key] += item[key];
    if (item.slot === 'main_hand' && item.weapon !== null) weapon = item.weapon;
  }

  const buckets = {
    armour: newBucket(),
    evasion: newBucket(),
    energy_shield: newBucket(),
    physical_min: newBucket(),
    physical_max: newBucket(),
    attacks_per_second: newBucket(),
  };
  const applied = [];
  const unsupported = [];
  const allocated = new Set(allocatedNodeIds);

  for (const node of nodes) {
    if (!allocated.has(node.id)) continue;
    for (const text of node.stats) {
      const match = node.kind === 'keystone' ? null : stripStatMarkup(text).match(MODIFIER);
      if (match === null) {
        unsupported.push(sourceFor(node, text));
        continue;
      }
      const [, rawPercentage, operation, target] = match;
      const percentage = Number(rawPercentage);
      for (const key of TARGET_KEYS[target]) applyModifier(buckets[key], operation, percentage);
      applied.push(sourceFor(node, text));
    }
  }

  const values = {
    armour: { baseline: baseline.armour, total: modifiedValue(baseline.armour, buckets.armour) },
    evasion: { baseline: baseline.evasion, total: modifiedValue(baseline.evasion, buckets.evasion) },
    energy_shield: {
      baseline: baseline.energy_shield,
      total: modifiedValue(baseline.energy_shield, buckets.energy_shield),
    },
    physical_min: { baseline: null, total: null },
    physical_max: { baseline: null, total: null },
    attacks_per_second: { baseline: null, total: null },
    physical_dps: { baseline: null, total: null },
  };

  if (weapon !== null) {
    values.physical_min = {
      baseline: weapon.physical_min,
      total: modifiedValue(weapon.physical_min, buckets.physical_min),
    };
    values.physical_max = {
      baseline: weapon.physical_max,
      total: modifiedValue(weapon.physical_max, buckets.physical_max),
    };
    values.attacks_per_second = {
      baseline: weapon.attacks_per_second,
      total: modifiedValue(weapon.attacks_per_second, buckets.attacks_per_second),
    };
    values.physical_dps = {
      baseline: (weapon.physical_min + weapon.physical_max) / 2 * weapon.attacks_per_second,
      total: (values.physical_min.total + values.physical_max.total) / 2 * values.attacks_per_second.total,
    };
  }

  /** @type {InventoryMetric[]} */
  const metrics = METRIC_KEYS.map((key) => ({
    key,
    baseline: values[key].baseline,
    total: values[key].total,
    delta: values[key].baseline === null ? null : values[key].total - values[key].baseline,
  }));
  return { metrics, applied, unsupported };
}

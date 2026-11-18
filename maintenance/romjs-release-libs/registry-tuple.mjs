const REQUIREMENT_FIELDS = Object.freeze(['abi', 'battery', 'board', 'compiler', 'mapper', 'region']);
const PROFILE_FIELDS = Object.freeze(['board', 'battery', 'prgRamBytes', 'prgNvramBytes', 'chrRamBytes', 'startup']);
const SHA256 = /^[a-f0-9]{64}$/;

export class RegistrySelectionError extends Error {
  constructor(code, key) {
    super(`${code}: ${key}`);
    this.name = 'RegistrySelectionError';
    this.code = code;
    this.key = key;
  }
}

export function requirementKey({ abi, battery, board, compiler, mapper, region }) {
  return JSON.stringify({ abi, battery, board, compiler, mapper, region });
}

function exactObject(value, fields) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function validateRequirements(requirements, label) {
  if (!exactObject(requirements, REQUIREMENT_FIELDS)
    || typeof requirements.abi !== 'string'
    || typeof requirements.battery !== 'boolean'
    || typeof requirements.board !== 'string'
    || typeof requirements.compiler !== 'string'
    || !Number.isInteger(requirements.mapper)
    || typeof requirements.region !== 'string') {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', label);
  }
}

function matchingSelections(registry, requirements) {
  const key = requirementKey(requirements);
  const matches = [];

  for (const [candidateKey, selection] of Object.entries(registry?.selections ?? {})) {
    let parsed;
    try {
      parsed = JSON.parse(candidateKey);
      validateRequirements(parsed, candidateKey);
    } catch {
      continue;
    }
    if (requirementKey(parsed) === key) matches.push(selection);
  }

  return { key, matches };
}

function parseSuccessor(bytesOrObject) {
  let value = bytesOrObject;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new RegistrySelectionError('INVALID_SUCCESSOR', 'JSON');
    }
  } else if (value instanceof Uint8Array) {
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
    } catch {
      throw new RegistrySelectionError('INVALID_SUCCESSOR', 'JSON');
    }
  } else {
    try {
      value = JSON.parse(JSON.stringify(value));
    } catch {
      throw new RegistrySelectionError('INVALID_SUCCESSOR', 'object');
    }
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function loadSuccessor(bytesOrObject, registry) {
  const descriptor = parseSuccessor(bytesOrObject);
  const descriptorFields = ['format', 'requirements', 'base', 'profile', 'persistence'];
  if (!exactObject(descriptor, descriptorFields) || descriptor.format !== 'nes-engine-successor/1') {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', 'format');
  }

  validateRequirements(descriptor.requirements, 'requirements');
  if (!exactObject(descriptor.base, ['requirements', 'manifestSha256', 'entrySha256'])) {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', 'base');
  }
  validateRequirements(descriptor.base.requirements, 'base.requirements');
  if (!SHA256.test(descriptor.base.manifestSha256) || !SHA256.test(descriptor.base.entrySha256)) {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', 'base pins');
  }
  if (!exactObject(descriptor.profile, PROFILE_FIELDS)
    || typeof descriptor.profile.board !== 'string'
    || typeof descriptor.profile.battery !== 'boolean'
    || !['prgRamBytes', 'prgNvramBytes', 'chrRamBytes'].every((field) => Number.isSafeInteger(descriptor.profile[field]) && descriptor.profile[field] >= 0)
    || typeof descriptor.profile.startup !== 'string') {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', 'profile');
  }
  if (descriptor.profile.board !== descriptor.requirements.board
    || descriptor.profile.battery !== descriptor.requirements.battery) {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', 'profile requirements');
  }
  if (!['shared-battery/1', 'volatile'].includes(descriptor.persistence)
    || (descriptor.requirements.battery === false
      && (descriptor.persistence !== 'volatile' || descriptor.profile.prgNvramBytes !== 0))
    || (descriptor.requirements.battery === true && descriptor.persistence !== 'shared-battery/1')) {
    throw new RegistrySelectionError('INVALID_SUCCESSOR', 'persistence');
  }

  const existing = matchingSelections(registry, descriptor.requirements);
  const base = matchingSelections(registry, descriptor.base.requirements);

  if (base.matches.length === 0) {
    throw new RegistrySelectionError('NO_BASE_SELECTION', base.key);
  }
  if (base.matches.length !== 1) {
    throw new RegistrySelectionError('AMBIGUOUS_BASE', base.key);
  }
  const [selection] = base.matches;
  if (selection?.manifest?.sha256 !== descriptor.base.manifestSha256
    || selection?.entry?.sha256 !== descriptor.base.entrySha256) {
    throw new RegistrySelectionError('BASE_PIN_MISMATCH', base.key);
  }

  // A generalized successor may retain the execution selector only when it is
  // pinned to that exact base selection. The release assembler separately
  // validates the new board profile and replaces the selector only in the
  // immutable successor release; unrelated existing selections still collide.
  if (existing.matches.length > 1
    || (existing.matches.length === 1
      && (existing.key !== base.key || existing.matches[0] !== selection))) {
    throw new RegistrySelectionError('EXISTING_SELECTION', existing.key);
  }

  return deepFreeze(descriptor);
}

export function resolveSelection(registry, requirements, successors = []) {
  const { key, matches } = matchingSelections(registry, requirements);
  const supplied = successors == null ? [] : (Array.isArray(successors) ? successors : [successors]);

  for (const candidate of supplied) {
    const successor = loadSuccessor(candidate, registry);
    if (requirementKey(successor.requirements) !== key) continue;
    const base = matchingSelections(registry, successor.base.requirements);
    const [{ entry, manifest }] = base.matches;
    if (requirementKey(successor.requirements) !== requirementKey(successor.base.requirements)) {
      matches.push({ entry, manifest });
    }
  }

  if (matches.length === 0) {
    throw new RegistrySelectionError('NO_SELECTION', key);
  }
  if (matches.length !== 1) {
    throw new RegistrySelectionError('AMBIGUOUS', key);
  }

  const [{ entry, manifest }] = matches;
  return { entry, manifest };
}

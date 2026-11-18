import { createHash } from 'node:crypto';

const KINDS = Object.freeze([
  'boot',
  'gameplay',
  'controller-roles',
  'loss-recovery-reset',
  'pause-resume',
  'save-load-continuation',
  'browser-frame-audio',
  'sharing-watch-policy',
]);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);

export class QualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QualificationError';
    this.code = code;
  }
}

function fail(code, message) { throw new QualificationError(code, message); }
function exact(value, names, label) {
  if (!object(value) || Object.keys(value).length !== names.length || !names.every((name) => Object.hasOwn(value, name))) fail('QUALIFICATION_INVALID', `Unexpected ${label} fields`);
}
function text(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function path(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 2048 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every((part) => part && part !== '.' && part !== '..') && !/[?#%]/.test(value);
}
function decode(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('QUALIFICATION_INVALID', `Invalid ${label} JSON`); }
}

export const qualificationEvidenceKinds = KINDS;

export function qualificationEvidencePaths(recordBytes, expectedSha256) {
  if (!Buffer.isBuffer(recordBytes) || !HASH.test(expectedSha256) || hash(recordBytes) !== expectedSha256) fail('QUALIFICATION_AUTHENTICATION', 'Qualification record authentication failed');
  const record = decode(recordBytes, 'qualification record');
  exact(record, ['format', 'package', 'capabilities', 'evidence'], 'qualification record');
  if (record.format !== 'nes-package-qualification/1' || !Array.isArray(record.evidence) || record.evidence.length !== KINDS.length) fail('QUALIFICATION_INVALID', 'Invalid qualification record format or evidence count');
  const paths = [];
  for (const member of record.evidence) {
    exact(member, ['kind', 'path', 'bytes', 'sha256'], 'qualification evidence pin');
    if (!KINDS.includes(member.kind) || !path(member.path) || !Number.isSafeInteger(member.bytes) || member.bytes < 1 || member.bytes > 1048576 || !HASH.test(member.sha256)) fail('QUALIFICATION_INVALID', 'Invalid qualification evidence pin');
    paths.push(member.path);
  }
  if (new Set(paths).size !== paths.length) fail('QUALIFICATION_INVALID', 'Duplicate qualification evidence path');
  return Object.freeze({ record, paths: Object.freeze(paths) });
}

export function authenticateQualification({ recordBytes, expectedSha256, evidenceMembers, sourceEnvelope }) {
  const { record } = qualificationEvidencePaths(recordBytes, expectedSha256);
  exact(record.package, ['id', 'artifactDigest'], 'qualification package');
  exact(record.capabilities, ['evidence', 'nativePlayers', 'mode', 'play', 'watch'], 'qualification capabilities');
  if (!ID.test(record.package.id) || record.package.id.length > 64 || !HASH.test(record.package.artifactDigest)) fail('QUALIFICATION_INVALID', 'Invalid qualification package identity');
  if (!text(record.capabilities.evidence, 240) || !Number.isSafeInteger(record.capabilities.nativePlayers) || typeof record.capabilities.mode !== 'string' || typeof record.capabilities.play !== 'string' || typeof record.capabilities.watch !== 'boolean') fail('QUALIFICATION_INVALID', 'Invalid qualification capabilities');
  if (!object(sourceEnvelope) || !object(sourceEnvelope.manifest) || sourceEnvelope.manifest.id !== record.package.id || sourceEnvelope.artifactDigest !== record.package.artifactDigest) fail('QUALIFICATION_STALE', 'Qualification does not match the current source package');
  const current = sourceEnvelope.manifest.capabilities;
  exact(current, ['verified', 'evidence', 'nativePlayers', 'mode', 'play', 'watch'], 'source capabilities');
  if (current.verified !== false || !Array.isArray(current.evidence) || current.evidence.length !== 0) fail('QUALIFICATION_TRANSITION', 'Only an inactive package may be qualified');
  for (const name of ['nativePlayers', 'mode', 'play', 'watch']) if (!same(record.capabilities[name], current[name])) fail('QUALIFICATION_POLICY', `Qualification changes ${name}`);
  if (!object(evidenceMembers)) fail('QUALIFICATION_EVIDENCE', 'Qualification evidence members are required');
  const seen = new Set(), receipts = [];
  for (const member of record.evidence) {
    if (seen.has(member.kind)) fail('QUALIFICATION_INVALID', `Duplicate qualification evidence kind: ${member.kind}`);
    seen.add(member.kind);
    const bytes = evidenceMembers[member.path];
    if (!Buffer.isBuffer(bytes) || bytes.length !== member.bytes || hash(bytes) !== member.sha256) fail('QUALIFICATION_EVIDENCE', `Qualification evidence authentication failed: ${member.path}`);
    const report = decode(bytes, `qualification evidence ${member.path}`);
    exact(report, ['format', 'package', 'kind', 'report'], 'qualification evidence report');
    exact(report.package, ['id', 'artifactDigest'], 'qualification evidence package');
    if (report.format !== 'nes-package-qualification-evidence/1' || report.kind !== member.kind || !same(report.package, record.package) || !text(report.report, 4000)) fail('QUALIFICATION_EVIDENCE', `Qualification evidence is not bound to the source package: ${member.path}`);
    receipts.push(Object.freeze({ kind: member.kind, path: member.path, bytes: member.bytes, sha256: member.sha256, report: report.report }));
  }
  if (!same([...seen].sort(), [...KINDS].sort())) fail('QUALIFICATION_EVIDENCE', 'Qualification evidence coverage is incomplete');
  return Object.freeze({
    id: record.package.id,
    sourceArtifactDigest: record.package.artifactDigest,
    capabilities: Object.freeze({ ...current, verified: true, evidence: record.capabilities.evidence }),
    receipt: Object.freeze({ format: record.format, package: record.package, record: Object.freeze({ bytes: recordBytes.length, sha256: expectedSha256 }), capabilities: record.capabilities, evidence: Object.freeze(receipts) }),
  });
}

const NETWORK_INPUTS = Object.freeze([
  Object.freeze({ id: 'a', kind: 'button', label: 'A' }),
  Object.freeze({ id: 'b', kind: 'button', label: 'B' }),
  Object.freeze({ id: 'select', kind: 'button', label: 'Select' }),
  Object.freeze({ id: 'start', kind: 'button', label: 'Start' }),
  Object.freeze({ id: 'up', kind: 'button', label: 'Up' }),
  Object.freeze({ id: 'down', kind: 'button', label: 'Down' }),
  Object.freeze({ id: 'left', kind: 'button', label: 'Left' }),
  Object.freeze({ id: 'right', kind: 'button', label: 'Right' }),
]);
const canonical = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

export function validateProductionNetworkBinding(binding, manifest, artifactDigest) {
  exact(binding, ['version', 'protocol', 'catalog', 'packageId', 'artifactDigest', 'packageFormat', 'route', 'entryAdapter', 'adapter', 'compatibility', 'players', 'inputProfile', 'inputs', 'inputsDigest', 'capabilities'], 'network binding');
  exact(binding.capabilities, ['watch', 'video', 'audio', 'nativePlayers', 'play'], 'network capabilities');
  exact(binding.players, ['local', 'remote'], 'network players');
  if (binding.version !== 'game-network-binding/1' || binding.protocol !== 3 || binding.catalog !== 'romjs-cartridge-roles/1' || binding.packageFormat !== 'game-package/1' || binding.packageId !== manifest.id || binding.artifactDigest !== artifactDigest || binding.route !== manifest.route || binding.entryAdapter !== `${manifest.route}netplay-nes-adapter.mjs` || binding.adapter !== 'nes-network/1') fail('BINDING_REPAIR_INVALID', 'Network binding identity mismatch');
  const expectedPlay = manifest.capabilities.play === 'host-p1-guest-p2' ? 'independent' : manifest.capabilities.play;
  const shared = manifest.capabilities.nativePlayers === 1 && expectedPlay === 'shared-hero';
  const independent = manifest.capabilities.nativePlayers === 2 && expectedPlay === 'independent';
  if (binding.capabilities.watch !== manifest.capabilities.watch || binding.capabilities.video !== (manifest.surfaces?.video?.kind !== 'none') || binding.capabilities.audio !== (manifest.surfaces?.audio?.kind !== 'none') || binding.capabilities.nativePlayers !== manifest.capabilities.nativePlayers || binding.capabilities.play !== expectedPlay || binding.capabilities.watch !== true || !binding.capabilities.video || !binding.capabilities.audio) fail('BINDING_REPAIR_POLICY', 'Network binding changes declared package capabilities');
  if (shared ? binding.compatibility !== 'solo-shared/1' || binding.players.local !== binding.players.remote : independent ? binding.compatibility !== 'native-two/1' || binding.players.local === binding.players.remote : true) fail('BINDING_REPAIR_POLICY', 'Network binding player classification mismatch');
  if (binding.inputProfile !== 'buttons/1' || !same(binding.inputs, NETWORK_INPUTS) || binding.inputsDigest !== hash(Buffer.from(canonical(NETWORK_INPUTS)))) fail('BINDING_REPAIR_INVALID', 'Network binding input contract mismatch');
  return binding;
}

export function authenticateBindingRepair({ recordBytes, expectedSha256, sourceEnvelope, sourceBinding }) {
  if (!Buffer.isBuffer(recordBytes) || !HASH.test(expectedSha256) || hash(recordBytes) !== expectedSha256) fail('BINDING_REPAIR_AUTHENTICATION', 'Binding repair record authentication failed');
  const record = decode(recordBytes, 'binding repair record');
  exact(record, ['format', 'package', 'binding'], 'binding repair record');
  exact(record.package, ['id', 'artifactDigest'], 'binding repair package');
  if (record.format !== 'nes-network-binding-repair/1' || record.package.id !== sourceEnvelope?.manifest?.id || record.package.artifactDigest !== sourceEnvelope?.artifactDigest) fail('BINDING_REPAIR_STALE', 'Binding repair does not match the current source package');
  const capabilities = sourceEnvelope.manifest.capabilities;
  if (capabilities?.verified !== false || !Array.isArray(capabilities.evidence) || capabilities.evidence.length !== 0) fail('BINDING_REPAIR_TRANSITION', 'Binding repair is limited to inactive packages');
  if (!object(sourceBinding) || sourceBinding.packageId !== record.package.id || sourceBinding.route !== sourceEnvelope.manifest.route || sourceBinding.capabilities?.nativePlayers !== capabilities.nativePlayers || sourceBinding.capabilities?.play !== (capabilities.play === 'host-p1-guest-p2' ? 'independent' : capabilities.play)) fail('BINDING_REPAIR_POLICY', 'Binding repair changes existing package roles');
  validateProductionNetworkBinding(record.binding, sourceEnvelope.manifest, sourceEnvelope.artifactDigest);
  return Object.freeze({ id: record.package.id, binding: Object.freeze(structuredClone(record.binding)), receipt: Object.freeze({ format: record.format, package: record.package, record: Object.freeze({ bytes: recordBytes.length, sha256: expectedSha256 }), binding: record.binding }) });
}

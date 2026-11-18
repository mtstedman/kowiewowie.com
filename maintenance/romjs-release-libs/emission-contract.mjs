const RECEIPT_FORMAT = 'romjs-nes-emission/1';
const HASH = /^[a-f0-9]{64}$/;
const TOP_KEYS = ['format', 'execution', 'contract', 'source', 'manifestSha256', 'modules', 'tool'];
const SOURCE_KEYS = ['manifestSha256', 'romSha256', 'prgSha256'];
const MODULE_KEYS = ['sourceSha256', 'sha256', 'bytes', 'entries', 'upgraded'];
const TOOL_KEYS = ['name', 'sourceSha256'];

export const EMISSION_CONTRACTS = Object.freeze({
  'owned-uxrom-abi2/1': 'owned-uxrom-prefetch-bus-cycles/1',
  'timed-mmc1/1': 'timed-mmc1-body/1',
  'timed-mmc3/1': 'timed-mmc3-body/1',
  'mmc2-dot/1': 'mmc2-dot-body/1',
});

export class EmissionContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EmissionContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EmissionContractError(code, message);
}

function exact(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail('EMISSION_HASH_MISMATCH', `${label} must be bytes`);
}

const K = Uint32Array.from([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (value, count) => (value >>> count) | (value << (32 - count));

function sha256(input) {
  const source = bytes(input, 'hash input');
  const size = (source.length + 9 + 63) & ~63;
  const padded = new Uint8Array(size);
  padded.set(source);
  padded[source.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = source.length * 8;
  view.setUint32(size - 8, Math.floor(bits / 0x100000000));
  view.setUint32(size - 4, bits >>> 0);
  const state = Uint32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[i] + words[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
}

function parseReceipt(value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(value, 'receipt')));
    } catch (error) {
      if (error instanceof EmissionContractError) throw error;
      fail('EMISSION_MISMATCH', 'Emission receipt is not valid UTF-8 JSON');
    }
  }
  return value;
}

function receiptMismatch(message) {
  fail('EMISSION_MISMATCH', message);
}

export function readEmissionReceipt(bytesOrObject) {
  const value = parseReceipt(bytesOrObject);
  if (!exact(value, TOP_KEYS) || value.format !== RECEIPT_FORMAT) receiptMismatch('Invalid emission receipt envelope');
  if (typeof value.execution !== 'string' || typeof value.contract !== 'string' || !HASH.test(value.manifestSha256)) receiptMismatch('Invalid emission receipt identity');
  if (!exact(value.source, SOURCE_KEYS) || !SOURCE_KEYS.every((key) => HASH.test(value.source[key]))) receiptMismatch('Invalid emission source identity');
  if (value.modules === null || typeof value.modules !== 'object' || Array.isArray(value.modules) || Object.keys(value.modules).length === 0) receiptMismatch('Invalid emission module inventory');
  const modules = {};
  for (const [name, record] of Object.entries(value.modules)) {
    if (!name || name.includes('/') || !exact(record, MODULE_KEYS)
      || !HASH.test(record.sourceSha256) || !HASH.test(record.sha256)
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0
      || !Number.isSafeInteger(record.entries) || record.entries < 1
      || record.upgraded !== true) receiptMismatch(`Invalid emission module record: ${name}`);
    modules[name] = Object.freeze({ ...record });
  }
  if (!exact(value.tool, TOOL_KEYS) || value.tool.name !== 'romjs-nes-timing-upgrade' || !HASH.test(value.tool.sourceSha256)) receiptMismatch('Invalid emission tool identity');
  return Object.freeze({
    format: value.format,
    execution: value.execution,
    contract: value.contract,
    source: Object.freeze({ ...value.source }),
    manifestSha256: value.manifestSha256,
    modules: Object.freeze(modules),
    tool: Object.freeze({ ...value.tool }),
  });
}

export function assertAdmissibleEmission({ execution, manifestBytes, receipt, modules } = {}) {
  const contract = EMISSION_CONTRACTS[execution];
  if (typeof contract !== 'string') fail('UNSUPPORTED_EXECUTION', 'Execution family has no admissible emission contract');
  if (receipt === undefined || receipt === null) fail('UNUPGRADED_EMISSION', 'An authenticated emission receipt is required');
  const parsed = readEmissionReceipt(receipt);
  if (parsed.execution !== execution || parsed.contract !== contract) fail('EMISSION_MISMATCH', 'Emission receipt does not match the execution contract');
  if (sha256(bytes(manifestBytes, 'manifestBytes')) !== parsed.manifestSha256) fail('EMISSION_HASH_MISMATCH', 'Manifest bytes differ from the emission receipt');
  if (modules !== undefined) {
    if (!modules || typeof modules !== 'object' || Array.isArray(modules)) fail('EMISSION_HASH_MISMATCH', 'Module bytes must be a name-to-bytes object');
    const expected = Object.keys(parsed.modules).sort();
    const actual = Object.keys(modules).sort();
    if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) fail('EMISSION_HASH_MISMATCH', 'Module inventory differs from the emission receipt');
    for (const name of expected) {
      const moduleBytes = bytes(modules[name], `module ${name}`);
      const record = parsed.modules[name];
      if (moduleBytes.byteLength !== record.bytes || sha256(moduleBytes) !== record.sha256) fail('EMISSION_HASH_MISMATCH', `Module bytes differ from the emission receipt: ${name}`);
    }
  }
  return parsed;
}

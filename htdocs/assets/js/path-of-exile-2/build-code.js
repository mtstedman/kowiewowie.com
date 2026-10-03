// Shareable PoE 2 build codes. A build is versioned JSON, deflated and base64url-encoded
// behind a format prefix, so it travels as a link (#build=<code>) or as pasted text and
// needs no server. Codes come from other people, so decoding bounds the code and inflated
// sizes and checks every field before the planner sees it.

const PREFIX = 'poe2b1.';
const MAX_CODE_LENGTH = 16_384;
const MAX_JSON_BYTES = 65_536;
// Matches the saved-build API's limits, so an imported build can always be saved.
const MAX_NODE_IDS = 2048;
const NODE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,32}$/;
const MAX_CHARACTER_NAME = 64;
const MAX_BUILD_NAME = 80;

export class BuildCodeError extends Error {}

/**
 * @typedef {{ class_id: string, ascendancy_id: string | null, tree_version: string,
 *   allocated_node_ids: string[], must_have_node_ids: string[], considered_node_ids: string[],
 *   character_name: string, build_name: string }} SharedBuild
 */

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** @param {string} text */
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new BuildCodeError('That build code contains characters a code never has.');
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new BuildCodeError('That build code is damaged.');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** @param {Uint8Array<ArrayBuffer>} bytes @param {CompressionStream | DecompressionStream} transform */
async function pipe(bytes, transform, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BuildCodeError('That build code is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** @param {unknown} value @param {string} label */
function nodeIdList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_NODE_IDS
    || !value.every((id) => typeof id === 'string' && NODE_ID_PATTERN.test(id))) {
    throw new BuildCodeError(`That build code has an invalid ${label} list.`);
  }
  return [...new Set(value)];
}

/** @param {unknown} value @param {number} maxLength */
function optionalText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
}

/**
 * @param {SharedBuild} build
 * @returns {Promise<string>}
 */
export async function encodeBuildCode(build) {
  const payload = {
    v: 1,
    t: build.tree_version,
    c: build.class_id,
    a: build.ascendancy_id || null,
    n: build.allocated_node_ids,
    m: build.must_have_node_ids,
    k: build.considered_node_ids,
    cn: build.character_name || undefined,
    bn: build.build_name || undefined,
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/**
 * The code inside pasted text: a bare code, or any link carrying it after "#build=" or "?build=".
 *
 * @param {string} text
 * @returns {string | null}
 */
export function extractBuildCode(text) {
  const trimmed = String(text || '').trim();
  const fromLink = /[#?&]build=([^&#\s]+)/.exec(trimmed);
  const code = fromLink ? decodeURIComponent(fromLink[1]) : trimmed;
  return code.startsWith(PREFIX) ? code : null;
}

/**
 * @param {string} text a code or a link containing one
 * @returns {Promise<SharedBuild>}
 */
export async function decodeBuildCode(text) {
  const code = extractBuildCode(text);
  if (code === null) throw new BuildCodeError('Paste a build code or share link from this planner.');
  if (code.length > MAX_CODE_LENGTH) throw new BuildCodeError('That build code is too large.');

  let payload;
  try {
    const json = await pipe(fromBase64Url(code.slice(PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch (error) {
    if (error instanceof BuildCodeError) throw error;
    throw new BuildCodeError('That build code is damaged.');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || payload.v !== 1) {
    throw new BuildCodeError('That build code is from an unsupported version of the planner.');
  }
  if (typeof payload.c !== 'string' || payload.c === '' || payload.c.length > 64) {
    throw new BuildCodeError('That build code names no class.');
  }
  if (payload.a !== null && payload.a !== undefined && (typeof payload.a !== 'string' || payload.a.length > 64)) {
    throw new BuildCodeError('That build code has an invalid ascendancy.');
  }

  const mustHaves = nodeIdList(payload.m, 'must-have');
  return {
    class_id: payload.c,
    ascendancy_id: payload.a || null,
    tree_version: typeof payload.t === 'string' ? payload.t.slice(0, 32) : '',
    allocated_node_ids: nodeIdList(payload.n, 'allocation'),
    must_have_node_ids: mustHaves,
    considered_node_ids: nodeIdList(payload.k, 'considered').filter((id) => !mustHaves.includes(id)),
    character_name: optionalText(payload.cn, MAX_CHARACTER_NAME),
    build_name: optionalText(payload.bn, MAX_BUILD_NAME),
  };
}

import { createHash } from 'node:crypto';

const ROUTE = /^\/games\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pin = (bytes) => Object.freeze({ bytes: bytes.length, sha256: hash(bytes) });
const samePin = (left, right) => object(left)
  && Object.keys(left).length === 2
  && Object.hasOwn(left, 'bytes')
  && Object.hasOwn(left, 'sha256')
  && left.bytes === right.bytes
  && left.sha256 === right.sha256;

export class RouteShellError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RouteShellError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RouteShellError(code, message);
}

export function ensureRouteShell({ canonicalShell, route, manifestFiles, read, write }) {
  if (!Buffer.isBuffer(canonicalShell)
    || !ROUTE.test(route)
    || !object(manifestFiles)
    || typeof read !== 'function'
    || typeof write !== 'function') {
    fail('ROUTE_SHELL_INVALID', 'Invalid route shell input');
  }

  const url = `${route}index.html`;
  const path = `htdocs${url}`;
  const expected = pin(canonicalShell);
  const current = read(path);
  if (current !== undefined && (!Buffer.isBuffer(current) || !current.equals(canonicalShell))) {
    fail('ROUTE_SHELL_CONFLICT', `Route shell conflicts with canonical shell: ${url}`);
  }

  const declared = manifestFiles[url];
  if (declared !== undefined && !samePin(declared, expected)) {
    fail('ROUTE_SHELL_AUTHENTICATION', `Route shell manifest pin conflicts with canonical shell: ${url}`);
  }

  const emitted = current === undefined;
  if (emitted) write(path, canonicalShell);
  return Object.freeze({
    emitted,
    files: declared === undefined ? { ...manifestFiles, [url]: expected } : manifestFiles,
    path,
    pin: expected,
    url,
  });
}

// Use the configured production response policy, including the worker URL scope.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../deploy/nginx/wowiekowie.com.conf',import.meta.url),'utf8');
const map=/map \$uri \$shared_engine_csp \{\n([\s\S]*?)\n\}/.exec(source);
assert(map,'Production CSP map required');
assert(source.includes('add_header Content-Security-Policy $shared_engine_csp always;'));
const fallback=/^\s*default "([^"]+)";$/m.exec(map[1]);
const scoped=/^\s*~([^\s]+) "([^"]+)";$/m.exec(map[1]);
assert(fallback&&scoped,'Expected production default and route policies');
const route=new RegExp(scoped[1]);
export function snesBrowserCSP(pathname){return route.test(pathname)?scoped[2]:fallback[1];}
assert(snesBrowserCSP('/games/arcade/').includes('blob:'));
assert(!snesBrowserCSP('/games/engines/snes/worker.mjs').includes('blob:'));

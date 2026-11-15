import assert from 'node:assert/strict';
const EMISSION_ROOTS=["htdocs","includes","tests","deploy"];
function insist(ok,message){if(!ok)throw Error(message);}
function isEmissionSource(key){return ['package.json','tsconfig.json'].includes(key)||EMISSION_ROOTS.some(root=>key.startsWith(root+'/'));}
function refuseRemovedDependency(key,removals){
 insist(removals instanceof Set,'Explicit legacy removal set required');
 insist(!removals.has(key),'Refusing removed original engine dependency: '+key);
}
for(const key of ['htdocs/games/contra/worker.mjs','includes/api/classes/NetplayPolicy.php','tests/example.mjs','deploy/nginx/site.conf','package.json','tsconfig.json'])assert.equal(isEmissionSource(key),true,key);
for(const key of ['README.md','identity.json','emission-findings-02.json','emitter.mjs','review.mjs','htdocs-other/file.mjs','authoring/htdocs/file.mjs'])assert.equal(isEmissionSource(key),false,key);
const key='htdocs/games/contra/engine/machine.mjs',removed=new Set([key]);
assert.throws(()=>refuseRemovedDependency(key,removed),/Refusing removed original engine dependency/);
assert.throws(()=>refuseRemovedDependency(key),/Explicit legacy removal set required/);
refuseRemovedDependency('htdocs/games/contra/composition-entry.mjs',removed);
console.log('Emission allowlist and removed-engine refusal fixtures passed');

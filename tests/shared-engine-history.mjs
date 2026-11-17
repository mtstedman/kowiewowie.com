import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as base from './engine-history-base-da79e95b5dbfe1cf77cb332c402512bddf29adc978858872f3100a44c919c76e.mjs';
const root=new URL('../',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:hash(b)}),same=(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256;
export const receiptSHA=base.receiptSHA;
export const maintenanceHead={"bytes":34154,"path":"receipts/engine-release-history-1.4.4.json","sha256":"4183be23c6c36330dd4b093f436da08605ff6132841424246653ec112d701249"};
function prior(read,exists){let h=maintenanceHead;while(h){const raw=read(h.path);if(!same(pin(raw),h))throw Error('Maintenance history receipt mismatch');const r=JSON.parse(raw);if(r.format!=='nes-engine-maintenance-history/1')throw Error('Maintenance history format');const nextRead=read,nextExists=exists;for(const [p,c]of Object.entries(r.changes)){if(!same(pin(read(p)),c.after)||!same(pin(read(c.original)),c.before))throw Error('Maintenance changed mismatch: '+p);}for(const [p,c]of Object.entries(r.added))if(!same(pin(read(p)),c))throw Error('Maintenance added mismatch: '+p);read=p=>{if(Object.hasOwn(r.added,p)){const e=Error('No prior file: '+p);e.code='ENOENT';throw e;}const c=r.changes[p];return nextRead(c?c.original:p);};exists=p=>!Object.hasOwn(r.added,p)&&(Object.hasOwn(r.changes,p)||nextExists(p));h=r.previous;}return {read,exists};}
export function releasePriorView(read=p=>readFileSync(new URL(p,root)),exists=p=>existsSync(new URL(p,root))){return prior(read,exists);}
export function verifySharedEngineMigration(read,exists){const v=releasePriorView(read,exists);return base.verifySharedEngineMigration(v.read,v.exists);}
export function sharedEngineHistoricalRead(read,exists){const v=releasePriorView(read,exists);return base.sharedEngineHistoricalRead(v.read,v.exists);}
export async function historicalRead(){const {coreHistoricalRead}=await import('./core-refresh-history.mjs');return coreHistoricalRead(sharedEngineHistoricalRead());}

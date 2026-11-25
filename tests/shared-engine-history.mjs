import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as base from './engine-history-base-da79e95b5dbfe1cf77cb332c402512bddf29adc978858872f3100a44c919c76e.mjs';
const root=new URL('../',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:hash(b)}),same=(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256;
export const receiptSHA=base.receiptSHA;
// Site markup, styling, artwork and prose are not pinned: a receipt may record their past bytes, but the live file is free to differ.
const presentation=p=>/^htdocs\/.*(?:\.(?:css|html|png|md|txt)|\.d\.mts)$/.test(p);
export const maintenanceHead={"path":"receipts/snes-site-history-20261125215000952.json","bytes":16846,"sha256":"b4dc8776b2eea07138572559bafb5e85bc51a7d915605880060dfac9ae56f971"};
function prior(read,exists){let h=maintenanceHead;while(h){const raw=read(h.path);if(!same(pin(raw),h))throw Error('Maintenance history receipt mismatch');const r=JSON.parse(raw);if(r.format!=='nes-engine-maintenance-history/1')throw Error('Maintenance history format');const nextRead=read,nextExists=exists;for(const [p,c]of Object.entries(r.changes)){if(!presentation(p)&&!same(pin(read(p)),c.after)||!same(pin(read(c.original)),c.before))throw Error('Maintenance changed mismatch: '+p);}for(const [p,c]of Object.entries(r.added))if(!same(pin(read(p)),c))throw Error('Maintenance added mismatch: '+p);read=p=>{if(Object.hasOwn(r.added,p)){const e=Error('No prior file: '+p);e.code='ENOENT';throw e;}const c=r.changes[p];return nextRead(c?c.original:p);};exists=p=>!Object.hasOwn(r.added,p)&&(Object.hasOwn(r.changes,p)||nextExists(p));h=r.previous;}return {read,exists};}
export function releasePriorView(read=p=>readFileSync(new URL(p,root)),exists=p=>existsSync(new URL(p,root))){return prior(read,exists);}
export function verifySharedEngineMigration(read,exists){const v=releasePriorView(read,exists);return base.verifySharedEngineMigration(v.read,v.exists);}
export function sharedEngineHistoricalRead(read,exists){const v=releasePriorView(read,exists);return base.sharedEngineHistoricalRead(v.read,v.exists);}
export async function historicalRead(){const {coreHistoricalRead}=await import('./core-refresh-history.mjs');return coreHistoricalRead(sharedEngineHistoricalRead());}

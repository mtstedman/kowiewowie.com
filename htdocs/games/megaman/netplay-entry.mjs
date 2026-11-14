// Receiver dispatch precedes importing the NES app/worker. UI is owned separately.
import {storageKey} from './netplay-client.mjs';
let saved=null;try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
export let network=null;
if(location.hash.startsWith('#netplay=')||location.hash.startsWith('#netplay')&&!location.hash.startsWith('#netplay3=')){
 document.getElementById('status').textContent='This invitation is incompatible. Ask the host for a new watch or play invitation.';
}else{
 try{const receiver=location.hash.startsWith('#netplay3=')||saved?.room;const module=await import(receiver?'./netplay-guest.mjs':'./app.mjs');network=module.network;window.dispatchEvent(new CustomEvent('wowiekowie-network-ready',{detail:{version:1,network,receiver:Boolean(receiver)}}));}
 catch{document.getElementById('status').textContent='Network binding unavailable. Reload or open a fresh invitation.';}
}

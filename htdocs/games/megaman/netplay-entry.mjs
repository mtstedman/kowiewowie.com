// Choose guest mode before importing the host app or creating a game worker.
const key='romjs-netplay-guest:'+location.pathname.replace(/index\.html$/,'');
let saved=null;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
try{
 if(location.hash.startsWith('#netplay=')||saved?.room)await import('./netplay-guest.mjs');
 else await import('./app.mjs');
}catch{document.getElementById('status').textContent='Unable to load the game interface. Reload to retry.';}

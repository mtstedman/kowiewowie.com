// Fetch the cartridge view only after the active game has finished unloading.
export function createLibraryView({root,catalog,onLoad,canActivate}){
 let loading=null,selected=null,disabled=false;
 function update(next,blocked){selected=next;disabled=blocked;for(const radio of root.querySelectorAll('input[name="package"]')){radio.checked=radio.value===selected?.id;radio.disabled=disabled;}for(const button of root.querySelectorAll('button'))button.disabled=disabled||!selected;const load=root.querySelector('#load'),state=root.querySelector('#selection-state');if(load)load.textContent=selected?'Load '+selected.title:'Load game';if(state)state.textContent=selected?selected.title+' · '+(selected.capabilities.nativePlayers===1?'Solo':selected.capabilities.mode):'Choose your next game.';}
 async function load(){
  if(loading)return loading;
  loading=(async()=>{
   const response=await fetch(new URL('./library.html',import.meta.url));if(!response.ok)throw Error('Could not load the cartridge shelf.');
   root.innerHTML=await response.text();const shelf=root.querySelector('#shelf');if(!shelf)throw Error('Invalid cartridge view');
   for(const p of catalog.list()){
    const label=document.createElement('label');label.className='cartridge';const radio=document.createElement('input');radio.type='radio';radio.name='package';radio.value=p.id;radio.setAttribute('aria-label',p.title+' cartridge');radio.setAttribute('aria-describedby','shelf-instruction');
    const activate=()=>{if(radio.checked&&!radio.disabled&&canActivate(p.id))void onLoad(p);};
    radio.addEventListener('click',activate);radio.addEventListener('change',activate);
    radio.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat)radio.click();}});radio.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')e.preventDefault();});
    const body=document.createElement('span');body.className='cartridge-body';const face=document.createElement('span');face.className='cartridge-label';const brand=document.createElement('span');brand.className='series';brand.textContent=p.publisher+' · '+p.platform;const title=document.createElement('strong');title.textContent=p.title;face.append(brand,title);
    if(p.image){const img=document.createElement('img');img.src=p.image;img.alt=p.title+' screenshot';img.loading='eager';img.decoding='async';img.width=256;img.height=p.surfaces.video.height;face.append(img);}else{const space=document.createElement('span');space.className='label-space';space.setAttribute('aria-hidden','true');face.append(space);}
    const meta=document.createElement('span');meta.className='cartridge-meta';meta.textContent=p.year+' · '+(p.capabilities.nativePlayers===1?'Solo':p.capabilities.mode);face.append(meta);const grip=document.createElement('span');grip.className='cartridge-grip';grip.setAttribute('aria-hidden','true');body.append(face,grip);label.append(radio,body);const choice=document.createElement('div');choice.className='cartridge-choice';
    const button=document.createElement('button');button.type='button';button.className='load-cartridge';button.dataset.loadPackage=p.id;button.textContent='Load game';button.setAttribute('aria-label','Load '+p.title);button.addEventListener('click',()=>{if(canActivate(p.id))void onLoad(p);});choice.append(label,button);shelf.append(choice);
   }
   root.querySelector('#load').addEventListener('click',()=>{if(selected&&canActivate(selected.id))void onLoad(selected);});update(selected,disabled);
  })().catch(error=>{loading=null;root.replaceChildren();throw error;});
  return loading;
 }
 return {load,update};
}

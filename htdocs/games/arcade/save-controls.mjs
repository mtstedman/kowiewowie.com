import {createSaveStore,SAVE_SLOTS} from './save-store.mjs';
const LABELS={slot1:'Slot 1',slot2:'Slot 2',slot3:'Slot 3',autosave:'Autosave',recovery:'Before last load'};
export function captureSavePreview(canvas){
 try{if(!canvas?.width||!canvas?.height)return null;const preview=canvas.ownerDocument.createElement('canvas');preview.width=128;preview.height=Math.max(1,Math.round(128*canvas.height/canvas.width));preview.getContext('2d').drawImage(canvas,0,0,preview.width,preview.height);return preview.toDataURL('image/webp',.65);}catch{return null;}
}
export function createSaveControls({root,platform,id,runtime,canvas,allowed,release,legacy,replica=false,store=createSaveStore({platform,id,legacy}),intervalMs=60000}){
 const doc=root.ownerDocument||document,select=doc.createElement('select'),saveButton=doc.createElement('button'),loadButton=doc.createElement('button'),status=doc.createElement('p'),preview=doc.createElement('img'),details=doc.createElement('p');
 const label=doc.createElement('label');label.textContent='Saved position ';select.setAttribute('aria-label','Saved position');label.append(select);
 const options=new Map();for(const slot of SAVE_SLOTS){const option=doc.createElement('option');option.value=slot;option.textContent=LABELS[slot]+' — empty';select.append(option);options.set(slot,option);}
 select.value='slot1';saveButton.type=loadButton.type='button';saveButton.textContent='Save to Slot 1';loadButton.textContent='Load selected save';saveButton.disabled=loadButton.disabled=true;
 if(platform==='nes'){saveButton.id='nes-save';loadButton.id='nes-load';status.id='nes-save-status';}else{saveButton.dataset.snesSave='save';loadButton.dataset.snesSave='load';status.className='quiet snes-save-message';}
 status.setAttribute('role','status');status.textContent='Three manual slots. Autosave every minute while playing. Loading first backs up your current position.';
 preview.alt='Selected saved game preview';preview.width=128;preview.hidden=true;details.className='quiet';root.className='nes-save-controls';root.append(label,saveButton,loadButton,preview,details,status);
 let selected='slot1',manual='slot1',rows=[],closed=false,busy=false,generation=0,operation=null,operationKind=null,automatic=null,refreshing=null,refreshAbort=null,loaded=false,enabled=false,timer=null,renderedRows=null,renderedSelected=null,renderedManual=null;
 const permitted=()=>!closed&&!replica&&allowed()&&runtime()?.snapshot().ready;
 const current=token=>permitted()&&token===generation;
 const requireCurrent=token=>{if(!current(token))throw Error('Save operation was cancelled');};
 function render(){
  const usable=enabled&&permitted()&&!busy;saveButton.disabled=select.disabled=!usable;loadButton.disabled=!usable||!rows.some(r=>r.slot===selected&&!r.empty&&!r.damaged);
  if(renderedRows===rows&&renderedSelected===selected&&renderedManual===manual)return;renderedRows=rows;renderedSelected=selected;renderedManual=manual;
  saveButton.textContent='Save to '+LABELS[manual];
  const row=rows.find(r=>r.slot===selected);preview.hidden=!row?.screenshot;if(row?.screenshot)preview.src=row.screenshot;else preview.removeAttribute('src');
  details.textContent=row?.damaged?'This saved game is damaged.':row&&!row.empty?`${LABELS[selected]} · ${new Date(row.savedAt).toLocaleString()}${row.migrated?' · Imported previous save':''}`:'No saved game in this slot yet.';
  for(const [slot,option]of options){const item=rows.find(r=>r.slot===slot);option.textContent=LABELS[slot]+(item?.damaged?' — damaged':item&&!item.empty?' — '+new Date(item.savedAt).toLocaleString():' — empty');}
 }
 async function refresh(){
  if(!permitted())return;if(refreshing)return refreshing;const token=generation;refreshAbort=new AbortController();
  refreshing=store.list({signal:refreshAbort.signal}).then(value=>{if(current(token)){rows=value;loaded=true;render();}}).catch(error=>{if(current(token)){loaded=true;status.textContent=error.message||'Cannot read saved games';}}).finally(()=>{refreshing=null;});return refreshing;
 }
 async function checkpoint(kind,slot){
  if(!permitted()||busy)throw Error('Game is not ready for a save operation');
  if(kind==='autosave'&&(!runtime().snapshot().running||typeof runtime().networkSnapshot!=='function'))return false;
  const token=++generation,abort=new AbortController();busy=true;operation=abort;operationKind=kind;render();status.textContent=kind==='load'?'Backing up current position and loading…':kind==='autosave'?'Autosaving…':'Saving game…';
  try{
   if(kind==='load'){
    // Read before replacing recovery, including when recovery itself is loaded.
    const target=await store.read(slot,{signal:abort.signal});requireCurrent(token);
    release();await runtime().pause();requireCurrent(token);
    const backup=await runtime().exportCheckpoint();requireCurrent(token);
    await store.write('recovery',backup,{screenshot:captureSavePreview(canvas())},{signal:abort.signal});requireCurrent(token);
    await runtime().importCheckpoint(target);requireCurrent(token);
    status.textContent='Game loaded. Your previous position is in Before last load. Use Resume to continue.';
   }else{
    if(kind!=='autosave'){release();await runtime().pause();requireCurrent(token);}
    const record=await (kind==='autosave'?runtime().networkSnapshot():runtime().exportCheckpoint());requireCurrent(token);
    await store.write(slot,record,{screenshot:captureSavePreview(canvas())},{signal:abort.signal});requireCurrent(token);
    status.textContent=kind==='autosave'?'Autosaved on this browser.':`Saved on this browser in ${LABELS[slot]}. Use Resume to continue.`;
   }
   rows=await store.list({signal:abort.signal});requireCurrent(token);loaded=true;return true;
  }catch(error){if(current(token))status.textContent=error.message||'Save operation failed';throw error;}
  finally{if(token===generation){busy=false;operation=null;operationKind=null;render();}}
 }
 function invalidate(){generation++;operation?.abort();refreshAbort?.abort();operation=null;operationKind=null;busy=false;render();}
 const afterAutomatic=async action=>{if(automatic)try{await automatic;}catch{}return action();};
 const save=()=>afterAutomatic(()=>checkpoint('save',manual)),load=()=>afterAutomatic(()=>checkpoint('load',selected));
 const autosave=()=>{if(automatic)return automatic;automatic=checkpoint('autosave','autosave').finally(()=>{automatic=null;});return automatic;};
 select.addEventListener('change',()=>{if(!SAVE_SLOTS.includes(select.value))return;selected=select.value;if(/^slot[123]$/.test(selected))manual=selected;render();});
 saveButton.addEventListener('click',()=>{void save().catch(()=>{});});loadButton.addEventListener('click',()=>{void load().catch(()=>{});});
 if(!replica)timer=setInterval(()=>{if(permitted()&&!busy&&runtime().snapshot().running)void autosave().catch(()=>{});},intervalMs);
 root.hidden=replica;
 return {save,load,autosave,refresh,invalidate,isBusy:()=>busy&&operationKind!=='autosave',
  update(value){enabled=Boolean(value);if(!loaded&&!refreshing&&permitted())void refresh();render();},
  dispose(){if(closed)return;closed=true;generation++;operation?.abort();refreshAbort?.abort();clearInterval(timer);},
 };
}

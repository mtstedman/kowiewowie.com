// Test contract fixture, not a game or emulation implementation.
let creations=0;
export function createRuntime(){
 const instance=++creations;let worker=null,closed=false,running=false,frame=requestAnimationFrame(()=>{}),timer=null,audio=null;
 const heldInputs=new Set();
 return {instance,
  reset(){if(closed)return;clearTimeout(timer);timer=null;worker?.terminate();worker=new Worker(new URL('./unused-worker.mjs',import.meta.url),{type:'module'});timer=setTimeout(()=>{timer=null;},500);},
  start(){if(closed)return;running=true;audio??=new window.AudioContext();},
  input(source,button,pressed){if(closed)return false;if(pressed)heldInputs.add(button);else heldInputs.delete(button);return true;},
  held:b=>heldInputs.has(b),pause(){running=false;heldInputs.clear();},
  async dispose(){if(closed)return;closed=true;running=false;heldInputs.clear();worker?.terminate();clearTimeout(timer);timer=null;cancelAnimationFrame(frame);if(audio)await audio.close();},
  snapshot:()=>({closed,running})
 };
}

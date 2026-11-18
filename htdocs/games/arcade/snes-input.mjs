export const SNES_BUTTONS=Object.freeze(['b','y','select','start','up','down','left','right','a','x','l','r']);
export const SNES_KEYS=Object.freeze({KeyZ:0,KeyA:1,ShiftLeft:2,ShiftRight:2,Enter:3,ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7,KeyX:8,KeyS:9,KeyQ:10,KeyW:11});
export class SnesGamepads {
 constructor({press,release,status,read=()=>navigator.getGamepads?.()??[]}){this.press=press;this.release=release;this.status=status;this.read=read;this.previous=new Map();this.blocked=new Set();}
 clear(){for(const [index,values]of this.previous)for(let i=0;i<12;i++)if(values[i])this.release(`g:${index}:${i}`,values.seat);this.previous.clear();this.blocked.clear();}
 poll(enabled,second=true){let pads;try{pads=Array.from(this.read()).filter(p=>p?.connected&&p.mapping==='standard').slice(0,second?2:1);}catch{this.clear();return;}
  for(const [index,old]of this.previous)if(!pads.some(p=>p.index===index)){for(let i=0;i<12;i++)if(old[i])this.release(`g:${index}:${i}`,old.seat);this.previous.delete(index);this.blocked.delete(index);}
  this.status(pads.length?`${pads.length} controller${pads.length===1?'':'s'} connected · B/A/Y/X face buttons · shoulders L/R`:'Keyboard: arrows, Z=B, X=A, A=Y, S=X, Q=L, W=R, Enter=Start, Shift=Select.');
  for(let n=0;n<pads.length;n++){const pad=pads[n],seat=n+1,pressed=i=>Boolean(pad.buttons[i]?.pressed||pad.buttons[i]?.value>.5),x=pad.axes[0]||0,y=pad.axes[1]||0;const values=[pressed(0),pressed(2),pressed(8),pressed(9),pressed(12)||y<-.45,pressed(13)||y>.45,pressed(14)||x<-.45,pressed(15)||x>.45,pressed(1),pressed(3),pressed(4),pressed(5)];let previous=this.previous.get(pad.index)||Array(12).fill(false);if(previous.seat&&previous.seat!==seat){for(let i=0;i<12;i++)if(previous[i])this.release(`g:${pad.index}:${i}`,previous.seat);previous=Array(12).fill(false);this.blocked.add(pad.index);}
   if(!enabled){for(let i=0;i<12;i++)if(previous[i])this.release(`g:${pad.index}:${i}`,seat);this.blocked.add(pad.index);this.previous.set(pad.index,Object.assign(Array(12).fill(false),{seat}));continue;}
   if(this.blocked.has(pad.index)){if(!values.some(Boolean))this.blocked.delete(pad.index);continue;}
   for(let i=0;i<12;i++)if(values[i]!==previous[i]){if(values[i])this.press(`g:${pad.index}:${i}`,i,seat);else this.release(`g:${pad.index}:${i}`,seat);}this.previous.set(pad.index,Object.assign(values,{seat}));
  }
 }
}

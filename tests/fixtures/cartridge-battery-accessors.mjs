// SYNTHETIC ACCESSOR CONTRACT FIXTURE. No ROM execution or production CPU.
const metadata={battery:true};
export function createMachine(){
 let battery=new Uint8Array(8192),ram=new Uint8Array(2048).fill(31);
 const base={snapshot(){return {ram:ram.slice(),prgRam:battery.slice()};},loadRAM(r,p){ram.set(r);battery.set(p);}};
 function initialize(){}function resetCPU(){}function step(){}
 return Object.freeze({exportBattery(){const s=base.snapshot();if(metadata.battery!==true||!(s.prgRam instanceof Uint8Array)||s.prgRam.length!==8192)throw Error('Battery RAM contract');return s.prgRam.slice();},
 importBattery(value){if(!(value instanceof Uint8Array)||value.length!==8192)throw Error('Exact battery RAM length required');const s=base.snapshot();if(metadata.battery!==true||!(s.ram instanceof Uint8Array)||s.ram.length!==2048||!(s.prgRam instanceof Uint8Array)||s.prgRam.length!==8192)throw Error('Battery RAM contract');base.loadRAM(s.ram,value.slice());},
 reset:initialize,resetCPU,step,advance:()=>{},getState:()=>({cycles:7,mapper:3,ram:Array.from(ram)})});
}

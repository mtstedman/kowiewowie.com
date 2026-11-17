export function instantiate(imports){
 const [runtime,data]=imports;
 const {makeBus,makeCPU,fromHex}=runtime;
 const {metadata,blocks,prgHex,chrHex,trainerHex}=data;
 const getPRG=()=>fromHex(prgHex),getCHR=()=>fromHex(chrHex),getTrainer=()=>fromHex(trainerHex);
 const createBus=(io={})=>makeBus(getPRG(),getTrainer(),io,metadata,getCHR());
 const createCPU=(bus=createBus())=>makeCPU(bus,blocks,metadata);
 return Object.freeze({metadata,CPUError:runtime.CPUError,getPRG,getCHR,getTrainer,createBus,createCPU});
}

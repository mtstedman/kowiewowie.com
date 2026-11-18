import {instantiate as F0} from "../../common/078907181a8d93b65fbb8a9aaebbaa1428b4406da2c8adc08b202f9cc8de85d0.mjs";
import {instantiate as F1} from "../../common/2f0c2fa65cf51c71da65036fb9821fa6f891f6659eb70536bcc8c38ab8279a94.mjs";
import {instantiate as F2} from "../../common/3c1e895d66fcff53e511323b9457d3744d77674a9a9b45e7f1b562e254ee841f.mjs";
import {instantiate as F3} from "../../common/a12fe8384ba28e6180a3c8d4e735318d3548c3c77b6b360f86d299bd465819ca.mjs";
import {instantiate as F4} from "../../common/c251e67459b0c3bb5df558c787fa4b8646b4f8ebb8109136e52fc17dcb5d5883.mjs";
import {instantiate as F5} from "../../common/ff1c49368eb97c54bae00a5cf657b272314bdcde726714bebd9951256a903ee8.mjs";
import {instantiate as F6} from "../../common/c288242eb3b5701d7c3d9db210fd6e3de910c4dc06ad32175a42b8e34f8173e7.mjs";
import {instantiate as F7} from "../../common/49b699f61ed164fa848d9a59f4ae80d6af1757d4e2be39519491a69a0696e150.mjs";
import {admit,createMachine as instantiateMachine} from "../../composer.mjs";
const graph={"entry":"machine.mjs","nodes":[{"dependencies":["runtime.mjs","$data"],"factory":"2f0c2fa65cf51c71da65036fb9821fa6f891f6659eb70536bcc8c38ab8279a94","key":"compiled.mjs"},{"dependencies":[],"factory":"c251e67459b0c3bb5df558c787fa4b8646b4f8ebb8109136e52fc17dcb5d5883","key":"devices.mjs"},{"dependencies":[],"factory":"c288242eb3b5701d7c3d9db210fd6e3de910c4dc06ad32175a42b8e34f8173e7","key":"hardware-config.mjs"},{"dependencies":["hardware-factories.mjs","hardware-config.mjs"],"factory":"a12fe8384ba28e6180a3c8d4e735318d3548c3c77b6b360f86d299bd465819ca","key":"hardware-cpu.mjs"},{"dependencies":[],"factory":"078907181a8d93b65fbb8a9aaebbaa1428b4406da2c8adc08b202f9cc8de85d0","key":"hardware-factories.mjs"},{"dependencies":["runtime.mjs","ppu-mmc3.mjs","compiled.mjs","devices.mjs"],"factory":"ff1c49368eb97c54bae00a5cf657b272314bdcde726714bebd9951256a903ee8","key":"machine.mjs"},{"dependencies":[],"factory":"49b699f61ed164fa848d9a59f4ae80d6af1757d4e2be39519491a69a0696e150","key":"ppu-mmc3.mjs"},{"dependencies":["hardware-cpu.mjs"],"factory":"3c1e895d66fcff53e511323b9457d3744d77674a9a9b45e7f1b562e254ee841f","key":"runtime.mjs"}]};
const factories=Object.freeze({"078907181a8d93b65fbb8a9aaebbaa1428b4406da2c8adc08b202f9cc8de85d0":F0,"2f0c2fa65cf51c71da65036fb9821fa6f891f6659eb70536bcc8c38ab8279a94":F1,"3c1e895d66fcff53e511323b9457d3744d77674a9a9b45e7f1b562e254ee841f":F2,"a12fe8384ba28e6180a3c8d4e735318d3548c3c77b6b360f86d299bd465819ca":F3,"c251e67459b0c3bb5df558c787fa4b8646b4f8ebb8109136e52fc17dcb5d5883":F4,"ff1c49368eb97c54bae00a5cf657b272314bdcde726714bebd9951256a903ee8":F5,"c288242eb3b5701d7c3d9db210fd6e3de910c4dc06ad32175a42b8e34f8173e7":F6,"49b699f61ed164fa848d9a59f4ae80d6af1757d4e2be39519491a69a0696e150":F7});
const abi="timed-mmc3/1";
const required=Object.freeze({"abi":"timed-mmc3/1","battery":false,"board":"standard-txrom","compiler":"fetch-epoch-2","mapper":4,"region":"ntsc"});
const profiles=Object.freeze([{"battery":false,"board":"standard-txrom","chrRamBytes":0,"prgNvramBytes":0,"prgRamBytes":0,"startup":"explicit-banks-zero-irq"},{"battery":false,"board":"standard-txrom","chrRamBytes":0,"prgNvramBytes":0,"prgRamBytes":8192,"startup":"explicit-banks-zero-irq"}]);
function supportsTimedProfile(metadata, profileOrProfiles) {
  if (!metadata || typeof metadata !== 'object' || !metadata.mmc3) return false;
  const profiles = Array.isArray(profileOrProfiles) ? profileOrProfiles : [profileOrProfiles];
  const header = metadata.cartridgeHeader;
  const mmc3 = metadata.mmc3;
  const declaredPrgRam = Number.isSafeInteger(header?.prgRamBytes)
    ? header.prgRamBytes
    : mmc3.prg_ram === '8k' ? 8192 : mmc3.prg_ram === 'none' ? 0 : undefined;
  const declaredPrgNvram = Number.isSafeInteger(header?.prgNvramBytes)
    ? header.prgNvramBytes
    : metadata.battery === false ? 0 : undefined;
  const declaredChrRam = Number.isSafeInteger(header?.chrRamBytes)
    ? header.chrRamBytes
    : Number.isSafeInteger(metadata.chrRamBytes) ? metadata.chrRamBytes : 0;
  const declaredBattery = typeof header?.battery === 'boolean' ? header.battery : metadata.battery;
  return profiles.some((profile) => {
    const expectedPrgRam = profile?.prgRamBytes === 8192 ? '8k' : profile?.prgRamBytes === 0 ? 'none' : null;
    return metadata.mapper === 4
      && metadata.board === profile?.board
      && metadata.battery === profile?.battery
      && declaredBattery === profile?.battery
      && declaredPrgRam === profile?.prgRamBytes
      && declaredPrgNvram === profile?.prgNvramBytes
      && declaredChrRam === profile?.chrRamBytes
      && expectedPrgRam !== null
      && mmc3.board === profile?.board
      && mmc3.prg_ram === expectedPrgRam
      && mmc3.startup_model === profile?.startup;
  });
}
export function createMachine(cartridge,options={}){const r=cartridge?.requirements,m=cartridge?.metadata;if(!r||r.abi!==required.abi||r.battery!==required.battery||r.board!==required.board||r.compiler!==required.compiler||r.mapper!==required.mapper||r.region!==required.region||m?.runtimeRevision!==required.compiler||m?.region!==required.region||!supportsTimedProfile(m,profiles))throw Error("UNSUPPORTED_ENGINE_ABI");return instantiateMachine(admit(cartridge,graph,abi),options,factories,abi);}

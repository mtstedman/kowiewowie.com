import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.1/mmc3-dot-1/398432625b99cdf64b837c006c500c4630d401b5a6520070a0be64175c31bbc8/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

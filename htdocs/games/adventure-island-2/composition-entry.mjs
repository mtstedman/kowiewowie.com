import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.5/mmc3-dot-1/e4351515a599cb945afaae9e36d2dfbdae1360096202fb0d4b5558946654da32/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

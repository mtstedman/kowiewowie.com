import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/mmc2-dot-1/f407942d9d93c23cb247d73ffc206a996775a2ee5968217832c03ad4d0ed989b/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

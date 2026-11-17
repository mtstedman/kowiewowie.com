import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.0/mmc3-dot-1/e423ecd5bd17cbe2bcbfd3e9c99a76a7c1b922a9784106c0e1f22a1bbec4b757/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

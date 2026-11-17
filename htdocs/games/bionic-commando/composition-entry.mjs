import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.1/timed-mmc1-1/5ca20aef639220dee547b8589e48489a70cdb82fd86ecffc1b203d04d21072d3/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.2/timed-mmc1-1/713b4363441fb8bb130d0d994f21f134fcb73178e2fe21ef30bc83475909f6c8/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.1/timed-mmc1-1/3d8426361ffb8b0f6b32898870c9fa13fc89b8ff2b2bcbda84ace93ad14bf843/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

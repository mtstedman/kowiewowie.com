import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.7/timed-mmc1-1/3da8cf271fd75537e9a1fc6f8ef61f8030a65fdaaf37c6fb94c0412766b470a3/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

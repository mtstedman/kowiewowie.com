import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.5/timed-mmc3-1/a765600c5b7ea28cbdea71e45656d10e7fdb92e15d1f72b94d9efdc5eed1908c/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

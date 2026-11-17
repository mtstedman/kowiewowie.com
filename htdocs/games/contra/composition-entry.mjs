import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.0/owned-uxrom-abi2-1/365bcd49b40c28fdf3654b5da8127c2df4ffdd56c28935a18a42d28fb0884f5a/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

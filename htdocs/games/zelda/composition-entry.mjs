import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.6/timed-mmc1-1/75905c6fd1991d17a10a222f75260cbd84a14936ca0e1d7472f7592fdd3f73df/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

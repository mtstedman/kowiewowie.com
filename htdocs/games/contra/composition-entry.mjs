import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.4/owned-uxrom-abi2-1/2ef52b6e1b8f353762184f8795541d3c76f6b24f62123abe3a7e3ee0f58ae1c2/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

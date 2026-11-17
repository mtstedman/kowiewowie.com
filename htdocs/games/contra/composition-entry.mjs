import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.7/owned-uxrom-abi2-1/08ea43374c552c4407690d3e999ee8414a29c214f70a65c70f01867c95a311b0/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

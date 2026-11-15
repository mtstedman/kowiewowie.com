import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.0.0/mmc3-dot-1/0829541f07aaef1a58f8b781cb4e96cffbee8d759b752726ec9916cc48c4efa8/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

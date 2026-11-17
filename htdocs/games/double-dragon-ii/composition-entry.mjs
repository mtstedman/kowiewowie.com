import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.6/timed-mmc3-1/f41d72a86acb9a9c12693a8a0b8f4b9d5e834053e1226510e9ee6bb3cbaa3981/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

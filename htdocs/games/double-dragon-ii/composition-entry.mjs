import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.4/timed-mmc3-1/f0c193f00e238697d35ea13a3926bb05cbc179fe778801bda3b26898ae417f87/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

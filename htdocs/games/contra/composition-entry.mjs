import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.1.0/owned-uxrom-abi2-1/3b48d7a0ad945189eb92b087bc3683aea139101e88e9b0dec0d79716a8c49167/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

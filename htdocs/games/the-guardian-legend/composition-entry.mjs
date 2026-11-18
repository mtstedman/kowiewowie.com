import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/owned-uxrom-abi2-1/2b9a4e88a16821e22ab83cf07033e9e4b7eaeabf3614f4b4e3f9589d27174639/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

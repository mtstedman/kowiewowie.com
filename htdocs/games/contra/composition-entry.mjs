import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.5/owned-uxrom-abi2-1/63b48793bb3175c3ddee1b0027c58d0c6f59215f12d1e2a05c3f05a419a0a9de/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.2/mmc5-dma-1/3d473bec8f2fb294cb27f53259c8932daae45953f06c11f6c1709eb58ae77e81/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

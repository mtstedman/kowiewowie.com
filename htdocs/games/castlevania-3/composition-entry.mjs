import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.1/mmc5-dma-1/d4f6e479712ccc8a16703d20ad053ffbcb4a27cb8bfeee59a93c75d0c7903406/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

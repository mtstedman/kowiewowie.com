import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/mmc5-dma-1/1e0c3416df695d9378a51e60554431d02c8b61b358a3021bd6cd07931ac05802/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.7/mmc5-dma-1/17a45068f53f81b6f72bf925e7b572aaa1c584ba56b418cd2eaa57fba5f7effe/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

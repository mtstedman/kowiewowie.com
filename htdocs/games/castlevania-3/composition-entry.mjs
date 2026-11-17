import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.5/mmc5-dma-1/77cac4b0820c89732cea2efcfcf61e9ad5a66f82542c93148abd4b8fa73af125/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

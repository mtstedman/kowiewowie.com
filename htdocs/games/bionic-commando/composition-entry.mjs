import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.3/timed-mmc1-1/f382811b4af9798dc6d41fa1c81c2bcf05261660e9bffa6382fbcbee9d4f7abe/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

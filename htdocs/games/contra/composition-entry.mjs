import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.3/owned-uxrom-abi2-1/c3524bd9410aa43073a11daba540819678eaa71b44a6d87bd92f764f54edde49/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

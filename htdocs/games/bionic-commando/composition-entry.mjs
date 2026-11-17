import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.6/timed-mmc1-1/1809d1b8d69307e485cb0f32f55bce096e914eee9059603808ef2c66fd37467b/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.2.0/mmc3-dot-1/f8aa1a90081a96bf9e329af33542a2d4eda3f2625d8f60d32a1195d55894c2fc/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.1.0/timed-mmc1-1/abf145633e72f53b8ced8ec7a2b56b3ca0495a6151b12c38c76ff078cde35d70/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

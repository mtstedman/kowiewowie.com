import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/mmc3-dot-1/fccf8ec9b90548f432ee53d0fb2ad6f64edd3365797aa2fc695ca8124037bfd1/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

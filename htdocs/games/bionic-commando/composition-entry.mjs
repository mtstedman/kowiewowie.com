import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.9/timed-mmc1-1/016fd481fb49c9af5bcac6272a9962a335017ed44b3b362bd33930aa2c538dd8/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

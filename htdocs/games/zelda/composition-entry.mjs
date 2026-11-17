import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.0/timed-mmc1-1/fe9c26b8198b378b68fd623faed34730bbfe7f6310ea2935632f75edce77650a/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.5/timed-mmc1-1/eae8336e03ddefc8e069be65a18517d96ca8f1f4576c6e872fc106148ed59004/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

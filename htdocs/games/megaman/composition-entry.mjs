import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.6/legacy-fetch-epoch-1/2c847f6045eaa37850f7e4f488b5b9ea180f393fdaa6410ab0994168916bfca4/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

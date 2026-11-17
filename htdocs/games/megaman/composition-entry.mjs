import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.1/legacy-fetch-epoch-1/646a87795539bb7d0b25b9c2175b53f71223b02b0d5617098fdcf9e84e890811/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

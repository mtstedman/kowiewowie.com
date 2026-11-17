import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.8/legacy-fetch-epoch-1/3616213e44d1f0fcc8cb26e805d724ffd374c5c2443525ca2d21a2831279cf26/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

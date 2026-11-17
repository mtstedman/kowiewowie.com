import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.4/legacy-fetch-epoch-1/5a445d1c6e0e38b176a50ada38d564a44039ebf2c5fe1dd5011cf7512dea7d31/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

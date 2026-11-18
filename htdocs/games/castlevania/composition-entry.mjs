import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/legacy-fetch-epoch-1/0a63987e4e00af00d7a37b08638a9d15e6e2c46e66dc79de42403ee33207ed0c/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

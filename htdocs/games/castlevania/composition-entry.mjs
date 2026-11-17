import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.1/legacy-fetch-epoch-1/5d4ece03808bc6c7e86b5ccab4d6b2e1c1cc44d056b99f1c92f91c522b0f9b7a/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

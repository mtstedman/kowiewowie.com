import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.4/timed-mmc1-1/e3a2dd2889affec8d7686785eecbac17a335a786948ad8b7d12a562359216c65/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

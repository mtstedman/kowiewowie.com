import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/timed-mmc1-1/dc4de03ee38f8af5b85df72b97f0fd2e3c0a7282aefc5f056961d48893db6d84/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

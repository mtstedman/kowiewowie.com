import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/timed-mmc1-1-profile/4595dfca04d12544ad16f3991f50332c5d278c85aef6414d8ecb3aed152ab7c0/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

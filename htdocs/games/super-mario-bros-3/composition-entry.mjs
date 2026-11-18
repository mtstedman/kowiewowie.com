import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/timed-mmc3-1-profile/7b35a0f90a74376491206f55da5423b96d17a4148b753dd32f1e0498914da142/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

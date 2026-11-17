import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.8/timed-mmc3-1/92cd769a50df6bab4786e5f60f5cc219b8364410bb13146143eb45491532bfc5/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

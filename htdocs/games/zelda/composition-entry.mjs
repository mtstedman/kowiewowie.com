import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.4/timed-mmc1-1/12dbcc97cff01b782f4e89c63a7b7c2488e07f9f7cfa70b8881c05a124231fd5/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

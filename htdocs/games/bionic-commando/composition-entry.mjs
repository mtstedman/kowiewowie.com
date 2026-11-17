import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.0/timed-mmc1-1/bed7e05f5ed0ae0def3262b82322b4e1488d792701e643517a43895c8af20311/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

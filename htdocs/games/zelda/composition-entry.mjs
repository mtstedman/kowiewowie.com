import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.2.0/timed-mmc1-1/0fc73456c755119829ba20b6ecce43896553bb73d6ec8c7604d89dff703d9250/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

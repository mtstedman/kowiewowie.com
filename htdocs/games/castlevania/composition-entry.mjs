import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.9/legacy-fetch-epoch-1/8b36c9743bb90e8c6039fc8cdb4963071b0c68e079b5a166de12c5771709e8f0/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

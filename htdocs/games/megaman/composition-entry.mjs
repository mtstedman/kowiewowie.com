import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.14/legacy-fetch-epoch-1/a6c7b4111956e00167fa3c480dcc199b103fc89c2c8f247cd022bfd3384c68fe/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

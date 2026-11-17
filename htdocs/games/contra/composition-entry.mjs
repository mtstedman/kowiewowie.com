import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.1/owned-uxrom-abi2-1/b55ee2f1ef16543893740b71a0ee8c0fa89790a3d3ac8380123e7c60d1cde89f/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

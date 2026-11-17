import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.7/legacy-fetch-epoch-1/996a364a04d5c0d96871b74797f5d83e3aba3b8c9ac0a5a37d5938517290826c/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

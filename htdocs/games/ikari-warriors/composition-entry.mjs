import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.4/legacy-fetch-epoch-1/4e43fa92ac6d5638f52f2bf6b2d6808f19867f0ac5a18a1592f9cd57b299524b/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

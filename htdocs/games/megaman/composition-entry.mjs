import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.5/legacy-fetch-epoch-1/076a983f8eef5c3c5af0d90de523f1ac5eb3b50ebbd0f37fbe8559badc4260bd/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

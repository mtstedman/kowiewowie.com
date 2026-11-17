import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.2/legacy-fetch-epoch-1/60fd1b7212eb8f812eaeed064461e46cf6959b7b640a6f5148ca116a62cc4126/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.3/mmc5-dma-1/f620acb8ff9baa370ffec38c694a559fec925d39c5053cf630e03ae7fe54b158/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

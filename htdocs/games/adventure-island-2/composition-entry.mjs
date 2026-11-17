import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.7/mmc3-dot-1/38cddb30105e07a6e1db01d29a84d14d0b658c5a8ed033aa02e2e710e7a0cd8f/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

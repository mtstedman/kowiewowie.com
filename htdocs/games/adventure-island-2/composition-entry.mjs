import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.4.3/mmc3-dot-1/3b433f32bcf3e0baaa31747934566c3a08daa83aaf6f3613612e090a2243051d/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

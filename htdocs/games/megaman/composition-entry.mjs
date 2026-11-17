import * as cartridge from "./cartridge/entry.mjs";
import {createMachine as compose} from "../engines/nes/1.3.0/legacy-fetch-epoch-1/87aad7833efd67ad06af8aaa7c780987e9e27317c2ccf5a764f0837325dead47/entry.mjs";
export const metadata=cartridge.metadata;
export const createMachine=(options={})=>compose(cartridge,options);

import * as codec from './battery-codec.mjs';
import {createPersistentRuntime as createShared} from '../arcade/battery-client.mjs';
export const createPersistentRuntime=(args,createBase,options)=>createShared(args,createBase,codec,options);

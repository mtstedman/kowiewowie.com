import {createRuntime as createBase} from './host-runtime-base.mjs';
import {createPersistentRuntime} from './battery-client.mjs';
export const createRuntime=args=>createPersistentRuntime(args,createBase);

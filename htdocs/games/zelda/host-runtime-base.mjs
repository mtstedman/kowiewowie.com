import {createRuntime as createShared} from '../arcade/worker-stream-host.mjs';
export const createRuntime=args=>createShared({...args,workerURL:new URL('./worker.mjs',import.meta.url)});

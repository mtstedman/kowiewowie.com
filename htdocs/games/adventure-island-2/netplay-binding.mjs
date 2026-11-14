import {verifyPackage,readBytes} from '../arcade/package.mjs';
import {loadBinding} from '../arcade/session-bridge.mjs';
const e=JSON.parse(new TextDecoder().decode(await readBytes(new URL('./game-package.json',import.meta.url),524288)));
export const binding=await loadBinding(await verifyPackage(e,e.artifactDigest));

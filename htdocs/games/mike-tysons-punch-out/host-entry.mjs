import {createRuntime} from './host-runtime.mjs';
import {GamepadInput} from './gamepad.mjs';
import {TouchDPad} from './touch-dpad.mjs';
import {createNESAdapter,legacy} from '../arcade/nes-adapter.mjs';
export {legacy};
export const version=1;
export const createAdapter=context=>createNESAdapter(context,createRuntime,GamepadInput,TouchDPad);

import {config} from './battery-config.mjs';
import {createBatteryCodec} from '../arcade/battery-codec.mjs';
export const {validateRecord,encodeRAM,decodeRAM,storageKey,readSave,writeSave}=createBatteryCodec(config);

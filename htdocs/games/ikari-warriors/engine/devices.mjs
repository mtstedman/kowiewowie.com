// verified:vendor/jsnes/src/tile.js
var Tile = class {
  constructor() {
    this.pix = new Uint8Array(64);
    this.initialized = false;
    this.opaque = new Uint8Array(8);
  }
  setBuffer(scanline) {
    for (let y = 0; y < 8; y++) {
      this.setScanline(y, scanline[y], scanline[y + 8]);
    }
  }
  setScanline(sline, b1, b2) {
    this.initialized = true;
    let tIndex = sline << 3;
    for (let x = 0; x < 8; x++) {
      this.pix[tIndex + x] = (b1 >> 7 - x & 1) + ((b2 >> 7 - x & 1) << 1);
      if (this.pix[tIndex + x] === 0) {
        this.opaque[sline] = false;
      }
    }
  }
  render(buffer, srcx1, srcy1, srcx2, srcy2, dx, dy, palAdd, palette, flipHorizontal, flipVertical, pri, priTable) {
    if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {
      return;
    }
    if (dx < 0) {
      srcx1 -= dx;
    }
    if (dx + srcx2 >= 256) {
      srcx2 = 256 - dx;
    }
    if (dy < 0) {
      srcy1 -= dy;
    }
    if (dy + srcy2 >= 240) {
      srcy2 = 240 - dy;
    }
    let fbIndex, tIndex, palIndex, tpri;
    if (!flipHorizontal && !flipVertical) {
      fbIndex = (dy << 8) + dx;
      tIndex = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 255)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = tpri & 3840 | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex++;
        }
        fbIndex -= 8;
        fbIndex += 256;
      }
    } else if (flipHorizontal && !flipVertical) {
      fbIndex = (dy << 8) + dx;
      tIndex = 7;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 255)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = tpri & 3840 | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex--;
        }
        fbIndex -= 8;
        fbIndex += 256;
        tIndex += 16;
      }
    } else if (flipVertical && !flipHorizontal) {
      fbIndex = (dy << 8) + dx;
      tIndex = 56;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 255)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = tpri & 3840 | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex++;
        }
        fbIndex -= 8;
        fbIndex += 256;
        tIndex -= 16;
      }
    } else {
      fbIndex = (dy << 8) + dx;
      tIndex = 63;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            palIndex = this.pix[tIndex];
            tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 255)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = tpri & 3840 | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex--;
        }
        fbIndex -= 8;
        fbIndex += 256;
      }
    }
  }
  isTransparent(x, y) {
    return this.pix[(y << 3) + x] === 0;
  }
  toJSON() {
    return {
      opaque: Array.from(this.opaque),
      pix: Array.from(this.pix)
    };
  }
  fromJSON(s) {
    this.opaque.set(s.opaque);
    this.pix.set(s.pix);
  }
};
var tile_default = Tile;

// verified:vendor/jsnes/src/utils.js
function copyArrayElements(src, srcPos, dest, destPos, length) {
  for (let i = 0; i < length; ++i) {
    dest[destPos + i] = src[srcPos + i];
  }
}
function fromJSON(obj, state) {
  const props = obj.constructor.JSON_PROPERTIES;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    const current = obj[prop];
    const value = state[prop];
    if (ArrayBuffer.isView(current) && Array.isArray(value)) {
      current.set(value);
    } else {
      obj[prop] = value;
    }
  }
}
function toJSON(obj) {
  const state = {};
  const props = obj.constructor.JSON_PROPERTIES;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    const value = obj[prop];
    state[prop] = ArrayBuffer.isView(value) ? Array.from(value) : value;
  }
  return state;
}

// verified:vendor/jsnes/src/ppu/nametable.js
var NameTable = class {
  constructor(width, height, name) {
    this.width = width;
    this.height = height;
    this.name = name;
    this.tile = new Uint8Array(width * height);
    this.attrib = new Uint8Array(width * height);
  }
  getTileIndex(x, y) {
    return this.tile[y * this.width + x];
  }
  getAttrib(x, y) {
    return this.attrib[y * this.width + x];
  }
  writeAttrib(index, value) {
    let basex = index % 8 * 4;
    let basey = Math.floor(index / 8) * 4;
    let add;
    let tx, ty;
    let attindex;
    for (let sqy = 0; sqy < 2; sqy++) {
      for (let sqx = 0; sqx < 2; sqx++) {
        add = value >> 2 * (sqy * 2 + sqx) & 3;
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 2; x++) {
            tx = basex + sqx * 2 + x;
            ty = basey + sqy * 2 + y;
            attindex = ty * this.width + tx;
            this.attrib[attindex] = add << 2 & 12;
          }
        }
      }
    }
  }
  toJSON() {
    return {
      tile: Array.from(this.tile),
      attrib: Array.from(this.attrib)
    };
  }
  fromJSON(s) {
    this.tile.set(s.tile);
    this.attrib.set(s.attrib);
  }
};
var nametable_default = NameTable;

// verified:vendor/jsnes/src/ppu/palette-table.js
var PaletteTable = class {
  constructor() {
    this.curTable = new Uint32Array(64);
    this.emphTable = new Array(8);
    this.currentEmph = -1;
  }
  loadNTSCPalette() {
    this.curTable = new Uint32Array([5395026, 11796480, 10485760, 11599933, 7602281, 91, 95, 6208, 12048, 543240, 26368, 1196544, 7153664, 0, 0, 0, 12899815, 16728064, 14421538, 16729963, 14090399, 6818519, 6588, 21681, 27227, 35843, 43776, 2918400, 10777088, 0, 0, 0, 16316664, 16755516, 16742785, 16735173, 16730354, 14633471, 4681215, 46327, 57599, 58229, 259115, 7911470, 15065624, 7895160, 0, 0, 16777215, 16773822, 16300216, 16300248, 16758527, 16761855, 13095423, 10148607, 8973816, 8650717, 12122296, 16119980, 16777136, 16308472, 0, 0]);
    this.makeTables();
    this.setEmphasis(0);
  }
  loadPALPalette() {
    this.curTable = new Uint32Array([5395026, 11796480, 10485760, 11599933, 7602281, 91, 95, 6208, 12048, 543240, 26368, 1196544, 7153664, 0, 0, 0, 12899815, 16728064, 14421538, 16729963, 14090399, 6818519, 6588, 21681, 27227, 35843, 43776, 2918400, 10777088, 0, 0, 0, 16316664, 16755516, 16742785, 16735173, 16730354, 14633471, 4681215, 46327, 57599, 58229, 259115, 7911470, 15065624, 7895160, 0, 0, 16777215, 16773822, 16300216, 16300248, 16758527, 16761855, 13095423, 10148607, 8973816, 8650717, 12122296, 16119980, 16777136, 16308472, 0, 0]);
    this.makeTables();
    this.setEmphasis(0);
  }
  makeTables() {
    let r, g, b, col, i, rFactor, gFactor, bFactor;
    for (let emph = 0; emph < 8; emph++) {
      rFactor = 1;
      gFactor = 1;
      bFactor = 1;
      if ((emph & 1) !== 0) {
        gFactor = 0.75;
        bFactor = 0.75;
      }
      if ((emph & 2) !== 0) {
        rFactor = 0.75;
        bFactor = 0.75;
      }
      if ((emph & 4) !== 0) {
        rFactor = 0.75;
        gFactor = 0.75;
      }
      this.emphTable[emph] = new Uint32Array(64);
      for (i = 0; i < 64; i++) {
        col = this.curTable[i];
        r = Math.floor(this.getRed(col) * rFactor);
        g = Math.floor(this.getGreen(col) * gFactor);
        b = Math.floor(this.getBlue(col) * bFactor);
        this.emphTable[emph][i] = this.getRgb(r, g, b);
      }
    }
  }
  setEmphasis(emph) {
    if (emph !== this.currentEmph) {
      this.currentEmph = emph;
      for (let i = 0; i < 64; i++) {
        this.curTable[i] = this.emphTable[emph][i];
      }
    }
  }
  getEntry(yiq) {
    return this.curTable[yiq];
  }
  getRed(rgb) {
    return rgb >> 16 & 255;
  }
  getGreen(rgb) {
    return rgb >> 8 & 255;
  }
  getBlue(rgb) {
    return rgb & 255;
  }
  getRgb(r, g, b) {
    return r << 16 | g << 8 | b;
  }
  loadDefaultPalette() {
    this.curTable[0] = this.getRgb(117, 117, 117);
    this.curTable[1] = this.getRgb(39, 27, 143);
    this.curTable[2] = this.getRgb(0, 0, 171);
    this.curTable[3] = this.getRgb(71, 0, 159);
    this.curTable[4] = this.getRgb(143, 0, 119);
    this.curTable[5] = this.getRgb(171, 0, 19);
    this.curTable[6] = this.getRgb(167, 0, 0);
    this.curTable[7] = this.getRgb(127, 11, 0);
    this.curTable[8] = this.getRgb(67, 47, 0);
    this.curTable[9] = this.getRgb(0, 71, 0);
    this.curTable[10] = this.getRgb(0, 81, 0);
    this.curTable[11] = this.getRgb(0, 63, 23);
    this.curTable[12] = this.getRgb(27, 63, 95);
    this.curTable[13] = this.getRgb(0, 0, 0);
    this.curTable[14] = this.getRgb(0, 0, 0);
    this.curTable[15] = this.getRgb(0, 0, 0);
    this.curTable[16] = this.getRgb(188, 188, 188);
    this.curTable[17] = this.getRgb(0, 115, 239);
    this.curTable[18] = this.getRgb(35, 59, 239);
    this.curTable[19] = this.getRgb(131, 0, 243);
    this.curTable[20] = this.getRgb(191, 0, 191);
    this.curTable[21] = this.getRgb(231, 0, 91);
    this.curTable[22] = this.getRgb(219, 43, 0);
    this.curTable[23] = this.getRgb(203, 79, 15);
    this.curTable[24] = this.getRgb(139, 115, 0);
    this.curTable[25] = this.getRgb(0, 151, 0);
    this.curTable[26] = this.getRgb(0, 171, 0);
    this.curTable[27] = this.getRgb(0, 147, 59);
    this.curTable[28] = this.getRgb(0, 131, 139);
    this.curTable[29] = this.getRgb(0, 0, 0);
    this.curTable[30] = this.getRgb(0, 0, 0);
    this.curTable[31] = this.getRgb(0, 0, 0);
    this.curTable[32] = this.getRgb(255, 255, 255);
    this.curTable[33] = this.getRgb(63, 191, 255);
    this.curTable[34] = this.getRgb(95, 151, 255);
    this.curTable[35] = this.getRgb(167, 139, 253);
    this.curTable[36] = this.getRgb(247, 123, 255);
    this.curTable[37] = this.getRgb(255, 119, 183);
    this.curTable[38] = this.getRgb(255, 119, 99);
    this.curTable[39] = this.getRgb(255, 155, 59);
    this.curTable[40] = this.getRgb(243, 191, 63);
    this.curTable[41] = this.getRgb(131, 211, 19);
    this.curTable[42] = this.getRgb(79, 223, 75);
    this.curTable[43] = this.getRgb(88, 248, 152);
    this.curTable[44] = this.getRgb(0, 235, 219);
    this.curTable[45] = this.getRgb(0, 0, 0);
    this.curTable[46] = this.getRgb(0, 0, 0);
    this.curTable[47] = this.getRgb(0, 0, 0);
    this.curTable[48] = this.getRgb(255, 255, 255);
    this.curTable[49] = this.getRgb(171, 231, 255);
    this.curTable[50] = this.getRgb(199, 215, 255);
    this.curTable[51] = this.getRgb(215, 203, 255);
    this.curTable[52] = this.getRgb(255, 199, 255);
    this.curTable[53] = this.getRgb(255, 199, 219);
    this.curTable[54] = this.getRgb(255, 191, 179);
    this.curTable[55] = this.getRgb(255, 219, 171);
    this.curTable[56] = this.getRgb(255, 231, 163);
    this.curTable[57] = this.getRgb(227, 255, 163);
    this.curTable[58] = this.getRgb(171, 243, 191);
    this.curTable[59] = this.getRgb(179, 255, 207);
    this.curTable[60] = this.getRgb(159, 255, 243);
    this.curTable[61] = this.getRgb(0, 0, 0);
    this.curTable[62] = this.getRgb(0, 0, 0);
    this.curTable[63] = this.getRgb(0, 0, 0);
    this.makeTables();
    this.setEmphasis(0);
  }
};
var palette_table_default = PaletteTable;

// verified:vendor/jsnes/src/ppu/index.js
var PPU = class {
  // Status flags:
  STATUS_VRAMWRITE = 4;
  STATUS_SLSPRITECOUNT = 5;
  STATUS_SPRITE0HIT = 6;
  STATUS_VBLANK = 7;
  constructor(nes) {
    this.nes = nes;
    this.showSpr0Hit = false;
    this.clipToTvSize = true;
    let i;
    this.vramMem = new Uint8Array(32768);
    this.spriteMem = new Uint8Array(256);
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = 0;
    this.firstWrite = true;
    this.openBusLatch = 0;
    this.openBusDecayFrames = 0;
    this.sramAddress = 0;
    this.currentMirroring = -1;
    this.nmiOutput = false;
    this.nmiSuppressed = false;
    this.vblankPending = false;
    this.frameEnded = false;
    this.dummyCycleToggle = false;
    this.validTileData = false;
    this.scanlineAlreadyRendered = null;
    this.f_nmiOnVblank = 0;
    this.f_spriteSize = 0;
    this.f_bgPatternTable = 0;
    this.f_spPatternTable = 0;
    this.f_addrInc = 0;
    this.f_nTblAddress = 0;
    this.f_color = 0;
    this.f_spVisibility = 0;
    this.f_bgVisibility = 0;
    this.f_spClipping = 0;
    this.f_bgClipping = 0;
    this.f_dispType = 0;
    this.cntFV = 0;
    this.cntV = 0;
    this.cntH = 0;
    this.cntVT = 0;
    this.cntHT = 0;
    this.regFV = 0;
    this.regV = 0;
    this.regH = 0;
    this.regVT = 0;
    this.regHT = 0;
    this.regFH = 0;
    this.regS = 0;
    this.curNt = null;
    this.attrib = new Uint8Array(32);
    this.buffer = new Uint32Array(256 * 240);
    this.bgbuffer = new Uint32Array(256 * 240);
    this.pixrendered = new Uint32Array(256 * 240);
    this.validTileData = null;
    this.scantile = new Array(32);
    this.scanline = 0;
    this.lastRenderedScanline = -1;
    this.curX = 0;
    this.sprX = new Uint8Array(64);
    this.sprY = new Uint8Array(64);
    this.sprTile = new Uint8Array(64);
    this.sprCol = new Uint8Array(64);
    this.vertFlip = new Uint8Array(64);
    this.horiFlip = new Uint8Array(64);
    this.bgPriority = new Uint8Array(64);
    this.spr0HitX = 0;
    this.spr0HitY = 0;
    this.hitSpr0 = false;
    this.secondaryOAM = new Uint8Array(32);
    this.secondaryOAM.fill(255);
    this.spritesFound = 0;
    this.sprite0InSecondary = false;
    this.scanlineSpriteCount = new Uint8Array(241);
    this.scanlineSecondaryOAM = new Uint8Array(241 * 32);
    this.scanlineSprite0 = new Uint8Array(241);
    this.sprPalette = new Uint32Array(16);
    this.imgPalette = new Uint32Array(16);
    this.ptTile = new Array(512);
    for (i = 0; i < 512; i++) {
      this.ptTile[i] = new tile_default();
    }
    this.ntable1 = new Array(4);
    this.currentMirroring = -1;
    this.nameTable = new Array(4);
    for (i = 0; i < 4; i++) {
      this.nameTable[i] = new nametable_default(32, 32, `Nt${i}`);
    }
    this.vramMirrorTable = new Uint16Array(32768);
    for (i = 0; i < 32768; i++) {
      this.vramMirrorTable[i] = i;
    }
    this.palTable = new palette_table_default();
    this.palTable.loadNTSCPalette();
    this.updateControlReg1(0);
    this.updateControlReg2(0);
  }
  // Sets Nametable mirroring.
  setMirroring(mirroring) {
    if (mirroring === this.currentMirroring) {
      return;
    }
    this.currentMirroring = mirroring;
    this.triggerRendering();
    if (this.vramMirrorTable === null) {
      this.vramMirrorTable = new Uint16Array(32768);
    }
    for (let i = 0; i < 32768; i++) {
      this.vramMirrorTable[i] = i;
    }
    this.defineMirrorRegion(16160, 16128, 32);
    this.defineMirrorRegion(16192, 16128, 32);
    this.defineMirrorRegion(16256, 16128, 32);
    this.defineMirrorRegion(16320, 16128, 32);
    this.defineMirrorRegion(12288, 8192, 3840);
    this.defineMirrorRegion(16384, 0, 16384);
    if (mirroring === this.nes.rom.HORIZONTAL_MIRRORING) {
      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;
      this.defineMirrorRegion(9216, 8192, 1024);
      this.defineMirrorRegion(11264, 10240, 1024);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 0;
      this.ntable1[3] = 1;
      this.defineMirrorRegion(10240, 8192, 1024);
      this.defineMirrorRegion(11264, 9216, 1024);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 0;
      this.ntable1[3] = 0;
      this.defineMirrorRegion(9216, 8192, 1024);
      this.defineMirrorRegion(10240, 8192, 1024);
      this.defineMirrorRegion(11264, 8192, 1024);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING2) {
      this.ntable1[0] = 1;
      this.ntable1[1] = 1;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;
      this.defineMirrorRegion(9216, 9216, 1024);
      this.defineMirrorRegion(10240, 9216, 1024);
      this.defineMirrorRegion(11264, 9216, 1024);
    } else {
      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 2;
      this.ntable1[3] = 3;
    }
  }
  // Define a mirrored area in the address lookup table.
  // Assumes the regions don't overlap.
  // The 'to' region is the region that is physically in memory.
  defineMirrorRegion(fromStart, toStart, size) {
    for (let i = 0; i < size; i++) {
      this.vramMirrorTable[fromStart + i] = toStart + i;
    }
  }
  startVBlank() {
    if (this.openBusDecayFrames > 0) {
      this.openBusDecayFrames--;
      if (this.openBusDecayFrames === 0) {
        this.openBusLatch = 0;
      }
    }
    if (this.lastRenderedScanline < 239) {
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        240 - this.lastRenderedScanline
      );
    }
    this.endFrame();
    this.lastRenderedScanline = -1;
  }
  // Fire the VBlank set event at dot 1 of scanline 0 (NES scanline 241).
  // dotsRemaining is the number of dots left in the current advanceDots()
  // call (including the VBlank dot), used for NMI delay calculation.
  // 0 means VBlank fires at the boundary between steps.
  _fireVblankSet(cpu, dotsRemaining) {
    this.vblankPending = false;
    if (!this.nmiSuppressed) {
      this.setStatusFlag(this.STATUS_VBLANK, true);
      this._updateNmiOutput();
      if (cpu.nmiRaised) {
        cpu.nmiDotsRemainingInStep = dotsRemaining;
      }
    }
    this.nmiSuppressed = false;
    this.startVBlank();
    this.frameEnded = true;
  }
  // Fire the VBlank clear event at dot 1 of scanline 20 (NES scanline 261,
  // pre-render). isLastDot indicates whether this is the last dot of the
  // current advanceDots() call. The 6502's NMI edge detector samples at φ2
  // (~2/3 through the bus cycle), so we only promote nmiRaised to nmiPending
  // when φ2 has had time to sample the rising edge — i.e., on the last dot.
  // See https://www.nesdev.org/wiki/NMI
  _fireVblankClear(cpu, isLastDot) {
    if (cpu.nmiRaised && isLastDot) {
      cpu.nmiPending = true;
      cpu.nmiRaised = false;
    }
    this.setStatusFlag(this.STATUS_VBLANK, false);
    this.setStatusFlag(this.STATUS_SPRITE0HIT, false);
    this.setStatusFlag(this.STATUS_SLSPRITECOUNT, false);
    this.hitSpr0 = false;
    this.spr0HitX = -1;
    this.spr0HitY = -1;
    this._updateNmiOutput();
  }
  // Advance the PPU by the given number of dots. Called after every CPU bus
  // cycle with dots=3 (PPU runs at 3x CPU clock). Handles all per-dot events:
  // VBlank set/clear, sprite 0 hit, and scanline boundaries.
  //
  // Sets this.frameEnded = true when VBlank fires (scanline 0, dot 1),
  // signaling the frame loop to break after the current instruction.
  advanceDots(dots) {
    let finalCurX = this.curX + dots;
    if (finalCurX < 341 && !(this.scanline === 0 && this.vblankPending && this.curX <= 1 && finalCurX >= 1) && !(this.scanline === 20 && this.curX <= 1 && finalCurX >= 1) && (this.spr0HitX < this.curX || this.spr0HitX >= finalCurX)) {
      this.curX = finalCurX;
      return;
    }
    let cpu = this.nes.cpu;
    for (let i = 0; i < dots; i++) {
      if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
        this._fireVblankSet(cpu, dots - i);
        this.curX++;
        continue;
      }
      if (this.scanline === 20 && this.curX === 1) {
        this._fireVblankClear(cpu, i === dots - 1);
      }
      if (this.curX === this.spr0HitX && this.f_bgVisibility === 1 && this.f_spVisibility === 1 && this.scanline - 21 === this.spr0HitY) {
        this.setStatusFlag(this.STATUS_SPRITE0HIT, true);
      }
      this.curX++;
      if (this.curX === 341) {
        this.curX = 0;
        this.endScanline();
      }
    }
    if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
      this._fireVblankSet(cpu, 0);
    }
    if (this.scanline === 20 && this.curX === 1) {
      this._fireVblankClear(cpu, true);
    }
  }
  endScanline() {
    switch (this.scanline) {
      case 19:
        if (this.dummyCycleToggle) {
          this.curX = 1;
          this.dummyCycleToggle = !this.dummyCycleToggle;
        }
        break;
      case 20:
        this.performOAMCorruption();
        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            this.renderBgScanline(false, 0);
          }
          this.scanlineSpriteCount[0] = 0;
          this.scanlineSprite0[0] = 0;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[i] = 255;
          }
          let scanline0Base = 1 * 32;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[scanline0Base + i] = this.secondaryOAM[i];
          }
          this.scanlineSpriteCount[1] = this.spritesFound;
          this.scanlineSprite0[1] = this.sprite0InSecondary ? 1 : 0;
          this.sramAddress = 0;
        }
        if (this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          this.checkSprite0(0);
        }
        if (!this.hitSpr0 && this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          if (this._precomputeSprite0Hit(1)) {
            this.hitSpr0 = true;
          }
        }
        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          this.nes.mmap.clockIrqCounter();
        }
        break;
      case 261:
        this.vblankPending = true;
        this.scanline = -1;
        break;
      default:
        if (this.scanline >= 21 && this.scanline <= 260) {
          let bufferScan = this.scanline + 1 - 21;
          this.performOAMCorruption();
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            if (!this.scanlineAlreadyRendered) {
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, bufferScan);
            }
            this.scanlineAlreadyRendered = false;
            if (!this.hitSpr0 && this.f_bgVisibility === 1 && this.f_spVisibility === 1 && this.scanlineSprite0[bufferScan]) {
              if (this.checkSprite0(bufferScan)) {
                this.hitSpr0 = true;
              }
            }
          }
          if (bufferScan < 240) {
            this.evaluateSprites(bufferScan + 1);
          }
          if (!this.hitSpr0 && this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
            this._precomputeSprite0Hit(bufferScan + 1);
            if (this.spr0HitX !== -1) {
              this.hitSpr0 = true;
            }
          }
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            this.nes.mmap.clockIrqCounter();
          }
        }
    }
    this.scanline++;
    this.regsToAddress();
    this.cntsToAddress();
  }
  startFrame() {
    this.scanlineSpriteCount.fill(0);
    this.scanlineSprite0.fill(0);
    let bgColor;
    if (this.f_dispType === 0) {
      bgColor = this.imgPalette[0];
    } else {
      switch (this.f_color) {
        case 0:
          bgColor = 0;
          break;
        case 1:
          bgColor = 65280;
          break;
        case 2:
          bgColor = 255;
          break;
        case 3:
          bgColor = 0;
          break;
        case 4:
          bgColor = 16711680;
          break;
        default:
          bgColor = 0;
      }
    }
    this.buffer.fill(bgColor);
    this.pixrendered.fill(65);
  }
  endFrame() {
    let i, y;
    let buffer = this.buffer;
    if (this.showSpr0Hit) {
      if (this.sprX[0] >= 0 && this.sprX[0] < 256 && this.sprY[0] >= 0 && this.sprY[0] < 240) {
        for (i = 0; i < 256; i++) {
          buffer[(this.sprY[0] << 8) + i] = 16733525;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.sprX[0]] = 16733525;
        }
      }
      if (this.spr0HitX >= 0 && this.spr0HitX < 256 && this.spr0HitY >= 0 && this.spr0HitY < 240) {
        for (i = 0; i < 256; i++) {
          buffer[(this.spr0HitY << 8) + i] = 5635925;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.spr0HitX] = 5635925;
        }
      }
    }
    if (this.clipToTvSize || this.f_bgClipping === 0 || this.f_spClipping === 0) {
      for (y = 0; y < 240; y++) {
        buffer.fill(0, y << 8, (y << 8) + 8);
      }
    }
    if (this.clipToTvSize) {
      for (y = 0; y < 240; y++) {
        buffer.fill(0, (y << 8) + 248, (y << 8) + 256);
      }
      buffer.fill(0, 0, 8 << 8);
      buffer.fill(0, 232 << 8, 240 << 8);
    }
    this.nes.ui.writeFrame(buffer);
  }
  updateControlReg1(value) {
    this.triggerRendering();
    this.f_nmiOnVblank = value >> 7 & 1;
    this.f_spriteSize = value >> 5 & 1;
    this.f_bgPatternTable = value >> 4 & 1;
    this.f_spPatternTable = value >> 3 & 1;
    this.f_addrInc = value >> 2 & 1;
    this.f_nTblAddress = value & 3;
    this.regV = value >> 1 & 1;
    this.regH = value & 1;
    this.regS = value >> 4 & 1;
    this._updateNmiOutput();
  }
  // Recomputes the NMI output level from (vblankFlag AND nmiEnabled).
  // On a false→true transition (rising edge), sets nmiRaised on the CPU.
  // On a true→false transition (falling edge), may cancel a not-yet-latched
  // NMI edge.
  //
  // On real 6502 hardware, the NMI edge detector samples the /NMI line at
  // φ2 of each CPU cycle. Once a falling edge is detected (line goes low),
  // the internal NMI signal is latched and held until the NMI handler
  // begins executing — even if /NMI goes back high on the very next cycle.
  //
  // The edge detector needs the NMI output to be stably asserted before φ2
  // to latch. Two cases where the edge is NOT latched:
  //
  // 1. Same bus cycle: NMI output went high→low within one bus cycle.
  //    The edge detector never saw a stable assertion at φ2.
  //
  // 2. Post-loop boundary: NMI output went high at the very end of a
  //    step() call (post-loop check, nmiDotsRemainingInStep=0), right at
  //    the φ2 boundary. If the NEXT bus cycle immediately causes a falling
  //    edge (e.g., $2002 read clearing VBL) BEFORE its step() runs, the
  //    edge detector at the next φ2 sees the line deasserted. This models
  //    the PPU→CPU propagation delay for NMI output changes right at φ2.
  //
  // nmiPending (promoted from a previous instruction) is never cleared.
  // See https://www.nesdev.org/wiki/NMI
  _updateNmiOutput() {
    let vblank = (this.nes.cpu.mem[8194] & 128) !== 0;
    let newOutput = this.f_nmiOnVblank !== 0 && vblank;
    if (newOutput && !this.nmiOutput) {
      this.nes.cpu.nmiRaised = true;
      this.nes.cpu.nmiRaisedAtCycle = this.nes.cpu.instrBusCycles;
    } else if (!newOutput && this.nmiOutput) {
      if (this.nes.cpu.nmiRaised) {
        let busCycleDiff = this.nes.cpu.instrBusCycles - this.nes.cpu.nmiRaisedAtCycle;
        if (busCycleDiff === 0 || busCycleDiff === 1 && this.nes.cpu.nmiDotsRemainingInStep === 0) {
          this.nes.cpu.nmiRaised = false;
        }
      }
    }
    this.nmiOutput = newOutput;
  }
  updateControlReg2(value) {
    this.triggerRendering();
    this.f_color = value >> 5 & 7;
    this.f_spVisibility = value >> 4 & 1;
    this.f_bgVisibility = value >> 3 & 1;
    this.f_spClipping = value >> 2 & 1;
    this.f_bgClipping = value >> 1 & 1;
    this.f_dispType = value & 1;
    if (!this.hitSpr0 && this.f_bgVisibility === 1 && this.f_spVisibility === 1 && this.scanline >= 21 && this.scanline <= 260) {
      let bufferScan = this.scanline + 1 - 21;
      if (this.scanlineSprite0[bufferScan]) {
        if (this.checkSprite0(bufferScan)) {
          this.hitSpr0 = true;
        }
      }
    }
    if (this.f_dispType === 0) {
      this.palTable.setEmphasis(this.f_color);
    }
    this.updatePalettes();
  }
  setStatusFlag(flag, value) {
    let n = 1 << flag;
    this.nes.cpu.mem[8194] = this.nes.cpu.mem[8194] & 255 - n | (value ? n : 0);
  }
  // CPU Register $2002:
  // Read the Status Register.
  readStatusRegister() {
    let tmp = this.nes.cpu.mem[8194];
    this.firstWrite = true;
    if (this.scanline === 0 && this.curX === 0) {
      this.nmiSuppressed = true;
    }
    this.setStatusFlag(this.STATUS_VBLANK, false);
    this._updateNmiOutput();
    tmp = tmp & 224 | this.openBusLatch & 31;
    this.openBusLatch = tmp;
    this.openBusDecayFrames = 36;
    return tmp;
  }
  // CPU Register $2003:
  // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
  writeSRAMAddress(address) {
    this.sramAddress = address;
  }
  // CPU Register $2004 (R):
  // Read from SPR-RAM (Sprite RAM / OAM).
  // During rendering, returns phase-dependent values instead of normal OAM:
  //  - Cycles 1-64 (secondary OAM clear): returns $FF
  //  - Cycles 65-256 (sprite evaluation): returns the byte being read
  //  - Cycles 257-320 (sprite tile loading): returns secondary OAM data
  // During VBlank or when rendering is disabled, returns OAM[OAMADDR] normally.
  // Bits 2-4 of byte 2 (attributes) always read as 0 (unimplemented bits).
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
  sramLoad() {
    let renderingEnabled = this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      let dot = this.curX;
      if (dot <= 64) {
        return 255;
      } else if (dot <= 256) {
        let val = this.spriteMem[this.sramAddress];
        if ((this.sramAddress & 3) === 2) {
          val &= 227;
        }
        return val;
      } else {
        return 255;
      }
    }
    let value = this.spriteMem[this.sramAddress];
    if ((this.sramAddress & 3) === 2) {
      value &= 227;
    }
    return value;
  }
  // CPU Register $2004 (W):
  // Write to SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramWrite(value) {
    let renderingEnabled = this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      this.sramAddress = this.sramAddress + 4 & 252;
    } else {
      this.spriteMem[this.sramAddress] = value;
      this.spriteRamWriteUpdate(this.sramAddress, value);
      this.sramAddress++;
      this.sramAddress %= 256;
    }
  }
  // CPU Register $2005:
  // Write to scroll registers.
  // The first write is the vertical offset, the second is the
  // horizontal offset:
  scrollWrite(value) {
    this.triggerRendering();
    if (this.firstWrite) {
      this.regHT = value >> 3 & 31;
      this.regFH = value & 7;
    } else {
      this.regFV = value & 7;
      this.regVT = value >> 3 & 31;
    }
    this.firstWrite = !this.firstWrite;
  }
  // CPU Register $2006:
  // Sets the adress used when reading/writing from/to VRAM.
  // The first write sets the high byte, the second the low byte.
  writeVRAMAddress(address) {
    if (this.firstWrite) {
      this.regFV = address >> 4 & 3;
      this.regV = address >> 3 & 1;
      this.regH = address >> 2 & 1;
      this.regVT = this.regVT & 7 | (address & 3) << 3;
    } else {
      this.triggerRendering();
      this.regVT = this.regVT & 24 | address >> 5 & 7;
      this.regHT = address & 31;
      this.cntFV = this.regFV;
      this.cntV = this.regV;
      this.cntH = this.regH;
      this.cntVT = this.regVT;
      this.cntHT = this.regHT;
      this.checkSprite0(this.scanline + 1 - 21);
    }
    this.firstWrite = !this.firstWrite;
    this.cntsToAddress();
    if (this.vramAddress < 8192) {
      this.nes.mmap.latchAccess(this.vramAddress);
    }
  }
  // CPU Register $2007(R):
  // Read from PPU memory. The address should be set first.
  vramLoad() {
    let tmp;
    this.cntsToAddress();
    this.regsToAddress();
    if (this.vramAddress <= 16127) {
      tmp = this.vramBufferedReadValue;
      if (this.vramAddress < 8192) {
        this.vramBufferedReadValue = this.vramMem[this.vramAddress];
      } else {
        this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
      }
      if (this.vramAddress < 8192) {
        this.nes.mmap.latchAccess(this.vramAddress);
      }
      this._incrementVramAddress();
      this.cntsFromAddress();
      this.regsFromAddress();
      return tmp;
    }
    let palIdx = this.vramAddress & 31;
    if ((palIdx & 19) === 16) {
      palIdx &= 15;
    }
    tmp = this.vramMem[16128 + palIdx] & 63 | this.openBusLatch & 192;
    this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress & 12287);
    this._incrementVramAddress();
    this.cntsFromAddress();
    this.regsFromAddress();
    return tmp;
  }
  // CPU Register $2007(W):
  // Write to PPU memory. The address should be set first.
  vramWrite(value) {
    this.triggerRendering();
    this.cntsToAddress();
    this.regsToAddress();
    if (this.vramAddress >= 8192) {
      this.mirroredWrite(this.vramAddress, value);
    } else {
      if (this.nes.mmap.canWriteChr(this.vramAddress)) {
        this.writeMem(this.vramAddress, value);
      }
      this.nes.mmap.latchAccess(this.vramAddress);
    }
    this._incrementVramAddress();
    this.regsFromAddress();
    this.cntsFromAddress();
  }
  // CPU Register $4014:
  // Write 256 bytes of main memory into Sprite RAM (OAM).
  // DMA always copies exactly 256 bytes from CPU page $XX00-$XXFF.
  // The destination starts at the current OAMADDR and wraps within OAM.
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDMA
  sramDMA(value) {
    let baseAddress = value * 256;
    let data;
    for (let i = 0; i < 256; i++) {
      data = this.nes.cpu.mem[baseAddress + i];
      let oamAddr = this.sramAddress + i & 255;
      this.spriteMem[oamAddr] = data;
      this.spriteRamWriteUpdate(oamAddr, data);
    }
    let cpu = this.nes.cpu;
    let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;
    let cycles = currentCycle % 2 === 0 ? 514 : 513;
    cpu.haltCycles(cycles);
  }
  // Updates the scroll registers from a new VRAM address.
  regsFromAddress() {
    let address = this.vramTmpAddress >> 8 & 255;
    this.regFV = address >> 4 & 7;
    this.regV = address >> 3 & 1;
    this.regH = address >> 2 & 1;
    this.regVT = this.regVT & 7 | (address & 3) << 3;
    address = this.vramTmpAddress & 255;
    this.regVT = this.regVT & 24 | address >> 5 & 7;
    this.regHT = address & 31;
  }
  // Increments the VRAM address after a $2007 read or write. During active
  // rendering (either BG or sprites enabled on a visible/pre-render scanline),
  // the increment behaves differently: instead of the normal +1 or +32 linear
  // increment, the PPU performs simultaneous coarse X and Y increments with
  // proper wrapping. This is because the v register is being used as part of
  // the rendering address logic, not as a simple pointer.
  // See https://www.nesdev.org/wiki/PPU_scrolling#$2007_reads_and_writes
  // See https://www.nesdev.org/wiki/PPU_registers#PPUDATA
  _incrementVramAddress() {
    let renderingEnabled = this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    let onRenderingScanline = this.scanline >= 20 && this.scanline <= 260;
    if (renderingEnabled && onRenderingScanline) {
      if ((this.vramAddress & 31) === 31) {
        this.vramAddress &= ~31;
        this.vramAddress ^= 1024;
      } else {
        this.vramAddress += 1;
      }
      if ((this.vramAddress & 28672) !== 28672) {
        this.vramAddress += 4096;
      } else {
        this.vramAddress &= ~28672;
        let coarseY = this.vramAddress >> 5 & 31;
        if (coarseY === 29) {
          coarseY = 0;
          this.vramAddress ^= 2048;
        } else if (coarseY === 31) {
          coarseY = 0;
        } else {
          coarseY += 1;
        }
        this.vramAddress = this.vramAddress & ~992 | coarseY << 5;
      }
    } else {
      this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    }
  }
  // Updates the scroll registers from a new VRAM address.
  cntsFromAddress() {
    let address = this.vramAddress >> 8 & 255;
    this.cntFV = address >> 4 & 3;
    this.cntV = address >> 3 & 1;
    this.cntH = address >> 2 & 1;
    this.cntVT = this.cntVT & 7 | (address & 3) << 3;
    address = this.vramAddress & 255;
    this.cntVT = this.cntVT & 24 | address >> 5 & 7;
    this.cntHT = address & 31;
  }
  regsToAddress() {
    let b1 = (this.regFV & 7) << 4;
    b1 |= (this.regV & 1) << 3;
    b1 |= (this.regH & 1) << 2;
    b1 |= this.regVT >> 3 & 3;
    let b2 = (this.regVT & 7) << 5;
    b2 |= this.regHT & 31;
    this.vramTmpAddress = (b1 << 8 | b2) & 32767;
  }
  cntsToAddress() {
    let b1 = (this.cntFV & 7) << 4;
    b1 |= (this.cntV & 1) << 3;
    b1 |= (this.cntH & 1) << 2;
    b1 |= this.cntVT >> 3 & 3;
    let b2 = (this.cntVT & 7) << 5;
    b2 |= this.cntHT & 31;
    this.vramAddress = (b1 << 8 | b2) & 32767;
  }
  incTileCounter(count) {
    for (let i = count; i !== 0; i--) {
      this.cntHT++;
      if (this.cntHT === 32) {
        this.cntHT = 0;
        this.cntVT++;
        if (this.cntVT >= 30) {
          this.cntH++;
          if (this.cntH === 2) {
            this.cntH = 0;
            this.cntV++;
            if (this.cntV === 2) {
              this.cntV = 0;
              this.cntFV++;
              this.cntFV &= 7;
            }
          }
        }
      }
    }
  }
  // Reads from memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredLoad(address) {
    return this.vramMem[this.vramMirrorTable[address]];
  }
  // Writes to memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredWrite(address, value) {
    if (address >= 16128 && address < 16160) {
      if (address === 16128 || address === 16144) {
        this.writeMem(16128, value);
        this.writeMem(16144, value);
      } else if (address === 16132 || address === 16148) {
        this.writeMem(16132, value);
        this.writeMem(16148, value);
      } else if (address === 16136 || address === 16152) {
        this.writeMem(16136, value);
        this.writeMem(16152, value);
      } else if (address === 16140 || address === 16156) {
        this.writeMem(16140, value);
        this.writeMem(16156, value);
      } else {
        this.writeMem(address, value);
      }
    } else {
      if (address < this.vramMirrorTable.length) {
        this.writeMem(this.vramMirrorTable[address], value);
      } else {
        throw new Error(`Invalid VRAM address: ${address.toString(16)}`);
      }
    }
  }
  triggerRendering() {
    if (this._inRendering) return;
    if (this.scanline >= 21 && this.scanline <= 260) {
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        this.scanline - 21 - this.lastRenderedScanline
      );
      this.lastRenderedScanline = this.scanline - 21;
    }
  }
  renderFramePartially(startScan, scanCount) {
    this._inRendering = true;
    this.nes.mmap.onSpriteRender();
    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 1);
    }
    if (this.f_bgVisibility === 1) {
      let si = startScan << 8;
      let ei = startScan + scanCount << 8;
      if (ei > 61440) {
        ei = 61440;
      }
      let buffer = this.buffer;
      let bgbuffer = this.bgbuffer;
      let pixrendered = this.pixrendered;
      for (let destIndex = si; destIndex < ei; destIndex++) {
        if (pixrendered[destIndex] > 255) {
          buffer[destIndex] = bgbuffer[destIndex];
        }
      }
    }
    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 0);
    }
    this.nes.mmap.onBgRender();
    this._inRendering = false;
    this.validTileData = false;
  }
  renderBgScanline(bgbuffer, scan) {
    let baseTile = this.regS === 0 ? 0 : 256;
    let baseAddr = this.regS === 0 ? 0 : 4096;
    let destIndex = (scan << 8) - this.regFH;
    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];
    this.cntHT = this.regHT;
    this.cntH = this.regH;
    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];
    if (scan < 240 && scan - this.cntFV >= 0) {
      let tscanoffset = this.cntFV << 3;
      let scantile = this.scantile;
      let attrib = this.attrib;
      let ptTile = this.ptTile;
      let nameTable = this.nameTable;
      let imgPalette = this.imgPalette;
      let pixrendered = this.pixrendered;
      let targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;
      let mmap = this.nes.mmap;
      let t, tpix, att, col;
      this._inRendering = true;
      this.nes.mmap.onBgRender();
      if (this.f_spriteSize === 1) {
        mmap.latchAccess(8168);
      }
      for (let tile = 0; tile < 32; tile++) {
        if (scan >= 0) {
          let tileIndex = nameTable[this.curNt].getTileIndex(
            this.cntHT,
            this.cntVT
          );
          if (this.validTileData) {
            t = scantile[tile];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = attrib[tile];
          } else {
            t = ptTile[baseTile + tileIndex];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);
            if (mmap.bgTileOverride) {
              let override = mmap.getBgTileData(
                baseTile,
                tileIndex,
                this.cntHT,
                this.cntVT
              );
              if (override) {
                t = override.tile;
                tpix = t.pix;
                att = override.attrib;
              }
            }
            scantile[tile] = t;
            attrib[tile] = att;
          }
          let sx = 0;
          let x = (tile << 3) - this.regFH;
          if (x > -8) {
            if (x < 0) {
              destIndex -= x;
              sx = -x;
            }
            if (t.opaque[this.cntFV]) {
              for (; sx < 8; sx++) {
                targetBuffer[destIndex] = imgPalette[tpix[tscanoffset + sx] + att];
                pixrendered[destIndex] |= 256;
                destIndex++;
              }
            } else {
              for (; sx < 8; sx++) {
                col = tpix[tscanoffset + sx];
                if (col !== 0) {
                  targetBuffer[destIndex] = imgPalette[col + att];
                  pixrendered[destIndex] |= 256;
                }
                destIndex++;
              }
            }
          }
          mmap.latchAccess(baseAddr + tileIndex * 16 + this.cntFV + 8);
        }
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH++;
          this.cntH %= 2;
          this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
        }
      }
      this._inRendering = false;
      this.validTileData = true;
    }
    this.cntFV++;
    if (this.cntFV === 8) {
      this.cntFV = 0;
      this.cntVT++;
      if (this.cntVT === 30) {
        this.cntVT = 0;
        this.cntV++;
        this.cntV %= 2;
        this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
      } else if (this.cntVT === 32) {
        this.cntVT = 0;
      }
      this.validTileData = false;
    }
  }
  // OAM corruption (2C02G/H hardware bug): if OAMADDR is not zero at the
  // beginning of the pre-render or any visible scanline (when rendering is
  // enabled), the 8 bytes at (OAMADDR & $F8) are copied over the first 8
  // bytes of OAM. This is a DRAM refresh glitch, separate from evaluation.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
  performOAMCorruption() {
    let renderingEnabled = this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (!renderingEnabled) return;
    if (this.sramAddress === 0) return;
    let srcBase = this.sramAddress & 248;
    for (let i = 0; i < 8; i++) {
      this.spriteMem[i] = this.spriteMem[srcBase + i & 255];
    }
    for (let i = 0; i < 8; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }
  // Evaluate sprites for the given scanline, populating secondary OAM and
  // storing results in per-scanline arrays for later batch rendering.
  //
  // On real hardware this runs during cycles 65-256 of each visible scanline,
  // finding up to 8 sprites that are in range for the NEXT scanline. The
  // algorithm is a state machine with counters n (sprite index, 0-63) and
  // m (byte within sprite, 0-3). It includes the hardware sprite overflow
  // bug where both n AND m are incremented when checking for a 9th sprite.
  //
  // targetScanline: the NES scanline (0-239) whose sprites we're evaluating.
  //   Evaluation on visible scanline N finds sprites for scanline N+1.
  //   Results are stored in scanlineSecondaryOAM[targetScanline].
  //
  // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
  evaluateSprites(targetScanline) {
    let renderingEnabled = this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (!renderingEnabled) return;
    let oamBase = targetScanline * 32;
    for (let i = 0; i < 32; i++) {
      this.scanlineSecondaryOAM[oamBase + i] = 255;
    }
    this.scanlineSpriteCount[targetScanline] = 0;
    this.scanlineSprite0[targetScanline] = 0;
    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    let spritesFound = 0;
    let secondaryIndex = 0;
    let startN = this.sramAddress >> 2 & 63;
    let startM = this.sramAddress & 3;
    let overflowM = 0;
    let n = startN;
    let firstSprite = true;
    let evaluated = 0;
    do {
      let m;
      if (spritesFound >= 8) {
        m = overflowM;
      } else if (firstSprite) {
        m = startM;
      } else {
        m = 0;
      }
      firstSprite = false;
      let yByte = this.spriteMem[n * 4 + m & 255];
      if (targetScanline > yByte && targetScanline <= yByte + spriteHeight) {
        if (spritesFound < 8) {
          for (let b = 0; b < 4; b++) {
            this.scanlineSecondaryOAM[oamBase + secondaryIndex + b] = this.spriteMem[n * 4 + m + b & 255];
          }
          if (evaluated === 0) {
            this.scanlineSprite0[targetScanline] = 1;
          }
          spritesFound++;
          secondaryIndex += 4;
        } else {
          this.setStatusFlag(this.STATUS_SLSPRITECOUNT, true);
          break;
        }
      } else if (spritesFound >= 8) {
        overflowM = overflowM + 1 & 3;
      }
      n = n + 1 & 63;
      evaluated++;
    } while (n !== 0);
    this.scanlineSpriteCount[targetScanline] = spritesFound;
    for (let i = 0; i < 32; i++) {
      this.secondaryOAM[i] = this.scanlineSecondaryOAM[oamBase + i];
    }
    this.spritesFound = spritesFound;
    this.sprite0InSecondary = this.scanlineSprite0[targetScanline] === 1;
    this.sramAddress = 0;
  }
  // Render sprites for a range of scanlines using per-scanline secondary OAM
  // data from sprite evaluation. Only the 8 (or fewer) sprites selected by
  // evaluation are rendered, enforcing the hardware's per-scanline sprite limit.
  //
  // bgPri: 0 = render sprites with bg priority 0 (in front of background),
  //         1 = render sprites with bg priority 1 (behind background).
  //
  // Each scanline's sprites come from scanlineSecondaryOAM[], populated by
  // evaluateSprites() during endScanline(). Sprite data is read from secondary
  // OAM format: [Y, tile, attributes, X] × 8 sprites.
  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility !== 1) return;
    let mmap = this.nes.mmap;
    let ptTile = this.ptTile;
    let buffer = this.buffer;
    let sprPalette = this.sprPalette;
    let pixrendered = this.pixrendered;
    for (let scan = startscan; scan < startscan + scancount; scan++) {
      if (scan < 0 || scan >= 240) continue;
      let count = this.scanlineSpriteCount[scan];
      let oamBase = scan * 32;
      for (let i = 0; i < count; i++) {
        let sprY = this.scanlineSecondaryOAM[oamBase + i * 4 + 0];
        let sprTile = this.scanlineSecondaryOAM[oamBase + i * 4 + 1];
        let sprAttr = this.scanlineSecondaryOAM[oamBase + i * 4 + 2];
        let sprX = this.scanlineSecondaryOAM[oamBase + i * 4 + 3];
        let vertFlip = sprAttr >> 7 & 1;
        let horiFlip = sprAttr >> 6 & 1;
        let priority = sprAttr >> 5 & 1;
        let palAdd = (sprAttr & 3) << 2;
        if (priority !== bgPri) continue;
        if (this.f_spriteSize === 0) {
          let tileIndex = this.f_spPatternTable === 0 ? sprTile : sprTile + 256;
          let sprBaseAddr = this.f_spPatternTable === 0 ? 0 : 4096;
          let dy = sprY + 1;
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 8) continue;
          ptTile[tileIndex].render(
            buffer,
            0,
            fineY,
            8,
            fineY + 1,
            sprX,
            dy,
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i,
            // priority: lower index in secondary OAM = higher priority
            pixrendered
          );
          mmap.latchAccess(sprBaseAddr + sprTile * 16 + 8);
        } else {
          let sprBaseAddr = (sprTile & 1) !== 0 ? 4096 : 0;
          let topTileNum = sprTile & 254;
          let top = (sprTile & 1) !== 0 ? topTileNum - 1 + 256 : topTileNum;
          let dy = sprY + 1;
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 16) continue;
          let tileOffset, tileFineY;
          if (fineY < 8) {
            tileOffset = vertFlip ? 1 : 0;
            tileFineY = fineY;
          } else {
            tileOffset = vertFlip ? 0 : 1;
            tileFineY = fineY - 8;
          }
          ptTile[top + tileOffset].render(
            buffer,
            0,
            tileFineY,
            8,
            tileFineY + 1,
            sprX,
            dy + (fineY < 8 ? 0 : 8),
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i,
            pixrendered
          );
          mmap.latchAccess(sprBaseAddr + topTileNum * 16 + 8);
          mmap.latchAccess(sprBaseAddr + (topTileNum + 1) * 16 + 8);
        }
      }
    }
  }
  // Check if sprite 0 overlaps with a background tile pixel on this scanline.
  // "Sprite 0" is the first sprite in evaluation order — normally OAM entry 0,
  // but a non-zero OAMADDR can make a different entry act as sprite 0.
  //
  // On real hardware, sprite 0 hit only fires when a non-transparent sprite
  // pixel overlaps with a non-transparent background tile pixel. We check
  // pixrendered[bufferIndex] > 0xff because bit 8 (256) is set by
  // renderBgScanline when an actual background tile pixel is rendered.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  checkSprite0(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;
    if (scan < 0 || scan >= 240) return false;
    if (!this.scanlineSprite0[scan]) return false;
    if (this.scanlineSpriteCount[scan] === 0) return false;
    let oamBase = scan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let x = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1;
    let vertFlip = sprAttr >> 7 & 1;
    let horiFlip = sprAttr >> 6 & 1;
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;
    let toffset;
    let t;
    let mmap = this.nes.mmap;
    if (this.f_spriteSize === 0) {
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      if (y <= scan && y + 8 > scan && x < 256) {
        t = mmap.getSpritePatternTile(sprTile + tIndexAdd);
        toffset = vertFlip ? 7 - (scan - y) : scan - y;
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    } else {
      if (y <= scan && y + 16 > scan && x < 256) {
        toffset = vertFlip ? 15 - (scan - y) : scan - y;
        if (toffset < 8) {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 1 : 0) + ((sprTile & 1) !== 0 ? 255 : 0)
          );
        } else {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 0 : 1) + ((sprTile & 1) !== 0 ? 255 : 0)
          );
          toffset = vertFlip ? 15 - toffset : toffset - 8;
        }
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    }
    return false;
  }
  // Helper: scan 8 pixels of sprite 0's tile row for overlap with background.
  // Checks for non-transparent sprite pixel overlapping non-transparent BG pixel,
  // excluding x=255 and left-clipped pixels (x=0..7 when leftClip is true).
  _checkSpr0Pixels(tile, toffset, startX, horiFlip, scan, leftClip) {
    let bufferIndex = scan * 256 + startX;
    for (let px = 0; px < 8; px++) {
      let tileIdx = horiFlip ? 7 - px : px;
      let pixelX = startX + px;
      if (pixelX >= 0 && pixelX < 255) {
        if (leftClip && pixelX < 8) {
          bufferIndex++;
          continue;
        }
        if (bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] > 255 && tile.pix[toffset + tileIdx] !== 0) {
          this.spr0HitX = pixelX;
          this.spr0HitY = scan;
          return true;
        }
      }
      bufferIndex++;
    }
    return false;
  }
  // Pre-computes sprite 0 hit for the NEXT scanline by checking BG tile data
  // directly, without requiring a full BG render. This is called after
  // renderBgScanline advances the scroll counters (cntFV/cntVT/cntV) to the
  // next row's position. By detecting the hit one scanline early, the dot-by-
  // dot loop in step() can set STATUS_SPRITE0HIT at the correct PPU cycle
  // instead of one full scanline late.
  //
  // The approach: for each of sprite 0's 8 pixels, compute which BG tile
  // occupies that screen position using the scroll registers, then check if
  // both the sprite pixel and BG pixel are non-transparent.
  //
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  _precomputeSprite0Hit(nextBufferScan) {
    if (nextBufferScan < 1 || nextBufferScan > 239) return false;
    if (!this.scanlineSprite0[nextBufferScan]) return false;
    if (this.scanlineSpriteCount[nextBufferScan] === 0) return false;
    let oamBase = nextBufferScan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let sprX = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1;
    let vertFlip = sprAttr >> 7 & 1;
    let horiFlip = sprAttr >> 6 & 1;
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;
    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    if (!(y <= nextBufferScan && y + spriteHeight > nextBufferScan))
      return false;
    if (sprX >= 256) return false;
    let sprRow = vertFlip ? spriteHeight - 1 - (nextBufferScan - y) : nextBufferScan - y;
    let sprTileObj, toffset;
    if (this.f_spriteSize === 0) {
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      sprTileObj = this.ptTile[sprTile + tIndexAdd];
      toffset = sprRow * 8;
    } else {
      let patternBase = (sprTile & 1) !== 0 ? 256 : 0;
      let baseTileIdx = sprTile & ~1;
      if (sprRow < 8) {
        sprTileObj = this.ptTile[baseTileIdx + patternBase + (vertFlip ? 1 : 0)];
        toffset = sprRow * 8;
      } else {
        sprTileObj = this.ptTile[baseTileIdx + patternBase + (vertFlip ? 0 : 1)];
        toffset = (sprRow - 8) * 8;
      }
    }
    if (!sprTileObj) return false;
    let bgFineY = this.cntFV;
    let bgCoarseY = this.cntVT;
    let bgNtV = this.cntV;
    let baseBgTile = this.regS === 0 ? 0 : 256;
    for (let px = 0; px < 8; px++) {
      let screenX = sprX + px;
      if (screenX >= 255) continue;
      if (leftClip && screenX < 8) continue;
      let tileIdx = horiFlip ? 7 - px : px;
      if (sprTileObj.pix[toffset + tileIdx] === 0) continue;
      let tileOffset = screenX + this.regFH >> 3;
      let absCol = this.regHT + tileOffset;
      let bgNtH = this.regH;
      if (absCol >= 32) {
        absCol -= 32;
        bgNtH ^= 1;
      }
      let ntIdx = this.ntable1[(bgNtV << 1) + bgNtH];
      let bgTileIndex = this.nameTable[ntIdx].getTileIndex(absCol, bgCoarseY);
      let bgTile = this.ptTile[baseBgTile + bgTileIndex];
      if (!bgTile) continue;
      let bgPixelX = screenX + this.regFH & 7;
      if (bgTile.pix[bgFineY * 8 + bgPixelX] !== 0) {
        this.spr0HitX = screenX;
        this.spr0HitY = nextBufferScan - 1;
        return true;
      }
    }
    return false;
  }
  // This will write to PPU memory, and
  // update internally buffered data
  // appropriately.
  writeMem(address, value) {
    this.vramMem[address] = value;
    if (address < 8192) {
      this.vramMem[address] = value;
      this.patternWrite(address, value);
    } else if (address >= 8192 && address < 9152) {
      this.nameTableWrite(this.ntable1[0], address - 8192, value);
    } else if (address >= 9152 && address < 9216) {
      this.attribTableWrite(this.ntable1[0], address - 9152, value);
    } else if (address >= 9216 && address < 10176) {
      this.nameTableWrite(this.ntable1[1], address - 9216, value);
    } else if (address >= 10176 && address < 10240) {
      this.attribTableWrite(this.ntable1[1], address - 10176, value);
    } else if (address >= 10240 && address < 11200) {
      this.nameTableWrite(this.ntable1[2], address - 10240, value);
    } else if (address >= 11200 && address < 11264) {
      this.attribTableWrite(this.ntable1[2], address - 11200, value);
    } else if (address >= 11264 && address < 12224) {
      this.nameTableWrite(this.ntable1[3], address - 11264, value);
    } else if (address >= 12224 && address < 12288) {
      this.attribTableWrite(this.ntable1[3], address - 12224, value);
    } else if (address >= 16128 && address < 16160) {
      this.updatePalettes();
    }
  }
  // Reads data from $3f00 to $f20
  // into the two buffered palettes.
  updatePalettes() {
    let i;
    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[16128 + i] & 63
        );
      } else {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[16128 + i] & 48
        );
      }
    }
    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[16144 + i] & 63
        );
      } else {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[16144 + i] & 48
        );
      }
    }
  }
  // Updates the internal pattern
  // table buffers with this new byte.
  // In vNES, there is a version of this with 4 arguments which isn't used.
  patternWrite(address, value) {
    let tileIndex = address >> 4;
    let leftOver = address & 15;
    if (leftOver < 8) {
      this.ptTile[tileIndex].setScanline(
        leftOver,
        value,
        this.vramMem[address + 8]
      );
    } else {
      this.ptTile[tileIndex].setScanline(
        leftOver - 8,
        this.vramMem[address - 8],
        value
      );
    }
  }
  // Updates the internal name table buffers
  // with this new byte.
  nameTableWrite(index, address, value) {
    this.nameTable[index].tile[address] = value;
    let bufferScan = this.scanline + 1 - 21;
    this.checkSprite0(bufferScan);
  }
  // Updates the internal pattern
  // table buffers with this new attribute
  // table byte.
  attribTableWrite(index, address, value) {
    this.nameTable[index].writeAttrib(address, value);
    this.nameTable[index].tile[960 + address] = value;
  }
  // Updates the internally buffered sprite
  // data with this new byte of info.
  spriteRamWriteUpdate(address, value) {
    let tIndex = address >> 2;
    if (tIndex === 0) {
      let bufferScan = this.scanline + 1 - 21;
      this.checkSprite0(bufferScan);
    }
    switch (address & 3) {
      case 0:
        this.sprY[tIndex] = value;
        break;
      case 1:
        this.sprTile[tIndex] = value;
        break;
      case 2:
        this.vertFlip[tIndex] = value >> 7 & 1;
        this.horiFlip[tIndex] = value >> 6 & 1;
        this.bgPriority[tIndex] = value >> 5 & 1;
        this.sprCol[tIndex] = (value & 3) << 2;
        break;
      case 3:
        this.sprX[tIndex] = value;
        break;
    }
  }
  isPixelWhite(x, y) {
    this.triggerRendering();
    return this.nes.ppu.buffer[(y << 8) + x] === 16777215;
  }
  toJSON() {
    let i;
    let state = toJSON(this);
    state.nameTable = [];
    for (i = 0; i < this.nameTable.length; i++) {
      state.nameTable[i] = this.nameTable[i].toJSON();
    }
    state.ptTile = [];
    for (i = 0; i < this.ptTile.length; i++) {
      state.ptTile[i] = this.ptTile[i].toJSON();
    }
    return state;
  }
  fromJSON(state) {
    let i;
    fromJSON(this, state);
    for (i = 0; i < this.nameTable.length; i++) {
      this.nameTable[i].fromJSON(state.nameTable[i]);
    }
    for (i = 0; i < this.ptTile.length; i++) {
      this.ptTile[i].fromJSON(state.ptTile[i]);
    }
    for (i = 0; i < this.spriteMem.length; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }
  static JSON_PROPERTIES = [
    // Memory
    "vramMem",
    "spriteMem",
    // Counters
    "cntFV",
    "cntV",
    "cntH",
    "cntVT",
    "cntHT",
    // Registers
    "regFV",
    "regV",
    "regH",
    "regVT",
    "regHT",
    "regFH",
    "regS",
    // VRAM addr
    "vramAddress",
    "vramTmpAddress",
    // Control/Status registers
    "f_nmiOnVblank",
    "f_spriteSize",
    "f_bgPatternTable",
    "f_spPatternTable",
    "f_addrInc",
    "f_nTblAddress",
    "f_color",
    "f_spVisibility",
    "f_bgVisibility",
    "f_spClipping",
    "f_bgClipping",
    "f_dispType",
    // VRAM I/O
    "vramBufferedReadValue",
    "firstWrite",
    "openBusLatch",
    "openBusDecayFrames",
    // Mirroring
    "currentMirroring",
    "vramMirrorTable",
    "ntable1",
    // SPR-RAM I/O
    "sramAddress",
    // Sprites. Most sprite data is rebuilt from spriteMem
    "hitSpr0",
    // Secondary OAM: persistent hardware state (not cleared on pre-render)
    "secondaryOAM",
    "spritesFound",
    "sprite0InSecondary",
    // Palettes
    "sprPalette",
    "imgPalette",
    // Rendering progression
    "curX",
    "scanline",
    "lastRenderedScanline",
    "curNt",
    "scantile",
    // Used during rendering
    "attrib",
    "buffer",
    "bgbuffer",
    "pixrendered",
    // Misc
    "nmiOutput",
    "nmiSuppressed",
    "vblankPending",
    "dummyCycleToggle",
    "validTileData",
    "scanlineAlreadyRendered"
  ];
};
var ppu_default = PPU;

// verified:vendor/jsnes/src/papu/channel-dm.js
var ChannelDM = class _ChannelDM {
  static MODE_NORMAL = 0;
  static MODE_LOOP = 1;
  static MODE_IRQ = 2;
  static JSON_PROPERTIES = [
    "isEnabled",
    "hasSample",
    "irqGenerated",
    "playMode",
    "dmaFrequency",
    "dmaCounter",
    "deltaCounter",
    "playStartAddress",
    "playAddress",
    "playLength",
    "playLengthCounter",
    "shiftCounter",
    "reg4012",
    "reg4013",
    "sample",
    "dacLsb",
    "data",
    "lastFetchedByte"
  ];
  constructor(papu) {
    this.papu = papu;
    this.isEnabled = false;
    this.hasSample = false;
    this.irqGenerated = false;
    this.playMode = _ChannelDM.MODE_NORMAL;
    this.dmaFrequency = 0;
    this.dmaCounter = 0;
    this.deltaCounter = 0;
    this.playStartAddress = 0;
    this.playAddress = 0;
    this.playLength = 0;
    this.playLengthCounter = 0;
    this.sample = 0;
    this.dacLsb = 0;
    this.shiftCounter = 0;
    this.reg4012 = 0;
    this.reg4013 = 0;
    this.data = 0;
    this.lastFetchedByte = 0;
  }
  clockDmc() {
    if (this.hasSample) {
      if ((this.data & 1) === 0) {
        if (this.deltaCounter > 0) {
          this.deltaCounter--;
        }
      } else {
        if (this.deltaCounter < 63) {
          this.deltaCounter++;
        }
      }
      this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;
      this.data >>= 1;
    }
    this.dmaCounter--;
    if (this.dmaCounter <= 0) {
      this.hasSample = false;
      this.endOfSample();
      this.dmaCounter = 8;
    }
    if (this.irqGenerated) {
      this.papu.nes.cpu.requestIrq(this.papu.nes.cpu.IRQ_NORMAL);
    }
  }
  endOfSample() {
    if (this.playLengthCounter === 0 && this.playMode === _ChannelDM.MODE_LOOP) {
      this.playAddress = this.playStartAddress;
      this.playLengthCounter = this.playLength;
    }
    if (this.playLengthCounter > 0) {
      this.nextSample();
      if (this.playLengthCounter === 0) {
        if (this.playMode === _ChannelDM.MODE_IRQ) {
          this.irqGenerated = true;
        }
      }
    }
  }
  nextSample() {
    this.data = this.papu.nes.mmap.load(this.playAddress);
    this.lastFetchedByte = this.data;
    this.papu.nes.cpu.haltCycles(4);
    this.playLengthCounter--;
    this.playAddress++;
    if (this.playAddress > 65535) {
      this.playAddress = 32768;
    }
    this.hasSample = true;
  }
  writeReg(address, value) {
    if (address === 16400) {
      if (value >> 6 === 0) {
        this.playMode = _ChannelDM.MODE_NORMAL;
      } else if ((value >> 6 & 1) === 1) {
        this.playMode = _ChannelDM.MODE_LOOP;
      } else if (value >> 6 === 2) {
        this.playMode = _ChannelDM.MODE_IRQ;
      }
      if ((value & 128) === 0) {
        this.irqGenerated = false;
      }
      this.dmaFrequency = this.papu.getDmcFrequency(value & 15);
    } else if (address === 16401) {
      this.deltaCounter = value >> 1 & 63;
      this.dacLsb = value & 1;
      this.sample = (this.deltaCounter << 1) + this.dacLsb;
    } else if (address === 16402) {
      this.playStartAddress = value << 6 | 49152;
      this.reg4012 = value;
    } else if (address === 16403) {
      this.playLength = (value << 4) + 1;
      this.reg4013 = value;
    } else if (address === 16405) {
      this.irqGenerated = false;
      if ((value >> 4 & 1) === 0) {
        this.playLengthCounter = 0;
      } else {
        if (this.playLengthCounter === 0) {
          this.playAddress = this.playStartAddress;
          this.playLengthCounter = this.playLength;
          if (!this.hasSample && this.playLengthCounter > 0) {
            this.nextSample();
            this.dmaCounter = 8;
            this.shiftCounter = this.dmaFrequency;
            if (this.playLengthCounter === 0 && this.playMode === _ChannelDM.MODE_IRQ) {
              this.irqGenerated = true;
            }
          }
        }
      }
    }
  }
  setEnabled(value) {
    this.isEnabled = value;
  }
  getLengthStatus() {
    return this.playLengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }
  getIrqStatus() {
    return this.irqGenerated ? 1 : 0;
  }
  toJSON() {
    return toJSON(this);
  }
  fromJSON(s) {
    fromJSON(this, s);
  }
};
var channel_dm_default = ChannelDM;

// verified:vendor/jsnes/src/papu/channel-noise.js
var ChannelNoise = class {
  constructor(papu) {
    this.papu = papu;
    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.isEnabled = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;
    this.envDecayDisable = false;
    this.envDecayLoopEnable = false;
    this.envReset = false;
    this.shiftNow = false;
    this.envDecayRate = 0;
    this.envDecayCounter = 0;
    this.envVolume = 0;
    this.masterVolume = 0;
    this.shiftReg = 1;
    this.randomBit = 0;
    this.randomMode = 0;
    this.sampleValue = 0;
    this.tmp = 0;
    this.accValue = 0;
    this.accCount = 1;
  }
  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleValue();
      }
    }
  }
  clockEnvDecay() {
    if (this.envReset) {
      this.envReset = false;
      this.envDecayCounter = this.envDecayRate + 1;
      this.envVolume = 15;
    } else if (--this.envDecayCounter <= 0) {
      this.envDecayCounter = this.envDecayRate + 1;
      if (this.envVolume > 0) {
        this.envVolume--;
      } else {
        this.envVolume = this.envDecayLoopEnable ? 15 : 0;
      }
    }
    if (this.envDecayDisable) {
      this.masterVolume = this.envDecayRate;
    } else {
      this.masterVolume = this.envVolume;
    }
    this.updateSampleValue();
  }
  updateSampleValue() {
    if (this.isEnabled && this.lengthCounter > 0) {
      this.sampleValue = this.randomBit * this.masterVolume;
    }
  }
  writeReg(address, value) {
    if (address === 16396) {
      this.envDecayDisable = (value & 16) !== 0;
      this.envDecayRate = value & 15;
      this.envDecayLoopEnable = (value & 32) !== 0;
      this.lengthCounterEnable = (value & 32) === 0;
      if (this.envDecayDisable) {
        this.masterVolume = this.envDecayRate;
      } else {
        this.masterVolume = this.envVolume;
      }
    } else if (address === 16398) {
      this.progTimerMax = this.papu.getNoiseWaveLength(value & 15);
      this.randomMode = value >> 7;
    } else if (address === 16399) {
      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 248);
      }
      this.envReset = true;
    }
  }
  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleValue();
  }
  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }
  toJSON() {
    return toJSON(this);
  }
  fromJSON(s) {
    fromJSON(this, s);
  }
  static JSON_PROPERTIES = [
    "isEnabled",
    "envDecayDisable",
    "envDecayLoopEnable",
    "lengthCounterEnable",
    "envReset",
    "shiftNow",
    "lengthCounter",
    "progTimerCount",
    "progTimerMax",
    "envDecayRate",
    "envDecayCounter",
    "envVolume",
    "masterVolume",
    "shiftReg",
    "randomBit",
    "randomMode",
    "sampleValue",
    "accValue",
    "accCount",
    "tmp"
  ];
};
var channel_noise_default = ChannelNoise;

// verified:vendor/jsnes/src/papu/channel-square.js
var ChannelSquare = class {
  constructor(papu, square1) {
    this.papu = papu;
    this.dutyLookup = [
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      1,
      1,
      1,
      1,
      1
    ];
    this.impLookup = [
      1,
      -1,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      -1,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      -1,
      0,
      0,
      0,
      -1,
      0,
      1,
      0,
      0,
      0,
      0,
      0
    ];
    this.sqr1 = square1;
    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.lengthCounter = 0;
    this.squareCounter = 0;
    this.sweepCounter = 0;
    this.sweepCounterMax = 0;
    this.sweepMode = 0;
    this.sweepShiftAmount = 0;
    this.envDecayRate = 0;
    this.envDecayCounter = 0;
    this.envVolume = 0;
    this.masterVolume = 0;
    this.dutyMode = 0;
    this.vol = 0;
    this.isEnabled = false;
    this.lengthCounterEnable = false;
    this.sweepActive = false;
    this.sweepCarry = false;
    this.envDecayDisable = false;
    this.envDecayLoopEnable = false;
    this.envReset = false;
    this.updateSweepPeriod = false;
    this.sweepResult = 0;
    this.sampleValue = 0;
  }
  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleValue();
      }
    }
  }
  clockEnvDecay() {
    if (this.envReset) {
      this.envReset = false;
      this.envDecayCounter = this.envDecayRate + 1;
      this.envVolume = 15;
    } else if (--this.envDecayCounter <= 0) {
      this.envDecayCounter = this.envDecayRate + 1;
      if (this.envVolume > 0) {
        this.envVolume--;
      } else {
        this.envVolume = this.envDecayLoopEnable ? 15 : 0;
      }
    }
    if (this.envDecayDisable) {
      this.masterVolume = this.envDecayRate;
    } else {
      this.masterVolume = this.envVolume;
    }
    this.updateSampleValue();
  }
  clockSweep() {
    if (--this.sweepCounter <= 0) {
      this.sweepCounter = this.sweepCounterMax + 1;
      if (this.sweepActive && this.sweepShiftAmount > 0 && this.progTimerMax > 7) {
        this.sweepCarry = false;
        if (this.sweepMode === 0) {
          this.progTimerMax += this.progTimerMax >> this.sweepShiftAmount;
          if (this.progTimerMax > 2047) {
            this.progTimerMax = 4095;
            this.sweepCarry = true;
          }
        } else {
          this.progTimerMax = this.progTimerMax - ((this.progTimerMax >> this.sweepShiftAmount) + (this.sqr1 ? 1 : 0));
        }
      }
    }
    if (this.updateSweepPeriod) {
      this.updateSweepPeriod = false;
      this.sweepCounter = this.sweepCounterMax + 1;
    }
  }
  updateSampleValue() {
    if (this.isEnabled && this.lengthCounter > 0 && this.progTimerMax > 7) {
      if (this.sweepMode === 0 && this.progTimerMax + (this.progTimerMax >> this.sweepShiftAmount) > 2047) {
        this.sampleValue = 0;
      } else {
        this.sampleValue = this.masterVolume * this.dutyLookup[(this.dutyMode << 3) + this.squareCounter];
      }
    } else {
      this.sampleValue = 0;
    }
  }
  writeReg(address, value) {
    let addrAdd = this.sqr1 ? 0 : 4;
    if (address === 16384 + addrAdd) {
      this.envDecayDisable = (value & 16) !== 0;
      this.envDecayRate = value & 15;
      this.envDecayLoopEnable = (value & 32) !== 0;
      this.dutyMode = value >> 6 & 3;
      this.lengthCounterEnable = (value & 32) === 0;
      if (this.envDecayDisable) {
        this.masterVolume = this.envDecayRate;
      } else {
        this.masterVolume = this.envVolume;
      }
      this.updateSampleValue();
    } else if (address === 16385 + addrAdd) {
      this.sweepActive = (value & 128) !== 0;
      this.sweepCounterMax = value >> 4 & 7;
      this.sweepMode = value >> 3 & 1;
      this.sweepShiftAmount = value & 7;
      this.updateSweepPeriod = true;
    } else if (address === 16386 + addrAdd) {
      this.progTimerMax &= 1792;
      this.progTimerMax |= value;
    } else if (address === 16387 + addrAdd) {
      this.progTimerMax &= 255;
      this.progTimerMax |= (value & 7) << 8;
      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 248);
      }
      this.envReset = true;
    }
  }
  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleValue();
  }
  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }
  toJSON() {
    return toJSON(this);
  }
  fromJSON(s) {
    fromJSON(this, s);
  }
  static JSON_PROPERTIES = [
    "isEnabled",
    "lengthCounterEnable",
    "sweepActive",
    "envDecayDisable",
    "envDecayLoopEnable",
    "envReset",
    "sweepCarry",
    "updateSweepPeriod",
    "progTimerCount",
    "progTimerMax",
    "lengthCounter",
    "squareCounter",
    "sweepCounter",
    "sweepCounterMax",
    "sweepMode",
    "sweepShiftAmount",
    "envDecayRate",
    "envDecayCounter",
    "envVolume",
    "masterVolume",
    "dutyMode",
    "sweepResult",
    "sampleValue",
    "vol"
  ];
};
var channel_square_default = ChannelSquare;

// verified:vendor/jsnes/src/papu/channel-triangle.js
var ChannelTriangle = class {
  constructor(papu) {
    this.papu = papu;
    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.triangleCounter = 0;
    this.isEnabled = false;
    this.sampleCondition = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;
    this.linearCounter = 0;
    this.lcLoadValue = 0;
    this.lcHalt = true;
    this.lcControl = false;
    this.tmp = 0;
    this.sampleValue = 15;
  }
  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleCondition();
      }
    }
  }
  clockLinearCounter() {
    if (this.lcHalt) {
      this.linearCounter = this.lcLoadValue;
      this.updateSampleCondition();
    } else if (this.linearCounter > 0) {
      this.linearCounter--;
      this.updateSampleCondition();
    }
    if (!this.lcControl) {
      this.lcHalt = false;
    }
  }
  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }
  // eslint-disable-next-line no-unused-vars
  readReg(address) {
    return 0;
  }
  writeReg(address, value) {
    if (address === 16392) {
      this.lcControl = (value & 128) !== 0;
      this.lcLoadValue = value & 127;
      this.lengthCounterEnable = !this.lcControl;
    } else if (address === 16394) {
      this.progTimerMax &= 1792;
      this.progTimerMax |= value;
    } else if (address === 16395) {
      this.progTimerMax &= 255;
      this.progTimerMax |= (value & 7) << 8;
      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 248);
      }
      this.lcHalt = true;
    }
    this.updateSampleCondition();
  }
  clockProgrammableTimer(nCycles) {
    if (this.progTimerMax > 0) {
      this.progTimerCount += nCycles;
      while (this.progTimerMax > 0 && this.progTimerCount >= this.progTimerMax) {
        this.progTimerCount -= this.progTimerMax;
        if (this.isEnabled && this.lengthCounter > 0 && this.linearCounter > 0) {
          this.clockTriangleGenerator();
        }
      }
    }
  }
  clockTriangleGenerator() {
    this.triangleCounter++;
    this.triangleCounter &= 31;
  }
  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleCondition();
  }
  updateSampleCondition() {
    this.sampleCondition = this.isEnabled && this.progTimerMax > 7 && this.linearCounter > 0 && this.lengthCounter > 0;
  }
  toJSON() {
    return toJSON(this);
  }
  fromJSON(s) {
    fromJSON(this, s);
  }
  static JSON_PROPERTIES = [
    "isEnabled",
    "sampleCondition",
    "lengthCounterEnable",
    "lcHalt",
    "lcControl",
    "progTimerCount",
    "progTimerMax",
    "triangleCounter",
    "lengthCounter",
    "linearCounter",
    "lcLoadValue",
    "sampleValue",
    "tmp"
  ];
};
var channel_triangle_default = ChannelTriangle;

// verified:vendor/jsnes/src/papu/index.js
var CPU_FREQ_NTSC = 17897725e-1;
var FRAME_STEPS_4 = [7457, 14913, 22371, 29828, 29829];
var FRAME_STEPS_5 = [7457, 14913, 22371, 29829, 37281];
var FRAME_PERIOD_4 = 29830;
var FRAME_PERIOD_5 = 37282;
var PAPU = class {
  constructor(nes) {
    this.nes = nes;
    this.square1 = new channel_square_default(this, true);
    this.square2 = new channel_square_default(this, false);
    this.triangle = new channel_triangle_default(this);
    this.noise = new channel_noise_default(this);
    this.dmc = new channel_dm_default(this);
    this.startedPlaying = false;
    this.recordOutput = false;
    this.triValue = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.smpAccumL = 0;
    this.smpAccumR = 0;
    this.dacRange = 0;
    this.dcValue = 0;
    this.masterVolume = 256;
    this.panning = [80, 170, 100, 150, 128];
    this.setPanning(this.panning);
    this.initLengthLookup();
    this.initDmcFrequencyLookup();
    this.initNoiseWavelengthLookup();
    this.initDACtables();
    for (let i = 0; i < 20; i++) {
      if (i === 16) {
        this.writeReg(16400, 16);
      } else {
        this.writeReg(16384 + i, 0);
      }
    }
    this.sampleRate = this.nes.opts.sampleRate;
    this.sampleTimerMax = Math.floor(
      1024 * CPU_FREQ_NTSC / this.sampleRate
    );
    this.sampleTimer = 0;
    this.updateChannelEnable(0);
    this.frameCycleCounter = 0;
    this.frameStep = 0;
    this.countSequence = 0;
    this.sampleCount = 0;
    this.frameIrqEnabled = false;
    this.frameIrqActive = false;
    this.frameIrqClearPending = false;
    this.apuCycleParity = 0;
    this.accCount = 0;
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
    this.channelEnableValue = 255;
    this.extraCycles = 0;
    this.maxSample = -5e5;
    this.minSample = 5e5;
  }
  // eslint-disable-next-line no-unused-vars
  readReg(address) {
    let tmp = 0;
    tmp |= this.square1.getLengthStatus();
    tmp |= this.square2.getLengthStatus() << 1;
    tmp |= this.triangle.getLengthStatus() << 2;
    tmp |= this.noise.getLengthStatus() << 3;
    tmp |= this.dmc.getLengthStatus() << 4;
    tmp |= this.nes.cpu.dataBus & 32;
    tmp |= (this.frameIrqActive ? 1 : 0) << 6;
    tmp |= this.dmc.getIrqStatus() << 7;
    if (this.frameIrqActive) {
      this.frameIrqClearPending = true;
    }
    return tmp & 255;
  }
  writeReg(address, value) {
    if (address >= 16384 && address < 16388) {
      this.square1.writeReg(address, value);
    } else if (address >= 16388 && address < 16392) {
      this.square2.writeReg(address, value);
    } else if (address >= 16392 && address < 16396) {
      this.triangle.writeReg(address, value);
    } else if (address >= 16396 && address <= 16399) {
      this.noise.writeReg(address, value);
    } else if (address === 16400) {
      this.dmc.writeReg(address, value);
    } else if (address === 16401) {
      this.dmc.writeReg(address, value);
    } else if (address === 16402) {
      this.dmc.writeReg(address, value);
    } else if (address === 16403) {
      this.dmc.writeReg(address, value);
    } else if (address === 16405) {
      this.updateChannelEnable(value);
      this.dmc.writeReg(address, value);
    } else if (address === 16407) {
      this.countSequence = value >> 7 & 1;
      let cpu = this.nes.cpu;
      let pendingCycles = cpu.instrBusCycles + 1 - cpu.apuCatchupCycles;
      let writeParity = this.apuCycleParity + pendingCycles & 1;
      this.frameCycleCounter = -7 + writeParity;
      this.frameStep = 0;
      if (value & 64) {
        this.frameIrqEnabled = false;
        this.frameIrqActive = false;
        this.frameIrqClearPending = false;
      } else {
        this.frameIrqEnabled = true;
      }
      if (this.countSequence === 1) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
    }
  }
  // Updates channel enable status.
  // This is done on writes to the
  // channel enable register (0x4015),
  // and when the user enables/disables channels
  // in the GUI.
  updateChannelEnable(value) {
    this.channelEnableValue = value & 65535;
    this.square1.setEnabled((value & 1) !== 0);
    this.square2.setEnabled((value & 2) !== 0);
    this.triangle.setEnabled((value & 4) !== 0);
    this.noise.setEnabled((value & 8) !== 0);
    this.dmc.setEnabled((value & 16) !== 0);
  }
  // Clocks all APU channel timers and the frame counter by nCycles CPU cycles.
  // Called once per instruction from the frame loop with the total cycle count.
  // frameCounterAlreadyAdvanced is the number of frame counter cycles already
  // advanced mid-instruction by APU catch-up (advanceFrameCounter). This is
  // subtracted from the frame counter portion only, not from channel timers.
  clockFrameCounter(nCycles, frameCounterAlreadyAdvanced) {
    let frameCounterCycles = nCycles - (frameCounterAlreadyAdvanced || 0);
    this.processFrameIrqClear(frameCounterCycles);
    this.apuCycleParity = this.apuCycleParity + frameCounterCycles & 1;
    nCycles += this.extraCycles;
    let maxCycles = this.sampleTimerMax - this.sampleTimer;
    if (nCycles << 10 > maxCycles) {
      this.extraCycles = (nCycles << 10) - maxCycles >> 10;
      nCycles -= this.extraCycles;
    } else {
      this.extraCycles = 0;
    }
    let dmc = this.dmc;
    let triangle = this.triangle;
    let square1 = this.square1;
    let square2 = this.square2;
    let noise = this.noise;
    if (dmc.isEnabled) {
      dmc.shiftCounter -= nCycles << 3;
      while (dmc.shiftCounter <= 0 && dmc.dmaFrequency > 0) {
        dmc.shiftCounter += dmc.dmaFrequency;
        dmc.clockDmc();
      }
    }
    if (triangle.progTimerMax > 0) {
      triangle.progTimerCount -= nCycles;
      while (triangle.progTimerCount <= 0) {
        triangle.progTimerCount += triangle.progTimerMax + 1;
        if (triangle.linearCounter > 0 && triangle.lengthCounter > 0) {
          triangle.triangleCounter++;
          triangle.triangleCounter &= 31;
          if (triangle.isEnabled) {
            if (triangle.triangleCounter >= 16) {
              triangle.sampleValue = triangle.triangleCounter & 15;
            } else {
              triangle.sampleValue = 15 - (triangle.triangleCounter & 15);
            }
            triangle.sampleValue <<= 4;
          }
        }
      }
    }
    square1.progTimerCount -= nCycles;
    if (square1.progTimerCount <= 0) {
      square1.progTimerCount += square1.progTimerMax + 1 << 1;
      square1.squareCounter++;
      square1.squareCounter &= 7;
      square1.updateSampleValue();
    }
    square2.progTimerCount -= nCycles;
    if (square2.progTimerCount <= 0) {
      square2.progTimerCount += square2.progTimerMax + 1 << 1;
      square2.squareCounter++;
      square2.squareCounter &= 7;
      square2.updateSampleValue();
    }
    let acc_c = nCycles;
    if (noise.progTimerCount - acc_c > 0) {
      noise.progTimerCount -= acc_c;
      noise.accCount += acc_c;
      noise.accValue += acc_c * noise.sampleValue;
    } else {
      while (acc_c-- > 0) {
        if (--noise.progTimerCount <= 0 && noise.progTimerMax > 0) {
          noise.shiftReg <<= 1;
          noise.tmp = (noise.shiftReg << (noise.randomMode === 0 ? 1 : 6) ^ noise.shiftReg) & 32768;
          if (noise.tmp !== 0) {
            noise.shiftReg |= 1;
            noise.randomBit = 0;
            noise.sampleValue = 0;
          } else {
            noise.randomBit = 1;
            if (noise.isEnabled && noise.lengthCounter > 0) {
              noise.sampleValue = noise.masterVolume;
            } else {
              noise.sampleValue = 0;
            }
          }
          noise.progTimerCount += noise.progTimerMax;
        }
        noise.accValue += noise.sampleValue;
        noise.accCount++;
      }
    }
    if (this.frameIrqEnabled && this.frameIrqActive) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
    this._advanceFrameSteps(frameCounterCycles);
    this.accSample(nCycles);
    this.sampleTimer += nCycles << 10;
    if (this.sampleTimer >= this.sampleTimerMax) {
      this.sample();
      this.sampleTimer -= this.sampleTimerMax;
    }
  }
  // Process the deferred frame IRQ flag clear. On real hardware, reading
  // $4015 schedules the clear for the next APU "get" cycle (which happens
  // every 2 CPU cycles). If the current APU phase is "put" (parity 0),
  // the next "get" is 1 cycle away. If "get" (parity 1), it's 2 cycles
  // away. This must be called BEFORE updating apuCycleParity for the
  // current advance, so it sees the parity at the start of the period.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  processFrameIrqClear(nCycles) {
    if (!this.frameIrqClearPending || nCycles <= 0) return;
    let cyclesToNextGet = (this.apuCycleParity & 1) === 0 ? 1 : 2;
    if (nCycles >= cyclesToNextGet) {
      this.frameIrqActive = false;
      this.frameIrqClearPending = false;
    }
  }
  // Advance only the frame counter steps without clocking channel timers,
  // DMC, or audio sampling. Used by CPU APU catch-up to update frame counter
  // state (length counters, envelopes) before $4015 reads, without disturbing
  // DMC DMA timing or audio generation.
  advanceFrameCounter(nCycles) {
    this.processFrameIrqClear(nCycles);
    this.apuCycleParity = this.apuCycleParity + nCycles & 1;
    this._advanceFrameSteps(nCycles);
  }
  // Advance frame counter steps and handle period wrap. Shared by both
  // clockFrameCounter (full APU tick) and advanceFrameCounter (catch-up only).
  // The step loop and period wrap are separated: steps fire when the counter
  // reaches each step's cycle position, and the period wrap only occurs when
  // the counter reaches the full period length (not immediately after the
  // last step). This matters because in 4-step mode, the last step fires at
  // 29829 but the period wrap (and 3rd IRQ assertion) occurs at 29830.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  _advanceFrameSteps(frameCounterCycles) {
    this.frameCycleCounter += frameCounterCycles;
    let steps = this.countSequence === 0 ? FRAME_STEPS_4 : FRAME_STEPS_5;
    let period = this.countSequence === 0 ? FRAME_PERIOD_4 : FRAME_PERIOD_5;
    for (; ; ) {
      if (this.frameStep < steps.length && this.frameCycleCounter >= steps[this.frameStep]) {
        this.fireFrameStep(this.frameStep);
        this.frameStep++;
      } else if (this.frameStep >= steps.length && this.frameCycleCounter >= period) {
        this.frameStep = 0;
        this.frameCycleCounter -= period;
        if (this.countSequence === 0) {
          this.frameIrqActive = this.frameIrqEnabled;
          this.frameIrqClearPending = false;
        }
      } else {
        break;
      }
    }
  }
  accSample(cycles) {
    if (this.triangle.sampleCondition) {
      this.triValue = Math.floor(
        (this.triangle.progTimerCount << 4) / (this.triangle.progTimerMax + 1)
      );
      if (this.triValue > 16) {
        this.triValue = 16;
      }
      if (this.triangle.triangleCounter >= 16) {
        this.triValue = 16 - this.triValue;
      }
      this.triValue += this.triangle.sampleValue;
    }
    if (cycles === 2) {
      this.smpTriangle += this.triValue << 1;
      this.smpDmc += this.dmc.sample << 1;
      this.smpSquare1 += this.square1.sampleValue << 1;
      this.smpSquare2 += this.square2.sampleValue << 1;
      this.accCount += 2;
    } else if (cycles === 4) {
      this.smpTriangle += this.triValue << 2;
      this.smpDmc += this.dmc.sample << 2;
      this.smpSquare1 += this.square1.sampleValue << 2;
      this.smpSquare2 += this.square2.sampleValue << 2;
      this.accCount += 4;
    } else {
      this.smpTriangle += cycles * this.triValue;
      this.smpDmc += cycles * this.dmc.sample;
      this.smpSquare1 += cycles * this.square1.sampleValue;
      this.smpSquare2 += cycles * this.square2.sampleValue;
      this.accCount += cycles;
    }
  }
  // Fire a frame counter step. Each step clocks different APU units depending
  // on the mode and step number.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  fireFrameStep(step) {
    if (this.countSequence === 0) {
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          this.frameIrqActive = true;
          this.frameIrqClearPending = false;
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          this.frameIrqActive = true;
          this.frameIrqClearPending = false;
          break;
      }
    } else {
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
      }
    }
  }
  // Quarter frame: clock envelopes and triangle linear counter (~240Hz)
  clockQuarterFrame() {
    this.square1.clockEnvDecay();
    this.square2.clockEnvDecay();
    this.noise.clockEnvDecay();
    this.triangle.clockLinearCounter();
  }
  // Half frame: clock length counters and sweep units (~120Hz)
  clockHalfFrame() {
    this.triangle.clockLengthCounter();
    this.square1.clockLengthCounter();
    this.square2.clockLengthCounter();
    this.noise.clockLengthCounter();
    this.square1.clockSweep();
    this.square2.clockSweep();
  }
  // Samples the channels, mixes the output together, then writes to buffer.
  sample() {
    let sq_index, tnd_index;
    if (this.accCount > 0) {
      this.smpSquare1 <<= 4;
      this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);
      this.smpSquare2 <<= 4;
      this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);
      this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);
      this.smpDmc <<= 4;
      this.smpDmc = Math.floor(this.smpDmc / this.accCount);
      this.accCount = 0;
    } else {
      this.smpSquare1 = this.square1.sampleValue << 4;
      this.smpSquare2 = this.square2.sampleValue << 4;
      this.smpTriangle = this.triangle.sampleValue;
      this.smpDmc = this.dmc.sample << 4;
    }
    let smpNoise = Math.floor((this.noise.accValue << 4) / this.noise.accCount);
    this.noise.accValue = smpNoise >> 4;
    this.noise.accCount = 1;
    sq_index = this.smpSquare1 * this.stereoPosLSquare1 + this.smpSquare2 * this.stereoPosLSquare2 >> 8;
    tnd_index = 3 * this.smpTriangle * this.stereoPosLTriangle + (smpNoise << 1) * this.stereoPosLNoise + this.smpDmc * this.stereoPosLDMC >> 8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueL = this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;
    sq_index = this.smpSquare1 * this.stereoPosRSquare1 + this.smpSquare2 * this.stereoPosRSquare2 >> 8;
    tnd_index = 3 * this.smpTriangle * this.stereoPosRTriangle + (smpNoise << 1) * this.stereoPosRNoise + this.smpDmc * this.stereoPosRDMC >> 8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueR = this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;
    let smpDiffL = sampleValueL - this.prevSampleL;
    this.prevSampleL += smpDiffL;
    this.smpAccumL += smpDiffL - (this.smpAccumL >> 10);
    sampleValueL = this.smpAccumL;
    let smpDiffR = sampleValueR - this.prevSampleR;
    this.prevSampleR += smpDiffR;
    this.smpAccumR += smpDiffR - (this.smpAccumR >> 10);
    sampleValueR = this.smpAccumR;
    if (sampleValueL > this.maxSample) {
      this.maxSample = sampleValueL;
    }
    if (sampleValueL < this.minSample) {
      this.minSample = sampleValueL;
    }
    if (this.nes.opts.onAudioSample) {
      this.nes.opts.onAudioSample(sampleValueL / 32768, sampleValueR / 32768);
    }
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }
  getLengthMax(value) {
    return this.lengthLookup[value >> 3];
  }
  getDmcFrequency(value) {
    if (value >= 0 && value < 16) {
      return this.dmcFreqLookup[value];
    }
    return 0;
  }
  getNoiseWaveLength(value) {
    if (value >= 0 && value < 16) {
      return this.noiseWavelengthLookup[value];
    }
    return 0;
  }
  // Recalculate the sample timer for a non-standard host frame rate.
  // At 60fps the timer fires once per (CPU_FREQ / sampleRate) cycles. If the
  // host calls frame() at a different rate, scale proportionally so the total
  // audio output per second stays constant.
  setFrameRate(rate) {
    this.sampleTimerMax = Math.floor(
      1024 * CPU_FREQ_NTSC * rate / (this.sampleRate * 60)
    );
  }
  setPanning(pos) {
    for (let i = 0; i < 5; i++) {
      this.panning[i] = pos[i];
    }
    this.updateStereoPos();
  }
  setMasterVolume(value) {
    if (value < 0) {
      value = 0;
    }
    if (value > 256) {
      value = 256;
    }
    this.masterVolume = value;
    this.updateStereoPos();
  }
  updateStereoPos() {
    this.stereoPosLSquare1 = this.panning[0] * this.masterVolume >> 8;
    this.stereoPosLSquare2 = this.panning[1] * this.masterVolume >> 8;
    this.stereoPosLTriangle = this.panning[2] * this.masterVolume >> 8;
    this.stereoPosLNoise = this.panning[3] * this.masterVolume >> 8;
    this.stereoPosLDMC = this.panning[4] * this.masterVolume >> 8;
    this.stereoPosRSquare1 = this.masterVolume - this.stereoPosLSquare1;
    this.stereoPosRSquare2 = this.masterVolume - this.stereoPosLSquare2;
    this.stereoPosRTriangle = this.masterVolume - this.stereoPosLTriangle;
    this.stereoPosRNoise = this.masterVolume - this.stereoPosLNoise;
    this.stereoPosRDMC = this.masterVolume - this.stereoPosLDMC;
  }
  initLengthLookup() {
    this.lengthLookup = [
      10,
      254,
      20,
      2,
      40,
      4,
      80,
      6,
      160,
      8,
      60,
      10,
      14,
      12,
      26,
      14,
      12,
      16,
      24,
      18,
      48,
      20,
      96,
      22,
      192,
      24,
      72,
      26,
      16,
      28,
      32,
      30
    ];
  }
  initDmcFrequencyLookup() {
    this.dmcFreqLookup = new Array(16);
    this.dmcFreqLookup[0] = 3424;
    this.dmcFreqLookup[1] = 3040;
    this.dmcFreqLookup[2] = 2720;
    this.dmcFreqLookup[3] = 2560;
    this.dmcFreqLookup[4] = 2288;
    this.dmcFreqLookup[5] = 2032;
    this.dmcFreqLookup[6] = 1808;
    this.dmcFreqLookup[7] = 1712;
    this.dmcFreqLookup[8] = 1520;
    this.dmcFreqLookup[9] = 1280;
    this.dmcFreqLookup[10] = 1136;
    this.dmcFreqLookup[11] = 1024;
    this.dmcFreqLookup[12] = 848;
    this.dmcFreqLookup[13] = 672;
    this.dmcFreqLookup[14] = 576;
    this.dmcFreqLookup[15] = 432;
  }
  initNoiseWavelengthLookup() {
    this.noiseWavelengthLookup = new Array(16);
    this.noiseWavelengthLookup[0] = 4;
    this.noiseWavelengthLookup[1] = 8;
    this.noiseWavelengthLookup[2] = 16;
    this.noiseWavelengthLookup[3] = 32;
    this.noiseWavelengthLookup[4] = 64;
    this.noiseWavelengthLookup[5] = 96;
    this.noiseWavelengthLookup[6] = 128;
    this.noiseWavelengthLookup[7] = 160;
    this.noiseWavelengthLookup[8] = 202;
    this.noiseWavelengthLookup[9] = 254;
    this.noiseWavelengthLookup[10] = 380;
    this.noiseWavelengthLookup[11] = 508;
    this.noiseWavelengthLookup[12] = 762;
    this.noiseWavelengthLookup[13] = 1016;
    this.noiseWavelengthLookup[14] = 2034;
    this.noiseWavelengthLookup[15] = 4068;
  }
  initDACtables() {
    let value, ival, i;
    let max_sqr = 0;
    let max_tnd = 0;
    this.square_table = new Array(32 * 16);
    this.tnd_table = new Array(204 * 16);
    for (i = 0; i < 32 * 16; i++) {
      value = 95.52 / (8128 / (i / 16) + 100);
      value *= 0.98411;
      value *= 5e4;
      ival = Math.floor(value);
      this.square_table[i] = ival;
      if (ival > max_sqr) {
        max_sqr = ival;
      }
    }
    for (i = 0; i < 204 * 16; i++) {
      value = 163.67 / (24329 / (i / 16) + 100);
      value *= 0.98411;
      value *= 5e4;
      ival = Math.floor(value);
      this.tnd_table[i] = ival;
      if (ival > max_tnd) {
        max_tnd = ival;
      }
    }
    this.dacRange = max_sqr + max_tnd;
    this.dcValue = this.dacRange / 2;
  }
  toJSON() {
    let obj = toJSON(this);
    obj.dmc = this.dmc.toJSON();
    obj.noise = this.noise.toJSON();
    obj.square1 = this.square1.toJSON();
    obj.square2 = this.square2.toJSON();
    obj.triangle = this.triangle.toJSON();
    return obj;
  }
  fromJSON(s) {
    fromJSON(this, s);
    this.dmc.fromJSON(s.dmc);
    this.noise.fromJSON(s.noise);
    this.square1.fromJSON(s.square1);
    this.square2.fromJSON(s.square2);
    this.triangle.fromJSON(s.triangle);
  }
  static JSON_PROPERTIES = [
    "channelEnableValue",
    "sampleRate",
    "frameIrqEnabled",
    "frameIrqActive",
    "frameIrqClearPending",
    "apuCycleParity",
    "startedPlaying",
    "recordOutput",
    "frameCycleCounter",
    "frameStep",
    "countSequence",
    "sampleTimer",
    "sampleTimerMax",
    "sampleCount",
    "triValue",
    "smpSquare1",
    "smpSquare2",
    "smpTriangle",
    "smpDmc",
    "accCount",
    "prevSampleL",
    "prevSampleR",
    "smpAccumL",
    "smpAccumR",
    "masterVolume",
    "stereoPosLSquare1",
    "stereoPosLSquare2",
    "stereoPosLTriangle",
    "stereoPosLNoise",
    "stereoPosLDMC",
    "stereoPosRSquare1",
    "stereoPosRSquare2",
    "stereoPosRTriangle",
    "stereoPosRNoise",
    "stereoPosRDMC",
    "extraCycles",
    "maxSample",
    "minSample",
    "panning"
  ];
};
var papu_default = PAPU;

// verified:vendor/jsnes/src/mappers/mapper0.js
var Mapper0 = class {
  static mapperName = "NROM";
  constructor(nes) {
    this.nes = nes;
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    this.joypadOutputBit0 = 0;
    this.joypadLastWriteCycle = -2;
    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;
    this.bgTileOverride = false;
  }
  write(address, value) {
    if (address < 8192) {
      this.nes.cpu.mem[address & 2047] = value;
    } else if (address >= 32768) {
    } else if (address >= 24576) {
      this.nes.cpu.mem[address] = value;
      this.nes.opts.onBatteryRamWrite(address, value);
    } else if (address > 16407) {
      this.nes.cpu.mem[address] = value;
    } else if (address > 8199 && address < 16384) {
      this.regWrite(8192 + (address & 7), value);
    } else {
      this.regWrite(address, value);
    }
  }
  writelow(address, value) {
    if (address < 8192) {
      this.nes.cpu.mem[address & 2047] = value;
    } else if (address >= 32768) {
    } else if (address > 16407) {
      this.nes.cpu.mem[address] = value;
    } else if (address > 8199 && address < 16384) {
      this.regWrite(8192 + (address & 7), value);
    } else {
      this.regWrite(address, value);
    }
  }
  load(address) {
    address &= 65535;
    if (address > 16407) {
      if (address < 24576) {
        return this.nes.cpu.dataBus;
      }
      return this.nes.cpu.mem[address];
    } else if (address >= 8192) {
      return this.regLoad(address);
    } else {
      return this.nes.cpu.mem[address & 2047];
    }
  }
  regLoad(address) {
    switch (address >> 12) {
      case 0:
        break;
      case 1:
        break;
      case 2:
      // Fall through to case 3
      case 3:
        switch (address & 7) {
          case 0:
            return this.nes.ppu.openBusLatch;
          case 1:
            return this.nes.ppu.openBusLatch;
          case 2:
            return this.nes.ppu.readStatusRegister();
          case 3:
            return this.nes.ppu.openBusLatch;
          case 4:
            return this.nes.ppu.sramLoad();
          case 5:
            return this.nes.ppu.openBusLatch;
          case 6:
            return this.nes.ppu.openBusLatch;
          case 7:
            return this.nes.ppu.vramLoad();
        }
        break;
      case 4:
        switch (address - 16405) {
          case 0:
            return this.nes.papu.readReg(address);
          case 1:
            return this.joy1Read() & 31 | this.nes.cpu.dataBus & 224;
          case 2: {
            let w = 0;
            if (this.zapperX !== null && this.zapperY !== null) {
              if (!this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)) {
                w = 1 << 3;
              }
            }
            if (this.zapperFired) {
              w |= 1 << 4;
            }
            return (this.joy2Read() | w) & 31 | this.nes.cpu.dataBus & 224;
          }
        }
        break;
    }
    let cpu = this.nes.cpu;
    if (cpu._dmcFetchCycles > 0 && cpu._dmcFetchCycles === cpu.instrBusCycles + 1) {
      let dmc = this.nes.papu.dmc;
      if (dmc && dmc.isEnabled) {
        return dmc.lastFetchedByte;
      }
    }
    return cpu.dataBus;
  }
  regWrite(address, value) {
    if (address >= 8192 && address <= 16383) {
      this.nes.ppu.openBusLatch = value;
      this.nes.ppu.openBusDecayFrames = 36;
    }
    switch (address) {
      case 8192:
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg1(value);
        break;
      case 8193:
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg2(value);
        break;
      case 8195:
        this.nes.ppu.writeSRAMAddress(value);
        break;
      case 8196:
        this.nes.ppu.sramWrite(value);
        break;
      case 8197:
        this.nes.ppu.scrollWrite(value);
        break;
      case 8198:
        this.nes.ppu.writeVRAMAddress(value);
        break;
      case 8199:
        this.nes.ppu.vramWrite(value);
        break;
      case 16404:
        this.nes.ppu.sramDMA(value);
        break;
      case 16405:
        this.nes.papu.writeReg(address, value);
        break;
      case 16406: {
        let cpu = this.nes.cpu;
        let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;
        if (currentCycle - this.joypadLastWriteCycle > 1) {
          let prevBit = this.joypadLastWrite & 1;
          if (prevBit !== this.joypadOutputBit0) {
            if (this.joypadOutputBit0 === 1 && prevBit === 0) {
              this.joy1StrobeState = 0;
              this.joy2StrobeState = 0;
            }
            this.joypadOutputBit0 = prevBit;
          }
        }
        this.joypadLastWrite = value;
        this.joypadLastWriteCycle = currentCycle;
        if (currentCycle % 2 === 1) {
          let newBit = value & 1;
          if (this.joypadOutputBit0 === 1 && newBit === 0) {
            this.joy1StrobeState = 0;
            this.joy2StrobeState = 0;
          }
          this.joypadOutputBit0 = newBit;
        }
        break;
      }
      case 16407:
        this.nes.papu.writeReg(address, value);
        break;
      default:
        if (address >= 16384 && address <= 16407) {
          this.nes.papu.writeReg(address, value);
        }
    }
  }
  // Sync any pending $4016 output that was deferred from odd-cycle writes.
  // Called before reads from $4016/$4017, since reads happen on a later
  // cycle and the APU clock will have ticked by then.
  _syncJoypadOutput() {
    let newBit = this.joypadLastWrite & 1;
    if (newBit !== this.joypadOutputBit0) {
      if (this.joypadOutputBit0 === 1 && newBit === 0) {
        this.joy1StrobeState = 0;
        this.joy2StrobeState = 0;
      }
      this.joypadOutputBit0 = newBit;
    }
  }
  joy1Read() {
    this._syncJoypadOutput();
    if (this.joypadOutputBit0) {
      return this.nes.controllers[1].state[0];
    }
    let ret;
    if (this.joy1StrobeState < 8) {
      ret = this.nes.controllers[1].state[this.joy1StrobeState];
    } else {
      ret = 1;
    }
    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) {
      this.joy1StrobeState = 0;
    }
    return ret;
  }
  joy2Read() {
    this._syncJoypadOutput();
    if (this.joypadOutputBit0) {
      return this.nes.controllers[2].state[0];
    }
    let ret;
    if (this.joy2StrobeState < 8) {
      ret = this.nes.controllers[2].state[this.joy2StrobeState];
    } else {
      ret = 1;
    }
    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) {
      this.joy2StrobeState = 0;
    }
    return ret;
  }
  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }
    this.loadPRGROM();
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
  loadPRGROM() {
    if (this.nes.rom.romCount > 1) {
      this.loadRomBank(0, 32768);
      this.loadRomBank(1, 49152);
    } else {
      this.loadRomBank(0, 32768);
      this.loadRomBank(0, 49152);
    }
  }
  loadCHRROM() {
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0);
        this.loadVromBank(0, 4096);
      } else {
        this.loadVromBank(0, 0);
        this.loadVromBank(1, 4096);
      }
    } else {
    }
  }
  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      let ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 8192) {
        copyArrayElements(ram, 0, this.nes.cpu.mem, 24576, 8192);
      }
    }
  }
  loadRomBank(bank, address) {
    bank %= this.nes.rom.romCount;
    copyArrayElements(
      this.nes.rom.rom[bank],
      0,
      this.nes.cpu.mem,
      address,
      16384
    );
  }
  loadVromBank(bank, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();
    copyArrayElements(
      this.nes.rom.vrom[bank % this.nes.rom.vromCount],
      0,
      this.nes.ppu.vramMem,
      address,
      4096
    );
    let vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    copyArrayElements(vromTile, 0, this.nes.ppu.ptTile, address >> 4, 256);
  }
  load32kRomBank(bank, address) {
    this.loadRomBank(bank * 2 % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  }
  load8kVromBank(bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();
    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount,
      address + 4096
    );
  }
  load1kVromBank(bank1k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();
    let bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    let bankoffset = bank1k % 4 * 1024;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      1024
    );
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[(bank1k % 4 << 6) + i];
    }
  }
  load2kVromBank(bank2k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();
    let bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    let bankoffset = bank2k % 2 * 2048;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      2048
    );
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[(bank2k % 2 << 7) + i];
    }
  }
  load8kRomBank(bank8k, address) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let offset = bank8k % 2 * 8192;
    copyArrayElements(
      this.nes.rom.rom[bank16k],
      offset,
      this.nes.cpu.mem,
      address,
      8192
    );
  }
  // Returns true if the PPU can write to the given pattern table address.
  // Most mappers only allow writes when there's no CHR ROM (pure CHR RAM).
  // Mappers with mixed CHR ROM/RAM (e.g. TQROM) override this.
  // eslint-disable-next-line no-unused-vars
  canWriteChr(address) {
    return this.nes.rom.vromCount === 0;
  }
  clockIrqCounter() {
  }
  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
  }
  // Called by the PPU before rendering background tiles for a scanline.
  // Override in mappers that need per-phase CHR bank switching (e.g. MMC5,
  // which uses separate CHR bank sets for sprites vs backgrounds).
  onBgRender() {
  }
  // Called by the PPU before rendering sprites.
  // Override in mappers that need per-phase CHR bank switching.
  onSpriteRender() {
  }
  // Called per-tile during BG rendering when bgTileOverride is true.
  // Returns {tile, attrib} to override the tile and attribute for a
  // background tile, or null to use the default lookup.
  // Used by MMC5 ExRAM mode 1 for per-tile CHR bank selection.
  getBgTileData() {
    return null;
  }
  // Look up a sprite pattern tile by ptTile index (0-511).
  // Default: return from the PPU's current ptTile cache.
  // MMC5 overrides this to look up from Set A's VROM banks directly,
  // since ptTile may have BG data (Set B) loaded during BG rendering.
  // This avoids calling load*VromBank (which triggers triggerRendering).
  getSpritePatternTile(index) {
    return this.nes.ppu.ptTile[index];
  }
  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
      joypadOutputBit0: this.joypadOutputBit0,
      joypadLastWriteCycle: this.joypadLastWriteCycle
    };
  }
  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
    this.joypadOutputBit0 = s.joypadOutputBit0 || 0;
    this.joypadLastWriteCycle = s.joypadLastWriteCycle ?? -2;
  }
};
var mapper0_default = Mapper0;

// verified:vendor/jsnes/src/controller.js
var Controller = class _Controller {
  static BUTTON_A = 0;
  static BUTTON_B = 1;
  static BUTTON_SELECT = 2;
  static BUTTON_START = 3;
  static BUTTON_UP = 4;
  static BUTTON_DOWN = 5;
  static BUTTON_LEFT = 6;
  static BUTTON_RIGHT = 7;
  // Turbo buttons rapidly toggle A/B each frame while held, simulating the
  // extra buttons on the NES Advantage and dogbone controllers.
  static BUTTON_TURBO_A = 8;
  static BUTTON_TURBO_B = 9;
  static JSON_PROPERTIES = [
    "state",
    "baseA",
    "baseB",
    "turboA",
    "turboB",
    "turboToggle"
  ];
  constructor() {
    this.state = new Array(8);
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = 64;
    }
    this.baseA = 64;
    this.baseB = 64;
    this.turboA = false;
    this.turboB = false;
    this.turboToggle = false;
  }
  buttonDown(key) {
    if (key === _Controller.BUTTON_TURBO_A) {
      this.turboA = true;
    } else if (key === _Controller.BUTTON_TURBO_B) {
      this.turboB = true;
    } else {
      this.state[key] = 65;
      if (key === _Controller.BUTTON_A) this.baseA = 65;
      if (key === _Controller.BUTTON_B) this.baseB = 65;
    }
  }
  buttonUp(key) {
    if (key === _Controller.BUTTON_TURBO_A) {
      this.turboA = false;
      this.state[_Controller.BUTTON_A] = this.baseA;
    } else if (key === _Controller.BUTTON_TURBO_B) {
      this.turboB = false;
      this.state[_Controller.BUTTON_B] = this.baseB;
    } else {
      this.state[key] = 64;
      if (key === _Controller.BUTTON_A) this.baseA = 64;
      if (key === _Controller.BUTTON_B) this.baseB = 64;
    }
  }
  // Called once per frame to toggle turbo button states. Produces a ~30 Hz
  // press rate at 60 FPS, matching the fast end of the NES Advantage's
  // adjustable turbo range.
  clock() {
    if (!this.turboA && !this.turboB) return;
    this.turboToggle = !this.turboToggle;
    if (this.turboA) {
      this.state[_Controller.BUTTON_A] = this.turboToggle ? 65 : 64;
    }
    if (this.turboB) {
      this.state[_Controller.BUTTON_B] = this.turboToggle ? 65 : 64;
    }
  }
  toJSON() {
    return toJSON(this);
  }
  fromJSON(s) {
    fromJSON(this, s);
  }
};
var controller_default = Controller;
export {
  controller_default as Controller,
  mapper0_default as Mapper0,
  papu_default as PAPU,
  ppu_default as PPU
};

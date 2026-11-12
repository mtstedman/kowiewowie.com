Build adapter: romjs-browser-fast-build. Only build mode is exposed. Historical library self_test descriptions below do not describe execution by this adapter. The candidate ROM compile was reported successful by the user; its full self_test timed out at 25 seconds and is not a pass. Browser performance has not been observed; no speed claim is made.

# Translated NES machine, browser package API3

Serve the whole directory over static HTTP and open index.html, or a directory URL ending in /. Relative references support nested prefixes. Serve .mjs as JavaScript and styles.css as text/css. The external module script, external authenticated stylesheet, same-origin module worker, canvas and in-memory Web Audio target Content-Security-Policy: default-src 'self' without unsafe-inline or unsafe-eval. There is no CDN, blob worker, inline script/style, HTML event-handler attribute, dynamic compilation or audio worklet. External JavaScript assigns function-valued event properties. The builder does not configure HTTP headers, publish or start a server. Actual browser interaction and CSP enforcement require a separate browser test.

Start enables gesture audio. Pause releases controls and stops scheduling/audio; Reset replaces the worker. Initialization/frame deadlines terminate failures. No npm/compiler/raw-ROM loader is needed by the generated browser application. DOM and AudioContext behavior remain untested by Node self_test.

Node imports createMachine from the file URL of machine.mjs with its relative graph intact. worker.mjs and runner.mjs import precisely the same machine. Run node runner.mjs with JSON on stdin, e.g. {"frames":8,"maxMs":3000,"buttons":[0]}, plus an external process timeout. Hashes are observations, not equivalence certificates.

createMachine({startPC?}) and reset({startPC?}) recreate deterministic power state: zero RAM, trainer, configured mapper, CHR and devices. startPC must be immutable PRG. resetCPU() preserves mapper/RAM/CHR/devices, reads the current mapped reset vector, advances seven CPU/device/cartridge cycles and drains resulting DMC requests. Invalid reset options are rejected before mutation. RAM is volatile; no saves/checkpoints.

step() calls only authenticated compiler instruction-specialized functions and returns kind, pc, cycles, physicalPC, mappings and writes. CPU write cycle is null for mapper0/2. No opcode-dispatch CPU, runtime compilation or JSNES CPU/NES orchestration is included. Bank/window modules stay native ESM; JSNES mapper0 supplies device registers, with cartridge loaders and banking methods trapped.

advance({maxSteps,maxCycles,maxMs}) and frame(options) default to 20000/40000/250; maxima100000/1000000/1000. frame throws FRAME_BUDGET if incomplete and callers may continue. Other execution errors require power reset. Bounds are checked between steps; one instruction plus bounded DMA may overshoot by4617 cycles. No synchronous user callbacks. Audio is48000Hz interleaved stereo, bounded16384 frames; oldest samples are dropped and counted. takeAudio drains it. getFrame copies256x240 packed0xBBGGRR; getRGBA copies RGBA bytes.

setButton(port,button,down): ports1/2, buttons0=A,1=B,2=Select,3=Start,4=Up,5=Down,6=Left,7=Right; down boolean. Reads shift eight latched bits then one. getState copies counters, mapper, last16 mapper writes and last32 CPU writes. readMemory/readDeviceMemory exclude I/O and copy up to4096 bytes through live mapping. readPPUMemory is a pure diagnostic, not a PPU bus transaction. getOAM/getPPUCache return copies. checkInterpreterGuard deliberately trips the non-executable facade and counts that diagnostic call.

Only complete NTSC ordinary iNES API3 fetch-epoch-2 artifacts are accepted. NROM128/256 and explicit UxROM policies are supported. MMC1 requires wiring, revision, prg_ram and all four startup registers. standard/SNROM support compiler MMC1A/B classes; fixed32 models unbanked32KiB CPU wiring. Exact compiler validates geometry/policy; API.md documents restrictions. No title/hash dispatch or guessed boards. Outer banking, extended RAM, NES2/PAL, unofficial instructions, mutable code and expansion hardware fail.

MMC1 write(address,value,absoluteCycle) and getCPUClock/advanceCPUClock are forwarded. Devices advance before each exact compiler write offset and at instruction/interrupt/reset completion. Reads do not advance time: no read offsets are supplied, and changing mapping during guarded fetches violates compiler epoch checks. Read effects and interrupt sampling remain approximate. NMI/IRQ delivery occurs outside CPU execution. DMA idle cycles advance cartridge time; reporting-counter edits alone do not. RMW old/new values independently reach the bus on consecutive cycles; compiler suppression/reset precedence and UxROM conflicts remain authoritative. Mapper0/2 retain aggregate timing.

DMC uses live PRG, immediate fetches and four-cycle stalls, not RDY arbitration/dummy reads/controller glitches. OAM copies256 read/write pairs, wraps OAMADDR and models513/514 cycles. OAM/DMC overlap, multiple requests, active-render OAM and transfers crossing into rendering fail. Frame-sequencer writes schedule three/four-cycle reset; five-step clocks occur there.

Compiler CHR is authoritative. PPUDATA buffering/palette reads use mapped CHR/CIRAM. PPUADDR/PPUDATA drive setPPUAddress. CHR writes update physical aliases and decoded tiles; bank changes refresh caches. Physical CIRAM/NameTable storage persists independently of single-screen/H/V/four-screen mappings. Active-render CHR/mirroring changes fail because JSNES is a scanline renderer; PRG-only changes remain supported. Disabled-render/vblank mapping changes work within this model. SNROM unequal CHR0/CHR1 bit4 gates in4KiB mode fail during rendering because lazy notifications are not exact PPU A12. Equal gates or8KiB mode are address independent. Active-render PPUADDR/PPUDATA fail. Full raster/game correctness is not established.

Before supplied ESM is consumed, the builder checks complete graph, hashes, ROM components, mapping identity, policy, API/revision and scan completeness. It snapshots ROM in a new job, verifies the entire compiler source SHA, loads its library before the CLI boundary, regenerates every file and compares every manifest field and byte. Policy insertion order is retained. All output files except manifest.json are hashed there; its hash is returned separately. bundle-inputs.json authenticates CSS before esbuild parses it; browser metadata includes CSS. Failed/reproduction jobs remain confined and count against budgets.

Compiler source is the locally authenticated unpublished candidate draft-07b449e9efb76c1a24c21b6648e521ba, SHA256 065e65d6d93390948b8fb60c985f8457a19fbdbb4b463e776888d2e95f5e0315. No active owner compiler digest is asserted; source SHA is enforced. JSNES/device/esbuild source and binary pins are preserved. Device sources are copied unchanged. esbuild receives only authenticated in-memory graph contents. Shared resolver canonicalizes ./ entries and legitimate parent-relative imports without leaving the root. Absolute/drive/URL/backslash/encoded/suffixed paths, root escapes before reentry, missing members, invalid contexts and CPU/NES modules fail. No filesystem fallback or external dependency. Build bundles devices and parses/resolves the browser graph without executing game modules.

Requires Linux/Python3, Node24, JSNES2.1.0 and esbuild0.28.2 at fixed installed paths. No installation/network/grants/active-definition changes. Trusted owner directories/executables must stay stable; not a sandbox against concurrent replacement by the same OS account. The draft requests owner timeout600s; output64KiB remains an owner setting. max_ms accepts1000..590000, default590000, after at most2s input framing. Compilation, reproduction, readback and all children share one absolute monotonic deadline. The pinned compiler library receives that same deadline; its separate CLI25s limit is not invoked or edited. Child launch time counts. Explicit short probes use min(global deadline, launch start + probe timeout).

Child CPU soft limit is ceil(4 * allowed wall seconds), minimum1, with hard limit2 CPU seconds later; both are capped by an inherited finite hard limit. CPU time includes threads, so it must not be equated to wall time. This is finite headroom, not a promise about arbitrary thread counts. Smaller inherited ceilings can terminate children and are recorded. Parent polling is at most100ms, process-group cleanup uses SIGKILL, and reaping waits at most500ms. SIGTERM/SIGINT request cleanup and an error report; SIGKILL cannot be handled. OS process creation and filesystem calls remain cooperatively bounded; owner timeout is the outer ceiling. Children retain512MiB V8 old-space and8192 bytes per output stream; old-space is not a total-RSS guarantee. Cumulative files remain bounded at256MiB. Dense graphs can exhaust bounds.

Child errors include error.process.stage (script basename), returncode_available, optional integer returncode, signal number/name, at most512 stderr characters, truncation flag, allowed/elapsed wall milliseconds, effective CPU limits and cleanup_reaped. returncode is omitted only when unavailable; signal=0 and signal_name='' mean no signal is known. Timeout/output-limit cancellation retains its own code even if cleanup produces SIGKILL. Empty stderr is explicitly represented. A signal alone does not prove why termination occurred. If the output cap cannot hold the complete report, compact child diagnostics retain a shortened ASCII stderr tail; other oversized reports use OUTPUT_LIMIT.

Timing repair uses owner-supplied draft-7316e59f44494e71bdaf141491d976f4. User-reported evidence: its full self_test built11 packages then failed with blank PROCESS_FAILED under25000ms. The user separately ran unchanged generated hardware-tests.mjs within a60s shell ceiling and reported62495 assertions,11 cases,53 self-switches passing. This is prior user evidence, not execution of this revision. Added timing/diagnostic regressions do not reduce existing assertions. New full-suite execution and browser interaction remain unverified during drafting.

self_test retains authored NROM/UxROM/MMC1 frame/controller/audio, NMI/IRQ/DMA, banking, exact write timing/RMW suppression, reset vectors, CHR/CIRAM caches, unsupported-case, provenance, confinement and budget assertions. Resolver regressions include actual bounded esbuild calls and ./ entries. Packaging regressions authenticate CSS, reject altered CSS/unsafe markup, resolve actual HTML/module/worker references under nested prefixes and audit CSP-incompatible constructs. These are synthetic hardware/static packaging assertions, not browser tests or real-game equivalence. complete_conversion=false and full_game_correctness=not_established always.

Fixture layout repair: source371eeaa8ec5a2c266a16a088adc02dae87e37a500dde0591440ef3c77941035a reportedly passed path/CSP bundling checks then failed startup-bank15 UOROM low-window self-switch. $8500 and fixed$C500 share physical offset$0500 in the last bank. The low routine moves to$8B00 (offset$0B00); fixed RMW remains$C500. All targets change consistently. Last-bank$BFFF is also IRQ-vector high byte at$FFFF. Boundary LDA needs$AD, so IRQ points to$AD80, a JMP$C180 trampoline in every selectable bank. Last-bank byte is written once in the IRQ vector and independently asserted as crossing opcode; other banks explicitly place$AD at offset$3FFF. IRQ behavior/handler body remain intact.

Every authored PRG/CHR region uses a physical allocator rejecting all overlapping writes, even equal-byte writes. Common code is explicitly re-emitted as named regions in banked fixtures instead of copying an untracked seed. NROM128 mirrors, UxROM low/high aliases, all MMC1 low/high bank pairs, vectors, DMA pages, CHR patterns/markers, routines, probe padding and unsupported-opcode sentinel are audited. Atomic collision checking precedes mutation. Negative tests reproduce the old overlap and vector-tail overwrite, check equal-byte collision, overrun and unchanged memory. Layout receipts include offsets, lengths and hashes. Execution checks inspect literal mapped bytes in every UxROM bank, run the low self-switch from every bank through compiled CPU functions, assert source/destination physical PCs and markers, retain last-bank startup and exercise boundary LDA with last bank selected. No runtime opcode validation, compiler or device behavior is relaxed.

LICENSE-JSNES.txt is Apache-2.0. NOTICE.txt retains upstream notice if installed. Vendor sources are unchanged, devices.mjs is their generated combination, and integration/UI/tests are separately authored. ROM/compiler-output distribution rights are not granted.

Sources:
- https://www.nesdev.org/wiki/MMC1
- https://www.nesdev.org/wiki/MMC1_pinout
- https://www.nesdev.org/wiki/PPU_rendering
- https://www.nesdev.org/wiki/PPU_scrolling
- https://www.nesdev.org/wiki/PPU_registers
- https://www.nesdev.org/wiki/CPU_interrupts
- https://www.nesdev.org/wiki/DMA
- https://www.nesdev.org/wiki/APU_Frame_Counter
- https://raw.githubusercontent.com/bfirsh/jsnes/v2.1.0/src/ppu/index.js
- https://esbuild.github.io/api/#metafile
- https://esbuild.github.io/plugins/#on-load-callbacks
- https://esbuild.github.io/plugins/#on-resolve-arguments
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/default-src
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src
- https://developer.mozilla.org/en-US/docs/Web/API/URL_API/Resolving_relative_references
- https://www.nesdev.org/wiki/UxROM
- https://www.nesdev.org/wiki/NROM
- https://www.nesdev.org/wiki/CPU_memory_map
- https://www.nesdev.org/wiki/Programming_UNROM
- https://www.nesdev.org/obelisk-6502-guide/reference.html
- https://docs.python.org/3/library/resource.html
- https://docs.python.org/3/library/subprocess.html
- https://man7.org/linux/man-pages/man2/getrlimit.2.html

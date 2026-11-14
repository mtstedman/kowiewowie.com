Cartridge library integration review bundle

This tool writes a new private directory only. It does not apply replacements, change Git state, edit the primary checkout, install dependencies, start services, commit, publish or deploy. The base is the clean dedicated worktree at c7088879c015fd62245e911f673eec1730f69d8a. Existing catalog registrations and every existing cartridge byte remain unchanged. Shared host, input, UI, audio, session, transport and policy behavior remain unchanged; only the server catalog digest constant is refreshed.

Input contract
Build accepts 1–8 games, including any subset, with explicit slug/title/publisher/year, canonical artifact directory, manifest path/SHA-256, compiler-manifest path/SHA-256, machine entry, ROM SHA-256, exact generic board policy and independently supported gameplay mode. Directories must have a closed manifest.files inventory of {bytes,sha256}; the outer manifest excludes itself. Original source.nes, compiled.mjs, runtime.mjs, generated translation modules and NOTICE.txt are required. CPU graph imports must be static local JavaScript. Unsupported formats, dynamic loaders, unlisted files, symlinks, hard links, malformed JSON, duplicate keys, changed inputs, inconsistent identities and unsupported hardware fail closed.

The separate hashed evidence file has exactly:
format: romjs-cartridge-evidence/1
fixture: false
reviewer: a nonempty reviewer identifier
artifact_manifest_sha256, compiler_manifest_sha256, rom_sha256: exact input identities
board: exact input board object
gameplay: {native_players, mode, independently_supported:true, ports:[1] or [1,2], port_test:null or {completed:true,independent_effects:true,rom_sha256,mode}}
engine: {kind:generated-specialized,interpreter_fallback:false,machine_sha256,runtime_sha256,mapping_identity,completed_validation:true}
sources: 1–16 {kind,file:{path,bytes,sha256}} entries. Required kinds: board-inspection, translation-validation and manual; two-player declarations also require native-port-observation. Evidence sources are read and hashed, never executed. A reviewer creates this receipt from real independently reviewed sources; the tool does not manufacture production attestations. Identity checks cannot establish whether a dishonest attestation is truthful.

Board has mapper 1, 2 or 4; exact compiler board and mapper_policy; region ntsc; battery boolean; prg_ram_bytes, chr_ram_bytes and battery_ram_bytes each 0 or 8192. Battery RAM is the whole supported PRG RAM. Mapper 5 and other geometries are rejected for their owners. No routing uses game titles, ROM identity lookup tables or a fixed pending-game list. ROM hashes are used solely for authentication and save identity.

Optional screenshot contains image and receipt file records. The receipt has exactly {format:romjs-gameplay-screenshot/1,rom_sha256,artifact_manifest_sha256,image:{bytes,sha256},authentic:true,capture_source}. The image must be a bounded CRC-valid PNG. Without evidence the image is null; no substitute artwork or generated gameplay is used.

Output contract
site/ is a private static arcade/test review tree, not a full deployable application. replacements/ contains every exact new/modified repository file. originals/ contains prior bytes of modified baseline files. sources/ retains original authenticated artifact files and independent evidence outside the web tree. integration.json classifies every create/modify, hashes both sides, retains all old package identities and lists accessor patches. review.patch covers existing text changes and small wrapper additions; large translated modules and binary files are represented by exact replacement files and hashes, not silently omitted from integration.json. manifest.json authenticates the complete artifact except itself. Its hash is returned on stdout. Interrupted directories are retained as incomplete; success requires final source and output rereads.

The package digest covers canonical game-package/1 metadata and actual engine/wrapper/shared dependencies. Catalogs, game-package.json and derived inventories are excluded from their own digest to avoid cycles. Browser and server network catalogs use this same digest, and NetplayPolicy.php changes only its catalog digest constant. Independently verified simultaneous P1/P2 is independent; alternating P1/P2 remains labeled take turns; solo uses shared hero. The existing session bridge continues to own role/seat/epoch assignment, spectator rejection and participant-local input release.

Battery implementation
Nonbattery requires battery_hooks=none. existing-battery-ram-v1 requires exportBattery():Uint8Array and importBattery(Uint8Array) on the authenticated machine. add-base-ram-v1 inserts only two bounded accessors into the inspected base.snapshot()/base.loadRAM() closure. It never edits runtime.mjs, compiled.mjs, translated banks, CPU execution, timings or mapper code. The exact insertion and original/derived hashes are reported. Existing hooks remain unchanged. Accessors expose the full 8192-byte cartridge battery RAM and preserve volatile CPU RAM through the existing loadRAM interface. The adapter checks an explicit romjs-battery/1 identity with version, ROM hash, mapping identity, mapper and exact RAM length before import.

A per-cartridge worker handshake restores the save before ready/first frame. The copied generic runtime accepts an injected worker class; its scheduling/input/audio body otherwise remains unchanged. Regular snapshots occur each 60 completed frames. The persistence wrapper pauses and flushes before graceful reset/disposal, bounds the flush at four seconds, then always disposes the base resources. Local storage denial, quota errors, malformed saves and identity mismatches do not become successful saves. Abrupt crashes/page termination can lose the final checkpoint interval. Saves are device/origin local, not synchronized between peers or accounts. Receivers use the existing stream-only adapter and create no persistence worker.

Validation
Nothing is executed during drafting. Build mode authenticates inputs and constructs output; it does not execute any production artifact or generated tests. Self-test requires games=[] and creates internally marked fixture artifacts below fixtures/inputs. Its bundle format is romjs-cartridge-library-fixtures/1, production_eligible=false. Fixture routes use fixture- prefixes, which build mode rejects. Self-test runs in-memory Python negative cases and the emitted Node tests using pinned generic host modules, controlled workers and a synthetic accessor machine. No ROM engine is imported by these tests. Synthetic fixtures are never evidence for production gameplay or multiplayer support.

The emitted tests verify exact preservation, package/catalog hashes, route normalization, actual generic host/session-bridge port assignment, stale/forged roles, spectator denial, participant-local releases, unload/reload, original frame-sampled controls, battery identity/length validation, storage failures, worker handshakes and accessor-only RAM effects. Existing catalog-specific baseline assertions retain their original cartridge scope; the new suite covers every supplied registration. Optional cartridge-library.browser.mjs uses preinstalled Playwright and Chromium with routed local assets and controlled workers to test same-document loading/unloading and save restoration. It does not establish real networking or gameplay.

Later commands from site/ (no dependency installation is provided):
node --test tests/cartridge-library.test.mjs
node --test tests/arcade-ui.test.mjs tests/combined-integration.test.mjs tests/combined-followup.test.mjs
node --test --test-concurrency=1 tests/cartridge-library.browser.mjs

Run PHP authority tests and normal repository CI only in a separately prepared full review checkout. Run the unchanged real combined browser/netplay lab against the integrated catalog, extending native cartridge observations as needed. Production gameplay, P1/P2 acceptance, audio, nominal FPS and real invite/watch/reconnect remain separately required. The old game-package-validate definition pins a different host; its successful structural publication is not runtime validation of this bundle.

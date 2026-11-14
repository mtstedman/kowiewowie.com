# Shared game host, package API 1

This visual revision presents the cartridge shelf immediately, reduces idle controls and copy, and keeps a compact loaded player. It retains the authenticated prior host, adapter, package validator, runtime, input, audio, provider and deployment contracts byte-for-byte. The supplied passing bundle is an immutable template dependency; its complete member inventory and original Git source inputs are authenticated before any transformation.

The private NES DOM controls now use the nes- ID prefix, including nes-pause and nes-reset. The derived runtime resolves those IDs only inside its own root; the adapter's touch/controller lookups use the same namespace. Shared-host pause and reset IDs remain unchanged and unique. Chromium checks document-wide uniqueness including hidden elements, identifies the visible toolbar controls without weakening strict locators, and checks that starting solo enables them while spectator binding disables both. This repair preserves the package and provider interfaces; regenerated inventory hashes and package artifact digests must be used by integrations.

## One document and one active package

The canonical document is /games/arcade/. Its selected package is the package query parameter. The old cartridge query alias is accepted. Each existing game index still serves the same shell; Catalog.route derives its selection and history.replaceState canonicalizes the URL in that initial document, preserving unrelated query parameters and the fragment. No redirect, iframe or second document is used. Package.route remains the immutable compatibility/asset route, so game-package/1 and its digest rules are unchanged.

Selecting a cartridge, using its per-cartridge Load game button, or changing its native radio selection with the keyboard loads it through the existing request path. Clicking the initially selected cartridge also loads it. Change cartridge calls the existing in-place unload path and focuses the library. The selected-game state, History API behavior, newest-selection cancellation and provider facade are unchanged. UI activation scrolls the current successful selection into view without document navigation. The original global load control remains an internal DOM element; the visible explicit controls belong to each cartridge.

The host invalidates its generation and begins old-resource teardown synchronously. It aborts waiting for an old import/load, consumes its eventual settlement, and awaits deterministic disposal before initializing another adapter. Each adapter receives private detached view/control mounts. Only the current generation attaches them to the page. Late asynchronous work can only alter its detached old mount through these context references. No stale completion publishes UI state, emits the ready event or rewrites history. Trusted adapters must honor cancellation and register cleanup before acquiring resources; this is not a sandbox against code that deliberately accesses global DOM or ignores resource ownership.

pagehide initiates adapter, worker, audio, input and provider cleanup. A persisted pageshow waits for that cleanup, creates a fresh host and restores the current route inside the same document. Cleanup failure blocks reinitialization. Browser process termination may deliver no event; remote lease policy remains the networking provider's responsibility.

## Package contract and registration

contracts.d.mts is the public typed contract. package.mjs strictly validates game-package/1. Each game-package.json is {manifest,artifactDigest}. The digest is SHA-256 of UTF-8 recursively key-sorted compact JSON, without a trailing newline; arrays retain order. The manifest records labels, routes, adapter entry, logical inputs, surfaces, capabilities, timing and URL-to-length/SHA-256 inventory records. A separately pinned catalog digest authenticates the envelope, which is then deeply frozen. The session provider cannot upgrade immutable player capabilities.

Register another compatible reviewed package with its adapter/resources, manifest and one catalog row; no host or player implementation edits are required. Modules export version=1 and synchronous createAdapter(context). load/start/pause/resume/reset/dispose, input/releaseAll, snapshot and surfaces are required. The adapter owns clocks, runtime, platform-specific mappings and actual resource disposal; the host owns mounting, selection, lifecycle ordering and local role/epoch gates. Async load is bounded and cancellable; async dispose is bounded and blocks the next adapter until settled. All cleanup callbacks are attempted even after a failure.

The entry bytes are checked before importing a digest-qualified same-origin URL. Full transitive inventories are authenticated by this builder/release workflow. Fetch-then-import is not an atomic cryptographic module loader. Serve one coherent revision and register only reviewed same-origin adapters. The synthetic non-NES fixture demonstrates contract reuse and resource accounting, not another console or authentic gameplay.

## NES, headings and compatibility

The exact original Mega Man 2 and Adventure Island II ROM identities and all runtime/compiler/bank assets remain inventory-authenticated. Both metadata records remain verified one-player, solo, shared-hero-capable packages. Future reviewed native two-player packages may declare simultaneous or alternating host-P1/guest-P2. The existing per-game app.mjs is authenticated by its Git blob and inspected SHA-256 before extracting host-runtime.mjs. The extraction removes global DOM/input/network mounting, wraps lifecycle state and adds disposal; emulation and media pacing are unchanged. Numeric button mappings and keyboard/gamepad/touch handling remain inside the NES adapter/runtime.

The per-game heading repair is preserved. Mega Man's original plain h1 is Translated NES game; Adventure Island's is Adventure Island II. Each complete source is checked against its distinct pinned byte count and SHA-256 after Git authentication. The HTMLParser structural check and unique exact anchors reject absent, duplicate, unexpected, nested, attributed and decoy headings. Each retained legacy.html has exactly its own title + ' · shared game' heading and one shelf link. Heading regression mutations run in memory against the production transform. HTMLParser is not a general HTML validator; complete source authentication supplies the stronger identity guarantee.

The retained legacy.html/app/guest derivations remain review artifacts. legacy-entry.mjs now displays a compatibility notice and keeps their old controls inactive; it does not launch the global legacy network UI. Canonical player controls never link to these artifacts. Existing public game directory/index links are the supported compatibility aliases into the shared host.

A legacy invite fragment or saved guest-session hint does not grant input permission and does not cause page departure. The NES hint puts the local package into a paused, input-disabled waiting state. A compatible provider can bind there, or the user can choose Play solo here, which reloads that adapter in place with a fresh generation and clears the invite fragment. Migrating old invitation credentials/room semantics into the new provider is separate networking work. No working legacy-session migration is claimed.

## Networking provider boundary

Use window.wowieGameHost and listen for wowiekowie-gamehost-ready. Obtain the current facade after each selection: bindSession is pinned to its host/generation and rejects stale facades, including when the same game is selected again. select(packageId) and unload() use the same in-place UI transition path as the shelf and library button. getPackage/getState, bindSession and dispose remain available. A library event signals completed in-place unloading.

Both invitation buttons call only host.invite and the bound provider's invitePlay/inviteWatch callbacks. Without a provider they are unavailable. There is no legacy navigation fallback, popup, iframe or implemented network transport. Providers must implement their invitation UI within the current document. Same-origin providers are trusted integration code; this host cannot sandbox a provider that itself navigates.

Provider identity is version 1, exact package ID and artifact digest. State includes role, phase, epoch, reconnect status, invitation availability and a bounded plain-text message. Epochs cannot decrease; role changes and completed reconnects require a fresh epoch. Invalid state releases inputs, pauses the engine and makes the binding incompatible. Provider methods are getState, subscribe/unsubscribe, inviteWatch/invitePlay({package,epoch,signal}), synchronous sendInput/releaseInputs, enableAudio, getMedia and dispose. The lease exposes remote guest input, release, adapter surfaces and disposal. Providers own authorization, signaling, transports, room policy, leases, server acknowledgments and reconnect decisions.

Spectator input is rejected at the host boundary and spectator lifecycle buttons cannot start/reset the local engine. Start only enables provider audio. Guest events go to the provider, not the local engine. Remote events require active host role, guest role claim, current epoch and the immutable capability's allowed seat. One-player shared hero accepts seat 1; native two-player packages may accept guest seat 2. All held edges release on pause, focus loss, session/epoch transition, switch, unload, errors and disposal. Watching supplies game video plus game audio, never webcam/microphone, and no control privileges. These are local boundary checks, not evidence of server authorization.

## Review bundle and checks

Later activation test input: {"site_root":"/home/mason/repos/wowiekowie.com","expected_base_sha":"e781fa69ff4a8b599d64d58f93d8565ef4beffb6","mode":"bundle","checks":"browser"}.

Linux, Python 3.11+, Git and Node 24+ are needed. Browser checks additionally require the existing lockfile's @playwright/test 1.63.0 installation and its matching Chromium already installed in the default Playwright cache. No secrets are needed. Missing dependencies or a missing browser fail the selected checks; the builder never installs or downloads them. Package manifests/lockfiles are unchanged.

Only dry-run and bundle modes are accepted. dry-run is memory-only with checks=none. bundle retains private replacements, originals, dependencies, changes.patch, integration.json and manifest.json under .posse/arcade-ui. The exact prior bundle and authoring evidence must remain available. Unaffected replacement bytes are copied only after their outer-manifest authentication; no source or evidence is imported as Python code. The prior create/modify classifications, source modes and deployment contract remain intact. Only the approved thumbnail and its receipt extend the replacement allowlist. The patch includes the thumbnail as a Git binary addition. Original source and external evidence bytes are rechecked after checks.

checks=isolated runs production Python heading regressions, Node syntax checks and the retained/extended Node suite: package/version/digest validation, capabilities, catalog-only non-NES reuse, route aliases, ordering, cancellation, late detached mount behavior, disposal failure, held input release, runtime worker/timer/animation/audio cleanup, provider identity, stale epochs, guest-seat routing and spectators. checks=browser runs these first, then the generated bounded Chromium suite, following the repository's existing node:test plus @playwright/test library convention.

The browser suite serves a fixed map of generated assets and authenticated small dependencies through Playwright routing at an intercepted loopback origin. It opens no HTTP server and allows no application network requests outside that map. It uses actual generated HTML/CSS/UI, package digest verification, host, NES adapters, extracted runtimes, DOM, History API and AudioContext objects. Only the emulator Worker boundary is controlled, preventing expensive ROM startup and making initialization deterministic. It asserts that the Document handle, performance.timeOrigin, navigation-entry count and document-request count remain unchanged through Mega Man -> Adventure Island -> library, Back transitions and invitations. It rejects popups/iframes/unexpected requests; checks old workers, audio, listener signals, mounts and session disposal; verifies zero spectator controls; exercises a deliberately delayed real ES-module import whose stale result cannot mount; and covers mobile-width cancellation and existing deep-link aliases. A synthetic pagehide/pageshow pair checks restoration logic without claiming an actual browser bfcache admission result.

These tests establish the described UI/lifecycle boundaries only. They do not establish gameplay fidelity, full emulator operation, real network permissions, streaming quality, audible audio, hardware controllers or browser performance. All tests are authored during drafting; only a later real run can produce a passing receipt.

The inspected deploy/deploy.sh and .github/workflows/ci.yml describe normal PHP lint, schema-definition validation, typecheck, regressions and deployment/health gates. They are recorded source dependencies, never invoked as a publication path by this builder. Existing CI does not automatically include this new browser test, and preinstalled browser availability has not been observed. A later reviewed integration must add appropriate CI execution and coordinate the separate performance/network changes against the exact base. A UI-compatible publisher or ordinary reviewed Git workflow must authenticate game-host-ui-integration/2 and its complete allowlist, including .d.mts and test fixtures, before any site publication. This builder always reports publish.ready=false.

Historical compiler reports remain historical. Mega Man retains its existing thumbnail. Adventure Island II uses the approved 5559-byte PNG, SHA-256 69230a2bd539cb7da09a2f70b1e4418575aa83495fda0f9f0e94a300c4976392, copied byte-for-byte with its original receipt. Package membership, catalog digest, per-game bundle-inputs, manifests, provenance and the integration inventory are refreshed from the resulting bytes. Only image metadata and its two new inventory members change the Adventure Island package; its host API and gameplay declarations are unchanged.

Public references:
- https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
- https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event
- https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close
- https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate
- https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
- https://docs.python.org/3.11/library/html.parser.html
- https://playwright.dev/docs/api/class-page
- https://playwright.dev/docs/api/class-request
- https://playwright.dev/docs/api/class-route
- https://playwright.dev/docs/api/class-browsertype
- https://playwright.dev/docs/locators#strictness
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/id

## Visual review evidence

Browser checks retain the existing same-document, alias, cancellation, lifecycle, spectator and provider regressions. Their cartridge helper now exercises direct activation; hidden idle toolbar expectations reflect the requested initial UI. Additional desktop 1365x1000 and mobile 390x844 checks cover the first viewport, both loading actions, selected radio and route, native keyboard activation, compact canvas/controls, useful Change cartridge action, and absent repetitive sharing copy. Existing document identity, navigation-request, popup, frame, teardown and strict ID checks remain.

Four viewport PNGs and two layout receipts are captured under review/ only inside a private builder bundle. The outer manifest is finalized after checks so these exact screenshot and receipt bytes are authenticated. Screenshots use a controlled emulator Worker: the loaded canvas is not authentic gameplay evidence. Shelf thumbnails are authentic captured assets. Human visual review remains necessary. No new execution result is asserted by this documentation. Missing evidence, preinstalled dependencies or browser failures stop the build; no installation, sandbox weakening or alternate publication route is attempted.

Keyboard repair: native Space does not dispatch a click for an already checked radio in the inspected Chromium implementation. The initial route already calls select for the first cartridge; selected being null is not established as the reported failure. Space and Enter now explicitly call radio.click once on nonrepeated keydown, with default handling suppressed on keydown and keyup. Click and change share one activation function. It suppresses duplicate requests for the same pending cartridge or an already loaded cartridge while allowing a different selection to cancel pending work. It does not require a preexisting selected match to initiate a load. The original request function remains responsible for selection, history, cancellation and host calls.

The original four browser test bodies and helpers retain the prior visual-draft transformations without further changes. Desktop/mobile Space checks and screenshots remain; added assertions count real host.load calls through a delegating test-only wrapper, as well as runtime creation. Fresh desktop/mobile sessions exercise initial Enter, held Enter/Space, unloading and reactivation. A delayed-import keyboard regression checks repeat suppression and native arrow switching while the first load is pending. These tests do not substitute pointer input for keyboard input or reduce existing assertions.

Presentation and keyboard references:
- https://playwright.dev/docs/screenshots
- https://playwright.dev/docs/api/class-page#page-screenshot
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/radio
- https://git-scm.com/docs/git-diff
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click
- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/html/forms/radio_input_type.cc
- https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- https://playwright.dev/docs/api/class-keyboard

Engine maintenance CLI (Node ES modules)

The exact executing assembler ships as maintenance/romjs-shared-engine-release-assembler.mjs in each fresh output site. It requires authenticated Acorn 8.17.0 dist/acorn.mjs supplied separately. No network or secrets are used.

Run: node maintenance/romjs-shared-engine-release-assembler.mjs < /external/release-input.json

Input JSON fields: root (current emitted modular site), output_directory (fresh disjoint directory), source_inventory (external JSON file), source_inventory_sha256, acorn_module, acorn_sha256, release (increasing stable same-major semver), edits ([{path,before_sha256,file,sha256}]). All SHA256 values must be independently trusted lowercase hex. An edit path is the CURRENT /games/engines/nes/<release>/common/<hash>.mjs or composer.mjs URL; file is the external edited source file. Never use the pre-extraction baseline.

Inventory format: {"format":"nes-release-source/1","files":{"relative/path":{"bytes":123,"sha256":"<trusted SHA256>"}}}. Cover every regular source file exactly, including maintenance scripts and history. Regenerate and authenticate this inventory before EACH release; do not reuse an earlier inventory. Supply a fresh output path for every run.

Stdout is one JSON receipt containing output_directory, release, receipt path, changed/added/preserved counts and executed_tests. Errors go to stderr with nonzero exit. A failed output write may leave a partial fresh directory. Inputs are never written; output is never deployed or activated.

The output refreshes current audit/runtime source pins and authenticates immutable successor history before the original shared-engine migration verifier runs. Historical receipts are retained; maintenance head and history wrapper are current pointers. No cryptographic signature is minted: trust comes from caller inventory SHA256 and embedded receipt hashes.

Later explicit regression: node tests/engine-release-<release>.mjs maintenance/romjs-shared-engine-release-assembler.mjs /external/release-input.json
Use a neutral comment INSIDE instantiate(imports) for the initial edit. This regression imports and steps real machines, checks history and pins, creates a temporary second neutral edit/inventory and successor release, and runs the regression on that second release. Temporary fixtures remain available for inspection. Drafting does not execute these checks. Browser/PHP/deployment tests remain separate gates.

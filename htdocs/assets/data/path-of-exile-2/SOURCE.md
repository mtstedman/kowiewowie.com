# Path of Exile 2 passive tree — data source and rule semantics

`tree.json` in this directory is an unmodified copy of Grinding Gear Games' official
Path of Exile 2 passive skill tree export. It is consumed by
`htdocs/assets/js/path-of-exile-2/tree-data.js`, which is the only place that interprets it.

## Pinned source

| Field | Value |
| --- | --- |
| Upstream repository | <https://github.com/grindinggear/poe2-skilltree-export> |
| Upstream file | `data.json` |
| Pinned commit | `bd87e6512c92b868542eddfb1ba4ea8b6dc2da36` (commit message / export version `0.5.5`, committed 2026-09-04) |
| Pinned URL | <https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36/data.json> |
| Installed as | `htdocs/assets/data/path-of-exile-2/tree.json` (served same-origin at `/assets/data/path-of-exile-2/tree.json`) |
| Size | 5,140,821 bytes |
| SHA-256 | `b52be9c4f17e4114064255ef1b8c58292e9db0e395d95af235a8d3fef0d44642` |

The SHA-256 above was computed over the installed file on 2026-10-01; its byte size equals the
size of the upstream file at the pinned commit. To re-verify against upstream:

```sh
sha256sum htdocs/assets/data/path-of-exile-2/tree.json
curl -fsSL https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36/data.json | sha256sum
```

Both commands must print the digest in the table.

**Version scope.** The export has no version field of its own (top-level keys: `tree`, `classes`,
`groups`, `nodes`, `edges`, `skillOverrides`, `jewelSlots`, `min_x`, `min_y`, `max_x`, `max_y`).
The version, URL and commit reported by `TreeData.version` / `TreeData.source` are the
`PINNED_SOURCE` constants in `tree-data.js`. The page must present this as "export 0.5.5", not as
the current live game: nothing here proves parity with whatever client build is live, and the
upstream "Releases" page is not a reliable freshness signal (it labels 0.5.2 "Latest").

## Attribution and notices

- Path of Exile 2, its passive tree data, names and stat text are © Grinding Gear Games. GGG's
  developer documentation (<https://www.pathofexile.com/developer/docs/data>) names this
  repository as its official passive-tree export.
- This site is **not affiliated with or endorsed by Grinding Gear Games**. GGG's third-party
  policy (<https://www.pathofexile.com/developer/docs>) asks public tools to say so visibly; the
  page that renders this data must carry that notice.
- The upstream repository ships no `LICENSE` file at the pinned commit. Publication by GGG
  establishes provenance, not a redistribution licence. The MIT licences of community tools
  (Path of Building, community viewers) cover their code only and do not license GGG data or art.
- No GGG artwork is installed here. `tree.json` contains icon paths and some
  `https://web.poecdn.com/...` image URLs inside `grantedSkill` blobs; the application must not
  load them (runtime assets stay same-origin, matching the site CSP).

## Refresh procedure

1. Pick a commit from the upstream history (never follow `main`), note its version from the
   commit message, and download `data.json` from the commit-pinned raw URL byte-for-byte.
2. Replace `tree.json`, then update the table above (commit, URL, version, size, SHA-256).
3. Update `PINNED_SOURCE` in `htdocs/assets/js/path-of-exile-2/tree-data.js` to the same
   version, URL and commit.
4. Re-check every item under "Verified from the pinned export" below against the new file,
   in particular: the class/ascendancy list, `id: null` placeholders, every `isFree` node,
   every `isMultipleChoice*` node, `unlockConstraint` shapes and `keystonesInRadius`.
   `normalizeTree()` throws on malformed IDs/coordinates and dangling references, and
   `buildAllocationModel()` throws if an `isFree` node falls outside the verified pattern, so a
   changed export fails loudly rather than being silently misread.
5. Run the PoE2 tests.

## What the export contains (inspected in the pinned file)

Line numbers refer to the installed, pretty-printed `tree.json`.

- `classes` (lines 3–625): 12 entries indexed 0–11 — Marauder, Witch, Ranger, Duelist, Shadow,
  Templar, Warrior, Sorceress, Huntress, Mercenary, Monk, Druid. Classes have no ID field;
  ascendancies have `id` (e.g. `Witch1`) and `name`. `overridePairs` is `[]` when empty and an
  object map `{"<original node id>": <skillOverrides id>}` otherwise.
- `nodes` (from line 20987): 5,152 passive nodes keyed by numeric skill hash, plus one synthetic
  `"root"` entry (no `skill`, no coordinates) whose `out` lists the six class-start nodes.
  Non-root nodes carry `skill` (equal to the key in every inspected node) and world
  coordinates `x`/`y`; `normalizeTree()` enforces both for the whole file.
- `edges`: `{from, to, orbit?, orbitX?, orbitY?}`; `from` is the string `"root"` for the first six.
- `skillOverrides` (from line 194734): replacement `name`/`icon`/`stats` records keyed by
  override ID.
- Six class-start nodes carry `classStartIndex` pairs, so classes share geometric starts:
  `47175` → [0 Marauder, 6 Warrior], `54447` → [1 Witch, 7 Sorceress], `50459` → [2 Ranger,
  8 Huntress], `50986` → [3 Duelist, 9 Mercenary], `44683` → [4 Shadow, 10 Monk],
  `61525` → [5 Templar, 11 Druid].

## Normalization (`normalizeTree`)

- `PassiveNode.id` is the upstream node key (the numeric skill hash used by GGG tree URLs), kept
  as a string. `x`/`y`, `name` and `stats` are copied unchanged. The upstream string `id`
  (e.g. `AscendancyDruid1Notable2`) and all other fields stay available in `TreeData.raw`.
- `TreeData.nodes` holds **all 5,152** keyed nodes. Only the synthetic `"root"` is left out,
  because it has no coordinates or skill hash; its six edges are likewise left out of
  `TreeData.edges`. Nothing else is dropped at this level.
- `kind` is derived from export flags: `classStart` (`classStartIndex`), `ascendancyStart`
  (`isAscendancyStart`), `mastery` (`isMastery`), `keystone`, `jewelSocket`, `notable`, `small`,
  and `placeholder` for nodes exported with `"id": null`.
- `domain` is `ascendancy` when the node has an `ascendancyId`, else `passive`.
- `ClassOption.id` is the class `name` (the export has no class ID). Ascendancy IDs are the
  export's own (`Witch1`, `Druid2`, …).
- Errors (all `Error` with a `PoE2 passive tree:` prefix): non-object export or sections;
  non-numeric node key or `skill` ≠ key; non-finite `x`/`y`; non-string name/stats;
  `in`/`out`, edge, `unlockConstraint`, `keystonesInRadius`, `multipleChoiceParent`,
  `classStartIndex` or `overridePairs` references that do not resolve; duplicate start nodes;
  a released class without a start node. `loadTree` adds descriptive errors for network
  failures, non-2xx responses and invalid JSON.

## Offered classes and ascendancies

Offered (8 classes, 23 ascendancies; "no ascendancy" is always supported by passing `null`):

| Class (start node) | Ascendancies |
| --- | --- |
| Witch (`54447`) | Infernalist `Witch1`, Blood Mage `Witch2`, Lich `Witch3`, Abyssal Lich `Witch3b` |
| Ranger (`50459`) | Deadeye `Ranger1`, Pathfinder `Ranger3` |
| Warrior (`47175`) | Titan `Warrior1`, Warbringer `Warrior2`, Smith of Kitava `Warrior3` |
| Sorceress (`54447`) | Stormweaver `Sorceress1`, Chronomancer `Sorceress2`, Disciple of Varashta `Sorceress3` |
| Huntress (`50459`) | Amazon `Huntress1`, Spirit Walker `Huntress2`, Ritualist `Huntress3` |
| Mercenary (`50986`) | Tactician `Mercenary1`, Witchhunter `Mercenary2`, Gemling Legionnaire `Mercenary3` |
| Monk (`44683`) | Martial Artist `Monk1`, Invoker `Monk2`, Acolyte of Chayula `Monk3` |
| Druid (`61525`) | Oracle `Druid1`, Shaman `Druid2` |

Excluded, with the evidence in the pinned file:

- **Marauder, Duelist, Shadow, Templar** — `"ascendancies": []` and no `overridePairs`
  (lines 4–13, 186–215). Their ascendancy clusters (`Marauder1..3`, `Duelist1..3`,
  `Shadow1..3`, `Templar1..3`) exist only as nodes with `"id": null`, empty `name` and empty
  `icon` (e.g. lines 26566–26750). Path of Building's converter skips classes with no
  ascendancies and nodes with a nil `id` for the same reason.
- **Ranger2, Druid3** — `"name": null`, `"image": null` (lines 159–166, 615–622); their nodes are
  `id: null` placeholders.
- A class is offered only if it has at least one offered ascendancy and a class-start node.

**Abyssal Lich (`Witch3b`) is offered as a variant of Lich.** It has a name, illustration and
flavour text (lines 99–129) and no graph nodes of its own; instead its 13 `overridePairs` map
graph nodes in the Lich (`Witch3`) cluster to `skillOverrides` records tagged
`"ascendancyId": "Witch3b"` (e.g. line 195403). The model therefore uses the Lich node tree
(same IDs, positions, connections, start node `23710`) with those replacements applied.
`normalizeTree()` checks that every one of the 13 targets is a `Witch3` node before offering
it; if that ever stops holding, Abyssal Lich is not offered. Corroboration: Path of
Building's converter declares `ascendancyReplacements = { Lich = "Abyssal Lich" }`. (One community
viewer hides it only because it filters ascendancies that own no nodes.) The general rule
implemented: a named ascendancy without nodes is offered when all of its override targets belong
to exactly one released sibling ascendancy.

## Allocation model (`buildAllocationModel`)

Scope: **ordinary shared allocations only.** Weapon-set allocations are not modelled.

### Model contents

- `nodes`: the passives that exist for the selected class/ascendancy — every main-tree passive,
  the selected class's start node, and (when an ascendancy is chosen) that ascendancy's nodes.
  Left out, deliberately: other classes' start nodes, other ascendancies' nodes, `placeholder`
  nodes, `mastery` nodes, and nodes whose `unlockConstraint` names a different ascendancy or
  references a node that is not in the model. All of them remain in `TreeData.nodes`.
- `edges`: official connections between model nodes (deduplicated).
- `rootIds`: `[classStart]` or `[classStart, ascendancyStart]`. Roots are implicit and free;
  they may appear in an allocation list and are ignored.
- Overrides: the selected class's and ascendancy's `overridePairs` replace `name`/`stats` on the
  **original** node (ascendancy override wins); ID, position and connections never change.
  Start nodes are exported under legacy labels (`WITCH`, `SIX`, `Necromancer`, `Gambler`, …);
  the model shows the selected class/ascendancy name instead. Ascendancy nodes in a model carry
  the selected ascendancy ID (so Abyssal Lich nodes report `Witch3b`).

### Verified from the pinned export

These rules are read directly from data in `tree.json`.

1. **Class starts.** The class root is the node whose `classStartIndex` contains the class
   index; two classes can share it and differ only by overrides and ascendancies.
2. **Class / ascendancy overrides.** `overridePairs` + `skillOverrides`, as above. Witch (23
   pairs), Huntress (18) and Druid (20) differ from the class that shares their start.
3. **`unlockConstraint` is conjunctive.** A constrained node needs every node in
   `unlockConstraint.nodes` allocated, and, when `unlockConstraint.ascendancy` is set, that
   ascendancy selected. In the pinned file 200 nodes carry `unlockConstraint` and 197 of those
   also name an ascendancy. Inspected examples: the Oracle-only "Paths Not Taken" nodes
   (e.g. `21218`, `60708`, `45226`) require `Druid1` plus "The Unseen Path" (`5571`);
   "Sacred Unity" (`28254`, Spirit Walker) requires `41401`, `62743` and `46070` with no
   ascendancy field. Every constraint is evaluated generically; the connectivity rule still
   applies on top.
4. **Multiple-choice membership.** Hubs carry `isMultipleChoice` (`60287`, `42416`, `57141`,
   `16433`, `52395`); options carry `isMultipleChoiceOption` and an explicit
   `multipleChoiceParent`.
5. **Cross-start access is encoded as edges.** Pathfinder's options "Path of the Warrior"
   (`57253`) and "Path of the Sorceress" (`12795`) — "Can Allocate Passive Skills from the
   …'s starting point" — are wired by export edges to main-tree nodes beside that start. The
   model keeps those edges for Pathfinder, so main-tree nodes can be allocated off the chosen
   option; for every other build the ascendancy nodes (and so the edges) are absent.
6. **Disconnected allocation.** Oracle's "Entwined Realities" (`32905`) reads "Non-Keystone
   Passive Skills in Medium Radius of allocated Keystone Passive Skills can be allocated without
   being connected to your tree". The export lists the affected nodes itself: 1,573 nodes
   carry a `keystonesInRadius` list of keystone IDs (33 nodes are flagged `isKeystone`).
   Spot check: node `63926` lists keystone `47759` ("Whispers of Doom"), 1,097 world units
   away. No radius constant is invented. Reading `keystonesInRadius` as this notable's radius
   relation is an inference from the field name, the stat text and that spot check.
7. **`isFree` wiring.** Exactly three nodes carry `isFree`: "Smith's Masterwork" (`9988`,
   Smith of Kitava), "Sanguimancy" (`8415`, Blood Mage) and "Sacred Unity" (`28254`, Spirit
   Walker). Each is an ascendancy notable whose `in` list contains its own ascendancy start
   (`5852`, `59822`, `63493`).

### Interpretations (not documented by GGG)

GGG publishes no allocation-rule documentation for this export. The following are
interpretations, with their basis; treat them as such when the export is refreshed.

- **Undirected connectivity.** `in`/`out` are treated as undirected. A node can be allocated
  when it touches a node already joined to a start. An ascendancy node must be supported by the
  ascendancy start or another ascendancy node; a main-tree node may be supported by the class
  start, a main-tree node, or an allocated ascendancy node wired to it (rule 5).
  Basis: community viewer `pathing.ts`, Path of Building `PassiveSpec.lua`.
- **Mastery nodes are image-only.** `isMastery` nodes sit inside the edge graph but are not
  allocatable passives in PoE2; they and their edges are excluded from the model so no route
  runs through them. Basis: Path of Building's converter maps `isMastery` to `isOnlyImage` and
  its path search skips them; the community viewer blocks them.
- **Other class starts and the synthetic root are not traversable.** Basis: same two tools.
- **`isFree` means "costs no point", nothing more.** A free node is charged 0 points, but it is
  still an ordinary node: it needs a connection and its `unlockConstraint`, and it is never a
  root. This is applied only to the wiring verified in rule 7; any other `isFree` node makes
  `buildAllocationModel` throw instead of guessing. Basis for zero cost: the export's flag
  name, and Path of Building, which maps it to `isFreeAllocate` and leaves such nodes out of
  its point count. Path of Building additionally treats them as connected to the start; that
  is unnecessary here because all three are adjacent to their start anyway. **Unverified:**
  whether the game client allocates these nodes automatically. The model neither forces nor
  forbids them.
- **Multiple choice.** At most one option per hub; an option requires its hub. The hub costs one
  ascendancy point and the option costs nothing, so hub + option = 1 point. A hub without an
  option is accepted as "choice pending" (no option is auto-picked). Basis: Path of Building's
  point count skips `isMultipleChoiceOption` nodes. A community viewer charges the option
  instead of the hub; totals are identical once an option is chosen.
- **Disconnected allocation is strict.** With "Entwined Realities" and a keystone both
  allocated, a listed non-keystone main-tree node needs no path (its `unlockConstraint` still
  applies). Such a node does not extend the tree: neighbours outside the radius still need a
  real path to a start. The stat text only exempts nodes inside the radius; whether the client
  lets you path outward from them is unverified, so the stricter reading is used.
- **Ascendancy point cost.** Every paid ascendancy node costs one ascendancy point and every
  paid main-tree node (including jewel sockets and attribute nodes) one passive point.

### `validateAllocation`, `canAllocate`, `pointCost`

- `validateAllocation` rejects IDs outside the model, more than one option per hub, and any set
  that cannot be allocated in some legal order from the roots; the `reason` names the first
  offending node. Because every rule other than option exclusivity is monotone, a greedy
  replay finds a legal order whenever one exists.
- `canAllocate` answers for one next node; it is `false` for roots, already-allocated nodes,
  unknown nodes and malformed input.
- `pointCost` counts each distinct paid ID once, in `passive` or `ascendancy`; roots, verified
  `isFree` nodes and multiple-choice options are zero. It throws on IDs outside the model.

### Not modelled

- Weapon-set specific allocations (separate per-set branches and their point accounting).
- Point **budgets**. `grantedPassivePoints` (e.g. Pathfinder nodes) changes how many points a
  character has, not what an allocation costs; `pointCost` reports cost only.
- Per-node stat choices that do not affect legality: the Strength/Dexterity/Intelligence choice
  on `isGenericAttribute` nodes (override IDs `26297`, `14927`, `57022`) and Pathfinder's
  "Traveller's Wisdom" alternatives. Attribute nodes show their generic stat text.
- Items and jewels. Jewel radius effects and item-granted passives are ignored. Sockets that
  only an item can allocate (the community viewer reports the "Voices" sinister sockets as
  graph-disconnected) stay in the model as nodes; with no connection they cannot be allocated
  through ordinary allocation.

## Upstream evidence consulted

- Official export (pinned): URL in the table above.
- GGG developer docs: <https://www.pathofexile.com/developer/docs/data>,
  <https://www.pathofexile.com/developer/docs>.
- Path of Building (PoE2) export converter, `dev` branch:
  <https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/Export/Scripts/passivetree_ggg.lua>
- Path of Building (PoE2) allocation logic, `dev` branch, read 2026-10-01 (unpinned):
  <https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/Classes/PassiveSpec.lua>
- Community viewer normalization and pathing (written against export 0.5.0):
  <https://raw.githubusercontent.com/cvenzin/poe2-skilltree/main/src/data/normalize.ts>,
  <https://raw.githubusercontent.com/cvenzin/poe2-skilltree/main/src/interaction/pathing.ts>

These tools are evidence for interpretation only; none of their code or data is included here.

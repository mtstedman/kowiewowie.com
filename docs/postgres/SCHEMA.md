<!-- schema-version: 22 -->

# PostgreSQL schema

The wowiekowie.com database schema is pinned by [`VERSION`](VERSION). The
current release pin is **version 22**. `migration-chain.json` is the ordered,
machine-readable history, and every executable SQL update lives in `updates/`.

The version pin describes the schema required by the same application release.
Production also records the successfully applied pin in the singleton
`database_schema_version` row. The deployment publishes this folder only after
the database transaction succeeds, so the deployed `VERSION` file and database
marker agree. The pre-existing `schema_migrations` table remains the immutable
per-file execution ledger.

## Version history

| Version | Update | Schema change |
| ---: | --- | --- |
| 1 | `001_initial_schema.sql` | Users, authentication, recipes, Magic decks and guides, games, and music |
| 2 | `002_add_magic_deck_card_scryfall_fields.sql` | Scryfall card ID and image fields |
| 3 | `002_videos.sql` | Videos and their public index/update trigger |
| 4 | `004_chess_games.sql` | Shared chess games, guest identities, links, positions, and move history |
| 5 | `005_chess_takeback_offers.sql` | Pending takeback-offer player and timestamp columns on chess games |
| 6 | `006_chess_opening_book.sql` | ECO opening labels and a transposition-aware graph of book positions and moves |
| 7 | `007_trivia_games.sql` | Shared-link trivia rooms, seated players, prompts, timed rounds, answer records, eliminations, and winner state |
| 8 | `008_trivia_question_bank.sql` | Persistent shared trivia question catalog used to seed default room prompts |
| 9 | `009_durable_game_rejoin_links.sql` | Hashed per-seat chess and trivia recovery tokens for durable rejoin after browser identity loss |
| 10 | `010_open_deck_scheduler.sql` | Open-deck time slots, set nominations, fill votes, and eviction votes |
| 11 | `011_trivia_murder_party.sql` | Killing-floor minigames, ghosts, multi-select prompts, and the final body race |
| 12 | `012_trivia_mini_games.sql` | Expanded Killing Floor trials with poison chalices, sword boxes, and crypt runes |
| 13 | `013_collectibles_catalog.sql` | Cached SKULLPANDA and Nommi collectible series products and their figure variants |
| 14 | `013_palworld_breeding.sql` | Indexed Palworld pals, breeding pairs, passive skills, and dataset provenance |
| 15 | `014_unified_collectibles.sql` | Sonny Angel catalog support, release-year sorting, and sourced price metadata |
| 16 | `015_poe2_saved_builds.sql` | Path of Exile 2 saved passive-tree builds owned by a registered user or guest browser identity |
| 17 | `016_poe2_passive_tree.sql` | Indexed Path of Exile 2 passive-tree exports: versions, classes, ascendancies, nodes, edges, unlock and radius lists, and overrides |
| 18 | `017_poe2_considered_nodes.sql` | Path of Exile 2 saved builds keep a list of considered passive node IDs |
| 19 | `018_risk_games.sql` | Online Risk games, seated human and bot players, and reusable hashed invite links |
| 20 | `019_collectible_identifiers.sql` | Retail SKUs and barcodes on collectible products and figures |
| 21 | `020_pop_bean_brand.sql` | POP BEAN joins the collectible brands |
| 22 | `021_collectible_collections.sql` | Owned collectible figures, saved for a registered user or a long-lived guest browser cookie |

The two historical filenames beginning with `002` are intentionally preserved:
their full basenames are already stored in production's migration ledger.

## Current version 22 inventory

- Authentication: `users`, `oauth_accounts`, `oauth_authorization_requests`,
  and `refresh_tokens`
- Content: `recipes`, `games`, `music_entries`, and `videos`
- Magic: `magic_decks`, `magic_deck_cards`, `magic_guides`, and
  `magic_guide_sections`
- Chess: `chess_guest_profiles`, `chess_games`, `chess_game_players`,
  `chess_game_links`, `chess_game_positions`, `chess_game_moves`,
  `chess_openings`, `chess_opening_positions`, `chess_opening_moves`, and the
  `chess_game_current_positions` view; `chess_games.pending_takeback_by_player_id`
  and `chess_games.pending_takeback_requested_at` persist pending takeback offers
- Trivia: `trivia_rooms`, `trivia_players`, `trivia_room_links`,
  `trivia_link_claims`, `trivia_question_catalog`, `trivia_prompts`,
  `trivia_rounds` (including key lock, memory match, poison chalices, sword
  boxes, and crypt runes Killing Floor trials), and `trivia_answers`
- Risk: `risk_games`, `risk_game_players`, and `risk_game_links`
- Open deck: `open_deck_slots`, `open_deck_set_nominations`,
  `open_deck_fill_votes`, and `open_deck_eviction_votes`
- Collectibles: `collectible_products` and `collectible_variants`; collections
  in `collectible_owned_figures` and `collectible_guest_collections`
- Palworld breeding: `palworld_dataset`, `palworld_pals`,
  `palworld_breeding_pairs`, and `palworld_passive_skills`
- Path of Exile 2: `poe2_saved_builds`, `poe2_tree_versions`,
  `poe2_tree_classes`, `poe2_tree_ascendancies`, `poe2_tree_nodes`,
  `poe2_tree_edges`, `poe2_tree_node_unlock_requirements`,
  `poe2_tree_node_keystones_in_radius`, `poe2_tree_skill_overrides`,
  `poe2_tree_class_override_pairs`, and `poe2_tree_ascendancy_override_pairs`
- Migration metadata: `schema_migrations` and `database_schema_version`

All application-owned timestamps are UTC `timestamptz` values. Primary content
and identity records use UUIDs generated by PostgreSQL's `pgcrypto` extension.
Public content is selected through partial indexes over published records.

## Chess game storage

The chess tables are separate from the pre-existing `games` content catalog.
They support anonymous cookie identities and registered `users`, two-player
games, revocable game invitations, a complete position timeline, and a move
ledger suitable for rebuilding a PGN-style history.

### Identity and links

`chess_guest_profiles` maps a SHA-256 hash of an opaque browser-cookie token to
a temporary display name. The raw token belongs only in a secure, HTTP-only,
same-site cookie and is never stored in PostgreSQL. Profiles have explicit
expiry and last-seen timestamps so stale guest identities can be cleaned up.

`chess_game_players` assigns at most one white and one black seat. A seat can
refer to either a registered user or a guest profile, and it always keeps a
display-name snapshot so historical games remain readable if the identity is
later removed. Each seated player can also carry one nullable recovery-token
hash plus created/last-used timestamps; the raw URL-safe recovery token is shown
only when minted or used and is never stored in PostgreSQL.

Every game has a random `public_id` for a stable URL. Treat that ID as a public
locator, not as authorization to make moves. `chess_game_links` stores only the
SHA-256 hash of a separate random invitation token. A link is either a
single-seat `play` invitation or a reusable `spectate` invitation and can be
expired or revoked. The application should generate at least 32 random token
bytes, put the URL-safe encoded raw token in the link, insert only its lowercase
hex SHA-256 digest, and reveal the raw token only when the link is created.

The cookie identity establishes who is using a link. Move authorization must
match that identity to the claimed `chess_game_players` seat; possession of the
public game ID alone is insufficient.

`chess_games` stores lifecycle state in `status`, `result`, `termination`, and
`finished_at`, current position state in `current_ply`, and paired nullable
takeback-offer state in `pending_takeback_by_player_id` and
`pending_takeback_requested_at`. The pending requester is constrained through
`(id, pending_takeback_by_player_id)` so the requester must be a
`chess_game_players` seat in the same game.

### Positions and history

`chess_game_positions` stores a full FEN snapshot at every half-move (`ply`),
including the initial position at ply 0. Its generated `side_to_move` column is
derived from the FEN, so the saved board and turn cannot disagree. FEN also
preserves castling rights, en-passant targets, and the half/full-move counters.

`chess_game_moves` is the ordered move ledger. It stores both UCI notation for
machine use and SAN for display/history export, the player who moved, and a
client-generated idempotency key. Each move references its before and after
position snapshots. The move trigger locks the game row, rejects stale or
out-of-order plies and the wrong player's turn, and advances the current
position atomically. The `chess_game_current_positions` view provides the
current FEN and turn without requiring callers to reproduce that join.

PostgreSQL checks ordering and turn ownership but does not act as a chess
engine. The application must validate legal moves, check/checkmate, draws,
Chess960 rules, and FEN board contents before writing them.

Creating a game must be one transaction: insert `chess_games`, insert its ply-0
position, add the creator's seat, and create any invitation links. The deferred
current-position foreign key guarantees that a committed game has its current
snapshot. To make a move, insert the resulting next-ply position and then the
matching move in the same transaction; the trigger advances the game. If the
move ends the game, update its status, result, termination, and `finished_at`
before committing. A failed transaction leaves neither a partial position nor
a partial history entry.

## Trivia game storage

The trivia tables are another live-game subsystem and are separate from the
static `games` content catalog. They support hosted 2-6 player rooms reached by
a shared join link, while mutations after seating are authorized through the
resolved registered user or `chess_guest_profiles` browser identity attached to
a `trivia_players` seat.

`trivia_rooms` stores a random public UUID for stable room URLs, lifecycle state
(`waiting`, `active`, `finished`, or `abandoned`), the 2-6 `max_players` cap,
the default answer-window duration, host and winner player references, current
round number, termination, and activity timestamps. The host and winner foreign
keys are scoped through `(room_id, player_id)` so they must point to seats in the
same room.

`trivia_players` stores seat numbers, host/player role, user and/or guest identity,
display-name snapshots, active/eliminated/left status, and the round that
eliminated a player. A user or guest profile can occupy only one seat per room,
so possession of a shared link cannot impersonate a different seated player.
Each seated player can also carry one nullable recovery-token hash plus
created/last-used timestamps; the raw URL-safe recovery token is shown only when
minted or used and is never stored in PostgreSQL.

`trivia_room_links` stores only SHA-256 hashes of raw URL-safe join tokens,
optional expiry/revocation timestamps, and the host seat that created each link.
`trivia_link_claims` records every successful link-to-seat claim. Join links are
shared and reusable until expiry, revocation, room start, or capacity, but they
only create or return a seat; host actions and answer submissions must match the
seat's registered user or guest profile.

`trivia_question_catalog` stores the shared, version-seeded prompt bank used
when a new room is created without caller-supplied prompts. Its rows have stable
slugs, display ordering, active flags, question text, correct answers, answer
choices, answer shapes, optional artwork, and explanations. The idempotent
160-question starter catalog lives in `database/data/trivia-questions.json` and
is imported by `php database/seed.php`.

`trivia_prompts` stores the ordered prompt text, correct answer, choice array,
single- or multi-select answer shape, optional artwork, and post-resolution
explanation for each room. Default catalog questions
are copied into these room-scoped rows at room creation, so gameplay still uses
the persisted room-local prompt snapshot. `trivia_rounds` binds one prompt to a
timed answer window with `opened_at`, `closes_at`, and resolved state.
`trivia_answers` records one answer per player per round, structured selections,
a per-room client idempotency UUID, correctness, score, and submission timestamp.
The application rejects duplicate or late answers. Wrong living players descend
to a Killing Floor trial—key lock, memory match, poison chalices, sword boxes,
or crypt runes; failed players become ghosts and remain eligible for later trivia.

Creating a room is one transaction: insert the room, seat the host, attach the
host to the room, persist caller-supplied prompts or copy active default prompts
from `trivia_question_catalog`, and create the initial hashed join link. A host
starts the game only after at least two seats are occupied, which opens round 1.
Resolving a round closes missing answers and pauses on a result reveal. The host
then advances to a Killing Floor when living players answered incorrectly, back
to trivia after the trial, or into the ghost race when only one living player
remains. In the finale, correct classifications move the last body and every
ghost along the escape track; a catching ghost steals the body, and the current
body holder wins by reaching the goal.

## Path of Exile 2 saved builds

`poe2_saved_builds` stores passive-tree routes saved from the Path of Exile 2
planner. Each build belongs to exactly one owner: either a registered `users`
row (`user_id`) or a `chess_guest_profiles` browser-cookie identity
(`guest_profile_id`); a check requires exactly one of the two to be set. Both
owner foreign keys use `ON DELETE CASCADE`, so a build is removed when its
owner is deleted. A build changes owner in one case: when a signed-in user
lists their builds while the browser still carries a guest cookie, the API
moves that guest's builds to the user, most recently updated first and up to
the 100-build limit; builds that do not fit stay with the guest.

Each row carries a 1-64 character `character_name` and a 1-80 character
`build_name` (both measured after trimming), the planner `class_id`, an
optional `ascendancy_id`, and the passive-tree `tree_version` it was built
against. `allocated_node_ids`, `must_have_node_ids` and `considered_node_ids`
store the allocated, must-have and considered passive node IDs as `jsonb`
arrays (all default to `[]`). Considered passives are ones kept for later and
play no part in routing.
`created_at` and `updated_at` default to `now()`, and the
`poe2_saved_builds_set_updated_at` trigger refreshes `updated_at` on every
update. The partial indexes
`poe2_saved_builds_user_idx` and `poe2_saved_builds_guest_idx` list an owner's
builds by most recent update.

## Path of Exile 2 passive tree

The `poe2_tree_*` tables hold the official passive-tree export the planner
loads from `GET /v1/poe2/tree`, instead of a static JSON file. Like the
Palworld tables they are an imported snapshot, keyed by integers from the
export rather than UUIDs. The migration creates schema only;
`database/seed-poe2-tree.php` imports the export pinned by
`database/data/poe2-passive-tree/source.json` (deployments run it after the
version minter). Field semantics are documented in
`database/data/poe2-passive-tree/SOURCE.md`.

`poe2_tree_versions` has one row per imported export `version` (1-32
characters, matching `poe2_saved_builds.tree_version`) with its
`source_url`, 40-hex `source_commit`, 64-hex `source_sha256`, the
`importer_revision` that wrote it, and `imported_at`. The partial unique
index `poe2_tree_versions_current_idx` allows at most one row with
`is_current`; the import sets it on the version it writes. Re-importing the
same digest with the same importer revision changes nothing. Every other table
carries `tree_version` as the leading key column and cascades from its version
row, so replacing or deleting a version removes all of its rows.

- `poe2_tree_classes`: one row per export class, keyed by `class_index`
  (export order), with a unique `name` and an optional `start_node_id`. Paired
  classes share a start node, so the class points at the node; that foreign
  key is deferred because classes are written before nodes.
- `poe2_tree_ascendancies`: keyed by `ascendancy_id`, with the owning
  `class_index`, the `position` within that class, and a nullable `name`
  (NULL marks an unreleased placeholder).
- `poe2_tree_nodes`: keyed by `node_id` (the skill hash). `export_id` is the
  upstream string ID and is NULL exactly when `kind` is `placeholder`; `kind`
  is one of `classStart`, `ascendancyStart`, `mastery`, `keystone`,
  `jewelSocket`, `notable`, `small`, or `placeholder`. Each row has `name`,
  `stats` (`text[]`), finite `x`/`y`, an optional `ascendancy_id`, `is_free`,
  `is_multiple_choice`, the `multiple_choice_parent_id` of an option (a node
  in the same version), and the `unlock_ascendancy_id` its unlock constraint
  requires (an ascendancy in the same version). An `ascendancyStart` node
  must name its ascendancy.
- `poe2_tree_edges`: keyed by `edge_index` (export position; the six root
  edges are not stored), connecting `from_node_id` to `to_node_id`, with an
  optional `orbit` and an `orbit_x`/`orbit_y` arc centre that is either
  complete or absent.
- `poe2_tree_node_unlock_requirements` and
  `poe2_tree_node_keystones_in_radius`: ordered lists keyed by
  `(node_id, position)`, each entry referencing another node of the version.
- `poe2_tree_skill_overrides`: replacement records keyed by `override_id`
  with optional `export_id`, `name`, `stats`, and `ascendancy_id`.
- `poe2_tree_class_override_pairs` and `poe2_tree_ascendancy_override_pairs`:
  `(owner, node_id) -> override_id`. `node_id` has no foreign key because the
  pinned export names two node IDs (on Druid) that are not in its node list.

### Indexes and the queries they serve

| Index | Columns | Query served |
| --- | --- | --- |
| `poe2_tree_versions_current_idx` (partial unique) | `poe2_tree_versions (is_current) WHERE is_current` | Find the current version for `/v1/poe2/tree` and its ETag; enforces a single current version |
| Primary keys | `(tree_version, class_index)`, `(tree_version, ascendancy_id)`, `(tree_version, node_id)`, `(tree_version, edge_index)`, `(tree_version, node_id, position)`, `(tree_version, override_id)`, `(tree_version, <owner>, node_id)` | Every per-version read that builds the API payload, in key order; node lookup by skill hash |
| `poe2_tree_ascendancies_tree_version_class_index_position_key` (unique) | `(tree_version, class_index, position)` | A class's ascendancies in export order; backs the class foreign key |
| `poe2_tree_edges_from_idx`, `poe2_tree_edges_to_idx` | `(tree_version, from_node_id)`, `(tree_version, to_node_id)` | A node's connections in either direction; back the edge foreign keys |
| `poe2_tree_node_unlock_requirements_required_idx` | `(tree_version, required_node_id)` | Nodes unlocked by a given node; backs the requirement foreign key |
| `poe2_tree_node_keystones_in_radius_keystone_idx` | `(tree_version, keystone_node_id)` | Nodes inside a given keystone's radius; backs the keystone foreign key |
| `poe2_tree_nodes_choice_parent_idx` (partial) | `(tree_version, multiple_choice_parent_id)` | A multiple-choice hub's options; backs the self-reference |
| `poe2_tree_nodes_unlock_ascendancy_idx` (partial) | `(tree_version, unlock_ascendancy_id)` | Nodes that require a given ascendancy; backs that foreign key |
| `poe2_tree_classes_start_node_idx` (partial) | `(tree_version, start_node_id)` | Classes that start at a given node; backs the deferred start-node foreign key |
| `poe2_tree_class_override_pairs_override_idx`, `poe2_tree_ascendancy_override_pairs_override_idx` | `(tree_version, override_id)` | Owners using a given override; back the override foreign keys |

Every foreign-key column leads an index, so replacing a version cascades
without sequential scans.

## Risk game storage

The Risk tables store online multiplayer Risk games, separate from the static
`games` content catalog. Players are identified by a registered user or a
`chess_guest_profiles` browser identity, and are invited through a shared,
hashed join link.

`risk_games` stores a random `public_id` for stable game URLs, lifecycle
`status` (`waiting`, `active`, `finished`, or `abandoned`), the 2-6
`seat_count`, the nullable serialized game `state` (`jsonb`), a non-negative
`state_version` counter for optimistic concurrency, the nullable 1-6
`winner_seat`, and `started_at`, `finished_at`, `created_at`, and `updated_at`
timestamps.

`risk_game_players` stores one row per seat: `game_id` (cascading on game
delete), a 1-6 `seat_number`, `kind` (`human` or `bot`), the nullable `user_id`
or `guest_profile_id` identity (each set to `NULL` when the identity is
deleted), a 1-40 character `display_name` snapshot, and `joined_at`. Seat
numbers, users, and guest profiles are each unique per game. The host is always
the `seat_number` 1 row; bot rows have kind `bot` and no user or guest identity.
Partial indexes on `user_id` and `guest_profile_id` support finding a player's
games.

`risk_game_links` stores only the lowercase hex SHA-256 `token_hash` of a raw
URL-safe invite token, plus optional `expires_at` and `revoked_at` timestamps
and `created_at`. One link is reusable by many players until the game leaves
`waiting`.

## Open-deck scheduler

The open-deck scheduler is a persisted voting subsystem for assigning set names
to public time slots. `open_deck_slots` stores the scheduled `start_at` and
`end_at`, lifecycle state (`open`, `filled`, or `closed`), the current filled
nomination when one has been resolved, and the deterministic eviction threshold.
Version 10 uses a conservative threshold of **3 eviction votes** against the
currently filled set before it is evicted.

`open_deck_set_nominations` stores one normalized set nomination per slot.
Nominations remain durable when they lose, fill a slot, or are later evicted;
the unique `(slot_id, lower(set_name))` index prevents duplicate set names in the
same slot. `open_deck_fill_votes` records one vote per voter identity hash and
nominated set, so a voter cannot vote twice for the same target. The application
resolves a filled slot by choosing the eligible nomination with the most fill
votes, breaking ties by earliest nomination creation time and then UUID.

`open_deck_eviction_votes` records one eviction vote per voter identity hash and
currently filled nomination. When a filled set reaches the threshold, the
application marks that nomination `evicted` without deleting its votes, then
fills the slot with the next eligible vote winner if one exists. If no eligible
winner has fill votes, the slot returns to `open` with all nomination and vote
history preserved. Closed slots reject nominations, fill votes, resolution, and
eviction votes until reopened through the scheduler API.

## Palworld breeding

The Palworld tables hold the breeding calculator's dataset server-side so pair,
child, and pal lookups are answered by indexes instead of scanning the full
breeding table in the browser. Like the collectibles catalog, they are a
replaceable imported snapshot rather than user-authored content and use integer
keys rather than UUIDs. The migration creates schema only; it inserts no pal or
breeding rows.

`palworld_dataset` is a singleton provenance row (`id` is a `smallint` primary
key constrained to `1`) recording the source `data_version`, the dataset
`revision` (a lowercase 64-character hex SHA-256), the imported `pal_count` and
`breeding_row_count`, and `imported_at` (defaults to `now()`).

`palworld_pals` stores one row per pal: `id` (identity primary key),
`pal_key`, `internal_name`, display `name`, optional `paldex_no`, `is_variant`
(default `false`), and `in_pal_database`. A check requires
`pal_key = lower(internal_name)`.

`palworld_breeding_pairs` stores one row per source breeding-table row, keyed
by its 1-based `source_row`. `parent1_pal_id`, `parent2_pal_id`, and
`child_pal_id` each reference `palworld_pals(id)` with `ON DELETE CASCADE`;
`parent1_gender` and `parent2_gender` are each `WILDCARD`, `MALE`, or
`FEMALE`.

`palworld_passive_skills` stores passive skills: `id` (identity primary key),
`name`, and `rank`.

### Indexes and the queries they serve

| Index | Columns | Query served |
| --- | --- | --- |
| `palworld_pals_pal_key_key` (unique) | `palworld_pals (pal_key)` | Resolve a pal by its key; also enforces one row per key on import |
| `palworld_pals_name_idx` | `palworld_pals (lower(name))` | Case-insensitive pal lookup by display name |
| `palworld_breeding_pairs_parents_idx` | `(parent1_pal_id, parent2_pal_id)` | Child of a pair given in stored parent order; all pairs with a given first parent; backs the `parent1_pal_id` foreign key |
| `palworld_breeding_pairs_parents_reverse_idx` | `(parent2_pal_id, parent1_pal_id)` | The same pair lookup with the parents in the opposite order; all pairs with a given second parent; backs the `parent2_pal_id` foreign key |
| `palworld_breeding_pairs_child_idx` | `(child_pal_id)` | Reverse lookup: every parent pair that breeds a given child; backs the `child_pal_id` foreign key |
| `palworld_passive_skills_rank_name_idx` | `palworld_passive_skills (rank, name)` | List passive skills by rank, ordered by name |

Because breeding is symmetric, a pair lookup queries
`parent1_pal_id = :a AND parent2_pal_id = :b` or
`parent1_pal_id = :b AND parent2_pal_id = :a`; each branch is served by one of
the two composite parent indexes. Every foreign-key column leads an index, so
pal deletes cascade without sequential scans.

Run `php database/seed-palworld.php` after minting the schema to load the
dataset.

## Collectibles catalog

The collectibles tables cache Pop Mart SKULLPANDA, Nommi, and the versioned
Sonny Angel catalog. They are a refreshable catalog snapshot, not
user-authored content, and use `bigint` identity keys rather than UUIDs.

`collectible_products` stores one series-level product per upstream listing:
`id` (identity primary key), `brand` (`skullpanda`, `nommi`, `sonny-angel`, or `pop-bean`), `source_key`
naming the upstream source, the source's `external_id`, `title`,
`product_url`, optional `image_url`, optional `price_cents`, optional
`currency`, optional price kind/source/date metadata, optional `release_year`,
optional retail `sku` (1-64 characters) and `barcode` (8-14 digits: UPC, EAN, or JAN),
and `first_seen_at`/`last_seen_at` timestamps (both default to
`now()`). `(source_key, external_id)` is unique so refreshes upsert the same
row and advance `last_seen_at`. The `brand` index supports per-line listing.

`collectible_variants` stores the individual figures in a product: `id`
(identity primary key), `product_id` referencing `collectible_products(id)`
with `ON DELETE CASCADE`, `name`, `is_secret` (default `false`) for secret or
chase figures, optional `image_url`, optional `price_cents`, optional
`currency`, optional price kind/source/date metadata, optional `sku` and
`barcode` (same rules as products), and display `position`
(default `0`). `(product_id, name)` is
unique.

`sku` and `barcode` record what a source publishes: TOYSEZ's Shopify feed
gives a SKU and sometimes a barcode per variant (a single-item listing carries
them on the product), and the Sonny Angel catalog gives the blind-box SKU and
JAN code on the series product. Pop Mart's storefront pages publish neither.
A refresh that omits an identifier keeps the stored one.

`price_cents` is a non-negative integer amount in currency minor units, paired
with an uppercase ISO 4217 `currency` code; for example, USD 19.99 is stored as
`1999` with `USD`. A variant whose `price_cents` is `NULL` inherits its
product's price.

## Collectible collections

A collection records which figures a visitor owns and how many.
`collectible_owned_figures` holds one row per owned figure: `user_id`
referencing `users(id)`, or `guest_collection_id` referencing
`collectible_guest_collections(id)` (exactly one is set; both cascade on
delete), the shelf's listing `product_id` (1-200 characters of
`A-Za-z0-9:._-`), the figure's `figure_name` (up to 300 characters), and a
`quantity` of 1 to 1,000,000; a figure that is no longer owned has no row.
`product_id` and `figure_name` are the keys the shelf uses rather than foreign
keys, so a catalog refresh that retires a listing never deletes what someone
owns. The partial unique indexes `collectible_owned_figures_user_key` and
`collectible_owned_figures_guest_key` keep one row per owner and figure and
serve each owner's collection read.

`collectible_guest_collections` is a browser without an account: the
SHA-256 `cookie_token_hash` of its random `wowie_collection` cookie (the token
itself is never stored) and `last_seen_at`. The cookie lasts 400 days, the
longest browsers keep one, and every collection request renews it; the row has
no expiry. A guest collection is created only when its browser first saves a
figure. When that browser next reads its collection while signed in, the guest
figures merge into the account (the larger quantity wins) and the guest row
is deleted.

Both tables refresh `updated_at` through `set_updated_at()` triggers.

## Chess opening book

The opening book separates human classification from book traversal. This is a
directed graph of positions, not a tree of move-sequence parents, because
different legal move orders can transpose into the same state.

`chess_openings` stores the human label: its ECO code and conventional full
name, such as `Caro-Kann Defense: Advance Variation, Tal Variation`. Its
optional `parent_opening_id` expresses only the name taxonomy (opening family,
variation, and subvariation); it never represents the preceding move. ECO/name
pairs are case-insensitively unique. A stored `tsvector` with a GIN index
supports word and prefix-query construction, while a lowercase B-tree pattern
index supports name autocomplete. The ECO field accepts the PGN forms `XDD`
and `XDD/DD`.

`chess_opening_positions` stores each standard-chess state once as EPD: the
first four FEN fields (piece placement, side to move, castling availability,
and legal en-passant availability), without halfmove or fullmove counters. The
unique EPD index is the exact transposition key. A position may point to the
opening label that becomes active there. Named positions also retain one
representative line in both PGN/SAN and space-separated UCI notation; that line
is for interchange and display and is not treated as the only route to the
position. Intermediate book positions have no opening label or representative
line.

`chess_opening_moves` stores directed edges between those positions. UCI is the
unambiguous lookup key and SAN is retained for display. The primary key
`(from_position_id, uci)` makes traversal deterministic, and the destination
index supports finding converging paths and inspecting transpositions. Import
code must use the chess engine to verify that each UCI move is legal in the
source EPD, that its SAN is correct, and that applying it produces the stored
destination EPD; SQL constraints validate notation shape but do not implement
chess rules.

To determine whether a game is on book, begin at the initial EPD node and replay
its moves through `chess_opening_moves`. Advance the active opening label
whenever the destination position has one. The first missing edge marks the
game off book permanently for that replay; later reaching a known EPD does not
put it back on book. Because transposing book lines converge on the same
position row, every loaded legal route activates the same opening label.

The versioned starter catalog lives in `database/data/chess-openings.tsv` and
uses the standard `eco`, `name`, and `pgn` columns from the CC0 Lichess opening
catalog. Run `php database/seed-chess-openings.php` after minting the schema.
The idempotent importer derives UCI and EPD through the application chess engine
and rejects illegal SAN, conflicting classifications, or inconsistent graph
edges before committing any rows.

## Minting the next version

1. Add new, forward-only SQL files beneath `updates/`. Every command must be
   valid inside a PostgreSQL transaction; do not use commands such as
   `CREATE INDEX CONCURRENTLY` that PostgreSQL forbids there.
2. Append one consecutive version to `migration-chain.json`, listing each SQL
   file and its lowercase SHA-256 digest.
3. Increase `VERSION` to that same version and update this document's leading
   `schema-version` marker, current version, inventory, and history.
4. Validate the complete chain with:

   ```bash
   php docs/postgres/db-version-minter.php --validate
   ```

On deployment, the minter locks schema changes, compares the database marker to
the release pin, and runs all missing updates in one transaction. It mints the
new `database_schema_version` only after every update reaches the ledger. Any
error rolls back both the update chain and the version bump, and deployment
stops before the new application or version document is published.

For an environment configured through `.env` or `WOWIE_ENV_FILE`, inspect or
apply the chain manually with:

```bash
php docs/postgres/db-version-minter.php --status
php docs/postgres/db-version-minter.php
```

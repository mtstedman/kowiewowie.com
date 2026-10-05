# wowiekowie.com

A dependency-free PHP site and PostgreSQL-backed JSON API for
wowiekowie.com.

## Architecture

The web and API entry points stay thin. Application behavior follows the
Posse domain layout requested for this project:

```text
api/                            API front controller and autoloader
includes/
  api/classes/                  API application/configuration
  auth/classes/                 JWT, refresh-token, and OAuth services
  collectibles/classes/         Collectible catalog, saved collections, and storefront sync
  content/classes/              PostgreSQL content repository
  content/functions/            Stateless validation and slug helpers
  database/classes/             PDO connection and schema version minter
  http/classes/                 Request/response contracts
database/
  migrate.php                   Compatibility entry point for the DB minter
  seed.php                      Idempotent JSON-to-PostgreSQL import
  seed-trivia.php               Focused trivia-catalog import used by deploys
  seed-chess-openings.php       Validated common-opening graph import
  seed-poe2-tree.php            Pinned PoE 2 passive-tree import used by deploys
  build-poe2-tree-art.mjs       Generates the PoE 2 planner's art manifest from the pinned sheets
  sync-collectibles.php         Offline authored catalogs and optional storefront sync
  data/chess-openings.tsv       Curated CC0 ECO/name/PGN starter catalog
  data/poe2-passive-tree/       Pinned GGG passive-tree export and provenance
  grant-role.php                User/editor/admin role management
docs/postgres/
  VERSION                       Schema version pin for this release
  migration-chain.json          Ordered, checksummed update chain
  updates/                      Complete PostgreSQL update history
  db-version-minter.php         Atomic schema update/version command
  SCHEMA.md                     Versioned schema documentation
tests/api-smoke.php             Database and API integration checks
tests/trivia-murder-game.php    Isolated full-game database playthrough
tests/poe2-tree-api.php         PoE 2 passive-tree import and API checks
tests/collectibles-collection.php  Saved-collection API checks (guest cookie, account merge)
```

PostgreSQL owns users, OAuth identities, rotating refresh tokens, recipes,
Magic decks/cards/guides, board games, and music entries. Existing unversioned
read endpoints remain available while new clients should use `/v1/...`.

The versioned schema also includes storage for shared chess games:
cookie-backed guest names, player seats, hashed invitation links, FEN position
snapshots, and ordered SAN/UCI move histories. Chess API routes are exposed
under `/v1/chess/...`:

```text
GET  /v1/chess/games
POST /v1/chess/games
POST /v1/chess/links/claim
POST /v1/chess/links/<token>/claim
GET  /v1/chess/games/<uuid>
GET  /v1/chess/games/<uuid>/moves
POST /v1/chess/games/<uuid>/moves
GET  /v1/chess/games/<uuid>/moves/promotions?from=<square>&to=<square>
POST /v1/chess/games/<uuid>/links
```

`GET .../moves/promotions` returns legal promotion choices for the requested
from/to squares. `POST .../moves` requires `uci` and may include `promotion`
(`q`, `r`, `b`, or `n`) when the UCI value does not already include its
promotion suffix.

Shared-link trivia rooms are a sibling live-game feature under `/v1/trivia/...`.
They reuse the same browser guest identity cookie model, store 2-6 seated
players, hash join-link tokens, and persist prompts and timed answer windows.
Wrong living players face a Killing Floor minigame, eliminated players continue
as ghosts, and the last survivor enters a final race for the body. Trivia API
routes are:

```text
GET  /v1/trivia/rooms
POST /v1/trivia/rooms
POST /v1/trivia/links/claim
POST /v1/trivia/links/<token>/claim
POST /v1/trivia/rejoin
GET  /v1/trivia/rooms/<uuid>
POST /v1/trivia/rooms/<uuid>/rejoin
POST /v1/trivia/rooms/<uuid>/links
POST /v1/trivia/rooms/<uuid>/start
POST /v1/trivia/rooms/<uuid>/rounds/advance
POST /v1/trivia/rooms/<uuid>/answers
POST /v1/trivia/rooms/<uuid>/replay
```

Room creation returns a raw join token once. Later room mutations require the
resolved browser identity to own the host or player seat; the shared link alone
is only a seating claim.

The collectibles shelf saves which figures a visitor owns. A signed-in
visitor's collection belongs to their account; anyone else's belongs to their
browser through the HttpOnly `wowie_collection` cookie, which is set with the
first saved figure, lasts 400 days (the longest browsers keep a cookie), and is
renewed by every collection request. The first collection read while signed in
merges that browser's guest collection into the account, keeping the larger
quantity of each figure. Collection routes are:

```text
GET  /v1/collectibles/collection
PUT  /v1/collectibles/collection/figures   {product_id, figure_name, quantity}
POST /v1/collectibles/collection/merge     {figures: [{product_id, figure_name, quantity}]}
```

A quantity of zero removes the figure. Writes must come from the site's own
origin or `WOWIE_CORS_ORIGINS`, as for PoE 2 builds.

## Database configuration

The API reads configuration in this order:

1. `WOWIE_ENV_FILE`
2. `/etc/wowiekowie.com/api.env`
3. `$XDG_CONFIG_HOME/wowiekowie/api.env` or `~/.config/wowiekowie/api.env`
4. the repository-local `.env`

Start from [.env.example](.env.example). Environment files contain secrets and
must not be committed. Generate independent database and JWT secrets; the JWT
secret must contain at least 32 random bytes.

Create the PostgreSQL login and database once:

```sql
CREATE ROLE wowiekowie_app LOGIN PASSWORD 'use-a-generated-password';
CREATE DATABASE wowiekowie OWNER wowiekowie_app;
```

Then apply the schema and import the current site content:

```bash
php docs/postgres/db-version-minter.php
php database/seed.php
php database/seed-chess-openings.php
php database/seed-poe2-tree.php
php docs/postgres/db-version-minter.php --status
```

The version minter and seed commands are idempotent. The legacy
`database/migrate.php` command remains as an alias. Content seeding upserts by
slug, including relational deck cards and guide sections. Use
`php database/seed-trivia.php` to refresh only the trivia catalog; normal
deployments run that focused seed automatically. Deployments also run
`php database/seed-poe2-tree.php`, which imports the pinned Path of Exile 2
passive-tree export into the `poe2_tree_*` tables before the planner that
loads it from `/v1/poe2/tree` is published; re-running it with the same export
changes nothing. See
[`docs/postgres/SCHEMA.md`](docs/postgres/SCHEMA.md) for the pinned version,
complete update chain, and procedure for adding a schema version.

The opening seed validates every curated PGN move through the same chess engine
used by live games, derives UCI and canonical EPD data, and merges transposing
move orders into shared book positions. Re-running it safely upserts the same
classifications, positions, and directed moves.

## Collectibles catalog sync

The searchable Skullpanda, Nommi, and Sonny Angel tree has a deterministic
local refresh that does not contact storefronts. Apply the schema, then import
all three authored catalogs:

```bash
php docs/postgres/db-version-minter.php
php database/sync-collectibles.php --catalog-only
php database/sync-collectibles.php --catalog-only --only=popmart-us
```

`--catalog-only` loads `htdocs/assets/data/sonny-angels.json` plus the
Skullpanda and Nommi catalog supplements. It can be combined with
`--only=<source_key>` for a single local source. The command prints one outcome
per selected source and exits non-zero for invalid catalog data or persistence
failure. It is safe to repeat: products and figures are merged without creating
duplicates. Partial supplements preserve saved retail prices, images,
observation metadata, and storefront variants that the authored roster does not
mention.

Deployments run this catalog-only command from the staged release after schema
readiness and deterministic seeds, but before publishing the release. A failed
local import therefore prevents publication without depending on storefront
availability. Run the same command manually whenever an authored catalog is
updated.

| `source_key` | Brand | Authored coverage and provenance |
| --- | --- | --- |
| `popmart-us` | Skullpanda | `htdocs/assets/data/skullpanda-catalog.json` contains six bounded series rosters transcribed from official Pop Mart US product pages. Each listed roster is marked complete, but the file is not a complete brand checklist; unresolved and other series remain outside it. |
| `toysez-nommi` | Nommi | `htdocs/assets/data/nommi-catalog.json` uses labeled TOYSEZ collection evidence for the complete Fantasy World and Interesting Fruits rosters, and TOYSEZ/KIKAGOODS evidence for additional title-only series. No official brand-wide checklist was available, so those remaining rosters and some release years stay unknown. |
| `sonny-angels-catalog` | Sonny Angel | `htdocs/assets/data/sonny-angels.json` is a non-exhaustive catalog sourced mainly from the official Sonny Angel archive and announcements, with limited secondary evidence for named secrets and Robby figures. It records 138 series and 739 figures, but does not claim every release or visually verified image/name pairing. |

Series status describes the evidence for that individual series, not the whole
brand: `complete` means the cited source supports the full listed roster,
`partial` means some named figures are known but the roster may be incomplete,
and `unknown` means the series is grouped without inventing figure names. Sonny
series with figures are exposed as partial and empty rosters as unknown. These
stable series identities drive the grouped UI for all three brands.

Running `php database/sync-collectibles.php` without `--catalog-only` retains
the normal storefront refresh. `--only=<source_key>` still restricts either
mode. Storefront refreshes keep the authored series grouping and rosters while
adding current retail observations; source failures remain isolated and do not
blank existing rows. Storefront requests use HTTPS, rate limiting, and bounded
timeouts, so they may take a few minutes and should be scheduled separately
from deployment.

## Local development

```bash
php -S 127.0.0.1:8080 -t htdocs htdocs/index.php
```

Open <http://127.0.0.1:8080>. The health endpoint is available at
<http://127.0.0.1:8080/health>.

Run the API locally from another terminal:

```bash
php -S 127.0.0.1:8081 -t api api/index.php
```

Run the integration checks against the configured PostgreSQL database:

```bash
php tests/api-smoke.php
php tests/trivia-murder-game.php
php tests/poe2-tree-api.php
node --test tests/poe2-tree.test.mjs
```

The smoke test covers database health, seeded content, registration, login
identity, JWT authentication, refresh-token rotation/reuse revocation, OAuth
configuration gating, and editor-only content writes. It removes its temporary
records when finished. The Murder Trivia playthrough creates an isolated schema,
applies the complete migration chain, exercises every game phase and replay, and
drops the schema when finished. The passive-tree check imports the pinned
export if needed, verifies repeat imports, rejected exports, current-version
switching and ETag revalidation, then confirms through the planner's own rule
model that the API payload builds the same allocation models as the export.

## API surface

Public reads:

```text
GET /health
GET /v1/recipes[/<slug>]
GET /v1/magic/decks[/<slug>]
GET /v1/magic/guides[/<slug>]
GET /v1/games[/<slug>]
GET /v1/music[/<slug>]
GET /v1/poe2/tree
```

`/v1/poe2/tree` returns the current imported passive tree as
`{data: {version, source: {url, commit, sha256}, tree}}`, where `tree` keeps
the export's field layout trimmed to what the planner reads. It sends a strong
`ETag` with `Cache-Control: no-cache`, so browsers revalidate and receive
`304 Not Modified` until a new export is imported.

Authentication:

```text
POST /v1/auth/register
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
GET  /v1/auth/me
GET  /v1/auth/oauth/<google|github>/start
GET  /v1/auth/oauth/<google|github>/callback
```

Register and login accept JSON containing `email`, `password`, and (for
registration) `display_name`. Access tokens are short-lived HS256 JWTs.
Refresh tokens are opaque, hashed in the database, rotated at every refresh,
and revoke their entire family when reuse is detected.

Content writes use `POST`, `PUT`, and `DELETE` on the versioned resource URLs
and require a Bearer token for a user with `editor` or `admin`. Promote an
existing account with:

```bash
php database/grant-role.php --email user@example.com --role editor
```

Public registration is controlled by `WOWIE_REGISTRATION_ENABLED`.

### Browser sessions (cookie mode)

The public site signs visitors in through the same `/v1/auth` routes, users
table, and rotating refresh-token families. A browser opts in per request by
sending `X-Wowie-Auth-Mode: cookie` with `credentials: 'same-origin'`:

- `POST /api/v1/auth/login` (`{email, password}`, 200) and
  `POST /api/v1/auth/register` (`{email, password, display_name}`, 201) return
  the usual token payload **without** `refresh_token`. The refresh token is
  instead set in the host-only `wowie_refresh` cookie with
  `Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax` and a lifetime of
  `refresh_expires_in`.
- `POST /api/v1/auth/refresh` (no body, 200) reads that cookie, rotates the
  token, and replaces the cookie. Missing, invalid, expired, revoked, or reused
  tokens and inactive accounts return the normal 401/403 error payloads and
  expire the cookie. Server errors leave the cookie untouched.
- `POST /api/v1/auth/logout` (no body, 204) revokes the cookie's refresh token
  and expires the cookie.
- The access token stays in page memory only and is sent as
  `Authorization: Bearer <access_token>` to `GET /api/v1/auth/me` and other
  protected routes. No credentials or tokens go in URLs or browser storage.

Clients without the header keep the existing JSON behavior: they send and
receive `refresh_token` in JSON, and the API never reads the browser cookie for
them.

Deployment prerequisites (all opt-in; nothing is enabled by default):

1. **HTTPS.** The cookie is `Secure`, so browsers only store and return it on
   `https://` pages. The site must call the API on the same origin under
   `/api/v1/auth/...` (for example `https://wowiekowie.com/api/v1/auth/login`),
   because the cookie is host-only and scoped to that path.
2. **Allowed origins.** Cookie-mode requests must send an `Origin` header that
   exactly matches an entry in an explicitly set `WOWIE_CORS_ORIGINS`, for
   example `WOWIE_CORS_ORIGINS=https://wowiekowie.com,https://www.wowiekowie.com`.
   Missing, `null`, or unlisted origins get `403 origin_not_allowed` before any
   token is issued, rotated, or revoked. While `WOWIE_CORS_ORIGINS` is unset,
   cookie mode rejects every request. The `X-Wowie-Auth-Mode` header is not in
   the CORS allow-list, so cross-origin pages cannot use cookie mode.
3. **Account availability.** Browser registration needs
   `WOWIE_REGISTRATION_ENABLED=true`. If registration stays disabled, register
   returns `403 registration_disabled` and visitors can only sign in to
   accounts that already exist: accounts made while registration was enabled,
   or accounts created through a configured Google/GitHub OAuth login. Public
   login and registration grant no additional roles. Grant `editor` or `admin`
   only on purpose with `php database/grant-role.php`.

Set these values in the API environment file (see
[Database configuration](#database-configuration)). Do not put secrets in
this repository.

### OAuth setup

Google and GitHub use authorization-code flow with PKCE and a one-time,
10-minute server-side state record. Add either provider's client ID and secret
to the environment file. Register these callbacks with the provider:

```text
https://api.wowiekowie.com/v1/auth/oauth/google/callback
https://api.wowiekowie.com/v1/auth/oauth/github/callback
```

OAuth logins require a provider-verified email address. Provider access tokens
are used only to fetch the identity and are not stored.

## Production

- Document root: `/var/www/wowiekowie.com/htdocs`
- API document root: `/var/www/wowiekowie.com/api`
- Shared PHP code: `/var/www/wowiekowie.com/includes`
- Migration code: `/var/www/wowiekowie.com/database`
- Versioned PostgreSQL schema: `/var/www/wowiekowie.com/docs/postgres`
- API environment: `/etc/wowiekowie.com/api.env` (`root:www-data`, mode `0640`)
- Web server: Nginx
- Runtime: PHP-FPM
- Nginx source configs: `deploy/nginx/*.conf`

TLS is issued and renewed with Certbot after the domain's DNS records point to
the production server.

## Production deployment

This checkout uses the versioned `.githooks/post-commit` hook. Every successful
local commit on `main` deploys the exact committed web/API/shared/database and
schema-documentation trees. Commits on work-item branches are never deployed.
Set `WOWIE_SKIP_AUTO_DEPLOY=1` when a main commit must be pushed before
deployment.

GitHub CI validates the schema pin, version marker, complete chain, and SQL
checksums, then lints the PHP and deployment shell before a release reaches the
deployment hook.

The deployment script lints PHP, validates the checksummed schema chain,
requires a clean `main` checkout matching `origin/main`, and compares the
database's minted version with `docs/postgres/VERSION`. A higher release pin is
applied in one transaction. Only after all updates and the database marker
commit does deployment publish the application and its new version document;
on failure neither version is bumped. It then performs the site/API health
checks. Run it manually after pushing with:

```bash
./deploy/deploy.sh
```

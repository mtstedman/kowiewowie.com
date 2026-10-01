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
  collectibles/classes/         Collectible catalog repository and storefront sync
  content/classes/              PostgreSQL content repository
  content/functions/            Stateless validation and slug helpers
  database/classes/             PDO connection and schema version minter
  http/classes/                 Request/response contracts
database/
  migrate.php                   Compatibility entry point for the DB minter
  seed.php                      Idempotent JSON-to-PostgreSQL import
  seed-trivia.php               Focused trivia-catalog import used by deploys
  seed-chess-openings.php       Validated common-opening graph import
  sync-collectibles.php         Skullpanda/Nommi storefront catalog sync
  data/chess-openings.tsv       Curated CC0 ECO/name/PGN starter catalog
  grant-role.php                User/editor/admin role management
docs/postgres/
  VERSION                       Schema version pin for this release
  migration-chain.json          Ordered, checksummed update chain
  updates/                      Complete PostgreSQL update history
  db-version-minter.php         Atomic schema update/version command
  SCHEMA.md                     Versioned schema documentation
tests/api-smoke.php             Database and API integration checks
tests/trivia-murder-game.php    Isolated full-game database playthrough
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
php docs/postgres/db-version-minter.php --status
```

The version minter and seed commands are idempotent. The legacy
`database/migrate.php` command remains as an alias. Content seeding upserts by
slug, including relational deck cards and guide sections. Use
`php database/seed-trivia.php` to refresh only the trivia catalog; normal
deployments run that focused seed automatically. See
[`docs/postgres/SCHEMA.md`](docs/postgres/SCHEMA.md) for the pinned version,
complete update chain, and procedure for adding a schema version.

The opening seed validates every curated PGN move through the same chess engine
used by live games, derives UCI and canonical EPD data, and merges transposing
move orders into shared book positions. Re-running it safely upserts the same
classifications, positions, and directed moves.

## Collectibles catalog sync

The unified Skullpanda, Nommi, and Sonny Angel catalog is filled by two
server-side storefront pulls plus the versioned Sonny data file. Apply the
schema first, then run the sync:

```bash
php docs/postgres/db-version-minter.php
php database/sync-collectibles.php
php database/sync-collectibles.php --only=popmart-us
```

`--only=<source_key>` limits the run to one source. The command prints one line
per source and exits non-zero when any selected source failed. Sources run
independently: a source that errors, stays rate limited after three
`Retry-After` retries, or returns no products is reported as failed and writes
nothing, so existing rows are never removed or blanked. Re-running is safe;
products are upserted by `(source_key, external_id)`.

| `source_key`   | Brand      | Source                                                                 | Currency |
| -------------- | ---------- | ---------------------------------------------------------------------- | -------- |
| `popmart-us`   | skullpanda | Official Pop Mart US store, `https://www.popmart.com/us/collection/skullpanda` | USD      |
| `toysez-nommi` | nommi      | TOYSEZ (third-party Shopify retailer), `https://toysez.com/collections/nommi`   | USD      |
| `sonny-angels-catalog` | sonny-angel | Versioned, sourced catalog in `htdocs/assets/data/sonny-angels.json` | Mixed |

- **Skullpanda** walks the collection pages (`?page=N`, at most 30) and then
  reads each product page for its main image and figure names. A `(Secret)`
  suffix marks a secret figure. Pop Mart prices the series or blind box, so
  figure variants carry no price. Only the public HTML pages are read; Pop
  Mart's signed backend API is not used.
- **Nommi** is a TOP TOY (MINISO) character and is not sold by Pop Mart, and no
  official machine-readable feed was found, so it comes from a retailer's
  Shopify feed: the first request uses `<collection>/products.json?limit=250`,
  then later requests add `&page=N` until an empty or short page (at most 20),
  keeping products whose title, vendor, or tags contain `nommi`.
- **Sonny Angel** imports the locally versioned catalog and locally hosted
  images into the same searchable database shelf. A figure's representative
  market price prefers sold evidence, then asking price, then retail; the kind,
  observation date, and source URL remain attached to that price.

Checked on 2026-10-01 for the Nommi source: a full production sync returned
166 products tagged `Nommi`, each with a `cdn.shopify.com` image and no named
variants (the products use Shopify's single `Default Title` variant), and
`https://toysez.com/meta.json` reports the store currency as `USD`. The store
rate limits the redundant `page=1` query shape, so the sync omits it for the
first request and stops immediately when that first page is short. A full
production Pop Mart sync returned 82 Skullpanda products and 58 named variants.

Prices are stored in minor units with the observed currency. Storefront prices
are retail listings, while Sonny prices retain whether they are retail, asking,
or sold evidence and link to the observation source. Sonny images are local;
the two storefront catalogs retain their remote HTTPS image URLs.

Requests use HTTPS only, wait at least one second between requests to the same
host, and time out after 20 seconds, so a full run takes a few minutes. A daily
run is enough, for example in `/etc/cron.d/wowiekowie-collectibles`:

```cron
17 4 * * * www-data cd /var/www/wowiekowie.com && php database/sync-collectibles.php >> /var/log/wowiekowie-collectibles.log 2>&1
```

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
```

The smoke test covers database health, seeded content, registration, login
identity, JWT authentication, refresh-token rotation/reuse revocation, OAuth
configuration gating, and editor-only content writes. It removes its temporary
records when finished. The Murder Trivia playthrough creates an isolated schema,
applies the complete migration chain, exercises every game phase and replay, and
drops the schema when finished.

## API surface

Public reads:

```text
GET /health
GET /v1/recipes[/<slug>]
GET /v1/magic/decks[/<slug>]
GET /v1/magic/guides[/<slug>]
GET /v1/games[/<slug>]
GET /v1/music[/<slug>]
```

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

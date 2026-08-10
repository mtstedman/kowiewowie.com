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
  content/classes/              PostgreSQL content repository
  content/functions/            Stateless validation and slug helpers
  database/classes/             PDO connection and migration runner
  http/classes/                 Request/response contracts
database/
  migrations/                   Ordered PostgreSQL schema migrations
  migrate.php                   Idempotent migration command
  seed.php                      Idempotent JSON-to-PostgreSQL import
  grant-role.php                User/editor/admin role management
tests/api-smoke.php             Database and API integration checks
```

PostgreSQL owns users, OAuth identities, rotating refresh tokens, recipes,
Magic decks/cards/guides, board games, and music entries. Existing unversioned
read endpoints remain available while new clients should use `/v1/...`.

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
php database/migrate.php
php database/seed.php
php database/migrate.php --status
```

Both migration and seed commands are idempotent. Content seeding upserts by
slug, including relational deck cards and guide sections.

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
```

The smoke test covers database health, seeded content, registration, login
identity, JWT authentication, refresh-token rotation/reuse revocation, OAuth
configuration gating, and editor-only content writes. It removes its temporary
records when finished.

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
- API environment: `/etc/wowiekowie.com/api.env` (`root:www-data`, mode `0640`)
- Web server: Nginx
- Runtime: PHP-FPM
- Nginx source configs: `deploy/nginx/*.conf`

TLS is issued and renewed with Certbot after the domain's DNS records point to
the production server.

## Production deployment

This checkout uses the versioned `.githooks/post-commit` hook. Every successful
local commit on `main` deploys the exact committed web/API/shared/database
trees. Commits on work-item branches are never deployed. Set
`WOWIE_SKIP_AUTO_DEPLOY=1` when a main commit must be pushed before deployment.

The deployment script lints PHP, requires a clean `main` checkout matching
`origin/main`, applies pending database migrations before switching API code,
and then performs both health checks. Run it manually after pushing with:

```bash
./deploy/deploy.sh
```

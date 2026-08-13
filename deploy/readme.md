# Production deployment

`deploy.sh` deploys the exact committed revision on `main`. As part of that
deployment, it brings PostgreSQL up to the schema version pinned by the same
revision **before** it publishes the application files.

## Database update behavior

The database update is version-driven; the script does not run every SQL file
that happens to be present in `docs/postgres/updates/`.

A schema release consists of all of the following committed files:

- `docs/postgres/VERSION`, containing the target positive integer version
- `docs/postgres/migration-chain.json`, containing every consecutive version
  through that target and the ordered, SHA-256-checksummed SQL updates for each
- `docs/postgres/SCHEMA.md`, whose leading `schema-version` marker matches the
  target version
- the SQL files referenced by the manifest under `docs/postgres/updates/`

During deployment, `deploy.sh` performs these steps:

1. It archives the committed revision into a temporary release directory.
2. It lints the release's PHP and validates the version pin, manifest, paths,
   and SQL checksums without accessing the database.
3. It runs the release's `db-version-minter.php` using
   `/etc/wowiekowie.com/api.env` for the database connection.
4. The minter takes a PostgreSQL advisory lock, reads the database's current
   version, and applies every missing version in manifest order in one
   transaction.
5. Each applied SQL file is recorded in `schema_migrations`. After every update
   succeeds, `database_schema_version` is advanced to the release pin and the
   transaction is committed.
6. Only after that commit does the deployment copy the application, migration,
   and schema-documentation files to `/var/www/wowiekowie.com`, followed by the
   HTTP health checks.

Re-running the same release is safe: updates already present in
`schema_migrations` are skipped, and an already-minted target version is left
at that version. Concurrent minters are serialized by the advisory lock.

If validation or a SQL update fails, the deployment exits before publishing
the new application files. SQL updates and the version-marker change are
rolled back together. PostgreSQL metadata tables may already have been created
by the minter, because their idempotent creation occurs before the update
transaction.

The process is forward-only. It refuses to deploy a release whose target is
older than the database, and it rejects a migration ledger that is inconsistent
with the committed chain. SQL updates must therefore be valid inside a
transaction; for example, do not use `CREATE INDEX CONCURRENTLY`.

Important boundaries:

- Merely adding a `.sql` file to `docs/postgres/updates/` does not schedule it.
  An unreferenced file is ignored; add it to a new manifest version and advance
  both version markers.
- Changing a referenced SQL file without updating its manifest checksum makes
  validation fail. Historical migrations should normally remain immutable.
- Once the database transaction commits, a later file-copy or health-check
  failure does not roll the database back. Migrations should remain compatible
  with the immediately preceding application release so that a deployment can
  be retried safely.

## Adding a schema version

1. Add one or more forward-only SQL files to `docs/postgres/updates/`.
2. Append the next consecutive version to
   `docs/postgres/migration-chain.json`, listing the SQL files in execution
   order with their lowercase SHA-256 digests.
3. Increase `docs/postgres/VERSION` and the leading `schema-version` marker in
   `docs/postgres/SCHEMA.md` to that same version, and update the schema history.
4. Validate the release before committing:

   ```bash
   php docs/postgres/db-version-minter.php --validate
   ```

The normal manual deployment, after pushing `main`, is:

```bash
./deploy/deploy.sh
```

The repository's `post-commit` hook also invokes the script on `main` with
`--allow-unpushed`. That flag skips only the `origin/main` equality check; the
branch and clean-worktree checks still apply.

To inspect a configured database separately from deployment, use:

```bash
php docs/postgres/db-version-minter.php --status
```

`--status` does not apply the migration chain, although it can idempotently
create the two migration metadata tables if they do not exist yet.

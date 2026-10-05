# CLOUD READINESS-3 — presence recovery under concurrency (real Postgres)

Deterministic regressions for the committed `20261005120000_world_presence_recovery.sql`, on a **local**
Supabase Postgres (never PGlite, never hosted). The runner creates and recreates its own database
`cr3_validation` inside the given container; the stack's `postgres` database is never touched.

```bash
node scripts/world-location/recovery-concurrency/run.mjs --container supabase_db_<local stack> --rounds 5 --out report.json
```

- **Code under test:** `git show HEAD:` of the migration (never the working copy), plus the two migrations it
  builds on. The only in-memory edits: a barrier `PERFORM public.cr3_hook('<name>')` at each `-- @hook <name>`
  comment line, and, for a mutant, one exact replacement (verified to match once).
- **Order:** advisory-lock barriers (one per hook and session tag), observed in `pg_stat_activity` before the
  concurrent action runs. Sleeps only poll observations; they never decide an order.
- **Privileges:** the database starts with Supabase's default privileges (`ALTER DEFAULT PRIVILEGES … TO anon,
  authenticated, service_role`); `recovery-grants-check.sql` must return 0 rows after the migration.
- **Exit codes:** `0` expected outcome for every build; `1` unexpected (the migration failed a check, or a mutant
  survived); `2` BLOCKED (no local container, setup failure, harness error or timeout). A BLOCKED run is never a
  pass and never a detection.

| Mutant | Protection removed | Must fail |
|---|---|---|
| `owner-share` | (adds) `FOR SHARE` on the OWNER host: claims would block the owner's renew/drain | I1 |
| `caller-no-share` | `FOR SHARE` on the CALLER host (I17) | C1 |
| `draining-takes` | waiting for a draining owner's final flush | S4 |
| `unreachable-takes` | no takeover of an unreachable owner without an explicit takeover | S2 |
| `takeover-ignored` | the explicit takeover («Jugar acá») | S2 |
| `draining-expired-stopped` | an expired drain counts as unreachable, not stopped | S4b |
| `no-yield` | the standby yields to a lower starting candidate | X1 |
| `excl-no-lock` | the table lock of the exclusive activation (TOCTOU) | X5 |

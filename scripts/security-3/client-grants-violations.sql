-- SECURITY-3: read-only check. Lists every client privilege that must not exist
-- after 20261001020637_security3_close_client_writes.sql. Zero rows = closed.
--
-- Safe to run anywhere: one SELECT over the catalog, no writes, no locks beyond
-- catalog reads. Objects that do not exist are simply absent from the result.
-- The PGlite tests in services/realtime/src/migrations/ run this exact file.

WITH
clients(role) AS (VALUES ('anon'), ('authenticated')),
dml(priv) AS (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')),
closed_tables AS (
  SELECT c.oid, c.relname, c.relacl, c.relowner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('pokemon_xp', 'pokedex_entries')
),
closed_functions AS (
  SELECT p.oid, p.oid::regprocedure::text AS sig, p.proacl, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'buy_market_listing', 'publish_market_listing', 'cancel_market_listing',
    'grant_pokemon_xp', 'spend_tokens_learn_move', 'register_pokemon',
    'record_pokemon_seen', 'bulk_record_pokemon_seen', 'collect_passive_tokens',
    'award_dungeon_reward', 'consume_dungeon_energy')
)
-- anon/authenticated, directly or through PUBLIC; INSERT/UPDATE also per column.
SELECT 'table' AS kind, t.relname::text AS object, r.role AS grantee, d.priv AS privilege
FROM closed_tables t CROSS JOIN clients r CROSS JOIN dml d
WHERE CASE WHEN d.priv IN ('INSERT', 'UPDATE')
           THEN has_any_column_privilege(r.role, t.oid, d.priv)
           ELSE has_table_privilege(r.role, t.oid, d.priv) END
UNION ALL
-- PUBLIC itself (grantee 0), table level.
SELECT 'table', t.relname::text, 'PUBLIC', a.privilege_type
FROM closed_tables t, aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
WHERE a.grantee = 0 AND a.privilege_type IN (SELECT priv FROM dml)
UNION ALL
-- PUBLIC itself, column level.
SELECT 'column', t.relname::text || '.' || att.attname, 'PUBLIC', a.privilege_type
FROM closed_tables t
JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL
CROSS JOIN LATERAL aclexplode(att.attacl) a
WHERE a.grantee = 0 AND a.privilege_type IN ('INSERT', 'UPDATE')
UNION ALL
SELECT 'function', f.sig, r.role, 'EXECUTE'
FROM closed_functions f CROSS JOIN clients r
WHERE has_function_privilege(r.role, f.oid, 'EXECUTE')
UNION ALL
SELECT 'function', f.sig, 'PUBLIC', 'EXECUTE'
FROM closed_functions f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
ORDER BY 1, 2, 3, 4;

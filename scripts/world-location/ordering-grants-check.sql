-- WORLD LOCATION-4: read-only check of the ordering objects' trust boundary.
-- Zero rows = closed. One SELECT over the catalog: no writes, safe anywhere.
-- Run it after applying 20261003120000_world_location_ordering.sql; the PGlite test
-- (worldLocationOrdering.database.test.js) runs this exact file.
--
-- Closed means: PUBLIC, anon and authenticated have NOTHING on the hosts table, its sequence
-- or the location/presence functions; service_role has exactly SELECT/INSERT/UPDATE on the
-- table, USAGE on the sequence and EXECUTE on the functions; RLS is on with no policy; every
-- function is SECURITY INVOKER with search_path=public.

WITH
clients(role) AS (VALUES ('anon'), ('authenticated')),
tbl AS (
  SELECT c.oid, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'world_presence_hosts' AND c.relkind = 'r'
),
seq AS (
  SELECT c.oid, c.relacl, c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'world_presence_generation_seq' AND c.relkind = 'S'
),
wanted(sig) AS (VALUES
  ('world_presence_acquire(uuid,integer)'), ('world_presence_activate(bigint,uuid,integer)'),
  ('world_presence_renew(bigint,uuid,integer)'), ('world_presence_drain(bigint,uuid,integer)'),
  ('world_presence_stop(bigint,uuid)'), ('world_location_claim_keyed(uuid,bigint,bigint,uuid,uuid)'),
  ('world_location_save_keyed(jsonb,bigint,uuid)'), ('world_location_claim(uuid,bigint)'),
  ('world_location_save(jsonb)')
),
fns AS (
  SELECT p.oid, regexp_replace(replace(p.oid::regprocedure::text, ' ', ''), '^public[.]', '') AS sig, p.prosecdef, p.proconfig, p.proacl, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND regexp_replace(replace(p.oid::regprocedure::text, ' ', ''), '^public[.]', '') IN (SELECT sig FROM wanted)
)
SELECT 'missing' AS kind, 'world_presence_hosts' AS object, NULL::text AS grantee, NULL::text AS detail
WHERE NOT EXISTS (SELECT 1 FROM tbl)
UNION ALL
SELECT 'missing', 'world_presence_generation_seq', NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM seq)
UNION ALL
SELECT 'missing', w.sig, NULL, NULL FROM wanted w WHERE NOT EXISTS (SELECT 1 FROM fns WHERE fns.sig = w.sig)
UNION ALL
SELECT 'rls_off', 'world_presence_hosts', NULL, NULL FROM tbl WHERE NOT relrowsecurity
UNION ALL
SELECT 'policy', 'world_presence_hosts', NULL, pol.polname::text FROM tbl JOIN pg_policy pol ON pol.polrelid = tbl.oid
UNION ALL
-- Table: no client privilege at all (column privileges count too).
SELECT 'table_privilege', 'world_presence_hosts', r.role, p.priv
FROM tbl CROSS JOIN clients r
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
WHERE CASE WHEN p.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           THEN has_any_column_privilege(r.role, tbl.oid, p.priv)
           ELSE has_table_privilege(r.role, tbl.oid, p.priv) END
UNION ALL
-- Table: service_role exactly SELECT, INSERT, UPDATE.
SELECT 'service_role_table', 'world_presence_hosts', 'service_role', p.priv
FROM tbl CROSS JOIN (VALUES ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', false), ('TRUNCATE', false), ('REFERENCES', false), ('TRIGGER', false)) p(priv, expected)
WHERE has_table_privilege('service_role', tbl.oid, p.priv) IS DISTINCT FROM p.expected
UNION ALL
-- Sequence: nothing for clients; service_role USAGE only (no SELECT, no UPDATE/setval).
SELECT 'sequence_privilege', 'world_presence_generation_seq', r.role, p.priv
FROM seq CROSS JOIN clients r CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
WHERE has_sequence_privilege(r.role, seq.oid, p.priv)
UNION ALL
SELECT 'service_role_sequence', 'world_presence_generation_seq', 'service_role', p.priv
FROM seq CROSS JOIN (VALUES ('USAGE', true), ('SELECT', false), ('UPDATE', false)) p(priv, expected)
WHERE has_sequence_privilege('service_role', seq.oid, p.priv) IS DISTINCT FROM p.expected
UNION ALL
-- PUBLIC (grantee 0) has no explicit or default entry on the sequence or the functions.
SELECT 'public_sequence', 'world_presence_generation_seq', 'PUBLIC', a.privilege_type
FROM seq, aclexplode(coalesce(seq.relacl, acldefault('s', seq.relowner))) a WHERE a.grantee = 0
UNION ALL
SELECT 'public_execute', fns.sig, 'PUBLIC', 'EXECUTE'
FROM fns, aclexplode(coalesce(fns.proacl, acldefault('f', fns.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
UNION ALL
SELECT 'execute', fns.sig, r.role, 'EXECUTE' FROM fns CROSS JOIN clients r
WHERE has_function_privilege(r.role, fns.oid, 'EXECUTE')
UNION ALL
SELECT 'service_role_execute', fns.sig, 'service_role', 'EXECUTE' FROM fns
WHERE NOT has_function_privilege('service_role', fns.oid, 'EXECUTE')
UNION ALL
SELECT 'security_definer', fns.sig, NULL, NULL FROM fns WHERE fns.prosecdef
UNION ALL
SELECT 'search_path', fns.sig, NULL, array_to_string(fns.proconfig, ',') FROM fns
WHERE fns.proconfig IS DISTINCT FROM ARRAY['search_path=public']
ORDER BY 1, 2, 3, 4;

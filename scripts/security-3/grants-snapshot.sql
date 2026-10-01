-- SECURITY-3: read-only snapshot of every ACL entry on the objects the migration
-- touches. Run it before and after applying
-- 20261001020637_security3_close_client_writes.sql and diff the two results:
-- only rows whose grantee is PUBLIC, anon or authenticated may disappear, and
-- no row may appear except a postgres/service_role privilege that was held
-- only through PUBLIC before.
--
-- One SELECT over the catalog; no writes.

WITH objs AS (
  SELECT 'table' AS kind, c.relname::text AS object, c.relacl AS acl, c.relowner AS owner, 'r'::"char" AS objtype
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('pokemon_xp', 'pokedex_entries')
  UNION ALL
  SELECT 'column', c.relname || '.' || a.attname, a.attacl, c.relowner, 'c'
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('pokemon_xp', 'pokedex_entries')
    AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  UNION ALL
  SELECT 'function', p.oid::regprocedure::text, p.proacl, p.proowner, 'f'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'buy_market_listing', 'publish_market_listing', 'cancel_market_listing',
    'grant_pokemon_xp', 'spend_tokens_learn_move', 'register_pokemon',
    'record_pokemon_seen', 'bulk_record_pokemon_seen', 'collect_passive_tokens',
    'award_dungeon_reward', 'consume_dungeon_energy')
)
SELECT o.kind, o.object,
       CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END AS grantee,
       x.privilege_type, x.is_grantable
FROM objs o
CROSS JOIN LATERAL aclexplode(coalesce(o.acl, CASE WHEN o.objtype = 'c' THEN NULL ELSE acldefault(o.objtype, o.owner) END)) x
ORDER BY 1, 2, 3, 4;

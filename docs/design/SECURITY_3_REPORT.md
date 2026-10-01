# SECURITY-3 HOTFIX — Retirar Free Claim y cerrar escrituras cliente

Rama `security/retire-free-claim-client-writes-0.3`, base `origin/integration/world-skills-0.3`
(`0274d30`).

> **Estado vigente (2026-10-01).** Producción aplicó y verificó la migración SECURITY-3. Hosted la
> registró como **`20261001032040 security3_close_client_writes`**; el archivo local se renombró de
> `20261001020637_…` a `supabase/migrations/20261001032040_security3_close_client_writes.sql` para coincidir
> (renombre puro: mismo blob, contenido idéntico byte por byte; el SQL aplicado no cambió).
> `client-grants-violations.sql` pasó de **19 filas a 0** en producción.
>
> Siguen otorgados a `anon`/`authenticated` sobre `pokemon_xp` y `pokedex_entries` los privilegios
> `MAINTAIN`, `REFERENCES` y `TRIGGER` (defaults de Supabase; la migración nunca los tocó, §6.2).
> No están expuestos por PostgREST, y los clientes no tienen conexión SQL directa, así que no son
> explotables hoy. Su limpieza es **deuda separada**: se resuelve en una migración nueva, **nunca
> modificando esta migración histórica**.

## 1. Contexto (FACT, verificado en producción por la estación principal)

- `free-claim` v19, JWT activo, **no versionada**; usa service role; llama
  `reset_daily_free_claim()` y después `claim_slot(..., p_is_free = true)`.
- Llamadas concurrentes pueden superar el límite diario; para especies sin fila en `slots`, dos
  reclamos concurrentes pueden reasignar ownership por el `ON CONFLICT DO UPDATE` de `claim_slot`.
- `pokemon_xp` y `pokedex_entries` permiten INSERT/UPDATE/DELETE del propio usuario.
- Las RPC inseguras históricas (005/008/009) no existen hoy en hosted.
- El mercado no se usa en Playtest 0.2.

## 2. `free-claim` retirado

`supabase/functions/free-claim/{handler.ts,index.ts}` (nuevos, versionados por primera vez).

| Petición | Respuesta |
|---|---|
| `OPTIONS` | `200 ok` + CORS, sin auth |
| sin `Authorization`, o no `Bearer <token>` | `401 {"error":"No autorizado"}`, sin consultar auth |
| token inválido/anon/forjado | `401 {"error":"No autorizado"}` (no revela el retiro) |
| auth no verificable (Auth caído) | `500 {"error":"Error interno"}` genérico; se loguea solo `err.name` |
| usuario válido, cualquier método/cuerpo | `410 {"code":"free_claim_retired","error":M,"message":M}` |

`M` = «El reclamo gratuito fue retirado. Próximamente podrás obtener Pokémon mediante huevos y captura.»
(`error` repite el mensaje porque los clientes viejos muestran ese campo, igual que `swap_retired`).

No lee el cuerpo, no crea cliente service-role (la verificación usa `SUPABASE_URL` +
`SUPABASE_ANON_KEY` y `auth.getUser`), no llama `reset_daily_free_claim` ni `claim_slot`, no
toca `slots`, `profiles`, tokens, contadores ni historial, no usa RNG. No hay reemplazo
(captura/huevos) en esta rama. **FACT:** `src/` y `legacy/` no invocan `free-claim`.

Tests (`handler.test.ts`, 14):
- contrato del handler (OPTIONS, sin auth, Bearer malformado, inválido, Auth caído sin filtrar
  el detalle, 410 estable, cuerpo nunca leído en 6 cuerpos × 5 métodos, 40 llamadas repetidas
  con exactamente 2 respuestas distintas —410 y 401— y cero red/env/archivos/RNG);
- reglas de fuente sobre `handler.ts` e `index.ts` (sin service role, `claim_slot`,
  `reset_daily_free_claim`, `.from/.rpc/insert/update/upsert/delete`, tablas, lectura del cuerpo;
  `index.ts` importa solo supabase-js y el handler, y lee solo `SUPABASE_URL`/`SUPABASE_ANON_KEY`);
- **el `index.ts` real** contra un Supabase Auth falso en `127.0.0.1`: OPTIONS, sin auth,
  inválido, válido ×3; el servidor recibe **solo** `GET /auth/v1/user` (ningún REST/RPC);
  Auth inalcanzable → cerrado (401/500) sin revelar el retiro;
- mutaciones: las reglas detectan service role, `claim_slot`, `reset_daily_free_claim`, upsert
  de `slots`, update de `profiles`, lectura del cuerpo, red y secretos; el contrato de
  comportamiento falla con un handler que responde 200, otorga un reclamo, salta auth, acepta
  sin token, lee el cuerpo, filtra el error de auth, varía entre llamadas o rompe OPTIONS.

## 3. Migración `20261001032040_security3_close_client_writes.sql` (antes `20261001020637_…`)

Versión única y posterior a todas (`20260930230308` era la última). Un solo bloque `DO`:

1. `pokemon_xp`, `pokedex_entries` (si existen): `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ... FROM
   PUBLIC, anon, authenticated`. SELECT no se toca. Revocar a nivel tabla revoca también los
   grants por columna del mismo privilegio.
2. Todas las sobrecargas reales (catálogo `pg_proc`, esquema `public`) de
   `buy_market_listing`, `publish_market_listing`, `cancel_market_listing` y de las latentes
   `grant_pokemon_xp`, `spend_tokens_learn_move`, `register_pokemon`, `record_pokemon_seen`,
   `bulk_record_pokemon_seen`, `collect_passive_tokens`, y de las de Dungeon `award_dungeon_reward`
   y `consume_dungeon_energy` (010/011, ver §3.1): `REVOKE EXECUTE ... FROM PUBLIC, anon,
   authenticated`. Si no existen, no hace nada; nunca las crea.
3. `postgres` y `service_role` conservan exactamente lo que tenían: se mide antes; si uno solo lo
   tenía vía `PUBLIC`, se le concede directo (único `GRANT` posible).

No crea/altera/borra tablas, columnas, filas, cuerpos de función, políticas ni comentarios.
No edita 005/008/009. Idempotente. Sin `CASCADE`: si algún cliente hubiera re-otorgado con
`GRANT OPTION`, la migración falla y se revierte entera (cerrado y visible).

### Permisos esperados antes → después (hosted)

| Objeto | Rol | Antes (esperado) | Después |
|---|---|---|---|
| `pokemon_xp`, `pokedex_entries` | `anon`, `authenticated` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE (+REFERENCES, TRIGGER, MAINTAIN por defaults de Supabase) — RLS limita a filas propias | SELECT (+REFERENCES, TRIGGER, MAINTAIN, sin cambio) |
| idem | `service_role`, `postgres` | todo | igual |
| `buy/publish/cancel_market_listing` | `PUBLIC`, `anon` | ya revocado (`20260926001502`) | revocado |
| idem | `authenticated` | EXECUTE | **sin EXECUTE** |
| idem | `service_role`, `postgres` | EXECUTE | EXECUTE |
| 6 RPC latentes | — | no existen | no existen (no se crean) |
| 6 RPC latentes en instalación nueva | `authenticated` | EXECUTE (005/008/009) + defaults de Supabase | sin EXECUTE; `service_role`/`postgres` igual |
| `award_dungeon_reward`, `consume_dungeon_energy` | — | no existen en producción | no existen (no se crean) |
| idem, en instalación nueva | `PUBLIC`, `anon`, `authenticated` | EXECUTE (010/011) + defaults de Supabase | sin EXECUTE; `service_role`/`postgres` igual |

Conteo de `client-grants-violations.sql` antes de la migración: **19** en la base tipo producción
(sin RPC de Dungeon; sin cambios por esta adición) y **38** en una instalación nueva sin SECURITY-3
(3 de mercado + 8 latentes/Dungeon × 3 roles + 11 de tablas; 6 de esas 38 son las dos de Dungeon).
Después: **0** en ambos casos.

### 3.1 RPC de Dungeon cerradas preventivamente

- **FACT:** `award_dungeon_reward` y `consume_dungeon_energy` **no existen en producción**, y las Edge
  Functions `dungeon-reward` y `dungeon-start` **tampoco están desplegadas**.
- Una instalación nueva las crea (010/011) y las concede a `authenticated`. `award_dungeon_reward`
  recibe montos de XP y tokens del cliente (acotados a 10 000 XP / 3 000 tokens por día, pero
  elegidos por el cliente); `consume_dungeon_energy` escribe `slots.energy`.
- SECURITY-3 las cierra a `PUBLIC`, `anon` y `authenticated` con el mismo mecanismo de catálogo
  (todas las firmas reales, ausentes → sin error, keepers preservados). No se editan 010/011 ni sus
  cuerpos; no se tocan energía, tokens ni XP.
- **Dungeon deberá reintroducir autoridad server-side en una fase futura** (resultado de la mazmorra
  calculado o validado en el servidor). **Estas funciones nunca deben concederse directamente a
  `authenticated`**; el guard estático y el de instalación nueva fallan si alguna migración lo hace.

**INFERENCE:** el ACL exacto de las dos tablas en hosted no está versionado; la fila «Antes»
sale de los defaults de Supabase y de la verificación de producción (escritura propia permitida).
Por eso el plan de §7 toma una foto antes y otra después.

### Herramientas de verificación (solo lectura)

- `scripts/security-3/client-grants-violations.sql` — un `SELECT` sobre el catálogo; lista cada
  privilegio cliente prohibido (tabla, columna, función; directo o vía `PUBLIC`). **0 filas = cerrado.**
- `scripts/security-3/grants-snapshot.sql` — todas las entradas de ACL de los objetos tocados,
  para comparar antes/después.

Los dos archivos se ejecutan tal cual en los tests de PGlite.

## 4. Tests de la migración y guard

`services/realtime/src/migrations/security3ClientGrants.test.js` (19, PGlite = Postgres 17):

- Base *hosted-like*: el mirror RC-0.3 del catálogo de producción (`scripts/integration/rc03-staging`),
  las migraciones que producción corrió después, y `pokemon_xp`/`pokedex_entries` con RLS de filas
  propias y defaults de Supabase. Se prueba el «antes» (el usuario escribe XP 999999, inserta y borra
  Pokédex, ejecuta el mercado).
- Después: INSERT/UPDATE/DELETE/TRUNCATE de `anon` y `authenticated` → `permission denied` en ambas
  tablas (incluido `moves`); grants por columna también revocados; SELECT idéntico para los cuatro
  roles y lecturas propias funcionando; `service_role`/`postgres` idénticos, también cuando solo
  tenían el privilegio vía `PUBLIC` (tabla y función).
- Mercado: las 3 firmas reales + una sobrecarga extra abierta a `PUBLIC` quedan sin EXECUTE
  cliente; las llamadas fallan antes de ejecutarse.
- Latentes presentes (005/008/009 aplicadas + sobrecarga extra concedida a `anon`): las 7 firmas
  revocadas, keepers iguales, llamadas rechazadas. Latentes ausentes: pasa y no crea nada. Base sin
  tablas ni funciones: pasa sin cambiar ningún ACL.
- Doble ejecución: ACL, definiciones y datos idénticos. Definiciones (cuerpo, `SECURITY DEFINER`,
  `search_path`, owner, comentario), políticas, columnas y filas de XP, Pokédex, `slots`, perfiles,
  publicaciones, ledger y transacciones: sin cambios. Fuera de los objetos cerrados ningún ACL cambia;
  en ellos solo desaparecen entradas de clientes.
- Estática: los únicos templates son los `REVOKE` y el re-`GRANT` a keepers; sin DROP/ALTER/CREATE/
  DELETE/UPDATE/INSERT/TRUNCATE/COMMENT como sentencia.

**Guard (sin tocar migraciones históricas):**
- dinámico: línea base mínima + **todos** los archivos de `supabase/migrations` en orden → la
  consulta de violaciones debe dar 0 filas y `service_role` conservar EXECUTE. Probado que detecta
  6 re-grants distintos (función a `authenticated`/`PUBLIC`, UPDATE de tabla, INSERT por columna,
  TRUNCATE a `PUBLIC`, `GRANT ALL ON ALL FUNCTIONS IN SCHEMA`). Si una migración futura no aplica
  sobre la línea base, el test falla con el nombre del archivo;
- estático: fuera de la lista congelada de 9 migraciones históricas (001, 002, 003, 005, 008, 009,
  010, 011, `20260926001502`), ningún archivo —cualquiera sea su versión, también uno viejo agregado fuera de
  orden— puede `GRANT` estos objetos a clientes, abrir el esquema a clientes (`ON ALL ... IN SCHEMA`,
  `ALTER DEFAULT PRIVILEGES`) ni `CREATE/DROP` estas funciones o tablas (recrearlas les devuelve los
  defaults de Supabase). Además SECURITY-3 debe ser el último archivo que las menciona;
- mutación por función: quitar de la lista de la migración cualquiera de las 11 funciones (incluidas
  las dos de Dungeon) deja esa función abierta a `authenticated` en una instalación nueva y el test
  falla.

Casos de Dungeon (con 010/011 aplicadas sobre la base tipo producción): antes, `authenticated` se
otorga 3 000 tokens y gasta energía; después, `anon`, `authenticated` y un rol que solo tiene lo de
`PUBLIC` reciben `permission denied` (también en una sobrecarga extra abierta solo a `PUBLIC`);
`postgres` y `service_role` conservan EXECUTE; cuerpos, energía (`slots.energy`), tokens, ledger y XP
idénticos; sin las funciones la migración pasa (dos veces) sin crearlas; doble aplicación idéntica.

Mutaciones de la migración (cada una detectada): sin `TRUNCATE` (6 tests fallan), sin `PUBLIC` en
funciones (4), olvidar `collect_passive_tokens` (2), olvidar `buy_market_listing` (5), sin
restaurar keepers en funciones (2) o tablas (2).

## 5. Datos

No se borra ni modifica ninguna fila de XP, Pokédex, `slots`, free claims, mercado, publicaciones,
tokens ni ledger, ni ninguna función SQL existente. Los cuatro slots legacy bloqueados siguen igual.

## 6. Auditoría complementaria (documentada, NO resuelta en esta rama)

1. **`profiles` expone columnas privadas a `anon`.** Hay una política `SELECT USING (true)` y
   SELECT de tabla para `anon`/`authenticated` (mirror RC-0.3): tokens, `total_spent`,
   `free_claims_remaining`, IDs/fechas de Twitch y YouTube, multiplicador, contadores de
   mazmorra. Requiere una vista pública o grants por columna.
2. **Grants excesivos.** Por los defaults de Supabase, los clientes conservan `REFERENCES`,
   `TRIGGER` y `MAINTAIN` en varias tablas (incluidas las dos de esta rama y `profiles`).
   `slots` ya se corrigió en `20260926001322`.
3. **`claim_slot` y `confirm_payment` no están versionadas.** Solo existen en hosted (el mirror
   de staging tiene stand-ins). `20260924042219` les revoca EXECUTE a clientes pero sus cuerpos no
   están en el repo; tampoco `reset_daily_free_claim`, `check_rate_limit`, `cleanup_rate_limits`.
4. **El mercado necesita CAS de ownership antes de volver**: rediseño por ejemplares y una
   transacción que verifique `owner_id`/ejemplar esperado al comprar, publicar y cancelar.
   Mientras tanto, las Edge Functions `market-*` (que llaman las RPC con el JWT del usuario) y
   `MarketView` responderán error de permisos.
5. **El backfill de INSTANCES no debe confiar ciegamente en XP/movimientos actuales**: hasta esta
   migración, cualquier usuario podía escribir su propio `pokemon_xp` (`xp`, `level`, `moves`) y su
   Pokédex. Los valores actuales pueden estar manipulados; tratarlos como no confiables o acotarlos.
6. **Migraciones antiguas duplicadas bloquean cualquier `db push` general** (8 archivos con versión
   `20260907`, 3 con `20260908`; `SWAP_RETIRE_2_REPORT.md` §11). Esta rama no las toca.
7. ~~`award_dungeon_reward` (010) y `consume_dungeon_energy` (011) se conceden a `authenticated` en
   una instalación nueva.~~ **Cerradas preventivamente en esta rama** (§3.1). No existen en
   producción; la reintroducción de Dungeon necesita autoridad server-side.
8. *(adicional, FACT)* `src/features/pokedex/api/pokedexApi.ts` y
   `src/features/progression/api/progressionApi.ts` siguen llamando `record_pokemon_seen`,
   `bulk_record_pokemon_seen`, `register_pokemon`, `spend_tokens_learn_move` y `grant_pokemon_xp`,
   y `collect-passive-tokens` llama `collect_passive_tokens`. En hosted esas RPC no existen, así que
   ya fallan hoy; esta rama no cambia ese comportamiento ni toca ese código.

## 7. Riesgos

- **Mercado:** tras aplicar la migración, comprar/publicar/cancelar falla con permisos (aceptado: no se
  usa en Playtest 0.2). Las publicaciones existentes quedan intactas y visibles por su política SELECT.
- **XP/Pokédex desde cliente:** cualquier escritura directa del cliente deja de funcionar. **FACT:** el
  código actual solo hace SELECT directo sobre ambas tablas.
- **ACL hosted no versionado:** si hosted tuviera un rol cliente con `GRANT OPTION` que re-otorgó, la
  migración falla entera (sin `CASCADE`); revisar la foto previa.
- **`free-claim`:** clientes viejos que lo llamen reciben 410 en lugar de un Pokémon. Ningún cliente
  actual lo invoca.
- **Rollback de `free-claim`:** volver a v19 reabre la carrera de ownership; solo como emergencia.

## 8. Plan de despliegue individual de `free-claim` (no ejecutado)

1. Respaldo de v19 (solo lectura): `supabase functions download free-claim --project-ref <ref>`.
2. Desde esta rama, en un checkout limpio, **solo esa función** y **con JWT** (sin `--no-verify-jwt`):
   ```bash
   supabase functions deploy free-claim --project-ref <ref>
   ```
3. Verificar: `supabase functions list` → `free-claim` v20, `verify_jwt = true`, las demás funciones
   con la misma versión/hash que antes. HTTP: `OPTIONS` → 200; `POST` sin auth → 401 (gateway);
   con JWT de usuario de prueba → `410 free_claim_retired`. Logs: solo arranque y, si aplica,
   `free-claim: auth check failed <Error>`; ninguna llamada a `claim_slot` ni escritura nueva en
   `transactions`/`activity_feed` con `free_claim`.
4. Rollback: re-desplegar el respaldo de v19 (reabre la vulnerabilidad).

## 9. Plan para aplicar solo esta migración (ejecutado por la estación principal; hosted la registró como `20261001032040`)

**No usar `supabase db push`** (§6.6).

1. Foto previa (solo lectura) en el SQL Editor: `scripts/security-3/grants-snapshot.sql` y
   `scripts/security-3/client-grants-violations.sql` (se espera ver filas de `authenticated` en ambas
   tablas y en las tres RPC de mercado).
2. Aplicar únicamente `supabase/migrations/20261001032040_security3_close_client_writes.sql` (entonces `20261001020637_…`), en una
   transacción: o `psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f <archivo>`, o el SQL Editor
   / `apply_migration` con el contenido exacto del archivo. El `NOTICE` debe decir 2 tablas y 3
   sobrecargas (o más, si hosted tiene sobrecargas no versionadas; las de Dungeon no existen allí).
3. Registrar la versión. **Resultado:** hosted asignó `20261001032040`; el archivo local se renombró a esa
   versión (como en `20260930230308`) y `SECURITY3_FILE` en el test apunta al nombre nuevo. No hace
   falta `migration repair`.
4. Verificar: `client-grants-violations.sql` → **0 filas**; diff de `grants-snapshot.sql`: solo
   desaparecen filas `PUBLIC`/`anon`/`authenticated` de INSERT/UPDATE/DELETE/TRUNCATE/EXECUTE.
   Con un usuario de prueba: `UPDATE pokemon_xp` → permiso denegado; `SELECT` propio funciona;
   `rpc('buy_market_listing')` → permiso denegado. Conteos de filas de XP, Pokédex, `slots`,
   `market_listings`, `token_ledger` iguales antes y después.
5. Rollback administrativo (solo si algo crítico se rompe): `GRANT` explícitos listados en la
   cabecera de la migración.

## 10. Gates

| Gate | Resultado |
|---|---|
| Deno real `free-claim` (`deno test`, Deno 2.9.7, `--allow-net=127.0.0.1`) | ✓ 14/14 · con `pokeswap-swap`, `kofi-webhook`, `_shared` y `world-authority`: 71/71 |
| `deno check` (`free-claim/index.ts`, `handler.test.ts`) | ✓ · `deno lint`: solo `no-import-prefix` del `jsr:` de supabase-js, igual que `pokeswap-swap` |
| Migración en PGlite (`security3ClientGrants.test.js`) | ✓ 25/25 (19 + 6 de Dungeon/conteos/mutación por función) · mutaciones de la migración detectadas (§4) |
| Realtime completo (`node --test`, Node 22.23.3) | ✓ 220 pass, 0 fallos; 20 skipped (gate de staging RC-0.3, requiere Supabase local) |
| Tests de Dungeon (`vitest run src/features/dungeon`) | ✓ 22 archivos / 452 tests |
| Vitest | ✓ 183 archivos / 1779 tests |
| typecheck | ✓ |
| lint | ✓ 0 errores / 9 warnings (los mismos de la base) |
| build normal + `swap-retire/bundle-check.mjs normal` | ✓ |
| build Playtest + `bundle-check.mjs playtest` | ✓ |
| Drift de SKILLS (`bundle-skills.mjs --check`) | ✓ exit 0 |

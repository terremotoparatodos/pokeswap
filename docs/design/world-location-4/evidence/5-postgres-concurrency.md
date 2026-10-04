# WORLD LOCATION-4 — F2: concurrencia sobre Postgres real (evidencia)

- **Producto probado:** `world/location-ordering-0.3 @ 0ddddd8b6745626fd224da5bafe1afd0000ba388`. Esta rama no cambia producto: ni SQL, ni Edge Functions, ni realtime, ni cliente. Solo agrega la batería `scripts/world-location/postgres-concurrency/`, esta evidencia y documentación.
- **Fecha:** 2026-10-04.
- **Entorno:** solo stacks locales; nada hosted.

## Versiones

| Componente | Versión |
|---|---|
| Supabase CLI | 2.114.0 |
| Postgres | 17.6 (`supabase/postgres:17.6.1.158`), `read committed` |
| PostgREST / GoTrue / Kong / edge-runtime (gate de staging) | 16.1 / 2.195.0 / 2.8.1 / 1.74.3 (compat. Deno 2.1.4) |
| Docker | 29.8.0 (Docker Desktop, WSL2, Windows 10) |
| Node | 24.19.0 (batería y staging) y 22.23.2 (staging, batería sobre el stack completo, tests del juez) |

## Bases

Hay 3 stacks solo-DB nuevos, preparados con `prepare.mjs init --db-only` + `migrate`, más el stack completo del gate de staging:

| Build | Contenedor | `sha256` aplicado de `20261003120000_world_location_ordering` |
|---|---|---|
| original | `supabase_db_wlocpg-orig` | `08d37a3890b2fdca…` (= blob de `0ddddd8`) |
| rv1: activate sin `LOCK TABLE` | `supabase_db_wlocpg-rv1` | `f366b0b314a0c2a2…` |
| rv2: claim sin `FOR SHARE` | `supabase_db_wlocpg-rv2` | `eb9945c4e3fba406…` |
| original (stack completo, staging) | `supabase_db_wloc4f2` | `08d37a3890b2fdca…` |

- Los mutantes se aplican **en memoria**: un único reemplazo exacto, verificado. El archivo del repo conserva sus bytes.
- Antes de correr, el runner lee el build vivo de `pg_proc.prosrc` y se niega a seguir si no coincide con el pedido.
- Las otras 8 migraciones tienen los mismos hashes en los 4 stacks; por ejemplo, `20261001220000_world_player_locations` = `79365d5fa55186e8…`.

## Resultados (10 rondas por build; reportes completos en `5-postgres-concurrency-{original,rv1,rv2}.json`)

| Escenario | original | rv1 | rv2 |
|---|---|---|---|
| A1 activate contra stop | 10 pass | **10 violation** | 10 pass |
| A2 activate contra drain | 10 pass | **10 violation** | 10 pass |
| A3 control: activate contra renew | 10 pass | 10 pass | 10 pass |
| A4 activaciones con la vieja retenida | 10 pass | **10 violation** | 10 pass |
| A4b control: carrera simple de activaciones | 10 pass | 10 pass | 10 pass |
| A5 claim contra drain | 10 pass | 10 pass | **10 violation** |
| A6 claim contra stop | 10 pass | 10 pass | **10 violation** |
| A5b control: carrera simple claim ‖ drain | 10 pass | 10 pass | 10 pass |
| **harness_error** | 0 | 0 | 0 |
| **deadlocks** (`pg_stat_database`) | 0 | 0 | 0 |
| **Veredicto del runner** | **PASS** (exit 0) | **PASS: detectado** (exit 0) | **PASS: detectado** (exit 0) |
| Duración (80 corridas) | 21,8 s | 22,1 s | 21,5 s |

La batería sobre el stack completo de staging (`supabase_db_wloc4f2`, original) también corrió con Node 22.23.2: 10 rondas, PASS, 0 harness_error, 0 deadlocks y 20,4 s.

## Causa exacta de cada detección (de los reportes)

- **RV1, A1 y A2.** El stop o el drain del mismo candidato commitea primero. Sin el lock, activate ya leyó `starting` y su `UPDATE … WHERE state = 'starting'` espera la fila (`Lock:transactionid`). Al liberarse, re-evalúa la condición, no actualiza nada y responde igual `{"status":"active"}`, mientras la fila queda en `state=stopped, activated_at=null` (TOCTOU). Con el lock, activate espera en `Lock:relation` y responde `{"status":"host_inactive","state":"stopped"}`.
- **RV1, A4.** El activate del viejo queda retenido detrás de su propio renew (`Lock:transactionid`). El nuevo se activa y commitea (`newerCommittedFirst=true`). Al liberarse, el viejo también queda `active`: su activación commitea después de la del nuevo y viola I18. Con el lock, los dos esperan en `Lock:relation`, el viejo commitea primero y el orden es coherente.
- **RV2, A5 y A6.** El claim pasa el chequeo del host y espera la fila del jugador, retenida por el flush del dueño anterior. Sin `FOR SHARE`, el drain o el stop del host commitea sin esperarlo (`drainCommittedFirst` / `stopCommittedFirst=true`). Al liberarse, el claim toma la fila: dueño = el host en `draining` o `stopped`, epoch 2. Viola I17, y los guardados del dueño anterior pasan a `stale`. Con el lock, el drain o el stop espera al claim (`Lock:transactionid`), y el claim entra mientras el host todavía está activo.
- **A4b y A5b** pasan en los tres builds, 10 de 10 cada uno. Es la forma de los tests Q6 anteriores: una carrera simple que no alcanza la ventana, como se explica en §3 del README de la batería.

## Gates de esta rama

| Gate | Resultado |
|---|---|
| Staging completo (`staging.test.js` + `locationStaging.test.js`), stack `wloc4f2` con la función servida | Node 22: 34/34; Node 24: 34/34. 0 skipped, 0 fail |
| Tests del juez (`judge.test.mjs`, sin base) | 7/7 en Node 24 y en Node 22 |
| Caminos BLOCKED de `run.mjs` (sin `--container`, contenedor inexistente, `DOCKER_HOST` remoto, build distinto del pedido, base sin migrar) | exit 2 en todos, mensaje `BLOCKED: …`, ningún PASS |
| `eslint` (configuración del repo) sobre los archivos nuevos | 0 problemas |
| `node --check` de los 6 módulos | OK |
| `git diff --check` | limpio |

No se repitieron las baterías de cliente ni los mutation runners anteriores, porque el producto no cambió.

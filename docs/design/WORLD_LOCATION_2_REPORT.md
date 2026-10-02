# WORLD LOCATION-2 — Persistencia autoritativa de la ubicación (implementación local)

> Rama `world/location-persistence-0.3`, desde `f558fca` (auditoría aprobada `design/world-location-persistence-0.3`).
> Integración de referencia: `integration/world-skills-0.3 @ 15f5f4f`.
> **Nada aplicado ni desplegado:** ni migración hosted, ni `world-authority`, ni secretos, ni flag en el entorno oscuro, ni merges. No se tocaron Playtest, producción, el gate, los testers ni otros worktrees.
> Etiquetas: **FACT** (ejecutado o leído), **INFERENCE** (deducido, a verificar), **NO EJECUTADO** (gate pedido que no pudo correr).

## 0. Resumen

- **Qué hay:**
  - una migración nueva y única;
  - dos operaciones nuevas en `world-authority`;
  - adaptadores;
  - versión de layout por área;
  - un journal coalescido con CAS `epoch + seq`;
  - integración en `PresenceRoom` con hidratación asíncrona;
  - flush de apagado;
  - flag `WORLD_LOCATION_PERSISTENCE=off|shadow|on`, `off` por defecto;
  - métricas.
- **Protocolo de cliente y `/version`:** sin cambios. Nada nuevo llega al bundle del navegador (FACT: 0 coincidencias en `dist/`, `src/` sin diff).
- **Pruebas:**
  - **+95** tests del realtime, de 335 a 430 (0 fallos en Node 22 y en Node 24);
  - 5 tests nuevos de contrato Deno;
  - 9 tests de staging de ubicación, **no ejecutados**;
  - **40/40 mutaciones** detectadas, con el árbol restaurado;
  - simulación de **dos procesos reales**: 11/11 chequeos;
  - benchmark de 100 jugadores: p99 del event loop dentro de ±1 % de `off` y **≤ 1 invocación/s**.
- **No ejecutado:** el stack Supabase local y el staging completo. Docker Desktop no arranca en esta máquina: `wsl.exe` no responde y el disco C: está al 98 %. Ver §8.
- **Cambio respecto de la auditoría:** el `await` del claim ya no va antes del reemplazo atómico. El brief pidió reservar la sesión sin esperar la base e hidratar después (§3).

## 1. Commits

| SHA | Commit |
| --- | --- |
| `d4be8da` | 1 · `feat(db)`: `world_player_locations` + claim/save (INVOKER, solo `service_role`) |
| `7e55c3f` | 2 · `feat(world-authority)`: `location_claim` / `location_save` |
| `2fe5059` | 3 · `feat(realtime)`: adaptadores (Edge + PGlite) |
| `8eb4d91` | 4 · `feat(realtime)`: versión de layout por área persistible |
| `6345580` | 5 · `feat(realtime)`: `LocationJournal` |
| `1600b85` | 6 · `feat(presence)`: reserva sin esperar, hidratación, vallado |
| `52145a7` | 7 · `feat(realtime)`: flush de apagado ordenado |
| `42e669c` | 8 · `feat(realtime)`: gate `WORLD_LOCATION_PERSISTENCE` |
| `3e50ae3` | 9 · `test(staging)`: vallado entre dos instancias (stack local) + simulación de dos procesos |
| `2eecbc4` | **extra** · `perf(realtime)`: un lote por segundo; huellas de layout al arrancar (lo encontró el benchmark, §7) |
| `3fba3fe` | **extra** · `test(world-location)`: runner de mutaciones, autoridad local, benchmark de ubicación |
| `1ce6ea4` | **extra** · `test(realtime)`: dos tests de autoridad colgada en Node 22 (§8) |
| *(este)* | 10 · `docs`: este informe y baselines |

**Desvío consciente:** son 13 commits y no 10. Los tres extra son correcciones o herramientas aparecidas durante la verificación. Prefiero que queden visibles antes que reescribir la historia.

## 2. Diff resumido

34 archivos, +3.816 / −23 (antes de este informe).

| Capa | Archivos |
| --- | --- |
| Base (archivo, sin aplicar) | `supabase/migrations/20261001220000_world_player_locations.sql`. Fuera de migraciones: `scripts/world-location/rollback_world_player_locations.sql` y `location-grants-check.sql` |
| Edge (sin desplegar) | `supabase/functions/world-authority/handler.ts` (+ tests) |
| Realtime: persistencia | `world/persistence/playerData.js`, `playerDataMetrics.js`, `dev/devPlayerData.js`, `dev/localDatabase.js`, `world/worldConfig.js` |
| Realtime: dominio | `world/layoutVersion.js`, `presence/locationJournal.js`, `presence/locationPolicy.js`, `presence/locationService.js` |
| Realtime: sala | `rooms/locationJoin.js` (nuevo, 200 líneas) y `rooms/PresenceRoom.js` (384 → 450 líneas). La lógica nueva quedó fuera de la sala central (AGENTS §24) |
| Proceso | `index.js` (`onShutdown`), `observability/metrics.js` (`location`), `.env.example`, `README.md` |
| Herramientas | `scripts/world-location/{two-instances,localAuthority,mutations}.mjs`, `scripts/benchmark-navigation.mjs --location`, README de rc03-staging |
| Docs | este informe, `docs/performance/baselines/world-location-2/` |

## 3. Reglas de conexión (aplicadas)

1. **Reemplazo atómico sin esperar la base.** En el join, `previous.leave(...)`, la reserva del `userId` y la creación de la sesión del journal son síncronas. No hay ningún `await` antes.
2. **Hidratación** (`on`, sin actor vivo ni `ReconnectCache`):
   - el socket queda reservado pero **sin actor**: nada se publica a otros jugadores;
   - `move`, `area`, `world:work` y `chat` se rechazan, y `ready` se difiere;
   - con la respuesta del claim, se coloca en la fila validada;
   - a los **1,5 s** (`HYDRATION_TIMEOUT_MS`), se coloca en Ciudad en estado `unclaimed`.
3. **Claim tardío (regla elegida):** se aplica solo si se cumplen las dos condiciones:
   - el jugador **no hizo nada todavía** (ningún paso aceptado, cruce, pedido de trabajo ni movimiento del servidor);
   - estamos dentro de **5 s** (`LATE_APPLY_WINDOW_MS`) desde que fue colocado.

   Se aplica como una colocación del servidor, con un snapshot nuevo: equivale a un join lento. En cualquier otro caso se ignora y el journal guarda la posición real. Tests: «a late claim moves a player who has done nothing yet…» y «…late claim ignored after moving». Mutación M32.
4. **`ReconnectCache` sigue ganando**, pero cada sesión nueva reclama igual un epoch (en segundo plano) para poder escribir.
5. **Sesión vallada:** un `stale` sobre el epoch vigente:
   - deja al escritor sin escribir al instante;
   - cierra el socket con **`4001` `session-replaced`** (D-L2);
   - su casilla **no** se guarda en la `ReconnectCache` (ganaría a la fila de la sesión nueva).

   Con el flag activo, el reemplazo local usa el mismo código y la misma razón. En `off`, sigue siendo `leave(4001)`, como hoy.

## 4. Esquema y operaciones

**`public.world_player_locations`:**
- `user_id` PK, FK a `auth.users` con `ON DELETE CASCADE`;
- `area_id`, `tx`, `ty` y `layout_version`: los cuatro `NULL` o los cuatro no `NULL`; regex y rangos ±4096 por `CHECK`;
- `epoch ≥ 1`, `seq ≥ 0`, `updated_at` (solo diagnóstico);
- `fillfactor 80`.

**Seguridad:**
- RLS activado y **ninguna política**;
- `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` **y `service_role`**;
- después, `GRANT SELECT, INSERT, UPDATE` solo a `service_role`, sin `DELETE` ni `TRUNCATE`.
- Las dos funciones son `SECURITY INVOKER`, con `search_path=public` y `EXECUTE` solo para `service_role`.

**`world_location_claim(uuid) → jsonb`:**
- un `INSERT … ON CONFLICT DO UPDATE SET epoch = epoch + 1, seq = 0` en un solo statement;
- devuelve `{status:'claimed', epoch, location|null}` con la ubicación anterior intacta;
- usuario inexistente → `{status:'unknown_user'}`, sin escribir nada. Lo decide la FK; `service_role` no necesita leer `auth.users`.

**`world_location_save(jsonb) → jsonb`:**
- de 1 a 200 filas, una por jugador;
- devuelve `[{userId, result}]` en el orden de entrada;
- bloquea las filas en orden de `user_id`, sin deadlocks entre lotes cruzados;
- cada fila: `UPDATE … WHERE epoch = p.epoch AND seq < p.seq`;
- si no aplicó: `stale` (no hay fila u otro epoch) o `duplicate` (mismo epoch, `seq ≤` guardado);
- `invalid` si la forma de la fila es mala (comparaciones seguras ante `NULL`);
- un lote malformado (vacío, > 200, usuario repetido o no UUID) lanza error y no escribe nada.

**`world-authority`:**

| op | Valida | Llama |
| --- | --- | --- |
| `location_claim` | `userId` UUID | `world_location_claim` |
| `location_save` | 1–200 filas reconstruidas campo por campo (descarta extras): UUID único, `epoch`/`seq` enteros seguros ≥ 1, `areaId` y `layoutVersion` por regex, `tx`/`ty` en ±4096. Una fila mala → `400` para todo el lote | `world_location_save` |

- Ninguna de las dos pasa por el gate de WORLD × SKILLS (D-L4).
- Los errores de la base no salen en la respuesta.

**Restauración** (`presence/locationPolicy.js`, siempre contra la navegación canónica):

| Situación | Resultado |
| --- | --- |
| Área inexistente o retirada | Ciudad |
| Cliente sin `worldProtocol ≥ 3` con la fila en una cueva (D-L6) | Aproximación de la cueva en la Pradera |
| Otra `layout_version` (D-L8) | Llegada del área |
| Casilla sólida, inalcanzable, portal o fuera del borde | Llegada del área |
| Caso normal | La casilla, mirando `down` (D-L7) |

- Los pisos `dg:<id>:<n>` guardan el ancla exterior de su cueva (D-L9). El registro `dungeonId → cueva` está vacío hasta que existan las Dungeons.
- **Versión de layout:** `1.<12 hex de sha256>` por área. Ciudad y cuevas: cada casilla clasificada. Pradera: los hechos autorizados, una ventana densa de la región autorizada más 24 casillas y una retícula de 64 sobre ±4096. Congelada por test (Ciudad `1.f04b84e25e1a`, Pradera `1.bbce2fd97f67`, cueva `1.54820710979b`). Se calcula al construir el servicio activo.

## 5. Semántica exacta de claim y save

- **Identidad:** solo `userId` de Supabase (UUID) verificado en el join. Invitados, `benchmark-*` y cualquier id no UUID no persisten nunca. Nada del payload del cliente (área, coordenadas, layout, epoch, seq) se usa: el journal lee el actor autoritativo.
- **Epoch:** lo emite la base en cada claim. Los claims de un mismo jugador se **encadenan** en el proceso, así que la sesión más nueva siempre obtiene el epoch más alto.
- **Seq:** contador del journal por epoch, empieza en 0 tras cada claim. **Nunca `moveSequence`** (test con `moveSequence = 2^53−1`; mutación M12). Un reintento de la **misma** ubicación reusa `(epoch, seq)`. Una ubicación **distinta** siempre recibe un seq nuevo, así que un `duplicate` nunca esconde datos nuevos (M20).
- **Resultados por usuario:**

  | Resultado | Efecto |
  | --- | --- |
  | `applied` / `duplicate` | Confirman solo a ese usuario |
  | `stale` del epoch vigente | Valla y cierra ese socket |
  | `stale` de un epoch anterior del mismo jugador | Se descarta |
  | `unknown` | Reintenta solo a ese usuario |
  | `invalid` | Descarta esa fila |

  Una respuesta sobre un usuario no enviado no confirma a nadie (M11, M13).
- **Sesión sin claim** (`claiming`/`unclaimed`):
  - juega normalmente;
  - no ejecuta `location_save`;
  - guarda un solo slot coalescido;
  - reintenta el claim con backoff de 1 s a 30 s (con jitter de hasta 250 ms) mientras está conectada;
  - al desconectarse, su slot se descarta y se cuenta, porque reclamar en ese momento podría vallar a una sesión nueva en otra instancia.
- **Memoria acotada:** un slot por jugador y como máximo 1.000 entradas; se expulsan los desconectados más viejos (`dropped.evicted`).
- **Cadencia:**
  - urgente (portal o desconexión) en el próximo tick, ≤ 1 s;
  - checkpoint: ≥ 10 s desde la última escritura del jugador **+ jitter determinista y acotado** en [0, 2 s), derivado del `userId` con FNV-1a;
  - lotes ≤ 200 y un solo lote en vuelo;
  - **tick de 1 s ⇒ ≤ 1 `location_save` por segundo por proceso**;
  - backoff de lote de 1 s a 30 s.
- **Pérdida aceptada:** con la autoridad sana, los portales y las desconexiones salen en ≤ 1 s. Si caen a la vez la autoridad y el proceso, puede perderse el último tramo, como mucho el último checkpoint (≤ 12 s de caminata) y, si la caída dura, también el último cruce. La restauración siempre cae en un lugar seguro. **No se afirma que el área nunca se pierda.**
- **Apagado:** `onShutdown` llama a `flushAll(3 s)` después de que Colyseus desconectó a todos. Es best-effort: nunca espera más allá del plazo, aunque la autoridad esté colgada, y la corrección no depende de él.

## 6. Métricas (`/metrics` → `location`; nunca `/version`, D-L5)

| Campo | Contenido |
| --- | --- |
| `mode`, `effective` | `off`, `shadow`, `on` o `unavailable` (sin adaptador de ubicación) |
| `restores` | `live`, `cache`, `row`, `noRow`, `failed`, `timeout`, `unknownUser` |
| `repairs` | `area`, `layout`, `tile`, `protocol` |
| `late` | `applied`, `ignored` |
| `shadow` | `wouldRestore`, `wouldRepair` (qué habría hecho `on`) |
| `fencedDisconnects` | Sesiones valladas cerradas con 4001 |
| `hydration` | `started`, `maxMs` |
| `journal` | Sesiones vivas por estado, `entries`, `pending`, `urgent`, `inflight`, `backoffMs`, `claims{ok, unknownUser, failed, superseded, retries}`, `saves{batches, rows, applied, duplicate, stale, staleOldEpoch, invalid, unknown, failedBatches, unchanged, maxBatch, lastBatchMs}`, `fenced`, `dropped{evicted, unclaimed, invalid, disabled}` |

Además, `world.playerData` suma `locationClaim` y `locationSave` (llamadas, fallos y latencias). Ningún campo lleva ids, áreas, casillas, epochs ni versiones de layout (test dedicado).

## 7. Benchmark (100 jugadores, 60 s, semilla 4)

**Escenario:**
- `scripts/benchmark-navigation.mjs --location <modo>`: los caminantes de CAVES-4 con rutas y cruces reales;
- los jugadores autentican con token, como UUID que persisten, y arrancan en Ciudad;
- el servidor es un proceso realtime real que usa la autoridad local (el handler real sobre PGlite);
- solo cambia el flag entre corridas;
- JSON en `docs/performance/baselines/world-location-2/`.

| Final (`2eecbc4`+) | `off` | `shadow` | `on` |
| --- | --- | --- | --- |
| Pasos aceptados (cliente = servidor) | 41.279 | 41.279 | 41.374 |
| Cruces aceptados | 511 | 511 | 511 |
| Rechazos inesperados / fugas / errores | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Event loop p50 / **p99** / máx. | 30,05 / **37,98** / 43,91 ms | 29,88 / **37,95** / 45,74 ms | 29,97 / **37,49** / 42,80 ms |
| Δ p99 frente a `off` | — | −0,1 % | −1,3 % |
| RTT del ack p99 | 99,0 ms | 78,3 ms | 78,4 ms |
| `location_save`/s | 0 | **0,86** | **0,88** |
| Filas/s | 0 | 13,99 | 14,59 |
| Claims (uno por join) | 0 | 100 | 100 |
| RSS final / pico | 219 / 219 MB | 207 / 210 MB | 219 / 218 MB |

**Antes de `2eecbc4`** (archivos `*-before-2eecbc4.json`):
- `shadow`/`on` daban 1,71/1,74 invocaciones/s por el tick de 500 ms;
- el **máximo** del event loop llegaba a 224/236 ms, por la huella de la Pradera calculada en el primer guardado en vivo.

Los dos problemas quedaron corregidos y tienen mutación (M39 y M40).

**Lectura:**
- El criterio del p99 (> 5 % = falla) se cumple.
- El de ≤ 1 invocación/s también, ahora por construcción.
- Las **filas/s** (unas 14) superan la estimación de la auditoría (≤ 10/s): el escenario sintético cruza unas 8,5 veces/s entre 100 jugadores, y cada cruce es urgente. Con el patrón del smoke de CAVES-4 (32 cruces en 7 min con 2 jugadores) domina el checkpoint (≤ 10 filas/s).
- Las filas viajan en lotes de hasta 41: el costo está en las filas por invocación, no en las invocaciones.

## 8. Gates (FACT: ejecutados en `1ce6ea4` salvo indicación)

| Gate | Resultado |
| --- | --- |
| Unitarios focalizados de ubicación (journal 23, política 7, layout 6, flag 6, adaptadores 6) | 48/48 |
| PGlite de la migración (`worldLocations.database.test.js`) | 17/17 |
| PGlite con dos journals (dos instancias) | 3/3 |
| Sala con persistencia (`PresenceRoomLocation.test.js`: dos copias de módulo sobre una base, reinicio, vallado, hidratación) | 27/27 |
| Contratos Deno `world-authority` | 11/11 (5 nuevos) |
| Deno `_shared` (guard de webhooks) | 27/27 (con `--allow-read`; mi primera invocación lo omitió) |
| Tests y `check` del guard de webhooks | 28/28 y ✓ |
| **Realtime completo, Node 22** (`npx --offline node@22`) | 430 aprobados, 0 fallos, 0 cancelados, 30 omitidos (21 de staging + 9 de staging de ubicación) |
| Realtime completo, Node 24 | 430 / 0 / 0 / 30 |
| Primera corrida en Node 22 | 7 cancelados: dos tests míos de autoridad colgada perdían el event loop (timers con `unref`). Corregido en `1ce6ea4`, sin tocar código de producto |
| Vitest completo | 191 archivos, 1829/1829 |
| typecheck | OK |
| lint | **2 errores y 9 warnings**. Los 9 warnings son preexistentes (`AuthModal.vue`, igual que en CAVES-4). Los 2 errores están en `docs/design/world-location-1/cas-model.mjs`, que viene del commit de auditoría aprobado `f558fca` y no se modificó (`git diff f558fca` vacío). Cero problemas en archivos de esta rama |
| Build normal + `bundle-check normal` | ✓ / ✓ |
| Build Playtest + `bundle-check playtest` | ✓ / ✓ |
| Bundle sin nada de ubicación (`dist/`) | 0 coincidencias |
| Drift de SKILLS (`bundle-skills.mjs --check`) | OK |
| `zone-layout.ts -- --check` | al día |
| WORLD × SKILLS (sala, placement, integración, Edge path, worldRoom, skillPolicy) | 38/38 |
| YIELD-2 (multi-yield + base) | 48/48 |
| Migraciones / SECURITY-3 (PGlite, incluye «todas las migraciones desde cero» con la nueva) | 57/57 |
| Navegación y presencia de CAVES-4 (regresión con `off`) | 82/82 |
| Pacing de SKILLS | ✓ |
| Benchmark de 100 jugadores | §7 |
| **Simulación de dos instancias** (`scripts/world-location/two-instances.mjs`): dos procesos `index.js` reales, el handler real sobre PGlite, sockets reales | **11/11** (§9) |
| Mutaciones | **40/40** detectadas, árbol restaurado (§10) |
| **Supabase local y staging completo** (`staging.test.js` + `locationStaging.test.js`) | **NO EJECUTADO.** Docker Desktop responde «unable to start»; `wsl.exe -l -v` no responde; C: tiene 98 % usado (11 GB libres; el stack pide unos 5 GB). No toqué WSL ni la configuración del sistema. Los 9 tests de staging de ubicación cargan y se omiten sin las variables |

## 9. Casos de la matriz (§7 de la auditoría)

| # | Caso | Dónde |
| --- | --- | --- |
| 1 | > 15 s sin cache → fila | sala (cueva y extremo a extremo), dos procesos |
| 2 | < 15 s → gana la cache, epoch nuevo | sala |
| 3 | Reinicio | sala (módulo nuevo), journal + PGlite, dos procesos (kill + proceso nuevo) |
| 4 | Apagado ordenado | sala (3 jugadores, casilla exacta), plazo con autoridad colgada |
| 5 | Dos instancias | PGlite (dos journals), sala (dos copias de módulo), **dos procesos reales** |
| 6–8 | Escritura tardía, lotes reordenados, reintento | PGlite |
| 9 | Posición manipulada | PGlite (`CHECK`s, filas inválidas), política, sala |
| 10 | Payload del cliente con área o casilla | sala (ignorado) |
| 11 | Cliente lee o escribe la tabla o la RPC | PGlite (`anon`/`authenticated` + catálogo + check hosted); staging **no ejecutado** |
| 12–13 | Área retirada, layout cambiado | política, sala |
| 14 | Autoridad caída o lenta al entrar | sala (1,5 s reales, Ciudad, `unclaimed`, sin saves); staging no ejecutado |
| 15 | Autoridad caída al guardar | journal (backoff, mismo seq, `duplicate` confirmado) |
| 16 | Doble reconexión | journal (claims encadenados), sala (tres joins seguidos) |
| 17 | Transición + desconexión | PGlite (los dos órdenes), sala |
| 18 | Trabajo activo + reinicio | sala (casilla de espera, 0 acciones vivas) |
| 19 | Trabajo activo + < 15 s | sala (sin cancelación) |
| 20 | Aislamiento entre áreas | sala |
| 21 | Invitado y benchmark | sala |
| 22 | 1.000 pasos → ≤ 1 fila | journal, sala |
| 23 | Benchmark `shadow` | §7 |
| 24 | Rollback a `off` | sala (en caliente), flag (al arrancar), suites de CAVES-4 con `off` |
| 25 | Playtest 0.2 intacto | no se tocó `main`, el tag, Playtest ni secretos (sin acciones remotas) |
| 26 | Cliente anterior a CAVES-3 | política, sala |
| 27 | Usuario borrado | PGlite (cascada); staging no ejecutado |

Además, con controles negativos: backoff acotado, cola coalescida y acotada, stale → 4001, lote parcial por usuario, jitter, lotes ≤ 200 y `off`/`shadow`/`on`.

## 10. Mutaciones (`node scripts/world-location/mutations.mjs`)

Cada una rompe una protección, exige que su test **falle** y restaura el archivo byte a byte; al final verifica con git que el árbol esté limpio. **40/40 detectadas** (corrida final sobre `1ce6ea4`; detalle en la salida del script).

| Capa | Mutaciones |
| --- | --- |
| SQL | M1 CAS sin epoch · M2 CAS sin seq · M3 grants de la tabla · M4 `EXECUTE` del claim · M5 `NULL` con `<>` · M6 el claim no resetea seq · M7 `DELETE` para `service_role` |
| Edge | M8 casillas fuera de rango · M9 jugador repetido · M10 claim sin UUID |
| Adaptador | M11 respuesta ajena confirma |
| Journal | M12 `moveSequence` como seq · M13 lote confirmado entero · M14 `stale` sin valla · M15 `unclaimed` guarda · M16 sin expulsión · M17 sin backoff · M18 sin jitter · M19 lotes > 200 · M20 seq reusado con otra casilla · M21 claims sin encadenar · M22 flush de apagado sin plazo · M23 claim sin backoff |
| Política | M24 sin `isSafeLanding` · M25 sin versión de layout · M26 área desconocida aceptada · M27 sin D-L6 · M28 piso de Dungeon guardado tal cual |
| Sala | M29 sin hidratación · M30 sin 4001 · M31 vallado recordado · M32 claim tardío tras actuar · M33 timeout ≠ 1,5 s · M34 invitados persisten · M35 actor visible durante la hidratación |
| Flag | M36 valores laxos · M37 `off` reclama |
| Carga | M39 tick de 500 ms · M40 huellas en el primer guardado |
| Layout | M38 cambio de mapa sin versión nueva |

## 11. Simulación de dos procesos (D-L10, ensayo local)

`node scripts/world-location/two-instances.mjs`, 11/11:
1. A atiende al jugador, que cruza a la Pradera; se guarda en ≤ 1 s.
2. B arranca con A vivo; el socket nuevo del jugador entra a B, restaurado en la Pradera (epoch 2).
3. El socket viejo cruza en A → `stale` → **A lo cierra con 4001** y `/metrics` de A cuenta 1 `fencedDisconnects`. La fila conserva el estado de B.
4. `/version` sin estado de ubicación.
5. A muere con kill; el jugador vuelve a Ciudad en B y se guarda.
6. B muere con kill; un B' nuevo restaura la última casilla guardada (epoch 3).

**Qué no prueba:**
- que Colyseus Cloud solape procesos en un deploy;
- que llame a `onShutdown` (INFERENCE §2.7, a verificar en staging);
- el apagado ordenado por señal: en Windows `SIGTERM`/`SIGINT` matan el proceso sin handler, así que el flush de apagado se probó a nivel de sala (§8).

## 12. Limitaciones y riesgos

1. **Staging (Supabase local) no ejecutado.** Los grants vía PostgREST, la concurrencia real de Postgres (20 claims, lotes cruzados), la cascada desde Auth y la Edge Runtime real están cubiertos solo por PGlite y la simulación. Es el primer gate a correr cuando Docker funcione.
2. **D-L10 sin verificar** en Colyseus Cloud: solapamiento y `onShutdown`.
3. **Pérdida ante una caída simultánea** de autoridad y proceso: el último checkpoint (≤ ~12 s) y, si la autoridad sigue caída, también cruces pendientes. Una sesión `unclaimed` que se desconecta pierde su posición (contado en `dropped.unclaimed`).
4. **Huella de la Pradera:** un cambio procedural lejos de toda zona autorizada y entre puntos de la retícula de 64 no cambia la versión. `isSafeLanding` sigue protegiendo la casilla, pero no un bolsillo cercado (H4).
5. **Cambiar la navegación** de un área resetea a todos sus jugadores a la llegada (D-L8, conservador). El test congelado obliga a decidirlo a conciencia.
6. **Claims en tormenta:** cada join hace un claim; con 100 joins simultáneos hay 100 invocaciones, sin lote. Tiene el mismo tope que la capacidad (100).
7. **Filas/s** por encima de la estimación con cruces sintéticos muy frecuentes (§7). Hay que mirarlo en `shadow` con jugadores reales.
8. **`PresenceRoom.js` tiene 450 líneas** (franja 300–500; antes 384). La lógica de ubicación está en `rooms/locationJoin.js`.
9. **Lint** falla por `cas-model.mjs`, preexistente en `f558fca` (§8). Se arregla en esa rama o ignorando `docs/` en ESLint: decisión de quien integre.
10. **Dungeons:** el registro `dungeonId → cueva` está vacío. Un piso `dg:*` hoy no se guarda; se conserva la última ubicación persistible.

## 13. Plan separado (nada de esto se hizo)

1. **Revisión:**
   - leer este informe y los commits 1 a 9;
   - mirar sobre todo `locationJoin.js` (reglas de conexión), `locationJournal.js` (CAS y resultados por usuario) y la migración.
2. **Staging local** (antes de integrar, cuando Docker funcione):
   - aplicar la migración en el loop de `scripts/integration/rc03-staging/README.md`;
   - `supabase functions serve`;
   - `staging.test.js` + `locationStaging.test.js`;
   - repetir el benchmark contra el stack.
3. **Integración:**
   - merge a `integration/world-skills-0.3` con el flag en `off`;
   - re-ejecutar los gates sobre el merge.
4. **Migración hosted** (con autorización, D-L1):
   - aplicar **solo** `20261001220000_world_player_locations.sql` en forma individual (nunca `supabase db push`);
   - alinear la versión local con la que registre hosted;
   - correr `scripts/world-location/location-grants-check.sql` (0 filas esperadas).
5. **Deploy de `world-authority`** (con autorización):
   - la Edge Function nueva, con el secreto existente y sin cambiar secretos;
   - verificar 401 sin secreto y 400 ante un lote malo.
6. **Shadow en el entorno oscuro:**
   - `WORLD_LOCATION_PERSISTENCE=shadow`, reinicio autorizado;
   - smoke normal y leer `/metrics` → `location`;
   - esperado: `stale` inesperados 0, `failedBatches` 0, `claims.failed` 0, `wouldRepair` razonables, ≤ 1 `location_save`/s;
   - verificar D-L10 en un deploy real.
7. **Activación:**
   - `on` con reinicio;
   - smoke humano de §8 de la auditoría (cueva > 30 s, reinicio, cruce y cierre, dos pestañas → 4001, trabajo, aislamiento, rollback a `off`).
8. **Rollback** en cualquier punto: `off` y reiniciar, sin tocar la base. Después, revertir la función. Por último, el script de rollback (los datos son descartables).

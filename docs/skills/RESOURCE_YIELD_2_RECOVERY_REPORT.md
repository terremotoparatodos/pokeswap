# RESOURCE YIELD-2 Recovery — resincronización autoritativa (informe)

> Rama `world/multi-yield-recovery-0.3`, creada desde `a2003b6` (= `origin/world/multi-yield-resources-0.3`, sin tocar). Corrige los hallazgos I-1, M-1, M-3 y M-5 de la auditoría de `d8b5571..a2003b6` y aclara M-2.
> Sin contrato público nuevo: no hay API, operación, migración ni función SQL nuevas. Sin merge, PR, deploy, tag ni cambios hosted.

## 1. El problema (I-1)

Una unidad cuyo commit agotaba sus 4 intentos (la base podía haberla aplicado igual) o volvía `stale_node` dejaba la memoria de WORLD con token y stock viejos. `#finish` escribía el nodo desde esa memoria, y desde ahí cada jugador que lo trabajaba recibía `stale_node` sin pago hasta que vencía la fila. Pasaba también con una sola instancia.

## 2. La recuperación autoritativa

Cuando el último commit de una secuencia es **ambiguo** (sólo fallos reintentables) o **`stale_node`**, la secuencia ya no escribe el nodo desde memoria:

1. **Retención.** La secuencia pasa a `resyncing` y el nodo responde `busy`. Nadie pierde tiempo trabajando un nodo cuyo stock es desconocido.
2. **Dedupe primero.** Si hay una unidad en duda, cada paso la liquida otra vez con **el mismo objeto de settlement** y el mismo `settlementId`. Nunca se crea uno nuevo. La base contesta de forma autoritativa:
   - `applied`, o `duplicate` con el settlement original (ver M-3): la unidad se confirma y recién ahí se emite `world:work:yield`.
   - `stale_node`: no existe un settlement con ese id, porque el dedupe va antes del CAS. La unidad no se pagó ni se pagará, y se cierra su autorización.
   - Un fallo reintentable deja la duda abierta para el próximo paso.
3. **Lectura del nodo.** Sin nada en duda, se lee la base con la lectura privada existente: `playerData.loadNodes()`, que en producción es la operación `load_nodes` de `world-authority` y en local/tests es `world_load_nodes()` como `service_role`. El resultado se filtra por `nodeId` dentro del servidor. El nodo se escribe tal como lo tiene la base:

   | La base tiene | WORLD escribe |
   |---|---|
   | sin fila (nunca trabajado, o vencida y borrada con el reloj de la base) | lleno (estado base) |
   | `available` + `stock_remaining` | parcial privado: stock, token = `action_id`, recarga en `respawn_at` |
   | `depleted` | agotado hasta `respawn_at`, con su token |
   | parcela | etapa según `plot` y el reloj del servidor |

4. **Pasos acotados en el reloj del room.** El primer paso corre enseguida. Los siguientes van por la `DueQueue` a +1 s, +3 s, +9 s y después cada 30 s: nunca hay un loop apretado. Tras `RESYNC_HOLD_STEPS` (4) pasos fallidos, el jugador y el Pokémon se liberan y reciben `world:work:done` sólo con las unidades confirmadas. **El nodo sigue retenido** hasta que la base contesta.
   - Si la base confirma después la unidad dudosa, cuenta como `lateConfirmations`: ya está pagada en la base y se ve en el próximo `player:state`.
   - No se emite un yield después del `done`.
5. **Varias instancias.** La base es la única autoridad: token, stock, `respawn_at` y el borrado de filas vencidas con `now()` de la base. Cada instancia se resincroniza sola contra ella. Si hay varios nodos resincronizándose a la vez, comparten una sola lectura en curso (`#loadPersisted`).
6. **Sin base** (`loadNodes` ausente: tests de transporte, demo) la memoria sigue siendo el único registro, como antes.

**Cableado.** `ResourceAuthority` recibe `loadNodes`. `WorldRoom` le pasa `() => playerData.loadNodes()`, la misma lectura que ya usaba `restore()` al arrancar. Es cableado interno y no cambia ningún contrato.

**Privacidad.** El flag `syncing` es privado del registro en memoria. `publicNode` elige sus campos uno por uno y nunca proyecta `stock`, `token`, `stockRemaining`, `syncing` ni ids de settlement. Los yields siguen llevando sólo `actionId`, `index` y `summary`. Hay tests que lo verifican en unidad y en integración.

**Costo conocido.** `world_load_nodes()` trae todas las filas vigentes, no una. Es aceptable para un camino raro: una resincronización es un evento de error, y las lecturas concurrentes se comparten. También borra filas vencidas con el reloj de la base, igual que en cada arranque. Si hiciera falta una lectura por nodo, sería una operación nueva, fuera de esta tarea.

## 3. M-1 — `stale_node` contado de verdad

Los tests cuentan cada llamada real a `settleWork`. Una unidad `stale_node`:

- se envía una sola vez, con su propio id, y nunca con otro;
- no deja que se prepare ni se pague ninguna unidad posterior: la unidad 2 nunca llega a la base, ni se autoriza una 3;
- no emite yield;
- cierra su autorización una vez;
- termina o se resincroniza de forma controlada, sin actividad posterior aunque el room siga corriendo.

## 4. M-3 — el duplicado devuelve el original

El dedupe de `world_commit_work` ya devolvía `to_jsonb(v_existing)`. El adaptador (`skillsWorldPolicy.ts`, función `canonicalSummary`) arma el resumen desde esa fila: `skill_id`, `xp_gained`, `xp_after`, `rewards`, `level_before` y `level_after`, más `levelUpLine` y `unlocks` derivados de los niveles guardados. Un reintento después de perder la respuesta vuelve a tirar el drop en memoria, pero esa tirada nunca llega al jugador. Si la fila no es un settlement bien formado de ese id, se vuelve al duplicado mínimo anterior. El índice de unidad lo pone WORLD (`unit.index`, el mismo sufijo `-hex2` del `settlementId`). El total acumulado suma los resúmenes confirmados. No hizo falta cambiar SQL.

## 5. M-5 — autorizaciones

| Final de la unidad | Autorización de SKILLS |
|---|---|
| éxito (`applied`) | liquidada, nada que cerrar |
| duplicado | liquidada, nada que cerrar |
| ambigua | **abierta** mientras el dedupe todavía pueda confirmarla. Se cierra sólo si la base contesta `stale_node` o un rechazo definitivo |
| `stale_node` | cerrada una vez (`cancelWork`), en el momento |
| rechazo definitivo (p. ej. `expired`) | cerrada una vez |
| abortada (una anterior falló) / en curso al cortar / cancelación | cerrada una vez, como antes |

`cancelWork` es idempotente y nunca despaga: después de un éxito o un duplicado no hace nada, y un reintento posterior sigue deduplicando en la base. Queda respetado que `service.settleWork` marca el ledger antes del commit: ante `stale_node` o un fallo de la base, el adaptador desmarca el ledger, y recién entonces WORLD cierra o reintenta.

## 6. M-2 — carbón

`docs/design/RESOURCE_YIELD_1_AUDIT.md` §4 agrega `coal_seam` a la tabla: queda deliberadamente en `[1,1]` porque es un material raro/avanzado y hoy está retirado del mapa. No cambia código de balance ni de stock.

## 7. Pruebas y mutaciones

**Tests nuevos:**

| Archivo | Cubre |
|---|---|
| `multiYield.test.js` (WORLD, SKILLS guionado) | **M-1**: cada llamada real a `settleWork`; la unidad stale se envía una vez con su id, nunca se reliquida, se cierra una vez, no se prepara ni se paga nada después y no hay actividad posterior. Ambigua → dedupe confirma (mismo objeto de settlement en los 4 intentos y en el paso de resync, un yield, el total canónico). Ambigua → `stale_node` (sin pago, cerrada una vez). `stale_node` → base llena, parcial, agotada o vencida. Filtro por `nodeId`. `busy` durante el resync y ninguna fuga (`stock`, `token`, `stockRemaining`, `syncing`, ids de settlement). Base caída: retención, liberación de jugador y Pokémon, nodo retenido, backoff acotado, confirmación tardía sin yield. Tabla **M-5**: éxito, duplicado, ambigua, stale, rechazo y cancelación. Sin base, comportamiento anterior. |
| `integration.test.js` (SQL real en PGlite + adaptador real) | **M-3 de punta a punta**: settlement aplicado → 4 respuestas perdidas → reintento con el mismo `settlementId` → duplicado con el original → un solo yield con la tirada pagada (no la retirada) → total canónico → XP 10 y materiales pagados una vez. Después el nodo sigue desde el token de la base. La segunda instancia con `stale_node` ahora se resincroniza y sirve la última unidad del parcial sin reiniciar. |
| `skillsWorldPolicy.test.ts` (Vitest) | Duplicado con el original (materiales, XP, niveles, `levelUpLine`), cancelación guardada, fila ajena o malformada. `cancelWork` idempotente después de stale, éxito, duplicado, ambigua y cancelación previa. |

**Mutation checks.** Cada mutación se aplicó de a una con un runner temporal, se corrieron los tests indicados y el archivo se restauró byte a byte (mismo SHA-1 antes y después). **16 de 16 detectadas** (12 contra `multiYield`, 2 contra la integración, 1 contra Vitest y 1 contra el bundle).

| Mutación | Tests | Resultado |
|---|---|---|
| La mutación de la auditoría: `if (result.ok \|\| (!result.retryable && result.reason !== 'stale-node')) break` (stale reintentado) | multiYield | detectada (2) |
| La unidad stale se reliquida con otro id | multiYield | detectada (1) |
| Sin resync (memoria como antes) | multiYield / integración | detectada (7 / 2) |
| El resync no filtra por `nodeId` | multiYield | detectada (1) |
| El nodo acepta trabajo mientras se resincroniza | multiYield | detectada (1) |
| La unidad dudosa se cierra enseguida (M-5) | multiYield | detectada (5) |
| La unidad stale queda abierta (M-5) | multiYield | detectada (2) |
| El resync saltea el dedupe de la unidad dudosa | multiYield / integración | detectada (4 / 1) |
| La confirmación tardía emite yield después de `done` | multiYield | detectada (1) |
| Yield ante una respuesta ambigua (antes de confirmar) | multiYield | detectada (3) |
| El jugador nunca se libera con la base caída | multiYield | detectada (1) |
| El resync ignora el stock del parcial | multiYield | detectada (4) |
| Duplicado sin el original (el código previo a M-3), en el adaptador | Vitest | detectada (2) |
| Lo mismo en el bundle generado | integración | detectada (1) |

Una mutación sobrevivió en la primera pasada: `#timer` ignorando el flag `syncing`. La guarda era redundante, porque la versión del registro ya invalida los timers viejos y un nodo retenido no programa timers. Se eliminó en lugar de dejar código sin probar.

## 8. Benchmark

`scripts/benchmark-world.mjs` se amplió sólo en el script (commit `0ee1e6a`, sin cambios productivos). La nueva sección `units` trae:

- unidades emitidas y liquidadas;
- commits intentados, confirmados, reintentados y fallidos;
- commits por unidad;
- duplicados, `stale_node`, commits ambiguos y resyncs;
- secuencias en error;
- p50, p95 y p99.

El event loop y la memoria ya estaban en la salida.

**Condiciones:** `node scripts/benchmark-world.mjs --players N --duration 60 --skills real`, Node 24.21.0 (zip oficial en una carpeta temporal, por ruta absoluta), SKILLS real sobre PGlite en memoria, 129 nodos objetivo en Pradera. Las tres corridas se hicieron después de pasar los gates funcionales.

| Jugadores | Pedidos | Secuencias | Unidades (clientes / servidor) | Commits intentados / confirmados | Commits por unidad | Reintentos / fallidos | Duplicados | `stale_node` | Ambiguos / resyncs | Secuencias en error | accepted→done p50 / p95 / p99 | request→reply p50 / p95 / p99 | commitWork p95 | Event loop p50 / p99 / máx | RSS / heap | Mundo KiB/s/cliente |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 76 | 8 | 22 / 22 | 22 / 22 | 1,00 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 7,26 / 13,86 / 13,86 s | 0,43 / 2,6 / 6,6 ms | 3,3 ms | 31,2 / 34,1 / 1 353 ms | 316 / 29 MB | 0,24 |
| 30 | 279 | 55 | 150 / 150 | 150 / 150 | 1,00 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 8,45 / 19,24 / 22,86 s | 1,19 / 4,1 / 8,5 ms | 4,6 ms | 31,3 / 35,9 / 1 348 ms | 320 / 28 MB | 1,07 |
| 100 | 20 761 | 101 | 265 / 265 | 265 / 265 | 1,00 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 9,01 / 15,05 / 19,24 s | 1,78 / 5,4 / 9,9 ms | 6,2 ms | 30,7 / 41,4 / 1 404 ms | 321 / 31 MB | 1,90 |

- **Errores: ninguno.** 0 fallos de PlayerData, 0 reintentos, 0 commits fallidos y 0 resyncs. Cada unidad liquidada en el servidor llegó a su dueño como un solo yield.
- **accepted→done** ahora mide una secuencia entera (2–4 unidades más sus commits), no una acción de una unidad. Por eso es más largo que en PROB-2 (2,5–3,6 s).
- **El máximo del event loop (~1,35 s)** es el arranque de PGlite (`loadNodes` 1,7–1,8 s), como en PROB-2. El p99 queda entre 34 y 41 ms.
- **Los rechazos de 100 jugadores** (14 202 `rate-limited`, 4 356 `too-far`, 1 822 `no-room`) son los bots, que reintentan a 7,5 Hz después de que el servidor los aparta. Es el mismo patrón que se verificó con un A/B en `SKILLS_PROB_2_REPORT.md` §10. Las secuencias (101) están topadas por la oferta de nodos: se agotaron 101 y el respawn de 90 s no llega dentro de la corrida.
- **El camino de recuperación no se ejerce bajo carga local**: PGlite no pierde respuestas. Su costo en producción es una lectura `load_nodes` compartida por evento de error.

## 9. Gates

Todo se corrió con Node 24.21.0 por ruta absoluta. Las dependencias del worktree se instalaron con `npm ci` local; no se instaló nada global. Los tests skipped no se cuentan como aprobados.

| Gate | Resultado |
|---|---|
| Tests focalizados (`multiYield.test.js`) | 32 / 32 |
| Mutation checks | 16 / 16 detectadas, archivos restaurados |
| Realtime completo | **258 tests: 237 pass, 0 fail, 21 skipped.** Los 21 son el gate de staging RC-0.3 y necesitan Supabase local |
| Integración PGlite (`integration`, `database`, `multiYield.database`) | 33 / 33, 0 skipped |
| Vitest completo | 186 archivos, 1 835 / 1 835 |
| Typecheck (`vue-tsc`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores y 9 warnings `vue/attributes-order` preexistentes en `AuthModal.vue`, que no se tocó |
| Build (`vite build`) | exit 0 |
| Drift de SKILLS (`bundle-skills.mjs --check`) | exit 0: bundle regenerado en `5d913d9` |
| Pacing (`npm run skills:pacing`) | exit 0, sin cambios de balance |

**Pendientes** (no hay infraestructura en esta PC y no se instaló nada):

1. **Deno:** la suite de la Edge Function `world-authority`. `handler.ts` no cambió.
2. **Docker / Supabase local:** los 21 tests de staging RC-0.3 (`staging.test.js`).
3. **Staging hosted:** no se tocó nada hosted ni la producción 0.2.
4. **Latencia hosted real** del camino de resync: la lectura `load_nodes` completa por evento de error.

## 10. Diff

Cadena desde `a2003b6`:

| Commit | Qué |
|---|---|
| `5d913d9` | fix(skills): el duplicado devuelve el original guardado (M-3), con el bundle regenerado |
| `dabb603` | fix(world): resync desde la base después de un commit ambiguo o stale (I-1, M-1, M-5) |
| `2ea684c` | test(world): recuperación sobre el SQL y el adaptador reales |
| `a07989e` | docs(design): `coal_seam` en `[1,1]` a propósito (M-2) |
| `0ee1e6a` | tools(benchmark): contadores multi-yield y p99 |
| (este) | docs(skills): este informe |

**Productivo:**

- `resourceAuthority.js` (~250 líneas cambiadas): `#settleOnce`, `#confirmUnit`, `#beginResync`, `#resyncStep`, `#loadPersisted`, `#resolveSync`, `#releaseHeld`, `#persistedState`, `#restingFromMemory` y `#reportDone`, más las constantes `RESYNC_DELAYS_MS` y `RESYNC_HOLD_STEPS`.
- `resourceStore.js`: flag privado `syncing`.
- `worldRoom.js`: cableado de `loadNodes`.
- `skillsWorldPolicy.ts`: `canonicalSummary` y `summaryOf`.
- `skills.generated.js`: bundle regenerado.

**Sin cambios:** SQL, migraciones, `handler.ts`, `playerData.js`, el protocolo del cliente, balance y stock.

# WORLD-1 — Shared World Authority

> Rama `world/1-shared-authority`, desde `playtest-0.2` = `dc6dc70` (verificado con `git fetch`: tag, `origin/playtest/community-0.1` y HEAD coincidían; no había hotfix posterior).
> Worktree propio (`../pokeswap-world1`), separado del checkout principal y de la estación de SKILLS.
> **Sin deploy, sin merge, sin PR.** Rama pusheada para revisión.
> **Revisión 1 (2026-09-25):** validar antes de reservar, fail closed de salvajes, settlement de SKILLS en espera, persistencia como deuda WORLD-1.1 (§19).

Criterio de éxito: *dos jugadores en el mismo lugar están realmente en el mismo mundo.* Qué quedó cubierto, qué no y por qué, está en §15–§16.

---

## 1. Resumen

| Qué | Antes (0.2) | Ahora (WORLD-1) |
|---|---|---|
| Identidad de un árbol/roca | determinista, pero dependía del catálogo de Skills | determinista y **de WORLD**: `area:tx:ty:variant`, el servidor la re-deriva para validarla |
| Estado del recurso | demo local por navegador, "cargas personales" | **servidor**: disponible → trabajando → agotado → respawn, igual para todos |
| Ver a otro trabajar | imposible | nodo `working` con jugador, Pokémon, verbo e `startedAt/endsAt`; el Pokémon aparece junto al nodo en todos los clientes |
| Pokémon salvajes | pool y especie tirados con `Math.random` en cada navegador | pool de la hora tirado **una vez en el servidor**; cada Pokémon (único) tiene un hogar fijo |
| Wanderers, NPC de Pradera, plaza | pasos aleatorios por cliente | **patrullas compartidas** muestreadas con el reloj del servidor: mismo tile, mismo instante, 0 bytes por paso |
| Colisión con NPC | local y contradictoria entre clientes | los que se mueven no bloquean; los estacionarios siguen sólidos (idéntico en todos) |
| Hora del día / clima | por sesión | reloj del servidor |
| Performance | baseline | PERF-2 y TRANS-1 **idénticos**; costo de mundo medido en §14 |

Tests: realtime 69 → 109 (+40); vitest 188/2002 → 194/2021; typecheck OK; lint 0 errores / 9 warnings (los mismos); build OK.

## 2. Auditoría BEFORE

En `docs/world/WORLD_1A_AUDIT.md` (commit `6c49ab5`). Resumen de hallazgos que cambian el diseño:

- El servidor no conocía el terreno: no podía validar que un árbol existe.
- La identidad de nodo dependía del catálogo de Skills (`definitionId` en el id).
- El agotamiento vigente era **por jugador** ("cargas personales"): contradice "si se agota, se agota para todos". Cambio de producto explícito de este pedido.
- La lista previa era correcta, con agregados: el pool salvaje además dependía del **orden de carga de chunks**, las casas de la plaza del **orden de llegada**, y hora/clima/cristales eran por sesión.

## 3. Arquitectura final

```
services/realtime/src/world/          (JS sin dependencias; el navegador importa los marcados ◆)
  terrain.js ◆            generador procedural (movido desde world.ts/noise.ts, huella congelada)
  areas.js ◆              áreas del mundo, chunk de 16 casillas
  resourceLayout.js ◆     layout determinista de nodos, ids estables, respawn por tipo
  resourceLifecycle.js    máquinas de estado por tipo (tabla)
  resourceStore.js        estado mutable disperso + revisión monotónica
  dueQueue.js             min-heap de completions y respawns
  skillPolicy.js          contrato WORLD↔SKILLS + policy "unavailable"
  demoSkillPolicy.js      policy fake (tests / local, nunca producción)
  pokemonOwnership.js     verificación read-only de `slots` con el token del jugador
  resourceAuthority.js    reservas, validación física, completion idempotente, cancelación
  worldInterest.js        AOI por chunks con histéresis
  worldProtocol.js ◆      mensajes, validación de intents, proyección pública
  worldRoom.js            transporte sobre el socket y el tick de PresenceRoom
  wildPopulation.js ◆     pool salvaje, tiles de spawn, roster de la hora
  wildService.js          roster por época, catálogo (Supabase / sintético)
  patrol.js ◆             patrullas deterministas + muestreo por tiempo
  worldConfig.js          elige adaptadores según entorno

src/features/world/                   (cliente)
  api/worldTransport.ts   puerto del socket
  domain/worldClock.ts    reloj del servidor
  domain/worldResources.ts espejo del estado (sólo lo que el servidor dijo)
  render/*                overlay (tocón/escombro, sacudida, progreso), Pokémon trabajador
  state/sharedWorld.ts    sink del socket + capa del motor + API de intents para SKILLS

src/features/wildlands/engine/
  worldLayer.ts           puerto del motor (actores extra, companions ocultos, reloj, roster)
  patrolMotion.ts         pose de una patrulla en el tiempo del servidor
  game.ts                 +45 líneas de enganche, sin lógica de mundo
```

**Decisión de ubicación.** El servicio es JS sin build y su Docker sólo copia `services/realtime/src`; no puede importar TS de `src/`. R32.4 dejó su núcleo en TS difiriendo la decisión de bundler, pero WORLD-1 necesita que el servidor *corra*. Se siguió el precedente de `protocol/arrival.js`: módulos JS sin dependencias dentro del servicio, con `.d.ts`, que Vite empaqueta en el cliente. **Una sola implementación** del generador, del layout, del pool y de las patrullas; nada duplicado.

## 4. Autoridad y flujo de datos

```
Cliente A                    Servidor (PresenceRoom + WorldRoom)                 Cliente B
─────────                    ───────────────────────────────────                 ─────────
move(dir) ───────────────►  actor.tx/ty (token bucket, igual que 0.2)
world:work{node,pkmn,req} ► workIntent() valida forma (sin campos de resultado)
                            ResourceAuthority.requestWork
                              ── validar (nada queda tomado) ──
                              1 físico: nodo existe (re-derivado), misma área,
                                adyacente, estado permite, 1 acción por jugador
                                y por Pokémon, 1 intento en vuelo por jugador
                              2 await ownership (slots, token de A)
                              3 await SKILLS.authorizeWorkAttempt(actionId,…)
                              ── adquirir (síncrono, sin await en el medio) ──
                              4 re-chequeo físico con el actor vivo y el nodo
                              5 nodo + jugador + Pokémon tomados; store: working
                                {worker, actionId, startedAt, endsAt}
                                (si otro llegó antes → busy y SKILLS.cancelWork)
                              6 dueQueue.push(endsAt, complete)
world:work:result ◄──────── (sólo a A)
                            flush 50 ms ─── world:batch {nodes:[working…]} ─────► ve el árbol trabajando,
                                                                                   el Pokémon, el verbo y el progreso
                            tick: complete(actionId)
                              running → settling (antes del primer await)
                              SKILLS.settleWork(actionId) (reintentos con el mismo id)
                              ok → depleted + respawnAt → dueQueue
                              falla → vuelve a su estado (nada se consume sin liquidar)
world:work:done ◄────────── (sólo a A; summary privado)
                            world:batch {depleted} ─────────────────────────────► tocón
                            tick: respawn → base ── world:batch {base:true} ────► árbol (misma versión para todos)
```

Salvajes y wanderers: el servidor decide **quién** (roster de la hora) y **cuándo** (su reloj, en cada mensaje de mundo); el **dónde** es una función pura compartida (patrulla sobre terreno compartido). Ningún cliente puede cambiar lo que ve otro.

## 5. Contrato WORLD ↔ SKILLS

Definido en `services/realtime/src/world/skillPolicy.js` (el comentario del archivo es el contrato completo):

```ts
authorizeWorkAttempt({ actionId, playerId, pokemon: { instanceId, speciesId },
  node: { id, resourceKind, variantId, areaId, tx, ty, zone, biome }, workKind, requestedAt })
  → { ok: true, durationMs } | { ok: false, reason }

settleWork({ actionId, playerId, pokemon, node, workKind, startedAt, endsAt, completedAt })
  → { ok: true, status: 'applied' | 'duplicate', summary? } | { ok: false, retryable, reason }
  // DEBE ser idempotente por actionId: WORLD puede reintentar.

cancelWork?({ actionId, playerId, reason })   // opcional, informativo
```

- WORLD **nunca** lee nivel, aptitud, especie, XP ni drops. No hay `if (skillLevel …)` ni `if (species …)` en `src/world/`.
- WORLD garantiza: una reserva por nodo, a lo sumo una completion por acción, ownership verificada antes de preguntarle nada a SKILLS, ninguna depleción sin liquidación confirmada, duración acotada a [0,5 s; 5 min].
- SKILLS garantiza: `settleWork` idempotente por `actionId` (recomendado: tabla con `action_id` como PK y la liquidación en la misma transacción, AGENTS §10).
- `summary` sólo viaja al jugador que trabajó (`world:work:done`), nunca en el estado público.
- Producción usa `unavailableSkillPolicy` (rechaza todo) hasta que SKILLS entregue su adaptador: **ningún camino de recompensa fake existe en producción.**
- **Estado del settlement: en espera de decisión.** WORLD-1 no resuelve XP/drops ni agrega service-role ni ningún credencial nuevo. El puerto está listo; *cómo* liquida SKILLS del lado servidor (qué operación, con qué credencial, en qué transacción) se decide después de revisar la rama de SKILLS (OQ-3). Lo que el puerto exige de esa implementación: idempotencia por `actionId`, liquidación server-only y atómica con la escritura de XP/drops, y `retryable` sólo cuando reintentar con el mismo `actionId` es seguro.

## 6. ResourceNode: schema y estados

Base (derivada, nunca almacenada): `id, resourceKind (tree|rock), variantId (tree|pine|snowpine|palm|rock|boulder|icerock), areaId, chunkId, tx, ty, zone, biome`.

Mutable (sólo mientras no está en su estado base): `state, worker {playerId, pokemonInstanceId, speciesId}, actionId, workKind (chop|mine), workedFrom, actionStartedAt, actionEndsAt, respawnAt, version`.

En el cable (`publicNode`): `id, state, version, base?, actionId?, workKind?, worker?, startedAt?, endsAt?, respawnAt?` (tipo/variante/tile salen del id).

Ciclos de vida como **datos** (`resourceLifecycle.js`): `{ initial, work: {desde → después de completar}, timed: {estado → siguiente} }`; `working` es común. Árboles/rocas: `available → working → depleted → available`. Una parcela de agricultura (`empty → planted → growing → ready → empty`) entra con la misma forma sin tocar la autoridad (probado en `resourceLifecycle.test.js`, no colocada en el mundo).

## 7. Estrategia de IDs

`${areaId}:${tx}:${ty}:${variantId}` — p. ej. `pradera:-6:-64:tree`.

- Derivado de seed (implícita en el área) + área + tile + variante, con el mismo hash/densidad/sal que usaba la demo R31, así los mismos árboles siguen siendo trabajables.
- El cliente nunca "crea" un id: si el servidor recibe uno, re-calcula el nodo en ese tile y exige coincidencia exacta (variante incluida). Ids falsificados → `unknown-node`.
- Cero filas estáticas: un mundo infinito no ocupa almacenamiento; el estado mutable es disperso.
- Un cambio de generador cambiaría ids: por eso la huella congelada (`worldFingerprint.test.ts`, 262 k tiles) y el test de servidor que ata el spawn al contrato de llegada.

## 8. Persistencia

| Estado | Dónde | ¿Sobrevive…? |
|---|---|---|
| Layout de nodos, roster salvaje de la hora, patrullas | derivado | todo (se recalcula igual) |
| Nodo trabajando / agotado, acciones en curso | memoria del proceso | restart del room: sí (estado de módulo, como la presencia) · reconexión: sí · área vacía: sí · **reinicio del proceso: no** |
| Liquidación (XP/drops) | SKILLS (DB) | todo; idempotente por `actionId` (UUID, nunca se reutiliza tras un reinicio) |

Decisión: **no persistir en WORLD-1**. Un reinicio sólo adelanta respawns de 90 s y corta acciones de segundos *sin liquidarlas* (nada se otorga ni se consume). Cero escrituras a DB por frame o por acción desde WORLD.

**Deuda explícita — WORLD-1.1 / integración:** persistir los nodos no-base (estado + `respawnAt`/timers) para sobrevivir reinicios del proceso. Es necesaria antes de cualquier estado de larga duración (cultivos de horas) y se revisa al integrar SKILLS. El lugar es un adaptador detrás de `ResourceStore`; no se amplió el scope ahora.

Timers: una min-heap (`dueQueue.js`) drenada por el tick existente de 50 ms; ningún `setTimeout` por nodo. Las entradas viejas son no-ops porque cada handler re-chequea versión/actionId.

## 9. AOI

- Chunks de 16 casillas; al moverse, el cliente se suscribe a los chunks dentro de 24 casillas y los suelta pasadas 32 (histéresis, como PERF-2.4). Sólo cambia al cruzar una banda de chunk, no en cada paso.
- Entrar a un chunk = su estado no-base completo en ese mismo batch (`enter`). Salir = `leave`, el cliente suelta todo lo del chunk. Volver = la verdad del servidor otra vez, nunca un estado local.
- El layout **no se transmite**: lo que no está en el espejo de un chunk conocido está en su estado base.
- Índice suscriptores-por-chunk: un cambio de nodo cuesta O(espectadores de ese chunk).
- Salvajes: el roster (≤25 entradas, ~2 KB) viaja en el snapshot de Pradera y una vez por hora; el cliente materializa sólo los que están a ≤64 casillas y los suelta a >96.

## 10. Pruebas de concurrencia y aceptación

Servidor (`node --test`): `resourceAuthority.test.js`, `worldRoom.test.js`, `PresenceRoomWorld.test.js`, `resourceLifecycle.test.js`, `wildPopulation.test.js`, `terrain.test.js`. Cliente (vitest): `sharedWorld.acceptance.test.ts` (dos `SharedWorld` reales contra el `WorldRoom` real), `worldResources.test.ts`, `workerActors.test.ts`, `patrolMotion.test.ts`, `plazaPokemon.test.ts`, `worldFingerprint.test.ts`.

| Aceptación pedida | Test |
|---|---|
| Dos clientes → mismos resource ids | `both clients derive the same node ids…`; `two viewers beside the same tree…` |
| A tala → B ve WORKING | `A chops, B sees the tree working…` (cliente) · `A works a tree, B sees it working…` (servidor) |
| B intenta el mismo → rechazo | mismos tests (`busy`) |
| **A y B casi simultáneos → una sola reserva** | `A and B race for the same tree: exactly one reservation…` (ambos intents en vuelo antes de cualquier await) |
| A termina → B ve DEPLETED | ídem |
| Nuevo cliente → DEPLETED | `a newcomer sees the depleted node…` |
| Respawn → todos AVAILABLE a la vez | mismo test: mismo flush, **misma versión** para los tres |
| Salir/volver de AOI → mismo estado | `leaving and re-entering the chunk window…` |
| Reconectar → mismo estado | `a reconnecting worker gets its running action…` (servidor y cliente) |
| Dos callbacks de completion → una liquidación | `completion depletes once, settles once…` (+ la entrada de la cola, 3 intentos → 1 grant) |
| Nodo lejano → rechazo | `too-far` |
| Pokémon ajeno → rechazo | `not-owner`, y SKILLS nunca es consultado |
| (rev. 1) un request inválido en vuelo no bloquea a un jugador legítimo | `a request with someone else’s Pokémon, still in flight, never makes the node busy…` (ownership demorada: A adquiere mientras la de B sigue pendiente) · `an attempt SKILLS is about to refuse never makes the node busy either` |
| (rev. 1) perdedor de la carrera, ya autorizado | recibe `busy`; SKILLS recibe `cancelWork` (`authorizedNotStarted`) |
| (rev. 1) un intento en vuelo por jugador | `in-flight`, sin lectura de ownership extra |
| (rev. 1) catálogo ilegible → sin salvajes, con diagnóstico | `no roster, no wild Pokémon: an unreadable catalog fails closed and says why, once` · `wild population never falls back to a local roll` · `an unavailable status clears the roster…` |
| (extra) request id repetido | `duplicate-request`, sin segunda reserva |
| (extra) liquidación que falla | el nodo no se agota; reintento transitorio → 1 grant con el mismo `actionId` |
| (extra) duración de SKILLS | acotada (10 ms → 500 ms) |
| (extra) payload con `reward/state/durationMs` | ignorado: no existen esos campos |
| (extra) alejarse cancela | nodo vuelve disponible para todos, `cancelWork` notificado |
| (extra) salvajes/patrullas | mismo roster para todos, rotación simultánea, misma pose a la misma hora del servidor, plaza independiente del orden |

## 11. Recursos compartidos funcionando

Servidor completo y probado; cliente recibe y dibuja: tocón/escombro para nodos agotados (para todos, primero en el overlay compuesto), sacudida sincronizada y anillo de progreso para nodos trabajados, etiqueta "Talando/Minando".

**Frontera con SKILLS:** la acción *propia* del jugador desde la UI (tocar un árbol → `sharedWorld.requestWork(nodeId, pokemonInstanceId)`) no se conectó a la UI de profesiones, porque esos archivos (`src/features/professions/**`) son de la estación de SKILLS y van a ser reemplazados. La API está lista (§17). Hasta entonces, en el playtest la demo local de profesiones sigue funcionando igual que en 0.2 para quien la usa, y encima de ella se ve el mundo compartido.

## 12. Acciones jugador + Pokémon visibles

Estado publicado por nodo: jugador (`playerId`, su nombre ya viaja en presencia), Pokémon (`pokemonInstanceId`, `speciesId`), verbo (`workKind`), `startedAt`, `endsAt`. Nada por frame. Cada cliente deriva el mismo lugar para el Pokémon (lado abierto del nodo más cercano a su entrenador), lo anima con el reloj del servidor y oculta al companion seguidor de ese entrenador mientras trabaja (no se ven dos copias).

## 13. Wild Pokémon / NPC compartidos

| Entidad | Estado |
|---|---|
| Salvajes (Pradera) | **Compartidos.** Roster por hora del servidor (misma regla de rareza que antes, sin dueño), un hogar por Pokémon entre los tiles de spawn históricos más cercanos al spawn; patrulla compartida. Ficha informativa igual que antes. |
| NPC entrenadores de Pradera | **Compartidos** (identidad ya determinista + patrulla). |
| Wanderers de Ciudad | **Compartidos** (patrulla). |
| Pokémon de plaza | Posición **compartida** (patrulla + casas en función de la lista, no del orden de llegada). La lista top-10 sigue calculándose en cada cliente desde `slots` (converge: es estado de DB). |
| Residentes | Sin cambios (ya eran deterministas y estacionarios). |
| Hora del día / clima | **Compartidos** (reloj del servidor). La tecla de saltar hora sigue siendo local. |
| Cristales recogibles | **No compartido** (pickup local "demo, no se guarda"); ver §16. |

Colisión: los actores con patrulla **no bloquean** al jugador ni a la ruta del navegador; así ningún jugador puede frenarse contra algo que otro no ve en el mismo lugar, y B nunca ve pausas "sin razón" de A. Los residentes estacionarios siguen siendo sólidos (idénticos en todos los clientes). Hablar con un NPC que camina ya no lo detiene (el giro local fue la única interacción con su posición).

Cambios de comportamiento intencionales (documentados): el pool ya no "sigue" al jugador por el mapa — cada salvaje vive cerca de su casa, concentrados en torno al spawn de Pradera (radio de 3 chunks de 32); explorando lejos se ven menos. Es consecuencia directa de que un Pokémon es único.

**Fail closed (rev. 1).** No existe fallback a una población tirada en el navegador: se eliminaron la población salvaje local de `population.ts`, el roll local de `usePlazaData.ts` y el wrapper `rollWildPool` del cliente (la regla vive y se prueba sólo en el servidor). Sin roster del servidor — servidor viejo, catálogo ilegible o todavía cargando — un área **no tiene Pokémon salvajes**. El diagnóstico es explícito: `wildStatus: 'loading' | 'ready' | 'unavailable'` en el snapshot de Pradera y `world:wild { wild: null, status: 'unavailable' }` en vivo; el servidor deja una línea de log por racha de fallas (sólo el código de estado) y la cuenta en `/metrics` (`world.wild.failures`, `lastFailure`). Una rotación que falla conserva el roster de la hora anterior: viejo, pero igual para todos.

**Gaps deliberados del shared world** (registrados, no se resuelven en WORLD-1):
- **Cristales locales**: el pickup de cristales sigue siendo por cliente ("demo, no se guarda").
- **Colisión con NPC desactivada**: los actores con patrulla no bloquean ni al jugador ni al navegador (sólo los residentes estacionarios son sólidos). Así nunca hay geometría dinámica contradictoria entre clientes, a cambio de que se atraviesen.
- (nota) Antes del primer mensaje de mundo — sin reloj del servidor — los NPC entrenadores y los wanderers de Ciudad usan el paseo local hasta que llega el reloj (su identidad es determinista; sólo la posición de esos segundos es local). Los salvajes no: no aparecen hasta que hay roster.

## 14. Métricas vs Playtest 0.2

Todo medido en esta máquina y en la misma sesión, con la baseline corrida de nuevo desde un worktree en `playtest-0.2` (así no se compara contra archivos de otra máquina u otra época). Archivos en `docs/performance/baselines/world-1/`.

### 14.1 Regresión de lo que 0.2 ya resolvía

| Herramienta | Playtest 0.2 | WORLD-1 |
|---|---|---|
| PERF-2 fidelidad remota (`remote-fidelity/run.sh`, escenarios × redes × Hz × semillas) | 0 saltos | **idéntico, fila por fila** (0 diferencias en `compare.mjs`) |
| TRANS-1 transiciones (`transition-trace/run.sh --timeline`) | 146 líneas | **idéntico** (diff vacío) |
| Multitud headless Pradera 10 (A camina, B mira) | A work p95 2,2 ms · B 2,0 ms · heap 17,8 MB · 0 saltos | 2,1 ms · 2,1 ms · 17,0 MB · 0 saltos |
| Multitud headless Pradera 30 | A 2,3 ms · B 2,1 ms · heap 18,0 MB · 0 saltos | 2,3 ms · 2,1 ms · 18,0 MB · 0 saltos |
| Bundle `WildlandsView` | 287,3 KB (96,8 KB gzip) | 302,5 KB (102,0 KB gzip) |

Nota: `perf-2/fidelity-4-stacked-steps.json` ya no se reproduce sobre `playtest-0.2` (TRANS-1 y MOBILE-1 cambiaron el pipeline después): la referencia válida es `world-1/fidelity-playtest-0.2.json`, generada ahora. En los clientes headless del branch el mundo estaba activo (roster sintético, patrullas, SKILLS demo): su costo no se distingue del ruido.

### 14.2 Costo del mundo en el cliente (`scripts/perf/world-client-cost.ts`)

| Trabajo | µs |
|---|---:|
| `followPatrol` × 60 actores (un frame) | 2,4 |
| overlay: 300 props con 20 nodos activos (un frame) | 29,4 |
| overlay: anillos + etiquetas, 20 nodos (un frame) | 11,2 |
| aplicar un batch con 10 nodos | 2,7 |
| construir una patrulla (una vez, al aparecer) | 55,5 |

Peor caso ≈ 45 µs por frame ≈ 0,3 % de 16,7 ms. Con 0 nodos activos el overlay sale en la primera comparación.

### 14.3 Carga con jugadores trabajando (`scripts/benchmark-world.mjs`, 60 s, sockets reales)

Jugadores sintéticos en Pradera que corren hasta nodos (132 a ≤ 60 casillas del spawn), los trabajan (3 s) y siguen; `off` = los mismos caminantes sin declarar el protocolo de mundo.

| Jugadores | KiB/s presencia por cliente (off → on) | KiB/s mundo | msgs mundo/s | acciones simultáneas (máx / media) | completadas | request→reply p95 | nodos guardados (máx) | RSS servidor (off → on) |
|---:|---|---:|---:|---|---:|---:|---:|---|
| 10 | 3,79 → 3,32 | 0,36 | 1,6 | 9 / 2,4 | 46 | 1,4 ms | 49 | 72 → 70 MB |
| 30 | 7,71 → 7,54 | 0,62 | 2,3 | 18 / 6,1 | 119 | 2,2 ms | 122 | 75 → 81 MB |
| 50 | 9,98 → 9,94 | 0,64 | 2,1 | 22 / 6,7 | 130 | 4,1 ms | 130 | 94 → 96 MB |

- Snapshot de mundo: 196 B en Ciudad, ~2,1 KB en Pradera (casi todo es el roster de 25). Batch p50 154–220 B, p95 ≤ 868 B, máx ≤ 2,1 KB (un `enter` con varios nodos).
- La presencia baja un poco con mundo porque los jugadores pasan tiempo trabajando (menos pasos): no hay costo de presencia agregado.
- Demora del event loop del servidor: igual con y sin mundo (histograma de 20 ms de resolución; p99 32–33 ms en ambos).
- Contención dura (primera corrida, sólo 26 nodos): con 50 jugadores, 41 `busy` y 796 `depleted` limpios, 26 reservas, **26 liquidaciones**, 0 dobles.

## 15. Gates

| Gate | Estado |
|---|---|
| vitest | 193 archivos / 2020 tests ✔ (baseline 188/2002) |
| realtime `npm test` | 104/104 ✔ (baseline 69/69) |
| typecheck | ✔ |
| lint | 0 errores, 9 warnings (preexistentes, AuthModal) |
| build | ✔; nada del servidor (`ResourceAuthority`, `WorldRoom`, policy demo, ownership, `node:crypto`) entra al bundle |
| Huella del generador | ✔ (4 ventanas, 262 k tiles, sin cambios) |
| PERF-2 / TRANS-1 / multitud | ✔ idénticos a 0.2 (§14.1) |
| Archivos de SKILLS (`src/features/professions/**`) | 0 modificados |
| Verificación visual (stack local, 2 navegadores + 3 trabajadores sintéticos) | ✔ (§15.1) |
| **Humano**: dos personas reales (PC/iPhone) en Pradera frente al mismo árbol | **pendiente** — gate antes de cualquier deploy |
| **Humano**: confirmar que la clave publishable puede leer `pokemon` y `slots` desde el servicio | **pendiente** — sin eso no hay roster y los clientes quedan en el fallback local |

### 15.1 Verificación visual

Stack local (`local-stack.mjs`, bundles de producción, `WORLD_DEMO_SKILLS=on`, catálogo sintético), dos pestañas como jugadores B y C en Pradera y tres jugadores sintéticos trabajando cerca del spawn:
- B vio a "Carga 1" con la etiqueta **Talando**, su Pokémon junto al árbol y el anillo de progreso;
- al terminar: tocón en `pradera:-6:-64` y escombro en `pradera:-5:-77` (contrastado con el estado del servidor: `depleted`, respawn en 57 s);
- tras el respawn el árbol volvió y otro trabajador empezó a talarlo;
- B y C vieron la misma hora (noche), los mismos nodos agotados y al otro jugador.

En build de producción los internos no son inspeccionables; la paridad fina entre clientes la prueban los tests (§10).

## 16. Riesgos residuales y preguntas abiertas

**Riesgos**

1. **Reinicio del proceso realtime**: borra nodos agotados y corta acciones sin liquidar (nada se otorga ni se consume). Aceptable con respawns de 90 s; no para cultivos de horas. **Deuda WORLD-1.1** (§8).
2. **Token del jugador**: la ownership se verifica con el token guardado al unirse. El token vence (~1 h): un jugador con la misma conexión por más de una hora recibe `not-owner`. Resolver antes del gameplay real de SKILLS (renovar el token por el socket o verificar desde el backend de SKILLS).
3. **Lectura del catálogo** con la clave publishable: si RLS no la permite, no hay roster y Pradera queda **sin salvajes** (fail closed, rev. 1), con log, `/metrics` y `wildStatus: 'unavailable'` en los clientes. Verificar antes del deploy (gate humano).
4. **Ownership dentro de la hora**: un salvaje comprado sigue en el roster hasta la hora siguiente; cada cliente lo oculta al ver su `slots` (converge, no es instantáneo).
5. **Plaza**: la lista top-10 se sigue calculando en cada cliente desde `slots`; converge, pero puede diferir segundos.
6. **Patrullas**: ignoran objetos colocados (banco, horno, entradas) porque cambian entre builds, así que pueden superponerse con uno; atraviesan al jugador (intencional). El reloj compartido difiere ±RTT/2 entre clientes (decenas de ms: menos de medio tile).
7. **Distribución de salvajes**: concentrados en 3 chunks de 32 alrededor del spawn; explorando lejos se ven menos que en 0.2.
8. **Un solo proceso**, como la presencia: sin réplicas ni Redis.
9. **`game.ts` tiene 1 115 líneas** (+45): sigue por encima de la guía; los enganches son mínimos, pero extraer remotos/companions queda como deuda.
10. **Gaps deliberados**: cristales locales y colisión con NPC desactivada (§13).
11. `WORLD_DEMO_SKILLS` sólo se activa con `NODE_ENV !== 'production'`; aun mal configurado, la policy demo sólo cuenta en memoria y no escribe nada en ningún lado.

**Preguntas abiertas (decidir antes de SKILLS-1 en producción)**

- **OQ-1** Respawn: 90 s por tipo, de WORLD y provisional. ¿Tabla por variante/zona? ¿Quién la fija?
- **OQ-2** Cristales y arbustos no son nodos de WORLD (el cristal es un pickup al pisarlo). ¿Minería de cristal? ¿Qué pasa con el pickup?
- **OQ-3** Settlement server-only de XP/drops: **en espera de la decisión del equipo tras revisar la rama de SKILLS.** WORLD-1 no agrega service-role ni credenciales ni elige mecanismo; sólo fija el puerto (§5).
- **OQ-4** Persistencia de nodos: registrada como deuda WORLD-1.1 / integración (§8).

## 17. Integrar la rama de SKILLS

1. **Servidor.** Implementar el adaptador `SkillPolicyPort` (p. ej. `services/realtime/src/world/skillsPolicy.js`): `authorizeWorkAttempt`, `settleWork` (idempotente por `actionId`, en la misma transacción que la XP y los drops) y opcionalmente `cancelWork`. Seleccionarlo en `worldConfig.js` en lugar de `unavailableSkillPolicy`. Sólo después de la decisión de settlement (OQ-3).
2. **Qué recibe SKILLS de WORLD**: `node.resourceKind` (tree|rock), `variantId`, `zone`, `biome`, `workKind` (chop|mine), `pokemon {instanceId, speciesId}` ya verificado y `playerId` autenticado. Con eso decide skill, nivel, aptitud, duración y recompensa. Nuevas reglas no requieren cambiar WORLD.
3. **Cliente.** La UI de SKILLS usa `SharedWorld` (instancia creada en `WildlandsView.vue`):
   - `requestWork(nodeId, pokemonInstanceId) → Promise<WorkResult>`, `cancelWork(actionId)`, `ownAction`, `onWorkDone(listener)` (trae el `summary` privado de SKILLS para el aviso);
   - ids con `resourceAt(areaId, tx, ty)` de `services/realtime/src/world/resourceLayout.js`, el mismo cálculo que el servidor;
   - estado de un nodo: `sharedWorld.resources.node(id)` (null = estado base si `resources.knows(area, tx, ty)`).
4. **Reemplazar en profesiones** (archivos de SKILLS, no tocados acá): la identidad de `domain/nodePlacement.ts` (mete el catálogo en el id) y el agotamiento personal de `domain/nodeDepletion.ts` pasan a ser del mundo; los overlays de profesiones deberían leer el espejo en lugar de `DemoState` para el estado del nodo. El overlay de mundo se compone **primero**: el tocón/escombro compartido gana sobre cualquier dibujo local.
5. **Archivos que ambas ramas pueden tocar**: `WildlandsView.vue` (creación de `SharedWorld`, composición de overlays), `colyseusPresence.ts`, `game.ts`. Sugerencia: integrar WORLD-1 primero y que SKILLS haga merge encima (merge commits, sin reescribir historia compartida).
6. **Tests que le tocan a SKILLS**: doble `settleWork` del mismo `actionId` → una sola otorgación en DB; dos liquidaciones concurrentes; `authorize` negando por nivel o aptitud.

## 18. Commits

```
6c49ab5 docs(world): WORLD-1A audit of the dynamic world; freeze generator fingerprint
0fbfcbc refactor(world): share the procedural generator with the realtime service
a98dce0 feat(world): WORLD-1B resource node foundation in the realtime service
fd0d6cc feat(world): WORLD-1C work actions, SkillPolicyPort and room integration
33919f4 feat(world): client mirror, shared clock and visible work actions
a3b5ea0 feat(world): WORLD-1D shared wild Pokemon, wanderers, plaza and sky
a6f060c fix(world): forget tokens of closed sockets; keep the roster across reconnects; no cross-area workers
0b1df18 docs(world): WORLD-1E regression, metrics and report
(rev. 1) fix(world): validate before acquiring; wild population fails closed
```

No se desplegó nada; no hay merge ni PR. Para cuando se apruebe: el servidor (protocolo 3) puede desplegarse antes que el frontend, y un frontend nuevo contra un servidor viejo se comporta como 0.2 (fallback local).

## 19. Revisión 1

| Pedido | Hecho |
|---|---|
| 1. No reservar antes de validar ownership | `ResourceAuthority.requestWork`: físico → ownership → SKILLS sin tomar nada; después re-chequeo y adquisición síncrona de nodo, jugador y Pokémon. Un intento en vuelo por jugador. El perdedor ya autorizado recibe `busy` y SKILLS `cancelWork`. Tests nuevos que fallaban con el orden anterior. |
| 2. Sin fallback a población local | Eliminadas la población salvaje local, el roll local y el wrapper del cliente. Sin roster: sin salvajes + `wildStatus` + log + métricas. Tests de servidor y cliente. |
| 3. XP/drops y service-role | No se tocaron. Puerto documentado (§5); settlement en espera (OQ-3). |
| 4. Persistencia | Deuda explícita WORLD-1.1 / integración (§8). |
| Gaps deliberados | Cristales locales y colisión NPC desactivada, registrados (§13). |

Gates tras la revisión: vitest 194/2021, realtime 109/109, typecheck OK, lint 0 errores / 9 warnings, build OK. Las mediciones de §14 no se repitieron: el orden de validación sólo cambia el camino de un intento de trabajo (no el de presencia), y en esas capturas la población salvaje ya corría en modo servidor.

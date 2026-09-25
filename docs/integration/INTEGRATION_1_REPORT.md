# INTEGRATION-1 — WORLD × SKILLS

> Rama `integration/world-skills-0.3`, desde `playtest-0.2` = `dc6dc70`, en un worktree propio (`../pokeswap-int1`).
> **Sin deploy, sin merge, sin PR.** La migración y la Edge Function están **preparadas, no aplicadas**. No se cargó ni se usó ningún secreto productivo.
> Reporte **preliminar**: la validación física (PC + iPhone por LAN, §16) queda para vos.

Criterio de éxito: *talar, minar y cultivar en el mundo compartido, con XP y materiales que el servidor decide, guarda una sola vez y recuerda después de un reinicio.*

Etiquetas: **FACT** (medido o probado acá), **INFERENCE** (deducido, sin medir), **OPEN QUESTION** (lo decide producto).

---

## 1. SHAs

| Qué | SHA |
|---|---|
| Base `playtest-0.2` | `dc6dc70` |
| WORLD congelada `world/1-shared-authority` | `90dbb87` |
| SKILLS congelada `skills/1-osrs-rebuild` | `a144d69` |
| Merge de WORLD (primero) | `41e07d3` |
| Merge de SKILLS (segundo) | `1d01697` |
| Dungeon deja de citar niveles de Skills | `71142bd` |
| INT-1B: esquema de settlement + puerto PlayerData | `33a9f66` |
| Edge Function `world-authority` (preparada) | `72824a1` |
| INT-1A/1B: adapter, mundo persistido, parcelas | `60834c7` |
| INT-1C/1D/1E: UI de Skills sobre el mundo compartido | `f5fa15c` |
| Fixes de la prueba en navegador | `4c4f116`, `e417a6a`, `d969a09` |
| Métricas, benchmarks y este reporte | commit final de la rama |

La historia de las dos ramas quedó entera, con merge commits (sin rebase ni squash).

## 2. Conflictos

**FACT: no hubo conflictos textuales.** `WildlandsView.vue` lo tocaban las dos ramas y git lo auto-mergeó. Después del merge, typecheck, tests y build daban verde.

Los conflictos fueron **conceptuales**. Ninguno obligó a elegir features:

| Tema | WORLD decía | SKILLS decía | Resolución |
|---|---|---|---|
| Quién es un árbol | id de WORLD `area:tx:ty:variant` | recursos de catálogo con pistas de mundo | WORLD manda la identidad; `skillsResourceFor(node)` elige el recurso de SKILLS de forma determinista (hash de posición, salt `31_031+1`, ring = min(2, zona)). Una sola función, usada igual por el cliente y el servidor. |
| Cargas | un nodo se agota con **una** acción completada | pistas de 3–5 cargas | Queda WORLD: se agota con una y respawnea a los 90 s. Las cargas de SKILLS no se usan (§17). |
| Quién dibuja la recolección | overlay de WORLD para todos | escena local de SKILLS | La tuya la dibuja SKILLS (resultado, XP); la de los demás y toda la agricultura, WORLD. |
| Sesión de Skills | — | sesión local + `localWorld` | Se retiraron las dos. La única sesión es `createWorldSkillsSession`, que habla con el servidor. |
| Dungeon "Cristal = Minería 45" | — | texto sin regla que lo imponga | Se sacó el texto de la UI. El dato de dominio sigue. Test de guarda: `dungeonSkillQuotes.test.ts`. |
| Profesiones R31 | — | retiradas por SKILLS-1 | Se acepta el retiro. Auditoría de tests en §11. |

## 3. Arquitectura

```
navegador (Vue)                          realtime (Colyseus, JS)                         Supabase (preparado)
───────────────                          ───────────────────────                         ────────────────────
SkillsWorldLayer (gated, lazy)           WorldRoom ── ResourceAuthority (WORLD)
  createWorldSkillsSession  ─ world:work ─►   │  valida nodo, posición, estado físico,
  FarmCard / WorkCard                          │  Pokémon propio (ownership port)
  PlotOverlay                                  │  decide el próximo estado físico
      ▲                                        ▼
      │ player:state / world:batch       SkillsWorldPolicy (SKILLS, bundle esbuild)
      └────────────────────────────────  │  reglas de nivel, aptitud, cultivo, XP, drop
                                         │  (única fuente: src/features/skills/domain)
                                         ▼
                                   PlayerDataAuthority (puerto)
                                     ├─ Edge adapter ── HTTPS + secreto ──►  world-authority (Edge Function)
                                     │                                         └─ service_role ─► world_commit_work()…
                                     ├─ SQL adapter (tests)
                                     └─ dev adapter (PGlite + migración real, solo local)
```

Límites que pediste, y cómo quedaron:

- **WORLD no tiene chequeos de nivel.** Solo pregunta `authorizeWorkAttempt` y obedece. Test: `skillPolicy.test.js` y el isolation de `resourceAuthority`.
- **SKILLS no toca el estado de los nodos.** WORLD calcula el estado siguiente *antes* del settlement (`#nextState`) y se lo pasa como `settlement.world`. SKILLS lo reenvía al commit sin leerlo.
- **Una sola copia de las reglas.** El dominio TS de SKILLS se bundlea con esbuild a `services/realtime/src/world/skills/skills.generated.js` (`scripts/integration/bundle-skills.mjs`). Un test de vitest (`serverBundle.test.ts`) falla si el bundle quedó viejo.
- **Build gate.** El código de Skills solo entra al bundle a través de `SkillsWorldLayer` (lazy, gated). `skillsIsolation.test.ts` ahora también cubre `worldSkills`, y el build normal de producción no lleva Skills.

## 4. Flujo

1. Join: la sala autentica una sola vez (Supabase Auth, o `benchmarkId` en modo benchmark). Envía `player:state {playerId, xp, materials, pokemon}` leído del servidor y le carga la XP a la política (`primePlayer`).
2. El jugador toca un árbol, una roca o una parcela; `WorkCard`/`FarmCard` muestran lo que dirá el servidor (aptitud, nivel, cultivo). Esto es solo UX.
3. `world:work {nodeId, pokemonInstanceId, requestId, cropId?}`. Cualquier otro campo se ignora.
4. WORLD valida en este orden: formato → nodo real (re-derivado del generador) → distancia → estado físico → actor/Pokémon libres → ownership (ids de usuario del servidor) → SKILLS `authorizeWorkAttempt`. **Recién ahí reserva.** Con cualquier "no", no quedó nada reservado.
5. `world:work:result {ok, actionId, startedAt, endsAt, details}`: todos los clientes ven el nodo `working`.
6. En `endsAt`, WORLD calcula el estado siguiente (agotado + respawn, o parcela sembrada/lista/vacía) y llama a `settleWork` **una vez**.
7. SKILLS calcula el pago y lo pone en staging. `commitWork` escribe settlement + XP + materiales + override del nodo **en una transacción**.
8. Si el commit sale bien, WORLD aplica el estado físico, lo difunde y manda `world:work:done` y `player:state`. Si falla, reintenta a 1 s, 3 s y 9 s. Si no hay confirmación, **no cambia nada**: el nodo sigue en pie y no hubo pago.

## 5. Settlement

- `action_id` es PK de `skill_work_settlements`, así que el primer commit gana. El segundo devuelve `applied:false` con el settlement guardado y no escribe nada.
- La XP la calcula el servidor desde el recurso y el nivel. El cliente no manda XP, recompensa, cantidad ni userId; si los manda, se ignoran (test `hostile payloads`).
- Retry después de un timeout: si el commit llegó a la DB pero la respuesta se perdió, el reintento da `applied:false` y **no paga dos veces** (test `exactly once: … a retry after the store timed out`).
- Si el commit falla, SKILLS saca el settlement del staging y el reintento vuelve a calcularlo. Como la transacción es atómica, no quedan escrituras parciales: no hay XP sin material ni recompensa con el nodo todavía en pie (test de `database.test.js`).
- Respawn: 90 s provisorio, centralizado en `worldTuning.js` (`RESPAWN_MS`).

## 6. Esquema de DB

Migración `supabase/migrations/20260926000001_world_skills_authority.sql` (273 líneas). **Solo agrega; no altera tablas ni datos existentes.**

| Tabla | Clave | Contenido |
|---|---|---|
| `player_skill_xp` | (user_id, skill_id) | XP ≥ 0; skill ∈ {woodcutting, mining, farming} |
| `player_materials` | (user_id, material_id) | cantidad ≥ 0; id con regex |
| `skill_work_settlements` | **action_id** | outcome, xp_gained, xp_after, rewards, niveles, nodo, rules_version |
| `world_node_overrides` | node_id | solo lo que difiere del mundo base: agotados con `respawn_at`, parcelas con `plot` |

| Función | Qué hace | Quién la ejecuta |
|---|---|---|
| `world_commit_work(...)` | settlement + XP + materiales + override, en una transacción, idempotente | solo `service_role` |
| `world_player_state(uuid)` | XP, materiales y Pokémon no bloqueados | solo `service_role` |
| `world_owns_pokemon(uuid, int)` | ownership contra `slots` | solo `service_role` |
| `world_load_nodes()` | overrides vigentes, para el arranque | solo `service_role` |

Límites dentro de la función: XP ≤ 100 000 por acción, ≤ 8 recompensas y cantidad de 1 a 100. Son una defensa en profundidad; el tope real lo pone el servidor.

**PostgreSQL:** los tests corren sobre PGlite (Postgres 18 en WASM). **INFERENCE:** el proyecto de Supabase corre 17. La migración no usa nada específico de la 18, pero conviene aplicarla primero en un branch o staging.

## 7. Límite de seguridad

- **Nada de service-role en el cliente.** El service role vive solo dentro de la Edge Function (`Deno.env`).
- **authenticated y anon no pueden escribir XP ni materiales.** `REVOKE ALL` a PUBLIC, anon y authenticated; RLS activado. authenticated solo tiene `SELECT` de sus propias filas (XP, materiales, settlements). Nadie lee `world_node_overrides` directo.
- **Ninguna RPC sensible abierta a anon ni a authenticated.** Las cuatro funciones tienen EXECUTE solo para `service_role`. Probado *con los privilegios default de Supabase en su peor caso* (stubs en `persistence/dev/supabaseStubs.sql`).
- **Edge Function `world-authority`.** Tiene cuatro operaciones fijas, cada una atada a una sola función SQL. Compara el secreto en tiempo constante, rechaza un secreto débil o ausente, valida el commit antes de llegar a la DB y no filtra errores de la DB. Tests Deno: 5/5.
- **Secreto.** `WORLD_AUTHORITY_SECRET` va solo en el entorno de la Edge Function y del proceso realtime. Nunca en `VITE_*`.
- **Fail closed.** En producción, sin `WORLD_AUTHORITY_URL` + `WORLD_AUTHORITY_SECRET` + `SUPABASE_PUBLISHABLE_KEY`, la política es `unavailable`: nadie es dueño de nada y no se puede trabajar. PGlite y el modo demo quedan inaccesibles con `NODE_ENV=production`.

Tests: `database.test.js` ("clients cannot write XP, materials, settlements or world state, nor call the authority functions", "a player reads only their own…"), `edgePath.test.js` (realtime → handler → SQL, y rechazo sin secreto) y `handler.test.ts`.

**Condición previa para producción:** la autoridad de ownership es `public.slots`. Antes de habilitar esto en prod, hay que verificar que las escrituras sobre ownership y economía estén cerradas a los clientes (el endurecimiento de roles de SEC-1). Los detalles no van en este repo público.

## 8. Identidad y ownership

- El `userId` sale **siempre** de la sesión que autenticó la sala al hacer join. El payload no puede nombrarlo (test: `userId in payload`).
- **El problema del token de 1 hora quedó resuelto.** La sala no guarda tokens. Todo lo posterior al join (ownership, estado, commit) va por `PlayerDataAuthority` con el userId, server-to-server. Una sesión de 3 horas sigue trabajando (test `a long session needs no player token`).
- Ownership: `ownsPokemon(userId, instanceId)` con caché positiva de 30 s (`OWNERSHIP_CACHE_MS`). Si vendés un Pokémon, puede seguir trabajando hasta 30 s más; la recompensa va igual al jugador, no al Pokémon.
- Modelo legacy: `slots.pokemon_id` es a la vez la instancia y la especie. La aptitud se calcula con esa especie. Los Pokémon bloqueados (`is_locked`) no cuentan.
- Identidades de benchmark/LAN: `devUserId(benchmarkId)` es un UUID derivado por hash. Solo existe en el adaptador dev. La primera vez se le asigna un roster pequeño: un especialista por skill, un Pokémon malo en todo y uno de early game.
- Recarga de la página: los `requestId` se reinician por conexión (`newConnection`). Antes, el primer pedido tras recargar se rechazaba como duplicado; fix `4c4f116` con test.

## 9. Persistencia de recursos

- Solo se persiste el estado mutable, como overrides dispersos: un nodo en su estado base no ocupa fila. Al respawnear, el override se borra en la misma transacción que el pago que lo generó; un override vencido no se carga.
- Arranque: `WorldRoom.start()` ejecuta `restore(loadNodes())` con reintentos. **Hasta restaurar, la sala no sirve mundo**: los clientes esperan y los pedidos reciben `world-loading`. Fail closed.
- **FACT:** un árbol agotado sigue agotado después de reiniciar el proceso realtime, hasta su instante de respawn (test de integración `a realtime restart keeps a depleted tree depleted…`, y `state survives a database restart` con PGlite en disco).
- **FACT en navegador:** tras recargar la página se mantuvieron la XP y los materiales (Talar 10 / 1 Tronco común; Agricultura 33 / 2 Bayas Aranja).

## 10. Persistencia de agricultura

- Cuatro parcelas fijas y compartidas en Pradera: `pradera:-7..-6:-73..-72:plot`, tipo `town`. Todas están en pasto abierto, fuera de nodos, del pad de retorno y del agua (test).
- Estado de la parcela: `{cropId, ownerId, plantedAt, growingAt, readyAt, tended}`. Todos son **timestamps del servidor**, y la etapa se deriva del reloj; no hay timers que perder.
- Cosecha: solo el que plantó. Un segundo intento de cosecha lo rechaza WORLD por estado (la parcela ya está vacía), y un duplicado del mismo action lo rechaza la DB.
- El tiempo de crecimiento viene de SKILLS (`plot.growMs`, acotado a 5 s–7 d). `WORLD_FARM_TIME_SCALE` lo acorta **solo en el stack local** (se ignora con `NODE_ENV=production`).
- **FACT:** plantar → reiniciar → la parcela aparece lista según el reloj del servidor → la cosecha paga una vez (test de integración `Agricultura: plant → … → restart → … harvest pays once`).
- **FACT en navegador:** Miltank plantó Baya Aranja (+8 XP) y la parcela pasó a lista; "Cosechar con Miltank" dio +25 XP y +2 Bayas Aranja, y la parcela volvió a vacía. Tras recargar: Agricultura 33 y 2 Bayas Aranja.

## 11. Auditoría de tests

| Suite | 0.2 | WORLD `90dbb87` | SKILLS `a144d69` | INTEGRATION-1 |
|---|---|---|---|---|
| vitest (archivos/tests) | 188 / 2002 | 195 / 2023 | — / 1686 | **176 / 1712** |
| realtime (`node --test`) | 69 | 109 | — | **134** |
| Deno (`world-authority`) | — | — | — | **5** |

La caída de vitest respecto de 0.2 viene del retiro de profesiones R31 que hizo SKILLS-1:

- se borraron 31 archivos (347 tests), todos bajo `src/features/professions`;
- los módulos vivos que importaban eran solo fixtures;
- se redujeron CityPanel 12→11, playtestShop 11→8, playtestStart 5→3, wildPool 3→1, loggingArt 11→7 y miningArt 9→6.

Los invariantes de `skills/local` y `skills/localWorld` (también borrados) se portaron a `resourceMapping.test.ts`.

Cobertura de lo que pediste:

| Pedido | Test |
|---|---|
| xp=999999, recompensa arbitraria, userId en el payload | `integration.test.js` › hostile payloads |
| Pokémon ajeno, nodo falso, nodo lejano | `integration.test.js` › refusals |
| anon/authenticated no escriben | `database.test.js` › clients cannot write… |
| Doble llamada, concurrencia, retry tras timeout | `database.test.js` (twice, concurrent), `integration.test.js` › exactly once |
| Carrera por el mismo árbol | `integration.test.js` › A and B race… |
| Reinicio, recarga, reinicio de agricultura, cosechar dos veces | `integration.test.js`, `database.test.js`, `worldRoom.test.js` › reloaded page |
| Sesión larga | `worldRoom.test.js` › a long session needs no player token |
| Pesca eliminada, sin herramientas | `noFishing.test.js` |
| Rutas de tap que no cruzan portales | `navigation.test.ts` › TapNavigator and trip tiles |

Gates finales: vitest 1712 ✓ · realtime 134 ✓ · Deno 5 ✓ · typecheck ✓ · lint 0 errores / 9 warnings (los mismos que 0.2) · build ✓ · drift del bundle de SKILLS ✓.

**Nota CI:** `edgePath.test.js` carga el handler TS con el type-stripping de Node. Acá (Node 24) corre; con un Node sin type-stripping **se saltea** en lugar de fallar. El handler igual queda cubierto por Deno.

## 12. Pesca eliminada

- El servidor conoce exactamente tres skills. `noFishing.test.js` es un test *de comportamiento* sobre el bundle real: `SKILL_IDS` se pierde por tree-shaking, así que en vez de buscar el texto prueba que ningún pedido de pesca se autoriza.
- Tampoco hay herramientas: ningún pedido ni regla lleva `tool`.
- La DB lo refuerza con `CHECK (skill_id IN ('woodcutting','mining','farming'))`.

## 13. Materiales

- Existen: el catálogo de SKILLS define ids, nombres e íconos (`MaterialIcon`).
- Se guardan: `player_materials`, sumados en la misma transacción que la XP.
- Se muestran: la tarjeta de resultado ("+1 Tronco común", "+2 Baya Aranja") y el inventario de la capa de Skills, que viene del `player:state` del servidor.
- El pie del panel de Skills decía "el progreso de esta build no se guarda". Ya no es cierto, así que ahora dice "El servidor guarda tu XP y tus materiales".
- **OPEN QUESTION:** todavía no hay dónde *gastar* materiales (crafteo o mercado). Esto es solo recolección.

## 14. Performance

Todo medido en esta máquina y en la misma sesión. Archivos en `docs/performance/baselines/integration-1/`.

| Herramienta | Playtest 0.2 | INTEGRATION-1 |
|---|---|---|
| PERF-2 fidelidad remota (144 corridas) | referencia `world-1/fidelity-playtest-0.2.json` | **idéntico, corrida por corrida** (144/144 iguales) |
| TRANS-1 transiciones (`--timeline`) | 146 líneas | **idéntico** (el diff solo difiere en finales de línea) |
| Multitud headless Pradera 10: A work / B work / heap B | 3,6 ms / 3,2 ms / 17,6 MB · 0 saltos | 3,1 ms / 2,7 ms / 17,5 MB · 0 saltos |
| Multitud headless Pradera 30 | 3,2 / 2,6 / 17,3 MB · 0 saltos | 3,1 / 2,6 / 17,1 MB · 0 saltos |
| Bundle playtest `WildlandsView` | 344,0 KB (115,3 gzip), con profesiones adentro | 307,2 KB (103,9 gzip) + `SkillsWorldLayer` lazy 99,7 KB (36,9 gzip) |
| Bundle normal `WildlandsView` | 287,3 KB (WORLD-1: 302,5) | 300,3 KB (101,1 gzip), sin Skills |

Nota sobre la multitud: la primera corrida de integración daba +0,8 ms contra los archivos de 0.2 guardados hace dos días. Al repetir 0.2 **en la misma sesión** (desde el checkout principal en `dc6dc70`), 0.2 dio incluso algo más alto. Era deriva de la máquina, no regresión. No hay regresión seria de PERF-2.

Carga del mundo (`scripts/benchmark-world.mjs`, 60 s, WebSockets reales):

| Jugadores | Modo | Presencia KiB/s/cliente | Mundo KiB/s/cliente | msgs mundo/s | Acciones pagadas | Event loop p99 |
|---|---|---|---|---|---|---|
| 10 | WORLD-1 demo | 3,32 | 0,36 | 1,56 | 46 | 32,5 ms |
| 10 | INT-1 demo | 3,32 | 0,35 | 1,57 | 46 | 32,6 ms |
| 30 | WORLD-1 demo | 7,54 | 0,62 | 2,33 | 119 | 32,9 ms |
| 30 | INT-1 demo | 7,54 | 0,61 | 2,27 | 119 | 32,9 ms |
| 50 | WORLD-1 demo | 9,94 | 0,64 | 2,11 | 130 | 33,4 ms |
| 50 | INT-1 demo | 9,96 | 0,63 | 2,11 | 130 | 33,3 ms |
| 10 | INT-1 **real + PGlite** | 3,07 | 0,23 | 1,06 | 17 | 33,3 ms |
| 30 | INT-1 real + PGlite | 12,99* | 0,28 | 1,25 | 17 | 33,4 ms |
| 50 | INT-1 real + PGlite | 24,38* | 0,30 | 1,37 | 17 | 33,8 ms |

- **Demo vs WORLD-1: iguales.** La sala no se encareció con la integración.
- En modo real, el throughput lo limita el mapa y no la DB. En radio 30 hay 17 nodos que un nivel 1 puede trabajar; se agotan por 90 s, y el resto responde `level-too-low`.
- (*) La presencia sube porque, en ese escenario, los 50 bots se amontonan alrededor de esos pocos nodos (AOI más denso). Es un efecto del escenario, no del código.
- El event loop tiene un pico máximo de ~0,9 s una sola vez, en el boot: es PGlite abriendo el WASM y aplicando la migración, antes del primer jugador. En producción no hay PGlite.

## 15. Métricas de DB y ancho de banda

`/metrics` ahora trae `world.playerData`: llamadas, fallos y p50/p95/max por operación. Son solo agregados, sin ids (test `playerDataMetrics.test.js`). En producción, cada llamada es un request a la Edge Function, o sea un round trip a la DB.

| Por acción | Lecturas | Escrituras |
|---|---|---|
| Join | 1 `playerState` | — |
| Pedido de trabajo | 1 `ownsPokemon` (0 con la caché de 30 s caliente) | — |
| Acción completada | — | **1** `commitWork`: una transacción con 1 insert de settlement, 1 upsert de XP, 1 update, N upserts de material (N ≤ 8, hoy 1–2) y 1 upsert/delete de override |
| Arranque del proceso | 1 `loadNodes` | — |

Latencias medidas (PGlite en proceso, sin red):

- `commitWork` p50 2,8–3,4 ms, p95 7–13 ms;
- `ownsPokemon` p50 ~1,8 ms;
- retraso de settlement visto por el cliente (de `endsAt` a `done`): p50 41–44 ms, p95 ≤ 64 ms. En modo demo (sin DB) daba 31–37 ms. La DB suma unos 5–8 ms; el resto es la granularidad del tick.
- **INFERENCE:** con la Edge Function, cada llamada suma un round trip HTTPS de decenas de ms (sin medir: no hay deploy). Como el settlement es asíncrono y el nodo se muestra `working` hasta confirmar, eso se ve como un retraso en la tarjeta de resultado, no como un tirón.

Estrés de settlement (`scripts/integration/settle-stress.mjs`: 50 jugadores × 20 acciones, 50 concurrentes, 20 % duplicadas):

- 1189 commits en 1,41 s (**846/s**, una sola conexión);
- 1000 aplicados, 189 duplicados que no pagaron;
- **0 jugadores con totales incorrectos**.
- La latencia p50 de 58 ms en ese test es cola (50 en espera sobre una conexión); en serie, cada commit cuesta ~1,2 ms.

Ancho de banda:

- `player:state` va en el join y tras cada pago: ~200–400 B.
- `world:work:result` / `done` suman menos de 1 KB por acción.
- Snapshot de mundo en Pradera: p50 1913 B. Batch p95: 500–870 B.
- Mundo por cliente: 0,23–0,63 KiB/s.

## 16. Validación física (PC + iPhone, LAN)

Nada de esto toca producción: realtime en modo benchmark, identidades sintéticas y DB embebida con la migración real.

```bash
node scripts/integration/lan-stack.mjs --reset-db
```

- Buildea el bundle playtest y lo sirve en `:4174`; pide el código de acceso habitual. Con `--dev` sirve Vite en `:5190`, sin gate.
- Realtime en `:2568` y métricas en `http://127.0.0.1:2569/metrics`.
- DB en `node_modules/.cache/integration-1/world-db`: sobrevive reinicios del script. `--reset-db` la vacía.
- `--farm-scale 0.05` (default): Baya Aranja crece en ~5 s. La tarjeta muestra el tiempo de producción; la escala solo acelera el crecimiento real.

URLs (el script imprime la IP detectada; en esta máquina, `192.168.1.6`):

- PC: `http://192.168.1.6:4174/?benchmarkId=pc&area=pradera`
- iPhone: `http://192.168.1.6:4174/?benchmarkId=iphone&area=pradera`

Checklist:

1. En los dos dispositivos, Skills → nivel total 3, con el roster del servidor.
2. PC tala un árbol cercano con su especialista de Talar (Scyther para el primer dispositivo que entra, Pinsir para el segundo). El iPhone ve el nodo `working` con el Pokémon, y después el tocón.
3. Desde el iPhone, intentar el mismo árbol → "ocupado" o "agotado", sin pago.
4. Minar una roca de piedra con el especialista de Minería (Diglett o Dugtrio).
5. Plantar Baya Aranja con el especialista de Agricultura (Miltank o Bellossom). El otro dispositivo ve la parcela; solo el dueño puede cosechar.
6. Cortar el script (Ctrl+C), relanzarlo **sin** `--reset-db`, recargar los dos: el tocón sigue (si no pasaron 90 s), la parcela sigue y la XP y los materiales siguen.
7. Esperar 90 s: el árbol respawnea en los dos.
8. Panel de Skills en el iPhone (MOBILE-1): cabe en pantalla, se cierra y no tapa el HUD.

Verificado por mí en el navegador del escritorio (desktop y 375×812): pasos 1, 2, 5, la persistencia tras recarga y el panel móvil. **No verificados físicamente:** el iPhone real, los dos dispositivos a la vez y Minería por UI (Minería está cubierta por el test de integración sobre una roca real).

## 17. Riesgos

1. **Un solo proceso realtime.** La reserva de nodos y la caché de XP de la política viven en memoria. Dos procesos detrás de un balanceador podrían reservar el mismo nodo. Hoy hay uno. Escalar horizontalmente exige particionar por área o mover la reserva a la DB.
2. **Caché de XP en la política.** Se carga en el join y se actualiza con cada commit. Si la XP cambiara por otro camino (un ajuste manual), la política decidiría niveles con un valor viejo hasta el próximo join. La DB igual suma bien.
3. **`authorizedNotStarted`.** Es el caso en que SKILLS autorizó pero WORLD no pudo arrancar (una carrera). Se cierra sin pago (`cancelWork`) y se cuenta en métricas. Hay que vigilarlo.
4. **Respuesta perdida.** Si el commit se aplicó pero la respuesta se perdió, el reintento da `duplicate`: la DB queda bien, pero esa tarjeta no muestra el detalle de la recompensa (la XP y los materiales se actualizan igual con `player:state`).
5. **Nodos sin recurso SKILLS.** **FACT:** en tundra, `snowpine` e `icerock` no mapean a ningún recurso (radio 60 del spawn: 17 de 132; radio 120: 112 de 494). El jugador los ve y recibe "Esto no se puede trabajar". Cerca del spawn (radio 20) todos mapean. **OPEN QUESTION** de producto: ¿recursos de tundra, o que esos nodos no parezcan trabajables?
6. **Cargas.** WORLD agota con una acción; las pistas de 3–5 cargas de SKILLS no se usan. **OPEN QUESTION** de balance.
7. **Ownership con caché de 30 s** (§8).
8. **PG 18 local vs 17 remoto (INFERENCE):** hay que probar la migración en un branch de Supabase antes de producción.
9. **Prerrequisito de seguridad en producción:** la ownership depende de `slots` (§7).

## 18. Pendiente para 0.3

- [x] Validación física PC + iPhone (§16): aprobada por el usuario (talar y minar 10/10, carrera por nodo, agricultura compartida).
- [x] Migración probada en un Supabase real de staging (local, PG 17.6) — ver §19. Falta un staging *hosted* antes de prod.
- [ ] Crear el secreto y desplegar `world-authority` en staging:
  - `supabase secrets set WORLD_AUTHORITY_SECRET=…`
  - `supabase functions deploy world-authority --no-verify-jwt`
  - configurar el realtime de staging con `WORLD_AUTHORITY_URL`, `WORLD_AUTHORITY_SECRET` y `SUPABASE_PUBLISHABLE_KEY`;
  - medir la latencia real de `commitWork` con `/metrics`.
- [ ] Decidir los OPEN QUESTIONS: tundra (§17.5), cargas (§17.6) y usos de materiales (§13).
- [ ] Deuda de WORLD-1 que sigue: cristales locales y colisión de NPC deshabilitada (sin cambios, como pediste).
- [ ] Decidir si el respawn provisorio de 90 s queda.
- [ ] **Polish (deuda, no implementado):** al talar, minar o cultivar, componer la escena como el combate: recurso → Pokémon trabajador delante → entrenador un tile detrás. Las animaciones de trabajo vienen después.
- [ ] Merge a playtest, release 0.3 y deploy: **no hechos**, a tu decisión.

---

## 19. RC-0.3 Security & Persistence Gate

> Hecho sobre `805ae1b` (verificado: local = remoto, árbol limpio). **Sin cambios de gameplay**, ni en producción, sin deploy y sin secretos productivos.
> A producción solo se hicieron **lecturas del catálogo** (esquema, grants, policies, funciones) y conteos agregados. No se escribió nada.

### 19.1 Entorno de prueba

- **Supabase branch: no disponible.** La org está en plan Free: no tiene branching y ya usa los dos proyectos activos que permite.
- **Por decisión tuya, se usó un stack Supabase local real** (`supabase start`, CLI 2.114): Postgres, PostgREST, GoTrue (Auth), Kong y Edge Runtime reales, con los roles y privilegios default de Supabase.
- **PostgreSQL probado: 17.6** (imagen `17.6.1.158`). **Producción corre 17.6** (`17.6.1.155`), la misma versión mayor y menor. Los tests anteriores con PGlite (PG 18) no dependían de nada propio de PG 18.
- **Espejo de prod:** se reconstruyeron, desde el catálogo de producción, el esquema, RLS, policies, ACLs de tabla y columna, y las funciones que escriben `slots` (`scripts/integration/rc03-staging/`, runbook en su README). Se verificó que las ACLs de `slots`, `profiles` y las funciones del espejo son **idénticas** a las de prod. No se copió ningún dato de producción.
- **Batería:** `services/realtime/src/world/persistence/staging.test.js`, 18 tests con **requests HTTP reales** como `anon`, como usuario con sesión real de Auth y como el servidor realtime a través de la Edge Function. Resultado: **18/18, tres corridas seguidas**. Se niega a correr contra una URL que no sea local.

### 19.2 Estado de `slots` (auditoría)

| Aspecto | Producción (catálogo) |
|---|---|
| RLS | activado |
| Policies | una sola: `slots_read`, `SELECT USING (true)` para todos. **No hay policy de INSERT, UPDATE ni DELETE** |
| Grants de tabla | anon y authenticated tienen el default de Supabase (`arwdDxtm`); RLS los neutraliza para INSERT, UPDATE y DELETE |
| Triggers | ninguno |
| Funciones que escriben `slots` | `claim_slot` y `confirm_payment`: **solo service_role** (SEC-1 vigente). `publish_market_listing`, `cancel_market_listing` y `buy_market_listing`: SECURITY DEFINER, ejecutables por anon y authenticated, y **todas validan con `auth.uid()`** |
| Otros caminos | GraphQL (`pg_graphql`) respeta RLS; PostgREST no expone TRUNCATE |

| ¿Puede…? | anon | authenticated |
|---|---|---|
| INSERT de un slot | **No** (401) | **No** (403) |
| UPDATE de un slot, incluido cambiar `owner_id`, `is_locked` o `pokemon_id` | **No** (0 filas; fila releída sin cambios) | **No** (ídem) |
| DELETE de un slot | **No** (ídem) | **No** (ídem) |
| UPSERT sobre el slot de otro | **No** | **No** |
| Asignarse un slot libre o ajeno vía `claim_slot` o `confirm_payment` | **No** (sin EXECUTE) | **No** (sin EXECUTE) |
| Publicar en el mercado un Pokémon ajeno o libre | **No** | **No** (`not_owner`) |
| Cancelar o comprar la publicación de otro sin pagar | **No** | **No** (`not_seller` / `insufficient_tokens`) |
| Cambiar ownership por GraphQL | **No** | **No** |

**Qué necesita un cliente legítimo sobre `slots`:** leer (lo usan la UI y la lectura del compañero en el join) y, a través de las funciones del mercado, publicar, cancelar o comprar **lo suyo**. Las dos cosas siguen funcionando y tienen test (`legitimate client`, `market functions`). No se rompió nada.

**Endurecimiento recomendado, sin aplicar porque son cambios en prod:**
- revocar a anon y authenticated los grants de tabla que no usan (INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES) en `slots` y tablas afines. Hoy están neutralizados por RLS o porque la API no los expone;
- en las funciones del mercado, rechazar explícitamente la llamada sin sesión. Hoy el caso sin sesión termina en error, pero por un constraint y no por un chequeo explícito.

Ninguna de las dos es explotable según estas pruebas.

### 19.3 Permisos sobre las tablas y funciones nuevas

| Rol | `player_skill_xp` / `player_materials` / `skill_work_settlements` | `world_node_overrides` | `world_*()` (4 funciones) |
|---|---|---|---|
| anon | nada: ni leer ni escribir (401) | nada | sin EXECUTE (401) |
| authenticated | **solo SELECT de sus propias filas** (RLS) | nada | sin EXECUTE (403) |
| service_role (solo dentro de la Edge Function) | lectura y escritura | lectura y escritura | EXECUTE |

Probado con requests reales: insertar XP 999999, subir materiales, crear o modificar settlements (incluido cambiar `action_id` u `outcome`), cambiar `state` o `respawn_at` de un nodo, borrar filas propias o ajenas y llamar a `world_commit_work` directamente. **Todo denegado.** Después de cada intento, el estado se releyó y no había cambiado.

### 19.4 Migración en Supabase real

- `20260926000001_world_skills_authority.sql` se aplicó con `ON_ERROR_STOP` y `--single-transaction`: **0 errores y 0 warnings**. Solo aparecen 3 NOTICE benignos de `DROP POLICY IF EXISTS`.
- **Re-aplicarla también funciona** (es idempotente).
- `supabase db lint`: nada en la migración nueva. Los únicos avisos son de los *stand-ins* del espejo.
- Constraints comprobados en la DB real: el CHECK de `state` de nodo, el de `material_id`, cantidad 1–100, XP ≤ 100 000, `skill_id` ∈ 3 skills y `action_id` PK.

### 19.5 Settlement, idempotencia, concurrencia y atomicidad (DB real, vía Edge Function)

- **Acción X:** +10 XP, +1 material, **un** settlement y el nodo persistido `depleted` con su `action_id`.
- **X de nuevo:**
  - idéntica → `applied:false`, sin XP ni material extra y sin segundo settlement;
  - con otros números válidos (50 XP, 5 oro) → `applied:false`, y devuelve **el settlement guardado** (10 XP);
  - con números fuera de rango (999999) → rechazada entera (500), sin cambios.
- **Concurrencia:** la misma acción enviada **2 y 20 veces a la vez** → exactamente **una** aplicada; el ledger final es exacto (20 XP y 2 troncos para 2 acciones). El índice único de `action_id` serializa las copias y el resto ve `already settled`.
- **Dos jugadores, el mismo nodo:** la autoridad del mundo lo otorga a uno solo; el otro recibe `busy` y hay un único settlement en la DB.
- **Atomicidad**, revisada en la transacción SQL y forzada con fallos a mitad de camino:
  1. un segundo reward inválido, con el primer reward, la XP y el settlement ya escritos en la misma transacción;
  2. un `state` de nodo que viola su CHECK, con la XP y los materiales ya escritos;
  3. un `material_id` inválido.

  En los tres casos: **ni XP, ni material, ni settlement, ni cambio de nodo**. PostgREST ejecuta cada RPC en una transacción, y cualquier `RAISE` o violación de constraint revierte todo. **No hubo que cambiar la SQL.**

### 19.6 Persistencia de WORLD en DB real

El realtime usó el adaptador de producción (Edge Function) contra este Supabase.

- **Depletion:** se taló el árbol y se reinició la sala. Mientras `respawnAt > now` sigue agotado y otro jugador recibe `depleted`.
- **Respawn:** después de `respawnAt`, una sala nueva lo trae disponible y se puede talar. No se escribe AVAILABLE: el override vencido se ignora al restaurar, y `world_load_nodes()` lo borra.
- **Agricultura:** se plantó y se reinició, y la parcela sigue `planted`, del mismo dueño, **sin reset**. Con el reloj en `readyAt`, otra sala la ve `ready`. B no puede cosechar (`not-your-plot`). A cosecha una vez (+25 XP y las bayas que se tiraron), la parcela queda vacía y un segundo intento es imposible.

### 19.7 Pruebas adversariales

| Cliente manda | Resultado (DB real) |
|---|---|
| `xp = 999999` | ignorado: 10 XP |
| `materialQuantity`/`quantity = 999999`, `reward` inventado | ignorado: lo que tiró el servidor (1–2 troncos) |
| `userId`/`playerId` = otra persona | ignorado: la otra persona no recibe nada |
| `pokemonInstanceId` ajeno | `not-owner` |
| `nodeId` real pero lejano | `too-far` |
| `nodeId` inventado | `unknown-node` |
| `actionId` propio en el intent | ignorado (lo genera el servidor) |
| `actionId` ya liquidado (vía función) | no-op, devuelve el settlement guardado |
| cosechar una parcela ajena | `not-your-plot` |
| plantar sobre una parcela ajena | `not-your-plot` |
| llamar a la Edge Function sin secreto, con secreto incorrecto, con la sesión de un usuario o con la service key como bearer | 401, sin tocar la DB |
| operación inventada, `actionId` o userId mal formados, skill `fishing` | 400 |

### 19.8 Identidad y sesión (cómo funciona hoy)

1. **Join:** el cliente manda su access token. El realtime lo verifica **una vez**, contra GoTrue (`/auth/v1/user`).
   - **FACT (stack real):** un token vivo da `player` con el `userId` canónico de Auth.
   - Un token **con claims editados** es `guest`.
   - Un token **vencido pero bien firmado** es `guest`. El control, el mismo token re-firmado con `exp` futuro, es aceptado, así que el rechazo se debe solo al vencimiento.
2. **Después del join,** la identidad es la del socket autenticado. Skills no usa el token: ownership, estado y commit van server-to-server con el `userId`. Una sesión abierta **no se rompe a los 60 minutos** (test de 3 h).
3. **Reconexión y recarga:** el cliente hace un join nuevo con `supabase.auth.getSession()`, que supabase-js mantiene refrescado. Un token viejo nunca sirve como identidad nueva.
4. **No hizo falta re-auth interno:** no hay nada que refrescar del lado del servidor.

Riesgo residual: una cuenta revocada durante una sesión abierta sigue conectada hasta desconectarse. La propiedad de cada Pokémon igual se re-chequea en el servidor (caché de 30 s).

### 19.9 Límite de secretos

- **Bundle final** (normal y playtest):
  - ninguna aparición de `service_role`, `WORLD_AUTHORITY*`, `x-world-authority-secret` ni `world_commit_work`;
  - el único JWT embebido es el `anon` (público);
  - ni el secreto de la función ni la service key del staging aparecen en ningún archivo.
  - El único match de `sb_secret_` es el código de supabase-js que valida prefijos de clave.
- **Git:** no se agregó ningún secreto. Las claves locales del staging viven solo en el scratchpad.
- **Logs:**
  - la Edge Function no devuelve el mensaje de la DB (`authority_failed`) y en su log escribe solo el código;
  - el realtime registra errores truncados, sin payloads ni credenciales;
  - probado que la respuesta de error no contiene el secreto, la service key, `service_role` ni el SQL.

### 19.10 Cambios realizados en esta fase

- **Gameplay y código de producción: ninguno.** No hizo falta corregir ningún bug.
- **Agregados:**
  - la batería de staging `staging.test.js`, que se saltea sin las variables `RC03_*`;
  - el espejo de prod y el runbook en `scripts/integration/rc03-staging/`;
  - esta sección, y la deuda de polish (composición recurso → Pokémon → entrenador) en §18.
- **Entorno de la máquina:** el disco de datos de Docker se movió a `D:\DockerDesktopWSL\disk`, con un *junction* desde su ruta original en C:, porque C: se había llenado con las imágenes.

### 19.11 Riesgos residuales

1. **Staging local, no hosted.** Es el mismo Postgres, PostgREST y GoTrue, pero no el proyecto real: la configuración del proyecto (por ejemplo, claves asimétricas o el pooler) puede diferir. **Antes de prod:** un staging hosted, o un branch con plan Pro, y un deploy de la función ahí.
2. **Latencia real de la Edge Function hosted: sin medir.**
3. **Endurecimientos recomendados de §19.2**, sin aplicar: grants de tabla amplios y un chequeo de sesión explícito en las funciones del mercado.
4. **Un solo proceso realtime** (§17.1): la reserva de nodos vive en memoria.
5. **El espejo cubre solo las tablas y funciones de ownership.** Otras tablas de prod no se re-auditaron en esta fase (SEC-1 las cubrió).
6. Los riesgos de §17 que no son de seguridad siguen igual.

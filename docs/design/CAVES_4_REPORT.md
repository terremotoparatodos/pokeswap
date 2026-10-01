# CAVES-4: autoridad de navegación y reconexión

> Rama `world/caves-authoritative-navigation-0.3`, base `integration/world-skills-0.3 @ c8d0a4c` (CAVES-3 integrado, smoke humano aprobado: `CAVES_3_REPORT.md` §9).
> Sin cambios en Supabase, SQL, Edge Functions, gate, testers, Playtest 0.2, `main`, tags ni realtime público.

## 1. Resumen

La navegación entre Ciudad Corazón, Pradera y `cueva-inicial` ahora la decide el servicio.

El cliente solo pide:
- caminar un paso (`move {direction, running, sequence}`);
- o un área (`area {areaId}`).

El servicio valida cada paso contra la colisión compartida y reconoce cada portal por área y casilla exactas. También elige el destino, las coordenadas de llegada y a quién ve cada uno.

Decisiones tomadas con el usuario antes de implementar:

| Decisión | Elegido |
| --- | --- |
| Botón «Ciudad» | **Recall server-side.** Es la única excepción explícita: el cliente pide volver y el servicio elige un destino fijo. |
| Pedido de la misma área fuera de la Ciudad | **Resync sin mover.** Solo cae a la llegada si la casilla del propio servicio dejó de ser válida. |
| Reconexión pasados 15 s o tras un reinicio | **Solo diseño** (§6). No se implementa persistencia. |

## 2. Auditoría: cómo se definía la navegación (FACT, en `c8d0a4c`)

| Pieza | Dónde vivía | ¿La conocía el servicio? |
| --- | --- | --- |
| Colisión de la Pradera | `terrain.js` + `resourceZones.js` (`isSolidAtArea`, incluye la roca de la cueva) | Sí, la usaba solo para nodos, salvajes y `standableTile`; no validaba pasos |
| Colisión de la cueva | `caveLayouts.js` | Sí, validaba pasos (CAVES-3) |
| Colisión de la Ciudad | `TownArea.buildCollision` sobre `hearthome.ts` + `hearthomeTerrain.ts` + `townProps.ts` (tamaños) | **No**: solo en el cliente |
| Límites | La Ciudad (grilla 64×51) y la cueva (21×15) tienen borde; la Pradera es infinita | — |
| Portales | Ciudad: `hearthome.ts` (gates). Pradera: el pad de `WildArea` y la boca (`caves.js`). Cueva: `E` | Solo boca y salida (CAVES-3) |
| Llegadas | `protocol/arrival.js` (literal para la Ciudad), espejo de `Area.arrival(from)` | Sí |
| `standableTile` | `workPlacement.js`: excluía la boca de la cueva | **No excluía el pad de la Pradera** |
| Secuencias | `applyMove`: rechazaba `≤ actual` (replay) y aceptaba cualquier número mayor | — |
| Objetos colocados por features | `placedObjects` (F-1): en producción vacío (`SkillsWorldLayer.placedObjects = []`) | No (no hace falta) |
| Agua | El jugador camina sobre ella (`habitat: 'any'`); solo los wanderers respetan su hábitat | — |

Huecos encontrados:
- En la Ciudad y la Pradera, el servicio aceptaba cualquier paso.
- `area: pradera` o `area: ciudad-corazon` se aceptaba desde cualquier casilla.
- El pedido de la misma área teletransportaba a la llegada desde cualquier lugar.
- Se aceptaban secuencias adelantadas.

## 3. Arquitectura elegida

**Una fuente canónica de navegación con datos puros**, sin dependencias, compartida por Vite y Node:

- `services/realtime/src/world/townLayout.js` (nuevo) contiene los hechos de navegación de la Ciudad:
  - terreno;
  - huellas de edificios con sus `open` y `door`;
  - fuentes;
  - props sólidos y sus tamaños;
  - gates con su llegada;
  - spawn.

  `townCollision(def)` es **la** regla: la usan el `TownArea` del navegador (también para las ciudades del lab) y el servicio. Nombres, blurbs, arte, textos de carteles y residentes quedan en `hearthome.ts`, y los carteles se vinculan por `key`.

  **Equivalencia probada:**
  - la definición de la Ciudad es profundamente igual a la anterior en el build normal y en el de playtest;
  - la máscara de colisión es idéntica bit a bit, margen incluido (md5 `04ca2bc1…`, congelada en `townLayout.test.js`).
- `services/realtime/src/world/navigation.js` (nuevo) compone las tres fuentes:
  - `isWalkable(area, tx, ty)`;
  - la lista enumerable `PORTALS`;
  - `portalAt`, `isSafeLanding`, `nextHop` y `portalTo`.

  La Pradera recibe un **borde duro** de ±4096 casillas. Es la única área que el arte deja sin límite, y el cliente lo replica (`WildArea.isSolid`).
- `arrival.js` lee el spawn y la llegada del gate de la Pradera desde `townLayout.js`. El bundle de SKILLS se regeneró: solo cambian datos.

No hay dos mapas manuales. El cliente y el servicio derivan la colisión de los mismos datos y con la misma función, y los tests de paridad cubren cada casilla de la Ciudad y de la cueva, y una ventana de 80×80 de la Pradera junto con su borde.

## 4. Reglas de autoridad (servicio)

**Pasos** (`applyMove` + `stepAllowed`):
- un paso es exactamente una casilla en una de cuatro direcciones;
- el destino debe ser `isWalkable` en el área real del actor;
- los campos extra del payload se ignoran (`tx`, `ty`, `areaId`, `steps`…).

**Secuencias:**

| Caso | Respuesta |
| --- | --- |
| `≤ actual` | `movement replay denied`. No se consume. |
| `> actual + 1` | `movement sequence denied`, **consumida**. El eco reconoce exactamente el último número del cliente, así que se reconcilia en un solo intercambio y no hay loop. |
| `NaN`, `Infinity`, fracciones, `> 2^53` o negativos | `movement denied`. No mueven ni consumen nada. |

**Rechazo de un paso:**
- un único `presence:self` autoritativo, solo al emisor;
- los observadores no reciben nada;
- el trabajo en curso no se cancela.

**Pedidos de área** (`presence/areaTransition.js`, devuelve `{ kind, arrival }`):

| Pedido | Respuesta |
| --- | --- |
| Otra área, parado **exactamente** sobre un portal de su área real que lleva ahí | `portal`: aterriza en la llegada de ese origen, nunca sobre un portal |
| Ciudad desde cualquier otro lugar | `recall` a (8,41) desde la Pradera y al spawn (31,20) desde la cueva: exactamente lo que el cliente ya predice |
| Ciudad estando en la Ciudad | `recall` al spawn |
| La misma área fuera de la Ciudad | `resync`: snapshot de la posición real, sin moverse ni publicar nada. Solo cae a la llegada si su casilla dejó de ser caminable |
| Cualquier otro caso (casilla equivocada, área no compartida, área inventada) | `area transition denied` + un snapshot con el área y la casilla reales |

**Reconexión dentro de la gracia de 15 s:** la casilla recordada se usa solo si `isSafeLanding` (caminable y no portal). Si no, se usa la llegada de su área (`reconnectRepairs`).

**Trabajadores:** `standableTile` excluye **todo** portal, el pad de la Pradera incluido.

**Presencia:**
- aislada por `areaId` (sin cambios);
- un jugador no puede usar `observe`;
- un invitado solo puede observar la Ciudad y la Pradera, nunca la cueva.

**Métricas** (agregadas, sin ids ni coordenadas):
- `transitions {portal, recall, resync}`;
- rechazos `sequence` y `blocked`;
- `reconnectRepairs`.

## 5. Protocolo y compatibilidad

- **Mensajes sin cambios:** `move`, `area`, `observe`, `presence:*`, `world:*`.
- **Revisiones sin cambios:** presencia 2 y WORLD 3. No se incrementa ninguna revisión.
- **Semántica nueva**, toda expresada con mensajes que el cliente de CAVES-3 ya maneja:
  - `movement blocked` ahora en las tres áreas;
  - `movement sequence denied` es una razón nueva, que el cliente solo cuenta en diagnóstico, seguida del `self` habitual;
  - `area transition denied` también para Ciudad ↔ Pradera desde una casilla equivocada;
  - el resync responde con un snapshot, como siempre.
- **El cliente legítimo no cambia de conducta:**
  - colisiona igual (paridad);
  - cruza solo parado sobre el portal;
  - numera sus pasos uno a uno;
  - su punto seguro usa el mismo mensaje.

  El cliente nuevo agrega solo el borde de la Pradera y los tests.
- **Cliente de CAVES-3 contra este realtime:** compatible. La única diferencia observable es el borde de la Pradera a ±4096 casillas. Aun así, en la validación oscura conviene reiniciar cliente y realtime juntos sobre el merge, como siempre.
- **Playtest 0.2:** usa su propio realtime público (`be360fd`, protocolo 2), que no se toca. Ningún cliente 0.2 debe apuntar a este realtime: sus capas de la Pradera son anteriores a MAP-2 y el servicio le rechazaría pasos.

## 6. Reconexión

### 6.1 Por qué pasados 15 s se vuelve a la Ciudad (FACT)

1. `PresenceRoom.onLeave` guarda el actor en `ReconnectCache.remember(id, actor)` con `RECONNECT_GRACE_MS = 15_000` (`presence/reconnectCache.js`) y un `setTimeout` que lo borra.
2. `onJoin` hace `reconnectingActors.take(userId)`. Si la entrada venció, devuelve `null` y se crea un actor nuevo en `AREA.TOWN (31,20)`.
3. Todo el estado de presencia vive en `Map`s del módulo: un **reinicio** del proceso lo pierde, y el jugador también vuelve a la Ciudad.
4. El cliente deshabilita la reconexión del SDK (`room.reconnection.enabled = false`) y rehace `joinOrCreate`. No manda área ni posición.
   - `?area=` solo elige el área local antes del primer snapshot.
   - `initialTownPosition` (localStorage) solo es cosmético.

   El snapshot del servicio siempre gana.
5. **Múltiples instancias:** la presencia asume un único proceso. Con dos, cada uno tendría su sala y sus `Map`s, y los jugadores quedarían partidos. Hoy no pasa (una app de Colyseus Cloud), y esta fase no lo cambia.

Lo que CAVES-4 sí agrega dentro de la gracia: la casilla restaurada se valida (§4). Pasados 15 s, el fallback a la Ciudad es seguro, porque la Ciudad no tiene portal en su spawn y el spawn es caminable.

### 6.2 Diseño mínimo propuesto (NO implementado: requiere migración, RPC y Edge Function)

- **Esquema:** `public.world_player_positions`.
  - `user_id uuid primary key references auth.users on delete cascade`
  - `area_id text check (area_id in ('ciudad-corazon','pradera','cueva-inicial'))`
  - `tx int`, `ty int`: `check` de rango ±4096
  - `dir text check (dir in ('up','down','left','right'))`
  - `revision bigint not null`
  - `updated_at timestamptz not null default now()`
- **Acceso y RLS:**
  - RLS activa, sin políticas;
  - `revoke all` a `anon` y `authenticated`;
  - solo `service_role` (como `world_skills_*`).
- **Funciones:** `world_save_position(p_user, p_area, p_tx, p_ty, p_dir, p_revision)` y `world_load_position(p_user)`.
  - `security definer` y `EXECUTE` solo para `service_role`.
  - El guardado es un upsert **monótono**: solo escribe si `p_revision > revision`.
- **Ruta:** el realtime no tiene credenciales de base. Dos acciones nuevas en la Edge Function `world-authority` (mismo secreto `WORLD_AUTHORITY_SECRET`), igual que el resto de WORLD.
- **Cuándo se escribe:** al salir, al cambiar de área y, como mucho, cada 10 s si el actor se movió, con lotes. Con 100 jugadores son ≤ 10 escrituras/s en el peor caso.
- **Cuándo se lee:** en `onJoin`, solo si no hay entrada en la `ReconnectCache` (la memoria fresca gana).
  - La posición leída se valida con `isSafeLanding` de la navegación **actual**.
  - Si no vale, se usa la llegada de su área; con un área desconocida, el spawn de la Ciudad.
  - Si la lectura falla o tarda más de N ms, el jugador va a la Ciudad (fail-safe). La lectura nunca bloquea la entrada a la presencia.
- **Amenazas y reglas:**
  - El cliente nunca escribe ni lee la tabla: el servicio guarda su propio actor autoritativo.
  - Un JWT forjado no toca nada.
  - Una posición vieja de otra instancia no pisa una nueva (`revision`).
  - Un mapa que cambió no deja a nadie en una pared (validación al leer).
  - No es estado de economía ni recompensa: no pasa por el gate de testers, como la presencia.
- **Compatibilidad:** aditiva. El realtime actual la ignora, el cliente no cambia y el protocolo tampoco.
- **Rollback:**
  - flag de entorno `WORLD_POSITION_PERSISTENCE=off`: el realtime deja de leer y escribir, y vuelve al comportamiento de hoy;
  - la tabla y las funciones pueden quedar (los datos son descartables);
  - el down migration borra las dos funciones y la tabla.
- **Pruebas necesarias:**
  - PGlite: grants (`anon` y `authenticated` sin `select`, `insert` ni `execute`), `check`s y upsert monótono;
  - Deno: contrato de las dos acciones de `world-authority`;
  - realtime: restaurar tras un reinicio (módulo fresco), fallback por casilla inválida o portal, fallo de la base → Ciudad, throttling, aislamiento de presencia al restaurar;
  - staging: punta a punta;
  - smoke oscuro: recargar tras más de 15 s y tras reiniciar el realtime.

**Autorización necesaria:** migración, RPC y cambio de la Edge Function hosted, en una fase aparte.

## 7. Pruebas

**Realtime:**
- `world/navigation.test.js` (6):
  - composición casilla por casilla;
  - solo enteros de áreas compartidas;
  - borde duro;
  - cada portal caminable, alcanzable y que aterriza en una casilla segura;
  - solo la casilla del portal lleva a otra área;
  - ningún trabajador sobre un portal.
- `world/townLayout.test.js` (8):
  - grilla, bordes y bosque;
  - spawn, gates, llegadas y puertas alcanzables;
  - huellas;
  - props;
  - contrato de llegadas;
  - `townCollision` genérico;
  - **huella md5 congelada**.
- `rooms/PresenceRoomNavigation.test.js` (16), con la sala real, el rate limit real y un reloj falso:
  - movimiento válido en las tres áreas;
  - las cuatro transiciones en ambos sentidos;
  - casilla equivocada en cada portal (un solo snapshot);
  - coordenadas, origen y destino falsificados;
  - recall;
  - resync;
  - paredes y bordes (un solo `self` y nada a los observadores);
  - pasos malformados o no finitos;
  - ráfaga y salto;
  - replay y secuencia adelantada (consumida, sin loop);
  - coordenadas superpuestas Ciudad/cueva;
  - observación;
  - dos jugadores cruzando el gate en sentidos opuestos;
  - recarga y vencimiento de la gracia;
  - fallback de una casilla inválida o de un portal;
  - un paso bloqueado no cancela el trabajo y uno real sí.
- `rooms/BenchmarkPresenceRoom.test.js` (+1): los jugadores sintéticos entran por los portales reales.

Tests existentes adaptados, sin cambiar lo que prueban, porque antes viajaban pidiendo un área desde cualquier casilla:
- `PresenceRoom`, `PresenceRoomCave`, `PresenceRoomWorld` y `PresenceRoomPlacement` cruzan por portales reales (`crossTo`) y caminan rutas reales (`routeBetween`);
- se reemplazó el test que documentaba «Ciudad ↔ Pradera como antes de CAVES-3».

**Navegador:**
- `areas/townNavigation.test.ts` (4): paridad de colisión en cada casilla, gates, huellas y textos de carteles, y copias en lugar de los originales congelados;
- `areas/navigationParity.test.ts` (4): colisión y borde de la Pradera, mundos locales sin borde, portales idénticos, llegadas y recall;
- `engine/presenceReconciliation.test.ts` (+2): el resync y el paso rechazado con número consumido se adoptan una vez y no se reenvía nada.

### 7.1 Controles negativos (mutantes)

Cada mutante se aplicó con un script, se corrieron los tests indicados y se restauró con `git checkout`. Al final, el worktree quedó limpio.

| Mutante | Lo detecta (tests que fallan) |
| --- | --- |
| N1 el servicio ignora paredes | Navegación y cueva (4) |
| N2 un portal funciona desde cualquier casilla de su área | Navegación y cueva (9) |
| N3 el recall lleva a cualquier área (teleport) | Navegación y cueva (9) |
| N4 el pedido de la misma área teletransporta a la llegada | Navegación y cueva (3) |
| N5 se aceptan secuencias adelantadas | Navegación (1) |
| N6 se rechazan pero no se consumen (riesgo de loop) | Navegación (1) |
| N7 un paso rechazado se publica a los observadores | Navegación (2) |
| N8 un paso rechazado cancela el trabajo | Navegación (1) |
| N9 la casilla restaurada no se valida | Navegación (1) |
| N10 la presencia ignora el área | Navegación y cueva (2) |
| N11 un trabajador puede quedar sobre el pad | `navigation.test.js` (1) |
| N12 la Pradera sin borde en el servicio | Navegación y paridad (3) |
| N13 la colisión de la Ciudad pierde los props | `townLayout.test.js` (2) |
| N14 el cliente olvida el borde de la Pradera | `navigationParity.test.ts` (1) |
| N15 el cliente corre el pad una casilla | `navigationParity.test.ts` (1) |
| N16 el cliente abre una casilla de fuente | `townNavigation.test.ts` (1) |
| N17 el cliente ignora un cruce rechazado | `presenceReconciliation.test.ts` (1) |

**17/17 detectados.**

## 8. Benchmark

`scripts/benchmark-navigation.mjs` usa:
- WebSockets reales contra un proceso realtime real, en modo benchmark local;
- PRNG con semilla 4;
- rutas reales por la navegación compartida y cruces reales;
- `--probes p` para inyectar falsificaciones deliberadas, que se cuentan aparte.

Los resultados están en `docs/performance/baselines/caves-4/`.

| 100 actores, 60 s | Limpio | Con sondas (p = 0.05) |
| --- | --- | --- |
| Distribución inicial | Ciudad 34 · Pradera 33 · cueva 33 | Igual |
| Distribución final | Ciudad 39 · Pradera 49 · cueva 12 | Ciudad 38 · Pradera 56 · cueva 6 |
| Pasos aceptados (cliente = servidor) | 40 118 = 40 118 | 40 148 = 40 148 |
| Cruces aceptados (`portal`) | 552 | 501 |
| Rechazos esperados (sondas del generador) | — | 73 de 73: 40 `sequence`, 26 `area`, 7 `blocked` |
| Rechazos inesperados (defectos del servidor) | **0** | **0** |
| Fugas de presencia entre áreas | **0** | **0** |
| Errores de socket | 0 | 0 |
| RTT del ack p50/p95/p99/máx (driver con 100 sockets en un proceso) | 6.5 / 33.9 / 48.7 / 91.0 ms | 6.8 / 35.7 / 51.1 / 82.3 ms |
| Event loop del servidor p50/p99/máx | 31.0 / 36.5 / 38.5 ms | 31.0 / 36.5 / 38.0 ms |
| Memoria RSS / heap (final; pico) | 203 / 27 MB (pico 205 / 68) | 198 / 68 MB (pico 199 / 75) |

El p50 del event loop (~31 ms) es el piso del medidor con resolución de 20 ms y el tick de 50 ms. Es el mismo valor de los benchmarks previos: INTEGRATION-1 `demo-50` dio p50 30.98 y p99 33.31.

**Comparación con la base `c8d0a4c`** (mismos scripts y la misma máquina; la base se extrajo con `git archive` a un directorio temporal):

| Escenario | Base | CAVES-4 |
| --- | --- | --- |
| Presencia, 100 jugadores, Ciudad, 30 s: RTT p50/p95/p99 | 7.68 / 15.33 / 19.30 ms, 0 rechazos | 7.39 / 15.30 / 18.43 ms, 0 rechazos |
| Presencia, 100 jugadores, Pradera, 30 s: RTT p50/p95/p99 | 7.41 / 15.38 / 19.07 ms, 0 rechazos | 7.58 / 16.11 / 19.54 ms, **550 `blocked` del generador** |
| WORLD, 30 jugadores, 60 s | 71 unidades, 277 `too-far` | 125 unidades = 125 settlements = 125 commits, 0 duplicados, 0 stale, 0 `too-far` |

Atribución de los rechazos del generador:
- **Pradera:** `benchmark-presence` camina un cuadrado ciego de 5 pasos por dirección desde la llegada, a través de árboles. La base los aceptaba porque no validaba colisión. Simulado offline contra `isWalkable`, el mismo patrón da exactamente 550 bloqueos.
  - En una corrida previa, antes de que el generador adoptara la secuencia del snapshot, hubo 650 `blocked` + 100 `replay`.
  - Los 100 replays eran el número 1 que consumió el cruce de entrada, y los 650 bloqueos coinciden con la simulación desplazada en un paso.
  - **No son defectos del servidor.**
- **WORLD:** los `too-far` de la base son un desfase previo del generador, que no seguía el movimiento que hace el servidor (WORLD VISUAL-2). Se corrigió en el generador.

Contra el benchmark histórico (`MULTIPLAYER_BENCHMARK.md`, 100 jugadores en la Ciudad: RTT p95 16.03 y p99 20.68), la validación no agrega costo medible.

## 9. Gates (punta de la rama)

| Gate | Resultado |
| --- | --- |
| Navegación y presencia focalizadas (navegación, Ciudad, salas, cueva, presencia, protocolo, benchmark room) | 102/102 |
| Realtime completo, Node 24 | 332 aprobados, 0 fallos, 21 omitidos (staging) |
| Realtime completo, **Node 22** (`npx --offline node@22`) | 332 aprobados, 0 fallos, 21 omitidos |
| Vitest completo | 190 archivos, 1824/1824 |
| typecheck | OK |
| lint | 0 errores, 9 warnings ya existentes |
| Build normal y Playtest + `bundle-check` del retiro de Swap | ✓ / ✓ |
| Realtime | Sin paso de build (Node corre `src/`). Arranque real verificado en cada corrida de benchmark (`index.js` en modo benchmark local) |
| Drift de SKILLS (`bundle-skills.mjs --check`) | OK (bundle regenerado en `995a467`, solo datos) |
| `zone-layout.ts -- --check` | al día |
| WORLD × SKILLS (sala, placement, integración, edge path, worldRoom, skillPolicy) | 46/46 |
| Multi-yield y recuperación (YIELD-2) | 84/84 |
| Migraciones y SECURITY-3 (PGlite) | 40/40 |
| Guard de webhooks: tests y `check` | 28/28 y ✓ |
| Pacing de SKILLS | ✓ |
| Controles negativos | 17/17 |

**Deno y staging omitidos:**
- `git diff c8d0a4c..HEAD -- supabase` está vacío: no cambian SQL, migraciones ni Edge Functions;
- staging valida el contrato con la base, que no se tocó;
- la persistencia de posición (§6.2), que sí los necesitaría, no se implementó.

## 10. Commits

| SHA | Contenido |
| --- | --- |
| `680178a` | Cierre humano de CAVES-3 (`CAVES_3_REPORT.md` §9), solo documentación |
| `49b0878` | `townLayout.js`: navegación canónica de la Ciudad; el cliente la consume (equivalencia probada) |
| `995a467` | Bundle de SKILLS regenerado (solo datos) |
| `fd0c6f3` | `navigation.js`: walkability, portales, borde de la Pradera; trabajadores fuera de todo portal; helpers de test |
| `5a62020` | El servicio valida cada paso y cada cruce; recall, resync, secuencias y restauración validada; tests de sala |
| `37b9ac7` | Cliente: borde de la Pradera y guardas de paridad |
| `1b6b554` | Huella congelada de la colisión de la Ciudad |
| `fae230b` | Jugadores sintéticos por portales reales; los generadores adoptan la autoridad |
| `5ebcebf` | Benchmark de navegación de 100 actores y resultados |
| *(este)* | Informe |

## 11. Deudas explícitas

1. **Persistencia de la posición (§6.2):** pasados 15 s o tras un reinicio, se vuelve a la Ciudad. Es seguro, pero no restaura el área.
2. **Una sola instancia:** la presencia asume un proceso. Escalar horizontalmente exige estado compartido.
3. **El recall es un teleport por diseño:** a un destino fijo y sin cooldown.
4. **Borde de la Pradera (±4096):** pared invisible, sin arte.
5. **Divergencia de colisión:** si el cliente y el servicio divergieran, el punto seguro del cliente podría pedir resync una y otra vez.
   - Hoy no pueden divergir: misma función, paridad probada y `placedObjects` vacío en producción.
   - No hay un cortacircuitos en tiempo de ejecución.
6. **Gates de la Ciudad a mundos no compartidos** (tundra, costa, bosque, desierto): son portales que el servicio nunca cruza (`area denied`). El cliente ya muestra «llegará próximamente».
7. **Invitados:** pueden observar cualquier casilla de la Ciudad o la Pradera (espectadores de solo lectura, por diseño), nunca la cueva.
8. **`benchmark-presence` sigue caminando a ciegas:** en la Pradera produce rechazos del generador (§8). Puede pasar a rutas reales si se quiere una línea base limpia ahí.
9. **Acoplamiento del bundle:** el bundle de SKILLS incluye `townLayout.js` (vía `arrival.js`). Editar la navegación de la Ciudad exige regenerarlo, y el drift check lo detecta.
10. **Agua caminable para el jugador:** FACT preexistente, no se cambia.
11. **Del §8 de CAVES-3:**
    - quedan oscuridad y antorchas (3), el toque sobre la roca (4) y los clientes viejos (5);
    - quedan **cerrados** Ciudad ↔ Pradera (1), la caminabilidad en el servicio (2) y el benchmark (6);
    - la reconexión (7) quedó auditada, con diseño y sin implementar.

## 12. Revisión e integración

**Revisión:**
1. `git fetch` y `git log --oneline c8d0a4c..origin/world/caves-authoritative-navigation-0.3`.
2. Leer `world/townLayout.js`, `world/navigation.js`, `presence/areaTransition.js`, `presence/movement.js` y el diff de `rooms/PresenceRoom.js`.
3. Gates:
   ```
   cd services/realtime && node --test src/**/*.test.js src/*/*/*.test.js
   npx vitest run
   npm run typecheck
   npx eslint .
   node scripts/integration/bundle-skills.mjs --check
   npx vite-node scripts/map/zone-layout.ts -- --check
   ```
   Opcional:
   ```
   node scripts/benchmark-navigation.mjs --players 100 --duration 60 [--probes 0.05]
   ```

**Integración:** merge `--no-ff` en `integration/world-skills-0.3`, conservando los hashes. No hace falta regenerar nada.

**Validación oscura:** reiniciar **juntos** cliente y realtime sobre el merge (mismos túneles, gate cerrado). Smoke humano propuesto, con Titan123 y terremototw:
1. Chocar contra edificios, fuentes, cercos y bancos de la Ciudad, y contra árboles y la roca de la cueva en la Pradera: no se atraviesan, no hay saltos y no aparece el toast de «punto seguro».
2. Ciudad → Pradera por la puerta oeste; Pradera → Ciudad por el pad; Pradera → cueva por la boca; cueva → Pradera por la salida.
3. El botón «Ciudad» desde la Pradera (aparece junto a la puerta oeste) y desde la cueva (aparece en el spawn).
4. Los dos jugadores cruzan la puerta oeste en sentidos opuestos a la vez: cada uno termina donde caminó y se ven solo en la misma área.
5. Recargar a menos de 15 s dentro de la cueva: vuelve a su casilla. Recargar pasados 15 s: Ciudad (esperado, §6).
6. YIELD-2: talar o minar; chocar contra el nodo no cancela, y alejarse un paso sí. Conciliar settlements, XP y materiales.

Nada de esto requiere SQL, deploy hosted ni cambios de gate o testers.

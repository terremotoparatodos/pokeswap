# RESOURCE YIELD-2 — recursos con varias unidades (informe)

> Rama `world/multi-yield-resources-0.3`, sobre la auditoría `a9c7bf2` (que desciende de la integración `d8b5571`). Diseño: `docs/design/RESOURCE_YIELD_1_AUDIT.md`, con las correcciones C1–C7 de su §11, que mandan.
> Sin merge, deploy, PR, tag ni cambios hosted. Deno y staging quedan pendientes para la estación principal (§10).

## 1. Qué cambia para el jugador

- **Varias unidades por nodo.** Un árbol común da 2–4 unidades, un pino 2–3 y una roca básica 1–3. Los recursos avanzados siguen en 1 y Agricultura no cambia.
- **Trabajo continuo.** El Pokémon sigue trabajando mientras quede stock. Cada unidad tiene su propia tirada probabilística y paga una unidad más la XP de siempre.
- **Feedback por unidad.**
  - El dueño ve un `+1` (con la recompensa real) por cada unidad confirmada, y la escena **no se cierra**.
  - Los observadores ven un destello en el anillo del nodo.
  - No hay barra de progreso ni contador: el stock es secreto.
- **Cómo termina.**
  - Al agotarse el nodo, cae el árbol.
  - Caminar corta la unidad en curso, sin pago; las ya confirmadas quedan.
  - Desconectarse deja terminar la unidad en curso y después retira al Pokémon.
- **Nodo parcial.** Un nodo que quedó a medias se ve **igual que uno lleno** para todos. Se rellena en silencio 90 s después de su última unidad liquidada.

## 2. Migración

`supabase/migrations/20261001051958_world_multi_yield.sql` (aditiva; renombrada desde `20260928120000_world_multi_yield.sql`, mismo contenido byte por byte, ver §2.1):

- `world_node_overrides.stock_remaining smallint NULL`, con `CHECK (stock_remaining BETWEEN 1 AND 3)` (constraint con nombre).
- **Semántica de filas:**
  - sin fila: nodo lleno;
  - `available` + `stock_remaining`: parcial;
  - `depleted` + `stock_remaining NULL`: agotado;
  - parcelas: sin cambios.
- `action_id` pasa a ser el **token de generación**: el último `settlementId` aplicado.
- `CREATE OR REPLACE world_commit_work` con la **misma firma**. Mantiene `REVOKE`/`GRANT` a `service_role`.
- **Rollback lógico** (probado en PGlite): volver a aplicar la función de `20260926002154_world_skills_authority.sql` y ignorar la columna. Un realtime anterior nunca la escribe.
- `localDatabase.js` (PGlite) y el loop de `scripts/integration/rc03-staging/README.md` incluyen la migración.

### 2.1 Aplicación en hosted

- Producción aplicó la migración **individualmente** (sin `db push`), después de SWAP RETIRE-2 y SECURITY-3, y la registró como **`20261001051958 world_multi_yield`**.
- El archivo local se renombró a esa versión: renombrada desde `20260928120000_world_multi_yield.sql`, mismo blob de Git y mismo SQL. Ahora es la última versión del repositorio.
- Verificación de producción (estación principal):
  - `world_commit_work` actualizado; su ACL queda solo para `postgres` y `service_role`;
  - `world_node_overrides.stock_remaining` presente;
  - las 12 filas preexistentes se preservaron con `stock_remaining = NULL`;
  - las violaciones de SECURITY-3 siguieron en 0;
  - no cambió ningún dato.
- `world_load_nodes` **no** se ejecutó durante la verificación, porque borra los nodos vencidos. La lectura funcional de `stock_remaining` queda para el nuevo realtime.

## 3. Contrato SQL (`world_commit_work`)

1. `pg_advisory_xact_lock(hashtext(nodeId))`, aunque el nodo no tenga fila.
2. **Dedupe primero:** un `settlementId` ya guardado devuelve `{applied:false, settlement}` sin tocar nada.
3. **CAS de generación nueva** (`expectedToken = null`): acepta si no hay fila, o si hay una fila no-plot con `respawn_at <= reservedAt`.
4. **CAS de parcial** (`expectedToken = T`): acepta si `action_id = T`, `state = 'available'`, `stock_remaining = stock.before` y `respawn_at > reservedAt`. Nunca compara con `now()` (regla B).
5. **Cualquier diferencia:** `{applied:false, rejected:'stale_node'}`, **sin `RAISE`**. No liquida, no paga y no toca el nodo.
6. **Si pasa:** liquidación, XP, materiales y nodo (`stock_remaining = NULLIF(after, 0)`, `action_id = settlementId`), en la misma transacción.
7. **Validación de `p_node.stock`:** `before` en 1..4, `after = before − 1`, estado coherente con `after`, `reservedAt`/`respawnAt` numéricos y `expectedToken` string o null. Si algo no cuadra, `RAISE 'invalid_stock'`.

**Edge Function `world-authority`: sin cambios.** Pasa `p_node` y `rejected` opacos y responde HTTP 200 a `stale_node` (test en `edgePath.test.js`).

## 4. Protocolo

| | Antes | Ahora |
|---|---|---|
| `WORLD_PROTOCOL` | 2 | **3**; un cliente v2 (o sin protocolo) recibe `client-outdated` |
| Revisión de presence | 4 | **5** (`/version`) |
| `SKILLS_RULES_VERSION` | skills-1.2 | **skills-1.3** |
| `world:work:yield` | — | `{ actionId, index, summary }`, sólo al dueño y **después** de confirmar el commit |
| `world:work:done` | `{ actionId, ok, status, summary }` | `{ actionId, ok, reason, total: { units, xpGained, rewards } }` |
| Nodo trabajando | `startedAt` | + `yieldAt` (instante de la última unidad confirmada: un destello) |

**Nunca viaja a un cliente:**
- `settlementId`;
- el stock inicial, el restante o su existencia;
- el próximo éxito, la duración, los intentos o la chance;
- el rellenado de un parcial.

Un parcial se proyecta como `{ id, state: 'available', version, base: true }` y no aparece en snapshots ni al entrar a un chunk.

**Razones de `done`:**
- `depleted`: el nodo se agotó;
- `completed`: una parcela;
- `moved`, `cancelled`, `disconnected`;
- `refused`: SKILLS negó la unidad siguiente;
- `error`: un commit falló o dio `stale_node`;
- `limit`: la guardia de 20 unidades.

`ok` vale `total.units > 0`.

## 5. Modelo de secuencia

**Una reserva es una secuencia.** Tiene un `actionId` base privado y unidades `settlementId = actionId-hex2(index)`, con índice < 20, estable en los reintentos y siempre derivado por el servidor.

**Estado privado de la secuencia** (`resourceAuthority.js`):
- `reservedAt`;
- `expectedToken`/`stockBefore`: salen de la generación viva al reservar, o de un sorteo nuevo con RNG cripto (`nodeStock.drawStock`) en el rango que manda SKILLS;
- `index`, `phase` (`running`/`settling`/`done`), `authorizing`;
- la cadena de commits, `pending`, `committed` (el último estado confirmado) y `restingBefore` (el parcial tal como estaba);
- `stop`, `stopAfterCurrent`, `disconnected`, `abortCommits` y el total acumulado.

**Pipeline:**
- **Arranque inmediato:** al terminar los intentos de la unidad i, ésta pasa a `settling` y los intentos de la i+1 arrancan **en el mismo instante**, sobre la grilla de ticks, si el stock predicho es > 0, nadie pidió parar y el índice lo permite.
- **Orden estricto:** los commits corren en orden sobre una cadena por secuencia; el de i+1 nunca sale antes de confirmar el de i.
- **`yield` de i:** sale sólo tras confirmar el commit de i.
- **Fallo de i:** si el commit de i falla del todo o da `stale_node`, la unidad preparada se descarta sin pago (`cancelWork` una sola vez) y la secuencia termina con `done{reason:'error'}`.
- **Último stock:** con `after = 0` no se prepara otra unidad.
- **Liberación:** el nodo queda reservado hasta que resuelve el último commit pendiente. Entonces se escribe:
  - agotado, con su timer; o
  - parcial privado, con el reloj de su última unidad; o
  - el parcial previo intacto, si se canceló antes de liquidar; o
  - base, si no se liquidó nada o el parcial venció mientras estaba reservado.

**Movimiento y cancelación:**
- La unidad que todavía intenta se descarta sin pago.
- Las que ya están en `settling` pagan una vez.
- Nunca arranca otra unidad después de un pedido de parar.
- Moverse varias veces no duplica la cancelación.

**Desconexión** (`WorldRoom.leave` → `ownerLeft`, sólo si el socket que se va es el vigente; una recarga no cuenta):
- `stopAfterCurrent`: la unidad en curso termina y liquida, y después sale `done{reason:'disconnected'}`.
- Si el jugador vuelve a la casilla de espera antes de que termine esa unidad (`actorPlaced` → `reconcileActor`), la secuencia sigue.
- Un jugador desconectado nunca arranca otra unidad.

**Reinicio del proceso:**
- La unidad en vuelo se pierde sin pago.
- `restore` recupera los parciales persistidos (stock, token, `respawn_at`), privados y con timer, y descarta los vencidos.
- La secuencia siguiente usa un `actionId` nuevo.

**Rellenado:** el timer de un parcial lo borra en silencio (`ResourceStore.forget`: sin versión ni publicación). Mientras el nodo está reservado no se aplica. Una cancelación no mueve el reloj.

**SKILLS:**
- `resources.ts` define `stock` como **regla**: árbol común `[2,4]`, pino `[2,3]`, roca `[1,3]`, el resto `[1,1]`.
- La autorización lleva `stock:{min,max}` como campo privado de WORLD, nunca en `details`.
- `stale_node` es final, no reintentable y no marca el ledger como liquidado.
- WORLD valida el rango (`readStockRange`, 1 ≤ min ≤ max ≤ 4).

## 6. Archivos

**Base de datos y persistencia (`235bdf4`):**
- migración nueva;
- `localDatabase.js`;
- `playerData.js` (`stockRemaining`, `rejected`);
- `rc03-staging/README.md`;
- tests: `multiYield.database.test.js` (nuevo, 12) y `edgePath.test.js` (+1).

**SKILLS (`f75aac6`):**
- `resources.ts` (`stock`), `balance.ts` (`skills-1.3`), `workRules.ts`, `skillsService.ts`;
- `skillsWorldPolicy.ts` (`stock` privado, `stale-node` final) y su test (nuevo);
- `skillPolicy.js` (`readStockRange`) y su test;
- bundle regenerado.

**WORLD (`dd4802e`):**
- `nodeStock.js` (nuevo);
- `resourceAuthority.js` (secuencias y pipeline);
- `resourceStore.js` (parciales privados, `forget`);
- `worldProtocol.js`/`.d.ts` (v3, `WORK_YIELD`, `yieldAt`);
- `worldRoom.js`/`.d.ts` (`onYield`, `ownerLeft`);
- `observability/version.js` (revisión 5);
- `testing.js`;
- tests: `multiYield.test.js` (nuevo, 24), `probabilisticWork.test.js`, `integration.test.js` (+ 2 instancias), `resourceAuthority.test.js`.

**Cliente (`4e302cd`):**
- `worldTransport.ts`, `colyseusPresence.ts`, `sharedWorld.ts`;
- `skillsSession.ts` (`units`, `endReason`), `worldSkillsSession.ts`;
- `useSkillsLayer.ts`, `gatheringOverlayCore.ts`;
- `worldResourceOverlay.ts` (destello);
- tests: sesión, overlay, `yieldFlash.test.ts` (nuevo), e2e `workCancelOnMove.e2e.test.ts`, `sharedWorld.acceptance.test.ts`.

**Pacing (`5a74101`):** `pacing.ts`, `pacing.test.ts`, `scripts/skills/pacing.ts`, `resources.ts` (sin `charges`), bundle.

**Staging (commit `test(staging)`):** `staging.test.js`, gate RC-0.3 adaptado más un test de parcial y `stale_node` por la Edge real (sin ejecutar aquí).

**Documentación (`d6387b4`, `580bdb1`, este informe):** auditoría, `SKILLS_PROB_2_REPORT.md`, `WORLD_SKILLS_CONTRACT.md` y el comentario de `balance.ts`.

**Tamaño:** `resourceAuthority.js` pasa de ~420 a 628 líneas (banda 500–800). Se justifica en §9.

## 7. Tests y mutation checks

**Tests nuevos o adaptados** (RNG y reloj deterministas):

| Área | Cubre |
|---|---|
| `nodeStock` | `settlementId` y su formato hex; guardia de índice < 20 (20, −1, 1,5, NaN, string); sorteo en los extremos de cada rango; sin rango = 1; generación con regla B; unidad primera, intermedia y última |
| Secuencia | stock 3 → tres liquidaciones con CAS (`expectedToken` null → `-00` → `-01`), `reservedAt` único, agotado con respawn desde la última unidad, un solo sorteo; stock 1; sin rango (parcela o demo) |
| Pipeline | commits de 0,4 s y 1,5 s: intentos sin pausa sobre la grilla, commits en orden estricto, `yield` = confirmación, fin medido; ningún `yield` antes del commit, aunque tarde 60 s |
| Fallos | `stale_node` en la unidad 1: la 2 se descarta sin pago, `cancelWork` una vez, `done` error; commit que falla siempre: 4 intentos con el mismo id y aborto |
| Parar | cancelar antes del primer éxito no persiste nada; cancelar en la unidad 1 paga la 0 y deja el parcial privado con su reloj; carrera movimiento/éxito; tres movimientos, una cancelación |
| Desconexión | termina la unidad en curso y no arranca otra; reconectar a tiempo sigue; reconectar tarde no; una recarga no detiene la secuencia (`WorldRoom`) |
| Parciales | la secuencia siguiente continúa la generación (token y stock del parcial, sin sorteo nuevo, 3 unidades entre dos jugadores); rellenado silencioso a los 90 s que una cancelación no extiende; regla B justo antes y en el instante de vencer |
| Reinicio | parcial restaurado privado con su token; vencido = lleno; unidad en vuelo perdida sin pago (integración) |
| Fugas | `yield` sólo con `actionId`/`index`/`summary`; proyecciones sin stock, token ni `settlementId`; un destello por unidad; un nodo, un trabajador (también entre unidades) |
| Integración (PGlite) | Talar 2 unidades (`yield`, destello, `done` agotado, XP 20); Minería stock 1; Agricultura igual (una unidad, `done`); reintento tras timeout; reinicio tras el commit; **dos instancias** sobre una base: `stale_node` sin pago y luego continuación tras restaurar |
| DB | CAS nuevo o parcial, ABA, agotado todavía vigente, vencimiento durante una unidad, reserva después de vencer, dedupe primero, `stale_node` sin `RAISE`, rollback lógico |
| Edge | unidad con stock y `stale_node` → HTTP 200 y 200 |
| SKILLS | rangos, `skills-1.3`, cultivos sin stock, stock privado, `stale_node` final y no liquidado |
| Cliente | protocolo 3; v1, v2 y sin protocolo → `client-outdated`; cada `yield` actualiza XP y materiales sin cerrar; índice repetido una vez; tarde tras `done` ignorado; total en `done`; overlay: `+1` por unidad sin cerrar el timeline y sin repetirlo al final; destello; e2e con el cliente real (una unidad no cierra la escena; caminar tras una unidad la conserva y descarta la siguiente) |
| Pacing | k normativo; sin `charges`; fórmula única; tres tablas fijadas; Agricultura intacta |

**Mutation checks** (cada mutación se aplicó temporalmente, se corrieron los tests indicados y se restauró el archivo por copia; `git status` quedó limpio):

| # | Mutación | Resultado |
|---|---|---|
| 1 | CAS sin comparar el token (`action_id = T`) | ✔ 2 tests fallan |
| 2 | CAS sin comparar el stock | ✔ 1 falla |
| 3 | dedupe después del decremento (CAS primero) | ✔ 2 fallan |
| 4 | `stale_node` como `RAISE` | ✔ 7 fallan |
| 5 | parcial proyectado tal cual (fuga de refill y de estado) | ✔ 3 fallan |
| 6 | parcial listado en snapshots de chunk | ✔ 1 falla |
| 7 | el cliente cierra la escena con el primer `yield` (capa) | ✔ 2 fallan (e2e) |
| 8 | la sesión da por terminada la secuencia con el primer `yield` | ✔ 3 fallan |
| 9 | un jugador desconectado arranca otra unidad | ✔ 3 fallan |
| 10 | pipeline sin cadena (commits fuera de orden) | ✔ 2 fallan |
| 11 | `yield` antes de confirmar el commit | ✔ 11 fallan |
| 12 | `stale-node` reintentable en SKILLS | ✔ 1 falla |
| 13 | rango divergente en la fuente (árbol 2–5), bundle sin regenerar | ✔ 6 fallan |
| 14 | rango divergente sólo en el bundle (árbol 3–4) | ✔ `bundle-skills --check` falla |
| 15 | tope de unidades divergente (`MAX_UNITS = 21`) | ✔ 1 falla |
| 16 | el `yield` lleva el stock restante | ✔ 2 fallan |

Una primera versión de la mutación 5 (agregar `stock` a la proyección de cualquier registro) sobrevivió porque era inerte: sólo los parciales tienen `stock`, y salen antes por la rama privada. La reemplacé por la fuga real (quitar esa rama) y agregué la 16.

## 8. Pacing y economía

**Modelo único** (`src/features/skills/domain/pacing.ts`):
- k = la media del rango normativo de stock: árbol común 3, pino 2,5, roca 2, avanzados 1.
- Overhead y desplazamiento se cobran **una vez por nodo**.
- Los commits son ordenados, así que la secuencia termina una latencia después de su última unidad, más lo que los commits se atrasen cuando la latencia supera al intento.
- **Tiempo por unidad:** t + (overhead + walk + commit + (k − 1)·max(0, commit − t)) / k.
- `multiYield.test.js` mide ese mismo fin con commits simulados de 0,4 s y 1,5 s.
- Las cargas advisory del catálogo se **eliminaron**: eran la causa del error.

**Horas hasta Nv 10 / 25 / 40 / 50** (aptitud 3, overhead 1,5 s, walk 8 s):

| Modelo | Talar | Minería |
|---|---|---|
| Estimación del catálogo (`pacing.ts` hasta YIELD-1; cargas advisory, sin latencia) | 0,22 / 1,11 / 4,51 / 12,86 | 0,23 / 1,18 / 5,67 / 18,28 |
| **Juego real anterior** (1 unidad por nodo; commit 0,4 s) | 0,45 / 2,32 / 9,80 / **29,66** | 0,45 / 2,24 / 10,44 / **32,22** |
| **Multi-yield** (stock normativo; commit 0,4 s, pipeline) | 0,22 / 1,21 / 8,70 / **28,55** | 0,28 / 2,07 / 10,26 / **32,05** |
| Multi-yield con commit malo (1,5 s) | 0,23 / 1,29 / 9,44 / 31,08 | 0,30 / 2,23 / 11,10 / 34,75 |

Agricultura: 0,26 / 1,16 / 5,38 / **19,05 h**, sin cambios.

- **Juego temprano:** Nv 25 pasa de 2,3 h a 1,2 h. El tramo 25→50 casi no cambia, porque lo dominan recursos de 1 unidad.
- **Oferta de materiales básicos:** a nivel 1, bosque ×2,8 y cantera ×1,9 (auditoría §4).
- **XP, materiales por unidad, respawn, densidad y rangos:** no se tocaron para compensar.

**Comandos:**

```
npm run skills:pacing
npm run skills:pacing -- --commit 1.5
npm run skills:pacing -- --single
```

`pacing.test.ts` fija las tres tablas.

**Documentación corregida:**
- `SKILLS_PROB_2_REPORT.md` §12 (riesgo 3), §14 y §16 (la adenda del tope de CANCEL-1);
- el comentario de `XP_CURVE` en `balance.ts`;
- la auditoría YIELD-1, §§ resumen y 4;
- `WORLD_SKILLS_CONTRACT.md` §7.

Las tablas históricas se conservan y llevan la corrección al lado.

## 9. Desvíos respecto del diseño

1. **Latencia en el pacing.** C7 decía "latencia una vez por nodo". Los tests de pipeline muestran que, si el commit tarda más que el intento de una unidad, los commits se encadenan. La fórmula suma entonces (k − 1)·max(0, commit − t). Las tablas de C7 no cambian a dos decimales, porque cuando eso pasa (nivel alto) dominan recursos de 1 unidad.
2. **`resourceAuthority.js` en 628 líneas.** Queda dentro de la banda 500–800 de AGENTS.md. La responsabilidad es una sola (reserva y ciclo de vida de la secuencia sobre un nodo) y el estado está muy acoplado. No lo partí para no mezclar una refactorización con este cambio; queda propuesto extraer la cadena de commits como paso aparte.
3. **Parcela = secuencia de una unidad.** Manda `yield` y después `done{reason:'completed'}` (antes era un único `done` con `summary`). La UI de Agricultura no cambia: sigue cerrando con `done`.
4. **`+1` con la recompensa real.** El pop de cada unidad muestra lo que pagó esa unidad (+1 tronco, o +2 si salió el bonus de aptitud) y su XP. No es un "+1" literal fijo.
5. **`done` agrega `limit` y `refused`** a las razones del brief: la guardia de 20 unidades, inalcanzable con stock ≤ 4, y una negativa de SKILLS a mitad de secuencia.
6. **`stale_node` y memoria.** Tras un `stale_node`, WORLD conserva en memoria el último estado confirmado de la secuencia. Si la base divergió (otra instancia), las secuencias siguientes de esa instancia sobre ese nodo reciben `stale_node` sin pago hasta que la fila vence (≤ 90 s para un parcial, el respawn para un agotado). Es seguro, pero deja el nodo inactivo en esa instancia durante ese lapso. Hoy producción corre una sola instancia.

## 10. Gates

| Gate | Resultado |
|---|---|
| Tests enfocados (`multiYield`, DB, edge, `probabilisticWork`, `integration`, sesión, overlay, e2e, pacing, `skillsWorldPolicy`) | ✔ |
| Realtime completo (Node 24) | ✔ **249 tests: 228 pass, 0 fail, 21 skipped** (los 21 son el gate de staging RC-0.3, que necesita un stack local de Supabase) |
| Integración / PGlite (dentro del realtime) | ✔ incluye `multiYield.database.test.js` (12) y la prueba de dos instancias |
| Vitest completo | ✔ **186 archivos, 1829 tests**, 0 fallos |
| Typecheck (`vue-tsc -p tsconfig.app.json`) | ✔ exit 0 |
| Lint (`eslint .`) | ✔ exit 0, **0 errores**; 9 warnings, todos en `src/features/auth/components/AuthModal.vue` (preexistentes, no tocado) |
| Build (`vite build`) | ✔ |
| Drift de SKILLS (`bundle-skills --check`) | ✔ exit 0 |
| Pacing (`npm run skills:pacing`) | ✔ Talar 28,55 h · Minería 32,05 h · Agricultura 19,05 h (Nv 50) |
| Deno (Edge Function) | **pendiente**: no hay Deno en esta máquina |
| Staging RC-0.3 (Supabase local) | **pendiente**: no hay Docker/Supabase. Los tests del gate se adaptaron a YIELD-2 y se agregó uno de parcial/`stale_node` por la Edge real, **sin ejecutar** |

Pasos para la estación principal:
1. aplicar `20261001051958_world_multi_yield` (renombrada desde `20260928120000_world_multi_yield.sql`) en el stack local (loop de `scripts/integration/rc03-staging/README.md`);
2. correr el gate de staging con las variables `RC03_*`;
3. correr la suite Deno de `world-authority`.

## 11. Riesgos pendientes

1. **Deno y staging sin ejecutar en esta máquina** (no hay Deno ni Docker/Supabase). Hay que correrlos en la estación principal antes de publicar: aplicar la migración en staging y correr la suite Deno de la Edge Function.
2. **Sumideros de materiales: obligatorios antes de abrir el gate al público.** La oferta básica sube ×2,8 en el bosque y ×1,9 en la cantera, y todavía no hay dónde gastarla.
3. **Más commits por hora** (R5): una fila por unidad, hasta ~×2 por jugador en nivel alto sobre básicos. El benchmark de 10/30/100 no se repitió con secuencias.
4. **Latencia hosted real.** El `+1` llega una latencia de commit después del golpe ganador. Con 1,5 s y unidades cortas, los commits se atrasan respecto de los intentos (medido en tests; el jugador ve los `+1` con retraso, pero nunca una pausa del Pokémon).
5. **Clientes con el bundle viejo** reciben `client-outdated` hasta recargar (protocolo 3).
6. **Un reinicio pierde la unidad en curso**, sin pago, como antes. Los parciales se conservan.
7. **Multi-instancia:** ver §9, punto 6.
8. **`resourceAuthority.js` en 628 líneas:** vigilar que no siga creciendo.

## 12. Prueba humana

Realtime local con esta rama (`npm run dev` más el realtime en modo dev con PGlite) y dos navegadores: A con Scyther y B observando.

1. **Secuencia completa.** A tala un árbol común.
   - Cada unidad muestra un `+1` y el Pokémon sigue.
   - B ve un destello en el anillo por cada unidad y ningún número.
   - Tras 2–4 unidades el árbol cae y la tarjeta de A muestra el total.
2. **Caminar a mitad de secuencia.** A camina después del primer `+1`.
   - La escena se cierra al instante y la tarjeta muestra lo cobrado.
   - B ve el árbol **lleno** (sin tocón).
   - Si B lo tala enseguida, cae antes (continúa el stock oculto).
3. **Rellenado.** Repetir el paso 2 y esperar 90 s sin tocar el árbol: vuelve a dar el rango completo.
4. **Desconexión.** A cierra la pestaña a mitad de una unidad.
   - B ve al Pokémon terminar esa unidad (un destello) y retirarse.
   - Al volver, A tiene esa unidad cobrada y no más.
5. **Recarga.** A recarga la página a mitad de una unidad y vuelve antes de que termine: el Pokémon sigue hasta agotar el árbol. Si vuelve después de esa unidad, el Pokémon ya se retiró y el resto del stock queda en el árbol.
6. **Minería:** igual que el paso 1, con 1–3 unidades por roca.
7. **Recursos avanzados:** con Nv suficiente, un nodo avanzado da una unidad y se agota.
8. **Agricultura:** plantar, cuidar y cosechar funcionan igual que antes.
9. **Cliente viejo:** con un bundle cacheado anterior, pedir trabajo muestra "Actualizá la página para seguir trabajando".
10. **Verificar** `/version` → protocol 5; `/metrics` → `actions.units`, `staleNodes`, `refilled`, `disconnectedStops`.

# SKILLS PROB-2 — Trabajo probabilístico (implementación)

> Rama `world/probabilistic-work-0.3`, sobre `design/probabilistic-work-audit-0.3 @ 0c411d9` ← `integration/world-skills-0.3 @ 4d72c3d`.
> Diseño aprobado: `docs/design/SKILLS_PROB_1_AUDIT.md`. Sin merge, deploy, PR, tag ni cambios en Supabase hosted o en el gate. `supabase/` no se tocó.

## 1. Qué cambió

- **Talar, Minería y Agricultura (plantar, cuidar y cosechar)** ya no duran un tiempo fijo. Una acción es una serie de **intentos de 600 ms**. Cada intento acierta con probabilidad `p` y el primer acierto la termina.
- **Al autorizar, el servidor sortea en secreto** cuántos intentos harán falta (tope incluido). Después programa el fin en `intentos × 600 ms` y **no se lo dice a nadie**.
- Toda la maquinaria de autoridad sigue igual: `actionId`, reserva atómica, `settling` antes del primer `await`, `world_commit_work` con PK `action_id`, reintentos con el mismo id y `too_early`.
- **Protocolo del mundo 2.** Se eliminaron las tres filtraciones de `endsAt` que detectó la auditoría. Un cliente con protocolo anterior recibe `client-outdated` y no puede iniciar nada.
- **Sin barras de progreso.** El Pokémon repite su gesto una vez por tick sobre el reloj del servidor, igual para el dueño y para los observadores. El éxito llega con `world:work:done`, el cambio del recurso y los pops existentes.
- **Rate limiting de `world:work` por jugador**: ráfaga 4, un token cada 500 ms.

## 2. Fórmula implementada

`src/features/skills/domain/attempts.ts` (pura) con constantes en `balance.ts` (`ATTEMPTS`, `TIER_MAX_CHANCE`):

```
x    = clamp((L − Lreq) / (50 − Lreq), 0, 1)                 (Lreq = 50 ⇒ x = 1 si L ≥ 50)
pReq = min(0,5, tick / (1,25 · baseMs))                       baseMs: baseDurationMs del recurso, FARM_ACTION_MS de la acción agrícola
b    = pReq + (pMax[tier] − pReq) · x²                         γ = 2
p    = min(0,98, 1 − (1 − b)^(1 / APTITUDE_DURATION[aptitud]))
cap  = clamp(⌈3 / p⌉, 3, 40)
N    = primer intento k < cap con random() < p; si no, cap      (una tirada por intento; el tope acierta sin tirar)
durationMs = N · tick,  tick = WORK_TICK_MS = 600
```

- `pMax` por tier: muy básico 0,95 · básico 0,85 · intermedio 0,72 · avanzado 0,58 · especializado 0,48.
- Cultivos por peldaño: Aranja muy básico, Medicinal básico, Zanama intermedio, Zidra avanzado, Revivir especializado.
- `p ∈ (0; 0,98]` para todo recurso, nivel 1–60, aptitud 1–5 y tick 400–1200 (test exhaustivo).
- El tope 40 sólo se aplica en un caso real: cúmulo cristalino en nivel 45–46 con aptitud 2 (⌈3/p⌉ = 42 → 40).

Valores verificados en `attempts.test.ts` (idénticos a la tabla de la auditoría):

| Caso (aptitud 3 salvo indicación) | p | E[t] | p90 | tope |
|---|---|---|---|---|
| Árbol común Nv 1 | 0,160 | 3,61 s | 8,4 s | 19 (11,4 s) |
| Árbol común Nv 1, aptitud 1 / 5 | 0,126 / 0,196 | 4,59 / 2,97 s | — | 24 / 16 |
| Roca Nv 1 | 0,150 | 3,85 s | 9,0 s | 20 |
| Árbol común Nv 50 | 0,950 | 0,63 s | 0,6 s (primer tick) | 4 |
| Pino Nv 12 → 50 | 0,133 → 0,850 | 4,33 → 0,71 s | — | 23 → 4 |
| Cúmulo cristalino Nv 45 → 50 | 0,080 → 0,480 | 7,18 → 1,24 s | — | 38 → 7 |

**Métrica a observar:** con γ = 2, las acciones por hora de un nivel 50 sobre recursos básicos pueden llegar a ~1,56× las de hoy (con ~2,5 s de desplazamiento por ciclo). Se acepta sin compensar, como se decidió. `SKILLS_RULES_VERSION` = `skills-1.1` queda en cada liquidación, así que se puede comparar XP y materiales por hora antes y después usando `skill_work_settlements`.

## 3. Autoridad y sorteo

1. `ResourceAuthority.requestWork` pasa `attemptMs: WORK_TICK_MS` a SKILLS.
2. `skillsService.authorizeWorkAttempt` valida `attemptMs` (entero entre 400 y 1200; si no, `invalid_request`). Luego calcula `p` y el tope con `evaluateWork`, sortea `N` con **su puerto `random`** y guarda `attempts` y `durationMs` en el ledger (`AuthorizedWork`, estado privado del servidor).
3. En producción, `random` es `cryptoRandom` (`crypto.getRandomValues`). Sólo los tests inyectan una fuente determinista: `createSkillsWorldPolicy({ random })`, `scriptedRandom()`.
4. WORLD recibe `durationMs`, lo redondea hacia arriba a ticks enteros (`tickAligned`, 1 tick como mínimo) y guarda el fin **sólo** en la acción privada y en la cola.
5. El registro público del nodo ya no tiene `actionEndsAt`.
6. `too_early` compara contra el sorteo guardado, así que un cierre antes de tiempo sigue siendo imposible.

**Lo que nunca recibe un cliente:** la cantidad de intentos, la duración, `endsAt`, el próximo intento exitoso, la semilla o la chance. `details` sólo lleva skill, XP, rango de recompensa, aptitud y niveles. Un escáner de tests recorre todos los mensajes al dueño, al observador, a un invitado y al dueño reconectado. Verifica que no aparezca ninguna de esas claves ni ningún número igual al fin o a la duración privados.

## 4. Protocolo

| | Protocolo 1 (antes) | Protocolo 2 (ahora) |
|---|---|---|
| Declaración | `worldProtocol: 1` | `worldProtocol: 2` (`WORLD_PROTOCOL`; revisión de presencia 4) |
| `world:work:result` ok | `{requestId, ok, actionId, nodeId, startedAt, endsAt, farmAction?, details?}` | `{requestId, ok, actionId, nodeId, startedAt, farmAction?, details?}` |
| `world:snapshot.ownAction` | `{actionId, nodeId, startedAt, endsAt}` | `{actionId, nodeId, startedAt}` |
| Nodo público (snapshot/batch) | `…, worker{…, stand}, startedAt, endsAt` | `…, worker{…, stand}, startedAt` |
| `world:work:done` | sin cambios | sin cambios (no lleva intentos) |
| Rechazos nuevos | — | `client-outdated`, `rate-limited` |
| Tick | implícito (duración) | `WORK_TICK_MS = 600`, constante del contrato (`worldProtocol.js`), compartida por servidor y navegador |

- **Cliente incompatible** (protocolo anterior o ninguno): no recibe estado del mundo. `world:work` recibe `client-outdated` directamente en su socket, **antes de cualquier verificación, lectura o reserva**, y `world:cancel` se ignora. No hay período de gracia ni cota falsa.
- El room pasa el socket de origen a `world.work` / `world.cancel`.
- Producción 0.2 corre en su propia rama y su propio realtime, y no cambia.

## 5. Agricultura: qué entra en el modelo

| Acción actual | ¿Activa? | ¿Probabilística? | Base |
|---|---|---|---|
| Plantar (`plant`) | sí | **sí** | `FARM_ACTION_MS.plant` 3000 ms + tier del cultivo |
| Cuidar (`tend`, una vez por cultivo) | sí, existe como acción activa | **sí** | `FARM_ACTION_MS.tend` 2000 ms |
| Cosechar (`harvest`) | sí | **sí** | `FARM_ACTION_MS.harvest` 2600 ms |
| Crecimiento `planted → growing → ready` | no (reloj) | **no** | `growMs` del cultivo, `PLOT_GROWING_AT` 0,5 |

Sin cambios:
- los timestamps persistidos (`plantedAt`, `growingAt`, `readyAt`, siempre desde el instante del acierto, como antes desde el fin de la acción);
- el ownership de la parcela;
- la cosecha exactly-once;
- `growMs`, XP y cosecha.

Un test demuestra que `readyAt − plantedAt` es igual con el mejor y el peor sorteo.

## 6. Presentación

- **Gesto del Pokémon** (`workerPose.TASK_BEATS`): chop, mine y farm con período = `WORK_TICK_MS`, es decir, un gesto por intento. Es una función pura de `workKind`, `startedAt` y el reloj del servidor, así que dueño y observadores dibujan lo mismo. WORLD VISUAL-2 queda intacto: stand del Pokémon, entrenador apartado, un único renderer, retiro al completar o cancelar, y trabajador visible durante una desconexión.
- **Escena del dueño** (Talar/Minería): las timelines empiezan **abiertas** (un golpe por tick, sin fin). Cuando llega la respuesta del servidor se **cierran**: termina el golpe en curso, cae el árbol (sólo si hubo éxito) y aparecen los pops. La escena arranca en la fase del servidor (`serverNow − startedAt`). El golpe de la escena coincide exactamente con el impacto del Pokémon (`CHOP_MS.windup = 270 = impactMs`, `SWING_MS.windup = 264 = impactMs`).
- **Tarjetas**: se quitó la barra (`.wc-progress`, `.fc-progress`) y la estimación de segundos por Pokémon. Muestran "Scyther está talando…", "… picando…" y "… cultivando…". Una parcela que crece sigue diciendo "lista en 45 s", porque el crecimiento es un reloj, no un intento.
- **Observadores**: el anillo ya no se llena. Late con los golpes. Se mantienen las etiquetas "Talando / Picando / Cultivando".
- "Ritmo" (hito cada 10 niveles) quedó absorbido en la curva de nivel. En el roadmap ahora dice "Tus golpes aciertan más seguido", sin prometer un porcentaje.

## 7. Reinicio, desconexión y reconexión: comportamiento exacto

| Momento del reinicio del realtime | Qué pasa | Test |
|---|---|---|
| Acción en `running` | Se pierde: acción, cola y sorteo vivían en memoria y el nodo nunca se persistió como `working`. Sin pago y árbol disponible. Liquidar ese `actionId` en el proceso nuevo es imposible (SKILLS no lo autorizó). El siguiente pedido hace un sorteo nuevo y paga una vez. | `integration.test.js` › *a restart while the Pokémon works…* |
| Después del commit | El nodo agotado se restaura de `world_node_overrides`. Un nuevo `commit_work` con el mismo `action_id` es `applied: false`: XP y materiales una sola vez. | *a restart after the commit never settles twice…* |
| Durante `settling` | La DB decide (transacción única): o está todo o no hay nada. Nunca doble. | cubierto por los dos anteriores + `exactly once` |

- **Sin ventaja por reiniciar o reconectar:** el jugador no conoce `N`. Con tope, seguir es siempre mejor que empezar de nuevo (test en `attempts.test.ts`).
- **Desconexión:** la acción sigue, el Pokémon queda visible en su stand, paga una vez al fin secreto y el resultado aparece en `player:state` al volver.
- **Reconexión antes del fin:** `ownAction` sin fin.
- **Reconexión después:** no hay acción.
- **Movimiento:** salir del anchor antes del éxito cancela sin pago.

## 8. Rate limiting

`services/realtime/src/world/workRateLimit.js`, aplicado primero en `ResourceAuthority.requestWork` y sobre el reloj del servidor:

- **Ráfaga 4 y un token cada 500 ms (2/s).**
  - El bucle legítimo más rápido (éxito de nivel 50 en el primer tick y nuevo pedido) no llega a 1,7/s.
  - La ráfaga cubre un doble toque, un reintento tras `busy`/`too-far` y el primer pedido después de reconectar. Se recarga en 2 s.
- **Por jugador autenticado, no por socket:** reconectar no recarga el bucket.
- **Rechazo gratis:** `rate-limited`, sin lectura de ownership, sin SKILLS, sin reservar nada. Por eso nunca puede terminar en un settlement. Lo que pasa sigue pasando por el dedupe de `requestId` y por todos los chequeos.
- **Métricas:** `actions.rateLimited` y `rejected['rate-limited']`. Hay un log acotado: la primera vez y después una línea por minuto, sólo con totales y sin ids.
- **Memoria acotada:** 10 000 buckets como máximo; los ociosos se descartan primero.
- **Medido:** con bots de uso normal (10 y 30 jugadores, 60 s) hubo 0 intents limitados.

## 9. Pruebas

Totales: Vitest 1732 → **1788** tests (180 → 182 archivos); realtime 157 → **184** pass + 20 skipped (staging).

| Pedido | Test |
|---|---|
| Fórmula por niveles y tiers; `p ∈ (0,1]`; tope; primer tick en nivel máximo; principiante 3–5 s; RNG en extremos; distribución exacta (sin Monte Carlo) | `src/features/skills/domain/attempts.test.ts` (38) |
| Sorteo con el puerto `random`, `durationMs = N × tick`, tope, tick inválido, nada predictivo en la respuesta | `skillsService.test.ts` |
| Ninguna filtración de `endsAt` (escáner de claves y valores) en snapshots, batches, resultados y `ownAction` | `probabilisticWork.test.js` › *the drawn end never reaches any client* |
| Sincronía dueño/observador, `worker.stand`, fase compartida | `probabilisticWork.test.js`, `workerPose.test.ts`, `gatheringOverlayCore.test.ts` |
| Cancelación antes del éxito; movimiento; desconexión y reconexión | `probabilisticWork.test.js` |
| Reinicio sin doble settlement (running y post-commit) | `integration.test.js` (PGlite en disco) |
| Carreras por el mismo recurso | `resourceAuthority.test.js`, `integration.test.js`, `workRateLimit.test.js` |
| El mismo `actionId` 1, 2 y 20 veces; 20 intents con el mismo `requestId` | `probabilisticWork.test.js` |
| Spam y rate limiting con reloj controlado | `workRateLimit.test.js` (9) |
| Talar, Minería, plantar, cosechar; crecimiento sin cambios | `integration.test.js` |
| Cliente sin barra (WorkCard, FarmCard) | `skillsUi.test.ts` |
| Cliente incompatible rechazado (authority, transporte, SharedWorld real) | `probabilisticWork.test.js`, `PresenceRoomWorld.test.js`, `sharedWorld.acceptance.test.ts` |
| Protocolo y tipos | `worldProtocol.d.ts`, `worldRoom.d.ts`, typecheck, `skillPolicy.test.js` |
| Nodos agotados y respawn independientes del sorteo | `probabilisticWork.test.js` |

### Mutation checks (temporales, todos restaurados; worktree limpio después)

| Mutación | Detectada por |
|---|---|
| `endsAt` en nodos públicos | `probabilisticWork` (escáner) · `worldRoom` |
| `endsAt` en `work:result` | `probabilisticWork` · `worldRoom` · `resourceAuthority` |
| `endsAt` en `ownAction` | `probabilisticWork` · `worldRoom` (reconexión) |
| Doble settlement (sin guardia de fase `running`) | `probabilisticWork` (1/2/20) · `resourceAuthority` |
| Cliente viejo aceptado | `probabilisticWork` · `PresenceRoomWorld` |
| Rate limit deshabilitado | `workRateLimit` (spam, por jugador, reconexión, log) |
| Tope incorrecto (⌈2/p⌉) | `attempts` (tabla de topes, tope 40, tiempos) |
| RNG incorrecto (`<=` en vez de `<`) | `attempts` (fallos antes del éxito) |
| RNG no inyectado (`Math.random`) | `skillsService` (sorteo guionado, tope) |
| γ incorrecto (1) | `attempts` (tabla, x²) |
| Barra restaurada en WorkCard | `skillsUi` › WorkCard sin barra |
| Barra restaurada en FarmCard | `skillsUi` › FarmCard sin barra |

Cada mutación se aplicó con un script, se corrieron los tests relevantes (todas hicieron fallar al menos uno), y el archivo se restauró con `git checkout` antes de pasar a la siguiente. Al final, `git status` estaba limpio.

## 10. Gates

| Gate | Resultado |
|---|---|
| Tests enfocados | ✓ |
| Realtime completo (`node --test`, Node 24.21 portable) | ✓ 185 pass · 0 fail · 20 skipped (staging) |
| Integración / PGlite | ✓ (`integration.test.js` 11, `database.test.js`, `edgePath.test.js` incluidos arriba) |
| Vitest completo | ✓ 183 archivos · 1803 tests |
| Pacing y drift del modelo (`pacing.test.ts`, 15) | ✓ |
| Typecheck (`vue-tsc`) | ✓ |
| Lint | ✓ 0 errores · 9 warnings (los mismos de antes, `AuthModal.vue`) |
| Build | ✓ |
| Drift de SKILLS (`bundle-skills.mjs --check` + `serverBundle.test.ts`) | ✓ |
| Deno (`supabase/functions/world-authority`) | **no corrido**: Deno no está instalado en esta máquina. `supabase/` no cambió en esta rama, y el handler sí se ejecutó bajo Node 24 en `edgePath.test.js`. |
| Staging local (RC-0.3) | **no disponible**: faltan Docker y el CLI de Supabase. Los 20 tests de `staging.test.js` quedaron *skipped*: RLS/ACL de tablas y funciones del mundo, la edge function con secreto, settlement/concurrencia/atomicidad contra Postgres real, el gate de testers, identidad JWT y los 4 flujos WORLD-on-Supabase. Ya están adaptados a PROB-2 (`privateDuration`, `scriptedRandom`), pero no se ejecutaron. No se reemplazaron por una simulación. |

**Entorno:** el Node del PATH es 18.14, y con él la suite del realtime ya fallaba antes de estos cambios (Colyseus 0.18 y PGlite). Con autorización se usó el zip oficial `node-v24.21.0-win-x64` (SHA-256 verificado contra `SHASUMS256.txt`) en una carpeta temporal, sin instalarlo ni tocar el PATH del sistema.

### Carga (`scripts/benchmark-world.mjs --skills real`, 60 s, PGlite en memoria)

Mismas condiciones en las tres corridas: `node scripts/benchmark-world.mjs --players N --duration 60 --skills real`, Node 24.21, SKILLS real sobre PGlite en memoria, 129 nodos objetivo en Pradera, bots que caminan a paso de carrera y trabajan.

| Jugadores | Pedidos | Acciones pagadas | accepted→done p50 / p95 / máx | rate-limited | Duplicados | Fallos de settlement / PlayerData | commit p95 | Mundo KiB/s/cliente | msgs mundo/s/cliente | Memoria RSS / heap | Event loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 206 | 19 | 2,46 / 8,46 / 8,46 s | 0 | 0 | 0 / 0 | 9,8 ms | 0,30 | 1,49 | 315 / 30 MB | 34,3 ms |
| 30 | 347 | 55 | 3,61 / 10,23 / 14,44 s | 0 | 0 | 0 / 0 | 4,0 ms | 0,55 | 2,25 | 336 / 36 MB | 34,3 ms |
| 100 | 23 655 | 100 | 3,01 / 9,61 / 13,86 s | **16 244** | 0 | 0 / 0 | 9,8 ms | 1,04 | 6,15 | 328 / 30 MB | 38,6 ms |

- `accepted→done` reemplaza al viejo `settleLagMs`, que se medía desde el `endsAt` público y ahora no existe. Las medianas (2,5–3,6 s) están en el rango de la media teórica de nivel 1 (3,0–4,6 s según aptitud) y ningún máximo supera el tope más su commit.
- **CPU:** el benchmark no la mide (su salida no trae contador de CPU del proceso) y no se agregó uno; se usa el event loop p99 como indicador. El p50 ≈ 31 ms de las tres corridas es la granularidad del medidor en Windows; el máximo de ~1,3 s corresponde al arranque de PGlite (`loadNodes` 1,7–3,2 s).
- **Los 16 244 `rate-limited` de 100 jugadores no son una degradación.** Lo verifiqué con un A/B: el mismo benchmark de 100 jugadores sobre `db38aaa` (el commit anterior al rate limit), en un worktree temporal que después borré:

  | 100 jugadores | Pedidos | Pagadas | accepted→done p50 / p95 | too-far | no-room | rate-limited | RSS |
  |---|---|---|---|---|---|---|---|
  | sin limiter (`db38aaa`) | 23 713 | 102 | 3,04 / 10,83 s | 14 920 | 8 352 | — | 451 MB |
  | con limiter (esta rama) | 23 655 | 100 | 3,01 / 9,61 s | 4 380 | 2 636 | 16 244 | 328 MB |

  El volumen de pedidos es el mismo con o sin limiter. Lo generan los bots: el servidor aparta al entrenador (WORLD VISUAL-2), el bot no sigue esa posición y reintenta a 7,5 Hz pedidos que el servidor ya rechazaba gratis (`too-far`, `no-room`). El limiter sólo cambia el motivo de rechazo de ~2/3 de ese spam. Las acciones pagadas (100 contra 102) están topadas por la oferta de nodos: se agotaron 100–102 nodos y el respawn de 90 s no llega a ocurrir dentro de los 60 s de corrida. Con 30 jugadores hubo 0 pedidos limitados. El cliente real no reintenta así: bloquea el input mientras trabaja y cada pedido es un toque.
- **Sin errores:** 0 fallos de settlement, 0 reintentos, 0 fallos de PlayerData y 0 duplicados en las tres corridas.

## 11. Diferencias respecto de la auditoría

- **Sin período de gracia ni alias `endsAt = endsBy`** para v1, por decisión tomada: un cliente incompatible recibe `client-outdated`. Por eso tampoco se envían `attemptMs` ni `endsBy`: el tick es una constante del protocolo 2.
- **`work:done` no lleva `attempts`** (la auditoría lo proponía como opcional), porque el cliente no debe conocer la cantidad sorteada.
- **`details` no lleva `chance` ni `expectedMs`**, y las tarjetas ya no muestran tiempos: no se muestra probabilidad ni duración esperada.
- **Rate limit con ráfaga 4 y 2/s** (la auditoría sugería 4/s con ráfaga 6), justificado en §8. No se agregó la cache negativa de ownership; el limiter acota ese costo.
- **Tick como constante única** (`WORK_TICK_MS`), no configurable en caliente. SKILLS valida que esté entre 400 y 1200 ms.
- **Cultivos con tier por peldaño** para `pMax`.
- **Ritmo absorbido** (recomendación D3) y cambio de texto en el roadmap.
- "Minando" → "Picando".
- El anillo de observadores late en vez de quedar estático.
- `workDuration`/`MIN_ACTION_MS` se conservan sólo para `scripts/map/audit-pradera.ts` (auditoría MAP-1 histórica). `scripts/skills/pacing.ts` ya usa el modelo probabilístico (§14).

## 12. Riesgos pendientes

1. **Staging RC-0.3 y Deno sin ejecutar en esta máquina** (§10). Hay que correrlos antes de publicar.
2. **Ritmo de XP**: hasta ~1,56× acciones/materiales por hora en nivel alto. Se observa con `rules_version = 'skills-1.1'`.
3. **Pacing: simplificación de desplazamiento.** `pacing.ts` ya usa el modelo probabilístico canónico (§14), pero sigue cobrando el desplazamiento como `walk / charges` (cargas advisory del catálogo), aunque en el mundo compartido cada éxito agota el nodo. Es una simplificación anterior a PROB-2 que no cambié para no mezclar dos efectos. Si se quiere reflejarla, subiría por igual los tiempos de todas las habilidades de recolección.
4. **Un reinicio sigue perdiendo las acciones en curso** (igual que antes). Nunca paga dos veces, pero el jugador tiene que volver a pedir.
5. **El éxito visible llega una latencia de commit después del tick ganador.** En el benchmark, el commit p95 fue de 4–10 ms en PGlite; con la edge function real será mayor.
6. **Los navegadores con el bundle viejo en cache** reciben `client-outdated` hasta recargar. El texto dice "Actualizá la página para seguir trabajando".
7. **El rate limit vive en memoria por proceso**: un reinicio lo vacía. Con una sola instancia de realtime alcanza.
8. **Event loop del benchmark**: p50 ≈ 31 ms en Windows (granularidad del medidor) y máx ≈ 1,3 s al arrancar PGlite. El benchmark no mide CPU.
9. **Bots del benchmark desincronizados**: con 100 jugadores generan ~390 pedidos/s de spam que el servidor rechaza (§10). No afecta el resultado, pero infla `requested` y `rate-limited`. Si se quiere medir contención real, el bot debería seguir la posición autoritativa.

## 13. Prueba humana posterior

1. Instalar dependencias y usar Node ≥ 20. Levantar el stack local:
   ```bash
   node scripts/integration/lan-stack.mjs --dev --reset-db
   ```
   Abrir `http://<host>:5190/?benchmarkId=pc&area=pradera` y, en otro dispositivo o ventana, `?benchmarkId=obs&area=pradera`.
2. **Talar nivel 1:** en el bosque, elegir un árbol común y un Pokémon.
   - La tarjeta dice "X está talando…", **sin barra ni segundos**.
   - El Pokémon golpea una vez cada ~0,6 s y el árbol tiembla con cada golpe.
   - Entre 1 y ~11 s aparece el éxito: último golpe, el árbol cae, +10 XP, +1 tronco.
   - Repetirlo varias veces: los tiempos varían y ninguno pasa de ~11,4 s.
3. **Observador:** desde la segunda identidad, mirar al trabajador.
   - Mismo Pokémon en el mismo stand, golpeando en la misma fase.
   - El anillo late y no se llena.
   - El árbol cae para los dos a la vez.
4. **Minería:** una roca en la cantera. Igual, con "picando".
5. **Agricultura:** plantar Baya Aranja, cuidar y cosechar.
   - Las tres acciones: sin barra, con "cultivando…".
   - Mientras crece, la tarjeta sí dice "lista en N s".
6. **Cancelaciones:** alejarse durante el trabajo (se cancela, sin XP) y cerrar la pestaña del dueño a mitad de camino.
   - Con la pestaña cerrada, el observador sigue viendo al Pokémon trabajar hasta el final.
   - Al volver, la XP ya está.
7. **Rate limit:** pedir trabajo muchas veces seguidas rápido. Aparece "Más despacio: esperá un momento." y no se paga nada extra.
8. **Cliente viejo:** abrir un build anterior (protocolo 1) contra este servidor. No ve el mundo compartido y al trabajar recibe "Actualizá la página para seguir trabajando".
9. **DevTools → Network → WS:** confirmar que ningún frame `world:*` contiene `endsAt`, `durationMs`, `attempts` ni `chance`.

## 14. Pacing (`scripts/skills/pacing.ts`)

**Estado final.** El modelo vive ahora en `src/features/skills/domain/pacing.ts`; el script quedó sólo como línea de comandos.

- **Sin fórmula propia.** Cada acción cuesta su tiempo esperado exacto bajo el sorteo del servidor, `WORK_TICK_MS × expectedAttempts(attemptChance(…), attemptCap(…))`, con las funciones y constantes canónicas de `attempts.ts` y `balance.ts` y el tick del contrato de protocolo.
- **Agricultura:** plantar, cuidar y cosechar se calculan igual, con el tier de cada cultivo. El crecimiento sigue siendo `growMs`.
- **Sin cambios:** los supuestos de overhead, walk y parcelas.

**Guardia anti-drift** (`src/features/skills/domain/pacing.test.ts`, 15 tests):

- **Constantes fijadas:** tick 600, γ 2, desbloqueo 1,25, tope ⌈3/p⌉ en [3, 40], p ≤ 0,98, `pMax` por tier y límites del tick.
- **Pacing = modelo:** el tiempo del pacing es Σ n·P(n)·tick de la distribución exacta, para todo recurso, nivel y aptitud.
- **Servidor = fuente:** a partir del **bundle del realtime** se recupera `p` por bisección sobre su `random` inyectado (un tick ⇔ roll < p) y se verifica el tope con el peor roll. Tiene que coincidir con la fuente TypeScript en árbol común, pino, roca y en plantar, cuidar y cosechar de los cinco tiers de cultivo, con aptitudes 2 y 5 y varios niveles.
- **Tick fuera de rango:** el bundle rechaza ticks fuera de [400, 1200].
- **WORLD → SKILLS:** un test del realtime verifica que WORLD pasa a SKILLS exactamente `WORK_TICK_MS`.

**Mutation checks del guardia** (todas detectadas y restauradas):

| Mutación | Detectada por |
|---|---|
| γ del bundle 2 → 1,9 | `pacing.test.ts` (servidor ≠ fuente) |
| Desbloqueo del bundle 1,25 → 1,2 | `pacing.test.ts` |
| Tope del bundle ⌈3/p⌉ → ⌈4/p⌉ | `pacing.test.ts` |
| `pMax` especializado del bundle 0,48 → 0,5 | `pacing.test.ts` |
| Tick 600 → 650 | `pacing.test.ts` (constantes) |
| Pacing de vuelta a duración fija | `pacing.test.ts` |
| γ de la fuente cambiado sin regenerar el bundle | `pacing.test.ts` + `serverBundle.test.ts` |
| WORLD pasando otro tick a SKILLS | `probabilisticWork.test.js` |

**Resultado del pacing** (aptitud 3, overhead 1,5 s, walk 8 s, 4 parcelas), en horas de juego activo:

| Habilidad | Nv 10 | Nv 25 | Nv 40 | Nv 50 (antes → ahora) |
|---|---|---|---|---|
| Talar | 0,24 h | 1,20 h | 4,86 h | 17,10 → **13,78 h** |
| Minería | 0,25 h | 1,29 h | 6,18 h | 21,83 → **19,66 h** |
| Agricultura | 0,27 h | 1,17 h | 5,40 h | 19,10 → **19,08 h** |

Talar a Nv 50 queda ~19 % más rápido que con la duración fija, Minería ~10 % y Agricultura igual (la domina el crecimiento). Es la consecuencia esperada de γ = 2 y del aumento de acciones por hora en niveles altos (§2). No se tocó el balance.

## 15. Cambios respecto de la versión anterior de este informe

- **Benchmark:** se agregó la corrida de **100 jugadores** y el A/B contra el commit sin rate limit (§10). Las cifras de 10 y 30 no cambian.
- **Pacing:** `pacing.ts` pasó del modelo de duración fija al modelo probabilístico canónico, con guardia anti-drift (§14). El riesgo 3 anterior ("pacing sigue modelando duraciones fijas") se reemplazó por la simplificación de desplazamiento que todavía queda.
- **Gates:** realtime 184 → **185** pass (nuevo test del tick WORLD → SKILLS); Vitest 1788 → **1803** (`pacing.test.ts`).
- **Comentarios:** los de `balance.ts` y `workRules.ts` ya no dicen que el pacing usa `workDuration`, y las horas de referencia de `XP_CURVE` son las del pacing probabilístico.

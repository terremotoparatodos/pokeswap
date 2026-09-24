# PERF-0 — Baseline técnica de PokeSwap 0.2 (Performance & Foundation)

> Fecha: 2026-09-23 (America/Buenos_Aires) · Auditoría de sólo lectura sobre el código.
> Único archivo agregado por PERF-0. No se cambió código, configuración ni despliegues.
> Convención: **FACT** (comprobado en código, git, ejecución o producción), **INFERENCE** (deducido, falta medir), **OPEN QUESTION**.
>
> Documentos que este reemplaza como punto de entrada: `PLAYTEST_0_1_BASELINE.md` (PERF-00, 2026-09-20)
> queda como registro histórico. Sus §1–§15 describen el código de `ae28451`; sólo su §16 describe trabajo posterior.

---

## 1. Estado actual

### 1.1 Git y producción

| Qué | Valor | Evidencia |
|---|---|---|
| Rama de trabajo y de producción | `playtest/community-0.1` | FACT |
| HEAD | `92ed74aeab6f8467cf3b03adf93c133dccb432f4` (merge PR #24, hint tray) | FACT |
| Local vs remoto | El checkout estaba **41 commits atrás** de `origin`. Se hizo `git merge --ff-only` (sin tocar archivos no trackeados). Hoy local = `origin` | FACT |
| Frontend servido en `pokeswap.lol` | `92ed74a` (string en `assets/playtestBuild-*.js`) | FACT, verificado hoy |
| Colyseus (`/version`) | `commit b224ac0`, `protocol 2`, iniciado 2026-09-24T00:14Z | FACT, verificado hoy |
| Código de servidor en HEAD vs desplegado | Idéntico: `92ed74a` no toca `services/realtime` | FACT |
| Working tree | Limpio en archivos versionados. Sólo no trackeados (ver §9.1) | FACT |
| Tags | Sólo `v0-legacy-baseline`. **No hay tag del Playtest 0.1** | FACT |

Ramas relevantes (relativas a HEAD):

| Rama | Relación | Nota |
|---|---|---|
| `origin/docs/session2-closeout` @ `28f71cf` | **+1 commit sólo de docs, sin mergear** | Cierra la sesión 2 del worklog y corrige `HANDOFF.md` §1 (~10 fps). Hasta que se mergee, `HANDOFF.md` en HEAD sigue desactualizado |
| `origin/docs/performance-stability-handoff` | ancestro (27 atrás) | Base del master handoff; ya integrada |
| `origin/feat/wildlands-r30-cloud-deploy` @ `ae28451` | ancestro (31 atrás) | Era la rama que desplegaba Colyseus hasta el 2026-09-23 |
| `origin/feat/ranch-1-prototype` | 9 commits propios, base `main` (279 atrás) | Prototipo `/rancho`. **No integrado**; fuera de alcance de 0.2 |
| `main` / `origin/main` @ `480b352` | 279 commits atrás | Línea R30. Nada de R31–R33, ciudad 3D ni playtest |
| `integration/pre-r34-town-3d`, `integration/r31`, `feat/r3x-*` | ancestros | Historia ya consolidada |

### 1.2 Gates ejecutados en HEAD (esta máquina: Windows 10, Node 24.19)

| Gate | Resultado |
|---|---|
| `npx vitest run` | **1.942 / 1.942**, 174 archivos, 30 s |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errores, 9 warnings antiguos (`AuthModal.vue`) |
| `VITE_PLAYTEST=on vite build` | OK. Chunks mayores: `WildlandsView` 337 kB (113 kB gz), `index` 335 kB, `ProfessionWorldDemo` 219 kB, `PlayDungeon` 130 kB |
| `services/realtime` `npm test` | **64 / 64** con Colyseus 0.18.13 real |
| `npm run benchmark:multiplayer -- --players 30 --duration 20 --protocol 2` | 18,75 KiB/s por cliente, 5.952 updates lógicos/s totales, RTT ack p95 4,7 ms / p99 6,8 ms, 0 rechazos. Coincide con la sesión 2 (18,59 KiB/s) → la herramienta es reproducible |

No se midió frame time en navegador en PERF-0 (ver §6 y §10: el HUD actual no mide lo que necesitamos).

### 1.3 Arquitectura general

- **Frontend:** Vue 3 + Vite + vue-router, TypeScript. Juego en Canvas 2D propio (sin engine). Todo el mundo jugable vive en `src/features/wildlands/` (~11.000 líneas sin tests).
- **Realtime:** Colyseus 0.18.13 en `services/realtime` (Node 22 en Colyseus Cloud, Miami, límite 100 conexiones). Presencia **efímera**: posición, dirección, velocidad, identidad visual y chat de área. Sin persistencia.
- **Supabase:** auth, catálogo/Pokédex, perfil, plaza (Pokémon propios), gate del playtest (`playtest_gate`). El motor del juego no escribe en Supabase.
- **Build modes (constantes de compilación):** `VITE_PLAYTEST=on` (build pública actual), `VITE_PERF=on` (HUD y cronómetros locales), normal (producto de `main`, hoy no publicado). Los modos **cambian el runtime**: p. ej. DPR máximo 1 en playtest y 2 en normal (`renderer.ts:85`).
- **Despliegue:** push a `playtest/community-0.1` → GitHub Actions construye con `VITE_PLAYTEST=on` y publica en Cloudflare Pages como producción (`--branch=main`). Colyseus Cloud redespliega solo, vía integración de GitHub, cuando el push toca `services/realtime` (INFERENCE fuerte del worklog; 3 de 3 casos).

---

## 2. Evolución: Playtest 0.1 → HEAD

### 2.1 Punto de referencia del Playtest 0.1

No hay tag. Reconstrucción con `gh run list` del workflow de deploy:

| UTC (ART = UTC−3) | Commit | Qué |
|---|---|---|
| 09-19 18:12 | `d502b4f` | **Primer deploy público** del build playtest |
| 09-19 21:51 → 22:36 | `32e3d75` `8a6d443` `41f3bd5` `22dd25b` `7072910` `ae28451` | **Hotfixes en vivo durante el stream** (6 deploys en 45 min) |
| 09-21 23:20 | `5ffd09e` | Siguiente deploy: la campaña PERF-01…06 |

- **Referencia elegida:** el Playtest 0.1 es el rango `d502b4f → ae28451`. `ae28451` es el estado al cierre del día y el que auditó PERF-00.
- **Certeza:** alta para el rango. **Media** para asignar un clip o reporte a un build concreto: el código cambió seis veces mientras se jugaba.
- OPEN QUESTION (heredada de PERF-00 §14): ¿qué reportes corresponden a `d502b4f` (3D en CPU, NPCs, DPR 2) y cuáles a `ae28451` (mitigado)?
- Propuesta, no aplicada: tag anotado `playtest-0.1-end` en `ae28451`.

### 2.2 Qué pasó después (37 commits, 33 sin merges; 17 con autor `Claude` desde un contenedor en la nube, 16 del usuario/otros agentes)

**09-20 — PERF-00.** Auditoría de sólo lectura. Commiteada después, dentro de `5ffd09e`.

**09-21 — Campaña PERF-01…06 (`5ffd09e`, un solo commit: 46 archivos, +2.364 / −217) y dos fixes:**

| Área | Cambio |
|---|---|
| Networking | AOI de ciudad a 20 tiles; recalcular el interés cuando el propio viewer se mueve; batching de 50 ms (`presence:batch`); `BenchmarkPresenceRoom` sólo fuera de producción |
| Multiplayer cliente | Actores remotos incrementales por id (ya no se reconstruye la multitud por delta); cola de pasos remotos con backlog máximo de 3 |
| Sprites | Caché de hojas de entrenador por URL (`characters.ts:226`) |
| Rendering | `ProjectionRowCache` (geometría por fila estable); colecciones reutilizadas en el hot path; **ruta 3D de ciudad retirada** del gameplay (fachadas 2D pre-renderizadas); clima −60 % de partículas con tope |
| NPC | Residentes y wanderers de ciudad **reactivados** (el playtest los había apagado) |
| Chunks | LRU de 16 canvases por mundo; `releaseCanvases()` al salir del mundo; precarga de vecinos por `requestIdleCallback`; warm del 3×3 inicial bajo la pantalla de carga |
| UI | Paneles y menús ya no bajan el loop a 10 fps: sólo bloquean input |
| Tooling | `VITE_PERF=on`; HUD con p95/p99/máx, fases del renderer y métricas de chunks; `npm run benchmark:multiplayer` |

- `01037df` — el cliente rechaza posiciones autoritativas dentro de sólidos y vuelve a un spawn seguro.
- `26f3b7c` — la escala de cámara ya no depende de `window.outerWidth` (roto en navegadores embebidos).

**09-23 — Estabilidad de presencia (master handoff `cba10e6` → sesiones 1 y 2 → PRs #22, #23, #24):**

| Área | Cambio | Commit |
|---|---|---|
| Bug | Contrato único de llegada entre cliente y servidor (`protocol/arrival.js`). Eliminó el bucle infinito "punto seguro" de Pradera: el servidor mandaba a (8,41), un sólido en Pradera | `5c65765` / `efd0518` |
| Networking | Token bucket 10/s con ráfaga 15; los rechazos se nombran (`invalid`/`replay`/`rate`); un rechazo por ritmo consume la secuencia y devuelve `presence:self` | `f4d0e1f`, `1fd49ac` |
| Networking | Protocolo 2: deltas `step` compactos, −38 a −45 % de bytes medidos con msgpack | `c8f121b` |
| Bug | La secuencia de movimiento ya no vuelve a 0; barrera `awaitingAreaSnapshot` contra acks viejos | `487ffb8` |
| Bug | `TownArea.isReachable()`: 68 casillas transitables pero inalcanzables ya no se aceptan como posición | `40e672f` |
| Bug | `KeyboardInput.detach()` limpia las teclas sostenidas (personaje que caminaba solo tras cambiar de pestaña) | `fa852ba` |
| Tooling | `GET /version` público, `/metrics` interno, `PresenceDiagnostics` en el HUD, harness determinista `scripts/presence-harness`, bytes wire reales y `--protocol` en el benchmark | `5f0c911` `c535333` `752b5bf` `4ac8a20` |
| UI | Bandeja única de pistas del mundo (fuera del alcance de rendimiento) | `57e77e2` |

- FACT: las correcciones de servidor aparecen **dos veces** en la historia: commit original + cherry-pick del hotfix, por ejemplo `5c65765`/`efd0518`. Es inofensivo, pero conviene saberlo al hacer bisect o blame.
- Archivos con más movimiento desde el playtest: `PresenceRoom.js` (10 commits), `game.ts` (6), `renderer.ts` (5), `WildlandsView.vue` (5), `movement.js` (5).
- Eliminaciones: ninguna. Se agregaron 72 archivos y se modificaron 49.

---

## 3. Trabajo posterior que sigue vigente (verificado leyendo HEAD)

| Mejora | Dónde vive hoy | Estado en HEAD |
|---|---|---|
| Remotos incrementales | `engine/game.ts:493-607` (`replaceRemoteActors`, `applyRemoteActor`, `queueRemoteStep`) | FACT vigente |
| Caché de trainer sheets | `engine/characters.ts:226,255` | FACT vigente. Los fallos no se cachean |
| Cola de pasos remotos (backlog 3) | `game.ts:44,557-588` | FACT vigente. Distancia ≠1 o backlog lleno → **snap** |
| AOI de ciudad 20 tiles; wild por sectores 12×12 ±1 | `services/realtime/src/presence/interest.js` | FACT vigente |
| Batching 50 ms con coalescing por actor | `PresenceRoom.js:42,216-235` | FACT vigente (ver riesgo R7) |
| Deltas `step` (protocolo 2) | `PresenceRoom.js:185-201`; cliente `colyseusPresence.ts:167-177` | FACT vigente, en producción |
| Token bucket y consumo de secuencia rechazada | `presence/movement.js` | FACT vigente |
| Contrato de llegada | `services/realtime/src/protocol/arrival.js` + `arrivalContract.test.ts` | FACT vigente |
| Reconciliación local con barrera y secuencia monotónica | `game.ts:415-485, 750-755` | FACT vigente |
| `isReachable` en la ciudad | `areas/townArea.ts:280-290` | FACT vigente |
| Teclado limpia al hacer `detach` | `engine/keyboard.ts:46` | FACT vigente |
| Ruta 3D fuera del renderer | `renderer.ts` no importa `townModel`; lo fija `rendererPlaytestPerformance.test.ts` | FACT vigente. `townModel.ts` quedó huérfano en runtime (§9) |
| DPR 1 | `renderer.ts:85` | FACT, **sólo** con `VITE_PLAYTEST=on`. El build normal usa DPR 2 |
| NPCs de ciudad | `areas/townPopulace.ts` sin gating | FACT: reactivados (14 residentes + 5 wanderers + plaza) |
| Row cache de proyección | `engine/projectionRows.ts` | FACT vigente. Sigue habiendo **un `drawImage` por fila de pantalla** |
| Chunks LRU, liberación y precarga ociosa | `engine/chunks.ts:218-359`, `areas/wildArea.ts` | FACT vigente |
| Pausa a frecuencia completa | `game.ts:327-334`, `gamePause.test.ts` | FACT vigente. `HANDOFF.md` en HEAD todavía dice ~10 fps |
| Diagnóstico de presencia y fases en el HUD | `multiplayer/domain/presenceDiagnostics.ts`, `playtest/components/PlaytestPerformanceHud.vue` | FACT vigente |
| `/version`, `/metrics` | `services/realtime/src/observability/` | FACT vigente, verificado en producción |

No se encontró trabajo posterior que haya sido revertido. El único revert (`3bab21e`) deshizo el cierre del registro de usuarios del 09-19, anterior al playtest y no relacionado con rendimiento.

---

## 4. Arquitectura del runtime

### 4.1 Arranque (`components/WildlandsView.vue:445-495`)

```text
onMounted
  ├─ listPokemon() + preloadLobbyArt()      (Supabase + imágenes)
  ├─ auth listo → chat/playtest store (import dinámico, sólo playtest)
  ├─ new WildlandsGame(canvas, {...})       → Atlas → Area inicial → Populace
  ├─ await game.prepare()                   → warm del 3×3 de chunks (sólo wild, requestIdleCallback)
  ├─ ColyseusPresence.connect()             → joinOrCreate('presence', token, protocol 2) → 'presence:ready'
  └─ game.start()                           → keyboard.attach + rAF
```

### 4.2 Un frame (`engine/game.ts:825-847`)

```text
requestAnimationFrame(loop)
  dt = clamp(now - last, 0, 50 ms)          ← timestep VARIABLE, sin acumulador fijo
  update(dt)
    ├─ travel.update → enterArea() si terminó el fade
    ├─ input: KeyboardInput.direction | TapNavigator.next (A*, radio 40, ≤5.000 nodos, sólo al tap/replan)
    ├─ driveWalker(player)                  ← movimiento por tiles, progress 0..1 a speed tiles/s
    │     └─ onPlayerArrive → presence.move(dir, running, ++seq)   (sólo intención, nunca posición)
    ├─ companion.update
    ├─ populace.update + wander/advance     (todos los actores de la zona activa, sin sleeping por cámara)
    ├─ advanceRemoteActors (cola de pasos)
    ├─ cámara = actorPosition(player)       ← REDONDEADA a píxel entero de mundo
    ├─ clima (cada 0,5 s)
    └─ HUD cada 0,15 s → onHud() → Object.assign(reactive) + minimapa
  renderer.render(scene(), dt)
    ├─ canvas.width/height = clientSize × min(DPR, 1|2)
    ├─ composeGround: agua animada + area.drawGround (chunks 512² o imagen de ciudad) + grid/pads/route/overlay
    ├─ projectGround: 1 drawImage por fila de pantalla (Mode-7)
    ├─ collect: decorIn() + overlay sprites + actores → proyección → culling por pantalla
    ├─ sort por profundidad → sombras → sprites (x/y/w/h redondeados) → nameplates/chat/labels
    └─ SceneLighting (tinte, glows, clima, viñeta, fade)
  area.tick()                               ← LRU de chunks
  métricas: workMs = update + render + tick (CPU), anillo de 180 muestras
```

### 4.3 Red (presencia)

```text
cliente                                     servidor (PresenceRoom, en memoria)
move{dir,running,seq} ───────────────────►  applyMove: dirección válida, seq > última, token bucket
                                             ├─ acepta: tx/ty += 1  (SIN colisión en servidor)
                                             ├─ publish → broadcastDelta → por observador: AOI → pendingDeltas[actor] = último
                                             ├─ syncVisibility(viewer) (entradas/salidas por mover al viewer)
◄──────────────── presence:self (inmediato) ─┘  sendSelf
◄──────────────── presence:batch cada 50 ms ─── flushDeltaBatches (último estado por actor en la ventana)
ColyseusPresence.apply → game.upsertRemoteActor → queueRemoteStep
game.setAuthoritativeActor(self) → reconciliación: nunca retrocede la predicción; si difiere → placePlayer (teleport)
area:{areaId} → changeArea → arrivalFor() → snapshot + chat:history
```

- FACT: la autoridad del servidor es de **ritmo y secuencia**, no de colisión. La transitabilidad la decide el cliente. Está documentado y no se cambia sin decisión de producto.

### 4.4 Sistemas: qué existe y qué no

| Sistema | Qué hay en el repo |
|---|---|
| Loop | Un solo rAF para input, simulación, render y housekeeping. Timestep variable con clamp de 50 ms. Pausa real sólo con la pestaña oculta |
| Cámara | Fija al jugador en píxeles enteros de mundo. Easing sólo en saltos >3 tiles. Lentes `handheld`, `dramatic`, `cenital` y `town` con blend. Zoom = lens × viewportScale × `fit`, con `fit` continuo entre 0,55 y 1 según el tamaño del canvas |
| Mapas | Ciudad Corazón 64×51 (imagen de suelo + decor declarado). Cinco mundos procedurales por semilla (`areas/atlas.ts`) |
| Chunks | 32×32 tiles → canvas 512×512 (~1 MiB). Build síncrono en `get()` si falta. LRU de 16. Precarga ociosa. Liberación al salir |
| Props y vegetación | Decor procedural por chunk (wild) o lista declarada (ciudad), filtrada por frame con `decorIn` |
| Sprites | `Sprite` = canvas + sombra pre-horneada. Trainers procedurales como fallback, luego la hoja real (cacheada). Pokémon: overworld sheet o front sprite ×0,5 |
| Animación | `walkClock` por actor. Frames por dirección. Pokémon con idle-step |
| NPC | Ciudad: residentes estáticos, wanderers y Pokémon de plaza. Wild: `Population` por chunk (Pokémon + trainers) |
| Pathfinding | A* 4-direccional por tap o replan (máx. 3 replans) |
| Colisiones | `area.isSolid` + `PlacedObjects` + ocupación lineal (`.some` / `[player, ...actors]`). Sin índice espacial |
| Remotos | Actores `remote` + companions, con cola de pasos. Sin buffer temporal, sin timestamps, sin extrapolación |
| Lifecycle | `enterArea` recrea `Populace` y limpia placed objects. `destroy()` cancela rAF y teclado. La View limpia listeners y sockets |
| Assets y caches | `trainerSheetCache`, `pokemonInfoCache` (sin eviction, catálogos finitos), chunks LRU. `preloadLobbyArt` |
| Timers | `setInterval` sólo en profesiones, plaza, swap y dungeon, todos con cleanup en unmount (PERF-00 §9, no re-auditado en detalle) |
| Workers / OffscreenCanvas / pooling / batching de draw | **No existen**. El único trabajo fuera del frame es `requestIdleCallback` para chunks |
| Culling | Por pantalla, en `collect`, **después** de simular todo. Sin culling de simulación |

---

## 5. Riesgos técnicos

Ordenados por impacto potencial sobre la estrategia 0.2, no por probabilidad.

**R1 — Topología de despliegue: un push a `main` pisaría producción.**
- FACT: `deploy-community-playtest.yml` publica el playtest con `--branch=main` en el proyecto Pages `pokeswap`.
- FACT: `deploy.yml` corre en cada push a `main` y publica en el mismo proyecto.
- INFERENCE fuerte: cualquier merge a `main` reemplazaría `pokeswap.lol` por la build R30 de `main`.
- Además, `feat/ranch-1-prototype` está basada en `main`.
- **Requiere decisión antes de tocar `main`.**

**R2 — Producción sin CI.**
- FACT: `ci.yml` sólo corre en PRs hacia `main`/`migration`.
- FACT: el deploy de playtest no ejecuta tests.
- Cada merge a la rama productiva publica el frontend y, si toca `services/realtime`, también el servidor, sin gate automático.

**R3 — La métrica de frame no mide la fluidez percibida.**
- FACT: `frameMs`/p95/p99 miden `update + render + tick` (CPU del motor).
- No miden:
  - el intervalo entre rAF;
  - frames perdidos;
  - trabajo de Vue (HUD a ~6,7 Hz, minimapa);
  - decodificación de mensajes de red;
  - GC;
  - composición o GPU.
- Un p99 de 2,8 ms es compatible con microtirones visibles.

**R4 — Cuantización de movimiento a píxel entero con timestep variable.**
- FACT: `actorPosition` redondea a píxel de mundo y la cámara lo sigue (`actors.ts:86`, `game.ts:898-909`).
- FACT: caminar es 3,75 tiles/s × 16 = 60 px/s (exactamente 1 px por frame a 60 Hz); correr es 120 px/s.
- INFERENCE, a medir: fuera de 60 Hz estable, la cámara avanza en pasos desiguales.
  - A 144 Hz caminar es 0,42 px/frame: patrón 0/0/1.
  - A 75 Hz, un frame sin avance cada cinco.
  - Un frame perdido a 60 Hz produce un salto de 2 px (6 px de pantalla con zoom 3).
- Es la hipótesis de código más directa para "falta de fluidez aunque marque 60 FPS". Ninguna métrica actual la ve.

**R5 — Escala no entera de pixel art.**
- FACT: el zoom incluye `fit` continuo (0,55–1) y `viewportScale`.
- FACT: los actores fuera del foco tienen escala de perspectiva variable.
- FACT: `drawImage` usa `Math.round(w * s)` con `imageSmoothingEnabled = false`.
- INFERENCE: píxeles de tamaño desigual que cambian cuando un sprite se desplaza en profundidad o cambia el tamaño de la ventana.
- Candidato para "se ve más pixelado / cambia de aspecto" en remotos y NPCs, no en el jugador, que está siempre en el foco.

**R6 — Movimiento remoto sin buffer temporal.**
- FACT: sin timestamps ni retraso de interpolación.
- Un paso llega → si el actor está quieto, arranca. Si no, se encola.
- INFERENCE: con RTT real de 155–204 ms (medido en producción, Buenos Aires → Miami) y jitter más la cuantización de 50 ms del batch, un remoto que corre (133 ms por tile) puede detenerse brevemente entre tiles ("stop-and-go"). No hay contador de estos huecos.

**R7 — El coalescing del servidor puede convertir dos pasos en un salto.**
- FACT: `sendDelta` guarda sólo el último estado por actor dentro de la ventana de 50 ms (`PresenceRoom.js:216-229`).
- FACT: el cliente hace snap si la distancia entre pasos ≠ 1 (`game.ts:572`).
- INFERENCE: si dos movimientos del mismo jugador llegan dentro de una ventana, algo que el handoff documenta como real al correr con jitter, los observadores ven un teletransporte de 2 tiles.
- El benchmark sintético mueve cada 140 ms exactos, así que no ejercita este caso.

**R8 — Chunks en navegadores sin `requestIdleCallback`.**
- FACT: sin rIC, `prefetchAround` y `warmAround` no hacen nada (`chunks.ts:261,280`), así que todo chunk se construye síncrono dentro del frame (5–13 ms medidos en desktop, más en móvil).
- OPEN QUESTION: soporte actual en Safari/iOS. Si falta, es el peor caso de spikes en iPhone.

**R9 — Precarga ociosa que puede pasarse del deadline.**
- FACT: se construye con ≥8 ms libres, pero un build medido llega a 12,9–13,2 ms.
- INFERENCE: puede invadir el frame siguiente.
- También: tras un viaje de área, `enterArea` sólo llama `prefetch` y nunca `warm`. El 3×3 visible se construye síncrono en los primeros frames del mundo nuevo, que el fade tapa sólo visualmente.

**R10 — `game.ts` con 1.043 líneas (AGENTS §6: 800+ = excepcional).**
- Mezcla:
  - loop;
  - cámara;
  - input;
  - reconciliación de presencia;
  - actores remotos;
  - chat bubbles;
  - métricas del HUD.
- Creció +332 líneas en `5ffd09e`, y cada fase de performance lo toca.
- Riesgo de convertirse en el nuevo archivo central (AGENTS §24).

**R11 — Commits de performance grandes.**
- `5ffd09e` junta 6 subfases y 46 archivos en un commit.
- Dificulta bisect y revert por subfase, que es exactamente lo que PERF-00 §13 pedía ("revertirse si no mejora su métrica").

**R12 — Build playtest ≠ build normal.**
- FACT: el DPR y los cronómetros dependen del modo.
- Medir un modo no dice nada del otro.
- `main` está 279 commits atrás, así que el "producto normal" no tiene hoy un despliegue real.

**R13 — Seguridad, fuera de performance.**
- Se verificó en solo lectura el 2026-09-24 y se trata aparte con el usuario, como excepción prioritaria.
- Los detalles no se registran en este repositorio público.

---

## 6. Estado de los problemas originales del Playtest 0.1

| Problema | Veredicto | Por qué |
|---|---|---|
| Rendimiento general pesado / microtirones | **Pesadez: parece haber mejorado. Microtirones: no verificable todavía** | FACT: CPU por frame en producción p99 2,8 ms (HUD, 09-23); en local, ciudad en movimiento con 30 remotos p99 3,1 ms. Pero el HUD no mide ritmo de frames (R3) y existen mecanismos de irregularidad visual no medidos (R4, R6) |
| Ciudad extremadamente pesada / intransitable | **Parece haber mejorado; causas identificadas aparentemente eliminadas** | FACT: las tres causas con evidencia (raster 3D en CPU, rebuild total de remotos, fan-out global) ya no están en el código. Medido en local con 30–50 sintéticos. **No** medido con multitud real, red real ni hardware bajo |
| Alejarse mejoraba el rendimiento | **Explicado por mecanismo; no re-medido en HEAD** | INFERENCE: coincide con el raster 3D (dependiente de lo visible) y con el AOI ausente. Ambos se retiraron. Falta un A/B cerca/lejos en HEAD para cerrarlo |
| Sprites que saltan / snapping | **Mejoró; persisten mecanismos plausibles; no verificable** | FACT: el snap por reconstrucción ajena desapareció. Siguen: snap por backlog o distancia ≠1 (R7), stop-and-go (R6), teleport de reconciliación local (medido: 0 en la prueba de producción del 09-23) y cuantización de cámara (R4) |
| Sprites que vuelven a verse pixelados / cambian | **Causa principal aparentemente solucionada; residual posible** | FACT: ya no se recrea el actor con el fallback procedural en cada delta (caché + in-place). Quedan: primer load (fallback → hoja, y pokéball → sprite en el companion remoto) y escala no entera (R5) |

---

## 7. Performance candidates

Ninguno está demostrado como cuello actual. El orden es por **evidencia de relación con un síntoma reportado**, no por coste estimado.

| # | Sistema | Evidencia hoy | Qué hay que medir para confirmarlo o descartarlo |
|---|---|---|---|
| C1 | Ritmo de frames y cuantización de cámara (R3/R4) | Código. Síntoma "no fluye" persistente según el feedback. Métricas actuales ciegas | Histograma de intervalos de rAF, delta de cámara por frame, % de frames con delta 0 o ≥2 px, a 60/120/144 Hz |
| C2 | Continuidad de remotos (R6/R7) | Código. Síntoma "saltan" | Snaps por causa (backlog, distancia ≠1, snapshot), huecos quieto-entre-pasos de un remoto en carrera, pasos coalescidos por el servidor |
| C3 | Escala de sprites (R5) | Código. Síntoma "pixelado" | Captura A/B con `fit` entero vs continuo; conteo de cambios de tamaño en píxeles de un sprite en movimiento |
| C4 | Trabajo fuera del motor en el hilo principal (Vue HUD, minimapa, decodificación de red, GC) | No medido. El HUD asigna ~30 campos a un `reactive` cada 150 ms | Long tasks (`PerformanceObserver`), tiempo de `onHud`, tiempo de handlers de mensajes |
| C5 | Proyección del suelo (1 `drawImage` por fila) | FACT: fase sostenida más cara en local (~0,8–1,2 ms a DPR 1). Escala con la altura × DPR | Misma medición con DPR 2 (build normal) y en móvil real |
| C6 | Chunks: build síncrono en frames de viaje y en navegadores sin rIC (R8/R9) | FACT: builds de 5–13 ms; frame máximo de 51,5 ms en entrada fría antes del fix | Frame máximo en viajes ciudad↔pradera ×10, travesía larga, Safari/iOS |
| C7 | Simulación sin culling (wander/advance de toda la zona) | Código. Escala acotada | Tiempo de `update` por número de actores; stress con densidad alta |
| C8 | Allocations por frame (`decorIn` con spread/filter, objetos de proyección, `Map` por observador en el servidor) | Código | Heap sampling y GC en soak de 30 min |
| C9 | Memoria en sesión larga | FACT: el servidor no fuga (soak de 15 min virtuales). Cliente no medido tras LRU y liberación | Heap tras 10 ciclos de área y a 30/60 min |
| C10 | Ancho de banda O(N²) en ciudad | FACT: 61 KiB/s por cliente con 100 jugadores juntos | Sólo relevante en móvil con red real; hoy el límite es de 100 conexiones |

Descartados con evidencia (no re-perfilar salvo regresión):
- Pathfinding: 73.339 taps, p99 0,18 ms, máximo 4,5 ms (worklog, hecho 10).
- CPU del servidor: ~7,7 % de un núcleo con 100 jugadores.
- Fuga del room: soak sin crecimiento.

---

## 8. Benchmark plan inicial

### 8.1 Reglas de comparación

- Build de producción local (`vite build` + `vite preview`), **declarando el modo** (playtest o normal). Nunca `vite dev` para números.
- Registrar: commit, modo, navegador y versión, refresh rate del monitor, viewport, DPR, zoom del navegador, CPU throttle, hardware.
- 10 s de warm-up descartados, 60–90 s medidos, 3 repeticiones, se reporta la mediana. Distinguir corrida fría de caliente.
- **Input determinista.** Hoy no existe. La automatización del navegador integrado no logró mover al jugador en producción: es espectador si otra sesión de la misma cuenta está activa, y además la tecla sintética dura menos de un frame. PERF-1 tiene que agregar un driver de recorrido DEV/PERF-only.

### 8.2 Escenarios

| Id | Escenario | Carga | Qué aísla |
|---|---|---|---|
| B0 | Ciudad quieta, sin red | 0 remotos | Costo base del renderer y del loop |
| B1 | Ciudad, recorrido fijo spawn → plaza/fuentes → Tienda → Centro → spawn, caminando y corriendo | 0 remotos | Cámara en movimiento, decor denso, cuantización (C1) |
| B2 | B1 con presencia sintética | 10 / 30 / 50 / 100 (`benchmark:multiplayer`) | Multiplicador de red y remotos (C2, C4) |
| B3 | Pradera, línea recta que cruza ≥6 límites de chunk | 0 remotos, frío y caliente | Chunks (C6), agua animada, clima |
| B4 | Ciclo ciudad ↔ Pradera ×10 por el portón oeste | 0 remotos | Spikes de viaje, liberación de canvases, heap (C6, C9) |
| B5 | Dos jugadores reales, uno sigue al otro corriendo 60 s | 2 sesiones con cuentas distintas, red real (Miami) | Continuidad remota con RTT real (C2) |
| B6 | Soak: 30 min en ciudad + 30 min wild con 30 sintéticos | 30 | Memoria, GC, desconexiones (C8, C9) |
| B7 | Matriz de dispositivo: B1 y B3 a 60 / 144 Hz, CPU throttle 4×, 375×812 DPR 2 y un teléfono real | 0 y 30 | Hardware bajo, DPR, refresh (C1, C3, C5) |
| B8 | Jitter controlado: harness con envíos agrupados de a 2–3 | 10 | Coalescing a snap (R7) sin depender de la red |

### 8.3 Salidas mínimas por corrida (JSON)

```text
meta: commit, modo, navegador, refresh, viewport, dpr, throttle, escenario, repetición
ritmo: intervalo rAF p50/p95/p99/máx, % > 1,5 × vsync, frames perdidos estimados
cpu: work p50/p95/p99/máx, fases (compose, project, collect, sort, sprites, lighting), update
hilo principal: long tasks (n, total ms, máx), tiempo HUD/Vue
visual: delta de cámara por frame (histograma), snaps remotos por causa, huecos de remotos, teleports locales
mundo: actores total/simulados/dibujados, chunks vivos/generados/evictados, build máx
red: msgs/s, updates/s, KiB/s, RTT mov p50/p95/p99, rechazos por razón, reconexiones
memoria: heap inicial/final/máx (donde exista), canvases vivos
```

### 8.4 Gates propuestos (a ratificar después de la primera medición)

- p99 de intervalo rAF ≤ 1,5 × vsync en B1/B3 desktop.
- 0 frames > 50 ms fuera de transiciones.
- 0 snaps remotos no explicados en B5/B8.
- % de frames con delta de cámara irregular: objetivo a fijar tras medir C1.
- Heap en B4/B6 dentro de ±10 % del plateau.
- Los números se fijan con datos, no antes (política ya vigente en el worklog).

---

## 9. Deuda y limpieza pendiente (inventario; no se tocó nada)

### 9.1 Archivos no trackeados en el checkout principal

| Ruta | Qué es | Sugerencia |
|---|---|---|
| `C:UsersRodriProyectospokeswap.claudelaunch.json`, `C:champions-scoutcalibration-data.json` (nombres con `:` privado de Windows) | Basura de una herramienta que escribió una ruta absoluta como nombre. El segundo es de otro proyecto (Champions Scout) | Borrar cuando se decida (seguro, no se usan) |
| `supabase/.temp/` | Cache del CLI de Supabase (ref de proyecto, versiones) | Agregar a `.gitignore` |
| `public/assets/trainers/dawnrosa/*.jfif` (6) | Imágenes de referencia descargadas el 09-19. Los `.gif` sí están trackeados | Mover fuera de `public/`, o se publican si alguien los agrega |
| `.worktrees/rancho-de-sky-build/` | Carpeta **no registrada** como worktree (huérfana) | Revisar y borrar |
| `.worktrees/demo-scope` | Worktree registrado (`docs/demo-scope-crafting-decisions`) | Mantener o quitar según se use |
| `agents/CLAUDE_SECURITY_AND_VERIFICATION_BACKLOG.md`, `docs/SECURITY_AND_VERIFICATION_ROADMAP.md` | Planes de seguridad del 09-10 (rama `migration`), nunca versionados | Decidir: versionar o archivar. Contienen R13 |
| `.claude/` | Configuración local del agente (`launch.json`, settings) | Local; no versionar |

### 9.2 Documentación desactualizada o contradictoria

| Documento | Problema |
|---|---|
| `docs/wildlands/HANDOFF.md:51` | Dice ~10 fps con panel abierto (`PAUSED_FRAME_MS`). El código hace lo contrario. Corregido sólo en la rama sin mergear `docs/session2-closeout` |
| `docs/wildlands/LOBBY_INTEGRATION_PLAN.md:64` | Misma afirmación de ~10 fps |
| `docs/wildlands/TOWN_3D_INTEGRATION_HANDOFF.md`, `CITY_MAPPING_LAB.md`, `PRE_R34_TOWN_3D_CONSOLIDATION.md` | Describen `townModel.ts` como la ruta de dibujo de producto. Hoy está retirada del gameplay |
| `docs/performance/PLAYTEST_0_1_BASELINE.md` §1–§15 | Describen `ae28451` en presente (p. ej. "NPCs desactivados", "rebuild total"). Sólo §16 describe el estado posterior. Falta un aviso al inicio |
| `docs/wildlands/CLAUDE_PERFORMANCE_STABILITY_MASTER.md` | Snapshot del 09-23 en `26f3b7c`. Dice que Colyseus no se autodespliega (falso según el worklog de la sesión 2) y lista 1.922 tests (hoy 1.942). Es un prompt histórico, no estado |
| Docs de performance repartidos | `docs/performance/` (baselines), `docs/wildlands/PERFORMANCE_STABILITY_WORKLOG.md` y `docs/wildlands/benchmarks/` (JSON crudo). Falta un índice |
| Memoria del agente (`project-pre-r34-town-3d-base`, `project-playtest-community-01`) | Describe la ciudad 3D como producto y el playtest como no pusheado. Se actualiza al cierre de PERF-0 |

### 9.3 Código

- `engine/townModel.ts` (305 líneas) + `townModel.test.ts`:
  - rasterizador, loader y `drawTownModel` sin importadores de runtime;
  - sólo `chunks.ts` importa tipos, para `DecorInstance.model`, que se describe como "metadata para tooling".
  - Decidir: moverlo a tooling (`cityLab` o scripts) o borrarlo junto con el campo `model`. Hay que confirmar antes que el City Mapping Lab no lo necesita.
- `game.ts` (1.043 líneas; R10):
  - candidatos a extraer sin cambiar comportamiento: actores remotos y su cola, reconciliación de presencia, muestreo de métricas.
  - Tiene que ser un PR estructural propio, **antes** de que PERF-2+ lo haga crecer, y con los tests de reconciliación como red.
- `services/realtime/src/presence/movement.js`: `BURST_LIMIT` está marcado `@deprecated` y no tiene lectores (FACT, `grep`). Se puede retirar.
- `rendererPlaytestPerformance.test.ts` verifica strings del código fuente (`not.toContain('drawTownModel')`). Es útil como guardia, pero frágil ante renombres.
- `PlayDungeon.vue` (976 líneas) y `WildlandsView.vue` (672) están por encima de los umbrales de AGENTS §6. Fuera del alcance de PERF salvo que el perfil los señale.

### 9.4 Operación

- R1 (`main` pisa producción) y R2 (sin CI en la rama productiva): se resuelven con decisión del usuario, no en PERF.
- Mergear `docs/session2-closeout` (sólo docs).

---

## 10. Próximo paso recomendado: PERF-1 — Instrumentación y baseline reproducible

**Objetivo:** poder responder con números "¿se siente fluido?" y "¿los remotos son continuos?". **Sin optimizar nada y sin cambiar el comportamiento jugable.**

### Alcance (una responsabilidad: medir)

1. **Ritmo de frames real** (C1, R3):
   - anillo de intervalos rAF (además de `workMs`);
   - `PerformanceObserver('longtask')`;
   - tiempo de `update` separado de `render`;
   - tiempo de `onHud`.
2. **Continuidad visual** (C1–C3):
   - histograma del delta de cámara por frame;
   - contadores de snap remoto por causa (`backlog`, `distance`, `snapshot`);
   - huecos de remotos entre pasos consecutivos;
   - cambios de set de sprite tras el warm-up.
3. **Servidor:** contador agregado de pasos coalescidos (sobrescritos antes del flush) en `/metrics` interno. Sin ids ni coordenadas.
4. **Driver de escenario determinista** (DEV/PERF-only, eliminado del build normal por constante):
   - spawn fijo, hora y clima fijos;
   - recorrido por lista de tiles, de B1 y B3;
   - duración fija;
   - export JSON (`window.__pokeswapPerf.export()` o botón en el HUD).
5. **Modo jitter del benchmark** (B8): `--burst N` en `scripts/benchmark-presence.mjs`.
6. **Captura de la baseline** en `92ed74a`:
   - escenarios B0–B4 y B7 en desktop, más una corrida en teléfono real con el usuario;
   - B5 con dos cuentas;
   - guardar JSON en `docs/performance/baselines/<fecha>/`;
   - resumen en este documento (§11 nuevo).

### Reglas

- Código nuevo en un módulo propio (p. ej. `src/features/wildlands/perf/`), con hooks mínimos en `game.ts`, `renderer.ts` y `colyseusPresence.ts`, para no hacer crecer `game.ts` (R10).
- Todo detrás de `VITE_PERF`/`VITE_PLAYTEST`, verificado con `grep` sobre `dist` del build normal.
- El trabajo del agente va en una rama propia (p. ej. `perf/1-instrumentation`), nunca directo en `playtest/community-0.1`. Commits pequeños por punto. Merge sólo con OK del usuario, sabiendo que el merge despliega (R2).
- Gates: vitest, typecheck, lint, build playtest y normal, suite del servidor, benchmark de 30 sin cambios en bytes/RTT.

### Salida de PERF-1

Una tabla con números para C1–C6 que diga cuáles participan del síntoma y cuáles no.

A partir de ahí se decide PERF-2, con una sola responsabilidad por fase. Opciones que PERF-1 debería habilitar o descartar:
- timestep fijo o cámara con granularidad de píxel de pantalla (C1);
- continuidad remota: no coalescer pasos consecutivos o buffer temporal (C2/R7);
- escala entera (C3);
- proyección del suelo (C5);
- chunks sin rIC (C6).

**Ninguna se empieza sin la medición que la justifique.**

### Decisiones que necesito del usuario antes o durante PERF-1

1. R1: ¿se congela `main` o se cambia el workflow para que no publique en producción?
2. R2: ¿agregamos `vitest` + typecheck al deploy de playtest como gate (cambio de CI, PR propio)?
3. Hardware y refresh objetivo, y mínimo aceptable (monitor de 144 Hz y qué teléfono).
4. ¿El movimiento a píxel entero "como la DS" es una decisión estética que hay que preservar? Condiciona las soluciones posibles para C1.

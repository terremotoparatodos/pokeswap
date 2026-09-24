# PERF-2 — Multiplayer Smoothness

Rama `perf/2-multiplayer-smoothness`, desde `14e38eb` (PERF-1 integrado, PR #28).
Objetivo: llevar la locomoción remota de 7,5/10 percibido a 9,5–10/10 sin empeorar el costo de frame.

**Estado:** implementado y medido con harness y headless. **Falta la validación física** (§6); PERF-2 no está cerrado hasta que esté.

## 1. Cambios, en orden y atribuibles

| Fase | Commit | Qué cambia | Dónde |
|---|---|---|---|
| 2.1 walk/run | `0c765db` | La marcha (velocidad + animación + estado enviado) se fija al empezar **cada** casilla, también encadenada. Shift aplica desde la casilla siguiente sin frenar; un paso nunca cambia de ritmo a mitad. | `engine/actors.ts` (`driveWalker`, hook), `engine/game.ts` |
| 2.2a reproducción | `5604d74` | La cola de 3 pasos con salto al llenarse se reemplaza por `RemoteStepPlayback`: en cada llegada decide una tasa de reproducción = cadencia real de llegada × corrección por holgura (objetivo 50 ms, horizonte 0,6 s, 0,8×–1,75×, con límite de cambio por segundo). Resync sólo con hueco en la ruta o > 12 pasos de atraso, contado aparte. | `engine/remotePlayback.ts` (nuevo, fuera de `game.ts`) |
| 2.2b envío | `22c43d7` | El movimiento se anuncia al **empezar** el paso, no al terminarlo: el observador lo sabe una casilla antes, y un cambio run→walk llega antes de caminarse. Llegada (recolección, puertas, viaje) sin cambios. | `engine/game.ts`, `engine/actors.ts` |
| 2.3 batching | `2b763c5` | Si caen varios pasos del mismo actor en una ventana de 50 ms, el último lleva los anteriores en `via` (máx. 8). Compatible: un cliente que ignora `via` recibe lo mismo que antes; el servidor puede desplegarse primero. | `services/realtime` (`protocol/messages.js`, `PresenceRoom.js`), `multiplayer/api/colyseusPresence.ts` |
| 2.4 AOI | `59ebf8b` | Histéresis: un actor ya visible sigue hasta 20 + 6 casillas. En wild se agrega un piso de 20 casillas a los sectores (antes podían soltar a 12–13, dentro de la vista). | `services/realtime/src/presence/interest.js` |
| — | `d94a373` | Harness: cada captura headless borra su perfil de Chrome (48 perfiles habían llenado 3,3 GB). | `scripts/perf/headless-capture.mjs` |

Valores elegidos por datos, no arbitrarios:
- holgura 50 ms = una ventana de batch (los intervalos de llegada físicos de PERF-1 caen en 100/150/200 ms);
- cadencia medida porque el emisor no siempre va a la velocidad que reporta (bots a 142 ms/paso; agua: 0,7× reportando la marcha nominal);
- margen AOI 6 casillas > las idas y vueltas de 5 casillas medidas en el borde (≈ 0,8 s corriendo);
- piso wild 20 = semiancho visible de una ventana de 1920 px a zoom 3 (48 px por casilla).

No se tocaron: frecuencia de envío, ventana de 50 ms, autoridad del servidor, colisión, NPC, mundo compartido (WORLD-1).

## 2. Harness determinista (antes → después)

`scripts/perf/remote-fidelity/run.sh`: mover real → `PresenceRoom` real → adaptador y reproducción reales; sólo la red es modelada. 11 escenarios (A–K), 4 redes (lan, wifi modelada, miami medida, rough), 60/144 Hz, 3 semillas. Archivos: `baselines/perf-2/fidelity-0-before.json` → `fidelity-4-stacked-steps.json`.

Todas las redes juntas:

| Escenario | Saltos | Máx. salto | Espera ms/s | Atraso p50 | Atraso p95 | Casillas nunca mostradas |
|---|---:|---:|---:|---:|---:|---:|
| A caminar | 0 | 0 | 25 | 472 → 157 | 492 → 215 | 0 |
| B correr | 4 → 0 | 3 → 0 | 70 → 58 | 314 → 154 | 340 → 207 | 6 → 0 |
| C walk → run | 0 | 0 | **322 → 33** | 298 → 161 | 452 → 206 | 0 |
| D correr, frenar, correr | 4 → 0 | 2 → 0 | 54 → 36 | 285 → 142 | 349 → 206 | 4 → 0 |
| F zig-zag corriendo | 4 → 0 | 3 → 0 | 70 → 58 | 314 → 154 | 340 → 207 | 6 → 0 |
| G dos movimientos por paquete | **144 → 0** | 2 → 0 | 952 → 258 | 131 → 202 | 208 → 296 | 144 → 0 |
| H diez corredores | **265 → 0** | 5 → 0 | 140 → 52 | 316 → 169 | 587 → 234 | 730 → 0 |
| I run → walk | 20 → 0 | **5 → 0** | 103 → 39 | 297 → 150 | 722 → 224 | 71 → 0 |
| J carrera larga (80) | 23 → 0 | 4 → 0 | 46 → 29 | 371 → 153 | 478 → 213 | 55 → 0 |

LAN (lo más parecido a tu PC en casa):

| Escenario | Espera ms/s | Atraso p50 | Atraso p95 | Ritmo en pantalla p5–p95 |
|---|---:|---:|---:|---:|
| caminar | 16 → 2 | 322 → **77** | 340 → 92 | 0,91–1,05 |
| correr | 13 → 4 | 202 → **67** | 225 → 78 | 0,92–1,06 |
| run → walk | 45 → 2 | 306 → 72 | 331 → 92 | 0,92–1,05 |
| diez corredores | 57 → 6 | 208 → 77 | 332 → 92 | 0,93–1,05 |

- **Saltos multicasilla: 0 en los 264 runs**, incluida la red "rough" (2 % de pausas de 250 ms). **Resyncs: 0.**
- **Backlog acotado:** la catch-up drena sin saltar; J (80 casillas) no acumula atraso.
- **Caminar no empeoró:** atraso 322 → 77 ms, esperas 16 → 2 ms/s; su ritmo varía ±5–9 %.
- **Agua (K):** esperas 220 → 50 ms/s; el remoto va al 0,7× real.

Atribución por fase: `fidelity-1-gait.json` (2.1), `-2-playback` (2.2a), `-3-send-at-start` (2.2b), `-4-stacked-steps` (2.3). Comparar con `node scripts/perf/remote-fidelity/compare.mjs a.json b.json [--by network]`.

## 3. Headless con multitud (antes → después)

`scripts/perf/run-multi.sh` (+ `AREA=pradera`), `compare-multi.mjs`. A recorre la ruta entre los corredores, B mira desde el spawn. Archivos: `baselines/perf-2/multi-0-before` (+ Pradera en `multi-2-playback`) → `multi-5-aoi`.

| | MULTI-10 | MULTI-20 | MULTI-30 | Pradera-10 | Pradera-30 |
|---|---|---|---|---|---|
| Saltos por remoto-minuto | 4 → **0** | 4 → **0** | 3,2 → **0** | 0 → 0 | 0 → 0 |
| Máx. salto (casillas) | 4 → 0 | 4 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| Esperas por remoto-minuto | 9 → 2,1 | 6,5 → 4,8 | 3,5 → 7,2 | 5 → 5,4 | 8,2 → 2,9 |
| Espera más larga (ms) | 185 → 100 | 202 → 133 | 201 → 134 | 200 → 150 | 234 → 118 |
| Salidas AOI/min (A) | 8,2 → **0** | 15,7 → **0** | 31,4 → **0** | 14,1 → **0** | 37,5 → **0** |
| Reentradas < 2 s (A) | 8 → 0 | 15 → 0 | 29 → 0 | 9 → 0 | 24 → 0 |
| Distancia al salir (antes) | 20 | 19 | 20 | **12** | **12** |
| Trabajo de frame p95 A (ms) | 2,5 → 2,6 | 2,6 → 2,5 | 2,7 → 2,7 | 2,8 → 2,7 | 3,0 → 2,2 |
| Trabajo de frame p95 B (ms) | 2,2 → 2,3 | 2,4 → 2,3 | 2,4 → 2,5 | 2,4 → 2,2 | 2,7 → 2,1 |
| Heap p95 B (MB) | 14,4 → 14,3 | 16,2 → 15,9 | 17,1 → 17,9 | 16,4 → 16,9 | 17,8 → 15,8 |
| Remotos p95 (A) | 11 → 11 | 21 → 21 | 31 → 31 | 11 → 11 | 31 → 31 |

Las esperas que quedan son cortas (≤ 150 ms) y vienen de los bots, que no corren a ritmo uniforme. Las de antes eran de ~200 ms, **seguidas de un salto de 4**.

Frame y memoria: dentro del ruido de headless en los cinco escenarios.

## 4. Ancho de banda (30 corredores, por cliente)

`baselines/perf-2/bandwidth/`:

| | Antes | Después |
|---|---:|---:|
| Cadencia estable | 19,33 KiB/s | 19,33 KiB/s (`via` no aparece) |
| Movimientos de a dos por paquete | 10,61 KiB/s, **95.700 pasos perdidos** | 16,21 KiB/s, 0 perdidos |

Retención AOI: sólo se conservan actores ya vistos a ≤ 26 casillas. El peor caso en ciudad es +67 % del área de entrada. Con la multitud cerca del observador no cambió la cantidad de remotos.

## 5. Límites conocidos

- **G (todos los paquetes del emisor de a dos):** sin saltos, pero con esperas de ~220–270 ms/s y ritmo 1,2–1,4×. Es un emisor degradado (pestaña en segundo plano o red muy mala), no el caso normal.
- **Red "rough":** sin saltos, pero con esperas de 100–180 ms/s. Una pausa de 250 ms no se puede ocultar con 50 ms de holgura sin sumar latencia a todos.
- **Wi-Fi modelada:** esperas de 20–50 ms/s (más que LAN). Es un modelo, no una medición del iPhone; la prueba física lo confirma o no.
- **Arranque:** el primer paso tras quedarse quieto parte a ritmo nominal; el controlador tarda unos pasos en asentar la holgura.
- **Compatibilidad:** clientes viejos contra servidor nuevo reciben lo mismo que antes. Clientes nuevos que miran a un cliente viejo (que envía al llegar) funcionan igual que en 2.2a.
- **Sin cambios, por alcance:** `cityLab` y `dungeonPrototype` (un jugador, sin presencia) siguen con la marcha fijada sólo estando quieto.

## 6. Validación física — PENDIENTE

Stack LAN: `node scripts/perf/local-stack.mjs --crowd 10` (build `VITE_PERF`, servidor local, 10 corredores en ciudad y 10 en Pradera).

| Observación | PC observa | iPhone observa | PERF-1 |
|---|---|---|---|
| Caminar | — | — | bien |
| Correr | — | — | 7,5 |
| Walk → run sin frenar | — | — | — |
| Run → walk sin frenar | — | — | — |
| Frenar | — | — | — |
| Zig-zag | — | — | — |
| Cambios bruscos | — | — | — |
| Varios corredores | — | — | 7,5 |
| Borde de visión en Pradera | — | — | "reset" |

Meta: 9,5–10. PERF-2 no se declara cerrado sin esta tabla.

## 7. Deploy

No desplegado. 2.3 y 2.4 cambian `services/realtime`: el merge a `playtest/community-0.1` redespliega Colyseus y Pages. El servidor es compatible con los clientes actuales, así que el orden no importa.

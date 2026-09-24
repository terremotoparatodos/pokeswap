# TRANS-1 — Transition & Remote Spawn Correctness

Rama `trans/1-transition-correctness`, desde `b97c23b` (PERF-2 integrado, PR #29).
Objetivo: que entrar o salir de un edificio, o cambiar de área, se vea desde otro jugador como una transición real, nunca como un teleport al spawn o a una posición ficticia.

**Estado: APROBADO.** Causa demostrada, corregida y validada físicamente en PC + iPhone 15 Pro.

## 1. Causa raíz

**Un edificio no es un área.**
- Al pisar la puerta se abre el panel de la función, pero para la presencia el jugador sigue en la calle, parado sobre la casilla de puerta.
- Al cerrar el panel, `placeAtDoor` movía al avatar a la casilla de salida (una más abajo) **sólo en el cliente**. El servidor seguía teniéndolo sobre la puerta.
- Desde entonces el servidor aplicaba cada movimiento con una fila de desfase.

Consecuencias:

| Salida | Qué pasaba en el servidor | Qué veía el otro jugador |
|---|---|---|
| hacia un costado | el actor terminaba dentro de la fachada, que es sólida; el ack de esa casilla activaba el **punto seguro** del cliente (spawn de la ciudad y pedido de recolocación) | lo veía entrar en la pared y **saltar 6 casillas al spawn** |
| hacia abajo | desfase de 1 casilla | lo seguía viendo **una casilla corrido**, sin límite de tiempo |

Quién lo origina: la lógica de salida de edificios del cliente. El punto seguro sólo respondía a un estado que la transición había roto.

**Cambios de área (ciudad ↔ Pradera): correctos antes y después.**
- El servidor publica área y posición de llegada en **un solo** upsert.
- Quien está en el área vieja recibe una salida; quien está en la nueva ve aparecer al jugador en la llegada.
- Nunca se combina un área nueva con una posición vieja o por defecto: la llegada del cliente y la del servidor están fijadas por el contrato de llegada (`arrivalContract.test.ts`).

## 2. Instrumentación

Harness determinista con dos clientes (`scripts/perf/transition-trace/run.sh [--timeline] [--json]`). Toda la lógica que decide es la real:
- **A:** anuncio de pasos, reconciliación de acks, punto seguro, `placeAtDoor`, viaje entre áreas;
- **servidor:** `PresenceRoom` con interés y batching;
- **B:** adaptador y reproducción.

Por actor, registra:
- movimientos enviados y mensajes autoritativos recibidos;
- la **razón** de cada recolocación (punto seguro, reconciliación, colocación);
- lo que el servidor publica a B y lo que B dibuja: apariciones, desapariciones y saltos.

Líneas temporales: `baselines/trans-1/timeline-before.txt` y `timeline-after.txt`.

## 3. Línea temporal antes → después (D1: entrar, salir y caminar a la izquierda)

Antes:
```
1840 ms  A      entered building door (31,14)
2656 ms  A      panel closed → placeAtDoor (31,14) → (31,15) (local only, nothing sent)
2784 ms  A      send move #7 left
2844 ms  A      SAFE POINT: self #7 says (30,14), solid → player (30,15) → (31,20), placement requested
2850 ms  server → B step (30,14) #7             ← dentro del edificio
2900 ms  server → B upsert ciudad-corazon (31,20) #7
3040 ms  B      A JUMPS 6 tiles to (30,20)
```

Después:
```
1840 ms  A      entered building door (31,14)
2656 ms  A      send move #7 down
2656 ms  A      panel closed → placeAtDoor (31,14) → (31,15) (announced as move #7)
2700 ms  server → B step (31,15) #7
2912 ms  A      send move #8 left
2950 ms  server → B step (30,15) #8
```

## 4. Cambio

`WildlandsGame.placeAtDoor` (`engine/game.ts`):
- **Caso normal:** cuando la presencia tiene la autoridad y el jugador está sobre la puerta, **salir es un paso normal fuera de la puerta**: animado, con la marcha fijada y anunciado con `startStep`, como cualquier otro movimiento.
- **Sin presencia**, o con el jugador fuera de la puerta (link directo a una función antes de tener posición autoritativa): se coloca como antes.
- `Entrances.doorFor` expone puerta y salida. La dirección se calcula entre ambas y, si no son vecinas, se usa la colocación.

No cambiaron el punto seguro, el protocolo, el servidor, la reproducción remota, `via` ni el AOI.

## 5. Antes → después

Harness, escenarios de puertas y de área:

| Escenario | Punto seguro | Recolocaciones | Saltos vistos por B | Desfase final B vs A |
|---|---:|---:|---:|---:|
| D1 salir e ir a la izquierda | 1 → 0 | 1 → 0 | 1 → 0 | 0 → 0 |
| D2 salir e ir a la derecha | 1 → 0 | 1 → 0 | 1 → 0 | 0 → 0 |
| D3 salir e ir hacia abajo | 0 → 0 | 0 → 0 | 0 → 0 | **1 → 0** |
| D4 entrar y salir tres veces | 1 → 0 | 1 → 0 | 1 → 0 | 0 → 0 |
| D5 entrar y salir enseguida | 1 → 0 | 1 → 0 | 1 → 0 | 0 → 0 |
| A1 ciudad → Pradera → ciudad, visto en la ciudad | 0 → 0 | 2 → 2 (las del viaje) | 0 → 0 | 0 → 0 |
| A2 ídem, visto en Pradera | 0 → 0 | 2 → 2 (las del viaje) | 0 → 0 | — |

Capturas físicas (resumen; los datos crudos quedan fuera de Git):

| | PERF-2 (PC, 33 s) | TRANS-1 (PC, 51 s) | TRANS-1 (iPhone, 50 s) |
|---|---:|---:|---:|
| Correcciones a punto seguro | **3** | **0** | **0** |
| Recolocaciones | 3 | 0 | 0 |
| Reconciliaciones | 0 | 0 | 0 |
| Saltos de remotos | 0 (1) | 0 | 0 |
| Trabajo de frame p95 | 2,8 ms | 2,8 ms | 2 ms |

(1) Descontando el artefacto de inicio de la traza (PERF_2_REPORT §6.2).

Percepción, PC ↔ iPhone, en Silph Co., el Centro Pokémon y ciudad → Pradera → ciudad:

| | |
|---|---|
| teleport al spawn | no |
| desapariciones raras | no |
| reaparición y posición | correctas |
| movimiento posterior | 10/10 |
| locomoción de PERF-2 | sigue en 10/10 |

## 6. Tests

- `engine/doorPresence.test.ts` (6): simula al servidor con el `applyMove` real.
  - Al salir hacia la izquierda, la derecha o abajo, el servidor queda en la casilla del jugador, sin punto seguro ni pedido de área.
  - La salida es un único movimiento anunciado y animado.
  - Sin presencia es una colocación simple.
  - Una casilla realmente sólida sigue yendo al punto seguro.
  - Sin la corrección fallan 4 de los 6; los otros 2 son las protecciones que no debían cambiar.
- `PresenceRoom.test.js` (+1): el cambio de área llega como una salida en el área vieja y como la llegada en la nueva, con coordenadas de esa área. Al volver, el jugador reaparece en la llegada del portón y el paso siguiente sale de ahí.
- `services/realtime/src/presence/movement.d.ts`: tipos para usar `applyMove` desde el test del cliente.

## 7. Regresión de PERF-2

- Harness de fidelidad (A–K, 4 redes, 264 runs): **idéntico byte a byte** a `perf-2/fidelity-4-stacked-steps.json`.
- Headless con multitud (`baselines/trans-1/multi`, contra `perf-2/multi-5-aoi`):

| | MULTI-10 | MULTI-20 | MULTI-30 | Pradera-10 | Pradera-30 |
|---|---|---|---|---|---|
| Saltos | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Salidas AOI/min | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Trabajo p95 del caminante (ms) | 2,6 → 2,5 | 2,5 → 2,4 | 2,7 → 2,6 | 2,7 → 2,4 | 2,2 → 2,6 |
| Espera más larga (ms) | 100 → 117 | 133 → 134 | 134 → 150 | 150 → 117 | 118 → 133 |

Todo dentro del ruido de headless.

## 8. Deuda y riesgos registrados (sin resolver)

- Si una puerta futura tuviera la salida no adyacente a la puerta, se vuelve a la colocación directa; hoy todas son adyacentes.
- Un NPC parado en la casilla exterior no bloquea la salida: el jugador lo atraviesa, igual que con la colocación anterior.
- El botón "Ciudad" manda al spawn a propósito (salida de emergencia).
- El punto seguro sigue activo ante estados realmente inválidos (un objeto colocado, un cambio de mapa). Hay que seguir mirándolo en las capturas: una corrección durante una transición normal indicaría otra rotura.

# ECO-BATTLE-SCENE-1 · SC-R1 — rango de inicio medido desde la pose visible

**Rama:** `fix/eco-battle-scene-range-0.3`, worktree `pokeswap-eco-range`.

**Base:** `89785e0`, con la aprobación funcional general del usuario. Sigue congelado y sin cambios.

**Origen:** revisión independiente de `89785e0`, hallazgo **SC-R1 (P2)**.
- Informe: `ECO-BATTLE-SCENE-1-REVIEW-89785e0.md`.
- El servidor mide el rango de 3 desde la pose de patrulla a la hora del servidor. La ficha y la depuración lo medían desde el origen.

**Independencia:** el atajo de chat (`6a01ad9`, `feat/chat-enter-shortcut-0.3`) no se incorpora acá. Se combinarán después, ya revisados, sin perder sus commits.

## 1. Reproducción sobre 89785e0

Se usó la sonda original del revisor (`scene-native-expanded.mjs`), sin modificarla, sobre una exportación propia de `89785e0` en `D:\Claude-SCR1-repro-89785e0`. Corrió en Chrome 147 headless, con perfil propio.

Resultado: **exit 1**, `rangeFindings: 2`, idénticos a los del informe.

| Entrenador | Distancia a la pose / al origen | Ficha | Depuración |
|---|---|---|---|
| (13,-98) | 3 / 5 | «Lejos: estás a 5 casillas», deshabilitada | «Lejos», deshabilitado |
| (10,-96) | 6 / 3 | «Libre», habilitada | «Combatir», habilitado |

## 2. Corrección

Es sólo de presentación, en el cliente ECO. No cambian el rango de 3, la validación del servidor, el protocolo, el core ni el balance. `services/` no tiene cambios.

- **`world/domain/ecoSeenTile.ts`** da la casilla donde se **ve** el individuo:
  - **ocupado:** la casilla `stand` donde lo congeló el servidor, o el origen si un servidor anterior no la manda;
  - **antes de conocer el reloj compartido:** el origen, que es donde el mapa también lo dibuja;
  - **en los demás casos:** `wildPoseAt` del servidor (`ecoScene.js`, la misma patrulla `patrol.js`) a la hora de `SharedWorld.serverNow()`. Es el mismo reloj con el que el motor mueve la patrulla en el mapa.
- **`tileDistance`:** distancia Chebyshev, la métrica del chequeo del servidor.
- **`EcoExperimentLayer`:**
  - vuelve a leer el reloj compartido cada 200 ms, así la distancia sigue a la patrulla;
  - entrega `seen` a la ficha y `seenAt` a la depuración; las dos leen la misma función.
- **Ficha:** mide desde `seen`.
- **Depuración:** muestra la casilla visible y la distancia a ella.
- Un individuo ocupado sigue mostrando «Ocupado» y no se puede pedir.

## 3. Regresiones (`EcoExperimentLayer.seen.test.ts`, 5)

Usan el individuo, el origen y el instante reales del fixture del revisor: pose (16,-95) a 1 007 100 ms, estable a ±100 ms.

1. **Pose a 3 y origen a 5:** ficha «Libre» y depuración «Combatir», ambas habilitadas, con la depuración en `(16, -95) · 3 t`. Pulsar envía el pedido y el servidor sigue decidiendo.
2. **Cerca del origen (3) y fuera del rango de la pose (6):** «Lejos» en las dos, y la ficha dice «estás a 6 casillas».
3. **Patrulla:**
   - se avanza el reloj de 200 en 200 ms hasta que el individuo pasó por al menos 3 casillas;
   - en cada paso, la ficha y la depuración coinciden con `wildPoseAt` en casilla, distancia, texto y habilitación.
4. **Ocupado, a 3 de donde quedó congelado:** «Ocupado» y deshabilitado en las dos. Sigue igual aunque avance el reloj.
5. Chequeo de que el fixture es el del revisor.

**Controles negativos:**
- Con `ecoSeenTile` devolviendo el origen (comportamiento anterior), fallan las regresiones 1, 2 y 3. La 4 es invariante y pasa en ambos casos.
- Sin el refresco del reloj, falla la 3.
- Restaurado: 5/5.

## 4. Gates del delta (Node 22.23.2)

| Gate | Resultado |
|---|---|
| Sonda nativa original sobre `3e771ca` (exportación `D:\Claude-SCR1-native-3e771ca`) | **exit 0**, `rangeFindings: 0`, `otherAssertionsPassed: true`, 8 eventos nativos. Los dos casos dan lo esperado: «Libre/Combatir» habilitados, y «Lejos: estás a 6 casillas» / «Lejos» deshabilitados |
| vitest de `src/features/world`, `ecoPopulace` y `battleRestrictions` | 25 archivos, 187/187 |
| Servidor: `ecoBattles.scene`, `ecoBattles.range`, `PresenceRoomEcoBattle` | 8/8 |
| `vue-tsc` | exit 0 |
| eslint de los 5 archivos del delta | exit 0 |

No se corrieron baterías generales, por pedido.

**Exclusión productiva:** el módulo nuevo sólo lo importan la ficha, la depuración y la capa. La capa se carga sólo bajo `ECO_EXPERIMENT`, que exige DEV y la flag. No se repitió el build productivo.

## 5. Límites

- **Desfase del reloj.** La ficha usa el reloj estimado del cliente y el servidor usa el suyo al recibir el pedido. Cerca de un cambio de casilla, o con latencia, la ficha puede ofrecer un inicio que el servidor rechace con `too-far`, o al revés, durante el instante del borde. El servidor sigue siendo la autoridad y su rechazo ya tiene texto propio. Es la misma condición de reloj que ya documentó el informe (§ Reloj); no se reproduce como defecto.
- **Refresco cada 200 ms.** La distancia puede ir hasta 200 ms detrás de la patrulla dibujada.

**Candidato congelado:** `fix/eco-battle-scene-range-0.3`, en el commit que agrega este reporte, para revisión. Sin push, merge ni cambios en otros entornos.

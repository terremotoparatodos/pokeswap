# ECO-BATTLE-SCENE-1 — Escena sincronizada y entrenador libre durante el combate

**Rama:** `feat/eco-battle-scene-0.3`, worktree `pokeswap-eco-scene`.

**Base:** `b56e5f7` (ECO-BATTLE-ENDING-1).
- La revisión independiente lo **aprobó técnicamente**. Se conserva sin cambios.
- El pulido menor de la retirada queda documentado, sin corrección aparte.

**Origen:** cambios que pidió el usuario tras el smoke de `b56e5f7` (2026-10-09). La disposición anterior de la escena **no** quedó aprobada.

**Desglose previo:** `ECO_BATTLE_SCENE_1_NOTES.md` (`0513dc6`).

## 1. Commits

| Commit | Qué |
|---|---|
| `0513dc6` | Desglose: hechos, diseño y riesgos |
| `3f484b3` | Servidor: escena autoritativa, `stand` y restricciones; prueba de paridad |
| `1126511` | Cliente: dibujo de la escena del servidor y entrenador libre con restricciones |
| `c6a2581` | e2e: acercarse a donde se ve el encuentro; escena y restricciones comprobadas en la red |
| (este commit) | Este reporte |

## 2. Hechos verificados

- **La patrulla visual es determinista y compartida.** La pose es función pura de (id, origen, caminabilidad, velocidad, hora del servidor).
- **El salto venía del cliente.** `hold` lo devolvía a la casilla de **origen** que lista el servidor, y el rango se medía desde ese origen.
- **Paridad de caminabilidad.** La regla «salvaje» del cliente (`!isSolid && !portal && !puerta`) coincide casilla por casilla con `wildWalkable` del servidor (`isWalkable && !portal`). Se probó en Pradera (±120 alrededor de la llegada) y en toda la cueva, y las patrullas reales construidas con una y otra regla son idénticas (`ecoSceneParity.test.ts`). Por eso el servidor calcula la **misma** pose que dibuja cada cliente.

## 3. Qué cambió

**Servidor** (autoridad; sin cambios en core, tiempos, balance, recompensas ni persistencia):
- **`ecoScene.js` (puro):** `wildWalkable`, `wildPoseAt` (patrulla compartida a la hora del servidor) y `battleStage`.
  - El Pokémon queda en la casilla vecina caminable del salvaje más cercana al entrenador.
  - Nunca en la casilla del entrenador ni en la del salvaje.
  - Los dos se miran.
- **`EcoBattles.engage`:**
  - congela al salvaje **donde se ve**, no en su origen;
  - mide el **rango de 3 desde ahí**;
  - fija la escena una sola vez;
  - rechaza con `no-room` si no hay lugar.
- **Quién recibe la escena:**
  - el dueño, en `battle.stage`;
  - los espectadores, en `stage.pokemon` y las orientaciones de la vista pública;
  - toda el área, en `stand` (`tx`, `ty`, `dir`) del ocupado dentro de la vista ECO, también quien llega tarde.
- **Restricciones validadas en el servidor** mientras hay combate, también en pausa dentro de la gracia:
  - `PresenceRoom.changeArea` rechaza cruzar a **otra** área, como un cruce no permitido: nada se mueve y el cliente recibe su posición real;
  - una resincronización de la misma área sigue permitida;
  - `WorldRoom.work` responde `in-battle`.
  - Caminar dentro del área no tiene cambios: el combate sigue, sin cancelación por distancia.
  - Todo se libera al cerrar la reserva.

**Cliente:**
- **Población:** `EcoActors.hold` congela al salvaje en `stand`, orientado al Pokémon. Con un servidor anterior, sin `stand`, usa el origen.
- **Overlay:** dibuja la escena del servidor, tanto para el dueño como para los espectadores. `stageFrom` reemplaza al `stageOf` del cliente, que se eliminó. El Pikachu ya no depende de dónde esté el entrenador.
- **Motor:** `setBattleRestricted` reemplaza a `setInputLocked` durante el combate.
  - Caminar, tocar para caminar y el chat siguen igual.
  - Un portal no inicia viaje y una actividad (Espacio o toque sobre un objeto del mundo) no empieza; en ambos casos aparece un mensaje.
  - El panel sigue con los movimientos y «Huir». Un rechazo o el final levantan las restricciones.
- **Textos:** se agregó el de `no-room`.

## 4. Pruebas dirigidas

**Servidor:**
- **`ecoBattles.scene.test.js`:**
  - **SC01:** congelado donde se ve, fuera de su origen; el Pokémon delante, caminable, sin pisar al entrenador y orientado. Dueño, espectador y lista del área con la misma escena.
  - **SC02:** el rango se mide desde la pose: a 3 de la pose y a más de 3 del origen inicia; a 4 de la pose se rechaza.
  - **SC03:** el dueño se aleja 10 casillas con ticks de por medio y las casillas no cambian.
  - **SC04:** la regla sin lugar.
  - **SC05:** trabajo `in-battle` y `mayLeaveArea` falso, también en pausa; ambos se liberan al terminar; otro jugador nunca queda retenido.
- **`PresenceRoomEcoBattle.test.js`** (sala real): en la boca de la cueva, retenido, el cruce se rechaza y queda en Pradera; la resincronización de la misma área responde; liberado, el mismo pedido cruza.
- **Kit y pruebas existentes:** el kit se para junto a la **pose**. Se adaptaron E01, S01 y las pruebas de reserva. Suite del servidor: **662, 0 fallos**.

**Cliente:**
- **`ecoSceneParity.test.ts`:** paridad casilla por casilla y de patrullas.
- **`ecoPopulace.test.ts`:** con `stand`, dos clientes con poses locales distintas lo congelan en la misma casilla con la misma orientación, no en el origen; libre, vuelve a su patrulla.
- **`battleRestrictions.test.ts`** (métodos reales del motor):
  - el portal no inicia viaje y muestra el mensaje;
  - Espacio o un toque sobre un objeto no empiezan la actividad, sin afectar otras casillas;
  - un toque en el suelo sigue caminando;
  - todo se levanta al terminar;
  - escribir en un campo de texto (Espacio, Enter, flechas, letras) no mueve ni interactúa.
- **Capa:**
  - Pikachu y barras quedan en las casillas del servidor mientras el entrenador camina por cuatro posiciones;
  - las restricciones se activan al pedir y al combatir, y las levantan un rechazo y el final;
  - dueño y espectador dibujan la misma escena con las mismas casillas.
- **Fixtures:** las escenas del servidor se agregaron a los fixtures existentes. Las pruebas de overlay usan una escena fija equivalente, así que sus expectativas no cambian.

**Gates (Node 22.23.2):**

| Gate | Resultado |
|---|---|
| vitest completo | 243 archivos, 2304/2304 |
| Servidor | 662 tests, 0 fallos |
| `vue-tsc` | exit 0 |
| eslint | exit 0; solo los 9 avisos previos de `AuthModal.vue` |

**En la red** (runner aislado con un realtime nuevo por corrida, 31390/31391; evidencia en `D:\Claude-SCENE-evidence`):

| Corrida | Resultado |
|---|---|
| e2e de combate | **2/2 PASS** |
| e2e de espectadores | **2/2 PASS**, sin reintentos |
| Control negativo (actualizaciones perdidas A←B) | **FAIL** esperado, sin reintento |

En las corridas del e2e de combate:
- escena del servidor con el Pokémon delante del salvaje congelado, y la misma casilla en la lista del área;
- el dueño camina durante el combate;
- trabajo rechazado con `in-battle`;
- el combate sigue; luego huida, victoria y retiro como antes.

El e2e de espectadores verifica además que el Pokémon queda delante y que la lista del área congela al salvaje en la casilla de la escena.

**Exclusión productiva:** build con `VITE_ECO_EXPERIMENT=on` y la **misma lista de 193 fuentes** que `a675b0e`, sin módulos ECO.
- El motor, que siempre se publica, ahora incluye `setBattleRestricted` y sus dos mensajes. Es código inerte en producción: solo lo llama la vista bajo `ECO_EXPERIMENT`, igual que antes `setInputLocked`.
- Sigue la constante del protocolo.

## 5. Límites conocidos

- **Desfase de reloj.** La pose congelada es la del servidor al recibir el pedido. Un cliente con su reloj ±100 ms desfasado puede verlo a mitad de un paso: el ajuste es de una casilla como máximo, nunca hasta el origen.
- **Rechazo de portal.** En la red no se ejerció con un dueño parado en un portal (requeriría combatir junto a la boca de la cueva). Lo cubren la prueba de la sala real y SC05.
- **Pendientes:** smoke humano y arte definitivo.

**Candidato congelado:** `feat/eco-battle-scene-0.3` en el commit que agrega este reporte, para revisión acotada. Sin push, merge ni cambios en otros entornos. No queda ningún proceso activo.

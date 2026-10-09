# ECO-BATTLE-SCENE-1 — Desglose antes de implementar

**Rama:** `feat/eco-battle-scene-0.3`, desde `b56e5f7` (ECO-BATTLE-ENDING-1). Ese commit lo **aprobó técnicamente** la revisión independiente; se conserva sin cambios. El pulido menor de la retirada queda solo documentado.

**Pedido del usuario (smoke de b56e5f7, 2026-10-09):** cambios solicitados. La disposición actual de la escena **no** está aprobada.
1. **Posiciones:**
   - el salvaje se congela donde estaba al pulsar «Combatir», sin saltar a su casilla de origen;
   - el Pokémon del jugador aparece enfrente, orientado hacia él, en una casilla válida y sin superponerse;
   - ambos quedan fijos durante el combate, aunque el entrenador se mueva;
   - dueño y espectadores ven la misma escena.
2. **Entrenador:**
   - camina libre dentro del área y usa el chat;
   - no cambia de área ni empieza otra actividad, y eso lo valida el servidor;
   - sigue eligiendo movimientos o huyendo.

## 1. Hechos (FACT, código de `b56e5f7`)

- **La patrulla visual es compartida y determinista** (`patrol.js`, WORLD-1D).
  - La pose es función pura de (id del encuentro, casilla de origen, caminabilidad, velocidad, hora del servidor).
  - Cada cliente la muestrea con `followPatrol(actor, serverNow)`: todos ven al salvaje en la misma casilla a la misma hora del servidor.
  - El servidor no la calcula hoy, pero puede: `buildPatrol` y `samplePatrol` ya viven en el servicio.
- **El salto viene del cliente.** Al quedar ocupado, `EcoActors.hold` pone al salvaje en la casilla que lista el servidor, que es su **origen** (`EcoPopulation.view` → `tile`), y no en su pose. Además, el servidor mide el rango de 3 desde ese origen, no desde donde el jugador lo ve.
- **El Pikachu lo ubica cada cliente** con `stageOf({ player, wild })`, a partir de la casilla del entrenador y del origen del salvaje. El dueño usa su casilla local; los espectadores, la casilla del dueño al reservar. Puede diferir entre clientes si el entrenador se mueve.
- **Caminabilidad del salvaje en el cliente:** `!area.isSolid && !isPortalTile && !isDoor`. En el servidor, `isWalkable` no excluye portales. Para que el servidor reproduzca la patrulla exacta, su caminabilidad «de salvaje» debe coincidir con la del cliente. Se verifica casilla por casilla en Pradera y en la cueva con un test de paridad.
- **Hoy el dueño queda bloqueado** con `setInputLocked` mientras dura `holds`. Cambiar de área termina el combate en el servidor con `left-area` (`actorPlaced`). El trabajo (`world:work`) no mira el combate.
- **El chat** del área corre por el socket de presencia. `KeyboardInput` ignora las teclas cuando el foco está en un campo de texto.

## 2. Diseño

**Servidor** (autoridad; sin cambios en core, tiempos, balance, recompensas ni persistencia):
- **Módulo puro `ecoScene.js`:**
  - `wildWalkable(area, tx, ty)`: misma regla que el cliente.
  - `wildPoseAt(encuentro, ahora)`: la casilla de la patrulla compartida.
  - `battleStage(entrenador, salvaje)`: el Pokémon del jugador en la casilla vecina caminable del salvaje más cercana al entrenador; nunca la del salvaje ni la del entrenador; orientado hacia el salvaje. Si no hay ninguna, `null`.
- **`EcoBattles.engage`:**
  - congela al salvaje en `wildPoseAt` a la hora del servidor;
  - mide el **rango de 3 desde esa pose**, lo que el jugador ve;
  - fija la escena (`stage`: dueño, salvaje y Pokémon) y la guarda junto a la reserva;
  - rechaza con `no-room` si no hay casilla válida.
  - La escena viaja en `EcoBattleInfo.stage` (dueño) y en la vista pública (espectadores). La vista ECO del área lleva `stand` en los ocupados, para que cualquier cliente, incluido uno que llega tarde, congele al salvaje en la misma casilla.
- **Restricciones durante el combate, validadas en el servidor:**
  - `PresenceRoom.changeArea` rechaza cambiar de área (`AREA_TRANSITION_DENIED` más snapshot, como un cruce rechazado);
  - `WorldRoom.work` rechaza una actividad (`in-battle`).
  - Se liberan solas al cerrarse la reserva. `left-area` sigue como red de seguridad ante cualquier otra colocación.

**Cliente:**
- `EcoActors.hold` usa `stand`. El overlay dibuja la escena del servidor (`stage`) para el dueño y para los espectadores; el dueño ya no la calcula con su propia casilla.
- **El dueño camina durante el combate.** `setInputLocked` se reemplaza por restricciones de combate en el motor: sin viaje por portales y sin interacción con objetos del mundo, con mensaje. El movimiento, los toques para caminar y el chat siguen. El panel sigue (movimientos, «Huir»).
- Las restricciones se levantan con el final del servidor.

## 3. Riesgos y límites (INFERENCE / OPEN)

- **Desfase de reloj.** La pose congelada es la del servidor al recibir el pedido. Un cliente con su reloj ±100 ms desfasado puede estar a mitad de un paso; el ajuste es de una casilla como máximo, nunca hasta el origen.
- **Paridad de caminabilidad.** Si alguna vez difiere, la patrulla del servidor y la del cliente se separarían. El test de paridad lo vigila.
- **e2e.** Los scripts se acercaban al origen. Ahora deben acercarse a la pose, que calculan con el mismo módulo y la hora del servidor estimada.

# ECO-BATTLE-SPECTATORS-1 — Propuesta: espectadores del combate overworld

**Estado:** propuesta, sin implementar.
**Base:** `a675b0e`, el candidato ECO-OVERWORLD-BATTLE-1. Sigue congelado; esta rama es hija suya y solo agrega este documento.
**Pedido del usuario (2026-10-09, cierre del smoke):** que el segundo jugador vea el combate en tiempo real, no solo el salvaje marcado como ocupado.
- Los jugadores del área ven al Pokémon del dueño, al salvaje, sus barras y los efectos, sincronizados con la autoridad del servidor.
- Solo el dueño controla el combate. Los demás siguen caminando, sin panel de acciones.
- Sin recompensas, persistencia ni cambios de balance.

Corresponde a la decisión **D2**, que la propuesta `8729fe8` (§4) dejó como entrega propia porque exige ampliar protocolo y servidor.

## 1. Situación actual (FACT, código de `a675b0e`)

- **El combate solo llega al dueño.** `ecoBattles.js` envía `world:eco-engage-result`, `world:eco-battle` y `world:eco-battle-end` únicamente al socket de la reserva (`reservation.client`). Lo hace en tres momentos:
  - en el tick con eventos (`tick`);
  - en la respuesta a cada acción (`action`);
  - al final (`#end`).
- **Los demás jugadores solo reciben `busy: true`.** Lo ven en la vista del área (`ecoPopulation.view`), que `worldRoom.#flushEco` difunde entera a los viewers ECO del área.
- **El snapshot del dueño (`ClientBattleSnapshot`) incluye datos privados:** movimientos, PP, la selección (`runtime.selected`), estadísticas completas y `joinAck`/controlador.
- **Lo que la presentación necesita de cada combatiente** (`ecoBattlePresentation.ts` más `actionBarFill`):
  - `instance.speciesId`, `level`, `stats.hp`, `condition.currentHp`, `condition.majorStatus`;
  - `runtime.confusionRemainingMs`;
  - para la barra: `stats.spe`, `runtime.stages` (velocidad), `runtime.actionElapsedMs`, `runtime.cooldownMultiplier`, `runtime.sleepRemainingMs` y `config.actionBar`.
- **Los efectos (`vfxOf`) leen estos eventos:** `MOVE_USED`, `DAMAGE`, `HEAL`, `MOVE_MISSED`, `STATUS_APPLIED`, `CONFUSION_APPLIED`, `PROTECT_GAINED`, `PROTECT_BLOCKED` y `FAINTED`.
- **La escena del dueño sale de una función pura:** `stageOf({ player, wild })` coloca al Pikachu a partir de la casilla del entrenador y la del salvaje.

## 2. Alcance mínimo

**Entra:**
1. **Vista pública del combate.** El servidor la difunde a los viewers ECO del área del combate, **excepto al dueño**, que sigue con su canal actual sin cambios.
2. **Contenido de la vista.** Lleva la escena (casilla del dueño al empezar y casilla del salvaje), una proyección pública por combatiente y los eventos de efectos. Así el espectador dibuja al Pikachu junto al avatar del dueño, al salvaje, las dos barras y los efectos.
3. **Quien llega tarde ve el combate en curso.** Al entrar en el área (o al unirse) recibe el estado actual de cada combate del área, sin eventos pasados.
4. **Fin.** Al terminar, el espectador ve el desenlace un momento (ver §6, P1) y la escena desaparece.
5. **El espectador no cambia de comportamiento:** no tiene panel, no se le bloquea el movimiento ni tiene ninguna acción nueva. La ficha del salvaje sigue diciendo «Ocupado».

**No entra:** recompensas, persistencia, balance, tiempos, cambios en el canal del dueño, combate entre jugadores, chat o reacciones de espectadores, ni producción, Cloud o Supabase. Todo sigue dentro de los flags ECO, solo en desarrollo.

## 3. Cambios de protocolo (`worldProtocol.js`)

Un solo mensaje nuevo, de servidor a cliente: **`world:eco-battle-public`**.

```text
{
  battleId, encounterId, areaId,
  stage: { owner: { tx, ty }, wild: { tx, ty } },   // fijadas por el servidor al reservar
  revision, timeMs, connected,                     // connected = false durante la gracia de reconexión del dueño
  config: { actionBar },                            // solo la parte que usa la barra
  combatants: { 'player-0' | 'wild-0': {
    speciesId, level, maxHp, currentHp, majorStatus, confused,
    spe, speedStage, actionElapsedMs, cooldownMultiplier, sleepRemainingMs
  } },
  events?: [ envelopes públicos: solo los tipos de §1, con su sequence ],
  ended?: { outcome }                               // última emisión de esta batalla
}
```

- **Sin intents nuevos de cliente a servidor.** Ver un combate no se pide: llega por estar en el área. No cambia ningún mensaje existente.
- **Nunca viajan** movimientos, PP, `selected`, el resto de las estadísticas, `joinAck`, controlador, `playerId`, rechazos ni resultados de acciones.

## 4. Cambios de servidor

- **`ecoBattles.js`:**
  - **Escena en la reserva.** Guarda `ownerTile`, la casilla del actor al reservar, y `wildTile`. La casilla del dueño no cambia durante el combate porque el dueño está bloqueado.
  - **Proyección pura.** Una función nueva y testeable, `publicBattleView(reservation, events?)`, que arma la proyección solo con la lista blanca de §3.
  - **Callback nuevo `broadcast(areaId, type, payload, exceptPlayerId)`.** Se invoca en los mismos puntos donde ya se envía al dueño:
    - el tick con eventos;
    - la respuesta aceptada a una acción;
    - el cambio de `connected` en la desconexión y en la reanudación;
    - `#end` con `ended`.
  - **La cadencia queda idéntica a la del dueño:** no hay ticks nuevos ni difusión periódica sin eventos.
  - **`publicBattlesIn(areaId)`** devuelve el estado actual de cada reserva activa del área, para quien llega tarde.
- **`worldRoom.js`:**
  - implementa `broadcast` sobre `this.clients`, filtrando por `state.eco`, `state.areaId === areaId` y `state.playerId !== exceptPlayerId`;
  - al unirse un socket o al cambiar de área, envía `publicBattlesIn(areaId)` junto a la vista ECO del área.
- **Sin cambios en** el core, las reservas, el rango, los tiempos, la población, las recompensas ni la persistencia.
- **Coste:** un mensaje pequeño por ventana de acción (unos 3,7 s en el fixture actual), por combate y por espectador del área. Se informa en `stats()`.

## 5. Cambios de cliente (ECO, solo desarrollo)

- **Estado `EcoSpectatedBattles` (`world/state`):**
  - un mapa `battleId → vista`;
  - deduplica con la regla de F2: solo una revisión estrictamente mayor reinicia el origen de interpolación; los eventos se deduplican por `sequence`;
  - ignora el `battleId` propio;
  - se vacía al cambiar de área, con la regla de F1 y C1: cada batalla queda atada a su área y nunca reaparece.
- **Presentación:** `presentCombatant` y `actionBarFill` se alimentan con un adaptador desde la proyección pública, sin copiar fórmulas.
- **Dibujo:** `EcoBattleOverlay` admite varias escenas, la propia y las observadas. Las observadas se dibujan con la misma `stageOf(ownerTile, wildTile)`, sin panel.
  - La marca «en combate» se mantiene sobre los ocupados que no tengan escena, por ejemplo mientras llega el primer mensaje.
- **Sin bloqueo ni panel para el espectador.** `setInputLocked`, `EcoBattlePanel` y la ficha no cambian.

## 6. Preguntas abiertas para el usuario

- **P1:** cuánto queda visible el desenlace para el espectador. Propuesta: 1,5 s con un rótulo corto («Ganó», «Huyó»), y luego desaparece.
- **P2:** si se ven todos los combates del área o solo los cercanos. Propuesta mínima: todos los del área, como hoy la vista ECO.
- **P3:** si los efectos de los espectadores se atenúan, para no confundirlos con un combate propio. Propuesta mínima: idénticos.

## 7. Pruebas

**Servidor** (`ecoBattles.test.js`, `worldRoom` y el protocolo):
- la difusión llega a los viewers ECO del área y no al dueño, a otras áreas ni a clientes sin ECO;
- la proyección no contiene movimientos, PP, `selected`, `joinAck` ni `playerId` (prueba de lista blanca);
- la revisión y los eventos de la vista pública coinciden con los del dueño en el mismo tick;
- quien llega tarde, por unirse o por cambiar de área, recibe el combate en curso;
- los finales se difunden con `ended`: victoria, huida, salida del área, expiración y desconexión;
- `connected` refleja la gracia de reconexión;
- no se envía nada sin eventos.

**Cliente:**
- deduplicación con duplicado deserializado y con estado anterior;
- reanudación de `connected`;
- la escena observada dibuja Pikachu, salvaje, barras y efectos;
- sin panel ni bloqueo;
- cambio de área (F1/C1);
- se ignora la batalla propia;
- fin con P1.

**Gates:**
- guarda de aislamiento;
- build de producción con exclusión, con las mismas fuentes que la base;
- vitest, `vue-tsc` y eslint.

**e2e (`eco-battle-e2e.mjs`):** un segundo cliente del SDK como espectador. Comprueba que recibe la misma secuencia de revisiones que el dueño, PS coherentes con los eventos y el fin.

**Smoke con dos ventanas** (sandbox aislado, identidades `eco-a` y `eco-b`):
1. A combate y B, en la misma área, ve el Pikachu junto al avatar de A, el salvaje, las dos barras y los efectos al mismo tiempo; los PS coinciden en ambas ventanas.
2. B camina libremente durante el combate, sin panel ni bloqueo, y no puede disputar al salvaje.
3. B entra al área con el combate ya empezado y lo ve.
4. A huye o gana: B ve el desenlace (P1) y la escena desaparece.
5. B sale del área: la escena se va y no vuelve.
6. A se desconecta: B ve el combate pausado; si A se reconecta, sigue.

## 8. Entrega propuesta

Una rama nueva desde una base explícita (la de `a675b0e`, o la integración que el usuario indique) y commits chicos:
1. protocolo y proyección pura, con su prueba de lista blanca;
2. difusión en el servidor;
3. estado del espectador en el cliente;
4. dibujo;
5. e2e;
6. reporte.

Antes del smoke humano, revisión independiente.

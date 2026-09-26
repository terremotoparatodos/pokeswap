# WORLD VISUAL-2 — Intercambio de posición y animaciones por tarea

> Rama `world/task-presentation-0.3`, desde `integration/world-skills-0.3 @ 953a5c7`. Presentación y posición efímera de presence. Sin cambios en balance, XP, materiales, settlement, idempotencia, feature gate, Supabase, migraciones, Edge Functions, depletion, respawn ni producción 0.2. Reemplaza la regla de stand de WORLD VISUAL-1 (§3 de `WORLD_VISUAL_1_REPORT.md`).

## 1. Auditoría: por qué la reubicación podía cancelar el trabajo

| Pieza | Comportamiento previo |
|---|---|
| Presence (`PresenceRoom.move` → `applyMove`) | La posición es del servidor pero **no valida colisiones** (lo hace el cliente). Cada paso lleva `moveSequence`; un número ≤ al actual es `replay` y se rechaza. |
| Dueño (`game.setAuthoritativeActor`) | Acepta `presence:self` si `moveSequence ≥ nextMoveSequence` y la casilla difiere: coloca al jugador ahí. Numera sus pasos desde `nextMoveSequence`. |
| Observadores (`queueRemoteStep`) | Descartan todo delta con `moveSequence` que no crece. |
| WORLD (`reconcileActor`, desde `viewerMoved` y `actorPlaced`) | Cancelaba si el actor dejaba de estar ortogonalmente junto al nodo. |

Consecuencia: mover al entrenador una casilla hacia atrás lo dejaba a distancia 2 del nodo → `reconcileActor` cancelaba en el acto. Y moverlo sin avanzar la secuencia lo hacía invisible para los observadores.

**Solución mínima:**
1. **Ancla.** En la adquisición la acción guarda `anchor` = casilla de espera. Mientras trabaja, `reconcileActor` cancela solo si el actor **deja el ancla** o cambia de área. El ancla se escribe **antes** de mover al jugador, así el propio movimiento del servidor se reconcilia contra ella y no cancela.
2. **Movimiento del servidor en presence.** `PresenceRoom.placeActor` fija la casilla y dirección, **avanza `moveSequence` en 1**, lo publica como un `step` a los observadores, le manda `presence:self` al dueño y avisa a WORLD (`viewerMoved`, que pasa por el ancla).
3. **Dueño.** Al aceptar un `self`, adopta la secuencia del servidor (su próximo paso se numera después). Si la diferencia es exactamente una casilla y no hay reducción de movimiento, la recorre como un paso corto en vez de saltar.
4. **Clientes 0.3 anteriores** (que no adoptan la secuencia): su siguiente paso llega como `replay`. Ahora un `replay` también se responde con `presence:self` (como ya pasaba con `rate`), así se resincronizan en vez de quedar una casilla corridos.

No hubo cambios de base de datos ni de settlement. `WORLD_PROTOCOL` sigue en 1 (`worker.stand` ya existía); el protocolo de presence no cambió de forma: solo el servidor puede, además, mover al jugador.

## 2. Regla de posiciones (`services/realtime/src/world/workPlacement.js`)

- `stand` (Pokémon) = **exactamente** la casilla validada del entrenador al adquirir, mirando al recurso.
- `wait` (entrenador): 1) la casilla **directamente opuesta** al recurso; 2) si no, un **costado** de su casilla — sur antes que norte, este antes que oeste (el orden fijo de WORLD); 3) si no, `null`.
- Casilla válida: terreno compartido (no sólido, no agua, no otro nodo ni parcela) y no ocupada por el Pokémon o el entrenador de **otra acción en curso**. El mundo procedural no tiene bordes; áreas no modeladas no ofrecen ninguna.
- Sin lugar → rechazo `no-room` **en los chequeos físicos**, antes de pedir ownership/autorización y sin reservar nada. Mensaje: *"No hay lugar para que tu Pokémon trabaje desde acá. Probá desde otro lado."* En Pradera, alrededor del 1,6 % de las casillas de trabajo (7 de 432 en un radio de 60).
- Completar o cancelar retira solo al Pokémon; el entrenador queda en su casilla de espera. Desconexión: sin cambios (la acción sigue, el Pokémon queda).

## 3. Animaciones por tarea (`src/features/world/render/workerPose.ts`)

Mismo sprite overworld; solo cambian inclinación hacia el recurso (px), salto y ritmo. Fase = `(serverNow − startedAt) mod período`, con la tarea autoritativa del nodo (`workKind`).

| Tarea | Período | Gesto |
|---|---|---|
| Talar (`chop`) | 580 ms = `CHOP_TOTAL_MS` | retrocede 1 px, empuja 4 px en el mordisco (260 ms = `CHOP_MS.windup`), vuelve suave |
| Minería (`mine`) | 500 ms = `SWING_TOTAL_MS` | se carga 1,5 px, golpe seco de 4 px en el golpe (220 ms = `SWING_MS.windup`), rebote hacia atrás con salto |
| Agricultura (`farm`) | 900 ms | inclinación suave de 2 px y el sprite baja 1,5 px; sin impacto |

- El impacto coincide con el beat de la escena de SKILLS (un test lo verifica contra `choppingTimeline`/`miningAction`). El temblor del nodo que ven los observadores ahora usa el mismo beat (`isImpact`).
- `reduceMotion` (preferencia existente del juego) mantiene los pasos del sprite y elimina inclinación y salto.
- Nada de esto toca duración, progreso ni recompensas.

## 4. Archivos

Servidor: `workPlacement.js`/`.d.ts` (nuevo; reemplaza `workerStand.js`, eliminado), `resourceAuthority.js` (ancla, colocación, `no-room`), `worldRoom.js` (pasa `placeActor`), `rooms/PresenceRoom.js` (`placeActor`, `self` en `replay`), `worldProtocol.d.ts` (tipo).
Cliente: `workerPose.ts`, `workerActors.ts`, `sharedWorld.ts`, `worldResourceOverlay.ts`, `wildlands/engine/game.ts` (adopción de secuencia + paso corto), `wildlands/engine/worldLayer.ts` (`reduceMotion`), `worldSkills/client/worldSkillsSession.ts` (mensaje).
Tests: `workPlacement.test.js`, `workPlacement.room.test.js`, `rooms/PresenceRoomPlacement.test.js` (nuevos); `workerPose.test.ts`, `workerActors.test.ts`, `presenceReconciliation.test.ts`, `workerPresentation.acceptance.test.ts`, `integration.test.js` (ajustados).

## 5. Pruebas

| Gate | Resultado |
|---|---|
| realtime (Node 22, incluye integración PGlite) | 168: **148 pass, 0 fail, 20 skip** (staging RC-0.3: requiere stack Supabase local) |
| vitest | **178 archivos, 1724 pass** |
| typecheck / build | OK |
| lint | 0 errores (9 warnings preexistentes en `AuthModal.vue`) |
| Deno / staging | no disponibles en esta máquina (sin Deno, Docker ni Supabase CLI); no se tocó ninguna Edge Function |

Cobertura pedida: Pokémon = casilla validada; retroceso libre; lateral cuando atrás está bloqueado (y orden entre laterales); rechazo limpio real (`pradera:-46:-124:icerock` desde `-46,-123`); la reubicación no cancela (room y presence real); paso manual posterior cancela (incluso hacia el nodo); dueño y observador reciben lo mismo; complete/cancel retiran solo al Pokémon; desconexión mantiene al trabajador y paga una vez; dos acciones vecinas no se pisan casillas; animaciones distintas por tarea y misma fase con el mismo reloj; reducción de movimiento; secuencia adoptada y resincronización por `replay`.

Ajuste de test existente: en `integration.test.js` (Agricultura), tras cosechar el entrenador queda una casilla atrás; el test ahora vuelve a acercarse antes del segundo intento (antes respondía `choose-crop`, ahora primero `too-far`).

## 6. Verificación visual local

Stack 100 % local (realtime benchmark + PGlite en memoria + catálogo sintético; Vite con URL de Supabase muerta), dueño `p` y observador `q`:

| Oficio | Entrenador → espera | Pokémon | Visto |
|---|---|---|---|
| Minería, roca `11,-70` | `10,-70` → `9,-70` | `10,-70` mirando a la derecha | dueño y observador idénticos; chispas de SKILLS intactas |
| Talar, árbol `8,-83` | `7,-83` → `6,-83` | `7,-83` mirando a la derecha | ídem; al terminar el árbol cae, el Pokémon se va y el entrenador queda en `6,-83` |
| Agricultura, parcela `-7,-72` | `-7,-73` → `-7,-74` | `-7,-73` mirando abajo | ídem; el entrenador queda en su casilla tras plantar/cosechar |

## 7. Riesgos y limitaciones

1. **UX:** después de cada trabajo el entrenador queda una casilla atrás; para repetir sobre el mismo nodo hay que volver a acercarse (pedido explícito: no teletransportar).
2. **Parcelas transitables en el cliente:** si el jugador trabaja parado sobre otra parcela, el Pokémon queda sobre esa parcela (es la casilla validada, como pide la regla). El entrenador nunca espera sobre una parcela.
3. El servidor no conoce objetos colocados del cliente (`placedObjects`); la casilla de espera valida solo terreno compartido. Si hubiera uno ahí, la reconciliación del cliente lo corrige al punto seguro.
4. Sincronía del impacto para el dueño: la escena de SKILLS arranca al recibir `WORK_RESULT` (reloj local); el Pokémon, desde `startedAt` (reloj del servidor). Diferencia típica: la latencia de esa respuesta.
5. Clientes 0.3 anteriores: tras la reubicación su primer paso se rechaza como `replay` y se resincronizan (un pequeño tirón). El público 0.2 no se ve afectado (otro realtime).

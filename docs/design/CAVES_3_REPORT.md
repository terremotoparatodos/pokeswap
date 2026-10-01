# CAVES-3 — Primera cueva compartida, caminable y vacía

> Rama `world/caves-walkable-0.3`, base `integration/world-skills-0.3 @ 67f1ad0` (CAVES-2 integrado, YIELD-2 cerrado).
> Diseño de referencia: `CAVE_ECOSYSTEM_ROADMAP.md` §2.1 y `SHARED_DUNGEON_ARCHITECTURE.md` §1.2.

## 1. Resumen

- La boca de la Pradera, `pradera-cueva-inicial` en `(-26,-74)`, pasa a `entrance: 'open'`. **Solo** la casilla de la boca `(-25,-74)` deja de ser roca y es el portal. Los laterales y la espalda siguen sólidos.
- El interior es **una única área compartida**, `cueva-inicial`: un mapa autorado de 21×15 en `caveLayouts.js`, el mismo dato para el navegador y el servicio. No hay instancias por jugador ni por grupo, ni `runId`, temporizador o estado de Dungeon.
- El interior está **vacío**: no tiene nodos, parcelas, salvajes, NPC, cofres, combate, captura, drops, obstáculos, llaves, pisos ni panel del prototipo.
- **El servicio decide cada cruce.** Se entra solo desde la boca y se sale solo desde la salida, y dentro de la cueva cada paso se valida contra el layout.
- **El protocolo WORLD sigue en 3.** El de presencia gana el id de área `cueva-inicial`, con la misma forma de mensaje.

## 2. Decisiones

| Tema | Decisión |
| --- | --- |
| Área | `cueva-inicial`, el `interiorAreaId` canónico de CAVES-2 |
| Mapa | `services/realtime/src/world/caveLayouts.js`: filas de caracteres (`#` roca, `.` suelo, `S` llegada, `E` salida). Fuera de la grilla es roca. Sin semilla ni `Math.random()` |
| Dimensiones | 21×15. Pasillos de ancho ≥ 3 (guarda). 160+ casillas de suelo, todas alcanzables |
| Llegada interior | `S = (10,11)`, mirando hacia adentro (`up`), a dos casillas de la salida: la llegada no la dispara |
| Salida | `E = (10,13)`, con pad visible; lleva a la Pradera |
| Regreso exterior | La aproximación `(-25,-73)`, mirando hacia abajo. No es portal (el portal es la boca), así que no hay loop entrada ↔ salida |
| Mecanismo de transición | El existente: el cliente pisa un portal, hace el fundido y manda `area` (presencia); el servicio responde con un snapshot. Lo nuevo es que el servicio **valida** el cruce (`presence/areaTransition.js`) |
| Render | `src/features/caves/world/caveArea.ts`: hornea el layout con las texturas de cueva existentes (`dungeonTerrain.ts`, solo arte) y un borde oscuro contra la roca. No importa nada del prototipo de Dungeon |
| WORLD | Sin cambios. La cueva no es procedural: el snapshot WORLD llega vacío (sin chunks, nodos ni salvajes), un trabajo ahí se rechaza, y una tarea activa se cancela al cambiar de área (`actorPlaced`, como en cualquier viaje) |

## 3. Autoridad y seguridad

`presence/areaTransition.js` decide, sin mover al actor:

- **Entrar a `cueva-inicial`:** solo desde `pradera`, con la entrada abierta, parado **exactamente** en la boca. Desde la aproximación, otra casilla u otra área, se rechaza.
- **Salir a `pradera`:** solo parado **exactamente** en la salida. Aterriza en la aproximación.
- **Lo demás no cambia:** Ciudad ↔ Pradera, el escape a Ciudad (también desde adentro) y el reset de área.
- **Ante un rechazo:** `presence:error` con motivo `area transition denied` (`protocol/crossing.js`), seguido de un snapshot con el área y la casilla reales. El cliente deja de esperar el área pedida y acepta ese snapshot.
- **Pasos dentro de la cueva:** el servicio los valida contra el layout (`stepAllowed`). Un paso contra una pared o el borde se rechaza como `blocked`, consume la secuencia y se responde con la casilla real, igual que un rechazo por ritmo.
- **Invitados:** `observe` rechaza la cueva (`OBSERVABLE_AREAS`). Solo ve el interior quien entró caminando.
- **Presencia:** se aísla por `areaId` (`interest.js`, sin cambios). Un test lo prueba con coordenadas superpuestas.
- **El cliente no puede:** pedir el área desde otro lugar, elegir coordenadas (se ignoran), atravesar paredes, activar la salida a distancia ni falsificar un cruce.
- **Trabajadores:** la boca no es una casilla válida para pararlos (`workPlacement.standableTile`). La reubicación automática de WORLD nunca deja a un entrenador sobre el portal.

No se toca Supabase, migraciones, Edge Functions, permisos, gate ni economía.

## 4. Commits

| SHA | Contenido |
| --- | --- |
| `ec366c4` | Cierre humano de CAVES-2 (`CAVES_2_REPORT.md` §13) |
| `b7f614f` | Interior canónico, boca abierta, área de presencia, llegadas, guardas del layout y de la boca |
| `e4e13a4` | Bundle de SKILLS regenerado: solo datos (cueva, layout y llegadas), sin cambios de reglas |
| `3c7830a` | Cruces y paredes validados por el servicio, con los tests de sala |
| `92e46fb` | `CaveArea` y portales en el cliente, con las guardas de paridad |
| `3c8d753` | Presencia del cliente y reconciliación de un cruce rechazado |
| `7e16fdd` | Test de aislamiento con coordenadas superpuestas (el control negativo de M3) |
| *(este)* | Informe |

## 5. Tests

- **`world/caveLayouts.test.js`:**
  - una cueva por interior y viceversa;
  - 21×15 con llegada y salida fijas;
  - borde de roca y fuera de la grilla sólido;
  - solo `#`, `.`, `S` y `E`;
  - llegada y salida distintas y no adyacentes;
  - todo alcanzable;
  - pasillos de ancho ≥ 3;
  - llegadas de ida y vuelta iguales a las del protocolo.
- **`world/caves.test.js`:** cueva abierta; solo la boca deja de ser roca, con laterales y espalda sólidos; exactamente una casilla abierta en la huella; la boca no sirve para trabajadores.
- **`rooms/PresenceRoomCave.test.js`, con la sala real:**
  - entrada solo desde la boca, y el rechazo responde con el área real;
  - el cliente no elige el destino;
  - dos jugadores comparten el interior y se ven, y uno de afuera no ve a ninguno;
  - aislamiento con coordenadas superpuestas;
  - paredes y borde validados por el servicio;
  - la salida mueve solo a ese jugador, a la aproximación y sin loop;
  - reconexión dentro de la cueva y salida después de reconectar;
  - sin mundo dentro de la cueva.
- **`caves/caveArea.test.ts`:** paridad exacta de colisión con el servicio, llegada, una sola salida, interior vacío, solo la boca lleva adentro, ningún otro mundo tiene un portal de cueva.
- **Tests existentes extendidos:** el contrato de llegadas (cuatro transiciones nuevas), la reconciliación de presencia (cruce rechazado), la guarda de portales de la Pradera, `zoneParity` y la guarda de cuevas del navegador.

### Controles negativos

Se aplicó cada mutante, se comprobó que fallara y se restauró el archivo.

| Mutante | Lo detecta |
| --- | --- |
| M1: la llegada cae sobre la salida | `caveLayouts.test.js` (3 tests) |
| M2: toda la huella atravesable | `caves.test.js` (3) |
| M3: la presencia ignora el área | `PresenceRoomCave.test.js`: aislamiento con coordenadas superpuestas. Los otros tests de sala sobrevivían, porque sus jugadores estaban lejos; de ahí el commit `7e16fdd` |
| M4: el cliente elige el destino | `PresenceRoomCave.test.js` (5) |
| M5: la salida aterriza en la roca | `caveLayouts.test.js` (3) |
| M6: el servicio ignora las paredes | `PresenceRoomCave.test.js` (2) |
| M7: el cliente ignora el rechazo | `presenceReconciliation.test.ts` (1) |
| M8: desaparecen las paredes del cliente | `caveArea.test.ts` (1) |
| M9: el cliente aterriza en la boca al salir | `caveArea.test.ts` y el contrato de llegadas (2) |

## 6. Gates (Node 22, punta `7e16fdd`)

| Gate | Resultado |
| --- | --- |
| Realtime focalizado (cuevas, layout, salas, presencia, protocolo, placement, zonas, salvajes) | 95/95 |
| Vitest focalizado (cuevas, mundo, wildlands) | 92 archivos, 493/493 |
| `zone-layout --check` | al día |
| Drift de SKILLS | OK |
| Multi-yield y recuperación | 98/98 |
| Migraciones y SECURITY-3 (PGlite) | 32/32 |
| Guard de webhooks: tests y `check` | 28/28 y ✓ |
| Pacing | ✓ |
| Realtime completo | 302 aprobados, 0 fallos, 21 omitidos (staging) |
| Vitest completo | 188 archivos, 1814/1814 |
| typecheck y lint | OK; lint con 0 errores y 9 warnings ya existentes |
| Build normal y Playtest, con `bundle-check` del retiro de Swap | ✓ |

**Staging y Deno omitidos:** no cambian SQL, migraciones ni Edge Functions (`supabase/` sin cambios), y el staging valida el contrato con la base, que no se tocó.

## 7. Prueba humana (entorno oscuro)

1. Titan123 camina hasta la boca de la cueva en la Pradera y la pisa: entra y aparece en el interior, mirando hacia adentro, lejos de la salida.
2. terremototw entra igual: los dos se ven y se mueven en la misma cueva.
3. Ninguno puede atravesar las paredes ni los pilares.
4. Titan123 pisa el pad de salida: vuelve a la Pradera, frente a la boca, no sobre ella. terremototw sigue adentro.
5. Desde afuera, Titan123 no ve a terremototw adentro. terremototw ya no lo ve.
6. Volver a entrar exige pisar otra vez la boca.
7. Recargar dentro de la cueva te deja dentro, en tu casilla, y la salida sigue funcionando.
8. Talar y minar en la Pradera siguen funcionando (YIELD-2).
9. Dentro de la cueva no hay recursos, salvajes ni ningún panel de Dungeon.

## 8. Deuda para CAVES-4 y siguientes

1. **Ciudad ↔ Pradera sigue sin validarse en el servicio**, como antes de CAVES-3: un cliente modificado puede pedir cualquiera de las dos áreas desde cualquier lugar. Conviene generalizar `areaTransition` a esos portales.
2. **Caminabilidad del servicio fuera de las cuevas:** en la Pradera y la Ciudad sigue decidiendo el cliente (`movement.js`). La cueva es la primera área con colisión validada en el servicio.
3. **Iluminación:** el interior no tiene oscuridad ni antorchas. `DUNGEON_DARKNESS` vive en la escena del prototipo y no está expuesto al renderer general.
4. **Toque sobre la roca** (CAVES-2 §10.6): la boca sigue sin hitbox propio para "tocar la boca y caminar hasta la aproximación".
5. **Clientes viejos:** un bundle anterior a CAVES-3 no conoce `cueva-inicial`. No puede pedirla, y ve la boca como roca. Hay que reiniciar realtime y cliente juntos.
6. **Benchmark de 100 actores en 3 áreas** (hoja de ruta §2.1): no se corrió en esta fase.
7. **La reconexión pasados 15 s** devuelve a la Ciudad, no a la aproximación de la cueva (D8 de CAVES-1). Hoy no hay caso en que eso deje al jugador en roca.

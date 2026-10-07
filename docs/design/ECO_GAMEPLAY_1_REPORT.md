# ECO-GAMEPLAY-1 — Primera población compartida visible y respawn experimental

**Estado:** implementado y verificado en local, aislado.
- Rama `feat/eco-gameplay-1-0.3`, en el worktree `pokeswap-eco-gameplay1`, desde `50842f8`. Esa base contiene `ad6a98e` (ancestro verificado) y su árbol `149380ab…` coincide con el del preflight.
- Sin push, integración, Cloud, gastos, SQL hosted, flags productivos ni cambios en procesos existentes.
- **Es experimental y solo de desarrollo:** el servidor rehúsa arrancar con el experimento en producción.

**Contrato previo:** [`ECO_GAMEPLAY_1_CONTRACT.md`](ECO_GAMEPLAY_1_CONTRACT.md) (commit `6bb94f1`).

## 1. Qué se entregó

| Punto | Resultado | Dónde |
|---|---|---|
| 1. Admisión R1/R2 empaquetada para Node | Bundle aparte `admission.generated.js` (API 1). Exporta solo `admitEcoPopulation`, `ECO_ADMISSION_API` y `ECO_ADMISSION_AREAS`, y entrega una población **admitida** y opaca o nada. El motor suelto no se exporta. El `?raw` del snapshot va como texto inmutable. El bundle v2 queda intacto. | `src/features/ecosystem/server/admissionRuntime.ts`, `scripts/integration/bundle-admission.mjs` |
| 2. Una población compartida por área, con reloj y RNG del servidor | Una población admitida por proceso, que cubre Pradera (zonas abierta y bosque) y Cueva. Datos del servidor: layouts autoritativos (`layoutVersion`), reloj del mundo, `node:crypto` y áreas activas según los espectadores. Falla cerrado. | `services/realtime/src/world/ecoPopulation.js`, `worldRoom.js`, `worldConfig.js` |
| 3. Identidad de encuentro independiente de especie y dueño | `<namespace>:<área>:<nido>:<generación>:<miembro>`, con namespace nuevo por proceso. Para el cliente es opaca; dos ejemplares de una especie tienen ids distintos. | ídem + `worldProtocol.js` |
| 4. Estado autoritativo en el cliente, sin dos sistemas | **Servidor:** con el experimento no existe `WildService` (no hay roster). **Cliente:** un área ECO no nula reemplaza al roster; un actor por id; panel dev de retirada. Todo detrás de `ECO_EXPERIMENT` (DEV + `VITE_ECO_EXPERIMENT=on`). | `sharedWorld.ts`, `population.ts`, `EcoDevPanel.vue`, cableado en `colyseusPresence.ts`, `WildlandsView.vue`, `game.ts`, `area.ts`, `worldLayer.ts` |
| 5. Entorno aislado para dos clientes y prueba humana | Lanzador con entorno explícito mínimo y prueba e2e de dos clientes | `scripts/ecosystem/eco-gameplay-local.mjs`, `scripts/ecosystem/eco-gameplay-e2e.mjs` |

**Datos y balance:** se usan los existentes, **provisionales y sin cambios**:
- respawn por grupo de 75 s ± 20 %, con reintento a 15 s;
- dormancia a los 5 min, con stagger de 5–15 s;
- capacidad: Pradera 18 (abierta 12, bosque 6) y Cueva 6;
- nidos ECO-MAP-1 y catálogo ECO-1.

**No se otorga nada:** la retirada de prueba usa la causa `fled` fijada por el servidor, y no hay captura, drop, token ni escritura persistente.

## 2. Verificación

| Gate (Node 22.23.2, Windows) | Resultado |
|---|---|
| `vitest run` (proyecto completo) | **230 archivos / 2187 tests, exit 0** (incluye 17 de admisión, 6 de presentación, 5 de `SharedWorld` y los guards de aislamiento ampliados) |
| Realtime `node --test 'src/**/*.test.js'` | **625: 591 pasan / 34 omitidos / 0 fallos, exit 0**, en la segunda corrida. Los 34 son los mismos casos de staging del preflight. La primera corrida tuvo **1 fallo intermitente** (ver §5). |
| `vue-tsc` (typecheck) | exit 0 |
| `eslint .` | exit 0: 0 errores, 9 warnings preexistentes en `AuthModal.vue` |
| `bundle-encounters --check`, `bundle-admission --check`, `event-classification --check`, `map-geometry --check`, `map-nests --check`, `validate-inputs` | exit 0 en todos |
| Build de producción (`vite build --sourcemap`, en carpeta propia) | exit 0. 12 source maps y 192 fuentes únicas, ninguna de ECO, del bundle de admisión, del adaptador ni del panel. 0 apariciones de `ecoProtocol`, `EcoDevPanel`, «Retirar (prueba)», `admitEcoPopulation`, `createValidatedPopulation` y `ECO_ADMISSION`. |

**Prueba de punta a punta contra el realtime aislado:** `eco-gameplay-e2e.mjs` usa dos jugadores sintéticos con el SDK real y el protocolo del navegador. Resultado **PASS**:
- los dos ven la **misma lista de 11 encuentros**;
- hay varios ejemplares por especie: #19×2, #187×2, #43×2 y #13×2;
- A retira un grupo de 2 y desaparece para ambos en el mismo flush;
- el nido **reaparece con una generación nueva a los 73 s**, visto por ambos.

**Navegador (build de desarrollo servido localmente, dos pestañas eco-a y eco-b):**
- las dos muestran Pradera (−5, −69) y el panel «activa · 11 en el área», con **la misma lista**;
- «Retirar (prueba)» en eco-b responde «Retirado…» y **las dos** pasan a 10 sin ese encuentro;
- el jugador remoto se ve en la otra pestaña;
- **pendiente para la prueba humana:** no llegué a caminar hasta un encuentro (estaban a 18–27 tiles y el desplazamiento en el panel del navegador fue muy lento), así que el dibujo del sprite en el mapa quedó sin verificar a ojo. Lo cubren los tests de `Population`.

**Entorno:**
- `.claude/launch.json` del checkout principal se restauró byte a byte (sha256 `9980aba9…`, igual al de antes);
- los puertos 2790, 2791 y 5199 quedaron libres;
- el entorno oscuro (2567/2568/5173) no estaba escuchando y no se tocó.

## 3. Prueba humana (dos clientes)

En el worktree, con Node 22:

```bash
node scripts/ecosystem/eco-gameplay-local.mjs realtime
```

```bash
node scripts/ecosystem/eco-gameplay-local.mjs client
```

1. **Abrir dos ventanas** (tiene que ser `127.0.0.1`, no `localhost`: el realtime solo admite ese origen):
   - `http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-a`
   - `http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-b`
2. **Misma población.** En las dos ventanas:
   - el HUD dice «Pradera»;
   - el panel «ECO · experimento (dev)» dice «activa · N en el área», con el mismo N;
   - la lista coincide: especie, nido:generación:miembro y tile.

   Deberían verse especies repetidas (dos o más con el mismo #).
3. **Ver a los Pokémon:**
   - caminar (click en el suelo o WASD con el foco en el mapa) hacia el tile de un encuentro de la lista;
   - tiene que verse el sprite en el mismo lugar y moviéndose igual en las dos ventanas;
   - nunca sobre agua, caminos, portales, recursos ni zonas de trabajo.
4. **Retirada y respawn:**
   - en una ventana, «Retirar (prueba)» sobre un encuentro: desaparece en **las dos**;
   - para ver el respawn, retirar a **todos** los miembros de ese grupo (mismo `nido:generación`);
   - en unos 60–90 s (75 s ± 20 %, más reintentos si está bloqueado) aparece un grupo nuevo en ese nido, con la generación +1, en las dos ventanas.
5. **Límites:** el contador de Pradera nunca pasa de 18.
6. **Opcional:**
   - sin abrir ventanas, `node scripts/ecosystem/eco-gameplay-e2e.mjs` repite la verificación automática;
   - entrar a la Cueva por su portal muestra su propia población.
7. **Cerrar:** Ctrl+C en las dos terminales. El build del cliente queda en la carpeta temporal que imprime el lanzador.

## 4. Límites

- **Solo experimental y de desarrollo:**
  - `WORLD_ECO_EXPERIMENT=on` con `NODE_ENV=production` impide arrancar;
  - el cliente solo pide ECO en un build de desarrollo con `VITE_ECO_EXPERIMENT=on`.
  - El roster horario **sigue siendo el camino de producción**: no se borró. En el modo experimental no existe; quitarlo definitivamente es una decisión posterior (AGENTS §14).
- **Un host, en memoria:** reiniciar el realtime vacía la población y cambia el namespace. No hay persistencia, multi-host, fencing ni recuperación.
- **Geometría estática:** las apariciones respetan el snapshot verificado (banderas prohibidas) y los límites del motor.
  - No consideran la ocupación dinámica de jugadores o trabajos.
  - Una vez aparecido, el Pokémon patrulla alrededor de su tile con la patrulla compartida existente, como los wilds actuales.
- **Retirada de prueba:** cualquier jugador del área puede retirar cualquier encuentro. No hay reserva, contención, combate ni captura; no certifica ninguna regla de gameplay.
- **Protocolo:** cada cambio envía el área completa (como mucho 18 encuentros), no deltas.
- **Clientes sin `ecoProtocol`:** contra un servidor experimental no ven población (`wildStatus: unavailable`, falla cerrado).
- **Sin cambios de balance:** los valores son provisionales y no están aprobados.
- **Fallo intermitente del realtime:**
  - en la primera corrida completa, `realtimeServer.test.js` («a join during the shutdown is refused with 4503») recibió `ECONNRESET` en lugar de `4503`;
  - no se reprodujo en 3 corridas aisladas ni en la corrida completa siguiente;
  - es una prueba del cierre del servidor, con el modo ECO apagado, y no la toca esta entrega;
  - se informa sin atribuirle causa.
- **Caché de vitest:** se escribe dentro del worktree (`src/node_modules/`, ignorado por git).

## 5. Preguntas abiertas (producto)

- Reserva y contención de encuentros, combate y captura: qué reemplaza a la retirada de prueba.
- Ocupación dinámica (jugadores, trabajos) en la elegibilidad de tiles.
- Persistencia de la población, época o namespace persistente y multi-host antes de cualquier valor persistente.
- Reemplazo del roster en producción y compatibilidad con clientes viejos.
- Balance de respawn, dormancia y capacidad sobre los nidos reales (siguen provisionales).

## 6. Commits

| Commit | Contenido |
|---|---|
| `6bb94f1` | Contrato motor ↔ servidor ↔ cliente |
| `b66e71b` | Admisión empaquetada para Node (punto 1) |
| `044d1e8` | Población compartida, reloj/RNG del servidor, identidad, protocolo y guards (puntos 2–3) |
| `18f478c` | Presentación en el cliente y panel de retirada de prueba (punto 4) |
| `1433867` | Entorno aislado y prueba e2e (punto 5) |
| (este documento) | Reporte |

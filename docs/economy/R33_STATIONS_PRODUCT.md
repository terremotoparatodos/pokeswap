# R33 — Estaciones productivas y el proceso del Horno

> Fecha: 2026-09-19. Estación **principal**.
> Rama: `feat/r33-stations-product`, desde `3736a8ec53730698ca2112cf1ba8d7834d7b7425` (R32.4, HUMAN APPROVED).
> Base contractual previa: [`../wildlands/R32_INTEGRATION_AUDIT.md`](../wildlands/R32_INTEGRATION_AUDIT.md) §10 (roadmap) y §3 (T-S3 congelado), [`PRE_R32_DESIGN_DECISIONS.md`](PRE_R32_DESIGN_DECISIONS.md) A-7/A-8, [`CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md`](CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md) §2 y §5, [`../wildlands/F1_OBSTACLE_PROVIDER_DESIGN.md`](../wildlands/F1_OBSTACLE_PROVIDER_DESIGN.md) §11.
> Leyenda: `FACT` verificado en código · `DECISION` decidido acá, con su motivo · `OPEN` sin decidir.

**Qué es R33:** la infraestructura reutilizable de estaciones, y el primer proceso real que la usa —`mineral bruto → Horno → lingote`— con footprint mayor a 1×1, estados visuales, tiempo controlable y dominio serializable.

**Qué NO es:** balance económico, persistencia, autoridad de servidor, construcción por el jugador, Fogata/Banco jugables, Dungeon, ni rediseño de la Mesa de Alquimia.

> **Microfase de cierre (2026-09-19).** Se aclaró la frontera producción/DEV (§2.1 y §2.2), se cerró `O-9` con un contrato de placement explícito (§12.1), se congeló la frontera de reloj (§7 y §9), se nombró el comportamiento de mochila llena (§6.1) y se fijaron como v1 "un proceso por estación" y "cancel sólo en READY" (§4.1). Todo ello está enforced por tests, no sólo escrito acá.

---

## 1. Auditoría previa (R31 y F-1), antes de diseñar nada

`FACT` Lo que ya existía y R33 **reutiliza** en lugar de duplicar:

| Pregunta | Respuesta del código |
|---|---|
| ¿Cómo existen los recursos? | `domain/catalog/items.ts`: 50 ítems con `kind`/`tier`/`tags`. Ya están `iron_ore`, `gold_ore`, `coal`, `iron_ingot`, `gold_ingot`, `steel_ingot` y la estructura `smelter` |
| ¿Cómo se representa el inventario? | Dos vistas: `Inventory` (`Record<itemId, number>`, lo que toma `resolveProcessing`) e `inventory/slotInventory.ts` (bolsa por slots con stacks y overflow, lo que usa el prototipo) |
| ¿Qué profesiones existen de verdad? | `mining`, `woodcutting`, `fishing`, `alchemy`. **No** existe Construcción (`A-9` sigue sin implementar) |
| ¿Qué queda de Alquimia? | Todo: overlay, `brewTimeline`, `stationPlacement`, controller y su `PlacedObject` (F-1). Intacta |
| ¿Qué estación ya existía productivamente? | Solo la Mesa de Alquimia, con tile **derivado** por espiral y footprint 1×1 |
| ¿Cómo funciona `PlacedObjects`? | Registro por área en memoria del cliente; `at` / `isSolid` / `isInteractive`; `placedObject()` expandía `width`/`depth`; el feature **declara** y el motor registra en cada `enterArea` |
| ¿Había proceso o timer? | **No.** `resolveProcessing` es instantáneo y `brewTimeline` es **animación**: si recargabas a mitad del brebaje, nunca había pasado nada |
| ¿Hay workers reales? | No. `demo/demoWorkers.ts` son fixtures y `DemoState.workers` guarda un `speciesId` por profesión, no una `PokemonInstance` |

`FACT` **La brecha real de R33 era el tiempo, no el crafteo.** Procesar ya funcionaba; lo que no existía era un trabajo que siguiera existiendo mientras nadie mira. Por eso R33 agrega una capa de proceso **encima** de `resolveProcessing` y no un segundo sistema de recetas.

---

## 2. Arquitectura

Tres capas, el mismo corte que usa `domain/types.ts`:

```text
StationDefinition    qué tipo de estación es       estático, versionado en código
PlacedStation        esta estación, acá             el registro que un servidor guardaría
StationProcessState  el trabajo que hace ahora      JSON puro, con identidad y duración
```

| Módulo | Rol |
|---|---|
| `stations/stationFootprint.ts` | La forma: celdas, rectángulo, máscara, anillo de acceso, centro del frente, tile más cercano |
| `stations/stationDefinition.ts` | El catálogo de tipos. Las recetas **se derivan** de `RECIPES` por `station`, nunca se copian |
| `stations/stationProcess.ts` | La máquina de estados pura: `prepare`/`start`/`advance`/`collect`/`cancel` |
| `stations/stationInstance.ts` | Una estación colocada: tiles, anillo, alcance, `ownerId?`, `workerInstanceId?` |
| `stations/stationVisualState.ts` | `StationProcessState → StationVisualState`, el único punto donde los dos vocabularios se tocan |
| `stations/stationSerialization.ts` | JSON adentro, JSON afuera, fail-closed |
| `stations/stationPlacement.ts` | El registro `StationPlacement`, la validación y la declaración estructural a F-1 |
| `stations/devStationPlacement.ts` | **DEV.** Búsqueda en espiral de un lugar libre. No es contrato |
| `stations/stationSession.ts` | Adaptador entre `Inventory` y la bolsa por slots del prototipo |
| `stations/furnaceOverlay.ts` | Dibuja el arte aprobado en el estado que reporta el dominio |
| `stations/useFurnaceController.ts` | La superficie Vue. No tiene reglas |
| `components/FurnaceStationCard.vue` | El panel. Funcional, no definitivo |

`FACT` `stations/` no importa el motor en su mitad pura; el overlay y el controller usan exactamente la misma superficie que ya usaba la Mesa (`world`, `area`, `sceneOverlay`, `game` solo como tipo, `areas/atlas`). La regla de aislamiento de R31 lo fija (`professionsIsolation.test.ts`).

### 2.1 Módulos production-ready

`FACT` **Lo que entra al bundle de producción hoy, y que todo jugador corre:** el trabajo de R33 sobre la capa física del motor.

| Módulo | Qué aporta R33 |
|---|---|
| `wildlands/engine/placedObjects.ts` | `cells` para formas arbitrarias, `placedFeet` (centro del frente), `nearestTile` (Manhattan) |
| `wildlands/engine/renderer.ts` | Proyecta el hitbox desde `placedFeet` |
| `wildlands/engine/game.ts` | Reapunta un toque al tile más cercano del objeto tocado |
| `wildlands/engine/picking.ts` | Sin cambios; su prioridad sigue siendo la contractual |

`FACT` **Código apto para producción que todavía no se importa desde producción**, porque no hay razón de producto para mostrarle un Horno a los jugadores. No tiene ningún gate DEV propio: lo único que lo mantiene fuera del bundle es que nada productivo importa `features/professions/`.

| Módulo | Rol |
|---|---|
| `stations/stationDefinition.ts` | El catálogo de tipos |
| `stations/stationFootprint.ts` | La forma |
| `stations/stationProcess.ts` | La máquina de estados pura |
| `stations/stationInstance.ts` | La estación colocada |
| `stations/stationPlacement.ts` | El registro de placement, la validación y la declaración a F-1 |
| `stations/stationVisualState.ts` | El mapeo proceso → visual |
| `stations/stationSerialization.ts` | JSON seguro, fail-closed |

### 2.2 El vertical slice DEV

`FACT` **Lo que existe sólo para poder probarlo un humano.** Nada de esto lo correría un servidor, y nada de esto es contrato.

| Módulo | Por qué es DEV |
|---|---|
| `stations/useFurnaceController.ts` | Superficie Vue; **el único lugar donde se lee un reloj de pared** (`session.sync()` sobre `Date.now`) |
| `stations/stationSession.ts` | Adaptador contra la bolsa por slots de la sesión demo local, que no persiste nada |
| `stations/furnaceOverlay.ts` | Dibujo dentro del renderer, y caché del tile derivado |
| `stations/devStationPlacement.ts` | La búsqueda en espiral. **No es el contrato de placement** (§12.1) |
| `components/FurnaceStationCard.vue` | El panel. Funcional, no definitivo |
| `components/world/ProfessionWorldDemo.vue` | El cableado, montado sólo con `import.meta.env.DEV` |

`FACT` **El Horno de Pradera es un fixture del harness, no una integración productiva.** Aparece porque `ProfessionWorldDemo` está montado en desarrollo; en producción esa rama del árbol no existe. Decir "integración productiva" sería falso, y la entrega original lo decía mal.

`FACT` `stationBoundary.test.ts` congela exactamente este corte: qué es motor de producción, que el motor no conoce estaciones, que toda la feature cuelga de dos entradas con `import.meta.env.DEV`, y que ningún módulo de estaciones se auto-gatea.

---

## 3. Los cuatro estados

`DECISION` Semántica productiva, no de hover:

| Estado | Significado | Cómo se llega |
|---|---|---|
| **IDLE** | No hay proceso. `PlacedStation.process === null` | Inicio, y después de `collect` o `cancel` |
| **READY** | Hay una receta preparada, **con sus insumos ya tomados** del jugador, y puede empezar | `prepare` |
| **WORKING** | Empezó y todavía no terminó | `start` |
| **DONE** | Terminó; hay algo para retirar | El tiempo se cumplió |

`DECISION` **`ready` no es adyacencia.** La Mesa de Alquimia muestra `ready` cuando el jugador se acerca: eso es estado de UI con nombre de estado de mundo. El Horno está `ready` porque un proceso está reteniendo su mineral. Nada en el mapeo visual lee el inventario del jugador. La Mesa no se tocó; la diferencia queda documentada acá y en el encabezado de `furnaceOverlay.ts`.

`DECISION` IDLE se modela como **ausencia** de proceso y no como una cuarta fase del registro, para que "no hay trabajo" no tenga que inventar un `recipeId` ni una duración. `stationPhase()` devuelve los cuatro estados.

---

## 4. Ciclo de vida y errores

```text
IDLE ──prepare──▶ READY ──start──▶ WORKING ──(tiempo)──▶ DONE ──collect──▶ IDLE
                    │
                    └──cancel──▶ IDLE (devuelve los insumos)
```

Todo rechazo es estructurado: un `code` y, cuando corresponde, la fase en la que realmente estaba.

| Situación | Código |
|---|---|
| Faltan insumos | `missing_inputs` — y **no se gasta nada** |
| Preparar una estación ocupada | `station_busy` + fase |
| `start` sin `ready` | `not_ready` + fase; un segundo `start` da `already_started` |
| `collect` antes de `done` | `not_done` + fase |
| Doble `collect` | `no_process` (fase `idle`): no hay qué acreditar |
| Receta inválida / no soportada | `unknown_recipe` / `recipe_not_supported` |
| Nivel, cantidad, identidad | `level_too_low`, `invalid_quantity`, `invalid_process_id` |
| Cancelar algo ya iniciado | `not_ready` + fase `working` |
| Una estación del catálogo que R33 no hizo funcionar | `station_not_productive` (§10, Fogata y Banco) |
| Una lectura de reloj inservible (`Infinity`, `NaN`) | `untrusted_clock` + fase (§7) |
| El output no entra en la mochila | `output_capacity_exceeded` + fase `done` — no se pierde nada (§6.1) |

`FurnaceStationCard.vue` traduce cada código a una frase; ningún código llega al jugador.

### 4.1 Decisiones v1: un proceso, y cancel sólo antes de empezar

`DECISION` **Una estación corre un proceso a la vez.** Preparar sobre una estación que está en READY, WORKING o DONE se rechaza con `station_busy` y la fase real. No hay cola.

Que más adelante haya cola no obliga a rehacer nada: la identidad vive en el **proceso** (`processId`), no en la estación, así que una cola es una lista de procesos al lado de uno activo, y no un cambio de modelo. `PlacedStation.process` es un proceso o `null`, nunca una lista, precisamente para que el día que sea una lista sea una decisión visible.

`DECISION` **Cancelar es sólo desde READY**, y devuelve los insumos comprometidos exactamente. Desde WORKING se rechaza con `not_ready` + fase `working`, y desde DONE también: lo terminado se retira, no se cancela.

Una cancelación con penalización —combustible perdido, devolución parcial, tiempo castigado— es diseño y balance, y R33 no lo abre. Lo que R33 congela es que **v1 no tiene una forma silenciosa de perder insumos**.

---

## 5. Reserva de insumos

`DECISION` **Los insumos se comprometen atómicamente al entrar en READY.** Salen de la bolsa una sola vez, y el proceso pasa a ser su dueño.

La alternativa —reservar un derecho y consumir al iniciar— necesita un segundo registro que mantenga la reserva honesta y una regla para qué pasa si el inventario cambia en el medio. Tomarlos una vez, por adelantado, hace imposible que dos trabajos gasten el mismo mineral, y `cancel` antes de arrancar los devuelve exactamente.

`DECISION` **El resultado se resuelve al preparar, no al retirar.** `prepareProcess` llama a `resolveProcessing` y guarda qué se consumió, qué se produce y cuánta XP. Por eso completar mil veces no produce dos veces, y por eso un servidor podrá calcular el registro una vez y entregarle al cliente una proyección de él.

---

## 6. Cancelar

`DECISION` `READY → cancel` devuelve los insumos comprometidos y deja la estación IDLE.
`DECISION` `WORKING → cancel` se **rechaza**. Reembolsos parciales, combustible desperdiciado o penalizaciones son decisiones de producto que R33 no toma. Detalle en §4.1.

### 6.1 Mochila llena: `output_capacity_exceeded`

`DECISION` Si el output no entra en la mochila, **no se pierde nada**:

| | |
|---|---|
| El retiro | se rechaza con `output_capacity_exceeded` y la fase `done` |
| La estación | sigue **DONE**, con el mismo `processId` y el mismo output |
| El output | **no** se vuelve a generar |
| Los insumos | **no** se vuelven a consumir |
| La sesión | se devuelve idéntica: el llamador recibe el mismo objeto que pasó |
| Después | liberar un espacio y retirar funciona, **una** vez; un segundo retiro da `no_process` |

Lo mismo vale para descargar una estación READY contra una mochila llena: los insumos se quedan con el proceso y la estación sigue READY.

`DECISION` El código se llama `output_capacity_exceeded` y no `inventory_full` porque lo que se excedió es la capacidad para **ese resultado**, no un estado global del jugador; el panel lo dice como *«Necesitás espacio en la mochila para retirar el resultado. El horno lo guarda hasta entonces.»*

`OPEN` Escrow, buzón y caída al suelo son diseños posteriores. R33 elige la opción que no pierde nada y no inventa un sistema nuevo: el resultado se queda donde ya estaba.

---

## 7. Tiempo

`FACT` No hay `Date.now`, `setTimeout`, `setInterval`, `performance.now` ni `Math.random` en ningún módulo de `stations/` fuera de los tests; un test escanea las fuentes de la carpeta para que siga siendo cierto.

`DECISION` El proceso guarda `startedAtMs` y `durationMs`; lo que queda se **deriva** (`remainingMs(process, nowMs)`). El reloj es un parámetro:

- hoy lo aporta el reloj de la sesión demo (`DemoState.now`), que sale de `Date.now()` en el controller. **Ese `Date.now()` del cliente NO es tiempo autoritativo de estación**: sirve para conducir la demo local y nada más;
- mañana lo aporta el `AuthorityClock` del servidor (R32.4) sin tocar el dominio: `server clock → StationProcess`, igual que las foundations de R32.4.

`DECISION` **No existe ninguna API que signifique «el cliente dice que el proceso terminó».** No hay `completeProcess(process)`, no hay flag `done: true`, no hay opción de forzar. El único camino a DONE es entregar una lectura y que se compare contra `startedAtMs + durationMs`. Un test escanea `stationProcess.ts` para que siga siendo cierto si alguien agrega una función nueva.

`DECISION` Una lectura que no es un número finito se **rechaza**, no se cree. `Infinity` y `NaN` son justamente los dos valores a los que echaría mano un llamador que quiere terminar el proceso ya, y con ellos el trabajo sigue corriendo:

| Llamada | Con una lectura inservible |
|---|---|
| `remainingMs` | devuelve la duración **entera**, nunca cero |
| `advanceProcess` | devuelve el proceso sin tocar: sigue WORKING |
| `advanceProcessChecked` | `{ ok: false, error: { code: 'untrusted_clock', phase } }` |
| `startProcess` | `untrusted_clock`: ni siquiera se puede arrancar |

`advanceProcess` es la forma que quiere un poll por frame —dale cualquier cosa, devolvé un proceso—; `advanceProcessChecked` es la que quiere quien está **decidiendo** (un tick de servidor, un test), porque distingue «todavía no» de «esa lectura no servía».

`FACT` **Recarga a mitad de proceso:** con esos dos números alcanza. Un test serializa un proceso en marcha, lo lee en frío y comprueba que le queda exactamente lo mismo y que termina en la misma lectura de reloj. No hay un timer vivo que sea la única verdad.

`FACT` **Lección de la prueba viva.** El primer cableado leía `state.now` sin sincronizar la sesión, así que el panel mostraba "quedan 9 s" para siempre: el trabajo se juzgaba contra un instante ya pasado. Las pruebas unitarias no podían verlo porque el dominio recibe el reloj como argumento; lo encontró la verificación en el navegador. `furnaceController.test.ts` mueve el reloj de pared con un stub de `Date.now` y falla sin el arreglo.

---

## 8. `processId`

`DECISION` Cada corrida tiene identidad estable, **inyectada** por quien la pide: el prototipo usa `<stationId>#<contador>`, un test usa `run-1`, y un servidor usará la suya. Nunca `Math.random()`. Es lo que va a permitir idempotencia y persistencia más adelante.

---

## 9. Frontera de autoridad y persistencia

`FACT` R33 **no** conecta las estaciones a R32.4. No hay Colyseus, Supabase, persistencia ni red. El registro vive en memoria del cliente, como el de F-1.

`DECISION` Lo que el dominio deja listo para que el servidor lo tome sin reescribirlo:

- la acción es describible como un pedido verificable: `(jugador, stationId, recipeId, cantidad, processId, workerInstanceId?)`;
- el estado es JSON plano y versionado (`STATION_PROCESS_VERSION`), sin clases ni `Date`;
- el reloj es un argumento, y una lectura inservible se rechaza en vez de creerse (§7);
- el resultado se decide una vez y se guarda, así que reenviar `advance` o `collect` no cobra dos veces;
- la posición es dato consultable por tile, no una derivación con trigonometría.

`OPEN` Cuando exista autoridad, el servidor decidirá: quién puede `prepare`/`start`/`collect`, la reserva, el reloj, la propiedad y la idempotencia del proceso. **Nada de eso se decide acá.** Un `startedAtMs` del cliente no puede tener semántica irreversible.

`FACT` R33 **no conecta** R32.4. La conexión es de una sola línea —quién provee `nowMs`— y es deliberadamente de R34 en adelante.

---

## 10. El Horno

`FACT` Arte **HUMAN APPROVED** portado de `art/station-visual-language` @ `ee5f6924e3a59a8f70a19eb84b2d78a629b1a65b`, sin rediseñar nada: el contrato compartido, el Horno, la Fogata, el Banco, sus tests y `STATION_VISUAL_LANGUAGE.md`. **No se trajo** el lab `/dev/estaciones` ni su ruta.

`FACT` El Horno usa sus **cuatro** variantes reales (`idle`, `ready`, `working`, `done`), y solo `working` anima.

### Recetas

`DECISION` Se usan las recetas que el catálogo de R31 **ya tenía**, con sus ids, cantidades y combustible. No se creó ningún ítem ni ningún id nuevo.

| Receta | Entra | Sale | Nivel | `baseSeconds` |
|---|---|---|---|---|
| `smelt_iron` | 2 `iron_ore` + 1 `coal` | 1 `iron_ingot` | 12 | 6 |
| `smelt_gold` | 2 `gold_ore` + 2 `coal` | 1 `gold_ingot` | 28 | 8 |
| `make_vial` | 2 `stone` + 1 `coal` | 2 `vial` | 6 | 5 |
| `forge_steel` | 2 `iron_ingot` + 2 `coal` | 1 `steel_ingot` | 35 | 9 |

`DECISION` **Combustible: R33 no tomó ninguna decisión nueva.** `coal` ya era un insumo declarado de `smelt_iron`, `smelt_gold`, `make_vial` y `forge_steel` desde R31 (`domain/catalog/recipes.ts`), con esas cantidades. R33 **reutilizó las recetas tal como estaban**: no agregó carbón a ninguna receta, no cambió un ratio, no inventó una carga acumulada y no hizo del combustible un concepto del contrato de proceso — para el proceso, `coal` es un insumo más.

Cualquier revisión futura de combustible, ratios o eficiencia (separar *material* de *combustible*, carga acumulada de la estación, ahorro por el atributo Eficiencia) es **balance y economía**, y sigue abierta en `O-8` / `A-12`.

`DECISION` **Valores `PLAYTEST / FOUNDATION`.** Duración, cantidades, niveles y XP son los del catálogo, tomados como estaban. La duración efectiva es `baseSeconds × 1.5` porque R33 no tiene modelo de propiedad y toda estación es la **pública** más lenta (`PUBLIC_STATION_TIME_MULTIPLIER`). Nada de esto es balance: es `A-12` / `O-8`.

### Fogata y Banco

`FACT` Su arte y su `StationDefinition` están en el catálogo, con `productive: false`. Así el catálogo conoce las tres estaciones aprobadas sin que R33 abra su gameplay.

`DECISION` **Estar en el catálogo no las vuelve jugables, y eso es un guardián, no una omisión.** `prepareProcess` rechaza con `station_not_productive` cualquier estación cuya definición no sea `productive`, **antes** de mirar la receta, el nivel o el inventario — así que ni siquiera una receta que la Fogata soportaría (`render_fish_oil`, `brew_vigor_tea`) puede arrancar, y nada se gasta en el intento. Sus recetas no se implementan.

### Mesa de Alquimia

`FACT` Coexiste sin cambios: su arte, su tile determinista, su overlay, su controller y su `PlacedObject`. Está en el catálogo de estaciones solo para que la consulta sea completa. El snapshot congelado de overlays (`a62f2ebb8372073d1d669d4217a84f3e`) no se movió.

---

## 11. Footprint mayor a 1×1

`FACT` F-1 ya guardaba el footprint como lista y tenía un test de 2×2 en el registro, pero **nunca colocaba** nada más grande, así que tres reglas río abajo no se habían ejercitado nunca.

`DECISION` El Horno ocupa **2×2**. No es un número al azar ni el tamaño del sprite: un horno con chimenea es lo más voluminoso del claro, y el segundo tile de profundidad es lo que obliga a rodearlo en vez de rozar una marca de un tile. Su arte mide 30×34 px sobre 32×32 px de suelo — el sprite puede sobresalir del footprint, nunca al revés.

`DECISION` El footprint es **una lista de celdas**, no dos números: `rectFootprint(w, d)` para rectángulos y `maskFootprint(filas)` para cualquier otra forma. Una fragua en cruz es otra lista, no otro tipo. `dx` puede ser negativo, porque una forma más ancha atrás que adelante igual tiene que anclarse en un tile del frente.

Lo que se corrigió en el motor, **genéricamente** (ningún tamaño está escrito en ningún lado):

| Regla | Qué pasaba | Qué hace ahora |
|---|---|---|
| Forma | Solo `width`/`depth` | `cells` opcional, con el ancla siempre incluida |
| Arte y toque | El hitbox se proyectaba desde el **ancla** | `placedFeet` lo proyecta desde el **centro del frente**. Un objeto 1×1 responde el mismo punto de siempre |
| Interacción | Un toque devolvía el ancla, hasta 3 pasos del jugador parado en la otra esquina | `nearestTile` lo reapunta al tile más cercano **del mismo objeto** |

`DECISION` **Manhattan y no Chebyshev.** Se probó primero con Chebyshev y estaba mal: una diagonal empata con una ortogonal y puede ganar, y entonces quien estaba al lado queda "a dos pasos". Todas las reglas río abajo —caminar, `besidePlaced`, la interacción de un paso— son ortogonales.

---

## 12. Colisión, navegación, picking, colocación

`FACT` Verificado con tests que manejan el walker, el `TapNavigator`, el A* y el orden de picking reales, y además en el juego vivo:

- **Colisión:** los cuatro tiles son sólidos en el `solidAt` compuesto (área + registro). El sprite **no** es la colisión.
- **Navegación:** el A* lo rodea, una ruta nunca termina dentro del footprint, y un hueco de un tile entre dos hornos sigue siendo caminable.
- **Picking:** se mantiene la prioridad contractual `actor → prop → placed → ground`. Un actor delante del Horno se queda con el toque; un punto a un tile del arte no es el Horno.
- **Colocación:** `validatePlacement` revisa **todo** el footprint y nombra el primer tile que falla, con motivo: `out_of_bounds`, `transition`, `solid_tile`, `water`, `node_tile`, `occupied`. `findStationSpot` además exige un anillo libre alrededor, para que no aparezca una estación a la que nadie puede acercarse.

`FACT` En los 5 mundos salvajes el Horno encuentra un lugar determinista, con sus 4 tiles libres, su anillo de 8 tiles caminable, y sin pisar nunca la Mesa de Alquimia (el Horno busca desde un anillo más lejano y recibe el tile de la Mesa como ocupado).

`FACT` **No se implementó construcción por el jugador.** `validatePlacement` es la validación que un constructor futuro llamará; `O-10` sigue cerrado.

### 12.1 Contrato de placement — `O-9` CERRADA

`DECISION` **Una estación productiva o persistente se coloca por dato explícito, nunca por una búsqueda en runtime.**

Una espiral derivada del spawn de un mundo no puede ser el contrato: un servidor no puede validar una posición que se recalcula, la estación no se puede mover, y cambia sola si cambia el generador de mundo.

El contrato es `StationPlacement` (`stations/stationPlacement.ts`):

```ts
interface StationPlacement {
  stationId: string        // identidad de esta instancia, distinta del tipo
  stationType: StationTypeId
  areaId: string           // identidad de área / mundo
  anchor: { tx, ty }       // posición
  cells: FootprintCell[]   // footprint, tal como se acordó al colocarla
  ownerId: string | null
}
```

`DECISION` `cells` se **transporta** en vez de releerse de la definición. Una estructura guardada tiene que decir qué ocupa realmente: si una versión posterior hiciera el Horno 3×2, cada Horno ya parado debe conservar su footprint hasta que algo lo migre, y un servidor tiene que poder verificar una posición contra la forma que se acordó entonces.

`FACT` `stationFromPlacement(placement)` es la única entrada productiva: para todo lo demás no hace falta nada más. El registro es JSON puro, listo para una tabla en R36.

`FACT` **La espiral es un helper DEV**, y vive en `devStationPlacement.ts` (`devFindStationSpot`). Ningún módulo del contrato productivo lo importa, y un test lo verifica archivo por archivo. Su trabajo es **producir** un `StationPlacement` para un mundo procedural del que nadie escribió datos —el harness de Pradera es exactamente eso— y no **ser** uno.

`FACT` El harness pasa por la misma puerta: deriva un ancla con el helper, escribe un `StationPlacement` y levanta la estación desde ese registro. Cambiar la búsqueda por datos guardados es una línea.

`FACT` La Mesa de Alquimia sigue derivando su tile como siempre (`alchemy/stationPlacement.ts`), sin tocar. Es, por la misma definición, un placement de prototipo.

---

## 13. Worker

`DECISION` **Solo un gancho.** `StationProcessState.workerInstanceId` se transporta y se serializa, y **nadie lo lee**: no hay bonus, no hay validación de party, no hay afinidad de Fuego.

El motivo es el estado real de R31: los workers son un `speciesId` por profesión (`DemoState.workers`), no una `PokemonInstance`. Conectarlo de verdad exige migrar profesiones al modelo de R32.2 y decidir `O-1` (si un worker ocupado deja de estar disponible para combate). Eso es una tarea propia, no un efecto lateral de R33. Lo que R33 garantiza es que enchufarlo después sea aditivo — y que **no** se use `speciesId` como identidad de worker nuevo.

`OPEN` Afinidad de Fuego con la Fundición: aprobada como posibilidad (`A-3`, `A-7`), **no implementada**. La palanca ya existe en los datos (`fire: { processing: 0.4 }` dentro de Minería) y `prepareProcess` ya acepta `processingBonus`; falta la decisión de balance.

---

## 14. Propiedad

`FACT` `PlacedStation.ownerId` existe como campo y nadie lo lee. R33 no implementa ingresos, porcentajes, permisos, tiendas ni terceros.

---

## 15. Muestra humana

Recorrida reproducible, verificada en el navegador sobre `Pradera` (área productiva existente; **no se tocó la ciudad**):

1. El Horno está apagado en el claro, junto a la Mesa de Alquimia.
2. El jugador tiene mineral de hierro y carbón.
3. Se interactúa desde un tile del anillo → se abre el panel, con las cuatro recetas del Horno.
4. Se elige *Lingote de Hierro* y se carga → el panel dice **Cargado**, y la bolsa pierde 2 mineral y 1 carbón, una sola vez.
5. **Encender** → **Fundiendo · quedan 9 s**, y la boca del Horno se enciende en el mundo.
6. El contador baja: 9 → 8 → 4.
7. A los 9 s → **Terminado**, y el Horno muestra el lingote en la repisa.
8. Sigue **Terminado** pasado el plazo: nada se entrega solo.
9. **Retirar** → el lingote entra a la mochila y el Horno vuelve a **Apagado**.

`furnaceSlice.test.ts` es esa misma recorrida como test, más los intentos de romperla: sin materiales, doble `start`, doble `collect`, `collect` temprano, descargar, y un segundo horno que no puede cargarse con el mineral que el primero está reteniendo.

---

## 16. Tests

| Archivo | Cubre |
|---|---|
| `stations/stations.test.ts` (53) | Definiciones (ids únicos, ítem de estructura, cuatro estados, footprint), footprints (1×1 legado, 2×2, máscara, anillo, alcance), colocación (validación por tile, motivos, determinismo, declaración a F-1), la máquina de estados completa, la transacción de inventario, tiempo (incluido el escaneo "sin reloj en la carpeta") y serialización |
| `stations/furnaceSlice.test.ts` (8) | El vertical slice de punta a punta contra la sesión real, y lo que un jugador va a intentar |
| `stations/furnaceController.test.ts` (4) | El reloj de la superficie, con `Date.now` stubeado. Falla sin el arreglo de §7 |
| `stations/stationContracts.test.ts` (~26) | Los contratos congelados en la microfase: que ninguna API acepte «terminado» del cliente y que `Infinity`/`NaN` se rechacen; la recarga a mitad de proceso con lectura confiable; mochila llena de punta a punta (rechazo → sigue DONE → liberar espacio → retiro una vez → sin duplicar); un proceso por estación; cancel sólo en READY; Fogata/Banco no productivos; y el placement declarado vs. el helper DEV |
| `stations/stationBoundary.test.ts` (9) | El corte producción/DEV: qué motor entra al bundle, que el motor no conoce estaciones, las dos únicas puertas con `import.meta.env.DEV`, y que ningún módulo de estaciones se auto-gatea |
| `wildlands/engine/placedObjectsFootprint.test.ts` (19) | Forma, colisión, A*, fin de ruta, hueco entre dos objetos, reapuntado del toque y geometría del hitbox, con el caso 1×1 asertado al lado de cada uno |
| `professions/art/stationVisuals.test.ts` (17) | Portado tal cual de la rama de arte |

`FACT` Suite completa **1.611 tests / 130 archivos, todos verdes**. `npm run typecheck` 0 errores. `npx eslint src` 0 errores (9 warnings preexistentes de `AuthModal.vue`).

### 16.1 Reporte de build, medido

`FACT` Se construyó el bundle en R33 y en la base de R32.4 (`3736a8e`, en un worktree temporal, con el **mismo** `.env`) y se compararon:

| | R32.4 base | R33 | Δ |
|---|---|---|---|
| `WildlandsView-*.js` | 304,60 kB | 305,35 kB | **+751 bytes** |
| `index-*.js` | 334,39 kB | 334,53 kB | +141 bytes |
| Resto de los chunks | — | — | idénticos byte a byte |

`FACT` Esos 751 bytes son el soporte genérico de footprint del motor (§2.1). En el chunk de producción **no hay ni una sola cadena** de estaciones: ni `smelt_iron`, ni `iron_ingot`, ni `StationProcess`, ni `furnaceStation`, ni `output_capacity_exceeded`, ni `Horno`. La comparación literal a literal entre los dos chunks sólo muestra renombres del minificador y hashes de archivo.

`FACT` **Aviso metodológico.** Una primera comparación daba +49 kB. Era un artefacto: el worktree de comparación no tenía `.env`, así que `VITE_REALTIME_URL` quedaba indefinida y Vite eliminaba Colyseus del bundle. Con el mismo entorno, el delta real es el de la tabla. Vale la pena anotarlo porque cualquier medición futura de bundle tiene la misma trampa.

`FACT` Snapshot congelado de overlays intacto: `a62f2ebb8372073d1d669d4217a84f3e`.

`FACT` Se cambió una cosa de la red de R31: `professionsIsolation.test.ts` ahora **quita los comentarios** antes de escanear. Los módulos de R33 explican en prosa que no tocan Supabase, `localStorage` ni `Math.random`, y la prohibición literal tropezaba con la explicación. Un comentario no puede llamar a nada, así que el guardián queda más preciso, no más débil.

---

## 17. Qué queda para R34 / R36 / R38

| Tema | Fase |
|---|---|
| Proceso validado por el servidor: reloj, reserva, idempotencia, ownership | R34/R35 |
| Persistencia de estaciones colocadas y de procesos en curso | R36 |
| Worker real (`PokemonInstance`, `worker ∈ activeParty`), bonos y afinidad de Fuego | Después de migrar profesiones (`O-1`, `O-2`, `O-3`) |
| Construcción por el jugador: planos, previsualización, permisos, mantenimiento, retiro | `O-10` |
| Fogata y Banco jugables, con sus recetas | Posterior |
| Combustible como concepto separado del material, y carga acumulada de la estación | `O-8` |
| Números: duración, cantidades, XP, rentabilidad, horno propio vs. público | `A-12` / R38 |
| Escribir datos de placement reales para estaciones canónicas (el contrato ya existe, §12.1) | R36 / `F1-O3` |
| UI final de crafteo | Posterior |

---

## 18. Preguntas abiertas que R33 deja

**Cerradas en la microfase de cierre (2026-09-19):**

| # | Cómo quedó |
|---|---|
| ~~R33-O1~~ | **CERRADA.** El placement productivo es dato explícito (`StationPlacement`, §12.1); la espiral es un helper DEV. `O-9` queda decidida |
| ~~R33-O4~~ | **CERRADA.** `output_capacity_exceeded`: el retiro se rechaza, la estación sigue DONE con su output, y el panel lo explica (§6.1) |

**Decisiones v1 que no son preguntas abiertas, sino límites elegidos:**

| Tema | v1 |
|---|---|
| `cancel` sobre `WORKING` | Se rechaza. Una cancelación con penalización es diseño y balance posteriores (§4.1) |
| Cola de procesos | No hay: un proceso por estación. Agregarla después es aditivo porque la identidad vive en el proceso (§4.1) |

**Lo que sigue verdaderamente abierto:**

| # | Pregunta | Bloquea |
|---|---|---|
| R33-O5 | ¿Quién escribe los datos de placement de una estación canónica —el área, un plano del jugador, el servidor— y dónde se guardan? El contrato existe; la fuente no | R36, `O-10` |
| R33-O6 | ¿El Horno propio es más rápido que el público, y cuánto? Hoy toda estación es la pública porque no hay modelo de propiedad | `A-12`, `O-10` |
| R33-O7 | ¿Combustible como concepto separado del material, con carga acumulada de la estación? R33 no lo abrió a propósito | `O-8` |
| R33-O8 | ¿El worker ocupado deja de estar disponible para combate mientras la estación trabaja? El gancho existe y está inerte | `O-1` |

# R33 — Estaciones productivas y el proceso del Horno

> Fecha: 2026-09-19. Estación **principal**.
> Rama: `feat/r33-stations-product`, desde `3736a8ec53730698ca2112cf1ba8d7834d7b7425` (R32.4, HUMAN APPROVED).
> Base contractual previa: [`../wildlands/R32_INTEGRATION_AUDIT.md`](../wildlands/R32_INTEGRATION_AUDIT.md) §10 (roadmap) y §3 (T-S3 congelado), [`PRE_R32_DESIGN_DECISIONS.md`](PRE_R32_DESIGN_DECISIONS.md) A-7/A-8, [`CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md`](CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md) §2 y §5, [`../wildlands/F1_OBSTACLE_PROVIDER_DESIGN.md`](../wildlands/F1_OBSTACLE_PROVIDER_DESIGN.md) §11.
> Leyenda: `FACT` verificado en código · `DECISION` decidido acá, con su motivo · `OPEN` sin decidir.

**Qué es R33:** la infraestructura reutilizable de estaciones, y el primer proceso real que la usa —`mineral bruto → Horno → lingote`— con footprint mayor a 1×1, estados visuales, tiempo controlable y dominio serializable.

**Qué NO es:** balance económico, persistencia, autoridad de servidor, construcción por el jugador, Fogata/Banco jugables, Dungeon, ni rediseño de la Mesa de Alquimia.

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
| `stations/stationPlacement.ts` | Validación de colocación y declaración estructural a F-1 |
| `stations/stationSession.ts` | Adaptador entre `Inventory` y la bolsa por slots del prototipo |
| `stations/furnaceOverlay.ts` | Dibuja el arte aprobado en el estado que reporta el dominio |
| `stations/useFurnaceController.ts` | La superficie Vue. No tiene reglas |
| `components/FurnaceStationCard.vue` | El panel. Funcional, no definitivo |

`FACT` `stations/` no importa el motor en su mitad pura; el overlay y el controller usan exactamente la misma superficie que ya usaba la Mesa (`world`, `area`, `sceneOverlay`, `game` solo como tipo, `areas/atlas`). La regla de aislamiento de R31 lo fija (`professionsIsolation.test.ts`).

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

`FurnaceStationCard.vue` traduce cada código a una frase; ningún código llega al jugador.

---

## 5. Reserva de insumos

`DECISION` **Los insumos se comprometen atómicamente al entrar en READY.** Salen de la bolsa una sola vez, y el proceso pasa a ser su dueño.

La alternativa —reservar un derecho y consumir al iniciar— necesita un segundo registro que mantenga la reserva honesta y una regla para qué pasa si el inventario cambia en el medio. Tomarlos una vez, por adelantado, hace imposible que dos trabajos gasten el mismo mineral, y `cancel` antes de arrancar los devuelve exactamente.

`DECISION` **El resultado se resuelve al preparar, no al retirar.** `prepareProcess` llama a `resolveProcessing` y guarda qué se consumió, qué se produce y cuánta XP. Por eso completar mil veces no produce dos veces, y por eso un servidor podrá calcular el registro una vez y entregarle al cliente una proyección de él.

---

## 6. Cancelar

`DECISION` `READY → cancel` devuelve los insumos comprometidos y deja la estación IDLE.
`DECISION` `WORKING → cancel` se **rechaza**. Reembolsos parciales, combustible desperdiciado o penalizaciones son decisiones de producto que R33 no toma.

---

## 7. Tiempo

`FACT` No hay `Date.now`, `setTimeout`, `setInterval`, `performance.now` ni `Math.random` en ningún módulo de `stations/` fuera de los tests; un test escanea las fuentes de la carpeta para que siga siendo cierto.

`DECISION` El proceso guarda `startedAtMs` y `durationMs`; lo que queda se **deriva** (`remainingMs(process, nowMs)`). El reloj es un parámetro:

- hoy lo aporta el reloj de la sesión demo (`DemoState.now`), así que el viaje en el tiempo del playground mueve el Horno;
- mañana lo aporta el `AuthorityClock` del servidor (R32.4) sin tocar el dominio.

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
- el reloj es un argumento, no una lectura;
- el resultado se decide una vez y se guarda, así que reenviar `advance` o `collect` no cobra dos veces;
- la posición es dato consultable por tile, no una derivación con trigonometría.

`OPEN` Cuando exista autoridad, el servidor decidirá: quién puede `prepare`/`start`/`collect`, la reserva, el reloj, la propiedad y la idempotencia del proceso. **Nada de eso se decide acá.** Un `startedAtMs` del cliente no puede tener semántica irreversible.

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

`DECISION` **Combustible.** No se tomó ninguna decisión económica nueva sobre el carbón: `coal` ya era un insumo declarado de estas recetas desde R31. El contrato de proceso no lo distingue de los demás insumos, y separar *material* de *combustible* sigue abierto en `O-8`.

`DECISION` **Valores `PLAYTEST / FOUNDATION`.** Duración, cantidades, niveles y XP son los del catálogo, tomados como estaban. La duración efectiva es `baseSeconds × 1.5` porque R33 no tiene modelo de propiedad y toda estación es la **pública** más lenta (`PUBLIC_STATION_TIME_MULTIPLIER`). Nada de esto es balance: es `A-12` / `O-8`.

### Fogata y Banco

`FACT` Su arte y su `StationDefinition` están en el catálogo, con `productive: false`. No tienen proceso, ni recetas propias, ni colocación. Así el catálogo productivo conoce las tres estaciones aprobadas sin que R33 abra su gameplay.

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
| `wildlands/engine/placedObjectsFootprint.test.ts` (19) | Forma, colisión, A*, fin de ruta, hueco entre dos objetos, reapuntado del toque y geometría del hitbox, con el caso 1×1 asertado al lado de cada uno |
| `professions/art/stationVisuals.test.ts` (17) | Portado tal cual de la rama de arte |

`FACT` Suite completa **1.574 tests / 128 archivos, todos verdes**. `npm run typecheck` 0 errores. `npx eslint src` 0 errores (9 warnings preexistentes de `AuthModal.vue`). `npm run build` OK, y el bundle **no contiene** nada del Horno: sigue siendo dev-only.

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
| Estaciones fijas del pueblo como dato del área en vez de derivadas | `O-9` / `F1-O3` |
| UI final de crafteo | Posterior |

---

## 18. Preguntas abiertas que R33 deja

| # | Pregunta | Bloquea |
|---|---|---|
| R33-O1 | ¿La estación se coloca por dato del área (o del jugador) en vez de derivarse por espiral? Hoy el Horno hereda el método de la Mesa, que es determinista pero no declarativo | `O-9`, y la validación de servidor |
| R33-O2 | ¿`cancel` sobre `WORKING` existe alguna vez, y con qué costo? R33 lo rechaza a propósito | `O-8`, `A-12` |
| R33-O3 | ¿Varios procesos en cola por estación, o uno solo? R33 hace uno solo (`station_busy`) | Diseño de producto |
| R33-O4 | ¿Qué pasa con un proceso `DONE` si la mochila está llena? Hoy se rechaza el retiro y el Horno queda `DONE`, que no pierde nada pero tampoco avisa bien | UX, y la lista de pendientes de recolección |

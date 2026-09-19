# F-1 — Contrato de obstáculos físicos y estaciones interactivas (diseño)

> Base: `integration/r31` @ `00f9e8d3760943cb17192d64b94cbc6ae1cebd33`. Rama `design/f1-obstacle-provider`.
> **Solo diseño: no se implementa nada.** No se creó ningún proveedor, no se tocó el motor, la navegación, el renderer, los overlays ni las profesiones.
> Lecturas previas: `CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md`, `PRE_R32_DESIGN_DECISIONS.md`, `R31_INTEGRATION_AUDIT.md`, `R31Z_CONSOLIDATION_PLAN.md` §5, `docs/wildlands/HANDOFF.md`, `R30_PROP_TAP_PICKING.md`.

| Marca | Significado |
|---|---|
| `FACT` | Verificado en el código de este commit |
| `APPROVED` | Ya decidido por producto |
| `PROPOSAL` | Recomendación de esta estación, **pendiente de aprobación** |
| `OPEN` | Falta decidir; no se inventa acá |

---

## 1. Diagnóstico actual

### 1.1 Quién responde hoy la solidez

`FACT` La única autoridad física es el área: `Area.isSolid(tx, ty)` e `Area.isWater(tx, ty)` (`engine/area.ts:57-58`). En un mundo procedural, `World.isSolid` es exactamente *"¿el decor de este tile es de los sólidos?"* (`engine/world.ts:138-140`), contra un `Set` fijo de `DecorKind`: cactus, roca, peñasco, matorral seco, árbol, pino, pino nevado, arbusto, palmera, roca de hielo y roca marina (`world.ts:39-41`). El agua sale del terreno (`isWaterTerrain`).

`FACT` Los tres consumidores de esa verdad:

| Consumidor | Cómo la usa |
|---|---|
| Movimiento | `MoveRules.blocked` en `game.ts:174-190` |
| Navegación | `TapNavigator` recibe un puerto `NavWorld` con `isSolid`, `occupied` e `isInteractive` (`navigator.ts:16-22`, cableado en `game.ts:107-111`) |
| Interacción | `interact()` mira el tile de enfrente y delega en `onWorldObject` (`game.ts:478-496`) |

`FACT` La solidez es **derivada y sin estado**: se recalcula del hash del mundo por tile. No hay registro, ni lista, ni objeto que se pueda agregar o quitar.

### 1.2 Terreno, props estáticos y `SceneOverlay`

| Capa | Qué es | Sólido | Se puede agregar en runtime |
|---|---|---|---|
| **Terreno** | Bioma por tile, derivado de la semilla | Solo el agua bloquea | No |
| **Props estáticos** | `DecorInstance` derivados por chunk (`chunks.ts:22-34`), con `kind`, tile y posición de pies | Sí, si su `kind` está en `SOLID_DECOR` | No |
| **`SceneOverlay`** | Puerto de dibujo por cuadro: `decor`, `ground`, `sprites`, `labels` (`sceneOverlay.ts:42-48`) | **No**, y no tiene forma de serlo | Sí, pero **solo visualmente** |

`FACT` El comentario del propio puerto lo dice: *"the engine knows nothing about what the overlay represents"*. `SceneOverlay` puede reemplazar el sprite de un prop existente y agregar sprites sueltos; **no puede** declarar que algo ocupa espacio.

### 1.3 Cómo navega el jugador

`FACT` `TapNavigator.plan` (`navigator.ts:125-133`) arma `blocked = isSolid || occupied` y decide si el destino se pisa o se rodea:

```ts
const beside = this.goalActor !== null || blocked(tile.tx, tile.ty) || this.interactive(tile)
```

`FACT` `isInteractive` existe y ya está cableado a las profesiones: `game.ts:110` pregunta `isWorldObject({ area, tx, ty })`, que el demo de profesiones resuelve consultando cada overlay (`ProfessionWorldDemo.vue:148`). O sea: **ya hay un canal por el que un feature declara "a este tile se llega de al lado"**, pero solo afecta a la navegación y a la interacción, no a la colisión.

### 1.4 Cómo funciona el picking después de F-2

`FACT` `Renderer.pick()` delega en `resolvePick` (`engine/picking.ts`): primero rects de actores, después rects de props, y si no hay ninguno, desproyecta el suelo. Los rects de prop son el arte dibujado, sin padding, y se registran solo para decor con `kind` (`renderer.ts:243-246, 312-325`).

`FACT` Consecuencia para F-1: **una estación dibujada por `SceneOverlay` no tiene rect de picking propio.** Si reemplaza el sprite de un prop existente, hereda el rect de ese prop; si se dibuja con `sprites()`, no participa del picking y el toque cae al suelo.

### 1.5 Por qué la Mesa de Alquimia se atraviesa

`FACT` La mesa existe solo como arte y como cálculo del cliente:

- su tile se **deriva** buscando el primer claro en anillos 4..14 desde un anchor, saltando agua, props sólidos y tiles con nodo (`professions/alchemy/stationPlacement.ts:20-56`);
- `besideStation` devuelve los cuatro tiles ortogonales desde donde se usa (`stationPlacement.ts:59-67`);
- se dibuja por `sprites()` del overlay de alquimia;
- se interactúa porque el controlador responde `isStation` a `isWorldObject`/`inspect` (`alchemy/useAlchemyController.ts:68-71`).

`FACT` Nada de eso llega a `Area.isSolid`, así que el motor no sabe que hay una mesa: el jugador la pisa, el pathfinding la cruza y el servidor futuro no tiene contra qué validar una posición. **Ese es F-1.**

### 1.6 Lifecycle actual

`FACT` `setSceneOverlay(overlay | null)` es un único slot en el juego (`game.ts:388-390`); lo pone y lo quita la vista (`WildlandsView`), y cada controlador de profesión hace `attach`/`detach`.

`FACT` `enterArea` (`game.ts:192-200`) reemplaza área y populace, recoloca al jugador y cambia la lente, pero **no toca el overlay**: el mismo overlay sigue vivo al cambiar de área. Hoy es inocuo porque el overlay recalcula todo desde el `area` que recibe por parámetro en cada hook, pero cualquier dato físico con estado que se registre en el futuro **sí** necesitaría limpiarse ahí.

`FACT` No existe hoy ningún registro de obstáculos que pueda quedar colgado: el riesgo de "obstáculo fantasma" es nuevo y lo introduce este diseño.

---

## 2. Modelo conceptual propuesto

`APPROVED` (principio) `SceneOverlay` representa lo visual y **no** es dueño de solidez, navegación ni estado físico.

### 2.1 Las cuatro capas, separadas

`PROPOSAL`

| Capa | Responsabilidad | Quién la responde | Estado hoy |
|---|---|---|---|
| **Dato físico** | Qué ocupa este tile y por qué | El área, sumando terreno, props derivados y un registro de objetos colocados | Falta el registro |
| **Representación visual** | Cómo se ve y en qué estado | `SceneOverlay` / renderer | Correcto, no cambia |
| **Dato de interacción** | Qué pasa al usarlo, desde dónde y con qué requisitos | El feature dueño (profesiones hoy) vía `onWorldObject` | Existe, parcial |
| **Autoridad y persistencia** | Si esa posición y esa acción son legales | Servidor (R32-0) | No existe |

La regla que las une: **una sola fuente por pregunta**. La solidez la responde el área; el dibujo, el overlay; la acción, el feature. Ninguna capa deduce la de al lado.

### 2.2 El contrato mínimo

`PROPOSAL` Un objeto físico colocado necesita, como mínimo:

```text
id            identidad propia, distinta del itemId del catálogo
areaId        a qué área pertenece
anchor        tile ancla
footprint     tiles que ocupa (1×1 en el primer prototipo)
solid         si bloquea el paso
interactive   si se usa desde un tile adyacente
kind          qué es (estación de alquimia, horno, fogata, banco…)
```

Y el área debe poder responder tres preguntas puras, por tile:

```text
¿este tile está ocupado por un objeto físico?   → para isSolid y pathfinding
¿qué objeto hay en este tile?                   → para interacción y picking
¿qué objetos hay en este rectángulo?            → para el renderer
```

`PROPOSAL` **El nombre `ObstacleProvider` se queda corto.** Lo que falta no es solo "lo que estorba": es el registro de **objetos de mundo colocados**, que además pueden ser interactuables y, más adelante, tener dueño y estado. Nombres mejores, en orden de preferencia:

1. **`PlacedObjects` / `placedObjectsIn(area)`** — dice qué es: cosas puestas en el mundo, además de las derivadas por semilla.
2. `WorldObjectRegistry` — más neutro, pero choca con el `WorldObjectTarget` que ya existe para interacción.
3. `ObstacleProvider` — describe solo una de sus tres consultas.

`OPEN` El nombre definitivo (`F1-N1`).

### 2.3 Qué debe soportar el modelo

`PROPOSAL` Todos conceptualmente cubiertos por el contrato de §2.2:

| Caso | Cómo lo cubre |
|---|---|
| Estación 1×1 | Un objeto con footprint de un tile |
| Varios obstáculos | El registro es una lista por área |
| Sin estación | Lista vacía: el área responde exactamente como hoy |
| Cambio de área | El registro se consulta por `areaId`; el del área anterior no se mira |
| Cleanup | Un solo lugar donde dar de baja (§5) |
| Footprint multi-tile | El contrato ya habla de tiles, no de un punto; la consulta es por tile |
| Props estáticos existentes | **No se migran.** Siguen derivándose del mundo; el registro se suma, no reemplaza |
| Estaciones públicas y estructuras de Construcción | Mismo contrato, distinto origen: unas son dato del área, otras las coloca el jugador |
| Solidez, interacción, navegación | Tres consultas sobre el mismo dato |
| Renderer y picking | Consulta de lectura por rectángulo; **no** duplica autoridad: sigue sin decidir gameplay |

`PROPOSAL` Dos fuentes, un solo registro: estaciones fijas del área (declaradas como dato) y objetos colocados por jugadores (R32-0 en adelante). Si el registro nace resolviendo solo la primera, la segunda lo rompe.

---

## 3. Flujo de datos

`PROPOSAL`

```text
dato físico del área
  ├─ terreno + props derivados de la semilla   (hoy)
  └─ objetos colocados: estaciones, estructuras (nuevo)
        │
        ├─→ isSolid / movimiento / pathfinding      "¿puedo pisar este tile?"
        ├─→ interacción                             "¿qué hay enfrente y quién lo maneja?"
        └─→ renderer / picking                      "¿qué dibujo y qué toqué?"
                │
                └─→ intención del cliente: (jugador, objetoId, acción)
                        │
                        └─→ validación autoritativa futura (R32-0)
```

`PROPOSAL` Qué tendrá que ser compartible con el servidor, conceptualmente:

- la **posición y el footprint** de cada objeto, derivables o declarados, nunca "lo que dijo el cliente";
- el **tipo** de objeto y sus reglas (qué recetas habilita, desde dónde se usa);
- la **identidad** del objeto, para que una acción se describa como `(jugador, objetoId, acción, cantidad, workerId)` y sea verificable;
- la **pertenencia al área**, para rechazar acciones de otra área.

No se diseña acá ninguna API de servidor.

---

## 4. Reglas y prioridades

`PROPOSAL` Orden al preguntar **si un tile se puede pisar** (primera que aplica gana):

1. terreno sólido → bloquea;
2. agua → bloquea al caminar;
3. prop estático sólido → bloquea;
4. objeto colocado con `solid` → bloquea;
5. actor → no bloquea el plan, lo re-planifica (`occupied`, como hoy);
6. objeto colocado no sólido (una marca en el suelo) → no bloquea.

`PROPOSAL` **Varios obstáculos en la misma tile:** el tile está ocupado si *alguno* bloquea. Para interacción, gana el objeto colocado por encima del prop derivado: lo puesto a propósito manda sobre el decorado de la semilla.

`PROPOSAL` **Prop visual y estación física superpuestos:** no debería ocurrir — la colocación valida que el tile esté libre, como ya hace `clearing()` en la mesa. Si igual ocurre, el objeto colocado es la verdad física y el prop se ignora.

`PROPOSAL` **Prioridad de interacción:** actor > objeto colocado > nodo de profesión > prop > suelo.

`PROPOSAL` **`pick()` vs. `isSolid`:** son preguntas distintas y deben seguir separadas. `pick()` responde **qué tocaste**; `isSolid` responde **si podés pisarlo**. F-2 no se toca: el picking sigue devolviendo un tile y **no** decide gameplay. Lo único que suma este diseño es que un objeto colocado pueda registrar su rect como ya lo hacen los props, para que tocar una mesa devuelva la mesa y no el suelo de atrás.

`PROPOSAL` **Toque sobre una estación:** devuelve su tile ancla; como el tile será sólido, el navegador ya planifica a un vecino (`beside`), y al llegar, la interacción de frente dispara `onWorldObject`. Es el mismo gesto que un árbol después de F-2.

`PROPOSAL` **Interacción desde tile adyacente:** los cuatro ortogonales del ancla, como ya define `besideStation`. Para footprints multi-tile, los tiles ortogonales al perímetro.

---

## 5. Lifecycle y cleanup

`PROPOSAL`

| Momento | Qué pasa |
|---|---|
| **Registro** | Al montar el feature dueño, o al cargar el área si la estación es dato del área |
| **Actualización** | El estado *visual* (apagado, listo, trabajando) **no** vive acá: es del overlay. Acá solo cambia lo físico: existe, dónde y qué ocupa |
| **Desregistro** | Al desmontar el feature dueño, explícitamente y por id |
| **Cambio de área** | `enterArea` debe soltar lo registrado para el área que se abandona. Hoy `enterArea` **no** toca el overlay (`game.ts:192-200`): es justo el punto donde un registro con estado se volvería fantasma |
| **Desmontaje del overlay** | `setSceneOverlay(null)` debe tener su equivalente físico, o el objeto queda sólido sin nadie que lo dibuje |
| **Timers y referencias** | El registro guarda datos planos, no callbacks ni timers. Nada de cerrar sobre el área o el juego |
| **Desincronización** | Si el dato físico existe y el visual no, hay una pared invisible: es el fallo más caro y el que los tests deben perseguir. Al revés —visual sin físico— es exactamente el bug F-1 de hoy |

`PROPOSAL` Regla de oro: **quien registra, desregistra**, y el registro vive junto al área, no junto al overlay.

---

## 6. Performance

`FACT` Hoy `isSolid` es un hash por tile, sin asignaciones, y el pathfinding lo llama muchas veces por plan (`pathfinding.ts:71`).

`PROPOSAL` Con **pocos objetos por área** (una mesa, un horno, una fogata, un banco: orden de unidades o decenas), una búsqueda lineal sobre una lista pequeña es más rápida que cualquier índice, y no agrega memoria por chunk. El coste por consulta sería comparar unos pocos enteros.

`PROPOSAL` Cuándo haría falta un índice espacial (**no ahora**):

- más de ~100 objetos por área, o cuando entren las estructuras de jugadores;
- footprints grandes y frecuentes;
- si el perfilado muestra que el pathfinding se degrada en móvil.

`PROPOSAL` En móvil el riesgo no es la consulta sino el trabajo por cuadro: mantener el registro como dato plano y no recalcularlo por frame. Con decenas de jugadores, cada cliente sigue consultando solo su área; el coste de red no cambia porque el dato es derivable o declarado, no sincronizado tile a tile.

`OPEN` Umbral exacto y si el índice, cuando llegue, se comparte con el node index de profesiones (`F1-P1`).

---

## 7. Tests necesarios antes de implementar

`PROPOSAL` Mínimos, en este orden:

| # | Caso | Qué prueba |
|---|---|---|
| 1 | Estación registrada → su tile es sólido | El dato físico llega a `isSolid` |
| 2 | Sin estación → comportamiento idéntico al actual | El proveedor nulo no cambia nada |
| 3 | Pathfinding alrededor | Una ruta que antes cruzaba el tile ahora lo rodea |
| 4 | Interacción adyacente | Desde los cuatro ortogonales se puede usar; desde diagonal no |
| 5 | Dos obstáculos | Ambos bloquean; ninguno pisa al otro |
| 6 | Overlap | Objeto colocado sobre prop: gana el colocado |
| 7 | Cambio de área | Lo registrado en A no aparece en B |
| 8 | Cleanup | Tras desregistrar, el tile vuelve a ser caminable y no queda referencia |
| 9 | Renderer / picking | Tocar la estación devuelve su tile; el suelo alrededor sigue devolviendo suelo |
| 10 | Mobile / touch | Mismo resultado a 375 px y con dpr 2 |
| 11 | **Regresión F-2** | Los 19 tests de `picking.test.ts` siguen verdes sin cambios |
| 12 | Sin fugas | Registrar y desregistrar N veces deja el registro vacío; nada retiene el área |

`PROPOSAL` Además, el snapshot congelado de profesiones (`a62f2ebb8372073d1d669d4217a84f3e`) debe seguir intacto: la mesa cambia de **solidez**, no de dibujo. Si el snapshot se mueve, algo se hizo de más.

---

## 8. Plan de implementación futuro (no iniciado)

`PROPOSAL`

| # | Commit | Archivos probables | Riesgo | Verificación |
|---|---|---|---|---|
| 1 | Contrato puro + tests | `engine/placedObjects.ts` (nuevo) + su test | **Bajo**: no lo consume nadie | Tests 1, 5, 6, 12 del §7 |
| 2 | Solidez y navegación | `engine/area.ts`, `engine/world.ts` o el área concreta, `engine/game.ts` (cableado del puerto) | **Alto**: toca el motor central; requiere aprobación explícita (ya marcado en `R31Z_CONSOLIDATION_PLAN.md`) | Tests 1–3, 7; suite completa; proveedor nulo = comportamiento idéntico |
| 3 | Interacción y picking | `engine/game.ts`, `engine/renderer.ts` | **Medio**: F-2 ya dejó el lugar donde registrar un rect | Tests 4, 9, 11 |
| 4 | Migración de la Mesa de Alquimia | `professions/alchemy/stationPlacement.ts`, `useAlchemyController.ts` | **Medio**: la posición pasa de derivada a declarada; el overlay deja de ser la única fuente | Snapshot congelado intacto; trace sin `-u` |
| 5 | Pruebas manuales | — | Bajo | Recorrido humano: no se pisa la mesa, se llega de los cuatro lados, se usa, 375 px |
| 6 | Documentación | `docs/wildlands/` | Bajo | — |

`PROPOSAL` El paso 2 es el cuello de botella real: si se hace bien, los pasos 3 a 6 son mecánicos. Si exigiera un cambio mucho mayor del previsto, **detenerse y proponer** antes de seguir.

---

## 9. Límites explícitos

F-1 **no** decide nada de esto, y ninguna de estas cosas debe colarse en su implementación:

ownership · permisos · placement por parte del jugador · persistencia · economía · combustible · recetas · balance · Horno funcional · Construcción funcional · server authority completa · party y workers · node index · F-3 · spawn autoritativo · popups de gathering (A-16).

F-1 entrega **una sola cosa**: que un objeto colocado exista como dato físico consultable, y que la Mesa de Alquimia deje de atravesarse.

---

## 10. Decisiones abiertas

| ID | Pregunta |
|---|---|
| `F1-N1` | Nombre definitivo del contrato (`PlacedObjects`, `WorldObjectRegistry`, `ObstacleProvider`) |
| `F1-O1` | Dónde vive el registro: dentro del `Area`, al lado del atlas, o un puerto que el juego recibe como hoy `onWorldObject` |
| `F1-O2` | Si las estaciones fijas del pueblo pasan a ser dato declarado del área o se siguen derivando (`O-9`) |
| `F1-O3` | Si la posición de la Mesa sigue derivándose por anillos o pasa a ser un dato fijo del área |
| `F1-O4` | Si el primer prototipo nace 1×1 o multi-tile (`C-7`) |
| `F1-O5` | Si un objeto colocado puede ser no sólido (marcas de suelo, alfombras) o todos bloquean |
| `F1-P1` | Umbral de rendimiento para un índice espacial y si se comparte con el node index |
| `F1-O6` | Qué pasa cuando un objeto aparece sobre un tile donde hay un actor (empujar, rechazar, esperar) |

---

## 11. Lo implementado (F-1, rama `feat/f1-placed-objects`)

`FACT` El diseño de arriba se implementó con las decisiones aprobadas: nombre `PlacedObjects`, registro del lado del mundo, objetos 1×1 con footprint extensible, objetos interactuables que pueden no ser sólidos, y la Mesa de Alquimia migrada conservando su ubicación determinista.

### 11.1 Contrato real adoptado

```ts
// engine/placedObjects.ts
interface TapHitbox { width; height; offsetX? }   // el arte propio, en píxeles de mundo
interface PlacedObject { id; areaId; anchor; footprint: readonly Tile[]; solid; interactive; kind; hitbox? }
placedObject(spec)            // arma el footprint desde width/depth (1×1 por defecto)
besidePlaced(object)          // el anillo ortogonal desde donde se usa
class PlacedObjects {
  register / unregister / clearArea / clear / size / inArea
  at(areaId, tx, ty)          // qué hay en ese tile
  isSolid(areaId, tx, ty)     // solidez
  isInteractive(areaId, tx, ty)
}

// engine/picking.ts — el toque se resuelve en pantalla, con orden explícito
hitTest(actores, props, sx, sy, colocados)   // actor → prop → objeto colocado → null
resolvePick(actores, props, sx, sy, suelo, colocados)
```

`FACT` **El alcance del toque es dato del objeto, no una constante del motor.** Cada objeto declara su `hitbox` —el ancho y el alto de su arte alrededor de los pies— y el renderer la proyecta con la cámara del cuadro, junto a los rects que ya guardaba para actores y props. Un horno más alto o una casa más ancha declaran el suyo sin tocar el motor. Un objeto sin `hitbox` no captura ningún toque: solo habla por sus tiles.

`FACT` **Prioridad de picking, explícita y testeada:**

```text
actor  →  prop procedural (F-2)  →  objeto colocado dentro de su arte  →  suelo
```

Una estación no puede quitarle el toque a un actor, ni a un prop que el renderer ya dibujó ahí, ni al suelo que su arte no cubre. Lo que su arte **sí** tapa le pertenece, igual que a un árbol después de F-2. `pick()` sigue siendo la señal de qué se tocó: la accesibilidad la deciden el mundo y el feature.

> La primera versión de F-1 aplicaba una corrección de dos filas por tile (`PLACED_TAP_REACH_ROWS`) a todos los objetos por igual, antes de navegar. La auditoría la rechazó con razón: secuestraba tiles de suelo libres y podía sobrescribir un prop ya resuelto por F-2. Esa regla global se eliminó.

### 11.2 Archivos propietarios

| Archivo | Rol |
|---|---|
| `engine/placedObjects.ts` | El contrato y el registro. Puro: sin DOM, sin timers, sin callbacks |
| `engine/game.ts` | Compone `solidAt = área + registro`, alimenta movimiento y navegación, y sincroniza el registro al entrar a un área |
| `engine/picking.ts`, `engine/renderer.ts` | Proyectan el hitbox declarado y resuelven el toque con la prioridad de §11.1 |
| `professions/alchemy/useAlchemyController.ts` | Declara la mesa como dato plano (`AlchemyPlacedObject`) |
| `professions/alchemy/alchemyOverlay.ts` | Suma `stationTile(area)`, un accesor de solo lectura del tile que ya derivaba |
| `WildlandsView.vue`, `AlchemyFieldLab.vue` | Cablean el puerto `placedObjectsIn`, dev-only como el resto del demo |

`FACT` El motor **pide**, el feature **declara**: `placedObjectsIn(area)` se consulta en cada `enterArea`, después de limpiar lo del área anterior. No hay registro manual ni desregistro disperso, así que no puede quedar un objeto fantasma.

`FACT` **Profesiones no importa el registro.** La mesa se declara estructuralmente (`id`, `areaId`, `anchor`, `kind`), de modo que la regla de aislamiento de R31 queda intacta.

### 11.3 Qué cambió para el jugador

`FACT` La Mesa de Alquimia se ve igual (el snapshot congelado `a62f2ebb8372073d1d669d4217a84f3e` no se movió), está en el mismo tile determinista, y ahora: bloquea el paso, el navegador se detiene a su lado, y un toque sobre su arte la abre en lugar de caminar detrás.

### 11.4 Limitaciones conocidas

- ~~**Solo 1×1 por ahora.**~~ **RESUELTO en R33 (2026-09-19).** El Horno se coloca en 2×2 y el contrato se extendió genéricamente: un spec puede dar `cells` (forma arbitraria) además de `width`/`depth`; `placedFeet` proyecta el hitbox desde el **centro del frente** del footprint en vez del ancla —leer el ancla desplazaba medio sprite el hitbox de un objeto 2×2—; y `nearestTile` reapunta un toque del ancla al tile más cercano del mismo objeto, en distancia **Manhattan**, para que estar parado en la esquina opuesta siga contando como estar al lado. Ningún tamaño quedó escrito en el motor. Detalle en [`../economy/R33_STATIONS_PRODUCT.md`](../economy/R33_STATIONS_PRODUCT.md) §11.
- **Búsqueda lineal**, sin índice espacial: correcto con unidades o decenas de objetos por área (§6).
- **El hitbox es un rectángulo**, no la silueta del arte: una esquina transparente responde por el objeto, igual que en actores y props (F-2).
- **Lo que el arte tapa, le pertenece.** El arte de la Mesa es más ancho que un tile, así que cubre por completo las dos tiles detrás suyo en su columna: un toque ahí abre la Mesa. Es el mismo criterio que un árbol; lo que ya no ocurre es que se lleve tiles fuera de su arte.
- **El hitbox lo declara quien coloca el objeto** y nadie verifica que coincida con el sprite dibujado: si el arte cambia de tamaño, hay que actualizar la declaración.
- **El registro vive en memoria del cliente.** No hay persistencia, ownership ni validación de servidor.
- **La posición sigue derivándose** por anillos desde el spawn del área (`F1-O3` sigue abierto): la mesa es declarada, pero su tile lo sigue calculando el overlay.
- Los props procedurales **no** se migraron ni se duplicaron: siguen saliendo de la semilla.

### 11.5 Qué queda pendiente

**Para Horno y Construcción:** ~~colocar sus objetos con este mismo contrato (arte primero, `A-8`), decidir footprint multi-tile (`C-7`)~~ — **hecho en R33**: el Horno usa este contrato, con arte aprobado y footprint 2×2, y `validatePlacement` es la validación que un constructor futuro llamará. Sigue pendiente todo lo de `O-10` — progresión, planos, colocación por el jugador, retiro, permisos y mantenimiento.

**Para servidor y persistencia (R32-0):** que las posiciones sean dato compartible y no "lo que dijo el cliente", que una acción se describa como `(jugador, objetoId, acción, …)`, y las validaciones 1–16 del `CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md` §7. El registro está preparado para eso —datos planos, sin comportamiento— pero no lo implementa.

**Decisiones abiertas que siguen abiertas:** `F1-O2`, `F1-O3`, `F1-O4`, `F1-O5`, `F1-P1`, `F1-O6`. `F1-N1` quedó resuelta: `PlacedObjects`.

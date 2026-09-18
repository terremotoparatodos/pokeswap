# T-C1 — Construcción + Horno: descubrimiento y diseño base

> Fecha: 2026-09-18. Escrito por la **estación secundaria**.
> Base contractual: `origin/integration/r31` @ `0a174d338f6882a85e6ca88219efcb4223e71545`.
> Rama: `design/construction-smelter-foundation`. **Sólo documentación: no se tocó `src/`, tests, assets ni configuración.**

**Qué es este documento:** el estado real del repo respecto de Horno y Construcción, y una propuesta de loops mínimos para discutir.
**Qué no es:** una especificación, un plan de implementación, un balance, ni un diseño de persistencia o autoridad. Nada de acá se implementa sin una orden explícita posterior.

## Leyenda

| Marca | Significado |
|---|---|
| `FACT` | Existe hoy en el repo, verificado en este commit y citado con archivo:línea |
| `APPROVED` | Decisión ya tomada por producto (`PRE_R32_DESIGN_DECISIONS.md`) |
| `PROPOSAL` | Recomendación de esta estación, **pendiente de aprobación** |
| `OPEN` | Decisión que no debe inventarse |

Regla que seguí: donde faltaba una decisión de producto, la registré como `OPEN` en vez de rellenarla. No hay números nuevos en este documento — ni ratios, ni tiempos, ni XP, ni costos, ni probabilidades, ni niveles.

---

## 1. Estado actual real

### 1.1 Recursos de minería

`FACT` El catálogo de items tiene 5 crudos de minería (`src/features/professions/domain/catalog/items.ts:14-18`):

| Item | Id | Tier | Tags |
|---|---|---|---|
| Piedra | `stone` | 1 | `mineral`, `construction` |
| Carbón | `coal` | 1 | `fuel` |
| Mineral de Hierro | `iron_ore` | 2 | `metal` |
| Mineral de Oro | `gold_ore` | 3 | `metal` |
| Fragmento Evolutivo | `evolution_shard` | 3 | `mineral`, `rare` |

`FACT` `coal` es el **único item con tag `fuel` de minería**; `common_log` también lo lleva (`items.ts:21`). El tag existe, pero **ningún resolver lo lee**: busqué `fuel` en `src/` y sólo aparece como etiqueta de catálogo. No hay concepto de combustible en el dominio.

`FACT` Los nodos de minería y sus niveles (`catalog/nodes.ts:12-48`): `stone_outcrop` Nv. 1, `coal_seam` Nv. 5, `iron_vein` Nv. 15, `crystal_cluster` Nv. 20 (acceso `hardRock`), `gold_vein` Nv. 30. `iron_vein` está anclado a `boulder`/`icerock` y limitado a biomas `desert`/`tundra` con `minZone: 1`.

`FACT` Los nodos **no están almacenados**: se derivan del mundo por hash determinista de `(tx, ty, seed)` más ancla, bioma y zona (`domain/nodePlacement.ts:66-84`). `zoneAt` es la distancia al origen en anillos (`nodePlacement.ts:53-55`). Esto es deliberado y es lo que un servidor podría revalidar en O(1).

### 1.2 Estado de los lingotes

`FACT` Los tres lingotes existen como items refinados: `iron_ingot`, `gold_ingot`, `steel_ingot` (`items.ts:46-48`).

`FACT` Sus recetas existen y **todas declaran estación `smelter`** (`catalog/recipes.ts:19-22`): `make_vial`, `smelt_iron` (Nv. 12), `smelt_gold` (Nv. 28), `forge_steel` (Nv. 35).

`FACT` Sus sinks existen y son reales dentro del catálogo: herramientas de hierro y acero (`recipes.ts:28-33`), Caña Reforzada y Caña Maestra (`recipes.ts:40-41`), `build_alchemy_table` pide `gold_ingot` (`recipes.ts:59`) y las reparaciones T2/T3 piden lingotes (`catalog/tools.ts:25-35`).

`FACT` **No hay faucet jugable.** Coincide con `G-6` del gate (`PRE_R32_HUMAN_GATE.md:47,91-99`) y sigue siendo cierto en este commit:

- no existe ningún horno colocado en el mundo: `smelter` aparece sólo como id de item (`items.ts:82`), como etiqueta de UI (`ui/recipeView.ts:10`) y como parámetro de simulación (`simulation/scenarios.ts:58`);
- el crafteo del playground ejecuta la receta sin validar estación;
- toda la capa de profesiones es **dev-only**: la única ruta es `/dev/profesiones`, registrada bajo `import.meta.env.DEV` (`src/app/router/routes.ts:31,56`).

`FACT` La sesión demo **regala** el insumo y el producto: el inventario inicial trae `iron_ore: 3` (`demo/demoSession.ts:70`), y los atajos del playground suman lingotes (`demo/demoSession.ts:352`, `components/playground/PlaygroundControls.vue:103`). Es `G-10`.

`FACT` `smelt_iron` pide Minería Nv. 12 y `iron_vein` pide Nv. 15: se puede fundir antes de poder minar. Es `G-9`, y es balance (`A-12`, `O-8`).

### 1.3 Faucets y sinks reales

`FACT` Faucets que existen en dominio: recolección por nodo (`domain/gathering.ts`), drops de PvE declarados pero sin productor (`items.ts:42-43,87`), y los atajos demo. Sinks que existen: recetas (`recipes.ts`), reparaciones (`domain/durability.ts:33-58`) y mantenimiento de estructuras (`tools.ts:40-57`).

`FACT` Hay sinks reservados explícitos para que la validación no acepte un recurso sin uso: `apricorn` → Poké Balls, `boss_relic` → mejoras de estructuras nivel 2 (`items.ts:93-96`).

`FACT` El procesamiento **no cuesta energía**; su único límite son los materiales (`domain/processing.ts:1-3`). La energía es sólo de recolección (`docs/economy/ENERGY_DURABILITY.md`).

### 1.4 Recetas y procesamiento existentes

`FACT` `RecipeCategory` ya incluye `construction` (`domain/types.ts:183`), y existen **4 recetas de construcción** (`recipes.ts:42-44,59`):

| Receta | Profesión hoy | Nivel | Estación | Sale |
|---|---|---|---|---|
| `build_campfire` | `woodcutting` | 1 | `null` | `campfire` |
| `build_workbench` | `woodcutting` | 5 | `null` | `workbench` |
| `build_smelter` | `mining` | 10 | `null` | `smelter` |
| `build_alchemy_table` | `alchemy` | 15 | `null` | `alchemy_table` |

`FACT` `station: null` significa "se levanta en el suelo, no sobre una mesa" (`types.ts:194`, `alchemy/recipeBrowser.ts:20`). El resolver trata `station: null` como multiplicador 1 y no exige nada (`processing.ts:49-52`).

`FACT` El resultado de una receta de construcción es **un item en el inventario**, no una estructura en el mundo: `resolveProcessing` devuelve `produced` como `ItemStack[]` (`processing.ts:55-60`). **No existe placement de estructuras.**

`FACT` `ProcessingContext` recibe `recipe`, `professionLevel`, `inventory`, `quantity`, `processingBonus`, `station: 'owned' | 'public'`, `stationSpeedBonus` y `random` (`processing.ts:13-23`). **No recibe worker, ni posición, ni combustible, ni herramienta.**

`FACT` Las estaciones públicas del pueblo existen sólo como multiplicador de tiempo (`PUBLIC_STATION_TIME_MULTIPLIER`, `tools.ts:59-60`).

### 1.5 Tools y reparaciones

`FACT` 12 herramientas en 3 tiers, con `repairMaterials` por herramienta (`tools.ts:23-36`). Cada reparación recorta la durabilidad máxima (`maxDurabilityLossPerRepair: 0.08`) y la herramienta se retira bajo `retireBelowRatio: 0.5` (`tools.ts:20`, `domain/durability.ts:17-58`). Las reparaciones T2/T3 son un sink directo de lingotes y carbón.

`FACT` No existe herramienta de Construcción. `ToolKind` es `pickaxe | axe | sickle | rod` (`types.ts`, `catalog/professions.ts` `toolKind` por profesión).

### 1.6 Qué estaciones existen, visual o como dato

`FACT` **Una sola**: la Mesa de Alquimia.

- Arte propio, 34×30 px, con anclaje al frente del tablero y cuatro estados legibles — `idle | ready | brewing | done` (`art/alchemyStation.ts:17-24,128`).
- Posición **derivada, no almacenada**: primer claro buscado en anillos 4..14 desde un anchor del mundo, saltando agua, props sólidos y tiles con nodo (`alchemy/stationPlacement.ts:20-56`). El mismo seed la pone en el mismo tile para todos, que es lo que un servidor necesitaría para validarla.
- `besideStation` define los cuatro tiles ortogonales donde se paran jugador y Pokémon (`stationPlacement.ts:59-67`).

`FACT` **No hay arte de Horno, Fogata ni Banco de Trabajo**: el único archivo de estación en `art/` es `alchemyStation.ts`.

`FACT` **La mesa no es sólida.** `SceneOverlay` sólo expone `decor`, `ground`, `sprites` y `labels` (`engine/sceneOverlay.ts:42-48`): no tiene solidez. La solidez del mundo la responde `Area.isSolid` (`engine/area.ts:57`), que el motor consulta para movimiento, navegación e interacción (`engine/game.ts:108,177`; `engine/navigator.ts:18,126`). El jugador puede pararse encima de la mesa; hay una pista dev-only que lo dice (`R31Z_CONSOLIDATION_PLAN.md:14`). Es el hallazgo **F-1**.

`FACT` La interacción del mundo entra por el tile que el jugador tiene enfrente: `interact()` mira `(player.tx + dx, player.ty + dy)` y delega en `onWorldObject({ area, tx, ty })` (`engine/game.ts:478-489`).

`FACT` **F-1 tiene diseño aprobado conceptualmente y no está implementado**: `ObstacleProvider` + `stationRegistry` con posiciones fijas como dato (`R31Z_CONSOLIDATION_PLAN.md:139-175,347`). Verifiqué que `src/features/wildlands/engine/obstacles.ts` **no existe**.

`FACT` `engine/buildings.ts` dibuja edificios de pueblo (`pokecenter`, `house`, `mart`, `gym`…) como placeholders con footprint en tiles (`buildings.ts:1-21`). Son decorado del mundo generado: **no son estructuras de jugador**, no se construyen, no tienen dueño ni estado.

### 1.7 Limitaciones del inventario

`FACT` Conviven dos modelos:

- **Aritmético**, el que usan los resolvers: `Inventory = Record<itemId, number>`, sin slots ni límite (`domain/inventory.ts`). `hasItems` / `addItems` / `removeItems` son inmutables y `removeItems` devuelve `null` antes que quedar en negativo (`inventory.ts:32-38`).
- **Por slots**, el del prototipo de UI: contenedor con capacidad y reglas de stack por clase de item (`inventory/slotInventory.ts`, `inventory/stackRules.ts`). Valores demo: 24 slots, y stacks de 100/60/20/50/25 según clase; herramientas y **estructuras** son `unique` (stack de 1) (`stackRules.ts:20-40`). El archivo dice explícitamente que son valores de demo, no reglas económicas (`stackRules.ts:1-5`).

`FACT` `ContainerKind` ya prevé el futuro: `player_inventory | storage | house_storage | shop_stock` (`slotInventory.ts:11`), y existe una transferencia entre contenedores **todo-o-nada** (`slotInventory.ts:148`). Es el contrato más cercano a un cofre que hay hoy.

### 1.8 Qué parte es sólo demo/local

`FACT` Todo. Profesiones vive detrás de `/dev/profesiones` (`routes.ts:31,56`), el demo de mundo se carga sólo en dev, no hay tablas ni persistencia de profesiones, y el XP/nivel viven en memoria (`PRE_R32_DESIGN_DECISIONS.md` A-11). El prototipo de Dungeon está en la misma situación: cliente puro, dev-only, sin autoridad ni persistencia (`docs/wildlands/DUNGEON_PROTOTYPE_INTEGRATION.md:43-48`).

`FACT` Existe además un test que mantiene la frontera: nada fuera de `professions` puede importar su dominio salvo dos entradas dev-only (`src/features/professions/professionsIsolation.test.ts`). Cualquier diseño que quiera consumir el catálogo desde otro feature choca con esa regla — lo comprobé en la práctica durante D1.2.4ter, donde hubo que copiar valores en vez de importarlos.

### 1.9 Resumen honesto del punto de partida

| Pieza | Estado |
|---|---|
| Mineral bruto | `FACT` existe como item y como nodo derivado; obtenible sólo en dev |
| Lingote de Hierro | `FACT` existe como item, receta y sink; **sin faucet jugable** |
| Recetas de construcción | `FACT` existen 4, producen **un item**, no una estructura |
| Reparaciones | `FACT` completas y consumiendo lingotes |
| Herramientas | `FACT` 12, sin herramienta de Construcción |
| Combustible | `FACT` sólo como tag inerte; `coal` es un input normal |
| Inventario | `FACT` dos modelos; slots y stacks con valores demo |
| Estaciones | `FACT` una sola con arte y posición derivada; sin solidez (F-1) |
| Construcción / housing | `FACT` **no existe**: ni profesión, ni placement, ni ownership |
| Placement / colisión | `FACT` `Area.isSolid` es la única autoridad; `ObstacleProvider` diseñado y no implementado |

---

## 2. Loop mínimo de Horno

`APPROVED` (A-7) Cadena mínima `Mineral bruto → Horno → Lingote`; hace falta un faucet jugable real; el refinado **sigue dentro de Minería** y no nace una profesión Fundición.

### 2.1 Loop propuesto

`PROPOSAL`

```text
obtener mineral            (Minería, nodo del mundo — ya existe)
→ caminar hasta un Horno   (estación real, con posición en el mundo)
→ interactuar de al lado   (el mismo gesto que la Mesa de Alquimia)
→ elegir proceso           (las recetas de estación `smelter` que el nivel permita)
→ elegir cantidad
→ confirmar consumo        (inputs de la receta + lo que se decida sobre combustible)
→ esperar/procesar         (con estado visible en la estación)
→ retirar el lingote
```

La diferencia con hoy es corta y deliberada: **el paso "estar frente a un horno" hoy no existe**, y sin él `station: 'owned' | 'public'` es un parámetro que nadie valida.

### 2.2 Conceptos, sin números

`PROPOSAL` **Inputs.** Los que la receta ya declara (`recipes.ts:19-22`). No agregar inputs nuevos en este paso.

`PROPOSAL` **Output.** El lingote de la receta, entregado al inventario del jugador. Sin sub-productos ni fallos en el primer loop: un proceso que puede fallar necesita RNG, y el RNG necesita autoridad (§7).

`PROPOSAL` **Combustible como concepto: sí, pero como decisión explícita, no como efecto secundario.** Hoy `coal` entra como un ingrediente más, indistinguible de la piedra. Recomiendo separar **material** de **combustible** en el modelo aunque el primer prototipo los trate igual, porque:

- hace legible el horno ("esto se alimenta");
- es la palanca natural de la afinidad Fuego (§6) y del atributo Eficiencia (§6);
- si después se decide que el horno tiene una carga que dura varios procesos, el cambio es de datos y no de arquitectura.

`OPEN` Si el combustible es un input por proceso, una carga acumulada de la estación, o ambos; y si el atributo Eficiencia lo ahorra. Es `O-8`.

`PROPOSAL` **Qué decide el jugador.** Qué proceso, cuánta cantidad, con qué worker, en qué horno (propio vs. público). Nada más en el primer loop.

`PROPOSAL` **Qué hace el worker.** Un solo worker por acción (`A-1`). Aporta bonos agregados; no elige, no acelera solo, no aparece como segundo actor de decisión. Contrato en §6.

`PROPOSAL` **Qué se comunica visualmente.** Los mismos cuatro estados que ya probaron funcionar en la Mesa de Alquimia (`art/alchemyStation.ts:24`), traducidos al horno: apagado, listo (hay insumos y nivel), fundiendo (fuego vivo, humo, resplandor), terminado (lingote a la vista). El estado del horno debe leerse **desde lejos y sin abrir el panel**.

`PROPOSAL` **Qué debe quedar para la autoridad futura.** Que la acción sea descriptible como un pedido verificable: `(jugador, estaciónId, recetaId, cantidad, workerId)` y nada más; que la posición de la estación sea un dato consultable y no una derivación con trigonometría (ver §5 y el reparo que ya hace `R31Z_CONSOLIDATION_PLAN.md:139-175`); y que el resultado lo escriba el servidor.

`OPEN` Tiempos, ratios, XP, niveles, si el horno propio es más rápido que el público y cuánto. Todo es `A-12` / `O-8`.

---

## 3. Loop mínimo de Construcción

`APPROVED` (A-9) Construcción es una profesión nueva e independiente; Tala sigue siendo gathering; es un sink importante; las estructuras podrán tener dueño, nivel, upgrades, mantenimiento, stock, permisos y tarifas, y **eso no se diseña todavía**.

### 3.1 Loop propuesto

`PROPOSAL`

```text
obtener materiales         (Tala + Minería + procesamiento — ya existe)
→ abrir el plano           (lista de estructuras que el nivel permite)
→ elegir dónde             (previsualización sobre el mundo, con footprint)
→ validar lugar            (terreno, espacio, distancia, superposición, área permitida)
→ construir                (consume materiales; toma tiempo; el worker participa)
→ estructura usable        (existe en el mundo, es sólida, se interactúa de al lado)
```

### 3.2 Las cuatro cosas que hay que mantener separadas

`PROPOSAL` Éste es el punto más importante del documento, porque hoy están mezcladas:

| Concepto | Qué es | Dónde vive | Estado hoy |
|---|---|---|---|
| **Construcción como profesión** | Nivel, XP, desbloqueos, qué planos conoce el jugador | Catálogo de profesiones | `FACT` no existe: `PROFESSION_IDS` es `mining, woodcutting, fishing, alchemy` (`types.ts:17`) |
| **Crafting / processing** | Transformar materiales en materiales | `domain/processing.ts` | `FACT` existe y funciona |
| **Placement de estructura** | Poner un objeto en el mundo, con posición, footprint y solidez | No existe | `FACT` no existe |
| **Uso posterior** | La estructura como estación, storage o servicio | Parcialmente | `FACT` sólo la Mesa de Alquimia, derivada y sin solidez |

`PROPOSAL` Las 4 recetas `construction` actuales están **en la profesión equivocada** según A-9: `build_campfire` y `build_workbench` son de Tala, `build_smelter` de Minería, `build_alchemy_table` de Alquimia (`recipes.ts:42-44,59`). Y producen un item, no una estructura. Recomiendo tratarlas como **precedente de datos, no como base**: la migración a una profesión Construcción es una decisión de producto con impacto en progresión (`OPEN`, ver §9).

`PROPOSAL` Un "plano" y una "receta" no son lo mismo y conviene que no compartan tipo: una receta produce items y se resuelve con inventario; un plano produce **una estructura colocada** y necesita además posición, orientación, footprint y validación de mundo. Compartir `RecipeDefinition` para las dos cosas es lo que hoy hace que construir una fogata sea indistinguible de serrar un tablón.

### 3.3 Contratos futuros que esto va a necesitar

`PROPOSAL` Identificados, **no diseñados**:

- **Identidad de estructura**: una estructura colocada necesita id propio, distinto del `itemId` del catálogo.
- **Posición y footprint**: área, tile de anclaje, tamaño en tiles, orientación.
- **Consulta de mundo**: "¿qué hay en este tile?" respondible por colisión, navegación, interacción y servidor (§5).
- **Estado**: condición/mantenimiento ya modelado en datos (`tools.ts:40-57`), sin nada que lo haga avanzar.
- **Ownership y permisos**: quién la construyó, quién puede usarla, quién puede retirarla.
- **Ciclo de vida**: construida, en obra, dañada, retirada; y qué pasa con los materiales al retirar.

`OPEN` Todos ellos: es `O-10`.

---

## 4. Primeras estructuras candidatas

Criterio de orden: **cuánto prototipo compra cada una por sistema nuevo que exige**. No hay materiales numéricos acá — sólo de qué está hecha conceptualmente cada cosa.

| # | Estructura | Qué le da al jugador | Materiales conceptuales | Tipo | Sistemas que exige y hoy no existen | Recomendación |
|---|---|---|---|---|---|---|
| 1 | **Fogata** | Un primer objeto propio en el mundo; ya es estación de 2 recetas | Madera + piedra | Estación | Placement, solidez | **Primer prototipo.** Es la estructura más barata que prueba el loop entero |
| 2 | **Horno** | Cierra `Mineral → Lingote` y desbloquea toda la cadena de metal | Piedra trabajada + madera + carbón | Estación | Placement, solidez, arte, estado de proceso | **Primer prototipo.** Es el objetivo de A-7 |
| 3 | **Banco de trabajo** | Habilita la mayoría de las recetas de refinado y herramientas | Tablones + piedra trabajada | Estación | Placement, solidez, arte | **Primer prototipo** si entra sin costo extra: es el mismo contrato que la fogata |
| 4 | **Cofre / almacenamiento** | Resuelve la presión de inventario que el propio prototipo genera | Tablones (+ metal para mejores) | Storage | Placement, solidez, **persistencia de contenido**, ownership | **Segundo.** El contenedor ya existe (`slotInventory.ts:11`), pero un cofre cuyo contenido se pierde al recargar es peor que no tenerlo |
| 5 | **Casa** | Punto personal y de regreso | Mucha madera + piedra + metal | Edificio | Todo lo anterior + interiores, parcelas, ownership persistente | **Postergar** |
| 6 | **Taller** | Estación avanzada / especializaciones | Materiales refinados + metal | Estación/edificio | Upgrades, especializaciones (hoy `status: 'future'`, `professions.ts`) | **Postergar** |
| 7 | **Tienda** | Participar en la economía entre jugadores | Materiales refinados | Servicio | Economía multiplayer, stock, precios, impuestos, anti-abuso | **Postergar.** Depende de A-12 |
| 8 | **Centro Pokémon** | Servicio comunitario de curación | Materiales avanzados | Servicio | Loop de PvE cerrado, economía de curación, permisos comunitarios | **Postergar.** Depende del loop de Dungeon (A-12, A-14) |

`PROPOSAL` El primer prototipo debería ser **Fogata + Horno (+ Banco de trabajo si sale gratis)**: las tres son "estación interactiva", comparten exactamente el mismo contrato de placement, solidez e interacción, y ninguna necesita persistencia para ser evaluable. El **Cofre** es el primer salto real de complejidad porque introduce estado propio que sobrevive.

`FACT` Nota sobre la Casa: el mundo ya dibuja casas y Centros Pokémon como decorado de pueblo (`engine/buildings.ts:12-14`). Eso **no** adelanta nada de esta sección: son placeholders sin dueño, sin estado y sin interacción de construcción.

---

## 5. Estaciones y lenguaje visual

`APPROVED` (A-8) Mesa de Alquimia, Horno, Fogata y Banco de Trabajo necesitan representación consistente y deben leerse como **ESTACIONES INTERACTIVAS**, no como decoración.

### 5.1 Lenguaje visual propuesto

`PROPOSAL` Tomar como base lo que ya existe y funciona (`art/alchemyStation.ts`) y volverlo regla común:

1. **Silueta artificial.** El mundo genera piedras, árboles y arbustos: formas orgánicas. Una estación debe tener líneas rectas, ángulos y materiales trabajados. Eso sólo ya la separa del decorado.
2. **Anclaje al frente.** El pie del sprite en el borde delantero (`STATION_AX/AY`, `alchemyStation.ts:19-21`), para que el orden de dibujo y la adyacencia coincidan con lo que el jugador ve.
3. **Cuatro estados legibles a distancia**, los mismos nombres para todas: `idle` (apagada), `ready` (podés usarla ahora), `working` (en proceso), `done` (hay algo para retirar). Hoy `alchemyStation.ts:24` usa `idle | ready | brewing | done`: `brewing` es el mismo estado con nombre de profesión.
4. **Un rasgo activo por estación**: el matraz en la Mesa, el fuego en el Horno y la Fogata, la pieza sobre el tablero en el Banco. Es lo que hace legible el estado sin abrir el panel.
5. **Marca de suelo**: las estaciones se apoyan sobre algo (base de piedra, tierra pisada). Ayuda a leerlas como puestas ahí a propósito, y da una pista visual de su footprint.

### 5.2 Separación estricta de responsabilidades

`PROPOSAL` Esto es lo que el documento necesita dejar clavado:

| Capa | Qué responde | Quién debería ser dueño | Estado hoy |
|---|---|---|---|
| **Representación visual** | Cómo se ve y en qué estado está | `SceneOverlay` (`sceneOverlay.ts:42-48`) | `FACT` correcto: sólo pinta |
| **Dato físico de mundo** | Qué estación hay, dónde, de qué tamaño | Un registro consultable por área y tile | `FACT` **no existe**; la Mesa se deriva por espiral (`stationPlacement.ts:44-56`) |
| **Colisión** | Si se puede pisar ese tile | El mundo, vía `Area.isSolid` + un proveedor adicional | `FACT` **falta**: la mesa no es sólida (F-1) |
| **Navegación** | Cómo llegar al lado | `TapNavigator`, que ya consulta solidez (`navigator.ts:126`) | `FACT` correcto si la solidez es verdadera |
| **Interacción** | Qué pasa al usarla de frente | `interact()` → `onWorldObject` (`game.ts:478-489`) | `FACT` correcto |
| **Validación autoritativa** | Si esa acción es legal | Servidor, leyendo el mismo dato | `FACT` no existe |

`PROPOSAL` **`SceneOverlay` no debe ser dueño de la solidez** — y hoy no lo es, lo cual es la buena noticia: el problema es que *nadie* lo es para las estaciones. La solución ya propuesta (`ObstacleProvider` consultable por mundo, navegación e interacción, con las estaciones como dato) es la correcta y **no la implemento acá**. Lo único que agrego como recomendación de diseño: ese registro debe poder alimentarse de **dos fuentes** — estaciones fijas del mundo y estructuras construidas por jugadores — porque si nace resolviendo sólo la primera, la segunda lo rompe.

`PROPOSAL` Consecuencia para el footprint: una estación que ocupa más de un tile necesita que la consulta sea por tile y no por objeto. Un horno de 1×1 y una casa de 4×3 deben responder la misma pregunta: "¿este tile está ocupado, y por qué?".

`OPEN` Si las estaciones fijas del mundo (las públicas del pueblo) se declaran como dato del área o se siguen derivando; y qué pasa con la Mesa de Alquimia actual cuando exista el registro. Es `O-9`.

---

## 6. Pokémon worker y afinidad

`APPROVED` (A-1, A-2, A-3) Party de 6, `worker ∈ activeParty`, 1 worker por acción, cinco atributos visibles (Potencia, Hallazgo, Eficiencia, Rapidez, Técnica), afinidad por `tipo(s) + stats + nivel + especie/ability + herramienta`, doble tipo con caps.

### 6.1 Lo que ya existe

`FACT` El sistema de afinidad es data-driven y calcula bonos por trait con presupuesto compartido, de modo que una especie fuerte en un nicho es proporcionalmente más débil en los otros (`domain/affinity.ts:1-11`).

`FACT` **El tipo Fuego ya aporta al trait `processing` dentro de Minería**: `fire: { processing: 0.4 }` (`catalog/affinityProfiles.ts:32`). O sea: la palanca conceptual que A-7 pide para el Horno **ya está puesta**, dentro de Minería y sin profesión nueva.

`FACT` `ProcessingContext` sólo recibe el bono agregado `processingBonus`, y lo aplica con tope `MAX_PROCESSING_BONUS` (`processing.ts:10,20,38`). No sabe qué Pokémon es, ni su tipo, ni su nivel.

### 6.2 Contratos conceptuales propuestos

`PROPOSAL` **Contexto del worker en el Horno.** Lo mínimo que la acción necesita conocer, sin fórmulas:

```text
worker:   identidad (pertenece al party activo), especie, tipo(s), nivel, stats relevantes
estación: cuál es, de quién es, en qué estado está
proceso:  receta elegida y cantidad
jugador:  nivel de la profesión, inventario, herramienta si aplica
```

`PROPOSAL` **Contexto del worker en Construcción.** Lo anterior, más lo que sólo existe al construir:

```text
plano:    qué estructura
lugar:    área, tile de anclaje, orientación, footprint
mundo:    terreno, superposición, distancia a otras estructuras, si el área lo permite
```

`PROPOSAL` **Qué podría afectar cada atributo** — direcciones, no fórmulas:

| Atributo | En el Horno | En Construcción |
|---|---|---|
| **Potencia** | Poco o nada: fundir no es fuerza | Levantar estructuras pesadas; posible requisito de ciertas obras |
| **Hallazgo** | Poco o nada: un lingote es un lingote | Poco o nada |
| **Eficiencia** | Ahorro de **combustible** e insumos | Ahorro de materiales |
| **Rapidez** | Tiempo del proceso | Tiempo de obra |
| **Técnica** | Calidad del refinado y resultados especiales | Calidad de la obra; posible condición inicial de la estructura |

`PROPOSAL` La lectura natural es que **Horno se apoya en Eficiencia, Rapidez y Técnica**, y **Construcción en Potencia, Rapidez y Técnica**. Eso da a las dos actividades perfiles de worker distintos sin inventar reglas nuevas.

`PROPOSAL` **Cómo importa Fuego en el Horno sin crear una profesión.** Exactamente como ya está modelado: el tipo pondera traits **dentro de Minería**, y el Horno es una acción de Minería. Si hace falta más resolución, el lugar correcto es el peso del tipo en el perfil de la profesión, no una profesión nueva. La sinergia mencionada en A-3 (Fuego + Roca para fundición) cabe en el mismo mecanismo.

`OPEN` Qué debe esperar a fórmulas y balance, y no debe decidirse acá: los valores de los cinco atributos y su derivación (`O-2`), la tabla de los 18 tipos y las reglas de doble tipo (`O-3`), la migración de los 11 traits actuales a los 5 atributos visibles (`O-2`), y si un worker queda ocupado y deja de estar disponible para combate mientras trabaja (`O-1`).

---

## 7. Trust boundary y persistencia futura

`FACT` La regla del proyecto: el cliente es la capa de presentación, el servidor es la capa de autoridad; una decisión es del servidor si es persistente, económica, explotable o compartida (`docs/TRUST_BOUNDARY.md:11-25`).

`FACT` Nada de profesiones tiene hoy autoridad ni persistencia (§1.8), y el prototipo de Dungeon está igual (`DUNGEON_PROTOTYPE_INTEGRATION.md:43-48`).

`PROPOSAL` Lo que un servidor futuro tendrá que decidir o validar. **Contratos y riesgos, sin tablas ni APIs:**

| # | Qué valida | Riesgo si lo decide el cliente |
|---|---|---|
| 1 | **Materiales** | Construir o fundir sin tener los insumos |
| 2 | **Receta / plano** | Producir algo que el jugador no desbloqueó |
| 3 | **Estación** | Fundir sin horno, o usar el horno de otro sin permiso |
| 4 | **Posición** | Colocar estructuras dentro de roca, agua, pueblos o encima de otra cosa |
| 5 | **Permisos** | Usar o modificar lo ajeno |
| 6 | **Ownership** | Reclamar una estructura que no construyó |
| 7 | **Inventario** | Duplicar items; construir y conservar los materiales |
| 8 | **Herramientas** | Usar una herramienta rota, ajena o de tier superior |
| 9 | **Combustible** | Procesar sin gastar la carga |
| 10 | **Worker activo** | Usar un Pokémon que no está en el party, o el mismo en varias acciones |
| 11 | **Duración** | Reclamar el resultado antes de tiempo |
| 12 | **Resultado** | Elegirse el output |
| 13 | **Placement** | Estructuras superpuestas, o que encierran a otro jugador |
| 14 | **Idempotencia / replay** | Reenviar "terminé" y cobrar dos veces |
| 15 | **RNG** | Repetir la tirada hasta que salga bien |
| 16 | **Estado de construcción** | Saltarse la obra; declararla completa |

`PROPOSAL` Tres riesgos que me parecen los más serios y conviene mirar temprano:

- **Idempotencia (14)** es el que más barato sale resolver al principio y más caro después: toda acción con duración necesita un identificador de intento desde el primer día, aunque el primer prototipo sea local.
- **Placement (4, 13)** es el único de esta lista que **no tiene dónde apoyarse hoy**: sin un dato de mundo consultable (§5), el servidor no tiene contra qué validar una posición. Es la dependencia dura entre Construcción y F-1.
- **Worker activo (10)** depende del party, que aún no existe en el cliente de WildLands (`A-1`, "Estado actual").

`PROPOSAL` Una propiedad de diseño que ayuda a todo lo anterior: mantener las posiciones **derivables o declaradas como dato**, nunca "lo que el cliente dijo". El mundo ya trabaja así con los nodos (`nodePlacement.ts:66-84`), y es la razón por la que `R31Z_CONSOLIDATION_PLAN.md:150` pide reemplazar la derivación trigonométrica de la Mesa por un registro fijo.

`OPEN` Dónde se persiste una estructura colocada, qué se guarda y qué se deriva, y qué pasa con las estructuras de un jugador que no juega más. Es `O-10`.

---

## 8. Fases recomendadas

`PROPOSAL` Cada fase tiene un **gate**: si el gate no está, la fase siguiente no empieza.

| Fase | Contenido | Depende de | Gate para pasar |
|---|---|---|---|
| **F0 · Diseño** (esto) | Estado real, loops, estructuras, contratos | — | Aprobación de los loops de §2 y §3, y respuesta a los `OPEN` bloqueantes de §9 |
| **F1 · Prototipo local visual** | Arte de Horno, Fogata y Banco con los 4 estados; lenguaje visual común | F0 | Que las 4 estaciones se lean como interactivas sin leer texto |
| **F2 · Dato de mundo + solidez** | Registro de estaciones consultable; colisión, navegación e interacción leyendo lo mismo (F-1) | F1, **aprobación de tocar el motor** | No poder pararse sobre una estación; llegar al lado desde los 4 costados; provider nulo = comportamiento idéntico |
| **F3 · Prototipo local funcional** | Loop del Horno completo en dev; Construcción colocando fogata/horno | F2 | Poder recorrer `mineral → horno → lingote → herramienta` **sin atajos de playground** |
| **F4 · R32-0 / autoridad** | Las 16 validaciones de §7; idempotencia; RNG del lado del servidor | F3, party activo (`A-1`/`O-1`) | Que ninguna de las 16 dependa del cliente |
| **F5 · Persistencia** | Estructuras colocadas, contenido de cofres, progreso de profesión | F4 | Que una estructura y un cofre sobrevivan a recargar |
| **F6 · Economía / balance** | Números de todo lo anterior | F5 y **loop de PvE definido** (`A-12`) | Medir demanda real de consumibles y materiales |
| **F7 · Multiplayer / ownership** | Permisos, uso público, tarifas, tiendas, Centro Pokémon comunitario | F6 | Anti-abuso y permisos resueltos |

`PROPOSAL` Dos dependencias que conviene decir en voz alta:

- **F2 es un cuello de botella real.** Toca `game.ts`, que es motor central, y ya está marcado como "requiere aprobación" (`R31Z_CONSOLIDATION_PLAN.md:175`). Construcción entera cuelga de ahí.
- **F6 no puede adelantarse.** Mientras el loop de PvE no esté definido, cualquier número de construcción es una suposición (`A-12`).

---

## 9. Riesgos y decisiones abiertas

### 9.1 Riesgos

| # | Riesgo | Por qué importa | Evidencia |
|---|---|---|---|
| R-1 | **Lingote de Hierro sigue sin faucet jugable** | Toda la rama de metal (herramientas T2/T3, reparaciones, Caña Reforzada) depende de un item que en producción no se puede obtener | `G-6`; §1.2 |
| R-2 | **El playground regala lingotes y funde sin horno** | Se puede "probar" la cadena sin recorrerla y concluir que funciona | `G-10`; `demoSession.ts:352` |
| R-3 | **Las recetas `construction` producen un item, no una estructura** | Si se construye sobre ese precedente, "construir" queda siendo crafting y el placement nunca aparece | `recipes.ts:42-44,59`; `processing.ts:55-60` |
| R-4 | **Las estaciones no son sólidas** | Sin dato de mundo no hay validación de posición posible, ni para el cliente ni para el servidor | F-1; §5 |
| R-5 | **Sin party activo no hay worker validable** | `worker ∈ activeParty` no se puede comprobar contra algo que no existe | `A-1` "Estado actual" |
| R-6 | **Un cofre sin persistencia es una trampa** | Guardar cosas y perderlas al recargar es peor que no tener cofre | §4, fila 4 |
| R-7 | **Dos modelos de inventario conviviendo** | Los resolvers usan conteos sin límite; la UI usa slots. Construcción consume mucho volumen y va a tensionar justo esa costura | §1.7 |
| R-8 | **Frontera de profesiones (R31)** | Cualquier feature nuevo que quiera leer el catálogo choca con el test de aislamiento; conviene decidir dónde vive Construcción **antes** de escribir código | `professionsIsolation.test.ts` |
| R-9 | **Acoplarse a Dungeon** | La economía de Dungeon no está balanceada y su semántica de captura está en conflicto abierto | `A-13`, `A-14`, `I-1` |
| R-10 | **Nivel de Construcción sin progresión** | Una quinta profesión sin nodos propios necesita definir de dónde sale su XP | §9.2, `OPEN` C-3 |

### 9.2 Decisiones abiertas

Ninguna se inventa acá. Las que ya tienen id en `PRE_R32_DESIGN_DECISIONS.md` lo conservan.

| ID | Pregunta | Bloquea |
|---|---|---|
| `O-8` | **Combustible**: input por proceso, carga de estación o ambos; tiempos; horno propio vs. público; relación entre nivel de fundido y de minado (Nv. 12 vs. Nv. 15); qué se hace con los lingotes regalados del playground | F3 |
| `O-9` | **Estaciones**: lenguaje visual final, si su posición es dato declarado o derivado, y la solidez (F-1) | F2 |
| `O-10` | **Construcción**: progresión, planos, colocación, ownership, permisos, mantenimiento, upgrades, tarifas, persistencia y autoridad | F3+ |
| `O-11` | **Casa / Tienda / Centro Pokémon**: economía de uso, ingresos, abastecimiento, cooldowns | F7 |
| `O-1` | **Party activo**: modelo de datos, worker ocupado vs. disponible para combate | F4 |
| `O-2` / `O-3` | **Atributos y afinidades**: fórmulas, tabla de tipos, caps de doble tipo | F6 |
| `C-1` | **Dónde vive Construcción**: ¿quinta entrada del catálogo de profesiones, o feature propio? Afecta a R-8 | F1 |
| `C-2` | **Qué pasa con las 4 recetas `construction` actuales**: ¿se migran a Construcción, se quedan en su profesión, o se duplican? Afecta la progresión ya publicada en los milestones (Minería Nv. 10 "Puede construir un Horno de Fundición propio", `professions.ts`) | F1 |
| `C-3` | **De dónde sale la XP de Construcción**: sólo de construir, también de procesar materiales de obra, o de ambos | F3 |
| `C-4` | **Retirar una estructura**: ¿se puede?, ¿devuelve materiales?, ¿qué pasa con el contenido de un cofre? | F3 |
| `C-5` | **Dónde se puede construir**: mundo abierto, zonas permitidas, parcelas, distancia mínima entre estructuras | F3 |
| `C-6` | **Estaciones públicas del pueblo**: ¿siguen existiendo cuando el jugador puede construir las propias, y con qué diferencia? Hoy son sólo un multiplicador de tiempo | F3 |
| `C-7` | **Footprint**: ¿todas las estaciones son 1×1 en el primer prototipo, o el sistema nace multi-tile? | F2 |

---

## Apéndice · Fuentes verificadas

Todo lo marcado `FACT` se leyó en `0a174d3`:

- `src/features/professions/domain/catalog/` — `items.ts`, `nodes.ts`, `recipes.ts`, `tools.ts`, `professions.ts`, `affinityProfiles.ts`
- `src/features/professions/domain/` — `types.ts`, `processing.ts`, `inventory.ts`, `gathering.ts`, `durability.ts`, `nodePlacement.ts`, `affinity.ts`
- `src/features/professions/inventory/` — `slotInventory.ts`, `stackRules.ts`
- `src/features/professions/alchemy/stationPlacement.ts`, `src/features/professions/art/alchemyStation.ts`
- `src/features/professions/demo/demoSession.ts`, `src/features/professions/components/playground/PlaygroundControls.vue`
- `src/features/professions/professionsIsolation.test.ts`
- `src/features/wildlands/engine/` — `sceneOverlay.ts`, `area.ts`, `game.ts`, `navigator.ts`, `buildings.ts`, `world.ts`
- `src/app/router/routes.ts`
- `docs/economy/` — `PRE_R32_DESIGN_DECISIONS.md`, `PRE_R32_HUMAN_GATE.md`, `R31_SESSION_HANDOFF.md`, `R31Z_CONSOLIDATION_PLAN.md`, `ENERGY_DURABILITY.md`
- `docs/wildlands/DUNGEON_PROTOTYPE_INTEGRATION.md`, `docs/TRUST_BOUNDARY.md`

Comprobaciones negativas (busqué y **no** existe): `src/features/wildlands/engine/obstacles.ts`; cualquier arte de horno, fogata o banco en `src/features/professions/art/`; cualquier lectura del tag `fuel`; cualquier profesión `construction` en `PROFESSION_IDS`; cualquier placement de estructura de jugador.

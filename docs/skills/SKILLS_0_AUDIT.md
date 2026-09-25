# SKILLS-0 — Auditoría BEFORE

> Estado de Skills en **PokeSwap Community Playtest 0.2** antes de SKILLS-1.
> Baseline: frontend `dc6dc70` (tag `playtest-0.2`, = `origin/playtest/community-0.1`, sin hotfixes posteriores). Realtime `be360fd` (sin referencias a Skills).
> Rama de trabajo: `skills/1-osrs-rebuild`, worktree propio (`../pokeswap-skills`), separado del working tree principal.
>
> Etiquetas: **FACT** (verificado en código), **INFERENCE**, **OPEN QUESTION** (AGENTS.md §1).

---

## 0. Resumen en cinco líneas

1. **FACT.** Skills es 100 % cliente, en memoria y no persistente. No hay tablas, RPCs, Edge Functions ni código de realtime. Un refresh resetea todo. **No hay riesgo de DB**: no existe ningún dato histórico que migrar ni borrar.
2. **FACT.** El módulo `src/features/professions/` tiene **185 archivos / ~39 000 líneas** (14 600 de ellas son un snapshot de test). Implementa cuatro profesiones (Minería, Tala, Pesca, Alquimia) más energía, herramientas con durabilidad, reparación, 11 "traits" de afinidad, 3 "access tags", recetas, estaciones (horno, mesa de alquimia), inventario por slots, un simulador económico y un playground de desarrollo.
3. **FACT.** Lo que ve el jugador del playtest (`ProfessionWorldDemo.vue`, montado por `WildlandsView` sólo en DEV y en la build de playtest) usa **un Pokémon fijo por profesión** (Machamp, Bibarel, Blastoise, Blissey) que el jugador no elige, y la Tienda vende pico/hacha/hoz/caña.
4. **INFERENCE.** El sistema es poco intuitivo porque la complejidad está en la capa equivocada: 11 bonus invisibles, energía, durabilidad, herramientas y 4 profesiones interdependientes, mientras que lo que el jugador debería aprender ("elijo un Pokémon y trabaja") no existe.
5. **Decisión.** Reemplazo, no mejora: nuevo feature `src/features/skills/` con 3 skills, aptitud por especie, contrato WORLD↔SKILLS e idempotencia; el dominio R31 se retira del producto y se elimina.

---

## 1. Skills existentes

| Id | Nombre | Herramienta | Nodos | Estado en producto |
|---|---|---|---|---|
| `mining` | Minería | pico | stone_outcrop (1), coal_seam (5), iron_vein (15), crystal_cluster (20, `hardRock`), gold_vein (30) | Live en playtest |
| `woodcutting` | Tala | hacha | common_tree (1), pine_tree (8), hardwood_tree (15), boreal_tree (30) | Live en playtest |
| `fishing` | Pesca | caña | shore_spot (1), coastal_spot (15), reef_spot (30, `deepWater`) | Live en playtest |
| `alchemy` | Alquimia | hoz | berry_bush (1), herb_patch (5), wild_grove (15), frost_bloom (30, `frozenGround`) + mesa de alquimia | Live en playtest |

- Nivel máximo 60 (`MAX_PROFESSION_LEVEL`). Curva `40·(L−1)^2.35` (`domain/progression.ts`).
- Milestones de texto + "especializaciones" stub (`status: 'future'`) nunca implementadas.
- **No existe Agricultura.** Lo más cercano es el forrajeo de Alquimia (arbustos de bayas), que es recolección, no cultivo.

## 2. Datos persistidos / tablas

**FACT.** Búsqueda en `supabase/migrations/*.sql`, `supabase/functions/**`, `services/realtime/**`: **cero** referencias a profession/skill/fishing/mining/wood/harvest.

- `20260907_008_progression_xp_authority.sql` es XP de **entrenador/Pokémon**, no de Skills.
- `demoSession.ts`, `useProfessionDemo.ts`, `usePlaytestStore.ts`: estado en `shallowRef`/`ref` de módulo. Sin `localStorage` (hay un test que lo prohíbe en el feature).
- **Consecuencia:** no hay legado de Pesca almacenado. No se necesita migración de retiro. No hay nada que auditar para DROP.

## 3. Items (R31 `domain/catalog/items.ts`, 56 items)

Ver clasificación completa en §10.

- Raw: stone, coal, iron_ore, gold_ore, evolution_shard, common_log, hardwood_log, boreal_log, resin, apricorn, fish, seaweed, quality_fish, pearl, heart_scale, oran_berry, medicinal_herb, leppa_berry, sitrus_berry, revival_herb, wild_essence, boss_relic.
- Refined: iron_ingot, gold_ingot, steel_ingot, stone_brick, vial, plank, hardwood_plank, tool_handle, fish_oil, herbal_extract.
- Tools (12): stone/iron/steel × pickaxe/axe/sickle, basic/reinforced/master rod.
- Consumables: potion, super_potion, hyper_potion, revive, ether, vigor_tea.
- Structures: workbench, campfire, smelter, alchemy_table.
- `RESERVED_SINKS`: apricorn y boss_relic existen "para una fase posterior".

**FACT.** La economía está cruzada a propósito: pociones necesitan frascos (minería), la hiperpoción necesita aceite de pescado, el Revivir alternativo necesita Escama Corazón (pesca), las herramientas necesitan mangos (tala) con resina. **Quitar Pesca rompe recetas de Alquimia y herramientas** → no se puede "sacar Pesca" sin rehacer el catálogo.

## 4. Recursos / nodos / mapa

- **FACT.** `domain/nodePlacement.ts` deriva nodos del seed del mundo: cada decor (`rock`, `boulder`, `tree`, `pine`, `crystal`…) tiene una densidad de hosting y se elige una definición por bioma + anillo de distancia (`ZONE_RING_TILES = 96`, `MAX_ZONE = 3`). Depletion por jugador en `nodeDepletion.ts` (cargas personales). No es estado compartido.
- **FACT.** Áreas: `ciudad-corazon` (lobby) + 5 mundos procedurales (`pradera`, `bosque`, `desierto`, `tundra`, `costa`), más dungeons (cuevas) aparte.
- **FACT.** Arte existente: 5 variantes de roca (`stone_outcrop`, `coal_seam`, `iron_vein`, `gold_vein`, `crystal_cluster`) y 4 de árbol (`common_tree`, `pine_tree`, `hardwood_tree`, `boreal_tree`), más sprites de spot de pesca, arbustos de forrajeo, mesa y horno.
- **INFERENCE.** El problema de "tutorial por el mapa" es real: `stone_outcrop` y `coal_seam` comparten anillo 0; los nodos bloqueados por herramienta aparecen al lado del spawn.
- **Propiedad futura:** existencia física, posición, estado, depletion y respawn son de **WORLD-1**. La colocación cliente actual es un sustituto pre-WORLD.

## 5. UI

| Superficie | Archivo | Qué muestra |
|---|---|---|
| Botón + panel Skills | `components/SkillsPanel.vue` | 4 filas (nivel/60, barra, XP, próximo unlock), energía, nota "no se guarda" |
| Tarjetas de acción | `MiningActionCard`, `LoggingActionCard`, `FishingActionCard`, `ForageActionCard` | recompensa, **energía**, **durabilidad**, XP, desglose de bonus |
| Estaciones | `FurnaceStationCard`, `AlchemyStationCard` | recetas, cantidades, procesos |
| Mochila | `InventoryGrid` (slots + stacks) | inventario demo |
| Hint | `ProfessionWorldDemo.hint` | "Acercate a una roca con vetas, un árbol con cinta, un arbusto con bayas, la mesa de alquimia, el horno o la orilla" |
| Tienda | `playtest/PlaytestShopView.vue` | pico, hacha, hoz, caña |
| Playground dev | `/dev/profesiones` | laboratorios por profesión, galería de assets |

**INFERENCE.** El jugador ve primero números de energía y durabilidad, y nunca elige al Pokémon. La pantalla dice "Skills" pero habla de herramientas.

## 6. Autoridad cliente/servidor

- **FACT.** Toda la resolución (drops, XP, RNG sembrado, depletion) corre en el navegador (`demoSession.ts`). Está bien **sólo** porque nada persiste (AGENTS §2, §8, §11).
- **FACT.** `services/realtime` es CommonJS JS y no importa nada de `src/`. No hay puerto para que el servidor ejecute reglas de Skills.
- **Requisito nuevo:** reglas encapsuladas, puras, sin Vue ni DOM, ejecutables en servidor; recompensa concedida una sola vez por `actionId`.

## 7. Referencias a Pesca (removal map BEFORE)

| Capa | Archivos |
|---|---|
| Lógica | `fishing/` (7 archivos: timeline, overlay, splash, approach, visual state, controller, test) |
| Arte | `art/fishingArt.test.ts`, `fishingAssets`, `fishingFx`, `fishingItems`, `fishingPalette`, `fishingSpots` |
| UI | `FishingActionCard.vue`, `FishingCast.vue`, `ui/fishingSession.ts`, `playground/FishingFieldLab.vue` |
| Catálogos | `PROFESSION_IDS`, `PROFESSIONS.fishing`, 3 nodos, 5 items, 3 cañas, 2 recetas de aceite, perfil de afinidad, access tag `deepWater`, recetas de alquimia que consumen pesca |
| Producto | `ProfessionWorldDemo.vue` (controller, card, poll de mordida, hint "la orilla"), `SkillsPanel` (fila 🎣), Tienda (`basic_rod`) |
| Tests transversales | `overlayTrace` + snapshot, `professionsStress`, `playtestStart.test`, `playtestShop.test`, `CityPanel.test` |
| Docs | `FISHING_ASSET_MANIFEST.md`, `FISHING_INTERACTION_SPEC.md`, `R31C2_*` |
| DB | **ninguna** |

## 8. XP y progresión actual

- Curva única `totalXp(L) = round(40·(L−1)^2.35)`, nivel 1–60. L2 = 40, L10 ≈ 7 000, L30 ≈ 110 000.
- XP por acción fija por nodo (30 → 200) con −50 % si el jugador supera por 25 niveles el requisito; +50 % "rested".
- Eficiencia por nivel sobre el requisito (velocidad/energía/yield/rare, con topes).
- **INFERENCE.** L10 exige ~230 acciones de nodo básico: la primera meta se siente lejana. No hay una razón visible entre unlocks (5 → 15 → 30).

## 9. Afinidad Pokémon actual

- 11 traits × pesos por tipo × pesos por stat × escala × tope, normalizado por especie, escalado por nivel del Pokémon; 3 access tags binarios; overrides como "raw boost" (4 entradas).
- **INFERENCE.** Imposible de leer para el jugador ("+12 % energySaving, detección ×1.3"). Imposible de parchear con intuición: un override no dice "Scyther tala muy bien", dice "+0.3 speed antes de normalizar".
- Depende del nivel del Pokémon: un Pokémon de nivel bajo es peor trabajador → mezcla la progresión del Pokémon con la del jugador.

## 10. Items — KEEP / REWORK / REMOVE / UNCLEAR

"¿Para qué quiero esto?" es la prueba. "Porque ya estaba" no alcanza.

| Item | Veredicto | Motivo |
|---|---|---|
| stone | **KEEP** | Material base de Minería; construcción/venta. Primer drop que aprende el jugador. |
| coal | **KEEP** | Combustible: única materia de fundición futura; drop de nivel 10. |
| iron_ore | **KEEP** | Metal de midgame (nivel 20). |
| gold_ore | **KEEP** | Recurso valioso (35): venta de alto valor. |
| evolution_shard | **UNCLEAR** | Toca progresión de Pokémon (evolución). No se dropea hasta que exista diseño de evolución. |
| common_log | **KEEP** | Madera base de Talar. |
| hardwood_log | **KEEP** | Madera de midgame. |
| boreal_log | **KEEP** | Madera avanzada (40+). |
| resin | **REMOVE** | Sólo existía para mangos de herramientas y cañas. Sin herramientas no tiene respuesta. |
| apricorn | **REMOVE** (idea guardada) | "Reservado para Poké Balls" = sistema futuro que toca captura. No se implementa para justificarlo. |
| fish, seaweed, quality_fish, pearl, heart_scale | **REMOVE** | Pesca eliminada. |
| oran_berry, medicinal_herb, leppa_berry, sitrus_berry, revival_herb | **REWORK** | Pasan a ser **cosechas de Agricultura** (antes forrajeo de Alquimia). Respuesta: consumibles de Dungeon (curan/restauran) y venta. |
| wild_essence, boss_relic | **UNCLEAR** (fuera de Skills) | Drops PvE; no son de Skills. No se tocan en este cambio. |
| iron_ingot, gold_ingot, steel_ingot, stone_brick, vial, plank, hardwood_plank, tool_handle, herbal_extract | **REMOVE del producto** | Productos de estaciones/recetas R31/R33. Sin sistema de crafting aprobado no tienen uso; se rediseñan cuando exista Crafting. |
| fish_oil | **REMOVE** | Pesca. |
| 12 herramientas | **REMOVE** | "El Pokémon es quien trabaja." |
| potion…vigor_tea | **REMOVE de Skills** | Los consumibles del Dungeon viven en `dungeonPrototype` con ids propios; `vigor_tea` sólo existía para la energía. |
| workbench, campfire, smelter, alchemy_table | **REMOVE del producto** | Estructuras de crafting R31/R33; fuera de las 3 skills. |
| — nuevo — pine_log | **NEW** | Madera de nivel 12 (Pino). Antes el pino daba common_log + resina: un árbol "nuevo" que daba lo mismo no enseñaba nada. |
| — nuevo — crystal | **NEW** | Cristal (45). Reemplaza "crystal_cluster da piedra + chance de fragmento evolutivo". Recurso especializado de fin de arco. |

## 11. Profesiones / sistemas a retirar

| Sistema | Veredicto | Motivo |
|---|---|---|
| Pesca | **ELIMINAR** | Orden de producto. |
| Alquimia como skill | **ELIMINAR** | Sólo 3 skills. Sus bayas/hierbas pasan a Agricultura. |
| Energía | **ELIMINAR** | Limitador invisible; el ritmo lo dan duración, depletion (WORLD) y crecimiento. |
| Herramientas + durabilidad + reparación | **ELIMINAR** | Contradice la identidad ("el Pokémon trabaja"). |
| 11 traits + access tags + `rested` + rareFind/detection | **REEMPLAZAR** | Por aptitud 1–5 por skill y especie. |
| Recetas / estaciones (horno R33, mesa, banco, fogata) | **RETIRAR** | Crafting no es Skill; sin catálogo de materiales aprobado. El diseño queda en docs para una fase Crafting. |
| Simulador económico (`sim:economy`) | **ELIMINAR** | Modelaba energía/herramientas; no aplica. |
| Playground `/dev/profesiones` | **ELIMINAR** | Laboratorio de R31; las reglas nuevas se prueban con tests puros. |
| Inventario por slots de la demo | **ELIMINAR** | La mochila de Skills en playtest pasa a ser conteo simple; el inventario real es decisión aparte. |
| Arte de roca/árbol, overlays, compañero Pokémon, reward pops | **CONSERVAR** | Es presentación reutilizable y ya validada visualmente. |
| Colocación de nodos cliente | **CONSERVAR como puente pre-WORLD** | WORLD-1 la reemplaza. |

## 12. Tests existentes

- 40 archivos de test en `professions/` (dominio, arte, overlays, stress, snapshot de 14 600 líneas).
- Transversales: `playtestStart.test.ts` (nodos inicial por profesión incl. pesca), `playtestShop.test.ts` (4 herramientas), `CityPanel.test.ts` (compra de pico/caña), `obstacles.test.ts` (dungeon cita niveles del catálogo de nodos), `factory.test.ts` (RNG sembrado de professions).
- **INFERENCE.** Buena parte prueba invariantes del sistema a eliminar (energía, durabilidad, cargas por slot). No se conservan; se reescriben tests del sistema nuevo.

## 13. Riesgos detectados

| Riesgo | Severidad | Mitigación |
|---|---|---|
| DB destructiva | **Ninguno** | No hay tablas. |
| Economía de tokens | **Ninguno** | Skills no toca tokens; las fichas de playtest son de sesión. |
| Rama reciente incompatible | Bajo | No hay rama remota de WORLD/Skills aún. `feat/r33-stations-product` y `design/construction-smelter-foundation` son históricas y ya mergeadas en lo que corresponde. |
| Dungeon cita niveles de Minería/Tala | Medio | Se actualizan los números citados; el cristal pasa a pedir Minería 45 (ver report). |
| Arte acoplado a ids de nodo R31 | Bajo | Los ids de recurso nuevos coinciden con los ids de arte. |
| WildlandsView (host compartido con WORLD) | Bajo | Se preserva el contrato del componente host; a lo sumo una prop. |

## 14. Qué conservar / reemplazar / eliminar (decisión)

- **Conservar:** arte de rocas y árboles, overlays de minería/tala, compañero Pokémon, reward pops, colocación pre-WORLD, ids de arte.
- **Reemplazar:** catálogo, curva, afinidad, resolución, UI de Skills, tarjetas de acción, puente del playtest.
- **Eliminar:** Pesca, Alquimia, forrajeo, energía, herramientas, durabilidad, recetas, estaciones, simulador, playground, inventario por slots, tests de lo anterior.

No se encontró nada que obligue a detenerse (sin riesgo de DB, sin dependencia con tokens, sin rama incompatible, nada contradice el prompt). Se continúa con SKILLS-1.

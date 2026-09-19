# R32 — Auditoría de integración y hoja de ruta

> Fecha: 2026-09-18. Estación **principal**.
> Estado auditado: `integration/r31` @ `bfc08365ceeaaf8e8c23317a1765eeb67cdcd6ae`.
> Este documento es la base contractual de R32. Una sesión nueva lee esto y `R31_SESSION_HANDOFF.md`, y no necesita reconstruir la historia.
> **Estado al 2026-09-18:** las §§1–13 son el análisis original y se conservan como estaban salvo donde diga `Actualización`. El estado real de cada subfase vive en **§14**, y a esta fecha R32.1, R32.2, R32.2.1 y R32.3 están entregadas —sólo dominio, catálogo, modelo y reglas— sin nada de autoridad, red, persistencia ni gameplay nuevo.

---

## 1. Estado real de `integration/r31`

`FACT` Lo que **ya está** en la rama de integración, contra `origin/main` @ `480b352`:

| Bloque | Estado |
|---|---|
| R31 profesiones (A → C4.1, QA, hardening, baseline, Bloque A, T-S2, R31-Z.1) | Consolidado |
| `PRE-R32 HUMAN PROFESSION GATE` | **PASSED** (2026-09-18, tras R31-H1) |
| R30 F-2 (prop tap picking) | En `main` y sincronizado acá |
| F-1 + F-1.1 (`PlacedObjects`) | Integrado (`bfc0836`) |
| **Prototipo de Dungeon/PvE (D1 → D1.2.4ter)** | **Integrado** (`73e97ab`), dev-only en `/dev/dungeon` |
| Diseño de Horno y Construcción | Integrado (`b7d4b7d`), solo diseño |
| Suite | 108 archivos / 1.180 tests; typecheck 0; lint 0 errores; build OK |
| Snapshot congelado de profesiones | `a62f2ebb8372073d1d669d4217a84f3e` |

`FACT` **La Dungeon ya está integrada como prototipo.** La referencia "congelada" `9dedac6` que circulaba es **ancestro** de esta rama; el tip real de `feat/d1-2-4-obstacles-combat` es `ef4ff85`, un commit más adelante, y también está integrado. No hay nada pendiente de traer de esa entrega.

`FACT` `integration/r31` **no se mergea a `main`** hasta que se ordene explícitamente.

---

## 2. Clasificación del prototipo de Dungeon

**A** reutilizable casi directo · **B** reutilizable con adapter · **C** solo prototipo · **D** descartar.

| Componente | Archivos | Clase | Razón |
|---|---|---|---|
| Generación de pisos | `floorPlan`, `floorTiles`, `floorSpace`, `decorPlan`, `tileKinds`, `rng`, `floorKey` | **A** | Dominio puro y determinista por semilla; el servidor puede recomputar lo mismo |
| Obstáculos y recovecos | `obstacles` | **A** | Puro; su única lectura de profesiones es un test anti-drift |
| Catálogo y spawn | `dungeonCatalog`, `dungeonSpawn`, `tiers` | **A** el modelo (Definition ≠ Spawn), **B** el reloj | El reloj del spawn debe ser del servidor |
| Combate | `battle`, `damage`, `moves`, `typeChart` | **B** | Motor sólido, hoy en cliente y con tabla de tipos/movimientos declarados PROTOTYPE |
| Expedición y co-op | `expedition`, `coop`, `occupancy`, `rewards` | **B** | Escritos como contratos, listos para autoridad; falta el servidor |
| Boss | `alpha`, `bossFight`, `bossRoom`, `bossSkills` | **B** | Igual |
| Captura | `capture` | **B** | Fórmula prototipo; la semántica quedó cerrada en §4 |
| Party / Pokémon | `party` | **B** | El split Species/Instance existe pero incompleto (§6) |
| Adapter a WildLands | `dungeonArea`, `dungeonScene`, `dungeonTerrain`, `dungeonProps`, `combatStaging`, `navigation` | **B** | Buen puente; debe convivir con `PlacedObjects` y con el área productiva |
| Render y arte | `render/*`, `worldOverlay`, `tileArt` | **B** | Reutilizable pasando por el renderer productivo |
| UI/HUD | `components/*` (PlayDungeon, CombatPopup, DungeonStage, BattleHud…) | **C** | Validaron UX; hay que recablearlos sobre estado autoritativo |
| Fixtures | `data/speciesFixtures`, `runFixtures` | **C** | 14 especies declaradas a mano; las reemplaza el Battle Catalog |
| Labs `/dev/dungeon` | `GeneratorLab`, `BattleLab`, `CaptureLab`, `ExpeditionLab`, `AlphaBossLab`, `WorldCompare`, `DevTools` | **C** | Herramienta, no producto |
| Tests de dominio | `generation`, `battle`, `boss`, `bossRoom`, `expedition`, `obstacles`, `floorSpace`, `navigation`, `playSession`, `ballAndSwitch`, `decorPlan`, `dungeonScene`, `combatStaging` | **A** | Se conservan casi tal cual: son la red del port |
| Dungeon legacy | `src/features/dungeon/` | **D** | Descartado como base. Consumidores vivos: `app/router/routes.ts` y `progression/api/progressionApi` |

`FACT` **Actualización R32.3 sobre la fila "Combate".** El port ya está hecho, en `src/features/battle/rules/`, y la clasificación fina —qué se reusó, qué se adaptó y qué se descartó, archivo por archivo— está en [`SHARED_BATTLE_RULES.md`](SHARED_BATTLE_RULES.md) §23. En resumen: se conservan las reglas aprobadas (Action Bar, prioridad, recarga, Protect, reloj propio del veneno, cambio, auto-repeat) y los límites de stage; se descartan la tabla de tipos escrita a mano y los 12 movimientos del prototipo, que reemplaza el Battle Catalog; y se descarta la **forma** de `battle.ts`, que muta lo que recibe y loguea strings, a favor de un reducer puro con eventos tipados. **El prototipo no se tocó y sigue funcionando igual**: la dependencia es `Dungeon → Shared Battle Rules` y nunca al revés.

---

## 3. T-S3 — Lenguaje visual de estaciones (congelado)

`FACT` Rama `art/station-visual-language` @ **`ee5f6924e3a59a8f70a19eb84b2d78a629b1a65b`**, 6 commits, base exacta `bfc0836`. **No mergeada**, congelada hasta R33.

| Pieza | Clase |
|---|---|
| `art/stationVisuals.ts` (contrato, paleta, 4 estados, medidas) | **A** |
| `art/furnaceStation.ts`, `campfireStation.ts`, `workbenchStation.ts` | **A** |
| `art/stationVisuals.test.ts` | **A** |
| `components/playground/StationVisualLab.vue` + ruta `/dev/estaciones` | **C** (dev-only) |
| `docs/economy/STATION_VISUAL_LANGUAGE.md` | **A** |

`FACT` **El límite se respetó:** sin Supabase, realtime, recetas, crafting, timers de gameplay, XP, inventario, `PlacedObject` ni hitbox productivo. La ruta usa el mismo patrón `import.meta.env.DEV` que `/dev/profesiones` y `/dev/dungeon`. El único `setInterval` es la animación del visor y se limpia al desmontar.

`PROPOSAL` En R33, la conexión correcta es: el arte aporta `width`/`height`/anclaje → se declara como `TapHitbox` del `PlacedObject` (F-1 ya lo acepta por objeto) → el `StationState` visual lo alimenta el **estado de proceso**, que todavía no existe.

---

## 4. I-1 — Semántica de captura: **CLOSED / APPROVED**

`APPROVED` (2026-09-18) Una captura exitosa crea una `PokemonInstance` real, pero mientras el jugador siga dentro de la Dungeon es **expedition loot** y no está asegurada.

| Salida | Qué pasa con lo capturado |
|---|---|
| **Retreat** voluntario | Asegurado: la instancia pasa a persistencia y propiedad del jugador |
| **Auto-extract** por expiración | Asegurado; mismo resultado que el retreat |
| **Wipe** | Se pierde: no se persiste como propiedad |
| **Pokémon preexistentes** | **Nunca** se pierden |

Esa es la tensión central del sistema: *capturo algo valioso → sigo arriesgando o me retiro para asegurarlo*.

Consecuencias que R32 debe respetar: la instancia se crea **en el servidor**, vive en el estado de expedición hasta la extracción, y solo ahí cruza el borde de persistencia. El aviso del prototipo («queda en el botín hasta que salgas») ya describe esta regla.

---

## 5. Battle Catalog — brecha y fuentes

`FACT` Hoy existen base stats de 493 especies (`professions/domain/catalog/speciesBaseStats.ts`), tipos en la tabla `pokemon` que ningún módulo interpreta, nombres y sprites. **No** existen: tabla de efectividad, movimientos, learnsets, abilities, catch rate, formas, naturalezas, IV/EV ni curva de experiencia. Detalle en `BATTLE_DATA_GAP_REPORT.md`.

`FACT` Fuentes verificadas el 2026-09-18 (solo lectura, nada importado):

| | **Pokémon Showdown** (`smogon/pokemon-showdown`) | **veekun/pokedex** | **PokéAPI** (`PokeAPI/pokeapi`) |
|---|---|---|---|
| Licencia | **MIT** | **MIT** | **BSD-3-Clause**, con aviso de marcas de Nintendo |
| Formato | TypeScript (`data/`, con `data/mods/gen6/`) | CSV + Python | CSV en `data/`, API REST/GraphQL pública |
| Cobertura Gen VI | Alta, pero `mods/gen6` son **diffs** (`inherit: true`) sobre el dato actual | Alta y **histórica por version-group** (`move_changelog`, learnsets por juego) | Alta, con `past_values` para cambios entre generaciones |
| Semántica de combate | La mejor: efectos, flags, prioridad, secundarios | Datos tabulares, sin semántica ejecutable | Datos tabulares |
| Extracción | Requiere resolver la cadena de mods con su propio `Dex.mod('gen6')` → acopla a su runtime | Directa: leer CSV y filtrar por generación | Directa desde CSV, o red si se usa la API |
| Mantenimiento | Muy activo; cambia seguido | Languideciendo (el README lo dice), pero Gen VI ya es histórico y estable | Activo |
| Riesgo de API externa | No aplica si se vendoriza | No aplica | **Alto** si se consume en runtime |
| Qué faltaría igual | Catch rate y algunos datos de especie están, pero mezclados con formatos competitivos | Efectos de movimiento como **texto**, no ejecutables | Ídem: describe efectos, no los implementa |

`PROPOSAL` **Recomendación: dos fuentes, una sola salida.**

1. **veekun/pokedex (MIT)** como fuente *tabular* y histórica: especies, formas, tipos, base stats, catch rate, naturalezas, learnsets por version-group de ORAS, potencia/precisión/PP/prioridad con los valores de Gen VI.
2. **Showdown `data/mods/gen6` (MIT)** como referencia *semántica* para implementar nuestros efectos: qué hace cada movimiento, flags y prioridades. Se lee como especificación; los efectos los escribimos nosotros en nuestro dominio, ya existente en `moves.ts`/`damage.ts`.
3. **PokéAPI**: descartada como dependencia de runtime; útil solo como verificación cruzada puntual.

`PROPOSAL` **Estrategia build-time, no runtime:** un script versionado toma las tablas, filtra a las especies que PokeSwap usa y emite un catálogo propio, inmutable y tipado, que se commitea como dato generado (con el commit exacto de la fuente y su licencia en la cabecera). El cliente lo carga como chunk aparte; el servidor lee el mismo archivo. Sin llamadas de red en juego.

`PROPOSAL` **Atribución y marcas:** el repo debe incluir las licencias MIT de las fuentes usadas y la nota de que Pokémon y sus nombres son marcas de Nintendo/Creatures/GAME FREAK. No se copia texto descriptivo (flavor text) ni assets oficiales.

`OPEN` La decisión final de fuente y licencia es del usuario. R32.1 no arranca sin esa aprobación.

---

## 6. `PokemonSpecies` / `PokemonInstance`

`FACT` Hoy, en el prototipo (`dungeonPrototype/domain/party.ts`): `PokemonSpecies` tiene id, nombre, tipos, base stats y catch rate; `PokemonInstance` tiene nivel, movimientos, HP, PP, estado y contadores de sueño/confusión.

`FACT` Faltan, y el modelo definitivo los necesita: `formId`, `nature`, `ivs`, `evs`, `abilityId`, PP por movimiento con PP-Ups, experiencia y curva, `originalTrainerId`/ownership, y el vínculo con la instancia persistida.

`FACT` Hay **dos vocabularios de Pokémon vivos** en el repo: el de profesiones (afinidades, `demoWorkers`) y el de combate (prototipo). Deben terminar apoyados en el mismo catálogo, sin fusionar sus reglas.

---

## 7. Authority split

| Capa | Responsabilidad |
|---|---|
| **Cliente** | Render, input, predicción de movimiento, animación de barras, HUD, selección de movimiento, UX |
| **Servidor** | Spawn y reloj de la dungeon; ciclo de la expedición; semilla de pisos; reserva de encuentro (`occupancy`); resolución de combate y RNG; resultado de captura; loot, llave y cofres; Alpha y botín personal; retreat; wipe; expiración; borde de persistencia |

`FACT` R30 ya dejó el molde: el cliente manda **intención** y el servidor deriva estado (`PresenceRoom`, `services/realtime`). `ExpeditionRoom` debe nacer con la misma forma. También dejó la lección del spawn: las posiciones se derivan del **mismo dato de área** en ambos lados, nunca de constantes copiadas a mano.

---

## 8. Dónde engancha la economía

Sin balancear nada todavía: consumibles (Poción, Revivir, Éter) como sink real; Poké Balls desde crafting; Minería, Tala y Alquimia como faucet de esos consumibles; Horno y Construcción como cadena de materiales; tienda NPC como red de seguridad; Centro Pokémon con cooldown como sustain externo; durabilidad de herramientas **solo** si se decide que la Dungeon las gasta. La Dungeon es el sink de demanda que faltaba para poder razonar la economía (`A-12`).

---

## 9. R32 — definición

**R32 = BATTLE + AUTHORITY FOUNDATIONS.** Ningún gameplay productivo nuevo. Al terminar R32 no se juega nada distinto; lo que cambia es que existe el catálogo, el modelo y la autoridad sobre los que R33+ se pueden construir sin rehacerlos.

| Subfase | Objetivo | Rama sugerida | Depende de | Riesgo | Qué NO entra |
|---|---|---|---|---|---|
| **R32.1 — Battle Catalog** | Fuente y licencia aprobadas, schema, pipeline build-time, catálogo de las especies que usamos | `feat/r32-1-battle-catalog` | Aprobación de fuente | Licencia y tamaño del dato | Formas exóticas, competitivo, efectos ejecutables |
| **R32.2 — Species / Instance** | Modelo definitivo compartido, con nature/IV/EV/ability/ownership | `feat/r32-2-pokemon-model` | R32.1 | Toca todo el combate | Persistencia real, UI |
| **R32.3 — Shared Battle Rules** | Portar el dominio puro del prototipo al catálogo y al modelo nuevos, como paquete compartido cliente/servidor | `feat/r32-3-shared-battle-rules` | R32.2 | Regresión de combate | Red, UI productiva, coop |
| **R32.4 — Authority Foundations** | `actionId`/idempotencia, reloj de servidor, RNG autoritativo, validación contra catálogo, esqueleto de `ExpeditionRoom` | `feat/r32-4-authority` | R32.3 | Alto: toca `services/realtime` | Gameplay productivo, loot, captura, persistencia |

**Revisión del orden propuesto: es correcto, con dos precisiones.**

1. **R32.3 debe nacer como paquete compartido**, no como código de cliente que después se "sube" al servidor. Si se porta primero al cliente, R32.4 lo reescribe.
2. **R32.4 termina con la sala vacía y probada**, sin expedición real. La tentación será meter loot "porque ya está la sala": eso es R35.

`PROPOSAL` Además, R32.1 debería incluir desde el primer día el **contrato de versionado** del catálogo (un `catalogVersion`), porque cliente y servidor tendrán que rechazar acciones de versiones distintas.

---

## 10. Roadmap posterior

| Fase | Contenido | Depende de |
|---|---|---|
| **R33 — Estaciones productivas** | T-S3 art + `PlacedObject` + estado de proceso. **Horno primero**: mineral → lingote jugable. Después Fogata y Banco | F-1, T-S3 |
| **R34 — Dungeon world + combate autoritativo** | Generación, área y props a producción; combate validado por servidor | R32.4, R33 opcional |
| **R35 — Expedition authority** | Loot, llave, captura (§4), retreat, wipe, expiración | R34 |
| **R36 — Persistencia** | Estructuras colocadas, inventario, progreso de profesión, instancias capturadas | R35 |
| **R37 — Co-op y Alpha** | Ready check, combates personales, Alpha cooperativo, botín personal | R35 |
| **R38 — Economía y balance inicial** | Primeros números con datos de playtest reales | R33, R36 |

`PROPOSAL` R33 antes que R34 a propósito: el Horno cierra la cadena de metal que R31 dejó sin faucet, es mucho más chico que la Dungeon y ejercita `PlacedObjects` con un segundo objeto real antes de que la Dungeon dependa de él.

---

## 11. Gates humanos

Uno al cierre de cada subfase y de cada release, con la regla del PRE-R32: una persona recorre y firma, y una `DIFERENCIA DETECTADA` bloquea el avance.

| Gate | Qué se firma |
|---|---|
| R32.1 | Los datos del catálogo son correctos para las especies que usamos, y la licencia está registrada |
| R32.2 | Una instancia real se describe completa y el combate del lab sigue igual |
| R32.3 | Un combate completo corre de punta a punta con el catálogo y el modelo nuevos, el replay determinista pasa y los huecos de movimientos son explícitos. **Precisión:** no se puede firmar "el mismo resultado que antes del port" — el prototipo peleaba con 12 movimientos a mano, una tabla de tipos propia y sin IV/EV/naturaleza, así que sus números no son comparables. Lo que se firma es que las **reglas aprobadas** siguen siendo las mismas (`SHARED_BATTLE_RULES.md` §23) |
| R32.4 | Ninguna de las validaciones depende del cliente; reenviar una acción no la cobra dos veces |
| R33 | `mineral → horno → lingote` recorrible sin atajos de playground |
| R34 | Un piso recorrible y un combate resuelto por el servidor |
| R35 | Retreat asegura, wipe pierde, expiración extrae |

---

## 12. Lo que **no** debe llegar a producción tal cual

- Los labs `/dev/dungeon`, `/dev/profesiones` y `/dev/estaciones`.
- Las fixtures de 14 especies y los `runFixtures`.
- El reloj del spawn en el cliente.
- Loot, llave, captura y recompensas decididos por el cliente.
- Los números de playtest: duración de 3 h, daño, catch rate, tablas de loot, tiempos de proceso.
- El HUD y los paneles del prototipo sin recablear.
- `src/features/dungeon/` legacy (retirar antes sus dos consumidores).
- Los atajos del playground de profesiones que regalan lingotes.

---

## 13. Preguntas abiertas que siguen bloqueando

| # | Pregunta | Bloquea |
|---|---|---|
| Q-1 | ¿Se aprueba la fuente recomendada (veekun tabular + Showdown gen6 como referencia semántica, ambas MIT, vendorizadas en build) y su atribución? | R32.1 |
| Q-2 | ¿Qué especies entran en el catálogo v1: solo las que usa el juego hoy, las 493 con base stats, o Gen I–VI completa? | R32.1 |
| Q-3 | ¿La Dungeon consume durabilidad de herramientas, o las herramientas quedan fuera del PvE? | R38, y antes el diseño de R35 |
| ~~Q-4~~ | ~~¿Se aprueba una sub-tarea de R32.1 para emitir `move_meta_stat_changes` en el catálogo?~~ **CERRADA (2026-09-18).** Aprobada y hecha: el pipeline suma la tabla de veekun y lee la semántica de `data/moves.ts` + `data/mods/gen6/moves.ts` de Showdown, cruzándolas. **109 de 122** movimientos con cambios de stats quedan resueltos; los ejecutables pasaron de 282 a **390 de 621**. `catalogVersion` nuevo: `1.oras.db4ae081bb58`. Detalle en `BATTLE_CATALOG.md` §6.1 y `SHARED_BATTLE_RULES.md` §14.1 | — |

Resueltas y cerradas: **I-1** (captura, §4) y la definición de R32 (§9). Las preguntas de reglas que abrió R32.3 (Protect, Struggle, flinch, envenenamiento grave, IA) están en `SHARED_BATTLE_RULES.md` §26.

---

## 14. Estado de R32

| Subfase | Rama | Estado |
|---|---|---|
| **R32.1 — Battle Catalog** | `feat/r32-1-battle-catalog` @ `a8984a7` | **HUMAN APPROVED**. Fuente aprobada: veekun tabular + overrides Gen VI de Pokémon Showdown. **Ampliado en R32.3 (Q-4)** con `meta.statChanges`: catálogo vigente `1.oras.db4ae081bb58` (era `1.oras.ab69b5804411`; sólo se agregó un campo, el resto del dato no cambió). Doc: `BATTLE_CATALOG.md` |
| **R32.2 — Species / Instance** | `feat/r32-2-pokemon-model` @ `7bf9af9` | Arquitectura **HUMAN APPROVED**. Modelo, fábrica pura, adaptador legacy, muestra `npm run pokemon:sample` |
| **R32.2.1 — Model decisions + legacy migration contract** | `feat/r32-2-1-model-decisions` @ `2738e43` | **HUMAN APPROVED**. Corte Identidad/Condition/Runtime, contrato de migración M-1 sobre identidad inmutable, canonicalización de movimientos legacy (A/B/C/D). Docs: `POKEMON_SPECIES_INSTANCE_MODEL.md` y `LEGACY_MOVE_AUDIT.md` |
| **R32.3 — Shared Battle Rules** | `feat/r32-3-shared-battle-rules`, desde `2738e43` | Entregada + microfase de correcciones, **pendiente de gate humano**. Motor puro y determinista en `src/features/battle/rules/`, compartible cliente/servidor: `reduceBattle(state, command, context)`, RNG como dato, Action Bar en ms, daño Gen VI, registry por `effectId`, **390/621 movimientos ejecutables** con los 231 diferidos explicados, etapas de stats **−2…+2** con clamp en la etapa, Protect que no se repone solo, 88 tests. Doc: `SHARED_BATTLE_RULES.md`. Muestra: `npm run battle:sample`. Checkpoint previo a la microfase: `7ef1c30` |
| **R32.4 — Persistencia / autoridad** | — | No arrancada |

Decisiones cerradas en R32.2.1 (detalle en el doc del modelo): migración legacy **M-1 hash determinista** sobre una **identidad inmutable que no incluye al dueño** (`slots.pokemon_id`), cardinalidad **un slot = un Pokémon** (`pokemon_xp` es progresión, no entidad) con propiedad tomada de `slots.owner_id`, IVs derivados 0–31, **EV 0** legacy, naturaleza derivada, habilidad **normal** únicamente, shiny sólo con evidencia inequívoca, `experience` persistida con curva L³ que **gana al `level` guardado**, movimientos legacy **canonicalizados** (español y alias históricos) en vez de reemplazados, major status **persiste** entre combates y pisos, confusion no, Mega sólo en runtime.

Q-1, Q-2 y Q-3 quedaron **cerradas** por el usuario al arrancar R32.1. Lo que R32.2 deja abierto para decisión humana está listado en `POKEMON_SPECIES_INSTANCE_MODEL.md` §18, y la estrategia de migración (§10 de ese doc) **no se aplica sin aprobación**.

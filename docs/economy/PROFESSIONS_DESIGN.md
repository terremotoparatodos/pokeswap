# R31 — Diseño de profesiones

> Estado: fundación R31. Hay diseño, contratos, fórmulas puras, tests y simulador. **No hay persistencia, UI, networking ni integración con el mapa.** Rama `feat/r31-professions-foundation`, sin merge.
> Documentos hermanos: [`POKEMON_PROFESSION_SYSTEM.md`](POKEMON_PROFESSION_SYSTEM.md), [`RESOURCE_ECONOMY.md`](RESOURCE_ECONOMY.md), [`ENERGY_DURABILITY.md`](ENERGY_DURABILITY.md), [`ECONOMY_LOOPS.md`](ECONOMY_LOOPS.md), [`R31_HANDOFF.md`](R31_HANDOFF.md).
> Convención: **FACT**, **INFERENCE**, **OPEN QUESTION** (`AGENTS.md` §1).

## 1. Hechos del repositorio que condicionan el diseño

| # | FACT | Consecuencia |
|---|---|---|
| F1 | `pokemon` (493 filas) tiene tipos, región, generación, legendario y `base_aura`. No tiene stats, peso, altura ni habilidades | La afinidad usa tipos + base stats del legado (`STATS_DB`, tag `v0-legacy-baseline`) |
| F2 | `slots` tiene PK `pokemon_id`: **una especie = un dueño global**. No hay `PokemonInstance`, naturaleza, IVs ni EVs | Los Pokémon de un jugador son escasos y únicos; swap/market pueden quitárselos |
| F3 | El nivel vive en `pokemon_xp(user_id, pokemon_id)` | Es la entrada de nivel de la afinidad |
| F4 | `slots.energy` es la energía de dungeon, con autoridad RPC | La energía de profesiones es un sistema separado |
| F5 | No hay tablas de ítems ni inventario; el Mercado solo vende Pokémon | Todo el catálogo es nuevo |
| F6 | `World` es determinista por semilla; los chunks son de 32×32 y la decoración sale de `hash2` | Los nodos se derivan de la semilla, sin sincronizar entidades |
| F7 | R30: el servicio Colyseus es autoridad de posición solo en Ciudad Corazón y Pradera Brisa; no escribe en Supabase y no tiene service-role | Recolectar con autoridad solo es posible en áreas compartidas y hace falta decidir cómo persiste el servidor (§8) |
| F8 | `AGENTS.md` §17 y el handoff de R30 exigen un desglose aprobado antes de crear tablas, RLS, RPCs o recompensas | R31 no crea nada de eso |

## 2. Arquitectura elegida

### 2.1 Tres capas

```text
Definición (catálogo en código, versionado)   → catalog/*.ts
Estado persistente (futuro, servidor)          → tipos *State / *Instance en types.ts
Runtime (una acción)                           → *Context / *Result + resolvers puros
```

### 2.2 Módulo

```text
src/features/professions/
  domain/
    types.ts                 Contratos de las tres capas
    catalog/
      professions.ts         4 profesiones + ENERGY_CONFIG + MAX_PROFESSION_LEVEL
      items.ts               54 ítems, drops PvE, sinks reservados
      nodes.ts               16 nodos de recolección
      tools.ts               12 herramientas, 4 estructuras, 6 consumibles
      recipes.ts             34 recetas
      affinityProfiles.ts    Pesos tipo/stat → rasgos, biomas hogar, 4 excepciones
      speciesBaseStats.ts    GENERADO desde el legado (493 especies)
    catalogValidation.ts     Faucets, sinks, referencias, tiers
    progression.ts           Curva XP, eficiencia por nivel
    energy.ts                Regeneración perezosa, costes, descanso, consumibles
    durability.ts            Desgaste, reparación, retiro
    affinity.ts              Pokémon → bonus por profesión
    gathering.ts             resolveGathering (una acción)
    processing.ts            resolveProcessing (refinado/crafting/alquimia)
    nodePlacement.ts         Nodos deterministas por casilla/chunk
    nodeDepletion.ts         Cargas personales en memoria
    inventory.ts             Aritmética inmutable de inventario
    rng.ts                   RNG sembrado para tests y simulador
  simulation/
    economyLedger.ts         Pool global con faucets/sinks y crafting recursivo
    economySim.ts            Simulador stock-flow sobre los resolvers reales
    scenarios.ts             Escenarios nombrados
    report.ts                Reporte de texto
  professionsIsolation.test.ts
scripts/
  simulate-economy.ts        CLI (npm run sim:economy)
  extract_legacy_base_stats.mjs
```

**Aislamiento (verificado por test):**
- Nada fuera del módulo lo importa.
- El módulo no usa Supabase, Colyseus, Vue, DOM, storage ni `Math.random`.
- Solo importa de otra feature `wildlands/engine/world` (tipos y terreno) y `wildlands/engine/noise` (hash). Ambos son puros.

### 2.3 Frontera de confianza

Los resolvers están pensados para ejecutarse **en el servidor**. El cliente solo envía intención ("recolectar en (tx, ty)") y muestra resultados. Todo lo que cambia inventario, XP, energía o durabilidad es persistente y económico: pertenece al servidor (`docs/TRUST_BOUNDARY.md` §1). El RNG se inyecta y en producción lo aporta el servidor (`AGENTS.md` §11).

```text
Cliente ──intención──▶ Autoridad (R32+)
                         1. identidad JWT, área compartida, posición adyacente (R30)
                         2. nodeAt(tx, ty) determinista
                         3. cargas personales (nodeDepletion)
                         4. energía regenerada (energy)
                         5. afinidad cacheada del Pokémon asignado (affinity), ownership revalidado
                         6. resolveGathering(context)
                         7. commit atómico: energía, XP, durabilidad, ítems (idempotente)
Cliente ◀──resultado──
```

## 3. Framework común

Una profesión es **solo datos**:

| Pieza | Dónde | Qué define |
|---|---|---|
| `ProfessionDefinition` | `catalog/professions.ts` | Nombre, herramienta, rasgos firma, hitos, especializaciones futuras |
| `GatheringNodeDefinition[]` | `catalog/nodes.ts` | Nivel, tier, energía, tiempo, XP, herramienta mínima, acceso, anclas, biomas, zona, cargas, respawn, drops |
| `RecipeDefinition[]` | `catalog/recipes.ts` | Nivel, entradas, salidas, tiempo, XP, estación |
| `ToolDefinition[]` | `catalog/tools.ts` | Tipo de herramienta × 3 tiers |
| `AffinityProfile` | `catalog/affinityProfiles.ts` | Cómo tipos y stats alimentan rasgos |

**Checklist para agregar una profesión** (ej. Cocina):
1. Agregar el id a `PROFESSION_IDS`.
2. Definir su `ProfessionDefinition`.
3. Crear sus nodos y/o recetas.
4. Crear su `AffinityProfile`.
5. Si usa herramienta nueva, agregar `ToolKind` y 3 tiers.
6. Correr los tests: `catalogValidation` falla si faltan faucets, sinks, recetas o tiers.

No se toca `gathering.ts`, `processing.ts`, `energy.ts` ni el simulador.

## 4. Profesiones iniciales

| Profesión | Herramienta | Nodos (nivel · tier) | Procesado principal | Rasgos firma |
|---|---|---|---|---|
| **Minería** | Pico | Afloramiento de piedra (1·T1), Veta de carbón (5·T1), Veta de hierro (15·T2), Cúmulo cristalino (20·T2, acceso `hardRock`), Veta de oro (30·T3) | Frascos, bloques, lingotes de hierro/oro/acero; picos, hachas y hoces | yield, energySaving, toolCare, detection |
| **Tala** | Hacha | Árbol común (1·T1), Pino (8·T1), Madera dura (15·T2), Pino boreal (30·T3) | Tablones, mangos, cañas; Fogata y Banco | speed, yield, critical |
| **Pesca** | Caña | Orilla (1·T1), Banco costero (15·T2), Arrecife (30·T3, acceso `deepWater`) | Aceite de pescado | rareFind, detection, quality |
| **Alquimia** | Hoz | Arbusto de bayas (1·T1), Parche de hierbas (5·T1), Arboleda silvestre (15·T2), Flor de escarcha (30·T3, acceso `frozenGround`) | Extractos, pociones, Revivir, Éter, Té de Vigor; Mesa | processing, quality, detection |

- Cada profesión recolecta **y** procesa dentro del mismo framework.
- Alquimia es la profesión de procesado por excelencia, y la única cuyos productos finales se destruyen al usarse.

## 5. Acciones

### 5.1 Recolección (`resolveGathering`)

Orden de validación (el primer fallo gana): `level_too_low` → `wrong_biome` → `access_required` → `tool_required` → `tool_broken` → `tool_tier_too_low` → `insufficient_energy`.

| Salida | Fórmula |
|---|---|
| Energía | `energyCost · max(0,6; (1 − energySaving)(1 − efNivel))` |
| Tiempo | `base · velHerramienta(o 1,5 a mano) · (1 − speed)(1 − efNivel)`, suelo 40 % |
| Unidades | `aleatorio[min,max]` + 1 con prob. `min(60 %, yield + herramienta + nivel + biomeMastery si es bioma hogar)`, ×2 si crítico |
| Secundarios | prob. fija; raros × `min(3, (1 + rareFind) · rareNivel)` |
| Calidad | cada unidad es "fina" con prob. `quality` (el efecto de la calidad queda para R33) |
| Desgaste | 1 (2 si el nodo supera el tier de la herramienta), cada punto evitable con prob. `toolCare` |
| XP | `xp nodo · (½ si sobrenivel ≥ 25) · (1,5 si hay descanso)` |

### 5.2 Procesado (`resolveProcessing`)

- **Sin coste de energía:** lo limitan los insumos.
- Valida cantidad (1–100), nivel e insumos.
- El rasgo `processing` (tope 30 %) acelera y puede ahorrar 1 unidad del primer insumo por craft.
- La estación pública tarda ×1,5; la propia aplica su bonus.
- La XP es menor por unidad de materia prima que en recolección. Así se evita subir de nivel comprando insumos sin límite.

## 6. XP y niveles

### 6.1 Rango y curva

- Niveles **1–60**. Los Pokémon ya usan 1–100; una escala más corta hace que cada nivel importe más.
- `XP total para nivel L = round(40 · (L − 1)^2,35)`.

| Nivel | XP total | Nivel | XP total |
|---|---|---|---|
| 5 | 1.040 | 30 | 109.319 |
| 10 | 6.991 | 40 | 219.312 |
| 15 | 19.745 | 50 | 374.991 |
| 20 | 40.470 | 60 | 580.179 |

### 6.2 XP por actividad

| Actividad | XP |
|---|---|
| Nodos T1 | 30–60 |
| Nodos T2 | 110–150 |
| Nodos T3 | 200 |
| Refinados | 5–45 por craft |
| Herramientas | 8–160 |
| Construcción | 20–90 |
| Descanso | +50 % de XP de recolección (no afecta recursos) |

### 6.3 Ritmo observado en el simulador

Escenario de 100 jugadores: 50 % casual, 35 % regular, 15 % hardcore.

- **7 días:** nivel medio 16–17, máximo 21.
- **30 días:** nivel medio 33, rango 27–41.
- **INFERENCE:** el nivel 60 queda a unos 3–4 meses para hardcore y más para casual. Hay que validarlo con escenarios de 90 días en R32.

### 6.4 Desbloqueos por nivel (derivados de los catálogos)

| Nivel | Minería | Tala | Pesca | Alquimia |
|---|---|---|---|---|
| 1 | Piedra, herramientas T1 | Árbol común, Tablón, Fogata, Caña Básica | Orilla | Bayas, Poción, Extracto |
| 5–8 | Carbón, Frasco (6) | Mango (5), Banco (5), Pino (8) | Aceite (5) | Hierbas (5), Té de Vigor (8) |
| 10–15 | Horno (10), Lingote de Hierro (12), Hierro + T2 (15) | Madera dura + T2 (15) | Banco costero + T2 (15) | Superpoción (12), Arboleda + T2 (15), Mesa (15) |
| 18–30 | Cúmulo (20, `hardRock`), Oro (28–30) | Pino boreal (30) | Arrecife (30, `deepWater`) | Éter (18), Revivir (25), Hiperpoción y Flor de escarcha (30) |
| 35 | Acero + herramientas T3 | Caña Maestra | — | — |
| 40–60 | Especializaciones y contenido compartido (reservado) | ídem | ídem | ídem |

### 6.5 Nuevos frente a veteranos

- **Día 1:** nodos T1 a mano o con la herramienta inicial. Los básicos T1 (piedra, troncos, bayas, pescado) son insumos masivos de recetas de todo nivel, así que el jugador nuevo vende algo que se demanda desde el principio.
- **Ventaja veterana:** `levelEfficiency` con tope en −18 % de tiempo, −15 % de energía, +12 % de yield y ×1,5 en rarezas. En un mismo nodo T1 eso da ≤ 1,32× unidades por punto de energía.
- **La ventaja real del veterano es el acceso:** T2/T3, recetas y herramientas de mejor tier. No se trata de volver inútil al jugador nuevo en contenido básico.
- **Sobrenivel:** con 25 o más niveles sobre el contenido, la XP se reduce a la mitad y los veteranos migran a otros nodos.

## 7. Especializaciones (futuras, no implementadas)

Se declaran como `SpecializationStub` (`status: 'future'`, desbloqueo en nivel 40):

| Profesión | Especializaciones |
|---|---|
| Minería | Prospector / Herrero |
| Tala | Guardabosques / Carpintero |
| Pesca | Pescador de altura |
| Alquimia | Boticario / Herbolario |

**OPEN QUESTION:** si serán mutuamente excluyentes y si se podrán cambiar. Recomendación: elegir una por profesión, con cambio de coste alto en materiales (otro sink).

## 8. Integración futura (R32+)

### 8.1 Dónde se ejecuta la autoridad

| Opción | Validación de posición | Secretos nuevos | Impacto en R30 | Riesgo |
|---|---|---|---|---|
| A. RPC Postgres llamada por el cliente | Imposible (la base no conoce la posición) | Ninguno | Ninguno | Teletransporte y bots sin detección de posición; solo topes de energía y cargas |
| B. Colyseus resuelve; persiste vía RPC con el JWT del usuario | Sí | Ninguno | Mensajes nuevos | **El cliente podría llamar la misma RPC directamente con su JWT e inventar resultados** |
| C. Colyseus resuelve; persiste vía Edge Function con secreto servidor-a-servidor | Sí | Secreto compartido Colyseus ↔ Edge Function | Mensajes nuevos, variable de entorno nueva | Gestión y rotación del secreto |
| D. Colyseus con rol Postgres dedicado de mínimo privilegio | Sí | Credencial de base en Colyseus | Mensajes nuevos, rompe "servicio sin credenciales" | Superficie mayor |

- **Recomendación:** C, con lotes (flush cada N segundos o al terminar la recolección), `batch_id` idempotente y validación de topes en la Edge Function.
- Cambia el principio de R30 de que el servicio no necesita secretos. **Requiere aprobación del equipo principal.** No se implementó.

### 8.2 Cambios de protocolo requeridos (documentados, no aplicados)

- **Problema:** `services/realtime/src/protocol/messages.js` solo acepta `move`, `area`, `observe` y `presence:ready`.
- **Cambio propuesto:**
  - intenciones `gather:start {tx, ty}` y `gather:stop`, validadas contra posición adyacente;
  - resultados privados `gather:result` enviados solo al jugador;
  - opcionalmente, un flag cosmético `activity` en `publicActor` para animar a otros jugadores. Es opcional: añade bytes a los deltas.
- **Alternativa:** un room separado `GatheringRoom`, que evita tocar `PresenceRoom`.
- **Impacto:**
  - solo Ciudad Corazón y Pradera Brisa tienen posición autoritativa, así que recolectar queda restringido ahí hasta ampliar áreas;
  - los mundos no compartidos no pueden tener recolección persistente.

### 8.3 Esquema propuesto (no creado; sin migraciones en R31)

```text
player_professions(user_id, profession, xp)                      PK (user_id, profession)
player_energy(user_id, current, rested, updated_at,
              consumable_restored_today, consumable_day)          PK user_id
inventory_items(user_id, item_id, quantity CHECK ≥ 0)             PK (user_id, item_id)
tool_instances(id, user_id, item_id, durability, max_durability, repairs)
gathering_batches(batch_id UNIQUE, user_id, created_at, payload_hash)   idempotencia
profession_party(user_id, profession, slot, pokemon_id)          pendiente de decisión (POKEMON_PROFESSION_SYSTEM §6)
```

RLS: el cliente solo tiene SELECT de sus filas; ningún INSERT, UPDATE ni DELETE. Toda escritura pasa por una función servidor (`TRUST_BOUNDARY.md` §7).

### 8.4 UI (fuera de scope)

- Panel de profesiones como feature propia bajo el Menú del lobby, sin engordar `WildlandsView.vue`.
- Nodos resaltados en el canvas según `detectionRadius`, siempre como presentación.

## 9. Fuera de R31

- Recolección dentro del mapa, animaciones, UI final y networking de recolección.
- Persistencia, migraciones, RLS, RPCs y Edge Functions.
- Comercio de ítems en el Mercado.
- Cambios en `PresenceRoom`, el protocolo R30, `game.ts` o `WildlandsView.vue`.

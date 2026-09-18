# PRE-R32 — Decisiones de diseño de producto

> Fecha: 2026-09-16. Surgieron durante el PRE-R32 HUMAN PROFESSION GATE (que **sigue abierto**).
> Registro de hallazgos del gate: [`PRE_R32_HUMAN_GATE.md`](PRE_R32_HUMAN_GATE.md). Estado operativo: [`R31_SESSION_HANDOFF.md`](R31_SESSION_HANDOFF.md).
> Base: `integration/r31` @ `c3349c6`.

**Qué es este documento:** la dirección de producto aprobada por el usuario y las preguntas abiertas.
**Qué no es:** una especificación, un plan de implementación, un balance ni un diseño de persistencia o autoridad. **No se implementa nada de lo que está acá** sin una orden explícita posterior y una descomposición según `AGENTS.md` §17.

---

## 0. Mapa macro de sistemas

No se balancea ningún sistema de forma aislada. La cadena de valor es:

```text
Pokémon
  └─ Party activo de 6
       └─ Combate + Workers
            └─ Profesiones
                 └─ Recursos
                      └─ Procesamiento
                           └─ Crafting
                                └─ Construcción
                                     └─ Estructuras / servicios
                                          └─ Economía multiplayer
```

En paralelo, la demanda:

```text
Dungeon / Bosses
  └─ Desgaste (HP, PP, faint)
       └─ Demanda de consumibles
            └─ Alquimia / comercio / Centros Pokémon
```

El valor de pociones, Revivir, Éter, curación y Centro Pokémon **depende del loop de PvE**. Por eso la economía no se cierra antes de definirlo (A-12).

---

# APPROVED

Decisiones tomadas. Se reabren solo con un motivo nuevo.

## A-1 · Party activo de hasta 6 Pokémon

- El jugador tiene un **equipo activo de hasta 6 Pokémon**.
- Ese mismo equipo cuenta para exploración, combate, dungeon, profesiones y workers.
- En profesiones rige `worker ∈ activeParty`: el worker elegido debe pertenecer al party activo.
- Inicialmente, **1 worker por acción**. No se diseñan workers simultáneos.
- **Restricción para R32-0:** la persistencia y la autoridad definitivas deben contemplar el party activo. El servidor valida que el worker de una acción pertenezca al party del jugador en ese momento.

**Estado actual:** los workers de profesiones son fixtures demo (`demo/demoWorkers.ts`) sin relación con un party. No existe party activo en el cliente de WildLands.

## A-2 · Cinco atributos laborales visibles

Reemplazan a los ocho conceptos visibles actuales: Extracción, Prospección, Conservación, Eficiencia, Velocidad, Hábitat, Calidad y Procesado (`ui/capabilities.ts`).

| Atributo | Significado |
|---|---|
| **Potencia** | Capacidad de extracción/recolección; fuerza aplicada al trabajo |
| **Hallazgo** | Probabilidad de recursos raros, mejores drops o descubrimientos |
| **Eficiencia** | Ahorro de lo consumido: energía, herramienta, combustible, ingredientes |
| **Rapidez** | Tiempo de acciones y procesos |
| **Técnica** | Calidad del crafting/procesamiento y posibilidad de resultados especiales |

- **Hábitat deja de ser un atributo numérico visible.** Pasa a ser una **afinidad contextual** con el entorno o bioma: nieve, bosque, humedal, costa, volcánico, montaña, etc.
- **Sin fórmulas ni valores** todavía (O-2).

**Correspondencia orientativa con los traits de dominio actuales** (a validar al diseñar):

| Atributo nuevo | Traits actuales que absorbería |
|---|---|
| Potencia | `yield`, `critical` |
| Hallazgo | `rareFind`, `detection` |
| Eficiencia | `energySaving`, `toolCare` |
| Rapidez | `speed` |
| Técnica | `quality`, `processing` |
| Hábitat (afinidad contextual) | `biomeMastery` |

## A-3 · Afinidades por tipo Pokémon

- El rendimiento laboral sale de `tipo(s) + stats relevantes + nivel + especie/ability + herramienta`.
- Los tipos **aportan afinidades**. No vale `tipo X = solo profesión Y`.
- Ejemplos conceptuales, no definitivos:

| Tipo | Afinidad |
|---|---|
| Roca / Tierra / Acero | Minería |
| Lucha | Fuerza física, gathering pesado |
| Planta / Bicho | Tala / Forage |
| Agua | Pesca |
| Fuego | Fundición / Horno |
| Veneno | Alquimia / ingredientes |
| Psíquico | Procesamiento / precisión |
| Hielo | Recursos de biomas fríos |
| Volador | Scouting / exploración |

- **Doble tipo:**
  - combina afinidades, con **caps o rendimientos decrecientes**: no suma el 100 % de ambos bonus;
  - admite **sinergias especiales** futuras por combinación (ejemplo conceptual: Fuego + Roca con muy buena afinidad para Fundición);
  - stats, nivel y especie siguen importando: un doble tipo no es automáticamente superior.
- La tabla de los 18 tipos queda **sin definir** (O-3).

## A-4 · Pesca por encuentro Pokémon

- **Se elimina** el concepto genérico de obtener "pescados". Hoy existen los items `fish` y `quality_fish`, y se consumen, por ejemplo, en `fish_oil`.
- Loop nuevo: `cast → espera → encuentro Pokémon → forcejeo → recompensa de objetos`.
- El Pokémon **no se captura**: representa el encuentro y el forcejeo; después se otorgan recursos o items.
- Primera distribución **visual de prototipo** (no es balance ni RNG autoritativo):

| Pokémon | Probabilidad |
|---|---|
| Magikarp | 85 % |
| Slowpoke | 14 % |
| Shellder | 1 % |

- A futuro podrán modificar la distribución: profundidad (A-5), bioma, nivel de Pesca, herramienta, worker, afinidades y eventos.

## A-5 · Fishing spots por profundidad

- Tres categorías mínimas, con al menos un spot representativo de cada una:
  - **Orilla:** pegado a la costa.
  - **Agua baja:** algo más adentrado.
  - **Agua profunda:** en la zona de agua oscura.
- La profundidad será un **dato real del spot**, no solo una posición visual.
- Podrá influir en Pokémon encontrados, recursos, rarezas, dificultad y requisitos.
- La distribución visual actual (`art/fishingSpots.ts`) **no es correcta** (hallazgo G-3).

## A-6 · Descubrimiento de items

- **Primera obtención** de un item o recurso: cartel o notificación destacada que explica qué se consiguió.
- **Siguientes obtenciones:** sin interrupción, solo con el popup en el mundo (item, cantidad, XP).
- El descubrimiento es **por item/recurso**.
- Conceptualmente habrá que persistir `discoveredItems`. **La persistencia no se diseña todavía.**

## A-7 · Horno de fundición como sistema real

- Deja de ser tentativo. Cadena mínima: `Mineral bruto → Horno → Lingote`.
- Hace falta un **faucet jugable real** de lingotes. Hoy solo existe `smelt_iron` en el banco del playground dev, sin horno real (G-6).
- Los lingotes alimentarán crafting, herramientas, reparaciones, construcción y la economía entre jugadores.
- Los Pokémon **Fuego** tendrán afinidad con Fundición. Eso **no crea** una profesión Fundición: el refinado sigue dentro de Minería.

## A-8 · Estaciones de crafteo con lenguaje visual común

- Mesa de Alquimia, Horno, Fogata y Banco de Trabajo necesitan sprites y representación consistentes.
- Deben leerse claramente como **ESTACIONES INTERACTIVAS**, no como decoración.
- Pendiente de **arte y de sistema**: colocación en áreas y solidez, que conecta con F-1 / `ObstacleProvider`.

## A-9 · Construcción como profesión independiente

- **Tala no se convierte en Construcción.** Tala sigue siendo gathering.
- **Construcción** es una profesión nueva e independiente.
- Cadena: `Tala + Minería + procesamiento → materiales → Construcción`.
- Es un **sink importante** de recursos.
- Estructuras futuras de ejemplo: fogata, cofres/almacenamiento, banco de trabajo, horno, casa, taller, tienda, Centro Pokémon, edificios comunitarios, estructuras avanzadas/reclamables.
- Las estructuras podrán tener dueño, nivel, upgrades, mantenimiento, stock, permisos, uso público o privado, tarifas e ingresos.
- **Persistencia y autoridad de edificios no se diseñan todavía.**

**Estado actual:** el catálogo ya define 4 estructuras con mantenimiento y efectos (`domain/catalog/tools.ts`, `STRUCTURES`). No hay profesión Construcción: `PROFESSION_IDS` es Minería, Tala, Pesca y Alquimia.

## A-10 · Casas, tiendas y Centros Pokémon (dirección)

| Estructura | Dirección |
|---|---|
| Casa | Punto personal, de regreso y de utilidad del jugador |
| Tienda | Participa en la economía entre jugadores |
| Centro Pokémon | Puede ser un servicio comunitario |

Conceptos a explorar más adelante: abastecimiento, consumibles, coste de uso, ingresos del propietario, cooldown, mantenimiento. **Sin economía fijada.**

## A-11 · Pantalla de Profesiones / Skills

- Inspirada conceptualmente en MMORPGs como RuneScape, con **UI propia**.
- Profesiones previstas: **Minería, Tala, Pesca, Alquimia, Construcción**. Forage sigue siendo recolección dentro de Alquimia (R31-C4.1).
- Cada profesión muestra:
  - nivel, XP actual, XP al siguiente nivel y barra de progreso;
  - próximos desbloqueos;
  - recursos y nodos disponibles;
  - herramientas, recetas y procesos;
  - worker e información propia de la profesión.
- Objetivo: que el jugador entienda **qué desbloqueó** y **qué desbloquea después**.

**Auditoría del estado actual** (2026-09-16, solo lectura):
- **No existe menú ni progreso de profesiones en producción.**
  - La única ruta es `/dev/profesiones`, registrada solo con `import.meta.env.DEV` (`src/app/router/routes.ts:31`).
  - El demo de profesiones en el mundo (`ProfessionWorldDemo`) se carga solo en dev (`WildlandsView.vue:103`).
  - No hay tablas ni persistencia de profesiones en Supabase.
- En el playground dev existe la pestaña **Progresión** (`ProfessionProgress.vue` + `ui/progressionView.ts`). Por cada una de las 4 profesiones muestra nivel/XP, un bloque "Próximo" con los siguientes desbloqueos y "Ya desbloqueado", todo derivado del catálogo. Es la base conceptual más cercana a A-11, pero es dev-only, con estado demo en memoria y sin Construcción.
- La XP y el nivel viven en la sesión demo (`demo/demoSession.ts`, `state.xp`), sin persistencia.

## A-12 · Economía: no balancear todavía

- No se cierran números de: energía, yields, XP, niveles, durabilidad, respawns, stacks, pending cap, herramientas, reparación, combustible, lingotes, crafting, Centro Pokémon y consumibles.
- **Motivo:** primero hay que definir el loop definitivo de PvE/Dungeon para medir el valor real de pociones, Revivir, Éter, curación y Centro Pokémon.
- Siguen vigentes decisiones previas (`R31Z_CONSOLIDATION_PLAN.md` §10):
  - el pending cap debe **existir** en producción, aunque su número es balance;
  - la hoz opcional queda sin cambios.

## A-13 · Dungeon legacy descartada

- **Todo el sistema de Dungeon anterior** (`src/features/dungeon/`, con sus APIs y tablas) queda **LEGACY** y **descartado como base**.
- No se rescata su arquitectura, no se migra, no se adapta, no se balancea sobre él y no se mantiene compatibilidad conceptual.
- Puede quedar físicamente en el repo mientras tenga consumidores. **No se borra ni se audita en profundidad para reutilizarlo.**
- **No condiciona WildLands.**

## A-14 · WILDLANDS DUNGEON / PVE — CLEAN-SLATE DESIGN, a cargo de la estación secundaria

- El sistema nuevo se diseña **desde cero**.
- El diseño y prototipo inicial se **delegará a la ESTACIÓN SECUNDARIA** (otra PC; GitHub es la única frontera). Alcance: dungeon loop, expediciones, encuentros, desgaste, minibosses, bosses, combate PvE, presión de consumibles, rewards y posible simulación.
- La secundaria **no modifica ramas productivas ni integra**.
- La **estación principal** conserva: arquitectura, integración, server/authority, networking, persistencia, Supabase, trust boundary, CI y revisión final. Cuando llegue la propuesta, audita compatibilidad, arquitectura, server authority, persistencia, anti-cheat e integración.
- **Estado (2026-09-17):** la estación secundaria entregó el prototipo D1 → D1.2.4ter (`feat/d1-2-4-obstacles-combat` @ `ef4ff85`), integrado en `integration/r31` como `src/features/dungeonPrototype/` (dev-only, sin autoridad ni persistencia). Ver [`../wildlands/DUNGEON_PROTOTYPE_INTEGRATION.md`](../wildlands/DUNGEON_PROTOTYPE_INTEGRATION.md), que incluye el conflicto abierto sobre la semántica de "captura" (I-1). El usuario prepara aparte el brief definitivo.

## A-15 · Principios conocidos de combate / dungeon

- Party activo de máximo 6 (A-1).
- Durante las expediciones importan **HP**, **PP** y **faint**.
- Pociones, Revivir y Éter tienen **valor real**.
- Los **bosses** son parte importante del PvE.
- Las dungeons **generan demanda económica**.
- Los **rewards son server-authoritative**: el cliente nunca decide rewards.

**No fijados:** cantidad de encuentros, daño, cooldowns, precios, valores de curación, dificultad, loot tables.

---

# OPEN

Decisiones pendientes de diseño. Ninguna bloquea el cierre del gate; todas bloquean su implementación.

| ID | Pregunta abierta | Relación |
|---|---|---|
| O-1 | Modelo de datos y persistencia del party activo: cambios de party durante una acción, worker ocupado vs. disponible para combate | A-1, R32-0 |
| O-2 | Fórmulas y valores de los 5 atributos, cómo se derivan de tipo, stats, nivel, especie, ability y herramienta, y migración de los traits actuales | A-2, A-3 |
| O-3 | Tabla de afinidades de los 18 tipos, regla de combinación y caps de doble tipo, sinergias especiales | A-3 |
| O-4 | Taxonomía de hábitats/biomas contextuales y cómo modifican el trabajo | A-2 |
| O-5 | Pesca: tablas de recompensa por Pokémon; mecánica del forcejeo y su encaje con espera/pique/recogida; qué reemplaza a `fish`/`quality_fish` en recetas; sprites de encuentros | A-4 |
| O-6 | Pesca: cómo se representa la profundidad en los datos del mundo (tile, zona o spot), cómo se detecta y qué requisitos impone | A-5 |
| O-7 | Descubrimiento: varios items nuevos en una acción; relación con la card de resultado; dónde persiste `discoveredItems` | A-6 |
| O-8 | Horno: combustible, tiempos, colocación (público vs. propio), relación entre nivel de fundición y nivel de minado (hoy fundir hierro pide Nv. 12 y minarlo Nv. 15), lingotes regalados por el playground | A-7 |
| O-9 | Estaciones: lenguaje visual, colocación como dato del área, solidez (F-1) | A-8 |
| O-10 | Construcción: progresión, recetas de estructuras, colocación, ownership, permisos, mantenimiento, upgrades, tarifas; persistencia y autoridad | A-9, A-10, R32-0 |
| O-11 | Casa / Tienda / Centro Pokémon: economía de uso, ingresos, abastecimiento, cooldowns | A-10, A-12 |
| O-12 | Pantalla de Profesiones: layout, navegación, qué muestra por profesión | A-11 |
| O-13 | Balance económico completo, después del loop PvE | A-12, A-15 |
| O-14 | Diseño completo de Dungeon/PvE (estación secundaria) y su auditoría de integración (principal) | A-14, A-15 |
| O-15 | Cúmulo cristalino: separar el pickup demo de R24 del nodo de profesión, y si la demo de cristales sigue existiendo | G-1 |

---

## Fuera de alcance explícito (hasta orden posterior)

No se implementa nada de lo siguiente:
- **Decisiones nuevas:** party de 6, atributos, afinidades por tipo, doble tipo, Construcción, menú de profesiones, horno, sprites, rediseño y profundidad de pesca, descubrimiento de items, fix del cúmulo cristalino, Dungeon, combate, bosses, balance.
- **Temas ya pendientes:** node index, F-1, F-2, F-3, authoritative spawn, R32 y merge a `main`.

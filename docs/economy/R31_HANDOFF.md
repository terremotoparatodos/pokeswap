# R31 — Handoff: Profession & Resource Economy Foundation

> Para cualquier instancia (Claude, ChatGPT o persona) que no vio la sesión R31. Leer completo antes de tocar código.
> Estado: **cerrada como fundación de diseño + contratos + simulador**. Rama `feat/r31-professions-foundation`, **sin merge** a `main`, `migration` ni `feat/wildlands-prototype`.

## 1. Contexto y base

| Dato | Valor |
|---|---|
| Repositorio | `terremotoparatodos/PokeSwap` |
| Rama R31 | `feat/r31-professions-foundation` |
| Punto de partida | `7e474c6` (HEAD de `main`: merge PR #21, cuyo último commit de R30 es `bf44f41`; sin diferencias de árbol entre ambos) |
| Estación | Paralela; la principal sigue con la beta/operación de R30 |
| Reglas aplicadas | `AGENTS.md` (§2, §8, §10, §11, §17, §18), `docs/INVARIANTS.md`, `docs/TRUST_BOUNDARY.md`, handoff de R30 (§ "Dirección acordada": diseño y prototipos sin persistencia) |

## 2. Qué se hizo

1. **Inspección** del repo, el modelo de datos, R30, el mundo y la economía existente. Hallazgos clave en §5.
2. **Arquitectura data-driven** de profesiones en un módulo aislado `src/features/professions/`:
   - contratos en tres capas (definición, estado, runtime);
   - catálogo inicial: 4 profesiones, 54 ítems, 16 nodos, 12 herramientas, 34 recetas, 4 estructuras, 6 consumibles.
3. **Fórmulas puras y testeadas:**
   - curva de XP 1–60 y eficiencia por nivel;
   - energía de jugador con regeneración perezosa, descanso y tope diario de consumibles;
   - durabilidad reparable con vida finita;
   - afinidad Pokémon por tipos + base stats + nivel, con presupuesto compartido.
4. **Resolvers pensados para servidor:**
   - `resolveGathering`, `resolveProcessing`;
   - nodos deterministas por semilla anclados a la decoración existente de WildLands;
   - cargas personales por nodo.
5. **Simulador económico** stock-flow que usa el resolver real: `npm run sim:economy`.
6. **Documentación** en `docs/economy/` y este handoff.
7. **Rebalanceo guiado por el simulador:**
   - la primera versión generaba ~70 unidades por cada unidad destruida;
   - se subieron energía, tiempo y XP por acción, se bajó la durabilidad y se encarecieron reparaciones y herramientas;
   - queda ~14:1 en 7 días. Sigue siendo sobreoferta y está documentada con sus palancas.

**No se hizo** (fuera de scope por pedido y por `AGENTS.md` §17):
- recolección en el mapa, UI, animaciones y networking de recolección;
- persistencia, migraciones, RLS, RPCs y Edge Functions;
- cambios en R30 (protocolo, `PresenceRoom`, `game.ts`, `WildlandsView.vue`);
- implementación de la party de profesión;
- merge, cherry-pick y rebase.

## 3. Archivos

### 3.1 Creados

```text
docs/economy/PROFESSIONS_DESIGN.md          Arquitectura, framework, profesiones, acciones, XP, integración futura
docs/economy/POKEMON_PROFESSION_SYSTEM.md   Datos reales, fórmula de afinidad, nichos, party, excepciones, escalado
docs/economy/RESOURCE_ECONOMY.md            Taxonomía, faucets, sinks, dependencias, hallazgos del simulador
docs/economy/ENERGY_DURABILITY.md           Energía, herramientas, durabilidad, reparación, estructuras
docs/economy/ECONOMY_LOOPS.md               Loops completos con diagramas mermaid y evidencia
docs/economy/R31_HANDOFF.md                 Este documento

scripts/extract_legacy_base_stats.mjs       Regenera speciesBaseStats.ts desde el tag v0-legacy-baseline
scripts/simulate-economy.ts                 CLI del simulador

src/features/professions/
  professionsIsolation.test.ts
  domain/types.ts
  domain/catalog/{professions,items,nodes,tools,recipes,affinityProfiles,speciesBaseStats}.ts
  domain/catalogValidation.ts
  domain/{progression,energy,durability,affinity,gathering,processing,nodePlacement,nodeDepletion,inventory,rng}.ts
  domain/{catalog,progression,energy,durability,affinity,gathering,nodes}.test.ts
  simulation/{economyLedger,economySim,scenarios,report}.ts
  simulation/economySim.test.ts
```

### 3.2 Modificados

| Archivo | Cambio | Motivo |
|---|---|---|
| `package.json` | Script `"sim:economy": "vite-node scripts/simulate-economy.ts --"` | Correr el simulador. `vite-node` ya viene instalado como dependencia de `vitest@3`; **no se agregaron dependencias** |

No se modificó ningún archivo de R30, de Supabase, del servicio realtime ni de otras features.

## 4. Arquitectura elegida (resumen)

```text
Definición (catalog/*.ts)  →  Resolvers puros (domain/*.ts)  →  Autoridad servidor (R32+)  →  Commit atómico
                                   ↑                                    ↑
                         RNG inyectado, now inyectado          posición R30, ownership, JWT
```

- **Una profesión es solo datos:** definición, nodos, recetas, 3 tiers de herramienta y perfil de afinidad. Agregar una no toca resolvers. `catalogValidation` falla si faltan faucets, sinks, recetas o tiers.
- **Aislamiento verificado por test:**
  - nada del app importa el módulo;
  - el módulo no usa Supabase, Colyseus, Vue, DOM, storage ni `Math.random`;
  - de otras features solo importa `wildlands/engine/world` y `wildlands/engine/noise` (puros).
- **Diagramas y detalle:** [`PROFESSIONS_DESIGN.md`](PROFESSIONS_DESIGN.md) §2.

## 5. Decisiones

| # | Decisión | Por qué | Alternativas descartadas |
|---|---|---|---|
| D1 | Afinidad por **tipos + base stats + nivel** con presupuesto compartido entre rasgos, topes y +10 % máx. por suma de stats | **FACT:** no existen naturaleza, IVs, EVs, habilidad, peso ni altura. Presupuesto compartido = sin especie óptima | Tabla manual por especie; bonus aditivos sin presupuesto (el legendario domina) |
| D2 | Base stats desde el legado (`STATS_DB`, 493 especies) a un catálogo generado | Única fuente verificada; la tabla `pokemon` no tiene stats | Inventar stats; bajar datos externos (licencia, verificación) |
| D3 | Energía **de jugador**, separada de `slots.energy` | `slots.energy` es de dungeon y viaja con el Pokémon en swap/market | Energía por Pokémon; sin energía |
| D4 | Descanso da **solo XP** | Premia ausencia sin crear recursos | Descanso que da yield |
| D5 | Herramienta rota **reparable con vida finita** (−8 % máx. por reparación, retiro < 50 %) | Nada se pierde de golpe y la demanda de materiales es sostenida | Desaparece a 0; reparable infinita |
| D6 | Nodos **derivados de la semilla** y anclados a decoración existente; **cargas personales** por nodo | Cero sincronización de entidades; sin camping ni "robo" de nodos | Nodos persistidos; nodos compartidos con agotamiento global; nodos 100 % personales instanciados |
| D7 | Procesado **sin energía** | Lo limita el insumo, que ya es el sink | Energía también en crafting |
| D8 | Niveles **1–60**, curva `40·(L−1)^2,35`, XP ½ con sobrenivel ≥ 25 | Cada nivel importa; veteranos migran y los básicos quedan para jugadores nuevos | Tabla de OSRS 1–99 |
| D9 | Recolección T1 **a mano** permitida | Participación inmediata del jugador nuevo | Herramienta obligatoria |
| D10 | Party: **recomendada** líder + asistentes (niveles 20/40), **no implementada** | Pedido explícito; ver [`POKEMON_PROFESSION_SYSTEM.md`](POKEMON_PROFESSION_SYSTEM.md) §6 | 1 activo; party de 6; fatiga individual |
| D11 | Sin venta de recursos a NPC por tokens | Sería faucet de tokens atado a energía, con SEC-02 aún abierto | NPC buyback |
| D12 | Sinks reservados explícitos (Bonguri, Reliquia de Jefe) | Mejor que inventar sinks arbitrarios | Destruir ítems sin gameplay |

## 6. Resultados del simulador (semilla 31)

| Escenario | Generado | Destruido | Stock final | Demanda insatisfecha | Nota |
|---|---|---|---|---|---|
| `base` 100 jug. · 7 d | 77.664 | 5.540 | 60.658 | 771 | 100 % de la energía gastada; nivel medio ~16–17 |
| `month-100` 30 d | 293.536 | 19.933 | 218.648 | 3.611 | Nivel medio 33; se agota la Baya Aranja |
| `no-pokemon` 7 d | 68.734 | 5.612 | 52.100 | 870 | Los Pokémon suman ~13 % de producción |
| `veterans` nivel 40 · T3 | 61.097 | 1.143 | 56.311 | 3.594 | Sin jugadores nuevos faltan básicos (2.100 Pociones) |
| `mining-only` | 81.046 | 1.722 | 79.398 | 4.925 | Sin Tala: 0 herramientas, 29.393 acciones a mano |

## 7. Verificación ejecutada

| Check | Resultado |
|---|---|
| `npx vitest run` (suite completa) | 66 archivos, 460 tests, todo verde (R31 aporta 9 archivos y 73 tests) |
| `npx eslint .` | 0 errores; las 9 advertencias son previas (`vue/attributes-order` en `AuthModal`) |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | OK (incluye todo `src/features/professions`) |
| `npm run typecheck` | OK; como ya advertía `docs/wildlands/HANDOFF.md`, no chequea nada sin `-b` |
| `npm run build` | OK; el módulo no entra en el bundle porque nada lo importa |
| `npm run sim:economy -- --scenario …` | OK en los 5 escenarios |
| Escaneo de secretos (service_role, JWT, tokens GitHub, contraseñas, URLs de base, id del proyecto) | Sin coincidencias en archivos nuevos y modificados; no hay `.env` en el working tree |
| `git status` antes de cada commit | Solo archivos R31 |

**Nota del entorno de esta estación:**
- El workspace de la app de escritorio de Claude en Windows está virtualizado: `AppData\Roaming\Claude` → `AppData\Local\Packages\Claude_…\LocalCache\Roaming\Claude`.
- Vitest, vite-node y el build fallan si se corren desde la ruta visible, y funcionan desde la ruta real.
- Es un problema del entorno, no del repo. Local tenía Node 18.14; CI usa Node 22.

## 8. Riesgos y deuda técnica

| # | Riesgo / deuda | Impacto | Mitigación propuesta |
|---|---|---|---|
| R1 | **Sobreoferta de T1** (troncos, pescado, carbón, hierbas) | Colapso de precios de básicos | Sinks con gameplay: housing, cocina/Poffins, más estructuras. Ver `RESOURCE_ECONOMY.md` §9 |
| R2 | Oro y Fragmento Evolutivo sin sink proporcional en T3 | Acumulación en veteranos | Estructuras/mejoras T3 antes de habilitar T3 |
| R3 | Revivir con cuello de botella (Hierba Revivir rara) | Demanda insatisfecha en PvE | Ajustar drop o sumar fuente PvE |
| R4 | **Autoridad de persistencia sin decidir.** R30 no tiene credenciales de escritura y una RPC con JWT de usuario es falsificable | Bloquea R32 | Decisión del equipo; recomendación en `PROFESSIONS_DESIGN.md` §8.1 (opción C) |
| R5 | Solo Ciudad y Pradera tienen posición autoritativa | Recolección persistente limitada a esas áreas | Empezar en Pradera; ampliar áreas compartidas después |
| R6 | Stats en código, no en base | Doble fuente si la base los agrega sin sincronizar | Migración aditiva `pokemon_base_stats` en fase aprobada; regenerar desde ahí |
| R7 | Alias de tipos duplicados entre `affinity.ts` y `wildlands/engine/population.ts` | Drift | Test de equivalencia; extraer a `pokemon/domain` cuando se toque población |
| R8 | El simulador asume mercado perfecto, crafteadores siempre disponibles y demanda PvE parametrizada | Números optimistas en fluidez | Tomar tendencias, no valores; agregar fricción de mercado en R33 |
| R9 | `nodeAt` llama a `decorAt` (fbm) por casilla; no se midió el coste en el servidor | CPU de Colyseus | Solo validar la casilla objetivo (O(1)); cachear por chunk si hace falta |
| R10 | `vite-node` es dependencia transitiva de `vitest` | El script se rompe si cambia la versión de vitest | Declararlo como devDependency si R32 adopta el simulador en CI |
| R11 | Mercado de ítems inexistente | Las dependencias entre profesiones requieren comercio | Feature separada con atomicidad propia |
| R12 | `quality` produce "unidades finas" sin efecto aún | Rasgo con poco valor | Definir efecto (durabilidad +, potencia +) en R33 |

## 9. Preguntas para el equipo principal

1. **Autoridad:** ¿se acepta que el servicio realtime tenga un secreto servidor-a-servidor (opción C) o se prefiere otra vía? (R4)
2. **Party:** ¿se aprueba líder + asistentes (niveles 20/40, peso 0,5)? ¿El líder por defecto es el acompañante de R27?
3. **Centro Pokémon:** ¿qué cooldown/restricción tendrá? Define la demanda de Alquimia.
4. **Energía:** ¿es aceptable la brecha 2,4× casual/hardcore? ¿La sesión T3 (~20 acciones por barra) es demasiado corta?
5. **Primera profesión productiva:** ¿Minería (la más conectada) o Alquimia (la más ligada al PvE existente)?
6. **Mercado de ítems:** ¿entra en el roadmap antes o después de la primera profesión persistente? ¿Comisión en tokens?
7. **Stats en base:** ¿se aprueba una migración aditiva de base stats?
8. **Especializaciones:** ¿excluyentes y cambiables con coste?
9. **Sinks de volumen:** ¿housing, cocina/Poffins o ambos para R33?
10. **Poké Balls con Bonguri:** toca captura y ownership. ¿Está en el roadmap?

## 10. Commits R31

| Hash | Mensaje |
|---|---|
| `bffebf6` | feat(professions): add economy domain contracts and catalog |
| `6b1b58e` | feat(professions): add progression, energy, durability and affinity formulas |
| `d7b4ada` | feat(professions): add gathering, processing and node resolvers |
| `8f02e01` | feat(professions): add economy simulation prototype |
| `de9402f` | docs(economy): define profession architecture and Pokemon affinity |
| `ed587ac` | docs(economy): document resources, energy, durability and loops |
| *(este documento)* | docs(economy): add R31 handoff — su hash se ve con `git log -1 feat/r31-professions-foundation` |

## 11. Recomendación para R32

**R32 — Minería persistente mínima en Pradera Brisa (una sola responsabilidad).** Antes de escribir código, producir el desglose de `AGENTS.md` §17: entry points, escrituras, invariantes, fallos e idempotencia.

1. **Decidir** R4 (autoridad) y la pregunta 2 (party; puede empezar con 1 líder).
2. **Migración aditiva y no destructiva:**
   - tablas `player_professions`, `player_energy`, `inventory_items`, `tool_instances`, `gathering_batches`;
   - RLS de solo SELECT propio;
   - escritura únicamente vía función servidor.
3. **Servicio realtime:**
   - room o mensajes de recolección (`gather:start`/`gather:stop`) documentados en `PROFESSIONS_DESIGN.md` §8.2;
   - validar adyacencia con la posición autoritativa, `nodeAt`, cargas personales y energía;
   - resolver con `resolveGathering`;
   - enviar resultados privados.
4. **Commit por lotes** idempotente (`batch_id`), con topes de energía revalidados en servidor.
5. **Tests de invariantes:** replay de lote, doble envío, energía negativa, reloj del cliente ignorado, ownership perdido a mitad de sesión, nodo agotado por jugador y otro jugador no afectado.
6. **UI mínima:** panel de Minería como feature propia (no dentro de `WildlandsView.vue`), con inventario de solo lectura.
7. **Fuera de R32:** Tala/Pesca/Alquimia persistentes, Mercado de ítems, housing.

Antes de R32 conviene una iteración corta de balance con el simulador: R1–R3 y un escenario de 90 días.

## 12. Cómo retomar

```bash
git fetch origin
git switch feat/r31-professions-foundation
npm ci
npx vitest run src/features/professions
npx vue-tsc --noEmit -p tsconfig.app.json
npm run sim:economy -- --scenario base
npm run sim:economy -- --scenario month-100 --json
```

Orden de lectura:
1. Este handoff.
2. [`PROFESSIONS_DESIGN.md`](PROFESSIONS_DESIGN.md).
3. [`POKEMON_PROFESSION_SYSTEM.md`](POKEMON_PROFESSION_SYSTEM.md).
4. [`RESOURCE_ECONOMY.md`](RESOURCE_ECONOMY.md).
5. [`ENERGY_DURABILITY.md`](ENERGY_DURABILITY.md).
6. [`ECONOMY_LOOPS.md`](ECONOMY_LOOPS.md).
7. `AGENTS.md`, `docs/TRUST_BOUNDARY.md`, `docs/wildlands/R30_PRODUCTION_HANDOFF.md`.

Prompt sugerido:

> Continuamos la economía de profesiones de PokeSwap después de R31. Leé completos `docs/economy/R31_HANDOFF.md` y los documentos que enlaza, más `AGENTS.md`, `docs/TRUST_BOUNDARY.md` y `docs/wildlands/R30_PRODUCTION_HANDOFF.md`. R31 vive solo en `feat/r31-professions-foundation` y no está mergeada. No crees tablas, RLS, RPCs ni Edge Functions hasta tener aprobadas las preguntas del §9 y un desglose según `AGENTS.md` §17. Empezá por el desglose de R32 del §11.

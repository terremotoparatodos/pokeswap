# R31-B — Handoff: Profession UX & Visual Prototype

> Para auditar o continuar R31-B sin haber participado de la sesión.
> Estructura: **R31 — Professions & Resource Economy** → R31-A Systems Foundation ✅ · **R31-B Profession UX & Visual Prototype** (este documento) · R31-C Balance & Closure (futura).
> Estado: cerrada como prototipo de desarrollo. Rama `feat/r31b-professions-ux`, **sin merge**.

## 1. Base y ramas

| Dato | Valor |
|---|---|
| Rama R31-A | `feat/r31-professions-foundation` en `bd33e3e`, pusheada a `origin` antes de empezar R31-B |
| Rama R31-B | `feat/r31b-professions-ux`, creada exactamente desde `bd33e3e` |
| Otras ramas | Sin tocar (`main` en `7e474c6`) |
| Remoto | GitHub informa que el repo se renombró a `terremotoparatodos/pokeswap`; la URL anterior redirige |

## 2. Qué se construyó

- **Profession Playground** (`/dev/profesiones`, solo desarrollo):
  - mapa real de Pradera Brisa con nodos deterministas;
  - controles de nivel, Pokémon, herramienta, durabilidad, energía, descanso, inventario y tiempo;
  - galería de los 14 estados de nodo;
  - pestañas Pokémon, Progresión, Crafteo e Inventario.
- **Vertical slice de Minería:** inspeccionar nodo → requisitos → trabajador → herramienta → coste exacto → extraer → recurso, rarezas, XP, energía, desgaste → feedback → estado actualizado → reparar.
- **Tala:** usa el mismo panel; solo cambian datos, herramienta, verbo y color.
- **Pesca:** timing liviano (lanzar, esperar, "¡Pica!", recoger). Energía y desgaste solo se cobran al atrapar.
- **Alquimia:** banco de crafteo con recetas reales, tengo/necesito, bloqueadas, lotes y feedback. También sirve para el refinado de las demás profesiones.
- **Pokémon:**
  - capacidades 0–5 derivadas de la afinidad real;
  - comparador sin ganador absoluto;
  - equipo líder + asistentes marcado como concepto no aprobado.
- **Energía, herramientas y progresión:**
  - medidor con coste previsto y desglose "¿Por qué?";
  - salud de herramienta en 5 estados con vida perdida en reparaciones;
  - línea de desbloqueos definidos frente a ideas futuras.
- **WildLands (solo desarrollo):** hook `onWorldObject` en el motor y panel sobre el mundo al tocar o encarar un nodo en Pradera.

**No se hizo** (fuera de alcance): persistencia, escrituras a Supabase, RPCs, Edge Functions, migraciones, cambios en R30 o en la autoridad de presencia, ownership, `PokemonInstance`, mercado, merge y cambios de balance.

Diseño completo: [`R31B_UX_DESIGN.md`](R31B_UX_DESIGN.md). Hallazgos sobre R31-A: [`R31B_FINDINGS.md`](R31B_FINDINGS.md).

## 3. Archivos

### 3.1 Creados

```text
docs/economy/R31B_UX_DESIGN.md
docs/economy/R31B_FINDINGS.md
docs/economy/R31B_HANDOFF.md

src/features/professions/ui/
  capabilities.ts  nodeStatus.ts  gearViews.ts  progressionView.ts  recipeView.ts  fishingSession.ts  feedback.ts
  presentation.test.ts  interaction.test.ts  feedback.test.ts
src/features/professions/demo/
  demoSession.ts  demoWorkers.ts  useProfessionDemo.ts  praderaLandmarks.ts
  demoSession.test.ts  praderaLandmarks.test.ts
src/features/professions/components/
  professions.css
  ItemGlyph.vue  EnergyMeter.vue  ToolStatus.vue  PokemonPortrait.vue  CapabilityBars.vue
  NodeOutlook.vue  GatheringFeedback.vue  FishingCast.vue  NodeInteractionPanel.vue  ProfessionHud.vue  WorldNodeMap.vue
  PokemonWorkerCard.vue  PokemonComparison.vue  WorkerParty.vue  ProfessionProgress.vue  RecipeCard.vue  AlchemyBench.vue  DemoInventory.vue
  playground/ProfessionPlayground.vue  playground/PlaygroundControls.vue  playground/NodeStateGallery.vue
  world/ProfessionWorldDemo.vue
```

### 3.2 Modificados

| Archivo | Cambio | Riesgo |
|---|---|---|
| `src/features/professions/domain/gathering.ts` (+ test) | `previewGathering` extraído; `resolveGathering` lo reutiliza. Mismo orden de tiradas, tests de R31-A intactos | Bajo |
| `src/features/professions/professionsIsolation.test.ts` | Reglas por capa (componentes pueden usar DOM) y entradas de la app permitidas solo si están bajo `import.meta.env.DEV` | Bajo |
| `src/features/wildlands/engine/game.ts` | `WorldObjectTarget` y opción `onWorldObject`; se consulta al tocar una casilla contigua o al usar acción mirando una casilla. Sin callback, el comportamiento no cambia | Bajo; toca un archivo central (ver B-21) |
| `src/features/wildlands/components/WildlandsView.vue` | Monta `ProfessionWorldDemo` y conecta el hook solo en desarrollo; pausa el juego con el panel abierto | Bajo |
| `src/app/router/routes.ts` (+ test) | Ruta `/dev/profesiones` solo en desarrollo | Bajo |

No se tocó `services/realtime`, `supabase/`, el protocolo de presencia, `package.json` ni los catálogos de R31-A.

## 4. Decisiones

| # | Decisión | Por qué | Descartado |
|---|---|---|---|
| UB1 | Toda regla sale de R31-A vía `ui/` y `demo/`; los componentes no calculan | "La UI prueba la arquitectura" | Constantes en componentes |
| UB2 | `previewGathering` en el dominio | Números previstos = números aplicados | Duplicar la fórmula en la UI; adivinar con RNG fijo |
| UB3 | Estado demo como reducer puro sobre los resolvers | Testeable y reemplazable por la API servidor | Inventario local persistente |
| UB4 | Un solo panel de nodo para todas las profesiones de recolección | Reutilización real, probada con Tala | Una pantalla por profesión |
| UB5 | Capacidades con 5 segmentos + texto exacto + chip de especialidad | Comparable sin sugerir un "mejor" | Estrellas, letras, radar, solo % |
| UB6 | Puntaje relativo a un especialista (50 % del presupuesto) | Los nichos fuertes se ven fuertes | Normalizar por tope |
| UB7 | Pesca con timing y cobro solo al atrapar | Identidad sin minijuego | Barra de tensión; zona de lanzamiento; automática |
| UB8 | Alquimia sin coste de energía, explicado en pantalla | Respeta la decisión D7 de R31-A | Inventar un coste |
| UB9 | Todo R31-B tras `import.meta.env.DEV` y verificado en `dist/` | No arriesgar producción | Flag por query string o variable de entorno |
| UB10 | Mapa del playground con nodos reales y coordenadas testeadas | Prueba del determinismo sin recorrer WildLands | Nodos inventados |
| UB11 | Equipo solo como concepto visual | Unlocks no aprobados | Aplicar niveles 20/40 |

## 5. Commits

| Hash | Mensaje |
|---|---|
| `ef3caac` | feat(professions): expose gathering preview for UI |
| `f55a895` | feat(professions-ui): add presentation models and local demo session |
| `bacab98` | feat(professions-ui): add gathering interaction framework |
| `904f138` | feat(professions-ui): add Pokemon, progression and crafting views |
| `774e207` | feat(professions-ui): add dev-only profession playground |
| `ca8b049` | feat(wildlands): add dev-only profession demo hook |
| `1aff70e` | docs(economy): document R31-B UX design and findings |
| *(este documento)* | docs(economy): add R31-B handoff — `git log -1 feat/r31b-professions-ux` |

## 6. Verificación

| Check | Resultado |
|---|---|
| Suite completa (`npx vitest run`) | Verde: 71 archivos, 502 tests (R31-B suma 5 archivos nuevos y extiende gathering, aislamiento y rutas) |
| `npx eslint .` | 0 errores; 9 advertencias preexistentes (`AuthModal`) |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | OK |
| `npm run build` | OK |
| `dist/` sin código R31-B | Sin playground, ruta dev, componente de demo ni textos del catálogo. Solo aparece el nombre de la opción genérica del motor `onWorldObject` (en `game.ts`), que en producción queda sin callback e inerte |
| Navegador escritorio (800 px) | Playground, mapa real, atajos, panel de veta de hierro, extracción con feedback (+1 Mineral de Hierro, +1 Carbón, XP, energía, durabilidad), galería de estados, pestañas Pokémon y Crafteo, lanzamiento de pesca |
| Navegador móvil (375 × 812) | Panel de nodo apilado y legible |
| Escaneo de secretos | Sin secretos en los archivos nuevos o modificados |
| **No verificado** | Abrir el panel caminando en WildLands: esta estación no tiene Supabase real ni servidor realtime, así que el jugador es espectador (B-19) |

**Nota del entorno** (no del repo):
- **Workspace virtualizado:** hay que correr las herramientas desde la ruta real.
- **Variables de Supabase:** la app necesita las dos variables para arrancar. Para la prueba visual se usó un `.env.local` con valores ficticios, ignorado por git y borrado al cerrar.

## 7. Cómo auditar

```bash
git fetch origin
git switch feat/r31b-professions-ux
npm ci
npx vitest run src/features/professions src/app/router
npm run dev          # abrir /dev/profesiones
```

Lista para una persona con entorno completo:
1. `/dev/profesiones`:
   - atajo "Veta de hierro" → tocar el nodo → Extraer varias veces;
   - "Agotar nodo"; bajar la durabilidad a 0 con el control → Reparar (con "Kit de insumos" si faltan materiales);
   - probar sin energía y en móvil.
2. Pestaña Pokémon: comparar Machamp con Magnemite.
3. Crafteo: "Kit de insumos" → crear Pociones en lote.
4. Profesión Pesca → Orilla → lanzar, esperar "¡Pica!" y recoger; repetir recogiendo antes de tiempo.
5. **WildLands en desarrollo con presencia real:**
   - ir a Pradera, caminar hacia una roca o un árbol, tocarlo o usar la tecla de acción;
   - el panel debe abrirse y pausar el juego;
   - cerrar con Esc.
6. `npm run build`: confirmar que `/dev/profesiones` redirige a la ciudad en el preview de producción.

## 8. Riesgos y deuda

| Riesgo | Mitigación |
|---|---|
| El hook de WildLands no se recorrió en vivo (B-19) | Paso 5 de la lista antes de aprobar |
| `game.ts` sigue creciendo (B-21) | Extraer interacción con el mundo a un módulo propio cuando se toque de nuevo |
| El fixture de tipos puede divergir de la base (B-02) | Retirarlo al conectar `useMyBox` y `pokemon` en R32 |
| La UX puede sugerir reglas no aprobadas (equipo, capacidad de inventario) | Etiquetas "Concepto" y "Demo local"; hallazgos B-05 y B-16 |
| Los textos de acceso viven en la UI (B-17) | Moverlos al catálogo |

## 9. Decisiones pendientes para el equipo principal

1. ¿Se aprueba el lenguaje de **capacidades 0–5 + texto exacto** como representación de Pokémon en profesiones?
2. **Inventario:** ¿capacidad por unidades, por espacios o sin límite? ¿Hay almacén? (B-05)
3. **Energía:** ¿costes enteros? ¿Umbral para el descanso? (B-06, B-07)
4. **Alquimia:** ¿mantener procesado sin energía (D7)? (B-13)
5. **Pesca:** ¿timing como identidad sin efecto, o que afecte calidad o rendimiento? ¿Cobrar solo al atrapar? (B-18)
6. **Equipo:** ¿líder + asistentes? ¿En qué niveles? (B-16)
7. **Detección:** ¿se invierte en resaltar nodos en el renderer, o se retira el rasgo? (B-09)
8. **Recetas:** ¿se agrega `name` al catálogo? (B-03)
9. **Distancia de T2/T3** en Pradera: ¿deseada? (B-14)

## 10. Recomendaciones para R31-C (Balance & Closure)

1. Usar la UX como lente de balance: correr el simulador con costes de energía enteros y umbral de descanso, y comparar cómo se leen los números en el panel.
2. Revisar `traitScale` y topes para que los bonus se perciban (B-10), midiendo en el simulador que la sobreoferta (~14:1) no empeore.
3. Decidir capacidad de inventario y coste de procesado, y simular el impacto en la relación faucet/sink.
4. Ampliar sinks de T1 detectados en R31-A antes de subir la percepción de yield.
5. Cerrar B-03 y B-17 en el catálogo (nombres de receta, textos de acceso). Son cambios de datos, sin tocar resolvers.
6. Actualizar `R31_HANDOFF.md` con el cierre de R31 completo y el alcance aprobado para R32.

## 11. Cómo retomar

> Continuamos R31 de PokeSwap. R31-A vive en `feat/r31-professions-foundation` y R31-B en `feat/r31b-professions-ux`; ninguna está mergeada. Leé `docs/economy/R31B_HANDOFF.md`, `R31B_FINDINGS.md`, `R31B_UX_DESIGN.md` y `R31_HANDOFF.md`, más `AGENTS.md`. No agregues persistencia, RPCs, migraciones ni cambios a R30. La siguiente fase es R31-C (balance y cierre): empezá por las decisiones del §9 y las recomendaciones del §10.

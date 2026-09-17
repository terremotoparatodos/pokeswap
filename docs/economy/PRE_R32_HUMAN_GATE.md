# PRE-R32 HUMAN PROFESSION GATE — Registro

> Estado: **ABIERTO.** Todavía no se declaró `PASSED` ni `FAILED`: falta completar la prueba manual del usuario.
> Base probada: `integration/r31` @ `c3349c6` (código idéntico a `25bcc1f`), dev server local `http://localhost:5188/dev/profesiones`.
> Definición del gate: [`R31Z_CONSOLIDATION_PLAN.md` §12.3](R31Z_CONSOLIDATION_PLAN.md).
> Decisiones de producto surgidas del gate: [`PRE_R32_DESIGN_DECISIONS.md`](PRE_R32_DESIGN_DECISIONS.md).
> Regla durante el gate: **no se implementa ni se arregla nada.** Solo se registra y clasifica.

## Clasificación

| Clase | Significado | ¿Bloquea el gate? |
|---|---|---|
| `REGRESIÓN` | Diferencia causada por R31-Z (refactor o limpieza) | **Sí** |
| `BUG PREEXISTENTE` | Defecto que ya existía antes de R31-Z | No |
| `UX / POLISH` | Problema o mejora de experiencia | No |
| `SISTEMA INCOMPLETO` | Sistema que debe existir y hoy falta o es solo demo | No |
| `DECISIÓN DE DISEÑO` | Dirección de producto, aprobada o abierta | No |
| `DEUDA TÉCNICA` | Problema interno sin efecto directo para el jugador | No |

Una observación **no** se considera regresión salvo que difiera del baseline pre-refactor (`f2c615e`).

---

## 1. Resultado por profesión

| Profesión | Resultado | Observaciones |
|---|---|---|
| Tala | _pendiente_ | — |
| Forage (incl. `herb_patch`) | _pendiente_ | — |
| Pesca | _pendiente_ | Ver G-3 y G-5: son de diseño, no regresiones |
| Alquimia | _pendiente_ | — |
| 375 px | _pendiente_ | — |

**Regresiones registradas: 0.**

---

## 2. Hallazgos

| ID | Clase | Hallazgo | Decisión relacionada |
|---|---|---|---|
| G-1 | BUG PREEXISTENTE | El cúmulo cristalino se recoge al pasar por encima | O-15 |
| G-2 | UX / POLISH | Faltan el cartel de primer descubrimiento y los popups silenciosos para lo ya descubierto | A-6 |
| G-3 | DECISIÓN DE DISEÑO | La distribución de fishing spots no es correcta; faltan profundidades | A-5, O-6 |
| G-4 | SISTEMA INCOMPLETO | Estaciones de crafteo sin arte consistente ni lectura de "interactivo" | A-8, O-9 |
| G-5 | DECISIÓN DE DISEÑO | Pescar "pescados" no encaja en el fantasy: se rediseña por encuentros Pokémon | A-4, O-5 |
| G-6 | SISTEMA INCOMPLETO | El horno no existe como sistema jugable; los lingotes no tienen faucet real | A-7, O-8 |
| G-7 | UX / POLISH | Ocho atributos laborales visibles es demasiado pesado | A-2, O-2 |
| G-8 | SISTEMA INCOMPLETO | No hay menú de profesiones fuera del playground dev | A-11, O-12 |
| G-9 | DECISIÓN DE DISEÑO | Fundir hierro pide Nv. 12 y minarlo Nv. 15 | O-8, A-12 |
| G-10 | DEUDA TÉCNICA | El playground regala lingotes y funde sin horno | O-8 |

### G-1 · BUG PREEXISTENTE — Cúmulo cristalino

**Observación del usuario:** se recoge simplemente caminando por encima; parece un residuo del objeto obtenible de la demo.

**Deseado:**
- que sea un nodo con interacción normal;
- sin pickup automático por superposición;
- con el flujo normal de acción y recompensa de profesiones.

**Contexto técnico** (solo inspección):
- `WildlandsGame.onPlayerArrive` llama a `area.collect(tx, ty)` en cada tile al que llega el jugador. Si recoge algo, suma `crystals++` y muestra "+1 cristal · demo, no se guarda" (`src/features/wildlands/engine/game.ts:626`).
- Ese código ya está en `origin/main` (demo de cristales R24): **no es regresión**.
- El nodo `crystal_cluster` se ancla al decor `crystal`, que es caminable. El pickup demo y el nodo de profesión conviven sobre el mismo prop.
- El arreglo toca el motor compartido y producción. Conviene decidirlo junto con F-2 (interacción con props).

### G-2 · UX / POLISH — Primer descubrimiento

- Primera obtención de un item: cartel destacado.
- Siguientes obtenciones: solo el popup del mundo (item, cantidad, XP).
- Registro por item. Detalle en A-6.

### G-3 · DECISIÓN DE DISEÑO — Profundidad de pesca

- Orilla, agua baja y agua profunda, con un spot representativo de cada una.
- La profundidad pasa a ser dato de gameplay.
- La distribución actual (`art/fishingSpots.ts`) no es correcta. Detalle en A-5.

### G-4 · SISTEMA INCOMPLETO — Estaciones de crafteo

- Mesa de Alquimia, Horno, Fogata y Banco de Trabajo necesitan arte consistente y lectura de estación interactiva.
- Las cuatro existen en el catálogo (`STRUCTURES`), pero solo la mesa de alquimia está colocada en el mundo. Detalle en A-8.

### G-5 · DECISIÓN DE DISEÑO — Pesca por encuentro Pokémon

- `cast → espera → encuentro Pokémon → forcejeo → recompensa de objetos`.
- Distribución visual de prototipo: Magikarp 85 / Slowpoke 14 / Shellder 1.
- El Pokémon no se captura. Detalle en A-4.

### G-6 · SISTEMA INCOMPLETO — Horno real

**Estado actual** (inspección):
- La receta `smelt_iron` (Minería, refinado, Nv. 12): 2 Mineral de Hierro + 1 Carbón → 1 Lingote de Hierro, estación `smelter`. También existe `forge_steel` (Nv. 35).
- Solo se ejecuta desde la pestaña **Crafteo** del playground dev (`AlchemyBench.vue` → `craftDemo`): es instantánea y siempre usa `station: 'public'`, así que **no valida horno**.
- No hay ningún horno colocado.
- El Mineral de Hierro sale de `iron_vein` (Nv. 15, biomas desierto/tundra). En Pradera solo hay una veta colocada para el laboratorio, en (-31,-104).
- Usos del lingote: acero, pico/hacha/hoz de hierro, Caña Reforzada y reparaciones T2.
- **En producción no hay forma de obtenerlo.**

Detalle en A-7.

### G-7 · UX / POLISH — Atributos laborales

- Hoy se muestran ocho capacidades (`ui/capabilities.ts`): Extracción, Velocidad, Eficiencia, Conservación, Prospección, Calidad, Procesado y Hábitat.
- Se simplifican a cinco: Potencia, Hallazgo, Eficiencia, Rapidez y Técnica.
- Hábitat pasa a ser afinidad contextual. Detalle en A-2.

### G-8 · SISTEMA INCOMPLETO — Menú de profesiones

- No hay menú ni progreso en producción: `/dev/profesiones` es dev-only y no hay persistencia.
- La pestaña **Progresión** del playground ya muestra nivel/XP, "Próximo" y "Ya desbloqueado" por profesión, derivados del catálogo. Detalle en A-11.

### G-9 · DECISIÓN DE DISEÑO — Nivel de fundición vs. minado

- `smelt_iron` pide Nv. 12 y `iron_vein` pide Nv. 15.
- Con mineral de la mochila inicial o del kit se puede fundir antes de poder minar.
- Es balance: queda abierto (A-12, O-8).

### G-10 · DEUDA TÉCNICA — Atajos del playground

- "Kit de insumos" suma +6 lingotes y la mochila "Stacks variados" +9. El banco funde sin horno.
- Es aceptable para revisión visual en dev.
- Riesgo: al probar reparaciones o crafteo se pueden tener lingotes sin haber recorrido la cadena real.

---

## 3. Qué NO se hace durante el gate

- No se implementa ningún hallazgo ni decisión.
- No se cambian balance, timings ni probabilidades.
- No se toca el motor por G-1.
- No se inicia R32 ni la Dungeon nueva.

Al cierre se declara `PRE-R32 HUMAN PROFESSION GATE: PASSED` o `FAILED` **según las regresiones** (§1). Los demás hallazgos pasan a la revisión posterior.

# PRE-R32 HUMAN PROFESSION GATE — Registro

> **Resultado: `PRE-R32 HUMAN PROFESSION GATE: FAILED — pending Tala visual lifecycle diagnosis.`** (2026-09-18)
> **Estado: FAILED / PENDING RE-TEST.** H-1 está corregido en una rama candidata (§5.1) y espera el re-test humano de Tala. El gate **no** se declara `PASSED` hasta que el usuario confirme el resultado visual.
> Base probada: `integration/r31` @ `b7d4b7d75de3f905539f6dad69fd97d533eed503`. El código de profesiones es idéntico desde `25bcc1f`: lo posterior es documentación y el prototipo de Dungeon. Dev server local `http://localhost:5188/dev/profesiones`, con la caché de Vite limpia.
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

## 1. Resultado por profesión (prueba humana, 2026-09-18)

| Profesión | Resultado | Observaciones del usuario |
|---|---|---|
| **Tala** | **`DIFERENCIA DETECTADA`** | Selección de árbol, worker, acción, hacha, VFX, energía, durabilidad, herramientas rotas, reparación, inventario y reward: correctos, sin anomalías. **«En la última carga el árbol parece caer, reaparece una vez más y recién después desaparece.»** «El popup actual interrumpe la lectura de la secuencia final.» Ver §4 (H-1) y §5 |
| **Forage** (incl. `herb_patch`) | **VISUALMENTE EQUIVALENTE** | `berry_bush` sin y con hoz correcto. `herb_patch` aparece, se selecciona y se recolecta correctamente. Worker, gesto, VFX, reward, energía y desgaste correctos. «El popup molesta porque tapa/interrumpe la secuencia final» (H-2). F-3 sigue siendo comportamiento conocido |
| **Pesca** | **VISUALMENTE EQUIVALENTE** | Spot, posición, cast, espera, pique, worker, caña, reward, depletion y respawn correctos. El usuario **no** considera importante diferenciar visualmente reel temprano de reel válido en este gate (H-6). «El popup también molesta» (H-2) |
| **Alquimia** | **VISUALMENTE EQUIVALENTE** | Estación, recetas, batch 1/3/Máx, ingredientes suficientes e insuficientes, proceso, worker, rewards, XP, ahorro, cancelación e inventario: correctos. **«El popup/cartel de Alquimia sí aporta valor y debe conservarse como feedback de Processing»** (H-3) |
| **375 px** | **CORRECTO** | «Sin problemas relevantes» de tarjeta, canvas, botones, overlays, worker, rewards ni scroll horizontal |

**Regresiones registradas: 0.** La única `DIFERENCIA DETECTADA` es la de Tala, y la evidencia la ubica **antes** del refactor (§5).

### 1.1 Declaración del gate

Regla acordada: si alguna profesión queda en `DIFERENCIA DETECTADA`, el gate no puede declararse `PASSED`.

```text
PRE-R32 HUMAN PROFESSION GATE: FAILED — pending Tala visual lifecycle diagnosis.
```

Qué significa y qué no:

- **No** hay regresión atribuible a R31-Z: la secuencia observada ya está registrada en el baseline congelado en `f2c615e` (§5).
- **No** autoriza fixes, ni de Tala ni de los popups. Corregir, y con qué alcance, es una tarea posterior.
- R31-Z sigue consolidado. Lo que queda pendiente es una decisión de producto sobre el final visual de Tala.

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

## 4. Observaciones humanas y su clasificación

| ID | Observación | Clase | Estado |
|---|---|---|---|
| H-1 | «en la última carga el árbol parece caer, reaparece una vez más y recién después desaparece» | **`DIFERENCIA DETECTADA`** | Diagnosticada en §5: es **preexistente**, no una regresión del refactor. Sin fix |
| H-2 | «el popup actual interrumpe la lectura de la secuencia final» (Tala), «el popup molesta porque tapa/interrumpe la secuencia final» (Forage), «el popup también molesta» (Pesca) | **`UX APROBADA`**, no regresión | Dirección: la recolección debe verse **continua**, comunicada con los pops normales del mundo. El descubrimiento inicial de un item queda como flujo excepcional aparte (`A-6`). Registrado como `A-16`. **No se implementa ahora** |
| H-3 | «el popup/cartel de Alquimia sí aporta valor y debe conservarse como feedback de Processing» | **Comportamiento deseado** | Processing conserva su cartel de finalización. Parte de `A-16` |
| H-4 | Hoz opcional que gasta durabilidad (F-3) | **`PREEXISTENTE` / decisión económica pendiente** | Sin cambios; se decide junto con el resto de herramientas (`A-12`) |
| H-5 | «Pesca futura deja de otorgar pescados; será encuentro visual Pokémon → forcejeo → objetos. Magikarp/Slowpoke/Shellder serán guiños visuales, no capturas» | **`DECISIÓN DE DISEÑO APROBADA`** | Ya registrada como `A-4`; se precisa que los Pokémon son guiños visuales y **no** capturas. **No se implementa ahora** |
| H-6 | Reel temprano y reel válido no se distinguen visualmente | **`UX / POLISH`**, no bloqueante | El usuario declara que no es importante en este gate |

---

## 5. Diagnóstico técnico de H-1 (solo inspección)

**Qué hace el código hoy.** La caída se dibuja en `logging/loggingOverlay.ts`, dentro de `decor()`:

```ts
if (pose.fall > 0 && pose.phase === 'fell') {
  …inclina el árbol…
  if (pose.fall > 0.7) art = loggingTreeArt(target.node.id, decor.kind, 'stump')
}
```

La inclinación y el tocón se aplican **solo durante la fase `fell`**, que dura `FELL_MS = 420` ms (`logging/choppingTimeline.ts`). Al pasar `resultAtMs`, la pose entra en fase `reward` (`REWARD_MS = 950` ms): `pose.fall` vale 1, pero la fase ya no es `fell`, así que la condición es falsa y el decor vuelve a dibujarse sin desplazamiento y con el arte base.

Y durante esos 950 ms el arte base sigue siendo el árbol entero, porque `logging/treeVisualState.ts` resuelve primero la acción en curso:

```ts
if (input.chopping) return { ...base, visual: 'chopping', art: 'ready', ring: 'strong' }
```

`chopping` (el flag `working` del core) es verdadero hasta que la acción se limpia en `overworld/gatheringOverlayCore.ts`, en `totalMs + linger`, es decir **después** de la fase de reward. El nodo ya quedó agotado en la sesión, porque el resultado se aplica en `resultAtMs`, pero la rama `depleted` de `treeVisual` no llega a evaluarse mientras `chopping` sea verdadero.

**Secuencia real:** cargas → caída de 420 ms que termina en tocón → **≈950 ms de árbol entero y derecho otra vez** → se limpia la acción → tocón. Es exactamente lo que describe H-1.

**Evidencia en el baseline congelado.** El bloque `logging · common_tree · felled and depleted` de `__snapshots__/overlayTrace.test.ts.snap` (md5 `334b1e04eb1e40f528f313573d4ac618`, congelado en `f2c615e`) contiene, en orden:

```text
tree@-6,-64 dx=0.38 dy=0.29 art=4bddb451   ← empieza a caer
…
tree@-6,-64 dx=3.24 dy=2.43 art=10de890f   ← ya es tocón, inclinado
tree@-6,-64 dx=3.56 dy=2.67 art=10de890f
19 × tree@-6,-64 dx=0 dy=0 art=4bddb451    ← el árbol entero y derecho, ≈950 ms
14 × tree@-6,-64 dx=0 dy=0 art=10de890f    ← recién acá queda el tocón
```

Los 19 cuadros coinciden con `REWARD_MS = 950` a la cadencia del arnés.

**¿Existía antes del refactor? Sí.** Comparado con `f2c615e` sin cambiar de rama:

- `logging/treeVisualState.ts` y `logging/choppingTimeline.ts` **no cambiaron** desde `f2c615e` (`git diff --stat` vacío);
- en `f2c615e`, `loggingOverlay.ts` ya tenía la misma condición `pose.fall > 0 && pose.phase === 'fell'`, el mismo umbral `pose.fall > 0.7` para el tocón y la misma limpieza en `totalMs + linger`.

H-1 es entonces **comportamiento preexistente del ciclo visual**, anterior al Bloque A.

**¿Estado visual real o percepción alterada por el popup?** Es un **estado visual real**: el árbol vuelve a dibujarse entero durante la fase de reward, y así quedó registrado en el baseline. El popup **agrava** la lectura porque aparece justo en esa ventana, pero no la causa. H-1 y H-2 son independientes.

**Propietario probable de un eventual fix** (no se implementa):

1. `src/features/professions/logging/loggingOverlay.ts` → `decor()`: sostener la caída y el tocón también en `reward` y `done`. Es el cambio más chico y local.
2. `src/features/professions/logging/treeVisualState.ts`: que `depleted` gane sobre `chopping`, o que el core informe «acción en curso pero resultado ya aplicado».

Ninguno de los dos es el core compartido: `overworld/gatheringOverlayCore.ts` solo aporta el flag `working` y el momento de limpieza. Si se decidiera exponer «resultado ya aplicado» en `ViewInput`, ahí sí se tocaría el core.

**Por qué los tests no lo detectan.** El baseline **fija** el comportamiento, no lo juzga: los 19 cuadros del árbol derecho están dentro del md5 aprobado. No existe ninguna aserción que diga «después de la caída, el árbol no vuelve a dibujarse entero». `logging/logging.test.ts` cubre timeline y estado visual por separado, y `treeVisual` con `chopping: true` devuelve `art: 'ready'` por diseño, así que también pasa. Cualquier fix **cambiará el snapshot a propósito** y necesitará aprobación explícita para regenerarlo.

**`OPEN`:** si en el futuro se quiere algo más que el tocón en reposo — una transición propia, o el tronco caído visible un momento en el suelo — sigue siendo decisión de producto (`O-16`).

### 5.1 R31-H1 — candidata de corrección (2026-09-18)

**H-1 corregido en rama candidata.** Rama `fix/r31z-logging-fall-lifecycle`, desde `0c2ec2e9003d2d49f6203f556cae23d14b0a74b9`. **No mergeada**, sin PR.

- **Qué cambió:** en `logging/loggingOverlay.ts` → `decor()`, mientras `pose.fall > 0` y la fase ya no es `fell`, el árbol se dibuja como tocón en reposo en vez de volver a dibujarse entero. Un solo archivo de producción.
- **Alternativa elegida:** la mínima. Se conserva intacta la caída existente — inclinación, desplazamiento y cambio a tocón en `fall > 0.7` — y solo se reemplaza el arte de la ventana de reward. La otra opción (sostener el tronco inclinado durante el reward) habría inventado una animación nueva y dejado un salto al soltar la acción.
- **Qué NO cambió:** timing, VFX, hojas, astillas, worker, input, recompensa, XP, energía, durabilidad, depletion, respawn, dominio, el core compartido ni las otras cuatro profesiones.
- **Test:** `overlayTrace.test.ts` suma una invariante, no un snapshot: iniciada la caída, ningún cuadro posterior vuelve a dibujar el árbol entero antes de quedar en el tocón. Falla contra el overlay anterior, con los 19 cuadros del defecto.
- **Snapshot:** md5 `334b1e04eb1e40f528f313573d4ac618` → `a62f2ebb8372073d1d669d4217a84f3e`. El diff son exactamente 19 líneas `decor` del escenario `logging · common_tree`, con el arte del árbol reemplazado por el del tocón; Minería, Forage, Pesca y Alquimia no se movieron.
- **Pendiente de re-test humano de Tala.** El gate permanece FAILED / PENDING RE-TEST hasta que el usuario confirme el resultado visual.

---

## 6. Qué NO se hizo durante el gate

- No se implementó ningún hallazgo ni decisión.
- No se cambiaron balance, timings ni probabilidades.
- No se tocó el motor por G-1, ni el ciclo visual por H-1.
- No se regeneró ningún snapshot: `-u` sigue prohibido.
- No se inició R32, F-1, Horno, Construcción ni los fixes de R30.

El gate queda **cerrado como FAILED y documentado** (§1.1). Los hallazgos y decisiones pasan a la priorización posterior.

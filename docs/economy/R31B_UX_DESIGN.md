# R31-B — Profession UX & Visual Prototype

> Estado: prototipo visual e interactivo, **solo en desarrollo**, sin persistencia ni red. Rama `feat/r31b-professions-ux`, creada desde `bd33e3e` (R31-A), sin merge.
> Pregunta que responde: **¿cómo se siente usar las profesiones dentro de PokeSwap?**
> Hallazgos sobre R31-A: [`R31B_FINDINGS.md`](R31B_FINDINGS.md). Auditoría y continuidad: [`R31B_HANDOFF.md`](R31B_HANDOFF.md).

## 1. Cómo verlo

```bash
npm run dev
```

| Superficie | Dónde | Requisitos |
|---|---|---|
| **Profession Playground** | `http://localhost:5173/dev/profesiones` | Solo build de desarrollo. El arranque de la app importa Supabase, así que necesita `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (sirven valores ficticios en un `.env.local` ignorado por git). El playground no hace ninguna llamada |
| **Demo en WildLands** | Pradera Brisa: tocá o encará una roca, un árbol o un arbusto | Solo en desarrollo. Hace falta Supabase y presencia R30 funcionando para controlar al jugador; sin servidor realtime el jugador es espectador y no puede moverse |

**Producción no incluye nada de R31-B:**
- la ruta `/dev/profesiones` no existe;
- el componente de WildLands no se monta ni se empaqueta;
- verificado buscando textos del módulo en `dist/` después de `npm run build`: sin coincidencias, salvo el nombre de la opción genérica del motor `onWorldObject`, que en producción no recibe callback y queda inerte.

## 2. Arquitectura de UI

```text
domain/ (R31-A)          contratos, catálogos, resolvers — única fuente de números
  └─ previewGathering    (R31-B) costes y probabilidades sin tirar dados
ui/                      view models puros y testeables, sin Vue
  capabilities.ts        rasgos → capacidades legibles (0–5) y comparación
  nodeStatus.ts          14 estados de nodo, prioridad y textos
  gearViews.ts           energía (desglose de coste) y salud de herramienta
  progressionView.ts     nivel, XP y línea de desbloqueos desde el catálogo
  recipeView.ts          ingredientes tengo/necesito, disponibilidad, lote
  fishingSession.ts      máquina de estados de pesca (lanzar/picar/recoger)
  feedback.ts            líneas de resultado de recolección y crafteo
demo/                    estado local de prototipo (no es autoridad)
  demoSession.ts         reducer puro: gather/craft/repair usando los resolvers reales
  useProfessionDemo.ts   wrapper Vue (shallowRef) con reloj local
  demoWorkers.ts         FIXTURE de 12 especies (tipos no disponibles offline)
  praderaLandmarks.ts    coordenadas reales de cada nodo en Pradera Brisa (testeadas)
components/              Vue, un componente por responsabilidad
  playground/            ProfessionPlayground, PlaygroundControls, NodeStateGallery
  world/                 ProfessionWorldDemo (integración dev en WildLands)
```

**Regla central:** los componentes no calculan reglas de juego.
- Todo número visible sale de un catálogo o de un resolver de R31-A, a través de `ui/` o `demo/`.
- El único dato duplicado es el fixture de tipos de especie; está documentado en el hallazgo **B-02**.

**Aislamiento** (`professionsIsolation.test.ts`):
- Nada del módulo usa Supabase, Colyseus, storage ni `fetch`.
- Las capas `domain/ui/demo/simulation` no tocan DOM ni `Math.random`.
- La app solo llega al módulo por dos puntos de entrada: `routes.ts` y `WildlandsView.vue`. En ambos la línea de import incluye `import.meta.env.DEV`.

## 3. Lenguaje visual común

Reutiliza la estética existente de WildLands: `LobbyHud`, `WildPokemonCard` y `LobbyPanel`.
- **Base:** fondo navy `#101a36`, borde azul `#3a5fb8` de 2 px, esquinas de 14 px, sombra.
- **Acentos:**
  - dorado `#ffd27a`: acción principal, nivel y lo destacado;
  - celeste: energía;
  - verde, ámbar y rojo: estado;
  - violeta: rareza.
- **Identidad por profesión:** un color de borde superior, sin fondos distintos. Minería tierra, Tala verde, Pesca azul, Alquimia rosa.
- **Tipografía y botones:** tipografía del sistema, como el HUD. Botones de al menos 44 px de alto.
- **Ítems:** todavía no hay arte de ítems. `ItemGlyph` es una ficha redonda coloreada por familia de material, con anillo según tier. Reemplazable por sprites sin tocar a quien lo usa.
- **Pokémon:** `PokemonPortrait` recorta el primer cuadro de la hoja overworld existente.
- **Accesibilidad:** `prefers-reduced-motion` desactiva animaciones en todo el módulo. Las barras usan `role="meter"`.

Descartado: estética de dashboard SaaS (tablas grises, gráficos), fondos claros tipo `LobbyPanel` (se pierde el tono de juego) y radar charts.

## 4. Interacción con nodos

### 4.1 Flujo

```text
encontrar nodo → inspeccionar → entender (quién, con qué, cuánto cuesta, qué da) → actuar → feedback → estado actualizado
```

`NodeInteractionPanel` es **un único panel** para Minería, Tala, Alquimia (recolección) y Pesca. De arriba a abajo:
1. Profesión, tier, nombre del nodo y nivel actual contra el requerido.
2. Estado actual en una línea: título y detalle, con color según el tono.
3. Trabajador (retrato y especialidad en puntos) y herramienta (barra de durabilidad).
4. `NodeOutlook`: recompensa (primario, probabilidad de +1 y de ×2, secundarios con su %), energía con desplegable "¿Por qué?", desgaste, XP y duración.
5. Medidor de energía con el coste de esta acción en rayado.
6. Barra de progreso, feedback y botones: acción y Reparar.

`NodeOutlook` usa `previewGathering`: **los números previstos son exactamente los que aplicará el resolver**.

### 4.2 Estados

| Estado | Tono | Cuándo |
|---|---|---|
| `available` | listo | Se puede actuar |
| `in_progress` | ocupado | Durante la acción (tiempo real × 0,1, entre 0,5 y 1,8 s en la demo) |
| `success` / `rare_drop` | bueno / raro | 1,4 s de resultado |
| `cooldown` | ocupado | 0,5 s tras el resultado; evita doble clic y representa la cadencia que validará el servidor |
| `locked_level`, `locked_access`, `wrong_biome` | bloqueado | Requisitos duros |
| `no_tool`, `tool_tier`, `tool_broken` | bloqueado / aviso | Herramienta |
| `depleted` | aviso | Sin cargas personales, con cuenta regresiva de respawn |
| `inventory_full` | aviso | No entra el máximo posible de la acción |
| `no_energy` | aviso | "Necesitás X; tenés Y" |

- **Prioridad:** línea de tiempo → requisitos duros → agotamiento → espacio → energía. La energía va al final porque los otros bloqueos son más útiles de conocer.
- **Galería:** `NodeStateGallery` muestra los 14 estados juntos para revisar el diseño.

### 4.3 Feedback

- **Líneas escalonadas:** `+N recurso` (verde), rarezas (violeta), `+XP` (dorado), `−energía` (celeste), `−durabilidad` o "Sin desgaste" (gris), subida de nivel (resaltada) y herramienta rota (ámbar).
- **Hallazgo raro o crítico:** además, cartel "¡Hallazgo especial!", brillo violeta en el panel y borde luminoso.
- **Sonido:** no se agregó. No existe infraestructura de audio en la app actual; el legado la tenía y se retiró en R23.
- **Cambio visual del nodo en el canvas:** no implementado; requiere cambios en el renderer (hallazgo **B-09**).

## 5. Pokémon como protagonista

### 5.1 De rasgos a capacidades

Los rasgos de R31-A son vocabulario de diseño. El jugador ve **capacidades**:

| Capacidad | Rasgos | Qué significa para el jugador |
|---|---|---|
| Extracción | yield, critical | Más unidades |
| Velocidad | speed | Acciones más cortas |
| Eficiencia | energySaving | Menos energía |
| Conservación | toolCare | Menos desgaste |
| Prospección | rareFind, detection | Rarezas y detección |
| Calidad | quality | Unidades finas |
| Procesado | processing | Crafteo más rápido y ahorro de insumos |
| Hábitat | biomeMastery | Bonus en sus biomas |

- Cada profesión muestra 5 capacidades en orden de relevancia.
- **Puntaje 0–5:** `bonus / (escalaDelRasgo × 0,5)`. Un Pokémon que pone la mitad de su presupuesto en ese rasgo llega a 5. Así un nicho fuerte se ve fuerte aunque su porcentaje sea chico (Magnemite: detección +34 %, 3/5).

### 5.2 Representación elegida y alternativas

| Opción | Pro | Contra | Decisión |
|---|---|---|---|
| Solo porcentajes | Exacto | Ilegible para comparar; +2 % frente a ×1,28 no se comparan | Solo como detalle |
| Estrellas | Familiar | Sugiere calidad general, "5 estrellas = mejor Pokémon" | Descartado |
| Letras (S/A/B) | Compacto | Jerga de tier list, empuja a buscar el mejor | Descartado |
| Radar | Visual | Difícil de leer en móvil; el área sugiere un total | Descartado |
| **5 segmentos por capacidad + texto exacto + chip de especialidad** | Se lee rápido, no suma un total, el detalle es auditable | Un poco más alto | **Elegido** |

`PokemonWorkerCard` muestra la especialidad como chip dorado, las barras, "Menos fuerte en…" (el costo de oportunidad), los accesos ("Accede a roca dura") y el hábitat.

### 5.3 Comparador

`PokemonComparison`: dos selectores y una tabla por capacidad, con la columna líder resaltada. Un empate es una diferencia de fuerza ≤ 0,05. El cierre es una frase por Pokémon: "**Machamp** si buscás extracción. **Magnemite** si buscás prospección y conservación." Si uno no lidera en nada, lo dice sin rodeos. No hay puntaje total ni ganador.

### 5.4 Equipo (concepto)

`WorkerParty` muestra líder y dos espacios de asistente con candado ("Nv. 20 (propuesta)", "Nv. 40 (propuesta)"). Lleva la etiqueta **"Concepto · no aprobado"** y aclara que no afecta ningún cálculo. Solo cuenta el líder, como en R31-A.

## 6. Energía

`EnergyMeter`:
- número actual/máximo y barra celeste;
- el coste de la próxima acción como franja rayada dentro de la barra;
- en ámbar si no alcanza;
- "Descanso +50 % XP" cuando corresponde, o "Se llena en X h Y min".

El desplegable **"¿Por qué?"** del panel explica el coste: base del nodo, reducción del Pokémon, reducción por nivel y si se aplicó el mínimo del 60 %. Todo sale de `energyCostBreakdown`, que usa `actionEnergyCost` y `levelEfficiency` de R31-A.

Descartado: corazones o rayos que se vacían con cuenta regresiva y colores alarmantes al estilo mobile. El medidor es calmo y solo se pone ámbar cuando la acción no alcanza.

## 7. Herramientas y durabilidad

`ToolStatus`: nombre, tier, barra de durabilidad sobre el **máximo original** con la vida perdida en reparaciones rayada en rojo, estado y efecto (velocidad, yield y reparaciones restantes).

| Estado | Regla visual |
|---|---|
| En buen estado | ≥ 60 % del máximo actual (verde) |
| Desgastada | 25–60 % (amarillo) |
| A punto de romperse | < 25 % (ámbar, pulso) |
| Rota · reparable | 0 y admite reparación (rojo) |
| Inservible | 0 y no admite más reparaciones |

- **Reparar:** usa `repairTool` y descuenta materiales del inventario de demo. Si faltan, lista los materiales.
- **Sin herramienta:** "Sin pico · a mano solo en nodos T1".

## 8. Progresión

`ProfessionProgress`:
- nivel grande en insignia dorada, barra dentro del nivel y "faltan N XP";
- **Próximo:** hasta 4 desbloqueos con nivel, tipo (nodo, herramienta, receta, hito, especialización) y chip **Definido** o **Idea futura** (especializaciones e hitos "Reservado");
- **Ya desbloqueado:** desplegable;
- nota fija: los valores siguen sujetos a balance en R31-C.

Todo se deriva de los catálogos (`professionUnlocks`). No hay reglas nuevas.

## 9. Profesiones

| Profesión | Estado | Interacción |
|---|---|---|
| **Minería** | Vertical slice completo | Panel común, extraer, feedback, desgaste, reparación, rarezas, acceso `hardRock` (cúmulo cristalino) |
| **Tala** | Reutiliza todo sin código propio | Mismo panel; cambian datos, herramienta (hacha), color y verbo ("Talar"). Bibarel y Scyther en el comparador |
| **Pesca** | Prototipo de identidad | `FishingCast`: lanzar → esperar 1,5–4 s → "¡Pica!" → ventana de 0,9 s para recoger. Recoger antes asusta al pez; tarde, se escapa. **Energía y desgaste solo se cobran al atrapar**, con el mismo resolver |
| **Alquimia** | Pantalla propia de crafteo | `AlchemyBench`: pestañas por profesión, recetas ordenadas (disponibles, falta ingrediente, bloqueadas), ingredientes tengo/necesito, salida, estación, tiempo, cantidad con máximo, crear, feedback de producido/consumido/ahorro/XP. La recolección de bayas usa el panel común |

**Pesca, alternativa elegida y descartes:**
- **Elegido:** timing liviano. Da identidad ("esperar y reaccionar") sin minijuego.
- **Descartado:** barra de tensión (demasiado scope), elegir zona de lanzamiento (depende de detección y del renderer) y pesca automática con temporizador (indistinguible de Minería).

**Alquimia y energía:** R31-A decidió que el procesado no consume energía (D7). La pantalla lo dice explícitamente en lugar de inventar un coste (hallazgo **B-13**).

## 10. Inventario

`DemoInventory` es un adaptador local explícito: agrupa por clase, muestra glifo y cantidad, y tiene capacidad de 300 unidades con barra.
- **No es un segundo inventario productivo.** Vive solo en memoria del prototipo.
- La capacidad no existe en R31-A (hallazgo **B-05**).
- **R32+:** el panel debe leer el inventario servidor, en solo lectura, a través de una API de feature. El cliente nunca debe ser autoridad (`AGENTS.md` §8).

## 11. WildLands

- **Hook en el motor:** `WildlandsGame` recibe `onWorldObject(target)`.
  - Se llama al **tocar una casilla contigua** o al **usar acción mirando una casilla**.
  - Tocar una roca o un árbol lejano ya hace que el navegador camine hasta el costado y lo encare, y eso dispara la acción.
  - Si el callback devuelve `false`, el comportamiento anterior no cambia.
- **Wiring en la vista:** `WildlandsView` solo lo conecta cuando `import.meta.env.DEV`.
- **`ProfessionWorldDemo`:**
  - calcula `nodeAt(worldNodePort(area.world), tx, ty)`, el mismo cálculo que haría el servidor;
  - si hay nodo, abre el panel como tarjeta inferior con fondo tenue y pausa el juego, igual que las tarjetas de la plaza;
  - muestra una pista discreta en mundos wild;
  - no envía mensajes de presencia ni toca R30.
- **Limitación:** las anclas no sólidas (orilla, pasto alto, cristal) no disparan la acción tras caminar hasta ellas (hallazgo **B-15**).

## 12. Profession Playground

Ruta dev `/dev/profesiones`, página independiente, sin la ciudad debajo.

| Pestaña | Contenido |
|---|---|
| Recolección | Mapa real de Pradera Brisa (semilla 208) con nodos deterministas, atajos a cada tipo de nodo, panel, HUD compacto y galería de estados |
| Pokémon | Tarjeta del líder, equipo conceptual, comparador y tarjetas compactas de las 12 especies del fixture |
| Progresión | Las 4 profesiones |
| Crafteo | Banco (Alquimia y refinado del resto) |
| Inventario | Inventario de demo |

**Controles:** profesión, nivel de profesión, Pokémon y su nivel, herramienta y durabilidad, energía, descanso, nodo del catálogo, agotar nodo, llenar o vaciar inventario, kit de insumos, avanzar 1 h y reiniciar.

Para retirarlo: borrar la entrada de `routes.ts` y la carpeta `components/playground`. No hay otras dependencias.

## 13. Responsive

- **Verificado en navegador:** escritorio (800 px) y móvil (375 × 812).
- **Panel de nodo en móvil:** se apila, la tripulación pasa a una columna y la pesca ubica el botón debajo. Los paneles de WildLands usan hoja inferior con `max-height` y scroll propio.
- **Comparador y progresión:** ocultan detalles secundarios por debajo de 520 px.
- **Mapa del playground:** celdas de 14 px y scroll horizontal.
- **Pendiente:** en móvil los controles del playground empujan el contenido hacia abajo (B-20). Aceptable para una herramienta interna.

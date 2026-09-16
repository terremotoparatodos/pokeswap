# R31-C4 Handoff — Alchemy Visual Identity & Interaction

> Rama: `feat/r31c4-alchemy-visual-design` (hija de `feat/r31c3-logging-visual-design` @ 9b587e6). **No mergeada.**
> Docs: [Dirección de arte](R31C4_ALCHEMY_ART_DIRECTION.md) · [Manifest](ALCHEMY_ASSET_MANIFEST.md) · [Interacción](ALCHEMY_INTERACTION_SPEC.md)
> Fases previas: [Minería](R31C1_HANDOFF.md) · [Pesca](R31C2_HANDOFF.md) · [Tala](R31C3_HANDOFF.md)

## 1. Qué se entregó

| Área | Entrega |
|---|---|
| Arte | 30 assets: la mesa × estados y líquidos, 13 íconos, 6 efectos, 2 marcadores |
| Estación | La mesa se **deriva del mundo** (primer claro junto al spawn), sin lista guardada |
| Runtime | Línea de tiempo de preparación (cargar/calentar/hervir/embotellar), overlay y controlador |
| UI | `AlchemyStationCard`: navegador de recetas, ingredientes con origen, lote, bloqueos y feedback |
| Navegador | `recipeBrowser.ts`: títulos únicos, estados, sugerencia y origen de cada ingrediente |
| Playground | Laboratorio de alquimia (motor real) y cuarto kit en la galería |
| WildLands dev | Minería, Pesca, Tala y Alquimia conviven en el overlay compuesto |
| Reutilizado | Navegación hacia objetos, Pokémon trabajador, inventario, `ItemGlyph`, burbujas, feedback, `CompositeOverlay`, `recipeView` de R31-B |

## 2. Verificación

**Automática (en esta rama):**
- `vitest`: 82 archivos, 621 tests OK (22 nuevos de Alquimia);
- `eslint`: 0 errores; 9 warnings en `AuthModal.vue`, anteriores a R31;
- `vue-tsc` / `npm run typecheck`: OK;
- `npm run build`: OK;
- `dist/` sin strings del playground, laboratorios ni galería;
- diff sin secretos.

**En navegador real** (Vite dev con `.env.local` de placeholders):

| Verificado | Resultado |
|---|---|
| Laboratorio de alquimia | La mesa aparece en el claro derivado (-9, -73) con el motor real |
| Acercarse | Tocarla de lejos camina hasta un costado; tocarla desde al lado abre el panel |
| Navegar recetas | 8 recetas con estado: preparables, "Faltan", "Nv. X" y la **Sugerida** |
| Ingredientes | "Hierba Medicinal · Alquimia 3/2", "Alga · Pesca 2/1" — con ícono y origen |
| Preparar 1 | Pokémon trabajador presente, barra y textos por fase, "+1 Extracto Herbal, −2 Hierba Medicinal, −1 Alga, +7 XP"; mochila 9 → 10 |
| Lote | "Máx 5" → "Preparar 5": "Produce 5 × …, 37,5 s" y "+5 / −9 / −5 / +35 XP" |
| Resultado destacado | Salió el ahorro del Pokémon: "Tu Pokémon ahorró 1 insumo" con banner y destello |
| Faltan ingredientes | "Te falta 1 × Hierba Medicinal", contador en rojo y botón deshabilitado |
| Bloqueada por nivel | Hiperpoción: "Necesitás Alquimia Nv. 30" y botón "Requiere Nv. 30" |
| Cruce de profesiones | Hiperpoción muestra Alquimia + Alquimia + **Pesca** + **Minería** en sus chips |
| Galería | Pestaña Alquimia con 30 assets y la fila de contexto (inactiva → lista) |
| Móvil 375×812 | Panel completo legible, botones de 40–44 px, sin scroll horizontal |

**Bugs encontrados y corregidos durante la fase:**
1. **La mesa caía sobre la puerta de la ciudad.** El ancla es el spawn del mundo, que también es el portal de vuelta: caminar hacia la mesa te sacaba del mundo. La búsqueda ahora empieza en el anillo 4 (test que lo fija).
2. **La mesa se movía sola.** El laboratorio le pasaba al overlay la casilla **ya derivada** como ancla y el overlay volvía a derivar desde ahí: la mesa quedaba a 4 casillas del jugador y no se podía abrir. Ahora el ancla cruda viaja sin transformar.
3. **La llama no se veía.** Se pintaba antes que el vidrio y el matraz la tapaba (lo detectó un test); ahora va al final.
4. **Ingrediente perdido al cargar.** El primer ingrediente caía en t = 0 y nunca entraba en la ventana del primer cuadro; ahora las gotas van desfasadas medio paso.
5. **Se ofrecía construir la mesa sobre la mesa.** `build_alchemy_table` es receta de Alquimia pero de categoría `construction`: se excluyó del navegador (H-4).

**No verificado** (dicho con honestidad):
- **WildLands real (`WildlandsView`):** sin Supabase ni realtime el jugador es espectador; el laboratorio usa la misma clase `WildlandsGame`, el mismo overlay y el mismo controlador.
- **Inventario lleno con Alquimia:** el camino existe (`inventory_full` con su texto), pero no se forzó el caso en el navegador; sí está cubierto en Minería y Tala.
- **Toque sobre la mesa en móvil real:** a 375 px se verificó el panel completo y el mundo (sin scroll horizontal); la secuencia de toques sobre el lienzo se manejó en escritorio.
- **Rendimiento:** no se midieron fps en un dispositivo móvil real.
- **Sonido:** no hay infraestructura de audio; solo está documentado.

## 3. Decisiones que requieren aprobación

1. **La mesa se deriva del mundo** (primer claro libre a 4+ casillas del spawn), sin persistencia, igual que los nodos.
2. **El color lo pone el producto**: un líquido por consumible, repetido en ícono, matraz y burbujas.
3. **El lote no repite la ceremonia**: la preparación ocurre una vez y solo el embotellado pulsa, con tope de 6.
4. **Sin energía y sin herramienta**, porque es lo que dice el dominio hoy. Si la economía decide cobrar algo, la tarjeta ya tiene el lugar.
5. **El "resultado destacado" es el ahorro de insumos** del Pokémon, no una calidad nueva de producto.
6. **El navegador excluye `construction`**: la mesa solo prepara.
7. **Títulos y orígenes los deriva la UI**, porque el catálogo no los tiene (H-2, H-3).

## 4. Límites y deuda

- **Alquimia tiene una mitad sin construir (H-1):** sus cuatro nodos de recolección (arbusto de bayas, parche de hierbas, arboleda silvestre, flor de escarcha) y la hoz siguen sin arte ni interacción propia. Es lo más grande que queda de esta etapa.
- **La mesa no tiene colisión:** la dibuja el overlay y la solidez la decide el área, así que el jugador puede pararse encima; parado sobre ella no puede abrirla (hay que dar un paso al costado). Se arregla cuando la mesa sea un prop real o un mueble de interior.
- **Una sola mesa por mundo**, siempre en el mismo claro, sin interiores ni mesa propia del jugador.
- **Todo es local:** sin persistencia ni servidor; otros jugadores no ven la mesa ni la preparación.
- **`CompositeOverlay` es de orden fijo** (Minería, Pesca, Tala, Alquimia).
- **Cuatro controladores casi iguales:** ver §5.

## 5. Piezas compartidas y qué conviene extraer ahora

Después de cuatro profesiones, lo que **ya** es compartido: `SceneOverlay` y `CompositeOverlay`, navegación hacia objetos, `overworld/workerPresence` y `workerCompanion`, `pixelArt`, rarezas y feedback, inventario completo, `ItemGlyph`, burbujas, laboratorio y galería, y ahora `ui/recipeView` bajo el navegador de Alquimia.

Lo que quedó **cuadruplicado** y conviene extraer en una fase corta y controlada:

| Duplicado | Propuesta |
|---|---|
| `useMiningController` / `useFishingController` / `useLoggingController` / `useAlchemyController` | Un `useGatheringController` con la parte común (selección, adyacencia, bloqueo de input, resultado) y un adaptador por profesión. Alquimia es el caso raro (sin nodo, con cantidad): sirve de prueba de que el adaptador es suficiente |
| Los cuatro `*ActionCard.vue` | Una tarjeta base con slots para chips y acciones |
| Reward pops y labels de los cuatro overlays | Un `overworld/rewardPops.ts` |
| El bloque `targetAt` / `stationAt` de cada overlay | Un helper `overlayTargetAt(area, tx, ty, filtro)` |
| El `spawnBeside` de los cuatro laboratorios | Un helper del playground |

Esa extracción es mecánica y está cubierta por tests puros. **Ahora sí conviene hacerla**: ya no hay una quinta profesión que la justifique más adelante.

## 6. Siguiente paso sugerido

1. **Aprobar el lenguaje de Alquimia** (mesa derivada, color por producto, lote con embotellado pulsado, sin energía).
2. **Revisión general / consolidación** de R31-C1 a C4, con la extracción de §5 como primer trabajo.
3. **Cerrar la mitad recolectora de Alquimia** (H-1) o decidir explícitamente que queda para después.
4. **R32:** contrato de servidor para nodos, estaciones y contenedores — incluyendo validar la estación al procesar (H-5).

## 7. Nota de entorno

En la ruta virtualizada donde se trabajó esta etapa **el watcher de Vite no detecta los cambios de archivo**: el navegador sigue sirviendo el módulo viejo por más que se recargue. Cualquier revisión visual exige matar el proceso del puerto, borrar `node_modules/.vite` y levantar el servidor de nuevo (mismo hallazgo que en R31-C3).

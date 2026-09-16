# R31-C3 Handoff — Logging Visual Identity & Interaction

> Rama: `feat/r31c3-logging-visual-design` (hija de `feat/r31c2-fishing-visual-design` @ 2e29ddf). **No mergeada.**
> Docs: [Dirección de arte](R31C3_LOGGING_ART_DIRECTION.md) · [Manifest](LOGGING_ASSET_MANIFEST.md) · [Interacción](LOGGING_INTERACTION_SPEC.md)
> Fases previas: [Minería](R31C1_HANDOFF.md) · [Pesca](R31C2_HANDOFF.md)

## 1. Qué se entregó

| Área | Entrega |
|---|---|
| Motor | Recetas de árbol expuestas (`TREE_METRICS`, `treeKindPixels`, `treeTrunkPixels`) sin cambiar el arte del mundo |
| Arte | 54 assets: árboles × estados, hachas × tiers y condición, íconos de madera, efectos y marcador |
| Tala | Timeline de hachazos con caída solo en el último corte, estado visual del árbol, hojas con deriva propia, overlay y controlador |
| UI | `LoggingActionCard` con el aviso "Quedan N cortes / Último corte: cae el árbol" |
| Playground | Laboratorio de tala (motor real) y tercer kit en la galería |
| WildLands dev | Minería, Pesca y Tala conviven en el overlay compuesto |
| Reutilizado | Navegación hacia objetos, Pokémon trabajador, inventario, rarezas, partículas, `ItemGlyph`, burbujas, feedback, `CompositeOverlay` |

## 2. Verificación

**Automática (en esta rama):**
- `vitest`: 80 archivos, 599 tests OK (21 nuevos de Tala);
- `eslint`: 0 errores; 9 warnings en `AuthModal.vue`, anteriores a R31;
- `vue-tsc` / `npm run typecheck`: OK;
- `npm run build`: OK;
- `dist/` sin strings del playground, laboratorios ni galería;
- diff sin secretos.

**En navegador real** (Vite dev con `.env.local` de placeholders):

| Verificado | Resultado |
|---|---|
| Laboratorio de tala | El motor real renderiza el bosque de Pradera; solo algunos árboles llevan marca |
| Seleccionar árbol | El jugador camina hasta el costado, encara el árbol y abre la tarjeta ("Quedan 6 cortes") |
| Talar | La tarjeta colapsa a "Talando…", aparece el Pokémon trabajador, se ve el hacha y sale "+1 Tronco Común, +1 Resina, +45 XP Tala, −9,16 energía, −1 durabilidad"; mochila 9 → 11 |
| Agotar | 6 cortes dejan "Agotado para vos · Se recupera en 1:04" y el árbol pasa a tocón (`art: 'stump'`) mientras el resto del bosque sigue en pie |
| Respawn | Con el reloj de la demo: tocón → **brote** (47 %) → **árbol joven** (88 %) → árbol completo |
| Hacha rota | Durabilidad a 0: "Tu hacha está rota · Reparala para seguir", ícono partido y Talar deshabilitado |
| Reparar | "Reparada · usaste 3 Piedra"; el máximo baja de 60 a 55 |
| Madera dura | Nivel 18 ≥ 15: "+1 Madera Dura, +110 XP Tala, −18,81 energía, −2 durabilidad" y destello de prospección sobre el árbol |
| Inventario lleno | Preset "Llena": "Inventario lleno · Liberá espacio para seguir" y botón deshabilitado |
| Galería | Pestaña Tala con 54 assets y la fila de contexto, incluyendo **decorativo frente a talable** |
| Móvil 375×812 | Loop completo: selección, tala con la tarjeta colapsada, resultado con íconos y mochila 9 → 11; botones de 44 px y sin scroll horizontal |

**Bugs encontrados y corregidos durante la fase:**
1. **Hacha rota poco legible:** el ícono roto tenía la misma cantidad de píxeles que el sano; ahora el mango queda partido y la cabeza desprendida (lo detectó un test).
2. **Marca de hacha demasiado sutil:** pasó de dos a tres filas con labio oscuro para leerse a distancia.
3. **Íconos de madera como letras:** el servidor de desarrollo tenía módulos viejos en caché; con un servidor limpio se confirmó que `ItemGlyph` ya usa el kit de Tala. No era un bug del código.

**No verificado** (dicho con honestidad):
- **WildLands real (`WildlandsView`):** sin Supabase ni realtime el jugador es espectador; el laboratorio usa la misma clase `WildlandsGame`, el mismo overlay y el mismo controlador.
- **Drop raro de Tala (Bonguri):** su probabilidad es de 0,3 % a 2 % y no salió durante las pruebas. El camino visual es el mismo ya verificado con el oro en Minería (cartel, borde violeta y destello).
- **Pino boreal en el mundo:** su arte se revisó en la galería; no se taló in situ (requiere Nv. 30 y está en tundra lejana).
- **Grupos de árboles muy juntos:** se probó el bosque real (copas superpuestas) y la selección por casilla funcionó; no se forzó el caso de dos nodos talables adyacentes ni el de árbol contra roca.
- **Rendimiento:** no se midieron fps en un dispositivo móvil real.
- **Sonido:** no hay infraestructura de audio; no se implementó.

## 3. Decisiones que requieren aprobación

1. **Árboles talables = subconjunto determinista** por densidad de ancla (12 % `tree`, 10 % `pine`/`snowpine`, 20 % `palm`), sin lista guardada.
2. **La marca de hacha en el tronco** es la única señal permanente; nada de contornos ni íconos flotantes.
3. **El árbol cae solo en el último corte** (opción C: inclinación + hojas + tocón), no en cada acción.
4. **Corteza repintada por tier** sobre el mismo volumen del prop.
5. **Sin recursos nuevos:** troncos, resina y Bonguri son los de R31-A. Corteza, savia y semillas quedan como propuesta.
6. **Regeneración en tres etapas** (tocón, brote, árbol joven) atadas al respawn existente.

## 4. Límites y deuda

- **Todo es local:** sin persistencia ni servidor; otros jugadores no ven la tala ni el tocón.
- **La caída es una inclinación, no una animación completa:** decisión de coste y de multiplayer (ver art direction §8).
- **El tocón no distingue el hacha usada** ni conserva marcas del jugador.
- **`CompositeOverlay` es de orden fijo** (Minería, Pesca, Tala): si dos profesiones marcaran la misma casilla, gana la primera.
- **Tres controladores casi iguales:** ver §5.

## 5. Piezas compartidas y qué conviene extraer ahora

Después de tres profesiones, lo que **ya** es compartido: `SceneOverlay` y `CompositeOverlay`, navegación hacia objetos, `overworld/workerPresence` y `workerCompanion`, `pixelArt`, pool de partículas, rarezas y feedback, inventario completo, `ItemGlyph`, burbujas, laboratorio y galería.

Lo que quedó **triplicado** y conviene extraer en una fase corta y controlada (no ahora, para no arrastrar riesgo dentro de esta):

| Duplicado | Propuesta |
|---|---|
| `useMiningController` / `useFishingController` / `useLoggingController` | Un `useGatheringController` con la parte común (selección, adyacencia, bloqueo de input, resultado) y un pequeño adaptador por profesión |
| Los tres `*ActionCard.vue` | Una tarjeta base con slots para chips y acciones |
| Reward pops y labels de los tres overlays | Un `overworld/rewardPops.ts` |
| El bloque `targetAt` de cada overlay | Un helper `nodeTargetAt(area, tx, ty, filtro)` |

Esa extracción es mecánica y está cubierta por tests puros; conviene hacerla antes de Alquimia, que sería la cuarta copia.

## 6. Siguiente paso sugerido

1. **Aprobar el lenguaje de Tala** (marca en el tronco, caída en el último corte, tres etapas de rebrote).
2. **Extracción corta** de las piezas de §5.
3. **Alquimia** con el kit ya compartido.
4. **R32:** contrato de servidor para nodos y contenedores.

# R31-C2 Handoff — Fishing Visual Identity & Interaction

> Rama: `feat/r31c2-fishing-visual-design` (hija de `feat/r31c-mining-visual-design` @ 93edd32). **No mergeada.**
> Docs: [Dirección de arte](R31C2_FISHING_ART_DIRECTION.md) · [Manifest](FISHING_ASSET_MANIFEST.md) · [Interacción](FISHING_INTERACTION_SPEC.md)
> Base: R31-C1 (Minería) sigue documentada en [`R31C1_HANDOFF.md`](R31C1_HANDOFF.md).

## 1. Qué se entregó

| Área | Entrega |
|---|---|
| Arte | 58 assets procedurales: spots × estados, cañas × tiers y condición, íconos de recursos, efectos y marcadores |
| Pesca | Timeline de lanzamiento, espera, pique y recogida; calidad de reacción; estado visual del spot; salpicaduras; overlay y controlador |
| Navegación | Reglas de orilla: se pesca parado en tierra; tocar el agua marcada selecciona el spot de la costa |
| UI | `FishingActionCard`, con el botón ¡Recoger! siempre visible durante la acción |
| Playground | Laboratorio de pesca (motor real), galería con selector Minería/Pesca |
| WildLands dev | `CompositeOverlay`: Minería y Pesca conviven en el único overlay del motor |
| Reutilizado | Inventario, rarezas, partículas, `pixelArt`, `SceneOverlay`, Pokémon trabajador, marcadores y feedback |

## 2. Verificación

**Automática (en esta rama):**
- `vitest`: 78 archivos, 578 tests OK (24 nuevos de Pesca);
- `eslint`: 0 errores; 9 warnings en `AuthModal.vue`, anteriores a R31;
- `vue-tsc` / `npm run typecheck`: OK;
- `npm run build`: OK.

**En navegador real** (Vite dev con `.env.local` de placeholders):

| Verificado | Resultado |
|---|---|
| Laboratorio de pesca | El motor real renderiza la costa de Pradera con los spots detectados |
| Tocar el agua marcada | El jugador camina a la orilla, encara el agua y se abre la tarjeta |
| Lanzar | La tarjeta colapsa a "Esperando el pique…" y deja ver caña, línea, flotador y Pokémon trabajador |
| Pique | Flotador hundido, "!" dorado sobre el agua y el botón ¡Recoger! resaltado |
| Captura | "¡Tirón perfecto!", +1 Pescado, +1 Alga, +53 XP Pesca, −9,59 energía, −1 durabilidad, "Nuevo espacio: Pescado" y mochila 9 → 10 |
| Escape | "Se escapó: tardaste en recoger" y "No gastaste energía ni desgaste: volvé a lanzar" |
| Agotar un spot | 6 capturas seguidas dejan "Agotado para vos · Se recupera en 1:05", el agua sin sombra y el botón deshabilitado |
| Bloqueo por nivel | Banco costero: "Requiere Pesca Nv. 15 · Tenés Nv. 6"; Arrecife: "Requiere Pesca Nv. 30" |
| Arrecife sin orilla | Se selecciona nadando a su lado, como dice la spec |
| Galería | Pestaña Pesca con estados en contexto y grupos por tipo (58 assets) |
| Móvil 375×812 | Loop completo: tarjeta, lanzamiento, pique y captura, con botones de 44 px y sin scroll horizontal |

**Correcciones hechas durante la fase:**
1. **Marca en el agua:** al principio se pintaba sobre la casilla de orilla (arena); ahora va sobre el agua que el spot marca, y tocar esa agua selecciona el spot.
2. **Alcance del lanzamiento:** la validación pedía estar al lado del *nodo*, lo que fallaba justo cuando el jugador estaba bien parado en la orilla; ahora pide estar junto al **agua** y en tierra.
3. **Reloj del overlay:** al recrear el juego (cambiar de landmark) el reloj vuelve a cero y las cachés quedaban en el futuro, congelando el escaneo de spots (el arrecife no aparecía). Ambos overlays ahora se reinician. Afectaba también a Minería.
4. **Íconos:** `ItemGlyph` no conocía pescado, alga, perla, escama ni cañas y mostraba letras; ahora usa el kit de Pesca.

**No verificado** (dicho con honestidad):
- **WildLands real (`WildlandsView`):** sin Supabase ni realtime el jugador es espectador. El laboratorio usa la misma clase `WildlandsGame`, el mismo overlay y el mismo controlador; la vista completa no se pudo caminar.
- **Captura rara:** perla (0,1 %) y escama (0,4 %) no aparecieron; la jerarquía de rareza es la misma de Minería, ya verificada allí con el oro.
- **Caña rota y reparación de Pesca:** no se forzó en el navegador (el flujo es el mismo de Minería, ya verificado).
- **Calidades `good` y `late`:** el código las distingue y hay tests, pero en el navegador solo se dieron `perfect` y `missed`.
- **Rendimiento:** no se midieron fps en un dispositivo móvil real.
- **Sonido:** no hay infraestructura de audio; no se implementó.

## 3. Decisiones que requieren aprobación

1. **Se pesca desde tierra** siempre que el spot tenga orilla; el arrecife abierto se pesca nadando.
2. **La marca vive en el agua** y es lo que el jugador toca, aunque el nodo esté en la costa.
3. **Ventana de pique de 1,1 s** con tramos perfecto (350 ms) y tarde (300 ms), configurables.
4. **Un escape no cuesta nada** salvo tiempo.
5. **Las tres calidades de captura aún dan el mismo botín:** falta decidir el bonus de `perfect` y el riesgo de `late`.
6. **El pique se avisa con "!" y color, no con sonido** (no hay audio).

## 4. Límites y deuda

- **Todo es local:** sin persistencia ni servidor; otros jugadores no ven la pesca.
- **Sin minijuego de tensión:** recoger es un solo toque; la lucha con el pez queda para otra fase si se quiere.
- **La sombra del pez no indica la especie ni el tamaño**: podría hacerlo en el futuro.
- **`CompositeOverlay` es de orden fijo** (Minería primero): si dos profesiones marcaran la misma casilla, gana la primera.
- **Números de tiempo y rareza** siguen siendo de prototipo.

## 5. Reutilización para Tala y Alquimia

| Pieza | Reutilizable tal cual | Qué cambia |
|---|---|---|
| `SceneOverlay`, `CompositeOverlay`, tiles interactuables | Sí | — |
| `overworld/workerPresence` + `workerCompanion` | Sí | — |
| `pixelArt`, partículas, rarezas, `ItemGlyph`, inventario | Sí | Tonos e íconos |
| `fishingTimeline` | Patrón | Tala: hachazos (ya está el de Minería); Alquimia: remover y esperar |
| `fishingApproach` | Patrón | Alquimia: acercarse a hierbas; Tala: al tronco |
| `spotVisualState` | Sí | Arte por estado |
| `FishingActionCard` + `MiningActionCard` | Patrón a generalizar en `useGatheringController` y una tarjeta común | Textos, íconos y acción |
| Laboratorio y galería | Sí | Landmarks y registro por profesión |

## 6. Siguiente paso sugerido

1. **Aprobar el feel de Pesca** (ventana, escape sin coste, marca en el agua).
2. **R31-C3 o C2-bis:** Tala y Alquimia con el mismo kit, y generalizar controlador y tarjeta.
3. **R32:** contrato de servidor para nodos y contenedores (ver `INVENTORY_DESIGN.md` §8 y `MINING_INTERACTION_SPEC.md` §6).

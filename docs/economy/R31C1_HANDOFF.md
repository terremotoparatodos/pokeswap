# R31-C1 Handoff — Mining Visual Identity & Interaction

> Rama: `feat/r31c-mining-visual-design` (hija de `feat/r31b-professions-ux` @ 721fd2a). **No mergeada.**
> Docs: [Dirección de arte](R31C1_MINING_ART_DIRECTION.md) · [Manifest](MINING_ASSET_MANIFEST.md) · [Interacción](MINING_INTERACTION_SPEC.md) · [Inventario](INVENTORY_DESIGN.md)

## 1. Qué se entregó

| Área | Entrega |
|---|---|
| Motor | `SceneOverlay` para decor, suelo, sprites y etiquetas; `setInputLocked`; `playerSnapshot`; tiles interactuables en el navegador (arregla B-15) |
| Arte | 80 assets procedurales (nodos × estados, picos × tiers y condición, íconos, VFX, marcadores) |
| Minería | Timeline de golpes, rareza del resultado, partículas (pool de 40), estado visual del nodo, overlay y controlador |
| Inventario | Espacios + stacks puros; reglas de stack de demo; pendientes; modelo de equipo B |
| UI | `MiningActionCard`, `InventoryGrid`, `ItemGlyph` con íconos pixel |
| Playground | Laboratorio minero (motor real de WildLands), Galería de assets y pestaña Mochila |

## 2. Verificación

**Automática (en esta rama):**
- `vitest`: 75 archivos, 546 tests OK;
- `eslint`: 0 errores; 9 warnings en archivos no tocados por R31-C1;
- `vue-tsc` / `npm run typecheck`: OK;
- `npm run build`: OK;
- `dist/` sin strings del playground, laboratorio ni galería;
- diff sin secretos.

**En navegador real** (Vite dev con `.env.local` de placeholders, borrado al final):

| Verificado | Resultado |
|---|---|
| Laboratorio en desktop | El motor real renderiza Pradera |
| Tocar el nodo | El jugador llega al costado y se abre la tarjeta con estado, Pokémon, pico, chips y botones |
| Minar | La tarjeta colapsa a "Minando…". Se ve el pico sobre el jugador y "+XP" sobre la roca. Al final, resultado (+1 Mineral de Hierro, +1 Carbón, +165 XP, −19,43 energía, −1 durabilidad) y "Seguir minando". Durabilidad 110→109 y energía 680→660 en los controles |
| Galería | Fila de estados en contexto (AVAILABLE, INTERACTABLE, TARGETED/IN_PROGRESS, LOCKED_LEVEL, SPECIAL_ACCESS, RARE, DEPLETED, RESPAWNING) y grupos por tipo |
| Móvil 375×812 | Playground sin scroll horizontal; laboratorio con HUD y canvas; controles debajo del contenido |

**No verificado en navegador** (dicho con honestidad):
- **WildLands real (`WildlandsView`):** sin Supabase ni realtime el jugador queda como espectador y no se puede caminar. El laboratorio usa la misma clase `WildlandsGame` y el mismo overlay, pero no la vista completa.
- **Cuadros individuales:** agotamiento completo, respawn animado, herramienta rota o reparación y rare drop no se capturaron cuadro por cuadro. La lógica está cubierta por tests y el arte de cada estado se vio en la galería.
- **Mochila llena y pendientes desde la UI:** la regla está testeada (`demoSession.test.ts`, `slotInventory.test.ts`), pero el recorrido no se capturó con screenshot.
- **Tarjeta en móvil:** no se abrió tocando un nodo a 375 px.
- **Rendimiento:** no se midieron fps en un dispositivo móvil real.
- **Sonido:** no existe infraestructura de audio; no se implementó.

## 3. Decisiones que requieren aprobación

1. **Herramienta equipada:** modelo B, casillas de equipo fuera de la mochila.
2. **INVENTORY_FULL:** bloquear solo si no entra el mínimo garantizado; el excedente va a pendientes personales.
3. **Números de demo:** stacks 100 / 60 / 20 / 50 / 25 / 1 y capacidad 24.
4. **Arte:** 100 % procedural (sin PNG) y nodos derivados de las rocas del mundo.
5. **Golpe:** pico overlay en lugar de cuadros nuevos del entrenador; el Pokémon no golpea.
6. **Agotamiento:** el sprite agotado es personal (por las cargas de R31-A); dos jugadores pueden ver estados distintos.
7. **Duración de la animación:** comprimida (2–4 golpes) respecto del tiempo real de la acción.

## 4. Límites y deuda

- **Todo es local:** sin persistencia, servidor ni protocolo. Otros jugadores no ven la minería.
- **DEPLETED sin respawn:** necesita contrato de agotamiento compartido (B-04).
- **Animación del jugador:** no se implementó el "lean" (inclinación del cuerpo); `miningPose` ya lo calcula.
- **Pulso de prospección** al abrir la tarjeta: no implementado.
- **Mochila:** ordenar o compactar no implementado; descartar borra sin confirmación (solo demo).
- **Lint:** los 9 warnings existentes de `vue/attributes-order` no se tocaron (fuera de alcance).

## 5. Reutilización para Tala, Pesca y Alquimia

| Pieza | Reutilizable tal cual | Qué cambia por profesión |
|---|---|---|
| `SceneOverlay` + tiles interactuables | Sí | — |
| `pixelArt.ts` (buffers, `brighten`, `mirror`, `toSprite`, `toDataUrl`) | Sí | — |
| `miningAction` (timeline) | Patrón | Tala: hachazos; Pesca: lanzar, esperar, tirón; Alquimia: remover |
| `miningRarity` + `particles` | Sí | Tonos (astillas, gotas de agua, burbujas) |
| `nodeVisualState` | Sí | Arte por estado (tocón, orilla calma, hierbas cortadas) |
| `useMiningController` / `MiningActionCard` | Patrón a generalizar en `useGatheringController` | Textos e íconos |
| `slotInventory` + `stackRules` + `InventoryGrid` | Sí, compartidos por todas las profesiones | — |
| Laboratorio y galería | Sí | Landmarks y registro de assets por profesión |

## 6. Siguiente paso sugerido

1. **R31-C2:** números de stacks y capacidad, y aprobación de A/B.
2. **Réplica visual:** repetir el kit para Tala, reutilizando las piezas de §5.
3. **R32:** contrato de servidor para contenedores y nodos (ver `INVENTORY_DESIGN.md` §8 y `MINING_INTERACTION_SPEC.md` §6 y §10).

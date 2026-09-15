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
| Trabajador | El Pokémon asignado aparece al lado del jugador durante la acción (`overworld/`), compartido por todas las profesiones |

## 2. Verificación

**Automática (en esta rama):**
- `vitest`: 76 archivos, 554 tests OK;
- `eslint`: 0 errores; 9 warnings en `AuthModal.vue`, anterior a esta rama;
- `vue-tsc` / `npm run typecheck`: OK;
- `npm run build`: OK;
- `dist/` sin strings del playground, laboratorio ni galería;
- diff sin secretos.

**En navegador real** (Vite dev con `.env.local` de placeholders, borrado al final):

| Verificado | Resultado |
|---|---|
| Laboratorio en desktop | El motor real renderiza Pradera |
| Tocar el nodo | El jugador llega al costado y se abre la tarjeta con estado, Pokémon, pico, chips y botones |
| Minar | La tarjeta colapsa a "Minando…". Se ven el pico, el destello y "+XP" sobre la roca. Al final: +1 Mineral de Hierro, +1 Carbón, +165 XP, −19,43 energía, −1 durabilidad, y "Seguir minando" |
| **Agotar un nodo** | 4 cargas de la veta de hierro: la cuarta deja "Agotado para vos · Se recupera en 3:18" con el botón deshabilitado y la roca sin mineral |
| **Respawn** | Adelantando el reloj de la demo, el nodo vuelve a estado disponible; el arte intermedio se revisó en la galería (RESPAWNING 1/3 y 3/3) |
| **Herramienta rota** | Durabilidad a 0: "Tu pico está roto · Reparalo para seguir", ícono de pico roto y Minar deshabilitado |
| **Reparación** | Sin materiales: "Faltan materiales: 2 Lingote de Hierro, 2 Carbón". Con el kit: "Reparado · usaste 2 Lingote de Hierro, 2 Carbón" y el máximo baja de 150 a 138 |
| **Rare drop** | Veta de oro con Nv. 30: ícono de oro subiendo con "+1", "+300 XP", cartel de hallazgo y "Nuevo espacio: Mineral de Oro" |
| **Mochila llena** | Preset "Llena": "Inventario lleno · Liberá espacio para seguir" y botón deshabilitado |
| **Pendientes** | Con "Casi llena", minar dio +2 hierro: "Stack de Mineral de Hierro completo" y "No entró: 1 Mineral de Hierro (queda pendiente)". Bajar la capacidad a 20 manda 4 stacks a "No entró"; "Recoger" los devuelve al haber lugar |
| **Trabajador en overworld** | Machamp aparece a la derecha del jugador al empezar el golpe, se queda toda la acción y se va al terminar. Cambiando a Onix en el selector del laboratorio, aparece la especie nueva en la acción siguiente |
| **Alcance** | Alejarse con la tarjeta abierta y tocar Minar cierra la tarjeta en lugar de minar a distancia |
| Galería | Estados en contexto (AVAILABLE, INTERACTABLE, TARGETED/IN_PROGRESS, LOCKED_LEVEL, SPECIAL_ACCESS, RARE, DEPLETED, RESPAWNING) y grupos por tipo |
| Móvil 375×812 | Sin scroll horizontal; la tarjeta abre con botones de 40 px o más; al minar colapsa y deja ver al jugador y la roca; el resultado se lee completo |

**Correcciones hechas durante estos recorridos:**
1. **Concordancia:** "Tu pico está rota" → "está roto", con "Reparalo/Reparala" y "Necesitás un/una" según la herramienta (con test).
2. **Kit de insumos:** no traía lingotes, así que un pico de hierro roto no se podía reparar en el playground; ahora incluye lingote de hierro, de acero y tablón.
3. **Cartel de rareza:** el oro decía "¡Hallazgo especial!"; ahora "¡Hallazgo raro!" y "especial" queda para el Fragmento Evolutivo.
4. **Pie de la tarjeta:** con tres botones se apretaba; ahora envuelve en dos filas.
5. **Mochila y tarjeta:** el cajón tapaba la tarjeta; ahora comparten una columna anclada abajo y el cajón se achica con scroll propio.
6. **Alcance de la acción:** minar exigía solo tener la tarjeta abierta; ahora exige estar al lado (`isBeside`).

**No verificado en navegador** (dicho con honestidad):
- **WildLands real (`WildlandsView`):** sin Supabase ni realtime el jugador queda como espectador y no se puede caminar. El laboratorio usa la misma clase `WildlandsGame`, el mismo overlay y el mismo controlador, pero no la vista completa.
- **Respawn cuadro por cuadro** en el mundo: se vio el estado agotado y el arte de respawn en la galería, no la transición completa in situ.
- **Trabajador desde los cuatro lados:** se verificaron nodo al norte (jugador desde el sur) y el cambio de especie. Norte, sur y este del jugador están cubiertos por tests puros (`workerPresence.test.ts`), no por captura.
- **Trabajador a 375 px:** la tarjeta y el minado sí; la posición del Pokémon en móvil no se capturó.
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
8. **Trabajador en overworld:** aparece al lado del jugador con su sprite normal, sin colisión ni animación por especie, y con una aparición de 0,22 s (ver `MINING_INTERACTION_SPEC.md` §9).
9. **Alcance:** alejarse del nodo cierra la tarjeta en lugar de bloquear el botón.

## 4. Límites y deuda

- **Todo es local:** sin persistencia, servidor ni protocolo. Otros jugadores no ven la minería.
- **DEPLETED sin respawn:** necesita contrato de agotamiento compartido (B-04).
- **Animación del jugador:** no se implementó el "lean" (inclinación del cuerpo); `miningPose` ya lo calcula.
- **Pulso de prospección** al abrir la tarjeta: no implementado.
- **Mochila:** ordenar o compactar no implementado; descartar borra sin confirmación (solo demo).
- **Trabajador:** no reacciona al golpe ni cambia de pose; si el jugador queda encajonado, no aparece. Otros jugadores no lo ven (es local).
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
| `overworld/workerPresence` + `workerCompanion` | Sí, ya es una pieza de profesiones | Nada: recibe el Pokémon activo y el nodo trabajado |
| `slotInventory` + `stackRules` + `InventoryGrid` | Sí, compartidos por todas las profesiones | — |
| Laboratorio y galería | Sí | Landmarks y registro de assets por profesión |

## 6. Siguiente paso sugerido

1. **R31-C2:** números de stacks y capacidad, y aprobación de A/B.
2. **Réplica visual:** repetir el kit para Tala, reutilizando las piezas de §5.
3. **R32:** contrato de servidor para contenedores y nodos (ver `INVENTORY_DESIGN.md` §8 y `MINING_INTERACTION_SPEC.md` §6 y §10).

# Plan — Ciudad Corazón como lobby integrado de PokeSwap

> Objetivo: que al entrar a PokeSwap el jugador aparezca en Ciudad Corazón y que **todo PokeSwap se use desde la ciudad**. Cada edificio abre una función real (Mercado, Swap, Dungeon, Pokédex, Perfil, Mi caja), la plaza muestra Pokémon y actividad reales en tiempo real, y las puertas llevan a los mundos.
>
> Contexto técnico: [`HANDOFF.md`](HANDOFF.md). Reglas que aplican: `AGENTS.md`, `docs/INVARIANTS.md`, `docs/TRUST_BOUNDARY.md`.

---

## Principios

1. **La ciudad es una interfaz, no una autoridad.** El lobby solo lee y muestra. Toda escritura (compras, swaps, dungeon, publicaciones) sigue pasando por las APIs y features existentes, que ya aplican las reglas del servidor.
2. **No duplicar features.** Las vistas actuales (`MarketView`, `SwapView`, `DungeonView`, `PokedexView`, `ProfileView`) se reutilizan como paneles sobre la ciudad. No se reescriben dentro del canvas.
3. **Siempre hay un camino sin juego.** Enlaces directos y un menú accesible para quien no quiera caminar (teclado, lector de pantalla, equipos lentos).
4. **Móvil primero.** Tap para caminar, paneles tipo hoja inferior y HUD compacto.
5. **Cada fase se puede desplegar sola** y deja la app funcionando.

---

## Mapa de edificios → funciones

| Edificio en la ciudad | Función de PokeSwap | Vista existente |
|---|---|---|
| Centro Pokémon | Mi caja (Pokémon propios) | `progression/useMyBox` (+ panel nuevo o sección de `ProfileView`) |
| Tienda | Mercado | `market/MarketView.vue` |
| Salón de Concursos | Swap | `swap/SwapView.vue` |
| Gimnasio | Dungeon | `dungeon/DungeonView.vue` |
| Club de Fans Pokémon | Pokédex | `pokedex/PokedexView.vue` |
| Casa de los Poffins | Perfil y progresión | `progression/ProfileView.vue` |
| Cartel junto al Centro Pokémon | Actividad reciente (tablón) | `map/useMapRealtime` (`activity_feed`) |
| Puertas de la ciudad | Mundos WildLands | ya implementado |

La asignación se puede cambiar editando datos en `areas/hearthome.ts`.

---

## Fase 0 — Consolidar el prototipo *(R24)* ✅ hecha (2026-09-13)

**Objetivo:** dejar la base segura y prolija antes de integrar.

- [x] Commit del trabajo actual en `feat/wildlands-prototype`, en 4 commits: fix de tipos, assets, prototipo y refactor R24.
- [x] PR hacia `migration`: [#3](https://github.com/terremotoparatodos/pokeswap/pull/3), con CI en verde. `main` está desfasada de `migration` (squash de #2), así que el preview de Cloudflare, que solo se despliega en PRs hacia `main`, llega cuando `migration` pase a `main`.
- [x] Agregar `src/vite-env.d.ts` para eliminar los errores de tipos preexistentes de `import.meta.env` (y `readonly` en `CombatSummary.rounds` para `DungeonView.vue`).
- [x] Partir `renderer.ts` (330: `lighting.ts`, `groundMarks.ts`) y `game.ts` (398: `travel.ts`, `keyboard.ts`, `dialogue.ts`). Comportamiento verificado con hashes de píxeles y de trazas de lógica, idénticos antes y después.
- [x] Decidido: `buildings.ts` se redujo a un bloque genérico por estilo (588 → ~65 líneas); `townProps.ts` se mantiene.
- [x] Verificado el build de producción: `public/assets/town`, `overworld`, `trainers` y `tilesets` llegan completos a `dist/`.

**Aceptación:** CI verde (tests, lint, tipos sin errores), preview desplegado y el prototipo igual que hoy.

---

## Fase 1 — La ciudad como home *(R25)* ✅ hecha (2026-09-13)

**Objetivo:** `/` abre Ciudad Corazón y las funciones se abren desde los edificios.

### Ruteo con paneles superpuestos
- [x] `/` renderiza `WildlandsView` (lobby). `HomeView` se eliminó: el camino sin juego son el menú y los links directos.
- [x] Las rutas de features pasan a ser **hijas del lobby**: `/mercado`, `/swap`, `/dungeon`, `/pokedex`, `/perfil`, `/caja`. Se renderizan en un `<router-view>` dentro de `LobbyPanel` (modal en escritorio, hoja inferior en móvil) y la ciudad sigue montada debajo.
- [x] `/market` y `/profile` redirigen a las nuevas; `/wildlands` redirige a `/` con su query y las rutas desconocidas a `/`. `/map` queda como página suelta hasta R29.
- [x] Botón Atrás del navegador, `Esc` y la ✕ cierran el panel. Los links directos abren la ciudad con el panel ya abierto.

### Puertas de edificios
- [x] `TownBuilding` suma `door: Tile` y `feature: LobbyFeature`. La puerta es el umbral caminable en la fila inferior del footprint, para no entrar al pasar por la vereda.
- [x] Pisar la puerta, o tocar el edificio (el personaje camina hasta ella), dispara `onEnterBuilding(id, feature)` y `WildlandsView` hace `router.push`. La lógica está en `engine/doors.ts`.
- [x] Mientras hay un panel (o el menú, o el login) abierto, el juego **pausa el input** y dibuja a ~10 fps.
- [x] Al cerrar un panel abierto por la puerta o por link directo, el personaje aparece frente a la puerta mirando hacia afuera.

### Interfaz
- [x] La barra superior se reemplaza por el botón **Menú** del HUD, con las 6 funciones (y su edificio) y los datos de sesión (usuario, tokens, Ingresar/Salir).
- [x] El HUD muestra los tokens del perfil (solo lectura, `useAuth`). Se relee el perfil al cerrar un panel.
- [x] Sin sesión el lobby se ve igual, y entrar a una función que la requiere abre `AuthModal`. El Mercado se puede ver sin sesión, como antes.
- [x] La ayuda de desarrollo (fps, teclas) solo se carga en desarrollo.
- [x] "Mi caja" es un panel propio (`MyBoxView`), movido desde `ProfileView`.

**Aceptación:**
- [x] Desde la ciudad se llega a las 6 funciones caminando y también desde el menú.
- [x] Los links directos funcionan y Atrás cierra paneles.
- [x] En móvil (375 px) todo se usa con tap.
- [x] Tests de ruteo, de `onEnterBuilding` y de puertas caminables desde el spawn (`atlas.test.ts`, `doors.test.ts`).
- [x] Motor equivalente fuera de lo nuevo: hashes de trazas de lógica idénticos antes y después.
- [ ] Antes de promover a `main`: pasar `pokeswap.lol` a Cloudflare Pages y probar links directos en el preview.

---

## Fase 2 — La plaza con datos reales *(R26)*

**Objetivo:** la ciudad refleja el estado real de PokeSwap y reemplaza al mapa legado (`/map`).

- [ ] Llevar al lobby las reglas de `map/useMapEntities` (sin duplicarlas: extraerlas a funciones puras que compartan ambos):
  - **Pokémon con dueño visibles:** top 10 por precio y los del usuario pasean por la plaza (reemplazan a los 5 Pokémon decorativos).
  - Se usa la hoja overworld de cada especie; tocar uno muestra nombre, dueño y precio, con acceso al Mercado.
- [ ] Suscribirse a `slots` con `useMapRealtime`: cambios de dueño o precio actualizan en vivo a los Pokémon de la plaza (entran, salen, cambian de cartel).
- [ ] **Tablón de actividad** (cartel junto al Centro Pokémon) con `activity_feed`, y toasts discretos para eventos nuevos.
- [ ] Los Pokémon del usuario tienen un distintivo (brillo o marcador) para encontrarlos rápido.
- [ ] Todo es lectura. Ningún cambio de posición o interacción escribe en la base (`TRUST_BOUNDARY` §2).

**Aceptación:**
- Una compra o swap hecho en otra pestaña se refleja en la plaza en segundos.
- Con 0, 10 o muchos slots con dueño la plaza sigue fluida (medir ms/frame; objetivo menor a 6 ms en escritorio).

---

## Fase 3 — Identidad del jugador *(R27)*

**Objetivo:** que el personaje sea "tuyo".

- [ ] Nombre de usuario sobre el personaje (texto escapado, `INV-ID-4`).
- [ ] **Pokémon acompañante:** el jugador elige uno de sus Pokémon (de `useMyBox`) que lo sigue caminando.
- [ ] Elección de personaje (protagonista hombre, mujer y futuros) cuando haya más hojas. Requiere guardar la preferencia:
  - Opción A: `localStorage` (cosmético, sin backend).
  - Opción B: columna en `profiles` actualizada por el propio usuario vía RLS. Revisar con `docs/BACKEND_INVENTORY.md` antes de migrar.
- [ ] Recordar la última posición en la ciudad (solo `localStorage`, cosmético).

**Aceptación:** al recargar, el jugador ve su nombre, su acompañante y su personaje elegido. Sin sesión se usa un aspecto por defecto.

---

## Fase 4 — Mundos conectados a PokeSwap *(R28)*

**Objetivo:** que salir por las puertas tenga sentido de juego, sin romper la economía.

- [ ] Los Pokémon salvajes de los mundos usan el **pool rotativo** del mapa legado (`_rollWildPool`: legendarios 2%, aura alta 12%, resto) filtrado por tipo de bioma, en lugar de toda la Pokédex.
- [ ] Tocar un salvaje abre su ficha de Pokédex y, si está libre, lleva al flujo de Swap o Mercado correspondiente.
- [ ] Cristales y recompensas: **desactivados** hasta tener una RPC o Edge Function que valide (`AGENTS.md` §2). Alternativa: dejarlos como coleccionable puramente visual y rotularlo claramente.

**Aceptación:** no existe ninguna escritura nueva desde el cliente. Las interacciones de los mundos solo abren features que ya validan en el servidor.

---

## Fase 5 — Retiro del mapa legado y pulido *(R29)*

- [ ] Eliminar `features/map/components/MapView.vue` y su ruta `/map` (redirigir a `/`) una vez que la Fase 2 cubra sus funciones. Conservar `useMapRealtime` y las reglas de entidades si se reutilizaron.
- [ ] Evaluar si `public/assets/tiles/*.png` (mapas de Platino) siguen siendo necesarios.
- [ ] **Carga:**
  - Pantalla de carga con precarga de `public/assets/town/*` (~38 KB) y del protagonista.
  - Overworld de Pokémon bajo demanda (ya funciona así).
  - Code-splitting del motor (ya es un chunk propio de ~34 KB gzip).
- [ ] **Móvil:** barra de navegación reemplazada por el HUD, zoom automático revisado en varios tamaños y pausa del loop con la pestaña oculta (`visibilitychange`).
- [ ] **Accesibilidad:** menú navegable con teclado, textos alternativos en el HUD y opción "reducir movimiento" (sin lluvia ni fundidos).
- [ ] Interiores del Centro Pokémon, Tienda y Gimnasio (opcional): áreas pequeñas con cámara más cenital (el soporte de cámara por área ya existe).

**Aceptación:** una sola entrada al producto (la ciudad), sin rutas huérfanas, Lighthouse móvil aceptable y sin regresiones en los tests de las features.

---

## Más adelante (fuera de este plan)

- **Online en tiempo real:** otros jugadores caminando en la ciudad (Colyseus con sala "lobby"). El modelo de áreas y movimiento por casillas ya está preparado para enviar eventos de paso.
- **Arte propio:** reemplazar los assets de Nintendo por arte con licencia antes de un lanzamiento público.
- **Más ciudades** con el mismo formato (`TownDef` + terreno + hoja de arte).

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Propiedad intelectual del arte | Mantener PNGs aislados en `public/assets/*` para reemplazarlos sin tocar código |
| Rendimiento en móviles modestos | Medir ms/frame por fase; bajar resolución interna o fps con el panel abierto |
| Complejidad de ruteo con paneles | Rutas hijas bien tipadas, tests de navegación y redirecciones para links viejos |
| Jugadores que no quieren caminar | Menú con acceso directo desde el día uno |
| Features que dependen del layout de página completa | Adaptar sus contenedores a panel (ancho fluido) antes de integrarlas |

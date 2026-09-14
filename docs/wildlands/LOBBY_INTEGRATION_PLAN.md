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
| Cartel junto al Centro Pokémon | Actividad reciente (tablón) | `wildlands/lobby/usePlazaRealtime` (`activity_feed`) |
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

## Fase 1 — La ciudad como home *(R25)* ✅ hecha (2026-09-13, en producción el 2026-09-14)

**Objetivo:** `/` abre Ciudad Corazón y las funciones se abren desde los edificios.

### Ruteo con paneles superpuestos
- [x] `/` renderiza `WildlandsView` (lobby). `HomeView` se eliminó: el camino sin juego son el menú y los links directos.
- [x] Las rutas de features pasan a ser **hijas del lobby**: `/mercado`, `/swap`, `/dungeon`, `/pokedex`, `/perfil`, `/caja`. Se renderizan en un `<router-view>` dentro de `LobbyPanel` (modal en escritorio, hoja inferior en móvil) y la ciudad sigue montada debajo.
- [x] `/market` y `/profile` redirigen a las nuevas; `/wildlands` redirige a `/` con su query y las rutas desconocidas a `/`.
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
- [x] Antes de promover a `main`: `pokeswap.lol` pasó a Cloudflare Pages y los links directos se probaron en el preview y en producción ([#7](https://github.com/terremotoparatodos/pokeswap/pull/7)).

---

## Fase 2 — La plaza con datos reales *(R26)* ✅ hecha (2026-09-13)

**Objetivo:** la ciudad refleja el estado real de PokeSwap y reemplaza al mapa legado (`/map`).

- [x] Llevar al lobby las reglas de `map/useMapEntities` sin duplicarlas: se extrajeron a `map/domain/ownedSlots.ts` y las usan el mapa y la plaza.
  - **Pokémon con dueño visibles:** por decisión de producto, en la plaza **solo se ve el top 10 por precio**. Los del usuario fuera del top no se agregan (el acompañante llega en R27). El mapa legado conserva top 10 + los del usuario. Los 5 Pokémon decorativos se eliminaron.
  - Se usa la hoja overworld de cada especie, o una Poké Ball si no hay hoja ni sprite. Tocar uno muestra nombre, dueño y precio, con acceso al Mercado.
- [x] Suscripción a `slots` con `usePlazaRealtime`: los cambios de dueño o precio actualizan la plaza en vivo (entran, salen, cambian de cartel). Al reconectar se vuelve a leer.
- [x] **Tablón de actividad** (cartel junto al Centro Pokémon y Menú → Actividad) con `activity_feed`. Hay toasts discretos para eventos nuevos y para cuando un Pokémon del usuario cambia de dueño.
- [x] Los Pokémon del usuario tienen un distintivo: un rombo amarillo sobre la cabeza.
- [x] Todo es lectura. Hay tests de que ningún módulo nuevo escribe (mock que falla ante escrituras y escaneo de fuentes).

**Aceptación:**
- [x] Una compra o swap hecho en otra pestaña se refleja en la plaza en segundos: los patches se aplican a los 250 ms. Se verificó con eventos de Realtime inyectados en la app; la prueba con una compra real la hace una persona.
- [x] Con 0, 10 o la plaza saturada (23) sigue fluida: 2,9 / 3,0 / 3,2 ms/frame en escritorio (p95 ≤ 3,7). Con 5.000 slots, las reglas tardan < 1 ms por lote.
- [x] Motor equivalente fuera de lo nuevo: hashes de lógica, HUD y píxeles idénticos antes y después.

---

## Fase 3 — Identidad del jugador *(R27)* ✅ hecha (2026-09-14)

**Objetivo:** que el personaje sea "tuyo".

- [x] Nombre de usuario sobre el personaje mediante `canvas.fillText`, sin interpretar HTML (`INV-ID-4`) y con ancho visual acotado.
- [x] **Pokémon acompañante:** el jugador elige uno de `useMyBox`; se valida contra la caja server-backed, se descarta si deja de ser propio o queda bloqueado y sigue el rastro del jugador sin colisión, picking ni pathfinding propio.
- [x] Elección entre las tres hojas disponibles (entrenador, entrenadora rosa y entrenadora amarilla). Las preferencias usan `localStorage` versionado y separado por `user.id`; no se agregaron columnas ni mutaciones en `profiles`.
- [x] Última posición segura de Ciudad Corazón recordada por usuario. Links con coordenadas, puertas y portales conservan prioridad y nunca se restauran como posición persistida.
- [x] Sección **Jugador** dentro de Mi caja, mobile-first, con Pokémon bloqueados visibles pero no seleccionables.
- [x] Sin sesión: aspecto predeterminado, sin nombre, sin acompañante y caja compartida limpiada en memoria.

**Aceptación:** 435 tests pasan; lint sin errores, tipos y build OK. Persistencia, ownership/lock, sesión tardía/logout, seguimiento, transición de área, fallbacks de arte y username hostil tienen tests. La escena y la traza lógica base mantienen hashes SHA-256 idénticos a `migration`; la ciudad y el viaje a un mundo se probaron vivos en escritorio y el lobby en 375 px.

---

## Fase 4 — Mundos conectados a PokeSwap *(R28)* ✅ hecha (2026-09-14)

**Objetivo:** que salir por las puertas tenga sentido de juego, sin romper la economía.

- [x] Los Pokémon salvajes usan el pool rotativo compartido `pokemon/domain/wildPool.ts`: legendarios 2%, aura alta 12% y resto 86%, sin dueño, sin duplicados y filtrado por bioma al poblar chunks. El mapa legado lo consume temporalmente hasta R29.
- [x] El pool es único por sesión y rota cada 60 minutos; viajar entre áreas no lo reinicia. Los patches de `slots` existentes lo filtran inmediatamente y la reconexión relee el snapshot.
- [x] Tocar o mirar un salvaje abre una ficha pública, segura y de solo lectura. Desde allí se navega a los paneles existentes de Pokédex, Mercado o Swap; no preselecciona especie ni hace mutaciones. Pokédex se mantiene como ficha informativa pública en WildLands, ya que su panel existente requiere sesión.
- [x] Cristales y recompensas siguen siendo visuales: el HUD y el toast indican “demo, no se guarda”; no hay RPC, Edge Function, escritura ni autoridad persistente.

**Aceptación:** no existe ninguna escritura nueva desde el cliente. Las interacciones de los mundos solo abren features que ya validan en el servidor.

---

## Fase 5 — Retiro del mapa legado y pulido *(R29)* ✅ hecha (2026-09-14)

- [x] Eliminar `features/map/components/MapView.vue` y todo el feature legado; `/map` redirige a `/` preservando query.
- [x] Retirar `public/assets/tiles/*.png`, exclusivos del mapa legado. Las lecturas, reglas de slots y Realtime viven ahora bajo `wildlands/lobby/`.
- [x] **Carga:**
  - Pantalla de carga con precarga de `public/assets/town/*` (~38 KB) y del protagonista.
  - Overworld de Pokémon bajo demanda (ya funciona así).
  - Code-splitting del motor (ya es un chunk propio de ~34 KB gzip).
- [x] **Móvil:** barra de navegación reemplazada por el HUD, zoom automático revisado y pausa segura del loop con la pestaña oculta (`visibilitychange`).
- [x] **Accesibilidad:** menú enfoca su primera opción al abrirse, HUD/minimapa/canvas tienen etiquetas y `prefers-reduced-motion` quita lluvia y fundidos.
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

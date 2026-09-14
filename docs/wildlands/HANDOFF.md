# WildLands — Traspaso de contexto

> Documento de respaldo para retomar el trabajo en otra conversación.
> Estado al **2026-09-14**, tras **R25 (La ciudad como home)**: mergeada en `migration` ([#6](https://github.com/terremotoparatodos/pokeswap/pull/6)) y en producción en https://pokeswap.lol ([#7](https://github.com/terremotoparatodos/pokeswap/pull/7)).
> Plan siguiente: [`LOBBY_INTEGRATION_PLAN.md`](LOBBY_INTEGRATION_PLAN.md).

---

## 1. Qué es

WildLands es el mundo explorable de PokeSwap, con estética de Pokémon DS (Platino):

- **Lobby:** Ciudad Corazón, recreada con el motor propio y sprites dibujados a mano.
- **Mundos:** 5 mundos procedurales infinitos a los que se viaja por las puertas de la ciudad.
- **Controles:** click/tap para caminar (pensado para móvil) y teclado como alternativa.
- **Home de PokeSwap (R25):** `/` es la ciudad. Cada función se abre en un panel sobre la ciudad, entrando a su edificio o desde el botón **Menú**.
- **Alcance:** el motor es **cosmético y del lado del cliente**. La ciudad solo lee (tokens del perfil en el HUD) y navega. Toda escritura sigue dentro de las vistas de las features (ver `AGENTS.md` §2 y `docs/TRUST_BOUNDARY.md`).

Ruta: `/` (la vieja `/wildlands` redirige conservando la query). Parámetros de URL útiles:

| Parámetro | Efecto |
|---|---|
| `?x=31&y=20` | Aparecer en esa casilla (si no es sólida) |
| `?area=desierto` | Arrancar en un mundo: `pradera`, `bosque`, `desierto`, `tundra`, `costa` |

### Rutas (R25)

| Ruta | Qué muestra | Edificio | Requiere sesión |
|---|---|---|---|
| `/` | Ciudad Corazón | — | no |
| `/mercado` | `MarketView` | Tienda | no (publicar sí, como antes) |
| `/swap` | `SwapView` | Salón de Concursos | sí |
| `/dungeon` | `DungeonView` | Gimnasio | sí |
| `/pokedex` | `PokedexView` | Club de Fans Pokémon | sí |
| `/perfil` | `ProfileView` (stats, recolectar, ledger) | Casa de los Poffins | sí |
| `/caja` | `MyBoxView` (Mis Pokémon + vender) | Centro Pokémon | sí |
| `/map` | Mapa legado, página suelta con "← Ciudad" | — | — |

- Redirecciones: `/market` → `/mercado`, `/profile` → `/perfil`, `/wildlands` → `/` y cualquier otra ruta → `/`.
- Las funciones son rutas hijas de `lobby` (`src/app/router/routes.ts`) y los nombres de ruta coinciden con `LobbyFeature` (`lobby/features.ts`).
- **Atrás, Esc y la ✕ cierran el panel.** Si el panel se abrió desde la ciudad, se hace `router.back()`. Si fue por link directo, `router.replace('/')`.
- **Link directo:** la ciudad arranca con el personaje en la puerta del edificio y el panel ya abierto.
- **Sin sesión:** una función que la requiere abre `AuthModal`. Si se cierra sin ingresar, vuelve a `/`. Si se ingresa, se muestra el panel.
- **Salir del panel:** si se había entrado por la puerta o por link, el personaje aparece frente a la puerta mirando hacia abajo. Si se abrió desde el menú, se queda donde estaba.
- **Pausa con panel, menú o login abiertos:** se ignoran toques, arrastre y teclado (`keys.detach()`, así escribir en un input no mueve al personaje), y el loop dibuja a ~10 fps (`PAUSED_FRAME_MS`).

---

## 2. Cómo correrlo y verificarlo

```bash
npm run dev          # http://localhost:5173/
npx vitest run src/features/wildlands
npx eslint src/features/wildlands
npx vue-tsc --noEmit -p tsconfig.app.json
npm run build
```

**Estado de checks al cierre de R25:** 315 tests del proyecto pasan, `eslint .` sin errores (13 warnings de orden de atributos, previos, en `AuthModal.vue` y `MapView.vue`), `vue-tsc -p tsconfig.app.json` en cero errores y build OK. R25 sumó tests de ruteo (`routes.test.ts`), del panel (`useLobbyPanel.test.ts`), de `panelAccess`, de puertas (`doors.test.ts` y `atlas.test.ts`), del menú y de `MyBoxView`.
- R24 agregó `src/vite-env.d.ts` (tipos de `import.meta.env`) y marcó `CombatSummary.rounds` como `readonly` (el error de `DungeonView.vue`).
- `npm run typecheck` (lo que corre CI) usa `tsconfig.json`, que solo tiene `references` y no chequea nada sin `-b`. Para chequear de verdad hay que usar `-p tsconfig.app.json`. `tsconfig.node.json` (`vite.config.ts`) tiene errores propios, previos y fuera del alcance de WildLands.
- El build copia `public/assets/*` completo a `dist/` (verificado: `town`, `overworld`, `trainers` y `tilesets`).

### Trucos de verificación visual (panel Browser de la app)

- **Frames congelados.** El panel pausa `requestAnimationFrame` cuando está oculto, así que una captura puede mostrar un frame viejo. Sacar 2–3 capturas seguidas, o simular la lógica en la página con `await import('/features/wildlands/engine/...')`.
- **Capturas 1:1.** Usar `resize_window 800×520`; con 1400×900 la captura sale reducida.
- **Vista cenital de depuración.** Instanciar `new TownArea(HEARTHOME)` en la página (import dinámico de `areas/atlas.ts` y `areas/townArea.ts`), llamar `drawGround` + `decorIn` sobre un canvas propio y superponerlo con `position: fixed`. Así se detectaron las sombras y líneas mal ubicadas.
- **Cámaras alternativas.** La tecla `V` cambia de cámara **solo en desarrollo** (`isDev`). Los jugadores siempre ven la cámara del área (Portátil).
- **Juego vivo desde la consola.** `document.querySelector('.wl').__vueParentComponent.setupState.game` da la instancia. Con el panel oculto, `requestAnimationFrame` no corre, así que hay que avanzar a mano con `game.update(1/60)` y dibujar con `game.renderer.render(game.scene(), 1/60)` antes de capturar o hacer click. Así se verificaron en R25 la entrada con teclado y con tap, la pausa y la salida por la puerta.
- **Página sin juego para la equivalencia.** Desde R25 `/` corre el juego, así que el trazo se ejecuta en una URL del mismo origen sin la app, por ejemplo `/assets/town/mart.png`.
- **Equivalencia de refactors (usada en R24 y R25).** Desde `/` (sin el juego corriendo), reemplazar `Math.random` por un generador sembrado, renderizar escenas fijas con `new Renderer(canvas)` (ciudad de día y de noche, fundido, costa con lluvia) y hashear `getImageData` con `crypto.subtle.digest`. Para la lógica, crear `new WildlandsGame(canvas, …)` sin `start()` y llamar `game.update(1/60)` en un bucle con toques, teclas y viajes, hasheando posiciones, cámara, fundido y HUD. Esperar ~2,5 s antes para que carguen los PNG. Correrlo antes y después del cambio y comparar.

---

## 3. Arquitectura (`src/features/wildlands/`)

```text
components/
  WildlandsView.vue  Vista del lobby: canvas, punteros, minimapa; compone HUD, menú, panel y AuthModal
  LobbyHud.vue       Píldora inferior: lugar, clima, hora, cristales y "Ciudad"
  LobbyMenu.vue      Botón Menú + tokens (solo lectura); hoja con las 6 funciones y la sesión
  LobbyPanel.vue     Panel de función: modal en escritorio, hoja inferior en ≤720 px
  DevHelp.vue        Ayuda de teclas y fps; se carga solo en desarrollo (no llega al build)
lobby/
  features.ts        LobbyFeature, títulos, qué requiere sesión, panelAccess()
  useLobbyPanel.ts   Ruta → panel abierto, cierre por historial, Esc, origen (door/menu/link)
engine/
  game.ts          Loop, cámara, jugador y NPCs, interacción, HUD
  travel.ts        Viajes entre áreas (fundido) y aviso de puertas cercanas
  doors.ts         Puertas de edificios: umbral caminable, tap en edificio → caminar a la puerta,
                   entrada (onEnterBuilding) y posición de salida
  keyboard.ts      Teclas mantenidas, Shift para correr, d-pad virtual y teclas de acción
  dialogue.ts      Frases de Pokémon y NPCs
  renderer.ts      Suelo Mode-7 por filas, sprites billboard, techos aplastados (flatTop),
                   sombras, picking
  lighting.ts      Tinte día/noche, luz del jugador y faroles, lluvia, viñeta, fundido, destellos
  groundMarks.ts   Marcas planas sobre el suelo: grilla, almohadillas de portal, ruta
  projection.ts    Cámara (LENSES; se usa 'handheld'), project/unproject
  area.ts          Interfaz Area + Portal (ciudad y mundos implementan lo mismo)
  actors.ts        Movimiento por casillas (driveWalker: sin tirones, tap-para-girar,
                   empuje), wander de NPCs, NPCs estacionarios con diálogo
  navigator.ts     Tap-to-move: planifica, re-planifica, llega junto a actor/obstáculo
  pathfinding.ts   A* acotado (radio y nodos)
  characters.ts    Trainer ASCII de respaldo, hojas overworld de Pokémon (2 frames x 4 dir),
                   hoja del protagonista (walk/run) y recoloreo HSL de NPCs
  population.ts    Pokémon salvajes por bioma/tipo + NPCs en mundos; loadPokemonInfo (caché)
  world.ts         Mundo procedural: biomas, terreno por vértices, decoración, findSpawn
  chunks.ts        Horneado de chunks 32x32 con autotiling dual-grid
  terrainArt.ts    Texturas de terreno y agua animada generadas por código
  noise.ts         hash2 / valueNoise / fbm deterministas
  atmosphere.ts    Ciclo de día (240 s), clima regional, partículas
  townGround.ts    Suelo de ciudad: calle, plazas, manzanas (plots), veredas (aprons),
                   canteros de arbustos, sombras de postes, fuentes horneadas de respaldo
  buildings.ts     Bloque genérico (techo, pared, puerta) por estilo: respaldo mientras carga
                   o si falla un PNG
  townProps.ts     Props de ciudad pintados por código: respaldo (el chorro de fuente marca posición)
  props.ts / sprite.ts / painter.ts / pixels.ts / minimap.ts   Utilidades de sprites y pixel art
areas/
  atlas.ts         LOBBY_ID ('ciudad-corazon'), WORLDS (5 mundos con semilla), Atlas (caché)
  hearthome.ts     Definición de Ciudad Corazón: edificios+sprites, props, manzanas, puertas,
                   residentes con frases, paseantes, Pokémon de la ciudad, carteles
  hearthomeTerrain.ts  Terreno 64x49 (s calle, g pasto, p plaza, t bosque) trazado del mapa
  townArea.ts      Area de ciudad: colisión, carga de arte PNG con respaldo, re-horneado
  wildArea.ts      Area de mundo procedural + almohadilla de regreso al lobby
```

Otros cambios fuera de la carpeta:
- `src/app/router/routes.ts`: tabla de rutas (lobby + hijas, redirecciones, `/map` suelta). `index.ts` solo crea el router.
- `src/app/App.vue`: sin barra superior. Solo `<router-view>` y "← Ciudad" en páginas `meta.standalone`. `HomeView` se eliminó.
- `src/features/progression/components/MyBoxView.vue`: la sección "Mis Pokémon" se movió desde `ProfileView`, que ahora enlaza a `/caja`.
- `src/features/auth/composables/useAuth.ts`: `refreshProfile()` (solo lectura), llamado al cerrar un panel para actualizar los tokens del HUD.
- `src/shared/utils/devTools.ts`: se exporta `isDev`.

### Puertas de edificios (R25)

- **Datos.** `TownBuilding.door` es la casilla del umbral, en la fila inferior del footprint, y `TownBuilding.feature` es la función. Se cargan en `hearthome.ts`: Centro Pokémon (17,19), Tienda (30,29), Salón de Concursos (31,14), Gimnasio (51,19), Club de Fans (11,29) y Casa de los Poffins (41,29).
- **Por qué el umbral está dentro del footprint** y no en la vereda: pasar caminando por delante no entra por accidente. `TownArea` lo marca caminable, los NPCs lo tratan como bloqueado (igual que los portales) y `nearestOpen` lo evita.
- **Entrada.** Pisar el umbral dispara `onEnterBuilding(buildingId, feature)` y `WildlandsView` hace `router.push`. Tocar el edificio (footprint más 2 filas de fachada por encima, `TAP_REACH_ROWS`) camina hasta la puerta. Tocar a un personaje delante del edificio sigue hablándole.
- **Motor.** `game.ts` solo tiene los enganches: `setPaused`, `placeAtDoor`, `Entrances.retarget` en `tap` y `Entrances.arrive` al llegar a una casilla.

### Deuda técnica conocida

- **`game.ts` (433 líneas tras R25).** La lógica de puertas está en `doors.ts`; en `game.ts` quedaron los enganches (~35 líneas) y la extracción de `placePlayer`. Candidatos si vuelve a crecer: el suavizado de clima (a `atmosphere.ts`) y la carga de hojas de personajes (a `characters.ts`).
- **Tamaño de archivos (resuelto en R24).** `renderer.ts` bajó a 330 líneas (efectos en `lighting.ts`, marcas en `groundMarks.ts`) y `game.ts` a 398 (`travel.ts`, `keyboard.ts`, `dialogue.ts`). `buildings.ts` pasó de 588 a ~65 líneas: un bloque genérico por estilo en lugar de edificios detallados que solo se veían si fallaba un PNG. `game.ts` quedó justo bajo el umbral; lo próximo que crezca (puertas de edificios en R25) debería ir en un módulo propio.
- **`WildlandsView.vue`:** bajó de 403 a ~320 líneas en R25 al separar `LobbyHud`, `LobbyMenu`, `LobbyPanel` y `DevHelp`.
- **Ahorro de trabajo en ciudad:** `TownArea.decorIn` filtra ~700 elementos por frame (hoy ~3 ms/frame en total). Una grilla espacial ahorraría trabajo si la ciudad crece.
- **Cámara de desarrollo:** `LENSES.dramatic` y `cenital` quedan solo para pruebas.

---

## 4. Assets y procedencia

| Carpeta | Contenido | Origen |
|---|---|---|
| `public/assets/overworld/NNNN.png` y `shiny/` | Hojas overworld por especie (ids 1–493), 4 dir x 2 frames | Repo del usuario `terremotoparatodos/sprites-overworld`, empaquetadas en local (raw.githubusercontent limita requests) |
| `public/assets/trainers/protahombre/*.gif` | Protagonista masculino de Platino (Walk/Run N/S/E/W) | Aportado por el usuario |
| `public/assets/trainers/protahombre.png` | Hoja 8x4 generada desde los GIFs | Generada |
| `public/assets/tilesets/buildings.png` | Hoja de edificios y props estilo DS | Aportada por el usuario |
| `public/assets/town/*.png` | Piezas recortadas de la hoja | `python scripts/extract_town_sprites.py` |
| `public/assets/tiles/hearthome.png` | Mapa de Ciudad Corazón de Platino | Ya existía en el repo; lo usa `/map` (legado). WildLands solo lo usó como referencia |

⚠️ **Propiedad intelectual.** El arte de Pokémon (hojas, GIFs, mapa) es material de Nintendo/Game Freak. Sirve para el prototipo, pero antes de un lanzamiento público o monetizado conviene reemplazarlo por arte propio o con licencia. El motor ya lo permite: cada sprite es un PNG con respaldo.

Para agregar personajes nuevos: carpeta en `public/assets/trainers/<nombre>/` con 4 GIFs de caminar (WalkN/S/E/W, 32x32, 4 frames). Se empaquetan igual que `protahombre` y el motor acepta hojas sin frames de correr.

---

## 5. Decisiones tomadas (y por qué)

1. **Motor propio en Canvas 2D, sin dependencias.** Proyección tipo Mode 7 por filas, con sprites como billboards.
2. **Una sola cámara (Portátil)** para el jugador: el arte DS está pensado para esa inclinación. Las otras quedan solo para desarrollo.
3. **Tap/click para moverse como control principal**, para que funcione en móvil. El teclado sigue disponible y tiene prioridad.
4. **Movimiento estilo Gen 4:** 3,75 casillas/s, sin pausas entre casillas, toque corto para girar y caminar en el lugar contra obstáculos.
5. **Ciudades antes que online.** El online se planificó para más adelante con Colyseus en São Paulo (Fly.io ~USD 5–10/mes para 50 simultáneos; Supabase queda para cuentas y economía). No hay nada implementado.
6. **Ciudad Corazón como lobby, recreada con el motor.** Primero se usó la imagen de Platino, después edificios pintados por código (el usuario los juzgó insuficientes) y finalmente **sprites de la hoja**, que es la dirección elegida.
7. **Asignación de edificios (hoja → ciudad):**
   - Salón de Concursos = edificio con cúpula y 4 faroles; Centro Pokémon, Tienda y Gimnasio = los de la hoja.
   - Casas = verde y azul; Departamentos = dos edificios marrones.
   - Casa de los Poffins = tienda violeta con toldo rosa.
   - **La catedral no existe en la hoja:** su lugar lo ocupa "Club de Fans Pokémon" (casa de techo rojo).
   - Plaza Amistad = caseta con escaleras; portones de ruta = edificio azul con puerta.
8. **Acabados de suelo:**
   - **Manzanas (plots):** ladrillo en tono medio con cordón, trazadas del original.
   - **Veredas:** solo para edificios fuera de una manzana.
   - **Sin sombras de contacto horneadas bajo edificios:** el zócalo del sprite ya cumple esa función, y una franja extra se veía como línea.
9. **Personas pintadas del mapa original → NPCs reales** parados en esos lugares, con frases.
10. **Recompensas.** Los cristales de los mundos son demo ("no se guarda"). Cualquier recompensa real debe pasar por RPC o Edge Function.

---

## 6. Pendientes y detalles menores

- **Bancos:** la hoja los dibuja vistos desde arriba y parecen tablones.
- **Portón sur:** su techo tapa parcialmente el portal que tiene encima (el viaje funciona igual).
- **Edificios sin interiores:** los 6 edificios con función abren su panel. El resto (casas, departamentos, portones) sigue mostrando nombre y descripción al mirarlos.
- **Vistas de features en panel:** `LobbyPanel` oculta el primer `<h2>` de cada vista (el título ya está en el encabezado) y ajusta su margen con `:deep(main)`. La tabla del Mercado en 375 px usa su propio scroll horizontal.
- **Combate de Dungeon sin enviar:** cerrar el panel desmonta la vista y lo pierde, igual que navegar a otra página antes de R25.
- **Dominio (resuelto el 2026-09-14):** `pokeswap.lol` y `www.pokeswap.lol` los sirve Cloudflare Pages (proyecto `pokeswap`); `pokeswap.pages.dev` sigue funcionando.
  - **DNS:** administrado en Cloudflare. El dominio sigue registrado en GoDaddy, con los nameservers apuntando a Cloudflare.
  - **Supabase Auth:** Site URL `https://pokeswap.lol` y Redirect URLs para el dominio, `www`, `pages.dev`, los previews (`*.pokeswap.pages.dev`) y `localhost`. El login con Google funciona en producción.
  - **GitHub Pages:** desactivado, sin custom domain ni branch.
  - **Links directos:** funcionan en producción gracias al fallback SPA de Cloudflare Pages (no hay `404.html`).
- **Mundos:** Pokémon salvajes elegidos por tipo de bioma sobre toda la Pokédex, no con las reglas de pool del mapa legado.
- **Barra de navegación de PokeSwap:** eliminada en R25 (la reemplaza el Menú del HUD).
- **Flujo de ramas:**
  - Cada fase va en una rama desde `migration`, con PR hacia `migration`.
  - Para publicar, se abre un PR `migration` → `main`. Cloudflare despliega un preview en los PRs hacia `main` y producción al mergear (`.github/workflows/deploy.yml`).
  - Siempre se mergea con **Create a merge commit**, nunca squash.
  - Historial: prototipo y R24 en [#3](https://github.com/terremotoparatodos/pokeswap/pull/3), sincronización en #5, R25 en [#6](https://github.com/terremotoparatodos/pokeswap/pull/6) y su promoción en [#7](https://github.com/terremotoparatodos/pokeswap/pull/7).
- **Protagonistas sin usar:** `public/assets/trainers/dawnrosa/` y `dawmamarillo/` (GIFs de caminar) están commiteados pero no se usan todavía. Quedan para la elección de personaje (R27).
- **Tileset fuente:** `public/assets/tilesets/buildings.png` solo lo usa `scripts/extract_town_sprites.py`, pero se publica igual en el build (188 KB).

---

## 7. Cómo retomar en una conversación nueva

Pegar algo como:

> Seguimos WildLands de PokeSwap. Leé `docs/wildlands/HANDOFF.md` y `docs/wildlands/LOBBY_INTEGRATION_PLAN.md`, creá la rama de la fase desde `migration` actualizada y arrancá por la fase que indique.

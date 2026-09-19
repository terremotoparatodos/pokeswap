# WildLands — Traspaso de contexto

> Documento de respaldo para retomar el trabajo en otra conversación.
> Estado tras **R30 (Presencia multijugador efímera)**: cerrada y publicada en producción el 2026-09-15. PR [#19](https://github.com/terremotoparatodos/pokeswap/pull/19) incorporó el cierre operativo y PR [#20](https://github.com/terremotoparatodos/pokeswap/pull/20) corrigió la visibilidad al minimizar. R29 (Retiro del mapa legado y pulido) fue fusionada en `migration` mediante merge commit `f6d6d80` (PR [#14](https://github.com/terremotoparatodos/pokeswap/pull/14)).
> R25 (La ciudad como home) está en `migration` ([#6](https://github.com/terremotoparatodos/pokeswap/pull/6)) y en producción en https://pokeswap.lol ([#7](https://github.com/terremotoparatodos/pokeswap/pull/7)).
> Respaldo operativo: [`R30_PRODUCTION_HANDOFF.md`](R30_PRODUCTION_HANDOFF.md). El plan cerrado está en [`R30_MULTIPLAYER_PLAN.md`](R30_MULTIPLAYER_PLAN.md), complementado por [`LOBBY_INTEGRATION_PLAN.md`](LOBBY_INTEGRATION_PLAN.md).
> **R33 (Estaciones productivas)** está entregada en `feat/r33-stations-product` y pendiente de gate humano. Agrega el contrato compartido de estaciones, footprints mayores a 1×1 en `PlacedObjects` y el primer proceso real —`mineral → Horno → lingote`— en el mundo de profesiones dev-only. No toca la ciudad, ni Dungeon, ni servidor, ni persistencia. Lo que **sí** entra al bundle de producción son 751 bytes del motor (footprints multi-tile); las estaciones son código apto para producción que ninguna ruta productiva importa todavía, y el Horno de Pradera es un fixture del harness dev-only, no una integración productiva. Doc: [`../economy/R33_STATIONS_PRODUCT.md`](../economy/R33_STATIONS_PRODUCT.md).
> **R32 (Battle + Authority Foundations)** va por su propia línea y **no cambia nada de lo que se juega hoy**: la base contractual y el estado de cada subfase están en [`R32_INTEGRATION_AUDIT.md`](R32_INTEGRATION_AUDIT.md) §14. Entregadas a la fecha: el catálogo ([`BATTLE_CATALOG.md`](BATTLE_CATALOG.md)), el modelo de Pokémon ([`POKEMON_SPECIES_INSTANCE_MODEL.md`](POKEMON_SPECIES_INSTANCE_MODEL.md)) y el motor de combate compartido ([`SHARED_BATTLE_RULES.md`](SHARED_BATTLE_RULES.md)) y las primitivas de autoridad de servidor ([`AUTHORITY_FOUNDATIONS.md`](AUTHORITY_FOUNDATIONS.md)). Ninguno lo importa todavía código de producción, así que el bundle de WildLands no cambió.

---

## 1. Qué es

WildLands es el mundo explorable de PokeSwap, con estética de Pokémon DS (Platino):

- **Lobby:** Ciudad Corazón, recreada con el motor propio y sprites dibujados a mano.
- **Mundos:** 5 mundos procedurales infinitos a los que se viaja por las puertas de la ciudad.
- **Controles:** click/tap para caminar (pensado para móvil) y teclado como alternativa.
- **Home de PokeSwap (R25):** `/` es la ciudad. Cada función se abre en un panel sobre la ciudad, entrando a su edificio o desde el botón **Menú**.
- **Plaza con datos reales (R26):** los 10 Pokémon con dueño más caros pasean por la plaza de las fuentes y se actualizan en vivo. Hay un tablón de actividad junto al Centro Pokémon y toasts discretos.
- **Identidad del jugador (R27):** con sesión se ve el username, se puede elegir personaje y un Pokémon propio que acompaña al jugador; las preferencias y la última posición segura de la ciudad son locales y cosméticas.
- **Mundos conectados (R28):** los salvajes salen de un pool global rotativo, libre de propietarios, y una ficha pública solo navega a las features existentes.
- **Alcance:** el motor es **cosmético y del lado del cliente**. La ciudad solo lee (tokens del perfil, `slots` y `activity_feed`, más Realtime) y navega. Toda escritura sigue dentro de las vistas de las features (ver `AGENTS.md` §2 y `docs/TRUST_BOUNDARY.md`).

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

- Redirecciones: `/market` → `/mercado`, `/profile` → `/perfil`, `/wildlands` y `/map` → `/` (conservan query) y cualquier otra ruta → `/`.
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

# R30: en otra terminal, con services/realtime/.env local (no versionado)
cd services/realtime
docker compose up --build
npm test
npm run test:load
```

**Estado de checks al cierre R30:** 386 tests de frontend, 23 pruebas del servicio, typecheck y build pasan; el preflight de carga valida 50 jugadores. Producción validó WebSocket, dos jugadores, espectador, click-path, F5 y minimizado. La configuración local de Docker y las claves publicables quedan ignoradas por Git.
- R27 sumó tests de preferencias versionadas, ownership/lock mediante `useMyBox`, carreras entre usuarios, sesión tardía/logout, seguimiento y transición de área, fallbacks de personaje/Pokémon, username hostil y la interfaz de Jugador.
- R26 sumó tests de las reglas compartidas (`ownedSlots.test.ts`), Realtime y de la población de la plaza (`plazaPokemon.test.ts`, `plazaTaps.test.ts`, zonas en `atlas.test.ts`). R29 los reubica bajo `wildlands/lobby/` y elimina los tests exclusivos del mapa.
- También sumó tests de datos en vivo y avisos (`usePlazaData.test.ts`, `plazaNotices.test.ts`), de render seguro (`PlazaPokemonCard.test.ts`) y de solo lectura (`plazaReadOnly.test.ts`, que escanea las fuentes nuevas).
- R25 había sumado tests de ruteo, del panel, de `panelAccess`, de puertas, del menú y de `MyBoxView`.
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
- **Tiempo real sin escribir en la base (R26).** Con la app abierta, `const { supabase } = await import('/shared/api/supabase.ts')`, buscar el canal con `supabase.getChannels().find(c => c.topic.startsWith('realtime:plaza-slots'))` y llamar `channel.bindings.postgres_changes.forEach(b => b.callback({ eventType: 'UPDATE', new: fila }))`. La plaza reacciona igual que ante un cambio real. Así se verificó entrada, salida, cartel en vivo y username hostil. La prueba de punta a punta (compra o swap en otra pestaña) la hace una persona, porque escribe en la base.
- **Plaza desde la consola.** `setupState` expone `plazaRef` (el componente `LobbyPlaza`) y `game`. `game.setOwnedPokemon([{ pokemonId, mine }])` pinta cualquier lista (por ejemplo, para ver el marcador sin sesión o saturar la plaza al medir).
- **Equivalencia de refactors (usada en R24, R25 y R26).** Desde `/` (sin el juego corriendo), reemplazar `Math.random` por un generador sembrado, renderizar escenas fijas con `new Renderer(canvas)` (ciudad de día y de noche, fundido, costa con lluvia) y hashear `getImageData` con `crypto.subtle.digest`. Para la lógica, crear `new WildlandsGame(canvas, …)` sin `start()` y llamar `game.update(1/60)` en un bucle con toques, teclas y viajes, hasheando posiciones, cámara, fundido y HUD. Esperar ~2,5 s antes para que carguen los PNG. Correrlo antes y después del cambio y comparar.
  - **Trampas encontradas en R26:**
    - Tras un `git stash`, Vite sirve módulos con `?t=` y puede haber **dos instancias** del mismo módulo (por ejemplo `population.ts`): la caché de sprites que calienta el script no es la del juego. Reiniciar el servidor antes de cada corrida.
    - Precargar `loadPokemonInfo` para toda la Pokédex de la prueba: si no, los salvajes aparecen en distintos `await` según qué hojas estaban en caché.
    - Los `await` del script dejan correr promesas pendientes, así que los actores que se cargan de forma asíncrona se agregan ahí. Purgar lo que se quiera excluir en cada paso, no solo al principio.

---

## 3. Arquitectura (`src/features/wildlands/`)

```text
components/
  WildlandsView.vue  Vista del lobby: canvas, punteros, minimapa; compone HUD, menú, panel y AuthModal
  LobbyHud.vue       Píldora inferior: lugar, clima, hora, cristales y "Ciudad"
  LobbyMenu.vue      Botón Menú + tokens (solo lectura); hoja con las 6 funciones y la sesión
  LobbyPanel.vue     Panel de función: modal en escritorio, hoja inferior en ≤720 px
  LobbyPlaza.vue     Plaza (R26): pasa el top 10 al juego; cartel del Pokémon, tablón y toast
  PlayerIdentitySection.vue  Sección Jugador de Mi caja: personaje y acompañante, mobile-first
  PlazaPokemonCard.vue  Cartel de un Pokémon con dueño: nombre, dueño (texto), precio, "Ver en el Mercado"
  ActivityBoard.vue  Tablón de actividad (usa LobbyPanel)
  PlazaNotice.vue    Toast discreto arriba a la izquierda
  DevHelp.vue        Ayuda de teclas y fps; se carga solo en desarrollo (no llega al build)
lobby/
  features.ts        LobbyFeature, títulos, qué requiere sesión, panelAccess()
  useLobbyPanel.ts   Ruta → panel abierto, cierre por historial, Esc, origen (door/menu/link)
  usePlazaData.ts    Lecturas de slots y activity_feed, Realtime, lotes de patches, reconexión, toasts
  plazaNotices.ts    Textos puros: próximo toast, entradas del tablón, "hace N min"
engine/
  game.ts          Loop, cámara, jugador y NPCs, interacción, HUD
  plazaPokemon.ts  Pokémon con dueño en la plaza: candidatos por zona, hogar estable, sync (entran/salen)
  plazaTaps.ts     Qué señala un tap o la tecla de acción: Pokémon con dueño o tablón
  pokeball.ts      Poké Ball dibujada por código para especies sin hoja ni sprite
  ownerMarker.ts   Rombo sobre los Pokémon del usuario
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
                   hojas de trainer (walk/run) y recoloreo HSL de NPCs
  playerAppearance.ts  Carga la hoja elegida sin carreras; fallback al trainer dibujado
  companion.ts     Seguidor cosmético por rastro de casillas, sin colisión ni picking
  playerNameplate.ts  Username no confiable pintado únicamente con fillText
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
multiplayer/
  api/colyseusPresence.ts   Adaptador de socket, lifecycle y reconexión sin polling
  domain/presence.ts        Puerto de actores, contrato remoto y áreas compartidas R30
  domain/areaReconciliation.ts  Barrera contra snapshots del área anterior durante un portal
areas/
  atlas.ts         LOBBY_ID ('ciudad-corazon'), WORLDS (5 mundos con semilla), Atlas (caché)
  hearthome.ts     Definición de Ciudad Corazón: edificios+sprites, props, manzanas, puertas,
                   residentes con frases, paseantes, Pokémon de la ciudad, carteles
  hearthomeTerrain.ts  Terreno 64x49 (s calle, g pasto, p plaza, t bosque) trazado del mapa
  townArea.ts      Area de ciudad: colisión, carga de arte PNG con respaldo, re-horneado
  townPopulace.ts  Residentes, paseantes y Pokémon con dueño de la ciudad (movido desde townArea en R26)
  wildArea.ts      Area de mundo procedural + almohadilla de regreso al lobby
identity/
  playerCharacters.ts       Catálogo cerrado de personajes y hojas disponibles
  playerPreferences.ts      Contrato local v1 por user.id, parseo y fallback
  playerPreferencesStore.ts Estado reactivo cosmético compartido con la sección Jugador
  playerIdentity.ts         Contrato visual y validación contra items de useMyBox
  townPosition.ts           Valida posiciones restaurables fuera de sólidos/puertas/portales
  usePlayerIdentity.ts      Une Auth, useMyBox, preferencias y el puerto del motor
```

Otros cambios fuera de la carpeta:
- `src/app/router/routes.ts`: tabla de rutas (lobby + hijas y redirecciones, incluido `/map` → `/`). `index.ts` solo crea el router.
- `src/app/App.vue`: sin barra superior ni páginas standalone; solo `<router-view>`. `HomeView` se eliminó.
- `src/features/progression/components/MyBoxView.vue`: la sección "Mis Pokémon" se movió desde `ProfileView`, que ahora enlaza a `/caja`.
- `src/features/auth/composables/useAuth.ts`: `refreshProfile()` (solo lectura), llamado al cerrar un panel para actualizar los tokens del HUD.
- `src/shared/utils/devTools.ts`: se exporta `isDev`.
- **R29 en `features/wildlands/lobby/`:**
  - `domain/ownedSlots.ts` conserva las reglas de plaza: `topPricedIds`, `mergeSlotPatch`, `slotPatchFromRow`, `activityFromRow`, `diffIds` y `activityLabel`.
  - `api/plazaApi.ts` conserva `fetchSlots()` y `fetchRecentActivity()` como SELECT públicos.
  - `usePlazaRealtime.ts` conserva topics únicos, `onActivity`, `onReconnect` y validación de payloads.
  - Se eliminó todo `features/map/`, la ruta activa y los tiles de Platino exclusivos. `tilesets/buildings.png` se conserva como fuente del extractor de arte de ciudad.

### Puertas de edificios (R25)

- **Datos.** `TownBuilding.door` es la casilla del umbral, en la fila inferior del footprint, y `TownBuilding.feature` es la función. Se cargan en `hearthome.ts`: Centro Pokémon (17,19), Tienda (30,29), Salón de Concursos (31,14), Gimnasio (51,19), Club de Fans (11,29) y Casa de los Poffins (41,29).
- **Por qué el umbral está dentro del footprint** y no en la vereda: pasar caminando por delante no entra por accidente. `TownArea` lo marca caminable, los NPCs lo tratan como bloqueado (igual que los portales) y `nearestOpen` lo evita.
- **Entrada.** Pisar el umbral dispara `onEnterBuilding(buildingId, feature)` y `WildlandsView` hace `router.push`. Tocar el edificio (footprint más 2 filas de fachada por encima, `TAP_REACH_ROWS`) camina hasta la puerta. Tocar a un personaje delante del edificio sigue hablándole.
- **Motor.** `game.ts` solo tiene los enganches: `setPaused`, `placeAtDoor`, `Entrances.retarget` en `tap` y `Entrances.arrive` al llegar a una casilla.

### Plaza con datos reales (R26)

**Qué se ve**
- En la plaza pasean los **10 Pokémon con dueño más caros**. No se agregan los del usuario fuera del top: el acompañante propio queda para R27.
- Los 5 Pokémon decorativos se eliminaron, incluido `TownDef.pokemon`.
- Los del top que son del usuario llevan un **rombo amarillo** encima (`ownerMarker.ts`). Sin sesión no hay marcador.
- **Tocar** un Pokémon con dueño (o mirarlo y usar la tecla de acción) abre su cartel: nombre, dueño, precio y "Ver en el Mercado", que abre el panel como desde el menú. El cartel lee los slots vivos, así que cambia solo si llega un patch.
- **Tablón:** es el cartel en (13,19), junto al Centro Pokémon, marcado con `TownProp.board`. También se abre desde el Menú → Actividad. Muestra los últimos 20 eventos de `activity_feed` sin usernames: ese feed solo trae `user_id`, y leer `profiles` sería una lectura nueva.
- **Toasts** (`PlazaNotice`), de a uno cada 4 s:
  - uno por cada Pokémon del usuario que cambia de dueño;
  - los eventos nuevos de actividad agrupados ("3 novedades en el tablón").
  - Se descartan mientras hay un panel, el menú, el login o el tablón abiertos.
- Con el cartel o el tablón abiertos el juego se pausa, igual que con un panel.

**Dónde aparecen**
- Hay 3 zonas en `hearthome.ts` (`plazaZones`): la plaza de las fuentes al oeste, al centro y al este, entre las filas 33 y 40.
- `plazaCandidates` descarta casillas sólidas, a menos de 6 casillas (Chebyshev) de una puerta, a menos de 4 de un portal y las de los residentes.
- `assignHome` elige la zona menos poblada (a igualdad, la que "prefiere" el id), con 3 casillas de separación entre hogares. Es determinista por `pokemonId`: cada Pokémon vuelve siempre al mismo lugar.
- Hay lugar para ~23 hogares con los residentes actuales. El test exige al menos 20 (el doble del top), todos alcanzables desde el spawn.

**Motor**
- `game.ts` solo suma enganches:
  - `setOwnedPokemon(list)`, que se reaplica en `enterArea` porque la población se recrea al volver de un mundo;
  - la opción `onInspect`;
  - una llamada a `plazaTaps` en `tap()` y en `interact()`.
- `TownPopulace` delega en `PlazaPokemon.sync`, que carga la hoja y crea el actor. Si el Pokémon salió mientras cargaba, no lo agrega. Si no hay hoja ni `sprite_url`, usa la Poké Ball.
- **El motor nunca recibe usernames ni precios:** solo `{ pokemonId, mine }`.

**Datos (solo lectura)**
- `usePlazaData` lee `slots` (`fetchSlots`) y `activity_feed` (`fetchRecentActivity`), y se suscribe con `useMapRealtime(…, { channel: 'plaza' })`.
- Los patches se agrupan cada 250 ms (un swap toca 2 slots). Los que llegan durante una lectura se reaplican encima del resultado.
- Al reconectar (`SUBSCRIBED` después de una caída) se vuelve a leer todo.
- **Cada suscripción usa un topic único** (`plaza-slots-3`). supabase-js devuelve el canal existente si el topic se repite, y su baja es asíncrona: un remontaje rápido (HMR, `/map` → `/`) recibía el canal viejo ya suscrito y fallaba con `cannot add postgres_changes callbacks … after subscribe()`.
- **Escrituras: ninguna.** `usePlazaData.test.ts` usa un mock de Supabase que falla ante cualquier escritura. `plazaReadOnly.test.ts` escanea las fuentes de R26 buscando escrituras, `localStorage` e `innerHTML`/`v-html`.
- **`activity_feed` solo registra `claim` y `free_claim`** (lo inserta `claim_slot`). Las compras y los swaps no generan eventos: se ven en la plaza por `slots` y, si afectan al usuario, por el toast de cambio de dueño.

**Mapa legado (cambios intencionales)**
- `useMapEntities` usa las reglas compartidas y ahora corrige tres errores:
  - `MapView` no actualizaba `_slots` con los patches, así que el top 10 se calculaba con los datos iniciales;
  - un Pokémon que salía del top 10 quedaba en el mapa;
  - el que entraba al top 10 porque otro bajaba de precio no aparecía.
- La vista y su API no cambian. Se retira en R29.

**Rendimiento (escritorio, canvas 1249×800, dpr 1, 600 frames)**

| Pokémon en la plaza | Visibles en cámara | ms/frame promedio | p95 | máx |
|---|---|---|---|---|
| 0 | 0 | 2,90 | 3,3 | 6,8 |
| 10 (datos reales) | 7 | 2,99 | 3,4 | 7,0 |
| 23 (plaza saturada) | 19 | 3,20 | 3,7 | 8,3 |

- Las reglas corren una vez por lote de patches, no por frame. Con 5.000 slots, `topPricedIds` tarda 0,76 ms y una ráfaga de 50 patches con recálculo, 0,91 ms. Con los 195 slots actuales, 0,02 ms y 0,18 ms.
- **Equivalencia:** mover `TownPopulace`, extraer `loadTrainerArt` y agregar los enganches dio hashes de lógica, HUD y píxeles idénticos al código anterior (sin llamar a `setOwnedPokemon`, sin el cartel nuevo y con los decorativos neutralizados).

### Identidad del jugador (R27)

- **Fuente de identidad.** `useAuth` aporta `user.id` y `profile.username`. El nombre solo se usa si el perfil corresponde al usuario activo y se pinta con `fillText`; nunca entra en HTML.
- **Preferencias.** Clave `pokeswap:wildlands:player:v1:<user.id>` con personaje, ID preferido de acompañante y última posición segura de la ciudad. JSON corrupto o versión desconocida vuelve al default. Logout limpia la identidad y la caja en memoria, pero conserva la preferencia namespaced para el próximo login.
- **Ownership.** El ID local se resuelve únicamente dentro de `useMyBox.items`. La selección se elimina tras una lectura exitosa si falta, pertenece a otra sesión o `is_locked` es true. Un error de red oculta temporalmente el acompañante sin borrar la preferencia.
- **Caja compartida.** `useMyBox` ahora descarta resultados async de una sesión anterior, deduplica una carga concurrente del mismo usuario y expone `clear()` para logout.
- **Acompañante.** Es un `Actor` Pokémon separado de `Populace`: no ocupa casillas, no bloquea A*, puertas o portales, no recibe taps ni diálogo. Sigue las casillas ya recorridas, con cola acotada y recolocación defensiva; al viajar o teletransportar se reinicia junto al jugador durante el fundido.
- **Arte.** Las dos protagonistas femeninas se empaquetaron como hojas 4×4 reproducibles con `scripts/pack_trainer_sprites.py`. Una hoja faltante conserva el trainer dibujado; un Pokémon sin overworld usa sprite frontal y luego Poké Ball.
- **Interfaz.** Mi caja compone una sección Jugador independiente. Elegir personaje o acompañante solo escribe la preferencia local; Vender conserva su flujo previo.
- **Equivalencia.** Contra `migration` (`46875f5`), escena base `ef424a1e…ad127` y traza lógica `ab638c90…2477` conservaron exactamente sus hashes SHA-256. En prueba viva se verificaron tap-to-move, username hostil literal, seguidor en ciudad, fundido y llegada con acompañante a un mundo; el lobby anónimo se comprobó en escritorio y 375 px.

### Mundos conectados (R28)

- **Regla compartida.** `features/pokemon/domain/wildPool.ts` reemplaza el `_rollWildPool` local del mapa. Recibe catálogo, snapshot de `slots`, RNG y tamaño; conserva los límites 2% / 12% / 86%, exclusión de propietarios, unicidad y fallback a cualquier candidato libre cuando una categoría falta. `/map` la consume hasta R29, sin que WildLands dependa de una vista retirada.
- **Rotación y autoridad.** `usePlazaData` sigue siendo la única lectura y suscripción de `slots` para el lobby y los mundos. Mantiene un pool por sesión, rota a la hora y filtra sus miembros por el snapshot server-backed de cada patch. Si un miembro obtiene dueño desaparece al instante; si queda libre y ya era miembro puede volver a aparecer; otros esperan el siguiente rollover. Al reconectar vuelve a leer.
- **Población.** `Population` distribuye solo integrantes libres del pool y compatibles con el bioma en chunks activos, reserva cada especie mientras carga arte y no duplica actores visibles. El fallback de hoja overworld a sprite frontal y Poké Ball permanece. La selección, patches y filtrado no corren por frame.
- **Interacción.** `wildTaps.ts` reconoce únicamente actores con marca cosmética `wild`; el acompañante sigue fuera de picking. Tap y tecla de acción abren `WildPokemonCard.vue`, que solo interpola texto y ofrece navegación general a Pokédex, Mercado o Swap. El motor no recibe owner, precio, tokens ni contratos económicos.
- **Límite de producto.** Mercado no admite preseleccionar una especie y Swap no permite pedir el resultado; ambos accesos permanecen generales. El panel actual de Pokédex también requiere sesión, por lo que la ficha WildLands es la consulta pública del guest.

### Deuda técnica conocida

- **`game.ts` (467 líneas tras R27).** R27 agregó solo el puerto de identidad, callbacks de posición y enganches del acompañante; carga, seguimiento y persistencia viven fuera. Si vuelve a crecer, el suavizado de clima sigue siendo el candidato a extraer a `atmosphere.ts`.
- **`WildlandsView.vue` (352 líneas tras R27).** La identidad vive en `usePlayerIdentity`; la vista solo espera Auth inicial y conecta el puerto del juego.
- **`renderer.ts` (346 líneas tras R27).** El nombre se dibuja en `playerNameplate.ts`; el renderer solo incorpora acompañante/nameplate al orden visual.
- **Tamaño de archivos (resuelto en R24).** `renderer.ts` bajó a 330 líneas (efectos en `lighting.ts`, marcas en `groundMarks.ts`) y `game.ts` a 398 (`travel.ts`, `keyboard.ts`, `dialogue.ts`). `buildings.ts` pasó de 588 a ~65 líneas: un bloque genérico por estilo en lugar de edificios detallados que solo se veían si fallaba un PNG. `game.ts` quedó justo bajo el umbral; lo próximo que crezca (puertas de edificios en R25) debería ir en un módulo propio.
- **`WildlandsView.vue` en R25:** bajó de 403 a ~320 líneas al separar `LobbyHud`, `LobbyMenu`, `LobbyPanel` y `DevHelp`.
- **Ahorro de trabajo en ciudad:** `TownArea.decorIn` filtra ~700 elementos por frame (hoy ~3 ms/frame en total). Una grilla espacial ahorraría trabajo si la ciudad crece.
- **Cámara de desarrollo:** `LENSES.dramatic` y `cenital` quedan solo para pruebas.

---

## 4. Assets y procedencia

| Carpeta | Contenido | Origen |
|---|---|---|
| `public/assets/overworld/NNNN.png` y `shiny/` | Hojas overworld por especie (ids 1–493), 4 dir x 2 frames | Repo del usuario `terremotoparatodos/sprites-overworld`, empaquetadas en local (raw.githubusercontent limita requests) |
| `public/assets/trainers/protahombre/*.gif` | Protagonista masculino de Platino (Walk/Run N/S/E/W) | Aportado por el usuario |
| `public/assets/trainers/protahombre.png` | Hoja 8x4 generada desde los GIFs | Generada |
| `public/assets/trainers/dawnrosa.png`, `dawmamarillo.png` | Hojas 4x4 de caminar para la elección de personaje | Generadas en R27 |
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
5. **Presencia R30.** Ciudad Corazón y Pradera Brisa comparten presencia efímera mediante Colyseus Cloud; Supabase sólo verifica el JWT y resuelve identidad visual autorizada. No se persisten posiciones ni estado de presencia. Un F5 recupera en memoria la posición del mismo usuario durante 15 segundos; un reinicio o una desconexión más larga la descarta. Ver [`R30_PRODUCTION_HANDOFF.md`](R30_PRODUCTION_HANDOFF.md).
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

- **R30 / operación:** no activar réplicas ni Redis aún: el límite inicial sigue siendo un proceso y 100 conexiones globales. Medir uso real antes de cambiar la topología; el runbook está en [`R30_PRODUCTION_HANDOFF.md`](R30_PRODUCTION_HANDOFF.md).
- **R30 / áreas:** sólo la puerta oeste a Pradera está habilitada para presencia compartida. Las puertas de Costa, Tundra, Bosque y Desierto muestran que llegarán próximamente mientras R30 esté activo.

- **Bancos:** la hoja los dibuja vistos desde arriba y parecen tablones.
- **Portón sur:** su techo tapa parcialmente el portal que tiene encima (el viaje funciona igual).
- **Edificios sin interiores:** los 6 edificios con función abren su panel. El resto (casas, departamentos, portones) sigue mostrando nombre y descripción al mirarlos.
- **Vistas de features en panel:** `LobbyPanel` oculta el primer `<h2>` de cada vista (el título ya está en el encabezado) y ajusta su margen con `:deep(main)`. La tabla del Mercado en 375 px usa su propio scroll horizontal.
- **Plaza (R26):**
  - **Prueba de punta a punta:** una compra o swap real en otra pestaña tiene que verla una persona, porque escribe en la base. El camino del cliente se verificó inyectando eventos de Realtime.
  - **"Ver en el Mercado"** abre el Mercado sin preseleccionar el Pokémon: `MarketView` no lee la query y cambiarlo tocaría esa feature.
  - **El tablón no muestra quién hizo cada acción:** mostrarlo requiere leer `profiles` por `user_id`. Queda para una fase que lo justifique.
  - **En desarrollo** la ayuda (`DevHelp`) tapa el toast y el marcador cuando están arriba a la izquierda. En producción no existe.
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
- **Hojas fuente de protagonistas:** los GIFs de `dawnrosa/`, `dawmamarillo/` y `protahombre/` se conservan como fuente; `scripts/pack_trainer_sprites.py` regenera las hojas usadas por el motor.
- **Tileset fuente:** `public/assets/tilesets/buildings.png` solo lo usa `scripts/extract_town_sprites.py`, pero se publica igual en el build (188 KB).

---

## 7. Cómo retomar en una conversación nueva

Pegar algo como:

> Seguimos WildLands de PokeSwap después de cerrar R30. Antes de escribir código leé completos `AGENTS.md`, `docs/INVARIANTS.md`, `docs/TRUST_BOUNDARY.md`, `docs/wildlands/HANDOFF.md` y `docs/wildlands/R30_PRODUCTION_HANDOFF.md`; verificá con `gh` que la PR documental de R30 esté fusionada y actualizá `main`. La prioridad inmediata es beta controlada/operación de la presencia: no agregues producto sin un objetivo aprobado. En paralelo existe una exploración aislada de profesiones, recursos y dungeons; puede producir diseño y prototipos sin persistencia, pero no debe aplicar RLS, migraciones, RPCs, Edge Functions, economía, recompensas ni ownership hasta un desglose aprobado según `AGENTS.md` §17. Cuando se apruebe una fase de producto, crear una rama nueva desde `main`, elegir una sola responsabilidad inicial y usar Create a merge commit al fusionar.

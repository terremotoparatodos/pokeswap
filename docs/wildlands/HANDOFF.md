# WildLands — Traspaso de contexto

> Documento de respaldo para retomar el trabajo en otra conversación.
> Estado al **2026-09-13**, tras **R24 (Consolidar el prototipo)**, rama `feat/wildlands-prototype` (creada desde `migration`).
> Plan siguiente: [`LOBBY_INTEGRATION_PLAN.md`](LOBBY_INTEGRATION_PLAN.md).

---

## 1. Qué es

WildLands es el mundo explorable de PokeSwap, con estética de Pokémon DS (Platino):

- **Lobby:** Ciudad Corazón, recreada con el motor propio y sprites dibujados a mano.
- **Mundos:** 5 mundos procedurales infinitos a los que se viaja por las puertas de la ciudad.
- **Controles:** click/tap para caminar (pensado para móvil) y teclado como alternativa.
- **Alcance:** todo es **cosmético y del lado del cliente**. No lee ni escribe tokens, propiedad ni recompensas (ver `AGENTS.md` §2 y `docs/TRUST_BOUNDARY.md`).

Ruta: `/wildlands` (link "WildLands" en la barra). Parámetros de URL útiles:

| Parámetro | Efecto |
|---|---|
| `?x=31&y=20` | Aparecer en esa casilla (si no es sólida) |
| `?area=desierto` | Arrancar en un mundo: `pradera`, `bosque`, `desierto`, `tundra`, `costa` |

---

## 2. Cómo correrlo y verificarlo

```bash
npm run dev          # http://localhost:5173/wildlands
npx vitest run src/features/wildlands
npx eslint src/features/wildlands
npx vue-tsc --noEmit -p tsconfig.app.json
npm run build
```

**Estado de checks al cierre de R24:** 273 tests del proyecto pasan (42 de WildLands), `eslint .` sin errores (13 warnings de orden de atributos, previos, en `AuthModal.vue` y `MapView.vue`), `vue-tsc -p tsconfig.app.json` en cero errores y build OK.
- R24 agregó `src/vite-env.d.ts` (tipos de `import.meta.env`) y marcó `CombatSummary.rounds` como `readonly` (el error de `DungeonView.vue`).
- `npm run typecheck` (lo que corre CI) usa `tsconfig.json`, que solo tiene `references` y no chequea nada sin `-b`. Para chequear de verdad hay que usar `-p tsconfig.app.json`. `tsconfig.node.json` (`vite.config.ts`) tiene errores propios, previos y fuera del alcance de WildLands.
- El build copia `public/assets/*` completo a `dist/` (verificado: `town`, `overworld`, `trainers` y `tilesets`).

### Trucos de verificación visual (panel Browser de la app)

- **Frames congelados.** El panel pausa `requestAnimationFrame` cuando está oculto, así que una captura puede mostrar un frame viejo. Sacar 2–3 capturas seguidas, o simular la lógica en la página con `await import('/features/wildlands/engine/...')`.
- **Capturas 1:1.** Usar `resize_window 800×520`; con 1400×900 la captura sale reducida.
- **Vista cenital de depuración.** Instanciar `new TownArea(HEARTHOME)` en la página (import dinámico de `areas/atlas.ts` y `areas/townArea.ts`), llamar `drawGround` + `decorIn` sobre un canvas propio y superponerlo con `position: fixed`. Así se detectaron las sombras y líneas mal ubicadas.
- **Cámaras alternativas.** La tecla `V` cambia de cámara **solo en desarrollo** (`isDev`). Los jugadores siempre ven la cámara del área (Portátil).
- **Equivalencia de refactors (usada en R24).** Desde `/` (sin el juego corriendo), reemplazar `Math.random` por un generador sembrado, renderizar escenas fijas con `new Renderer(canvas)` (ciudad de día y de noche, fundido, costa con lluvia) y hashear `getImageData` con `crypto.subtle.digest`. Para la lógica, crear `new WildlandsGame(canvas, …)` sin `start()` y llamar `game.update(1/60)` en un bucle con toques, teclas y viajes, hasheando posiciones, cámara, fundido y HUD. Esperar ~2,5 s antes para que carguen los PNG. Correrlo antes y después del cambio y comparar.

---

## 3. Arquitectura (`src/features/wildlands/`)

```text
components/WildlandsView.vue   Vista Vue: canvas, HUD, minimapa, eventos de puntero
engine/
  game.ts          Loop, cámara, jugador y NPCs, interacción, HUD
  travel.ts        Viajes entre áreas (fundido) y aviso de puertas cercanas
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
- `src/app/router/index.ts`: ruta `/wildlands`.
- `src/app/App.vue`: link en la barra.
- `src/shared/utils/devTools.ts`: se exporta `isDev`.

### Deuda técnica conocida

- **Tamaño de archivos (resuelto en R24).** `renderer.ts` bajó a 330 líneas (efectos en `lighting.ts`, marcas en `groundMarks.ts`) y `game.ts` a 398 (`travel.ts`, `keyboard.ts`, `dialogue.ts`). `buildings.ts` pasó de 588 a ~65 líneas: un bloque genérico por estilo en lugar de edificios detallados que solo se veían si fallaba un PNG. `game.ts` quedó justo bajo el umbral; lo próximo que crezca (puertas de edificios en R25) debería ir en un módulo propio.
- **`WildlandsView.vue` (403 líneas):** apenas por encima de 400. Revisarlo cuando R25 agregue paneles.
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
- **Edificios sin interiores ni puertas funcionales:** tocar un edificio muestra su nombre y descripción.
- **Mundos:** Pokémon salvajes elegidos por tipo de bioma sobre toda la Pokédex, no con las reglas de pool del mapa legado.
- **Barra de navegación de PokeSwap:** no entra en 375 px de ancho (fuera de WildLands).
- **Commit:** el prototipo y R24 están commiteados en `feat/wildlands-prototype`. Falta el PR (hacia `migration` o `main`) y el preview de Cloudflare Pages, que solo se despliega en PRs hacia `main` (`.github/workflows/deploy.yml`).
- **Protagonistas sin usar:** `public/assets/trainers/dawnrosa/` y `dawmamarillo/` (GIFs de caminar) están commiteados pero no se usan todavía. Quedan para la elección de personaje (R27).
- **Tileset fuente:** `public/assets/tilesets/buildings.png` solo lo usa `scripts/extract_town_sprites.py`, pero se publica igual en el build (188 KB).

---

## 7. Cómo retomar en una conversación nueva

Pegar algo como:

> Seguimos WildLands de PokeSwap. Leé `docs/wildlands/HANDOFF.md` y `docs/wildlands/LOBBY_INTEGRATION_PLAN.md`, revisá la rama `feat/wildlands-prototype` y arrancá por la fase que indique.

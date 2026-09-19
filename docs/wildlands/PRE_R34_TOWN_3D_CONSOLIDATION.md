# Pre-R34 — Consolidación R33 + Town 3D

> Microfase de consolidación. **No abre R34.** Toma el HEAD aprobado de R33 y le
> integra la ciudad 3D aprobada de la estación secundaria, para dejar una única
> base desde la cual arrancar R34.

## 1. Qué es esta base

**`R33 + Town 3D = base consolidada pre-R34`**

| | |
|---|---|
| Rama | `integration/pre-r34-town-3d` |
| Base R33 (primer padre) | `bd03e4bad67858b52c8b0e7812b74728ae0751b0` (`feat/r33-stations-product`) |
| Town 3D (segundo padre) | `87504b792c48e240d866e43a65619be08e4e8927` (`feat/town-3d-models`) |
| Merge commit | `086365c58daff0311443c47f61a7fb07ad709d5e` |
| Commit documental | `cd65e69` — cherry-pick de `8968553afc43b53ef3cf9365bf9ef738de8d3603` (`docs/town-3d-handoff`) |
| HEAD consolidado | ver §9 |

Ninguna de las dos ramas de origen fue modificada. `feat/town-building-depth`
queda **descartada** (la reemplazan los modelos 3D reales).

## 2. Estrategia de integración

Merge `--no-ff` de la rama Town completa como **una unidad lógica**, no
cherry-picks. La rama Town es lineal, acumulativa (27 commits: lab → árboles →
vallas → modelos) y contiene estados intermedios que después se revierten; un
cherry-pick commit a commit los replicaría sin ganancia.

El merge preserva la provenance: el primer padre es la línea R33, el segundo es
la unidad Town, y `git log --first-parent` sigue leyendo la historia principal.

El documento de handoff entró después, por cherry-pick del único commit
documental — verificado como un solo archivo nuevo, sin reintegrar la rama Town
por segunda vez.

## 3. Conflictos

**Git: ninguno.** El merge fue automático.

Superficie compartida real entre ambas líneas desde su base común `7c3af21`,
medida (no asumida): exactamente **dos archivos**.

| Archivo | R33 cambia | Town cambia | Resultado |
|---|---|---|---|
| `engine/renderer.ts` | `collectPlacedHits` sobre `scene.placed` (usa `placedFeet`) | `collect()` / `drawSprites` sobre `scene.decor` (modelos, sombras, altura del farol) | ambos lados presentes e intactos |
| `docs/wildlands/HANDOFF.md` | 2 líneas de estado | lista de puertas | secciones disjuntas |

**Conflicto semántico: ninguno.** Auditado a mano, no aceptado por confianza en
el merge automático:

- `model` sólo se puebla desde `DecorInstance.model`, dentro del bucle de
  `scene.area.decorIn(...)` en `collect()`.
- `scene.placed` **nunca entra a `collect()`**: los objetos colocados se dibujan
  por `overlay.sprites()` y su picking sale de `collectPlacedHits`.
- Por lo tanto una estación multi-celda nunca toma el camino del modelo 3D, y un
  modelo de ciudad nunca llega al bucle de placed hits. Las dos superficies son
  disjuntas por construcción, no por casualidad.

Verificado en vivo: en Ciudad Corazón `frame.placedHits.length === 0`.

### 3.1 Riesgo semántico conocido y aceptado

`projection.ts` agrega `town` a `LensName`. No existe ningún `Record<LensName,…>`
en el repo (el typecheck lo habría roto). El único consumidor que enumera lentes
es `LENS_ORDER` en `game.ts` y en `LabStage.vue`, que listan tres lentes y omiten
`town`. Eso sólo afecta a `cycleLens()`, atada a la tecla **V** y **protegida por
`isDev`**: en la ciudad, pulsar V salta a `handheld` y no vuelve a `town`. Es
comportamiento de depuración, no de producción, y no se corrige en esta microfase.

## 4. Auditoría de regresión de R33

Ningún archivo de R33 fue reemplazado ni revertido. Comparación byte a byte
contra `bd03e4b`:

| Archivo | Estado |
|---|---|
| `engine/placedObjects.ts` (footprints multi-celda, `placedFeet`) | idéntico |
| `engine/pathfinding.ts` | idéntico |
| `engine/picking.ts` | idéntico |
| `engine/navigator.ts` | idéntico |
| `engine/game.ts` | idéntico |
| `navigation.test.ts`, `placedObjectsNavigation.test.ts`, `worldObjectNavigation.test.ts` | idénticos |
| dominio de estaciones (`src/**/station*`) | sin cambios |
| `engine/renderer.ts` | único compartido; el hunk de R33 está intacto (ver §3) |

## 5. Qué entra como producto

Ciudad aprobada, sin rediseño durante la integración: mapa **64×51** (2 filas al
sur), modelos 3D reales de Silph Co., Casa de Mr. Pokémon, Casino, Centro
Pokémon, Gimnasio, Tienda, casas, apartamentos y las 5 puertas de ruta; faroles,
fuentes, bancos 1×2, vallas autotile con esquinas y postes; cartel de rutas en
(14,40); puerta de la Tienda en (29,29); lente `town`.

Contrato de los modelos, sin cambios respecto del handoff: **visual only**.
Colisión, puertas, `doorForTap` y picking siguen siendo el sistema de footprints
existente. La geometría de gameplay sigue separada de la geometría visual.

## 6. Qué sigue siendo DEV-only

- **City Mapping Lab** (`/dev/city-lab`, `src/features/cityLab/**`): protegido por
  `import.meta.env.DEV` con el mismo patrón que `professionPlayground` y
  `dungeonPrototype`. Verificado ausente de `dist` (ni `cityLab`, ni
  `CityLabView`, ni `dev-city-lab`). Se conserva: es la herramienta para iterar
  la ciudad.
- **Árboles de ciudad** (`src/features/worldAssets/trees/**`): los 18 importadores
  están **todos** dentro de `src/features/cityLab/**`. Cero importadores de
  producción. El bosque de la ciudad sigue siendo `tree-a/b/c` procedural. No se
  tocó generator, seeds, `TownDef` para placed trees ni el renderer procedural.

## 7. Verificaciones

### Validate Map sobre la ciudad real

**0 errores**, 16 warnings, 1 info. 6 entradas alcanzables (Swap, Caja, Dungeon,
Pokédex, Mercado, Perfil) y 5 salidas alcanzables (Tundra, Costa, Pradera,
Bosque, Desierto).

Warnings aceptados, todos preexistentes salvo el rincón de Silph:

- 5 bolsas caminables desconectadas: (8,0), (50,0), (6,14), (57,14) y **(36,7)**
  — el rincón detrás de Silph Co., 16 tiles: inaccesible, tapado por el edificio,
  sin props, NPCs, puertas ni portales. **Aceptado**, no se corrige.
- 3 "no hay dónde pararse frente a" las puertas de ruta (son pasajes, no
  edificios legibles).
- 1 copa de árbol sobre (36,7) caminable.
- 1 pasillo de 1 de ancho en el camino spawn → Tundra desde (22,14).
- 6 vallas en y=7 escondidas entre los árboles.
- Info: la salida sur al Desierto no está dentro de ningún edificio.

### Dimensión y colisión, medidas en vivo

`area.width = 64`, `area.height = 51`, spawn (31,20). Ningún consumidor productivo
asume 49 filas. Las 20 casillas que el handoff declara cambiadas se verificaron
una por una contra el motor en ejecución: 12/12 nuevas sólidas (Silph, Casino,
vieja puerta de la Tienda, 4 tiles de banco, 2 filas nuevas de la puerta sur) y
8/8 nuevas caminables (viejo Club de Fans, vieja Casa de los Poffins, plaza de la
puerta sur, nueva puerta de la Tienda (29,29), spawn, los 2 tiles del portal al
Desierto). Fuera de rango en y=51 devuelve sólido.

### Smoke manual

Recorrida con el jugador real en la ciudad: spawn, Centro Pokémon, Gimnasio,
Tienda, Silph Co., Casa de Mr. Pokémon, Casino, puerta oeste, puerta este, puerta
sur (parado sobre su portal, **despejado** del modelo) y las dos salidas norte.
Cámara, depth y profundidad correctos en todos los casos; NPCs y Pokémon de la
plaza se dibujan delante de los edificios como corresponde.

Tap sobre el modelo 3D de la Tienda → el jugador camina hasta la puerta y abre el
panel de Mercado; al cerrar con Esc queda en (29,30) mirando hacia abajo, frente a
la puerta. Click-to-move y diálogo de NPC funcionando. Todos los assets de modelos
responden 200.

> Nota de método: sin sesión el motor corre en modo espectador y no dibuja al
> jugador. El smoke se hizo con `setSpectator(false)` desde la consola — un flag
> cosmético de cliente, no un bypass de autenticación.

### Performance

Medida con la instrumentación propia del motor (`frameMs` = trabajo por frame),
sobre el dev server:

| Escenario | fps | frameMs min / avg / max |
|---|---|---|
| Desktop 993×768, cámara quieta | — | 1.24 / 1.79 / 2.13 |
| Desktop 993×768, caminata de 27 tiles por el centro | — | 1.50 / **11.79** / **14.28** |
| Móvil 375×812 @dpr2 (718×1624), caminata de 23 tiles | **60.0 sostenidos** | 6.14 / **11.94** / **14.63** |

Sin stutter reproducible: en móvil los 60 fps se mantienen durante toda la
caminata (min 59.98). El coste está dominado por la re-rasterización de los
modelos cuando la cámara se mueve, no por la cantidad de píxeles: el viewport
móvil tiene **más** píxeles de respaldo (1.17 M) que el de escritorio (0.76 M) y
cuesta lo mismo.

**Margen ajustado, a vigilar en el playtest:** el peor frame queda ~2 ms por
debajo del presupuesto de 16.7 ms. Una máquina más lenta o un viewport mayor
podrían pasarse. No se optimiza nada en esta microfase (§15 del contrato); queda
documentado.

No se pudo medir el build de producción de forma confiable en este entorno: Vue
de producción no expone `__vueParentComponent`, y el panel del navegador limita
rAF a 30 fps, así que una medición externa de pacing mide el panel y no la app.
Los números de arriba son del dev build, que es la cota pesimista.

### Bundle

| | R33 (`bd03e4b`) | Consolidado | Delta |
|---|---|---|---|
| `WildlandsView-*.js` | 305,352 B | 313,435 B | **+8,083 B (+2.6 %)** |
| `index-*.js` | 334,533 B | 334,533 B | sin cambio |
| `assets/town/` | 83 KB | 682 KB | +599 KB |
| `assets/town/models/` | ausente | **595 KB** (101 archivos) | +595 KB |
| `dist` total | 5.8 MB | 6.4 MB | +0.6 MB |

Auditoría de assets:

- El lab **no** entra: ni código, ni la ruta `/dev/city-lab`, ni el arte de los
  árboles de ciudad (ningún PNG de `worldAssets/trees` se emite a `dist`).
- Producción referencia 16 modelos. **`condo` (58 KB) se copia a `dist` y nunca se
  pide**: existe sólo para la paleta del lab, y `public/` se copia entero. Se
  verificó en el navegador que la ciudad nunca lo solicita. Sacarlo requeriría
  mover el asset fuera de `public/` o filtrar en el build; **no se hizo** —
  58 KB que nunca se descargan no justifican tocar la arquitectura de assets en
  una consolidación. Queda como decisión abierta.

### Checks

| Check | Resultado |
|---|---|
| `npx vitest run` | **140 archivos, 1753 tests, todos pasan** (el merge simulado de la secundaria daba 1716; la diferencia es la evolución de R33) |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | limpio |
| `npx eslint src` | **0 errores**, 9 warnings preexistentes (AuthModal) |
| `npx eslint .` (raíz) | 14 errores, todos dentro de `.worktrees/demo-scope/**` — un worktree untracked, preexistente, ajeno a esta rama. `.worktrees/` no está en el ignore de eslint; vale la pena agregarlo, pero no en esta microfase |
| `npx vite build` | OK |

## 8. Qué NO se hizo

R34, Dungeon, Colyseus, Supabase, persistencia de estaciones, integración
productiva de placed trees, cambios de generator o seeds, modelos nuevos,
rediseño de la ciudad, `feat/town-building-depth`, y los warnings históricos no
bloqueantes.

## 9. Para arrancar R34

Partir de `integration/pre-r34-town-3d`. Resolver su HEAD desde Git:

```bash
git rev-parse integration/pre-r34-town-3d
```

Las 7 entradas untracked preexistentes de la estación principal siguen intactas y
sin stagear.

## 10. Preguntas abiertas

1. ¿El `condo` se saca del bundle productivo, o se acepta como coste de tener la
   paleta del lab en `public/`?
2. ¿Se agrega `.worktrees/` al ignore de eslint para que `npx eslint .` vuelva a
   dar 0 errores en la raíz?
3. El margen de ~2 ms en el peor frame: ¿se mide en dispositivos reales antes del
   playtest comunitario, o se acepta y se observa durante el playtest?
4. `LENS_ORDER` omite `town`: ¿se agrega a la rotación DEV o se deja así?

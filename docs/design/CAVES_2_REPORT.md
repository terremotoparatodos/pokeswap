# CAVES-2 — Fuente canónica y guardas estructurales

> Rama `world/caves-foundation-0.3`, base `f4323c9` (CAVES-1 aprobado, padre `6039409`).
> Verificado antes de empezar: `origin/design/caves-audit-0.3 = f4323c9`, padre `6039409`, `origin/integration/world-skills-0.3 = d8b5571`, YIELD-2 congelado en `3fca914`.
> Diseño de referencia: `docs/design/CAVES_1_AUDIT.md` (§13 decisiones D1–D11).

## 1. Resumen

- La colocación procedural de bocas se reemplaza por **un dato**: `services/realtime/src/world/caves.js`, con una única cueva, `pradera-cueva-inicial`, anclada en `(-26,-74)`, con la entrada **cerrada**.
- La roca de la cueva es parte de la **capa compartida de colisión** (`isSolidAtArea`). El navegador (`World.isSolid`) y el servicio dan la misma respuesta casilla por casilla, sin componentes montados y sin depender del orden de montaje.
- El footprint y el claro frontal 3×3 son **terreno planificado**. Ningún hogar de salvaje ni ningún errante compartido los ocupa.
- Desaparecen del mundo las otras 5 bocas de Pradera y las 24 de los mundos inalcanzables, junto con la apertura de `DungeonRunPanel`. El prototipo de Dungeon **se conserva**, pero sólo se alcanza por las rutas DEV.
- 14 guardas derivadas de `CAVES`, más un gate que corre el auditor de Pradera. 8 mutaciones detectadas y todos los gates en verde.

## 2. Commits

| # | SHA | Contenido |
| --- | --- | --- |
| 1 | `c767075` | Fuente canónica: `caves.js` + `caves.d.ts`. |
| 2 | `5a6b053` | Consumo por colisión, reserva y dibujo; retiro del acceso procedural. |
| 3 | `1e7985a` | Guardas (`caves.test.js`, `caves.guard.test.ts`), MAP-2 adaptado y scripts alineados o retirados. |
| 4 | `d0f2279` | Informe. |
| 5 | `4515cd4` | Auditor de Pradera: termina con exit 0 y comprueba la cueva canónica; gate `praderaAudit.test.ts`. |
| 6 | `33272d4` | Renombre `dungeonsInWorld` → `worldPlaytestFeaturesEnabled`. |
| 7 | `98a7b3c` | Corrige el 6: la línea del import de Skills vuelve a llevar el gate literal que exige `skillsIsolation.test.ts`, que el 6 había roto (lo detectó el Vitest completo). |
| 8 | *(este)* | Informe actualizado. |

El commit 2 deja en rojo, a propósito, la aserción MAP-2 "las 6 cuevas no se movieron", que el commit 3 reemplaza. La punta de la rama está en verde (§7).

## 3. Diff resumido

| Archivo | Cambio |
| --- | --- |
| `services/realtime/src/world/caves.js` (+`.d.ts`) | **Nuevo.** Fuente canónica. |
| `services/realtime/src/world/resourceZones.js` | `isSolidAtArea` incluye `isCaveRock` e `isPlannedTile` incluye `isCaveReserved`. |
| `services/realtime/src/world/wildPopulation.js` | `wildSpawnTiles` descarta casillas reservadas por una cueva. |
| `services/realtime/src/world/skills/skills.generated.js` | Regenerado: inlinea `resourceZones.js`, que ahora importa `caves.js`. **Sólo agrega** los datos de la cueva, sin cambiar reglas de SKILLS. |
| `src/features/caves/world/caveMouthOverlay.ts` | **Nuevo.** Dibuja las bocas de `caves.js` y su etiqueta. |
| `src/features/caves/art/caveEntranceArt.ts` | Movido desde `dungeonEntrances/art/` sin cambios. |
| `src/features/wildlands/components/WildlandsView.vue` | Sin `DungeonEntrances`, `DungeonRunPanel`, `dungeonRun`, `leaveDungeon` ni `professionClaims`. Instala `CaveMouthOverlay` en todos los builds. El flag `dungeonsInWorld` pasa a llamarse `worldPlaytestFeaturesEnabled`, porque ya no gobierna ninguna Dungeon: habilita la capa de profesiones (`:skills`), el chat de área (`ChatPanel`) y la espera de montaje. Misma condición (`import.meta.env.DEV \|\| isPlaytest`). La línea de `ProfessionWorldDemo` conserva la condición literal a propósito, porque `skillsIsolation.test.ts` exige ver el gate de build en la misma línea del import de Skills. |
| `src/features/wildlands/engine/game.ts` | Los errantes compartidos no caminan por la reserva de una cueva (una condición en `sharedPopulace.walkable`). |
| `src/features/wildlands/engine/placedObjects.ts` | Se elimina el tipo huérfano `'dungeonEntrance'`. |
| `src/features/playtest/domain/cityFeatures.ts` | El aviso del Gimnasio ya no manda a buscar una cueva: "La Dungeon todavía no está abierta: la cueva de la Pradera sigue cerrada." |
| `src/features/dungeonEntrances/components/DungeonEntrances.vue`, `world/caveOverlay.ts` | **Eliminados**, reemplazados por `caves.js` y `CaveMouthOverlay`. |
| `scripts/dungeon-entrances.ts` + script npm `dungeon:entrances` | **Retirados.** Medían las cuevas por semilla, que ya no existen. |
| `scripts/map/audit-pradera.ts` | Lee `cavesIn('pradera')`, sin `seedOf` propio ni colocación. Se retira la propuesta histórica de MAP-1 (mapas 1–4, `proposal.json`, candidatos de zona): buscaba lugar para zonas en un mundo que ya las tiene, fallaba en `reserveSite` y su resultado ya está congelado en `docs/design/map-1/`. La carpeta de salida es obligatoria, sin valor por defecto en `docs/`. Al final comprueba la cueva: una sola, ancla `(-26,-74)`, aproximación alcanzable; si no, exit 1. |
| `src/features/caves/praderaAudit.test.ts` | **Nuevo.** Gate liviano (~1,3 s): corre el auditor real en una carpeta temporal y exige exit 0 y la línea de comprobación de la cueva. |
| `src/features/world/domain/zoneParity.test.ts` | Sin la lista copiada `CAVES_BEFORE_MAP2` ni `seedOf`. Lee `CAVES` y verifica stands y esperas contra footprint **y** claro. |
| `services/realtime/src/world/caves.test.js`, `src/features/caves/caves.guard.test.ts` | **Nuevos.** Guardas. |

## 4. Fuente canónica resultante

```text
CAVES = [
  {
    id: 'pradera-cueva-inicial',   areaId: 'pradera',
    anchor: (-26,-74),  width: 3,  depth: 2,  facing: 'down',
    footprint: (-26..-24, -74) + (-26..-24, -75)        // 6 casillas, todas roca
    mouth:     (-25,-74)                                // futuro portal (roca mientras está cerrada)
    approach:  (-25,-73)
    clearance: (-26..-24, -73..-71)                     // 3×3, incluye la aproximación
    interiorAreaId: 'cueva-inicial',                    // no registrado en ningún protocolo todavía
    entrance: 'closed',
  },
]
cavesIn(areaId) · isCaveRock(areaId, tx, ty) · isCaveReserved(areaId, tx, ty)
```

Los datos autorados son `id`, área, ancla, tamaño, orientación, interior y estado. `defineCave` deriva una vez el footprint, la boca, la aproximación y el claro, y congela el registro; el test de geometría comprueba esa derivación. `caves.js` no tiene dependencias, igual que `resourceZones.js`: Vite lo empaqueta y Node lo ejecuta.

```text
 -75   R R R      R = roca (colisión cliente y servidor)
 -74   R M R      M = boca, roca mientras `entrance: 'closed'`
 -73   . A .      A = aproximación, única vecina abierta de M
 -72   . . .      claro frontal: sin props, nodos, parcelas, portales,
 -71   . . .      stands, esperas, hogares ni errantes
      -26 -25 -24
```

**Quién la lee:**
- `resourceZones.js`, para colisión y terreno planificado.
- `wildPopulation.js`, para hogares.
- `game.ts`, para los errantes.
- `CaveMouthOverlay`, para el dibujo.
- `audit-pradera.ts`, para el mapa.
- Las guardas.

Todos consumen `cavesIn` / `isCaveRock` / `isCaveReserved`. No queda ninguna copia de coordenadas, de `seedOf` ni de la regla de colocación.

## 5. Comportamiento visible

- **Pradera:** en `(-26,-74)` hay una sola roca con boca, el mismo sitio que la antigua "cueva 1", a 24 pasos de la llegada. Es sólida por los cuatro lados. A ≤7 casillas de la aproximación aparece la etiqueta **"Cueva · próximamente"**. Tocarla no hace nada: no hay modal, ni viaje, ni Dungeon.
- **Resto de Pradera:** las otras cinco rocas con boca ya no existen, ni su colisión ni su etiqueta.
- **Otros mundos y Ciudad:** ninguna boca.
- **Todos los builds 0.3** dibujan la cueva, porque su roca colisiona en todos. Antes sólo DEV y playtest tenían cuevas. Producción 0.2 no se toca.
- **Pista de la bandeja:** desaparece "Hay cuevas cerca…".
- **Playtest:** el chat ya no depende de estar en una Dungeon. El aviso del Gimnasio cambió de texto.
- **Prototipo:** `PlayDungeon`, el generador, `DungeonRunPanel` y la colocación/spawn **siguen en el repo**. Sólo se alcanzan desde `/dev/dungeon` y `/dev/superficies?s=dungeon`, dos rutas que el router monta únicamente con `import.meta.env.DEV`. Una guarda falla si cualquier fuente de la aplicación fuera de esas carpetas vuelve a referenciarlos.

### Efectos colaterales, medidos

- **Hogar salvaje:** había una casilla de hogar en `(-26,-75)`, **dentro** de la roca (el problema I3 de CAVES-1). Ahora se descarta, así que los Pokémon del pool horario que usaban las casillas siguientes de esa lista reciben otro hogar. La asignación sigue siendo determinista y la decide el servidor. El cambio queda limitado a esta cueva.
- **Errantes:** las patrullas compartidas se calculan en el cliente con `sharedPopulace.walkable`, que es idéntica en todos los clientes. Ahora evitan footprint y claro.
- **`workPlacement`:** la roca ya no es "standable" para el servidor. No cambió ninguna posición de trabajo, porque las zonas están lejos; la guarda lo comprueba en las más de 300 colocaciones reales.

### Código muerto que queda (documentado, no limpiado)

| Pieza | Estado |
| --- | --- |
| `dungeonEntrances/domain/entrancePlacement.ts` (+ test), `entranceSpawns.ts`, `components/DungeonRunPanel.vue` | Sólo los usa la galería DEV (`devSurfaces/SurfaceGallery.vue`). DUNGEONS-1 decidirá si se reutilizan o se retiran. |
| `playtest/state/usePlaytestStore.ts` `returnFromExpedition` | Sin llamadores desde el mundo. |
| `wildlands/components/worldHints.ts` tono `'dungeon'` | Nadie lo produce ya. |
| Superficie de playtest `'dungeon'` (`playtest.setSurface`) | Ya no se emite desde el mundo. |

## 6. Guardas (derivadas de `CAVES`)

| # | Guarda pedida | Dónde |
| --- | --- | --- |
| 1 | ids únicos | `caves.test.js` › *ids are unique…* (y los ids de interior; ningún id codifica coordenadas) |
| 2 | exactamente una cueva pública | › *exactly one public cave…* (y 0 en Ciudad y en los otros 4 mundos) |
| 3 | ancla exacta `(-26,-74)` | idem |
| 4 | footprint válido y sin agua | › *geometry…*, › *footprint on dry ground…* |
| 5 | aproximación alcanzable por BFS desde la llegada | › *the approach is walkable and reachable…* |
| 6 | laterales y espalda sólidos | › *footprint… every rock tile, sides and back included, is solid* y *the only open neighbour of the mouth is the approach* |
| 7 | aproximación caminable | › *the approach is walkable…* |
| 8 | claro 3×3 libre | idem (no sólido, seco, sin prop, alcanzable) |
| 9 | ningún recurso, parcela, portal o decoración incompatible | › *nothing else occupies the reserve…* (también zonas, rutas, reservas y props autorados) |
| 10 | ningún stand o espera de `workPlacement` en la reserva | › *no work stand or waiting tile…*; `zoneParity.test.ts` › *…a cave or its clearance* |
| 11 | la entrada no abre `DungeonRunPanel` | `caves.guard.test.ts` › *no world surface opens the Dungeon prototype…* |
| 12 | sin entradas por semilla ni por orden de montaje | idem (ninguna referencia a `areaEntrances`/`placeEntrances` fuera del prototipo y DEV) y › *draws exactly the caves of caves.js…* |
| 13 | cliente y servidor: mismo footprint y colisión | › *collides like the service…*; `zoneParity.test.ts` › *draws and collides exactly like the server layer* (radio 64, incluye la cueva) |
| 14 | una mutación de la definición hace fallar las guardas | §8 |
| + | ningún hogar salvaje en la reserva | `caves.test.js` › *no wild home can land in a cave reserve* |
| + | el auditor de Pradera termina limpio y mide la cueva canónica | `praderaAudit.test.ts` (corre el script real; exit 0, ancla y aproximación) |

## 7. Verificación (Node 24.21.0 portable, sobre `98a7b3c`)

| Gate | Resultado |
| --- | --- |
| Auditor de Pradera (`npx vite-node scripts/map/audit-pradera.ts -- <carpeta temporal>`) | ✓ **exit 0** · `cave check: ok — (-26,-74), approach (-25,-73) at 24 steps` · `audit.json` → 1 cueva, ancla `(-26,-74)`, footprint 6, aproximación a 24 pasos. Escribe sólo en la carpeta temporal; `docs/design/map-1/` y `map-2/` sin cambios. Sin argumento termina con exit 2 y no escribe nada. |
| Tests de cuevas (servidor) | ✓ `caves.test.js` 8/8 |
| Tests de cuevas y paridad (cliente) | ✓ 13/13 (`caves.guard.test.ts` 5, `praderaAudit.test.ts` 1, `zoneParity.test.ts` 5, `praderaPortalGuard.test.ts` 2) |
| Mapa, zonas, colisión, `workPlacement` (servidor) | ✓ 29/29 (`resourceZones`, `wildPopulation`, `workPlacement`, `workPlacement.room`) |
| Realtime completo (`node --test "src/**/*.test.js"`) | ✓ 196 pass · 0 fail · 20 skipped (staging, igual que antes) |
| Vitest completo | ✓ 186 archivos · 1821 tests |
| Typecheck (`vue-tsc`) | ✓ exit 0 |
| Lint (`eslint .`) | ✓ exit 0 · 0 errores · 9 warnings, los mismos de antes (`AuthModal.vue`) |
| Build | ✓ exit 0 |
| Drift de SKILLS (`bundle-skills.mjs --check`, `serverBundle.test.ts`) | ✓ exit 0 |
| `zone-layout.ts -- --check` | ✓ exit 0 · "resourceZoneLayout.js is up to date" |

No se corrieron Deno ni staging: no cambian Supabase, Edge Functions, settlement ni persistencia.

Una corrida intermedia del Vitest completo, sobre `33272d4`, falló en `skillsIsolation.test.ts`. Esa guarda exige que el import de Skills lleve el gate de build en la misma línea, y el renombre lo había reemplazado por el flag. `98a7b3c` lo repone. La tabla corresponde a la corrida final.

## 8. Mutaciones

Cada mutación se aplicó con un script, se corrieron `caves.test.js`, `caves.guard.test.ts` y `zoneParity.test.ts`, y se restauró con `git checkout`. Al final, `git status` estaba limpio.

| Mutación | Qué falla |
| --- | --- |
| Entrada movida (ancla `-22,-74`) | *exactly one public cave… at (-26,-74)* |
| Aproximación bloqueada (roca autorada en `-25,-73`) | *approach walkable and reachable*, *nothing else occupies the reserve*, *collides like the service* |
| Lateral caminable (columna izquierda fuera de `isCaveRock`) | *every rock tile… solid*, *only open neighbour of the mouth*, *work stand…*, *collides like the service*, *cave is planned ground…* |
| Recurso dentro del claro (zona + roca en `-26,-72`) | *nothing else occupies the reserve*, *work stand…*, *approach… clearance open*, *collides like the service*, dos de `zoneParity` |
| Reaparece una boca extra (segunda cueva en `caves.js`, sitio de la vieja cueva 2) | *exactly one public cave*, *draws exactly the caves of caves.js*, *clearance open*, *collides like the service* |
| Reaparece la colocación procedural (`areaEntrances` importado en `WildlandsView`) | *no world surface opens the Dungeon prototype or places entrances from a seed* |
| El auditor lanza una excepción después de escribir sus resultados | `praderaAudit.test.ts` (exit ≠ 0) |
| Cueva movida a `(-22,-74)`, vista por el auditor | el auditor termina con exit 1 (`cave anchored at (-22,-74), expected (-26,-74)`) y `praderaAudit.test.ts` falla |

## 9. Compatibilidad

**Sin cambios en:**
- presencia y protocolos (`AREAS`, `ARRIVALS` e `isPresenceAreaId` intactos; `interiorAreaId` no se registra en ningún lado);
- reglas, catálogo, balance ni rendimiento de WORLD/SKILLS (el bundle generado sólo agrega datos de cuevas);
- YIELD-2;
- Supabase, Edge Functions, gate, producción 0.2.

**Cambia el mundo compartido de Pradera sólo en esta cueva:**
- 6 casillas pasan a ser roca para el servidor;
- hay 15 casillas reservadas donde no puede haber hogares ni errantes;
- los hogares salvajes cambian de asignación en consecuencia (ver §5).

Un cliente 0.3 anterior a este cambio no dibujaría la roca. Como la colisión del jugador la decide el cliente (`presence/movement.js`), ese cliente podría atravesarla, pero el servidor no la usa para validar movimiento. Eso no crea ningún estado inválido.

## 10. Riesgos pendientes para CAVES-3

1. **Abrir la boca:** `entrance: 'open'` debe convertir `mouth` en casilla portal y sacarla de `isCaveRock`. Las guardas 6 y 7 ya exigen que la aproximación sea su única vecina abierta.
2. **Área interior:** registrar `interiorAreaId` en `AREAS`, `WORLD_AREAS`, `isPresenceAreaId`, `ARRIVALS`/`arrivalFor` y el Atlas, sin desfasar llegadas cliente/servidor (el problema histórico que documenta `arrival.js`).
3. **Viajes con presencia:** `game.ts` elige el área de presencia con un ternario `ciudad-corazon | pradera` en el callback de `travel.update` y en `requestPresencePlacement`, y hay que generalizarlo.
4. **Reconexión (D8):** devolver a `approach`, que ya es casilla segura y está garantizada por guarda.
5. **Tareas activas:** con un cambio de área real, `reconcileActor` cancela solo. Falta un test de sala que lo cubra.
6. **Tap en la roca:** hoy la cueva no es un objeto colocado, así que un tap sobre la parte alta del arte cae en la casilla de detrás. Si CAVES-3 quiere "tocar la boca para caminar hasta la aproximación", necesita un hitbox.
7. **Código del prototipo:** `entrancePlacement`/`entranceSpawns`/`DungeonRunPanel`/`returnFromExpedition` quedan para DUNGEONS-1.

## 11. Estado

- Push sólo a `world/caves-foundation-0.3`. Sin PR, merge, deploy, tag ni release.
- `pokeswap-caves-audit` y `design/caves-audit-0.3` no se tocaron. Tampoco otros worktrees.

# WORLD VISUAL-1 — Trabajador autoritativo y animación sincronizada

> Rama `world/worker-presentation-0.3`, desde `integration/world-skills-0.3 @ 3317703`. Solo presentación: no cambia tiempos, balance, XP, materiales, settlement, idempotencia, ownership, feature gate, Supabase, migraciones, Edge Functions, depletion, respawn, reglas de desconexión, mapas ni densidad. Producción pública (`playtest/community-0.1`, tag `playtest-0.2 @ dc6dc70`) no se tocó.

## 1. Problema

El Pokémon trabajador tenía dos representaciones: el dueño lo veía desde SKILLS (`workerCompanion`, al lado del *jugador*), y los demás desde WORLD (`workerActors`, lado del nodo más cercano al entrenador, recalculado cada frame con la posición local del entrenador). Resultado: posiciones distintas para dueño y observadores, trabajador propio no necesariamente junto al recurso, animación casi imperceptible (rebote de 2 px) y saltos al desconectarse el entrenador.

## 2. Qué cambió

| Pieza | Cambio |
|---|---|
| `services/realtime/src/world/workerStand.js` (nuevo) | Función pura `workerStand(node, trainer, isOpen, isHidden)` + predicados de terreno `standableTile(areaId)` y `hiddenBehindCanopy(areaId)`. |
| `resourceAuthority.js` | Calcula el stand **una sola vez**, en la adquisición (misma sección síncrona que reserva el nodo), con el tile validado del actor vivo. Se guarda en `record.worker.stand`. |
| `worldProtocol.js` / `.d.ts` | `publicNode` agrega `worker.stand { tx, ty, dir }` si existe. Campo **aditivo y opcional**; `WORLD_PROTOCOL` sigue en 1. |
| `src/features/world/render/workerPose.ts` (nuevo) | Pose pura: inclinación de 3 px hacia el recurso y vuelta, salto de 1,5 px, 2 pasos de sprite por ciclo de 600 ms. Fase = `(serverNow − startedAt) mod 600`. |
| `workerActors.ts` | Único renderer. Usa `worker.stand`; sin él, el fallback anterior (`workerSpot`, relativo al entrenador). |
| `sharedWorld.ts` | Se quitó el filtro que excluía al trabajador propio (salvo parcelas). |
| SKILLS (`gatheringOverlayCore`, `miningOverlay`, `loggingOverlay`, `useSkillsLayer`) | Dejan de invocar/dibujar el compañero. Conservan golpes, chispas, partículas, sacudida, árbol que cae y pops de recompensa. |
| `workerCompanion.ts`, `workerSummon.ts` (+test) | **Eliminados** (AGENTS §14: el camino viejo ya no se alcanza). `workerPresence.ts` queda solo con `isBeside`. |
| `WildlandsView.vue` | El loader de trabajadores usa la hoja overworld empaquetada por id de especie cuando el Pokédex no tiene la entrada (lo que hacía el compañero retirado). Sin esto, el dueño veía una Poké Ball si el Pokédex no cargó. |

`WorldResourceOverlay` sigue sin dibujar sacudida/anillo de progreso para la acción propia (lo hace SKILLS); solo el Pokémon pasó a ser de WORLD.

## 3. Regla del stand (decisiones)

1. Candidatos: vecinos **cardinales** del nodo que sean transitables (no sólido, no agua, no otro nodo ni parcela) y **no** la casilla del entrenador.
2. Orden: **visible** antes que tapado por una copa de árbol (un árbol justo debajo de la casilla se dibuja encima; la copa del propio árbol tapa su lado norte) → **más cerca del entrenador** (Chebyshev: los dos lados que flanquean el lado desde donde interactuó, luego el opuesto) → orden fijo **sur, este, oeste, norte**.
3. Sin cardinales abiertos: **diagonales**, mismo orden. Sin nada: **la casilla del entrenador** (transitable por definición).
4. Siempre mira al recurso (`dir`); en diagonales mira en x.

Decisiones a revisar:
- **No se usa la casilla del entrenador** mientras haya otra: "el lado desde el que interactuó" se interpreta como preferir los lados que lo flanquean, para no superponer sprites durante toda la acción.
- **Visibilidad primero.** En la prueba visual, Talar desde el oeste en un bosquecillo ponía al Pokémon en el sur, completamente tapado por la copa del árbol de abajo (y el norte lo tapa la copa del nodo). Se agregó el criterio de visibilidad (solo terreno, determinista) por encima de la preferencia de lado. Revertirlo es una línea (`isHidden` opcional).
- Solo terreno compartido: el servidor no conoce los objetos colocados del cliente (`placedObjects`); en Pradera hoy no hay ninguno junto a nodos.

## 4. Compatibilidad

- Cliente viejo + servidor nuevo: ignora `worker.stand` (sigue con su lógica).
- Cliente nuevo + servidor viejo: sin `stand`, usa `workerSpot` (fallback anterior) con la animación nueva.
- `stand` no se persiste (las acciones en curso no se restauran tras un reinicio; sin cambio).

## 5. Pruebas

Nuevas o ampliadas:
- `workerStand.test.js`: determinismo; adyacente, transitable y mirando al recurso; desempates y fallbacks (flanco, otro flanco, opuesto, diagonales, casilla del entrenador); visibilidad; terreno real de Pradera; parcelas.
- `workerStand.room.test.js` (WorldRoom real): dueño, observador y recién llegado reciben el mismo stand; moverse alrededor del nodo no lo cambia; desconexión: sigue en su stand y liquida una vez; cancel y cancel-por-movimiento lo quitan.
- `workerPose.test.ts`: misma pose con el mismo reloj; ~3 px y vuelta cada 0,6 s; nunca llega al nodo; frames desde el reloj compartido.
- `workerActors.test.ts`: usa el stand sin importar el entrenador; dos clientes producen el mismo actor; fallback sin stand; limpieza.
- `workerPresentation.acceptance.test.ts` (dos `SharedWorld` + `WorldRoom` reales): una sola representación para dueño y observador, seguidor oculto (sin duplicado), desconexión, complete/cancel/moved.
- Ajustadas dos aserciones de forma exacta (`worldRoom.test.js`, `integration.test.js`) para el campo nuevo.

| Gate | Resultado |
|---|---|
| realtime (`node --test`, Node 22) | 168: **148 pass, 0 fail, 20 skip** (staging RC-0.3: requiere stack Supabase local) |
| integración PGlite (dentro de realtime: `integration.test.js`, `database.test.js`) | pass |
| vitest | **177 archivos, 1715 pass** |
| typecheck | 0 errores |
| lint | 0 errores (9 warnings preexistentes en `AuthModal.vue`) |
| build | OK |
| Deno | **no ejecutado**: Deno no está instalado en esta máquina; no se tocó ninguna Edge Function |
| staging local | **no disponible**: sin Docker ni Supabase CLI |

El Node del sistema es 18.14; el proyecto apunta a 22 (Dockerfile). Se usó un Node 22.23.3 oficial (checksum verificado) en una carpeta temporal, sin tocar el del sistema.

## 6. Verificación visual local

Stack 100 % local: realtime en modo benchmark (`PRESENCE_BENCHMARK=on`), `WORLD_PLAYERDATA=pglite` en memoria, catálogo salvaje sintético; Vite con `VITE_SUPABASE_URL` apuntando a una dirección local muerta. Ningún servicio hosted.

| Oficio | Nodo / entrenador | Stand del servidor | Visto |
|---|---|---|---|
| Talar | árbol `8,-83`, entrenador al oeste | `9,-83` mirando a la izquierda | dueño y observador: mismo Pokémon, mismo tile, sin duplicado |
| Minería | roca `11,-70`, entrenador al oeste | `11,-69` mirando arriba | dueño y observador idénticos; chispas de SKILLS intactas |
| Agricultura | parcela `-7,-73`, entrenador al norte | `-8,-73` mirando a la derecha (las otras parcelas se excluyen) | observador tras desconectar al dueño: sigue en su tile hasta terminar; luego desaparece y la parcela queda plantada |

Las capturas se entregaron aparte (no se versionan).

## 7. Limitaciones y riesgos

1. La visibilidad considera solo copas de árboles justo debajo; copas vecinas pueden tapar parcialmente un borde del sprite.
2. Con el Pokédex caído, dueño y observadores ven la hoja overworld por id (antes, los observadores veían una Poké Ball).
3. Observado solo en el stack local: tras reiniciar el realtime con dos pestañas abiertas, la identidad benchmark `a` quedó sin equipo en `player:state` (otra identidad nueva funcionó). No se investigó a fondo; involucra solo `devPlayerData`/benchmark y no el código de este cambio.
4. Los documentos de SKILLS en `docs/economy/*` siguen describiendo `workerCompanion` como historia de R31; no se reescribieron.

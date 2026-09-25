# WORLD-1A — Auditoría BEFORE (mundo dinámico)

> Rama `world/1-shared-authority`, desde `playtest-0.2` = `dc6dc70` (verificado: `git fetch`, tag, `origin/playtest/community-0.1` y HEAD coinciden; no hubo hotfix posterior).
> Sólo lectura del estado real. Cada afirmación está marcada como **FACT** (leída en el código), **INFERENCE** u **OPEN QUESTION**.
> La lista previa de "compartido / no compartido" se auditó contra el código y se corrigió donde no coincidía (§8).

---

## 1. Mapa de sistemas

```
Navegador                                             Servicio realtime (Colyseus, 1 proceso)
─────────                                             ───────────────────────────────────────
WildlandsView.vue ─ monta ─► WildlandsGame (game.ts)  PresenceRoom.js
  │                          ├ Atlas → Area                ├ actors (Map en memoria, por módulo)
  │                          │   ├ TownArea (Ciudad)       ├ AOI: presence/interest.js
  │                          │   └ WildArea (Pradera)      ├ batching 50 ms, `step` compacto, `via`
  │                          │       └ World(seed) ◄─── terreno determinista, sólo en el cliente
  │                          ├ Populace (NPC, salvajes, plaza) ◄── 100 % local
  │                          ├ SceneOverlay ◄── profesiones (demo local) + entradas de dungeon
  │                          └ remotos ◄── ColyseusPresence ─── WebSocket ──► snapshot/self/delta/batch/chat
  └ ProfessionWorldDemo.vue (playtest/DEV) ── demo local de Skills, sin red
```

- **FACT** — El servicio realtime (`services/realtime`) no conoce el terreno: no sabe qué es sólido, ni dónde hay árboles, ni qué Pokémon hay. Acepta direcciones y aplica un token bucket (`presence/movement.js`). "Walkability is decided by the client either way".
- **FACT** — El servicio es JavaScript sin build (Dockerfile copia `services/realtime/src`; el contexto de build es esa carpeta). No puede importar TypeScript de `src/`. Precedente: `src/features/battle/authority/` (R32.4) dejó su núcleo en TS por esa razón y difirió la decisión de bundler.
- **FACT** — Precedente inverso: módulos JS sin dependencias dentro del servicio que el cliente también consume, con `.d.ts` al lado (`protocol/arrival.js` + `arrival.d.ts`, `presence/movement.d.ts`).
- **FACT** — Estado del servicio en memoria de módulo: sobrevive al `dispose` de la sala pero no a un reinicio del proceso. Reconexión: `ReconnectCache` de 15 s, nunca persistida.

## 2. Generación de recursos

| Qué | Dónde | Estado |
|---|---|---|
| Terreno, biomas, decor | `wildlands/engine/world.ts` + `noise.ts` | **FACT** determinista por `seed` (Pradera = 208). Puro, sin canvas. |
| Nodos de recurso | `professions/domain/nodePlacement.ts` `nodeAt()` | **FACT** determinista: `hash2(tx, ty, seed + NODE_SALT)` contra `ANCHOR_DENSITY` por ancla de decor. Id: `${seed}:${tx}:${ty}:${definitionId}`. |
| Variante del nodo | mismo archivo | **FACT** elegida del catálogo de Skills (`GATHERING_NODES`: bioma, zona, peso). La identidad depende hoy del catálogo de Skills. |
| Agotamiento | `professions/domain/nodeDepletion.ts` | **FACT** "cargas personales": cada jugador tiene su propio contador por nodo; nadie agota un nodo para otro. Nunca se implementó en un servidor. |
| Estado en el playtest | `demo/demoSession.ts`, `useProfessionDemo.ts` | **FACT** demo 100 % local: nivel, energía, agotamiento, drops y XP viven en memoria del navegador. "Local demo session only: no writes, no network, no presence messages." |
| Trabajador Pokémon | `demo/demoWorkers.ts`, `overworld/workerCompanion.ts` | **FACT** especie de un roster fixture (no es propiedad del jugador). Dibujado sólo en el cliente que trabaja; nadie más lo ve. |
| Cristales recogibles | `WildArea.collect()` → `ChunkStore.removeDecor` | **FACT** borrado local de decor ("+1 cristal · demo, no se guarda"). |

**Consecuencia:** la identidad base de un árbol ya es estable entre clientes (misma semilla, mismo hash), pero *todo* su estado mutable es por cliente. Dos jugadores frente al mismo árbol ven dos árboles independientes.

## 3. Entidades dinámicas

| Entidad | Código | Identidad | Especie/aspecto | Posición | Veredicto |
|---|---|---|---|---|---|
| Jugadores | `PresenceRoom`, `game.ts` remotos | servidor (user id) | servidor (personaje) | servidor (pasos) | **Compartido** |
| Companion (seguidor) | `companionId` en presence | servidor, ownership validada contra `slots` al entrar | servidor | derivada del dueño en cada cliente | **Compartido** (identidad); posición derivada |
| Residentes de Ciudad | `townPopulace.ts` (`stationary`) | determinista (`town:r${i}`) | determinista | fija | **Compartido** (determinista, correcto) |
| Wanderers de Ciudad | `townPopulace.ts` + `wander()` | determinista (`town:n${i}`) | determinista | **`Math.random` por cliente** | **No compartido** |
| Pokémon de plaza | `plazaPokemon.ts` | lista top-10 por precio calculada **en cada cliente** desde datos de mercado | por id | casa asignada **según el orden de llegada** (depende de la historia del cliente) + `wander()` aleatorio | **No compartido** |
| Pokémon salvajes | `population.ts` + `pokemon/domain/wildPool.ts` | slots por chunk deterministas, pero la especie sale de un pool de 25 **tirado con `Math.random` en cada cliente** cada hora, y además depende del orden de carga de chunks (`spawnedPokemonIds`) | por cliente | `wander()` aleatorio | **No compartido** |
| NPC entrenadores de Pradera | `population.ts` | determinista por chunk | determinista (hash) | `wander()` aleatorio | **No compartido** (posición) |
| Trabajo de profesión | demo local | — | — | — | **No compartido** (nadie ve a otro trabajar) |
| Hora del día | `game.ts` `clock = 0.4` + `dt` | — | — | — | **No compartido** (cada sesión arranca a la misma hora local) |
| Clima | `atmosphere.weatherAt(…, this.seconds, seed)` | — | — | — | **No compartido** (usa segundos de sesión) |

## 4. Colisión

- **FACT** — `game.ts` `rules.occupied` bloquea al jugador local contra *cualquier* actor de `populace` (NPC y Pokémon locales). El servidor no lo sabe.
- **FACT** — Con posiciones aleatorias por cliente, A se frena contra un NPC que B no tiene ahí: B ve a A pararse sin motivo (PERF-1 §13, "NPC/hitbox descartado como causa de snaps, movido a WORLD-1").
- **FACT** — `TapNavigator.occupied` usa la misma población local.
- **FACT** — La interacción "hablar" (`interact`) congela el `nextThink` del NPC 3 s localmente.

## 5. Realtime / transporte

- **FACT** — Mensajes: `presence:snapshot|self|delta|batch|error`, `chat:*`. Un único socket por jugador.
- **FACT** — Batching de 50 ms por cliente, una entrada por actor, `step` compacto (protocolo 2) con `via` apilado (PERF-2.3).
- **FACT** — Negociación por opción de join (`presenceProtocol`), así el servidor puede desplegarse antes que el frontend.
- **FACT** — No hay reloj compartido: el servidor nunca envía su hora.

## 6. AOI

- **FACT** — `presence/interest.js`: Ciudad = Chebyshev 20; Pradera = Chebyshev 20 **o** mismo/adyacente sector de 12; retención +6 (histéresis PERF-2.4).
- **FACT** — Sólo aplica a jugadores. No hay interés espacial para ninguna otra entidad porque no existen en el servidor.
- **FACT** — Cliente: `Population` puebla 3×3 chunks de 32 alrededor del jugador y libera a distancia > 2 chunks.

## 7. Persistencia y ciclo de vida

- **FACT** — Nada del mundo dinámico se persiste en ningún lado. Todo muere con la pestaña o con el proceso realtime.
- **FACT** — Supabase: `slots` (propiedad, `is_locked` = publicado en mercado) y `pokemon` (catálogo) se leen con la clave publishable; el plaza lee `slots` completo (`lobby/api/plazaApi.ts`).
- **FACT** — Instancia de Pokémon en producción: todavía es la fila legacy `slots.pokemon_id` (un Pokémon = un id único; R32.2 define `PokemonInstance` pero no está migrado).
- **FACT** — El servicio realtime tiene `SUPABASE_URL` + clave publishable y ya valida el companion con el token del usuario (`authorizedCompanion`). No tiene service-role y no escribe.

## 8. Corrección de la lista previa

| Lista previa | Resultado de la auditoría |
|---|---|
| "Compartido: ubicaciones base de recursos" | **Correcto a medias**: la posición es determinista, pero la *variante* depende del catálogo de Skills (que se va a reemplazar) y el estado no existe en el servidor. |
| "Compartido: residentes" | **Correcto** (estacionarios, deterministas). |
| "Compartido: identidad básica del companion" | **Correcto**. |
| "No compartido: especie/posición de salvajes" | **Correcto**, y peor de lo listado: el pool se re-tira por cliente y además depende del orden de carga de chunks. |
| "No compartido: wanderers, plaza" | **Correcto**; en plaza también la *casa* depende del orden de llegada. |
| "No compartido: estado de recursos, acciones, companion trabajando" | **Correcto**; además el modelo de agotamiento vigente es por jugador ("cargas personales"), que contradice el producto pedido. |
| "Algunos sistemas ambientales" | **Concreto**: hora del día, clima y cristales recogibles. |
| (no listado) | NPC entrenadores de Pradera: identidad determinista, posición aleatoria. |

## 9. Riesgos detectados para el diseño

1. **El servidor no tiene terreno.** Cualquier validación de "este árbol existe en (x, y)" o "este tile es caminable" exige que el servidor ejecute el mismo generador. Hoy vive en TS dentro de `src/`.
2. **Identidad de nodo acoplada a Skills.** `nodeAt` elige `definitionId` del catálogo de Skills; si SKILLS cambia el catálogo, cambian los ids de los nodos. WORLD no puede depender de eso.
3. **El agotamiento personal** (`personalCharges`) es incompatible con "si se agota, se agota para todos". Es un cambio de producto explícito del pedido de WORLD-1; se documenta como tal.
4. **`game.ts` tiene 1 070 líneas** (AGENTS §6/§24): no se le puede sumar un sistema; cualquier integración tiene que ser un puerto chico.
5. **Skills en paralelo**: `src/features/professions/**` es de la otra estación. WORLD no puede editar esos archivos sin detenerse (§ "Archivos compartidos" del pedido).
6. **OPEN QUESTION** — El respawn es hoy un número del catálogo de Skills (`respawnSeconds`, 90–900 s por definición). Se decide en WORLD-1B quién lo posee.

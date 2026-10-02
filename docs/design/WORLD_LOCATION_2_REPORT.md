# WORLD LOCATION-2 — Persistencia autoritativa de la ubicación (implementación local)

> Rama `world/location-persistence-0.3`, desde `f558fca` (auditoría aprobada `design/world-location-persistence-0.3`).
> Integración de referencia: `integration/world-skills-0.3 @ 15f5f4f`.
> **Revisión 1 (2026-10-02):** la rama se descongeló en `7c3b723` solo para corregir los findings B1, B2, B3 y M2 de la revisión (§R).
> **Nada aplicado ni desplegado:** ni migración hosted, ni `world-authority`, ni secretos, ni flag en el entorno oscuro, ni merges. No se tocaron Playtest, producción, el gate, los testers ni otros worktrees.
> **Staging sigue pendiente:** Docker/WSL no funcionan en esta máquina y no se intentó repararlos ni liberar espacio. **No se declara staging aprobado.**
> Etiquetas: **FACT** (ejecutado o leído), **INFERENCE** (deducido, a verificar), **NO EJECUTADO** (gate pedido que no pudo correr).

## 0. Resumen

- **Qué hay:**
  - una migración nueva y única;
  - dos operaciones nuevas en `world-authority`;
  - adaptadores;
  - versión de layout por área;
  - un journal coalescido con CAS `epoch + seq`;
  - claims **condicionales** sobre el epoch leído (revisión, B2);
  - integración en `PresenceRoom` con hidratación asíncrona;
  - flush de apagado;
  - flag `WORLD_LOCATION_PERSISTENCE=off|shadow|on`, `off` por defecto;
  - métricas.
- **Revisión 1:**
  - B1: `shadow` ya no es invasivo.
  - B2: un claim abandonado ya no desplaza a la sesión viva.
  - B3: un claim tardío ya no mueve a un jugador publicado.
  - M2: la versión de la Pradera ya no muestrea.
  - Los tres repros del revisor (R1, R2, R3) son tests permanentes. Fallaron sobre el código anterior y pasan ahora (§R).
- **Protocolo de cliente y `/version`:** sin cambios. Nada nuevo llega al bundle del navegador (FACT: 0 coincidencias en `dist/` normal y Playtest).
- **Pruebas** (FACT, punta de la rama):
  - realtime: 457 aprobados y 0 fallos en Node 22 y en Node 24 (31 omitidos: 21 de staging general y 10 de staging de ubicación);
  - 11/11 contratos Deno de `world-authority`;
  - **54/54 mutaciones** detectadas, con el árbol restaurado;
  - simulación de **dos procesos reales**: 17/17 chequeos;
  - benchmark de 100 jugadores: p99 del event loop dentro de ±1,2 % de `off` y **≤ 1 invocación/s**.
- **No ejecutado:** el stack Supabase local y el staging completo (§8).
- **Cambios respecto de la auditoría:**
  - el `await` del claim no va antes del reemplazo atómico: el brief pidió reservar la sesión sin esperar la base e hidratar después (§3);
  - el claim es condicional (§5.1);
  - el claim tardío ya no restaura (§3, regla 3).

## R. Revisión 1: hallazgos y correcciones

| Finding | Repro del revisor | Commit | Corrección |
| --- | --- | --- | --- |
| **B1** shadow invasivo | R1 | `022e0c9` | En `shadow`, un `stale` solo valla al escritor y suma `shadow.wouldFence`. No desconecta, no cambia la presencia, no cancela acciones, no mueve al jugador ni cambia la razón de cierre, y la casilla entra igual en la `ReconnectCache`. El reemplazo local en `shadow` cierra con `4001` sin razón, igual que `off`. `session-replaced` es exclusivo de `on` |
| **B2** claims abandonados o fuera de orden | R2 | `097696d` | Claim **condicional** sobre el epoch leído (§5.1) |
| **B3** claim tardío con teletransporte (incluye M1 de la revisión) | R3 | `074cfc4` | La frontera es la **publicación** (§3, regla 3). Se eliminaron la ventana de 5 s (`LATE_APPLY_WINDOW_MS`) y la lógica `pristine`/`acted` |
| **M2** huella dispersa de Pradera | — | `c57a8fb` | Huella de los datos canónicos completos más `TERRAIN_GENERATOR_VERSION` junto al generador, con guards (§4) |
| Controles negativos | — | `74d34fa` | M41–M54 nuevos; M4, M6, M10 y M32 siguen al código nuevo (§10) |
| Gate frágil | — | `11c31b0` | El test de costo de M2 usaba una cota de reloj (150 ms) que falló con la suite completa en paralelo (376 ms, Node 22 y 24). Ahora prueba la propiedad: solo se leen casillas de la ventana authored, cada una una vez |

**Reproducción invertida (FACT).** Cada test nuevo se corrió primero sobre el código anterior a su corrección y falló por la causa que señaló el revisor:

| Repro | Sobre el código anterior | Después |
| --- | --- | --- |
| R1 · `shadow` + `stale` | `leaves = [[4001, 'session-replaced']]` (esperado `[]`). El reemplazo local en `shadow` cerraba con `'session-replaced'`. La sesión legítima nueva en otra instancia, en `shadow`, desconectaba a la vieja | 0 desconexiones y `wouldFence = 1`. La presencia no cambia (los observadores no reciben deltas), el jugador sigue jugando y una reconexión sale de la cache |
| R2 · C1 abandonado, C2 vivo (`on`/`shadow` × una/dos instancias) | C1 tardío llevaba el epoch de 2 a 3 en los cuatro casos, así que C2 quedaba `stale` | C1 tardío responde `conflict` y no escribe. C2 guarda sin `stale` ni 4001 |
| R3 · claim tardío tras el fallback publicado (nada, chat, `cancelWork`, paso rechazado, área rechazada) | El jugador terminaba en `cueva-inicial (12, 8)` | Sigue en Ciudad `(31, 20)`, sin snapshot nuevo ni leave/upsert a observadores. La fila pasa a Ciudad en el siguiente tick y una restauración posterior nunca devuelve la cueva |

Los mismos tres efectos se vuelven a provocar en cada corrida de mutaciones: M41 (R1), M44/M45 (R2), M32/M51 (R3).

**Recomendaciones no bloqueantes L1, L3 y L4:** registradas en §12, sin ampliar el alcance.

## 1. Commits

| SHA | Commit |
| --- | --- |
| `d4be8da` | 1 · `feat(db)`: `world_player_locations` + claim/save (INVOKER, solo `service_role`) |
| `7e55c3f` | 2 · `feat(world-authority)`: `location_claim` / `location_save` |
| `2fe5059` | 3 · `feat(realtime)`: adaptadores (Edge + PGlite) |
| `8eb4d91` | 4 · `feat(realtime)`: versión de layout por área persistible |
| `6345580` | 5 · `feat(realtime)`: `LocationJournal` |
| `1600b85` | 6 · `feat(presence)`: reserva sin esperar, hidratación, vallado |
| `52145a7` | 7 · `feat(realtime)`: flush de apagado ordenado |
| `42e669c` | 8 · `feat(realtime)`: gate `WORLD_LOCATION_PERSISTENCE` |
| `3e50ae3` | 9 · `test(staging)`: vallado entre dos instancias (stack local) + simulación de dos procesos |
| `2eecbc4` | extra · `perf(realtime)`: un lote por segundo; huellas de layout al arrancar |
| `3fba3fe` | extra · `test(world-location)`: runner de mutaciones, autoridad local, benchmark de ubicación |
| `1ce6ea4` | extra · `test(realtime)`: dos tests de autoridad colgada en Node 22 |
| `ce73757` | 10 · `docs`: informe y baselines |
| `7c3b723` | `chore(lint)`: `cas-model.mjs` pasa ESLint (sin cambio de lógica) |
| `022e0c9` | **R** · `fix(presence)`: `shadow` nunca desconecta ni olvida (B1) |
| `097696d` | **R** · `fix(location)`: claims condicionales (B2) |
| `074cfc4` | **R** · `fix(presence)`: un claim tardío nunca mueve a un jugador publicado (B3) |
| `c57a8fb` | **R** · `fix(world)`: la versión de la Pradera hashea todos sus datos canónicos (M2) |
| `74d34fa` | **R** · `test(world-location)`: controles negativos M41–M54 |
| `11c31b0` | **R** · `test(world)`: costo de la huella por casillas leídas, no por reloj |
| *(este)* | **R** · `docs`: este informe y los baselines de la revisión |

Commits nuevos, sin amend ni rebase.

## 2. Diff resumido

- Desde `f558fca`: 42 archivos, +5.420 / −25, antes de este informe.
- Revisión 1 (`7c3b723..11c31b0`): 23 archivos, +821 / −215.

| Capa | Archivos |
| --- | --- |
| Base (archivo, sin aplicar) | `supabase/migrations/20261001220000_world_player_locations.sql`. Fuera de migraciones: `scripts/world-location/rollback_world_player_locations.sql` y `location-grants-check.sql` |
| Edge (sin desplegar) | `supabase/functions/world-authority/handler.ts` (+ tests) |
| Realtime: persistencia | `world/persistence/playerData.js`, `playerDataMetrics.js`, `dev/devPlayerData.js`, `dev/localDatabase.js`, `world/worldConfig.js` |
| Realtime: dominio | `world/layoutVersion.js`, `world/terrain.js` (solo la constante `TERRAIN_GENERATOR_VERSION`), `presence/locationJournal.js`, `presence/locationPolicy.js`, `presence/locationService.js` |
| Realtime: sala | `rooms/locationJoin.js` (187 líneas) y `rooms/PresenceRoom.js` (452; 384 antes de WORLD LOCATION). La lógica de ubicación quedó fuera de la sala central (AGENTS §24) |
| Proceso | `index.js` (`onShutdown`), `observability/metrics.js` (`location`), `.env.example`, `README.md` |
| Herramientas | `scripts/world-location/{two-instances,localAuthority,mutations}.mjs`, `scripts/benchmark-navigation.mjs --location`, README de rc03-staging |
| Docs | este informe, `docs/performance/baselines/world-location-2/` (y `review-1/`) |

## 3. Reglas de conexión (aplicadas)

1. **Reemplazo atómico sin esperar la base.** En el join, `previous.leave(...)`, la reserva del `userId` y la creación de la sesión del journal son síncronas. No hay ningún `await` antes.
2. **Hidratación** (`on`, sin actor vivo ni `ReconnectCache`):
   - el socket queda reservado pero **sin actor**: nada se publica a otros jugadores;
   - `move`, `area`, `world:work` y `chat` se rechazan, y `ready` se difiere;
   - con la respuesta del claim, se coloca en la fila validada;
   - a los **1,5 s** (`HYDRATION_TIMEOUT_MS`), se coloca en Ciudad en estado `unclaimed`.
3. **Claim tardío (revisión, B3): la frontera es la publicación.**
   - Si el claim responde **antes** de admitir y publicar al actor, puede restaurar la ubicación de la fila.
   - Una vez publicado el fallback al cliente o a los observadores, ningún claim lo mueve. El claim:
     - solo adquiere el epoch;
     - adopta la posición autoritativa actual;
     - encola un **guardado urgente** de esa posición (siguiente tick);
     - nunca cambia área ni casilla, nunca reproduce la ubicación vieja y no envía snapshot ni deltas.
   - Métrica: `late.adopted`. Ya no existen la ventana de 5 s ni la lógica `pristine`/`acted`.
4. **`ReconnectCache` sigue ganando**, pero cada sesión nueva reclama igual un epoch (en segundo plano) para poder escribir.
5. **Sesión vallada** (un `stale` sobre el epoch vigente):
   - deja al escritor sin escribir al instante, en `shadow` y en `on`;
   - **solo en `on`**: cierra el socket con **`4001` `session-replaced`** (D-L2), y su casilla **no** se guarda en la `ReconnectCache` (le ganaría a la fila de la sesión nueva);
   - **en `shadow`** (B1): nada visible cambia (sin desconexión, presencia, acciones, movimiento ni razón de cierre) y la casilla entra en la cache como antes de WORLD LOCATION. Se cuenta en `shadow.wouldFence`.

   El reemplazo local usa `4001 session-replaced` solo en `on`. En `off` y `shadow` sigue siendo `leave(4001)`, como hoy.

## 4. Esquema y operaciones

**`public.world_player_locations`** (sin cambios en la revisión):
- `user_id` PK, FK a `auth.users` con `ON DELETE CASCADE`;
- `area_id`, `tx`, `ty` y `layout_version`: los cuatro `NULL` o los cuatro no `NULL`; regex y rangos ±4096 por `CHECK`;
- `epoch ≥ 1`, `seq ≥ 0`, `updated_at` (solo diagnóstico);
- `fillfactor 80`.

**Seguridad:**
- RLS activado y **ninguna política**;
- `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` **y `service_role`**;
- después, `GRANT SELECT, INSERT, UPDATE` solo a `service_role`, sin `DELETE` ni `TRUNCATE`;
- las dos funciones son `SECURITY INVOKER`, con `search_path=public` y `EXECUTE` solo para `service_role`.

**`world_location_claim(uuid, bigint) → jsonb`** (revisión, B2; antes `(uuid)`):
- `p_expected_epoch`: el epoch que el llamador leyó por última vez (`0` = sin fila);
- escribe solo si el epoch guardado sigue siendo ese, en una sola sentencia:
  - `0` → `INSERT … ON CONFLICT DO NOTHING`;
  - otro valor → `UPDATE … SET epoch = epoch + 1, seq = 0 WHERE epoch = p_expected_epoch`;
- respuestas:
  - escribió → `{status:'claimed', epoch, location|null}`, con la ubicación anterior intacta;
  - el epoch cambió → `{status:'conflict', epoch: <actual, 0 si no hay fila>}`, sin escribir nada;
  - usuario inexistente → `{status:'unknown_user'}`, sin escribir nada. Lo decide la FK;
  - `p_expected_epoch` `NULL` o negativo → error.

**`world_location_save(jsonb) → jsonb`** (sin cambios):
- de 1 a 200 filas, una por jugador;
- devuelve `[{userId, result}]` en el orden de entrada;
- bloquea las filas en orden de `user_id`, sin deadlocks entre lotes cruzados;
- cada fila: `UPDATE … WHERE epoch = p.epoch AND seq < p.seq`;
- si no aplicó: `stale` (no hay fila u otro epoch) o `duplicate` (mismo epoch, `seq ≤` guardado);
- `invalid` si la forma de la fila es mala (comparaciones seguras ante `NULL`);
- un lote malformado (vacío, > 200, usuario repetido o no UUID) lanza error y no escribe nada.

**`world-authority`:**

| op | Valida | Llama |
| --- | --- | --- |
| `location_claim` | `userId` UUID **y `expectedEpoch` entero seguro ≥ 0** (si no, `400 invalid_epoch`) | `world_location_claim(p_user_id, p_expected_epoch)` |
| `location_save` | 1–200 filas reconstruidas campo por campo (descarta extras): UUID único, `epoch`/`seq` enteros seguros ≥ 1, `areaId` y `layoutVersion` por regex, `tx`/`ty` en ±4096. Una fila mala → `400` para todo el lote | `world_location_save` |

- Ninguna de las dos pasa por el gate de WORLD × SKILLS (D-L4).
- Los errores de la base no salen en la respuesta.

**Restauración** (`presence/locationPolicy.js`, siempre contra la navegación canónica):

| Situación | Resultado |
| --- | --- |
| Área inexistente o retirada | Ciudad |
| Cliente sin `worldProtocol ≥ 3` con la fila en una cueva (D-L6) | Aproximación de la cueva en la Pradera |
| Otra `layout_version` (D-L8) | Llegada del área |
| Casilla sólida, inalcanzable, portal o fuera del borde | Llegada del área |
| Caso normal | La casilla, mirando `down` (D-L7) |

- Los pisos `dg:<id>:<n>` guardan el ancla exterior de su cueva (D-L9). El registro `dungeonId → cueva` está vacío hasta que existan las Dungeons.

**Versión de layout** (`1.<12 hex de sha256>` por área; congelada por test):
- **Ciudad y cuevas:** cada casilla clasificada, más un borde de una casilla. Sin cambios: Ciudad `1.f04b84e25e1a`, cueva `1.54820710979b`.
- **Pradera** (revisión, M2): **nada se muestrea**. La versión hashea todos los datos canónicos completos:
  - `TERRAIN_GENERATOR_VERSION`, semilla, límites, llegada y pad de regreso;
  - cada zona, reserva, ruta, cueva y portal;
  - cada casilla de la capa authored;
  - además, cada casilla de la ventana authored con margen.

  La retícula de 64 se eliminó. Un cambio de **datos** en cualquier punto del cuadrado ±4096 cambia la versión por sí solo. Un cambio de **código** del generador o de las colisiones la cambia a través de `TERRAIN_GENERATOR_VERSION`. Nueva versión congelada: `1.7eb512c66092` (antes `1.bbce2fd97f67`; no hay ninguna fila guardada en ningún entorno).
- **`TERRAIN_GENERATOR_VERSION`** (en `terrain.js`, junto al generador), con su obligación documentada ahí:
  - se sube en el mismo commit que cualquier cambio de código que pueda mover una casilla, para cualquier semilla, en el generador, `SOLID_DECOR` o las reglas de colisión (`resourceZones.js`, `caves.js`, `navigation.js`);
  - los datos authored no la requieren.
- **Guards** (`layoutVersion.test.js`):
  - digest congelado del código de esos cuatro archivos (sin comentarios ni espacios) por versión. Un cambio de código sin versión nueva falla, incluso si toca solo casillas lejos de todo lugar authored (mutación M53);
  - el navegador importa el mismo generador y las mismas colisiones (sin fork en `wildlands/engine`);
  - la persistencia lee la misma constante;
  - `worldFingerprint.test.ts` (Vitest) sigue congelando salidas muestreadas.
- **Costo:** una huella nueva de la Pradera lee solo la ventana authored (< 20.000 casillas, probado por conteo). Se calcula una vez al construir el servicio activo y nunca en un guardado.

## 5. Semántica exacta de claim y save

- **Identidad:** solo `userId` de Supabase (UUID) verificado en el join. Invitados, `benchmark-*` y cualquier id no UUID no persisten nunca. Nada del payload del cliente (área, coordenadas, layout, epoch, seq) se usa: el journal lee el actor autoritativo.
- **Epoch:**
  - lo emite la base, con un claim condicional (§5.1);
  - los claims de un mismo jugador se **encadenan** en el proceso, y la sesión más nueva siempre obtiene el epoch más alto.
- **Seq:**
  - es un contador del journal por epoch, que empieza en 0 tras cada claim. **Nunca `moveSequence`** (test con `moveSequence = 2^53−1`; mutación M12);
  - un reintento de la **misma** ubicación reusa `(epoch, seq)`;
  - una ubicación **distinta** siempre recibe un seq nuevo, así que un `duplicate` nunca esconde datos nuevos (M20).
- **Resultados por usuario:**

  | Resultado | Efecto |
  | --- | --- |
  | `applied` / `duplicate` | Confirman solo a ese usuario |
  | `stale` del epoch vigente | Valla al escritor. En `on` cierra ese socket con 4001; en `shadow` solo suma `wouldFence` |
  | `stale` de un epoch anterior del mismo jugador | Se descarta |
  | `unknown` | Reintenta solo a ese usuario |
  | `invalid` | Descarta esa fila |

  Una respuesta sobre un usuario no enviado no confirma a nadie (M11, M13).
- **Sesión sin claim** (`claiming`/`unclaimed`):
  - juega normalmente;
  - no ejecuta `location_save`;
  - guarda un solo slot coalescido;
  - reintenta el claim con backoff de 1 s a 30 s (con jitter de hasta 250 ms) mientras está conectada;
  - al desconectarse, su slot se descarta y se cuenta, porque reclamar en ese momento podría vallar a una sesión nueva en otra instancia.
- **Memoria acotada:** un slot por jugador y como máximo 1.000 entradas; se expulsan los desconectados más viejos (`dropped.evicted`). Nunca se expulsa una entrada con un claim en cola o en vuelo.
- **Cadencia:**
  - urgente (portal, desconexión o posición adoptada por un claim tardío) en el próximo tick, ≤ 1 s;
  - checkpoint: ≥ 10 s desde la última escritura del jugador, **más un jitter determinista y acotado** en [0, 2 s), derivado del `userId` con FNV-1a;
  - lotes ≤ 200 y un solo lote en vuelo;
  - **tick de 1 s ⇒ ≤ 1 `location_save` por segundo por proceso**;
  - backoff de lote de 1 s a 30 s.
- **Pérdida aceptada:**
  - con la autoridad sana, los portales y las desconexiones salen en ≤ 1 s;
  - si caen a la vez la autoridad y el proceso, puede perderse el último tramo: como mucho el último checkpoint (≤ 12 s de caminata) y, si la caída dura, también el último cruce;
  - la restauración siempre cae en un lugar seguro. **No se afirma que el área nunca se pierda.**
- **Apagado:** `onShutdown` llama a `flushAll(3 s)` después de que Colyseus desconectó a todos. Es best-effort: nunca espera más allá del plazo, aunque la autoridad esté colgada, y la corrección no depende de él.

### 5.1 Claims condicionales (revisión, B2)

**El problema (R2).**
1. C1 empieza para un jugador.
2. Su respuesta HTTP se abandona (el adaptador Edge aborta a 1,5 s) o su socket desaparece.
3. C2 empieza, pasa a ser la sesión viva y reclama el epoch `e`.
4. La operación de C1 llega a la base **después**: con el claim incondicional, el epoch pasaba de `e` a `e + 1`.
5. El siguiente `save` de C2 volvía `stale`: C2 quedaba vallada y, en `on`, desconectada con 4001.

Abortar el `fetch` no alcanza: la Edge Function o PostgreSQL pueden seguir ejecutando y confirmar después.

**Mecanismo elegido (el mínimo correcto): claim condicional sobre el epoch leído.** En la base, `world_location_claim(user, expected)` escribe solo si el epoch guardado sigue siendo `expected` (§4). Si no, responde `conflict` con el epoch actual y no escribe nada. En el realtime (`locationJournal.js`):

1. **Solo la sesión viva y actual envía claims.** Antes de cada ronda, `#mayClaim` exige que el journal no esté deshabilitado, que `session.live` sea verdadero, que `entry.session === session` y que la entrada siga registrada. Un claim nunca sale para una sesión cerrada o reemplazada (M46).
2. **Conflicto → leer y reclamar después:** el journal guarda el epoch devuelto (`knownEpoch`) y, si la sesión sigue viva, reclama con él (M48). Hace como mucho 3 rondas; después cuenta `failed` y sigue el backoff de siempre.
3. **Encadenado por jugador:** los claims del mismo jugador en el proceso van en cadena. La entrada **no se olvida ni se expulsa** mientras haya un claim suyo en cola o en vuelo (`claimsInFlight`, M47).
4. **Espera acotada en el servidor:** el journal no espera una llamada de claim más de 5 s (`CLAIM_WAIT_MS`), cualquiera sea el adaptador (el de Edge corta a 1,5 s; M50). Dejar de esperar es seguro porque la llamada tardía es condicional.
5. `knownEpoch` vive en la entrada: una sesión nueva del mismo jugador en el mismo proceso reclama en una sola llamada.

**Por qué resiste una respuesta HTTP abortada y una operación de base que termina tarde.** El claim de C1 escribe solo si **ningún otro claim confirmó** desde que C1 leyó su epoch, sea cual sea el momento en que se ejecute:
- **C2 confirmó antes de que C1 llegara:** el epoch ya no coincide y C1 es un no-op (`conflict`), aunque llegue minutos después.
- **C1 confirmó antes de que C2 leyera:** C2 ve el epoch nuevo y reclama después de él, así que C2 termina con el más alto.
- **C1 confirmó entre la lectura y la escritura de C2:** la escritura de C2 da `conflict`; C2 relee, reclama después y también termina arriba.
- No se compara ningún reloj, ni de cliente ni de servidor, ni `moveSequence`, ni nada del payload.
- Funciona igual entre dos instancias, porque decide la fila en la base.

**Lo que se conserva.**
- Una sesión nueva **real** sigue desplazando a la anterior: reclama después de ella, y la anterior recibe `stale` en su próximo guardado (4001 en `on`, `wouldFence` en `shadow`).
- Tabla, CAS de `save`, grants y RLS no cambian. Cambian solo la firma y el contrato del claim: no hizo falta un cambio significativo de esquema ni de la semántica CAS, que es la condición del brief para detenerse.

**Cota y costo.**
- Un claim abandonado puede escribir como mucho una vez, y solo si nadie reclamó desde su lectura. En ese caso le gana el siguiente claim vivo.
- Un jugador con fila que entra a un proceso que no conoce su epoch hace dos llamadas (`conflict` y `claimed`): un RTT más dentro de los 1,5 s de hidratación. Un jugador nuevo, o uno conocido por el proceso, hace una.

## 6. Métricas (`/metrics` → `location`; nunca `/version`, D-L5)

| Campo | Contenido |
| --- | --- |
| `mode`, `effective` | `off`, `shadow`, `on` o `unavailable` (sin adaptador de ubicación) |
| `restores` | `live`, `cache`, `row`, `noRow`, `failed`, `timeout`, `unknownUser` |
| `repairs` | `area`, `layout`, `tile`, `protocol` |
| `late` | `adopted` (revisión: antes `applied`, `ignored`) |
| `shadow` | `wouldRestore`, `wouldRepair`, **`wouldFence`** (qué habría hecho `on`) |
| `fencedDisconnects` | Sesiones valladas cerradas con 4001 (solo `on`) |
| `hydration` | `started`, `maxMs` |
| `journal` | Sesiones vivas por estado, `entries`, `pending`, `urgent`, `inflight`, `backoffMs`, `claims{ok, unknownUser, failed, superseded, retries, conflicts, abandoned}`, `saves{batches, rows, applied, duplicate, stale, staleOldEpoch, invalid, unknown, failedBatches, unchanged, maxBatch, lastBatchMs}`, `fenced`, `dropped{evicted, unclaimed, invalid, disabled}` |

Además, `world.playerData` suma `locationClaim` y `locationSave` (llamadas, fallos y latencias). Ningún campo lleva ids, áreas, casillas, epochs ni versiones de layout (test dedicado).

## 7. Benchmark (100 jugadores, 60 s, semilla 4)

**Escenario:**
- `scripts/benchmark-navigation.mjs --location <modo>`: los caminantes de CAVES-4 con rutas y cruces reales;
- los jugadores autentican con token, como UUID que persisten, y arrancan en Ciudad;
- el servidor es un proceso realtime real que usa la autoridad local (el handler real sobre PGlite);
- solo cambia el flag entre corridas.

**Revisión 1** (`11c31b0`; JSON en `docs/performance/baselines/world-location-2/review-1/`):

| | `off` | `shadow` | `on` |
| --- | --- | --- | --- |
| Pasos aceptados (cliente = servidor) | 40.995 | 40.807 | 40.807 |
| Cruces aceptados | 505 | 501 | 501 |
| Rechazos inesperados / fugas / errores | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Event loop p50 / **p99** / máx. | 29,93 / **39,58** / 74,12 ms | 30,15 / **40,04** / 45,97 ms | 29,88 / **39,58** / 149,42 ms |
| Δ p99 frente a `off` | — | +1,2 % | 0,0 % |
| RTT del ack p99 | 72,6 ms | 73,4 ms | 81,2 ms |
| `location_save`/s | 0 | **0,86** | **0,86** |
| Filas/s | 0 | 13,99 | 14,29 |
| Claims (`ok` / `conflicts`) | 0 | 100 / 0 | 100 / 0 |
| `stale` | — | 0 | 0 |
| RSS final / pico | 205 / 206 MB | 207 / 209 MB | 207 / 210 MB |

**Lectura:**
- El criterio del p99 (> 5 % = falla) se cumple, y también el de ≤ 1 invocación/s.
- **Máximo de 149 ms en `on`:** no se reprodujo. Dos repeticiones idénticas de `on` dieron 51,8 y 53,2 ms de máximo, con p99 de 40,1 y 38,9 ms (`nav-100-60s-on-rerun-{1,2}.json`); `off` tuvo 74 ms en la misma serie.
  - FACT: las huellas de layout se calculan antes de servir y el claim tardío ya no hace trabajo de sala.
  - INFERENCE: es ruido de la máquina (GC u otro proceso), no un costo del modo.
- Los jugadores del benchmark son nuevos (sin fila), así que cada join hace un claim (`conflicts` 0). El caso de dos llamadas (jugador con fila, proceso nuevo) lo cubren los tests y la simulación de dos procesos (§11).
- **Filas/s:** unas 14, por encima de la estimación de la auditoría (≤ 10/s). El escenario sintético cruza unas 8,5 veces/s entre 100 jugadores, y cada cruce es urgente. Con el patrón del smoke de CAVES-4 domina el checkpoint.

**Primera entrega** (`2eecbc4`+, archivos `nav-100-60s-{off,shadow,on}.json`; antes de `2eecbc4`, archivos `*-before-2eecbc4.json`): p99 de 37,98 / 37,95 / 37,49 ms, 0,86 / 0,88 `location_save`/s. Los dos problemas de entonces, tick de 500 ms y huella calculada en el primer guardado, siguen corregidos (M39, M40).

## 8. Gates (FACT: ejecutados en la punta de código `11c31b0`)

| Gate | Resultado |
| --- | --- |
| Reproducción invertida de R1, R2 y R3 | Fallaron sobre el código anterior a cada corrección y pasan después (§R) |
| Tests de ubicación (sala con persistencia, journal, journal + PGlite, política, flag, layout, adaptadores, migración PGlite, staging de ubicación) | 122/122; 10 omitidos (staging de ubicación) |
| PGlite de la migración (`worldLocations.database.test.js`) | 20/20 |
| Contratos Deno `world-authority` | 11/11 |
| Deno `_shared` (guard de webhooks, `--allow-read`) | 27/27 |
| Guard de webhooks: tests y `check` | 28/28 y ✓ |
| **Realtime completo, Node 24** (v24.19.0) | 457 aprobados, 0 fallos, 0 cancelados, 31 omitidos (21 de staging + 10 de staging de ubicación) |
| **Realtime completo, Node 22** (`npx --offline node@22`, v22.23.2) | 457 / 0 / 0 / 31 |
| Primera corrida completa de la revisión | 1 fallo en los dos Node: la cota de reloj del test de costo de M2 (376 ms con la suite en paralelo). Corregido en `11c31b0` sin tocar código de producto |
| Vitest completo | 191 archivos, 1829/1829 |
| typecheck | OK |
| lint | **0 errores**, 9 warnings preexistentes (`AuthModal.vue`). Los 2 errores de `docs/design/world-location-1/cas-model.mjs` que señalaba la primera entrega se corrigieron en `7c3b723` |
| Build normal + `bundle-check normal` | ✓ / ✓ |
| Build Playtest + `bundle-check playtest` | ✓ / ✓ |
| Bundle sin nada de ubicación (`dist/`, normal y Playtest) | 0 coincidencias (`world_location`, `location_claim`, `location_save`, `WORLD_LOCATION`, `wouldFence`, `TERRAIN_GENERATOR_VERSION`, `session-replaced`) |
| Drift de SKILLS (`bundle-skills.mjs --check`) | OK |
| `zone-layout.ts -- --check` | al día |
| Pacing de SKILLS | ✓ |
| WORLD × SKILLS (sala world, placement de sala, placement, integración, Edge path, worldRoom, skillPolicy) | 46/46 |
| YIELD-2 (multi-yield, multi-yield PGlite, resourceAuthority, resourceLifecycle) | 67/67 |
| Migraciones / SECURITY-3 (`security3ClientGrants`, `skipSwapCooldownRetire`, `database`, `worldLocations.database`; incluye «todas las migraciones desde cero») | 60/60 |
| Navegación y presencia de CAVES-4 (navegación, Ciudad, cuevas, interiores, zonas, terreno, salas de presencia/cueva/navegación/benchmark, presencia, interés, reconexión, llegada) | 115/115 |
| Benchmark de 100 jugadores `off`/`shadow`/`on` | §7 |
| **Simulación de dos procesos** (`scripts/world-location/two-instances.mjs`) | **17/17** (§11) |
| Mutaciones | **54/54** detectadas, árbol restaurado (§10) |
| **Supabase local y staging completo** (`staging.test.js` + `locationStaging.test.js`) | **NO EJECUTADO.** Docker Desktop responde «unable to start», `wsl.exe` no responde y C: está al 98 %. No se tocó WSL, Docker ni el disco. Los 10 tests de staging de ubicación, actualizados al claim condicional (uno nuevo: R2 en Postgres real), cargan y se omiten sin las variables |

## 9. Casos de la matriz (§7 de la auditoría)

| # | Caso | Dónde |
| --- | --- | --- |
| 1 | > 15 s sin cache → fila | sala (cueva y extremo a extremo), dos procesos |
| 2 | < 15 s → gana la cache, epoch nuevo | sala |
| 3 | Reinicio | sala (módulo nuevo), journal + PGlite, dos procesos (kill + proceso nuevo) |
| 4 | Apagado ordenado | sala (3 jugadores, casilla exacta), plazo con autoridad colgada |
| 5 | Dos instancias | PGlite (dos journals), sala (dos copias de módulo, `on` y `shadow`), **dos procesos reales** |
| 6–8 | Escritura tardía, lotes reordenados, reintento | PGlite |
| 9 | Posición manipulada | PGlite (`CHECK`s, filas inválidas), política, sala |
| 10 | Payload del cliente con área o casilla | sala (ignorado) |
| 11 | Cliente lee o escribe la tabla o la RPC | PGlite (`anon`/`authenticated` + catálogo + check hosted); staging **no ejecutado** |
| 12–13 | Área retirada, layout cambiado | política, sala, layout (M2: cualquier dato canónico de la Pradera) |
| 14 | Autoridad caída o lenta al entrar | sala (1,5 s reales, Ciudad, `unclaimed`, sin saves; claim tardío adoptado sin mover), dos procesos (claim retenido); staging no ejecutado |
| 15 | Autoridad caída al guardar | journal (backoff, mismo seq, `duplicate` confirmado) |
| 16 | Doble reconexión | journal (claims encadenados, entrada retenida), sala (tres joins seguidos) |
| 17 | Transición + desconexión | PGlite (los dos órdenes), sala |
| 18 | Trabajo activo + reinicio | sala (casilla de espera, 0 acciones vivas) |
| 19 | Trabajo activo + < 15 s | sala (sin cancelación) |
| 20 | Aislamiento entre áreas | sala |
| 21 | Invitado y benchmark | sala |
| 22 | 1.000 pasos → ≤ 1 fila | journal, sala |
| 23 | Benchmark `shadow` | §7 |
| 24 | Rollback a `off` | sala (en caliente), flag (al arrancar), suites de CAVES-4 con `off` |
| 25 | Playtest 0.2 intacto | no se tocó `main`, el tag, Playtest ni secretos (sin acciones remotas salvo el push de esta rama) |
| 26 | Cliente anterior a CAVES-3 | política, sala |
| 27 | Usuario borrado | PGlite (cascada); staging no ejecutado |
| R1 | `shadow` + `stale` | sala (sin desconexión ni cambio de presencia, cache, `wouldFence`; reemplazo local; sesión legítima en otra instancia) |
| R2 | Claim abandonado tardío | sala (`on`/`shadow` × 1/2 instancias), journal, PGlite, dos procesos; staging (escrito, no ejecutado) |
| R3 | Claim tardío tras publicar | sala (nada, chat, `cancelWork`, paso rechazado, área rechazada; claim antes de admitir sí restaura) |

Además, con controles negativos: backoff acotado, cola coalescida y acotada, `stale` → 4001 solo en `on`, lote parcial por usuario, jitter, lotes ≤ 200, conflicto con límite de rondas y `off`/`shadow`/`on`.

## 10. Mutaciones (`node scripts/world-location/mutations.mjs`)

Cada una rompe una protección, exige que su test **falle** y restaura el archivo byte a byte. Al final verifica con git que el árbol esté limpio. **54/54 detectadas** y árbol restaurado (corrida final sobre `74d34fa`; el commit siguiente, `11c31b0`, solo cambia el test de costo, que ninguna mutación usa).

- **Detección por tiempo:** M22 y M50 se detectan porque el test cuelga hasta el plazo del runner (240 s). No fallan por una aserción. Que una espera no esté acotada se manifiesta justamente así.
- **M32:** el primer test que falla es «a failed claim retries…», que exige que un claim tardío no mueva al jugador. **M45** falla primero en el repro R2 de la sala.

| Capa | Mutaciones |
| --- | --- |
| SQL | M1 CAS sin epoch · M2 CAS sin seq · M3 grants de la tabla · M4 `EXECUTE` del claim · M5 `NULL` con `<>` · M6 el claim no resetea seq · M7 `DELETE` para `service_role` · **M44 claim incondicional (R2)** · **M45 claim que espera «sin fila» pisa una existente** |
| Edge | M8 casillas fuera de rango · M9 jugador repetido · M10 claim sin UUID · **M49 claim sin epoch esperado** |
| Adaptador | M11 respuesta ajena confirma |
| Journal | M12 `moveSequence` como seq · M13 lote confirmado entero · M14 `stale` sin valla · M15 `unclaimed` guarda · M16 sin expulsión · M17 sin backoff · M18 sin jitter · M19 lotes > 200 · M20 seq reusado con otra casilla · M21 claims sin encadenar · M22 flush de apagado sin plazo · M23 claim sin backoff · **M46 claim de una sesión cerrada o reemplazada** · **M47 entrada olvidada con un claim en vuelo** · **M48 conflicto sin reclamar después** · **M50 espera infinita de un claim colgado** |
| Política | M24 sin `isSafeLanding` · M25 sin versión de layout · M26 área desconocida aceptada · M27 sin D-L6 · M28 piso de Dungeon guardado tal cual |
| Sala | M29 sin hidratación · M30 sin 4001 · M31 vallado recordado · **M32 claim tardío mueve a un jugador publicado (R3)** · M33 timeout ≠ 1,5 s · M34 invitados persisten · M35 actor visible durante la hidratación · **M41 `shadow` desconecta (R1)** · **M42 `shadow` no recuerda en la cache** · **M43 `shadow` nombra la razón del reemplazo** · **M51 posición adoptada no urgente** |
| Flag | M36 valores laxos · M37 `off` reclama |
| Carga | M39 tick de 500 ms · M40 huellas en el primer guardado |
| Layout | M38 cambio de mapa sin versión nueva · **M52 capa authored de la Pradera sin hashear** · **M53 cambio del generador lejos de todo lugar authored sin versión nueva** · **M54 versión del generador fuera de la versión de layout** |

## 11. Simulación de dos procesos (D-L10, ensayo local)

`node scripts/world-location/two-instances.mjs`, **17/17**:
1. A atiende al jugador, que cruza a la Pradera; se guarda en ≤ 1 s.
2. B arranca con A vivo; el socket nuevo del jugador entra a B, restaurado en la Pradera (epoch 2; claim con conflicto y reintento).
3. El socket viejo cruza en A → `stale` → **A lo cierra con 4001**, y `/metrics` de A cuenta 1 `fencedDisconnects`. La fila conserva el estado de B.
4. `/version` sin estado de ubicación.
5. A muere con kill; el jugador vuelve a Ciudad en B y se guarda.
6. B muere con kill; un B' nuevo restaura la última casilla guardada (epoch 3).
7. **Nuevo (revisión, B2):**
   - un segundo jugador entra a B', pero la autoridad **retiene** su claim: no responde, y la operación espera;
   - B' se rinde a 1,5 s, lo coloca en Ciudad y el socket se va;
   - el jugador entra a un A' nuevo y reclama (epoch 1);
   - recién entonces el claim retenido se ejecuta en la base: responde `conflict` y no escribe;
   - A' sigue guardando, sin `stale` ni 4001 en `/metrics`.

**Qué no prueba:**
- que Colyseus Cloud solape procesos en un deploy;
- que llame a `onShutdown` (INFERENCE §2.7, a verificar en staging);
- el apagado ordenado por señal: en Windows `SIGTERM`/`SIGINT` matan el proceso sin handler, así que el flush de apagado se probó a nivel de sala (§8).

## 12. Limitaciones y riesgos

1. **Staging (Supabase local) no ejecutado.**
   - Sin cubrir en Postgres real y PostgREST: grants, concurrencia real de claims condicionales (20 a la vez con la misma expectativa), lotes cruzados, cascada desde Auth y Edge Runtime real.
   - Solo los cubren PGlite y la simulación.
   - Es el primer gate cuando Docker funcione. **No se declara aprobado.**
2. **D-L10 sin verificar** en Colyseus Cloud: solapamiento y `onShutdown`.
3. **Pérdida ante una caída simultánea** de autoridad y proceso:
   - se pierde el último checkpoint (≤ ~12 s) y, si la autoridad sigue caída, también los cruces pendientes;
   - una sesión `unclaimed` que se desconecta pierde su posición (contado en `dropped.unclaimed`).
4. **Dos llamadas de claim** para un jugador con fila que entra a un proceso que no conoce su epoch: un RTT más dentro de la hidratación de 1,5 s (§5.1).
5. **Versión de la Pradera con incremento manual para cambios de código:**
   - un cambio de código del generador o de las colisiones exige subir `TERRAIN_GENERATOR_VERSION`. El guard obliga a decidirlo, porque falla ante cualquier cambio de código en los cuatro archivos;
   - no puede impedir que alguien registre un digest nuevo sin subir la versión. La regla («nunca editar una entrada existente») está escrita junto al generador y en el test.
6. **Cambiar la navegación** de un área resetea a todos sus jugadores a la llegada (D-L8, conservador). En la Pradera, cualquier cambio de datos canónicos tiene el mismo efecto.
7. **Claims en tormenta:** cada join hace uno o dos claims; con 100 joins simultáneos hay 100–200 invocaciones, sin lote. Tiene el mismo tope que la capacidad (100).
8. **Filas/s** por encima de la estimación con cruces sintéticos muy frecuentes (§7). Hay que mirarlo en `shadow` con jugadores reales.
9. **`PresenceRoom.js` tiene 452 líneas** (franja 300–500). La lógica de ubicación está en `rooms/locationJoin.js` (187).
10. **Dungeons:** el registro `dungeonId → cueva` está vacío. Hoy un piso `dg:*` no se guarda; se conserva la última ubicación persistible.

**Recomendaciones no bloqueantes de la revisión (registradas, sin ampliar el alcance):**
- **L1 — clasificación de errores definitivos.**
  - Hoy toda falla de un claim o de un lote se trata como transitoria y se reintenta con backoff: red, 5xx, 400 por un bug propio (`invalid_epoch`, `invalid_rows`) o respuesta malformada (`malformed location claim`).
  - Los claims se reintentan hasta 30 s de backoff mientras la sesión vive; los lotes, hasta 30 s.
  - Un error definitivo debería contarse aparte y no reintentarse sin fin.
  - Riesgo actual: ruido de reintentos acotado por el backoff, sin efecto en la corrección.
- **L3 — el rollback exige `migration repair`.**
  - `rollback_world_player_locations.sql` borra la tabla y las funciones (ya con la firma `(uuid, bigint)`), pero la migración seguiría registrada en `supabase_migrations.schema_migrations` del entorno hosted.
  - Después del script hay que marcarla como revertida (`supabase migration repair --status reverted <versión registrada>`). Si no, un `db push` futuro la daría por aplicada.
  - El orden del §13.8 se mantiene: `off`, después la función y por último el script con su repair.
- **L4 — `ReconnectCache` entre instancias.**
  - La cache es por proceso. Si un jugador pasa de A a B y vuelve a A dentro de los 15 s, A puede restaurar desde su cache una posición anterior a lo jugado en B, porque la cache le gana a la fila.
  - La sesión nueva en A reclama igual un epoch nuevo y guarda donde realmente está, así que la fila no queda corrupta; pero el jugador ve la posición vieja de A.
  - Opciones futuras: invalidar o descartar la entrada de la cache cuando el claim de la sesión nueva devuelve una fila guardada por un epoch posterior al de la sesión cacheada, o comparar epochs antes de usarla.

## 13. Plan separado (nada de esto se hizo)

1. **Revisión:** leer §R y los commits de la revisión. Mirar sobre todo:
   - `locationJournal.js` (`#claimOnce`, `#mayClaim`, `claimsInFlight`);
   - la función `world_location_claim`;
   - `locationJoin.js` (`fence`, `left`, `#adopt`);
   - `layoutVersion.js`/`terrain.js`.
2. **Staging local** (antes de integrar, cuando Docker funcione):
   - aplicar la migración en el loop de `scripts/integration/rc03-staging/README.md`;
   - `supabase functions serve`;
   - `staging.test.js` + `locationStaging.test.js` (incluye R2 en Postgres real y 20 claims concurrentes condicionales);
   - repetir el benchmark contra el stack.
3. **Integración:**
   - merge a `integration/world-skills-0.3` con el flag en `off`;
   - volver a correr los gates sobre el merge.
4. **Migración hosted** (con autorización, D-L1):
   - aplicar **solo** `20261001220000_world_player_locations.sql` en forma individual (nunca `supabase db push`);
   - alinear la versión local con la que registre hosted;
   - correr `scripts/world-location/location-grants-check.sql` (0 filas esperadas).
5. **Deploy de `world-authority`** (con autorización):
   - la Edge Function nueva, con el secreto existente y sin cambiar secretos;
   - verificar 401 sin secreto, 400 ante un lote malo y 400 ante un claim sin `expectedEpoch`.
6. **Shadow en el entorno oscuro:**
   - `WORLD_LOCATION_PERSISTENCE=shadow`, reinicio autorizado;
   - smoke normal y leer `/metrics` → `location`;
   - esperado: `stale` inesperados 0, `wouldFence` 0 salvo dos pestañas o instancias reales, `failedBatches` 0, `claims.failed` 0, `wouldRepair` razonables, ≤ 1 `location_save`/s;
   - en `shadow` ningún jugador debe notar nada;
   - verificar D-L10 en un deploy real.
7. **Activación:**
   - `on` con reinicio;
   - smoke humano de §8 de la auditoría (cueva > 30 s, reinicio, cruce y cierre, dos pestañas → 4001, trabajo, aislamiento, rollback a `off`).
8. **Rollback** en cualquier punto:
   - `off` y reiniciar, sin tocar la base;
   - después, revertir la función;
   - por último, el script de rollback y `migration repair` (L3). Los datos son descartables.

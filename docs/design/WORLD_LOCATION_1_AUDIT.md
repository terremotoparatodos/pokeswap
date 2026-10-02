# WORLD LOCATION-1 — Auditoría de persistencia autoritativa de la ubicación

> Fase de **auditoría y diseño**. No hay código de producto, migraciones, SQL, deploy ni cambios hosted.
> Base: `integration/world-skills-0.3 @ 15f5f4f6d9e098b7953ed66f047e0437782c1d0f` (CAVES-4 aprobado).
> Rama: `design/world-location-persistence-0.3`. Primer commit: cierre humano de CAVES-4 (`docs/design/CAVES_4_REPORT.md` §13).
> Etiquetas: **FACT** (leído en el código de `15f5f4f`), **INFERENCE** (deducido, a verificar), **PROPUESTA** (diseño).

## 0. Resumen

**Problema.** La ubicación del jugador vive solo en memoria del proceso realtime. Pasados 15 s desconectado, tras un reinicio o un deploy, el jugador reaparece en la Ciudad `(31,20)`.

**Recomendación:**
- **Fila dedicada por usuario:** `public.world_player_locations`, solo `service_role`, RLS sin políticas.
- **Dos operaciones nuevas en `world-authority`:**
  - `location_claim`: lee y reclama la fila en una transacción, e incrementa el **epoch de sesión**;
  - `location_save`: escribe un **lote** de filas, cada una con CAS `epoch = actual AND seq > actual`.
- **Escritura:**
  - al cruzar un portal y al desconectarse (flush en ≤ 1 s, coalescido);
  - checkpoint cada 10 s solo si la casilla cambió;
  - flush final al apagar ordenadamente;
  - nunca por paso.
  - Con 100 jugadores: ≤ 1 invocación cada 10 s más los picos de portal o salida, y ≤ 10 filas/s en el peor caso.
- **Restauración:**
  - la memoria de 15 s (`ReconnectCache`) sigue ganando;
  - si no hay memoria, se usa la fila, **validada con la navegación actual** (área conocida, versión de layout, `isSafeLanding`);
  - cualquier duda cae a la llegada del área o a la Ciudad;
  - la base caída **nunca** bloquea la entrada.
- **Gate:** `WORLD_LOCATION_PERSISTENCE=off|shadow|on` en el realtime, `off` por defecto. Rollback instantáneo sin deploy de base.
- **Protocolo y cliente:** sin cambios. El cliente sigue recibiendo solo su `snapshot`.

**El esbozo de CAVES-4 §6.2 se mantiene en lo esencial, con siete correcciones** (§3):
1. `revision` → epoch de sesión + seq;
2. `SECURITY INVOKER`, no `definer`;
3. `area_id` sin enum cerrado;
4. sin `dir`;
5. versión de layout;
6. ninguna `await` antes del reemplazo atómico del actor;
7. pisos de Dungeon nunca persistidos tal cual.

## 1. Pre-flight

| Paso | Resultado |
| --- | --- |
| `git fetch --all --prune` | OK |
| `integration/world-skills-0.3` local y `origin` | ambos `15f5f4f6d9e098b7953ed66f047e0437782c1d0f` (FACT) |
| Rama remota `design/world-location-persistence-0.3` | no existía |
| Worktree nuevo | `../pokeswap-wloc1`, rama nueva desde `15f5f4f`. No se tocaron otros worktrees, integración, Playtest ni producción |
| Primer commit | `b9345f6`: §13 «Cierre humano (APROBADO)» en `CAVES_4_REPORT.md`, tomado del scratchpad del smoke oscuro sin cambios de contenido |

## 2. Auditoría (FACT salvo indicación)

### 2.1 Ciclo de vida del actor

| Momento | Qué pasa | Dónde |
| --- | --- | --- |
| Autenticación | `onAuth` → `authenticateSupabase(token)`: una sola llamada a `/auth/v1/user`. `userId` = `user.id` de Supabase. Sin token o con token inválido, la sesión es `guest`. | `auth/supabaseAuth.js:4-24`, `rooms/PresenceRoom.js:83-86` |
| Entrada | Chequeo de capacidad (100). Un invitado es observador en la Ciudad. Un jugador expulsa el socket anterior (`previous.leave(4001)`), toma la `ReconnectCache` (solo si no hay actor vivo), valida con `isSafeLanding` y, si no hay nada, crea el actor en Ciudad `(31,20)`. Todo **síncrono** tras el `await` de `onAuth`; el compañero se resuelve después y no bloquea. | `PresenceRoom.js:101-146` |
| Comentario crítico | «Replace the old socket before any optional visual lookup. Otherwise a reload can let the old onLeave remove presence seen by other clients.» Cualquier `await` nuevo **antes** de ese bloque rompe esa garantía (§6.4). | `PresenceRoom.js:116-117` |
| Salida | `onLeave`: si el socket sigue siendo el vigente del usuario, borra el actor, lo guarda en la `ReconnectCache` (15 s) y difunde `leave`. Un socket ya reemplazado no toca nada. | `PresenceRoom.js:157-174` |
| Eliminación | Pasados 15 s, el `setTimeout` borra la entrada. Al reiniciar el proceso se pierden todos los `Map` de módulo. | `presence/reconnectCache.js:1-26` |
| Usuario borrado | No hay hook. La presencia es efímera; con la tabla nueva lo resolvería `ON DELETE CASCADE`. | — |

### 2.2 `ReconnectCache`

- Un `Map` en memoria, con `take` destructivo y `remember` con `expiresAt` y un `setTimeout` con `unref`. «It is never persisted.»
- Restaurar desde ella ya valida la casilla (CAVES-4): si no es `isSafeLanding`, usa la llegada del área; con un área desconocida, la Ciudad (`reconnectRepairs`).
- **Debe seguir siendo la fuente preferida.** Es más fresca que cualquier checkpoint y no cuesta red.

### 2.3 Transiciones de área

- `areaTransition` decide sin mover. Solo se cruza parado exactamente sobre un portal hacia esa área, y siempre se aterriza en `arrivalFor(to, from)`, que nunca es un portal (`presence/areaTransition.js:39-51`).
- `changeArea` asigna `areaId`, `tx`, `ty` y `dir`, llama a `world.actorPlaced` (que cancela un trabajo) y publica (`PresenceRoom.js:199-227`).
- Es el **único** punto donde cambia `areaId`, aparte de la restauración. Eso lo convierte en el gancho natural de persistencia inmediata.

### 2.4 Secuencias y reconciliación — hallazgo H1

- `moveSequence` **lo controla el cliente**. Un número que salta hacia adelante se rechaza, pero **se consume** (`actor.moveSequence = sequence`), así que un cliente puede llevarlo a cualquier entero ≤ 2^53 (`presence/movement.js:31-42`). También lo incrementa `placeActor` del servidor (`PresenceRoom.js:292`).
- **Consecuencia:** `moveSequence` **no sirve** como contador de CAS para persistir. Un cliente malicioso podría saltar a 2^53 y fijar «la escritura más nueva posible». El seq de persistencia tiene que ser un contador **propio del servidor**.

### 2.5 `world-authority` y patrones de persistencia

- **Ruta única.** realtime → HTTPS + `x-world-authority-secret` (comparado en tiempo constante, ≥ 32 caracteres) → Edge Function → RPC con `service_role`. El realtime **no tiene credenciales de base** (`supabase/functions/world-authority/handler.ts:1-16,42-49`, `persistence/playerData.js:105-146`).
- **Operaciones fijas:** `access`, `player_state`, `owns_pokemon`, `commit_work` y `load_nodes`. Cada una valida su forma antes de tocar la base; los errores de la base no salen en la respuesta (`handler.ts:93-128`).
- **Patrón SQL:**
  - tabla con RLS y `REVOKE ALL … FROM PUBLIC, anon, authenticated`; grants explícitos a `service_role`;
  - funciones `SECURITY INVOKER`, `SET search_path = public`, con `EXECUTE` solo para `service_role` (`20260926002154_world_skills_authority.sql:85-119,215-280`).
  - **Hallazgo H2:** CAVES-4 §6.2 proponía `security definer`. El patrón vigente es `INVOKER`, más seguro: no eleva privilegios si alguien hereda `EXECUTE` por error.
- **Dedupe y CAS:**
  - `skill_work_settlements.action_id` es PK con `ON CONFLICT DO NOTHING`;
  - en YIELD-2, `world_node_overrides.action_id` es el **token de generación** del nodo, con un CAS que devuelve `stale_node` (`20261001051958_world_multi_yield.sql:15,46-57,129-143`);
  - el patrón «token de generación + `stale`» ya existe y está probado contra una segunda instancia vieja (commit `2ea684c`).
- **Restauración en el arranque:** `WorldRoom.start()` reintenta `loadNodes` hasta que responde, y no sirve mundo hasta tenerlo (`world/worldRoom.js:55-75`). Para la ubicación **no** se copia ese bloqueo (§6.6).
- **Adaptadores:** `worldDependencies(env)` elige `authority` (Edge), `local-db` (PGlite, nunca en producción), `demo` o `unavailable` (`world/worldConfig.js:11-52`). El adaptador de ubicación sigue la misma selección.
- **Timeout del adaptador Edge:** `EDGE_TIMEOUT_MS = 6_000` (`playerData.js:105`). Es demasiado para la ruta de entrada: la ubicación necesita uno propio y corto.

### 2.6 Identidad y sesiones

| Tipo de sesión | Comportamiento |
| --- | --- |
| Jugador | Identidad = `auth.userId` (UUID de `auth.users`), verificada una vez en el join; ningún campo del payload la nombra. Una sesión por usuario: el join nuevo expulsa al anterior (`4001`). |
| Invitado | Sin `actorId`. No se persiste nunca. |
| Benchmark | Ids `benchmark-*` (no UUID), sala aparte. No se persiste nunca. |
| `sessionId` de Colyseus | Efímero, por socket. **No** sirve como token entre instancias: no está en la base. |

### 2.7 Varias instancias — hallazgo H3

La presencia asume un único proceso: `Map` de módulo, una sala `presence` y ningún bus (CAVES-4 §6.1.5; `SHARED_DUNGEON_ARCHITECTURE.md` §1.6). Hoy hay una app de Colyseus Cloud.

Aun así, **hay dos instancias reales en un deploy**: la vieja drena mientras la nueva acepta joins (INFERENCE sobre Colyseus Cloud, a verificar en staging). Por eso la persistencia debe ser correcta con dos escritores **aunque la presencia no escale**. Escalar la presencia (routing pegajoso, bus) queda fuera de alcance.

### 2.8 Llegadas y validación de casillas

- `ARRIVALS`: Ciudad = `TOWN_SPAWN`, Pradera `(-5,-69)` y el `S` de cada cueva (`protocol/arrival.js:20-28`).
- `isWalkable` devuelve `false` para cualquier área fuera de las tres compartidas y para coordenadas no enteras (`world/navigation.js:48-55`).
- `isReachable`: en las áreas acotadas, alcanzable desde su spawn (flood fill); en la Pradera, cualquier casilla caminable (`navigation.js:104-136`).
- `isSafeLanding` = alcanzable y no portal (`navigation.js:137-145`).
- **Hallazgo H4:** en la Pradera, «alcanzable» equivale a «caminable». Si un layout futuro encierra una casilla guardada, la validación por casilla no lo detecta. Hace falta la **versión de layout** para caer a la llegada cuando el área cambió.
- `standableTile` (casilla de espera del trabajo) excluye sólidos, agua, nodos, parcelas y portales. La casilla donde espera el entrenador es siempre segura al guardarse (`world/workPlacement.js:45-58`).

### 2.9 Trabajo activo

- `ownerLeft`: al desconectarse, la unidad en curso termina y liquida, y no empieza otra (`world/resourceAuthority.js:258-271`).
- `reconcileActor`: si vuelve a la casilla de espera **antes** de que esa unidad termine, sigue; en cualquier otra casilla o área, se cancela con `moved` (`resourceAuthority.js:283-297`).
- El trabajo vive solo en memoria. Un reinicio lo pierde sin pagar dos veces; lo liquidado y el stock parcial están en la base (cabecera de `resourceAuthority.js`).
- **Consecuencia:** persistir la casilla de espera es correcto. Tras un reinicio no hay trabajo que reanudar y el jugador aparece al lado del nodo. Restaurar **no** debe crear ni reanudar trabajo, y `world.actorPlaced` ya lo garantiza.

### 2.10 Cliente

- `joinOrCreate('presence', { token, presenceProtocol, worldProtocol, visual, benchmark? })`. No envía área ni posición (`src/features/wildlands/multiplayer/api/colyseusPresence.ts:75-88`).
- `reconnection.enabled = false`: tras una caída rehace el join (`:88-91`).
- `?area=` e `initialTownPosition` son locales y cosméticos; el `snapshot` del servicio manda (CAVES-4 §6.1.4).
- **FACT del smoke de CAVES-4:** recargar dentro de la cueva antes de 15 s devuelve al jugador a su casilla. El cliente vigente ya acepta un primer `snapshot` en un área distinta de la Ciudad.

### 2.11 `profiles` y tablas existentes — hallazgo H5

- `profiles` tiene grants **por columna** para `authenticated` (`INSERT (id, username)`, `UPDATE (id, username, avatar_url, display_name, lang)`; `20260924042219_client_role_least_privilege.sql:14-19`).
- El DDL base y la **política de SELECT** de `profiles` **no están en el repositorio** (se crearon fuera de las migraciones).
- El realtime lee `profiles` con el JWT del jugador (`supabaseAuth.js:15-19`), y el mercado lee usernames de terceros. INFERENCE: hay un SELECT amplio.
- **Riesgo:** una columna nueva en `profiles` heredaría ese SELECT y expondría la ubicación de cualquier jugador a cualquier cliente.

### 2.12 Modelo de amenazas actual

| Garantía | Detalle |
| --- | --- |
| El cliente no decide su posición | Pasos de una casilla validados, área solo por portal, campos extra ignorados (CAVES-4 §4). |
| La ubicación no es valor | No da XP, materiales ni tokens. Su peor abuso es colocarse en una casilla, y la restauración la valida igual. |
| Riesgos que agrega persistirla | (a) un cliente que escribe o lee la tabla; (b) una sesión vieja que pisa una nueva; (c) un mapa cambiado que deja a alguien encerrado; (d) la base lenta que bloquea la entrada; (e) una fuga de la ubicación de terceros. |

## 3. Correcciones al esbozo de CAVES-4 §6.2

| # | Esbozo §6.2 | Corrección | Por qué |
| --- | --- | --- | --- |
| C1 | `revision bigint`, monótona | `epoch` (lo da la base en el claim) + `seq` (contador del servidor por epoch) | Una `revision` en memoria arranca de 0 tras un reinicio y pierde contra la fila vieja. Sin epoch, una instancia vieja con un contador alto gana (§5.3, modelo). |
| C2 | `security definer` | `SECURITY INVOKER` + `EXECUTE` solo para `service_role` | Es el patrón vigente (H2). |
| C3 | `check (area_id in (3 áreas))` | Formato con regex. La validez semántica la decide el realtime al leer. | Una cueva o área nueva no debería exigir una migración, y un área retirada no debería romper la fila. |
| C4 | `dir` | Sin `dir`: se restaura `down` (o el `dir` de la llegada) | Solo es estético. No afecta paso, colisión, trabajo ni reconciliación (§4.2). |
| C5 | — | `layout_version` | H4: detecta un mapa cambiado aunque la casilla siga caminable. |
| C6 | «La lectura nunca bloquea la entrada» | El claim se hace **antes** del bloque síncrono de reemplazo, con timeout corto, y el bloque vuelve a comprobar todo tras el `await` | §2.1 «Replace the old socket…». |
| C7 | — | Los pisos de Dungeon guardan su **ancla permanente**, nunca el piso | Las runs son efímeras (`SHARED_DUNGEON_ARCHITECTURE.md` §2.5, D8). |

## 4. Diseño recomendado

### 4.1 Componentes y permisos

```
Navegador ──(move/area: intención)──▶ PresenceRoom ──▶ LocationJournal (memoria, por userId)
                                           │                     │ flush (lotes)
                                           │ onJoin: claim       ▼
                                           └──────────▶ playerData.location* ──HTTPS + secreto──▶ world-authority
                                                                                             └─ service_role ─▶ world_location_claim / world_location_save
```

| Componente | Lee | Escribe |
| --- | --- | --- |
| Navegador (`anon`, `authenticated`) | **Nada.** Sin grants, sin políticas y sin `EXECUTE`. | **Nada.** |
| `PresenceRoom` | Decide la ubicación al entrar (cache > fila validada > Ciudad). | Marca dirty en el journal. |
| `LocationJournal` (nuevo, realtime) | — | Única fuente de las escrituras: toma la casilla **del actor autoritativo**, nunca de un payload. |
| `world-authority` | `location_claim` | `location_save` |
| Postgres | Funciones `SECURITY INVOKER`, `EXECUTE` solo para `service_role` | Ídem |
| Operador | SQL de diagnóstico con `service_role` | — |

### 4.2 Esquema propuesto (PROPUESTA, no aplicado)

```sql
CREATE TABLE public.world_player_locations (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- NULL los cuatro: fila reclamada que todavía no guardó ninguna ubicación.
  area_id        text        NULL CHECK (area_id ~ '^[a-z][a-z0-9-]{2,47}$'),
  tx             integer     NULL CHECK (tx BETWEEN -4096 AND 4095),
  ty             integer     NULL CHECK (ty BETWEEN -4096 AND 4095),
  layout_version text        NULL CHECK (layout_version ~ '^[a-z0-9.-]{1,32}$'),
  epoch          bigint      NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  seq            bigint      NOT NULL DEFAULT 0 CHECK (seq >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_player_locations_all_or_none CHECK (
    (area_id IS NULL AND tx IS NULL AND ty IS NULL AND layout_version IS NULL) OR
    (area_id IS NOT NULL AND tx IS NOT NULL AND ty IS NOT NULL AND layout_version IS NOT NULL))
) WITH (fillfactor = 80);  -- updates HOT: no hay índices secundarios
```

- **Sin fila, o una fila con los cuatro campos en `NULL`,** significa «sin ubicación»: Ciudad. El primer claim crea la fila así; el primer save la completa.
- **Sin `dir`:** no hace falta. El servidor restaura `ARRIVALS[area].dir` o `down`.
- **`layout_version`:** una huella por área, calculada al arrancar a partir de los datos de navegación (por ejemplo, los 12 primeros hex de un hash de `townLayout` + `caveLayouts` + `resourceZoneLayout` + `AREA_BOUNDS` del área). La Ciudad ya tiene su md5 congelado (`townLayout.test.js`). No viaja al cliente.
- **Sin índices adicionales:** se accede solo por PK.
- **RLS y grants:** `ENABLE ROW LEVEL SECURITY` sin políticas; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; `GRANT SELECT, INSERT, UPDATE ON … TO service_role`. Sin `DELETE`: lo hace la cascada.

**Funciones** (`SECURITY INVOKER`, `SET search_path = public`, `EXECUTE` solo para `service_role`):

```sql
-- Reclama la ubicación para una sesión nueva: un solo statement, atómico.
world_location_claim(p_user_id uuid)
  RETURNS jsonb  -- { epoch, location: { areaId, tx, ty, layoutVersion } | null }
  -- INSERT … (epoch = 1) ON CONFLICT (user_id) DO UPDATE SET epoch = epoch + 1, seq = 0
  -- RETURNING: la ubicación previa intacta y el epoch nuevo.

-- Guarda un lote. Cada fila es independiente.
world_location_save(p_rows jsonb)  -- [{ userId, epoch, seq, areaId, tx, ty, layoutVersion }] (≤ 200)
  RETURNS jsonb  -- [{ userId, result: 'applied' | 'stale' | 'duplicate' }]
  -- UPDATE … SET area_id, tx, ty, layout_version, seq = p.seq, updated_at = now()
  -- WHERE user_id = p.userId AND epoch = p.epoch AND seq < p.seq
  -- Si no aplicó: 'stale' si epoch <> p.epoch o no hay fila; 'duplicate' si seq >= p.seq.
```

### 4.3 Operaciones nuevas en `world-authority`

| `op` | Valida | Llama |
| --- | --- | --- |
| `location_claim` | `userId` UUID | `world_location_claim` |
| `location_save` | `rows` array 1–200; por fila: UUID, `epoch` y `seq` enteros ≥ 1 y ≤ 2^53, `areaId` con regex, `tx`/`ty` enteros en rango, `layoutVersion` con regex. Una fila inválida → `400` para todo el lote: un realtime sano no la produce. | `world_location_save` |

- Ni el gate de WORLD × SKILLS ni `world_skills_access`: la ubicación no es valor (D-L4).
- El adaptador PGlite agrega las mismas dos funciones, como el resto de `PlayerDataAuthority`.
- La interfaz suma `locationClaim(userId)` y `locationSave(rows)`.

### 4.4 Frecuencia de escritura

`LocationJournal` mantiene por usuario `{ epoch, seq, last: {areaId, tx, ty}, saved: {…}, dirtyAt, urgent }`. Nunca escribe en la ruta del paso: un paso solo marca dirty en O(1).

| Disparador | Prioridad | Cuándo sale |
| --- | --- | --- |
| Cruce de portal (`changeArea` con `arrival`) | urgente | en el próximo flush urgente (≤ 1 s, coalescido) |
| Desconexión (`onLeave` del socket vigente) | urgente | ídem; la entrada sigue en el journal hasta confirmarse |
| Movimiento normal | normal | en el flush periódico, si la casilla cambió y pasaron ≥ 10 s desde el último guardado de ese usuario |
| Movimiento hecho por el servidor (`placeActor`, trabajo) | normal | ídem |
| Restauración que reparó la casilla | normal | ídem: la reparación queda persistida |
| Apagado ordenado (SIGTERM / `onShutdown`) | final | un lote con todos los actores vivos y pendientes, con límite de 3 s |

- Un único flush en vuelo a la vez. Lo que llega mientras tanto espera al siguiente.
- **Lote:** ≤ 200 filas por invocación.
- **Carga con 100 jugadores activos:**
  - checkpoint: ≤ 100 filas / 10 s = **≤ 10 filas/s**, en **1 invocación cada 10 s** (~8.640/día);
  - picos: un cruce de portal o una salida agrega como mucho 1 invocación por segundo. El smoke de CAVES-4 tuvo 32 cruces en 7 min con 2 jugadores.
  - **Total estimado:** < 15k invocaciones/día con 100 jugadores, frente a ~860k/día si se escribiera cada paso (644 pasos en 7 min con 2 jugadores, escalado). Las filas son updates HOT por PK.
- **Pérdida máxima aceptada:** ≤ 10 s de caminata dentro de una misma área si el proceso muere sin apagado ordenado. El área nunca se pierde una vez confirmado el flush urgente (≤ 1 s).

### 4.5 Reglas CAS

1. **Epoch de sesión.** Cada join de jugador hace `location_claim`, que incrementa `epoch` en la base. El epoch es la **valla** (fencing token): solo la sesión con el epoch vigente puede escribir.
2. **Seq por epoch.** El journal lo incrementa en cada instantánea que encola. Lo genera el servidor y es independiente de `moveSequence` (H1). Cada fila: `WHERE epoch = p.epoch AND seq < p.seq`.
3. **Resultados:**
   - `applied`;
   - `duplicate` (seq ≤ guardado: un reintento o un lote que llegó después del siguiente): se ignora;
   - `stale` (otra sesión reclamó después): esta sesión queda **vallada**. Deja de escribir para ese usuario y se registra la métrica `location.fenced`.
4. **Sesión vallada que sigue conectada.** Significa que el mismo usuario abrió otra sesión en otra instancia. Se expulsa con `4001`, como el reemplazo local (D-L2).
5. **Sin timestamps.** `updated_at` es solo diagnóstico. Los relojes de dos instancias no se comparan nunca.
6. **Orden local.** Si al ejecutarse el bloque síncrono de `onJoin` el actor vivo ya tiene un epoch **mayor** que el del join que llega (dos joins concurrentes resueltos fuera de orden), el join con epoch menor se rechaza con `4001`. Gana siempre el epoch más alto, en local y en la base.
7. **Reintentos.** Un flush fallido (timeout o 5xx) reencola las filas con el **mismo** `(epoch, seq)`: un reintento que la base ya aplicó vuelve como `duplicate`. Backoff de 1, 2, 4… hasta 30 s. El journal tiene tope de 1.000 usuarios pendientes; si se llena, descarta los más viejos y lo cuenta en `location.dropped`.

**Modelo aislado.** `docs/design/world-location-1/cas-model.mjs` recorre todas las intercalaciones de una escritura tardía de la sesión vieja A frente al claim y dos escrituras reordenadas de la sesión nueva B:

| Regla | Intercalaciones | I1: A pisa después del claim de B | I2: la fila final no es la última de B |
| --- | --- | --- | --- |
| **epoch + seq** | 8 | **0** | **0** |
| timestamp (A con +2 s de desfase) | 8 | 6 | 8 |
| contador sin epoch (reinicia en 0) | 8 | 3 | 5 |

### 4.6 Restauración y validación

En `onJoin` (jugador; ni invitado ni benchmark) con el flag en `on`:

1. **Antes del bloque síncrono:** `claim = await race(locationClaim(userId), 1500 ms)`. Si falla o vence: `claim = null` (degradado).
2. **Bloque síncrono** (igual que hoy, más la regla 6 de §4.5):
   - actor vivo → se usa ese;
   - si no, `ReconnectCache.take` → validación actual (CAVES-4);
   - si no, `claim.location` → `restoreFromRow`;
   - si no, Ciudad `(31,20)`.
3. **`restoreFromRow(loc)`:**
   - `areaId` no es un área persistible conocida → Ciudad (`location.repair.area`);
   - `layoutVersion` ≠ la versión actual del área → `ARRIVALS[areaId]` (`location.repair.layout`);
   - `!isSafeLanding(areaId, tx, ty)` → `ARRIVALS[areaId]` (`location.repair.tile`: sólida, portal, inalcanzable o fuera del borde);
   - si no, `{areaId, tx, ty, dir: 'down'}`.
4. **Después:** `world.actorPlaced(actor)` (no reanuda ningún trabajo), `publish` y, al `ready`, el `snapshot` de siempre. El actor guarda `locationEpoch` y el journal arranca en `seq = 0`. Si hubo reparación, queda dirty normal.
5. **Degradado:** el journal reintenta el claim en segundo plano. Cuando lo obtiene, empieza a escribir desde la posición **actual** y **ignora** la ubicación leída: nunca teletransporta a alguien que ya está jugando.

### 4.7 Fallbacks

| Situación | Resultado | Métrica |
| --- | --- | --- |
| El área ya no existe o no es persistible | Ciudad `(31,20)` | `repair.area` |
| Cambió el mapa (`layoutVersion` distinta) | Llegada del área | `repair.layout` |
| Casilla sólida o inalcanzable | Llegada del área | `repair.tile` |
| Casilla portal | Llegada del área: nunca se cruza al restaurar | `repair.tile` |
| Ocupada por un elemento nuevo (nodo, parcela, prop) | Si el elemento es sólido en la navegación compartida, `isSafeLanding` falla → llegada. Si no es sólido (otro jugador, un Pokémon trabajando), los actores no colisionan entre sí y se queda. | `repair.tile` |
| Base o autoridad caída al entrar | Cache si la hay; si no, Ciudad. Claim en segundo plano, sin escrituras hasta tener epoch. | `claim.failed`, `claim.timeout` |
| Base caída al guardar | Reencolar con backoff. Las escrituras se pierden solo si el proceso muere antes de reconectar. | `save.failed`, `dropped` |
| Flag `off` | Comportamiento de hoy | — |

### 4.8 Trabajo activo, Dungeons y pisos

| Caso | Comportamiento |
| --- | --- |
| Trabajo activo | Se persiste la casilla de espera, que es segura. Dentro de la gracia de 15 s en el mismo proceso, el trabajo continúa como hoy (`reconcileActor`). Tras un reinicio, el trabajo ya no existe y se restaura junto al nodo. **Restaurar nunca reanuda ni inicia trabajo**, y el juego no lo paga dos veces (YIELD-2). |
| Áreas persistibles | Lista explícita en el realtime: `persistableArea(areaId)` es verdadero para la Ciudad, la Pradera y cada interior de cueva abierto (`CAVE_INTERIORS`). Una cueva nueva entra sin migración. |
| Pisos de Dungeon (futuro, `dg:<dungeonId>:<n>`) | **Nunca** se guardan como tales: el journal guarda el **ancla** del piso, que es la aproximación exterior de la cueva según la D8 de `SHARED_DUNGEON_ARCHITECTURE.md` §2.5. La continuidad de la run (llaves, accesos) vive en sus propias tablas (`dungeon_floor_access`) y la decide `DungeonRunService`. |
| Área o run nueva | Ninguna requiere cambiar el esquema. |
| Dos instancias con Dungeons | El lease de la run y el epoch de ubicación son independientes. La ubicación nunca da acceso a un piso. |

### 4.9 Qué no recibe nunca el cliente

- `epoch`, `seq`, `layout_version` ni `updated_at`.
- Si la posición salió de la cache, de la fila o de una reparación. Solo ve su `snapshot`; las métricas son agregadas y sin ids ni coordenadas, como hoy.
- La ubicación persistida de **otro** jugador. Solo existe la presencia viva filtrada por interés, como hoy.
- El secreto, la URL de `world-authority` ni cualquier error de la base.
- Nada nuevo en `/version` ni en `/metrics` que identifique usuarios.

### 4.10 Compatibilidad con clientes antiguos

- **Protocolo sin cambios.** No se suman mensajes ni revisiones de presencia o WORLD. El `PRESENCE_PROTOCOL_REVISION` público no cambia; INFERENCE: conviene exponer `locationPersistence: off|shadow|on` solo en `/metrics` interno (D-L5).
- **Cliente de CAVES-3/4:** ya acepta un primer `snapshot` en la Pradera o la cueva (smoke de CAVES-4, paso 5).
- **Cliente más viejo que CAVES-3** (sin la cueva): no debe apuntar a este realtime (CAVES-4 §5). Si lo hiciera y su fila fuera la cueva, recibiría un área que no sabe dibujar. Mitigación opcional: si el join no declara `worldProtocol ≥ 3`, se restaura solo la Ciudad o la Pradera y la cueva cae a la aproximación de la Pradera (D-L6).
- **Playtest 0.2:** su realtime público (`be360fd`, protocolo 2) no recibe ni el código ni el secreto, y la tabla no le afecta.

### 4.11 Feature gate y rollback

| Valor de `WORLD_LOCATION_PERSISTENCE` (realtime) | Efecto |
| --- | --- |
| `off` (por defecto, también si falta o es inválido) | Ni claim ni escrituras. Exactamente lo de hoy. |
| `shadow` | Claim y escrituras, pero la fila **no** se usa para restaurar. Mide carga, CAS y fallos sin cambiar la experiencia. Las reparaciones se cuentan como «habría reparado». |
| `on` | Restauración desde la fila. |

**Rollback:**
1. `off` y reiniciar el realtime: inmediato, sin tocar la base.
2. Revertir la Edge Function a la versión anterior: las operaciones nuevas desaparecen y el realtime, en `off`, no las llama.
3. Down migration (solo si se decide abandonar): `DROP FUNCTION` ×2 + `DROP TABLE`. Los datos son descartables.

El flag es por proceso, no por usuario. Para una prueba por usuario está D-L4.

## 5. Comparativas

### 5.1 Fila dedicada vs columnas en una tabla existente

| Criterio | Fila dedicada `world_player_locations` | Columnas en `profiles` (o `player_skill_xp`) |
| --- | --- | --- |
| Exposición | Sin grants al cliente, por construcción | `profiles` tiene un SELECT de cliente que no está en el repo (H5): riesgo de fuga de la ubicación de todos |
| Contención | Updates frecuentes en una tabla propia | Updates cada 10 s sobre la fila de perfil que leen el mercado y la auth: bloqueo y bloat en una tabla caliente |
| Rollback | `DROP TABLE` | `ALTER TABLE profiles DROP COLUMN` en una tabla de producción |
| Coste | Una tabla más | Ninguna tabla nueva |
| **Veredicto** | **Recomendada** | Descartada |

### 5.2 Persistencia directa desde el realtime vs `world-authority`

| Criterio | Directa (Postgres o service key en el realtime) | Operación nueva en `world-authority` |
| --- | --- | --- |
| Secretos | El realtime tendría la conexión o la `service_role` key: un compromiso del realtime abre **toda** la base | El realtime solo tiene `WORLD_AUTHORITY_SECRET`: dos funciones con forma validada |
| Latencia | Menor (~5–20 ms con pool) | +1 salto HTTPS (~80–250 ms, INFERENCE). Irrelevante en lotes; acotado en el claim por el timeout de 1,5 s |
| Conexiones | Pool desde Colyseus Cloud, IPs dinámicas, TLS | Ya resuelto |
| Coherencia | Un segundo camino a la base | El mismo patrón que WORLD (INTEGRATION-1, SECURITY-3) |
| **Veredicto** | Descartada | **Recomendada** |

### 5.3 Cuándo escribir

| Estrategia | Escrituras/s con 100 jugadores | Pérdida ante una caída | Veredicto |
| --- | --- | --- | --- |
| Cada paso | ~200+ filas/s, ~1 invocación por paso o batching complejo | ~0 | Descartada: carga sin valor |
| Solo al desconectar | Mínima | Todo, si el proceso muere (deploy sin drenaje, crash) | Insuficiente: no sobrevive a un reinicio no ordenado |
| **Transición + desconexión urgentes, checkpoint de 10 s con debounce, flush al apagar** | ≤ 10 filas/s, ≤ ~1 invocación/s en el pico | ≤ 10 s dentro de un área; el área no se pierde | **Recomendada** |

### 5.4 CAS: epoch de sesión vs timestamp vs contador

| Regla | Falla cuando | Veredicto |
| --- | --- | --- |
| Timestamp | Hay desfase de reloj entre instancias: una instancia adelantada gana siempre. Modelo: 6/8 y 8/8 violaciones. | Descartada |
| Contador en memoria | Un proceso reiniciado empieza en 0 y pierde frente a la fila; una instancia vieja con contador alto pisa a la nueva. Modelo: 3/8 y 5/8. | Descartada |
| `moveSequence` | Lo controla el cliente (H1) | Descartada |
| **Epoch (lo emite la base) + seq (servidor, por epoch)** | — (0/8) | **Recomendada**: es el mismo principio que el token de generación de YIELD-2 |

## 6. Amenazas y mitigaciones

| # | Amenaza | Mitigación |
| --- | --- | --- |
| T1 | El cliente escribe su ubicación (REST, RPC o payload) | Sin grants ni `EXECUTE` para `anon`/`authenticated`; RLS sin políticas; los payloads ignoran campos extra (CAVES-4); el journal lee el actor autoritativo. **Prueba de grants en PGlite y staging.** |
| T2 | El cliente lee ubicaciones ajenas | Ídem: tabla dedicada sin SELECT (no `profiles`, H5) |
| T3 | Posición manipulada en la base (operador, bug o secreto filtrado) | Validación completa al restaurar: área, layout, `isSafeLanding`. Lo peor que se logra es aparecer en una casilla legal. |
| T4 | Sesión o instancia vieja que pisa una nueva | Epoch como valla y seq (§4.5); expulsión de la sesión vallada |
| T5 | `moveSequence` forzado a 2^53 | No se usa para persistir (H1) |
| T6 | Mapa cambiado que encierra a un jugador | `layout_version` → llegada del área (H4) |
| T7 | DoS por joins (claims) | Capacidad de 100, auth previa obligatoria y un claim por join de jugador. Los invitados no hacen claim. |
| T8 | La base lenta bloquea la entrada o el tick | Timeout de 1,5 s en el claim; escrituras asíncronas en lotes y un solo flush en vuelo; el tick nunca espera |
| T9 | Fuga en logs y métricas | Sin coordenadas ni ids en logs y métricas (como hoy); errores de la base solo en el log de la función |
| T10 | Privacidad y borrado de cuenta | `ON DELETE CASCADE`; los datos son mínimos (área + casilla) |
| T11 | Secreto débil o ausente | Comportamiento vigente de `sameSecret` (≥ 32 caracteres, tiempo constante). Sin secreto, la ubicación queda `unavailable` y el flag se ignora (fail-safe a «hoy»). |
| T12 | SQL injection en el lote | `jsonb_to_recordset` con tipos y `CHECK`s; la función valida además la forma; nunca hay SQL dinámico |

## 7. Matriz de pruebas

**Capas:** **U** unitario del realtime (`node --test`, reloj y adaptador falsos); **P** PGlite con la migración real; **D** contrato Deno de `world-authority`; **S** stack Supabase **local** (`staging.test.js`, solo `127.0.0.1`); **H** smoke humano oscuro.

| # | Caso | Esperado | Capas |
| --- | --- | --- | --- |
| 1 | Desconexión > 15 s (sin cache) | Restaura área y casilla de la fila | U, S, H |
| 2 | Desconexión < 15 s | Gana la cache; la fila no cambia el resultado | U, H |
| 3 | Reinicio del realtime (módulo fresco) | Restaura desde la fila; la pérdida es ≤ 10 s de caminata dentro del área, y el área se conserva | U, S, H |
| 4 | Apagado ordenado (SIGTERM) | Un flush final antes de salir; restaura la última casilla exacta | U, S |
| 5 | Dos instancias compitiendo (A vieja, B nueva) | Tras el claim de B, toda escritura de A es `stale`; A deja de escribir y expulsa al usuario si sigue conectado | U, P, S |
| 6 | Escritura tardía de una sesión vieja | `stale` y la fila no cambia | P, D, modelo |
| 7 | Lotes reordenados de la misma sesión | `duplicate` para el viejo; la fila final es la de mayor seq | P, modelo |
| 8 | Reintento de un lote ya aplicado | `duplicate` y sin cambios | P |
| 9 | Posición manipulada en la base (sólida, portal, fuera de rango, fracción) | Los `CHECK`s rechazan el rango y la fracción; la casilla sólida o portal → llegada (`repair.tile`) | P, U |
| 10 | Payload del cliente con `tx`/`ty`/`areaId` | Ignorado (regresión de CAVES-4) | U |
| 11 | El cliente llama a la RPC o lee la tabla como `anon` o `authenticated` | `permission denied` / 0 filas | P, S |
| 12 | Área desconocida o retirada en la fila | Ciudad (`repair.area`) | U |
| 13 | Layout actualizado (`layout_version` distinta) | Llegada del área (`repair.layout`) | U |
| 14 | Base caída al entrar (timeout o 5xx) | Entra en < 1,6 s (cache o Ciudad); claim en segundo plano; no escribe hasta tener epoch | U, S |
| 15 | Base caída al guardar | Reencola con backoff; al volver la base aplica sin duplicar | U, S |
| 16 | Doble reconexión (dos joins concurrentes del mismo usuario) | Gana el epoch mayor, en local y en la base; el otro recibe `4001`; nunca quedan dos actores | U, S |
| 17 | Transición concurrente con desconexión | Cruce (seq n) y salida (seq n+1) en cualquier orden de entrega → la fila final es el área nueva | U, P |
| 18 | Trabajo activo y desconexión de más de 15 s o reinicio | Restaura en la casilla de espera; no hay trabajo vivo; el nodo no queda reservado; 0 pagos dobles | U, S, H |
| 19 | Trabajo activo y desconexión de menos de 15 s | Sigue como hoy (`reconcileActor`) | U (regresión) |
| 20 | Aislamiento de presencia al restaurar en la cueva | Solo lo ven los que están en la cueva; ni la Ciudad ni la Pradera reciben `upsert` | U, H |
| 21 | Invitado y benchmark | Sin claim ni escrituras | U |
| 22 | Pasos sin escritura | 1.000 pasos en 10 s → ≤ 1 fila | U |
| 23 | Benchmark de 100 actores con persistencia `shadow` | p99 del event loop sin regresión (> 5 % = falla); ≤ 1 invocación/s en promedio | benchmark |
| 24 | Rollback: `on` → `off` | Comportamiento idéntico al de `15f5f4f` (la suite de CAVES-4 en verde) | U, H |
| 25 | Playtest 0.2 intacto | `be360fd`, protocolo 2, `main` y el tag `playtest-0.2` sin cambios; ningún secreto nuevo allí | verificación |
| 26 | Cliente sin `worldProtocol ≥ 3` con la fila en la cueva | Según D-L6 | U |
| 27 | Usuario borrado | La fila desaparece por cascada | P |

## 8. Staging y smoke humano

**Staging (stack Supabase local, como RC-0.3):**
1. Migración, funciones y Edge Function locales. `staging.test.js` suma los casos 1, 3, 5, 11, 14–16 y 18, con dos instancias de `PresenceRoom` sobre la misma base en procesos distintos.
2. `shadow` contra el stack local con el benchmark de 100 actores (caso 23).

**Validación oscura (requiere autorización hosted, D-L1):**
1. Migración hosted.
2. Deploy de `world-authority` con las dos operaciones.
3. Realtime oscuro en `shadow` durante un smoke normal.
4. Leer las métricas `location.*`: 0 `stale` inesperados, 0 fallos.
5. Pasar a `on`.

**Smoke humano** (Titan123 y terremototw, con el gate cerrado):
1. Entrar a la cueva, cerrar la pestaña, esperar **más de 30 s** y volver: misma casilla en la cueva.
2. Caminar por la Pradera, esperar más de 10 s parado, **reiniciar el realtime oscuro** y reconectar: misma área y la casilla del último checkpoint (como mucho 10 s atrás).
3. Cruzar un portal y cerrar la pestaña antes de 1 s; reabrir pasados 30 s: el área nueva.
4. Abrir dos pestañas con el mismo usuario: queda una sola sesión y el otro jugador ve un solo entrenador.
5. Talar, cerrar la pestaña con el trabajo en curso y volver pasados 30 s: junto al nodo, sin trabajo activo; conciliar settlements (con SQL de solo lectura autorizado, o diferido).
6. Cada jugador en un área distinta: ninguno ve al otro tras restaurar.
7. Pasar el flag a `off`, reiniciar y reconectar pasados 30 s: Ciudad (comportamiento de hoy).
8. Monitor de solo lectura de `/metrics`, como en CAVES-4.

## 9. Plan de implementación en commits (fase siguiente, no ejecutado)

| # | Commit | Contenido | Hosted |
| --- | --- | --- | --- |
| 1 | `feat(db): world_player_locations + claim/save (INVOKER, service_role only)` | Migración y down migration; tests PGlite de grants, `CHECK`s, CAS (casos 6–9, 11, 17, 27) | no (archivo) |
| 2 | `feat(world-authority): location_claim / location_save` | Validación, handler y tests Deno | no (archivo) |
| 3 | `feat(realtime): playerData location adapters (edge + pglite)` | `locationClaim` y `locationSave`, timeout propio de 1,5 s, métricas | no |
| 4 | `feat(realtime): layout versions per persistable area` | Huella por área; test que la congela (cambia ↔ cambia la navegación) | no |
| 5 | `feat(realtime): LocationJournal (dirty, debounce, batches, CAS results)` | Puro, con reloj inyectado (casos 15, 17, 22) | no |
| 6 | `feat(presence): claim before atomic join, restore from row, epoch ordering` | `PresenceRoom.onJoin` y `onLeave`, regla 6, expulsión de la sesión vallada (casos 1–3, 10, 12–14, 16, 18–21, 26) | no |
| 7 | `feat(realtime): graceful shutdown flush` | Hook de apagado (caso 4) | no |
| 8 | `feat(realtime): WORLD_LOCATION_PERSISTENCE gate (off/shadow/on)` | Flag y tests de rollback (caso 24) | no |
| 9 | `test(staging): two-instance location fencing against local stack` | `staging.test.js` | no |
| 10 | `docs: WORLD_LOCATION_2_REPORT` | Gates, benchmark y checklist | no |
| — | Aplicar la migración y desplegar la Edge Function hosted | Fase aparte, con autorización explícita | **sí** |

Los commits 1–9 no tienen efecto en el entorno oscuro mientras la Edge Function hosted no tenga las operaciones y el flag esté en `off`.

## 10. Decisiones que necesitan aprobación

| Id | Decisión | Recomendación |
| --- | --- | --- |
| D-L1 | Autorizar, en una fase aparte, la migración hosted, el deploy de `world-authority` y el secreto ya existente en el realtime oscuro | Sí, después de que la implementación pase staging local |
| D-L2 | Sesión vallada (`stale`) aún conectada en otra instancia: ¿expulsarla con `4001`? | Sí: mantiene «una sesión por usuario», como el reemplazo local |
| D-L3 | Checkpoint de 10 s y pérdida máxima de ≤ 10 s ante un crash | 10 s. Bajar a 5 s duplica las invocaciones y aporta poco |
| D-L4 | ¿Gate por usuario (solo testers) además del flag de proceso? | No: la ubicación no es valor. El entorno oscuro ya limita quién juega. Si se prefiere, `location_claim` puede devolver `null` a los no testers sin cambiar el esquema |
| D-L5 | ¿Exponer el estado del flag en `/version`? | No. Solo en `/metrics` interno |
| D-L6 | Cliente sin `worldProtocol ≥ 3` con la fila en la cueva | Restaurar la aproximación de la Pradera. Si se descarta, aceptar el riesgo (no deberían conectarse) |
| D-L7 | `dir` | Sin `dir` (se restaura `down`) |
| D-L8 | Cambio de layout → llegada del área, aunque la casilla siga siendo válida | Sí. Es conservador, raro y solo afecta al área que cambió |
| D-L9 | Pisos de Dungeon → ancla exterior (D8) | Sí, coherente con `SHARED_DUNGEON_ARCHITECTURE.md` §2.5 |
| D-L10 | Confirmar en staging que Colyseus Cloud tiene dos procesos solapados durante un deploy y que llama a `onShutdown` (INFERENCE §2.7) | Verificar antes de pasar a `on` |

## 11. Qué no se hizo

- Sin código de producto, migraciones, SQL, cambios hosted, deploys, reinicios ni limpieza.
- No se tocaron integración, Playtest, producción ni otros worktrees.
- El único artefacto ejecutable es `docs/design/world-location-1/cas-model.mjs`: un modelo aislado, sin imports del producto, fuera de cualquier bundle o suite de tests.

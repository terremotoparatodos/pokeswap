# SKILLS PROB-1 — Auditoría y diseño de trabajo probabilístico sin barra

> Solo auditoría y diseño, sobre `integration/world-skills-0.3 @ 4d72c3d`. No se modificó código productivo, SQL, bundles, gate ni testers.
> Convenciones de AGENTS.md §1: **FACT** = verificado en el código citado; **INFERENCE** = deducido; **OPEN QUESTION** = decisión pendiente.
> Los números de las tablas salen del script del Apéndice A (analítico, verificado con Monte Carlo de 200 000 muestras: media 3,61 s analítica = 3,61 s simulada).

## 0. Resumen

- **Hoy** una acción de Talar/Minería/Agricultura dura un tiempo fijo que decide SKILLS al autorizar (`durationMs`); WORLD agenda el cierre en su cola (`DueQueue`) y lo liquida una sola vez contra la base (`world_commit_work`, PK `action_id`). El cliente dibuja una barra de `endsAt − startedAt`.
- **Propuesta:** mantener *toda* la maquinaria de autoridad y exactly-once y cambiar solo **qué significa `durationMs`**: SKILLS calcula la probabilidad por intento `p`, **sortea en secreto el número de intentos `N`** (geométrica truncada, RNG criptográfico del servidor) y devuelve `durationMs = N · tick`. El servidor **deja de publicar `endsAt`**: publica `startedAt`, `attemptMs` (el tick) y `endsBy` (cota superior pública). El cliente anima un golpe por tick hasta recibir `world:work:done`.
- **Fórmula recomendada:** `p = 1 − (1 − b)^(1/A)`, con `b = pReq + (pMax − pReq) · x^γ`, `x = (L − Lreq)/(50 − Lreq)`, `pReq = tick / (1,25 · baseDurationMs)`, `γ = 2`, tope de intentos `⌈3/p⌉`. Recurso básico: **3,6 s de media en nivel 1** (rango 3,0–4,6 s según aptitud) y **0,63 s en nivel 50** (95 % en el primer intento).
- **Por qué es seguro:** la geométrica es sin memoria y, truncada, *premia seguir*: cancelar, reconectar o provocar un reinicio nunca mejora la espera esperada, siempre que `N` no salga del servidor. No hace falta persistir intentos ni semillas.
- **Riesgos bloqueantes:** (1) hoy `endsAt` viaja a todos los clientes en tres mensajes — sin cambiarlo el azar es trivialmente predecible; (2) `MIN_ACTION_MS = 1200` de SKILLS impide los 600 ms de nivel máximo; (3) clientes v1 calculan la barra con `endsAt`; (4) no hay rate-limit de `world:work`.

## 1. Estado actual

### 1.1 Mapa de responsabilidades

| Pieza | Archivo · función | Autoridad o presentación |
|---|---|---|
| Transporte de intents | `services/realtime/src/rooms/PresenceRoom.js` · `work()` L228, `cancelWork()` L234 | Autoridad (sólo acepta actores autenticados; guests no trabajan) |
| Tick del mundo (50 ms) | `PresenceRoom.js` · `onCreate()` L74 → `world.tick()` + `flush()` | Autoridad (reloj del servidor) |
| Validación del intent | `world/worldProtocol.js` · `workIntent()` L35 | Autoridad (sólo `nodeId`, `pokemonInstanceId`, `requestId`, `cropId`; no hay campo de duración ni recompensa) |
| Gate de mundo cargado | `world/worldRoom.js` · `work()` L154 (`world-loading`) | Autoridad (fail-closed hasta `restore`) |
| Idempotencia de pedido | `world/resourceAuthority.js` · `requestWork()` L95–101 (`recent` por conexión, 32 ids; `attempting`) | Autoridad |
| Chequeo físico | `resourceAuthority.js` · `#physicalCheck()` L310: nodo existe, área, alcance ortogonal 1, estado, `actor-busy`, `pokemon-busy`, lugar, parcela | Autoridad |
| Ownership | `world/pokemonOwnership.js` · `verify()` (cache positiva 30 s) | Autoridad |
| Nivel, aptitud, duración | `src/features/skills/domain/workRules.ts` · `evaluateWork()` L139, `workDuration()` L86; `skills/service/skillsService.ts` · `authorizeWorkAttempt()` L101 | Autoridad (bundle `skills.generated.js`) |
| Normalización de la respuesta | `world/skillPolicy.js` · `readAuthorization()` L74 (clamp `[500 ms, 5 min]`) | Autoridad |
| Stand del Pokémon y espera del entrenador | `world/workPlacement.js` · `workPlacement()`; `resourceAuthority.js` · `#placement()` L336 | Autoridad (visual pero decidido por el servidor) |
| Adquisición atómica | `resourceAuthority.js` · `requestWork()` L127–138 → `#start()` L285 | Autoridad (sin `await` entre re-chequeo y reserva) |
| `startedAt` / `endsAt` / timer | `#start()`: `endsAt = startedAt + durationMs`; `queue.push(endsAt, complete)` | Autoridad |
| Cancelación | `cancel()` L155 (voluntaria), `reconcileActor()` L177 (movimiento / cambio de área) | Autoridad |
| Cierre exactly-once | `complete()` L193: fase `running → settling` antes del primer `await`; reintentos 1/3/9 s con el mismo `actionId` | Autoridad |
| Chequeo "no antes de tiempo" | `skillsService.ts` · `settleWork()` L136–149 (`too_early` con 250 ms de tolerancia) | Autoridad |
| Recompensa | `workRules.ts` · `rollDrop()` L173 con `cryptoRandom` (`skillsWorldPolicy.ts`) | Autoridad |
| Persistencia | `supabase/migrations/20260926002154_world_skills_authority.sql` · `world_commit_work` (PK `action_id`, XP + materiales + override del nodo en una transacción) | Autoridad (DB) |
| Agotamiento / respawn | `resourceAuthority.js` · `#nextState()` L246, `#timer()` L264; `world/worldTuning.js` `RESPAWN_MS` 90 s; `resourceLifecycle.js` | Autoridad |
| Restauración tras reinicio | `worldRoom.js` · `start()` L55 → `authority.restore()` L76 | Autoridad |
| Proyección pública del nodo | `worldProtocol.js` · `publicNode()` L57 (incluye `startedAt`, **`endsAt`** L68) | Autoridad → presentación |
| Acción propia al reconectar | `worldRoom.js` · `snapshot()` L120 (`ownAction` con **`endsAt`**) | Autoridad → presentación |
| Barra de progreso | `src/features/skills/components/WorkCard.vue` L55, `FarmCard.vue` L54 (animación CSS de `durationMs`) | Presentación |
| Duración vista por el cliente | `worldSkills/client/worldSkillsSession.ts` · `begin()` L107: `durationMs = endsAt − startedAt` | Presentación |
| Animación del nodo (escena Skills) | `skills/ui/useSkillsLayer.ts` L136–158 → `choppingTimeline()` / `miningTimeline()` (número de golpes = `⌈durationMs / 580⌉`) | Presentación |
| Animación del Pokémon | `src/features/world/render/workerPose.ts` · `TASK_BEATS` (chop 580, mine 500, farm 900 ms) anclado a `startedAt` + reloj del servidor | Presentación |
| Anillo de progreso para observadores | `world/render/worldResourceOverlay.ts` · `ground()` (usa `endsAt`) | Presentación |
| Estimación en la tarjeta | `WorkCard.vue` L45 / `FarmCard.vue` L43 (`option.seconds`, vía `skills/ui/skillsView.ts`, `farmView.ts`) | Presentación |

### 1.2 Flujo actual

```mermaid
sequenceDiagram
  autonumber
  participant C as Cliente (Vue + escena)
  participant R as PresenceRoom (tick 50 ms)
  participant A as ResourceAuthority
  participant O as Ownership (edge, cache 30 s)
  participant S as SKILLS (bundle, ledger en memoria)
  participant D as Postgres (world_commit_work)
  C->>R: world:work {nodeId, pokemonInstanceId, requestId}
  R->>A: requestWork(actor, intent)
  A->>A: requestId repetido? in-flight? #physicalCheck
  A->>O: verify(userId, instanceId)
  A->>S: authorizeWorkAttempt(actionId, node, pokemon)
  S-->>A: ok, durationMs (nivel × aptitud × Ritmo, ≥ 1200)
  A->>A: re-chequeo sincrónico + adquisición (nodo, jugador, Pokémon)
  A->>A: startedAt = now, endsAt = now + durationMs, queue.push(endsAt)
  A-->>C: world:work:result {actionId, startedAt, endsAt}
  A-->>C: world:batch node{state: working, worker.stand, startedAt, endsAt} (a todos los que ven el chunk)
  A->>R: placeActor(trainer → anchor)
  Note over C: barra CSS de endsAt−startedAt, golpes = ⌈duración/580⌉
  R->>A: tick(): endsAt vencido → complete(actionId)
  A->>A: phase running → settling, #nextState (depleted + respawnAt)
  A->>S: settleWork (too_early si elapsed < durationMs − 250)
  S->>D: world_commit_work (PK action_id; XP + materiales + override nodo)
  D-->>S: applied | duplicate
  S-->>A: ok + summary
  A-->>C: world:batch node{depleted, respawnAt}
  A-->>C: world:work:done {ok, summary}
```

### 1.3 Casos borde auditados

| Caso | Comportamiento hoy | Evidencia |
|---|---|---|
| Cancelación voluntaria | `world:cancel` → `cancel()` sólo en fase `running`; nodo vuelve a su estado previo; SKILLS cierra el ledger sin pago (`cancelWork`). | FACT, `resourceAuthority.js` L155, `skillsWorldPolicy.ts` `cancelWork` |
| Movimiento | Cada paso llama `reconcileActor`; salir del `anchor` o del área cancela con `moved`. El paso que hace el propio servidor (`placeActor`) ocurre *después* de fijar el anchor, por eso no cancela. | FACT, L177–182, L300–301 |
| Desconexión | `onLeave` **no** cancela: la acción sigue y liquida; `work:done` no llega a nadie. El actor queda 15 s en `ReconnectCache`. | FACT, `PresenceRoom.js` L130–146, `presence/reconnectCache.js` |
| Reconexión < 15 s | Se restaura el mismo actor (en el anchor) → la acción sobrevive; `snapshot` manda `ownAction`. | FACT, `worldRoom.js` L113–120 |
| Reconexión > 15 s | Actor nuevo en la ciudad → `actorPlaced` → `reconcileActor` cancela si aún corría. Si ya liquidó, el jugador ve el resultado en `player:state`. | FACT |
| `requestId` tras recargar | `newConnection()` olvida los ids de la conexión anterior (la página recargada cuenta desde 1). | FACT, L172 |
| Carrera por el mismo nodo | Ambas solicitudes validan sin reservar; la primera que llega al tramo sincrónico adquiere; la segunda falla el re-chequeo con `busy` y SKILLS recibe `cancelWork` (métrica `authorizedNotStarted`). | FACT, L127–151 |
| Carrera por la misma parcela | Igual; además `farmActionFor` restringe tend/harvest al dueño. | FACT, `plots.js` |
| Doble cierre | `complete()` sólo actúa con fase `running` y `record.actionId` coincidente; entradas duplicadas de la cola son no-ops. Reintento de settle con el mismo `actionId`; la PK lo deduplica. | FACT, L193–198, `dueQueue.js` |
| Cierre fallido | Sin commit confirmado el nodo vuelve a su estado previo: nunca recompensa sin tocón ni tocón sin recompensa. | FACT, L226–230 |
| Reinicio del realtime | Acciones, ledger de SKILLS y cola viven en memoria: una acción en curso **se pierde sin pago**; el nodo nunca se persistió como `working`, así que vuelve disponible. Nodos agotados/parcelas se restauran de `world_node_overrides`. Si el proceso muere *durante* el commit, la DB decide (commit completo o nada). | FACT, `restore()` L76, SQL |
| Agotamiento | Una acción completada agota el árbol/roca (`SIMPLE_LIFECYCLE`); `charges` del catálogo es sólo advisory. Respawn 90 s. | FACT |
| Clientes viejos | Sólo quien declara `worldProtocol ≥ 1` recibe mensajes de mundo. Hoy todos los clientes son v1. | FACT, `worldRoom.js` L77 |
| Rate-limit de `world:work` | **No existe** más allá de `in-flight` y `requestId` repetido; cada intent con un Pokémon *no* propio consulta la edge (la cache sólo guarda positivos). | FACT, `PresenceRoom.js` L228, `pokemonOwnership.js` |

### 1.4 Qué filtra hoy la duración al cliente (importante para el diseño)

| Canal | Campo | Receptor |
|---|---|---|
| `world:work:result` | `startedAt`, `endsAt` | dueño |
| `world:snapshot.ownAction` | `startedAt`, `endsAt` | dueño al (re)conectar / cambiar de área |
| `world:batch` / `world:snapshot` `nodes[]` (`publicNode`) | `startedAt`, `endsAt` | **todos** los que ven el chunk |

Con duración fija esto es inocuo. Con duración aleatoria, **cualquiera de los tres canales revela el resultado del sorteo** antes de que ocurra. Es el cambio bloqueante #1.

## 2. Arquitectura propuesta

### 2.1 Principio

> *El servidor sortea cuántos intentos harán falta; el cliente sólo ve intentos.*

SKILLS ya es dueño del azar persistente (`rollDrop` con `cryptoRandom`) y ya devuelve una duración que WORLD agenda, liquida y verifica (`too_early`). Si el número de intentos se sortea al autorizar y la duración resultante nunca sale del servidor, **no cambia nada de la autoridad, del exactly-once, del lock del nodo ni de la persistencia**. Lo que cambia es la fórmula en SKILLS y la proyección pública en WORLD.

### 2.2 Alternativas consideradas

| | A. Tirada viva por tick en WORLD | B. Tirada viva por tick en SKILLS | **C. Sorteo secreto al autorizar (recomendada)** |
|---|---|---|---|
| Quién decide el éxito | WORLD (rompe el contrato: WORLD no lee reglas) | SKILLS, una llamada por tick | SKILLS, una vez |
| Coste por acción | 1 tirada/tick + 1 mensaje/tick si se muestran intentos | 1 llamada/tick (async) | **igual que hoy**: 1 autorización, 1 entrada en la cola, 1 commit |
| Exactly-once | hay que rehacer el cierre | hay que rehacer el cierre | **sin cambios** |
| `too_early` | no aplica | no aplica | **sigue funcionando** (`durationMs = N·tick`) |
| Distribución | geométrica | geométrica | **idéntica** (ver §2.5) |
| Riesgo de fuga | ninguno | ninguno | sólo si `durationMs` sale del servidor → se elimina de los tres canales |

**Recomendación: C.** A y B cuestan más y no dan nada que el jugador pueda distinguir.

### 2.3 Flujo propuesto

```mermaid
sequenceDiagram
  autonumber
  participant C as Cliente v2
  participant A as ResourceAuthority
  participant S as SKILLS
  participant D as Postgres
  C->>A: world:work {nodeId, pokemonInstanceId, requestId}
  A->>S: authorizeWorkAttempt(..., attemptMs = WORK_TICK_MS)
  S->>S: p = chance(L, recurso, aptitud) · N ~ Geom(p) truncada en ⌈3/p⌉ (crypto)
  S-->>A: ok, durationMs = N·attemptMs (secreto), attempt {chance, attemptMs, maxAttempts}
  A->>A: adquisición como hoy; endsAt interno = startedAt + N·attemptMs
  A-->>C: work:result {actionId, startedAt, attemptMs, endsBy} (sin endsAt real)
  A-->>C: batch node{working, worker, startedAt, attemptMs, endsBy}
  loop cada attemptMs (sólo en el cliente, por reloj del servidor)
    C->>C: golpe + sonido; sin respuesta = intento fallido
  end
  A->>A: tick: endsAt interno vencido → complete() (idéntico a hoy)
  A->>S: settleWork → D: world_commit_work
  A-->>C: batch node{depleted} + work:done {ok, summary, attempts}
  C->>C: golpe final, árbol cae / roca se parte, +XP, +ítem
```

### 2.4 Fórmula recomendada

Para un recurso con nivel requerido `Lreq`, duración base de catálogo `baseDurationMs` (ya existe en `resources.ts`; `FARM_ACTION_MS` para cultivos) y un `pMax` por tier, un jugador de nivel `L` con un Pokémon de aptitud `A`:

```
x      = clamp((L − Lreq) / (Lmax − Lreq), 0, 1)          Lmax = MAX_SKILL_LEVEL = 50
pReq   = min(0,5, attemptMs / (UNLOCK_SLOWDOWN · baseDurationMs))   UNLOCK_SLOWDOWN = 1,25
b      = pReq + (pMax − pReq) · x^γ                        γ = 2
p      = min(P_CAP, 1 − (1 − b)^(1 / APTITUDE_DURATION[A]))  P_CAP = 0,98
Nmax   = clamp(⌈CAP_FACTOR / p⌉, 3, MAX_ATTEMPTS)         CAP_FACTOR = 3, MAX_ATTEMPTS = 40
N      = min(Nmax, Geom(p))                                 (1 = primer intento)
durationMs = N · attemptMs
```

**Justificación, término a término**

1. **Intentos discretos de `attemptMs`.** Una tirada de Bernoulli por tick da tiempo `T·N` con `N ~ Geom(p)`, `E[t] = T/p`. Es el modelo de RuneScape clásico (una tirada por tick de 600 ms) y lo más fácil de entender: cada golpe tiene la misma chance.
2. **`pReq` desde `baseDurationMs`.** En el nivel de desbloqueo, con aptitud 3, `E[t] = 1,25 · baseDurationMs`. No hay números nuevos por recurso: el catálogo existente ya ordena la dificultad (árbol común 3000 ms < pino 3600 < madera dura 4400 < boreal 5200; roca 3200 < carbón 3800 < hierro 4400 < oro 5200 < cristal 6000). El factor **1,25** es el mínimo que deja el nivel 1 de un recurso básico dentro de 3–5 s **para todas las aptitudes** (3,0 s con aptitud 5; 4,6 s con aptitud 1). Con 1,0 el nivel 1 quedaba en 2,9 s.
3. **Interpolación hasta `pMax`.** Igual que la tabla *low/high* de RuneScape: dos anclas por recurso y una interpolación en el nivel. `pMax` por tier: muy básico 0,95 · básico 0,85 · intermedio 0,72 · avanzado 0,58 · especializado 0,48. Con 0,95 un recurso básico sale al primer intento 95 % de las veces en nivel 50 (media 632 ms ≈ un tick).
4. **Curva `x^γ` con γ = 2.** RuneScape usa γ = 1 (lineal en `p`). Aquí eso acelera mucho el juego temprano (nivel 10: 1,9 s contra 2,9 s de hoy; nivel 20: 1,3 s contra 2,8 s) y, como el XP por acción no cambia, adelanta la curva de niveles calibrada en `SKILLS_1_REPORT.md`. Con γ = 2, hasta el nivel 10 el tiempo queda igual o algo más lento que hoy (3,6 → 3,1 s contra 3,0 → 2,9 s) y la ganancia fuerte llega en la segunda mitad (tabla §2.6). Es un parámetro; γ = 1,5 es la alternativa si se quiere sentir el progreso antes.
5. **Aptitud como exponente.** `1 − (1−b)^m` es la probabilidad de acertar *al menos una* de `m` tiradas; con `m = 1/APTITUDE_DURATION[A]` (0,77 a 1,25) la aptitud sigue significando "trabaja ~1,6× más rápido de 1 a 5", el mismo significado que tiene hoy, y la probabilidad nunca pasa de 1.
6. **Ritmo.** El multiplicador `rhythmMultiplier` (−4 % cada 10 niveles) queda absorbido por `x^γ`: el nivel ya acelera directamente. **OPEN QUESTION D3**.
7. **Tope `Nmax = ⌈3/p⌉`.** Protege contra rachas: nadie espera más de ~3× la media. Truncar la geométrica tiene dos efectos deseados: acorta la cola (p99 = tope) y hace que **seguir sea siempre mejor que reiniciar** (§2.8). Afecta entre 0 % y ~5 % de las acciones.
8. **`P_CAP = 0,98`.** Aun con aptitud 5 en nivel 50 queda algún fallo ocasional: el golpe no es una animación decorativa.

### 2.5 Equivalencia sorteo previo = tiradas por tick

Para `n < Nmax`: `P(N = n) = (1−p)^(n−1) · p`, exactamente la probabilidad de fallar `n−1` ticks y acertar el `n`-ésimo; `P(N = Nmax) = (1−p)^(Nmax−1)` (el tope acierta seguro). Sortear `N` al autorizar o tirar en cada tick produce la **misma distribución** de tiempos; la única diferencia es *cuándo* se conoce el resultado, y ese dato no sale del servidor.

### 2.6 Tablas de probabilidad y tiempos (tick 600 ms, aptitud 3, γ = 2)

`E[t]` incluye el tope. Percentiles = tiempo hasta el éxito. "P(tope)" = fracción de acciones que llega al intento garantizado.

| Recurso | Nivel | p por intento | E[t] | p50 | p90 | p99 | tope (intentos / s) | P(tope) |
|---|---|---|---|---|---|---|---|---|
| Árbol común (Nv 1) | 1 | 16,0 % | 3,61 s | 2,4 s | 8,4 s | 11,4 s | 19 / 11,4 s | 4,3 % |
| | 10 | 18,7 % | 3,12 s | 2,4 s | 7,2 s | 10,2 s | 17 / 10,2 s | 3,7 % |
| | 20 | 27,9 % | 2,09 s | 1,8 s | 4,8 s | 6,6 s | 11 / 6,6 s | 3,8 % |
| | 30 | 43,7 % | 1,35 s | 1,2 s | 3,0 s | 4,2 s | 7 / 4,2 s | 3,2 % |
| | 40 | 66,0 % | 0,90 s | 0,6 s | 1,8 s | 3,0 s | 5 / 3,0 s | 1,3 % |
| | 50 | 95,0 % | 0,63 s | 0,6 s | 0,6 s | 1,2 s | 4 / 2,4 s | 0,0 % |
| Roca (Nv 1) | 1 | 15,0 % | 3,84 s | 3,0 s | 9,0 s | 12,0 s | 20 / 12,0 s | 4,6 % |
| | 50 | 95,0 % | 0,63 s | 0,6 s | 0,6 s | 1,2 s | 4 / 2,4 s | 0,0 % |
| Pino (Nv 12) | 12 | 13,3 % | 4,33 s | 3,0 s | 10,2 s | 13,8 s | 23 / 13,8 s | 4,3 % |
| | 30 | 29,4 % | 2,00 s | 1,2 s | 4,2 s | 6,6 s | 11 / 6,6 s | 3,1 % |
| | 50 | 85,0 % | 0,71 s | 0,6 s | 1,2 s | 1,8 s | 4 / 2,4 s | 0,3 % |
| Veta de carbón (Nv 10) | 10 | 12,6 % | 4,56 s | 3,6 s | 10,8 s | 14,4 s | 24 / 14,4 s | 4,5 % |
| | 50 | 85,0 % | 0,71 s | 0,6 s | 1,2 s | 1,8 s | 4 / 2,4 s | 0,3 % |
| Madera dura (Nv 25) | 25 | 10,9 % | 5,28 s | 4,2 s | 12,0 s | 16,8 s | 28 / 16,8 s | 4,4 % |
| | 50 | 72,0 % | 0,83 s | 0,6 s | 1,2 s | 2,4 s | 5 / 3,0 s | 0,6 % |
| Veta de hierro (Nv 20) | 20 | 10,9 % | 5,28 s | 4,2 s | 12,0 s | 16,8 s | 28 / 16,8 s | 4,4 % |
| | 50 | 72,0 % | 0,83 s | 0,6 s | 1,2 s | 2,4 s | 5 / 3,0 s | 0,6 % |
| Veta de oro (Nv 35) | 35 | 9,2 % | 6,23 s | 4,8 s | 14,4 s | 19,8 s | 33 / 19,8 s | 4,5 % |
| | 50 | 58,0 % | 1,03 s | 0,6 s | 1,8 s | 3,6 s | 6 / 3,6 s | 1,3 % |
| Pino boreal (Nv 40, apt ≥ 2) | 40 | 9,2 % | 6,23 s | 4,8 s | 14,4 s | 19,8 s | 33 / 19,8 s | 4,5 % |
| | 50 | 58,0 % | 1,03 s | 0,6 s | 1,8 s | 3,6 s | 6 / 3,6 s | 1,3 % |
| Cúmulo cristalino (Nv 45, apt ≥ 2) | 45 | 8,0 % | 7,18 s | 5,4 s | 16,8 s | 22,8 s | 38 / 22,8 s | 4,6 % |
| | 50 | 48,0 % | 1,24 s | 1,2 s | 2,4 s | 4,2 s | 7 / 4,2 s | 2,0 % |

**Aptitud (árbol común, E[t])**

| Nivel | Apt 1 | Apt 2 | Apt 3 | Apt 4 | Apt 5 |
|---|---|---|---|---|---|
| 1 | 4,59 s (12,6 %) | 4,00 s | 3,61 s (16,0 %) | 3,30 s | 2,97 s (19,6 %) |
| 10 | 3,94 s | 3,43 s | 3,12 s | 2,83 s | 2,57 s |
| 25 | 2,07 s | 1,84 s | 1,68 s | 1,54 s | 1,42 s |
| 50 | 0,67 s (90,0 %) | 0,64 s | 0,63 s (95,0 %) | 0,62 s | 0,61 s (97,6 %) |

**Curva γ (árbol común, aptitud 3, E[t] en s) contra la duración fija de hoy**

| Nivel | 1 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hoy (fijo) | 3,00 | 3,00 | 2,88 | 2,88 | 2,76 | 2,76 | 2,64 | 2,64 | 2,52 | 2,52 | 2,40 |
| γ = 1 (RuneScape) | 3,61 | 2,60 | 1,91 | 1,52 | 1,27 | 1,09 | 0,95 | 0,85 | 0,76 | 0,69 | 0,63 |
| γ = 1,5 | 3,61 | 3,24 | 2,62 | 2,08 | 1,68 | 1,37 | 1,14 | 0,96 | 0,83 | 0,72 | 0,63 |
| **γ = 2 (recomendada)** | 3,61 | 3,51 | 3,12 | 2,60 | 2,09 | 1,68 | 1,35 | 1,10 | 0,90 | 0,75 | 0,63 |

**Impacto en el ritmo de XP (INFERENCE).** Cada éxito agota el nodo, así que el ciclo real es `E[t] + desplazamiento`. Con 2,5 s de desplazamiento y re-pedido (MAP-1 midió ciclos de 6–7 s con desplazamiento incluido), acciones por hora sobre árbol común, γ = 2: Nv 1 **0,90×** hoy · Nv 10 0,96× · Nv 20 1,15× · Nv 30 1,34× · Nv 40 1,47× · Nv 50 1,56×. El XP por acción no cambia, pero el XP por hora sí sube en niveles altos: **OPEN QUESTION D4**.

**Agricultura.** Mismo cálculo con `FARM_ACTION_MS` como base y el `requiredLevel` del cultivo: plantar en nivel 1 3,6 s (p 16 %), cuidar 2,4 s, cosechar 3,2 s; en nivel 50, 0,63 s los tres. El crecimiento (`growMs`) **no cambia**.

### 2.7 Tick

| Parámetro | Valor | Motivo |
|---|---|---|
| `WORK_TICK_MS` (config WORLD) | **600** por defecto | Referencia RuneScape; múltiplo de 12 × el tick de room de 50 ms: el jitter de cierre es ≤ 50 ms (≤ 8 %). |
| Mínimo | 400 | Por debajo el golpe deja de leerse como un golpe y el nivel máximo (≈ 1 tick) se siente instantáneo. |
| Máximo | 1200 | Por encima el nivel 50 tarda > 1 s en recursos básicos; contradice "primer intento". |
| Dónde vive | `worldTuning.js` (ritmo físico de WORLD), enviado a SKILLS en `WorkAttempt.attemptMs` | WORLD es dueño del reloj; SKILLS de la probabilidad. |
| Cambio en caliente | No. Se lee al arrancar; cada acción guarda el tick con el que se autorizó. | Una acción nunca cambia de ritmo a mitad de camino. |
| Clamps | `readAuthorization` pasa a `[attemptMs, MAX_ATTEMPTS·attemptMs]` y exige `durationMs % attemptMs === 0`. `MIN_ACTION_MS = 1200` de SKILLS deja de aplicarse a recolección. | Hoy `MIN_ACTION_MS` impide 600 ms (bloqueante #2). |

### 2.8 Autoridad, exactly-once y concurrencia

- **Autoridad:** `N` se sortea en SKILLS con `cryptoRandom` (el mismo `random` que ya usa `rollDrop`), dentro de `authorizeWorkAttempt`, y queda en `AuthorizedWork.terms`. WORLD sólo recibe `durationMs` y lo trata como hoy. El cliente no envía ni recibe nada que lo determine.
- **`actionId` e idempotencia:** sin cambios. Un `actionId` sigue autorizando una sola vez (`duplicate_action`) y liquidando una sola vez (PK en DB + ledger + fase `settling`).
- **`too_early`:** sin cambios de código: `elapsed < N·attemptMs − 250` se rechaza. Con N = 1 y tick 600 la tolerancia (250 ms) es 42 % del tick; aceptable porque el cierre lo inicia la cola del servidor, no el cliente.
- **Concurrencia:** sin cambios. Un nodo, un trabajador (el lock es el `record.actionId`); jugador y Pokémon, una acción cada uno. El sorteo previo no cambia la ventana de carrera.
- **Agotamiento y respawn:** sin cambios; el éxito agota como hoy.

### 2.9 Reconexión, reinicio y "re-tirar"

**Afirmación:** ningún jugador puede mejorar su tiempo esperado cancelando, reconectando o provocando un reinicio, mientras `N` no salga del servidor.

- *Sin memoria:* para la geométrica, `E[intentos restantes | ya falló k] = 1/p`, igual que empezar de cero. Reiniciar no gana nada y suma la latencia de un nuevo pedido.
- *Con tope:* los intentos restantes están acotados por `Nmax − k`, así que `E[restante | falló k] < 1/p`. **Reiniciar es estrictamente peor que seguir.**
- *Condición necesaria:* que el jugador no sepa `N`. Si lo supiera, cancelaría cuando `N` es grande y truncaría la cola a su favor. Por eso el cambio bloqueante #1 es quitar `endsAt` de los tres canales (§1.4) y de cualquier `details`.

**¿Persistir, reconstruir o derivar de una semilla?** **Ninguna de las tres es necesaria.**

| Opción | Veredicto |
|---|---|
| Persistir `N` o los intentos | Innecesario: una acción no sobrevive a un reinicio (hoy tampoco) y volver a sortear no da ventaja. Añadiría una escritura a la DB por inicio. |
| Reconstruir tras reinicio | Innecesario: el ledger de SKILLS y la cola son de memoria; tras el reinicio el nodo nunca estuvo persistido como `working` y la acción muere sin pago, exactamente como hoy. |
| Semilla determinista (`HMAC(secreto, actionId)`) | Sólo aporta auditoría reproducible. Si la semilla fuera predecible (sin secreto) sería explotable. **No recomendado** para PROB-1; si se quiere auditoría, guardar `attempts` y `chance` en la liquidación (**OPEN QUESTION D6**, requiere migración aditiva). |

### 2.10 Dueño desconectado con el Pokémon trabajando

Recomendación: **mantener el comportamiento actual.** La acción sigue hasta el éxito (como mucho `Nmax` ticks: 11–23 s según recurso), liquida y paga; no hay repetición automática, así que no habilita AFK. Si el jugador vuelve dentro de los 15 s de gracia, ve la acción en `ownAction` o el resultado; si vuelve más tarde, `player:state` trae el XP y los materiales ya persistidos. Sólo el cúmulo cristalino (tope 22,8 s) puede superar la gracia; en ese caso el cierre sigue siendo correcto porque `reconcileActor` sólo cancela acciones en fase `running` y la liquidación no depende del socket.

### 2.11 Mensajes del protocolo (`WORLD_PROTOCOL` 1 → 2)

| Mensaje | Cambio | v2 | Compatibilidad v1 |
|---|---|---|---|
| `world:work` (C→S) | ninguno | igual | igual |
| `world:work:result` ok | + `attemptMs`, + `endsBy`; `endsAt` deja de ser el real | `{ requestId, ok, actionId, nodeId, startedAt, attemptMs, endsBy }` | `endsAt = endsBy` (alias, deprecado) |
| `world:snapshot.ownAction` | ídem | `{ actionId, nodeId, startedAt, attemptMs, endsBy }` | `endsAt = endsBy` |
| `publicNode` en `snapshot`/`batch` | ídem | `startedAt`, `attemptMs`, `endsBy` | `endsAt = endsBy` |
| `world:work:done` | + `attempts` (opcional, ya pasado) | `{ actionId, ok, status, summary, attempts }` | campo extra ignorado |
| `authorization.details` | + `chance`, `expectedMs` para la tarjeta | sólo al dueño | ignorado |
| `world:work:attempt` | **no se agrega** | el cliente deriva los golpes del reloj del servidor | — |

`endsBy = startedAt + Nmax·attemptMs` es una **cota pública**: se deduce de la fórmula y del nivel, no revela `N`.

**No** se anuncia el éxito antes del commit (no hay mensaje "golpe exitoso" previo a `work:done`): anunciarlo y luego fallar la liquidación mostraría un árbol caído que se levanta. El costo es que el éxito visible llega una latencia de commit (≈ 100–300 ms, edge + DB) después del tick ganador; el Pokémon sigue golpeando mientras tanto, que es justamente lo esperable.

### 2.12 Compatibilidad con clientes anteriores

- **Servidor primero.** El servidor v2 sigue aceptando `worldProtocol: 1` y rellena `endsAt = endsBy`. Un cliente v1 verá la barra hasta la cota y el resultado al final de su timeline (la escena ya espera la respuesta: `onResult` devuelve `undefined` mientras no llega). Se ve más lento, nunca incorrecto, y **no filtra `N`** aunque un cliente mienta su versión.
- **Luego el cliente v2**, que declara `worldProtocol: 2`.
- **Una versión después** (**OPEN QUESTION D5**): `world:work` desde v1 responde `{ ok: false, reason: 'client-outdated' }` con el texto "Actualizá la página para seguir trabajando".
- Los tests de aceptación que hoy hacen `join(..., { worldProtocol: 1 })` siguen válidos para el camino v1.

### 2.13 Qué reemplaza a la barra

| Momento | Pokémon | Nodo | Sonido | UI |
|---|---|---|---|---|
| Aceptado | camina al stand, mira al nodo | anillo suave | — | la tarjeta pasa a "{Pokémon} está talando…", **sin barra** |
| Cada intento (tick) | un golpe completo: `TASK_BEATS.period = attemptMs`, impacto en ~45 % del tick | astillas / chispas pequeñas, sacudida 1 px | golpe seco (volumen bajo, pitch con ±5 % de variación cosmética) | nada: el fallo es la ausencia de éxito, como en RuneScape |
| Éxito (`work:done ok`) | golpe final + salto corto | árbol cae / roca se parte (animaciones `fell` existentes) | golpe fuerte + campanilla | `+XP`, `+ítem` (`rewardPops`), nivel si subió |
| Cancelado / movido | vuelve con el entrenador | vuelve a normal | — | toast breve |
| Fallo de liquidación | vuelve | normal | tono grave | "No se pudo guardar. Probá de nuevo." |
| Observadores | mismo golpe por tick (mismo reloj, mismo `startedAt`) | anillo **sin** progreso (se elimina el arco de `worldResourceOverlay.ground`) | sólo si están cerca | — |
| Reduce motion | sprite paso a paso, sin inclinación | sin partículas | igual | igual |

La tarjeta antes de empezar reemplaza "3 s" por "≈ 3,6 s" (media, calculada con la misma fórmula compartida, sólo informativa). **No** se muestra la probabilidad por golpe salvo que se decida (**OPEN QUESTION D7**).

`choppingTimeline` / `miningTimeline` pasan de "N golpes conocidos" a "golpes indefinidos hasta el resultado": el número de golpes deja de salir de `durationMs`.

### 2.14 Estimación de carga

Supuestos (INFERENCE): 70 % de los conectados trabajando; ciclo medio = `E[t]` + 2,5 s de desplazamiento; mezcla de niveles 1–30 → ciclo ≈ 5 s (peor caso nivel 50: ≈ 3,1 s); 5 observadores por chunk activo.

| Concurrentes | Acciones/s (típico · peor) | Commits DB/s | Autorizaciones + ownership/s | Deltas de nodo/s (×2 por acción × 5 viewers) | Entradas en la cola | CPU sorteo |
|---|---|---|---|---|---|---|
| 10 | 1,4 · 2,3 | 1,4 · 2,3 | 1,4 · 2,3 (ownership cacheada) | 14 · 23 | ≤ 7 | despreciable |
| 30 | 4,2 · 6,8 | 4,2 · 6,8 | 4,2 · 6,8 | 42 · 68 | ≤ 21 | despreciable |
| 100 | 14 · 23 | 14 · 23 | 14 · 23 | 140 · 230 | ≤ 70 | despreciable |

- Con la propuesta C **el costo por acción es el mismo que hoy**; lo que cambia es la *frecuencia* en niveles altos (hasta ~1,6× por jugador). El recurso escaso es la edge function `world-authority` (un `commit_work` por acción, timeout 6 s): a 100 jugadores, 14–23 commits/s. Medir antes de abrir a 100 (**riesgo R5**).
- Si se eligiera A (mensaje por intento) se sumarían ~100 × 0,7 / 0,6 s × 5 viewers ≈ **580 mensajes/s** a 100 jugadores, sin beneficio visible. Otro motivo para C.

### 2.15 Spam, bots y reloj

| Vector | Hoy | Con PROB-1 | Mitigación propuesta |
|---|---|---|---|
| Spam de `world:work` | sin límite; cada pedido con Pokémon ajeno pega a la edge (cache sólo de positivos) | igual | token bucket por jugador: 4 intents/s, ráfaga 6; cache negativa de ownership 5 s |
| Cancelar y reiniciar para "re-tirar" | — | sin ventaja (§2.9); cuesta una autorización | el mismo bucket; métrica `cancelledThenRestarted` |
| Leer `N` | — | imposible si no sale del servidor | test que recorre los tres canales y falla si aparece un `endsAt` distinto de `endsBy` |
| Mentir `worldProtocol: 1` | — | recibe `endsAt = endsBy` (cota) | nada más que hacer |
| Reloj del cliente adelantado | no afecta: el cierre lo agenda el servidor | igual | — |
| Enviar `cancel` en el "momento justo" | — | el cliente no conoce el momento | — |
| Bot que encadena nodos | posible hoy | igual; el azar no lo agrava | métricas por jugador (acciones/h, varianza de intervalos) para una fase posterior |
| Pedido tardío tras éxito | `actor-busy` mientras `settling` | igual | — |

### 2.16 Recursos: árboles, pinos, rocas, cultivos y avanzados

| Tipo | Lifecycle | Qué cambia | Qué no cambia |
|---|---|---|---|
| Árbol común / palmera | `available → working → depleted → available` | chance por intento | agota al primer éxito, respawn 90 s, XP, drop |
| Pino (`pine_tree`, Nv 12) | idem | pMax 0,85 | idem |
| Roca (`stone_outcrop`) | idem | chance | idem |
| Parcela (plantar / cuidar / cosechar) | `PLOT_LIFECYCLE` | chance con `FARM_ACTION_MS` y nivel del cultivo | `growMs`, dueño, `tended`, cosecha |
| Avanzados (madera dura, boreal, hierro, oro, cristal) | idem árbol/roca | pMax del tier; tope protege la cola larga | requisitos de nivel y aptitud mínima |
| Recursos futuros con varias cargas (`charges`) | no existe aún | la fórmula funciona igual por *carga*: cada éxito consume una; la acción podría encadenar | fuera de PROB-1 |

## 3. Impacto por archivo

| Archivo | Cambio | Tipo |
|---|---|---|
| `src/features/skills/domain/balance.ts` | + `ATTEMPT`: `UNLOCK_SLOWDOWN`, `CURVE_GAMMA`, `P_CAP`, `CAP_FACTOR`, `MAX_ATTEMPTS`, `TIER_MAX_CHANCE`; `SKILLS_RULES_VERSION = 'skills-1.1'` | regla |
| `src/features/skills/domain/attempts.ts` (nuevo) | `attemptChance()`, `attemptCap()`, `drawAttempts(p, cap, random)`, `expectedMs()` — puras, compartidas cliente/servidor | regla |
| `src/features/skills/domain/workRules.ts` | `WorkTerms` + `chance`, `attemptMs`, `maxAttempts`, `attempts`; `workDuration` deja de usarse para recolección | regla |
| `src/features/skills/service/skillsService.ts` | `authorizeWorkAttempt` recibe `attemptMs`, sortea `attempts`, devuelve `durationMs = attempts·attemptMs` + `attempt` público | regla |
| `src/features/worldSkills/server/skillsWorldPolicy.ts` | pasa `attemptMs`; `details` + `chance`, `expectedMs`; **nunca** `durationMs` en `details` | adaptador |
| `services/realtime/src/world/skills/skills.generated.js` | regenerado con `bundle-skills.mjs` | bundle |
| `services/realtime/src/world/worldTuning.js` | + `WORK_TICK_MS = 600` (400–1200) | config |
| `services/realtime/src/world/skillPolicy.js` | `readAuthorization`: clamp a múltiplos de `attemptMs`, lee `attempt {chance, attemptMs, maxAttempts}` | contrato |
| `services/realtime/src/world/resourceAuthority.js` | `#start` guarda `attemptMs`, `endsBy`; `#reply` sin `endsAt` real; `complete` sin cambios | autoridad |
| `services/realtime/src/world/resourceStore.js` | + `actionAttemptMs`, `actionEndsBy` | estado |
| `services/realtime/src/world/worldProtocol.js` (+ `.d.ts`) | `WORLD_PROTOCOL = 2`; `publicNode` sin `endsAt` real | protocolo |
| `services/realtime/src/world/worldRoom.js` | `ownAction` sin `endsAt` real; versión por cliente para el alias v1 | protocolo |
| `services/realtime/src/rooms/PresenceRoom.js` | token bucket para `world:work` / `world:cancel` | seguridad |
| `services/realtime/src/world/pokemonOwnership.js` | cache negativa breve | carga |
| `src/features/world/state/sharedWorld.ts` | `OwnAction` con `attemptMs`, `endsBy` | cliente |
| `src/features/worldSkills/client/worldSkillsSession.ts` | `begin()` devuelve `attemptMs` en lugar de `durationMs` | cliente |
| `src/features/skills/ui/useSkillsLayer.ts`, `worldSkills/client/useFarmPlots.ts` | escena en bucle hasta `work:done` | cliente |
| `src/features/skills/scene/logging/choppingTimeline.ts`, `scene/mining/miningAction.ts` | timeline abierta (golpe por tick) + fase final disparada por el resultado | presentación |
| `src/features/world/render/workerPose.ts` | `periodMs = attemptMs` | presentación |
| `src/features/world/render/worldResourceOverlay.ts` | anillo sin arco de progreso | presentación |
| `src/features/skills/components/WorkCard.vue`, `FarmCard.vue` | quitar `.wc-progress` / `.fc-progress`; "≈ x s" | presentación |
| `src/features/skills/ui/skillsView.ts`, `farmView.ts` | `seconds` = `expectedMs()` | presentación |
| `supabase/` | **ninguno** en la fase mínima; opcional D6 (`attempts`, `chance` en `skill_work_settlements`) | — |

## 4. Riesgos

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | `endsAt` real en `work:result`, `ownAction` o `publicNode` revela `N` | **Bloqueante** | quitarlo de los tres canales; test de no-fuga |
| R2 | `MIN_ACTION_MS = 1200` y el clamp de 500 ms impiden 600 ms | **Bloqueante** | reglas nuevas en §2.7 |
| R3 | Cliente v1 calcula barra y golpes con `endsAt − startedAt` | **Bloqueante para el rollout** | alias `endsAt = endsBy`, servidor primero, luego `client-outdated` |
| R4 | Sin rate-limit de `world:work` | Alto (ya existe hoy) | token bucket + cache negativa |
| R5 | Más commits/s en niveles altos sobre la edge function | Medio | medir a 30 jugadores antes de 100; métricas `playerData` existentes |
| R6 | Ritmo de XP en niveles altos hasta +56 % | Medio (diseño) | γ = 2; decidir D4 |
| R7 | El éxito visible llega una latencia de commit después del tick | Bajo | el Pokémon sigue golpeando; aceptable |
| R8 | Cola larga percibida en recursos avanzados (p99 ≈ 20 s) | Bajo | tope `⌈3/p⌉`; D2 |
| R9 | Sesgo por usar `Math.random` en vez de `cryptoRandom` | Bajo | el sorteo usa el `random` inyectado de SKILLS; test de que producción usa `cryptoRandom` |
| R10 | Reinicio pierde acciones en curso (ya pasa hoy) | Bajo | sin cambio; el jugador vuelve a pedir y no pierde valor esperado |

## 5. Decisiones abiertas

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Curva | γ = 1 (RuneScape) · 1,5 · **2** | γ = 2 |
| D2 | Protección de rachas | **tope `⌈3/p⌉`** · tope `⌈2/p⌉` (más corto, más "picos") · probabilidad creciente por fallo | `⌈3/p⌉` |
| D3 | Ritmo (`RHYTHM`) | **absorbido por la curva** · mantenerlo multiplicando `p` | absorberlo |
| D4 | XP/h en niveles altos | aceptar (hasta 1,56×) · bajar `pMax` · recalibrar XP en otra tarea | aceptar y medir; recalibrar aparte |
| D5 | Clientes v1 | alias `endsAt = endsBy` una versión y luego `client-outdated` · `client-outdated` desde el día uno | alias una versión |
| D6 | Auditoría del sorteo | nada · guardar `attempts`/`chance` en la liquidación (migración aditiva) | nada en PROB-1; D6 en un encargo con migración |
| D7 | Mostrar la probabilidad por golpe | no · sí en la tarjeta · sí en el roadmap | no (sólo "≈ x s") |
| D8 | ¿Agricultura también probabilística? | **sí** (el brief lo pide) · sólo Talar y Minería | sí, mismo modelo |
| D9 | `pMax` por tier | 0,95 / 0,85 / 0,72 / 0,58 / 0,48 · otros | los propuestos |
| D10 | `UNLOCK_SLOWDOWN` | **1,25** (3,0–4,6 s en Nv 1) · 1,0 (2,4–3,7 s) | 1,25 |

## 6. Fases de implementación (commits pequeños)

1. **`skills: attempt chance model`** — `balance.ts` + `attempts.ts` puros con tests de tablas (valores de §2.6), sin conectar.
2. **`skills: authorize with secret attempt draw`** — `WorkTerms`, `authorizeWorkAttempt(attemptMs)`, `durationMs = N·attemptMs`; `SKILLS_RULES_VERSION` 1.1; tests de distribución (χ²) y de `too_early`.
3. **`world-skills: pass attemptMs, public attempt details`** — adaptador + bundle regenerado + test de drift del bundle.
4. **`world: WORK_TICK_MS and attempt-aware readAuthorization`** — tuning + clamps; tests de límites.
5. **`world: stop publishing the real end (protocol 2)`** — `publicNode`, `work:result`, `ownAction` con `attemptMs`/`endsBy`; alias v1; **test de no-fuga**.
6. **`world: rate-limit work intents`** — token bucket + cache negativa de ownership.
7. **`client: adopt protocol 2`** — `sharedWorld`, `worldSkillsSession`, `useFarmPlots`.
8. **`client: open-ended work animation`** — timelines en bucle, `TASK_BEATS.period = attemptMs`, fase final por resultado.
9. **`client: remove progress bars`** — `WorkCard`, `FarmCard`, anillo del overlay; "≈ x s".
10. **`client: attempt sounds and success feedback`** — sonidos y pops.
11. **`world: refuse protocol 1 work`** (una versión después, D5).

Cada commit deja el sistema desplegable: 1–4 no cambian el comportamiento visible (con `attemptMs` = tick y sin conectar la fórmula al cliente), 5 es compatible con v1, 7–10 dependen de 5.

## 7. Matriz de pruebas

| Área | Prueba | Nivel |
|---|---|---|
| Fórmula | `attemptChance` reproduce §2.6 (±0,1 pp); monotonía en nivel y aptitud; `p ∈ (0, 0,98]`; `Lreq = 50` no divide por cero | unit |
| Fórmula | `expectedMs` analítico = Monte Carlo (±2 %) para cada recurso en Lreq y 50 | unit |
| Sorteo | χ² de `N` contra geométrica truncada (10⁵ muestras, α = 0,01); `N ≤ Nmax`; `N ≥ 1` | unit |
| Sorteo | producción inyecta `cryptoRandom` | unit |
| Contrato | `readAuthorization` rechaza `durationMs` no múltiplo, `> MAX_ATTEMPTS·tick`, `attemptMs` fuera de 400–1200 | unit |
| Funcional | nivel 1 completa en `[tick, Nmax·tick]`; nivel 50 recurso básico: ≥ 90 % en el primer tick (con `random` fijo) | room |
| Funcional | talar, minar, plantar, cuidar, cosechar con el nuevo modelo; agotamiento y respawn idénticos | room / aceptación |
| No-fuga | ningún mensaje a ningún cliente (dueño, observador, v1, v2, snapshot, batch, result) contiene el `endsAt` interno | room |
| Cancelación | cancel en tick k: sin pago, nodo restaurado, ledger cerrado; re-pedido inmediato autorizado | room |
| Movimiento | moverse del anchor cancela; el `placeActor` del servidor no | room (existente, re-ejecutar) |
| Reconexión | < 15 s: `ownAction` con `attemptMs`/`endsBy`, acción sigue; > 15 s: cancelada si `running`, pagada si ya liquidó | room |
| Desconexión | dueño offline: la acción liquida, `player:state` al volver refleja XP y materiales | aceptación |
| Persistencia | reinicio durante `running`: sin pago, nodo disponible; reinicio tras commit: nodo agotado restaurado | staging (pglite) |
| Exactly-once | `complete` dos veces, settle con `duplicate`, reintento tras `store-unavailable`: un solo pago | room + DB |
| Concurrencia | dos jugadores, mismo nodo, mismo tick: uno `busy`, SKILLS `cancelWork` para el otro | room |
| Concurrencia | dos jugadores, misma parcela vacía | room |
| Seguridad | spam de 50 `world:work`/s: bucket rechaza, métricas suben, ownership no satura | room |
| Seguridad | cliente declara v1: recibe `endsAt = endsBy` | room |
| Seguridad | payload con `durationMs`, `attempts`, `chance` ignorados | unit (`workIntent`) |
| Carga | benchmark existente con 10 / 30 / 100 bots, tick 600: p95 del tick de room < 10 ms, commits/s y bytes/s dentro de §2.14 | bench |
| Presentación | golpe por tick sincronizado entre dueño y observador (mismo `startedAt`, mismo reloj) | unit (`workerPose`) |
| Presentación | reduce-motion; sin barra en `WorkCard`/`FarmCard` | component |

## 8. Recomendación final

**Implementar la opción C (sorteo secreto al autorizar) con la fórmula de §2.4: γ = 2, `UNLOCK_SLOWDOWN` = 1,25, tope `⌈3/p⌉`, tick 600 ms.** Reutiliza intacta la autoridad, el exactly-once, el lock de nodos y la persistencia existentes. Cumple el brief: 3,0–4,6 s en recurso básico de nivel 1 y 0,63 s (95 % primer intento) en nivel 50. No requiere migración ni persistir intentos, y es inmune a reconexiones y reinicios por construcción. La condición no negociable es el commit 5: **el final real de una acción no puede salir del servidor.** Antes de empezar hay que cerrar D1, D4 y D5.

---

## Apéndice A — Script de las tablas

Autocontenido (Node ≥ 18). No forma parte del repositorio ejecutable; se reproduce aquí para auditar los números.

```js
const UNLOCK_SLOWDOWN = 1.25, T = 600, LMAX = 50, CAP_FACTOR = 3, MAX_ATTEMPTS = 40, P_CAP = 0.98
const APT = { 1: 1.3, 2: 1.12, 3: 1, 4: 0.9, 5: 0.8 }            // APTITUDE_DURATION (balance.ts)
const TIER_PMAX = { 'muy básico': 0.95, 'básico': 0.85, 'intermedio': 0.72, 'avanzado': 0.58, 'especializado': 0.48 }

function chance(L, req, baseMs, pMax, apt = 3, g = 2) {
  const pReq = Math.min(0.5, T / (UNLOCK_SLOWDOWN * baseMs))
  const x = Math.max(0, Math.min(1, (L - req) / (LMAX - req)))
  const base = pReq + (pMax - pReq) * x ** g
  return Math.min(P_CAP, 1 - (1 - base) ** (1 / APT[apt]))
}
const cap = p => Math.min(MAX_ATTEMPTS, Math.max(3, Math.ceil(CAP_FACTOR / p)))
const mean = p => T * (1 - (1 - p) ** cap(p)) / p                     // E[min(Geom(p), cap)] · T
const quantile = (p, q) => T * Math.max(1, Math.min(cap(p), Math.ceil(Math.log(1 - q) / Math.log(1 - p))))
const atCap = p => (1 - p) ** (cap(p) - 1)
```

## Apéndice B — Referencias

- `docs/skills/WORLD_SKILLS_CONTRACT.md` — contrato WORLD × SKILLS vigente.
- `docs/skills/SKILLS_1_REPORT.md` §7 — calibración de la curva de XP.
- `docs/design/MAP_1_RESOURCE_AUDIT.md` — ciclos de trabajo y escasez de nodos en Pradera.
- `docs/TRUST_BOUNDARY.md`, `AGENTS.md` §2 y §11 — el cliente no decide azar persistente.

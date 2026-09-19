# R32.4 — Authority Foundations

> Rama `feat/r32-4-authority-foundations`, desde `feat/r32-3-shared-battle-rules` @ `9ba9641bf0e921b8507e0d96f05fee7efeee352b`.
> **Solo primitivas de autoridad, tests y documentación.** No hay Supabase, ni persistencia, ni inventario, ni ownership, ni Dungeon, ni encuentros, ni loot, ni llaves, ni captura persistida, ni retreat, ni wipe, ni Alpha, ni Boss, ni co-op, ni matchmaking, ni IA, ni predicción de cliente, ni reconciliación, ni balance.
> Catálogo: `1.oras.db4ae081bb58`. Reglas: `pokeswap-battle-v1`. Ninguno de los dos cambia acá.
> Código: `src/features/battle/authority/`. Tests: 55, en cinco archivos de esa misma carpeta.

---

## 1. Qué es

R32.3 dejó el motor: puro, determinista, compartible entre cliente y servidor. R32.4 no agrega gameplay; decide **quién tiene la palabra final**, y construye las primitivas mínimas para que más adelante una `ExpeditionRoom` real pueda correr Shared Battle Rules sin que un cliente pueda torcerlas.

```
payload de transporte (unknown)
  → validate.ts        forma, ids, límites — una whitelist, nunca un cast
  → authority.ts       controlador, objetivo, versiones, idempotencia
  → reduceBattle       las mismas reglas que corre el cliente
  → eventos + revision + snapshot sin el RNG
```

Al terminar R32.4 **no se juega nada distinto**. Lo que cambia es que existe un lugar donde un combate puede resolverse del lado del servidor, y que ese lugar ya sabe desconfiar.

---

## 2. Frontera de confianza

Esto es lo que hay que leer si se lee una sola sección. Es AGENTS §2 aplicado a un combate.

| Confiable (lo decide el servidor) | No confiable (llega por la red) |
|---|---|
| El reloj (`AuthorityClock`) | Cualquier tiempo que mencione el cliente |
| La semilla y el cursor del RNG | Cualquier `seed`, `cursor` o roll propuesto |
| El catálogo y las reglas | La versión que el cliente **dice** correr |
| El mapa de control `controllerId → combatantIds` | El `combatantId` del payload |
| El estado canónico y la `revision` | Cualquier estado o resultado afirmado |
| Qué hace un objeto y cuánto bonifica una ball | El `itemId` y el `ballId` propuestos |

El cliente puede proponer **intención**. No puede afirmar **hechos**: no hay ningún campo en `protocol.ts` que pueda cargar daño, HP resultante, resultado de captura, roll de RNG, cooldown completado, cambio de stat, recompensa ni loot. No es que se ignoren: es que no existen. Esa es la forma más barata de que no se filtren.

Sí:

```
USE_MOVE(combatantId, moveSlotId, targetId?)
```

No:

```
Thunderbolt dealt 73 damage
```

---

## 3. Arquitectura, y por qué la sala está en TypeScript

`services/realtime` es JavaScript CommonJS sin paso de build: **no puede importar** Shared Battle Rules, que son TypeScript bajo `src/`. Escribir ahí la `ExpeditionRoom` hoy obligaba a una de dos cosas: una segunda copia de las reglas —justo lo que R32.3 existe para evitar— o una decisión de bundler tomada a las apuradas al cierre de una fase.

Por eso la sala vive donde viven las reglas, sin ninguna dependencia de transporte:

| Archivo | Responsabilidad |
|---|---|
| `clock.ts` | `AuthorityClock`, reloj de sistema y reloj manual para tests |
| `seed.ts` | `AuthoritySeedSource`: CSPRNG en producción, fija en test |
| `actionId.ts` | Formato y parseo de `<controllerId>:<sequence>` |
| `protocol.ts` | Intenciones, códigos de rechazo, envelopes de evento y de resultado |
| `validate.ts` | Payload `unknown` → `TransportAction`. Puro, sin contexto |
| `snapshot.ts` | Proyección del estado canónico **sin** RNG |
| `idempotency.ts` | Ledger acotado + piso de secuencia por controlador |
| `itemCatalog.ts` | Qué hace un objeto y cuánto bonifica una ball, del lado del servidor |
| `authority.ts` | `BattleAuthority`: estado canónico, reloj, control, revisión |
| `expeditionRoom.ts` | Esqueleto de sala: join/leave/message/update |
| `harness.ts` | Andamio de test y dev (no está en el barrel) |

R34 conecta esto a Colyseus dándole un paso de build al servicio. **Nada de este código tiene que cambiar cuando pase**: una subclase de `Room` llama `join`, `message`, `update` y `leave`, en ese orden, y reenvía lo que devuelven.

---

## 4. `actionId`

```
actionId = "<controllerId>:<sequence>"
```

Un string, dos trabajos:

- **dedupe** — el mismo id dos veces es la misma acción dos veces.
- **orden** — `sequence` es un contador por controlador, así que se puede distinguir "no vi esto" de "ya acepté uno posterior" sin timestamps ni relojes vectoriales.

**Scope: batalla × controlador.** No global y no por socket: una reconexión conserva la identidad del controlador y sigue contando, así que las acciones anteriores al corte siguen siendo reconocibles como las mismas.

El prefijo no es decoración: se compara contra el controlador **autenticado por el transporte**. Un cliente no puede acuñar ids en el namespace de otro y envenenarle la ventana de dedupe.

Por qué no un UUID: dedupea y no dice nada del orden, así que la detección de stale necesitaría un segundo campo y un ledger acotado no tendría red de contención al desalojar. Por qué no un timestamp: §11 — nada acá puede depender de un reloj de pared para su semántica.

Parseo estricto: se corta por el **último** `:` (un `controllerId` con `:` adentro sobrevive), la secuencia son dígitos decimales sin cero a la izquierda, y `01` no es `1`. Todo lo que no sea exactamente lo que produce `formatActionId` se rechaza con `INVALID_ACTION_ID`.

---

## 5. Idempotencia

Contrato: la primera recepción válida ejecuta y registra; la repetición **no vuelve a mutar** y devuelve el resultado ya conocido.

```ts
submit(controllerId, payload) -> accepted | duplicate | rejected
```

- `accepted` — corrió una vez. Lleva `actionId`, `revision`, `events` y `snapshot`.
- `duplicate` — el mismo `actionId` otra vez. Devuelve los eventos y la revisión **recordados**; el snapshot es el actual, porque un cliente que reintenta quiere ponerse al día, no ver un tablero viejo.
- `rejected` — no corrió nada. Lleva `reason`, `actionId` cuando se pudo leer, la `revision` actual y un `detail` de diagnóstico que **no** es protocolo.

Nada se duplica: ni daño, ni PP, ni captura, ni cambio, ni objeto, ni ningún efecto lateral. El test que lo prueba no mira una llamada: corre dos batallas idénticas, una de las cuales recibe **cada** acción tres veces, y compara el estado final.

### Cache acotada

`createIdempotencyLedger({ maxEntries = 256 })`, FIFO, en memoria y por batalla. Sin Redis y sin base: R32.4 es el piso sobre el que eso se elegiría, y elegirlo ahora sería elegirlo sin un perfil de carga.

Una cache acotada sola olvidaría una acción vieja y la volvería a correr. Por eso hay una segunda estructura: el **piso** por controlador, la secuencia más alta jamás aceptada, que solo crece y cuesta un número. Un id lo bastante viejo como para haber sido desalojado está, por construcción, en el piso o por debajo, y vuelve como `STALE_ACTION`. **El límite cuesta memoria de consulta, nunca corrección.**

---

## 6. Orden y acciones viejas

No se asume entrega exactamente-una-vez ni orden. Tres casos, y nada más que tres:

| Situación | Respuesta |
|---|---|
| `actionId` en el ledger | `duplicate`, sin segunda mutación |
| `sequence` ≤ piso del controlador y no está en el ledger | `rejected: STALE_ACTION` |
| Cualquier otra | Se valida y, si corresponde, se ejecuta |

Una acción atrasada que nunca se ejecutó se rechaza igual: obedecerla desharía una decisión que el propio cliente ya superó. No hay huecos que llenar —no se exige contigüidad— porque un hueco puede ser una acción rechazada, y rechazar no mueve el piso.

### Reconexión

Un cliente que se reconecta —recarga, segunda pestaña, socket caído— vuelve a contar desde 1, y ese `controller:1` caería debajo del piso. Resetear el piso sería tirar la ventana de dedupe, que es justo lo que una reconexión **no** puede hacer. Así que la autoridad expone `acceptedFloor(controllerId)` y el handshake de join le dice al cliente desde dónde seguir: el contador es una **continuación**, no un conteo nuevo.

Un rechazo **no** entra al ledger: no mutó nada, así que repetirlo es inofensivo, y corregir el payload y reintentar con otro `actionId` funciona.

---

## 7. Reloj de servidor

R32.3 no tiene reloj: `ADVANCE_TIME` lleva milisegundos y el motor le cree a quien los manda. Correcto para un reducer puro, fatal sobre un socket.

La autoridad **nunca** toma un delta de la red. Lee su propio reloj, le resta el momento en que arrancó la batalla y le pasa la diferencia a las reglas.

```ts
interface AuthorityClock { nowMs(): number }
```

- `createSystemClock()` — el único reloj de pared de la feature. Clampea hacia adelante: si el host salta para atrás, la batalla se congela en vez de rebobinar las Action Bars. Una batalla congelada se recupera; una que retrocede, no.
- `createManualClock(startMs)` — el de los tests. `advance(ms)` y `setTo(ms)`, ambos solo hacia adelante. **Nada duerme y nada se agenda.**

`tick()` es el único punto donde avanza el tiempo. La sala lo llama desde su loop —un `setSimulationInterval` de Colyseus en R34— antes de drenar los mensajes; es un game loop de paso fijo, no una sutileza. `submit()` **no** avanza el reloj: un rechazo y un duplicado son lecturas puras, y una acción se ejecuta en el tiempo de batalla que dejó el último tick.

Un timestamp de cliente puede viajar como metadato de diagnóstico. No tiene autoridad sobre nada: ni Action Bar, ni ticks de veneno, ni sueño, ni cooldown, ni expiración. El test lo comprueba mandando veinte acciones que afirman diez segundos cada una, con el reloj quieto: el tiempo de batalla sigue en cero.

---

## 8. RNG de servidor

El RNG autoritativo es del servidor. El cliente no provee semilla, ni cursor, ni rolls.

```ts
interface AuthoritySeedSource { createSeed(): number }
```

- Producción: `createRuntimeSeedSource()`, sobre `crypto.getRandomValues`. **Tira** si no hay CSPRNG en vez de degradar en silencio, porque un fallback callado es exactamente como una semilla débil llega a producción sin que nadie se entere.
- Tests: `createFixedSeedSource(seed)` y `createSequenceSeedSource([...])`.
- `Math.random()` no aparece en ninguno de los dos.

Por qué un CSPRNG y no un contador: la semilla decide si una captura sale, y una semilla predecible es una captura predecible. AGENTS §11 ya lo pide para todo lo que mueve propiedad, rareza o recompensa; una captura es las tres cosas.

Shared Battle Rules sigue recibiendo su `RngState` como dato. Lo que cambia es que solo la autoridad lo establece y lo hace evolucionar.

---

## 9. Secreto del RNG, y por qué es una proyección

`BattleState` lleva `rng: { seed, cursor }`, y tiene que llevarlo: las reglas son puras, su azar es dato, y un replay arranca de esos dos números.

Mandárselos al cliente le entregaría el futuro entero del combate. `rngValueAt(seed, cursor)` está **exportado**, es determinista y tiene tres líneas: con esos dos números se leen de antemano la precisión, el crítico, los efectos secundarios y —el que mueve propiedad— el roll de captura. No haría falta hacer trampa. Haría falta mirar.

La respuesta es una **proyección**, no un cambio a R32.3:

| | Lleva RNG | Quién lo ve |
|---|---|---|
| `InternalAuthoritativeBattleState` | Sí | Solo el servidor |
| `ClientBattleSnapshot` | **No** | El cliente |

`projectClientSnapshot` construye el snapshot **campo por campo**, nunca con `Omit<BattleState, 'rng'>`. Con `Omit`, el día que alguien agregue un segundo secreto al estado, se publica a todos los clientes y no falla nada. Listando los campos, uno nuevo le falta al cliente hasta que una persona decida lo contrario: la dirección equivocada es la segura.

Hay tres tests sobre esto: el snapshot no contiene `rng`, `seed` ni `cursor` a ninguna profundidad; los envelopes de evento tampoco; y el estado interno **sí** los sigue teniendo, para que la ausencia signifique algo.

---

## 10. Validación de versiones

Antes de crear una batalla y antes de aceptar cualquier acción se comparan `catalogVersion` y `battleRulesVersion` contra lo que el servidor soporta.

- **Al crear:** si el catálogo o las reglas no están soportadas, `createBattleAuthority` tira. Un servidor que arranca una batalla sobre un catálogo que no puede correr se enteraría tres acciones después, adentro de un reducer, con la pelea ya en pantalla.
- **Al aceptar:** la versión que manda el cliente tiene que estar soportada **y** coincidir con la del estado. Cualquier otra cosa es `INVALID_VERSION`.

El cliente no decide qué versión se ejecuta y no hay compatibilidad silenciosa: un mismatch es un rechazo explícito, nunca una reinterpretación contra otro catálogo.

---

## 11. Frontera de validación

`validate.ts` es una **whitelist**: cada campo del resultado se copia por nombre.

```ts
const action = payload as TransportAction   // nunca
```

Un cast es una promesa que el compilador cree y la red no cumple. La whitelist además resuelve "el daño y el RNG del cliente se ignoran" sin una sola rama sobre el tema: un payload que carga `damage`, `seed`, `cursor`, `revision` o `elapsedMs` valida **exactamente** a la misma acción que el mismo payload sin ellos. El test lo afirma comparando las dos respuestas enteras.

Se valida, en dos etapas:

| Etapa | Dónde | Qué |
|---|---|---|
| Forma | `validate.ts`, puro | Objeto, `actionId`, `battleId`, ambas versiones, tipo de intención, ids, límites numéricos |
| Contexto | `authority.ts` | Namespace del `actionId`, batalla, versiones soportadas, batalla terminada, control, objetivo, objeto y ball |

Los ids son strings opacos de hasta 128 caracteres. Los ids de catálogo son enteros seguros en `(0, 1 000 000]`: `Number.isSafeInteger` solo aceptaría `1e15`, y un límite solo aceptaría `4.5`; hacen falta los dos más el signo para que un `NaN`, un `Infinity`, un negativo o un float no lleguen a las reglas, donde un lookup fallaría tres capas más allá.

`advanceTime` **no es una intención válida**. No es que se rechace por autorización: no está en la unión. El reloj es del servidor.

---

## 12. Control y propiedad

La autoridad deriva el mapa de las sides al crear la batalla:

```
controllerId → combatantIds
```

Una side con `controllerId: null` es la salvaje: del servidor, de nadie más. Un cliente no puede mover un Pokémon enemigo, elegirle un movimiento, cambiar la party de otro, usar un objeto de otro ni capturar en nombre de otro; y capturar algo que ya comanda no es capturar (`INVALID_TARGET` — R35 va a leer propiedad exactamente en esa línea).

El contrato es independiente de Supabase: `controllerId` lo provee el **transporte** al autenticar —en R30 eso es `supabaseAuth.js`— y nunca sale del payload. No hay persistencia todavía.

---

## 13. Revisión y envelopes

`revision` arranca en 0 y sube exactamente 1 por mutación exitosa, venga de una acción o del reloj.

- Duplicados: **no** incrementan.
- Rechazos: **no** incrementan. `reduceBattle` devuelve el mismo objeto de estado cuando rehúsa, y eso es lo que la autoridad lee: un estado intacto es un rechazo.

Cada evento de dominio viaja adentro de un envelope transport-safe:

```ts
{ battleId, sequence, revision, actionId, serverTimeMs, event }
```

`sequence` es monotónica sobre todos los eventos de la batalla. `actionId` es la acción que lo causó, o `null` cuando fue el reloj del servidor. El `BattleEvent` de adentro es R32.3 **sin tocar**: el envelope agrega contexto, no reinterpreta el evento.

---

## 14. Snapshot

`ClientBattleSnapshot` lleva `battleId`, `revision`, `serverTimeMs`, `timeMs`, ambas versiones, el `config` (el cliente anima las barras que el servidor cronometra), sides, combatientes proyectados, `outcome`, `eventSeq` y el mapa de control —que no es secreto: es quién puede apretar qué botón.

JSON-safe, sin `Map`, `Set`, función ni clase. El costo es una pasada superficial sobre los combatientes: el catálogo no está en el estado y no se copia nunca, así que un snapshot son una docena de objetos chicos y no 621 movimientos. Los snapshots referencian versiones e ids; el catálogo entero no viaja.

---

## 15. Códigos de rechazo

Códigos, no oraciones ni excepciones. Un rechazo es un resultado ordinario de una frontera no confiable, y usar `throw` como protocolo hace que el caso común parezca un bug (AGENTS §19).

| Código | Cuándo |
|---|---|
| `INVALID_SCHEMA` | El payload no tiene la forma de una acción, o el objeto no existe |
| `UNKNOWN_ACTION` | Bien formado, pero no es una intención que este servidor conozca |
| `INVALID_ACTION_ID` | El `actionId` no es `<controllerId>:<sequence>` |
| `UNKNOWN_BATTLE` | La batalla equivocada |
| `INVALID_VERSION` | Catálogo o reglas que este servidor no corre |
| `NOT_CONTROLLER` | Ese controlador no comanda ese combatiente |
| `INVALID_TARGET` | El objetivo no está en la batalla, o no es legal para la intención |
| `STALE_ACTION` | Superada: ya se aceptó una acción posterior de ese controlador |
| `BATTLE_FINISHED` | La batalla está decidida |
| `ACTION_NOT_ALLOWED` | Las reglas la rehusaron: sin PP, movimiento desconocido, cambio ilegal |

`DUPLICATE` no es un rechazo: es una de las tres formas del resultado.

---

## 16. `ExpeditionRoom` — esqueleto y nada más

Hace exactamente esto: entra y sale gente, rutea **un** tipo de mensaje a la autoridad, corre un paso de loop y devuelve qué difundir. Una sola batalla, que nadie elige con un encuentro.

No hay piso de Dungeon, ni encuentros, ni spawn, ni loot, ni llave, ni boss, ni co-op, ni persistencia, ni Supabase. Agregar cualquiera de esas cosas acá es trabajo de R34/R35 disfrazado de R32.4.

Una reconexión reemplaza el socket viejo del mismo controlador, igual que `PresenceRoom`: dos sockets vivos para un controlador creerían cada uno que comandan al mismo Pokémon. Una sesión desconocida recibe el mismo código que un controlador equivocado, y no aprende nada sobre quién está en la sala.

**No se importa nada del prototipo de Dungeon.** La autoridad importa Shared Battle Rules y nada de `dungeonPrototype/battle.ts` ni de su estado mutable. La dirección futura es `ExpeditionRoom → battle authority → shared rules`, nunca al revés.

---

## 17. Logging

Ninguno. `console.*` está prohibido en `src/` por ESLint (AGENTS, R21) y no hace falta: el diagnóstico viaja en el resultado estructurado (`reason` y `detail`) y en los eventos. No se construyó observabilidad: eso tiene dueño en R30 y su propio runbook.

---

## 18. Verificación

```bash
npm run test        # 1457 tests, 122 archivos (55 nuevos en authority/)
npm run typecheck   # 0 errores
npm run lint        # 0 errores en src/
npm run build       # OK
```

`npx eslint .` reporta 14 errores preexistentes bajo `.worktrees/`, que es un directorio untracked de otra rama y está fuera de alcance. `eslint.config.js` ignora `services/` y `supabase/` en la raíz, pero no sus copias dentro de `.worktrees/`.

Los cinco archivos de test:

| Archivo | Qué prueba |
|---|---|
| `authority.transport.test.ts` | El camino completo, el gate humano: intención → validación → reducción → eventos + snapshot, el mismo `actionId` dos veces, acciones superadas y reconexión |
| `authority.malicious.test.ts` | Control ajeno, spoofing de namespace, objetivos falsos, números imposibles, versiones falsas, daño y RNG del cliente, batalla terminada |
| `authority.clock.test.ts` | Tiempo de servidor, tiempo de batalla, slicing, status sobre reloj de servidor, relojes que no retroceden |
| `authority.rng.test.ts` | Misma semilla, semilla distinta, cliente sin acceso, y las tres pruebas de no filtración |
| `authority.units.test.ts` | `actionId`, whitelist, desalojo del ledger, catálogo de objetos, sala, versiones al crear |

---

## 19. Gate humano de R32.4

| # | Criterio | Dónde se ve |
|---|---|---|
| 1 | El input de transporte se trata como untrusted | §11; `validate.ts` es una whitelist |
| 2 | El cliente no controla el RNG | §8; `authority.rng.test.ts` |
| 3 | El cliente no controla el reloj | §7; `authority.clock.test.ts` |
| 4 | Una acción duplicada no ejecuta dos veces | §5; las dos batallas comparadas |
| 5 | Un controlador equivocado no puede actuar | §12; `authority.malicious.test.ts` |
| 6 | Las versiones se validan | §10 |
| 7 | La `revision` canónica es monotónica | §13 |
| 8 | El snapshot no filtra el RNG | §9 |
| 9 | Las reglas corren del lado del servidor sin duplicar lógica | §3; se importa `reduceBattle`, no se reescribe |
| 10 | El test de autoridad de punta a punta pasa | §18 |
| 11 | No hay Dungeon productivo ni Supabase | §16 |

---

## 20. Lo que queda para R33 y más adelante

| Fase | Qué |
|---|---|
| **R34** | Paso de build en `services/realtime` y `ExpeditionRoom` como `Room` de Colyseus real. Encuentros, piso, spawn con reloj de servidor. Difusión de snapshots y eventos a varios clientes |
| **R34/R35** | Predicción de cliente y reconciliación. R32.4 no las diseñó a propósito (§18 del encargo): primero tiene que existir un cliente que reciba snapshots |
| **R35** | Loot, llave, captura como propiedad (I-1: retreat asegura, wipe pierde, expiración extrae), retreat, wipe, expiración. El borde de propiedad ya tiene su línea en `toCommand` |
| **R35/R36** | Inventario real: hoy `itemCatalog.ts` sabe **qué hace** un objeto y no si el jugador lo tiene. Ese chequeo entra en una frontera que ya existe |
| **R36** | Persistencia: `finishBattle` devuelve instancias; escribirlas es del servidor |
| **R37** | Co-op: el estado ya se escribe como sides con parties y slots activos, así que un Alpha con dos aliados es más slots, no otro tipo |
| **Cuando haya perfil de carga** | Si el ledger en memoria por batalla no alcanza (salas de larga vida, reconexiones largas), recién ahí se elige Redis o una tabla |

---

## 21. Preguntas realmente abiertas

| # | Pregunta | Bloquea |
|---|---|---|
| A-1 | La primitiva de reconexión existe (`acceptedFloor`, §5), pero **el handshake que la usa es de R34**: falta decidir si el piso viaja en el join, en el snapshot, o en la respuesta del propio rechazo | R34, cuando exista un cliente real |
| A-2 | ¿Qué tamaño de ledger corresponde? 256 es una pelea larga a ojo, no una medición | R34, con telemetría |
| A-3 | ¿Un `USE_MOVE` con `targetId` debería ser obligatorio en vez de opcional? Hoy es opcional porque R32.3 es 1 vs 1 y deriva el objetivo; con más slots tiene que ser obligatorio | R37 |
| A-4 | ¿El cliente recibe el `detail` de un rechazo, o solo el código? Hoy viaja; es diagnóstico y no protocolo, pero le cuenta al atacante en qué chequeo cayó | R34 |

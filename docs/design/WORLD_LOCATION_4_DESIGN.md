# WORLD LOCATION-4 — Orden distribuido de sesiones y cierre de sesión (diseño)

> **Estado:** auditoría y diseño, **sin implementación**. Rama `design/world-location-ordering-0.3`, base `integration/world-skills-0.3 @ 4d0ab64`.
> **Alcance de esta rama:** solo `docs/`. No cambia código productivo, SQL, hosted, flags ni procesos. `WORLD_LOCATION_PERSISTENCE` sigue en `shadow` en el entorno oscuro y **`on` sigue bloqueado**.
> **Origen:** LOCATION-3B (calificación en shadow, 2026-10-03) terminó en **BLOCKED**: entre dos instancias, una sesión vieja puede volver a imponerse sobre una más nueva (T3, T4 y T7, esta última sin latencia inyectada).
> **Recomendación:** clave de propiedad **(generación del host, orden de aceptación en el host)**, con la generación asignada por la base a cada proceso, más:
> - **drenaje** del host viejo;
> - **reconexiones automáticas que nunca desplazan a otra pestaña** (`resume`): solo una acción del jugador puede desplazar;
> - un **código de cierre propio** para el reemplazo;
> - **guardado antes de desconectar** en el apagado.
>
> Ningún reloj de máquina se compara. La demostración está en §3.4 y la comprobación exhaustiva de los casos concretos en §2.3.

> **Revisión 1 (C1–C5, 2026-10-03):** el diseño recibió `APPROVE WITH REQUIRED FIXES`. Esta revisión agrega:
> - **ciclo de vida del host** con estados monótonos `starting → active → draining → stopped` y activación explícita y atómica (§3.3);
> - **claims y guardados según el estado del host** (§3.3.4);
> - **permisos explícitos** de tabla, secuencia y funciones (§7.4.1);
> - la **topología como precondición bloqueante** (§3.5);
> - la **prueba obligatoria de 4503 frente a 4001** (§5.3);
> - las **decisiones de UX** aprobadas (§3.6);
> - un segundo modelo exhaustivo con **mutantes** como controles negativos (§2.4).
>
> **No hay `READY FOR ON`** mientras la precondición de topología (§3.5) no esté verificada en Colyseus Cloud.

Convenciones:

- **FACT** es medido u observado; **INFERENCE** se deduce del código o de los datos; **OPEN QUESTION** queda sin resolver.
- Los tiempos de las trazas son ms relativos al inicio de cada escenario del arnés.
- `@x` es el instante en que la respuesta de hosted volvió al proxy, que está pegado al realtime (overhead del proxy ≤ 0,2 ms, FACT).

---

## 1. El defecto, formalizado

### 1.1 Cómo se midió (LOCATION-3B)

Todo fue temporal y quedó fuera del repo:

- **Proxy local** como única puerta hacia hosted. Reenvía **solo** `location_claim` y `location_save` al `world-authority` v4 real, con el secreto real del lado servidor, y responde localmente las demás operaciones, así SKILLS no tiene efectos en hosted. Registra el orden de llegada, los epochs esperados y confirmados y los tiempos. Puede demorar, retener o devolver tarde un request.
- **Auth:** un stub mapea tokens de prueba a la cuenta tester `terremototw`. Es la única pieza simulada: el contrato de ubicación solo ve el user id.
- **Realtimes:** dos realtime de `4d0ab64` sin modificar (`NODE_ENV=production`, `shadow`), P en el puerto 2701 y Q en el 2711. Sockets reales `@colyseus/sdk` con `Origin` permitido.

La evidencia redactada (sin ids, tokens ni secretos) está en `docs/design/world-location-4/evidence/`. El arnés no se versiona porque lee rutas de secretos y el id del tester; queda en el scratchpad de la sesión de LOCATION-3B.

**Identidad de sesión.** El journal de `4d0ab64` **no tiene un id de sesión persistente**: la base solo ve `(user_id, epoch)`, y el arnés no registró el `sessionId` de Colyseus. Esa ausencia es parte del defecto. En las trazas, cada sesión se nombra por socket e instancia (`A@P` es el socket A en la instancia P). No se repitieron las pruebas para capturar ids porque escribirían en hosted (esta fase lo prohíbe). El test de aceptación (§7.6) registra el `sessionId` nuevo de §7.4.

### 1.2 Mecanismo (código de `4d0ab64`)

`LocationJournal.#claimOnce` envía `world_location_claim(user, knownEpoch)`. Si la respuesta es `conflict`, adopta el epoch leído y **vuelve a reclamar** (hasta 3 rondas). Si el intento falla o se abandona (el adaptador Edge corta a 1,5 s), el reintento en segundo plano repite el ciclo con backoff de 1 a 30 s.

Dentro de un proceso, `replace()` cierra el socket viejo y la cadena de claims ordena las sesiones (§2 de LOCATION-3B: 41/41). **Entre procesos no hay nada que ordene:** cualquier sesión viva que reciba `conflict` relee y reclama, así que **gana el último claim confirmado por la base**, sea de la sesión más nueva o de la más vieja.

### 1.3 T3 — claim de la sesión vieja en vuelo (800 ms inyectados), primera corrida (E0 = 75)

| t (ms) | Inst. | Sesión | Evento | Esperado → respuesta | Llega a hosted / responde |
|---:|:--:|:--:|---|---|---|
| ≈0 | P | A | se abre el socket A (`joinOrCreate`) | | |
| 9 | P | A | claim ronda 1 (entrada fresca: `knownEpoch` 0) | 0 → `conflict 75` | @374 |
| 376 | P | A | claim ronda 2 (re-base) **retenido 800 ms en tránsito** | 75 → … | |
| ≈380 | Q | B | se abre el socket B (cuando la ronda 2 de A ya está en vuelo) | | |
| 386 | Q | B | claim ronda 1 | 0 → `conflict 75` | @818 |
| 826 | Q | B | claim ronda 2 | 75 → **`claimed 76`** | @1224 — **B es la sesión vigente** |
| 1644 | P | A | la ronda 2 de A llega a la base | 75 → `conflict 76` (no escribe) | @1644 |
| 1661 | P | A | **A relee y reclama otra vez** (ronda 3) | 76 → **`claimed 77`** | @2100 — **REIMPOSICIÓN**, 876 ms después de que B fuera confirmada |
| 11590 | P | A | checkpoint de A | e77 → `applied` | @12604 |
| 12127 | Q | B | checkpoint de B | e76 → **`stale`** | @12779 → B cercada (`wouldFence` Q +1) |

Se repitió 3 veces más (E0 = 86, 88 y 90) y la sesión vieja ganó en **3/3** (`evidence/3b-t3-t4-t7-repeats.log`).

### 1.4 T4 — claim de la sesión vieja abandonado y reintentado (E0 = 77)

| t (ms) | Inst. | Sesión | Evento | Esperado → respuesta | Llega / responde |
|---:|:--:|:--:|---|---|---|
| ≈0 | P | A | se abre A | | |
| 9 | P | A | ronda 1 | 0 → `conflict 77` | @445 |
| ≈335 | Q | B | se abre B (300 ms después de que A recibió su snapshot) | | |
| 341 | Q | B | ronda 1 | 0 → `conflict 77` | @788 |
| 455 | P | A | ronda 2 **retenida sin respuesta**; el adaptador aborta a 1,5 s (≈1955) → `failed`, A queda `unclaimed` | 77 → (retenida) | |
| 802 | Q | B | ronda 2 | 77 → **`claimed 78`** | @1227 — **B vigente** |
| 3216 | P | A | **reintento en segundo plano** (backoff ≈1 s + jitter) | 77 → `conflict 78` | @3673 |
| 3675 | P | A | re-base | 78 → **`claimed 79`** | @4102 — **REIMPOSICIÓN**, 2,9 s después de B |
| 5595 | P | A | se libera la ronda 2 abandonada y llega tarde a la base | 77 → `conflict 79` | **no escribe**: el request abandonado en sí es inofensivo (B2 de WORLD LOCATION-2) |
| 11791 | Q | B | checkpoint | e78 → **`stale`** | B cercada |
| 12284 | P | A | checkpoint | e79 → `applied` | |

Se repitió 2 veces (E0 = 92 y 94) y la sesión vieja ganó en **2/2**.

**Lo que muestra T4:** el abandono no es el problema; el problema es el **reintento de una sesión que sigue viva**. Con el backoff, la reimposición puede llegar **hasta 30 s después** de que la sesión nueva quedó confirmada.

### 1.5 T7 — carrera natural, sin inyección (gap de 250 ms, E0 = 104)

| t (ms) | Inst. | Sesión | Evento | Esperado → respuesta | Llega / responde |
|---:|:--:|:--:|---|---|---|
| 0 | P | A | se abre A | | |
| 8 | P | A | ronda 1 | 0 → `conflict 104` | @435 |
| 250 | Q | B | se abre B | | |
| 257 | Q | B | ronda 1 | 0 → `conflict 104` | @721 |
| 443 | P | A | ronda 2; **hosted tardó 822 ms (latencia real)** | 104 → `conflict 105` | @1265 |
| 729 | Q | B | ronda 2 | 104 → **`claimed 105`** | @1131 — **B vigente** |
| 1267 | P | A | re-base | 105 → **`claimed 106`** | @1660 — **REIMPOSICIÓN**, 529 ms después |
| 11865 | P | A | checkpoint | e106 → `applied` | |
| 12374 | Q | B | checkpoint | e105 → **`stale`** | B cercada |

Las otras cuatro carreras naturales (gaps de 100, 150, 200 y 300 ms) terminaron en B porque el orden de commit coincidió con el de apertura. **El resultado dependió solo de la latencia de hosted** (FACT, `evidence/3b-t3-t4-t7-repeats.log`).

### 1.6 Qué pasaría en `on`

1. La pestaña **nueva** (B) sigue jugando hasta su próximo guardado: un checkpoint (10 a 12 s), un cruce de portal o la desconexión.
2. Ese guardado vuelve `stale`. `LocationJoin.fence` cierra B con **4001 `session-replaced`**.
3. El cliente muestra «otra pestaña o dispositivo» y **no reintenta** (`colyseusPresence.ts`).
4. La pestaña **vieja** (A) queda dueña y sigue guardando. El jugador ve expulsada la pestaña que abrió último.

No hay bucle automático, porque 4001 detiene el cliente, pero gana la pestaña equivocada. Si el jugador recarga B, B vuelve a ganar y A recibe 4001.

En T4 la expulsión puede ocurrir mucho después de que B parecía estable (hasta 30 s de backoff más el siguiente guardado).

### 1.7 Requisito del test de aceptación futuro

Debe reproducir **las tres variantes** contra dos procesos reales:

- **T3:** el claim de la sesión vieja en vuelo mientras reclama la nueva.
- **T4:** el claim viejo abandonado y reintentado.
- **T7:** **sin latencia inyectada**. En CI se usa una distribución de latencia muestreada del benchmark real (p50 ≈ 415 ms, cola hasta 1,5 s) con muchas repeticiones. Como compuerta manual, una corrida contra hosted en el entorno oscuro.

El criterio está en §7.6. El protocolo actual debe **fallar** ese test (se verifica que el test no sea vacuo) y el nuevo debe pasarlo en todas las repeticiones.

---

## 2. Auditoría de alternativas

### 2.1 Resultado de imposibilidad

> **Sin un coordinador común por el que pasen ambas aceptaciones, y sin relojes sincronizados con desfase acotado, ningún protocolo puede garantizar que «la última conexión aceptada por cualquier realtime gane».**

Argumento por indistinguibilidad, con una red asíncrona sin cota de demora:

- **E1:** P acepta A en el instante real 0 y Q acepta B en 250.
- **E2:** Q acepta B en 0 y P acepta A en 250.
- Se eligen las demoras de modo que cada mensaje llegue a la base en el mismo instante en ambas ejecuciones. Los relojes locales, con desfases arbitrarios, muestran las mismas lecturas.

Ningún participante (P, Q ni la base) distingue E1 de E2, así que cualquier protocolo determinista elige el mismo ganador en las dos. Pero «la última aceptada» es B en E1 y A en E2: el protocolo se equivoca en una de ellas. ∎

Consecuencias:

- **Orden por llegada a la base** (cualquier `nextval`, cualquier «último claim confirmado»): un request viejo que llega tarde parece nuevo.
- **Orden por reloj del realtime:** correcto solo si el desfase es menor que el gap entre aceptaciones. T7 tenía 250 ms.
- **Orden exacto:** solo es posible si **ambas aceptaciones ocurren en el mismo coordinador**. Eso es justamente lo que ya pasa dentro de un proceso (LOCATION-3B §2: 41/41).

### 2.2 Las alternativas, una por una

Para cada una se respondió lo mismo: qué es «la más nueva», entre procesos, relojes, request tardío, respuesta perdida, reintento, proceso caído, sesión abandonada, cliente manipulado, migración y coste. Entre paréntesis, la fila del modelo de §2.3.

#### A. Ticket asignado por la base (`nextval`), idempotente por `sessionId` — filas 8–11

| | |
|---|---|
| La más nueva | la sesión cuyo **primer request (registro)** llegó después a la base |
| Entre procesos y dispositivos | sí, un contador único |
| Relojes | no usa |
| **Request tardío** | **falla.** Si el registro de la sesión vieja llega después del de la nueva, la vieja recibe el ticket mayor y **pasa a ser la más nueva**. Modelo T3/T7: R1 = 1, R2 = 2 (contraejemplo: `A envía reg` después de que B ya es dueña → `ticket2` → A desplaza a B) |
| Respuesta perdida / reintento | con idempotencia, mismo ticket. Sin ella (`ticketSinIdem`, filas 12–15), T4 empeora (R1 = 33) |
| Proceso caído / sesión abandonada | no resucita sin socket; pero si el registro y el claim viajan juntos, un registro tardío de una sesión muerta **reclama** |
| Cliente | no interviene |
| Migración / coste | columna + secuencia + función; +1 RTT por join salvo que se combine con el claim |
| **Veredicto** | **No cierra T3/T7.** Hace menos probable la reimposición, que es exactamente lo que la consigna pidió no confundir con una solución |

#### B. Timestamp de aceptación del servidor (reloj del realtime) — filas 16–23

| | |
|---|---|
| La más nueva | el mayor `acceptedAt` según el reloj del proceso que aceptó |
| Entre procesos | **requiere relojes sincronizados** |
| **Relojes** | con un desfase ε, las aceptaciones a menos de ε se ordenan mal. Con P adelantado 300 ms, T7 (gap 250) se invierte: R1 = 1, R2 = 2. Un reloj adelantado minutos haría ganar a sus sesiones durante minutos |
| Request tardío, respuesta perdida, reintento | bien: el sello es fijo y el claim idempotente |
| Proceso caído / abandonada | bien |
| Cliente | bien (sello de servidor) |
| Migración / coste | bajos |
| **Veredicto** | cierra T3/T4/T7 **solo bajo la hipótesis** \|ε\| < gap, que no es demostrable. Se rechaza como garantía; sirve como diagnóstico |

#### C. Identificador generado por el cliente o la pestaña

| | |
|---|---|
| La más nueva | lo que diga el cliente (id de pestaña + reloj del dispositivo) |
| Relojes | los de los dispositivos, sin ninguna sincronización |
| Cliente manipulado | **no es confiable**: el cliente lo forja y podría declararse «la más nueva» para siempre |
| **Veredicto** | se rechaza como autoridad. Uso permitido, solo de UX: reconocer que la misma pestaña reconecta (no usado en esta propuesta) |

#### D. Lease por sesión con propietario y generación

| | |
|---|---|
| La más nueva | quien tiene el lease vigente; otra sesión solo toma la fila si el lease expiró o mediante takeover |
| Relojes | solo `now()` de la base: bien |
| Request tardío | un takeover tardío incondicional gana; uno condicional cae en E |
| Coste | una renovación periódica **por jugador** (N escrituras cada pocos segundos). Sin takeover, la pestaña nueva espera a que expire: mala UX |
| **Veredicto** | se rechaza por sesión. **La idea del lease se usa a nivel de host** (H) |

#### E. Takeover explícito

| | |
|---|---|
| La más nueva | la última que hizo takeover |
| Request tardío | un takeover condicional («tomo la fila si el dueño sigue siendo X», un CAS sobre lo observado) no desplaza a uno posterior, **salvo que la sesión vuelva a leer**. Para entrar tiene que leer, y una lectura tardía es un request tardío: `rebaseUnico`, filas 4–7, R1 = 1 |
| **Veredicto** | **necesaria como semántica de UX** (recargar o «Jugar acá» es un takeover explícito), pero **no resuelve el orden** sola |

#### F. Coordinador único de presencia

| | |
|---|---|
| La más nueva | el orden de `onJoin` en el único proceso. **Exacto** (41/41 medido; modelo filas 2, 26 y 30: 0 violaciones) |
| Entre dispositivos | bien, si todos los sockets del usuario llegan al mismo proceso |
| Topología actual | **el mundo ya es de proceso único** (INFERENCE fuerte: `actors`, `clientsByActor` y `world` son de módulo; dos procesos activos parten el mundo). En régimen hay un solo host; varios procesos solo coexisten durante un **traspaso** (deploy) o por un error de configuración |
| Falta | el traspaso entre coordinadores → H |

#### G. Sesión provisional + confirmación autoritativa

La sesión juega provisionalmente hasta que la base confirma. Ya existe en `on` (hidratación de 1,5 s y adopción tardía B3). **Mejora la UX, no el orden.** Se conserva tal cual.

#### H. (Recomendada) Generación de host + orden de aceptación en el host + drenaje — F + lease de host + E + G — filas 24–31

| | |
|---|---|
| **La más nueva** | la de **clave mayor `(g, n)`**: `g` es la generación que la base le asignó al proceso al arrancar; `n` es el orden de aceptación (`onJoin`) dentro del proceso. En régimen (un solo host) es **exactamente la última aceptada**. Entre hosts, **el host vigente gana** |
| Entre procesos | orden total por clave; el host viejo **drena**: deja de aceptar y cierra sus sesiones con «reconectar» (§3.3) |
| Entre dispositivos | igual que entre pestañas: el host vigente ordena |
| **Relojes** | **no compara relojes de máquinas.** Los leases de host usan solo `now()` de la base; el período de renovación usa el temporizador monotónico local (afecta la tasa, no el desfase) |
| **Request tardío** | lleva su clave fija desde la aceptación: **nunca** desplaza a una clave mayor (Lema 2, §3.4) |
| **Respuesta perdida** | el claim es idempotente por clave: el reintento **adopta** el epoch confirmado sin incrementarlo |
| **Reintento** | mismo payload; mismo resultado o `superseded` definitivo |
| **Proceso caído** | su lease vence; otro host toma una generación nueva (mayor) y sus sesiones ganan |
| **Sesión abandonada** | su claim tardío solo gana si su clave es la mayor, es decir, si **era** la más nueva; nunca desplaza a una posterior |
| **Cliente manipulado** | el cliente no aporta nada a la clave |
| Migración | tabla y secuencia de hosts con ciclo de vida, 3 columnas, 7 funciones, Edge v5, realtime y cliente (códigos de cierre). Ver §3.3 y §7.3 a §7.5 |
| Coste | medio. **Un RTT menos por join** (desaparece la lectura de conflicto; hoy son 2 llamadas por join, B2 de LOCATION-3B) y una renovación cada 5 s **por proceso** |

### 2.3 Comprobación exhaustiva (`world-location-4/ordering-model.mjs`)

El modelo recorre **todas** las intercalaciones de envío, llegada a la base, respuesta, pérdida y abandono para T3/T7 (sin abandono), T4 (con abandono y reintento), el mismo proceso y el caso invertido (una pestaña nueva cae en el host viejo).

En `generacionDrenaje` el modelo incluye además el drenaje del host viejo, en cualquier momento de la traza, y las reconexiones `resume` que provoca.

Propiedades:

- **R1:** ninguna sesión le quita la fila a una pestaña abierta después.
- **R2:** al final gana la pestaña abierta último. Una reconexión es la misma pestaña y conserva su orden de apertura.
- **S:** ningún guardado se aplica sin ser dueño.
- **K:** la clave nunca decrece.

Salida completa, con el contraejemplo más corto de cada fila, en `ordering-model.out.txt`. «Finales» son estados finales distintos.

| Protocolo | T3/T7 R1/R2 | T4 R1/R2 | Mismo proceso R1/R2 | Pestaña nueva en host viejo R1/R2 | S | K |
|---|---|---|---|---|---|---|
| actual (`4d0ab64`) | **2/2** | **57/40** | 0/0 | 2/2 | 0 | — |
| rebaseUnico | 1/2 | 6/10 | 0/**2** | 1/2 | 0 | — |
| ticket (idempotente) | **1/2** | 6/10 | 0/0 | 1/2 | 0 | — |
| ticketSinIdem | 1/2 | 33/61 | 0/0 | 1/2 | 0 | — |
| reloj, desfase 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | — |
| reloj, P +300 ms | **1/2** | 6/10 | 0/0 | 0/0 | 0 | — |
| generacion (sin drenaje) | **0/0** | **0/0** | 0/0 | 1/2 | 0 | 0 |
| **generacionDrenaje (propuesta)** | **0/0** | **0/0** | **0/0** | 3/4 (excepción acotada, §3.4) | 0 | 0 |

Lectura:

- El modelo **reproduce el defecto real**: en la fila «actual», el contraejemplo mínimo es la traza de T3/T7. También **rechaza** ticket, rebaseUnico y reloj con desfase, con contraejemplos concretos.
- La propuesta da 0 violaciones en T3, T4 y T7 **en todas las intercalaciones**, incluso cuando el host viejo drena en medio de la carrera, sin ninguna hipótesis de latencia.
- La única excepción es la pestaña abierta en el host viejo **antes de que ese host sepa que hay uno más nuevo**. Por §2.1 es inevitable sin un coordinador común. Está acotada en el tiempo y es estable (§3.4).
- **Iteraciones del propio diseño que el modelo atrapó:**
  - reconectar la pestaña drenada como aceptación nueva le devolvía la partida a la pestaña vieja (de ahí el `resume`);
  - asignar `n` fuera del `onJoin` rompía el orden en el host.
- Límites del modelo (dos pestañas más sus reconexiones, un abandono por sesión, un guardado por sesión): ver la cabecera del archivo. La demostración general, sin esos límites, está en §3.4.

### 2.4 Comprobación exhaustiva del ciclo de vida de hosts (`world-location-4/host-lifecycle-model.mjs`)

El modelo recorre todas las intercalaciones de requests de varios procesos contra las funciones SQL propuestas en §7.4: `acquire`, `activate`, `renew`, `drain`, `stop`, `claim` con clave y `save`. Incluye llegada en cualquier orden, respuesta perdida con reintento, caída de un candidato y el paso del tiempo de la base (leases).

Además del protocolo propuesto corre **11 mutantes** (controles negativos). Cada uno quita o cambia una regla y debe quedar **detectado**: alguna propiedad violada en algún escenario. Salida completa, con el contraejemplo más corto de cada mutante, en `host-lifecycle-model.out.txt`.

**Propiedades:**

- **H1:** `newerActive` solo es verdadero si existe un host más nuevo **activo, activado tras estar listo** y con lease vigente. Un `starting` nunca drena al vigente.
- **H2:** los estados son monótonos.
- **H3:** una generación por `hostId`; `acquire` nunca cambia una fila existente; el reintento devuelve la misma generación y el mismo estado.
- **H4:** claims solo desde `active` con lease; guardados solo desde `active` con lease, o desde `draining` con lease sobre una fila propia.
- **H5:** la activación solo ocurre desde `starting`, con lease vigente y sin un host más nuevo activo.
- **H6:** un host que supo de uno más nuevo termina `draining` o `stopped`.
- **H7:** un candidato caído antes de estar listo nunca queda activo, y el vigente sigue activo.

**Escenarios:**

- **S1:** candidato que falla antes de estar listo.
- **S2:** candidato lento (su lease de arranque vence).
- **S3:** dos candidatos concurrentes.
- **S4:** respuesta perdida en `acquire` y en `activate`.
- **S5:** intento de reactivar un host `draining` o `stopped` (y de renovarlo y guardar).
- **S6:** claims y guardados hostiles fuera de estado, con el epoch vigente adivinado.
- **S7:** guardado hostil de un host `draining` que ya perdió la fila.

**Resultados:**

| Variante | S1 | S2 | S3 | S4 | S5 | S6 | S7 | Resultado |
|---|---|---|---|---|---|---|---|---|
| **propuesta** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0 violaciones** |
| `acquire` crea `active` (el §7.4 original) | H1,H7 | H1 | H1 | 0 | H1 | 0 | H1 | detectado |
| `newerActive` cuenta `starting` | H1,H7 | H1 | H1 | 0 | H1 | 0 | H1 | detectado |
| `acquire` no idempotente | 0 | 0 | 0 | H3 | 0 | 0 | 0 | detectado |
| `activate` sin chequeo de estado | 0 | 0 | 0 | 0 | H2,H5,H6 | 0 | 0 | detectado |
| `activate` sin lease | 0 | H5 | H5 | H5 | H5 | H5 | H5 | detectado |
| `activate` sin chequeo de host más nuevo | 0 | 0 | H5 | 0 | 0 | 0 | 0 | detectado |
| claim solo por identidad (el §7.4 original) | 0 | 0 | 0 | 0 | 0 | H4 | H4 | detectado |
| claim sin lease | 0 | 0 | 0 | 0 | 0 | H4 | H4 | detectado |
| save sin estado | 0 | 0 | 0 | 0 | H4 | H4 | H4 | detectado |
| save `draining` sin chequeo de dueño | 0 | 0 | 0 | 0 | 0 | 0 | H4 | detectado (solo con S7) |
| `renew` reactiva `draining`/`stopped` | 0 | 0 | 0 | 0 | H2,H6 | 0 | 0 | detectado |

Lectura:

- El primer §7.4 tenía dos de estos defectos (`acquire` creaba `active`, y el claim chequeaba solo identidad). El modelo los detecta.
- La regla de dueño para `draining` solo se detecta con S7, porque ante guardados honestos el CAS de epoch ya la implica. Se conserva como defensa en profundidad contra un epoch adivinado.
- Estados recorridos por la propuesta: S1 672, S2 2.679, S3 106.634, S4 153, S5 8.719, S6 2.203 y S7 3.492 (unos 100 s en total).

---

## 3. Semántica de producto

### 3.1 Qué garantías son implementables

| Garantía | ¿Implementable? | Por qué |
|---|---|---|
| La última conexión aceptada por **cualquier** realtime siempre gana | **No**, sin coordinador común ni relojes acotados | §2.1 |
| El último claim confirmado por la base gana | Sí (es la de hoy) | **produce T3/T4/T7**: se rechaza |
| Una conexión nueva hace takeover explícito | Sí | sola no ordena (E); se usa como UX |
| **La última pestaña abierta por el jugador en el host de presencia vigente gana; un host viejo nunca recupera a un jugador; solo una acción del jugador desplaza a otra pestaña** | **Sí** | §3.4 y modelo |

### 3.2 La semántica elegida (para el jugador)

- **Una cuenta juega en una sola pestaña a la vez:** la última que abrió (abrir, recargar o «Jugar acá»). Las otras muestran «Tu partida se abrió en otra pestaña o dispositivo» y **no reconectan solas**. El botón «Jugar acá» (recargar) es el takeover explícito: esa pestaña pasa a ser la última abierta.
- **Las reconexiones automáticas** (deploy, reinicio, drenaje o corte de red) son de la **misma pestaña** (`resume`). Vuelven solas y en silencio, **en la posición donde estaban** (guardado antes de desconectar, §6), pero **nunca desplazan a otra pestaña viva**: si la hay, ceden y muestran «otra pestaña o dispositivo».
- **Nunca** una pestaña vieja le quita la partida a una más nueva, ni por claims (clave, §3.4) ni por reconexiones automáticas (`resume`).
- **Seguridad de `resume`:** el `tabId` lo genera el cliente (uno por carga de página). Solo sirve para decidir si una reconexión automática **cede**. Un cliente que lo manipule solo logra ceder, o comportarse como un recargar, que de todos modos está permitido. No otorga autoridad (I8).

### 3.3 Host vigente: ciclo de vida y drenaje (revisión C1/C2)

#### 3.3.1 Estados y transiciones

Los estados de un host son monótonos: `starting → active → draining → stopped`. Cada transición es una función SQL **atómica** con `WHERE state = <esperado>`. Ninguna otra transición es posible.

| Transición | Función | Condición (en la base, `now()` de la base) | Reintento tras una respuesta perdida |
|---|---|---|---|
| — → `starting` | `world_presence_acquire(hostId, leaseMs)` | genera la generación (`nextval`) y el lease de arranque | **misma generación y mismo estado**: `ON CONFLICT (host_id) DO NOTHING` y después se lee la fila; `acquire` nunca modifica una fila existente |
| `starting` → `starting` (lease) | `world_presence_renew` | el lease sigue vigente; si venció → `host_expired`, nunca revive | idempotente |
| **`starting` → `active`** | **`world_presence_activate(generation, hostId, leaseMs)`** | identidad exacta, estado `starting`, lease vigente y **ningún host más nuevo `active` con lease vigente**. Se serializa con `LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE` (dos candidatos no pasan a la vez) | sobre un `active`, devuelve `active` sin cambios |
| `starting` → `stopped` | `world_presence_drain` o `world_presence_stop` | candidato que aborta | idempotente |
| `active` → `active` (lease) | `world_presence_renew` | extiende el lease. Un `active` con lease vencido solo revive si no hay uno más nuevo activo; si lo hay, responde `newerActive` sin extender | idempotente |
| `active` → `draining` | `world_presence_drain(generation, hostId, drainMs)` | fija la ventana de flush (`now() + drainMs`); `renew` **no** la extiende | idempotente |
| `draining` → `stopped`; `*` → `stopped` | `world_presence_stop` | `stopped` es terminal | idempotente |
| **prohibidas** | — | `draining → active`, `stopped → *`, `active → starting`, cualquier retroceso | — |

- **`newerActive` solo cuenta hosts `active` con lease vigente.** Un `starting` no desplaza ni drena al vigente: no aparece en `newerActive`, no puede reclamar ni guardar (§3.3.4).
- **Un proceso que falla durante el arranque** deja una fila `starting` inerte: su lease de arranque vence, no puede activarse (`host_expired`) y no afecta al activo. Si falla limpio, llama `stop`.
- **Dos candidatos concurrentes:** las activaciones se serializan.
  - Si el de mayor generación ya está activo, el menor recibe `newer_active` y se detiene.
  - Si el menor se activó primero, la activación del mayor lo hace drenar (como en un deploy).
- **Candidato lento:** renueva su lease de arranque mientras se prepara. Si se cuelga y el lease vence, ya no puede activarse.

#### 3.3.2 En qué punto del ciclo de vida de Colyseus

Orden propuesto para `services/realtime/src/index.js`. Solo se aplica cuando `WORLD_LOCATION_PERSISTENCE` es `shadow` u `on`; con `off` no se adquiere nada y el arranque queda como hoy.

1. **Arranque del proceso:** `host.acquire()` con un `hostId` aleatorio nuevo, **antes** de `gameServer.listen()`, con backoff. El estado queda `starting`.
   - Si hosted no responde en 10 s, el proceso sirve igual con la ubicación `unavailable` (sin generación: no reclama ni guarda, se cuenta `dropped.noGeneration`) y sigue intentando `acquire` en segundo plano.
   - Las sesiones aceptadas sin generación quedan sin persistencia toda su vida.
2. **Preparación:** `gameServer.define('presence', …)` y `await world.start()` (carga inicial). Mientras tanto, `host.renew()` cada 5 s mantiene vivo el lease de arranque.
3. **`await gameServer.listen(port)`.** En Colyseus Cloud, `Server.listen` delega en `@colyseus/tools`, que abre `/run/colyseus/<2567 + NODE_APP_INSTANCE>.sock` y envía `process.send('ready')` a PM2 **antes** de devolver el control (FACT, `@colyseus/tools` 0.18.3).
4. **Activación:** **inmediatamente después** de que `listen` resuelve, `host.activate()`.
   - Con `active`: `accepting = true`, `/health` pasa a listo y empieza la renovación cada 5 s (lease de 15 s).
   - Con `newer_active`, `host_expired` o `host_inactive`: `stop`, se registra y el proceso sale con código 0. Más de 3 salidas de este tipo por hora disparan una alarma de **topología** (§3.5).
5. **Entre `listen` y la activación:** `onJoin` espera `host.whenActive()` hasta 2 s (sin cambios visibles en el caso normal; la activación es un RTT). Si vence, `ServerError(4503)` y el cliente reintenta con `resume`. El contador `n` se asigna **después** de esa espera, en la parte síncrona del `onJoin` (I13).
6. **Régimen:** renovación cada 5 s. Con `newerActive` (de una renovación, un claim o un guardado), el host drena.
7. **Apagado o drenaje:**
   - `gameServer.onBeforeShutdown` (antes de `matchMaker.gracefullyShutdown`): `host.drain()` (`active → draining`), congelar el movimiento y `flushAll` (3 s);
   - después, `PresenceRoom.onBeforeShutdown`: `presence:closing{draining}` y `this.disconnect(4503)`;
   - por último, `gameServer.onShutdown`: `host.stop()`.

   Un drenaje por `newerActive` sigue los mismos pasos sin salir del proceso; cuando queda vacío, `stop` y sale.

#### 3.3.3 Drenaje y `resume`

Un host que se entera de que hay uno vigente más nuevo **drena**:

1. rechaza nuevos joins con 4503;
2. congela el movimiento;
3. guarda las posiciones pendientes (solo filas propias, §3.3.4);
4. cierra cada socket con **4503 `host-draining`**.

Los clientes reconectan con `resume: {tabId}`; el ruteo los lleva al host vigente.

- **Join `resume` en el host vigente:**
  - si hay una sesión viva del mismo usuario **de otra pestaña** (otro `tabId`), el join se rechaza con `ServerError(4409, 'session-replaced')`: el cliente muestra el overlay con «Jugar acá» y se detiene;
  - si es la misma pestaña o no hay ninguna, es una aceptación normal con clave mayor.
- **`newerActive`** viaja en las respuestas de renovación, claim y guardado, para que el host viejo se entere en su primera interacción con la base.
- **No hay reanudación:** un host `draining` **nunca** vuelve a `active`. Si el host nuevo muere, la plataforma reinicia un proceso, que es un candidato nuevo con una generación nueva.

#### 3.3.4 Claims y guardados según el estado del host (C2)

La base exige, en la misma transacción y con `FOR SHARE` sobre la fila del host (serializa con `drain` y `stop`):

- **identidad exacta** `(generation, hostId)`;
- el **estado**;
- el **lease vigente** según `now()` de la base.

| Estado del host | Claim | Guardado |
|---|---|---|
| no existe o la identidad no coincide | `unknown_host` | `unknown_host` |
| `starting` | `host_inactive` | `host_inactive` |
| `active`, lease vigente | según la clave (§3.4) | normal: CAS de epoch **y** `owner_generation` = generación del escritor |
| `active`, lease vencido | `host_expired` | `host_expired` |
| `draining`, lease vigente | `host_inactive` (no crea claims) | **solo el flush final de filas propias** (`owner_generation` = la del host) con CAS de epoch. La ventana la fija `drain` y no se extiende |
| `draining`, lease vencido | `host_inactive` | `host_expired` |
| `stopped` | `host_inactive` | `host_inactive` |

Ningún guardado puede superar el CAS de epoch y dueño (Lema 3), cualquiera sea el estado.

**Reacción del realtime (sin reintentos infinitos):**

| Respuesta | Reacción |
|---|---|
| `unknown_host` | error de configuración o base reseteada: la ubicación pasa a `unavailable` en este proceso; se registra una vez; **no** se reintenta |
| `host_inactive` estando el host convencido de que está `active` | renovación inmediata para conocer el estado real. Si es `draining` o `stopped`, se sigue el drenaje. La sesión que no tenía claim queda **sin persistencia** (contada) y no se reintenta |
| `host_expired` | **pausa**: no se envían claims ni guardados y se renueva de inmediato. Si la renovación revive el lease, se reanuda: los guardados pendientes se reintentan una vez y las sesiones sin claim siguen su backoff (máximo 6 intentos, unos 2 min). Si responde `newerActive`, o sigue vencido tras 2 períodos de lease, el host drena y se detiene |
| `host_expired` en el flush de un `draining` | se termina el drenaje; las posiciones sin guardar se cuentan («K sin guardar (lease vencido)») |

### 3.4 Demostración

**Definiciones**

- Cada sesión `s` tiene la clave `K(s) = (g(h(s)), n(s))`, en orden lexicográfico:
  - `h(s)` es el host que la aceptó;
  - `g(h)` es la generación que la base le asignó a `h` antes de que aceptara jugadores;
  - `n(s)` es el contador de aceptación de `h`, que crece estrictamente en el orden de `onJoin` (el `onJoin` de Node es síncrono hasta asignar `n`).
- La clave se fija **en la aceptación** y viaja idéntica en todo claim y reintento de `s`.
- La fila guarda `K*` (clave del dueño) y `e` (epoch).
- `claim(K)` es atómico en SQL:
  - si `K > K*`: `K* := K`, `e := e + 1` → `claimed(e)`;
  - si `K = K*` y la sesión coincide: → `claimed(e)` (adopción);
  - si no: → `superseded`.
- `save(e', …)` se aplica solo si `e' = e`.

**Lema 1 (monotonía).** `K*` y `e` nunca decrecen.
*Prueba:* la única asignación es `K* := K` con `K > K*`, y `e := e + 1`. ∎

**Lema 2 (no reimposición).** Si en el instante `t` vale `K* ≥ K(B)` y `K(A) < K(B)`, entonces en todo `t' ≥ t` ningún claim de A modifica `K*` ni `e`.
*Prueba:* todo claim de A lleva `K(A)`, cualquiera sea su envío, su demora o su reintento. Por el Lema 1, `K(A) < K(B) ≤ K*(t) ≤ K*(t')`, así que la comparación da `superseded`. ∎

**Lema 3 (un solo escritor).** Después de un takeover por B, todo guardado de A da `stale`.
*Prueba:* A guarda con su `e_A`. El takeover hace `e > e_A`, y por el Lema 1 nunca vuelve a `e_A`. ∎

**Lema 4 (la más nueva llega).** Si B sigue viva y reintenta ante fallas de transporte hasta recibir una respuesta definitiva, termina con `K* = K(B)`, salvo que exista `C` con `K(C) > K(B)`.
*Prueba:* cada intento de B da `claimed` (toma la fila o la adopta) o `superseded`. Este último solo ocurre si `K* > K(B)`, es decir, si existe tal C. ∎

*Nota (revisión C2):* desde §3.3.4, un claim exige además que el host de la sesión esté `active` con lease vigente. Eso solo **restringe** qué claims se aplican, así que los Lemas 1–3 valen igual. El Lema 4 asume además que el host de B está `active`. Si no lo está, B no persiste (falla cerrada), y tampoco se reimpone nadie: I2 sigue valiendo.

**Teorema (T3, T4, T7).** Sea A aceptada en el host P y B en Q, con `g(P) < g(Q)` (P es la instancia vieja). Entonces `K(A) < K(B)` y, **en toda intercalación**:

- B termina dueña (o una C más nueva);
- una vez que B es dueña, A no vuelve a serlo (Lema 2);
- ningún guardado de A se aplica después (Lema 3).

T3 es una intercalación con la ronda de A demorada; T4, una con abandono y reintento; T7, una con latencia natural. Todas están cubiertas sin hipótesis de latencia ni de reloj. ∎

**Corolario (mismo proceso).** Si `h(A) = h(B)` y A fue aceptada antes, `n(A) < n(B)`: mismo resultado. Hoy ya vale por `replace()` y la cadena de claims; con la clave vale **sin depender de la cadena**.

**Lema 5 (las reconexiones automáticas no desplazan).** Una reconexión `resume` de la pestaña X entra al host vigente H. Solo hay dos casos:

- en H hay otra pestaña viva Y: X se rechaza (cede) y no reclama;
- no la hay: X es la única pestaña viva y su clave nueva no desplaza a ninguna sesión viva de otra pestaña.

Por lo tanto, el drenaje y los cortes de red nunca hacen que una pestaña le quite la partida a otra pestaña viva. ∎

**Teorema con drenaje.** Agregar el drenaje a T3, T4 y T7 en cualquier momento no cambia el resultado:

- si A drena antes de que B sea aceptada en Q, A' entra a Q con `n(A') < n(B)` y B la reemplaza (Corolario);
- si drena después, A' cede ante B (Lema 5).

Modelo: 0/0 en T3/T7 y T4 con el drenaje intercalado en todas las posiciones. ∎

**Excepción acotada (pestaña nueva en el host viejo).** Sea B abierta por el jugador en P **después** de que Q pasó a estar activo, pero **antes** de que P lo sepa, y A viva en Q. Entonces:

- `K(B) < K(A)`: si B toma la fila primero, A se la quita (R1 transitorio);
- cuando P se entera, drena, y la reconexión `resume` de B cede ante A (Lema 5).

Gana A, la más vieja, y B ve «otra pestaña o dispositivo» con «Jugar acá». No hay oscilación: la clave es monótona y B no reconecta sola.

**Cota:** la ventana va desde que Q está activo hasta la primera interacción de P con la base que traiga `newerActive` (un claim, un guardado o una renovación). Es como mucho un período de renovación R = 5 s más un RTT. Fuera de esa ventana P rechaza el join y la pestaña entra a Q como aceptación nueva, sin `resume`, y gana.

Por §2.1, esta ventana no se puede eliminar sin un coordinador común: P y Q todavía no comparten nada que ordene esas dos aceptaciones. (Modelo, caso invertido: R1 = 3, R2 = 4, todos dentro de la ventana; R2 = 0 si la renovación ocurre antes de aceptar B.)

### 3.5 Precondición de topología (**BLOQUEANTE para `on`**)

La propiedad «una generación por proceso» **solo es válida si WORLD tiene un único proceso activo en régimen**, y el solapamiento ocurre únicamente durante un deploy o un reinicio.

**Lo que se sabe hoy:**

- (FACT) `services/realtime/ecosystem.config.js` declara `instances: 1` y `exec_mode: 'fork'`.
- (FACT) `@colyseus/tools` 0.18.3, cuando `COLYSEUS_CLOUD` está definido:
  - escucha en `/run/colyseus/<2567 + NODE_APP_INSTANCE>.sock`, así que la plataforma admite varias instancias PM2;
  - envía `process.send('ready')` al terminar `listen`.
- (FACT) `index.js` le pasa a `listen` un `Server` ya construido, así que **la configuración Redis (driver y presencia) de Cloud no se aplica**.
- (INFERENCE fuerte) Con más de un proceso, cada uno tendría su propio matchmaker y su propio mundo: `actors`, `world` y `clientsByActor` son de módulo. **El mundo ya estaría partido**, con o sin WORLD LOCATION.
- (OPEN QUESTION) Si Cloud respeta `instances: 1`, cómo reemplaza el proceso en un deploy y qué señal envía.

**Caso 1 — Colyseus ejecuta un único proceso WORLD:**

- la propuesta es válida;
- en un deploy, el proceso nuevo arranca `starting`, se activa después de `listen` (§3.3.2), y el viejo se entera por `newerActive` o recibe SIGTERM o SIGINT y drena;
- los jugadores reconectan al nuevo con `resume`.

**Caso 2 — Colyseus puede ejecutar varios workers WORLD permanentes:**

- **una generación por proceso no es válida:** el worker de mayor generación haría drenar a los demás, y estos, al reiniciarse con una generación mayor, harían drenar al primero (drenaje mutuo);
- habría que pasar a una **generación por deployment** (un id de deployment o revisión común a sus workers) **más** un coordinador o sharding común. Por ejemplo:
  - fijar cada usuario a un worker por hash de `userId` con un driver y presencia compartidos (Redis), para que el orden en el host siga valiendo por usuario;
  - o un lease de propiedad por usuario (alternativa D);
- es un **rediseño de la propiedad**, fuera de esta propuesta, y además exige resolver antes la partición del mundo.

**Verificación obligatoria en Colyseus Cloud antes de `on`** (con evidencia documentada; preferentemente en una segunda app de Cloud para el build oscuro, sin tocar la pública):

1. **cantidad de procesos WORLD simultáneos** en régimen: `NODE_APP_INSTANCE` y el `hostId`/generación en el log de cada proceso; `/version` por proceso;
2. **escalado horizontal:** si hay autoescalado o varias máquinas o regiones por app, y si se puede fijar en uno;
3. **ruteo durante un deploy:** a qué proceso van las conexiones nuevas desde que el nuevo envía `ready`, y si el viejo sigue recibiendo conexiones;
4. **cuándo se dispara el apagado:** qué señal (SIGINT o SIGTERM), en qué momento respecto del `ready` del nuevo, y con qué plazo hasta el SIGKILL (debe superar el drenaje: 3 s de flush más margen);
5. **id de deployment o revisión:** si existe una variable de entorno común y confiable (para los logs y para el caso 2).

**Regla:** mientras estos cinco puntos no estén verificados y resulten en el caso 1, el veredicto **no puede** ser `READY FOR ON`. Si resultan en el caso 2, el veredicto es `BLOCKED` con rediseño. Además, el realtime registra en `/metrics` las salidas por `newer_active` y los drenajes por `newerActive` sin deploy, como alarma de una topología inesperada.

### 3.6 Decisiones de UX (aprobadas)

- El texto del botón es **«Jugar acá»**.
- Aparece en el **overlay de sesión cedida o reemplazada**: después de 4409, de un `ServerError` 4409 en un `resume`, o de 4001 interpretado como reemplazo.
- Es una **acción explícita de takeover**: un join **sin** `resume`, que como aceptación nueva desplaza a la otra pestaña.
- **Una reconexión automática nunca equivale a pulsarlo:** las reconexiones automáticas siempre llevan `resume` y ceden.
- El `tabId` **solo** sirve para la UX y la reanudación. **Jamás** participa de la clave autoritativa de la base (I8): la clave es `(generation, seq)`, asignada por la base y por el `onJoin` del host.

---

## 4. Reintentos y tiempos de espera

| Decisión | Valor | Motivo |
|---|---|---|
| Espera de hidratación (UX, `on`) | **1,5 s**, sin cambios | lo que el jugador espera antes del respaldo en Ciudad (PRESENCE UX-1). **Se separa** del timeout del request |
| Timeout del request `location_claim` | **4 s** (hoy 1,5 s) | p99 real ≈ 1,45 s, máx 1,52 s (FACT, LOCATION-3B §5), o sea ≈ 2,7 × p99. **No es la solución de T3/T7**: solo reduce abandonos y reintentos. La corrección es la clave (§3.4), con la que un abandono es inofensivo |
| Timeout de `location_save` | 5 s, sin cambios | |
| Llamadas por join | **1** (hoy 2) | sin lectura de conflicto; el claim lleva la clave |
| Deduplicación | **por clave + `sessionId`**: el claim es idempotente, y una repetición con la misma clave **adopta** | no hace falta un id de intento: cualquier repetición de la misma sesión es la misma operación. Los guardados ya son idempotentes por `(epoch, seq)` |
| **Cuándo reintentar** | error de transporte, timeout, HTTP 5xx o 429: backoff 1 s → 30 s con jitter, **mientras la sesión esté viva** y no haya recibido `superseded` | |
| **Cuándo un conflicto es definitivo** | **siempre** que la respuesta sea `superseded`: no hay re-base. `unknown_user` y 4xx también son definitivos (sin persistencia, contados) | el re-base automático era el defecto |
| **Adoptar una operación aplicada con respuesta perdida** | el reintento con la misma clave y la misma sesión devuelve `claimed` con el **epoch vigente, sin incrementarlo** | Lema 1; no quedan epochs huérfanos de la propia sesión |
| **Impedir que un reintento abandonado desplace a una sesión posterior** | estructural: la clave del reintento es la de la aceptación original | Lema 2 |
| `presence_acquire` al arrancar | antes de `listen`, con backoff; tras 10 s sin respuesta, el proceso sirve con la ubicación `unavailable` y sigue intentando en segundo plano (`dropped.noGeneration`) | falla cerrada, sin bloquear el juego (§3.3.2) |
| `presence_activate` | inmediatamente después de `listen`; reintento ante falla de transporte (idempotente); `newer_active`, `host_expired` o `host_inactive` → `stop` y salida | §3.3.2 |
| `presence_renew` | cada 5 s; lease de 15 s; timeout de 3 s | un fallo de renovación no detiene al host: la seguridad no depende del lease |
| `host_inactive` / `host_expired` / `unknown_host` en claims o guardados | pausa y renovación; **sin reintentos infinitos** (máximo de intentos y luego drenaje o `unavailable`) | §3.3.4 |

---

## 5. Códigos de cierre: auditoría de 4001 y decisión

### 5.1 Lo reservado en Colyseus 0.18 (FACT, `@colyseus/shared-types` `Protocol.mjs` y `core`)

| Código | Nombre | Quién lo emite |
|---|---|---|
| 1000 / 1001 / 1005 / 1006 | WebSocket estándar | transporte (1006: caída de red) |
| 4000 | `CONSENTED` | salida voluntaria; `Room.disconnect()` por defecto |
| **4001** | **`SERVER_SHUTDOWN`** | `Room.onBeforeShutdown()` por defecto y `matchMaker.gracefullyShutdown()` en producción |
| 4002 | `WITH_ERROR` | excepción en `onLeave` o en mensajes |
| 4003 | `FAILED_TO_RECONNECT` | reconexión rechazada |
| 4010 | `MAY_TRY_RECONNECT` | modo dev y recarga en caliente |
| 4217 | `ErrorCode.INVALID_PAYLOAD` | error de matchmaking |
| (app) 4001 | `session-replaced` | `locationJoin.replace()` y `fence()` en `4d0ab64` |
| (app) 4210 | capacidad | `ServerError` en `onJoin` |

**Colisión (FACT, LOCATION-3B §4):** un apagado ordenado cierra a todos con 4001. El cliente (`colyseusPresence.ts`, `REPLACED_SESSION_CODE = 4001`, desde `47678af`) lo interpreta como «reemplazado»: se detiene y no reconecta. **Todo deploy o reinicio deja a los jugadores varados** con un mensaje falso. Es **preexistente** a WORLD LOCATION.

### 5.2 Decisión

| Código | Significado | Cliente nuevo (`presenceProtocol` 3) | Cliente anterior (≤ 2) |
|---|---|---|---|
| **4409 `session-replaced`** (nuevo, app) | reemplazo **autoritativo**: otra pestaña abierta por el jugador en este host, o `superseded`/`stale` porque otra sesión tiene una clave mayor. También como `ServerError` del join cuando un `resume` cede ante otra pestaña viva | se detiene y muestra «otra pestaña o dispositivo» con «Jugar acá» | no lo recibe: a los clientes ≤ 2 el servidor les sigue enviando **4001** para el reemplazo, que es lo que entienden, y nunca les aplica `resume` (no lo declaran) |
| **4503 `host-draining`** (nuevo, app) | apagado, deploy o drenaje (también como `ServerError` del join en un host que drena) | reconexión `resume` inmediata (backoff reiniciado) | **reconecta** (≠ 4001): **corrige también a los clientes anteriores**, como join fresco |
| 4001 | — | **caída o reinicio → reconexión `resume`**, si el servidor anunció protocolo 3 (eco en el snapshot): a un cliente de protocolo 3 el servidor nuevo nunca le envía 4001, así que solo puede venir de Colyseus. Si no lo anunció (servidor viejo, por ejemplo tras un rollback), 4001 es ambiguo: **una** reconexión `resume` si el socket cerrado vivió ≥ 30 s y no hubo otro 4001 en los últimos 60 s; si no, se trata como reemplazo y se muestra «Jugar acá». Como mucho un rebote por minuto: sin bucles | reemplazo, como hoy |
| 4000 | salida voluntaria | sin reconexión (la inició el cliente) | igual |
| 1006 / 4002 / 4003 / 4010 | red o error | reconexión `resume` | reconexión (join fresco, como hoy) |

**Joins con `resume`.** Todo join automático del cliente nuevo (reconexión por red, error o drenaje) envía `resume: { tabId }`. Solo el join inicial de la página, un recargar o «Jugar acá» van sin `resume`.

El servidor:

- guarda el `tabId` de cada sesión en `client.userData`;
- ante un `resume`, si la sesión viva del usuario en ese host es **de otra pestaña**, rechaza el join con 4409;
- si es de la misma pestaña (su socket viejo todavía no detectado como caído), la reemplaza como hoy.

**Mejora sobre hoy:** un corte de red en la pestaña vieja ya no le quita la partida a la nueva.

**Límite:** si la otra pestaña está muerta pero su socket aún no expiró en el servidor, el `resume` cede y el jugador pulsa «Jugar acá». Es una UX aceptable y no hay pérdida de datos.

Además, **antes** de cerrar el servidor envía un mensaje `presence:closing { reason: 'replaced' | 'draining' }`. La razón no depende solo del código. Los clientes anteriores ignoran mensajes desconocidos.

- **Cómo deja de emitirse 4001 en un apagado:** `PresenceRoom.onBeforeShutdown()` se sobrescribe para drenar (§6) y desconectar con 4503. Así `matchMaker.gracefullyShutdown()` ya no encuentra clientes a los que cerrar con 4001. Un test lo afirma.
- **Versión de protocolo: sí, hay que subirla.** `presenceProtocol` pasa de 2 a 3 (lo declara el cliente) y la revisión del servidor de 5 a 6 (`/version`). El servidor elige el código de reemplazo según el protocolo declarado y hace eco de `presenceProtocol` en el snapshot, para que el cliente nuevo sepa cómo leer un 4001.
- **Compatibilidad (C5):**
  - **4001 recibido durante una caída o un reinicio → reconectar** (con `resume`; para un servidor sin eco rige la regla acotada de la tabla);
  - **4409 → sesión reemplazada: se detiene** y muestra «Jugar acá»;
  - **4503 → host drenando: reconectar con `resume`**;
  - **clientes anteriores (≤ 2), de forma segura:** reciben 4001 solo como reemplazo (se detienen) y 4503 en apagados y drenajes (reconectan con un join fresco). Como no envían `resume`, en un deploy con dos pestañas viejas la que reconecta puede desplazar a la otra, que recibe 4001 y se detiene: es el comportamiento preexistente, sin bucles.
- **Ningún caso produce un bucle de dos pestañas:** solo el reemplazo detiene, y solo el apagado, el drenaje o la red reconectan.

### 5.3 Tests (en la implementación)

1. **Apagado** (cliente nuevo y anterior): reconectan y **nunca** se emite 4001.
2. **Pérdida de red** (1006): reconecta.
3. **Reemplazo en el mismo host:** nuevo → 4409 y se detiene; anterior → 4001 y se detiene.
4. **Reemplazo por `superseded` o `stale`** en `on`: igual que 3.
5. **Salida voluntaria** (4000): no reconecta.
6. **Join rechazado por drenaje:** reconecta.
7. **Cliente nuevo + servidor viejo:** 4001 → se detiene.
8. **`presence:closing` antes del cierre:** tiene prioridad sobre el código.
9. **Bucle:** dos pestañas con cliente anterior contra el servidor nuevo terminan con una sola pestaña jugando y ninguna reconexión automática.
10. **`resume`:**
    - (a) con otra pestaña viva en el host → `ServerError` 4409 y se detiene;
    - (b) misma pestaña (socket viejo no detectado) → la reemplaza;
    - (c) sin otra pestaña → entra normal;
    - (d) corte de red en la pestaña vieja con la nueva viva → la vieja cede;
    - (e) recargar o «Jugar acá» (sin `resume`) → desplaza a la otra pestaña.
11. **Integración obligatoria (C5): 4503 no se convierte en 4001 en el apagado.**
    - Montaje: proceso real del realtime + clientes `@colyseus/sdk` reales, con varios clientes conectados y uno uniéndose durante el apagado.
    - Se dispara el apagado ordenado (SIGTERM, o `process.emit` como en el arnés de 3B).
    - `PresenceRoom.onBeforeShutdown` cierra con `this.disconnect(4503)`; `matchMaker.gracefullyShutdown` corre después.
    - Se afirma que **todos** los clientes conectados observan **4503 y ninguno 4001**, que el join durante el apagado recibe `ServerError` 4503, y que el log de Colyseus no registra cierres `SERVER_SHUTDOWN`.
    - Corre por dos caminos: `server.listen(port)` y el de `@colyseus/tools` (`COLYSEUS_CLOUD=1`, socket Unix, en Linux o CI).
    - **Control negativo:** con el override deshabilitado, el mismo test debe ver 4001 y fallar.

### 5.4 Corrección menor: el log de apagado

**FACT:** `flushAll` suma a `sent` las filas **enviadas**, incluidas las que vuelven `stale`, y el log dice «1 saved» aunque la base las rechazó.

**Corrección:** `#send` devuelve `{ rows, applied, duplicate, stale }`; `flushAll` devuelve `{ applied, stale, left, timedOut }`; el log queda «N guardadas, M rechazadas (otra sesión ya reclamó), K sin guardar (plazo vencido)».

---

## 6. Ventana del guardado final

### 6.1 Lo observado (FACT, LOCATION-3B §4, `evidence/3b-shutdown.log`)

| Escenario | Guardado final de P | Q restauró | Resultado |
|---|---|---|---|
| Apagado de P, reconexión a Q en 0 / 200 / 1000 ms, hosted normal | `applied` (enviado ≈ 0,45 s tras el pedido de apagado) | la última posición | sin pérdida |
| Ídem en 0 ms, guardado final demorado +800 ms | `stale` (Q reclamó primero) | el checkpoint anterior | **se pierden los últimos pasos** |
| Ídem en 500 ms, +2000 ms | `stale` | el checkpoint anterior | ídem |
| Hosted más lento que el plazo (3 s) | sale a los 3,0 s; la escritura en tránsito aterriza 2,4 s después de morir el proceso (`applied`, CAS válido) | — | el log dice «not saved» aunque se guardó |

**Por qué hoy existe la ventana:** `index.js` guarda en `onShutdown`, que Colyseus ejecuta **después** de desconectar a los clientes. Un cliente que reconecta rápido puede llegar a Q antes de que aterrice el guardado final de P.

### 6.2 Decisión

- **Apagado, deploy y drenaje: guardar y transferir antes de completar el reemplazo.** El drenaje (§3.3) se hace en `gameServer.onBeforeShutdown`, que Colyseus ejecuta **antes** de `matchMaker.gracefullyShutdown()`:
  1. el host pasa a `draining`: rechaza joins y congela el movimiento (los intentos de mover se rechazan y reciben `presence:self`);
  2. `flushAll` (plazo de 3 s);
  3. `PresenceRoom.onBeforeShutdown` envía `presence:closing` y cierra con 4503.

  **Garantía causal:** el commit del guardado ocurre antes del cierre, el cierre antes de la reconexión y la reconexión antes del claim en Q. Así Q **siempre** lee la posición final si el guardado terminó dentro del plazo. Si no terminó, el guardado tardío solo puede aplicarse antes del claim de Q; después es `stale` (Lema 3) y se cuenta y registra como «rechazada».
- **Takeover en vivo entre hosts** (solo posible en la ventana de drenaje, o con dos pestañas en hosts distintos): **se acepta como semántica de takeover**. La sesión nueva parte de la **última posición confirmada** (como mucho, el intervalo de checkpoint de 10 a 12 s, o el último portal). Transferir la posición en memoria entre hosts exigiría un canal entre hosts, y el único caso relevante (el deploy) ya queda cubierto por guardar antes de desconectar.
- **Mismo host:** sin pérdida. La sesión nueva **reutiliza el actor vivo** (FACT, F2 de LOCATION-3B `joinDuringSave`).
- **«Una instancia vieja nunca escribe después de perder autoridad»:** está garantizado por el CAS de epoch (Lema 3), no por el tiempo. Un guardado en tránsito que llega después del takeover es `stale`, siempre (FACT: `cas=ok` en todas las corridas de LOCATION-3B).

---

## 7. Diseño para la implementación

### 7.1 Modelo de estado

**Host (fila en `world_presence_hosts` + proceso):** `starting → active → draining → stopped`, monótono, sin retrocesos (§3.3.1).

- `starting`: tiene generación, pero no acepta jugadores (el `onJoin` espera la activación hasta 2 s), no reclama, no guarda y no cuenta en `newerActive`.
- `active`: acepta, reclama y guarda; renueva cada 5 s (lease de 15 s).
- `draining`: rechaza joins (4503), congela el movimiento, hace el flush final de sus filas propias dentro de la ventana fijada por `drain` y cierra con 4503. **Nunca** vuelve a `active`.
- `stopped`: terminal.
- **Sin generación** (hosted inalcanzable al arrancar): la ubicación queda `unavailable`; las sesiones no persisten.

**Sesión (journal):** `accepted(K, sessionId, tabId) → claiming → owner(epoch) → { closed | superseded | fenced }`.

- `unpersisted` es terminal y no escribe. Ocurre sin generación, con `unknown_user`, con `host_inactive`, o al agotar los reintentos tras `host_expired`.
- `superseded` y `fenced` son terminales: nunca vuelven a reclamar. En `on` se cierran con 4409 (o 4001 si el cliente es ≤ 2).

**Pestaña (cliente):** `fresh-join → playing → { replaced (overlay «Jugar acá», se detiene) | lost (reconecta con resume) | draining (reconecta con resume, inmediato) }`. Solo se sale de `replaced` por una acción del jugador («Jugar acá» o recargar).

**Fila de ubicación:** `(epoch, seq, location, owner_generation, owner_seq, owner_session)`. El orden de `(owner_generation, owner_seq)` es lexicográfico.

### 7.2 Invariantes

| Id | Invariante | Dónde se garantiza |
|---|---|---|
| I1 | `(owner_generation, owner_seq)` de una fila nunca decrece | SQL (`WHERE (og, os) < (p_g, p_n)`) |
| I2 | una sesión con clave menor que la del dueño nunca toma la fila (no reimposición: T3/T4/T7) | SQL + clave fija en la aceptación |
| I3 | un solo escritor: un guardado se aplica solo con el epoch vigente | SQL (sin cambios) |
| I4 | en un host, la aceptación posterior tiene la clave mayor | `onJoin` síncrono hasta asignar `n` |
| I5 | un host que conoce uno más nuevo y activo no acepta jugadores | realtime (drenaje) |
| I6 | ningún cliente reconecta solo después de un reemplazo autoritativo | cliente (4409, o 4001 sin eco) |
| I7 | un apagado ordenado nunca emite el código de reemplazo | `PresenceRoom.onBeforeShutdown` |
| I8 | ningún valor del cliente participa en la clave ni en el orden | realtime (la clave es de servidor) |
| I9 | ningún reloj de máquina se compara; los leases usan `now()` de la base | SQL |
| I10 | en un drenaje, el guardado se intenta antes de cerrar cualquier socket | `onBeforeShutdown` |
| I11 | en shadow nadie se desconecta por ubicación; solo se cuenta (`wouldFence`, `wouldReplace`, `wouldDrain`) | realtime |
| I12 | una reconexión automática (`resume`) nunca desplaza a una sesión viva de otra pestaña; solo una acción del jugador desplaza | realtime (join `resume`) + cliente |
| I13 | el orden en el host `n` se asigna en la parte síncrona de `onJoin` (después de la espera de activación y antes de cualquier otro `await`) | realtime |
| I14 | un host `starting` no reclama, no guarda y no provoca drenajes (`newerActive` solo cuenta `active` con lease) | SQL (H1, H4) |
| I15 | estados del host monótonos; `draining` nunca vuelve a `active`; `stopped` es terminal | SQL (`WHERE state = <esperado>`; H2) |
| I16 | `acquire` y `activate` son idempotentes por `hostId`: misma generación y mismo estado | SQL (H3) |
| I17 | claims solo desde `active` con lease vigente; guardados desde `active` con lease, o desde `draining` con lease sobre filas propias | SQL (H4) |
| I18 | la activación solo ocurre desde `starting`, con lease vigente, sin un host más nuevo activo, serializada | SQL (`LOCK TABLE`; H5) |
| I19 | la topología de §3.5 (caso 1) está verificada antes de `on` | compuerta manual |
| I20 | ningún cliente conectado recibe 4001 en un apagado ordenado del servidor nuevo | `PresenceRoom.onBeforeShutdown` + test C11 |

### 7.3 Secuencias de mensajes

**Join normal (un host):**

```
cliente → H.onJoin: n := ++H.accepted; K := (g_H, n); sessionId := uuid()   (síncrono)
H → world-authority: location_claim {userId, generation: g_H, seq: n, sessionId, hostId}
world-authority → SQL world_location_claim_keyed(...) → claimed {epoch, location}
H: owner(epoch); en `on` restaura desde location (hidratación ≤ 1,5 s)
```

**Reemplazo en el mismo host:** B entra con `n_B > n_A` → `replace(A)`: `presence:closing{replaced}` + 4409 (o 4001 para clientes ≤ 2). Se reutiliza el actor vivo. El claim de B toma la fila. Un claim tardío de A da `superseded`.

**T7 con la propuesta** (A en P con `g = 1`, B en Q con `g = 2`):

```
A: claim (1, a) ───────────────(latencia 822 ms)──────────────► SQL: (1,a) vs K*
B: claim (2, b) ──► SQL: (2,b) > K* → claimed e+1 (B dueña)
A llega: (1,a) < (2,b) → superseded{newerActive} (definitivo; A no relee)
   shadow: wouldReplace++ ; on: A se cierra con 4409 (se detiene: hay una pestaña más nueva)
   y P, que ahora sabe que Q está activo, drena el resto de sus sesiones (resume)
```

Si A llega primero: A toma `e+1` y después B toma `e+2` (`(2,b) > (1,a)`). Final: B.

**Respuesta perdida:**

```
A: claim (1,a) → SQL claimed e+1 → (la respuesta se pierde) → timeout 4 s → reintento claim (1,a)
SQL: K* = (1,a) y owner_session = A → claimed e+1 (adopción, sin incremento)
```

**Deploy:**

```
Q arranca: presence_acquire → (g_Q > g_P, starting) → define + world.start → listen (ready a PM2)
   → presence_activate → active (ahora sí cuenta en newerActive); antes de eso P no se entera de nada
P: SIGTERM (o renew/claim → newerActive) → draining: rechaza joins (4503), congela, flushAll
   → presence:closing{draining} + cierre 4503 → clientes reconectan con resume{tabId}
Q.onJoin(resume): ¿hay otra pestaña viva del usuario en Q? no → n := ++Q.accepted → claim (g_Q, n) > (g_P, *) → claimed
                                                           sí → ServerError 4409 (cede; «otra pestaña»)
   → el claim de Q lee la posición que P acaba de guardar
P: presence_stop → stopped
```

**Dos pestañas durante un deploy** (A en P, la vieja; B ya en Q): P drena → A reconecta con `resume` → en Q está B viva → A cede (4409). Gana B, la más nueva (Lema 5). Sin `resume`, A' habría entrado como aceptación nueva y le habría quitado la partida a B; el modelo encontró ese contraejemplo en una iteración anterior del diseño.

**Pestaña nueva en el host viejo** (B abierta en P antes de que P sepa de Q, con A viva en Q): la excepción acotada de §3.4. P se entera (por el `newerActive` de un claim, de un guardado o de la renovación) → drena → B reconecta con `resume` y cede ante A. B usa «Jugar acá» si quiere recuperar la partida.

### 7.4 Esquema SQL propuesto (migración nueva; **no se aplica en esta fase**)

```sql
-- 2026100Xxxxxxx_world_location_ordering.sql (propuesta, revisión 1)

-- ── Hosts: secuencia, tabla y permisos explícitos ───────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.world_presence_generation_seq AS bigint MINVALUE 1 NO CYCLE;

CREATE TABLE IF NOT EXISTS public.world_presence_hosts (
  generation       bigint      PRIMARY KEY DEFAULT nextval('public.world_presence_generation_seq'),
  host_id          uuid        NOT NULL UNIQUE,          -- aleatorio por arranque, generado por el realtime
  state            text        NOT NULL DEFAULT 'starting'
                               CHECK (state IN ('starting', 'active', 'draining', 'stopped')),
  lease_expires_at timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  activated_at     timestamptz NULL,                      -- diagnóstico
  draining_at      timestamptz NULL,
  stopped_at       timestamptz NULL
);
ALTER SEQUENCE public.world_presence_generation_seq OWNED BY public.world_presence_hosts.generation;
ALTER TABLE public.world_presence_hosts ENABLE ROW LEVEL SECURITY; -- sin políticas: ningún cliente

-- No se depende de los privilegios por defecto de Supabase (que en el esquema public conceden
-- ALL sobre tablas, secuencias y funciones a anon, authenticated y service_role, y EXECUTE de
-- funciones a PUBLIC): se revoca TODO y se concede lo mínimo.
REVOKE ALL ON TABLE    public.world_presence_hosts          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.world_presence_generation_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.world_presence_hosts TO service_role;  -- sin DELETE ni TRUNCATE
GRANT USAGE ON SEQUENCE public.world_presence_generation_seq TO service_role;      -- nextval (y currval); sin SELECT ni UPDATE (setval)

-- ── Dueño por clave en la fila de ubicación ──────────────────────────────────
ALTER TABLE public.world_player_locations
  ADD COLUMN IF NOT EXISTS owner_generation bigint NOT NULL DEFAULT 0 CHECK (owner_generation >= 0),
  ADD COLUMN IF NOT EXISTS owner_seq        bigint NOT NULL DEFAULT 0 CHECK (owner_seq >= 0),
  ADD COLUMN IF NOT EXISTS owner_session    uuid   NULL;
-- (los permisos de world_player_locations no cambian: SELECT, INSERT, UPDATE solo para service_role)

-- ── Ciclo de vida ─────────────────────────────────────────────────────────────
-- acquire: crea el host en 'starting'. Idempotente por host_id: el reintento devuelve la MISMA
-- generación y el estado actual; nunca modifica una fila existente.
CREATE OR REPLACE FUNCTION public.world_presence_acquire(p_host_id uuid, p_lease_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.world_presence_hosts;
BEGIN
  IF p_host_id IS NULL OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN
    RAISE EXCEPTION 'invalid_acquire';
  END IF;
  INSERT INTO public.world_presence_hosts (host_id, lease_expires_at)
  VALUES (p_host_id, now() + make_interval(secs => p_lease_ms / 1000.0))
  ON CONFLICT (host_id) DO NOTHING;
  SELECT * INTO v FROM public.world_presence_hosts WHERE host_id = p_host_id;
  RETURN jsonb_build_object('generation', v.generation, 'state', v.state);
END $$;

-- activate: starting → active, explícita y atómica. Serializada: dos candidatos no se activan a
-- la vez, y nadie se activa si hay un host MÁS NUEVO activo con lease vigente.
-- LOCK … SHARE ROW EXCLUSIVE requiere UPDATE (lo tiene service_role) y no bloquea los FOR SHARE
-- de los claims.
CREATE OR REPLACE FUNCTION public.world_presence_activate(p_generation bigint, p_host_id uuid, p_lease_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.world_presence_hosts;
BEGIN
  IF p_generation IS NULL OR p_generation < 1 OR p_host_id IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN
    RAISE EXCEPTION 'invalid_activate';
  END IF;
  LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'active' THEN RETURN jsonb_build_object('status', 'active'); END IF;          -- reintento
  IF v.state <> 'starting' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', v.state); END IF;
  IF v.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  IF EXISTS (SELECT 1 FROM public.world_presence_hosts h
              WHERE h.generation > p_generation AND h.state = 'active' AND h.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('status', 'newer_active');
  END IF;
  UPDATE public.world_presence_hosts
     SET state = 'active', activated_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
   WHERE generation = p_generation AND state = 'starting';
  RETURN jsonb_build_object('status', 'active');
END $$;

-- renew: NUNCA cambia el estado. starting y active extienden; un active vencido solo revive si no
-- hay uno más nuevo activo; draining no se extiende (su ventana la fija drain); stopped no responde.
CREATE OR REPLACE FUNCTION public.world_presence_renew(p_generation bigint, p_host_id uuid, p_lease_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.world_presence_hosts; v_newer boolean;
BEGIN
  IF p_generation IS NULL OR p_host_id IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN RAISE EXCEPTION 'invalid_renew'; END IF;
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'stopped' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', 'stopped'); END IF;
  IF v.state = 'starting' AND v.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', 'starting'); END IF;
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts h
                      WHERE h.generation > p_generation AND h.state = 'active' AND h.lease_expires_at > now());
  IF v.state = 'starting' OR (v.state = 'active' AND NOT (v.lease_expires_at <= now() AND v_newer)) THEN
    UPDATE public.world_presence_hosts SET lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
     WHERE generation = p_generation AND state = v.state;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'state', v.state, 'newerActive', v_newer);
END $$;

-- drain: active → draining (ventana de flush fija), starting → stopped; idempotente.
CREATE OR REPLACE FUNCTION public.world_presence_drain(p_generation bigint, p_host_id uuid, p_drain_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.world_presence_hosts;
BEGIN
  IF p_generation IS NULL OR p_host_id IS NULL OR p_drain_ms NOT BETWEEN 1000 AND 60000 THEN RAISE EXCEPTION 'invalid_drain'; END IF;
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'active' THEN
    UPDATE public.world_presence_hosts
       SET state = 'draining', draining_at = now(), lease_expires_at = now() + make_interval(secs => p_drain_ms / 1000.0)
     WHERE generation = p_generation AND state = 'active';
    RETURN jsonb_build_object('status', 'ok', 'state', 'draining');
  ELSIF v.state = 'starting' THEN
    UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now() WHERE generation = p_generation AND state = 'starting';
    RETURN jsonb_build_object('status', 'ok', 'state', 'stopped');
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN v.state = 'stopped' THEN 'host_inactive' ELSE 'ok' END, 'state', v.state);
END $$;

-- stop: cualquier estado → stopped (terminal); idempotente.
CREATE OR REPLACE FUNCTION public.world_presence_stop(p_generation bigint, p_host_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = coalesce(stopped_at, now())
   WHERE generation = p_generation AND host_id = p_host_id AND state <> 'stopped';
  RETURN jsonb_build_object('status', 'ok');
END $$;

-- ── Claim con clave: exige host active, lease vigente e identidad exacta ─────
CREATE OR REPLACE FUNCTION public.world_location_claim_keyed(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE h public.world_presence_hosts; v_row public.world_player_locations; v_took boolean; v_newer boolean;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_host_id IS NULL OR p_generation IS NULL OR p_generation < 1 OR p_seq IS NULL OR p_seq < 1 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  -- FOR SHARE: un drain/stop concurrente espera a que este claim termine (o el claim ve el estado nuevo).
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  BEGIN
    INSERT INTO public.world_player_locations (user_id, owner_generation, owner_seq, owner_session)
    VALUES (p_user_id, p_generation, p_seq, p_session)
    ON CONFLICT (user_id) DO UPDATE
       SET epoch = world_player_locations.epoch + 1, seq = 0, updated_at = now(),
           owner_generation = EXCLUDED.owner_generation, owner_seq = EXCLUDED.owner_seq, owner_session = EXCLUDED.owner_session
     WHERE (world_player_locations.owner_generation, world_player_locations.owner_seq) < (EXCLUDED.owner_generation, EXCLUDED.owner_seq)
    RETURNING * INTO v_row;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END;
  v_took := FOUND; -- antes de cualquier otra sentencia
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                      WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  IF NOT v_took THEN
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id;
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF; -- bug del llamador
      -- adopción: misma clave y misma sesión → claimed con el epoch vigente, sin incremento
    ELSE
      RETURN jsonb_build_object('status', 'superseded', 'newerActive', v_newer);
    END IF;
  END IF;
  RETURN jsonb_build_object('status', 'claimed', 'epoch', v_row.epoch, 'newerActive', v_newer,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END);
END $$;

-- ── Guardado con clave: regla por estado + CAS de epoch y dueño ──────────────
-- Mismas validaciones de forma por fila que world_location_save v1 (se omiten aquí: se reutiliza
-- su cuerpo). Cambian la cabecera y la condición del UPDATE.
CREATE OR REPLACE FUNCTION public.world_location_save_keyed(p_rows jsonb, p_generation bigint, p_host_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE h public.world_presence_hosts; v_newer boolean; /* … variables de v1 … */
BEGIN
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state IN ('starting', 'stopped') THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', h.state); END IF;
  -- h.state ∈ {active, draining} con lease vigente. Para ambos, cada fila se aplica solo si:
  --   UPDATE … WHERE user_id = v_user AND epoch = v_epoch AND seq < v_seq AND owner_generation = p_generation
  -- En 'draining' la condición de dueño es la que restringe el flush a sus filas propias; en 'active'
  -- es defensa en profundidad (el epoch ya identifica al dueño). Resultado por fila: applied |
  -- duplicate (mismo epoch y dueño, seq <=) | stale | invalid, como en v1.
  /* … cuerpo de v1 con esa condición … */
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                      WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  RETURN jsonb_build_object('status', 'ok', 'results', /* … */ NULL, 'newerActive', v_newer);
END $$;

-- ── v1 (realtime 4d0ab64): solo filas sin dueño por clave ────────────────────
--   world_location_claim(uuid, bigint): … WHERE user_id = p_user_id AND epoch = p_expected_epoch AND owner_generation = 0
--   world_location_save(jsonb):         … AND owner_generation = 0
-- Con dueño por clave, v1 responde 'conflict' o 'stale': el realtime viejo no persiste (falla cerrada).
-- Una migración posterior las elimina cuando los logs del Edge no muestren llamadas v1.

-- ── Permisos de funciones: explícitos ───────────────────────────────────────
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.world_presence_acquire(uuid, integer)',
    'public.world_presence_activate(bigint, uuid, integer)',
    'public.world_presence_renew(bigint, uuid, integer)',
    'public.world_presence_drain(bigint, uuid, integer)',
    'public.world_presence_stop(bigint, uuid)',
    'public.world_location_claim_keyed(uuid, bigint, bigint, uuid, uuid)',
    'public.world_location_save_keyed(jsonb, bigint, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;
```

#### 7.4.1 Permisos: decisiones y pruebas (C3)

- **`SECURITY INVOKER` se mantiene.** Las funciones corren con los privilegios de `service_role`, que tiene exactamente lo necesario:
  - tabla de hosts: `SELECT, INSERT, UPDATE` (`UPDATE` también habilita `FOR SHARE`/`FOR UPDATE` y el `LOCK … SHARE ROW EXCLUSIVE`);
  - fila de ubicación: `SELECT, INSERT, UPDATE`, sin cambios;
  - secuencia: **`USAGE`**, el permiso exacto para `nextval`, usado por el `DEFAULT` en el `INSERT` de `acquire`;
  - `EXECUTE` de las 7 funciones.
- **Nada para `PUBLIC`, `anon` ni `authenticated`:** ni tabla, ni secuencia, ni funciones.
- **`SECURITY DEFINER` se descarta:** no hace falta escalar privilegios, y aumentaría el radio de daño de cualquier bug. Si algún día se justificara: owner fijo (`ALTER FUNCTION … OWNER TO postgres`), `SET search_path = pg_catalog, public` con nombres calificados, `REVOKE EXECUTE … FROM PUBLIC` y una prueba que verifique `prosecdef` y `proowner`.
- **Sin poda en la base:** sin `DELETE` para nadie. Las filas `stopped` son una por arranque y la poda queda como mantenimiento manual documentado (§7.8).

**Pruebas PGlite reales (Q7):**

1. **Preparación:** los stubs de Supabase (`supabaseStubs.sql`) se extienden con `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role`. Hoy solo emulan tablas y funciones; esta línea reproduce el comportamiento real de Supabase. Así la migración prueba que **sus `REVOKE`** cierran todo, sin depender de los valores por defecto.
2. **Como `service_role`** (`asRole`): `acquire`, `activate`, `renew`, `drain`, `stop`, `claim_keyed` y `save_keyed` funcionan, incluido el `nextval` implícito de `acquire` y el `LOCK` de `activate`.
3. **Como `anon`, `authenticated` y un rol nuevo sin grants** (que solo hereda `PUBLIC`):
   - `SELECT`, `INSERT` y `UPDATE` sobre `world_presence_hosts` → 42501;
   - `nextval`, `currval`, `setval` y `SELECT last_value` sobre la secuencia → 42501;
   - `EXECUTE` de cada una de las 7 RPC → 42501.
4. **Catálogo** (extensión de `scripts/world-location/location-grants-check.sql`, cero filas = cerrado):
   - `has_table_privilege`, `has_sequence_privilege(…, 'USAGE' | 'SELECT' | 'UPDATE')` y `has_function_privilege` en falso para `anon` y `authenticated`;
   - `service_role` exactamente `SELECT/INSERT/UPDATE` + `USAGE` + `EXECUTE`, sin `DELETE` ni `TRUNCATE`;
   - ninguna función `prosecdef`.
5. **Mutaciones:** quitar cada `REVOKE` o `GRANT` de la migración por separado hace fallar al menos una de las pruebas 2–4.

### 7.5 Contrato de `world-authority` (v5, aditivo)

Todas las operaciones siguen con `x-world-authority-secret` comparado en tiempo constante, sin gate WORLD×SKILLS y con errores sin filtrar detalles de la base. Los enteros se validan como seguros (≤ 2^53 − 1) y los UUID como UUID. Un body con campos de la forma vieja y de la nueva a la vez es 400.

| Op | Request | Response 200 |
|---|---|---|
| `presence_acquire` | `{hostId, leaseMs: 1000..120000}` | `{generation, state}` (idempotente por `hostId`) |
| `presence_activate` | `{generation, hostId, leaseMs}` | `{status: 'active' \| 'newer_active' \| 'host_expired' \| 'host_inactive' \| 'unknown_host', state?}` |
| `presence_renew` | `{generation, hostId, leaseMs}` | `{status: 'ok', state, newerActive}` \| `{status: 'host_expired' \| 'host_inactive' \| 'unknown_host', state?}` |
| `presence_drain` | `{generation, hostId, drainMs: 1000..60000}` | `{status: 'ok' \| 'host_inactive' \| 'unknown_host', state}` |
| `presence_stop` | `{generation, hostId}` | `{status: 'ok'}` |
| `location_claim` (con clave) | `{userId, generation, seq ≥ 1, sessionId, hostId}` | `{claim: {status: 'claimed', epoch, location, newerActive} \| {status: 'superseded', newerActive} \| {status: 'host_inactive', state} \| {status: 'host_expired'} \| {status: 'unknown_host'} \| {status: 'unknown_user'}}` |
| `location_save` (con clave) | `{rows, generation, hostId}` | `{status: 'ok', results, newerActive}` \| `{status: 'host_inactive', state}` \| `{status: 'host_expired', state}` \| `{status: 'unknown_host'}` |
| `location_claim` / `location_save` (forma v4) | como en v4 | como en v4, con la guarda `owner_generation = 0`; se retiran con v1 |

### 7.6 Compatibilidad, migración y matriz de pruebas

**Fases, cada una con su propia autorización:**

0. Este documento (revisión 1). Revisión.
1. Implementación en una rama (commits de §7.7), con gates locales, el arnés de dos procesos contra PGlite y los modelos en CI.
2. **Verificación de topología en Colyseus Cloud (§3.5).** Es bloqueante. Puede hacerse en paralelo con la fase 1, pero **antes** de cualquier paso que lleve a `on`.
3. Migración SQL en hosted (aditiva; v1 sigue funcionando para el realtime viejo sobre filas sin dueño por clave).
4. Deploy de `world-authority` v5 (aditivo).
5. Integración y **reinicio conjunto** del entorno oscuro, realtime + cliente (`presenceProtocol` 3), todavía en `shadow`.
6. Recalificación en shadow: T3/T4/T7 con el arnés, T7 natural contra hosted, el caso invertido, el ciclo de vida de hosts (candidato que falla o es lento), apagado (C11) y benchmark.
7. Migración que retira v1.
8. Decisión sobre `on`, **solo** con la fase 2 resuelta en el caso 1.

**Mezcla de versiones:**

- El realtime viejo (v1) solo toca filas con `owner_generation = 0`.
- El realtime nuevo siempre gana sobre ellas.
- Un realtime nuevo sin generación (hosted caído al arrancar) no escribe.
- La producción pública (0.2) no usa ubicación y no se ve afectada.

**Matriz de pruebas:**

| Id | Capa | Caso | Esperado |
|---|---|---|---|
| M1 | modelo de orden (`ordering-model.mjs`, CI) | T3/T7, T4, mismo proceso, caso invertido, **más los protocolos alternativos como controles negativos** | propuesta 0/0 en R1/R2 en T3/T7, T4 y mismo proceso; caso invertido solo dentro de la ventana (§3.4); `actual`, `ticket`, `rebaseUnico` y `reloj` desfasado > 0 (los controles muestran que el test no es vacuo) |
| **M2** | **modelo de ciclo de vida** (`host-lifecycle-model.mjs`, CI) | S1–S7 × propuesta + 11 mutantes | propuesta 0 violaciones; **los 11 mutantes detectados**; el proceso sale con código ≠ 0 si la propuesta viola algo |
| Q1 | SQL (PGlite, migración real) | claim con clave mayor, igual (adopción) y menor (`superseded`); `newerActive` con y sin host más nuevo; `key_reused`; `unknown_user` | según §7.4 |
| Q2 | SQL | v1 sobre una fila con dueño por clave | `conflict` o `stale`, sin escribir |
| **Q3** | **SQL: matriz estado × operación** | estados `starting`, `active`, `active` vencido, `draining`, `draining` vencido, `stopped` y desconocido × `claim`, `save` de fila propia, `save` de fila ajena con el epoch vigente adivinado, `activate`, `renew`, `drain`, `stop` | exactamente la tabla de §3.3.4 y las transiciones de §3.3.1. Ninguna transición prohibida |
| **Q4** | **SQL: ciclo de vida** | `acquire` repetido (misma generación y mismo estado, sin tocar el lease); `activate` repetido; `activate` con lease de arranque vencido; `activate` con un host más nuevo activo; `renew` de un `draining` no extiende; `renew` de un `active` vencido con o sin uno más nuevo | según §3.3.1 |
| **Q5** | **SQL: mutaciones** (como `scripts/world-location/mutations.mjs`) | quitar cada guarda: estado, lease, identidad, dueño en `draining`, `LOCK`, idempotencia de `acquire`, «no extender `draining`» | cada mutación hace fallar al menos un test de Q1–Q4 |
| Q6 | SQL en el stack Supabase local (Postgres real, dos conexiones) | dos `activate` concurrentes; `claim` contra un `drain` concurrente; `acquire` concurrente con el mismo `hostId` | nunca dos activaciones con el menor después del mayor activo; el claim ve `active` y termina antes del drain, o ve `draining` y responde `host_inactive`; una sola generación por `hostId` |
| **Q7** | **permisos PGlite** (§7.4.1) | `service_role` puede; `anon`, `authenticated` y `PUBLIC` no pueden leer la tabla, usar la secuencia ni ejecutar las RPC; catálogo en cero filas; mutaciones de los `REVOKE`/`GRANT` | 42501 en todo lo prohibido |
| E1 | Edge (Deno) | validación de cada op; todos los estados de respuesta; formas mezcladas → 400; sin fugas; secreto obligatorio | |
| J1 | journal (unidad) | sin re-base; `superseded` definitivo; reintento de transporte con la misma clave; adopción; reacciones a `host_inactive`, `host_expired` y `unknown_host` **sin reintentos infinitos** (máximo de intentos y pausa) | §3.3.4 |
| J2 | journal (unidad) | T3, T4 y T7 con dos journals sobre un almacén CAS compartido | B dueña en todas |
| H1 | host (realtime) | `acquire` antes de `listen`; activación después de `listen`; `onJoin` espera la activación hasta 2 s y si no, 4503; `newer_active` en la activación → `stop` y salida; `newerActive` en régimen → drenaje; sin generación → `unavailable` | §3.3.2 |
| D1 | drenaje | join rechazado (4503); movimiento congelado; flush antes de cerrar (solo filas propias); cierre 4503 | el claim del host nuevo lee la posición final |
| D2 | join `resume` | otra pestaña viva → 4409; misma pestaña → la reemplaza; ninguna → entra | I12 |
| C1–C10 | cliente | §5.3 | |
| **C11** | **integración obligatoria (C5)** | §5.3, punto 11 | todos los clientes ven **4503**, ninguno 4001; un mutante sin el override ve 4001 y el test falla |
| L1 | log | flush con un `stale` | «0 guardadas, 1 rechazada» |
| A1 | arnés de dos procesos | T3, T4 y T7 (latencia muestreada, ≥ 200 repeticiones) | en todas: dueña final = la sesión del host vigente; `cas=ok` |
| A2 | arnés | dos pestañas durante un deploy; pestaña nueva en el host viejo dentro y fuera de la ventana | §3.4 |
| A3 | arnés | apagado, reinicio, desconexión durante un guardado, respuesta tardía; **candidato que falla durante el arranque**; **candidato lento** | sin pérdida con reconexión inmediata; el vigente no se ve afectado por un candidato que no llegó a `active` |
| A4 | arnés | mismo proceso (las 10 intercalaciones de 3B §2) | 41/41 |
| S1 | shadow en el entorno oscuro contra hosted (compuerta manual) | T7 sin inyección, T3, T4 y benchmark | como A1 |
| **T1** | **topología en Colyseus Cloud (compuerta manual bloqueante)** | los 5 puntos de §3.5 | caso 1 documentado; si no, `BLOCKED` |

**Criterio de aceptación de T3/T4/T7:** el test A1 (y S1) **falla** con el journal de `4d0ab64` y **pasa** con la propuesta en el 100 % de las repeticiones.

### 7.7 Plan en commits pequeños (implementación futura; nada de esto en esta rama)

Es un cambio multicapa (AGENTS §17). Cada commit es atribuible y revisable por separado. La verificación de topología (T1) **no es un commit**: es una compuerta que se documenta en el commit 11.

1. `test(supabase-stubs)`: privilegios por defecto de Supabase para secuencias en `supabaseStubs.sql`. Solo infraestructura de test.
2. `sql(location)`: migración (hosts con su ciclo de vida, permisos explícitos, claim y save con clave, guardas v1) + script de rollback + tests PGlite Q1–Q4 y Q7 + runner de mutaciones Q5. No se aplica.
3. `sql(location)`: tests de concurrencia Q6 en el stack Supabase local.
4. `edge(world-authority)`: ops `presence_*`, claim y save con clave, todos los estados; tests E1.
5. `realtime(host)`: servicio de ciclo de vida (`acquire` antes de `listen`, `activate` después, `renew`, `drain`, `stop`, espera en `onJoin`, alarma de topología); tests H1.
6. `realtime(location)`: claim y save con clave en el journal (sin re-base ni cadena), reacciones a `host_*` acotadas, timeout de claim de 4 s; tests J1 y J2.
7. `realtime(presence)`: drenaje, join `resume` con `tabId`, 4409/4503 según protocolo, override de `onBeforeShutdown`, `presence:closing`, revisión 6; tests D1, D2 y **C11**.
8. `realtime(location)`: conteos del log de apagado (L1).
9. `client(presence)`: `presenceProtocol` 3, `tabId` y `resume`, interpretación de códigos (incluida la regla del 4001 ambiguo), overlay con «Jugar acá»; tests C1–C10.
10. `scripts(world-location)`: arnés de dos procesos con proxy de fallas (A1–A4) y modo benchmark; incluye los modelos M1 y M2 en CI.
11. `docs`: informe de resultados y evidencia de la verificación de topología en Cloud (T1).

### 7.8 Riesgos y rollback

| Riesgo | Mitigación |
|---|---|
| **Cloud ejecuta varios workers WORLD permanentes (caso 2 de §3.5)** | **bloqueante**: sin `on`. Se rediseña la propiedad (generación por deployment + coordinador o sharding) y se resuelve la partición del mundo |
| Cloud sigue ruteando al host que drena | el cliente reintenta con backoff de hasta 10 s; nunca hay pérdida de autoridad. Se verifica en T1 |
| Bucle de reinicios por `newer_active` (síntoma de topología inesperada) | salida con código 0 y alarma si hay más de 3 por hora; además lo cubre T1 |
| Candidato colgado en el arranque | su lease de arranque vence; nunca se activa; el vigente no se ve afectado (M2: S1 y S2) |
| Hosted caído al arrancar | ubicación `unavailable`, el juego sigue y `acquire` se reintenta en segundo plano |
| Hosted caído en régimen (`host_expired`) | pausa sin reintentos infinitos; si no revive en 2 leases, drena y se detiene (§3.3.4) |
| Hosted caído durante el drenaje | el flush vence con el plazo o la ventana; las escrituras tardías son `stale` o `applied` según el CAS (nunca un escritor doble) |
| Contención del `LOCK` de activación | solo `activate` lo toma (una vez por arranque); no bloquea claims (`FOR SHARE`) |
| Saltos del reloj de la base | solo afectan la duración de los leases (disponibilidad), no la seguridad |
| Privilegios por defecto de Supabase reabren algo | `REVOKE ALL` explícito más Q7 con los defaults emulados y sus mutaciones |
| Regresión en clientes por los códigos | matriz C1–C11 y compatibilidad cruzada (§5.2) |
| Pestaña nueva abierta en el host viejo durante la ventana (§3.4) | acotada a ≤ R + RTT; estable; «Jugar acá» |
| Otra pestaña muerta con socket aún no expirado | el `resume` cede; «Jugar acá»; sin pérdida |
| Crecimiento de `world_presence_hosts` | una fila por arranque; poda manual de filas `stopped` de más de 30 días (sin `DELETE` para `service_role`) |

**Rollback:**

- `WORLD_LOCATION_PERSISTENCE=off`: no hay `acquire` ni llamadas de ubicación, y el arranque queda como hoy.
- Volver a desplegar `world-authority` v4: las ops nuevas dan 400, el realtime nuevo queda con la ubicación `unavailable` y falla cerrada.
- El script SQL de rollback elimina las funciones nuevas, las columnas, la tabla y la secuencia, y restaura los cuerpos de v1. Los datos son descartables.
- Los códigos de cierre se revierten con el cliente (el cliente viejo funciona con el servidor nuevo, §5.2).

### 7.9 Decisión explícita sobre 4001

- **Se deja de usar 4001 para el reemplazo con clientes de protocolo 3.** El reemplazo autoritativo usa **4409 `session-replaced`**, precedido de `presence:closing{replaced}`.
- **El servidor deja de emitir 4001 en apagados y drenajes:** usa **4503 `host-draining`** mediante `PresenceRoom.onBeforeShutdown`. Así reconectan también los clientes anteriores.
- **4001 se conserva solo** como código de reemplazo hacia clientes con `presenceProtocol` ≤ 2, mientras existan.
- **Se sube `presenceProtocol` a 3** y la revisión del servidor a 6.
- **Prueba obligatoria:** C11 (§5.3, punto 11). Después de cerrar con 4503, Colyseus no lo sustituye por 4001 durante el apagado, y hay un control negativo.

---

## 8. Preguntas abiertas

1. **Colyseus Cloud (BLOQUEANTE, §3.5):** cantidad de procesos WORLD, escalado horizontal, ruteo durante un deploy, señal y plazo de apagado, y un id de deployment confiable. Hace falta una app de Cloud para el build oscuro (pendiente desde INTEGRATION-1).
2. **Fila de `terremototw`:** quedó en el epoch 242, en Ciudad 14,41, tras LOCATION-3B. Se ajusta deliberadamente antes de habilitar la restauración real. No se toca en esta fase.

Resueltas en esta revisión: el texto y la ubicación de «Jugar acá» (§3.6).

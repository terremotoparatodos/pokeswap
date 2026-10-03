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
| Migración | tabla de hosts, 3 columnas, 4 funciones, Edge v5, realtime y cliente (códigos de cierre). Ver §7.3 a §7.5 |
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

### 3.3 Host vigente y drenaje

- **Generación:** cada proceso realtime obtiene su generación `g` de la base **antes de aceptar jugadores**, junto con un lease (`now()` de la base + 15 s), y lo renueva cada 5 s. La renovación responde `newerActive`: si existe un host de generación mayor con lease vivo.
- **Drenaje:** un host que se entera de que hay uno vigente más nuevo (`newerActive` en una renovación, un claim o un guardado) **drena**:
  1. rechaza nuevos joins con «reconectar»;
  2. congela el movimiento;
  3. guarda todas las posiciones pendientes;
  4. cierra cada socket con **4503 `host-draining`**.

  Los clientes reconectan con `resume: {tabId}`; el ruteo los lleva al host vigente.
- **Join `resume` en el host vigente:**
  - si hay una sesión viva del mismo usuario **de otra pestaña** (otro `tabId`), el join se rechaza con `ServerError(4409, 'session-replaced')`: el cliente muestra «otra pestaña» y se detiene;
  - si es la misma pestaña (su propio socket viejo) o no hay ninguna, es una aceptación normal con clave mayor.
- **Respuesta del claim con `newerActive`:** el claim también informa si existe un host más nuevo activo, para que el host viejo se entere en su primera interacción con la base y no recién en la siguiente renovación. Eso acorta la ventana de la excepción.
- **Reanudación:** si un host ve que su generación no es la mayor **pero** ningún host más nuevo tiene lease vivo (el nuevo murió), toma una **generación nueva** y vuelve a aceptar. Ninguna sesión vieja recupera nada: las aceptaciones nuevas son las que ganan.
- **OPEN QUESTION (ciclo de vida de Colyseus Cloud):** que durante un deploy las conexiones nuevas se ruteen al proceso nuevo, y que no haya dos procesos de presencia activos fuera de un traspaso. Si Cloud siguiera ruteando al host que drena, el cliente reintentaría con backoff (máximo 10 s) hasta que ese host termine. Es un costo acotado y nunca hay pérdida de autoridad. Queda como verificación de Cloud.

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
| `presence_acquire` al arrancar | reintento con backoff; hasta obtener `g`, la ubicación queda `unavailable` (no se reclama nada; se cuenta `dropped.noGeneration`). El mundo sigue funcionando | falla cerrada, sin bloquear el juego |
| `presence_renew` | cada 5 s; lease de 15 s; timeout de 3 s | renovar falla → el host sigue sirviendo: la seguridad no depende del lease |

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
| 4001 | — | si el servidor anunció protocolo 3 (eco en el snapshot), es un apagado de Colyseus no interceptado → reconexión. Si no lo anunció (servidor viejo), es reemplazo → se detiene | reemplazo, como hoy |
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
- **Compatibilidad cruzada:**
  - cliente nuevo con servidor viejo: 4001 sin eco → reemplazo (seguro, sin bucles);
  - cliente viejo con servidor nuevo: reemplazo con 4001 y apagado con 4503 (reconecta).
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

**Host (realtime):** `starting → active ⇄ draining → stopped`.

- `starting`: sin generación; la ubicación queda `unavailable`; el juego sigue.
- `active`: tiene `g` y renueva cada 5 s.
- `draining`: conoce un host más nuevo, o recibió SIGTERM. Rechaza joins con 4503, congela el movimiento, guarda y cierra con 4503.
- Reanudación `draining → active` (con una **generación nueva**) solo si ningún host más nuevo tiene lease vivo y el proceso no está apagándose.

**Sesión (journal):** `accepted(K, sessionId, tabId) → claiming → owner(epoch) → { closed | superseded | fenced }`.

- `unpersisted` (sin generación al aceptar, o `unknown_user`) es terminal y no escribe.
- `superseded` y `fenced` son terminales: nunca vuelven a reclamar. En `on` se cierran con 4409 (o 4001 si el cliente es ≤ 2).

**Pestaña (cliente):** `fresh-join → playing → { replaced (se detiene) | lost (reconecta con resume) | draining (reconecta con resume, inmediato) }`. `replaced` solo sale por acción del jugador («Jugar acá» o recargar).

**Fila:** `(epoch, seq, location, owner_generation, owner_seq, owner_session)`. El orden de `(owner_generation, owner_seq)` es lexicográfico.

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
| I13 | el orden en el host `n` se asigna en `onJoin`, antes de cualquier `await` | realtime |

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
Q arranca: presence_acquire → g_Q = g_P + 1; Q acepta conexiones nuevas
P: SIGTERM (o renew/claim → newerActive) → draining: rechaza joins (4503), congela, flushAll
   → presence:closing{draining} + cierre 4503 → clientes reconectan con resume{tabId}
Q.onJoin(resume): ¿hay otra pestaña viva del usuario en Q? no → n := ++Q.accepted → claim (g_Q, n) > (g_P, *) → claimed
                                                           sí → ServerError 4409 (cede; «otra pestaña»)
   → el claim de Q lee la posición que P acaba de guardar
P: presence_release → stopped
```

**Dos pestañas durante un deploy** (A en P, la vieja; B ya en Q): P drena → A reconecta con `resume` → en Q está B viva → A cede (4409). Gana B, la más nueva (Lema 5). Sin `resume`, A' habría entrado como aceptación nueva y le habría quitado la partida a B; el modelo encontró ese contraejemplo en una iteración anterior del diseño.

**Pestaña nueva en el host viejo** (B abierta en P antes de que P sepa de Q, con A viva en Q): la excepción acotada de §3.4. P se entera (por el `newerActive` de un claim, de un guardado o de la renovación) → drena → B reconecta con `resume` y cede ante A. B usa «Jugar acá» si quiere recuperar la partida.

### 7.4 Esquema SQL propuesto (migración nueva; **no se aplica en esta fase**)

```sql
-- 2026100Xxxxxxx_world_location_ordering.sql (propuesta)

CREATE SEQUENCE IF NOT EXISTS public.world_presence_generation_seq;

CREATE TABLE IF NOT EXISTS public.world_presence_hosts (
  generation       bigint      PRIMARY KEY DEFAULT nextval('public.world_presence_generation_seq'),
  host_id          uuid        NOT NULL UNIQUE,          -- aleatorio por arranque, generado por el realtime
  state            text        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'draining', 'stopped')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL
);
ALTER TABLE public.world_presence_hosts ENABLE ROW LEVEL SECURITY; -- sin políticas
REVOKE ALL ON TABLE public.world_presence_hosts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.world_presence_hosts TO service_role;

ALTER TABLE public.world_player_locations
  ADD COLUMN IF NOT EXISTS owner_generation bigint NOT NULL DEFAULT 0 CHECK (owner_generation >= 0),
  ADD COLUMN IF NOT EXISTS owner_seq        bigint NOT NULL DEFAULT 0 CHECK (owner_seq >= 0),
  ADD COLUMN IF NOT EXISTS owner_session    uuid   NULL;

-- Generación de un proceso. Idempotente por host_id: el reintento de una respuesta perdida
-- devuelve la MISMA generación. Poda hosts 'stopped' de más de 7 días.
CREATE OR REPLACE FUNCTION public.world_presence_acquire(p_host_id uuid, p_lease_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_row public.world_presence_hosts;
BEGIN
  IF p_host_id IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN RAISE EXCEPTION 'invalid_acquire'; END IF;
  INSERT INTO public.world_presence_hosts (host_id, lease_expires_at)
  VALUES (p_host_id, now() + make_interval(secs => p_lease_ms / 1000.0))
  ON CONFLICT (host_id) DO UPDATE SET lease_expires_at = EXCLUDED.lease_expires_at
  RETURNING * INTO v_row;
  DELETE FROM public.world_presence_hosts WHERE state = 'stopped' AND started_at < now() - interval '7 days';
  RETURN jsonb_build_object('generation', v_row.generation);
END $$;

-- Renovación: extiende el lease y dice si existe un host MÁS NUEVO activo y vivo.
CREATE OR REPLACE FUNCTION public.world_presence_renew(p_generation bigint, p_host_id uuid, p_lease_ms integer, p_state text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_found boolean;
BEGIN
  IF p_state NOT IN ('active', 'draining', 'stopped') OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN RAISE EXCEPTION 'invalid_renew'; END IF;
  UPDATE public.world_presence_hosts
     SET lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0), state = p_state
   WHERE generation = p_generation AND host_id = p_host_id AND state <> 'stopped'
  RETURNING true INTO v_found;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  RETURN jsonb_build_object('status', 'ok', 'newerActive', EXISTS (
    SELECT 1 FROM public.world_presence_hosts
     WHERE generation > p_generation AND state = 'active' AND lease_expires_at > now()));
END $$;

-- Claim con clave. Atómico en una sentencia; el primero de dos concurrentes con la misma
-- clave toma la fila y el segundo adopta. Sin re-base: 'superseded' es definitivo.
CREATE OR REPLACE FUNCTION public.world_location_claim_keyed(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_row public.world_player_locations; v_newer boolean; v_took boolean;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_generation IS NULL OR p_generation < 1 OR p_seq IS NULL OR p_seq < 1 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  -- La generación debe ser de ese host (defensa en profundidad; el llamador ya tiene el secreto).
  IF NOT EXISTS (SELECT 1 FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id) THEN
    RETURN jsonb_build_object('status', 'unknown_host');
  END IF;
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
  -- ¿Hay un host más nuevo activo? (el host viejo se entera en su primer claim, no en la próxima renovación)
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts
                      WHERE generation > p_generation AND state = 'active' AND lease_expires_at > now());
  IF NOT v_took THEN
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id;
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF; -- bug del llamador
      NULL; -- adopción: misma clave y misma sesión → claimed con el epoch vigente, sin incremento
    ELSE
      RETURN jsonb_build_object('status', 'superseded', 'newerActive', v_newer);
    END IF;
  END IF;
  RETURN jsonb_build_object('status', 'claimed', 'epoch', v_row.epoch, 'newerActive', v_newer,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END);
END $$;

-- v1 (realtime 4d0ab64) deja de poder tomar filas con dueño por clave:
--   WHERE user_id = p_user_id AND epoch = p_expected_epoch AND owner_generation = 0
-- (con dueño por clave, v1 siempre responde 'conflict': el realtime viejo no persiste, falla cerrada).
-- Una migración posterior la elimina cuando los logs del Edge no muestren llamadas v1.

-- world_location_save: sin cambios en la regla CAS. Recibe opcionalmente la generación del
-- escritor (nivel lote) y devuelve además 'newerActive' (un EXISTS por lote), para que el host
-- viejo se entere también al guardar.

REVOKE ALL ON FUNCTION public.world_presence_acquire(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_presence_renew(bigint, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_location_claim_keyed(uuid, bigint, bigint, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.world_presence_acquire(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_renew(bigint, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed(uuid, bigint, bigint, uuid, uuid) TO service_role;
```

Notas:

- **Concurrencia del claim:** `INSERT … ON CONFLICT DO UPDATE … WHERE` toma un lock de fila. Dos claims concurrentes se serializan y el segundo evalúa el `WHERE` contra la fila ya actualizada (mismo argumento que B2 de WORLD LOCATION-2).
- **Guardado con `newerActive`:** el escritor manda su generación en un campo de nivel lote, `generation` (no por fila). La respuesta agrega `newerActive` una sola vez por lote.
- **Rollback:** `rollback_world_location_ordering.sql` elimina las funciones nuevas, las columnas y la tabla, y restaura el cuerpo de v1. Los datos son descartables.

### 7.5 Contrato de `world-authority` (v5, aditivo)

Todas las operaciones siguen con `x-world-authority-secret` comparado en tiempo constante, sin gate WORLD×SKILLS (una ubicación no es un valor) y con errores sin filtrar detalles de la base.

| Op | Request | Response 200 | 400 si |
|---|---|---|---|
| `presence_acquire` | `{hostId: uuid, leaseMs: 1000..120000}` | `{generation}` | `hostId` o `leaseMs` inválidos |
| `presence_renew` | `{generation: int ≥ 1, hostId, leaseMs, state: 'active'\|'draining'\|'stopped'}` | `{status: 'ok', newerActive: bool}` \| `{status: 'unknown_host'}` | campos inválidos |
| `location_claim` (forma nueva) | `{userId, generation, seq: int ≥ 1, sessionId: uuid, hostId}` | `{claim: {status: 'claimed', epoch, location, newerActive} \| {status: 'superseded', newerActive} \| {status: 'unknown_user'} \| {status: 'unknown_host'}}` | cualquier campo inválido; **no** se mezclan campos de la forma vieja y la nueva |
| `location_claim` (forma vieja) | `{userId, expectedEpoch}` | igual que v4 | se mantiene hasta retirar v1 |
| `location_save` | `{rows, generation?}` | `{results}`, y `newerActive` (uno por lote) cuando hay `generation` | igual que v4 |

Los enteros se validan como seguros (≤ 2^53 − 1) y se pasan a SQL como `bigint`.

### 7.6 Compatibilidad, migración y matriz de pruebas

**Fases, cada una con su propia autorización:**

0. Este documento. Revisión.
1. Implementación en una rama (commits de §7.7), con gates locales y el arnés de dos procesos contra PGlite.
2. Migración SQL en hosted (aditiva; v1 sigue funcionando para el realtime viejo).
3. Deploy de `world-authority` v5 (aditivo).
4. Integración y **reinicio conjunto** del entorno oscuro, realtime + cliente (`presenceProtocol` 3), todavía en `shadow`.
5. Recalificación en shadow: T3/T4/T7 con el arnés, T7 natural contra hosted, el caso invertido, apagado y benchmark. Se espera PASS.
6. Migración que retira v1, cuando los logs del Edge no muestren llamadas v1.
7. Decisión sobre `on`, después de verificar en Cloud el ruteo durante un deploy.

**Mezcla de versiones:**

- El realtime viejo (v1) **no puede** tomar filas con dueño por clave (guarda en SQL).
- El realtime nuevo **siempre** gana sobre filas tomadas por v1, porque `owner_generation = 0` es menor que cualquier generación.
- La producción pública (0.2, `be360fd`) no usa ubicación y no se ve afectada.

**Matriz de pruebas:**

| Id | Capa | Caso | Esperado |
|---|---|---|---|
| M1 | modelo (`ordering-model.mjs`, CI) | T3/T7, T4, mismo proceso, caso invertido | propuesta 0/0 en R1/R2 en T3/T7, T4 y mismo proceso; caso invertido solo dentro de la ventana (§3.4); `actual` > 0 (no vacuo) |
| Q1 | SQL (PGlite, migración real) | claim con clave mayor, igual (adopción), menor (`superseded`); `newerActive` con y sin host más nuevo vivo; `key_reused`; `unknown_user`; `unknown_host` | según §7.4 |
| Q2 | SQL | dos conexiones concurrentes con claves distintas: el final es la clave mayor; con la misma clave: un `claimed` y una adopción | sin epochs huérfanos de la misma sesión |
| Q3 | SQL | v1 sobre una fila con dueño por clave | `conflict`, sin escribir |
| Q4 | SQL | acquire idempotente; renew con `newerActive`; poda | |
| E1 | Edge (Deno) | validación de cada op; formas mezcladas → 400; sin fugas de errores; el secreto es obligatorio | |
| J1 | journal (unidad) | sin re-base; `superseded` definitivo; reintento por transporte con la misma clave; adopción; sin generación → `unpersisted` | |
| J2 | journal (unidad) | **T3, T4, T7 con dos journals** sobre un almacén CAS compartido y latencias programadas | B dueña al final en todas; A sin `claimed` después de B |
| H1 | host | acquire antes de aceptar; renew; `newerActive` → drenaje; reanudación con generación nueva | |
| D1 | drenaje | join rechazado (4503); movimiento congelado; flush antes de cerrar; cierre 4503 | el claim del host nuevo lee la posición final |
| D2 | join `resume` | otra pestaña viva → 4409; misma pestaña → reemplaza; ninguna → entra | I12 |
| C1–C10 | cliente | §5.3 (incluye `resume`) | |
| L1 | log | flush con un `stale` | «0 guardadas, 1 rechazada» |
| **A1** | **arnés de dos procesos** (PGlite + proxy de fallas) | **T3** (ronda vieja demorada 800 ms), **T4** (retenida → abandonada → reintento), **T7** (latencia muestreada del benchmark, ≥ 200 repeticiones con gaps de 50 a 500 ms) | en **todas**: dueña final = la sesión del host vigente; ninguna `claimed` de A después de la confirmación de B; `stale` solo para A; `cas=ok` |
| A2 | arnés | **dos pestañas durante un deploy** (A en P, B en Q; P drena en distintos momentos) y **pestaña nueva en el host viejo** dentro y fuera de la ventana | deploy: gana B siempre; host viejo: fuera de la ventana gana la nueva; dentro, cede de forma estable (excepción §3.4) |
| A3 | arnés | apagado, reinicio, desconexión durante un guardado, respuesta tardía (LOCATION-3B §4) | idem 3B, más **sin pérdida** con reconexión inmediata (flush antes del cierre) |
| A4 | arnés | mismo proceso (las 10 intercalaciones de LOCATION-3B §2) | 41/41 |
| **S1** | **shadow en el entorno oscuro contra hosted** (compuerta manual) | **T7 sin inyección**, T3, T4, benchmark | como A1; `wouldFence` / `wouldReplace` solo en la instancia vieja |

**Criterio de aceptación de T3/T4/T7:** el test A1 (y S1) **falla** con el journal de `4d0ab64` y **pasa** con la propuesta en el 100 % de las repeticiones. No se acepta ninguna tasa menor.

### 7.7 Plan en commits pequeños (implementación futura; nada de esto en esta rama)

Es un cambio multicapa (AGENTS §17). Cada commit es atribuible y revisable por separado.

1. `sql(location)`: migración de orden + script de rollback + tests PGlite Q1–Q4 (no se aplica).
2. `edge(world-authority)`: ops `presence_*`, `location_claim` con clave, `newerActive` en claim y guardado, tests E1.
3. `realtime(location)`: servicio de host (acquire, renew, estado) + tests H1.
4. `realtime(location)`: claim con clave en el journal, sin re-base ni cadena; adaptadores Edge y PGlite; timeout del claim de 4 s; tests J1 y J2.
5. `realtime(presence)`: drenaje (rechazo de joins, congelamiento, flush en `onBeforeShutdown`, `presence:closing`, 4409/4503 según protocolo), join `resume` con `tabId`; `/version` revisión 6; tests D1 y D2.
6. `realtime(location)`: conteos del log de apagado (L1).
7. `client(presence)`: `presenceProtocol` 3, `tabId` por carga de página, `resume` en toda reconexión automática, interpretación de códigos, eco en el snapshot, botón «Jugar acá»; tests C1–C10.
8. `scripts(world-location)`: arnés de dos procesos con proxy de fallas (A1–A4) y modo benchmark contra el stack.
9. `docs`: informe de resultados.

### 7.8 Riesgos y rollback

| Riesgo | Mitigación |
|---|---|
| Colyseus Cloud sigue ruteando al host que drena (OPEN QUESTION) | el cliente reintenta con backoff de hasta 10 s; nunca pierde autoridad. Verificar en Cloud antes de `on` |
| Dos hosts activos por error de configuración | el mundo ya estaría partido (precondición). La clave sigue garantizando un solo escritor; el más nuevo gana y el viejo drena |
| Hosted caído al arrancar | ubicación `unavailable` y el juego sigue (falla cerrada) |
| Hosted caído durante el drenaje | el flush vence a los 3 s; las escrituras tardías son `stale` o `applied` según el CAS (nunca un escritor doble) |
| Saltos del reloj de la base | solo afectan la duración de los leases (liveness), no la seguridad |
| Regresión en clientes por los códigos | matriz C1–C10 y compatibilidad cruzada (§5.2) |
| Pestaña nueva abierta en el host viejo durante la ventana (§3.4) | acotada a ≤ R + RTT por `newerActive` en claims, guardados y renovaciones; estable; «Jugar acá» |
| Otra pestaña muerta con socket aún no expirado | el `resume` cede; «Jugar acá»; sin pérdida |
| Crecimiento de `world_presence_hosts` | una fila por arranque, con poda a 7 días |

**Rollback:**

- `WORLD_LOCATION_PERSISTENCE=off` deja de hacer llamadas de ubicación.
- Volver a desplegar `world-authority` v4: el realtime nuevo recibe 400 en las ops nuevas, la ubicación queda `unavailable` y falla cerrada.
- El script SQL de rollback elimina lo nuevo.
- Los códigos de cierre se revierten con el cliente (el cliente viejo funciona con el servidor nuevo, §5.2).

### 7.9 Decisión explícita sobre 4001

- **Se deja de usar 4001 para el reemplazo con clientes de protocolo 3.** El reemplazo autoritativo usa **4409 `session-replaced`**, precedido de `presence:closing{replaced}`.
- **El servidor deja de emitir 4001 en apagados y drenajes:** usa **4503 `host-draining`** mediante `PresenceRoom.onBeforeShutdown`. Así reconectan también los clientes anteriores.
- **4001 se conserva solo** como código de reemplazo hacia clientes con `presenceProtocol` ≤ 2, mientras existan.
- **Se sube `presenceProtocol` a 3** y la revisión del servidor a 6.

---

## 8. Preguntas abiertas

1. **Colyseus Cloud** (antes de `on`): ruteo de conexiones nuevas durante un deploy, orden entre SIGTERM y drenaje, y cuántos procesos de presencia corren en un plan.
2. **Botón «Jugar acá»:** texto y ubicación final (PRESENCE UX). El comportamiento (recargar = takeover) es el de §3.2.
3. **Fila de `terremototw`:** quedó en el epoch 242, en Ciudad 14,41, tras LOCATION-3B. Se ajusta deliberadamente antes de habilitar la restauración real (indicación del usuario). No se toca en esta fase.

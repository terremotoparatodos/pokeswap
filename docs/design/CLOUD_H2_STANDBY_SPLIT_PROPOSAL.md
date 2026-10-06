# CLOUD H2 — Propuesta: separar la promoción automática del standby de los demás beneficios de recovery

**Estado: propuesta, sin implementar.** No se cambió producto, SQL, flags, procesos ni entornos, ni se hizo merge o deploy. H2 sigue **bloqueando la integración**. Esta propuesta es una **contención acotada**: no es la solución del failover.

- **Rama:** `design/cloud-h2-standby-split-0.3`, desde `fix/cloud-candidate-h1-typecheck-0.3 @ ea1284e` (candidato con H1 y typecheck corregidos). Esa rama sigue congelada.
- **Insumo:** la investigación independiente `investigation/cloud-h2-0.3 @ 2bab8f7` (sin publicar en origin) y su paquete `H2_REPRODUCCION.zip`.
- **Convenciones:** **FACT** = código o prueba ejecutada aquí. **INFERENCE** = deducción. **OPEN QUESTION** = sin establecer. **CLOUD-NO-COMPROBADO** = comportamiento de la plataforma que nada de esto observó.

## 1. Referencias verificadas (FACT, 2026-10-06)

| Referencia | Commit | Dónde |
|---|---|---|
| `feat/cloud-readiness-3-0.3` | `5ca9ccdbdf349f830c10605e95abac69699ab048` | origin |
| `feat/cloud-join-order-2-0.3` | `886ff4d632c0f797ee83c39fbfb2ca0804f942e6` | origin |
| `fix/cloud-candidate-h1-typecheck-0.3` | `ea1284edf42b4e919f40e8801665f366636a171d` | origin |
| `investigation/cloud-h2-0.3` | `2bab8f7a7538f6b65f76e282f7bd5d4980b44367` | solo local; worktree de la investigación |

**El paquete de la investigación coincide con su commit:**
- `MANIFEST.sha256` verifica los 19 archivos.
- Los tres ejecutables del overlay (`PresenceRoomH2.test.js`, `h2-processes.mjs`, `h2-loopback.mjs`) son idénticos byte a byte (salvo CRLF) a los de `2bab8f7`.
- `2bab8f7` parte de `886ff4d` y **no** incluye H1 ni el arreglo de typecheck. Esa es la razón de revalidar aquí, sobre `ea1284e`.
- Antes de ejecutar los archivos se leyeron. Escuchan solo en `127.0.0.1` (preload), usan usuarios y credenciales sintéticos y matan solo a sus hijos.

## 2. Revalidación de H2 sobre el candidato corregido (`ea1284e`, Node 22.23.2)

Superpuse en este worktree los tres archivos ejecutables de `2bab8f7`, sin cambios. Las salidas están en `docs/design/cloud-h2-split/revalidation/`. Los scripts escriben `base: '886ff4d'` fijo, pero la base real de esta corrida es `ea1284e`.

### 2.1 Pruebas deterministas: `PresenceRoomH2.test.js` (FACT)

**10/10 en las tres corridas.** Son 12 mundos de PGlite, con sala, hosting, lifecycle, adaptador y SQL reales. Lo que se repite:

| Caso | Resultado |
|---|---|
| `on`, el standby promueve antes de que A renueve | A, vivo, cierra con **4503/draining**; un reintento fijo a A recibe 4503; una conexión directa a S coloca al jugador |
| `off` | Sin standby; A revive su misma identidad y conserva el socket |
| A renueva antes del probe | No hay promoción |
| Probe falso y renovación antes del activate | El activate exclusivo responde `other_active` |
| Escritor vencido | Su claim, su save y su drain dan `host_expired`, y la fila conserva la última posición confirmada |
| Stop terminal confirmado | Con recovery, S promueve; sin recovery, no queda ningún host elegible |
| Contraejemplo de gracia (1 s, 30 s, 120 s **lógicos**) | El cierre 4503 reaparece en los tres |
| `shadow` | Ver §2.3 |

**Diferencia con la corrida de la investigación (FACT):** en `ea1284e` la promoción vuelve a arrancar el journal (H1). Las pruebas lo detienen igual al construir cada proceso y no dependen de él. H1 **no cambia** H2: el desplazamiento del host vivo ocurre igual.

### 2.2 Procesos y sockets reales: `h2-processes.mjs` (FACT)

Se usan el entrypoint real, el handler v7 real y el SDK real. El lease vence de forma natural (15 s) al rechazar solo `presence_renew` de A. **3 escenarios PASS y 15/15 chequeos.** Los tiempos son relativos al arranque de la autoridad local y no constituyen un SLA.

| Escenario | Línea de tiempo (FACT) |
|---|---|
| **on, recovery on** | **5,7 s:** A gen 2 sirve al jugador; S gen 1 desplazado. **16,1 s:** el lease de A vence; el proceso A sigue vivo, en pausa, con `/readyz` 503 y el socket abierto; **S promueve a gen 3** sin tráfico. **27,7 s:** A vuelve a renovar, ve un host más nuevo, se drena, cierra el socket con **4503** y queda `stopped` con `/readyz` 503. Un reintento a A recibe 4503 y una conexión directa a S funciona |
| **on, recovery off** | Mismo vencimiento. **26,1 s:** A revive la gen 2 y vuelve a `/readyz` 200 **con el mismo socket**. S nunca promueve. Entre 16 s y 26 s A estuvo en pausa (joins 4503, `/readyz` 503) |
| **shadow, recovery on** | S en shadow quedó en standby porque su activación fue rechazada (`newer_active`). **23,2 s:** S **promueve a una gen 3 activa real**. A, en shadow, queda **en pausa sin lease vivo** pero con `/readyz` 200, admitiendo y sin cerrar nada |

### 2.3 Qué es evidencia local y qué es Cloud

**FACT local:**
- la carrera de autoridad;
- el cierre 4503 de un host vivo;
- que el reintento a una ruta fija falla;
- que un lease vencido no implica proceso muerto;
- que shadow puede promover de verdad.

**CLOUD-NO-COMPROBADO:**
- **Qué recibe las conexiones en cada momento.** Aquí la «ruta» es la elección explícita de A por parte del arnés: no hay NGINX, agente ni descubrimiento.
- **Si el agente lee `/readyz` fuera del deploy y si reinicia procesos vivos con 503.** La emulación de ROLLOUT-1 fue local.
- **Con qué frecuencia una pausa o un problema de red supera 15 s en Cloud.** Nada aquí mide eso.

## 3. Qué controla hoy `WORLD_PRESENCE_RECOVERY` (FACT, `ea1284e`)

| Beneficio | Dónde | ¿Depende del standby? |
|---|---|---|
| Claim v2: estado del dueño. `owner_draining` y `owner_unreachable` se pueden reintentar; un dueño `stopped`/`unknown` se toma (D2-B); el takeover solo es explícito («Jugar acá») | `recoveryCapability.js` `withRecovery`; SQL `claim_keyed_v2` | No |
| Mapa de cierres: 4503 `draining`/`owner-unreachable` en lugar del 4409 falso; un host desactualizado reintenta | `locationJoin.js:162-196` (`recovery()`) | No |
| Estado `held` en el cliente y «Jugar acá» con `takeover` | cliente (`closePolicy.ts`, controlador) | No (el cliente no conoce el flag) |
| Capacidad sondeada una vez, con fallback v1 ante `unsupported` | `recoveryCapability.js` | No |
| Apagado: detener una identidad en promoción, también directo a la autoridad | `presenceHosting.js` `beginShutdown`/`#abandon` | Solo protege al standby |
| **Standby: probe `any_active`, identidad nueva y activación exclusiva** | `presenceHosting.js:310-370` (`#startStandby`, `#probe`, `#promote`) | **Es el standby** |
| Claim v3 con reglas v2 (`p_recovery`) | JOIN-ORDER-2 | No |

**FACT de código:**
- El standby es el **único** que llama a `world_presence_any_active` y a `world_presence_activate_exclusive`.
- `#startStandby` solo exige `recovery.enabled` y que el apagado no haya empezado.
- `#stopped` llama a `#startStandby()` **antes** de mirar el modo, así que en `shadow` también arranca un standby real (`presenceHosting.js:387-396`).

## 4. Propuesta

### 4.1 Separar la promoción (P-A)

- **Interruptor propio** para la promoción automática, por ejemplo `WORLD_PRESENCE_STANDBY=on`, apagado por defecto. El nombre lo decidís vos (D-1).
- **Condición para iniciar el standby:** `recovery.enabled && standbyRequested && location().restores`.
- **Sin cambios en todo lo demás de recovery:** claim v2, mapa de cierres, `held`, capacidad y apagado.
- **Sin cambios en SQL, Edge ni cliente.**

**Cambio estimado** (INFERENCE, a confirmar al implementar):
- `recoveryCapability.js`: una función `standbyRequested(env)` de unas 3 líneas;
- `presenceHosting.js`: una opción de constructor y la guarda en `#startStandby`, unas 5 líneas;
- `PresenceRoom.js`: leer el entorno una vez y una función de prueba, unas 5 líneas;
- la métrica `hosting.standbyEnabled`;
- tests.

### 4.2 Shadow nunca promueve (P-B)

- La guarda `location().restores` de P-A ya lo cubre: en `shadow` no se inicia ningún standby, sea cual sea el flag.
- **Por qué es necesario aunque el standby esté pedido:** una promoción en shadow crea una fila `active` **real** con generación nueva (FACT §2.2). En una flota mixta, un host en `on` que la vea con `newerActive` **se drena** (INFERENCE desde `#hostChanged`). Shadow dejaría de ser solo observación.
- **Qué hace shadow después:** cuenta lo que haría el standby (`wouldStandby`) y no llama nunca al probe ni a la activación exclusiva.
- **Fuera de alcance:** que los procesos en shadow activen su propia fila de host de forma normal es diseño de LOCATION-4. Puede desplazar hosts en `on` en una flota mixta; queda como OPEN QUESTION (§7).

### 4.3 Qué conserva y qué pierde P-A

| | Con recovery on y standby off (propuesto) | Con recovery on y standby on (como `ea1284e`) |
|---|---|---|
| H2 por vencimiento del lease | **No ocurre por esta vía**: A revive su identidad al renovar, igual que en el control `off`, con el socket intacto (INFERENCE: el standby es el único que activa en exclusiva) | Ocurre (FACT §2) |
| D2-B (dueño detenido, sin 4409 falso) | Se conserva | Se conserva |
| Dueño inaccesible: 4503 y «Jugar acá» explícito | Se conserva | Se conserva |
| Host desactualizado: 4503 en lugar de 4409 (L1) | Se conserva | Se conserva |
| **D2-A: un proceso desplazado vuelve a ser host cuando no queda ninguno activo** | **Se pierde.** El desplazado queda vivo y detenido (`/readyz` 503, joins 4503) hasta que lo termine su deploy o supervisor, como en LOCATION-4 | Lo recupera solo, con identidad nueva |
| Tiempo sin host durante una pausa de A más larga que el lease | A está en pausa (4503) hasta su próxima renovación exitosa, y vuelve solo | S puede tomar el control, pero si A está vivo y enrutado el jugador queda afuera (H2) |

### 4.4 Quién recupera el servicio ante una caída real con standby off

- **Si el proceso termina** (crash, OOM, salida):
  - el supervisor (PM2 `autorestart`) arranca un proceso nuevo;
  - el proceso nuevo toma una generación nueva y se **activa de forma normal**, que no exige que no haya otro activo, solo que no haya uno **más nuevo**;
  - los jugadores reconectan con `resume` y reclaman con una clave mayor que la del dueño muerto, así que **toman la fila**;
  - esto no depende del standby (INFERENCE desde el código de LOCATION-4 y la migración de ordering).
  - CLOUD-NO-COMPROBADO: que Cloud reinicie y vuelva a enrutar al slot reiniciado; ROLLOUT-1 lo emuló en local.
  - Prueba de aceptación AT-4: `kill` real de A y reinicio por el arnés.
- **Si el proceso vive pero no puede renovar** (red o pausa): A vuelve solo cuando renueva (FACT, escenario `off`). No hay promoción en falso, pero tampoco servicio mientras dura la pausa.
- **Si el proceso vive, quedó desplazado y el host que lo desplazó desaparece** (el caso D2-A): **nadie lo recupera automáticamente.** Hace falta un reinicio del supervisor o del agente, o un deploy.
  - OPEN QUESTION / CLOUD-NO-COMPROBADO: ¿el agente reinicia un proceso vivo con `/readyz` 503 durante la operación normal? Si no lo hace, esta situación necesita intervención manual o una regla del agente.

### 4.5 Lo que esta propuesta no hace ni afirma

- **No usa ninguna gracia** como prueba de muerte. No alarga leases ni agrega reintentos o heartbeats como criterio.
- **No permite que un host ignore el fencing.** A sigue retirándose ante `newerActive`, y los claims y saves vencidos siguen rechazados (FACT §2.1, escritor vencido).
- **No resuelve el enrutamiento.** Resolver qué host tiene autoridad no implica que el host autorizado reciba a los jugadores. Con standby off sigue habiendo dos caminos para que un host **activo y no enrutado** desplace al enrutado (INFERENCE: ninguno pasa por el standby):
  1. un **candidato de deploy** que se activa antes de ser enrutado (D1/D3 de ROLLOUT-1);
  2. un host en `starting` cuyo lease venció y que toma una **identidad nueva** al recuperarse (`hostLifecycle.js` `#recover`).
- La solución de fondo sigue siendo un contrato entre el controlador de ruta y la autoridad, con fencing por época y verificación por el camino público, como recomienda la investigación. Queda fuera de alcance.

## 5. Compatibilidad y rollback

| Situación | Efecto |
|---|---|
| Entornos existentes (recovery apagado en todos) | Ninguno: el standby ya no arranca sin recovery |
| `WORLD_PRESENCE_RECOVERY=on` sin el flag nuevo | **Cambio respecto de `ea1284e`**: no hay standby. Ese comportamiento nunca se desplegó (READINESS-3 y JOIN-ORDER-2 están sin integrar) |
| `WORLD_PRESENCE_RECOVERY=on` + `WORLD_PRESENCE_STANDBY=on` | Exactamente lo de `ea1284e` (H2 incluido); solo como opción explícita |
| Solo `WORLD_PRESENCE_STANDBY=on` | Sin efecto: requiere recovery |
| `shadow` con cualquier combinación | Nunca hay standby ni activación exclusiva; solo cuenta |
| SQL, Edge y cliente | Sin cambios. Las funciones `any_active` y `activate_exclusive` quedan sin usar mientras el standby esté apagado |
| Rollback | Volver a `ea1284e`, o encender el flag nuevo. No hay datos que migrar |

## 6. Pruebas de aceptación propuestas

Todas deben fallar contra `ea1284e` donde corresponda, por una aserción pertinente (control negativo). Un timeout nunca cuenta como detección.

| # | Prueba | Contra `ea1284e` |
|---|---|---|
| AT-1 | La secuencia H2 de `PresenceRoomH2.test.js` y `h2-processes.mjs` (on) con recovery on y standby off: S nunca entra en standby ni llama a `any_active`/`activate_exclusive`; A renueva **la misma generación** y conserva el socket; `/readyz` vuelve a 200 | Falla (S promueve) |
| AT-2 | Con recovery on y standby on, la secuencia H2 sigue reproduciendo H2, documentado como opción explícita | Pasa igual |
| AT-3 | `shadow` con standby pedido: tras una activación rechazada no hay standby, hay 0 llamadas exclusivas y `wouldStandby` cuenta; ninguna fila `active` nueva | Falla (escenario shadow de §2.2) |
| AT-4 | Caída real con standby off: `SIGKILL` de A con un jugador, reinicio por el arnés (como PM2), generación nueva activa, `resume` del jugador **toma la fila** y restaura la última casilla confirmada | Pasa igual (no depende del standby) |
| AT-5 | D2-A con standby off: el desplazado queda `stopped`, `/readyz` 503 y nunca promueve, documentado como pérdida | Falla (hoy promueve) |
| AT-6 | Los beneficios conservados con standby off: los tests de READINESS-3 de D2-B, P1/P3, draining, dueño vivo y P2, sin cambios | Pasan igual |
| AT-7 | Los tests de standby de READINESS-3 (D2-A, cesión, SIGINT antes y durante la promoción, dos desplazados, SQL eliminado en standby) piden el flag explícitamente y siguen pasando | Requiere ajustar su configuración, no sus aserciones |
| AT-8 | H-1 (`PresenceRoomJournalLifecycle.test.js`) con standby on | Pasa igual |
| AT-9 | Lectura del entorno (`on` exacto; cualquier otro valor es off) y métrica `standbyEnabled` sin identificadores | Nuevo |
| Gates | Realtime completo en Node 22, typecheck, lint y `diff --check`. Batería SQL y Deno solo si cambian, y no deberían | |

## 7. Decisiones que requieren tu aprobación

| # | Decisión | Recomendación |
|---|---|---|
| D-1 | Separar la promoción con un flag propio (nombre, defecto apagado) **o** retirar el código de standby hasta tener un contrato de ruta | Flag apagado: conserva el código probado (H-1, SIGINT) sin activarlo. AGENTS.md §14 pide no mantener versiones «por las dudas»: si no hay plan de usarlo, retirarlo es la opción más limpia |
| D-2 | Aceptar perder D2-A automático y que, ante un desplazado sin host, se recupere por supervisor, agente o deploy | Aceptar, sujeto a la OPEN QUESTION de §4.4 sobre el agente |
| D-3 | Shadow nunca promueve (P-B), incluso con el standby pedido | Sí |
| D-4 | ¿Qué hace un proceso vivo y desplazado sin standby? Sigue vivo con 503, como LOCATION-4, sin salir solo (salir causaría el bucle de PM2 documentado en LOCATION-4) | Mantener |
| D-5 | Los dos caminos residuales de §4.5 (candidato de deploy activo no enrutado, `starting` vencido con identidad nueva): ¿bloquean la integración igual que H2, o se aceptan con la contención de ROLLOUT-1/STARTUP-1? | Tu decisión; no son de este cambio |
| D-6 | Dueño de la solución de fondo: contrato entre ruta y autoridad (plataforma y app) | Tu decisión |
| D-7 | ¿Implementar P-A y P-B en una rama nueva desde `ea1284e`, con las AT-1 a AT-9? | Pendiente de tu orden |
| D-8 | Shadow activa su propia fila de host de forma normal y puede desplazar hosts en `on` en una flota mixta (diseño de LOCATION-4) | Estudiarlo aparte; queda fuera de este alcance |

## 8. Entorno

- Worktree `pokeswap-h2split` desde `ea1284e`, con `node_modules` como junction a int1. No se debe correr `vite dev` ahí.
- Los tres archivos ejecutables de la investigación están copiados en la rama para poder reproducir; su fuente es `2bab8f7`.
- Se tocó solo el worktree propio. La investigación y su worktree quedaron intactos, y no hay procesos de la revalidación vivos: el arnés mata a sus hijos al terminar.

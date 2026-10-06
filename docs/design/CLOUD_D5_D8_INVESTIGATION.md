# CLOUD D5/D8 — Investigación y alcance mínimo para avanzar con seguridad

**Estado:** investigación documental con reproducciones locales aisladas. **No se implementó producto.** No se tocó Cloud, PM2, SQL hosted, flags, procesos ni entornos activos, y no hubo merge ni deploy. La contención de H2 aprobada (`640a4f3`) sigue congelada y no autoriza integrar ni activar nada.

**Ramas y referencias:**
- **Esta:** `design/cloud-d5-d8-0.3`, desde `640a4f3`, solo documental.
- **Lectura previa:** el dictamen de la revisión independiente `POKESWAP_H2_VALIDATION_REVIEW.md` (APPROVE para la contención) y los antecedentes CLOUD ROLLOUT-1, CLOUD STARTUP-1 y H2.
- **Trabajo del ecosistema:** no se duplica. La configuración de PM2 y del agente es del ecosistema y aquí solo se referencia.

**Convenciones:** **FACT-LOCAL** = prueba ejecutada aquí. **FACT-CÓDIGO** = lectura del código en `640a4f3`. **FACT-LECTURA** = lectura, sin cambios, de configuración o de un endpoint existente. **INFERENCE** = deducción. **CLOUD-NO-COMPROBADO** = comportamiento de la plataforma que nada de esto observó.

**Cuatro vistas, siempre separadas:**
- **proceso:** vivo o muerto, `/readyz`;
- **autoridad:** filas de `world_presence_hosts`, estado y lease vivo;
- **destino del tráfico:** a qué proceso marca el cliente; aquí lo elige el arnés;
- **sesiones existentes:** colocada, o cerrada con un código.

## 1. Hechos de código que explican D5 y D8 (FACT-CÓDIGO)

1. **Gana la generación más nueva, sin mirar el tráfico.** `world_presence_activate` (migración `20261003120000`) activa un host `starting` salvo que exista uno **más nuevo** activo con lease vivo. Uno **más viejo** activo no lo impide. El host viejo se retira cuando se entera de que hay uno más nuevo (`newerActive`), sea por su próximo renew (≤ 5 s) o por cualquier respuesta de claim o save. En `on` se drena, cierra sus sockets con 4503 y queda desplazado: vivo, `/readyz` 503, sin salir solo.
2. **`ready` llega antes que la autoridad.** `realtimeServer.js`: (2) adquiere, (3) `listen`, y ahí `@colyseus/tools` reporta `ready` a PM2, (4) `activate()`. La activación no espera tráfico ni confirmación de ruta.
3. **Un host `starting` renueva su lease cada 5 s.** Si su identidad se pierde con confirmación (`host_expired`, `unknown_host`, identidad detenida), `#newIdentity` toma un `hostId` nuevo, por lo tanto una **generación nueva**, y la recuperación de fondo adquiere y activa de forma normal (`hostLifecycle.js`).
4. **Shadow participa de la autoridad.** `PresenceHosting.prepare` adquiere host si `location().active`, que vale para `shadow` y para `on`. Los procesos en shadow **activan** su fila de host, y sus sesiones **reclaman y guardan** filas de jugadores con clave. Shadow solo se diferencia en no restaurar posiciones y no cerrar sockets por reemplazos o cercos.
5. **No hay espacio de nombres por flota.** `world_presence_hosts` (`generation`, `host_id`, `state`, `lease_expires_at` y marcas de tiempo) y `world_player_locations` no tienen columna de entorno ni de flota. La generación sale de una única secuencia por base. La función Edge `world-authority` tiene **un** secreto por proyecto, compartido por todo realtime que la use.
   - **Consecuencia:** el único aislamiento entre flotas es usar **otra autoridad**, es decir otra base o proyecto.

## 2. Estado actual de la autoridad hosted (FACT-LECTURA, 2026-10-06, sin SQL hosted)

- **El entorno oscuro** (`e09591a`, lanzador `start-dark-realtime.ps1`, leído sin imprimir secretos) corre con `WORLD_LOCATION_PERSISTENCE=shadow` contra la `world-authority` **del proyecto hosted** (`https://qsufab….supabase.co`). Es la misma autoridad que usaría una flota `on` sobre ese proyecto.
- **El proceso sigue vivo** (PID 31224 escuchando en 2567/2568 desde el 2026-10-04). Una lectura de `/metrics` en localhost muestra:
  - **host:** `active`, **generación 2**, unas 28 000 renovaciones (6 fallidas y recuperadas), sin desplazamiento ni reseteos de identidad;
  - **ubicación:** `shadow` con 6 claims `ok` y **15 filas guardadas aplicadas**.
- **Línea base del entorno** (`BASELINE.md`): «world_presence_hosts 0→1 (g2 active)» y «ubicación 2 filas».
- **INFERENCE:** hoy **no** hay una flota `on` sobre esa autoridad. La 0.2 pública (`be360fd`) es anterior a LOCATION, y la app Cloud 0.3 sigue pendiente. Por eso hoy no hay conflicto vivo: **aparece en cuanto una flota `on` use el mismo proyecto.**

## 3. Reproducciones locales (FACT-LOCAL)

**Arnés:** `docs/design/cloud-d5-d8/repro/d5-d8-processes.mjs`.
- Usa procesos reales (`services/realtime/src/index.js`), sockets del SDK real y el handler real de `world-authority` sobre Postgres embebido con todas las migraciones.
- Corre solo en loopback, con usuarios y secretos sintéticos y timers de producción (lease 15 s, renew 5 s).
- Standby apagado y join order apagado.
- **La «ruta» es el arnés eligiendo el proceso:** no hay NGINX, agente ni PM2.

**Resultado:** dos corridas completas en Node 22.23.2, **6/6 PASS** cada una (`evidence/d5-d8-processes-run{1,2}.{txt,json}`). Los tiempos son de esas corridas y no son un SLA.

| Escenario | Proceso | Autoridad | Destino del tráfico | Sesiones | ¿Recupera solo? |
|---|---|---|---|---|---|
| **D5A_SWITCH**: un candidato C activa sin tráfico y luego la ruta pasa a C | A vivo, `/readyz` 200 → 503. C vivo, 200 | Ventana con **dos filas activas y vivas** (gen 1 y 2). A se entera, queda `stopped` y C sigue `active` | A, y después C, por el cambio del arnés a los 3 s | P se cierra con **4503/draining** entre 3,4 y 3,5 s después de que C activó. Un redial a A recibe 4503. Tras el cambio, P se coloca en C **en su casilla guardada** (unos 3,2 s después del cierre) | **Transitorio**, acotado por el cambio de ruta |
| **D5A_ABORT**: igual, pero C muere antes del cambio de ruta (deploy abortado) | A vivo con 503. C muerto | Tras el lease de C, **ningún host activo y vivo** | A (no cambió) | P cerrado con 4503; los rediales a A reciben 4503 | **No.** Más de 22 s observados sin host hasta que el arnés arrancó a mano un proceso nuevo (A2), que recién ahí coloca a P. Sin intervención externa no se recupera |
| **D5B_EXPIRED_STARTING**: un candidato C pierde la autoridad mientras arranca, se le vence el lease de `starting` y vuelve | A vivo, 200 → 503. C vivo | El primer renew de C tras la caída responde **`host_expired`**: C **adquiere la generación 3** (1 reseteo de identidad), se activa y A queda desplazado | A (C nunca recibió tráfico) | P cerrado con 4503 | Igual que D5(a): transitorio si la ruta pasa a C, sin recuperación si C desaparece |
| **D8_SHADOW_AFTER_ON**: un proceso **shadow** S arranca después de A en `on`, contra la misma autoridad | A vivo con 503. S vivo con **200** | S activa una fila **real** con generación más nueva, y A queda desplazado | A | P cerrado con 4503 | Igual que D5(a). Un reinicio del entorno shadow **tumba** la flota `on` |
| **D8_SHADOW_WRITES_SHARED_ROW** | S y luego A | S reclama y **guarda** la fila del jugador (dueño = generación de S) | S y después A | La flota `on` **restaura la casilla que escribió la flota shadow** | Es contaminación de datos, no una interrupción |
| **D8_SEPARATE_AUTHORITY** (control) | A y S vivos, 200 | Cada uno con su base: una fila activa en cada una | A | P sigue conectado y se mueve después de más de 2 periodos de renew | Sin interacción |

**Hechos de D5(b) observados al preparar el escenario, que acotan cuándo ocurre** (FACT-LOCAL, corridas de depuración):
- **Una sola activación lenta (17 s) no lo dispara:** el cliente abandona a los 6 s y reintenta la **misma** identidad dentro del lease, y la activación tardía llega a un host ya activo.
- **Con solo las activaciones fallando**, las **renovaciones** del host `starting` mantienen vivo su lease, así que no hay `host_expired`.
- **Hace falta que fallen activación y renovación** durante más que el lease (un candidato aislado de la autoridad al arrancar). En el arnés, las primeras variantes no llegaron a la condición: C se había activado en 16 ms, antes de que entrara la regla. Fue una carrera del arnés, no del producto, y quedó corregida.

**Límites de la evidencia:**
- PGlite serializa; la concurrencia de la activación ya está probada en Postgres real en LOCATION-4 y READINESS-3.
- No hay proxy real, ni agente de Cloud, ni PM2.
- Sin navegador: el reintento del cliente es explícito.
- Una corrida por escenario en cada pasada, dos pasadas.
- No mide frecuencias en Cloud.

## 4. Riesgos, contención mínima y contrato de ruta

### 4.1 D5(a): candidato de deploy que activa la autoridad antes de recibir tráfico

**Hechos y límites:**
- Activar desplaza al host enrutado en ≤ 1 renew (FACT-LOCAL, unos 3,4 s).
- Si la ruta cambia, el corte dura lo que tarde ese cambio. Si el deploy se aborta después de activar, **no hay recuperación automática** (FACT-LOCAL).
- CLOUD-NO-COMPROBADO: en qué orden hace el agente de Cloud las cosas (activación → `ready` → cambio de upstream → SIGINT del viejo), y si revierte la ruta al abortar. En la emulación de ROLLOUT-1 (D1), el cambio ocurría **antes** de que el nuevo escuchara.

**Contención mínima y coste de disponibilidad:**

| Opción | Qué cambia | Coste | Qué no garantiza |
|---|---|---|---|
| **C-1 Deploy «stop-then-start»**: un solo slot, el nuevo arranca solo después de que el viejo se detuvo | Sin solapamiento no hay dos hosts activos, ni desplazamiento por un candidato, ni D5A_ABORT con un viejo desplazado | Un corte por deploy de arranque más activación: entre 6 y 20 s según STARTUP-1, más el reintento del cliente | Que Cloud lo permita (CLOUD-NO-COMPROBADO, a coordinar con el ecosistema). Un crash del nuevo sigue dependiendo del supervisor |
| **C-2 Activación al primer join** (producto, futura): el candidato queda `starting` hasta que un join le llega | Un candidato que nunca recibe tráfico (deploy abortado) nunca activa | El primer join de C espera la activación (~1 RTT, tope `ACTIVATION_WAIT_MS` de 2 s). Las sesiones de A se cierran con 4503 cuando C activa, como hoy | Un join no es prueba autoritativa de ruta: si Cloud expone rutas por slot (`/<2567+slot>/`, supuesto de la emulación de ROLLOUT-1, CLOUD-NO-COMPROBADO), un join directo a un slot no enrutado lo activaría |
| **C-0 Operativa, sin código**: tratar todo deploy abortado como incidente con reinicio manual | Ninguno | El corte dura hasta la intervención | Nada automático |

**Qué requiere un contrato externo de ruta:** que **quien tiene la autoridad sea el destino del tráfico**. El controlador concede ruta y autoridad a la misma época (identidad + generación). El host nuevo solo activa con esa concesión; el viejo se cerca con esa misma concesión; un deploy abortado revierte las dos. Ni el lease, ni `readyz`, ni una espera pueden darlo.

**Criterios de aceptación (para la opción que elijas):**
- **C-1:** emulación del ecosistema sin dos filas activas a la vez durante un deploy; corte medido y aceptado por vos; deploy abortado sin host desplazado.
- **C-2:** D5A_ABORT pasa a «el host enrutado nunca se desplaza»; D5A_SWITCH conserva la casilla y el corte; un control con join directo a un slot no enrutado documenta el límite.

### 4.2 D5(b): host en `starting` vencido que toma identidad nueva y desplaza al enrutado

**Hechos y límites:**
- Ocurre solo si el candidato queda aislado de la autoridad (activación **y** renovación) durante más que el lease mientras arranca (FACT-LOCAL).
- Al volver toma una generación nueva y desplaza al enrutado **sin haber recibido tráfico**.
- INFERENCE: es el mismo mecanismo que cualquier **(re)arranque** con generación nueva, como el reinicio de PM2 del slot viejo durante un deploy que ROLLOUT-1 (D2) ya observó en emulación. No se repitió aquí.

**Contención mínima y coste:**

| Opción | Qué cambia | Coste |
|---|---|---|
| **C-3 Sin readquisición automática para un host que nunca activó** (producto, futura): tras perder la identidad confirmada queda `stopped` con 503, igual que un desplazado | El candidato aislado ya no vuelve con una generación nueva por su cuenta | Un candidato legítimamente lento necesita un reinicio externo, y **ese reinicio adquiere otra generación igual**. Solo ayuda si los reinicios están controlados, por ejemplo con la política de reinicio de PM2 que estudia el ecosistema (`restart_delay`, D2 de ROLLOUT-1) |
| **C-1** (arriba) | Sin solapamiento no hay host enrutado que desplazar | El de C-1 |

**Qué requiere el contrato de ruta:** lo mismo que D5(a). Sin él, «la generación más nueva gana» siempre deja que un proceso no enrutado con generación nueva tome la autoridad.

**Criterios de aceptación:** D5B_EXPIRED_STARTING pasa a «A no se desplaza; C queda con 503» (C-3) o a «no hay A enrutado mientras C arranca» (C-1). Un control con C-3 desactivado reproduce el desplazamiento.

### 4.3 D8: shadow y `on` sobre la misma autoridad

**Hechos y límites:**
- **No hay aislamiento dentro de una autoridad** (FACT-CÓDIGO y FACT-LOCAL):
  - un shadow más nuevo desplaza a la flota `on` y le cierra los jugadores con 4503;
  - un shadow reclama y guarda filas que la flota `on` después restaura;
  - el único aislamiento comprobado es **otra autoridad** (D8_SEPARATE_AUTHORITY).
- **Hoy** el entorno oscuro en shadow tiene una fila activa y escribió filas en la autoridad **hosted** (§2).
- INFERENCE: un shadow **más viejo** que la flota `on` no la desplaza (solo cuenta `wouldDrain`), pero sus claims pueden competir por filas. No se midió aquí cuál gana en cada orden de claves.

**Contención mínima y coste:**

| Opción | Qué cambia | Coste |
|---|---|---|
| **C-4 Una autoridad por flota** (operativa, sin código), **obligatoria antes de cualquier `on`**: ninguna flota shadow, dark o de prueba usa la autoridad de la flota `on`. Apagar el entorno oscuro de esa autoridad, o moverlo a un proyecto Supabase separado | Elimina el desplazamiento cruzado y la contaminación de filas (D8_SEPARATE_AUTHORITY) | Se pierde la observación en shadow con datos y cuentas de producción, o hace falta un segundo proyecto. Hay que decidir qué hacer con las filas que el entorno oscuro ya escribió en hosted |
| **C-5 Shadow solo observa** (producto, futura): sin adquirir ni activar host, sin claims ni saves | Shadow no puede afectar autoridad ni filas | Shadow deja de medir claims y saves reales, que era su propósito en LOCATION |
| **C-6 Autoridad con espacio de nombres por flota** (producto y SQL, futura): columna de flota en hosts y filas, más la regla «más nuevo» por flota | Varias flotas en un proyecto | Cambio de esquema y de todas las funciones de autoridad. Las filas de jugador compartidas siguen necesitando una regla de dueño entre flotas |

**Contrato de ruta:** **no** hace falta para D8. Es aislamiento del espacio de nombres de autoridad, no de enrutamiento.

**Criterios de aceptación:**
- **Antes de cualquier `on` sobre un proyecto, inventario verificable de las flotas que usan esa autoridad:**
  - qué procesos tienen `WORLD_AUTHORITY_URL` apuntando a ese proyecto;
  - las filas activas de `world_presence_hosts`, leídas por alguien autorizado a leer hosted.
- **Con C-4:** D8_SEPARATE_AUTHORITY como prueba de referencia.
- **Con C-5 o C-6:** D8_SHADOW_AFTER_ON y D8_SHADOW_WRITES_SHARED_ROW deben dejar de reproducir el efecto, con control.

## 5. Interrupción transitoria y situación sin recuperación

| Situación | Clase | Quién la termina |
|---|---|---|
| Candidato activa y la ruta cambia (D5A_SWITCH) | Transitoria: de cierre a colocación, lo que tarde el cambio de ruta (aquí unos 3,2 s con un cambio a los 3 s) | El agente, al cambiar la ruta (CLOUD-NO-COMPROBADO) |
| Deploy abortado después de activar (D5A_ABORT) | **Sin recuperación automática** | Solo un reinicio o redeploy externo. Con standby apagado nada interno lo hace, y H2 desaconseja encenderlo |
| D5(b) | Como D5(a), según el destino de C | Ídem |
| Shadow que se reinicia sobre la autoridad de `on` (D8_SHADOW_AFTER_ON) | Sin recuperación mientras el tráfico siga en la flota `on`: queda desplazada | Un reinicio de la flota `on`, que a su vez vuelve a desplazar al shadow; puede alternar. Solo C-4 o C-5 lo resuelven |
| Filas escritas por shadow (D8) | Contaminación persistente, no un corte | Decisión sobre esos datos |

## 6. Decisiones que requieren tu aprobación

| # | Decisión | Recomendación |
|---|---|---|
| E-1 | **C-4 obligatorio:** ninguna flota `on` comparte autoridad con shadow, dark o pruebas, y se hace el inventario antes de cualquier `on` | Sí. Es el paso mínimo y sin código |
| E-2 | Qué hacer con el entorno oscuro sobre la autoridad hosted: apagarlo antes de que exista una flota `on` ahí, o moverlo a otro proyecto | Apagarlo o moverlo **antes** de cualquier `on`. Hoy no hace daño porque no hay `on` |
| E-3 | Las filas que el entorno oscuro ya escribió en hosted (§2): conservarlas, borrarlas o aislarlas antes de `on` | Tu decisión. Una flota `on` las restauraría |
| E-4 | D5(a)/(b): C-1 (stop-then-start, con corte por deploy) mientras no exista contrato de ruta | Evaluarlo con el ecosistema (configuración del agente), sin duplicar su trabajo |
| E-5 | ¿Diseñar C-2/C-3 (producto) como mitigación intermedia, sabiendo que no son garantías? | Solo si C-1 no es viable en Cloud |
| E-6 | El contrato entre ruta y autoridad (D6), como requisito para un failover automático correcto | Siguiente investigación aparte; aquí solo están sus requisitos (§4.1) |
| E-7 | ¿C-5 o C-6 para D8, o basta C-4? | C-4 basta para avanzar; C-5 y C-6 solo si querés varias flotas en un proyecto |

**Sin promesas.** Nada de esto promete un failover correcto basado en leases, readiness o esperas.

## 7. Entorno

- **Worktree** `pokeswap-d5d8`, con `node_modules` como junction a int1.
- **Sin procesos de las reproducciones vivos:** el arnés mata a sus hijos y cierra sus bases.
- **El entorno oscuro sigue corriendo como estaba.** Solo se leyeron `/version`, `/readyz` y `/metrics` en localhost y sus archivos de lanzamiento y línea base; no se imprimió ningún secreto.
- **No se tocó:** int1, producción, Cloud, PM2, SQL hosted ni flags.

# WORLD LOCATION-4 — Topología de Colyseus Cloud (§3.5): evidencia

> **Veredicto:**
> - **Régimen (app pública 0.2): caso 1 de §3.5 CONFIRMADO por observación.** Un servidor, una región, 1 vCPU compartida, un proceso de la app en régimen, sin autoescalado visible y sin Redis.
> - **Despliegue de 0.3 en Cloud: BLOCKED.** En cada deploy observado, el proceso nuevo cae varias veces seguidas con `EADDRINUSE` en el puerto de salud (§4.3). En 0.3 cada una de esas caídas adquiere y **activa** una generación nueva antes de morir. Hace falta un cambio de código (aparte, con autorización) y las pruebas de §7.
>
> **Fecha:** 2026-10-05 (UTC). **Base:** `integration/world-skills-0.3 @ e09591a`.
> **Alcance:** solo lectura. Sin deploys, reinicios ni cambios de configuración, escalado, variables o secretos. No se leyeron ni se registran valores de secretos (de las variables, solo los nombres). La app pública y el entorno oscuro no se tocaron. `WORLD_LOCATION_PERSISTENCE` sigue en `shadow` y el gate sigue cerrado.

Convenciones como en el diseño: **FACT**, **INFERENCE**, **OPEN QUESTION**. Se separan tres fuentes:

- **[CLOUD]** observado en Colyseus Cloud (panel, historial de deploys, logs de PM2 de la instancia, respuestas HTTP);
- **[REPO]** comportamiento del código instalado en el repo (`services/realtime/node_modules`, versiones del lockfile);
- **[HIPÓTESIS]** lo que solo un despliegue controlado puede confirmar o refutar.

---

## 1. Inventario del panel [CLOUD]

Observado con la sesión del usuario en `cloud-prod.colyseus.io` (2026-10-05), solo lectura.

| Punto | Observado |
|---|---|
| App | «PokeSwap» (space «Pokeswap»), endpoint `https://us-mia-2a460f24.colyseus.cloud` |
| Repositorio / rama | `terremotoparatodos/pokeswap`, rama `playtest/community-0.1`, conexión de GitHub activa (push = deploy) |
| Root directory / install / build | `/services/realtime/` · `npm ci` · `npm test` (el «build» corre los tests en la máquina de producción durante el deploy) |
| Additional watch paths | vacío |
| Servidores / regiones | **1** endpoint, **1** instancia (una sola IP), **1** región: North America, Miami |
| Escalado | no hay ajuste de autoescalado visible; solo acciones manuales `RESIZE` y `ADD REGION` (no se usaron) |
| Plan / CPU | **High Frequency, 1 vCPU compartida, 1 GB RAM** |
| Runtime | Node 22 |
| Variables de usuario (solo nombres) | `NODE_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS` (= «injected env (4) from .env.cloud» en el log). **No** hay `REDIS_URI`, `PORT`, `HEALTH_PORT` ni variable de commit/revisión |
| Variables de la plataforma | «injected env (9) from /etc/environment»; nombres **no** visibles en el panel |
| Último deploy | `77f8563` (cabeza del PR #30) en el historial; el log muestra `HEAD is now at be360fd` (el merge, árbol idéntico a `77f8563`). Duración 18 s |
| Agente | **moderno**: el post-deploy ejecuta `/usr/bin/colyseus-post-deploy` (binario de la plataforma, antes que el del repo) y termina con `Post-deploy success.`; el módulo PM2 `@colyseus/tools` está activo (`PM2 post-deploy agent is up and running...`, `Scaling to 2 for 1 new process(es)`). Su versión **no** es visible |
| `listen_timeout` / `kill_timeout` efectivos | **no expuestos** en el panel |
| Métricas de la instancia | CPU 0,5 %, 108 MB, 0 CCU, 1 sala, uptime 1 semana, **4 reinicios** |

**Nota de seguridad:** la pestaña Build & Deploy muestra en claro el «Deploy CLI Token». Este documento no lo reproduce. Rotarlo o no es decisión del usuario.

## 2. Observado desde afuera [CLOUD]

- **FACT:** 46/46 `GET /version` → `{"commit":"be360fd","protocol":2,"startedAt":"2026-09-24T22:24:17.955Z"}`, con `Server: nginx/1.22.1`. Por sí solo, esto es *compatible* con un único destino. Junto con §1 y §4.2, confirma un único proceso sirviendo.
- **FACT:** el `commit` de `/version` sale de `git` en la máquina (no hay variable de commit en §1, y el deploy hace `git reset` a `be360fd`). El panel rotula el deploy con la cabeza del PR (`77f8563`). **Para identificar el build, la referencia es `/version`, no el rótulo del panel.**

## 3. Comportamiento del código instalado [REPO]

Versiones del lockfile en `be360fd` y en `e09591a`: `@colyseus/core` 0.18.13, `@colyseus/tools` 0.18.3. Para comparar se miró también `@colyseus/tools` 0.18.7, la última publicada. En Cloud corre el binario y el módulo de la **plataforma**, de versión desconocida (§1). Lo de esta sección es referencia del código publicado. Lo que se observó en §4 coincide con él.

### 3.1 Listen y readiness

- **FACT** (`core/build/Server.mjs:69-74`): con `COLYSEUS_CLOUD`, `Server.listen(port)` delega en `@colyseus/tools`.`listen(this)`.
- **FACT** (`tools/build/index.mjs:58-70`): escucha en el socket `/run/colyseus/<2567 + NODE_APP_INSTANCE>.sock` y envía `process.send('ready')`.
- **FACT** (`realtimeServer.js` en `e09591a`): orden `acquire` (hasta `ACQUIRE_WAIT_MS = 10_000`) → `listen` (aquí sale el `ready`) → `activate()` → `createHealthServer()`.
- **FACT** (`observability/health.js`): el servidor de salud escucha en TCP `HEALTH_PORT ?? PORT + 1` = **2568** en Cloud (sin `PORT` ni `HEALTH_PORT`, §1), **igual para todos los procesos**, y no tiene manejador de `error`.

### 3.2 Redis — corrección de §3.5

El texto anterior de §3.5 atribuía la ausencia de Redis a que `index.js` pasa un `Server` ya construido. La conclusión es correcta, pero la causa no:

- **FACT** (`core/build/MatchMaker.mjs:50-51`, `core/build/utils/Env.mjs:9-36`): el constructor llama a `matchMaker.setup()`, que en Cloud intenta Redis si hay **más de 1 CPU** o existe `REDIS_URI`.
- **FACT** (lockfile): `@colyseus/redis-driver` y `@colyseus/redis-presence` no están instalados. Si se intentara, el import fallaría con un warning y quedarían `LocalPresence`/`LocalDriver`.
- **FACT [CLOUD]:** con 1 vCPU y sin `REDIS_URI` (§1), en la app pública el intento ni siquiera ocurre.
- **Consecuencia:** cada proceso tiene su propio matchmaker y su propio mundo. **No** deben agregarse los paquetes Redis ni `REDIS_URI` mientras rija la propiedad por proceso. Un plan con más de 1 CPU no cambia esto mientras los paquetes falten, pero sí cambia el valor por defecto de `instances` (§5).

### 3.3 Agente de deploy (`tools/pm2/post-deploy-agent.cjs`, `rollout.cjs`, `shared.cjs`)

- **FACT** (`shared.cjs:90-120`): fuerza `exec_mode = "fork"` y `wait_ready = true`; respeta `instances` (si falta, usa el número de CPUs); si falta `kill_timeout`, pone 30 min.
- **FACT** (`rollout.cjs`, `post-deploy-agent.cjs:113-194`): con `instances: 1`, el pico es de 2 procesos y la secuencia es:
  1. levanta el nuevo (`pm2.scale` o `pm2.restart` del slot detenido);
  2. escribe en NGINX **solo** el socket del nuevo;
  3. espera 1,5 s;
  4. `pm2.stop(viejo)`;
  5. reconcilia y hace `pm2 dump`.
- **FACT** (diff 0.18.3 → 0.18.7): 0.18.7 corrige que un proceso arrancado fuera de un deploy conservaba el `kill_timeout` por defecto de PM2 (1,6 s) y «would be SIGKILLed mid-drain».
- **FACT** (`tools/post-deploy.cjs`): el script heredado arranca o recarga **sin** `getAppConfig`. Hoy no se usa (§1), pero existe como respaldo.

### 3.4 PM2 (documentación oficial)

- **FACT:** señal de parada por defecto SIGINT, con SIGKILL tras `kill_timeout` (1,6 s por defecto). `wait_ready` espera 3000 ms por defecto (`listen_timeout`). `autorestart` reinicia ante cualquier salida salvo `stop_exit_codes`.
- **FACT** (`ecosystem.config.js`): `min_uptime: '10s'`, `max_restarts: 10`. Si un proceso cae más de 10 veces seguidas sin durar 10 s, PM2 deja de reiniciarlo (estado `errored`).

## 4. Lo que muestran los logs de PM2 de la instancia [CLOUD]

Fuente: el visor de logs del panel (`pm2.log`, `pokeswap-realtime-{out,error}.log`, `-colyseus-tools-out.log`, últimas 100 líneas), con seis deploys entre 2026-09-23 y 2026-09-24. Siempre el mismo patrón.

### 4.1 Procesos

- **FACT:** `pm_id 0` = módulo `@colyseus/tools` (agente). Los procesos de la app son `pokeswap-realtime:1` y `pokeswap-realtime:2` y se **alternan** en cada deploy.
- **FACT:** el banner de `tools.listen` muestra `Listening on http://localhost:2567` (instancia 0) en el deploy de 21:16 y `2568` (instancia 1) en el de 22:24. Esto confirma que `NODE_APP_INSTANCE` alterna, así que no sirve como id de deployment.
- **FACT:** en régimen hay **un** proceso `online` (`pokeswap-realtime:2` desde 2026-09-24T22:24:18). El otro slot queda detenido.

### 4.2 Secuencia de un deploy (2026-09-24 22:24, precisión de 1 s)

```
22:24:16  pokeswap-realtime:2 starting → online → exited with code [1]   (×4–5 hasta 22:24:17)
22:24:17  Stopping app:pokeswap-realtime id:1
22:24:17  pokeswap-realtime:1 exited with code [0] via signal [SIGINT]
22:24:18  pokeswap-realtime:2 online   (y queda)
22:24:22  process tree killed (1 pids)
```

- **FACT:** el viejo recibe **SIGINT** mediante `pm2.stop` y sale con **código 0** (apagado ordenado de Colyseus), alrededor de 1–2 s después del primer `online` del nuevo.
- **FACT:** en los 6 deploys, el viejo **solo** termina por `Stopping app`; nunca se lo ve reiniciado por `autorestart` durante el traspaso.
- **No observable:** el `kill_timeout` efectivo. El viejo salió en menos de 1 s (0 jugadores), así que nunca se llegó al plazo.

### 4.3 Hallazgo: bucle de caídas del proceso nuevo por el puerto de salud

- **FACT** (`pokeswap-realtime-error.log`): cada caída es `Error: listen EADDRINUSE: address already in use :::2568` en `createHealthServer (observability/health.js:11)`, desde `index.js:25`.
- **FACT:** durante el traspaso, los dos procesos intentan el **mismo** puerto TCP 2568 para salud (§3.1). El nuevo no puede abrirlo mientras el viejo viva, cae con código 1, `autorestart` lo relanza y vuelve a caer. Solo se estabiliza cuando el viejo sale. Los «4 reinicios» del panel son estos.
- **FACT:** el `ready` y el banner `Listening` salen **antes** de la caída. El agente ya puede haber apuntado NGINX al proceso nuevo mientras está cayendo.
- **En 0.2** el efecto es acotado: 4–5 caídas en 1–2 s, con conexiones nuevas posiblemente rechazadas en esa ventana.
- **En 0.3** (`e09591a`; INFERENCE desde el código, sin probar en Cloud):
  - cada intento hace `acquire` (una generación nueva) → `listen` → **`activate`** → cae en `createHealthServer`;
  - el host viejo queda desplazado por un candidato que muere enseguida (en su próxima interacción con la base recibe `newer_active` y queda detenido con 4503), en lugar de drenar por SIGINT;
  - cada caída pasa por el apagado de Colyseus (`uncaughtException` → `onBeforeShutdown`/`onShutdown` → `host.stop()` → `exit(1)`) y quema generaciones;
  - cada ciclo cuesta varios RPC a hosted, y el viejo tarda más en salir (drenaje de hasta ~6 s con jugadores) y no suelta el 2568 hasta terminar. Con `min_uptime: 10s` y `max_restarts: 10`, PM2 podría marcar al nuevo `errored`: **ningún proceso sirviendo** hasta una intervención.
- **Requisito (cambio de código, fuera de esta rama):** que dos procesos de la misma app no compitan por el puerto de salud. Opciones:
  - puerto por instancia (`HEALTH_PORT` base + `NODE_APP_INSTANCE`);
  - socket Unix en Cloud;
  - fallo no fatal del servidor de salud.

  Con cualquiera de ellas, la caída deja de ocurrir **después** de `activate()`.

## 5. Requisitos para un deploy de 0.3 en Cloud (no aplicados)

Cambiar `ecosystem.config.js` o el código es configuración productiva con autorización aparte. Esta rama no lo toca.

| Clave | Requisito | Motivo |
|---|---|---|
| puerto de salud | único por proceso, o no fatal (§4.3) | **bloqueante**: hoy cada deploy entra en un bucle de caídas |
| `instances` | `1` explícito; nunca `0`, `-1`, `"max"` ni ausente | ausente = un proceso por CPU; con un plan de más CPUs, el mundo se partiría |
| `exec_mode` | irrelevante en Cloud (se fuerza `fork`); dejar `'fork'` | — |
| `kill_timeout` | **≥ 15 000 ms** explícito (sugerido 30 000) | el viejo drena hasta 3 s, cierra salas, hace el flush tardío de hasta 3 s y `host.stop()`. El agente pone 30 min si falta, pero un valor explícito vale también para el script heredado y para versiones anteriores a 0.18.7 |
| `listen_timeout` | **≥ 15 000 ms** explícito | el `ready` sale después del acquire (hasta 10 s); con 3 s, PM2 da por listo al proceso antes de tiempo |
| `wait_ready` | `true` explícito | el script heredado no lo fuerza |
| `min_uptime` / `max_restarts` | revisar junto con el arreglo del puerto | hoy un deploy normal ya consume 4–5 reinicios «inestables» |
| `autorestart` | `true` (sin cambios) | con F1 un host desplazado no sale |
| Redis / `REDIS_URI` | no agregar / no definir | §3.2 |
| servidores / regiones | uno / una; no usar `ADD REGION` | caso 1 |
| tests en el deploy | medir `npm test` de 0.3 en 1 vCPU / 1 GB | el «build» de Cloud corre la suite en la máquina de producción, junto al proceso vivo; la de 0.3 incluye tests con PGlite |

## 6. Hipótesis que necesitan un despliegue controlado

- **H1 — reinicio del proceso viejo durante el rollout.** Se conserva como hipótesis. Mecanismo: si el viejo cayera entre el `ready` del nuevo y su `pm2.stop`, `autorestart` lo relanzaría con el código viejo y una generación mayor; el nuevo recibiría `newer_active` (terminal) y luego `pm2.stop` apagaría al viejo, sin dejar ningún host activo. En los 6 deploys observados el viejo nunca se reinició (§4.2), pero eso no demuestra que Cloud lo impida.
- **H2 — `kill_timeout` efectivo** sobre un viejo con jugadores (no observable en el panel).
- **H3 — NGINX:** latencia de la recarga y si los websockets abiertos sobreviven hasta el 4503.
- **H4 — `ready` lento:** acquire de más de 3 s con y sin `listen_timeout` explícito.
- **H6 — bucle de §4.3 en 0.3:** cantidad de generaciones quemadas, si el viejo queda desplazado antes del SIGINT y si se alcanza `max_restarts`. Antes y después del arreglo.

H5 (identidad de build) quedó resuelta en §2.

## 7. Pruebas pendientes

### 7.1 Sin deploy

Hechas en §1, salvo dos:

- nombres de las 9 variables de la plataforma (no visibles en el panel);
- versión del agente (no visible). Se puede preguntar a soporte (§7.3 B).

### 7.2 Con un deploy controlado (nunca sobre la app pública)

1. `/version` + log de cada proceso con `pid`, `NODE_APP_INSTANCE` y generación, antes, durante y después.
2. Marcas de tiempo de `ready`, `Stopping app`, `onBeforeShutdown`, flush y `exit`, con jugadores conectados al viejo (H2).
3. Conexiones nuevas solo al nuevo; las existentes cierran con 4503 y vuelven con `resume` (H3).
4. Acquire lento de más de 3 s (H4).
5. Dos deploys seguidos (alternancia de slots).
6. H1: matar al viejo dentro de la ventana de traspaso.
7. H6: reproducir el bucle con `e09591a`, y verificar que el arreglo del puerto lo elimina.

### 7.3 Alternativas para 7.2 y su coste

Una segunda app de Cloud **no es obligatoria**.

| Opción | Coste | Qué cubre | Qué no cubre |
|---|---|---|---|
| A. Panel y logs de la app pública | 0 | hecho (§1, §4) | un deploy de 0.3 |
| B. Soporte de Colyseus (versión del agente, `kill_timeout`/`listen_timeout` efectivos, NGINX, variables de la plataforma) | 0 | H2, H3 por declaración del proveedor | no es medición |
| C. Emulación local: contenedor Linux con PM2 + NGINX + el agente publicado de `@colyseus/tools`, sockets en `/run/colyseus`, mismo `ecosystem.config.js`, `COLYSEUS_CLOUD` definido, sin dependencias nuevas en el repo | 0 (Docker local) | H1, H2, H4, **H6** y el orden de §3.3 con el código real del agente | la versión exacta y el NGINX de la máquina de Cloud |
| D. Segunda app de Cloud para el build oscuro | servidor desde ~USD 15/mes (precio publicado de entrada; el plan actual, 1 vCPU High Frequency, a confirmar en el simulador), cobro mensual por adelantado con crédito prorrateado si se borra antes | todo 7.2 en la plataforma real | — |

**Recomendación:** arreglar el puerto de salud (tarea aparte) y luego C + B. D solo si después queda algo que bloquee `on`, y con decisión explícita del usuario sobre el gasto.

## 8. Separación de entornos

- **Entorno oscuro actual** (procesos locales + túneles, `e09591a`, `shadow`): validado (`WORLD LOCATION-4 SHADOW OK`). **No corre en Colyseus Cloud** ni usa PM2: ni el bucle de §4.3 ni los requisitos de §5 lo afectan. Sigue en `shadow` con el gate cerrado.
- **App pública 0.2:** `be360fd`, sin persistencia ni generaciones. El bucle de §4.3 ya ocurre en cada deploy, con efecto acotado. Está en freeze; no se toca en esta tarea.
- **Futuro deploy de 0.3 en Cloud:** requiere el arreglo del puerto de salud, §5 aplicado (con autorización) y H1–H4/H6 resueltas (por C o D) antes de cualquier paso hacia `on`.
- **Límite:** lo observado en 0.2 muestra la topología en régimen y la mecánica del rollout, pero no cómo se comportan el acquire/activate de 0.3 en esa mecánica. Además, 0.3 podría correr en otra app, con otro plan.

## 9. Fuentes

- Panel de Colyseus Cloud (sesión del usuario): Endpoints, historial de Deployments con su build output, Logs de la instancia, Settings (Application Info, Environment Variables —solo nombres—, Build & Deploy).
- Código: `services/realtime/node_modules/@colyseus/core/build/{Server,MatchMaker}.mjs`, `utils/Env.mjs`; `@colyseus/tools/build/index.mjs`, `post-deploy.cjs`, `pm2/{post-deploy-agent,rollout,shared}.cjs` (0.18.3); `@colyseus/tools@0.18.7` vía `npm pack` (solo para comparar); `services/realtime/src/{realtimeServer.js,observability/health.js}`.
- Colyseus: [Deployment](https://docs.colyseus.io/deployment), [Cloud](https://docs.colyseus.io/cloud), [Environment variables](https://docs.colyseus.io/cloud/environment-variables), [Continuous deployment](https://docs.colyseus.io/cloud/continuous-deployment), [Compute plans](https://docs.colyseus.io/cloud/compute-plans), [Pricing & billing](https://docs.colyseus.io/cloud/pricing-billing), [Read API](https://docs.colyseus.io/cloud/api), [Graceful shutdown](https://docs.colyseus.io/server/graceful-shutdown), [Scalability](https://docs.colyseus.io/scalability), [Pricing](https://colyseus.io/pricing).
- PM2: [Signals / clean restart](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/), [Restart strategies](https://pm2.keymetrics.io/docs/usage/restart-strategies/).

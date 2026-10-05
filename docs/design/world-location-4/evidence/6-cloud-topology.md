# WORLD LOCATION-4 — Topología de Colyseus Cloud (§3.5): evidencia

> **Veredicto:** `INSUFFICIENT EVIDENCE`. Nada de lo encontrado apunta al caso 2 de §3.5 (varios WORLD permanentes), pero el caso 1 **no está confirmado** en Cloud.
> **Fecha:** 2026-10-05 (UTC). **Base:** `integration/world-skills-0.3 @ e09591a`.
> **Alcance:** investigación de solo lectura. Sin deploys, reinicios ni cambios de configuración, escalado, variables o secretos. La app pública y el entorno oscuro no se tocaron. `WORLD_LOCATION_PERSISTENCE` sigue en `shadow` y el gate sigue cerrado.

Convenciones como en el diseño: **FACT** (observado o leído en código/documentación), **INFERENCE**, **OPEN QUESTION**. Se separan tres fuentes:

- **[CLOUD]** configuración observada en Colyseus Cloud;
- **[REPO]** comportamiento del código instalado en el repo (`services/realtime/node_modules`, versiones del lockfile);
- **[HIPÓTESIS]** lo que solo un despliegue controlado puede confirmar o refutar.

---

## 1. Panel de Colyseus Cloud — NO observado

**FACT:** no hubo sesión disponible.

- Claude in Chrome: ningún navegador conectado.
- Navegador interno de la app: `https://cloud-prod.colyseus.io/` muestra el formulario de login.
- No se usaron tokens, credenciales ni la Read API (requiere un token de equipo; crearlo es un cambio de configuración que decide el usuario).

Por lo tanto **ninguno** de estos puntos está observado:

| Punto del panel | Estado |
|---|---|
| app pública correcta y repositorio asociado | OPEN QUESTION |
| cantidad de servidores, regiones y procesos | OPEN QUESTION |
| configuración de escalado / autoescalado | OPEN QUESTION |
| plan y CPU | OPEN QUESTION |
| último deploy y sus logs | OPEN QUESTION |
| agente moderno (`Post-deploy success.`) o script heredado (`Proceeding with legacy post-deploy script...`) | OPEN QUESTION |
| `listen_timeout` / `kill_timeout` efectivos | OPEN QUESTION (el panel podría no exponerlos; ver §5) |
| nombres de variables de entorno (sin valores) | OPEN QUESTION |

Para completarlo: iniciar sesión en `https://cloud-prod.colyseus.io/` (o conectar Claude in Chrome con esa sesión) y repetir solo este inventario, en modo lectura (§7.1).

## 2. Observado desde afuera en la app pública [CLOUD]

URL pública: `https://us-mia-2a460f24.colyseus.cloud`.

- **FACT:** 46 `GET /version` entre 01:09 y 01:10 UTC → 46 respuestas idénticas: `{"service":"pokeswap-presence","commit":"be360fd","protocol":2,"startedAt":"2026-09-24T22:24:17.955Z"}`.
- **FACT:** cabeceras `Server: nginx/1.22.1` + `X-Powered-By: Express`.
- **FACT:** `/healthz` y `/metrics` → 404 desde afuera (viven en el puerto interno).

**Alcance de esta evidencia:** es **compatible** con un único destino detrás de NGINX en esa máquina y con un proceso sin reinicios desde 2026-09-24. **No prueba** la ausencia de workers que no reciban HTTP, de otras máquinas o regiones detrás de otro nombre, ni de autoescalado. Tampoco dice nada de cómo se comporta un deploy.

## 3. Comportamiento del código instalado [REPO]

Versiones del lockfile en `be360fd` y en `e09591a`: `@colyseus/core` 0.18.13, `@colyseus/tools` 0.18.3. Para comparar se miró también `@colyseus/tools` 0.18.7, la última publicada. `pm2` **no** está en `node_modules`: el agente de deploy corre con el PM2 y el `@colyseus/tools` instalados en la máquina de Cloud, cuya versión es desconocida. Por eso lo de esta sección es **referencia del código publicado**, no prueba de lo que corre en la plataforma.

### 3.1 Listen y readiness

- **FACT** (`core/build/Server.mjs:69-74`): con `COLYSEUS_CLOUD` definido, `Server.listen(port)` delega en `@colyseus/tools`.`listen(this)`.
- **FACT** (`tools/build/index.mjs:58-70`): `tools.listen` escucha en `/run/colyseus/<2567 + NODE_APP_INSTANCE>.sock` y, al terminar, envía `process.send('ready')`.
- **FACT** (`services/realtime/src/realtimeServer.js`): el `ready` sale **dentro** de `gameServer.listen`. Antes de eso va `preparePresenceHost()` (acquire con hasta `ACQUIRE_WAIT_MS = 10_000`, `hostLifecycle.js:67`); después va `host.activate()`. Readiness para PM2 ≠ host activo.

### 3.2 Redis — corrección de §3.5

El texto anterior de §3.5 decía que la configuración Redis no se aplica **porque** `index.js` le pasa a `listen` un `Server` ya construido. La conclusión es correcta, pero la causa no:

- **FACT** (`core/build/MatchMaker.mjs:50-51`, `core/build/utils/Env.mjs:9-36`): el constructor de `Server` llama a `matchMaker.setup()`, que usa `getDefaultPresence()`/`getDefaultDriver()`. En Cloud, si la máquina tiene **más de 1 CPU** o existe `REDIS_URI`, intentan importar `@colyseus/redis-presence` y `@colyseus/redis-driver`.
- **FACT** (lockfile de `be360fd` y de `e09591a`): ninguno de los dos paquetes está instalado. El import falla, se escribe un warning (`could not initialize RedisPresence/RedisDriver`) y se usan `LocalPresence`/`LocalDriver`.
- **FACT:** `getDefaultPublicAddress()` sí se aplica (`SUBDOMAIN.SERVER_NAME/<2567+N>`); con un solo proceso no tiene efecto.
- **Consecuencia:** cada proceso tiene su propio matchmaker y su propio mundo. Agregar los paquetes Redis cambiaría eso sin tocar código, así que **no deben agregarse** mientras rija la propiedad por proceso.
- **Uso como evidencia:** si los logs de Cloud muestran ese warning, la máquina tiene más de 1 CPU o hay `REDIS_URI`.

### 3.3 Agente de deploy (`tools/pm2/post-deploy-agent.cjs`, `rollout.cjs`, `shared.cjs`)

- **FACT** (`shared.cjs:90-120`, `getAppConfig`): fuerza `exec_mode = "fork"` y `wait_ready = true`; respeta `instances` (si falta, usa `MAX_ACTIVE_PROCESSES` = CPUs); si falta `kill_timeout`, pone **30 min**; `kill_retry_time` 5 s.
- **FACT** (`rollout.cjs`): con `instances: 1`, `spawnCount = 1` y pico = 2 procesos. Se reusa un slot detenido si existe; si no, se escala a 2.
- **FACT** (`post-deploy-agent.cjs:113-194`), en orden:
  1. levanta el nuevo (`pm2.scale` o `pm2.restart` del slot detenido);
  2. escribe en `colyseus_servers.conf` **solo** el socket del nuevo;
  3. espera 1,5 s («to ensure NGINX is updated & reloaded»);
  4. `pm2.stop(viejo)`: PM2 envía la señal de parada (SIGINT por defecto) y, tras `kill_timeout`, SIGKILL;
  5. al final, reconcilia y hace `pm2 dump`. El slot viejo queda `stopped` y el próximo deploy lo reusa.
- **FACT:** por lo anterior, `NODE_APP_INSTANCE` **alterna 0/1** entre deploys y no sirve como id de deployment.
- **FACT** (diff 0.18.3 → 0.18.7): 0.18.7 aplica la configuración vigente al proceso viejo antes de `pm2.stop`/`pm2.restart` (`withCurrentConfig`). Su comentario explica que un proceso arrancado fuera de un deploy (por ejemplo, el script heredado al bootear) conserva el `kill_timeout` por defecto de PM2, **1,6 s**, y «would be SIGKILLed mid-drain».
- **FACT** (`tools/post-deploy.cjs`): si el módulo agente no responde, el script heredado hace `pm2.start(ecosystem)` o `pm2.reload(ecosystem)` **sin** pasar por `getAppConfig`. En ese camino no se fuerzan `wait_ready` ni `kill_timeout`: valen los de `ecosystem.config.js` o los de PM2.

### 3.4 PM2 (documentación oficial)

- **FACT:** señal de parada por defecto SIGINT; SIGKILL a los **1,6 s** si no salió (configurable con `kill_timeout`).
- **FACT:** con `wait_ready`, PM2 espera el `ready` **3000 ms** por defecto (`listen_timeout`).
- **FACT:** `autorestart` reinicia ante cualquier salida salvo los códigos de `stop_exit_codes`. Que un proceso detenido con `pm2 stop` no se reinicie es **INFERENCE** fuerte (es el sentido de `stop`); la página no lo dice explícitamente.

### 3.5 Documentación de Colyseus Cloud

- **FACT:** Cloud usa NGINX + PM2 y un `ecosystem.config.js`. Las variables documentadas son `NODE_ENV`, `REGION` y `COUNTRY`; **no** hay un id de deployment o revisión documentado.
- **FACT:** la documentación no describe la secuencia de rollout, la señal, el plazo hasta SIGKILL ni cómo fijar servidores o regiones. Las páginas de planes no dan CPU por plan.
- **FACT:** facturación por servidor, mensual y por adelantado; si se borra antes de fin de ciclo, el tiempo no usado queda como crédito. Precio de entrada publicado: «Starting at $15/mo».

## 4. Respuestas a los diez puntos

| # | Pregunta | [CLOUD] | [REPO] | Estado |
|---|---|---|---|---|
| 1 | procesos de la app pública | 46/46 `/version` del mismo proceso | `instances: 1` en el ecosystem | compatible con 1; **no confirmado** |
| 2 | escalado horizontal / autoescalado | no observado | no aplica | OPEN QUESTION |
| 3 | ¿respeta `instances:1` y `exec_mode`? | no observado | el agente respeta `instances` y fuerza `fork` | confirmado solo para el agente publicado |
| 4 | ruteo de conexiones nuevas en un deploy | no observado | NGINX solo al nuevo tras su `ready` | código; HIPÓTESIS en Cloud |
| 5 | conexiones existentes | no observado | siguen en el viejo hasta su apagado (4503) | código + INFERENCE sobre NGINX |
| 6 | orden ready / señal / onBeforeShutdown / fin | no observado | `ready` → NGINX → 1,5 s → SIGINT → `onBeforeShutdown` → cierre → `onShutdown` → `exit(0)` | código; HIPÓTESIS en Cloud |
| 7 | ¿viejo bajo `autorestart` en el traspaso? | no observado | sí, entre el `ready` del nuevo y su `pm2.stop` (≥ 1,5 s) | código; efecto = HIPÓTESIS (§6) |
| 8 | id de deployment confiable | no observado | ninguno documentado; `NODE_APP_INSTANCE` alterna | OPEN QUESTION |
| 9 | ¿se aplica Redis de Cloud? | no observado | no: paquetes ausentes → Local (§3.2) | confirmado por código |
| 10 | configuración para 0.3 | — | §5 | recomendación, no aplicada |

## 5. Requisitos para un deploy de 0.3 en Cloud (no aplicados)

Estos valores se fijan en `services/realtime/ecosystem.config.js` para que valgan **en los dos caminos** (agente moderno y script heredado), sin depender de la versión del agente. Cambiar ese archivo es un cambio de configuración productiva con autorización aparte; esta rama no lo toca.

| Clave | Requisito | Motivo |
|---|---|---|
| `instances` | `1` explícito; nunca `0`, `-1`, `"max"` ni ausente | ausente = un proceso por CPU = mundo partido (§3.2) |
| `exec_mode` | irrelevante en Cloud (se fuerza `fork`); dejar `'fork'` | — |
| `kill_timeout` | **≥ 15 000 ms** explícito (sugerido 30 000) | el apagado del viejo es `onBeforeShutdown` (flush de hasta 3 s) + cierre de salas + `onShutdown` (flush tardío de hasta 3 s) + `host.stop()` (1 RPC). Peor caso ≈ 6 s + RTT. 1,6 s (PM2 por defecto) lo corta a mitad del drenaje |
| `listen_timeout` | **≥ 15 000 ms** explícito | el `ready` sale después del acquire, que puede tardar hasta 10 s. Con 3 s por defecto, PM2 da por listo al proceso y el agente apunta NGINX a un socket que todavía no escucha |
| `wait_ready` | `true` explícito | el agente lo fuerza, pero el script heredado no |
| `autorestart` | `true` (sin cambios) | con F1 un host desplazado no sale; solo sale por SIGINT/SIGTERM vía `pm2.stop` |
| paquetes Redis / `REDIS_URI` | no agregar / no definir | §3.2 |
| servidores / regiones / autoescalado | uno / una / apagado | caso 1 de §3.5 |

## 6. Hipótesis que necesitan un despliegue controlado

- **H1 — reinicio del viejo durante el rollout (se conserva como hipótesis).** Si el proceso viejo se cae entre el `ready` del nuevo y su `pm2.stop` (≥ 1,5 s), `autorestart` lo relanzaría con el código viejo. Al arrancar adquiriría una generación **mayor** que la del nuevo; por N1, el nuevo recibiría `newer_active` (terminal) y quedaría `stopped`; enseguida `pm2.stop` apagaría al viejo. El resultado posible es **ningún host activo** hasta el próximo reinicio. Que PM2 o el agente lo impidan, y con qué frecuencia ocurre, no está verificado. La alarma de §3.5 (drenajes por `newerActive` sin deploy) lo haría visible.
- **H2 — señal y plazo reales:** SIGINT y el `kill_timeout` efectivo sobre el proceso viejo (30 min por el agente, 1,6 s si el viejo vino del script heredado y el agente es < 0.18.7, o el valor explícito de §5).
- **H3 — latencia de la recarga de NGINX** y si los websockets abiertos sobreviven a la recarga hasta el 4503 (`worker_shutdown_timeout` de Cloud desconocido).
- **H4 — `ready` lento:** comportamiento con un acquire de más de 3 s y `listen_timeout` por defecto.
- **H5 — identidad de build:** si `/version` resuelve el commit por variable de entorno o por `git` en Cloud.

## 7. Pruebas pendientes

### 7.1 Sin deploy (lectura del panel, requiere sesión)

1. Confirmar la app `us-mia-2a460f24` y el repositorio/rama asociados.
2. Servidores, regiones, autoescalado, plan y CPU.
3. Texto del último deploy: agente moderno o script heredado.
4. Logs de la instancia: `could not initialize RedisPresence` (→ más de 1 CPU o `REDIS_URI`), líneas de arranque y `ready`.
5. Nombres (no valores) de las variables de entorno: si existe alguna de revisión.

### 7.2 Con un deploy controlado (nunca sobre la app pública)

1. `/version` + log de cada proceso con `pid`, `NODE_APP_INSTANCE` y generación, antes, durante y después.
2. Marcas de tiempo de `ready` del nuevo, señal al viejo, `onBeforeShutdown`, flush, `exit`; señal real y `kill_timeout` efectivo (H2).
3. Desde la señal, conexiones nuevas solo al nuevo; las existentes cierran con 4503 y vuelven con `resume` (H3).
4. Acquire lento (> 3 s) con y sin `listen_timeout` explícito (H4).
5. Dos deploys seguidos: reuso del slot detenido.
6. H1: matar al viejo dentro de la ventana de traspaso y observar generaciones y estado de ambos hosts.

### 7.3 Alternativas para 7.2 y su coste

Una segunda app de Cloud **no es obligatoria**. Opciones, de menor a mayor coste:

| Opción | Coste | Qué cubre | Qué no cubre |
|---|---|---|---|
| A. Leer el panel / logs de la app pública (§7.1) | 0 | topología real en régimen, versión del agente usada en el último deploy | comportamiento de un deploy nuevo |
| B. Preguntar a soporte de Colyseus (versión del agente, señal, `kill_timeout`, NGINX, id de revisión) | 0 | H2, H3, H5 por declaración del proveedor | no es medición |
| C. Emulación local: contenedor Linux con PM2 + NGINX + el agente publicado de `@colyseus/tools` (0.18.3 y 0.18.7), sockets en `/run/colyseus`, sin dependencias nuevas en el repo | 0 (Docker local) | H1, H2, H4, el orden de §3.3 y el reuso de slots, con el código real del agente | la versión y la configuración reales de la máquina de Cloud, y H3 tal como la configura Cloud |
| D. Segunda app de Cloud para el build oscuro | servidor desde ~USD 15/mes, cobro mensual por adelantado con crédito prorrateado si se borra antes (precio y CPU del plan a confirmar en el simulador) | todo 7.2 en la plataforma real | — |

**Recomendación:** A + B + C primero. D solo si después de eso queda algo que bloquee `on`, y con decisión explícita del usuario sobre el gasto.

## 8. Separación de entornos

- **Entorno oscuro actual** (procesos locales + túneles, `e09591a`, `shadow`): ya validado (`WORLD LOCATION-4 SHADOW OK`). **No corre en Colyseus Cloud**, así que esta investigación no lo afecta ni lo invalida. Sigue en `shadow` con el gate cerrado.
- **Futuro deploy de 0.3 en Cloud:** requiere §5 aplicado (con autorización), §7.1 observado y las hipótesis de §6 resueltas (por C o D) antes de cualquier paso hacia `on`.
- **Límite:** lo observado en 0.2 (`be360fd`, sin persistencia ni generaciones) muestra un régimen estable, no un deploy. 0.3 cambia los tiempos de arranque (acquire antes de `listen`, activate después) y correría con una configuración, un plan y quizás una app distintos.

## 9. Fuentes

- Código: `services/realtime/node_modules/@colyseus/core/build/{Server,MatchMaker}.mjs`, `utils/Env.mjs`; `@colyseus/tools/build/index.mjs`, `post-deploy.cjs`, `pm2/{post-deploy-agent,rollout,shared}.cjs` (0.18.3); `@colyseus/tools@0.18.7` vía `npm pack` (solo para comparar).
- Colyseus: [Deployment](https://docs.colyseus.io/deployment), [Cloud](https://docs.colyseus.io/cloud), [Environment variables](https://docs.colyseus.io/cloud/environment-variables), [Continuous deployment](https://docs.colyseus.io/cloud/continuous-deployment), [Compute plans](https://docs.colyseus.io/cloud/compute-plans), [Pricing & billing](https://docs.colyseus.io/cloud/pricing-billing), [Read API](https://docs.colyseus.io/cloud/api), [Graceful shutdown](https://docs.colyseus.io/server/graceful-shutdown), [Scalability](https://docs.colyseus.io/scalability), [Pricing](https://colyseus.io/pricing).
- PM2: [Signals / clean restart](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/), [Restart strategies](https://pm2.keymetrics.io/docs/usage/restart-strategies/).

# CLOUD STARTUP-1 — PM2 timeouts explícitos, verificados en la emulación local

> **Veredicto:** con `wait_ready: true`, `listen_timeout: 20000` y `kill_timeout: 30000` el agente de Colyseus espera el `ready` real y nunca corta el drenaje con SIGKILL en un arranque normal (8/8 rollouts, 0 errores públicos). **20 s no cubren** un arranque con la CPU disputada (16,6–20,0 s sin fallas) combinado con un acquire lento o caído: ahí PM2 da el proceso por listo por tiempo y vuelve el hueco de D1 (4,5–11,6 s de 502). Medición y propuesta en §4; el valor no se amplió. **`ready` no es «host activo»:** con la autoridad caída el proceso anuncia `ready` sin generación y rechaza todos los joins con 4503 (§3).

**Fecha:** 2026-10-05 (UTC). **Rama:** `fix/realtime-cloud-timeouts-0.3`, manifiesto en `574eb0a` (base `f204598`, HEALTH PORT-1).
**Alcance:** configuración y documentación. Nada hosted, ni deploy, ni flags, ni entorno oscuro. Sin rediseño de LOCATION: D2 y D4 siguen abiertos (§6).
**Convenciones:** **FACT** (observado), **INFERENCE**, **OPEN QUESTION**.

## 1. Cómo se verificó

La emulación de CLOUD ROLLOUT-1 se ejecutó en un contenedor exclusivo con 1 vCPU. Componentes:

- NGINX 1.22.1 (la misma versión que Cloud);
- PM2 6.0.14 con el agente `@colyseus/tools` 0.18.3 `post-deploy-agent.cjs`, accionado con `pm2 trigger @colyseus/tools post-deploy`;
- realtime en `NODE_ENV=production`, `COLYSEUS_CLOUD=1` y `WORLD_LOCATION_PERSISTENCE=on`;
- autoridad local: el handler real de `world-authority` sobre PGlite con las migraciones reales, con datos y tokens sintéticos;
- cuatro jugadores reales del SDK detrás de NGINX, con la política de cierre del cliente.

El agente lee **el `ecosystem.config.js` de la rama tal como está commiteado**: `<cwd>:<cwd>/ecosystem.config.js`, sin copias.

**FACT: el agente aplica los valores del manifiesto.** El `pm2_env` de cada proceso arrancado por el agente, leído con `pm2.list()` en las 12 corridas con el manifiesto de la rama, muestra:

- `wait_ready: true`
- `listen_timeout: 20000`
- `kill_timeout: 30000`, y no los 30 min que el agente pone cuando falta
- `autorestart: true`
- `min_uptime: 10000`
- `max_restarts: 10`
- `restart_delay: null`
- `instances: 1`

Lo confirma también el comportamiento:

- PM2 marca `online` 2–24 ms antes del log `Listening on` (el `ready` real) en todos los arranques que entran en 20 s, y exactamente 20 s después del launch en los que no entran;
- el control con `kill_timeout: 1000` registra «still alive after 1000ms, sending it SIGKILL».

## 2. Resultados

Las fases se miden en ms desde el trigger del deploy. En cada fila:

- **launch**: aparece el proceso nuevo;
- **listening**: `process.send('ready')` y el log de `@colyseus/tools`;
- **ready**: PM2 `online`;
- **active**: el host del proceso nuevo pasa a `active` en su `/metrics`;
- **nginx**: el agente reescribe el upstream;
- **SIGINT** y **exit**: los del proceso viejo.

| Escenario | n | Veredicto | launch | listening | ready | active | nginx | SIGINT | exit viejo | 502 públicos | rejoin máx. | posiciones |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. Rollout normal, CPU libre | 3 | **pass 3/3** | 2,9 s | 9,5–9,7 s | = listening | +0,24 s | +0,04 s | +1,5 s | 0/SIGINT | 0 | ≤ 529 ms | 4/4 |
| 1. Rollout normal, CPU disputada | 1 | **pass** | 7,1 s | 23,8 s | = listening | +0,06 s | +0,04 s | +1,5 s | 0/SIGINT | 0 | 565 ms | 4/4 |
| 2. Acquire lento (respuesta a 6 s) | 1 | fail | 7,6 s | **32,0 s** | **27,5 s (timeout)** | 32,2 s | 27,6 s | 29,1 s | 0/SIGINT | **19 (4,5 s)** | 3,6 s | 4/4 |
| 3a. Autoridad caída 35 s desde el trigger | 1 | fail | 8,4 s | **40,1 s** | **28,4 s (timeout)** | 40,4 s | 28,5 s | 30,0 s | 0/SIGINT | **52 (11,6 s)** | 15,7 s | **0/4** (autoridad caída en el drenaje) |
| 3b. Solo `presence_acquire` caído 35 s | 1 | fail | 8,0 s | **38,4 s** | **28,0 s (timeout)** | 38,6 s | 28,0 s | 29,5 s | 0/SIGINT | **46 (10,3 s)** | 15,6 s | 4/4 |
| 3c. Autoridad caída 60 s (agota `ACQUIRE_WAIT_MS`) | 1 | fail | 3,2 s | 22,3 s | = listening (**sin generación**) | **83,3 s** | 22,3 s | 23,8 s | 0/SIGINT | 0, pero joins **4503** 25,9 → 91,0 s | **65,6 s** | **0/4** |
| 3d. Solo `presence_acquire` caído 60 s | 1 | fail | 8,5 s | 39,9 s | **28,4 s (timeout)** | **70,8 s** | 28,4 s | 29,9 s | 0/SIGINT | 52 (502) + joins 4503 hasta 75,6 s | 45,6 s | 4/4 |
| 4. Flush lento (save a 5 s; renovaciones lentas para forzar la vía SIGINT) | 1 | **pass** | 8,3 s | 27,3 s | = listening | | 27,4 s | 28,8 s | 0/SIGINT (flush de 6 s, sin SIGKILL) | 0 | | 4/4 |
| 5. Control: `kill_timeout: 1000` < flush | 1 | **fail (esperado)** | 8,0 s | 28,0 s | = listening | | 28,1 s | 29,6 s | **0/SIGKILL** a 1 s, sin línea de flush | 0 | | **0/4**, cierres **1006** |
| 6. Dos deploys consecutivos; el 2.º espera el `stop` real del 1.º | 2 | **pass 2/2** | 7,9–8,4 s | 18,4–19,0 s tras launch | = listening | | +0,03–0,08 s | +1,5 s | 0/SIGINT | 0/311, 0/304 | ≤ 633 ms | 8/8 |

(*) En el escenario 6 el segundo deploy reusa el slot detenido (`pm2.restart`) y se dispara solo después del evento `stop` de PM2. Así se evita el caso de deploys solapados (D3 de CLOUD ROLLOUT-1).

### Duración del arranque sin fallas (launch → hito)

| Hito | CPU libre (8 arranques) | CPU disputada (9 arranques) |
|---|---|---|
| carga de módulos (`[location] persistence on`) | 4,3–4,7 s | 11,2–14,0 s |
| `[health] listening` | 6,1–6,6 s | 16,4–19,7 s |
| `Listening on` (`ready`) | **6,2–6,8 s** | **16,6–20,0 s** |

«CPU disputada»: desde las 12:35 el host Windows estaba con 79 % de CPU por procesos ajenos a la prueba (`ffmpeg`, Chrome, etc.), sumado al límite de 1 vCPU del contenedor. **FACT:** con la CPU disputada, el arranque sin fallas llega a 20,03 s (corrida 5), al borde del `listen_timeout`.

## 3. `ready` no es «host activo»

**FACT** (corrida 3c, CPU libre): con la autoridad caída, el proceso nuevo pasó por esta secuencia.

1. A los 9,7 s abre el puerto de salud con el host en `acquiring`.
2. Agota `ACQUIRE_WAIT_MS` (10 s) y registra `[host] no generation after 10000 ms: unavailable — /readyz 503 and joins 4503 in 'on'`.
3. **Escucha y envía `ready` a los 22,3 s**, sin generación.
4. PM2 lo marca `online` y el agente cambia NGINX y manda SIGINT al viejo a los 23,8 s.

El viejo estaba `paused` (`/readyz` 503) pero **seguía con sus 4 jugadores conectados**. Al drenar, no pudo guardar porque la autoridad estaba caída: «4 sin guardar».

Desde 25,9 s hasta que volvió la autoridad (60 s), **todos los joins al proceso nuevo recibieron 4503**. Después:

- el host nuevo adquirió y activó en segundo plano recién a los 83,3 s, por el backoff de reintento;
- los jugadores entraron a los 91 s;
- las posiciones volvieron a la última guardada antes de la caída.

El endpoint público `/version` respondió 200 durante todo el hueco. **Un 200 en el puerto público no significa que se esté sirviendo a jugadores.**

**Efecto:** un deploy durante una caída de la autoridad convierte «host viejo en pausa pero con jugadores conectados» en «nadie conectado» hasta que vuelve la autoridad y termina el backoff, unos 66 s en esta corrida. No es un problema de `listen_timeout`.

**INFERENCE:** con un `ready` demorado hasta tener generación pasaría lo mismo. PM2 lo daría por listo al vencer `listen_timeout` y el agente haría el mismo cambio, porque no consulta `/readyz`. Mitigación operativa: no disparar deploys con la autoridad degradada. Cualquier cambio de diseño queda fuera de esta rama.

## 4. ¿Alcanzan 20 s? Medición y propuesta (no aplicada)

| Caso | Arranque medido | ¿Cubre 20 s? |
|---|---|---|
| Sin fallas, CPU libre | 6,2–6,8 s | sí (margen ~13 s) |
| Peor caso acotado, CPU libre: arranque + `ACQUIRE_WAIT_MS` (3c: 19,1 s desde el launch) | ~17–19 s | **sí, con poco margen** (0,9 s en 3c) |
| Sin fallas, CPU disputada | 16,6–20,0 s | **al límite** |
| CPU disputada + acquire lento o caído (2, 3a, 3b, 3d) | 24,4–31,7 s | **no**: listo por tiempo, 4,5–11,6 s de 502 |

**Propuesta, a decidir:** `listen_timeout: 30000`. Cubre una CPU disputada (~20 s) más `ACQUIRE_WAIT_MS` (10 s). Su único coste es que un proceso que nunca llega a `ready` tarda 10 s más en darse por listo. Alternativa: dejar 20 s y medir el arranque real en Cloud, con los tiempos de `starting → online` del log de PM2 en un deploy controlado.

**OPEN QUESTION:** la CPU de Cloud (1 vCPU compartida High Frequency) mientras corre el `npm test` del build. Sin medición en Cloud, la emulación solo acota el rango: 6–20 s sin fallas.

## 5. Limitaciones respecto de Cloud

Las de CLOUD ROLLOUT-1 §6 siguen vigentes:

- **Ruta del WebSocket:** que NGINX enrute el WebSocket a `/<puerto>/` es un supuesto.
- **PM2:** Cloud usa un PM2 parcheado. El de npm no tiene `updateProcessConfig`; los valores del manifiesto sí llegan por `pm2.start` / `pm2.scale`, como se vio en §1.
- **Recarga de NGINX:** acá la hace un vigilante; la de Cloud es desconocida.
- **CPU:** `os.cpus()` ve 20 CPU, por eso Colyseus intenta Redis y cae a local sin efecto.
- **Build:** no se emuló el build en la misma máquina (`git reset` + `npm ci` + `npm test`).
- **Versión del agente:** la de Cloud es desconocida; acá se usó 0.18.3.
- **Autoridad:** en loopback, sin la latencia de la Edge Function hosted.

Además, el `slow` del flush lento aplica el guardado en la base de inmediato y solo demora la respuesta: prueba el plazo del flush, no un guardado que llega tarde. Y la carga del host en §2 no se controló: está medida, no provocada.

## 6. Fuera de alcance (abierto)

- **D2:** cuando el slot viejo cae durante el arranque del nuevo, `autorestart` crea una generación mayor que después se detiene, y la menor queda desplazada (sin host activo) o da un falso 4409 al reconectar. **No** se toca en esta rama: sin `restart_delay` ni readquisición.
- **D4:** la línea `shutdown flush` cuenta como «sin guardar» posiciones ya guardadas. Se trata aparte.
- **D3:** deploys solapados (comportamiento del agente). El escenario 6 lo evita esperando el `stop` real del primer deploy.

## 7. Reproducir

El arnés vive fuera del repo, en el scratchpad de la sesión: `rollout1/` (Dockerfile, `nginx.conf`, `harness/`, `configs/`, `runs/`). Comandos:

```bash
docker start pokeswap-rollout1
MSYS_NO_PATHCONV=1 docker exec pokeswap-rollout1 sh /work/harness/matrix7.sh   # 1, 2, 3a, 3b, 4, 5, 6
MSYS_NO_PATHCONV=1 docker exec pokeswap-rollout1 sh /work/harness/matrix8.sh   # 3c, 3d
node harness/phases.mjs <runs/...>                                              # fases por rollout
```

Datos crudos por corrida: `runs/<id>/{timeline.jsonl, pm2-logs.jsonl, pm2/pm2.log, authority-events.json, nginx-*.log, result.json}`.

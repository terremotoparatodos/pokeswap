# Servicio de presencia R30

Servicio Colyseus separado para presencia efímera de WildLands. No tiene credenciales de service-role, no escribe en Supabase y no guarda posiciones, acompañantes ni cosméticos.

## Variables de entorno

- `PORT` (por defecto `2567`)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ALLOWED_ORIGINS` (lista separada por comas; obligatorio en producción, por ejemplo `https://pokeswap.lol,https://www.pokeswap.lol`)

Para desarrollo local, copiar `.env.example` a `.env` dentro de este directorio y completar únicamente la URL y la clave publishable/anon ya expuestas al frontend. No usar `SUPABASE_JWT_SECRET`, service-role ni un JWT de usuario como variable de entorno.

El token del usuario se verifica una sola vez al entrar contra Supabase Auth. Cuando el JWT no trae `username`, el servicio hace una única lectura autenticada de `profiles`; no hay polling. Nunca registrar tokens, headers de autorización ni variables de entorno.

## Colyseus Cloud

Construir desde `services/realtime/Dockerfile`, configurar las cuatro variables en el panel de Colyseus Cloud y publicar la URL WebSocket como `VITE_REALTIME_URL` en Cloudflare Pages. Usar un único proceso mientras el límite global sea 100; no activar réplicas ni Redis hasta diseñar presencia compartida.

Entorno en Cloud (CLOUD ENV-1): Cloud entrega las variables del panel en `.env.cloud`, y las de la plataforma en `/etc/environment`. Las carga `@colyseus/tools` al importarse. Como varios módulos leen el entorno al importarse, `src/index.js` primero las carga (`src/cloudEnvironment.js`, solo con `COLYSEUS_CLOUD`) y recién después importa el realtime. La precedencia es la de `@colyseus/tools`: `.env.cloud` y `/etc/environment` pisan al proceso, `.env` no. Fuera de Cloud no se carga ningún archivo.

## Observabilidad y carga

Colyseus Cloud debe alertar sobre conexiones, rechazos de join, CPU, memoria y desconexiones. El proceso expone `GET /healthz`, `GET /readyz` y `GET /metrics` en `HEALTH_PORT` (2568 en desarrollo); publicarlos sólo por la red interna de Cloud. `/readyz` responde 503 hasta que el arranque termina (salud → acquire → listen → activate).

Puerto de salud (HEALTH PORT-1):

- Local / Docker (sin `COLYSEUS_CLOUD`): `HEALTH_PORT`, o `PORT + 1` (2568 por defecto). `NODE_APP_INSTANCE` no se suma, así que ningún realtime local se corre al puerto de juego de otro.
- Colyseus Cloud (`COLYSEUS_CLOUD` definida): `HEALTH_PORT` (o `PORT + 1`, 2568) es la **base** y cada slot de PM2 suma su `NODE_APP_INSTANCE` (ausente = 0). En un rollout el proceso viejo y el nuevo corren a la vez en los slots 0 y 1 y toman 2568 y 2569; sus puertos de juego en Cloud son sockets Unix, no TCP.
- `PORT`, `HEALTH_PORT` o `NODE_APP_INSTANCE` mal formados, o un puerto final fuera de 1–65535, son un error de configuración: el proceso termina antes de abrir puertos o adquirir una generación.
- Si el puerto de salud no se puede abrir (por ejemplo `EADDRINUSE`), o el servidor de salud falla después, se registra `[health] unavailable …` / `[health] degraded …` con el código y el realtime sigue sirviendo: no reinicia, no adquiere otra generación ni desplaza hosts. `[health] listening on port N` sólo se registra cuando el puerto quedó abierto. Los logs operativos deben registrar sólo el tipo de evento y los contadores agregados. Antes de habilitar 100 conexiones, ejecutar 50 jugadores autenticados más espectadores repartidos entre Ciudad y Pradera, midiendo mensajes por segundo, latencia de movimiento y FPS en un viewport de 375 px.

`npm test` ejecuta los casos de capacidad, autenticación, anti-spam e interés espacial. `npm run test:load` ejecuta un preflight reproducible de 50 jugadores, repartidos entre Ciudad y Pradera, e informa tiempo y mensajes del protocolo. La imagen debe verificarse con `docker build -t pokeswap-realtime-r30 .` en CI o un equipo con Docker.

La reconexión del cliente vuelve a entrar a una sala nueva con backoff acotado; no usa reserva de sesión ni restaura posiciones. Antes de Cloud, verificarla en un navegador normal cerrando y levantando el contenedor con dos sesiones abiertas.

## Verificación de despliegue y métricas (protocolo 2)

- `GET /version` en el puerto **público** devuelve sólo identidad de build: `{ service, commit, protocol, startedAt }`. `commit` sale de `PRESENCE_BUILD_COMMIT` (o `SOURCE_COMMIT`/`GIT_COMMIT`/`COMMIT_SHA`), luego de `git rev-parse`, y si no hay ninguno es `unknown`; nunca refleja texto arbitrario del entorno. `protocol` sube cuando cambia comportamiento del que depende el cliente (ver `src/observability/version.js`). Para verificar un deploy: `curl -s https://<endpoint>/version`.
- `GET /metrics` sigue sólo en `HEALTH_PORT` (red interna). Además de conexiones y rechazos por razón (`capacity`, `invalid`, `rate`, `replay`, `area`) informa movimientos aceptados, cambios de área, recuperaciones de reconexión, uptime, memoria (MB) y demora del event loop (p50/p99/máx). Nada identifica usuarios.
- Puntos de llegada: `src/protocol/arrival.js` es el contrato con `Area.arrival()` del cliente; `src/features/wildlands/multiplayer/domain/arrivalContract.test.ts` falla si divergen.
- Ritmo de movimiento: token bucket de 10 movimientos/s con ráfaga de 15 (`src/presence/movement.js`), para que un corte de red de hasta ~1,5 s corriendo no rechace pasos legítimos.
- Harness determinista de reconciliación cliente/servidor: `scripts/presence-harness/run.sh` desde la raíz.
- Deltas compactos: un cliente que se une con `presenceProtocol: 2` recibe los movimientos de actores que ya conoce como `{ type: 'step', actor: { id, tx, ty, dir, speed, moveSequence } }`; la identidad (username, personaje, acompañante, área) sólo viaja en `upsert` completos. Clientes sin esa opción siguen recibiendo `upsert`, así que el servidor puede desplegarse antes que el frontend. Soak de lógica (100 jugadores corriendo en la plaza): ~134 → ~72 KB/s por cliente (JSON estimado), mismo CPU.
- Pasos apilados (PERF-2.3): los deltas se agrupan en ventanas de 50 ms con una entrada por actor. Si dos o más `step` del mismo actor caen en la misma ventana, el último conserva su forma y lleva los anteriores en `via: [{ tx, ty, dir, speed, moveSequence }, …]` (más viejo primero, como máximo 8). Antes sólo sobrevivía el último y el observador veía un salto de dos casillas. Un cliente que ignora `via` recibe exactamente lo mismo que antes. Con cadencia estable `via` no aparece (mismo ancho de banda); con movimientos de a dos por paquete, 30 jugadores: 10,6 → 16,2 KiB/s por cliente, sin pasos perdidos.

## Mundo compartido (WORLD-1, protocolo de presencia 4)

El mundo dinámico viaja por el mismo socket y el mismo tick de 50 ms que la presencia. Sólo lo reciben los clientes que declaran `worldProtocol: 2` al unirse (SKILLS PROB-2). Un cliente que declara un protocolo anterior, o ninguno, no recibe estado del mundo y cualquier `world:work` suyo recibe `client-outdated` sin que se verifique ni reserve nada.

- **Trabajo probabilístico (PROB-2)**: una acción son intentos de `WORK_TICK_MS` = 600 ms. SKILLS sortea en secreto cuántos; el servidor programa el fin y **nunca lo publica**: ni `endsAt`, ni duración, ni intentos, ni chance en ningún mensaje. Los nodos en trabajo llevan quién, qué y `startedAt` (fase de la animación). `world:work` está limitado por jugador (ráfaga 4, 1 cada 500 ms; `rate-limited`).

- **Recursos** (`src/world/`): layout determinista compartido con el navegador (`terrain.js`, `resourceLayout.js`), estado mutable disperso en memoria (`resourceStore.js`), autoridad de acciones (`resourceAuthority.js`), interés por chunks de 16 casillas (`worldInterest.js`), transporte (`worldRoom.js`).
- **Mensajes**: cliente → `world:work { nodeId, pokemonInstanceId, requestId }`, `world:cancel { actionId }`. Servidor → `world:snapshot`, `world:batch`, `world:work:result`, `world:work:done`, `world:wild`. Todos llevan `now` (reloj del servidor).
- **SKILLS**: puerto `SkillPolicyPort` en `src/world/skillPolicy.js`. En producción la policy es `unavailable` (rechaza todo). El settlement server-only de XP/drops está pendiente de decisión; este servicio no tiene service-role. `WORLD_DEMO_SKILLS=on` (sólo fuera de producción) activa la policy demo; `WORLD_DEMO_ACTION_MS` fija su duración.
- **Salvajes**: el roster de la hora se calcula con dos lecturas por hora (`pokemon` y `slots` con dueño) usando la clave publishable. `WORLD_WILD_CATALOG=synthetic` usa un catálogo sintético (stacks locales sin Supabase). **Fail closed:** sin roster no hay salvajes; los clientes reciben `wildStatus` y el proceso deja una línea de log por racha de fallas (`[world] shared wild population unavailable …`) y la cuenta en `/metrics`.
- **Ubicación del jugador (WORLD LOCATION-2)**: `WORLD_LOCATION_PERSISTENCE=off|shadow|on`, un flag por proceso; `off` por defecto (también si falta o es inválido). `shadow` reclama y guarda pero no restaura; `on` restaura desde la fila validada. Necesita `world-authority` con `location_claim`/`location_save`; sin ese adaptador el modo efectivo es `unavailable` (= `off`). Estado y contadores agregados sólo en `/metrics` (`location`), nunca en `/version`. Rollback: `off` y reiniciar. Diseño: `docs/design/WORLD_LOCATION_1_AUDIT.md`; informe: `docs/design/WORLD_LOCATION_2_REPORT.md`.
- **Persistencia**: ninguna (deuda WORLD-1.1). Un reinicio del proceso devuelve todos los nodos a su estado base y corta las acciones en curso sin liquidar (ver `docs/world/WORLD_1_REPORT.md` §8).
- **Métricas**: `/metrics` (puerto interno) incluye `world` con contadores agregados, sin ids ni coordenadas.
- **Carga**: `node scripts/benchmark-world.mjs --players 30 --duration 60 [--world off]` desde la raíz.

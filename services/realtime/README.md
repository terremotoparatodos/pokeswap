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

## Observabilidad y carga

Colyseus Cloud debe alertar sobre conexiones, rechazos de join, CPU, memoria y desconexiones. El proceso expone `GET /healthz`, `GET /readyz` y `GET /metrics` en `HEALTH_PORT` (2568 en desarrollo); publicarlos sólo por la red interna de Cloud. Los logs operativos deben registrar sólo el tipo de evento y los contadores agregados. Antes de habilitar 100 conexiones, ejecutar 50 jugadores autenticados más espectadores repartidos entre Ciudad y Pradera, midiendo mensajes por segundo, latencia de movimiento y FPS en un viewport de 375 px.

`npm test` ejecuta los casos de capacidad, autenticación, anti-spam e interés espacial. `npm run test:load` ejecuta un preflight reproducible de 50 jugadores, repartidos entre Ciudad y Pradera, e informa tiempo y mensajes del protocolo. La imagen debe verificarse con `docker build -t pokeswap-realtime-r30 .` en CI o un equipo con Docker.

La reconexión del cliente vuelve a entrar a una sala nueva con backoff acotado; no usa reserva de sesión ni restaura posiciones. Antes de Cloud, verificarla en un navegador normal cerrando y levantando el contenedor con dos sesiones abiertas.

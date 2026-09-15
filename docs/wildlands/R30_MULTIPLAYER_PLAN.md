# R30 — Presencia multijugador efímera

> Estado: implementación local aprobada; pendiente de auditoría final, commits y despliegue. No está fusionada ni publicada.
> Base: R29 fusionada en `migration` mediante merge commit `f6d6d80`.

## Objetivo

Hacer visible la presencia multijugador en Ciudad Corazón y la zona wild inicial sin introducir autoridad persistente en el navegador ni cambiar economía, ownership, auth de Supabase, RLS, migraciones, RPCs o Edge Functions.

## Decisiones de producto aprobadas

- Una sola Ciudad Corazón y una sola zona wild inaugural (**Pradera Brisa**); ambas usan la misma semilla de mundo existente para todos. Bosque, Desierto, Tundra y Costa no tienen presencia compartida en R30.
- Ciudad: los jugadores autenticados se ven entre sí sin colisión.
- Wild: los jugadores comparten mundo, pero sólo reciben presencia dentro de su interés visual por sectores cercanos.
- El username se muestra siempre sobre el actor y se trata como texto no confiable.
- Personaje, acompañante y cosméticos son visuales; el acompañante se muestra cuando su jugador está dentro del interés visual.
- Sin sesión: espectador de solo lectura; ve el juego en vivo y la invitación principal es iniciar sesión/registrarse. No recibe actor ni puede mandar movimiento.
- No hay límite por lobby o zona wild inicial. El servidor tendrá un tope global de 100 conexiones simultáneas como decisión de escasez/demanda.
- Colyseus Cloud es el hosting inicial elegido.
- Chat queda explícitamente fuera de R30, pero la identidad y lifecycle se diseñan para no impedir una fase futura de chat con moderación, bloqueo, reporte y rate limiting propios.

### Capacidad aprobada

El tope global de 100 incluye jugadores y espectadores. No hay cola ni cupos separados por área en R30.

## Confianza y autoridad

```text
Browser
  → WebSocket: intención efímera de movimiento
  ← WebSocket: snapshot y deltas de presencia visibles

Colyseus server
  → verifica JWT de Supabase
  → lee identidad autorizada en servidor
  → conserva presencia sólo en memoria
  ✗ no escribe presencia, posiciones, slots, tokens ni recompensas en Supabase
```

- El cliente nunca es autoridad de `userId`, username, posición, área, personaje, acompañante o cosmético.
- El navegador no recibe secretos ni usa service-role.
- El servidor valida JWT, límites, área, velocidad, frecuencia y formato de cada intención.
- La posición, presencia y acompañante se descartan al desconectar; no se restauran desde `localStorage` ni se escriben a la base.
- `slots`, economía y ownership siguen fuera del alcance del servicio. La plaza de R26/R28 conserva su lectura y Realtime actuales, sin duplicar suscripciones.

## Sin polling

- Colyseus WebSocket entrega snapshot inicial y deltas push.
- No habrá consultas HTTP periódicas para presencia o posiciones.
- El tick del servidor actualiza estado efímero; no es polling del cliente.
- La reconexión usa backoff acotado y no crea conexiones duplicadas.

## Límites técnicos iniciales

- Un proceso y hasta 100 conexiones totales; medir primero con 50 jugadores autenticados y espectadores separados.
- Ciudad: visibilidad completa dentro de la sala.
- Wild: sectores y vecinos; no se transmite el mundo entero ni actores a distancia infinita.
- Movimiento validado por el servidor: 3,75 casillas/s caminando, 7,5 corriendo, intervalo mínimo de 240 ms/100 ms y ráfaga máxima de 10 intenciones por segundo.
- Si se supera la capacidad: rechazar/encolar de modo explícito; no crear otra copia de la semilla sin una decisión de producto.

## Estructura propuesta

```text
services/
  realtime/
    src/
      rooms/
      auth/
      presence/
      protocol/
    Dockerfile
    package.json
    compose.yaml             # sólo desarrollo local
src/features/wildlands/
  multiplayer/
    api/                    # adaptador Colyseus
    domain/                 # puerto, contrato y reconciliación de área
```

`WildlandsGame` recibe un puerto de actores remotos. No importa Colyseus, Supabase ni detalles de socket. Los actores remotos no bloquean colisión/pathfinding, no reciben interacción ni alteran puertas, viajes o recompensas.

## Docker y despliegue

- Docker empaqueta el servidor Node/Colyseus con versiones reproducibles para local, CI y producción.
- Cloudflare Pages sigue sirviendo el frontend; el servidor WebSocket es un servicio separado en Colyseus Cloud.
- Secretos sólo se inyectan como variables de entorno del hosting. No entran a la imagen, Git ni Vite.
- `docker compose` no añade Redis al primer despliegue. Redis/shared presence queda para la futura división horizontal entre procesos.
- Colyseus Cloud parte de USD 15/mes según su página de precios; validar región, plan y coste real antes de activar facturación.

## Dependencias instaladas

- `@colyseus/core`, `@colyseus/ws-transport` y `@colyseus/schema`, sólo en `services/realtime`.
- `@colyseus/sdk`, sólo para el adaptador cliente de WildLands.
- Docker, como empaquetado del servicio, no como dependencia de frontend.

## Verificación realizada

- Protocolo: guest sin actor, JWT inválido como guest, reemplazo de sesión, spawn autoritativo posterior a `presence:ready`, anti-spam, secuencias repetidas, límite de 100 e interés spatial/leave.
- Seguridad: sin escrituras de Supabase, service-role, secretos, polling ni HTML inseguro en el adaptador.
- Integración: `WildlandsGame` usa un puerto de presencia; no importa Colyseus ni Supabase. Los actores remotos no bloquean ni reciben interacción.
- Carga: preflight reproducible de 50 jugadores (`npm run test:load` en `services/realtime`).
- Manual local: dos clientes autenticados y un espectador; ciudad, Pradera, carrera, click-path, entrada/salida y portal oeste a Pradera. Las puertas de Costa, Tundra, Bosque y Desierto se bloquean mientras presencia esté activa, porque no son zonas compartidas R30.

## Pendiente de despliegue

- Crear el servicio en Colyseus Cloud, cargar variables de entorno y configurar health checks internos.
- Publicar la URL `wss://` resultante como `VITE_REALTIME_URL` en el build de Cloudflare Pages.
- Ejecutar una prueba de aceptación con dos cuentas y un espectador en el entorno Cloud antes de abrir el PR de promoción.

## Criterios de aceptación

- Un usuario autenticado aparece, se mueve y desaparece en ambos escenarios compartidos.
- Un espectador ve la escena viva sin actor ni capacidad de mutación.
- La misma semilla persiste para todos; sectores son optimización de visibilidad, no instancias de producto.
- Se respetan AGENTS.md, INVARIANTS y TRUST_BOUNDARY.
- No hay polling, escrituras de cliente a base, secretos en frontend ni dependencia invertida hacia el motor.
- Docker build, pruebas de protocolo/seguridad, typecheck, lint, build y carga pasan antes de PR.

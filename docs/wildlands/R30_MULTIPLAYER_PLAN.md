# R30 — Presencia multijugador efímera

> Estado: plan aprobado; sin implementación ni dependencias añadidas.
> Base: R29 fusionada en `migration` mediante merge commit `f6d6d80`.

## Objetivo

Hacer visible la presencia multijugador en Ciudad Corazón y la zona wild inicial sin introducir autoridad persistente en el navegador ni cambiar economía, ownership, auth de Supabase, RLS, migraciones, RPCs o Edge Functions.

## Decisiones de producto aprobadas

- Una sola Ciudad Corazón y una sola zona wild inaugural; ambas usan la misma semilla de mundo existente para todos.
- Ciudad: los jugadores autenticados se ven entre sí sin colisión.
- Wild: los jugadores comparten mundo, pero sólo reciben presencia dentro de su interés visual por sectores cercanos.
- El username se muestra siempre sobre el actor y se trata como texto no confiable.
- Personaje, acompañante y cosméticos son visuales; el acompañante se muestra cuando su jugador está dentro del interés visual.
- Sin sesión: espectador de solo lectura; ve el juego en vivo y la invitación principal es iniciar sesión/registrarse. No recibe actor ni puede mandar movimiento.
- No hay límite por lobby o zona wild inicial. El servidor tendrá un tope global de 100 conexiones simultáneas como decisión de escasez/demanda.
- Colyseus Cloud es el hosting inicial elegido.
- Chat queda explícitamente fuera de R30, pero la identidad y lifecycle se diseñan para no impedir una fase futura de chat con moderación, bloqueo, reporte y rate limiting propios.

### Open question de capacidad

**INFERENCE:** el tope global de 100 debe incluir espectadores, porque consumen sockets, CPU y ancho de banda. Si producto quiere reservar cupos para usuarios autenticados, esa política deberá definirse antes de implementar la cola/rechazo de conexiones.

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
- Frecuencia inicial a decidir mediante prueba de carga; objetivo de diseño: movimiento suave sin saturar 375 px.
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
    api/
    state/
    domain/
    engine/
```

`WildlandsGame` recibe un puerto de actores remotos. No importa Colyseus, Supabase ni detalles de socket. Los actores remotos no bloquean colisión/pathfinding, no reciben interacción ni alteran puertas, viajes o recompensas.

## Docker y despliegue

- Docker empaqueta el servidor Node/Colyseus con versiones reproducibles para local, CI y producción.
- Cloudflare Pages sigue sirviendo el frontend; el servidor WebSocket es un servicio separado en Colyseus Cloud.
- Secretos sólo se inyectan como variables de entorno del hosting. No entran a la imagen, Git ni Vite.
- `docker compose` no añade Redis al primer despliegue. Redis/shared presence queda para la futura división horizontal entre procesos.
- Colyseus Cloud parte de USD 15/mes según su página de precios; validar región, plan y coste real antes de activar facturación.

## Dependencias autorizadas, aún no instaladas

- `@colyseus/core` y `@colyseus/schema`, sólo en `services/realtime`.
- `colyseus.js`, sólo para el adaptador cliente de WildLands.
- Docker, como empaquetado del servicio, no como dependencia de frontend.

## Pruebas requeridas

- Guest observa y no crea actor ni puede enviar movimiento.
- JWT inválido o expirado no obtiene presencia autenticada.
- Username hostil se dibuja como texto literal.
- Teletransporte, velocidad imposible, payload malformado y spam se rechazan.
- Dos jugadores de ciudad se ven y se atraviesan.
- En wild, jugadores lejanos no se reciben y aparecen al cruzar sectores de interés.
- Viaje, logout, reconexión, pestaña oculta y cierre limpian presencia sin duplicados.
- Ningún módulo de R30 hace una escritura de Supabase o conserva estado autoritativo en navegador.
- Carga: 50 jugadores autenticados en ciudad y distribución wild; confirmar FPS y red en 375 px antes de subir a 100.

## Criterios de aceptación

- Un usuario autenticado aparece, se mueve y desaparece en ambos escenarios compartidos.
- Un espectador ve la escena viva sin actor ni capacidad de mutación.
- La misma semilla persiste para todos; sectores son optimización de visibilidad, no instancias de producto.
- Se respetan AGENTS.md, INVARIANTS y TRUST_BOUNDARY.
- No hay polling, escrituras de cliente a base, secretos en frontend ni dependencia invertida hacia el motor.
- Docker build, pruebas de protocolo/seguridad, typecheck, lint, build y carga pasan antes de PR.

# R30 — Respaldo de producción y handoff

> Estado: cerrada y publicada el 2026-09-15.
> Alcance: presencia multijugador efímera de Ciudad Corazón y Pradera Brisa.

## Resultado publicado

- El frontend se sirve desde Cloudflare Pages en `pokeswap.lol` y `www.pokeswap.lol`.
- El servicio de presencia es un proceso Node/Colyseus separado en Colyseus Cloud. La instancia inicial es única, en Miami, con tope global de 100 conexiones que incluye espectadores.
- La implementación R30 inicial se fusionó mediante PR #16. Los arreglos operativos se fusionaron a `main` mediante PR #19 y PR #20.
- El servidor y el cliente se comunican por WebSocket. La comprobación final de producción obtuvo `101 Switching Protocols` desde el origen público oficial.

## Límites de producto y confianza que siguen vigentes

- Sólo Ciudad Corazón y Pradera Brisa son áreas compartidas. Los sectores wild son interés visual; no son instancias de producto.
- Invitados son espectadores de solo lectura: no reciben actor, ni movimiento, ni mutaciones.
- No hay chat, combate, captura, trading, recompensas ni cambios de economía en R30.
- El cliente sólo manda intención de dirección. El servicio deriva y confirma posición, área, velocidad, secuencia y presencia.
- No hay polling, escrituras de cliente a Supabase ni persistencia de posiciones, presencia, cosméticos o acompañantes.
- `WildlandsGame` continúa aislado de Colyseus y Supabase mediante el puerto de actores remotos.
- Usernames se dibujan como texto literal, nunca HTML.

## Arquitectura operativa

```text
Cloudflare Pages (cliente compilado)
  └─ VITE_REALTIME_URL desde GitHub Actions / variable de repositorio
       └─ Colyseus Cloud (services/realtime)
            ├─ verifica JWT con Supabase usando clave publishable
            ├─ mantiene actores sólo en memoria
            └─ entrega snapshots y deltas WebSocket
```

El servicio no necesita ni debe recibir service-role, JWT secret, credenciales de base de datos ni tokens de despliegue en el repositorio.

## Configuración de hosting

### Colyseus Cloud

- Repositorio y rama de despliegue: `feat/wildlands-r30-cloud-deploy` durante el cierre de R30. La rama quedó integrada en `main` mediante PR #19 y #20.
- Root directory: `/services/realtime`.
- Install command: `npm ci`.
- Build/verification command: `npm test`.
- El manifiesto `services/realtime/ecosystem.config.js` es requerido por Cloud y usa `src/index.js`.
- Dependencia de runtime requerida por Cloud: `@colyseus/tools`.
- Variables de runtime: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS` y `NODE_ENV`. Nunca documentar aquí sus valores secretos.
- `ALLOWED_ORIGINS` debe contener únicamente las URLs públicas oficiales separadas por coma. El servicio también incluye explícitamente los dos dominios oficiales para no depender de que el proceso hijo de Cloud propague `NODE_ENV` de forma consistente.

### Cloudflare Pages / GitHub

- La fuente efectiva de `VITE_REALTIME_URL` es la variable de repositorio de GitHub inyectada por `.github/workflows/ci.yml` y `.github/workflows/deploy.yml` durante el build.
- Cambiar una variable sólo en la UI de Cloudflare no modifica un bundle ya generado por GitHub Actions.
- El endpoint del servicio es público por diseño, pero no debe confundirse con un secreto. El token de despliegue de Colyseus sí es secreto y no debe compartirse en conversaciones, Git ni logs.

## Lifecycle de jugadores

- Al entrar, el servidor emite el spawn autoritativo después de `presence:ready`; el cliente no supone una coordenada local como verdad.
- Un segundo navegador autenticado del mismo usuario reemplaza la sesión anterior de forma segura.
- F5 o una caída breve: la última posición/área se conserva sólo en memoria durante 15 segundos. Sólo el mismo `userId` autenticado puede recuperarla.
- Pasados 15 segundos, al reiniciar el servicio o al escalar a otra instancia, la posición se descarta y el jugador vuelve al spawn. Esto es deliberado: R30 no persiste posiciones.
- Minimizar u ocultar la pestaña pausa render e input, pero conserva el socket de presencia. El actor sigue visible y no puede moverse en segundo plano.
- Si el navegador o la red realmente cierran el socket, entra en la ventana efímera de recuperación anterior.

## Incidentes resueltos durante el despliegue

| Síntoma | Causa | Resolución permanente |
|---|---|---|
| Producción sin personaje ni movimiento | Cloud no detectaba el manifiesto/proceso y faltaba el tooling de runtime | `ecosystem.config.js` descubrible, `@colyseus/tools` instalado y validado |
| WebSocket 403 pese a sesión válida | Política de origin y entorno Cloud no coincidían con el proceso WebSocket | Lista explícita de los dos dominios oficiales, sin abrir origins arbitrarias |
| Click recorría una sola casilla | Un acknowledgement anterior podía rebobinar el paso local siguiente | El motor conserva el paso optimista en curso y sólo reconcilia autoridad nueva |
| F5 devolvía al spawn | El actor se eliminaba inmediatamente al cerrar el socket | Caché de reconexión en memoria, 15 segundos, por `userId` autenticado |
| Minimizar hacía desaparecer el actor | La vista suspendía/cerraba presencia cuando el documento quedaba oculto | Ocultar pausa juego/input, pero mantiene presencia |

## Verificación ejecutada

- Cliente: `npm test` (386 pruebas), `npm run typecheck` y `npm run build` aprobados durante el cierre.
- Servicio: `npm test` (23 pruebas) y `npm run test:load` con preflight de 50 conexiones aprobados.
- Seguridad: JWT inválido como guest, guest sin actor, límite global, anti-spam, secuencias repetidas, interest wild, reemplazo de sesión, F5 efímero y origins oficiales cubiertos por pruebas.
- Producción: WebSocket validado desde el dominio público oficial; pruebas manuales con dos jugadores, espectador, Ciudad, Pradera, carrera, click-path, portal, F5 y minimizado.

## Operación y diagnóstico seguro

1. Para una falla de presencia, revisar primero Colyseus Cloud → Deployments y Logs; confirmar que el commit esperado fue desplegado.
2. Revisar Stats de Colyseus: CCU, Rooms, CPU y memoria. No pegar tokens ni valores completos de variables en tickets o chats.
3. Confirmar que el bundle de Cloudflare fue reconstruido con `VITE_REALTIME_URL` desde GitHub Actions al fusionar a `main`.
4. Si falla el WebSocket, probar con una cuenta autenticada desde `pokeswap.lol`; no desactivar la política de origins como atajo.
5. Para rollback, revertir el PR concreto en GitHub con un nuevo merge commit. No usar force-push ni reset destructivo sobre `main`.

## Próxima fase recomendada

Antes de sumar sistemas de juego, hacer una fase corta de beta controlada/operación:

1. Observar uso real, rechazos por límite y CPU/memoria bajo varios jugadores.
2. Definir alertas de disponibilidad y un runbook de incidente sin registrar JWTs ni información personal.
3. Repetir prueba de carga con tráfico de navegador real y medir latencia México/Argentina.
4. Sólo si la métrica lo exige, decidir réplicas, Redis o una segunda región. No habilitarlos por anticipado: cambiarían la autoridad de presencia efímera.

Después de esa fase, elegir una única expansión de producto para R31, por ejemplo una segunda zona compartida o interacciones sociales diseñadas con moderación, bloqueo, reportes y rate limiting desde el inicio. Chat no debe añadirse como efecto colateral de presencia.

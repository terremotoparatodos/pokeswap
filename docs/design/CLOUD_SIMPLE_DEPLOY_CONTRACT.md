# CLOUD — ¿Permite Colyseus Cloud un despliegue stop-then-start controlado? Contrato mínimo y aislamiento del entorno oscuro

**Estado:** solo investigación, lecturas y propuesta. No se modificó producto, Cloud, PM2, SQL hosted, filas, flags, procesos ni entornos. No se crearon servicios ni hubo merge o deploy. `on`, la integración y cualquier cambio operativo **no están autorizados**.

**Ramas:**
- **Esta:** `design/cloud-simple-deploy-0.3`, desde `design/cloud-d5-d8-0.3 @ 19ca9f3`, que sigue congelada.
- **Decisiones del dueño que enmarcan este análisis:**
  - **E1/E7:** aislamiento obligatorio entre el entorno oscuro y la flota pública. Una autoridad **por flota**, no por proceso: los procesos del mismo despliegue comparten su contrato.
  - **E2:** solo opciones; no se apaga ni se mueve nada.
  - **E3:** conservar las filas e inventariar su procedencia.
  - **E4:** verificar stop-then-start en Cloud.
  - **E5:** no implementar C-2 ni C-3.
  - **E6:** el contrato de plataforma para el despliegue simple, antes de cualquier failover autónomo.

**Convenciones:**
- **FACT-OFICIAL:** documentación oficial, consultada el 2026-10-06.
- **FACT-CÓDIGO:** código fuente oficial del agente de Cloud (`@colyseus/tools`, MIT) o del repo.
- **FACT-LECTURA:** configuración o evidencia local existente, leída sin cambios.
- **MEDIDO-LOCAL:** emulaciones y pruebas locales anteriores, no Cloud.
- **ESTIMADO:** cálculo.
- **CLOUD-NO-COMPROBADO:** sin observación en Cloud.

## 1. Qué permite Cloud

### 1.1 Documentación oficial (FACT-OFICIAL)

| Fuente | Qué dice | Qué **no** dice |
|---|---|---|
| [Deployment · Colyseus Cloud](https://docs.colyseus.io/deployment/cloud) | Usa NGINX y PM2, exige `@colyseus/tools` y un `ecosystem.config.js`; se despliega con `npx @colyseus/cloud deploy` (opciones `--env`, `--remote`, `--branch`, `--reset`, `--preview`) | Estrategia de despliegue, cómo se detiene o reinicia el servidor, rollback, ventanas de mantenimiento |
| [Deployment](https://docs.colyseus.io/deployment) | Graceful shutdown en SIGTERM/SIGINT; en la lista de producción, «Let deploys drain gracefully»; para Cloud, que esos ítems «are handled for you» | Cómo, ni en qué orden |
| [Cloud API](https://docs.colyseus.io/cloud/api) | **Beta, se habilita por equipo a pedido**, y **solo lectura**: aplicaciones, métricas, historial de deploys con estado y logs de salida (`GET /api/v1/applications/{slug}/deploys`), logs de instancia (hasta 256 KB) | «cannot deploy or change settings»: no hay deploy, stop, start, restart, scale ni rollback |
| [Compute plans](https://docs.colyseus.io/cloud/compute-plans) | Tipos de CPU y almacenamiento | Instancias, procesos o despliegues |

**Conclusión oficial:** no hay ningún modo documentado de despliegue «stop-then-start», ni stop o rollback controlables por el cliente, ni una API para operarlos.

### 1.2 Lo que hace el agente de Cloud (FACT-CÓDIGO)

Fuente: `@colyseus/tools` 0.18.3, la versión instalada para el realtime. Hashes y líneas exactas en `evidence/colyseus-tools-agent.txt`. Un resumen de `post-deploy-agent.cjs` en la rama `master` de colyseus/colyseus describe el mismo algoritmo: espera hasta 5 s a que los viejos dejen `online` y espera capacidad antes de reintentar.

Cabecera del agente: «New process(es) are spawned… NGINX configuration is updated so new traffic only goes through the new process… Old processes are asynchronously and gracefully stopped».

**Caminos:**

| Caso | Secuencia | Orden |
|---|---|---|
| **Primer deploy** (`apps.length === 0`) | `pm2.start` | — |
| **Cambia el App Root Directory** (`pm_cwd !== config.cwd`) | `pm2.delete('all')` y después `pm2.start` | **El único camino stop-then-start del agente.** Su disparador no está documentado ni bajo control del cliente (OPEN QUESTION / CLOUD-NO-COMPROBADO) |
| **Cualquier otro deploy** (rolling) | (1) arranca `ceil(instances/2)` procesos nuevos; (2) apenas PM2 los da por listos, escribe `/etc/nginx/colyseus_servers.conf` **solo con los nuevos**; (3) **espera fija de 1,5 s** «to ensure NGINX is updated & reloaded»; (4) `pm2.stop` o `restart` de los viejos, que esperan su salida hasta `kill_timeout`; (5) reconcilia y `pm2 save` | **Start-then-stop, siempre** |

**Lo que el agente no da:**
- **Ninguna clave de configuración cambia el orden.** El agente solo traslada `max_memory_restart`, `kill_timeout`, `kill_retry_time`, `wait_ready`, `merge_logs`, `cron_restart`, `autorestart`, `exp_backoff_restart_delay` y `restart_delay`.
- **`instances` vale como mínimo 1,** y el pico es `instances + ceil(instances/2)`: con 1 instancia hay **2 procesos** durante el deploy.
- **La recarga de NGINX no se confirma.** El agente solo escribe el archivo; el comentario del propio código propone un `fswatch` externo, y la confirmación es una **espera** de 1,5 s.
- **El agente fuerza `wait_ready = true`** y, sin `kill_timeout`, pone **30 minutos**.

### 1.3 Configuración observable del proyecto (FACT-LECTURA)

- **`services/realtime/ecosystem.config.js`** en `640a4f3` y `19ca9f3`: `instances: 1`, `autorestart: true`, `min_uptime: '10s'`, `max_restarts: 10`. **Sin** `kill_timeout`, así que en Cloud valen los 30 min del agente. Sin `listen_timeout`.
- **CLOUD STARTUP-1** (`7823f14`, congelada, del ecosistema): agrega `wait_ready: true`, `listen_timeout: 20000` y `kill_timeout: 30000`. No cambia el orden.
- **`ready` llega antes que la autoridad:** en Cloud, `Server.listen` de `@colyseus/core` delega en `@colyseus/tools.listen`, que hace `process.send("ready")` al enlazar el socket. En `realtimeServer.js` la activación de la autoridad es **posterior**. Para el agente, `ready` significa «escucha», no «tiene autoridad».
- **El cliente** no dispone de SSH, PM2 ni NGINX de Cloud. Lo único observable es el historial de deploys y los logs (API beta, a pedido), más `/version` público de la app (commit y `startedAt`) por el camino público.

### 1.4 Veredicto (E4)

**Cloud no permite hoy un despliegue stop-then-start controlado y comprobable** con lo documentado ni con la configuración observable. El despliegue normal es start-then-stop. La terminación del proceso viejo la confirma PM2 **dentro** del agente, sin exponérsela al cliente. La publicación de la ruta se «confirma» con una espera de 1,5 s, no con una verificación.

El único camino stop-then-start del agente («App Root Directory changed») no está documentado como función y no lo pude comprobar: no se debe usar como mecanismo sin una confirmación escrita de Colyseus.

## 2. Secuencia verificable que necesitaríamos (contrato del despliegue simple, E6)

Ninguna espera cuenta como confirmación de terminación, y ningún `ready` cuenta como prueba de enrutamiento.

| Paso | Evidencia exigida | ¿Lo da Cloud? |
|---|---|---|
| **S1 Retirar el proceso viejo** (SIGTERM o SIGINT) | — | Solo dentro de un deploy y **después** de arrancar el nuevo |
| **S2a Autoridad del viejo terminada** | Su fila en `world_presence_hosts` pasa a `stopped`: el propio proceso la detiene en `onShutdown`, y queda fuera de toda escritura (`host_inactive`). Verificable leyendo la autoridad | **Sí, en la app:** es nuestro contrato SQL. Su lectura necesita a alguien autorizado (hosted) o una operación de lectura nueva |
| **S2b Proceso viejo terminado** | Que salió, o que lo mató PM2 tras `kill_timeout` | **No expuesto.** PM2 lo sabe pero el cliente no lo ve. Lo más cerca son los logs de instancia (API beta) con la línea de cierre: observación posterior, no un gate |
| **S3 Iniciar el nuevo solo después de S2** | — | **No:** el agente arranca el nuevo primero |
| **S4 Nuevo listo con autoridad** | Escucha **y** fila `active` con su generación | Hoy `ready` se envía antes de activar (§1.3); hace falta que «listo» incluya la activación |
| **S5 Publicar su ruta** | Upstream de NGINX con solo el nuevo, y **recarga confirmada** | El agente escribe el upstream; la recarga no se confirma (espera de 1,5 s) |
| **S6 Verificar por el camino público** | `GET /version` público devuelve el commit y el `startedAt` del nuevo en *k* sondas seguidas, más un join real colocado. Es evidencia, no prueba absoluta: un keep-alive o un socket viejo pueden seguir en el proceso viejo hasta que este cierre | **Sí, lo podemos sondear nosotros** (la app ya expone `/version`) |

**Lo que falta del lado de la plataforma:** ordenar S1→S2b→S3, exponer S2b y confirmar S5. Tal como está, **no se puede verificar** en Cloud.

## 3. Si el arranque falla, y rollback

**Con el agente actual (rolling), FACT-CÓDIGO e INFERENCE:**
- **Si el nuevo nunca da `ready`:** `pm2.scale` o `restart` no llaman a su callback hasta `ready` o `listen_timeout`. Con `wait_ready`, PM2 lo da por listo **al vencer** `listen_timeout` (MEDIDO-LOCAL, STARTUP-1). El agente escribe NGINX con el nuevo y detiene al viejo **aunque el nuevo no tenga autoridad ni sirva**. Eso es D5 con deploy degradado, y requiere intervención.
- **Si el nuevo muere al arrancar:** la `autorestart` de PM2 lo reintenta con generación nueva cada vez (D2 de ROLLOUT-1). El viejo ya fue detenido.
- **Rollback:** la documentación no ofrece ninguno. Lo único disponible es **volver a desplegar** una versión anterior con la CLI (`--branch` o `--remote`), que es otro rolling deploy. Tarda lo que un deploy y repite los mismos riesgos (CLOUD-NO-COMPROBADO).

**Con un stop-then-start (si existiera):**
- Un fallo de arranque deja **sin servicio hasta el rollback**, porque el viejo ya terminó.
- El rollback tiene que ser **arrancar el artefacto anterior conservado**, con la misma secuencia S3–S6. Es seguro para la autoridad: el viejo quedó `stopped` (terminal) y el rollback toma una generación nueva.
- Corte total = deploy fallido + rollback.

## 4. Interrupción: medido frente a estimado

| Componente | Valor | Clase |
|---|---|---|
| Arranque hasta `listening` | 6,2–6,8 s con CPU libre; 16,6–20,0 s con contención | MEDIDO-LOCAL (STARTUP-1, emulación PM2 + NGINX + agente) |
| 502 por cambio de upstream antes de que el nuevo escuche | 3–3,8 s con la configuración por defecto; 9,8 s con acquire lento | MEDIDO-LOCAL (ROLLOUT-1, D1) |
| Corte por deploys superpuestos | unos 11,3 s | MEDIDO-LOCAL (ROLLOUT-1, D3) |
| Activación del nuevo → cierre de las sesiones del viejo | unos 3,4 s, por el periodo de renew | MEDIDO-LOCAL (D5/D8, `19ca9f3`) |
| Cierre → recolocación tras el cambio de ruta | unos 3,2 s, con un cambio a los 3 s | MEDIDO-LOCAL (D5/D8) |
| Espera fija del agente antes de detener a los viejos | 1,5 s | FACT-CÓDIGO (es una espera, no una confirmación) |
| Drain y flush del viejo al apagarse | hasta 3 s (`SHUTDOWN_LOCATION_FLUSH_MS`) | FACT-CÓDIGO |
| Backoff del cliente al reconectar | 0,5 s y luego duplicando, con tope 10 s | FACT-CÓDIGO |
| **Stop-then-start completo, sin fallos** | drain y salida del viejo (≤ 3 s) + arranque (6–20 s) + activación (~1 RTT) + recarga de ruta (desconocida) + reintento del cliente (0,5–4 s), unos **10–30 s** | **ESTIMADO** (CLOUD-NO-COMPROBADO) |
| Rolling actual sin fallos | segundos (cambio de upstream + 1,5 s + reconexión), con las ventanas D5 de dos activos | ESTIMADO, a partir de las mediciones locales |

**«Interrupción aceptable»** es tu decisión (F-4). Como referencia, un deploy simple sin solapamiento costaría del orden de 10–30 s sin servicio en cada deploy (ESTIMADO), a cambio de eliminar las ventanas con dos hosts activos.

## 5. Aislamiento del entorno oscuro (E2) y filas existentes (E3)

### 5.1 Estado (FACT-LECTURA, `19ca9f3` §2)

- El entorno oscuro (`e09591a`, shadow) usa la autoridad **hosted** y tiene una fila de host activa (generación 2).
- Un join de un tester también **reclama y guarda** filas de jugador en ese proyecto.
- Además usa ese mismo backend para WORLD × SKILLS (dark launch RC-0.3: gate cerrado, testers Titan123 y terremototw).

### 5.2 Opciones (ninguna ejecutada)

| Opción | Qué aísla | Coste / riesgo | Requiere |
|---|---|---|---|
| **I-1 Entorno oscuro con `WORLD_LOCATION_PERSISTENCE=off`** en el mismo proyecto | Su host deja de participar en la autoridad (no adquiere ni activa, no hace claims ni saves; FACT-CÓDIGO: `prepare` solo actúa si la persistencia está activa) | Se pierde la observación de ubicación en shadow. WORLD × SKILLS sigue probándose contra producción. Su fila de host vieja queda sin renovar y vence. **Requiere reiniciar el entorno oscuro** (cambio operativo, a autorizar) | Tu aprobación y una ventana de reinicio |
| **I-2 Proyecto Supabase separado para el entorno oscuro** | Todo: autoridad, filas y economía | Hace falta un proyecto, migraciones, la función Edge, secretos y testers. Hay que verificar si el plan lo permite **sin coste** antes de crearlo; no se crea nada todavía. Las pruebas oscuras dejan de usar datos y cuentas de producción, que era el propósito del dark launch | Tu aprobación y verificar el plan de Supabase |
| **I-3 Separación en el tiempo**: no correr el entorno oscuro mientras exista una flota `on` | Mientras se respete | Frágil: un reinicio olvidado del entorno oscuro desplaza a la flota pública (D8) | Disciplina operativa; **no recomendado** como única medida |
| **I-4 Espacio de nombres por flota en la autoridad** (C-6) | Varias flotas en un proyecto | Esquema y funciones nuevas; producto y SQL | Fuera de este alcance |

**Recomendación:** I-1 **antes** de cualquier `on` sobre el proyecto hosted, más I-2 solo si querés seguir observando ubicación en shadow. En cualquier caso, un inventario (§5.3) antes de `on`.

### 5.3 Filas existentes (E3): procedencia y tratamiento

**Procedencia** (FACT-LECTURA, monitores y líneas base locales; **sin** leer hosted):

| Momento (UTC) | Evidencia | Filas de ubicación en hosted |
|---|---|---|
| 2026-10-02 (LOCATION-3B) | Smoke vía la función Edge: una fila creada y **borrada** | 0 al terminar |
| 2026-10-02 20:32 | `db-baseline.json` del entorno oscuro 80c6ab8, después de reiniciar | **0** |
| 2026-10-02 20:32 → 10-03 04:46 | Monitor del entorno oscuro **80c6ab8** (shadow, claims v1): 24 claims y 48 filas aplicadas; pico de 2 jugadores | escritas por el entorno oscuro |
| 2026-10-03 | Monitor del entorno oscuro **4d0ab64** (shadow): 11 claims y 14 filas aplicadas | escritas por el entorno oscuro |
| 2026-10-05 00:31 → 01:01 | Entorno oscuro **e09591a** (shadow, claims con clave): 6 claims y 15 filas aplicadas. La lectura de hoy da los mismos contadores, así que no hubo escrituras desde entonces | — |
| 2026-10-05 (`BASELINE.md`) | «ubicación **2 filas** (md5 de 11 columnas 07d66bd1)» | **2** |

**INFERENCE:**
- El único escritor desde la fila 0 fue el entorno oscuro en shadow: la 0.2 pública no usa estas tablas y el smoke de 3B borró su fila.
- Las 2 filas corresponden a **cuentas de tester** que jugaron en el entorno oscuro: hubo dos jugadores como máximo y dos testers.
- **No está verificado** contra hosted: no hubo ninguna lectura de hosted en esta etapa.

**Inventario propuesto** (lectura que debe hacer alguien autorizado; **no ejecutado**). Una consulta, sin escribir:

```sql
SELECT l.user_id, l.owner_generation, l.epoch, l.seq, l.area_id, l.updated_at,
       (l.owner_generation = 0) AS written_by_v1_claims,         -- 80c6ab8 / 4d0ab64 (WORLD LOCATION-2)
       h.state AS owner_host_state, h.created_at AS owner_host_created
FROM public.world_player_locations l
LEFT JOIN public.world_presence_hosts h ON h.generation = l.owner_generation
ORDER BY l.updated_at;
```

Hay que cruzar `user_id` con las dos cuentas de tester y no publicar los identificadores en el repo.

**Tratamiento propuesto, sin borrar, sobrescribir ni reparar:**
- **T-1, recomendado:** conservar las filas y etiquetarlas como «origen: entorno oscuro» en un registro operativo **fuera** de la base. No hay columna para eso, y agregarla es un cambio de esquema.
- **T-2:** antes de `on`, decidir de forma explícita si la flota pública puede restaurarlas. Su primer claim con clave mayor las tomaría y restauraría la casilla, como en D8_SHADOW_WRITES_SHARED_ROW. Solo afecta a 2 cuentas de tester y son posiciones (INFERENCE).
- **T-3:** si se prefiere que la flota pública empiece sin ellas, hace falta un procedimiento aparte, con copia previa y autorización, que **no** se propone ejecutar ahora.

## 6. Alternativas si Cloud no ofrece stop-then-start comprobable

| Alternativa | Qué logra | Coste | Requiere |
|---|---|---|---|
| **A-1 Pedirle a Colyseus** confirmación escrita de: un modo de despliegue con parada previa; el disparador y la garantía del camino «App Root Directory changed»; si NGINX se recarga con confirmación; y la habilitación de la API beta de solo lectura (historial de deploys y logs) | Saber si el contrato S1–S6 es posible en su plataforma | Tiempo de soporte | Tu aprobación para contactarlos |
| **A-2 Traspaso de autoridad en la app**: el nuevo no activa hasta ver `stopped` la fila del host anterior | Stop-then-start **de la autoridad**, aunque los procesos se solapen: no hay dos activos | Producto y diseño. Durante la espera, los joins al nuevo reciben 4503 y reintentan. **Si el viejo muere sin detenerse, no hay prueba de su muerte** (H2): necesita la confirmación de PM2 (S2b) o una intervención | Diseño aparte; **no** es C-2 ni C-3. Se propone solo para evaluar |
| **A-3 Hosting propio (VM) con PM2 y NGINX bajo nuestro control** | S1–S6 completos y verificables (`pm2 stop` espera la salida, recarga de NGINX comprobable) | Costo y operación; **servicio nuevo, posiblemente pago**: no se crea nada | Tu decisión explícita |
| **A-4 Aceptar el rolling actual con controles operativos**: deploys serializados, nunca superpuestos, y `/version` sondeado por el camino público después de cada deploy | Reduce D3 y da evidencia de ruta | Las ventanas D5 siguen, y un deploy abortado sigue sin recuperación automática | Procedimiento operativo |

## 7. Decisiones que requieren tu aprobación

| # | Decisión | Recomendación |
|---|---|---|
| F-1 | Contactar a Colyseus (A-1) con las preguntas de §6 y pedir la API de solo lectura | Sí: es la única forma de saber si S1–S6 son posibles en Cloud |
| F-2 | I-1 (entorno oscuro con persistencia de ubicación `off`) antes de cualquier `on` sobre el proyecto hosted; el reinicio es un cambio operativo a programar | Sí, antes de `on` |
| F-3 | I-2 (proyecto separado), solo si se quiere seguir observando ubicación en shadow; verificar antes el coste | Opcional |
| F-4 | Interrupción aceptable por deploy (por ejemplo ≤ 30 s, sin pérdida de la última posición confirmada) | Tu definición; los valores de §4 son estimaciones |
| F-5 | Inventario de solo lectura en hosted (§5.3) por alguien autorizado, y T-1 (conservar y registrar el origen) | Sí; T-2/T-3 se deciden antes de `on` |
| F-6 | Si Cloud no ofrece el contrato: evaluar A-2 como diseño (no implementación), A-3 o A-4 | Esperar la respuesta a F-1 |

**Sin promesas.** Ninguna de estas opciones promete un failover correcto basado en leases, readiness o esperas.

## 8. Entorno

- **Worktree** `pokeswap-deploy`, solo documentos.
- **Lecturas hechas:** el paquete `@colyseus/tools` y `@colyseus/core` instalados, la documentación oficial, la configuración del repo y la evidencia local del entorno oscuro.
- **No se tocaron** hosted, Cloud ni procesos.

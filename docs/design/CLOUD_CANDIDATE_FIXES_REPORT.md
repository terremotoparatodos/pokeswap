# CLOUD — Correcciones acotadas sobre el candidato combinado (H-1, typecheck, L1)

**Estado:** rama congelada para revisión. No está integrada, no hubo deploy, la toma por intento (P-1) no se implementó y no se tocó nada hosted.

**H-2 sigue BLOQUEANDO la integración**, hasta que se resuelva y se revise el candidato final. Esta rama no lo investiga ni lo mitiga: no tiene heurística de gracia ni ningún cambio de promoción o standby más allá de H-1.

- **Rama:** `fix/cloud-candidate-h1-typecheck-0.3`, desde `feat/cloud-join-order-2-0.3 @ 886ff4d`, que sigue congelada.
- **Convenciones:** **FACT** (código o prueba ejecutada aquí), **INFERENCE** (deducción), **OPEN QUESTION** (pregunta abierta).

| Commit | Contenido |
|---|---|
| `a284a6e` | H-1: corrección y tests |
| `7580844` | typecheck |
| `e51c811` | L1: secuencia probada (solo tests) |
| *(este)* | Informe y rectificación |

## 1. H-1 — El journal no vuelve a correr después de una promoción

### 1.1 Reproducción sobre `886ff4d` (FACT)

**Causa:**
- El desplazamiento, `#hostChanged`, llama a `drain()`. `drain()` llama a `location.shutdown()`, que hace `journal.stop()` y `flushAll()`.
- La promoción del standby, `#promote`, instala la identidad nueva y vuelve a admitir jugadores, pero **nunca** reinicia el timer.
- Por eso el host promovido no guarda checkpoints, no guarda al desconectarse y no reintenta claims.

**Cómo se probó** (`rooms/PresenceRoomJournalLifecycle.test.js`):
- El journal corre sobre el **`setInterval` de producción** que instala `LocationService.start()`.
- El test controla solo el scheduler (timers simulados de `node:test`, únicamente `setInterval`) y el reloj del journal. **No** llama a `tick()` ni detiene el journal a mano.
- El desplazamiento es real: la respuesta de renew de un host más nuevo provoca drain y desplazamiento. La promoción también es real: el sondeo del standby con identidad exclusiva nueva.

**Control negativo contra `886ff4d`** (mismos tests, archivos de producto de `886ff4d`):

| Test | Resultado sin la corrección |
|---|---|
| «after a promotion … checkpoint, urgent disconnect and claim retry» | `AssertionError: after promotion: the CHECKPOINT is saved` (fila `tx/ty = null` frente a `32/20`). Antes del desplazamiento el mismo checkpoint **sí** se guarda: el timer está cableado |
| «one timer only …» | `AssertionError: exactly one tick per second` (0 frente a 5) |
| «LocationService.resume() …» | `TypeError: service.resume is not a function`, porque la API nueva no existe |
| «a definitive shutdown stays definitive …» y «a replaced service is never restarted …» | Pasan en los dos: son guardas de regresión de la corrección |

### 1.2 Corrección

Son 13 líneas en 3 archivos.
- **`LocationService.resume()`** vuelve a arrancar el timer del journal. Se llama desde `#promote`, justo después de `attachHost`, en el mismo tramo síncrono que instala la identidad.
- **`LocationJournal.start()`** sigue siendo idempotente (un solo timer) y **nunca** arranca un journal deshabilitado. Eso cubre el rollback a `off` y un servicio reemplazado.

Cómo queda cada requisito:
- **La promoción vuelve a guardar y reintentar.** FACT: después de una promoción real se guardan el checkpoint, la desconexión urgente y un claim que falló y se reintenta con su clave.
- **No quedan timers duplicados.** FACT: dos ciclos de desplazamiento y promoción dan exactamente un tick por segundo.
- **El apagado definitivo sigue siendo definitivo.**
  - Una promoción que responde tarde, después del SIGTERM, nunca se instala (`shutdownBegun`, que ya existía) y el journal no vuelve a correr.
  - FACT: 0 ticks y `timer === null`.
- **Una respuesta tardía no reactiva un servicio detenido.** El servicio de ubicación reemplazado queda detenido después de una promoción, y un servicio deshabilitado ignora `resume()` y `start()`.

## 2. typecheck

**Reproducción con el mismo runtime, dependencias y configuración.** `node_modules` es la misma junction a int1, con `vue-tsc` 2.2.12 y TypeScript 5.9.3; `package.json`, el lock y `tsconfig*` son iguales. Corrido sobre tres commits:

| Commit | `npm run typecheck` |
|---|---|
| `886ff4d` (candidato) | 5 × TS2550 en `ownerUnreachable.test.ts` |
| `5ca9ccd` (READINESS-3, congelada) | **los mismos 5**, idénticos |
| `0e5842c` (el commit de READINESS-3 que introdujo `.at(-1)` en ese test) | **5** |

**Causa:**
- El test usa `Array.prototype.at`, que `tsconfig.app.json` no declara: su `lib` es ES2020 y `.at` es de ES2022.
- No cambió ninguna interfaz importada: el tipo del array es local al mock del test.
- Ningún archivo de `src`, ni la configuración ni las dependencias, cambió entre `0e5842c` y `5ca9ccd`.

**Corrección mínima (`7580844`):**
- Un helper local `lastJoin()` con acceso por índice, igual que el resto del repo.
- Sin tocar `lib`, sin excluir el test, sin `any` y sin silenciar nada.
- Resultado: typecheck limpio, y el test sigue pasando 5/5.

**Rectificación de lo que se había reportado:**
- **CLOUD READINESS-3** (`docs/design/CLOUD_READINESS_3_REPORT.md` §4, fila Cliente) dice «typecheck sin errores … El cliente no cambió después de estos gates (`0e5842c`)». **Es incorrecto:** el typecheck ya fallaba en `0e5842c` con estos 5 errores. Lo que sí se comprobó entonces (Vitest, eslint, build) no se ve afectado.
- **CLOUD JOIN-ORDER-2** (`CLOUD_JOIN_ORDER_2_REPORT.md` §5 y §10) atribuyó el fallo a READINESS-3 **deduciéndolo** de que el archivo y `tsconfig` no habían cambiado, sin correrlo sobre la base. Esa deducción era insuficiente: un archivo sin cambios puede fallar distinto si cambia algo que importa. Ahora está **comprobado** sobre `5ca9ccd` y `0e5842c` con el mismo entorno. Agregué una nota de errata en ese informe dentro de esta rama.

## 3. L1, con precisión

FACT: tests «L1 sequence (recovery=false/true)» en `rooms/PresenceRoomJoinOrderClaims.test.js` (`e51c811`).

### 3.1 Qué significa «dos hosts activos»

Las **tres** cosas a la vez, durante una ventana acotada:

| Sentido | ¿Se cumple? | Por qué |
|---|---|---|
| Dos procesos que se creen activos | Sí | Los dos `HostLifecycle` están en `active` |
| Dos filas con `state = 'active'` | Sí | |
| Dos hosts elegibles con lease válido según SQL | Sí | `lease_expires_at > now()` en las dos |

**La ventana:**
- `world_presence_activate` solo rechaza cuando hay un host **más nuevo** activo. Un host más viejo activo no impide que el nuevo se active.
- El viejo sigue activo hasta que se entera del nuevo: en su próximo renew (≤ `HOST_RENEW_MS`, 5 s) o con el `newerActive` de **cualquier** respuesta de claim o save.
- INFERENCE: en Cloud esto es la superposición de deploys (D3 de ROLLOUT-1). No es un estado estable.

### 3.2 Secuencia y qué chequeo rechaza

1. El intento **abandonado** (1) reclama primero en el host **nuevo** B, y toma la fila.
2. El intento **nuevo** (2) llega al host **viejo** A.
3. claim v3 no aplica ningún rechazo de misma página, porque el intento 2 es el **mayor**. Decide entonces con las reglas que reemplaza:
   - **sin recovery**, la regla v1: la clave `(gen A, seq)` es menor que la del dueño, así que responde `superseded`;
   - **con recovery**, la regla v2: `world_presence_owner_state` del dueño es `active`, así que responde `superseded`.
   - En los dos casos llega con `newerActive: true`, y el contador no autoriza ninguna toma.
4. El socket del intento 2 nunca se coloca en A. La fila queda con B y el intento 1.

### 3.3 Qué ve el socket y qué hace el cliente

| | Socket | Cliente (`closePolicy.ts`) |
|---|---|---|
| Sin recovery | **4409** con `closing: 'replaced'` | `replaced`: se detiene y ofrece «Jugar acá». Solo esa acción explícita recupera |
| Con recovery | **4503** con `closing: 'draining'` | `reconnect`: reintenta solo, con `resume` y un intento **nuevo** (3). En el test cae en B, se admite, reclama con clave mayor y la fila vuelve a la página con el intento 3 |

En los dos casos, **la misma respuesta** retira a A: su `newerActive` lo drena y lo desplaza, y su fila queda `stopped`.

### 3.4 Separación

| Aspecto | ¿Ocurre? | Juicio |
|---|---|---|
| Rechazo correcto de un host desactualizado | Sí | **Correcto.** A es el host viejo de una superposición: LOCATION-4 exige que no reclame filas de un host más nuevo y que se retire, y eso ocurre |
| Pérdida de orden de la página | Sí, **transitoria** | La fila queda con el intento 1 en B hasta el próximo claim de la página en B, que tiene clave mayor y la toma. El socket abandonado lo deja el cliente apenas su join resuelve. Ningún actor viejo queda publicado ni guardando a nombre del vigente. **No requiere arreglo** |
| Mensaje incorrecto de reemplazo | Sí, **solo sin recovery** | 4409 «reemplazada» sin otra pestaña ni dispositivo. Es el mismo defecto de LOCATION-4 ante un host desactualizado que READINESS-3 corrigió **detrás de** `WORLD_PRESENCE_RECOVERY` (test de READINESS-3 «a LIVE owner on a newer host … 4409 without it (control)»). No lo introduce el orden de joins |
| Falta de recuperación | Sí, **solo sin recovery** | Hace falta «Jugar acá». Con recovery, el reintento automático recupera |

### 3.5 Arreglo mínimo propuesto (no implementado)

No hace falta código del orden de joins. Lo mínimo es una **regla de despliegue**: no encender `WORLD_JOIN_ORDER=on` sin `WORLD_PRESENCE_RECOVERY=on` en el mismo proceso. Con los dos encendidos, L1 queda en un rechazo correcto, un mensaje correcto (4503) y una recuperación automática.

Si se quisiera forzar en código, la variante mínima tiene dos opciones, y las dos son decisiones del dueño:
- pedir la capacidad de orden entre procesos (`JoinOrderCapability`) solo cuando recovery también está pedido;
- o loguear una advertencia al arrancar con `on` y recovery apagado.

Mapear `superseded + newerActive` a 4503 también sin recovery cambiaría el comportamiento de LOCATION-4 fuera del kill switch, así que no se propone aquí.

**Nada de esto implementa toma por contador ni autoriza la regla de misma página de M0.**

**Dependencia con H-2:** con recovery encendido, el reintento del cliente depende de que el enrutado llegue a un host que sirva. Lo que H-2 está evaluando (un standby no enrutado que queda activo) puede afectar esa recuperación. Esta rama no lo evalúa.

## 4. Gates

Todos en Node 22.23.2 salvo indicación.

| Gate | Resultado (FACT) |
|---|---|
| Focalizados | `PresenceRoomJournalLifecycle.test.js` 5/5 (×3); recovery, presence, hosting y host: 159/159; claims de join order con L1: 15/15; `ownerUnreachable.test.ts` 5/5 |
| Realtime completo, **una corrida sobre el código final** (`e51c811`) | **715 tests, 681 pass, 0 fail, 34 skipped**. Respecto de `886ff4d` (708/674/34) suma 7 tests nuevos: 5 de H-1 y 2 de L1 |
| Los 34 omitidos | **Todos históricos:** 21 «RC-0.3 staging gate» y 13 «WORLD LOCATION-2 staging»; necesitan un stack local de Supabase con variables `RC03_*` |
| Tests nuevos con condición de omisión | Los que cargan `handler.ts` desde Node (dos de join order y uno de READINESS-3) **corrieron**, no se omitieron. Los **cuatro escenarios de staging local** de JOIN-ORDER-2 (`join-order-integration.mjs`: SAME, TWO, NO_V3, SHADOW) son un script aparte, no forman parte de los 715, y no se repitieron porque esa capa no cambió |
| Cliente afectado | `src/features/wildlands/multiplayer`: 15 archivos, 101 tests |
| typecheck completo | **Limpio** (exit 0) |
| Lint | `npx eslint .`: 0 errores; 9 warnings preexistentes de `AuthModal.vue` |
| Build | OK. Solo cambió un test del cliente; se corrió igual |
| `git diff --check` | `886ff4d..HEAD` limpio |
| No repetidos (sus capas no cambiaron) | Batería SQL en Postgres real, Deno, integración con procesos reales y emulación PM2/NGINX |

## 5. Entorno dejado

- **Worktree** `pokeswap-candfix`, con `node_modules` como junction a int1. No se debe correr `vite dev`. `dist/` está construido y queda ignorado.
- **Worktree temporal** `<scratchpad>/tc-5ca9ccd`, desacoplado (detached) en `5ca9ccd`. Se usó solo para comparar el typecheck.
- **Sin tocar:** la rama `886ff4d` y las anteriores, hosted, SQL de producto, flags, secretos, PM2, int1, el entorno oscuro, producción y el ecosistema.

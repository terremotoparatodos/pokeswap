# CLOUD H2 — Cierre de las brechas de validación de la revisión (F1, F2, F3 y la barrera de UNREACHABLE)

**Estado:** solo tests, arneses y documentación. Ningún cambio de producto, SQL versionado, Edge, cliente, dependencias ni configuración: `git diff 575f3f5..HEAD -- services/realtime/src` toca solo un archivo `.test.js`, y `supabase/` y `src/` no cambian. No apareció ningún defecto de producto.

**Ramas:**
- **Esta:** `fix/cloud-h2-validation-gaps-0.3`, desde `fix/cloud-h2-standby-contain-0.3 @ 575f3f5`, que sigue congelada.
- **Insumo:** la revisión independiente `POKESWAP_H2_REVIEW.md` (6 de octubre de 2026), con dictamen RECHAZAR por F1. Las guardas de H2 se dieron por conformes.

**Lo que sigue vigente:** esto es una contención y no autoriza integrar, desplegar ni activar flags. Siguen las advertencias sobre `WORLD_PRESENCE_STANDBY=on` (reintroduce H2, solo para pruebas aisladas), D5, D8 y lo no comprobado en Cloud: `CLOUD_H2_STANDBY_CONTAINMENT_REPORT.md` §4–§6.

**Convenciones:** **FACT** = prueba ejecutada aquí. **INFERENCE** = deducción. **OPEN QUESTION** = sin establecer.

## 1. F1 — CAPABILITY_ROLLBACK verifica el claim efectivo (`298fc1a`)

**Antes**, el escenario aceptaba como éxito un socket colocado, v2 con HTTP 501, v1 con HTTP 200 y el mismo `seq`. Alcanzaba con un HTTP 200 aunque el claim fuera rechazado.

**Ahora** (`scripts/world-location/recovery-integration.mjs`, `capabilityRollback` y `rollbackChecks`):
- se conserva el **orden** correcto: primero el rollback de join order, después el de recovery;
- hay exactamente dos claims, en orden: v2 con **501** y v1 con **200**;
- **la misma clave completa** (`userId`, `generation`, `hostId`, `sessionId`, `seq`) viaja por v2 y por v1, y el `userId` es el del jugador;
- v1 responde **`claimed`** con una época;
- la **fila persistida** pertenece a esa clave (`owner_generation`, `owner_seq`, `owner_session`) y su `epoch` es la época respondida. Se lee de la base, no de la respuesta;
- el jugador queda colocado.

**Controles** (FACT, Node 22.23.2, `evidence/recovery-integration.txt`):

| Control | Qué inyecta | Resultado |
|---|---|---|
| `CONTROL_ROLLBACK_REFUSED_200` (el control de la revisión) | Después de los rollbacks, en la base embebida de la prueba, v1 devuelve `{"status":"unknown_user"}` | La comprobación **anterior** lo habría aceptado (PASS); la nueva lo **rechaza**: «v1 answered claimed» y «the persisted row belongs to that key» fallan y la fila no existe. Nunca PASS |
| `CONTROL_ROLLBACK_TRANSPORT` | Todo v1 falla en transporte (HTTP 503) | Queda registrado el 503 y fallan los chequeos de orden, de `claimed` y de fila: es un **FAIL**, no PASS ni BLOCKED |
| `CONTROL_ROLLBACK_WRONG_ORDER` | Se revierte recovery solo | El script de recovery se niega con su error explícito («run rollback_world_location_join_order.sql first»). Es una **excepción**, que el runner clasifica BLOCKED: no es un resultado de chequeos |
| `CAPABILITY_ROLLBACK` normal | — | **PASS**: v2 con 501, después v1 con 200 y `claimed` en la época 1, misma clave completa y fila de la generación 1 con `seq` 1, la sesión de la clave y la época 1 |

## 2. UNREACHABLE — la barrera previa al crash exige el save aplicado (`298fc1a`)

**Antes**, la barrera esperaba cualquier `location_save` de B con HTTP 200.

**Ahora** (`tileSaved`) exige las dos cosas:
- un `location_save` de B que respondió **`applied` para este jugador**;
- la fila de la base con **exactamente esa casilla** bajo la generación de B.

Si no se cumple dentro del límite, el escenario termina BLOCKED, nunca PASS. El escenario guarda además la fila persistida antes del crash.

**Control `CONTROL_UNREACHABLE_SAVE_NOT_APPLIED`** (FACT, real):
- B reclama y después la época de la fila se mueve en la base de la prueba, así que el save urgente de B al desconectar responde **HTTP 200 con `stale`**.
- La barrera anterior lo habría aceptado; la nueva lo **rechaza**: no está aplicado y la fila no tiene la casilla.

**Repeticiones en serie, con todos los resultados conservados** (`evidence/unreachable-serial-5.{txt,json}`):

| Corrida | Resultado |
|---|---|
| Serie con `--repeat 5` | `UNREACHABLE#1` a `#5`: 5 PASS |
| Corrida completa del arnés, después | UNREACHABLE PASS |
| Fallos o bloqueos | 0 FAIL, 0 BLOCKED |

**La falla inicial de la revisión se conserva y no queda explicada.**
- **Qué observó la revisión (FACT, en su corrida):** con otras validaciones corriendo, UNREACHABLE dio FAIL en dos chequeos. Los dos joins se colocaron sin 4503 y «Jugar acá» devolvió la casilla inicial (31,20) en vez de la guardada (32,20).
- **Hipótesis (INFERENCE, no demostrada):** esos hechos son coherentes con que, al momento de los joins, **no** existiera una fila de B con la casilla guardada. Con la barrera anterior, eso podía pasar desapercibido, porque cualquier HTTP 200 de B bastaba.
- **Qué cambia con la barrera nueva:** esa situación terminaría en **BLOCKED** en la barrera, en lugar de un FAIL atribuido a la lógica de `owner-unreachable`.
- **Lo que no se afirma:** que la causa haya sido la carga ni la infraestructura. Las 5 corridas verdes en serie y la corrida completa **no borran** esa observación. La causa sigue como OPEN QUESTION.

## 3. F3 — AT-9 prueba la lectura única del entorno (`f9dd14e`)

En `PresenceRoomStandbyContainment.test.js`, AT-9 ahora hace, **dentro del mismo proceso hijo**:
1. importa la sala y lee `standbyRequested`;
2. cambia `process.env.WORLD_PRESENCE_STANDBY` al valor opuesto y confirma que el entorno cambiado **sí** se lee distinto;
3. vuelve a leer: el valor capturado al cargar se mantiene.

**Valores cubiertos:** sin definir (off), `on` exacto (on), y como variantes inválidas `ON`, `On`, `" on"`, `"on "`, `true`, `1`, `yes`, `off` y `""` (todas off).

**Control** (`evidence/at9-negative-control.txt`): con una sala modificada solo temporalmente para releer el entorno en cada acceso (restaurada con git, nunca commiteada), AT-9 falla por aserción: «unset: captured at load (off), kept after the environment changed».

## 4. F2 — rango de la advertencia de rollback

Corregí `CLOUD_H2_STANDBY_CONTAINMENT_REPORT.md` §4 y dejé una rectificación:
- **Reintroduce H2 por la vía del standby:** volver con recovery encendido a una versión **sin** `c7167d6` (por ejemplo `ea1284e`).
- **No la reintroducen:** las versiones con `c7167d6` (`c7167d6`, sus commits siguientes y `575f3f5`). Tienen el mismo producto y permiten recovery encendido con el standby apagado **para esta vía**.
- **Encender `WORLD_PRESENCE_STANDBY=on` reintroduce H2.** Las advertencias D5, D8 y Cloud se conservan.

## 5. Gates (FACT, Node 22.23.2)

| Gate | Resultado |
|---|---|
| Focalizado: AT-9 | PASS; el control falla por aserción |
| Arnés con procesos reales, completo (`recovery-integration.mjs`) | **11/11 PASS** (7 escenarios y 4 controles), exit 0 |
| UNREACHABLE en serie | 5/5 PASS |
| Realtime completo | **721 tests, 687 pass, 0 fail, 34 skipped**. Los 34 son históricos: 21 «RC-0.3 staging gate» y 13 «WORLD LOCATION-2 staging» |
| typecheck | Limpio (exit 0) |
| `npx eslint .` | 0 errores; 9 warnings preexistentes de `AuthModal.vue` |
| `git diff --check` | `575f3f5..HEAD` limpio |

No repetí la batería SQL, Deno, cliente, build ni los escenarios de `h2-containment-processes.mjs`: esas capas y ese arnés no cambiaron.

## 6. Entorno

- **Worktree** `pokeswap-h2gaps`, con `node_modules` como junction a int1.
- **Sin procesos vivos:** el arnés mata a sus hijos y cierra sus bases.
- **Inyecciones de los controles:** solo en bases PGlite efímeras de la prueba, nunca en SQL versionado ni en una base real.
- **No se tocó:** hosted, flags, PM2, entornos activos, int1, el entorno oscuro ni producción.

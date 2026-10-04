# WORLD LOCATION-4 — gates de la implementación (Node 22.23.2, Deno 2.8.3)

## Cómo se corrieron

- Todo secuencial, con el binario de Node 22 (no `npm`, que tomaría Node 24).
- Los dos mutation runners nunca corrieron a la vez.
- Una corrida que el runner tuvo que matar por timeout nunca cuenta como detección.

| Corrida | HEAD | Qué cubrió |
|---|---|---|
| 1 | `fd5c921` | todos los gates |
| 2 | `ae1c53e` | solo los gates afectados por ese commit o fallidos en la corrida 1 |

Entre las dos corridas solo cambiaron 5 scripts del arnés (`scripts/world-location/`). El producto, los tests y las migraciones son idénticos, así que los gates de producto de la corrida 1 valen para el código final.

| Gate | Corrida | rc | Duración | Resultado |
|---|---|---|---|---|
| Modelo de orden (`ordering-model.mjs --trazas`) | 1 | 0 | 8 s | salida idéntica a `ordering-model.out.txt` |
| Modelo de ciclo de vida (`host-lifecycle-model.mjs --trazas`) | 1 | 0 | 233 s | salida idéntica a `host-lifecycle-model.out.txt` |
| SQL sobre PGlite (ordering, v1, journal + DB) | 1 | 0 | 65 s | 39/39 |
| Deno `world-authority` (test + `deno check handler.ts`) | 1 | 0 | 1 s | 18/18 |
| Realtime focalizado (host, journal, cierres, hosting, room, bootstrap, adapters, version) | 1 | 0 | 14 s | 161/161 |
| Realtime completo | 1 | 0 | 103 s | 526 pass, 0 fail, 34 skipped (staging: necesitan el stack local de Supabase) |
| Vitest completo | 1 | 0 | 74 s | 204 archivos, 1934 tests |
| Typecheck (`vue-tsc -p tsconfig.app.json`) | 1 | 0 | 13 s | sin errores |
| Lint (`eslint .`) | 1 y 2 | 0 | 15 s / 7 s | 0 errores (9 warnings preexistentes de `vue/attributes-order`) |
| SKILLS drift | 1 | 0 | 0 s | sin drift |
| Build normal + bundle-check + agujas de ubicación | 1 | 0 | 15 s | sin swap; 0 coincidencias de `world_location`, `location_claim`, `session-replaced`, … |
| Build Playtest + bundle-check + agujas | 1 | 0 | 9 s | ídem |
| Arnés de orden, 200 repeticiones, semilla 7 | 1 | **1** | 375 s | falló `candidates` (ver la nota 1) |
| Arnés de orden, 200 repeticiones, semilla 7 | **2** | 0 | 404 s | todo PASS (ver `4-harness.json`) |
| Control negativo del arnés sobre `4d0ab64` (debe fallar) | 1 y 2 | 0 | 214 s / 217 s | falla donde corresponde (ver `4-harness-negative-4d0ab64.json`) |
| `two-instances.mjs` | 1 | **1** | 35 s | 16/17 (ver la nota 2) |
| `two-instances.mjs` | **2** | 0 | 31 s | 17/17 |
| `compat-check.mjs` (releases desde refs) | 1 | 0 | 2 s | 6/6 |
| Benchmark de navegación `--location shadow` (40 jugadores, 20 s) | 1 | 0 | 27 s | 40 claims al unirse, 88 filas, 4,33 filas/s, sin rechazos inesperados |
| Mutantes de orden (`ordering-mutations.mjs`) | 1 | 0 | 1562 s | 66/66, árbol restaurado |
| Mutantes de orden (`ordering-mutations.mjs`) | **2** | 0 | 1198 s | **67/67** (se agregó X9), árbol restaurado, sin timeouts |
| Mutantes WLOC-2 (`mutations.mjs`) | 1 | 0 | 728 s | **51/51**, árbol restaurado, sin timeouts |
| `git diff --check f97e546..HEAD` + árbol limpio | 1 y 2 | 0 | 0 s | limpio |

## Gates repetidos y motivo

1. **Arnés, `candidates`** (corrida 1).
   - **Causa:** el error fue «no realtime on 2910». Desde `fd5c921`, en `on`, un candidato rechazado sale con código 0 justo después de escuchar. El sondeo del puerto, cada 100 ms, podía perderse esa ventana.
   - **Arreglo (`ae1c53e`, solo arnés):** `startRealtime` acepta un proceso terminado como resultado de arranque, y el escenario verifica su código de salida.
2. **`two-instances.mjs`** (corrida 1).
   - **Causa:** leyó la fila del host apenas se cerró el socket, cuando A todavía estaba entre `drain` y `stop`; la fila decía `draining`.
   - **Arreglo:** la fila se lee después de que el proceso sale.
   - **Misma carrera en el escenario `drain`:** pasó por timing; ahora usa el mismo orden.
3. **Lint, control negativo, mutantes de orden y diff-check:** se repitieron porque `ae1c53e` cambió scripts que ellos usan. Los mutantes X1–X9 corren el arnés, y se agregó X9 (escenario `shadow-refused`).

**No se repitió el runner WLOC-2:** sus 51 mutantes ejercitan código de producto y tests que no cambiaron después de `fd5c921`.

## Corrida 3 — correcciones de la revisión (F1, F3–F8, renovaciones)

**Contexto:**
- Batería completa en `a78a7a0` (Node 22.23.2, Deno 2.8.3), secuencial, sin dos mutation runners a la vez.
- Después hubo dos commits solo de scripts:
  - `010c625`: juez de mutantes y M1/M2/M4;
  - `7558d6c`: lectura nula de la tabla de hosts en el escenario `drain`.
- Por eso se repitieron completos los dos mutation runners y el control negativo del arnés.

| Gate | HEAD | rc | Duración | Resultado |
|---|---|---|---|---|
| Modelo de orden (`--trazas`) | `a78a7a0` | 0 | 10 s | idéntico a `ordering-model.out.txt` |
| Modelo de ciclo de vida (`--trazas`) | `a78a7a0` | 0 | 266 s | idéntico a `host-lifecycle-model.out.txt` |
| SQL sobre PGlite | `a78a7a0` | 0 | 64 s | 42/42 (incluye F6 y F8) |
| Deno `world-authority` | `a78a7a0` | 0 | 2 s | 18/18 + `deno check handler.ts` |
| Realtime focalizado (incluye `hostLifecycleSerial`) | `a78a7a0` | 0 | 14 s | 171/171 |
| Realtime completo | `a78a7a0` | 0 | 117 s | 539 pass, 0 fail, 34 skipped (staging) |
| Vitest | `a78a7a0` | 0 | 41 s | 1935/1935 |
| Typecheck / lint / SKILLS drift | `a78a7a0` | 0 | — | OK (lint: 0 errores) |
| Builds normal y Playtest + bundle-check + agujas | `a78a7a0` | 0 | — | OK, 0 agujas de ubicación |
| Arnés completo, 200 repeticiones, semilla 7 | `a78a7a0` | 0 | 496 s | ver la nota 1 |
| Control negativo del arnés sobre `4d0ab64` (debe fallar) | `7558d6c` | 1 (esperado) | 205 s | ver la nota 2 |
| Supervisor `autorestart` (150 s, 6 jugadores) | `a78a7a0` | 0 | 152 s | ver la nota 3 |
| Supervisor sobre `7b95e94` (debe fallar) | `a78a7a0` | 0 (`!`) | 156 s | ver la nota 4 |
| `two-instances.mjs` | `a78a7a0` | 0 | 31 s | 17/17 |
| `compat-check.mjs` | `a78a7a0` | 0 | 0 s | 6/6 |
| Benchmark `--location shadow` (40 jugadores) | `a78a7a0` | 0 | 24 s | 40/40 claims al unirse, 76 filas |
| Mutantes de orden | `a78a7a0` | 0 | 1519 s | 81/81 |
| Mutantes de orden (repetido) | `010c625` | 0 | **1432 s** | **81/81**, sin timeouts, árbol restaurado |
| Mutantes WLOC-2 | `a78a7a0` | 1 | 466 s | 48/51 (ver la nota 5) |
| Mutantes WLOC-2 (repetido) | `010c625` | 0 | **438 s** | **50/50**, sin timeouts, árbol restaurado |
| `git diff --check f97e546..HEAD` + árbol limpio | `7558d6c` | 0 | 0 s | limpio |

**Notas:**

1. **Arnés completo en `a78a7a0`** (ver `4-harness.json`):
   - T3/T4/T7: 0 violaciones en 1200 repeticiones, mismo proceso y dos procesos;
   - `candidates` 36/36, `shadow-refused` 6/6, `inverted` 39/39, `failed-startup` 6/6, `drain` 7/7, `shutdown` 7/7, `lost` 2/2.
2. **Control negativo sobre `4d0ab64`** (ver `4-harness-negative-4d0ab64.json`): T3 150/200, T4 150/200 y T7 104/200 violadas; `drain` 2/7; `shutdown` 2/6. Su primera corrida (`a78a7a0`) también falló, pero el escenario `drain` lo hizo por un TypeError del arnés (el árbol viejo no tiene tabla de hosts) y no por sus checks. Por eso se corrigió (`7558d6c`) y se repitió.
3. **Supervisor sobre este build:** 2 generaciones, 0 reinicios, un solo host activo después de asentarse y un cierre (4503) por jugador. Ver `4-supervisor.json`.
4. **Supervisor sobre `7b95e94`:** 49 generaciones, 47 reinicios, host activo alternado y 14 desconexiones por jugador. Ver `4-supervisor-negative-7b95e94.json`.
5. **WLOC-2: corrección del registro de las corridas 1 y 2.**
   - M1, M2 y M4 figuraban como detectados en la corrida 1 solo porque el archivo de tests chocó con el **timeout de 60 s del propio Node**. El runner descartaba únicamente su propio deadline, no ese.
   - En una corrida más rápida sobrevivieron: mutan la migración `20261001220000`, cuya `save` v1 y cuyos grants recrea `20261003120000`.
   - Arreglo (`010c625`):
     - los dos runners tratan «test timed out after N ms» como timeout, nunca como detección;
     - M1 y M2 apuntan a la `save` v1 vigente;
     - M4 se retira como equivalente (el claim v1 queda revocado por las dos migraciones).
   - **El «51/51» de la corrida 1 incluía 3 detecciones falsas.** El resultado verificado es **50/50**.

## Corrida 4 — correcciones N1–N4 (recuperación del host, juez de mutantes)

**Contexto:**
- Batería completa en `82f01bc` (Node 22.23.2, Deno 2.8.3), secuencial, sin dos mutation runners a la vez.
- Los dos runners y `git diff --check` fallaron en esa corrida (notas 5–7). Las causas se corrigieron en `7e5703f` (solo tests, runners y fixtures), y se repitieron completos los dos runners, el realtime completo, los tests del juez y el diff.

| Gate | HEAD | rc | Duración | Resultado |
|---|---|---|---|---|
| Modelo de orden (`--trazas`) | `82f01bc` | 0 | 12 s | idéntico a `ordering-model.out.txt` |
| Modelo de ciclo de vida (`--trazas`) | `82f01bc` | 0 | 283 s | idéntico a `host-lifecycle-model.out.txt` |
| Tests del juez (`mutationJudge.test.mjs`) | `82f01bc` | 0 | 0 s | 12/12 |
| SQL sobre PGlite | `82f01bc` | 0 | 81 s | 42/42 |
| Deno `world-authority` | `82f01bc` | 0 | 2 s | 18/18 + `deno check handler.ts` |
| Realtime focalizado (incluye `hostRecovery`) | `82f01bc` | 0 | 16 s | 179/179 |
| Realtime completo | `82f01bc` | 0 | 156 s | 547 pass, 0 fail, 34 skipped (staging) |
| Vitest | `82f01bc` | 0 | 65 s | 1935/1935 |
| Typecheck / lint / SKILLS drift | `82f01bc` | 0 | — | OK (lint: 0 errores) |
| Builds normal y Playtest + bundle-check + agujas | `82f01bc` | 0 | — | OK, 0 agujas de ubicación |
| Arnés completo, 200 repeticiones, semilla 7 | `82f01bc` | 0 | 526 s | ver la nota 1 |
| Control negativo del arnés sobre `4d0ab64` (debe fallar) | `82f01bc` | 0 (`!`) | 219 s | ver la nota 1 |
| Supervisor `autorestart` (150 s, 6 jugadores) | `82f01bc` | 0 | 152 s | 2 generaciones, 0 reinicios, un cierre por jugador |
| Supervisor sobre `7b95e94` (debe fallar) | `82f01bc` | 0 (`!`) | 165 s | 47 generaciones, 46 reinicios, 14–15 cierres por jugador |
| Supervisor, corte total de 25 s a los 10 s (`--outage`) | `82f01bc` | 0 | 152 s | ver la nota 2 |
| El mismo corte sobre `284d1b5` (debe fallar) | `82f01bc` | 0 (`!`) | 153 s | ver la nota 2 |
| Supervisor, solo `presence_activate` caído 20 s desde el arranque | `82f01bc` | 0 | 153 s | ver la nota 3 |
| El mismo corte sobre `284d1b5` (debe fallar) | `82f01bc` | 0 (`!`) | 152 s | ver la nota 3 |
| `two-instances.mjs` | `82f01bc` | 0 | 34 s | 17/17 |
| `compat-check.mjs` | `82f01bc` | 0 | 1 s | 6/6 |
| Benchmark `--location shadow` (40 jugadores) | `82f01bc` | 0 | 24 s | OK |
| Mutantes de orden | `82f01bc` | 1 | 2215 s | 85/88 (nota 5) |
| Mutantes WLOC-2 | `82f01bc` | 1 | 638 s | 42/50 (nota 6) |
| `git diff --check f97e546..HEAD` | `82f01bc` | 2 | 0 s | nota 7 |
| Sondas del revisor `RVT-vitest`, `RVT-node` | `82f01bc` | 1 (esperado) | 164 s | nota 4 |
| **Mutantes de orden (repetido)** | `7e5703f` | 0 | **2185 s** | **88/88, sin timeouts ni cancelados, árbol restaurado** |
| **Mutantes WLOC-2 (repetido)** | `7e5703f` | 0 | **781 s** | **50/50, sin timeouts ni cancelados, árbol restaurado** |
| Realtime completo (repetido) | `7e5703f` | 0 | 165 s | 547 pass, 0 fail, 34 skipped (staging) |
| Tests del juez (repetido) | `7e5703f` | 0 | 0 s | 12/12 |
| `git diff --check f97e546..HEAD` + árbol limpio | `7e5703f` | 0 | 0 s | limpio |

**Notas:**

1. **Arnés en `82f01bc`:**
   - T3/T4/T7: 0 violaciones en 1200 repeticiones, mismo proceso y dos procesos;
   - `candidates` 36/36, `shadow-refused` 6/6, `inverted` 39/39, **`failed-startup` 12/12** (ahora en `on` y en `shadow`), `drain` 7/7, `shutdown` 7/7, `lost` 2/2.
   - **Control negativo sobre `4d0ab64`:** T3 150/200, T4 150/200 y T7 114/200 violadas; `drain` 2/7; `shutdown` 2/6.
2. **Corte total de la autoridad (25 s, desde los 10 s):**
   - Este build: durante el corte A responde `/readyz` 200 mientras su lease sigue vivo, y 503 cuando lo pierde (pausa, sin persistencia). Después del corte vuelve solo a 200 antes del deploy, con su primera generación. En total hubo 2 generaciones y 0 reinicios. Ver `4-supervisor-outage.json`.
   - `284d1b5` falla el check «durante el corte A responde 503»: siguió en 200 sin autoridad. Ver `4-supervisor-outage-negative-284d1b5.json`.
3. **Solo `presence_activate` caído 20 s desde el arranque:**
   - Este build: A queda en 503 mientras no puede activar. Al volver la autoridad se activa solo, con la misma generación, y el host 1 queda `active` antes del deploy. 2 generaciones, 0 reinicios. Ver `4-supervisor-activation-outage.json`.
   - `284d1b5`: A queda detenido para siempre. El host 1 queda `stopped` y `/readyz` responde 503 antes del deploy; los jugadores no tuvieron servicio hasta B. Falla «A se recupera solo». Ver `4-supervisor-activation-outage-negative-284d1b5.json`.
4. **Sondas del revisor** (copias temporales sin trackear, borradas después; árbol limpio). Comando exacto: `rv-runner.mjs S3 O26 T1 B1 K6 X11 RVT-vitest RVT-node`.
   - S3, O26, T1, B1, K6 y X11 quedaron CAUGHT.
   - `RVT-vitest` quedó **TIMED OUT** («Test timed out in 1000ms»).
   - `RVT-node` quedó **CANCELLED** («ℹ cancelled 1»).
   - Ninguna de las dos cuenta como detectada. `restored: true`.
5. **Mutantes de orden, 85/88 en `82f01bc`.** Ninguno se esconde:
   - **H2 MISSED:** su `expect` nombraba el test viejo «refused answers end or pause», que N1 renombró a «refused answers: unknown_host is recoverable…». El juez nuevo exige el test esperado, así que no contó. Se corrigió el nombre y quedó CAUGHT.
   - **N1f MISSED:** el mutante no renueva mientras el host está `starting`. N1-1c solo miraba la identidad final. A los ≈12,5 s el host pasa a `unavailable`, sus renovaciones vuelven y el lease de 15 s aún vive, así que el test no lo veía. Ahora N1-1c afirma que el lease de arranque se renovó entre intentos, y quedó CAUGHT.
   - **N1a TIMED OUT:** con el mutante el host se detiene, el reloj controlado deja de avanzar y el bucle que levantaba el corte giraba para siempre, así que el archivo chocaba con el timeout de 60 s. Ahora el bucle es acotado: el test falla por sus aserciones y quedó CAUGHT.
6. **Mutantes WLOC-2, 42/50 en `82f01bc`:** M1, M2, M3, M5, M6, M7, M44 y M45 dieron TIMED OUT («test timed out after 60000ms»).
   - **Causa:** `worldLocations.database.test.js` tarda ≈80 s **sin mutar** (20 tests de PGlite de ≈2 s y uno de 4 s). Node aplica `--test-timeout=60000` también al archivo, así que se cortaba aunque el mutante no hiciera nada.
   - **El juez viejo los contaba como detectados** porque el código de salida era ≠0. En la corrida 3 el archivo entraba en 60 s (`sql-pglite` 64 s, contra 81 s ahora).
   - **Arreglo (`7e5703f`):** los archivos `*.database.test.js` tienen 180 s en los dos runners; el resto sigue con 60 s.
   - Verificado a mano: M1 y M44 quedan CAUGHT por su test (80 s cada uno).
7. **`git diff --check`:** espacios al final de línea en `fixtures/judge/fail.txt` y líneas vacías al final de `vfail.txt`, `vhook.txt` y `vtimeout.txt`. Se limpiaron y los 12 tests del juez siguen pasando.

## Corrida 5 — correcciones N5/N6 (respuestas tardías, respuestas ligadas a su identidad) y el juez

Copias `git archive` en un directorio temporal, `node_modules` enlazados en solo lectura, Node 22.23.2. El producto no cambió después de `5eb4d42`; los commits siguientes son tests y scripts de los runners (`5095514`, `0838eca`, `0251528`, `10d65e5`).

| Gate | HEAD | rc | Duración | Resultado |
|---|---|---|---|---|
| Focalizados (late answers, identity binding, recovery, lifecycle, serial, journal, hosting, Close/Host/Location/Room, bootstrap, adapters) | `5eb4d42` | 0 | 16 s | 182/182 |
| Realtime completo | `5eb4d42` | 0 | 171 s | 562 pass, 0 fail, 0 cancelled, 34 skipped (staging) |
| SQL sobre PGlite (ordering, v1, journal + DB) | `5eb4d42` | 0 | 92 s | 42/42 |
| Deno `world-authority` (test + `deno check handler.ts`) | `5eb4d42` | 0 | 2 s | 18/18 |
| Vitest completo | `5eb4d42` | 0 | 72 s | 204 archivos, 1935 tests |
| Typecheck | `5eb4d42` | 0 | 13 s | sin errores |
| Lint | `5eb4d42`, `0251528` | 0 | 14 s / 15 s | 0 errores (9 warnings preexistentes) |
| Tests del juez | `0251528` | 0 | 0 s | 13/13 |
| `compat-check.mjs` | `5eb4d42` | 0 | 1 s | PASS |
| Arnés de orden, 200 repeticiones, semilla 7 | `5eb4d42` | 0 | 531 s | T3/T4/T7 0/1200; `candidates` 36/36, `shadow-refused` 6/6, `inverted` 39/39, `failed-startup` 12/12, `drain` 7/7, `shutdown` 7/7, `lost` 2/2 |
| Supervisor: deploy | `5eb4d42` | 0 | 152 s | 2 generaciones, 0 reinicios, 6/6 |
| Supervisor: corte total de 25 s | `5eb4d42` | 0 | 154 s | 2 generaciones, 0 reinicios, 8/8 |
| Supervisor: `presence_activate` caído 20 s | `5eb4d42` | 0 | 153 s | 2 generaciones, 0 reinicios, 8/8 |
| Mutantes de orden, completo | `0251528` | 1 | 1890 s | 95/97: J5 y X7 PATTERN (nota 2) |
| Mutantes de orden J5, X7 | `10d65e5` | 0 | 279 s | 2/2 |
| **Mutantes de orden (total)** | `10d65e5` | — | — | **97/97, sin missed, timedOut, cancelled ni error; árbol restaurado** |
| **Mutantes WLOC-2, completo** | `0251528` | 0 | 587 s | **50/50, sin missed, timedOut, cancelled ni error; árbol restaurado** |
| `git diff --check 06a010c..HEAD` + árbol limpio | final | 0 | 0 s | limpio |

**Notas:**

1. **Por qué se repitieron los dos runners completos:** `0838eca` cambió el juez compartido (lee los marcadores de timeout, cancelación y promesa pendiente fuera de las líneas que nombran tests), y eso puede cambiar el veredicto de cualquier mutante.
2. **J5 y X7 PATTERN en `0251528`:** el código de N5/N6 cambió las líneas que mutaban (el `observe` de un guardado ahora lleva su identidad; la recuperación exige una generación antes de activar). `10d65e5` los reapunta y los dos quedan CAUGHT.
3. **Mutantes nuevos:** N5a, N5b, N5c, N6a, N6b, N6c, N6d, JG1 y JG2. En la primera corrida de la muestra (`5eb4d42`) N5c quedó MISSED, porque ningún test cubría un acquire de la recuperación que falla después del stop, y JG1 quedó CANCELLED, porque el juez leía «Promise resolution is still pending» en el nombre de un test del juez. Los arreglaron `5095514` (test N5-7) y `0838eca` (el juez ignora las líneas de nombres); en la corrida completa los nueve quedaron CAUGHT.
4. **T2 pasó a ser equivalente con la barrera de N5:** quitar solo la guarda de estado ya no cambia nada, porque la barrera también lo impide. Ahora T2 quita las dos defensas a la vez y queda CAUGHT.
5. **Control negativo de N5/N6 sobre `06a010c`:** ver `4-n5n6-negative-06a010c.md`.

**Qué sigue valiendo de corridas anteriores:**
- El SQL, la Edge Function y el cliente no cambiaron desde `06a010c`, así que los gates de `world-authority`, la migración y el cliente de la corrida 4 siguen valiendo; igual se repitieron SQL, Deno y Vitest.
- Los controles negativos del supervisor sobre `7b95e94` (bucle con salida 0) y `284d1b5` (detención permanente) de las corridas 3 y 4 siguen valiendo: el comportamiento que rechazan no volvió. Las tres corridas del supervisor sobre este código pasan.
- `two-instances.mjs` (17/17) y el benchmark son de la corrida 4. No se repitieron: `two-instances` no ejercita respuestas tardías ni cambios de identidad, y el arnés completo de esta corrida cubre los procesos reales.

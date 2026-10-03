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

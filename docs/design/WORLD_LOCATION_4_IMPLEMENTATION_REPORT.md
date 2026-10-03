# WORLD LOCATION-4 — Informe de implementación local del orden distribuido

- Rama: `world/location-ordering-0.3`, sobre el diseño aprobado `f97e546` (rev1, C1–C5).
- Alcance: implementación **local**.
- No se aplicó ninguna migración y no se desplegó ninguna Edge Function.
- No se tocaron hosted, el flag, el entorno oscuro (`4d0ab64` en shadow) ni la fila de `terremototw`.

## 1. Veredicto

- **Implementación local: COMPLETA.** Las piezas del plan (§7.7 del diseño) están implementadas y los gates pasan en Node 22 (§5).
- **`on`: BLOQUEADO.** Hay tres pendientes deliberados, todos fuera de lo que se puede probar en local:
  1. **Topología en Colyseus Cloud** (§3.5 del diseño, bloqueante): cuántos procesos WORLD corren, el escalado, el ruteo durante un deploy, la señal y el plazo de apagado, y un id de deployment.
  2. **Salida con código 0 bajo PM2** (§8.1 de este informe, bloqueo nuevo): con el `ecosystem.config.js` actual, PM2 reinicia el proceso que sale. Eso puede producir un bucle de candidatos.
  3. **Staging hosted:** la migración y `world-authority` v5 en un proyecto de staging, los tests Q6 contra Postgres real y la prueba humana de «Jugar acá».
- **`shadow`: sin cambios visibles para los jugadores**, salvo la corrección intencional de los códigos de cierre:
  - un apagado ya no emite 4001, sino 4503, y el cliente reconecta;
  - un candidato rechazado en `shadow` sigue sirviendo sin persistencia (§4.3).

## 2. Cadena de commits (desde `f97e546`)

1. `90475da` sql(location): host lifecycle, keyed claim/save and v1 guards (WORLD LOCATION-4)
2. `07e1517` test(supabase-stubs): emulate Supabase default privileges on sequences (WORLD LOCATION-4)
3. `9035495` edge(world-authority): additive v5 contract for host lifecycle and keyed location ops (WORLD LOCATION-4)
4. `dd558a6` realtime(host): presence host lifecycle, acquire before listen, activate after (WORLD LOCATION-4)
5. `e3da6a3` test(host): stop the background acquire in a finally (WORLD LOCATION-4)
6. `91fa8ff` realtime(location): keyed journal — (generation, seq, sessionId), no re-read, superseded final (WORLD LOCATION-4)
7. `78b952b` test(location): a paused host sends no first claim; R1/R3 cover both superseded paths (WORLD LOCATION-4)
8. `6c3d136` realtime(presence): drain and close codes (WORLD LOCATION-4)
9. `74eed4a` realtime(location): correct shutdown flush counts (WORLD LOCATION-4, L1)
10. `011afdc` test(location): L2 names the journal test that catches it
11. `f985e8b` client(presence): protocol 3 close codes, resume and «Jugar acá» (WORLD LOCATION-4)
12. `0994930` test(location): the mutation runner parses Vitest's coloured report
13. `04b65aa` test(location): generic ordering harness — T3/T4/T7, two processes, host lifecycle (WORLD LOCATION-4)
14. `21e7541` test(location): candidates force a late activation of the older host; X2 runs the lost-response scenario
15. `54f4c07` test(location): M50 no longer needs to be the first failure (T4 also catches it)
16. `c717337` test(location): cross compatibility and a join during shutdown gets 4503 (WORLD LOCATION-4)
17. `5692736` refactor(presence): extract the presence host, drain and close codes from PresenceRoom (WORLD LOCATION-4)
18. `59f626d` test(location): harness mutants always run the harness (not the base mutant's unit tests)
19. `fd5c921` realtime(host): in `on` a stopped host ends the process (code 0); shadow never refuses joins (WORLD LOCATION-4)
20. `ae1c53e` test(location): harness timing after exit-on-stop; shadow-refused scenario (WORLD LOCATION-4)
21. `a1ecaf9` docs(location): gates of the WORLD LOCATION-4 implementation on Node 22
22. *(este informe)* `docs(location): WORLD LOCATION-4 implementation report`

Plan del diseño (§7.7) → commits: 1 SQL (`90475da`, `07e1517`), 2 Edge (`9035495`), 3 host (`dd558a6`, `e3da6a3`), 4 journal (`91fa8ff`, `78b952b`), 5 drenaje y códigos (`6c3d136`), 6 conteos de apagado (`74eed4a`, `011afdc`), 7 cliente (`f985e8b`, `0994930`), 8 arnés (`04b65aa`, `21e7541`, `54f4c07`, `ae1c53e`), 9 compatibilidad (`c717337`), reducción de `PresenceRoom.js` (`5692736`, `59f626d`), salida en `on` y shadow no invasivo (`fd5c921`), 10 gates (`a1ecaf9`), 11 este informe.

## 3. Qué se implementó

### 3.1 Por capa

| Capa | Archivos | +/− |
|---|---|---|
| SQL (migración) | 1 | +516 / −0 |
| SQL (rollback, chequeo de grants) | 2 | +253 / −0 |
| Edge Function | 2 | +160 / −1 |
| Realtime | 18 | +1021 / −189 |
| Tests del realtime | 15 | +1887 / −309 |
| Cliente | 7 | +178 / −34 |
| Tests del cliente | 9 | +244 / −20 |
| Arnés y herramientas | 12 | +1326 / −170 |
| Docs y evidencia (sin este informe) | 3 | +896 / −0 |

**SQL** — migración nueva `20261003120000_world_location_ordering.sql` (no se editó ninguna aplicada):
- secuencia `world_presence_generation_seq` y tabla `world_presence_hosts` con estados `starting/active/draining/stopped` y leases medidos con el `now()` de la base;
- `world_presence_acquire/activate/renew/drain/stop`;
- `world_location_claim_keyed` / `world_location_save_keyed`, con clave `(generation, seq, session)` y CAS por dueño;
- las v1 re-creadas con la guarda `owner_generation = 0`;
- todas `SECURITY INVOKER`, `search_path` fijo y `REVOKE`/`GRANT` explícitos sobre la tabla, la secuencia y las 9 funciones;
- rollback (`rollback_world_location_ordering.sql`) y chequeo de grants (`ordering-grants-check.sql`).

**Edge Function** — `world-authority` v5, aditiva:
- `presence_*`;
- formas con clave de `location_claim`/`location_save` (mezclarlas con `expectedEpoch` da 400);
- v1 intacta.

**Realtime**:
- `HostLifecycle`: `acquire` antes de `listen`, `activate` después, renovación cada 5 s, lease de 15 s y `newerActive`;
- journal con clave: el `seq` se asigna en el `onJoin` síncrono; la clave no cambia nunca; `superseded` es final; la adopción ante una respuesta perdida usa la misma clave;
- `rooms/presenceHosting.js`: admisión, drenaje, códigos de cierre y `resume`;
- `PresenceRoom.onBeforeShutdown` hace `disconnect(4503)`;
- log de apagado con conteos reales;
- en `on`, un host detenido termina el proceso con código 0.

**Cliente**:
- `presenceProtocol` 3, un `tabId` por carga de página y `resume` en todo join automático;
- `domain/closePolicy.ts`: solo el reemplazo detiene al cliente; el 4001 ambiguo tiene un rebote por minuto como máximo;
- evento `takeover`, botón «Jugar acá» en el overlay de sesión reemplazada.

**Arnés y herramientas** — todo local y genérico: jugadores y tokens generados, secreto por corrida, PGlite.
- `ordering-harness.mjs`, `orderingSameProcess.mjs`, `orderingLifecycle.mjs`, `realtimeProcesses.mjs`, `localAuthority.mjs`, `compat-check.mjs`, `two-instances.mjs` (adaptado);
- el modo `--location` del benchmark ya no usa el modo benchmark, que nunca hostea presencia: no hay bypass de producción.

### 3.2 Requisitos obligatorios → dónde quedan cubiertos

| Requisito | Implementación | Pruebas |
|---|---|---|
| Ciclo `starting → active → draining → stopped` monótono; `draining` nunca vuelve a `active`; `stopped` es terminal | `world_presence_*` + `HostLifecycle` | DB (Q1–Q3), `hostLifecycle.test.js`, O1–O9, H1–H6 |
| `acquire` antes de `listen`; activar solo al estar listo | `realtimeServer.js` | `realtimeServer.test.js` (orden de trazas), H4, H5 |
| Ni claims ni guardados desde `starting`; claims solo con `active` y lease vivo | `claim_keyed`/`save_keyed` (`FOR SHARE` sobre el host), `canClaim`/`canSave` | Q4, O10, O11, O16, O17, J3, J4 |
| `draining` solo guarda filas propias; el lease de drenaje no se extiende | CAS por dueño en `save_keyed`; `renew` | Q4, O7, O18 |
| Respuestas perdidas idempotentes | misma clave = adopción (mismo epoch); `seq` repetido = `duplicate` | DB, O13, O15, J2; arnés `lost` 20/20 y 20/20; X2, X3 |
| Coexistencia nuevo/viejo acotada por renovación + RTT | `newerActive` en renew, claim y save; drenaje en `on` | arnés `candidates`/`drain`, `PresenceRoomClose.test.js`, C6, X5 |
| No afirmar que la activación marca al viejo como `draining` en la misma transacción | la activación solo se niega sobre un vigente más nuevo; el viejo se entera después | DB, O5, arnés `candidates` (rondas invertidas), X4 |
| SQL: migración nueva, `SECURITY INVOKER`, `search_path` fijo, grants mínimos explícitos; PUBLIC/anon/authenticated sin acceso; `service_role` lo justo | migración + `REVOKE ALL` y `GRANT` explícitos | Q7 con roles reales (incluida la secuencia), catálogo no vacuo, O21–O25 |
| Hosts inactivos, vencidos o desconocidos fallan cerrado; el CAS impide guardar tras perder la autoridad | `claim_keyed`/`save_keyed` | DB `claims fail closed…`, `saves … never after losing authority` |
| Compatibilidad v1 cerrada | v1 con `owner_generation = 0` | DB `v1 still works… fails closed on keyed rows`, O19, O20, M44, M45 |
| `seq` asignado síncronamente; la clave nunca cambia en reintentos; `superseded` final; la respuesta perdida adopta; sin relectura con clave nueva | `host.sessionKey()` en `begin`; `LocationJournal` | journal T3/T4/T7, J1, J2, X2 |
| `tabId` nunca en la autoridad de la base | `tabId` solo en la memoria de `presenceHosting` | `presenceHosting.test.js`; la clave SQL no lo incluye |
| 4409 → detenerse; 4503 → reconectar con `resume`; 4001 de Colyseus → reconectar con protección de bucle; `presence:closing` antes del cierre | `presenceHosting.js`, `closePolicy.ts`, `colyseusPresence.ts` | C2–C4, K1–K5, e2e |
| «Jugar acá» solo como takeover explícito; la reconexión automática nunca es takeover | `takeover` (dominio y controlador) y overlay | K4, K5, e2e y tests del overlay |
| Integración: un 4503 manual nunca se observa como 4001 | `onBeforeShutdown` → `disconnect(4503)` | `realtimeServer.test.js` (C11, con join durante el apagado → 4503), C1/X6; arnés `shutdown` |

## 4. Resultados y comparación con el protocolo anterior (`4d0ab64`)

### 4.1 T3/T4/T7 — misma semilla (`--seed 7`), 200 repeticiones por escenario, 25 en paralelo

Detalle de las corridas:
- **Latencia de la autoridad:** distribuida, exponencial con media de 40 ms y tope de 400 ms, en cada request.
- **T3:** el claim de la sesión vieja llega a la base entre 0,3 y 1,2 s tarde.
- **T4:** el claim de la sesión vieja queda colgado; el realtime lo abandona, lo reintenta, y el colgado aterriza después.
- **T7:** carrera natural, con 0–300 ms entre joins.
- **Variantes:** 3 de cada 4 repeticiones cruzan procesos (A en el proceso viejo P, B en el nuevo Q); 1 de cada 4 usan el mismo host.

Invariantes comprobados:
- **I1** (solo en el modo mismo proceso): la fila queda con la clave de B;
- **I2:** el servidor nunca cierra a B;
- **I3:** la fila termina en la última posición de B;
- **I4** (solo en el modo mismo proceso): ningún guardado de A se aplica después del claim de B.

| Modo | Escenario | Este protocolo | `4d0ab64` |
|---|---|---|---|
| Mismo proceso | T3 | **0/200** | n/a (sin host de presencia) |
| Mismo proceso | T4 | **0/200** | n/a |
| Mismo proceso | T7 | **0/200** | n/a |
| Dos procesos (shadow) | T3 (0,3–1,2 s inyectados, p50 0,78 s) | **0/200** | **150/200** violadas (las 150 cruzadas) |
| Dos procesos (shadow) | T4 (abandonado + reintento) | **0/200** | **150/200** violadas (las 150 cruzadas) |
| Dos procesos (shadow) | T7 (0–300 ms, p50 140 ms) | **0/200** | **112/200** violadas |

Detalle en `world-location-4/evidence/4-harness.json` y `4-harness-negative-4d0ab64.json`:
- En `4d0ab64`, la violación es I3: la fila queda en la posición de la sesión **vieja**, o vacía, porque el guardado de B fue `stale`.
- En las 50 repeticiones del mismo host, la sesión vieja recibe 4001 en `4d0ab64` y 4409 en este protocolo.
- Corrida 1 (`fd5c921`): mismos resultados para este protocolo; negativo 149/150/114.

Lectura:
- Con el protocolo anterior fallan **todas** las repeticiones cruzadas de T3 y T4 (149–150 de 150): el claim de la sesión vieja aterriza tarde, le quita la fila a la nueva, y el guardado de B queda `stale`.
- T7 falla en 114 de 200 repeticiones.
- Con este protocolo: 0 de 1200 en total (600 en el mismo proceso y 600 con dos procesos).
- El modo mismo proceso es n/a para `4d0ab64`: no tiene host de presencia.

### 4.2 Ciclo de vida (procesos reales, `on`)

| Escenario | Resultado | Con `4d0ab64` |
|---|---|---|
| `candidates`: dos procesos a la vez (3 rondas) y activación del más viejo forzada 4 s tarde (3 rondas) | 30/30: siempre un solo host activo, el más nuevo; el viejo nunca se activa después; el detenido sale con 0 y el otro sigue listo | n/a |
| `shadow-refused`: candidato `shadow` rechazado | 6/6: sigue corriendo y listo; admite, mueve, no cierra, no reclama | n/a |
| `failed-startup`: la autoridad rechaza `presence_*` al arrancar | 6/6: sirve sin persistencia, nunca reclama ni escribe; al volver la autoridad adquiere y activa en segundo plano; los joins nuevos reclaman; la sesión temprana nunca | n/a |
| `drain`: un host nuevo se activa con 10 jugadores en el viejo | 7/7: los 10 cierran con 4503 (nunca 4001); `presence:closing` para protocolo 3; todas las posiciones guardadas; el viejo sale con 0 y queda `stopped`; los jugadores vuelven con `resume` al nuevo en su lugar exacto | **2/7**: nadie se cierra, no hay drenaje ni host |
| `shutdown`: SIGTERM con 6 clientes de protocolo 3 y 4 de protocolo 2, más un join durante el apagado | 7/7: todos 4503; el join, 4503; posiciones guardadas; salida 0; log «10 guardadas, 0 rechazadas (otra sesión ya reclamó), 0 sin guardar»; host `stopped` | **2/6**: los 10 cierran con **4001** (se detendrían como «reemplazados»), el join recibe ECONNREFUSED y el log no distingue |
| `lost`: respuesta perdida de claim y de guardado (20 rondas) | 20/20 adoptan la misma clave y epoch; 20/20 reintentos `duplicate` con la fila correcta | n/a |
| `two-instances.mjs` (ensayo de deploy) | 17/17 | — |

### 4.3 Compatibilidad cruzada

- **Realtime nuevo + cliente nuevo:** e2e del cliente (27 tests), `PresenceRoomClose.test.js`, arnés.
- **Realtime nuevo + clientes anteriores:**
  - protocolo 2, sin protocolo o con protocolo malformado → join fresco y reemplazo con 4001;
  - nunca reciben `presence:closing`;
  - un `resume` sin `tabId` no es resume;
  - en un apagado reciben 4503 y reconectan (arnés `shutdown`: 4 clientes de protocolo 2).
- **Cliente nuevo + realtime anterior (sin eco del protocolo):**
  - un 4001 sobre un socket que vivió ≥ 30 s reconecta una sola vez con `resume`; un segundo 4001 dentro del minuto se trata como reemplazo y detiene;
  - un 1006 reconecta; un 4000 no hace nada.
- **Releases** (`compat-check.mjs`, desde refs de git):
  - producción Playtest 0.2 no usa ninguna operación de ubicación ni el host de presencia;
  - el entorno oscuro `4d0ab64` usa solo v1;
  - esta rama usa las formas con clave y el ciclo de vida, y v1 sigue respondida (no se removió).
- **Realtime anterior + base nueva:**
  - las v1 siguen funcionando sobre filas que ninguna sesión con clave posee;
  - sobre filas con clave fallan cerradas (`conflict`), según el test de DB.
- **`shadow` con activación rechazada (arnés `shadow-refused`):**
  - el proceso sigue corriendo y listo;
  - admite y mueve a los jugadores (protocolo 2 y 3);
  - no cierra a nadie, no envía `presence:closing` y no reclama.

## 5. Gates (Node 22.23.2, Deno 2.8.3)

Tabla completa, con duraciones y corridas, en `world-location-4/evidence/4-gates.md`. Resumen:

- **Modelos:** salida idéntica a la del diseño (orden y ciclo de vida).
- **SQL sobre PGlite:** 39/39.
- **Deno:** 18/18 y `deno check handler.ts`.
- **Realtime:** focalizado 161/161; completo 526 pass, 0 fail, 34 skipped (staging).
- **Vitest:** 1934/1934. **Typecheck:** OK. **Lint:** 0 errores. **SKILLS drift:** OK.
- **Builds normal y Playtest:** bundle-check OK y 0 agujas de ubicación en el bundle.
- **Arnés:** 200 repeticiones por escenario, todo PASS. Control negativo sobre `4d0ab64`: falla donde corresponde.
- **two-instances:** 17/17. **compat-check:** 6/6.
- **Benchmark `--location shadow`:** 40/40 claims y sin rechazos inesperados.
- **Mutation runners:** de orden **67/67** en 1198 s; WLOC-2 **51/51** en 728 s.
- **`git diff --check`:** limpio.

Gates repetidos (motivo detallado en `4-gates.md`):
- el arnés (`candidates`) y `two-instances.mjs` fallaron en la corrida 1 por timing del propio arnés, tras el cambio de `fd5c921` (un proceso detenido ahora sale);
- se corrigieron en `ae1c53e` y se repitieron, junto con lint, el control negativo, el runner de orden (sus mutantes X corren el arnés) y diff-check.

## 6. Controles negativos

- **Mutantes de orden** (`scripts/world-location/ordering-mutations.mjs`): **67/67 detectados**, árbol restaurado, ningún timeout contado como detección. Duración: 1198 s (corrida 2) y 1562 s (corrida 1, 66 mutantes).

  | Grupo | Qué rompen |
  |---|---|
  | O1–O25 | SQL: ciclo de vida, claims con clave, CAS, compatibilidad v1, privilegios por defecto |
  | E1–E4 | Edge Function |
  | H1–H6 | host |
  | J1–J5 | journal |
  | R1–R3 | room ante `superseded` |
  | C1–C6 | drenaje y códigos de cierre |
  | S1–S2 | `shadow` no invasivo; salida en `on` |
  | L1–L2 | log de apagado |
  | K1–K5 | cliente: 4409, `resume`, «Jugar acá», regla del 4001 |
  | X1–X9 | las mismas roturas, detectadas de punta a punta por el arnés: menor clave gana, clave nueva en el reintento, clave igual relanzada, activación sobre uno más nuevo, ignorar al más nuevo, apagado con 4001, arranque que no se recupera, proceso detenido vivo, `shadow` que rechaza joins |

- **Mutantes WLOC-2** (`scripts/world-location/mutations.mjs`): **51/51 detectados** en 728 s, árbol restaurado, sin timeouts.
  - Los mutantes de v1 apuntan ahora a la migración que define las v1 vigentes, y se agregó M6k.
  - M21, M46, M47 y M48 se retiraron por equivalentes bajo claves, con su motivo en el archivo.
- **Protocolo anterior:** `ordering-harness.mjs --tree <git archive de 4d0ab64>` falla en T3/T4/T7 (150/150/112 de 200), `drain` y `shutdown`.

  ```
  git archive 4d0ab64 services/realtime supabase | tar -x -C <dir>
  node scripts/world-location/ordering-harness.mjs --tree <dir> --reps 200 --seed 7
  ```

  Con `node_modules` enlazados en `<dir>`.

## 7. Decisiones de implementación y desvíos respecto del diseño

1. **`resume` va como `{ resume: true, tabId }`** en las opciones del join. El diseño escribe `resume: {tabId}`; la semántica es la misma. Un `resume` sin `tabId` válido (8–64 caracteres `[A-Za-z0-9_-]`) es un join fresco.
2. **El servidor solo usa `tabId` en memoria,** en un `WeakMap` por socket, y nunca lo persiste. El diseño decía `client.userData`, pero `observe()` reemplaza `userData` en los invitados.
3. **El contador `dropped.noGeneration` del diseño** quedó como `claims.noKey`: sesiones aceptadas sin host activo.
4. **`PresenceRoom.js`** había crecido de 452 a 580 líneas. El host, el drenaje, la admisión y los códigos de cierre son una sola responsabilidad y pasaron a `rooms/presenceHosting.js` (≈180 líneas, con tests focalizados sobre fakes). `PresenceRoom.js` queda en 510 líneas: delegación, guardas de movimiento durante el drenaje y `onBeforeShutdown`. Las exportaciones públicas no cambiaron.
5. **Shadow nunca rechaza un join por el estado de su host.** Si el host no está activo, la sesión no recibe clave. Un apagado o drenaje en `shadow` sí cierra con 4503, que es la corrección de 4001 válida para todos los modos.
6. **En `on`, un host que se detiene termina el proceso** con un apagado ordenado y código 0, una sola vez (diseño §3.3.2, pasos 4 y 7). Ver §8.1.
7. **Los mutantes de WLOC-2 que la clave volvió equivalentes se retiraron** con su motivo: M21, M46, M47 y M48. Los de v1 apuntan ahora a la migración que define las v1 vigentes. Se agregó M6k.
8. **El benchmark de navegación con `--location`** ahora se conecta como un navegador (Origin + token) en lugar de usar el modo benchmark, que no hostea presencia.

## 8. Límites y pendientes

### 8.1 Bloqueo nuevo previo a `on`: salida con código 0 bajo PM2

- **FACT** (`services/realtime/ecosystem.config.js`): `autorestart: true`, `min_uptime: '10s'`, `max_restarts: 10` y sin `stop_exit_codes`.
- **INFERENCE** (semántica documentada de PM2, no verificada en local porque PM2 no está instalado y no se descargó):
  - PM2 reinicia el proceso ante cualquier salida, también con código 0, salvo que el código figure en `stop_exit_codes`;
  - una salida antes de 10 s cuenta como reinicio inestable y corta en 10 intentos;
  - una salida tras un drenaje con más de 10 s de vida se reinicia sin límite.
- **Consecuencia:** cada reinicio adquiere una generación nueva y mayor, se activa, y hace drenar y salir al otro host. Si durante un deploy Cloud deja al proceso viejo bajo `autorestart`, o si hubiera dos procesos WORLD permanentes (caso 2 de §3.5), eso es un bucle de candidatos y generaciones.
- **En `shadow` no hay salidas,** así que el entorno oscuro no está expuesto.
- **No se cambió** ni la configuración de PM2 ni la de Cloud.
- **Resolverlo exige verificar en Cloud** cómo reemplaza el proceso en un deploy, y decidir entre:
  - (a) `stop_exit_codes: [0]` o una semántica equivalente;
  - (b) no salir y quedar `stopped` con `/readyz` en 503;
  - (c) otra opción que surja de la verificación.

### 8.2 Otros límites

- **Staging hosted pendiente:** los tests Q6 de `locationStaging.test.js` necesitan el stack local de Supabase (Docker) y quedaron *skipped*; el arnés corre sobre PGlite con el handler real, pero sin PostgREST ni Edge Runtime.
- **Camino de `@colyseus/tools`:** el arranque con `COLYSEUS_CLOUD=1` (socket Unix y `process.send('ready')`) no se ejercitó, porque es Linux/Cloud; el orden acquire → listen → activate se probó con `server.listen(port)`.
- **SIGTERM en Windows:** el arnés lo emula con un preload (`shutdownOnStdin.mjs`, solo herramientas locales) que emite `SIGTERM` dentro del proceso; en Linux la señal llega igual al mismo manejador de Colyseus.
- **`deno check index.ts` dentro del repo** falla por `node_modules`; es preexistente e igual en `pokeswap-int1`. `deno check handler.ts` y los tests de Deno pasan.
- **Las ops v1 no se removieron:** el entorno oscuro (`4d0ab64`) las usa. Su retiro es una fase posterior.
- **El control negativo de `4d0ab64`** se corre con un `git archive` del commit fuera del repo (no se commitea); el comando está en §6.
- **La fila de `terremototw`** no se tocó: sigue en el epoch 242, Ciudad 14,41.

## 9. Confirmaciones

- **`pokeswap-int1`:** sin cambios. Sigue en `4d0ab64` y su único cambio local es el `supabase/.temp/` preexistente; no se trabajó ahí.
- **Entorno oscuro:** sigue en `4d0ab64` / shadow; no se reinició ni se le cambió el flag.
- **Hosted y producción:** sin migraciones aplicadas, sin Edge Functions desplegadas y sin SQL contra hosted; esta fase no hizo ninguna llamada a hosted.
- **Datos:** la fila de `terremototw` intacta.
- **Lo usado:** jugadores y tokens generados en una base local efímera (PGlite).
- **Configuración:** no se cambiaron flags, `ecosystem.config.js` ni la configuración de Colyseus Cloud.
- **Git:** solo se pushea `world/location-ordering-0.3`; sin merge, rebase, amend ni force-push.

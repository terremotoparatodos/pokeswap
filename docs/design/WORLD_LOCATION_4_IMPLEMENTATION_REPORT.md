# WORLD LOCATION-4 — Informe de implementación local del orden distribuido

- Rama: `world/location-ordering-0.3`, sobre el diseño aprobado `f97e546` (rev1, C1–C5).
- Alcance: implementación **local**.
- No se aplicó ninguna migración y no se desplegó ninguna Edge Function.
- No se tocaron hosted, el flag, el entorno oscuro (`4d0ab64` en shadow) ni la fila de `terremototw`.

## 1. Veredicto

- **Implementación local: COMPLETA**, con las correcciones de la revisión aplicadas (§10), las de N1–N4 (§11) y las de N5/N6 (§12). Los gates pasan en Node 22 (§11.4). Una falta de autoridad ya no detiene el host: se recupera solo; solo un host más nuevo es terminal.
- **`on`: BLOQUEADO** por dos pendientes deliberados, ninguno demostrable en local:
  1. **Topología en Colyseus Cloud** (§3.5 del diseño, bloqueante): cuántos procesos WORLD corren, el escalado, el ruteo durante un deploy, la señal y el plazo de apagado, y un id de deployment.
  2. **Staging hosted (incluye F2):** la migración y `world-authority` v5 en un proyecto de staging, los tests Q6 contra Postgres real y la prueba humana de «Jugar acá».
- **El bucle bajo PM2** (§8.1) ya no es un bloqueo: está **corregido (F1)**. Un host desplazado nunca sale por sí mismo; el supervisor de pruebas lo demuestra contra el comportamiento anterior (§10.1).
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

### 8.1 Salida con código 0 bajo PM2 — CORREGIDO por F1 (§10.1)

> Lo que sigue es el análisis original, que la revisión convirtió en F1. Desde `688d6d6` un host desplazado no sale: queda detenido con `/readyz` en 503 y joins 4503. El supervisor de pruebas reproduce el bucle con `7b95e94` (49 generaciones en 150 s) y lo descarta con el código actual.

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
- **Salida en Cloud:** un proceso desplazado queda vivo hasta que su deploy o su supervisor lo termine. Cómo y cuándo lo hace Cloud sigue dentro de la verificación de topología (§3.5).

## 9. Confirmaciones

- **`pokeswap-int1`:** sin cambios. Sigue en `4d0ab64` y su único cambio local es el `supabase/.temp/` preexistente; no se trabajó ahí.
- **Entorno oscuro:** sigue en `4d0ab64` / shadow; no se reinició ni se le cambió el flag.
- **Hosted y producción:** sin migraciones aplicadas, sin Edge Functions desplegadas y sin SQL contra hosted; esta fase no hizo ninguna llamada a hosted.
- **Datos:** la fila de `terremototw` intacta.
- **Lo usado:** jugadores y tokens generados en una base local efímera (PGlite).
- **Configuración:** no se cambiaron flags, `ecosystem.config.js` ni la configuración de Colyseus Cloud.
- **Git:** solo se pushea `world/location-ordering-0.3`; sin merge, rebase, amend ni force-push.

## 10. Correcciones de la revisión (APPROVE WITH REQUIRED FIXES)

La revisión de solo lectura sobre `7b95e94` pidió F1 y F3–F8 más un punto informativo. F2 se valida después sobre Supabase/Postgres real. Cada corrección es un commit nuevo, sin amend ni rebase.

| Ítem | Commit(s) | Qué cambió | Prueba | Control negativo |
|---|---|---|---|---|
| F1 | `688d6d6`, `e597496`, `f8e102e` | un host desplazado no sale; queda detenido (503, 4503) | `presenceHosting.test.js`, arnés `candidates`/`drain`/`inverted`, `two-instances`, `supervisor-loop.mjs` | S2, S3, X8, X12; supervisor sobre `7b95e94` |
| F3 | `4b7f9bd`, `b37610a` | un carril para activate/drain/stop/renew; reintentos acotados | `hostLifecycleSerial.test.js` (barreras, 40P01, respuesta perdida) | T1, T2 (H3, H6 reapuntados) |
| F4 | `97900ec` | escenario `inverted` de punta a punta | arnés `inverted` 39/39 | X10 (servidor: `resume` como apertura nueva), X11 (cliente sin `resume`) |
| F5 | `de3e443` | `shadow` no espera `whenActive` | test con reloj controlado; arnés `shadow-refused` | S4 (S1, H4 reapuntados), X9 |
| F6 | `5f5dd3b` | `drain` de un host vencido: `host_expired`, sin revivir | DB (PGlite); `hostLifecycleSerial` | O26 (SQL), O27 (realtime) |
| F7 | `8955ec3` | backoff de 4503 sin reinicio por rechazo | e2e con reloj falso | K6, K8 |
| F8 | `b5f7484` | rollback transaccional, guarda de estado parcial, orden de despliegue | DB, ejecutando sentencia por sentencia | B1 (sin `BEGIN`), B2 (sin guarda) |
| Renovaciones | `a78a7a0` | 2 leases completos (6 renovaciones, 30 s), derivados | `hostLifecycleSerial` | U1 |
| Runners | `010c625`, `7558d6c` | timeouts del framework ≠ detección; M1/M2 reapuntados, M4 retirado; lectura nula en `drain` | runners completos | — |

### 10.1 F1 — por qué ya no se sale con código 0

- **Bucle con la salida:** un proceso desplazado que sale con código 0 entra en bucle bajo cualquier supervisor que reinicie toda salida (PM2 `autorestart: true`, que es lo que declara `ecosystem.config.js`). Cada reinicio adquiere una generación más nueva y desplaza al host vigente, que a su vez sale.
- **Comportamiento actual (host desplazado):**
  - drena si servía a alguien y queda vivo y detenido;
  - `/readyz` 503, joins 4503;
  - sin renovar, reclamar ni mover;
  - lo termina su deploy o su supervisor.
- **Los tres finales quedan separados en `presenceHosting.js`:**
  - desplazado por la autoridad;
  - apagado real (SIGTERM/SIGINT, Colyseus sale);
  - error recuperable de arranque (sirve sin persistencia y adquiere en segundo plano).
- **Supervisor de pruebas** `scripts/world-location/supervisor-loop.mjs`, sin dependencias nuevas: reinicia toda salida y no supone `stop_exit_codes`. Deploy A → B con 6 jugadores durante 150 s:

| Build | Generaciones | Reinicios del supervisor | Host activo tras asentarse | Cierres por jugador |
|---|---|---|---|---|
| este (`a78a7a0`) | **2** | **0** | siempre uno, el más nuevo | **1** (4503) |
| `7b95e94` (sale con código 0) | 49 | 47 (A 25, B 24) | alterna entre A y B | 14 |

Evidencia: `world-location-4/evidence/4-supervisor.json` y `4-supervisor-negative-7b95e94.json`.

- **Defensa opcional, pendiente de confirmar en Cloud (no aplicada):** `stop_exit_codes` y `exp_backoff_restart_delay` de PM2. Dejaron de ser necesarias para la corrección, porque ningún desplazado sale. Siguen siendo útiles contra salidas por error repetidas, pero dependen de que Cloud respete el `ecosystem.config.js`, y eso no está verificado.

### 10.2 F3 — serialización del ciclo de vida

- **Un carril por proceso:**
  - `activate` y `drain` esperan cualquier `renew` en vuelo;
  - no empieza un `renew` mientras `activate`, `drain` o `stop` están encolados o en curso;
  - `stop` es inmediato en local y su llamada espera su turno;
  - una respuesta de `activate` nunca revive un host detenido mientras tanto.
- **Locks:** el proceso nunca tiene dos locks de host a la vez (`activate`: `LOCK TABLE`; `renew`, `drain` y `stop`: lock de fila), así que no puede invertirlos. Los locks SQL no cambiaron.
- **Reintentos acotados** ante errores de transporte, 40P01 incluido: `activate` 6, `drain` y `stop` 3.
- **Sin rechazos huérfanos:** cada operación captura sus propios fallos.
- **Pruebas con barreras** que fuerzan cada cruce:
  - `activate` ↔ `renew`, `drain` ↔ `renew`, `stop` ↔ `renew`;
  - `activate` ↔ `stop`;
  - respuesta perdida;
  - 40P01 recuperado y 40P01 permanente, que termina en el límite sin rechazos sin manejar.

### 10.3 F4 — caso invertido

- **Escenario `inverted` del arnés:** Q ya activo; una pestaña nueva entra en P antes de que P se entere. Las renovaciones de P fallan hasta que la pestaña está adentro y después responden d = 0 / 1,5 / 3 / 4,5 s tarde.
- **Drenaje:** P se entera, drena y cierra la pestaña con 4503 en ≤ una renovación + d + RTT.
- **Reanudación:** la pestaña reanuda en Q.
  - **Con otra pestaña viva en Q:** cede (4409), y «Jugar acá» toma el control explícitamente; recién entonces la otra recibe 4409.
  - **Sola:** se la admite y queda dueña de la fila.
- **El otro orden real** (claim-first: el claim reintentado vuelve `superseded`, 4409 y «Jugar acá») también se cubre.
- **P** termina vivo y detenido (503).
- **Hallazgo:** demorar las respuestas de renovación más de 6 s supera el propio timeout del realtime hacia la autoridad (`EDGE_TIMEOUT_MS`), y entonces la renovación falla en vez de oírse. El momento del drenaje se mantiene por debajo.

| d | Otra pestaña en Q | Cierre en P | Tiempo en P | `resume` en Q | Tras «Jugar acá» |
|---|---|---|---|---|---|
| 0 | sí | 4503 | 4,4 s | 4409 (cede) | la otra recibe 4409; fila de Q |
| 0 | no | 4503 | 4,5 s | admitida | fila de Q |
| 1,5 s | sí | 4503 | 5,9 s | 4409 | ídem |
| 1,5 s | no | 4503 | 5,9 s | admitida | — |
| 3 s | sí | 4503 | 7,4 s | 4409 | ídem |
| 3 s | no | 4503 | 7,5 s | admitida | — |
| 4,5 s | sí | 4503 | 8,8 s | 4409 | ídem |
| 4,5 s | no | 4503 | 9,0 s | admitida | — |
| claim-first | sí | 4409 (`superseded`) | 5,3 s | — | la otra recibe 4409; fila de Q |

### 10.4 F5 — shadow sin demora

- **Admisión:** se pregunta primero el modo. Solo `on` espera la activación (hasta 2 s); en `shadow`, un host `starting` o rechazado admite al instante, sin consultar `whenActive`. La sesión no recibe clave, así que no reclama y no se cierra a nadie.
- **Prueba con reloj controlado:** en `shadow` se admite con el reloj detenido; en `on` la admisión queda retenida hasta la activación.

### 10.5 F6 — host vencido

- **Regla:** `world_presence_drain` de un host `active` con el lease vencido responde `host_expired` y no cambia nada: no pasa a `draining` y no recibe lease nuevo, así que no puede hacer flush. El realtime lo detiene sin flush.
- **Por qué:** perder las últimas posiciones de ese host es preferible a devolverle autoridad a un host cuyo lease venció. El CAS de los guardados queda como segunda defensa, no como la regla.
- **Migración:** se editó en el lugar, porque nunca se aplicó en ningún lado.

### 10.6 F7 — backoff de 4503

- **Antes:** cada 4503 (cierre o join rechazado) reiniciaba el backoff, así que un drenaje que rechazaba joins seguidos reintentaba cada ~500 ms.
- **Ahora:**
  - durante todo el drenaje el backoff crece (500 ms duplicándose hasta 10 s);
  - solo un snapshot autoritativo (conexión lista y estable) lo reinicia;
  - un join exitoso por sí solo no lo reinicia;
  - `resume` se conserva.
- **Prueba con reloj falso:** dos minutos de rechazos dan intervalos crecientes y topeados (unos 15 intentos, todos con `resume`).

### 10.7 F8 — rollback y orden de despliegue

- **Rollback transaccional:** el script corre entre `BEGIN` y `COMMIT`; todas sus sentencias son transaccionales.
  - pre-chequeo: se niega a un estado parcial y no cambia nada si faltan objetos;
  - post-chequeo antes del `COMMIT`;
  - cualquier fallo deshace todo.
- **Pruebas:** corren el script sentencia por sentencia, como `psql -v ON_ERROR_STOP=1 -f`. Un solo `exec()` del archivo es una transacción implícita y escondería un `BEGIN` faltante.
- **Orden obligatorio** (documentado en el script; **ninguna fase se ejecutó**):
  1. la migración;
  2. `world-authority` v5;
  3. el realtime nuevo.
- **Orden no admitido:** realtime nuevo contra Edge v4. La v4 responde 400 a todo `presence_*` y a las llamadas con clave, y el realtime reintenta su `acquire` y sirve sin persistencia.
- **Rollback:** el mismo orden al revés (realtime viejo u `off` → v4 → script).

### 10.8 Informativo — renovaciones

- **Contradicción:** el diseño dice que el host drena si el lease sigue vencido «tras 2 períodos de lease», pero el código se rendía tras 3 renovaciones × 5 s = 15 s, es decir, un lease.
- **Arreglo:** ahora son 2 leases completos: `EXPIRED_RENEWALS` = ⌈2 × lease / renovación⌉ = 6, o sea 30 s. Se deriva del lease y de la renovación (también el valor por defecto de cada host), así que las cifras no pueden volver a contradecirse.
- **Por qué dos:** un corte breve de la autoridad debe pausar la persistencia, no terminar el host. Dos períodos siguen acotando cuánto conserva un host sus sesiones sin un lease vivo.

### 10.9 Corrección del registro: mutantes WLOC-2

**El «51/51» de las corridas 1 y 2 incluía tres detecciones falsas.**
- M1, M2 y M4 fallaban solo porque el archivo de tests chocaba con el timeout de 60 s del propio Node. El runner descartaba su propio deadline, pero no ese.
- Mutaban la migración `20261001220000`, cuya `save` v1 y cuyos grants recrea `20261003120000`.
- **Arreglo (`010c625`):**
  - los dos runners tratan «test timed out after N ms» como timeout;
  - M1 y M2 apuntan a la `save` v1 vigente;
  - M4 se retiró por equivalente (el claim v1 queda revocado por las dos migraciones).
- **Resultado verificado: 50/50.**

### 10.10 Gates, controles negativos y diff de las correcciones

Detalle completo en `world-location-4/evidence/4-gates.md` (corrida 3).

**Gates:**
- **Modelos:** idénticos.
- **SQL:** 42/42. **Deno:** 18/18.
- **Realtime:** focalizado 171/171; completo 539 pass, 0 fail, 34 skipped (staging, F2).
- **Vitest:** 1935/1935. **Typecheck, lint, SKILLS drift y builds:** OK.
- **Arnés de 200 repeticiones:** 0/1200 violaciones y todos los escenarios de ciclo de vida PASS (`candidates` 36/36, `shadow-refused` 6/6, `inverted` 39/39, `failed-startup` 6/6, `drain` 7/7, `shutdown` 7/7, `lost` 2/2).
- **Supervisor:** PASS.
- **two-instances:** 17/17. **compat-check:** 6/6. **Benchmark:** OK.
- **`git diff --check`:** limpio.

**Mutation runners** (sin timeouts contados como detección):
- de orden: **81/81**, 1432 s;
- WLOC-2: **50/50**, 438 s.

**Controles negativos:**
- `4d0ab64`: T3 150/200, T4 150/200 y T7 104/200 violadas; `drain` 2/7; `shutdown` 2/6.
- `7b95e94` bajo el supervisor: bucle (49 generaciones).

**Commits de las correcciones (desde `7b95e94`):**

- `4b7f9bd` realtime(host): serialize activate, drain, stop and renew (review F3)
- `b37610a` test(location): H3 and H6 follow the serialized activate
- `5f5dd3b` sql(location): a drain never revives a host whose lease ran out (review F6)
- `688d6d6` realtime(host): a displaced host stays stopped instead of exiting (review F1)
- `e597496` test(location): S3 exits synchronously, so the unit test's exit stub records it
- `f8e102e` test(host): no process.exit anywhere in the hosting tests (a real exit 0 read as a pass)
- `de3e443` realtime(presence): shadow never waits for the activation (review F5)
- `8955ec3` client(presence): 4503 refusals keep backing off; only a ready connection resets it (review F7)
- `97900ec` test(location): the inverted case end to end (review F4)
- `b5f7484` sql(location): the rollback is one transaction with a partial-state guard; deploy order (review F8)
- `a78a7a0` realtime(host): an expired lease gives up after two full lease periods, as the design says
- `010c625` test(location): framework timeouts never count as detections; M1/M2 retargeted, M4 retired
- `7558d6c` test(location): the drain scenario reads the hosts table null-safely (a tree before WORLD LOCATION-4 has none)
- *(este informe)*

## 11. Correcciones N1–N4

La revisión de `284d1b5` pidió N1–N4. Cada corrección es un commit nuevo, sin amend ni rebase.

| Ítem | Commit(s) | Qué cambió |
|---|---|---|
| N1 | `83ff531`, `7e5703f` | solo un host más nuevo es terminal; toda falta de autoridad se recupera sola, sin `process.exit` |
| N2/N3 | `82f01bc`, `7e5703f` | un único juez para los dos runners: solo un fallo real del test esperado cuenta como detección |
| N4 | `83ff531` | el comentario de `hostLifecycle.js` (y el de `realtimeProcesses.mjs`) ya no dice que el proceso sale en `on` |

### 11.1 N1 — dos categorías

**Desplazamiento definitivo** (solo con prueba de la base):
- una activación rechazada con `newer_active`, o `newerActive` en cualquier respuesta;
- el host se detiene (después de su drenaje), `/readyz` responde 503 y los joins reciben 4503;
- no sale, no re-adquiere, y nunca vuelve a reclamar, guardar ni renovar.

**Falla recuperable** (todo lo demás):
- autoridad inalcanzable, timeout o error de transporte;
- error temporal en acquire o activate;
- lease de arranque vencido (`host_expired`) o `unknown_host`.

El host queda `unavailable` (sin identidad todavía, o con su activación por confirmar). Si ya estaba `active`, queda `paused` cuando no pudo renovar durante un lease completo. Mientras tanto:
- `/readyz` responde 503;
- en `on` los joins reciben 4503 temporal, y el cliente reintenta con backoff (F7);
- en `shadow` los jugadores no notan nada: se sirve sin persistencia, como antes.

**Recuperación:**
- En segundo plano, de a una a la vez, con backoff acotado: 1 s que se duplica hasta 30 s.
- Cuando la autoridad vuelve, el host se activa (o se despausa) y vuelve a estar listo solo. No hay `process.exit` ni reinicio.
- Si al volver ya hay un host más nuevo activo, la activación recibe `newer_active` y el host pasa a desplazado definitivo.

**Identidad:**
- Un reintento cuya respuesta pudo perderse conserva el mismo `hostId` y la misma generación (acquire y activate son idempotentes).
- Solo se toma un `hostId` nuevo, y con él una generación nueva, cuando la base confirma que la identidad vieja ya no sirve (`unknown_host`, `host_expired`).
- Así, las generaciones crecen con pérdidas confirmadas, nunca con reintentos.

**Serialización:**
- Cada intento de activación toma el carril (F3) por separado, y la espera del backoff queda fuera del carril.
- Por eso las renovaciones entre intentos mantienen vivo el lease de arranque. El supervisor encontró que, sin esto, un corte de 20 s solo de `presence_activate` costaba una generación innecesaria. Lo cubre el test N1-1c.

**Lease vencido de un host activo:**
- Pausa (sin admitir ni persistir) y sigue renovando.
- `onExpired` ahora solo informa; ya no drena.

**Tests con reloj controlado** (`hostRecovery.test.js`, 8/8, autoridad en memoria con la semántica de las funciones SQL):

| Test | Caso |
|---|---|
| N1-1 | seis activates fallidos. Con el corte levantado a los 13 s: misma identidad. A los 17 s: exactamente una identidad nueva, confirmada por `host_expired` |
| N1-1c | solo activate falla ≈20 s. Las renovaciones entre intentos extienden el lease de arranque: misma identidad |
| N1-2 | activate aplicado y respuesta perdida, igual para acquire: misma generación |
| N1-3 | `unknown_host`: una identidad nueva y recupera |
| N1-4 | host de arranque vencido: `host_expired`, una identidad nueva y recupera |
| N1-5/6 | autoridad caída más de un lease con el host activo: pausa (503, 4503, sin claims) y vuelve solo, con la misma generación y sin otro host |
| N1-7 | recuperación con un host más nuevo: desplazado definitivo, sin re-adquirir |
| N1-8 | `shadow` durante todo el corte: joins admitidos al instante, `/readyz` 200, sin claims, nadie cerrado |

**Supervisor** (`supervisor-loop.mjs --outage`, emula PM2 `autorestart`):
- **Corte total de 25 s**, desde los 10 s, con este build:
  - A responde 200 mientras su lease vive y 503 después;
  - vuelve a 200 solo, antes del deploy, con su primera generación;
  - 2 generaciones, 0 reinicios.
  - Sobre `284d1b5` falla: siguió en 200 sin autoridad.
- **Solo `presence_activate` caído 20 s** desde el arranque, con este build:
  - 503 durante el corte; luego activo con la misma generación;
  - 2 generaciones, 0 reinicios.
  - Sobre `284d1b5` falla: A queda detenido para siempre, en 503 hasta que llega B.
- **El bucle original (desplazamiento)** sigue igual: 2 generaciones con este build, 47 sobre `7b95e94`.
- Las tres corridas lo muestran: no hay bucle de reinicios, un corte temporal nunca deja el host detenido para siempre, y solo el desplazamiento real es terminal.

**Arnés:**
- `failed-startup` corre ahora en los dos modos, 12/12:
  - en `on`: 503 y 4503 durante el corte, y después listo con una sola generación;
  - en `shadow`: sirve todo el tiempo.

**Mutantes nuevos:**
- N1a–N1f: parar ante una activación inalcanzable, terminar ante `unknown_host`, una identidad nueva por error de transporte, ningún 503 sin autoridad, un host más nuevo tratado como recuperable, y ninguna renovación entre intentos.
- X13: el supervisor con el corte de activación.

### 11.2 N2/N3 — el juez de los dos runners

**Dónde vive:** `scripts/world-location/mutationJudge.mjs`, compartido por `ordering-mutations.mjs` y `mutations.mjs`.

**Qué cuenta como CAUGHT:** solo un fallo real e identificable del test esperado, y la causa esperada cuando la hay, sin ninguna de estas señales en la corrida:
- el deadline del runner;
- «test timed out after» de Node;
- «Test timed out in» o «Hook timed out in» de Vitest;
- `cancelled > 0` de node:test;
- «Promise resolution is still pending»;
- un error de infraestructura, parseo o carga;
- una salida ≠0 sin un fallo identificable.

**Otros veredictos:** `timedOut`, `cancelled`, `error` o `missed`, en ese orden de gravedad.

**Restauración:** el mutante se aplica y se restaura byte a byte en un `finally`, y el árbol se verifica limpio al final.

**Arnés y supervisor:** sus mutantes también deben nombrar lo que falla:
- el arnés imprime `<modo>: FAIL` solo por checks;
- un crash del arnés imprime `ERROR`;
- el supervisor nombra el check que falló.

**Tests del juez** (`mutationJudge.test.mjs`, 12/12, sobre salidas reales sin rutas): aserción → caught; deadline del runner; timeout de Node; timeout de un test de Vitest; timeout de un hook de Vitest; cancelado de node:test; promesa pendiente; error de infraestructura; salida 1 sin fallo identificable. Cada caso deja los archivos restaurados.

**Sondas del revisor**, con el comando exacto `rv-runner.mjs S3 O26 T1 B1 K6 X11 RVT-vitest RVT-node`:
- S3, O26, T1, B1, K6 y X11 quedaron CAUGHT;
- **`RVT-vitest` quedó TIMED OUT**;
- **`RVT-node` quedó CANCELLED**;
- `restored: true`.

Ninguna de las dos sondas cuenta como detectada.

### 11.3 Mutantes que el juez nuevo dejó de contar (sin esconder ninguno)

Primera corrida con el juez nuevo (`82f01bc`):
- de orden: 85/88;
- WLOC-2: 42/50.

| Mutante | Veredicto | Por qué | Arreglo (`7e5703f`) |
|---|---|---|---|
| H2 | missed | su `expect` nombraba un test que N1 renombró | nombre actualizado |
| N1f | missed | N1-1c no era sensible: ya `unavailable`, las renovaciones volvían antes de que venciera el lease | N1-1c afirma que el lease de arranque se renovó entre intentos |
| N1a | timedOut | con el host detenido, el reloj controlado no avanzaba y el bucle del test giraba hasta el timeout | el bucle es acotado; el test falla por aserción |
| WLOC-2 M1, M2, M3, M5, M6, M7, M44, M45 | timedOut | `worldLocations.database.test.js` tarda ≈80 s sin mutar, y Node aplica `--test-timeout=60000` al archivo. **El juez viejo contaba esa salida como detección.** | `*.database.test.js` tiene 180 s en los dos runners |

**Resultado después del arreglo** (`7e5703f`, completos y secuenciales):
- de orden: **88/88 en 2185 s, sin missed, timedOut, cancelled ni error; árbol restaurado**;
- WLOC-2: **50/50 en 781 s, sin missed, timedOut, cancelled ni error; árbol restaurado**.

### 11.4 Gates

Detalle en `world-location-4/evidence/4-gates.md` (corrida 4). Evidencia de supervisor:
- `4-supervisor-outage.json`
- `4-supervisor-outage-negative-284d1b5.json`
- `4-supervisor-activation-outage.json`
- `4-supervisor-activation-outage-negative-284d1b5.json`

**Resultados:**
- **Modelos:** idénticos.
- **SQL:** 42/42. **Deno:** 18/18.
- **Realtime:** focalizado 179/179; completo 547 pass, 0 fail, 34 skipped (staging), repetido en `7e5703f`.
- **Vitest:** 1935/1935. **Typecheck, lint, SKILLS drift y builds:** OK.
- **Arnés:** 0/1200 violaciones; `candidates` 36/36, `shadow-refused` 6/6, `inverted` 39/39, `failed-startup` 12/12, `drain` 7/7, `shutdown` 7/7, `lost` 2/2.
- **Control negativo `4d0ab64`:** T3 150/200, T4 150/200 y T7 114/200 violadas; `drain` 2/7; `shutdown` 2/6.
- **Supervisor:** tres corridas PASS y tres controles negativos FAIL (§11.1).
- **two-instances:** 17/17. **compat-check:** 6/6.
- **`git diff --check`:** limpio.

**Commits de las correcciones (desde `284d1b5`):**

- `83ff531` realtime(host): recoverable failures recover by themselves; only a newer host is terminal (review N1, N4)
- `82f01bc` test(location): one mutation judge for both runners; timeouts, cancellations and infrastructure errors never count (reviews N2, N3)
- `7e5703f` test(location): honest mutant verdicts after the N2/N3 judge (WORLD LOCATION-4)
- *(este informe y la corrida 4)*

## 12. Correcciones N5/N6

La revisión de `06a010c` confirmó N1–N4 y reprodujo dos defectos de la recuperación nueva. Cada corrección es un commit nuevo, sin amend ni rebase.

| Ítem | Commit(s) | Qué cambió |
|---|---|---|
| N5 | `1faa221`, `5095514` | una respuesta de acquire/activate que llega después de un stop, drain, displace o cambio de identidad nunca reactiva el host |
| N6 | `1faa221`, `8868b27` | cada respuesta va ligada a la identidad que la pidió; una respuesta de una identidad anterior no cambia nada; las sesiones de una identidad perdida siguen jugando sin persistencia |
| INFO del juez | `1d7983e`, `0838eca` | «Could not find» es infraestructura; los marcadores de timeout/cancelación se leen fuera de los nombres de los tests |
| Tests y mutantes | `31e99e4`, `5eb4d42`, `0251528`, `10d65e5` | autoridad en memoria compartida con respuestas retenidas; mutantes N5a–c, N6a–d, JG1, JG2; T2, N1c, J5 y X7 reapuntados |

### 12.1 N5 — barrera de ciclo de vida

- **Era:** el host lleva una `era`, y stop, drain, displace y una identidad nueva abren una era nueva.
- **Cuándo se comprueba:** cada acquire y cada activate recuerdan la era y la identidad con que salieron, y las vuelven a comprobar **después** de su `await`, antes de:
  - aplicar identidad o estado;
  - empezar a renovar;
  - admitir sesiones o publicar ready;
  - dejar seguir a la recuperación.
- **Si la base ya aplicó la llamada** (una fila adquirida, un host activado):
  - esa identidad exacta se cierra con un `stop` acotado (3 intentos) en el lane;
  - nunca se cierra otra identidad, y nunca dos veces la misma;
  - si el cierre no llega a la base, la fila no se renueva nunca y su lease vence sola.
- **Resurrección por transporte:** la recuperación ya no devuelve a `unavailable` a un host detenido cuando su acquire falla por transporte después del stop. Ese era un segundo camino de resurrección.
- **Lane:** nada queda colgado; `settled()` es para tests y tooling.

**Tests (`hostLateAnswers.test.js`, barreras reales sobre la autoridad en memoria):**
1. acquire en vuelo → stop → respuesta;
2. acquire en vuelo → displace → respuesta;
3. activate aplicado con la respuesta retenida → stop;
4. activate aplicado con la respuesta retenida → displace;
5. drain durante la recuperación;
6. respuesta de una renovación de una identidad anterior después de pasar a otra;
7. acquire de la recuperación que falla después del stop;
8. el lane queda libre y el cierre fallido es acotado.

En todos: sin resurrección, sin admisión y sin renovaciones nuevas. La identidad adquirida tarde queda `stopped` o, si el cierre falla, vence sin renovarse.

### 12.2 N6 — respuestas ligadas a su identidad

- **`observe(answer, identity)`** solo cambia el ciclo de vida si `identity` es la actual del host. Si no, la respuesta se cuenta en `foreignAnswers` y se ignora: un `unknown_host`, `host_inactive`, `host_expired` o `newerActive` de una identidad anterior no reinicia, no pausa y no desplaza al host sano.
- **Las renovaciones** comparan la identidad con que salieron.
- **El journal** manda al host:
  - en un claim, la identidad de la clave de la sesión;
  - en un guardado, la identidad que lo escribió.
- **Al cambiar de verdad hostId/generación**, las sesiones con claves anteriores:
  - pasan a `unpersisted`, se cancelan sus reintentos y se descarta su posición pendiente (contada en `dropped.identityLost`);
  - nunca reciben otra clave en silencio;
  - nunca mandan guardados bajo la identidad nueva;
  - nunca se cercan ni se cierran con 4409, aunque la base responda `stale`;
  - siguen jugando: el estado degradado queda en `claims.identityLost`, en `sessions.live.unpersisted` y en un log por pérdida.
- **Cómo recuperan la persistencia:** con una aceptación nueva (una reconexión o una recarga). Esa sesión recibe una clave de la identidad actual, que supera a la anterior, así que su claim toma la fila y restaura la última posición que la identidad vieja llegó a guardar.
- **Lo que se pierde:** las posiciones anotadas después de la pérdida. La memoria de reconexión del proceso sigue funcionando como antes.

**Tests (`hostIdentityBinding.test.js`, `HostLifecycle` y `LocationJournal` reales):**
- la generación 1 se pierde y el host se recupera sano en la 2; después llegan respuestas viejas de `unknown_host`, `host_inactive`, `host_expired` y `newerActive`, con varios jugadores con claves anteriores;
- un claim viejo en vuelo;
- un guardado viejo en vuelo: rechazado, `stale` y aplicado;
- una sesión nueva de la generación 2 conserva su autoridad;
- ningún reinicio extra, ningún cercado falso y ninguna escritura atribuida a otra generación.

### 12.3 Control negativo

Los tests nuevos corridos sobre `06a010c` fallan 14 de 16, siempre por comportamiento: el host vuelve a `active`, la generación sana se reinicia hasta 7, o hay un cercado falso. N5-3 y N5-4 ya pasaban por la guarda de F3. Detalle en `world-location-4/evidence/4-n5n6-negative-06a010c.md`.

### 12.4 Juez

- «Could not find '…'» (node:test con un archivo de test inexistente, Node 22 y 24) es infraestructura: veredicto ERROR, nunca CAUGHT. Lo cubre la fixture `notfound.txt`.
- Los marcadores de timeout, cancelación y promesa pendiente se leen **fuera** de las líneas que nombran tests (✔ ✖ ✓ × FAIL). Una línea aprobada como «✔ … "Promise resolution is still pending" …», que es el nombre de un test del propio juez, hacía que una corrida de los tests del juez se leyera como cancelada. Lo cubren el test 11 y el mutante JG2.

### 12.5 Gates

Detalle en `world-location-4/evidence/4-gates.md` (corrida 5).

**Producto en `5eb4d42`:**
- realtime completo: 562 pass, 0 fail, 34 skipped (staging);
- focalizados: 182/182; SQL: 42/42; Deno: 18/18; Vitest: 1935/1935;
- typecheck OK; lint con 0 errores; compat PASS;
- arnés: 0/1200, con todos los escenarios en PASS;
- supervisor: deploy, corte total y corte de activate en PASS, con 2 generaciones y 0 reinicios.

**Mutantes:**
- de orden: **97/97**;
- WLOC-2: **50/50**;
- sin missed, timedOut, cancelled ni error, y con el árbol restaurado. Se repitieron completos porque cambió el juez.

**`on` sigue BLOQUEADO** por la topología de Cloud y por staging (§1). Esta fase no tocó hosted, el flag, el entorno oscuro ni `pokeswap-int1`.

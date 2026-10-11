# ECO limitado por internet — preparación de entrega

Fecha: 2026-10-11. Estado: propuesta implementable; **no habilitado y no listo para activar**.
Responsabilidad única: empaquetado, exclusión productiva y operación de una prueba limitada.

## 1. Base y límites del trabajo

- **FACT:** el commit solicitado `da3c782c80275889d997cdffbced4f7526d97c96` existe: merge de ECO-COMBATANT-2, experimento dev-only, apagado por defecto, SCRIPTED verificado y hosted no verificado.
- **FACT:** al comenzar, el checkout principal estaba en `playtest/community-0.1` @ `92b7038e74f1a6bca6672956228683b9a2a71b91`; la referencia local `integration/world-skills-0.3` apuntaba a `e09591a1098e5a72a6ba4e42e6565d12484a737f`. Ese nombre de rama no acredita la base pedida; no se consultó el remoto.
- Copia propia creada exactamente desde el SHA solicitado: `C:/Users/Rodri/.codex/worktrees/eco-limited-delivery-prep/pokeswap`, rama `codex/eco-limited-delivery-prep`. No se inspeccionaron ni modificaron archivos del trabajo de cuentas reales ni otros worktrees.
- Leídos `AGENTS.md`, `docs/INVARIANTS.md`, los contratos ECO pertinentes y sólo los caminos de entrada/configuración/empaquetado necesarios.
- Este incremento sólo agrega este documento. No cambia código, flags, configuración, dependencias ni SQL. No instala paquetes, inicia servicios, crea túneles, despliega, contrata recursos, consulta cuentas/infraestructura hosted ni lee secretos.
- Se consultó documentación pública de Vite, Cloudflare Pages y Colyseus; eso no verifica disponibilidad, permisos, precios ni estado de recursos del usuario.

## 2. Resultado recomendado y alternativas

**INFERENCE / recomendación:** conservar el esquema existente: **cliente estático en un destino Pages propio + una aplicación/instancia realtime propia con un único proceso**. Ambos deben usar una release limitada explícita y el realtime debe admitir únicamente cuentas Supabase autorizadas. No modificar ni reutilizar el servidor público como requisito del plan.

| Alternativa existente o derivada del empaquetado actual | Cambios y costo operativo | Conclusión |
| --- | --- | --- |
| Pages separado + Colyseus Cloud separado | Reutiliza `dist/`, Dockerfile y bootstrap Cloud existentes; requiere destinos propios, TLS/WSS y comprobar un proceso sin solapamiento | Recomendada por continuidad con el repo; disponibilidad y autorización de esos destinos siguen pendientes |
| Estáticos + Docker/Node en una máquina independiente, detrás de un proxy TLS | Mismo cliente y realtime; agregar configuración de proxy para HTTP de matchmaking y upgrades WebSocket, supervisión y puertos internos | Alternativa si ya hay una máquina autorizada; no requiere adoptar otro backend, pero exige más operación propia |
| Cambiar el Pages/realtime públicos | Menos recursos separados, pero cambia el público, comparte gates y aumenta el alcance de rollback | Fuera del camino mínimo recomendado; no se asume autorizado |
| Publicar el sandbox dev o un túnel | Los scripts actuales usan loopback, identidad benchmark y datos simulados; `DEV` también habilita otras herramientas | No satisface esta entrega con cuentas reales y acceso restringido |

Pages sirve el cliente; el proceso Node mantiene salas y sockets. No convertir realtime en una función efímera ni introducir Redis, réplicas o nueva lógica de combate. La recomendación no implica contratar ni crear recursos ahora.

## 3. Desglose de responsabilidades antes de implementar (AGENTS §17)

| Responsabilidad | Entradas y consumidores | Lecturas / autoridad | Escrituras y efectos | Fallo requerido |
| --- | --- | --- | --- | --- |
| Perfil limitado del cliente | `ecoExperiment.ts`; transporte `colyseusPresence.ts`; `WildlandsView.vue`; rutas y shell | Configuración pública de build; respuestas del realtime | Sólo presentación, socket y caches descartables | Sin opt-in, producción sigue excluyendo ECO; acceso rechazado nunca presenta juego offline como prueba real |
| Perfil y admisión realtime | `index.js` → `realtimeServer.js`; `worldConfig.js`; `PresenceRoom.onAuth` antes de crear actor/suscripciones | UUID verificado por `authenticateSupabase`; allowlist del operador; ventana limitada | Salas, encuentros, elecciones y reservas en memoria | Configuración inválida aborta; guest/UUID no permitido no entra ni observa |
| Lectura owned | `OwnedEcoCombatants` → capacidad `readEcoCombatants` → `eco_combatants` de la autoridad | Propiedad/lock/XP/movimientos reales; gate WORLD; M-1 existente | Ninguna nueva persistencia ECO | Lectura/gate fallidos rechazan; nunca fallback sintético |
| Empaquetado y operación | Build Vite y `services/realtime/Dockerfile`; hosting estático y un proceso | SHA, manifest/digest, endpoints de salud y métricas agregadas | Publicación y cierre futuros, únicamente de los destinos limitados | No publicar con pruebas fallidas; cierre corta sockets y nuevas admisiones |

Invariantes: identidad Supabase (INV-ID-1); propiedad del servidor (INV-OWN-1/2/3); frontend sin autoridad económica; RNG persistente nunca en navegador; contratos ECO-COMBATANT-2/ECO-GAMEPLAY-2 y privacidad de espectadores conservados. No nuevos premios, captura, XP, drops, tokens, desgaste ni curación persistida.

## 4. Bloqueos actuales comprobados

1. **FACT — cliente:** `src/features/world/domain/ecoExperiment.ts` exige `DEV && VITE_ECO_EXPERIMENT === 'on'`. Por ello producción elimina capa, capacidades y receptores ECO. `--mode development` por sí solo no cambia `NODE_ENV` ni supera esta exclusión.
2. **FACT — realtime:** `services/realtime/src/world/worldConfig.js` rechaza tanto ECO como `owned` con `NODE_ENV=production`. El Dockerfile establece precisamente ese entorno.
3. **FACT — autorización:** la autenticación existente acepta invitados; una cuenta Supabase válida no acredita invitación al test. `worldProtocol`, `ecoProtocol` y `ecoCombatantProtocol` son capacidades declaradas por el cliente, no permisos.
4. **FACT — origins:** `originPolicy.js` agrega siempre los dominios públicos cuando hay `ALLOWED_ORIGINS` configurado. Es protección de navegador, no autenticación: un cliente manual puede enviar un Origin permitido. El perfil limitado necesita una lista exclusiva para su propio origen además de admisión por UUID.
5. **FACT — herramienta dev:** `WorldRoom` construye `EcoPopulation` con `devRetire: true`; `EcoExperimentLayer.vue` monta `EcoDevPanel` y ofrece “Retirar (prueba)”. Abrir ECO sin separar esta facultad también abriría el retiro manual.
6. **FACT — autoridad real:** la rama `mode: 'authority'` de `worldDependencies` conecta `createSkillsWorldPolicy` y el adaptador completo, incluido `commitWork`. `WORLD_LOCATION_PERSISTENCE=off` no desactiva premios SKILLS.
7. **FACT — gate compartido:** `VITE_PLAYTEST=on` excluye rutas de mercado/dungeon/progresión y conserva chat/superficies de playtest, pero `PlaytestShell` usa `community-0.1` vía `gateApi.ts`. El código de acceso es público y sólo una barrera UX; no sirve para limitar el realtime ni cerrar sockets.
8. **FACT — operación:** los workflows de deploy actuales publican en el proyecto Pages `pokeswap`; el de playtest fuerza `--branch=main`. No sirven como destino aislado sin un flujo separado. `compose.yaml` actual publica también el puerto de salud y no pasa configuración de autoridad/ECO.

## 5. Cambios mínimos futuros para superar deliberadamente la exclusión

**Propuesta, todavía sin implementar.** Mantener `NODE_ENV=production` en cliente y realtime. No abrir todos los caminos `DEV` ni quitar el rechazo productivo general.

- **Perfil doble explícito:** agregar `VITE_ECO_RELEASE=limited` al build y `WORLD_ECO_RELEASE=limited` al servidor. Conservar además los opt-in existentes `VITE_ECO_EXPERIMENT=on` / `WORLD_ECO_EXPERIMENT=on`. Ausencia de perfil mantiene la exclusión actual; un perfil desconocido o incompleto falla. El servidor limitado exige `owned` explícito, sin default sintético. La expresión del cliente debe seguir siendo constante de build para conservar tree-shaking.
- **Admisión por cuenta:** agregar una policy pequeña de admisión, aplicada después de verificar Auth y antes de aceptar la sala/actor. Exigir allowlist no vacía de UUIDs (`WORLD_ECO_TESTER_IDS`) y vencimiento UTC futuro (`WORLD_ECO_EXPIRES_AT`). No aceptar invitados, benchmark, capacidades como permisos ni allowlists proporcionadas por el cliente. El vencimiento bloquea joins y drena/cierra sockets existentes; no alcanza con comprobarlo una vez al arrancar. Un cambio/revocación de la lista requiere reiniciar la instancia en este mínimo, cortando sesiones existentes.
- **Origen propio:** en ese perfil, usar sólo los orígenes HTTPS limitados de `ALLOWED_ORIGINS`; no agregar los públicos. Mantener la policy normal fuera del perfil. Matchmaking HTTP y upgrade WebSocket deben quedar cubiertos por la admisión; nunca publicar directamente un puerto que eluda el proxy previsto.
- **Herramientas:** `EcoDevPanel` sólo en desarrollo y `devRetire` falso en el servidor limitado. Rechazar `world:eco-dev-retire` aun enviado manualmente. Conservar selector en la tarjeta del encuentro y combate normal. Las rutas de labs, benchmarking y PERF siguen fuera del build limitado.
- **Datos reales sin premios ajenos:** el perfil limitado debe usar una fachada específica de sólo lectura para ECO, con `readEcoCombatants` real y sólo las lecturas auxiliares necesarias por el transporte. Policy SKILLS `unavailable`, ownership de trabajo denegado y ninguna capacidad de `commitWork`, `location*` o `presence_*`. Rechazar `world:work` en el servidor aunque la UI lo esconda. No usar el adaptador completo sin recortar sus capacidades. No crear un segundo lector de slots/XP: reutilizar el entregado por el trabajo de cuentas reales.
- **Shell propio:** usar `VITE_PLAYTEST=on` para conservar la exclusión de rutas económicas, pero seleccionar una entrada limitada propia en `src/app/App.vue`, sin montar el shell que depende de `community-0.1`. Reutilizar login existente, mostrar acceso pendiente/denegado y permitir la escena sólo con admisión real. Chat/movimiento/ECO permanecen; SKILLS se oculta. No cambiar ni abrir la fila pública del playtest.
- **Release independiente:** preparar empaquetado y flujo manual de publicación dirigido sólo a destinos limitados. Ningún merge/push en ramas de deploy público como mecanismo de activación. Sin auto deploy por cada push y sin reutilizar por defecto URL/proyecto público.

Ubicar perfil/policy/fachada en módulos con responsabilidad explícita y usar pocos puntos de integración. No agregar otra gran sección de operación, auth o negocio a `WorldRoom`/`WildlandsView`; no refactorizar combate, mercado ni cuentas.

## 6. Configuración necesaria — nombres, nunca valores secretos

Los modos indicados son valores no secretos de la propuesta. No hay archivo `.env` operativo agregado por este trabajo. Los nombres nuevos no funcionan en la base actual.

| Ámbito | Variables | Uso / requisito |
| --- | --- | --- |
| Build del cliente, existentes | `NODE_ENV`, `VITE_ECO_EXPERIMENT`, `VITE_PLAYTEST` | Producción, ECO opt-in y superficies de playtest limitadas con shell independiente |
| Build del cliente, nueva | `VITE_ECO_RELEASE` | Únicamente `limited` autoriza la excepción productiva, junto al opt-in |
| Build del cliente, existentes | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Proyecto validado por el trabajo de cuentas reales; sólo credenciales publicables |
| Build del cliente, existentes | `VITE_REALTIME_URL`, `VITE_BUILD_ID` | URL WSS de la instancia limitada; SHA de release trazable. Ausencia de URL es error en ese perfil |
| Runtime realtime, existentes | `NODE_ENV`, `WORLD_ECO_EXPERIMENT`, `WORLD_ECO_COMBATANT_MODE` | Producción + ECO opt-in + `owned` explícito |
| Runtime realtime, nuevas | `WORLD_ECO_RELEASE`, `WORLD_ECO_TESTER_IDS`, `WORLD_ECO_EXPIRES_AT` | Perfil `limited`, UUIDs autorizados y cierre automático de ventana. Sin defaults abiertos |
| Runtime realtime, existentes | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Auth del mismo proyecto que el cliente; publishable/anon |
| Runtime realtime, existentes | `WORLD_AUTHORITY_URL`, `WORLD_AUTHORITY_SECRET` | Endpoint real y autenticación servidor-servidor; suministrados por canal del operador, nunca en build/browser/logs |
| Runtime realtime, existentes | `ALLOWED_ORIGINS`, `PORT`, `HEALTH_PORT`, `PRESENCE_BUILD_COMMIT` | Origen limitado exclusivo, puertos de juego/salud e identidad del SHA; salud accesible sólo internamente |
| Runtime realtime, existente | `WORLD_LOCATION_PERSISTENCE` | `off` exigido por el perfil. La fachada no expone operaciones de ubicación/host |
| Proveedor, si es Cloud | `COLYSEUS_CLOUD`, `NODE_APP_INSTANCE` | Variables de plataforma, no inventarlas; bootstrap carga entorno antes de los módulos, respetando precedencia Cloud |

El perfil debe rechazar `PRESENCE_BENCHMARK`, `WORLD_PLAYERDATA`, `WORLD_DEMO_SKILLS` y `WORLD_WILD_CATALOG` cuando seleccionen adaptadores de prueba. El build debe rechazar `VITE_PRESENCE_BENCHMARK` / `VITE_PERF` activos. No se requiere `WORLD_DB_DIR` ni `WORLD_FARM_TIME_SCALE`.

`SUPABASE_SERVICE_ROLE_KEY` pertenece exclusivamente al Edge que opera el otro trabajo; no se agrega al realtime ni al cliente. No se requieren JWT secret, credenciales DB, valores secretos en manifests ni un nuevo secreto de acceso compartido entre testers.

Si se elige Pages, el operador necesitará `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el ámbito de publicación, junto al identificador del proyecto limitado. Esos nombres ya existen en workflows; no se solicitan ni usan ahora. Credenciales/permisos de la aplicación Cloud siguen bajo control del operador. Ajustes de redirect OAuth/reset sólo si el login elegido los requiere: el otro trabajo define y comprueba ese contrato.

## 7. Empaquetado mínimo

1. Congelar SHA que combine posteriormente la conexión real aprobada y estos cambios mínimos; no afirmar que `da3c782` ya contiene esa integración real verificada.
2. En checkout limpio propio, instalar con los dos lockfiles existentes. Node 22 es la referencia del Dockerfile/CI. No agregar paquetes de aplicación.
3. Cliente: `npm run build -- --mode eco-limited`, con producción y configuración explícita del perfil. El modo selecciona configuración, **no crea el gate**. Salida `dist/` incluye assets de `public/` y chunks del catálogo. Servir con hosting estático TLS y fallback SPA; no usar Vite dev/preview como servidor final.
4. Realtime: imagen desde el contexto `services/realtime`, usando el Dockerfile existente (`npm ci --omit=dev`, copia de `src`, inicio Node). Los bundles `admission.generated.js` y `encounterBattle.generated.js` están dentro de `src`; no requiere importar TS fuera del contenedor ni regenerar catálogos desde internet en runtime.
5. Manifest separado con SHA, digest de imagen, perfil limitado, versiones presence/WORLD/ECO/combatant y resultado de checks; sin lista de usuarios, entorno completo ni secretos. En esta base: capability presence=3, `/version.protocol`=6, WORLD=3, ECO=1, combatant=2; son conceptos distintos. El resto de versiones de catálogo/reglas debe obtenerse del artefacto congelado, no inventarse.
6. Si se usa Docker propio, preparar configuración aparte que pase sólo el entorno necesario y deje `HEALTH_PORT` interno. El proxy debe reenviar HTTP de Colyseus además del WebSocket, conservar Origin y permitir conexiones largas. No ejecutar el compose actual como entrega de internet.
7. Una instancia activa, sin autoscaling ni rollout que mantenga dos poblaciones sirviendo. Para actualizar la prueba: cerrar admisión, parar la vieja, iniciar la nueva, comprobar y reabrir. Los jugadores volverán a entrar y la población/elección/reservas en memoria se reiniciarán.

## 8. Dependencias concretas del trabajo de cuentas reales

| Entrega esperada del otro trabajo | Qué bloquea aquí |
| --- | --- |
| SHA/contrato revisado y evidencia con cuentas Supabase reales | Congelar la release final; SCRIPTED no acredita hosted |
| Login, refresh/reconexión y UUID obtenido del Auth real, username disponible | Admisión a la lista y movimiento/chat como jugador |
| `world-authority` real compatible con `eco_combatants`, gate WORLD y secreto servidor existente | Lectura owned; no crear/diseñar/deployar otra Edge aquí |
| Slots propios desbloqueados y XP/moves reales elegibles según M-1/catálogo | Seleccionar e iniciar batallas sin inventar ejemplares, atributos o movimientos |
| `world_skills_access` permite a testers; caso denegado comprobado | Allowlist local sólo estrecha: no puede superar un gate WORLD cerrado |
| Fallos de lectura, venta/lock entre selección e inicio, reconexión y privacidad comprobados | Aceptación funcional y de autoridad; mantener snapshot puntual sin prometer atomicidad con ventas posteriores |

La lista de UUIDs del realtime y el gate WORLD son condiciones independientes. No cambiar el gate global para resolver una invitación ni asumir que `access: open/tester` invita automáticamente a ECO.

Este trabajo puede preparar perfil, packaging, policies y tests locales con dobles de lectura; **la activación con datos reales espera la entrega anterior**. Si ese trabajo agrega una capacidad de sólo lectura, reutilizarla. Si conserva el adaptador amplio actual, la fachada limitada corresponde a esta entrega. Cambios mínimos compartidos se integran posteriormente por commits revisados en una copia nueva, nunca editando su worktree.

## 9. Activación futura, comprobación y apagado

Estos pasos son un runbook para una autorización posterior. No se ejecutaron.

**Antes de activar:**

1. Recibir evidencia/commit del trabajo real y resolver los OPEN QUESTION de §11. Aprobar los cambios de perfil/admisión y una ventana de prueba explícita.
2. Identificar destinos independientes autorizados para cliente y realtime; preparar TLS/WSS, puertos internos y un único proceso. Registrar referencias de rollback sin credenciales.
3. Ejecutar los checks locales de §10 y generar manifest/artefactos. Revisar que ninguna URL por defecto apunte al realtime público, que no viajen secretos ni herramientas dev y que no se use el workflow público.
4. Configurar el entorno sólo en los destinos limitados, con allowlist y vencimiento. Iniciar realtime con ingreso externo aún cerrado. No tocar flags de la instancia pública ni ubicaciones globales.
5. Comprobar identidad de `/version` y salud interna. Además de `/readyz`, comprobar población admitida, `world.ready`, bundle de batallas listo y lector owned: el `/readyz` actual sólo comprueba arranque/configuración Auth/host, **no acredita ECO ni disponibilidad Edge**. Si falta alguno, no abrir.
6. Publicar el cliente limitado; probar primero con dos testers autorizados y una cuenta excluida. Abrir ingreso únicamente después de los rechazos negativos y del recorrido real completo.

**Durante la ventana:** verificar SHA en cliente y `/version`, shared encounters entre dos sesiones, selector propio, batalla/huida/victoria, espectador sin datos privados, chat/movimiento y reconexión. Registrar errores y métricas agregadas; nunca JWT, secreto, lista de UUIDs o filas personales. Ante datos dudosos o fallback sintético, cerrar la prueba.

**Apagado:** cerrar primero el ingreso del realtime limitado y terminar graciosamente su único proceso; eso desconecta sockets existentes y borra estado efímero. Deshabilitar la publicación limitada o sustituirla por aviso de cierre. Comprobar desde una pestaña abierta y otra nueva que no puedan entrar/reconectar, incluido acceso manual al endpoint. La copia estática en cache no puede superar la admisión cerrada. Detener también el reinicio automático de esa instancia si el cierre es definitivo. No depender del código público de playtest ni sólo de retirar el enlace.

**Rollback:** volver únicamente al artefacto limitado anterior todavía permitido y dentro de la ventana, o mantener cerrado. No reabrir implícitamente al reiniciar: vencimiento se revalida en cada arranque. No tocar DB, autoridad pública, flags públicos ni rama pública; no hay recompensas ECO que deshacer.

## 10. Lista corta de tareas y pruebas de aceptación

| Tarea implementable, una responsabilidad por cambio | Aceptación requerida |
| --- | --- |
| T1. Perfil productivo limitado y validación de configuración | Producción normal excluye ECO incluso con el viejo opt-in; nuevo perfil incompleto/typo no inicia ni habilita; sólo combinación válida produce ECO. Labs/PERF/benchmark quedan fuera |
| T2. Policy de admisión/origen/ventana | Cuenta válida incluida entra; guest, JWT inválido, cuenta excluida y cliente manual con Origin permitido se rechazan antes de snapshots/observación/lecturas owned. Origin público también rechazado. Expiración cierra sockets y rechaza reconexiones; retirar UUID + reiniciar revoca acceso |
| T3. Fachada owned de sólo lectura y retiro dev cerrado | Lector real usado sin fixture; gate/timeout/error no conceden combate. Spy exige cero `commit_work`, `location*` y `presence_*`, incluso con `world:work` manual. Retiro manual rechazado; retiro por victoria y respawn existentes funcionan |
| T4. Cliente limitado, shell y packaging independientes | Login real y denegación claros; no consulta/depende de `community-0.1`; direct URLs económicas/labs no cargan implementaciones. Selector en tarjeta funciona sin panel dev. Falta WSS causa error, nunca mundo offline presentado como test real |
| T5. Artefactos, checks y runbook operativo | Imagen incluye bundles y arranca luego con perfil validado; assets/chunks y fallback SPA funcionan. SHA/digest verificables; health/metrics no son públicos. No destinos públicos por defecto ni publicación automática. Cierre probado con sockets previos y nuevos |

Checks futuros: typecheck/lint/build y tests pertinentes del cliente; tests realtime de configuración/admisión/owned/reservas/espectadores/origins; controles de deriva de bundles de integración. Conservar las regresiones `ecoPopulation.test.js` y `ownedEcoCombatants.test.js` para producción normal y añadir casos positivos/negativos del perfil, en lugar de borrar los rechazos existentes.

Recorrido final futuro con datos reales: A y B ven la misma población; A sólo elige Pokémon propio elegible; B no recibe XP/instancia/ownerId/set privado; ambos compiten por un encuentro y sólo uno lo reserva; pérdida de socket respeta gracia; victoria retira una vez, huida libera; estado persistente económico/progresión no cambia por ECO. La comprobación de registros reales/Edge corresponde al trabajo autorizado para cuentas reales, no a este incremento documental.

**Verificación de este incremento:** revisión estática de las rutas/configuración y control de diff documental. No se ejecutaron build, tests de producto, Docker ni aceptación hosted; no se afirma readiness operativa.

## 11. Preguntas abiertas que bloquean activación, no esta preparación

- **OPEN QUESTION:** qué destinos separados están disponibles y autorizados, con qué TLS, supervisión y capacidad de mantener un único proceso. No se inspeccionó ninguna cuenta de hosting.
- **OPEN QUESTION:** cohorte de UUIDs, duración y operador responsable de cierre. No se inferirán desde usernames ni se dará acceso abierto mientras falten.
- **OPEN QUESTION:** SHA final, endpoint y contrato entregados por cuentas reales, y evidencia del gate/lecturas hosted. No asumir despliegue de la base local.
- **OPEN QUESTION:** si el login requiere autorizar redirects del origen limitado. Resolver dentro del trabajo de cuentas reales sin tocar configuración aquí.

No bloquean esta preparación ni deben expandirla: persistir atributos individuales, captura/recompensas, balance, mobile completo, multi-host, ventas atómicas con combates y rediseño general. Siguen fuera de esta versión limitada.

## Fuentes

Evidencia principal: archivos del SHA indicado en §§3–4, `services/realtime/README.md`, Dockerfile/compose/workflows, `docs/design/ECO_COMBATANT_2_CONTRACT.md`, `ECO_COMBATANT_2_CLOSURE.md` y `ECO_GAMEPLAY_2_CONTRACT.md`. Ante documentación histórica contradictoria prevalece el camino activo del SHA.

Vite distingue modo de `NODE_ENV` y reemplaza constantes de entorno durante build; `VITE_*` es público. [Documentación oficial de entorno/modos](https://vite.dev/guide/env-and-mode).

El cliente compilado se sirve desde su directorio de salida; `vite preview` es para comprobación local. [Despliegue estático de Vite](https://vite.dev/guide/static-deploy). Pages documenta build Vue y salida `dist`. [Vue en Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vue-site/).

Colyseus documenta almacenamiento de variables/secrets por aplicación. [Entorno y secretos en Colyseus Cloud](https://docs.colyseus.io/cloud/environment-variables). El bootstrap y la precedencia específicos de este proyecto se verificaron en `cloudEnvironment.js`; no se dedujeron del estado actual de una aplicación hosted.

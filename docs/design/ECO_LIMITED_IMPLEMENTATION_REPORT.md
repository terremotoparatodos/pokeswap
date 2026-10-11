# ECO limited — implementación local

Base exacta: `da3c782c80275889d997cdffbced4f7526d97c96`.
Rama y copia nuevas: `codex/eco-limited-implementation`, `C:/Users/Rodri/.codex/worktrees/eco-limited-implementation/pokeswap`.
Sólo T1–T4 y artefactos/checks locales de T5. Publicación y conexión real pendientes.

## Desglose previo (AGENTS §17)

- T1: configuración de build/runtime. Cliente y servidor tienen opt-in independiente; defaults productivos conservados. No autoridad persistente.
- T2: admisión después de Auth y antes de sala/actor/lecturas owned; origen propio, UUIDs del operador y ventana de servidor. Expiración cierra sockets y bloquea mensajes/joins, incluso carreras con Auth lento.
- T3: fachada sobre `createEdgePlayerData.readEcoCombatants`, sin otro lector; SKILLS unavailable, sin capacidades de settlement/ubicación/host ni retiro dev. Combate/reservas/core intactos.
- T4: shell propio, login existente, escena online retenida hasta admisión; sin gate community-0.1, rutas económicas o herramientas. Fallos no pasan a offline.
- T5: artefactos, manifests y pruebas locales. No launcher, hosting, deploy o workflows públicos.

Entradas: Vite/config, bootstrap realtime, `PresenceRoom.onAuth/onJoin/onMessage`, adaptadores `worldDependencies`, `App.vue` y transporte del cliente. Lecturas: identidad Supabase, owned por autoridad existente; tests usan dobles SCRIPTED. Escrituras nuevas: ninguna persistente. Side effects: sockets/encuentros/reservas efímeros y timers cancelables.

Invariantes: INV-ID-1, INV-OWN-1/2/3, servidor como autoridad económica, contratos ECO y privacidad existentes. Fallos: configuración inválida aborta, auth/lista/ventana niegan acceso, lector fallido no usa synthetic. Unknowns hosted se mantienen como OPEN QUESTION y bloquean activación, no implementación local.

Plan de comprobación: regresiones productivas conservadas; pruebas nuevas de configuración/admisión/expiración/capacidades y exclusión UI; builds producción normal y limited; pruebas de transporte en loopback explícitamente SCRIPTED. No acreditar Auth/Edge hosted.

## Entrega y commits separables

| Tramo | Commit | Resultado |
| --- | --- | --- |
| T1 | `eaa967f` | Perfil explícito de build/runtime; validación antes de servir; default productivo excluido |
| T2 | `2cf0f92` | UUID verificado, lista del operador, origen exclusivo y ventana de servidor |
| T3 | `5eb08fc` | Fachada owned sobre lector existente; sin persistencia SKILLS/ubicación/host ni retiro manual |
| T4 | `543b440` | Shell limitado, login existente, socket obligatorio y exclusión de superficies/herramientas |
| Corrección T2/T4 | `04e4082` | Auth privado firmado sobrevive la serialización interna de Colyseus; HTTP 403/410 se traducen a denegado/vencido |
| T5 local | HEAD de esta rama | Empaquetador, prueba de transporte SCRIPTED, exclusiones de rutas y reporte; sólo archivos locales |

El SHA completo congelado está en `review-manifest.json`, generado después de commitear todo. También figura en el bundle de Git y en `VITE_BUILD_ID` de ambos builds. El documento de propuesta original está preservado junto a este reporte; sus afirmaciones de “sólo documento” describen aquella etapa, no esta implementación.

**FACT:** ningún cambio a core, reservas, recompensas, balance, SQL, dependencias/lockfiles ni workflows públicos. Los cambios pequeños en `WildlandsView.vue` y `PresenceRoom.js`, archivos existentes grandes, sólo conectan este perfil con sus entradas actuales; no agregan sistemas ni un launcher. El principal y su configuración no se editaron.

## Comportamiento implementado

- Producción normal: sin `WORLD_ECO_RELEASE`, se conservan los rechazos a ECO/owned productivo y los orígenes públicos actuales. Sin `VITE_ECO_RELEASE`, un build normal sigue excluyendo ECO aunque tenga el opt-in antiguo. Las pruebas originales se mantienen.
- Limited: exige los dos opt-ins independientes. Configuraciones incompletas, inválidas, vencidas, benchmark, fuentes sintéticas o persistencia de ubicación abortan. No hay lista abierta ni vencimiento implícito.
- La autenticación estática se verifica en matchmaking, antes de crear sala/seat o leer owned. El UUID proviene de `authenticateSupabase`; los campos `userId`, `benchmark` o protocolos enviados por el browser no conceden acceso. Se revalida después de Auth y antes de crear el actor. El sobre privado de Auth se firma con una clave efímera del proceso, jamás enviada al browser.
- HTTP devuelve 403 para denegación y 410 para vencimiento. El socket usa 4403/4408. Al vencer se cierran automáticamente sockets inactivos, se bloquean nuevos joins y mensajes, `/readyz` pasa a 503 y la política queda cerrada durante la vida del proceso. Un reloj que retrocede no reabre una ventana ya vencida.
- La fachada sólo delega `readEcoCombatants` a `createEdgePlayerData`: operaciones `eco_combatants`, sin segundo lector de slots/progresión. `playerState` vacío y `loadNodes` vacío son compatibilidad efímera, no lecturas de Skills. No expone settlement, ownership para trabajo, ubicación ni lifecycle de hosts. Skills no disponibles y `workAllowed=false`; retiro dev rechazado con `disabled`. No fallback synthetic al fallar la lectura.
- Entrada propia: usa sesión y modal de login existentes, sólo ingreso; no depende de `community-0.1`. No monta mundo sin cuenta; al conectar retiene la escena hasta snapshot player. Denegación/vencimiento desmontan la vista y el socket. Un endpoint ausente o caído nunca se presenta como sesión offline real. Cambiar de cuenta remonta; Salir usa el logout existente.
- El perfil reutiliza `VITE_PLAYTEST` únicamente para excluir los imports de rutas económicas ya existentes y habilitar el chat. No monta el shell, store, superficies ni gate comunitarios. Las rutas directas económicas/dev vuelven al mundo. Lobby económico, Skills, métricas/perf, labs, benchmark y panel de retiro/depuración se excluyen del cliente limitado.

## Configuración necesaria para una activación posterior

Los valores privados deben ser provisionados por el operador sólo después de decidir destinos y aprobar la conexión real. Ningún valor secreto está en este reporte ni los artefactos.

| Ámbito | Nombres | Requisito |
| --- | --- | --- |
| Cliente, públicos y fijados al construir | `VITE_ECO_RELEASE`, `VITE_ECO_EXPERIMENT`, `VITE_PLAYTEST` | `limited`, `on`, `on`; sin estos opt-ins no hay excepción |
| Cliente, públicos | `VITE_REALTIME_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | WSS del realtime propio; HTTPS/Auth y credencial diseñada para ser pública del entorno acordado |
| Cliente, públicos | `VITE_BUILD_ID`, `VITE_PERF`, `VITE_PRESENCE_BENCHMARK` | SHA revisado; herramientas apagadas/ausentes |
| Realtime | `NODE_ENV`, `WORLD_ECO_RELEASE`, `WORLD_ECO_EXPERIMENT`, `WORLD_ECO_COMBATANT_MODE` | `production`, `limited`, `on`, `owned` |
| Realtime, política del operador | `WORLD_ECO_TESTER_IDS`, `ALLOWED_ORIGINS`, `WORLD_ECO_EXPIRES_AT` | UUIDs CSV no vacíos; orígenes HTTPS propios, sin los públicos; ISO UTC futuro explícito |
| Realtime | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `WORLD_AUTHORITY_URL`, `WORLD_AUTHORITY_SECRET` | Mismo entorno real de Auth/owned; URLs HTTPS. El último nombre es exclusivamente secreto de servidor, longitud mínima 48 |
| Realtime | `WORLD_LOCATION_PERSISTENCE` | `off`; no shadow/on |
| Realtime | `PRESENCE_BENCHMARK`, `WORLD_PLAYERDATA`, `WORLD_DEMO_SKILLS`, `WORLD_WILD_CATALOG` | Ausentes o `off`; no PGlite/demo/synthetic |
| Operación | `PORT`, `HEALTH_PORT`, `PRESENCE_BUILD_COMMIT` | Puertos del destino propio; health interno, separado del público; identidad del SHA revisado |

No copiar `WORLD_AUTHORITY_SECRET` a ningún nombre `VITE_*`. La lista del operador es independiente del gate WORLD y del acceso al cliente. Origin restringe browser; no reemplaza UUID autenticado. Revocar la lista o cambiar vencimiento requiere un reinicio de esta instancia con política nueva: no existe hot reload de autorización.

## Integración pendiente del trabajo del principal

1. Entregar commit/evidencia de login real y lectura owned mediante el contrato existente: `eco_combatants` devuelve `rows` con slot, dueño, lock y progresión XP/nivel/moves. La selección y el engage mantienen las validaciones actuales de owned/M-1; la fachada no los reimplementa.
2. Acordar el mismo entorno de `SUPABASE_URL`/`VITE_SUPABASE_URL`, credenciales públicas equivalentes y endpoint de `WORLD_AUTHORITY_URL`. Confirmar que `WORLD_AUTHORITY_SECRET` pertenece a ese entorno, sin compartir su valor en Git ni reportes.
3. Confirmar gate WORLD, permisos del lector y error cerrado cuando cuenta/owned/gate no habilitados. La allowlist ECO no cambia ni sustituye ese gate. No se cambió SQL ni un flag hosted para resolverlo.
4. Confirmar que el login existente puede entrar/renovar sesión en el origen propio, y las redirecciones OAuth necesarias. El login real sigue siendo autoridad Supabase; los fixtures no lo acreditan.
5. Integrar commits revisados en una copia nueva. Si el principal cambia el contrato del lector, ajustar esta fachada sobre ese lector, no duplicarlo. El launcher local principal sigue independiente: no se añadió ni se modificó un launcher ni su configuración. El perfil limited requiere URLs HTTPS/WSS; las pruebas loopback sustituyen Auth/Edge explícitamente y no hacen del launcher local una release de internet.

**OPEN QUESTION:** destinos y contratación; acceso/gate real; claims de cuenta y owned reales; TLS/proxy; un proceso sin solapamiento de deploys; capacidad de la instancia y disponibilidad del contenedor. Estas decisiones y pruebas bloquean activación, no la revisión local.

## Artefactos y reproducción local de T5

Ejecutar desde una copia limpia congelada, con las dependencias de los lockfiles existentes disponibles localmente:

```text
node scripts/eco/prepare-limited-review.mjs <directorio-absoluto-nuevo-fuera-del-worktree>
```

El script no escucha puertos, ejecuta login, llama hosting ni modifica configuraciones. Rechaza checkout sucio, salida existente y base no descendiente. Genera dos builds controlados con URLs `.invalid` y un placeholder público SCRIPTED, guarda logs, verifica exclusiones y produce:

- `limited-client.zip` y carpeta `limited/`: cliente limitado para revisión; no activable con esas URLs.
- `normal-client.zip` y `normal/`: control de regresión productiva, manteniendo fuera ECO con el opt-in antiguo presente.
- `realtime-source.tar`: fuente congelada de `services/realtime`, lockfile y Dockerfile existente; no imagen ejecutable verificada. Su contexto Docker sería la carpeta `services/realtime` extraída. Ningún contenedor fue construido/iniciado.
- `review.bundle`: commits del incremento, con la base exacta como prerequisito; `git bundle verify` y `git bundle list-heads` permiten revisar identidad/historia sin push.
- `review-manifest.json`: base, SHA completo, Node, manifests de ambos builds y SHA-256 de todos los archivos generados (excepto el propio manifest). Logs de build incluidos.

No se añadieron dependencias. Se instalaron únicamente los lockfiles existentes desde caché offline. El bundle contiene fuente y tests; los ZIP sólo los builds y assets públicos. El proceso runtime requerirá la instalación normal del lockfile y su imagen/supervisor en la etapa aprobada de hosting.

## Comprobaciones locales y límites

**FACT / SCRIPTED:** 73 pruebas dirigidas de servidor pasaron: configuración, firma/admisión/expiración, orígenes, fachada/lector, owned y batallas/espectadores, rechazo productivo normal y health. 317 pruebas del cliente pasaron en el grupo world/auth/routes/exclusión/entrada, seguido de 19 comprobaciones focalizadas de ruta limited, desconexión, desmontaje y transporte (son grupos parcialmente superpuestos, no sumar como únicos).

La prueba `limitedInternet.scripted.test.js` arranca el bootstrap real sobre dos puertos efímeros en **127.0.0.1**. Intercepta Auth/Edge con respuestas SCRIPTED `.invalid` y bloquea cualquier otro destino de red; no consulta una cuenta ni una Edge Function hosted. Verifica HTTP matchmaking, SDK y WebSocket reales: invitados/token inválido/UUID ajeno/benchmark/origen público rechazados antes de lecturas; dos cuentas con datos owned privados distintos; sólo `eco_combatants` en la frontera de autoridad; trabajo/retiro rechazados; cierre automático de sockets idle y nuevas admisiones denegadas al vencer; `/readyz` 503. Cierra servidor y health al terminar.

```text
cd services/realtime
node --test src/limitedInternet.scripted.test.js
node --test src/security/limitedRelease.test.js src/security/limitedAdmission.test.js src/security/originPolicy.test.js src/world/persistence/limitedOwnedData.test.js src/world/persistence/ecoRead.test.js src/world/ecoPopulation.test.js src/world/ownedEcoCombatants.test.js src/world/ecoCombatantWiring.test.js src/world/ecoBattles.test.js src/world/ecoBattles.spectators.test.js src/rooms/BenchmarkPresenceRoom.test.js src/observability/health.test.js src/cloudEnvironment.test.js
```

Typecheck pasó. Lint dirigido sin errores; advertencias de orden de atributos del modal existente, sin refactor ajeno. El empaquetador verifica builds normales/limited y manifests; exige ausencia de herramientas y rutas económicas del limited, y ausencia de ECO del normal. No son pruebas de UI en un navegador remoto ni de un proxy TLS real. `/readyz=200` sólo significa bootstrap/Auth-config/presence disponibles; para ECO se debe comprobar aparte admisión, owned, población y combate. La revisión no atribuye resultados a Auth o Edge hosted.

La expiración termina las sesiones; las reservas efímeras se limpian con la lógica de desconexión/grace ya existente. No se modificó ese core. El origen puede ser falsificado fuera de un browser: por eso sólo autenticación más UUID permiten jugar. Una cuenta allowlisted se verifica al entrar, no mediante polling de Auth en cada tick.

## Activación futura, comprobación y apagado (no ejecutados)

1. Revisar el SHA/bundle y recibir la conexión real del principal. Decidir y autorizar destinos propios, ventana y cuentas; mantener un único proceso realtime y ningún solapamiento con el público.
2. Provisionar TLS/WSS y proxy que soporte HTTP matchmaking y upgrades. Realtime necesita salida a Auth y al lector; health/metrics quedan internos. Aprobar redirecciones de login. No compartir la instancia pública como paso implícito.
3. Construir cliente con configuración pública real y guardar SHA/checksums nuevos: los ZIP SCRIPTED de revisión deben reemplazarse mediante ese build. Preparar imagen/source del mismo SHA, configurar servidor privadamente y validar perfiles antes de exponerlo.
4. Encender únicamente el destino limited acordado. Comparar `/version.commit` con `PRESENCE_BUILD_COMMIT`; comprobar health interno, dos cuentas permitidas/una no permitida, owned privado y lock/sale/gate cerrado, sin synthetic. Comprobar población/batalla/espectador aparte de health; capturar evidencia sin tokens/headers privados.
5. Verificar invitado/benchmark/origen público y URLs económicas/dev rechazados; owned vacío/error no habilita una batalla; trabajo/retiro no genera operaciones persistentes. Ensayar expiry con socket idle y login nuevo, sin cambiar reloj ni políticas de producción normal.
6. Apagar: retirar acceso al origen limited y detener **su** realtime; constatar cierre de sockets y denegación de nuevas sesiones. Retirar su cliente/configuración. Si se conserva el proceso como producción normal, quitar el perfil limited **y** los opt-ins ECO/owned antes de reiniciarlo; quitar sólo `WORLD_ECO_RELEASE` dejando ECO on debe fallar. No requiere revertir SQL/estado persistente ni tocar el público.

La caducidad cierra el acceso, no contrata, detiene automáticamente la máquina ni borra los estáticos. El apagado operativo sigue siendo responsabilidad del operador. Los destinos y la publicación permanecen pendientes de decisión; no hubo push, merge, deploy, túnel o consulta hosted.

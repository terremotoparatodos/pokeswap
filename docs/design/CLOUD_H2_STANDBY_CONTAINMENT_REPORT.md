# CLOUD H2 — Contención: la promoción del standby con interruptor propio, nunca en shadow

**Qué es y qué no es.**
- Es una **contención** de H2.
- No es la solución del failover, ni una autorización para integrar, desplegar o activar los modos nuevos en Cloud (D5).
- H2 sigue existiendo con `WORLD_PRESENCE_STANDBY=on`. Esa combinación **solo** se autoriza en pruebas aisladas.

**Referencias.**
- **Rama:** `fix/cloud-h2-standby-contain-0.3`, desde `fix/cloud-candidate-h1-typecheck-0.3 @ ea1284e`, que sigue congelada.
- **Propuesta:** `design/cloud-h2-standby-split-0.3 @ 90b6f87`, publicada.
- **Investigación de origen:** `investigation/cloud-h2-0.3 @ 2bab8f7`, solo local.

**Convenciones:** **FACT** = código o prueba ejecutada aquí. **INFERENCE** = deducción. **OPEN QUESTION** = sin establecer. **CLOUD-NO-COMPROBADO** = comportamiento de la plataforma que nada aquí observó.

## 1. Decisiones aplicadas

| | Decisión | Cómo quedó |
|---|---|---|
| D1 | `WORLD_PRESENCE_STANDBY`, apagado por defecto; el código se conserva | `standbyRequested(env)` es verdadero solo con `on` exacto. La sala lo lee **una vez** al cargar. Todo el código del standby sigue ahí (H-1, SIGINT, cesión) para investigar un futuro contrato de ruta |
| D2 | Aceptar la pérdida temporal del D2-A automático | Con el flag apagado, un proceso **vivo y desplazado** queda vivo y detenido (`/readyz` 503, joins 4503) hasta que **algo externo** lo termine o lo reinicie. **No se garantiza en Cloud:** CLOUD-NO-COMPROBADO si el agente reinicia un proceso vivo con 503 durante la operación normal. Es la OPEN QUESTION de §6 |
| D3 | Shadow nunca inicia ni promueve un standby, aunque el flag esté pedido | En shadow, `#startStandby` solo cuenta `wouldStandby`. No sondea `any_active` ni llama a la activación exclusiva |
| D4 | El desplazado sigue vivo con 503, sin salidas ni bucles | Sin cambios: el proceso nunca termina por su cuenta |
| D5 | Los dos caminos residuales siguen abiertos; nada se activa en Cloud | §5 |
| D6 | Investigación del contrato ruta ↔ autoridad, como tarea posterior aparte | No empezó en esta rama |
| D8 | Riesgo de flotas mixtas shadow/on | §5.3 |

## 2. Cambio (`c7167d6`)

| Archivo | Cambio |
|---|---|
| `presence/recoveryCapability.js` | `STANDBY_ENV` y `standbyRequested(env)` |
| `rooms/presenceHosting.js` | Opción `standbyRequested`, apagada. Guardas en `#startStandby`: sin el flag cuenta `notRequested` y vuelve; sin `location().restores`, o sea en shadow, cuenta `wouldStandby` y vuelve. `stats()` expone `standbyEnabled` y los dos contadores nuevos, solo como agregados |
| `rooms/PresenceRoom.js` | Lee el entorno una vez; agrega `configurePresenceStandby({ requested })` para tests y tooling |

- **Sin cambios en SQL, Edge ni cliente:** `git diff ea1284e..HEAD -- supabase src` está vacío.
- **Lo que no depende del interruptor:** claim v2, el mapa de cierres (4503 `draining`/`owner-unreachable`), `held` con «Jugar acá», la capacidad con su fallback, el orden de joins y el apagado.
- **Tests que ejercitan el standby:** ahora lo piden de forma explícita, **sin cambiar ninguna aserción**. Son `PresenceRoomRecovery.test.js` (los cinco de standby, por `displaced()` y `processWith({ standby: true })`), `PresenceRoomJournalLifecycle.test.js` (H-1) y los escenarios de standby de `recovery-integration.mjs` (D2A, SIGINT_PROMOTION, AUTHORITY_DOWN y CONCURRENT_CANDIDATES).

## 3. Pruebas de aceptación y resultados

Todo corrió en Node 22.23.2. Evidencia en `docs/design/cloud-h2-containment/evidence/`.

| # | Prueba | Con el cambio | Control negativo: archivos de producto de `ea1284e` |
|---|---|---|---|
| AT-1 | Recovery on, standby off: la secuencia H2 no ocurre por esta vía. Determinista: `PresenceRoomStandbyContainment.test.js`. Procesos reales: `CONTAINED` | **PASS.** S no tiene standby (`notRequested = 1`), 0 llamadas a `any_active` y `activate_exclusive`, recovery sigue `enabled`. A vuelve con **la misma generación**, sin pausa, y su socket nunca se cerró y sigue moviéndose | **FAIL por aserción.** Determinista: «no standby». Procesos: 4 de 6 chequeos fallan, porque S promueve y A queda desplazado |
| AT-2 | Recovery on, standby **on**: H2 sigue existiendo, documentado como solo para pruebas aisladas. Determinista y `STANDBY_ON` | **PASS.** S promueve; A, vivo, cierra con 4503/`draining`; un reintento por la ruta a A recibe 4503 | PASS igual: es el comportamiento anterior |
| AT-3 | Shadow con el standby **pedido** y sin pedir: no hay standby, ni probe, ni activación exclusiva, ni host activo nuevo. Determinista ×2 y `SHADOW` | **PASS** | **FAIL por aserción.** Determinista: el standby existe. Procesos: 3 de 6 chequeos fallan |
| AT-4 | Caída **real** con standby off: `SIGKILL` de A con un jugador y un proceso nuevo, como haría PM2. `CRASH` | **PASS.** La fila del muerto sigue `active` con lease vivo: no hay prueba de muerte y no se usa ninguna. El proceso nuevo toma una generación **mayor**, sirve sin standby, y el `resume` del jugador recibe su última casilla confirmada y la fila de la generación nueva | PASS igual: no depende del standby |
| AT-5 | D2-A con standby off: el desplazado nunca promueve, queda con 503 y la pérdida queda documentada | **PASS** | **FAIL por aserción** («no active host…»: hoy promueve) |
| AT-6 | Recovery conserva sus otros beneficios con standby off | **PASS**, con los tests de READINESS-3 **sin cambios**: D2-B, P1/P3 (`owner-unreachable` y «Jugar acá»), draining, dueño vivo, P2, shadow, kill switch y rollback de capacidad. Su `processWith` corre ahora con el standby apagado por defecto. En procesos reales: D2B, UNREACHABLE y CAPABILITY_ROLLBACK PASS. Además AT-1 comprueba que recovery sigue `enabled` | — |
| AT-7 | Los tests de standby lo piden y siguen pasando | **PASS.** Unitarios dentro de la suite completa. Procesos reales: D2A, SIGINT_PROMOTION, AUTHORITY_DOWN y CONCURRENT_CANDIDATES PASS (`recovery-integration.txt`, 7/7) | — |
| AT-8 | H-1 con el standby pedido | **PASS**: `PresenceRoomJournalLifecycle.test.js` 5/5 dentro de la suite | — |
| AT-9 | Lectura del entorno: solo `on`; `ON`, `true`, `1`, `yes` y `off` cuentan como off; la sala lo lee al cargar (comprobado en un proceso hijo con el entorno real); métrica agregada | **PASS** | **FAIL por aserción**: «the room exports configurePresenceStandby» |

**Un timeout nunca contó como detección.** La primera corrida del control de `CONTAINED` terminó BLOCKED por una espera que se agotaba. Se reordenó para esperar con límite y **afirmar** después, y desde ahí falla por chequeos (`containment-processes-control.txt`).

**Defecto preexistente encontrado (`e335f79`, solo de test).**
- El escenario `CAPABILITY_ROLLBACK` de `recovery-integration.mjs` revertía recovery solo.
- Desde JOIN-ORDER-2 (`886ff4d`) ese rollback se niega mientras exista v3, así que el escenario quedaba BLOCKED.
- No se había corrido este arnés en JOIN-ORDER-2. Ahora revierte primero el orden de joins, igual que los tests unitarios, sin cambiar aserciones.

**Gates:**

| Gate | Resultado |
|---|---|
| Realtime completo (Node 22, código final) | **721 tests, 687 pass, 0 fail, 34 skipped**. Respecto de `ea1284e` (715/681/34) suma 6 tests nuevos de AT |
| Los 34 skipped | Todos históricos: 21 «RC-0.3 staging gate» y 13 «WORLD LOCATION-2 staging» |
| Escenarios de procesos reales | Son scripts aparte y no se cuentan en los 721: `h2-containment-processes.mjs` 4/4 y `recovery-integration.mjs` 7/7 |
| typecheck | Limpio |
| `npx eslint .` | 0 errores; 9 warnings preexistentes de `AuthModal.vue`. Los scripts nuevos también quedan sin errores |
| `git diff --check` | `ea1284e..HEAD` limpio |
| Batería SQL, Deno, cliente y build | No se repitieron: esas capas no cambiaron |

## 4. Rollback (corrige la sección de la propuesta `90b6f87` §5)

La propuesta presentaba «encender el flag o volver a `ea1284e`» como rollback. **No es un rollback seguro sin esta advertencia:**

- **Encender `WORLD_PRESENCE_STANDBY=on`**, con recovery on y modo `on`, **reintroduce H2**: un standby puede promover cuando el host vivo y enrutado solo perdió su lease, y ese host cierra con 4503 y rechaza joins (FACT: AT-2).
- **Volver a `ea1284e` (o a cualquier commit anterior a este) con `WORLD_PRESENCE_RECOVERY=on`** también **reintroduce H2**, porque ahí la promoción depende solo de recovery. Además vuelve a permitir que **shadow promueva** un standby real (AT-3, control).
- **Rollback sin H2:** dejar `WORLD_PRESENCE_RECOVERY` apagado, que es el estado de todos los entornos existentes. Eso pierde también los demás beneficios de recovery (D2-B, 4503 en lugar de 4409, `held` y «Jugar acá» ante un dueño inaccesible).
- Entre las versiones que **no** reintroducen H2 por esta vía están este commit con el flag apagado y cualquier versión con recovery apagado.
- Ningún cambio de datos: no hay nada que migrar en ningún sentido.

## 5. Lo que sigue abierto

### 5.1 La contención no resuelve el enrutamiento

- Resolver qué host tiene autoridad no implica que ese host reciba a los jugadores. Esta rama solo elimina **una** vía por la que un host activo y no enrutado desplaza al enrutado: la promoción automática del standby.
- No usa ninguna gracia como prueba de muerte y no deja que ningún host ignore el fencing. A sigue retirándose ante `newerActive`, y los writes vencidos siguen rechazados.

### 5.2 Los dos caminos residuales (D5), sin cambios

Ninguno pasa por el standby (INFERENCE desde el código):

1. **Candidato de deploy** que se activa de forma normal antes de ser enrutado. `world_presence_activate` solo exige que no haya un host **más nuevo** activo, así que el host enrutado se drena al enterarse (D1/D3 de ROLLOUT-1).
2. **Host en `starting`** cuyo lease venció, que en su recuperación de fondo toma una **identidad nueva** y se activa de forma normal (`hostLifecycle.js`, `#recover` y `#newIdentity`).

No se probaron aquí con procesos reales. Su aceptación queda para después de revisarlos.

### 5.3 Riesgo de flotas mixtas shadow/on (D8)

**Shadow no carece de efectos sobre la autoridad.** Esta corrección **solo** elimina su promoción de standby. Un proceso en shadow sigue haciendo lo siguiente (LOCATION-4, sin cambios):
- **adquiere y activa su propia fila de host**: una fila `active` real, con generación propia y renovaciones;
- **sus sesiones reclaman con clave** cuando su host está activo, aunque nunca restauren posiciones ni cierren sockets.

**En una flota mixta,** un proceso en shadow **más nuevo** que uno en `on` hace que el de `on` reciba `newerActive` y **se drene**, cerrando sus sockets con 4503 (INFERENCE desde `#hostChanged` y la regla de activación). Al revés, el de shadow solo cuenta `wouldDrain`. Sus claims también pueden competir por las filas de jugadores con los del proceso en `on`.

**Consecuencia:** no mezclar shadow y on en la misma flota sin un análisis aparte. Esta rama no lo cubre ni lo prueba.

## 6. Preguntas abiertas

- **CLOUD-NO-COMPROBADO / OPEN QUESTION:** ¿qué proceso recibe las conexiones en cada fase del agente de Cloud? ¿El agente lee `/readyz` y reinicia procesos vivos con 503 fuera de un deploy? Determina quién recupera un desplazado sin standby (D2).
- **OPEN QUESTION:** el contrato entre ruta y autoridad (D6): épocas, fencing y verificación por el camino público. Es una tarea posterior y separada.

## 7. Entorno

- **Worktree** `pokeswap-h2contain`, con `node_modules` como junction a int1. No se debe correr `vite dev`.
- **`h2-loopback.mjs`** está copiado sin cambios de `2bab8f7`. Los demás arneses son propios o del repo.
- **Sin procesos vivos:** los arneses matan a sus hijos y cierran sus bases.
- **No se tocó:** hosted, flags existentes, secretos, PM2, int1, el entorno oscuro, producción ni el ecosistema.
- **Ramas congeladas intactas:** `ea1284e`, `886ff4d`, `5ca9ccd` y `90b6f87`.

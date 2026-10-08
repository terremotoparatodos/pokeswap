# ECO-GAMEPLAY-2 — Reporte: reserva y combate de prueba (sandbox)

**Rama:** `feat/eco-gameplay-2-0.3`, desde `integration/world-skills-0.3` @ `d5d54be`. Sin push ni merge.
**Contrato:** [ECO_GAMEPLAY_2_CONTRACT.md](ECO_GAMEPLAY_2_CONTRACT.md) (§1–6 y precisiones §7).
**Alcance:** solo dentro del experimento de desarrollo (`WORLD_ECO_EXPERIMENT=on` con `NODE_ENV≠production`; cliente DEV con `VITE_ECO_EXPERIMENT=on`). Sin captura, ownership, XP, drops, tokens, base de datos ni persistencia. No cambian geometría, elegibilidad de casillas, capacidades, rarezas, respawn ni el core de batalla.

## 1. Commits

| Commit | Contenido |
|---|---|
| `febf1d4` | Contrato antes del código. |
| `bcce8a4` | Runtime de combate de prueba que **envuelve** la autoridad de batalla existente, y su bundle generado para Node. |
| `e59c69d` | Precisiones §7 del contrato (relojes, orden de salidas, empate, victoria→retirada, retirada manual). Resultado `draw` distinto. |
| `9f2db72` | Servidor: reservas autoritativas (`ecoBattles.js`), protocolo, cableado en `WorldRoom`/`PresenceRoom`, `busy` en la vista. Pruebas A01–A12 y casos con semilla 7. |
| `70eb68f` | Cliente: sesión de combate, botón «Combatir», panel de combate perezoso, e2e de red. |
| (este) | Este reporte. |

## 2. Qué se construyó

**Servidor.** `services/realtime/src/world/ecoBattles.js` lleva las reservas:
- una por encuentro y una por jugador;
- la batalla es la autoridad existente, cargada solo dentro del experimento desde `encounterBattle.generated.js`, con import dinámico;
- `EcoPopulation` suma tres cosas:
  - `busy` en la vista pública;
  - `alive(id)`, con la distinción oculto/ido explicada en §5;
  - `retireVictory(id)`, la misma superficie admitida `retire` de ECO-1, sin cambiar la API de admisión;
- la retirada manual de prueba de un encuentro reservado responde `busy`.

**Protocolo.** Se agregan los mensajes `world:eco-engage`, `world:eco-battle-action` y `world:eco-flee`, y sus respuestas `world:eco-engage-result`, `world:eco-battle` y `world:eco-battle-end`. Las respuestas van **solo al dueño**.
- `ECO_ENGAGE_RANGE = 6` vive en el protocolo compartido: el servidor lo aplica y el cliente solo lo usa para deshabilitar el botón.
- Los motivos de rechazo no listados en el §5 del contrato son `not-current-socket`, `already-battling`, `too-far`, `client-outdated` y `disabled`. El fin también incluye `snapshot`.

**Cliente.** Todo vive bajo `ECO_EXPERIMENT`, que vale `false` constante en producción:
- `EcoDevPanel.vue` muestra **«Combatir»**, **«Ocupado»** o **«Lejos»** por encuentro;
- `EcoBattlePanel.vue` es perezoso y muestra:
  - la etiqueta del fixture;
  - la barra de PS;
  - los movimientos con nombre del catálogo, `#id` y PP;
  - el tiempo de combate restante, que es una estimación local entre mensajes;
  - el botón «Huir» y el resultado;
- `ecoBattleSession.ts` envía el `TransportAction` del core numerado desde el `JoinAck` del servidor y sigue la reanudación tras reconectar. **No existe** API de captura ni de objetos en el cliente.

**Parámetros provisionales del experimento, no balance:**
- rango 6 (Chebyshev);
- `ECO_BATTLE_MAX_MS = 120 000` de tiempo de combate;
- `ECO_DISCONNECT_GRACE_MS = 15 000` de reloj de servidor.

## 3. Orden de resolución (contrato §7, implementado)

**Una sola transición terminal por reserva.** La reserva pasa a `closed` y sale de los índices **antes** de cualquier efecto: retirada, mensaje y vista.

**En cada tick del mundo (50 ms):**
1. **Dueño desconectado:** solo se mira la gracia. El combate no avanza, así que no puede ganar ni perder.
2. **Encuentro inexistente** (`alive` falso): fin `vanished`.
3. **Si no,** se avanza el combate por el delta del reloj de servidor, recortado al límite. Las reglas deciden primero: `victory`, `defeat` o `draw`.
4. **Solo si sigue indeciso y llegó al límite:** fin `expired`.

**Fuera del tick:**
- **Huida:** se procesa al recibirse. Después del fin es un no-op (`no-battle`).
- **Cambio de área del dueño:** fin `left-area`.
- **Solo `victory` llama a `retireVictory`**, y una sola vez. La huida nunca retira.

**Acciones.** Antes del core (cuyo ledger contesta un `actionId` ya aceptado antes de autorizar), el adaptador exige, en orden:
1. jugador;
2. socket vigente;
3. reserva propia conectada;
4. `battleId` igual;
5. `actionId` con prefijo del jugador.

Si algo falla, responde `not-your-battle` o `no-battle` **sin snapshot**.

**Reconexión:**
- el socket nuevo toma la reserva;
- tras su snapshot de mundo recibe `world:eco-engage-result` con `resumed`, el mismo `battleId` y el `JoinAck` (continuación de la secuencia);
- un socket reemplazado que se cierra después no afecta nada;
- sin reanudación, el cliente marca el fin como `disconnected`.

## 4. Pruebas

### 4.1 Realtime (`ecoBattles.test.js`, 16 pruebas, `node --test`)

Las pruebas A01–A12 usan un combate guionado (el test fija el resultado) sobre un `WorldRoom` real con población admitida, reloj manual y aleatoriedad sembrada. Los casos con semilla 7 usan el **bundle real**.

| Caso | Prueba |
|---|---|
| A01 | Dos jugadores, mismo encuentro, **en ambos órdenes**: uno combate y el otro recibe `busy`, lo ve `busy` y no recibe nada del combate. |
| A02 | Acciones de otro jugador (`no-battle`), con `actionId` ajeno, con otro `battleId`, o desde un socket reemplazado **con un `actionId` ya aceptado**: rechazadas sin llegar al core (contador de `submit`), sin snapshot. El socket nuevo reanuda. Invitado y cliente sin protocolo ECO. |
| A03 | Rango en el borde: 6 aceptado y 7 rechazado (`too-far`), en ambos lados y por un solo eje. También otra área, invitado, socket ajeno (`client-outdated`) y socket reemplazado (`not-current-socket`). |
| A04 | Id malformado, de otro namespace, de una generación inexistente o retirado: rechazado. |
| A05 | Una reserva por jugador (`already-battling`). Repetir el engage devuelve el mismo combate. Acción y huida después del fin son no-ops. Un solo fin. |
| A06 | `capture` y `useItem` por mensaje directo: `NOT_ALLOWED_IN_SANDBOX`, y el ledger no avanza (bundle real). |
| A07 | La victoria retira **exactamente ese individuo, una vez**, para todos. Antes de terminar, la retirada manual da `busy`. Después dan `not-alive` la retirada manual, un segundo `retireVictory` y un nuevo engage. El nido respawnea igual que antes. |
| A08 | Derrota, empate, huida y vencimiento liberan sin retirar. El vencimiento sigue en curso un tick antes del límite y se recorta exacto al límite con un tick tardío. Se puede volver a combatir con otro `battleId`, y el `battleId` viejo no toca la reserva nueva. |
| A08b | Si el combate se decide en el paso que alcanza el límite, gana la regla y **no** da `expired`. |
| A09 | La desconexión **pausa** el reloj de combate: el tiempo de combate no cambia en 14 s. B recibe `busy` durante la gracia. La reconexión reanuda el mismo combate desde donde quedó y no crea un segundo. La gracia, contada desde el cierre del socket **vigente**, libera como mucho 250 ms después del límite (`disconnected`), sin retirar. Una reconexión posterior no recupera nada. |
| A10 | Carreras: huida antes de victoria (no retira); victoria antes de huida (la huida da `no-battle` y la retirada manual `not-alive`); salir del área (`left-area`); encuentro desaparecido (`vanished`). |
| A11 | Fallo cerrado: experimento apagado (`disabled`), bundle o catálogo no cargado (`battle-unavailable`), excepción al preparar, creación fallida (no queda reserva), población no admitida (`unavailable`) y cliente desactualizado. |
| A12 | Un ciclo completo (engage, acción, victoria, segundo engage, huida) no toca datos de jugador, ownership ni el store de nodos (proxy espía). |

**Casos con semilla 7, por el ciclo completo de reserva con el bundle real.** La especie se fuerza envolviendo `start`, porque qué especie anda cerca la sortea la población.
- **Rattata #19 + Impactrueno #84:** victoria entre 10 y 12 s de combate. Queda `retired: true` y el individuo desaparece.
- **Geodude #74 sin órdenes:** derrota entre 22 y 26 s. Se libera y sigue en el mundo.
- **Metapod #11 + Onda Trueno #86 al inicio + Doble Equipo #104 a los ≥65 s de combate:**
  - llega vivo al límite y termina **`expired`** con `timeMs = 120 000` exactos y el resultado de las reglas en `ongoing`;
  - se libera, el individuo sigue en el mundo y una acción posterior da `no-battle`.
  - Esto acredita técnicamente el vencimiento y la liberación, no solo «llegar vivo a 120 s».

**Semilla fija frente a sandbox normal.** Estos tiempos son reproducciones con **semilla fija**. En el sandbox el servidor sortea una semilla por combate, así que el humano reproduce el **tipo** de resultado, no los mismos segundos. La exploración independiente de ChatGPT con las semillas 1–128 dio victoria contra Rattata entre 7,4 y 11,0 s, y derrota contra Geodude entre 20 y 48 s. Su script verifica el hash del bundle de `bcce8a4`. Desde `e59c69d` el bundle cambió (solo el resultado `draw`), por eso los casos se reprodujeron con pruebas propias.

### 4.2 Cliente (vitest)

- **`ecoBattleSession.test.ts` (8):**
  - engage por id;
  - rechazos;
  - `TransportAction` numerado desde el `JoinAck`;
  - nueva numeración tras `STALE_ACTION`;
  - snapshot nunca más viejo;
  - mensajes de otro combate ignorados;
  - huida que solo pide;
  - pausa, reanudación y fin `disconnected` cuando no hay reanudación;
  - sin conexión y sin respuesta.
- **`EcoDevPanel.battle.test.ts` (3):**
  - «Combatir» solo libre y en rango;
  - «Ocupado»/«Lejos» deshabilitados;
  - sin retirada manual de un encuentro ocupado;
  - el panel muestra el fixture y los PS;
  - la huida se envía y no cambia nada hasta la respuesta;
  - el resultado sale del servidor;
  - no hay botón de captura ni de objetos.

### 4.3 E2E de red contra el realtime aislado

Se corre con `scripts/ecosystem/eco-battle-e2e.mjs`. Dos jugadores sintéticos usan el SDK real de Colyseus en `127.0.0.1:2790`, lanzado con `eco-gameplay-local.mjs realtime`. Corrida del 2026-10-07: **PASS**, en 28 s.
1. Engage lejano rechazado (`too-far`).
2. A camina, reserva y B recibe `busy` y lo ve ocupado.
3. Captura rechazada por el sandbox; acción de B rechazada (`no-battle`, sin snapshot); retirada manual rechazada (`busy`).
4. Huida: liberado, sin retirar, libre para ambos.
5. Nuevo engage; A corta su socket, B lo sigue viendo ocupado; A se reconecta y **reanuda el mismo combate**.
6. Fin del servidor sin órdenes (esta vez victoria en 7,4 s): retirado y desaparece para ambos.

`eco-gameplay-e2e.mjs` de ECO-1 sigue en **PASS**: misma población, retirada de prueba y respawn a los 70 s. Al terminar se detuvieron los procesos locales y quedaron libres los puertos 2790, 2791 y 5199. No se tocaron 2567, 2568 ni 5173.

### 4.4 Gates (Node 22.23.2)

| Gate | Resultado |
|---|---|
| vitest completo | 234 archivos, **2209/2209**. |
| realtime completo (`node --test src/**/*.test.js`) | 641 pruebas: **607 pasan, 0 fallan, 34 omitidas**. Las omisiones son condicionales previas; ninguna es ECO. |
| `vue-tsc --noEmit` | exit 0. |
| eslint (archivos tocados del frontend y scripts) | 0 errores. Los JS del servicio están fuera del alcance de eslint por configuración del repo. |
| `bundle-battle`, `bundle-admission`, `bundle-encounters` y `bundle-skills` con `--check` | Todos al día. |
| Guarda de aislamiento | El adaptador de batalla es el **único** archivo nuevo admitido y alcanza solo el bundle de batalla, con controles negativos. |

### 4.5 Exclusión productiva

**Servidor.** Con el experimento apagado no existe `ecoBattles` y el bundle de batalla nunca se importa (import dinámico solo en el constructor del experimento). `WORLD_ECO_EXPERIMENT=on` con `NODE_ENV=production` sigue impidiendo arrancar.

**Cliente.** Build de producción con `VITE_ECO_EXPERIMENT=on`, `vite build --sourcemap`, en una carpeta temporal ya borrada:
- **193 fuentes únicas**, ninguna de batalla: ni `battle/*`, ni `pokemon/model`, ni la sesión, ni los paneles, ni el runtime o bundle ECO;
- 0 apariciones de `EcoBattlePanel`, `EcoBattleSession`, «Combate de prueba», «Combatir», «fixture de prueba», `prepareEncounterBattles`, `EcoDevPanel` y `ecoProtocol`.

**Superficie inerte que sí se publica,** igual que ocurría con `world:eco-dev-retire` en ECO-1:
- las cadenas del objeto `WORLD_MESSAGE` compartido;
- tres métodos pequeños de `SharedWorld`: `setEcoBattleSink`, `ecoSend` y `ecoBattleMessage`.

Nadie los llama en producción: los receptores están detrás de `ECO_EXPERIMENT`.

## 5. Hallazgos y decisiones

- **Oculto no es ido.** Un área sin espectadores pasa a `idle`: deja de mostrarse y conserva a sus individuos. Si el dueño se desconecta y nadie más mira el área, el encuentro reservado queda oculto durante la gracia.
  - El tick comprueba `alive`, que los conserva, y no `encounter`, que los oculta. Así no se libera como `vanished` por error.
  - El paso a `dormant` llega a los 5 minutos y la gracia es de 15 s, así que no se pisan.
  - No cambia ninguna capacidad ni ninguna regla de actividad.
- **La retirada manual de prueba sobre un encuentro ocupado** se rechaza también para su dueño, en el servidor y deshabilitando el botón en el cliente.
- **Causa interna de la victoria:** `retire` de la superficie admitida fija la causa `fled`, que es un valor del motor sin efectos. No se amplió la API de admisión, así que la victoria la registra el adaptador (`metrics.retiredByVictory`).
- **Tiempo restante en el cliente:** es una estimación de presentación entre mensajes. La autoridad es el reloj de combate del servidor.

## 6. Fe de erratas de ECO-GAMEPLAY-1 (sin editar su entrega)

El reporte de ECO-GAMEPLAY-1 (§ verificación, fila del build de producción) dice «192 fuentes únicas, ninguna de ECO». Las cifras correctas son:
- **193** fuentes únicas;
- una de ellas es `src/features/wildlands/engine/ecoPopulace.ts`, que queda **inerte** en producción: sus ramas dependen de `ECO_EXPERIMENT`, que es `false` constante.

La medición de esta entrega da las mismas 193 fuentes: ECO-GAMEPLAY-2 no agrega ninguna.

## 7. Smoke humano con dos ventanas (pendiente)

**Preparación.** Se usan tres terminales, en el worktree del candidato y con Node 22:
```
node scripts/ecosystem/eco-gameplay-local.mjs realtime
node scripts/ecosystem/eco-gameplay-local.mjs client
```
Las dos ventanas son estas (identidades sintéticas, sin cuentas):
- Ventana A: `http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-a`
- Ventana B: `http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-b`

El panel «ECO · experimento (dev)» lista los encuentros cercanos, con su id corto, la distancia y los botones **Combatir / Ocupado / Lejos** y «Retirar (prueba)». **B se queda en el área** para mantenerla activa. Anotá el SHA del candidato y el id corto del individuo de cada fila.

**Fixture del jugador:** Pikachu #25, nivel 12, con Impactrueno #84 (`thunder-shock`), Ataque Rápido #98 (`quick-attack`), Onda Trueno #86 (`thunder-wave`) y Doble Equipo #104 (`double-team`). El rival es nivel 8. El panel muestra los nombres canónicos en inglés y el `#id`.

**Antes de empezar, dos avisos:**
- No hay pausa por inactividad: sin órdenes, el Pikachu repite su último movimiento o, si no hay, el primero.
- Los segundos citados en la tabla son de semilla 7. En el sandbox la semilla es aleatoria, así que se espera el mismo **tipo** de resultado.

| ✓ | Caso | Pasos | Esperado |
|---|---|---|---|
| ☐ | Disputa | A y B a ≤6 casillas del mismo individuo. Pulsan «Combatir» casi a la vez. Repetir otro día con el orden invertido. | Una sola ventana abre el combate. La otra muestra «otro jugador lo está combatiendo» y la fila **Ocupado**. Registrar quién ganó. |
| ☐ | Control | El ganador elige un movimiento. El otro no tiene panel de ese combate. | Los PS y la elección cambian según el servidor. No hay botón de captura ni de objetos. |
| ☐ | Victoria (Rattata #19) | Combatir un Rattata de la pradera y elegir **thunder-shock #84** una vez, o no dar órdenes. | «¡Victoria!…» (semilla 7: unos 11 s). El individuo desaparece en **ambas** ventanas y los demás siguen. Volver a pulsar sobre su fila vieja ya no es posible. El nido repone más tarde, con id nuevo. |
| ☐ | Huida | Reservar otro individuo y pulsar «Huir». Después B pulsa «Combatir» sobre ese mismo individuo. | «Huiste…». **El mismo individuo** sigue presente y B puede combatirlo. |
| ☐ | Derrota (Geodude #74) | En la cueva inicial, combatir un Geodude **sin dar órdenes**. | «Derrota…» (semilla 7: unos 24 s). El Geodude sigue y queda libre para B. |
| ☐ | Vencimiento (Metapod #11) | En el bosque de la pradera: elegir **thunder-wave #86 en los primeros 3 s** del combate. Hacia los 65 s del contador, elegir **double-team #104**. Mantener la ventana conectada hasta que el contador llegue a 0:00. B se queda en el área. | Sale «Se agotó el tiempo del combate de prueba…» y el mismo Metapod sigue y queda libre. Si no se logra (por una semilla distinta o por tiempos humanos), registrar **no observado por el humano**: queda acreditado técnicamente en §4.1 (Metapod con semilla 7 → `expired` a 120 000 ms) y en A08. |
| ☐ | Desconexión | A en combate cierra su pestaña sin huir. B mira la fila: **Ocupado** durante unos 15 s, después libre. B combate. Luego reabrir A. | Se libera unos 15 s después del cierre y el individuo sigue. Reabrir A no crea otro combate ni toca el de B. Registrar las horas de corte y de liberación. Variante: reabrir A **antes** de 15 s debe reanudar el mismo combate («Reconectando…» y después el mismo panel). |

Para cada fila conviene guardar una captura de A y de B, la hora, el id corto y el resultado. La autoridad, los replays y la ausencia de escrituras están acreditados por §4; el smoke visual no los sustituye.

## 8. Pendiente y fuera de alcance

- Smoke humano (§7).
- Fuera de esta entrega:
  - ocupación dinámica (encuentros que bloquean casillas);
  - captura, recompensas y persistencia;
  - equipos reales y balance de fixtures;
  - la decisión de retirar el roster horario.

**Candidato congelado:** `feat/eco-gameplay-2-0.3` en el commit de este reporte. Sin push ni merge, sin Cloud ni Supabase, sin tocar `pokeswap-int1` ni el entorno oscuro.

## 9. Delta tras la revisión independiente de `001197f` (FINDINGS F1–F3)

La revisión independiente de `001197fa` dio FINDINGS (F1, F2 bloqueantes; F3 defecto técnico). El usuario autorizó corregir F1–F3 dentro del alcance actual, más un commit aparte de legibilidad. El contrato registra las correcciones en su §8.

| Commit | Contenido |
|---|---|
| `32a6c22` | F1, F2 y F3, con sus regresiones. Regenera el bundle de admisión (`exists`). |
| `b6b5938` | Solo la legibilidad de los botones deshabilitados «Lejos» y «Ocupado». |
| (este) | Este delta del reporte. |

### 9.1 Reproducción previa

Los fallos se reprodujeron sobre una exportación aislada de `001197f` (`git archive`) en `D:\Claude-ECO2-REPRO-001197fa-20261008\code`, con Node 22.23.2 y sin tocar las evidencias originales:
- se usaron las sondas originales de la revisión, sin cambios;
- su salida va a un directorio propio, `evidence-001197fa`;
- resultado: R02, R03 y R09 **fallan** y las otras seis pasan, igual que en la revisión.

### 9.2 Correcciones

- **F1, socket vigente.**
  - Acción y huida exigen que el socket sea el vigente del mapa autoritativo (`clientForPlayer`) **y** el de la reserva.
  - Si entra un socket del jugador sin protocolo ECO (o con un protocolo de mundo viejo), la reserva queda sin socket en ese momento: pausada, con la gracia contando desde ahí.
  - El socket reemplazado no alcanza el ledger ni recibe snapshots, ni siquiera antes de su `onLeave`.
  - Se conservan la reconexión ECO válida y la protección frente al `onLeave` tardío.
- **F2, gracia al reanudar.**
  - La gracia se comprueba antes de borrar `disconnectedAt`, tanto al entrar el socket como en el engage del mismo encuentro.
  - En `≥ 15 000 ms` la reserva se libera en ese momento (`disconnected`, sin retirar), aunque no haya pasado un tick.
  - El tick usa el mismo predicado.
- **F3, existencia exacta.**
  - La población admitida suma `exists(id)`, de solo lectura. Es el único cambio de su superficie: comprueba el individuo exacto en el estado.
  - `alive` lo usa. Un individuo oculto porque su área está `idle` sigue vivo; uno retirado, inexistente o limpiado al pasar a `dormant`, no.
  - El engage sigue exigiendo un individuo mostrado.

### 9.3 Evidencia

- **Sondas originales R01–R09**, sin relajar ninguna aserción:
  - sobre una exportación del commit `b6b5938`: **9/9**, salida `0`;
  - salida en `D:\Claude-ECO2-REPRO-001197fa-20261008\evidence-b6b5938e…` y log en `probes-b6b5938e….txt`.
- **Regresiones nuevas** en `ecoBattles.test.js`:

  | Caso | Qué cubre |
  |---|---|
  | F1 | Reemplazo sin ECO y reemplazo con protocolo viejo. Replay aceptado, acción nueva y huida rechazados sin llegar al ledger. Pausa inmediata, sin snapshots al socket viejo. Su `onLeave` tardío no cambia nada. Un socket ECO dentro de la gracia reanuda. |
  | F2 | Reconexión a límite −1 ms (reanuda), a límite exacto y a límite +1 ms (libera en el acto), sin tick entre medio. También el engage tras la gracia: combate nuevo, nunca el vencido. |
  | F3 | `alive` con el individuo mostrado, oculto (`idle`), limpiado (`dormant`), retirado, con generación o miembro inexistentes y con otro namespace. Además, la desaparición bajo una reserva termina como `vanished`. |
  | `admissionBundle.test.ts` | La superficie suma `exists`, que se prueba con mostrado, oculto, dormido, retirado e inexistente. |

  Las cuatro pruebas nuevas de `ecoBattles.test.js` **fallan** con el código de `001197f`: se ejecutaron sobre su exportación y dieron 16 aprobadas y 4 fallidas. Con la corrección pasan.

### 9.4 Gates (Node 22.23.2)

| Gate | Resultado |
|---|---|
| Realtime completo | 645 pruebas: 611 pasan, 0 fallan, 34 omitidas (condicionales previas). |
| vitest completo | 235 archivos, 2213/2213. |
| `vue-tsc` | exit 0. |
| eslint en `src/features/world`, `src/features/ecosystem` y `scripts/ecosystem` | exit 0. |
| `--check` de los bundles `battle`, `admission`, `encounters` y `skills` | Todos al día. |
| Build de producción con `VITE_ECO_EXPERIMENT=on` | 193 fuentes. La única ECO sigue siendo `ecoPopulace.ts`, inerte. 0 apariciones de `EcoBattlePanel`, `EcoBattleSession`, `EcoDevPanel`, «Combatir», «Combate de prueba», «fixture de prueba», `prepareEncounterBattles` y `ecoProtocol`. |

**No se repitió:** el e2e de red (`eco-battle-e2e.mjs`) necesita levantar el realtime aislado, y esta corrección no autorizó procesos nuevos. La revisión tampoco lo usó como evidencia.

### 9.5 Legibilidad (commit aparte)

Antes, los botones deshabilitados de `EcoDevPanel.vue` usaban el estilo del navegador con `opacity: 0.5` y casi no se veían. Ahora tienen texto `#c9d3da`, fondo `#34404b` y borde `#5a6874`.
- No cambian el comportamiento, la distribución ni ningún otro estilo.
- Se comprobó en el navegador con una maqueta estática que usa los colores exactos del panel (antes y después).

El pulido gráfico restante de los paneles queda pendiente, por separado y sin rediseño.

### 9.6 Smoke humano (registrado)

El usuario aprobó el smoke de dos ventanas el 2026-10-07 sobre `001197f`. Es una **aprobación funcional**, no del acabado gráfico.

| Caso | Resultado |
|---|---|
| Combate, huida, disputa entre dos jugadores, victoria, derrota y desconexión | Funcionaron correctamente. |
| Vencimiento | **No observado por el humano.** No se registra como smoke aprobado; queda respaldado solo por la prueba técnica (§4.1, Metapod con semilla 7 → `expired` a 120 000 ms, y A08/A08b). |

Las correcciones F1–F3 afectan a fronteras de socket y tiempo que el smoke humano no ejercita. Las cubren las sondas y las regresiones de §9.3.

**Candidato congelado para revisar el delta:** `feat/eco-gameplay-2-0.3` en el commit de este reporte. Sin push ni merge, sin Cloud ni Supabase, y sin cambios en entornos activos.

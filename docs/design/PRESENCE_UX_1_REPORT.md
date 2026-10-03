# PRESENCE UX-1 — Entrada autoritativa sin parpadeo de Ciudad

> Base: `integration/world-skills-0.3 @ 80c6ab8`. Rama: `world/authoritative-entry-loading-0.3` (worktree `pokeswap-entry1`).
> Solo cliente y tests de cliente. Sin cambios en el servidor realtime, el protocolo, SQL, migraciones, Edge Functions, flags, la base ni el entorno oscuro.

## 1. Problema (FACT, en `80c6ab8`)

En una carga online, `WildlandsView`:

1. construía el motor en Ciudad, o en `?area=`/`x`/`y` o en la casilla de Ciudad guardada en `localStorage` (`initialTownPosition`);
2. calentaba esa área (`prepare`), arrancaba el loop y ocultaba «Llegando a Ciudad Corazón…»;
3. recién después conectaba el socket y esperaba `presence:snapshot`;
4. si el snapshot ubicaba al actor en Pradera o en `cueva-inicial`, `setAuthoritativeActor` hacía `enterArea` sobre una escena ya visible.

El servidor nunca ubicó al actor en Ciudad: el parpadeo era solo del cliente. En la reconexión pasaba lo mismo a menor escala: la escena seguía viva sin otros jugadores, y un snapshot de otra área cambiaba la escena sin preparar.

## 2. Secuencia antes y después

**Antes (online, actor guardado en Pradera):**

```
loading "Llegando a Ciudad Corazón…" → [Ciudad visible, HUD y minimapa de Ciudad] → snapshot → enterArea(pradera) sin preparar → [Pradera]
áreas visibles: [ciudad-corazon, pradera]
```

**Después:**

```
overlay opaco "Entrando al mundo…" (escena retenida, nada dibujado, sin HUD, sin input)
  → snapshot (el motor pasa a Pradera, todavía retenido)
  → prepare() de Pradera
  → reveal → [Pradera]
áreas visibles: [pradera]
```

**Reconexión, misma área:** último frame congelado + «Reconectando…» → snapshot → 0 `enterArea` → reveal.
**Reconexión, otra área:** último frame congelado + «Reconectando…» → snapshot → 1 `enterArea` bajo el overlay → `prepare()` → un solo reveal.
**Sin realtime (`VITE_REALTIME_URL` ausente):** idéntico a `80c6ab8`.

## 3. Máquina de estados

`src/features/wildlands/multiplayer/domain/worldEntry.ts` (pura, sin DOM ni timers):

| Fase | Qué se ve | Input | Sale por |
| --- | --- | --- | --- |
| `offline` | el mundo local de siempre | normal | — (terminal) |
| `connecting` | fondo neutro opaco, «Entrando al mundo…» | bloqueado | `prepared` → `ready`; 12 s sin autoridad → `connection-error` (`entry`); 4001 → `replaced` |
| `ready` | la escena | normal | pérdida o cambio de sesión → `reconnecting`; 4001 → `replaced` |
| `reconnecting` | último frame atenuado, «Reconectando…» | bloqueado | `prepared` → `ready`; 15 s sin autoridad → `connection-error` (`reconnect`); 4001 → `replaced` |
| `connection-error` | «No pudimos entrar al mundo.» o «No pudimos reconectar.» + **Reintentar** (con foco) | bloqueado | Reintentar → la espera que falló |
| `replaced` | «Tu sesión se abrió en otra pestaña o dispositivo.» (con foco), sin botón | bloqueado | — (final) |

Tres condiciones separadas en el estado:
- `authority`: el socket actual recibió un snapshot;
- `prepared`: el motor terminó de preparar el área en la que ese snapshot lo dejó;
- `live`: la escena dibuja y acepta input. Solo pasa a `true` cuando las dos anteriores se cumplen.

El estado no tiene área, casilla ni coordenada. Una pérdida mientras se preparaba el área invalida ese snapshot. Un fallo de `prepare()` da error y nunca revela. Un timeout da error y nunca un lugar.

## 4. Arquitectura

```
WildlandsView (cableado)
  ├─ WorldEntryOverlay.vue        presentación de la fase (props → texto, rol, botón)
  ├─ WorldEntryController         multiplayer/state: timers, un socket por intento, hold/prepare/reveal
  │    └─ worldEntry.ts           multiplayer/domain: transiciones puras
  ├─ ColyseusPresence             api: además informa snapshot / lost / replaced (puerto opcional)
  └─ WildlandsGame                engine: holdScene() / revealScene() / prepare()
```

- **Motor (`game.ts`, +25 líneas):**
  - `holdScene()` detiene el loop, de modo que el canvas conserva su último frame (ninguno antes del primer reveal);
  - mientras está retenido no hay update, ni HUD, ni `observe` de invitados;
  - teclado, tap y drag quedan rechazados, y nada vuelve a enganchar el teclado (unpause, visibilidad, fin de espectador);
  - `revealScene()` lo devuelve;
  - sin hold, el motor es el de antes.
- **Adaptador (`colyseusPresence.ts`):**
  - cuarto parámetro opcional `status: PresenceConnectionStatus`;
  - `snapshot(access)` se emite después de aplicar el snapshot al motor;
  - `lost()` se emite en caídas y cierres que no son 4001, y `replaced()` en 4001, donde el adaptador ya se detenía;
  - un snapshot de una room que el adaptador ya dejó se ignora (`this.room !== room`);
  - sin cambios de mensajes, opciones de join ni protocolo;
  - `REALTIME_CONFIGURED` exporta si hay URL de realtime.
- **Controlador (`worldEntryController.ts`):**
  - `start()` retiene la escena antes de abrir el socket;
  - cada socket tiene una generación: el estado que informa un socket reemplazado (por reintento o cambio de sesión), y un `prepare` lanzado por él, se ignoran;
  - un timeout o un error cierran el socket (`disconnect`), lo que también corta sus reintentos internos;
  - `retry()` abre exactamente un socket nuevo y solo desde `connection-error`;
  - `renew()` (cambio de sesión) no hace nada en `connection-error` ni en `replaced`.
- **Vista (`WildlandsView.vue`, +35 líneas):**
  - online ignora `?area`, `x`, `y`, `initialTownPosition` y la puerta de un link directo;
  - construye el motor en su área por defecto ya retenida, sin `prepare` previo;
  - delega el socket en el controlador;
  - «Llegando a Ciudad Corazón…» queda solo para `offline`;
  - la rama offline conserva el orden exacto de antes.
- **Overlay (`WorldEntryOverlay.vue`):**
  - z-index 50: tapa el HUD del mundo (≤ 35) y deja el botón de bugs del playtest (60) y el modal de auth;
  - toma todos los punteros;
  - mientras se ve, todo lo que tapa queda `inert` (`components/entryInert.ts`), incluso lo que aparece después y los otros diálogos (`LobbyPanel`, `PlazaPokemonCard`, `WildPokemonCard`) (R4);
  - la única excepción es el hermano que lleva `data-world-entry-keep-interactive`. `WildlandsView` se lo pone al `AuthModal` y el atributo cae en su raíz (`.auth-overlay`), que solo contiene el diálogo de ingreso. Se lee en el hermano mismo, nunca en sus descendientes. `aria-modal`, z-index y texto no deciden nada;
  - si el foco ya está en el diálogo de ingreso, el overlay no lo mueve;
  - `role="status"` con `aria-busy` mientras espera, `role="alert"` en error y en `replaced`, rotulado por su mensaje (`aria-labelledby`);
  - el foco va a Reintentar en error y al mensaje (`tabindex="-1"`) en `replaced` (R4);
  - el botón es nativo, con `type="button"` y 44 px mínimos.

### Decisiones y rótulos

- **Área del invitado (contrato desde R1):** el snapshot de invitado no trae área (`{ access: 'guest', actors }`). El servidor ubica a todo observador nuevo en `AREA.TOWN` (`PresenceRoom.onJoin`, fijado por `PresenceRoom.test.js`). El cliente muestra su área por defecto, `LOBBY_ID`, recién cuando llega ese snapshot. `guestAreaContract.test.ts` importa `AREA` del módulo de protocolo del servidor y exige `LOBBY_ID === AREA.TOWN`; el e2e de invitado compara contra `AREA.TOWN`. Ya no se usa `?area=` para invitados online.
- **FACT — `?area=` del benchmark:** `ColyseusPresence` sigue mandando `benchmark.area` solo con `VITE_PRESENCE_BENCHMARK=on` en DEV/PERF, y solo lo lee `BenchmarkPresenceRoom`. No se tocó.
- **Decisión — `replaced` sin botón:** el brief pide «sin reintento automático» y no menciona un botón. Ofrecer uno echaría a la otra pestaña o dispositivo. Se recarga la página.
- **PREEXISTENTE — `watch(user)`:** `useAuth` reasigna `user` en cada `onAuthStateChange`, incluidos los refrescos de token. Antes eso ya reemplazaba el socket. Ahora se ve como un «Reconectando…» breve, que no remonta el área si es la misma. No se cambió (fuera de alcance).
- **Timer inicial:** los 12 s corren desde que se abre el socket, después de cargar la Pokédex y esperar la sesión, como el `connect()` anterior.
- **Tamaño:** `game.ts` (1117 → 1142) y `WildlandsView.vue` (717 → 752) ya superaban las guías de tamaño. Lo nuevo vive en módulos propios; en esos dos archivos solo hay cableado.
- **Cliente desactualizado:** el mensaje específico de `client-outdated` (`Actualizá la página para seguir trabajando.`, de `worldSkillsSession`) es un rechazo de trabajo, no de conexión. No pasa por el overlay y queda intacto. Un `presence:error` tampoco cambia la fase.

## 5. Pruebas

| Archivo | Qué prueba | Tests |
| --- | --- | --- |
| `multiplayer/state/worldEntry.e2e.test.ts` | Motor real + `ColyseusPresence` real + controlador, contra una room Colyseus falsa. «Visible» = lo que el motor entregó al renderer, frame a frame | 18 |
| `multiplayer/state/worldEntryController.test.ts` | Controlador con escena, sockets y timers falsos | 8 |
| `multiplayer/domain/worldEntry.test.ts` | Transiciones puras | 12 |
| `engine/sceneHold.test.ts` | Hold/reveal del motor, offline sin cambios, guardas de input una por una | 5 |
| `components/WorldEntryOverlay.test.ts` | Textos, roles, botón, snapshot de markup por estado | 8 |
| `components/worldEntryView.guard.test.ts` | Cableado de la vista (orden online, rama offline intacta, renew, dispose) | 7 |

Cobertura del brief:
- **Motor:**
  - Pradera → `[pradera]`;
  - cueva → `[cueva-inicial]`;
  - nada dibujado, y ningún HUD, antes del snapshot, aunque pasen 10 s;
  - invitado → `[ciudad-corazon]` solo después del snapshot;
  - con `prepare()` pendiente no se dibuja nada;
  - snapshot repetido de la misma área: 1 solo `enterArea` en total;
  - la casilla final es la del servidor.
- **Reconexión:**
  - último frame conservado (0 frames nuevos);
  - tap y drag rechazados aun forzando `spectator=false`;
  - misma área → 0 `enterArea`;
  - otra área → exactamente 1, sin frame nuevo hasta terminar `prepare`, y luego `[pradera, cueva-inicial]`;
  - 15 s → `connection-error`/`reconnect` y la escena sigue siendo Pradera.
- **Errores:**
  - 12 s → `connection-error`/`entry`, y en los 120 s siguientes no hay más joins;
  - Reintentar (con doble click) → +1 `Client` y +1 join;
  - un snapshot tardío de la room vieja no ubica ni revela;
  - 4001 → `replaced`, `renew`/`retry` ignorados y 0 joins en 5 minutos;
  - el adaptador solo, sin controlador, también se detiene en 4001;
  - `presence:error` (`client-outdated`) no cambia la fase.
- **Componente:**
  - nunca «Llegando a Ciudad Corazón…» online;
  - «Entrando al mundo…» hasta `ready`, incluso con snapshot recibido y área en preparación;
  - «Reconectando…»;
  - errores accesibles;
  - snapshot nuevo `__snapshots__/WorldEntryOverlay.test.ts.snap` (no se modificó ningún snapshot existente).

### 5.1 Controles negativos (mutantes)

Runner en el scratchpad de la sesión (`ux1/mutants.py`): aplica cada mutante, corre la batería focalizada y restaura el archivo. **22/22 muertos:**

| # | Mutante | Muere en |
| --- | --- | --- |
| M1a | el controlador no retiene antes de abrir (Ciudad visible primero) | controller + e2e |
| M1b | la vista trata el realtime como offline | guard de vista |
| M1c | «Llegando a Ciudad Corazón…» también online | guard de vista |
| M2a | `prepared` junto con el snapshot (revelar antes de preparar) | controller |
| M2b | la máquina pasa a `ready` con el snapshot | máquina |
| M3a / M3a2 | tap / drag ignoran el hold (input durante reconexión) | e2e |
| M3b | fin de espectador re-engancha el teclado retenido | sceneHold |
| M3c | una pérdida no retiene la escena | controller + e2e |
| M3d | `update` lee la dirección retenido | sceneHold |
| M3e | el loop sigue con la escena retenida | sceneHold |
| M4a | Reintentar fuera de `connection-error` (sockets duplicados) | controller + e2e |
| M4b | abrir un socket sin cerrar el anterior | controller |
| M4c | el snapshot de una room ya dejada se aplica | e2e |
| M4d | sin chequeo de generación (listeners viejos activos) | controller |
| M5a | el adaptador sigue reconectando tras 4001 | e2e (adaptador solo) |
| M5b | el controlador trata 4001 como pérdida (auto-reintento) | controller + e2e |
| M6a | un timeout entra al mundo | máquina |
| M6b / M6c | timeouts 15/12 cruzados | máquina + controller |
| M7 | un snapshot de la misma área remonta | e2e |
| M8 | `replaced` ofrece Reintentar | componente |

M3d y M3e sobrevivían a la primera corrida: son guardas redundantes con detener el loop. Se agregó un test que ejerce cada guarda por separado. M5a sobrevivía porque el controlador cerraba el socket de todos modos; se agregó la prueba del adaptador solo.

## 6. Gates (punta de código `f5270b7`)

| Gate | Resultado |
| --- | --- |
| Focalizados UX-1 (multiplayer, sceneHold, overlay, guard de vista, noCityTeleport) | 14 archivos, 85/85 |
| Presencia/reconciliación cliente (presenceReconciliation, remoteActors, remotePlayback, doorPresence, multiplayer) | 14 archivos, 89/89 |
| CAVES-4 cliente (caves, áreas, navegación) | 8 archivos, 45/45 |
| CAVES-4 + presencia realtime (navigation, rooms/*, presence, reconnectCache, interest) | 126/126 |
| WORLD × SKILLS y YIELD-2 cliente (world, worldSkills, WORK CANCEL-1 e2e) | 14 archivos, 84/84 |
| Vitest completo | 197 archivos, 1887/1887 |
| typecheck | OK |
| lint | 0 errores, 9 warnings ya existentes (AuthModal) |
| Build normal + `bundle-check normal` | ✓ |
| Build Playtest + `bundle-check playtest` | ✓ |
| Realtime completo, Node 24 | 492: 461 aprobados, 0 fallos, 31 omitidos (staging) |
| Realtime completo, Node 22.23.2 | 492: 461 aprobados, 0 fallos, 31 omitidos |
| Harness de presencia (`scripts/presence-harness/run.sh`) | 5 escenarios, cliente = servidor; S5: los 9 rechazos de ritmo ya conocidos |
| Drift de SKILLS / `zone-layout --check` | OK / al día |
| Sin cambios en servidor, protocolo, SQL, Edge, scripts ni dependencias | `git diff --name-only 80c6ab8.. -- services supabase scripts package.json package-lock.json` vacío |
| Controles negativos | 22/22 muertos (§5.1) |

Deno y staging omitidos: no hay diff en `supabase/`.

### 6.1 Verificación en navegador (aislada)

Se hizo con un build de esta rama servido con `vite preview` en el puerto 5191 y un realtime **local y aislado** en modo benchmark (puertos 2690/2691, sin secretos). La Supabase era un placeholder. El entorno oscuro no se tocó: 2567/2568/5173 conservan sus PIDs, el realtime oscuro sigue con `startedAt` 20:28:31Z y el monitor sigue en marcha.

- **Realtime caído:**
  - fondo neutro con «Entrando al mundo…»;
  - a los ~12 s, «No pudimos entrar al mundo.» con Reintentar, sin Ciudad debajo.
- **Reintentar con el realtime ya levantado:** un intento; el invitado entra a Ciudad después del snapshot.
- **Recarga con identidad benchmark ubicada por el servidor en Pradera:** muestreo del DOM en cada frame, dentro de un iframe del mismo origen:
  ```
  overlay «Entrando al mundo…» → escena → HUD «Pradera (-5, -69)»
  ```
  - nunca «Ciudad» ni «Llegando a Ciudad Corazón…»;
  - durante 67 ms el HUD muestra su «—» inicial hasta el primer emit del motor; es el valor por defecto del HUD, no un área.
- **Se corta el realtime estando en Pradera:**
  - «Reconectando…» sobre el último frame congelado y atenuado;
  - al volver el realtime, la misma Pradera (-5, -69), sin escena intermedia.
- **Consola:** solo los errores esperables del placeholder de Supabase (puerto 1) y las conexiones rechazadas con el realtime caído.

## 7. Revisión

1. `git fetch` y `git log --oneline 80c6ab8..origin/world/authoritative-entry-loading-0.3`.
2. `git diff --name-only 80c6ab8..origin/world/authoritative-entry-loading-0.3 -- services supabase scripts package.json package-lock.json` tiene que estar vacío.
3. Leer `multiplayer/domain/worldEntry.ts`, `multiplayer/state/worldEntryController.ts`, el diff de `colyseusPresence.ts`, `game.ts` y `WildlandsView.vue`, y `WorldEntryOverlay.vue`.
4. Gates:
   ```
   npx vitest run
   npm run typecheck
   npx eslint .
   npm run build && node scripts/swap-retire/bundle-check.mjs normal
   VITE_PLAYTEST=on npm run build && node scripts/swap-retire/bundle-check.mjs playtest
   cd services/realtime && node --test src/**/*.test.js src/*/*/*.test.js
   ```
5. Validación humana propuesta, en el entorno oscuro, recién cuando se integre y se reinicie (no ahora):
   - recargar estando en Pradera y en la cueva: nunca se ve Ciudad, ni siquiera el minimapa;
   - recargar como invitado: «Entrando al mundo…» y después Ciudad;
   - cortar la red unos segundos: «Reconectando…» sobre la última escena, sin moverse, y vuelve a la misma área;
   - abrir la cuenta en otra pestaña: la vieja dice «Tu sesión se abrió en otra pestaña o dispositivo.», con el foco en ese mensaje, y no vuelve a conectarse;
   - con teclado: en «Entrando al mundo…» Tab no llega a nada del mundo; en error Tab queda en Reintentar y Enter reintenta;
   - realtime caído: «No pudimos entrar al mundo.» a los 12 s, y Reintentar entra cuando vuelve.

**Integración:** merge `--no-ff` en `integration/world-skills-0.3`. El realtime no cambia, así que para la validación oscura alcanza con reiniciar el cliente. Requiere autorización aparte.

## 8. Revisión 1 y correcciones (R1–R4)

La revisión de `20af2d0` dio **APPROVE WITH REQUIRED FIXES**. Correcciones, una por commit, sobre la misma rama:

| Commit | Qué |
| --- | --- |
| `3dcc3b2` | **R1** contrato del área invitada: `guestAreaContract.test.ts` (`LOBBY_ID === AREA.TOWN`, importado de `services/realtime/src/protocol/messages.js`); el e2e de invitado compara contra `AREA.TOWN` |
| `9e2323e` | **R2** snapshot posterior al timeout: e2e, máquina y controlador |
| `9e96acb` | **R3** `if (disposed) return` después del `await import('../perf/usePerfCapture')` en `WildlandsView`, más una prueba que monta la vista real |
| `849c657` | **R4** overlay accesible: `inert`, foco y el texto de 4001 |
| `0c3f6ae` | **R4** ciclo de vida completo de `inert`, con el `AuthModal` real |
| `6c144ed` | **R4** `holdScene` suelta el teclado por sí mismo (cierra el control negativo N14) |
| `5148b60` | **R4** solo el diálogo de ingreso escapa del `inert`: marcador explícito en lugar de la regla `aria-modal` (finding de la revisión final, §8.6) |

Sin cambios en `services/`, `supabase/`, `scripts/`, `package*.json`, el protocolo, SQL, Edge Functions ni la persistencia: `git diff --name-only 80c6ab8..HEAD -- services supabase scripts package.json package-lock.json` está vacío.

### 8.1 Qué prueba cada corrección

- **R1:**
  - el import de `messages.js` vive solo en dos tests, con `@ts-expect-error` porque el módulo no trae `.d.ts` y agregarle uno tocaría `services/`;
  - en `dist` (normal y Playtest) no aparecen `TOWN:"ciudad-corazon"`, `OBSERVE:"observe"`, `CHAT_HISTORY:"chat:history"`, `guestAreaContract` ni `WIRE_AREA`;
  - control positivo del método: `WORK_RESULT:` de `worldProtocol.js`, que sí se bundlea, aparece en 1 archivo.
- **R2:**
  - e2e: timeout de la entrada → la room vieja entrega un snapshot tardío de `cueva-inicial` **antes** de reintentar. Sigue en `connection-error`; no se dibuja nada; 0 `enterArea`; no hay `revealScene` ni `keys.attach`. Tap, drag y una flecha no hacen nada; la posición queda igual; no se crea `Client` ni join durante 60 s;
  - máquina: desde `connection-error`, `snapshot`, `prepared`, `lost`, `timeout`, `prepare-failed` y `renew` devuelven el mismo estado; solo `retry` vuelve a esperar (`replaced` sigue siendo final);
  - controlador: tras el timeout, el estado del socket viejo y `renew` no cambian nada; solo `retry` abre el segundo socket.
- **R3:** `worldEntryView.unmount.test.ts` monta `WildlandsView` (build de medición online) con el import de captura retenido. Desmonta, libera el import y comprueba:
  - 0 controladores, 0 `Client` y sin `attach` de la captura;
  - sin timers, frames ni listeners nuevos;
  - `entry`, `loading` y `perfCapture` sin cambios.
- **R4:**
  - `entryInert.test.ts`: cubre a todos los hermanos menos a sí mismo; solo respeta al hermano marcado (un `aria-modal` queda `inert`, y un contenedor con un descendiente marcado también); deja como estaba lo que ya era `inert`; cubre lo que aparece después; al liberar deja de observar; saca el foco de un input tapado;
  - `entryInert.panels.test.ts`, con `AuthModal`, `LobbyPanel`, `PlazaPokemonCard` y `WildPokemonCard` reales, en `connecting`, `reconnecting`, `connection-error` y `replaced`:
    - panel y cartas quedan `inert`, incluidos sus links, inputs y botones;
    - el `AuthModal` sigue usable (foco, escritura y cierre);
    - quien escribe en él no pierde el foco cuando llega el error;
    - abrir y cerrar panel, cartas e ingreso con el overlay ya visible los cubre bien, dos vueltas;
    - en `ready` vuelve exactamente el `inert` previo; al desmontar no queda `inert` ni observer;
  - guard de la vista: el marcador aparece una sola vez, en `<AuthModal`. Cae en la raíz `.auth-overlay` y no cambian clase, `role`, `aria-modal` ni `aria-label`. `AuthModal.vue` no lo menciona y ningún estilo lo usa;
  - `WorldEntryOverlay.keyboard.test.ts`, con el overlay entre sus hermanos reales:
    - en `connecting` el orden de tabulación queda vacío;
    - una pérdida saca el foco del chat;
    - en error y en el error de reconexión el foco va a Reintentar, único destino de Tab;
    - en `replaced` el foco va al mensaje, sin botón ni destinos;
    - en `ready` no queda nada `inert` ni foco en el overlay que ya no está;
    - lo que aparece mientras está cubierto queda cubierto y el diálogo de ingreso (marcado) no;
    - desmontar libera todo;
  - `entryInert.lifecycle.test.ts`:
    - recorre connecting → error → retry → ready → reconnecting → error → retry → ready → replaced → unmount con el `AuthModal` real;
    - lo que ya era `inert` sigue igual y nada más queda `inert` en `ready` ni al desmontar;
    - como máximo 1 `MutationObserver` activo; se crean 3 (una por aparición) y ninguno sobrevive;
    - el `AuthModal` sigue usable, abierto antes o durante el overlay;
  - e2e de teclado: flechas, WASD, Space y E no mueven ni interactúan en `connecting` ni en `reconnecting`, y una flecha sostenida durante la espera no camina después del reveal;
  - `sceneHold`: con acceso de jugador intacto, `holdScene` suelta el teclado y una flecha apretada mientras está retenida no camina después del reveal.

### 8.2 Controles negativos

Runner `mutants-r.py` sobre una copia `git archive` (no sobre el worktree). Corre la batería focalizada (`multiplayer`, `sceneHold`, `components`) y restaura cada archivo.

- **Los 22 originales: 22/22 muertos**, cada uno en el test que nombra su causa.
- **Nuevos: 16/16 muertos** (N14 al segundo intento, ver abajo).

| # | Mutante | Muere en |
| --- | --- | --- |
| N1 | R2: el timeout no cierra el socket | e2e snapshot tardío + controlador |
| N2 | R2: `closeSocket` no avanza la generación **y** el adaptador aplica la room dejada | e2e snapshot tardío + e2e retry + controlador |
| N3 | R2: la máquina sale de `connection-error` con un snapshot | máquina |
| N4 | R2: la máquina sale de `connection-error` con `prepared` | máquina |
| N5 | R3: sin el guard después del import de captura | prueba de montaje (`controllers` = 1) |
| N6 | R4: el overlay no hace `inert` | teclado y foco (6 tests) |
| N7 | R4: el error no enfoca Reintentar | teclado y foco |
| N8 | R4: `replaced` no enfoca su mensaje | teclado y foco |
| N9 | R4: liberar deja el mundo `inert` | `entryInert` + teclado |
| N10 | R4: el diálogo de ingreso también queda `inert` | `entryInert` + teclado |
| N11 | R4: lo que aparece después no se cubre | `entryInert` + teclado |
| N12 | R4: el foco se queda en un input tapado | `entryInert` + teclado |
| N13 | R4: el texto viejo de 4001 | overlay + teclado |
| N14 | R4: `holdScene` no suelta el teclado | `sceneHold` (agregado en `6c144ed`) |
| N15 | R1: el servidor ubica observadores en otra área (solo en la copia) | contrato + e2e invitado |
| N16 | R1: el área por defecto del cliente no es Ciudad | e2e invitado y entrada + `sceneHold` |

N14 sobrevivía en la primera corrida (37/38). Todo camino actual hacia el hold pone el acceso en `pending`, que también suelta el teclado, así que el mutante era equivalente en los flujos existentes. Se agregó el test directo del contrato de `holdScene` y el mutante muere.

Controles del marcador explícito (`mutants-r4b.py`, sobre una copia de `5148b60`): **11/11 muertos**.

| # | Mutante | Muere en |
| --- | --- | --- |
| P1 | vuelve la exclusión genérica por `aria-modal`, junto al marcador | paneles y cartas en las 4 fases + abrir/cerrar + `entryInert` |
| P2 | la regla anterior: solo `aria-modal`, sin marcador | idem |
| P3 | un descendiente marcado deja usable a todo su contenedor | `entryInert` |
| P4 | sin excepción: el ingreso también queda `inert` | paneles (4 fases) + ciclo de vida + teclado |
| P5 | la vista no marca el `AuthModal` | guard de la vista |
| P6 | el overlay le roba el foco al diálogo de ingreso | paneles (foco al llegar el error) |
| N6, N9, N11, N12 | sin `inert`, liberar deja `inert`, sin cubrir lo nuevo, foco en input tapado (repetidos sobre el código nuevo) | paneles, ciclo de vida, `entryInert`, teclado |
| N17 | liberar no desconecta el observer | paneles + ciclo de vida + `entryInert` |

### 8.3 Gates (código de `849c657`; después solo se agregaron tests, que corrieron aparte)

| Gate | Resultado |
| --- | --- |
| Focalizados UX-1 (`multiplayer`, `sceneHold`, `components`) | 26 archivos, 127/127 |
| Presencia/reconciliación cliente | 94/94 |
| CAVES-4 cliente | 45/45 |
| WORLD × SKILLS cliente | 84/84 |
| Vitest completo | 201 archivos, 1905/1905 |
| typecheck | OK |
| lint | 0 errores, los 9 warnings ya existentes (AuthModal) |
| Build normal + `bundle-check normal` + chequeo de `dist` | ✓ |
| Build Playtest + `bundle-check playtest` + chequeo de `dist` | ✓ |
| Realtime Node 24.19 | 492: 461 aprobados, 0 fallos, 31 omitidos |
| Realtime Node 22.23.2 | 492: 461 aprobados, 0 fallos, 31 omitidos |
| CAVES-4 + presencia realtime | 126/126 |
| Drift de SKILLS / `zone-layout --check` | OK / al día |

Sobre `086ff5d` (los tests de `0c3f6ae` y `6c144ed`): Vitest completo 202 archivos, 1908/1908; focalizados 27 archivos, 130/130; typecheck OK; lint 0 errores.

Sobre `5148b60` (§8.6), en una copia `git archive`:
- focalizados: 28 archivos, 139/139;
- presencia cliente: 94/94; CAVES-4 cliente: 45/45;
- Vitest completo: 203 archivos, 1917/1917;
- typecheck OK; lint 0 errores (9 warnings ya existentes);
- builds normal y Playtest con `bundle-check` ✓;
- `dist`: el marcador aparece en 1 archivo (la vista); los marcadores de `messages.js` siguen en 0.

Realtime no se repitió: el delta no toca `services/`.

Todo corrió en copias `git archive` del scratchpad con `node_modules` como junction a int1. No se borró ninguna caché (`.vite` incluida).

### 8.4 Verificación en navegador (teclado real, aislada)

- **Montaje:**
  - build online de esta rama, con `VITE_REALTIME_URL=ws://127.0.0.1:2690` y Supabase placeholder;
  - servido con `vite preview` en el 5192 (entrada temporal de `launch.json`, ya quitada);
  - realtime aislado en modo benchmark en 2690/2691;
  - el entorno oscuro (2567/2568/5173, `startedAt` 20:28:31Z) y su monitor no se tocaron.
- **Realtime caído:**
  - «Entrando al mundo…» con `role="status"`; 9 de los 10 hermanos del overlay `inert` y 0 controles alcanzables;
  - 4 Tab reales no llegan a nada;
  - a los 12 s, «No pudimos entrar al mundo.» con `role="alert"` y el foco en Reintentar; 3 Tab reales siguen ahí.
- **Enter real sobre Reintentar, con el realtime ya levantado:** «Entrando al mundo…» → mundo; 0 `inert`; 7 controles alcanzables; el siguiente Tab cae en un control del mundo («Arriba»).
- **Pérdida con el foco en «Menú»:**
  - «Reconectando…» sobre la escena; el foco sale de «Menú»; 9 `inert`; 0 alcanzables;
  - a los 15 s, «No pudimos reconectar.» con el foco en Reintentar;
  - Enter real → «Reconectando…» → mundo, 0 `inert`.
- **Corte breve:** el adaptador reconecta solo («Reconectando…» → mundo, 0 `inert`).
- **Consola:** solo los errores esperables del placeholder de Supabase (puerto 1).
- **No verificado en navegador:**
  - el teclado sobre el motor: en este build el visitante entra como invitado, que nunca camina; lo prueban el e2e y `sceneHold` con acceso de jugador;
  - 4001, el `AuthModal` sobre el overlay y paneles o cartas abiertos debajo: los prueban los tests de componente con los componentes reales (§8.1).

### 8.5 Deudas registradas (no se implementan en este encargo)

1. **Errores y timeout internos de `prepare()`.** Una excepción dentro del callback de `requestIdleCallback` (`engine/chunks.ts`, `buildWhenIdle`) nunca resuelve ni rechaza la promesa. Como `waitLimitMs` ya es `null` con autoridad, la pantalla queda en «Entrando al mundo…» sin timeout ni Reintentar. Hace falta propagar el error o poner un límite que termine en `prepare-failed`. Mismo riesgo que tenía el `prepare` previo a UX-1.
2. **Refresco de token sin cambio de usuario.** `useAuth` reasigna `user` en cada `onAuthStateChange`, incluidos los refrescos, y `watch(user)` llama a `renew()`. Resultado: hold, «Reconectando…», ruta cancelada y pasos predichos sin confirmar rebobinados. No hay loop ni remontaje. Habría que renovar solo si cambia `user.id`. PREEXISTENTE (antes se reemplazaba el socket igual, sin overlay).
3. **Cierre de sesión de un invitado dentro de la cueva.** Al pasar de jugador a invitado dentro de `cueva-inicial`, el motor se queda en la cueva y el `observe` de invitado se rechaza (`OBSERVABLE_AREAS` no la incluye). El invitado ve la cueva sin actores. PREEXISTENTE.

### 8.6 Revisión final: diálogos debajo del overlay

La revisión final de `786bb96` encontró que `entryInert` dejaba usable a cualquier hermano que fuera o contuviera `[aria-modal="true"]`. Esto incluía, además del ingreso:
- `LobbyPanel` (z 20);
- las cartas de la plaza (z 12), que son hijas directas de `.wl` porque `LobbyPlaza` es un fragmento.

Las tres quedan debajo del overlay (z 50), y sus controles seguían alcanzables con teclado. Pasaba en dos casos:
- un link directo a una función con sesión iniciada, durante «Entrando al mundo…»;
- un panel o una carta abiertos al perder la conexión.

No era una regresión frente a `20af2d0` (que no tenía nada `inert`) ni un problema de seguridad (esas acciones son del servidor), pero contradecía R4.

Corrección (`5148b60`):
- sin regla genérica: solo queda fuera el hermano que lleva `data-world-entry-keep-interactive`;
- `WildlandsView` lo pone al `AuthModal` como atributo heredado, así que `AuthModal.vue` no cambia;
- el overlay no mueve el foco si ya está dentro de ese diálogo.

Pruebas y controles: §8.1 y §8.2.

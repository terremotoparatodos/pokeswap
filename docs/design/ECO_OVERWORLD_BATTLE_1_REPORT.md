# ECO-OVERWORLD-BATTLE-1 — Reporte: el combate de prueba dentro del overworld (sandbox)

**Rama:** `feat/eco-overworld-battle-0.3`, hija explícita de `ec4d804`. Las razones y el dictamen de ese candidato están en las [notas previas](ECO_OVERWORLD_BATTLE_1_NOTES.md), §0. Sin push ni merge.

**Propuesta aprobada:** `docs/overworld-battle-proposal-0.3` @ `8729fe8`, decisiones A–F.

**Alcance:**
- solo presentación e interacción del cliente, detrás de `ECO_EXPERIMENT`;
- sin cambios de servidor, protocolo, reservas, relojes, core, fixtures, balance ni rango. El diff contra `ec4d804` está vacío en `services/`, `battle/`, `ecosystem/`, `pokemon/`, `dungeonPrototype/` y paquetes;
- sin captura, recompensas ni persistencia.

## 1. Commits

| Commit | Contenido |
|---|---|
| `1a64d76` | Notas previas: base explícita, cadena de *fallback* sin órdenes y datos de la barra de acción. |
| `d78820c` | El salvaje ocupado se queda quieto en su casilla del servidor (decisión B). |
| `dae5639` | Adaptador puro snapshot/eventos → presentación. |
| `7d8c5ca` | Combate en el mundo (overlay) y panel no modal; se elimina el modal (A, C, D1, E). |
| `1fa46f5` | Comprobación dirigida de sincronización en el e2e de red. |
| `2491a18` | Corrección de encuadre: el panel se coloca del lado contrario al salvaje. |
| `b00a75d` | Corrección de lint: el overlay llega a la vista por evento, no mutando una prop. |
| (este) | Este reporte. |

## 2. Qué cambió

- **Escena** (`world/render/ecoBattleOverlay.ts`, por el puerto `SceneOverlay` del motor):
  - el Pikachu sintético aparece a una casilla del entrenador, hacia el salvaje, mirándolo;
  - barras de PS y de acción encima de los dos;
  - marcas de ataque, impacto, estado, escudo y curación, y números de daño.

  Reutiliza tal cual el `createWorldOverlay` de Dungeon (decisión A), **sin su gancho `decor`**, que convierte las luces en antorchas de mazmorra. También reutiliza `speciesSprite`, `CombatIcon` y la paleta por tipo.
- **Datos** (`world/domain/ecoBattlePresentation.ts`, puro):
  - PS, PP y estado salen del último snapshot. Los PS pueden **subir**; no hay ninguna regla de «solo bajan».
  - Barra de acción: `actionBarFill` **del core** sobre la vista de cliente. Una prueba la compara con el estado canónico. Entre dos snapshots solo avanza con el reloj local, tope en 1. Se congela en pausa, dormido o terminado.
  - Eventos tipados → marcas.
  - **No genera ataques, daño ni resultados.**
- **Salvaje en combate** (decisión B): mientras está `busy`, el actor deja su patrulla y se queda en la casilla que lista el servidor, la misma para todos los clientes y la que usa el rango. Al liberarse vuelve a patrullar.
- **Dueño** (decisión C): `setInputLocked` mientras dura el combate. El entrenador no se mueve; el mundo, su dibujo, las animaciones, los demás jugadores y los controles del panel siguen activos.
- **Espectadores** (decisión D1): solo «en combate» sobre los encuentros `busy` ajenos. **El combate completo para espectadores queda pendiente.**
- **Panel** (`EcoBattlePanel.vue`, no modal):
  - lenguaje visual de `CombatPopup`: nombres, niveles, PS, movimientos con tipo, categoría y PP, «se repite: X», tiempo restante, «Huir», aviso de reconexión;
  - resultado con la protección de 700 ms intacta;
  - toma el foco sin atraparlo y lo devuelve al control que pidió el combate, **incluido el botón de depuración** (el residual F3 del cierre de `ec4d804`), o lo libera a la página;
  - va en la esquina inferior opuesta al salvaje.
- **Se conservan:** la ficha por individuo, la selección en el mapa, las correcciones F1 y F2 y el panel de depuración secundario. **Se elimina** el modal `EcoBattleScreen` (decisión E).

## 3. Comprobaciones previas (resumen; detalle en las notas)

- **Sin órdenes** (core, `chooseMove`), en este orden:
  1. el movimiento seleccionado (persiste);
  2. si no, el último usado;
  3. si no, el primero utilizable;
  4. si no queda ninguno, Struggle.

  El salvaje usa la misma cadena; no hay IA.
- **Barra de acción:** se dibuja con `runtime.actionElapsedMs` y `cooldownMs` (velocidad efectiva por etapas, parálisis, `cooldownMultiplier`, `config.actionBar`). Todo eso viene en el snapshot. Durante el sueño la barra no avanza.

## 4. Pruebas

- **Adaptador** (8 pruebas, con autoridad real del core vía su harness, catálogo real, reloj manual y semilla fija):
  - PS iguales al snapshot durante un combate entero, y también al subir;
  - la interpolación coincide con el siguiente snapshot del servidor;
  - relleno igual al estado canónico (`actionBarFill`);
  - tope en 1 sin otros cambios;
  - congelado en pausa, dormido y terminado;
  - los eventos se convierten en marcas sobre los dos combatientes;
  - posición del Pikachu.
- **Overlay** (5): nada sin combate ni ocupados; sin gancho `decor`; posiciones del Pikachu y de las barras; las marcas caen sobre el Pokémon correcto y se desvanecen; «en combate» solo ajeno; un combate nuevo reinicia la escena.
- **Salvaje ocupado** (3): se queda en la casilla del servidor; si ya estaba ocupado al cargar, igual; dos clientes coinciden.
- **Capa** (17):
  - lo anterior (selección, ficha, F1, F2) adaptado al panel;
  - F3 no modal: foco al panel, depuración no `inert`, retorno al botón de depuración, liberación desde la ficha;
  - encuadre: el panel va a la izquierda si el salvaje está al este.
- **Gates** (Node 22.23.2):

  | Gate | Resultado |
  |---|---|
  | vitest completo | 238 archivos, 2243/2243, más 1 prueba del commit de lint (653/653 en `world` y `wildlands`) |
  | `vue-tsc` | exit 0 |
  | eslint en `src` y `scripts` | exit 0; solo los avisos previos de `AuthModal.vue` |
  | Build de producción con `VITE_ECO_EXPERIMENT=on` | **193 fuentes**, ninguna de ECO, combate, Dungeon UI ni modelo. 0 apariciones de `EcoExperimentLayer`, `EcoBattlePanel`, `EcoBattleOverlay`, «en combate», «Combate de prueba», «fixture de prueba» y `ecoProtocol`. |
  | Guarda de aislamiento | Sin cambios. La prueba del adaptador usa el harness del core, no el runtime ECO. |

## 5. Comprobación dirigida de sincronización

**Lado servidor** (`scripts/ecosystem/eco-battle-e2e.mjs`, contra el realtime aislado). En un combate real tras la reanudación, se registran todos los snapshots que recibe el dueño. La prueba falla si el tiempo de combate o la revisión retroceden, o si los PS no coinciden con los que informan sus propios eventos. La cadencia solo se informa, sin umbral inventado.

**Corrida del 2026-10-08: PASS.**
- 2 snapshots, ordenados y con PS consistentes;
- separación de 3 696 ms;
- **3 667 ms de combate en 3 696 ms de reloj**;
- victoria a los 7 354 ms.

**Lectura** (FACT de esta corrida, no una regla): el servidor solo envía snapshots cuando hay eventos, y en este enfrentamiento hay uno por ventana de acción, unos 3,7 s. Entre dos ventanas los PS no cambian porque **no pasa nada**. El contador de tiempo es local y sigue avanzando.

**Lado cliente:** las pruebas del adaptador muestran que la presentación coincide con el último snapshot y con el siguiente.

**La observación abierta de ECO-PRESENTATION-1 («2:00 y PS completos») sigue abierta.** Esta medición no reproduce aquella captura ni le atribuye causa. Solo muestra que, en esta corrida, el servidor no se detuvo y que una pausa de unos 3,7 s sin cambios de PS es el comportamiento normal entre ventanas.

## 6. Smoke real (evidencia de Claude; 2026-10-08)

Sandbox aislado: Node 22, 127.0.0.1:2790/2791/5199, identidades sintéticas, sin Supabase ni Cloud. El dueño fue el cliente propio `eco-owner`, con el panel Navegador visible a pedido del usuario. El rival fue un jugador sintético `eco-rival` (SDK, como en el e2e).

- **Dueño en el mundo:**
  - Caterpie y Oddish en el bosque;
  - el Pikachu junto al entrenador, mirando al salvaje, con barras encima de los dos;
  - el salvaje quieto en su casilla;
  - el panel con nombres, niveles, PS, cuatro movimientos con PP, «se repite: Double Team», tiempo restante y «Huir».
- **Movimiento:** durante el combate las flechas no mueven al entrenador (`inputLocked`). El motor sigue sin pausa a 60 fps y los demás Pokémon siguen moviéndose.
- **Resultados vistos antes de volver al mapa:** «Victoria» (el Oddish desaparece) y «Huiste» (el Caterpie vuelve a patrullar). Después de «Volver al mapa», el entrenador camina de nuevo y el foco queda en la página.
- **Espectador:** mientras `eco-rival` combatía el Caterpie `…:1:1`, el cliente propio vio «en combate» sobre ese Caterpie, quieto en su casilla (`patrol` ausente), al rival y nada más. Al huir el rival, la marca desapareció y el Caterpie volvió a patrullar.
- **Encuadre** (medido; una casilla ≈ 43 px en pantalla):
  - **Hallazgo:** con el panel abajo a la derecha, un encuentro en rango a +5, +2 casillas quedaba **dentro** del rectángulo del panel.
  - **Corregido** en `2491a18`: el panel va del lado contrario al salvaje.
  - Vuelto a medir: panel a la izquierda (x 12–273), Caterpie al este (x 531–639), totalmente visible. El panel termina por encima de los botones Skills y Chat.
- **Cableado del overlay por evento** (`b00a75d`): comprobado en el sandbox que la vista recibe el overlay de la capa (`ground`, `sprites`, `labels`). El dibujo es el mismo que ya se había verificado en pantalla.

## 7. Observaciones y pendientes

- **O-1:** el borde por tipo eléctrico (amarillo) de Thunder Shock se parece al resaltado de «seleccionado». Es ambiguo; para el diseño definitivo.
- **O-2:** el panel de depuración desplegado tapa el lado izquierdo del mundo, donde puede estar el salvaje. Es una herramienta secundaria y va plegada por defecto.
- **O-3:** la copa de los árboles puede tapar al entrenador o al Pikachu en el bosque. Las barras quedan por encima. Es el *depth sort* existente del motor.
- **O-4:** con el panel Navegador oculto el HUD no actualiza el área, así que la capa no puede marcar. Es una limitación del entorno de prueba, no del producto.
- **O-5:** si la profesión Skills está activa, `setInputLocked` es compartido. En el sandbox no coinciden, pero si convivieran habría que coordinar quién bloquea.
- **Pendiente explícito:**
  - combate completo para espectadores (D2: protocolo y servidor);
  - diseño visual definitivo (arte, escala, animaciones);
  - la observación «PS y contador quietos», que sigue abierta.
- **No hecho:** smoke humano. Este reporte solo acredita las comprobaciones de Claude.

## 8. Foco al cerrar y condición E modificada (después de `a10099e`)

Instrucción del usuario: el reemplazo del modal no espera la aprobación completa de `ec4d804`. Ese candidato y su hallazgo (F3 residual) se conservan sin declararlo aprobado ni integrarlo. La procedencia de lo reutilizado está en las notas, §4.

- **Panel, al cerrar:**
  - vuelve al control de origen si sigue existiendo y es **utilizable**: conectado, habilitado, fuera de `inert` y visible;
  - si no, va al **canvas del mapa**, que es enfocable, y no al `body`.
- **Sin contención:** Tab y Shift+Tab nunca se retienen y nada pasa a `inert`.
- **Teclado:** Espacio y Enter sobre los botones del panel no se cancelan, y el mapa no los toma.
- **Regresiones nuevas** (`EcoExperimentLayer.test.ts`, «keyboard and focus on close»), con origen:
  - utilizable;
  - deshabilitado por el propio panel («Lejos»);
  - retirado;
  - dentro de `inert`;
  - en la ficha;
  - más una prueba de que no hay contención y de que el teclado queda en los botones.

  Ejecutadas sobre una exportación de `a10099e`, **dos fallan**, las de origen retirado y ficha, que antes liberaban al `body`. Aquí pasan.
- La vista pasa al panel el canvas (`mapFocus`). No cambia ningún control ajeno a ECO.

**Candidato congelado:** `feat/eco-overworld-battle-0.3` en el commit de este reporte. Sin push, merge, Cloud, Supabase ni cambios en entornos activos. `ec4d804` sigue congelado y sin tocar.

## 9. Revisión de `a10099e`: F1, F2 y F3 (2026-10-09)

**Revisión:** `ECO-OVERWORLD-BATTLE-1-REVIEW-a10099e.md`, FINDINGS. La revisión no cubre `b8fdcc1`.

**Delta completo desde `a10099e`:**

| Commit | Qué |
|---|---|
| `b8fdcc1` | Foco al cerrar el panel (§8). Ya existía antes de la revisión y se conserva sin reset ni amend. |
| `3ce1566` | F1: la escena del combate queda en su área. |
| `8bf0f6a` | F2: un snapshot repetido no rebobina la barra ni el contador. |
| `b81b194` | F3: Espacio y Enter en el panel de depuración se quedan en sus controles. |
| (este commit) | Este apartado. |

**Reproducción propia antes de corregir.** Sobre una exportación propia de `a10099e`, con las sondas originales sin cambios, copiadas fuera de la carpeta de la revisión:
- **F2:** relleno 0,34615 → 0,15385, y el contador visible pasa de 119 400 a 119 900 ms.
- **F1:** tras cambiar de área siguen el Pikachu y dos barras en (24,14) y (72,14).
- **F3** (Chrome nativo): Espacio en «Combatir» de depuración deja la sesión `idle`, sin envío de engage nuevo, y el mapa recibe 1 `interact`.

Las otras 3 sondas pasan. La evidencia original no se tocó.

**Correcciones (solo cliente ECO; sin servidor, core, protocolo ni Cloud):**

- **F1** (`EcoExperimentLayer.vue`). La escena queda asociada al área donde se pidió el combate.
  - Si el jugador está en otra área, se descarta **para siempre**: ni Pikachu, ni barras, ni marcas, tampoco las de eventos que lleguen tarde.
  - El panel puede seguir mostrando el texto del resultado.
  - Volver al área no la redibuja.
  - En su propia área, un combate terminado se sigue dibujando mientras se muestra el resultado.
- **F2** (`ecoBattleSession.ts`). La deduplicación del snapshot va aparte del resto del mensaje.
  - Solo una revisión **estrictamente mayor** reemplaza el snapshot y reinicia el origen de interpolación y el contador.
    - FACT: el core avanza la revisión en cada cambio que confirma, incluido el paso del tiempo (`authority.ts`, `commit`). Por eso una revisión igual es el mismo estado.
  - El mismo estado otra vez (copia deserializada) o uno anterior no cambian ninguno de los dos.
  - El resultado del mensaje (rechazo o aceptación, `nextActionSequence`) y los eventos nuevos se siguen procesando.
  - La reanudación (`engage-result` con `resumed`) sigue reiniciando ambos desde los números del servidor.
  - La pausa por desconexión no cambia.
- **F3** (`EcoDevPanel.vue`).
  - La raíz del panel de depuración detiene Espacio y Enter, igual que la ficha y el panel de combate. El mapa ya no toma Espacio como `interact` ni cancela la activación del botón.
  - Las teclas del mapa fuera del panel no cambian. No se tocó `keyboard.ts`.

**Regresiones nuevas.** Las cuatro fallan sobre una exportación de `b8fdcc1` con solo las pruebas nuevas, y pasan con las correcciones:
- `EcoExperimentLayer.area.test.ts` (F1):
  - salir con el resultado en pantalla, incluido el regreso al área;
  - salir con el combate en curso, con eventos tardíos;
  - control: en su área, un combate terminado se dibuja. Pasa en ambos casos.
- `ecoBattleSession.test.ts` (F2), en una sola secuencia:
  - duplicado deserializado con rechazo y evento nuevo;
  - estado anterior con aceptación;
  - estado posterior;
  - pausa y reanudación válida;
  - duplicado `structuredClone` tras reanudar.
- `EcoExperimentLayer.test.ts` (F3): Espacio y Enter sobre el plegador, «Combatir» y «Retirar» no se cancelan y el mapa no interactúa. El clic pide ese individuo. Fuera del panel, Espacio y las flechas siguen funcionando con el `KeyboardInput` real.

**Sondas originales repetidas sobre `b81b194`, sin relajar expectativas:**

| Sonda | Resultado |
|---|---|
| vitest | 7/7. Relleno 0,34615 → 0,34615, contador 119 400 → 119 400, sprites tras cambiar de área `[]` |
| Chrome nativo | `pass: true` y `debugSpacePassed: true`. Espacio en «Combatir» de depuración → `engaging`, 0 `interact`. El resto de los casos sigue pasando, incluido el retorno de foco al botón de depuración |

**Gates (Node 22.23.2):**

| Gate | Resultado |
|---|---|
| vitest completo | 239 archivos, 2252/2252 |
| `vue-tsc` | exit 0 |
| eslint | exit 0; solo los avisos previos de `AuthModal.vue` |
| Build de producción con `VITE_ECO_EXPERIMENT=on` | 193 fuentes, la **misma lista** que `a10099e` construido igual. 0 apariciones de `EcoExperimentLayer`, `EcoBattlePanel`, `EcoBattleOverlay`, `EcoDevPanel`, «en combate», «Combate de prueba», «fixture de prueba», «depuración (dev)» y `ecoProtocol` |

No se repitieron servidor, core ni Cloud.

**Candidato congelado:** `feat/eco-overworld-battle-0.3` en el commit que agrega este apartado. Reemplaza a `b8fdcc1`, mencionado en §8. Sin push, merge, Cloud, Supabase ni cambios en entornos activos.

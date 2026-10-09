# CHAT-SHORTCUT-1 — Enter para chatear desde el mapa (escritorio)

**Rama:** `feat/chat-enter-shortcut-0.3`, worktree `pokeswap-chat-shortcut`.

**Base:** `89785e0` (ECO-BATTLE-SCENE-1, aprobación funcional general del usuario; sigue congelado sin cambios).

**Alcance:** incremento pequeño y separado. Reutiliza `ChatPanel` sin rediseño. El atajo móvil queda para después.

## 1. Comportamiento

- **Enter desde el mapa** abre el chat y pone el cursor en el campo. Si el chat ya estaba abierto, sólo devuelve el cursor.
  - «Desde el mapa» significa: el canvas del mapa tiene el foco, o no lo tiene nadie (el `body`, por ejemplo después de cerrar un panel).
  - Esa misma pulsación no envía nada (`preventDefault`).
- **Enter en el campo** envía con el flujo de siempre (el `submit` del formulario y `chat.send`).
- **Escape en el campo** cierra el chat, como antes, y ahora devuelve el foco al mapa.
- **Mientras se escribe**, Espacio, flechas, WASD y E no mueven ni actúan. Eso ya lo garantizaban el `@keydown.stop` del campo y el filtro de `KeyboardInput`; ahora hay una prueba que lo cubre.
- **Durante y fuera del combate:** el atajo no depende del combate.
- **No toca el Enter de nadie más:** otros inputs, botones, diálogos y el panel de combate conservan su Enter.
  - Además, el host lo bloquea cuando hay algo encima del mapa: menú, edificio, plaza, overlay de profesión o tarjeta de acción. Son las mismas condiciones que ya respetaba su Escape, ahora reunidas en un solo `computed` (`overHud`).
- **Tecla mantenida:**
  - un Enter con `repeat` no abre el chat;
  - en el campo, un Enter con `repeat` no envía.

  Así, mantener Enter nunca abre el chat y envía lo que quedó escrito.
- Con Ctrl, Alt, Meta o Shift, o durante una composición IME, el atajo no actúa.

## 2. Cambios

| Archivo | Qué |
|---|---|
| `chat/components/mapEnterShortcut.ts` | Predicado puro `isMapEnter(event, map)` |
| `chat/components/ChatPanel.vue` | Props opcionales `mapFocus` y `shortcutBlocked`, listener en `window`, Escape que devuelve el foco, Enter repetido bloqueado. Sin `mapFocus` no hay atajo, igual que antes |
| `wildlands/components/WildlandsView.vue` | Pasa el canvas y `overHud`. `ecoMapFocus` pasa a llamarse `mapFocus` y lo comparten el panel de combate y el chat |

Sin cambios en el servidor, el protocolo, el core, la economía ni la persistencia.

## 3. Pruebas (`ChatPanel.shortcut.test.ts`, 10)

- Abre el chat y enfoca el campo desde el mapa y desde el `body`. Esa pulsación no envía.
- Con el chat abierto, Enter devuelve el cursor al campo.
- Enter en el campo envía por el flujo existente; un Enter repetido en el campo no envía.
- Un Enter mantenido sobre el mapa no abre el chat.
- Escape cierra el chat y devuelve el foco al canvas.
- Con un `KeyboardInput` real, escribir Espacio, flechas, WASD y E no mueve ni interactúa. Al volver al mapa, las flechas sí mueven.
- El atajo no actúa (ni abre ni hace `preventDefault`) si el Enter llega desde:
  - un input;
  - un botón;
  - un diálogo, o un botón dentro de él;
  - el panel `.ebp` o un botón de movimiento.
- Con el panel de combate en pantalla y el foco en el mapa, sí abre.
- Bloqueos: el host bloquea el atajo (`shortcutBlocked`), hay modificadores, o falta `mapFocus`.
- Al desmontar el panel, se retira el listener.

**Control negativo:** quitando del predicado la guarda de `repeat` y la del destino, fallan las 2 pruebas correspondientes. Restaurado: 10/10.

**Gates del delta (Node 22.23.2):**

| Gate | Resultado |
|---|---|
| Pruebas del chat, del teclado (`battleRestrictions`) y del host que montan `WildlandsView` | 10 archivos, 59/59 |
| `vue-tsc` | exit 0 |
| eslint (`chat/components`, `WildlandsView.vue`) | exit 0 |

No se corrieron baterías generales, por pedido.

## 4. Límites

- jsdom no reproduce el envío implícito nativo ni la repetición real del teclado. El bloqueo de esa pulsación y del Enter repetido se probó a nivel de `preventDefault`. Falta comprobarlo en un navegador real, durante el smoke.
- Si el foco quedó en un botón (por ejemplo, un movimiento recién usado), Enter es de ese botón, como se pidió. Para chatear hay que volver al mapa: clic en el mapa o Escape.
- El chat sólo existe en builds DEV o de playtest (`worldPlaytestFeaturesEnabled`), así que el atajo también.

**Candidato congelado:** `feat/chat-enter-shortcut-0.3`, en el commit que agrega este reporte. Sin push, merge ni cambios en otros entornos.

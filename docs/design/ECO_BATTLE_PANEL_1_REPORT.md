# ECO-BATTLE-PANEL-1 — Panel de combate compacto, anclado al combate

**Rama:** `feat/eco-battle-panel-compact-0.3`, worktree `pokeswap-eco-panel`.

**Base:** `f5257fc`, la combinación de SC-R1 con el chat y CH-R1. Se conserva sin cambios.

**Origen:** observación del usuario en el smoke de `f5257fc` (2026-10-09): el chat está bien, pero el panel de combate molesta por su tamaño y por sus cambios de posición. Esa presentación **no** quedó aprobada.

**Alcance:** sólo presentación. No cambian el servidor, el protocolo, el core, el balance ni la autoridad. El chat no se modifica.

## 1. Commits

| Commit | Qué |
|---|---|
| `e37f6bc` | Panel compacto y anclado, proyección de sólo lectura del motor, pruebas |
| `35af867` | El lado inicial se elige lejos del entrenador. Lo encontró la comprobación en navegador: el panel lo tapaba |
| `e813f8a` | Panel de 208 px. Lo encontró la comprobación en navegador: «▸ Thunder Shock» se cortaba |
| (este commit) | Este reporte |

## 2. Qué cambió

**Panel (`EcoBattlePanel.vue`):** compacto y semitransparente (fondo con alfa 0,66, 208 px de ancho).
- **Movimientos:** los cuatro en una columna vertical. Cada botón muestra:
  - el nombre;
  - el color y el ícono del tipo;
  - «PP n», o «Sin PP» cuando no quedan, y en ese caso el botón queda deshabilitado.

  El movimiento en uso se marca con borde dorado, «▸» y `aria-pressed`.
- **«Huir»** queda debajo de los movimientos.
- **El tiempo restante** está en la cabecera.
- **Avisos:** «Reconectando…» y los rechazos del servidor siguen siempre visibles.
- **Botón lateral «Info»** (`aria-expanded`), que expande dentro del mismo panel:
  - nombre, nivel y PS de cada combatiente, con su barra;
  - el estado;
  - la **recarga**: la misma barra de acción que dibuja el mundo, con `presentCombatant`;
  - el tiempo restante y el movimiento que se repite.

  Arranca cerrado y sólo lo abre el jugador. No hay otro modal.

**Anclaje** (`ecoBattlePanelPlacement.ts` puro y `usePanelAnchor`):
- El panel se ubica junto al recuadro en pantalla que ocupan los combatientes y sus barras.
- **El lado se elige una sola vez por combate:** el contrario al entrenador, si hay lugar; si no, el otro.
- Después no cambia de lado: ni por actualizaciones del servidor, ni por abrir Info, ni porque el entrenador camine.
- **Sigue a la cámara** cuadro a cuadro.
- **Se corre sólo lo necesario** para no salirse de la pantalla. Si el borde lo empuja sobre la escena, pasa debajo de ella, o encima si abajo no hay lugar; nunca la tapa.
- **Queda anclado por su borde superior,** así que crecer (Info, un aviso) lo extiende hacia abajo, sin saltos.
- **Antes de que exista la escena** (pidiendo el combate, o tras un rechazo) se ubica junto al individuo pedido.
- **Sin proyección** (nada dibujado todavía) queda en su esquina de respaldo.
- Se eliminó la regla anterior de esquina, que alternaba según dónde estuviera el entrenador.

**Motor:** se agregó `screenOf(wx, wy)` de sólo lectura sobre el último cuadro dibujado (renderer y game). `WildlandsView` lo pasa a la capa ECO como `project`.

**Sin cambios:** movimiento del entrenador, chat y final sin confirmación. El foco al abrir y cerrar sigue igual que antes.

## 3. Pruebas dirigidas

**Pruebas nuevas:**
- **`ecoBattlePanelPlacement.test.ts` (7):** recuadro de la escena; lado preferido y lado alternativo; lejos del entrenador; al costado sin tapar; crecer sin moverse; correrse sólo en el borde; pasar debajo o encima en lugar de tapar.
- **`EcoExperimentLayer.panel.test.ts` (6), con la capa real:**
  - junto a la escena;
  - sigue a la cámara con el mismo desplazamiento;
  - no cambia por una actualización del servidor, por abrir Info ni porque el entrenador camine;
  - empieza lejos del entrenador y no lo sigue cuando cruza;
  - en el borde pasa debajo de la escena;
  - cuatro movimientos en columna, con nombre, uno marcado y uno «Sin PP» deshabilitado; pulsar uno envía sólo un pedido;
  - Info abre y cierra dentro del mismo panel, no se abre solo con una actualización, y no aparece ningún diálogo.

**Control negativo:** si el lado se recalcula en cada cuadro, falla la prueba del borde (el panel salta al otro lado). Restaurado: pasa.

**Pruebas existentes** (`EcoExperimentLayer.test.ts`):
- tres aserciones siguen el cambio pedido:
  - la vida está detrás de Info;
  - el tiempo está en la cabecera;
  - se eliminó la prueba de la esquina que alternaba;
- su fixture ahora tiene la forma real del runtime y `config` del snapshot, que Info lee igual que el mundo.

**Gates (Node 22.23.2):**

| Gate | Resultado |
|---|---|
| `world`, chat, `chatShortcutEntry`, restricciones, población, proyección y picking | 34 archivos, 257/257 |
| `vue-tsc` | exit 0 |
| eslint del delta | exit 0 |

No se repitieron auditorías del combate ni baterías generales.

**Exclusión productiva:** build con `VITE_ECO_EXPERIMENT=on`, con la misma lista de **193 fuentes** que la referencia; no entran el panel ni el anclaje.
- `screenOf` y el `projectWorld` de la vista sí llegan al bundle productivo.
- Es código inerte: su único consumidor es la capa ECO, que sigue detrás de `ECO_EXPERIMENT`. Es el mismo caso que `setBattleRestricted`.

## 4. Comprobación en navegador real

Navegador del escritorio, viewport de 1024×768 CSS, sandbox aislado (2790/2791/5199) desde exportaciones de cada SHA, en `D:\Claude-PANEL-*`. Lo verificado:

- **Posición:** junto a la escena y del lado contrario al entrenador, sin tapar combatientes ni barras. En la primera versión tapaba al entrenador; lo corrige `35af867`.
- **Movimiento de cámara:** el entrenador caminó durante el combate.
  - El panel acompañó a la escena del mismo lado.
  - Con el entrenador cruzado al otro lado de la escena, no cambió de lado.
  - Cerca del borde superior se corrió sólo lo justo.
- **Columna:** los cuatro botones tienen la misma x y y escalonadas.
  - Pulsé Thunder Shock, Quick Attack, Thunder Wave y Double Team; en cada caso `aria-pressed` pasó al elegido y bajaron sus PP.
  - Con 208 px ningún nombre se corta, tampoco «▸ Thunder Shock»; con 184 px se cortaba, y lo corrige `e813f8a`.
- **Info:** se abrió y se cerró dentro del panel, con vida, nivel, recarga, tiempo y «se repite». La esquina del panel no se movió al abrir (de 184 a 343 px de alto) y no apareció ningún diálogo.
- **Final:** al terminar el combate, el panel se fue sin pedir confirmación y el entrenador siguió caminando.

**No comprobado en navegador:**
- un «Sin PP» real (sí está en la prueba de integración);
- el aviso de reconexión con el panel nuevo;
- la vista de B como espectador (no cambia: no tiene panel).

## 5. Límites

- **Recuadro de la escena:** se estima con una altura fija (48 px de mundo sobre los pies) y un ancho de ±20 px. Un sprite más alto podría asomar apenas por encima.
- **Viewports angostos:** si el panel no entra a ningún lado, se ajusta contra el borde y pasa encima o debajo de la escena. En un teléfono puede cubrir otras partes del HUD. Lo móvil no se revisó en este incremento.
- **Pendiente:** el smoke visual del usuario.

**Candidato congelado:** `feat/eco-battle-panel-compact-0.3`, en el commit que agrega este reporte. Sin push, merge ni cambios en otros entornos.

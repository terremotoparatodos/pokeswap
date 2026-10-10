# ECO-COMBATANT-1 — continuidad de CM-R1

Fecha: 2026-10-10. Base exacta: `5d502eae3f2c70203340d8d2373eb3ef357ca1fb`.
Rama nueva: `codex/eco-combatant-cm-r1-continuity`.
Worktree nuevo: `C:\Users\Rodri\.codex\worktrees\eco-combatant-cm-r1-continuity\pokeswap`; ruta física usada: `D:\CHATGPT\Datos-Codex\worktrees\eco-combatant-cm-r1-continuity\pokeswap`.

## Causa y corrección

**FACT:** el estado pendiente aplicaba `disabled` al `<select>`. Chrome quitaba el foco al deshabilitarlo y lo dejaba en BODY. El ACK actualizaba especie y habilitación, pero no el foco. La siguiente flecha llegaba al listener del mapa.

El selector compartido mantiene ahora su habilitación nativa durante una confirmación pendiente. `aria-disabled=true` y el aviso existente comunican la espera. El handler rechaza nuevas intenciones mientras espera y restaura el valor confirmado, como ya hacía el control. El estado de elección existente también conserva su guardia contra peticiones simultáneas. Combate sigue bloqueado hasta el ACK; reservas, desconexión y falta de opciones conservan sus bloqueos existentes.

No hay `focus()`, watcher de recuperación de foco ni listener global nuevo en el producto. El foco permanece por no destruir su condición nativa; si el usuario sale al chat, mapa u otro control, la respuesta respeta ese destino. `@keydown.stop` continúa aislando el teclado del selector sin `preventDefault`; `keyup` sigue liberando teclas del mapa. Enter conserva su acción nativa.

Solo cambia `EcoCombatantSelector.vue` en producto. Sin cambios de servidor, protocolo, core, estado de elección, catálogos, bundles ni refactor de controles.

## Reproducción conservada

Antes del arreglo se copió y ejecutó sin modificaciones la sonda `native-continuity.mjs` de la revisión independiente, primero para ficha y después para depuración. Su SHA-256 coincide con la copia conservada:
`38ACCE2252EA8988EED591C90864E30C82DC5D053235FC47FED9678E65C6B89C`.

En ambos casos, **un único enfoque → ArrowDown → ACK → ArrowUp** falla con salida 1: Rattata confirmada, foco BODY, ArrowUp nativo trusted cancelado y dirección `up`; no hay segunda elección. [Ficha](evidence/eco-combatant-cm-r1-continuity/base-card/selector-native.json), [depuración](evidence/eco-combatant-cm-r1-continuity/base-debug/selector-native.json). La nueva sonda también falla en la base al detectar pérdida de foco durante el pendiente, antes del ACK. Los nuevos tests tienen dos fallos de continuidad en la base y 18 casos que ya pasan.

La misma sonda independiente, con los mismos bytes y asserts, pasa después del arreglo en las dos rutas: [ficha](evidence/eco-combatant-cm-r1-continuity/fixed-original-card/selector-keyboard.json), [depuración](evidence/eco-combatant-cm-r1-continuity/fixed-original-debug/selector-keyboard.json).

## Corrección de la sonda anterior

La sonda entregada en `5d502ea` hacía `.focus()` antes de cada flecha y nuevamente antes de Enter. Su PASS acreditaba teclas aisladas después de reenfocar explícitamente; no acreditaba continuidad tras confirmar. Ese reenfoque ocultó el defecto residual. El reporte y evidencia anteriores permanecen intactos, con este límite documentado aquí.

La sonda actual enfoca **una vez por ruta**, antes de seis elecciones consecutivas: Pikachu → Rattata → Pikachu → Rattata → Oddish → Rattata → Pikachu. No reenfoca entre teclas, confirmaciones ni Enter. La primera pareja prueba exactamente Down → ACK → Up. Las elecciones siguientes agregan Down/Up mantenidas mientras el servidor retiene su respuesta: foco conservado, default nativo intacto, ningún movimiento/interacción, ninguna petición adicional y valor confirmado conservado.

Después de esa secuencia, Enter abre el desplegable nativo; Down y Enter confirman Rattata sin reenfoque. Los escenarios independientes de abandono empiezan con un enfoque inicial y salen mediante un clic nativo al chat de prueba, canvas u otro botón. Solo después se libera el ACK; ninguno recupera el foco del selector. No se restaura el foco desde el driver al comprobar esa salida. El control final del mapa conserva movimiento, liberación de flecha y Space.

Las respuestas cruzan HTTP hacia `EcoCombatants` real y el bundle existente. El harness retiene/libera cada respuesta para comprobar la espera de forma determinista, sin modificar tiempos del producto. No se asigna `select.value` desde el driver. Las aserciones operan sobre el estado completo; los snapshots guardan la última tecla/intención y sus contadores para no repetir historias acumuladas. El registro final guarda una vez todos los eventos nativos observados.

La sonda tiene 510 líneas y una responsabilidad: construir, ejecutar y cerrar esta prueba nativa aislada. Se conserva su harness existente; no se distribuye esa lógica en componentes ni controles del producto.

## Verificación acotada

Node **v22.23.3**, Chrome **147.0.7727.138**. Dependencias copiadas al nuevo worktree; manifiestos y lockfiles intactos.

- **46/46 tests** en tres archivos: 20 de teclado (ocho casos nuevos), 24 de capa ECO y dos de estado de elección. La expectativa previa de `disabled` durante pendiente se reemplaza por enfocable + `aria-disabled`; se mantienen espera, valor confirmado, ACK y bloqueo de combate. Los casos nuevos verifican seis elecciones por ruta, intentos durante pendiente y abandono a input/canvas/botón.
- **Sonda nativa final PASS:** 96 eventos de tecla enviados, 21 comprobaciones, 20 selecciones recibidas por el servicio y 111 snapshots. [Resultado](evidence/eco-combatant-cm-r1-continuity/fixed-native/selector-keyboard.json), [captura](evidence/eco-combatant-cm-r1-continuity/fixed-native/selector-keyboard.png).
- **Tipos PASS:** `vue-tsc --noEmit -p tsconfig.app.json`.
- **Lint del delta PASS**, sin avisos: componente, test de teclado y sonda modificados.
- Evidencia, scripts, tests y reporte anteriores conservados; servidor, transporte, bundles y exclusión productiva permanecen idénticos. No se repitieron suites generales, e2e de combate, builds, regeneraciones ni auditorías.

Desde la ruta física, con Node 22 y dependencias presentes:

```powershell
node node_modules/vitest/vitest.mjs run features/world/components/EcoCombatantSelector.keyboard.test.ts features/world/components/EcoExperimentLayer.test.ts features/world/state/ecoCombatantSelection.test.ts
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.app.json
node node_modules/eslint/bin/eslint.js src/features/world/components/EcoCombatantSelector.vue src/features/world/components/EcoCombatantSelector.keyboard.test.ts scripts/ecosystem/eco-combatant-keyboard-native.mjs
node scripts/ecosystem/eco-combatant-keyboard-native.mjs (Get-Location).Path <directorio-nuevo-de-evidencia>
```

## Límites y cierre

La primera tentativa de reproducción se lanzó antes de terminar la copia de dependencias y falló resolviendo Vue, sin iniciar navegador o servidor. Se conserva en `base-setup-error.log`; después de completar la copia se reprodujo el defecto en ambas rutas. Los fallos pertinentes de base se conservan junto con stdout, stderr y cierres. La primera corrida verde se conserva fuera del repositorio en `D:\CHATGPT\Datos-Codex\worktrees\eco-combatant-cm-r1-continuity\first-native-green`.

El teclado es nativo trusted de Chrome headless por CDP, sobre los componentes y `KeyboardInput` reales. El chat/botón/canvas de salida pertenecen al fixture; no es una nueva sesión manual con teclado físico ni un arranque del juego completo o Colyseus. Los tests jsdom no simulan la navegación nativa ni el blur de Chrome: acreditan el contrato del control y se complementan con la sonda nativa.

Los siete navegadores propios salieron con código 0, sus servidores cerraron y sus PIDs/puertos no permanecen activos. [Versiones, hashes, resultados y limpieza](evidence/eco-combatant-cm-r1-continuity/verification.json). Ningún archivo de los checkouts anteriores o entornos activos se modificó.

Commits nuevos, sin amend: corrección/tests; sonda/reporte; evidencia. El HEAD completo entregado en el chat es el único SHA congelado. Sin push, merge, deploy ni procesos propios activos. Integración posterior reservada a Claude.

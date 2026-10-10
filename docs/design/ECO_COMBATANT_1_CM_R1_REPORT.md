# ECO-COMBATANT-1 — corrección CM-R1

Fecha: 2026-10-10. Base exacta: `741f70b317ed8c841806df53fa20ee8dc3371373`.
Rama nueva: `codex/eco-combatant-cm-r1`.
Worktree nuevo: `C:\Users\Rodri\.codex\worktrees\eco-combatant-cm-r1\pokeswap`;
ruta física usada: `D:\CHATGPT\Datos-Codex\worktrees\eco-combatant-cm-r1\pokeswap`.

## Cambio

El selector compartido por ficha y depuración ahora detiene la propagación de `keydown` mediante `@keydown.stop`. Las flechas y Enter conservan su acción nativa: no se llama a `preventDefault`. El listener global del mapa sigue instalado. `keyup` sigue propagándose para liberar una dirección mantenida antes de enfocar el selector.

El delta de producto es un atributo en `EcoCombatantSelector.vue`. No cambia el listener del mapa, servidor, protocolo, combate, bundles, catálogo ni controles de otros componentes. No se abordaron observaciones ajenas a CM-R1.

## Reproducción previa al arreglo

Se ejecutó **primero la sonda original sin modificar**, modo `arrows`, contra la base exacta en este worktree aislado. Se copió byte por byte el script indicado por la revisión; ambos SHA-256 coinciden:
`4E6752425C4BC3BCE955C3FF248D679F121E029ED52F8BCC8895AE7B9AD76255`.

Resultado esperado de reproducción: salida **1**, `pass:false`, **dos hallazgos**, control causal `true`. En ficha y depuración, ArrowDown nativo tiene `isTrusted=true`, termina cancelado, deja dirección `down` mientras se mantiene y no envía elección. El control causal de la sonda original retira su listener únicamente dentro de ese fixture de base, y confirma que la selección nativa funciona sin la interferencia. El arreglo y la nueva regresión mantienen el listener durante todas las comprobaciones.

Evidencia original conservada en [base-native](evidence/eco-combatant-cm-r1/base-native/selector-arrows.json), junto con script, stdout, stderr y limpieza. El fixture compilado de esa ejecución se conservó fuera del repositorio, en `D:\CHATGPT\Datos-Codex\worktrees\eco-combatant-cm-r1\cm-r1-base-fixture`; sus hashes están en `base-native/fixture-hashes.json`. La evidencia lleva atributos Git que impiden normalizar sus bytes.

## Regresiones y verificación acotada

Runtime **Node v22.23.3**; navegador **Chrome 147.0.7727.138**. Se reutilizaron dependencias del lockfile copiadas al nuevo worktree; no cambió ningún manifiesto ni lockfile.

| Comprobación | Base | Arreglo |
| --- | --- | --- |
| Nueva regresión de componentes, ambas rutas, cuatro flechas | 8 fallos; 4 casos complementarios pasan | 12/12 pasan |
| Nueva sonda nativa, con listener real del mapa | Falla con dirección `down` en el primer ArrowDown | PASS en ficha, depuración y mapa |
| Tests relacionados de capa ECO y estado de elección | Comprobaciones anteriores conservadas | 26/26 pasan |
| Tipos (`vue-tsc`) | Comprobación anterior conservada | PASS |
| Lint de componente, test nuevo y sonda nueva | — | PASS, sin avisos |

Total final: **38/38 tests**, tres archivos. La regresión de componentes usa `KeyboardInput` real, comprueba que ninguna de las cuatro flechas cancela su default o activa movimiento, confirma el flujo pendiente/ack, y prueba movimiento/interacción fuera del control y liberación mediante `keyup`.

La nueva [sonda nativa](../../scripts/ecosystem/eco-combatant-keyboard-native.mjs) deriva de la reproducción original y cubre exclusivamente CM-R1. Inyecta teclas nativas de Chrome por CDP, registradas con `isTrusted=true`; no sustituye la navegación por `dispatchEvent` ni asigna el valor del selector desde el driver. En cada ruta:

- ArrowDown elige Rattata; ArrowUp vuelve a Pikachu, sin movimiento ni interacción del mapa.
- Cada intención cruza HTTP hacia un proceso Node aislado que ejecuta **EcoCombatants real** y el bundle existente. Se registran los payloads y respuestas exitosas; ambos selectores muestran la especie confirmada y quedan habilitados.
- Enter conserva su default y abre el selector nativo. ArrowDown y Enter permiten confirmar Rattata desde ese control.
- Al enfocar el mapa, ArrowDown vuelve a producir dirección `down`, `keyup` la libera y Space vuelve a activar interacción.

Son **24 eventos de tecla nativa, siete comprobaciones y seis selecciones recibidas por el servidor**. [Resultado final y snapshots](evidence/eco-combatant-cm-r1/fixed-native-final/selector-keyboard.json); [captura](evidence/eco-combatant-cm-r1/fixed-native-final/selector-keyboard.png). La primera corrida verde se conserva fuera del repositorio en `D:\CHATGPT\Datos-Codex\worktrees\eco-combatant-cm-r1\cm-r1-first-green`. [Resumen de versiones, hashes y limpieza](evidence/eco-combatant-cm-r1/verification.json).

No se repitieron suites generales, builds ni regeneraciones: el cambio afecta solo la propagación de teclado de un control Vue. El reporte, tests, e2e, exclusión productiva y evidencia anteriores permanecen intactos en la base; no se atribuyen como nuevas ejecuciones.

## Repetición

Desde la ruta física del worktree, con Node 22 y las dependencias existentes:

```powershell
node node_modules/vitest/vitest.mjs run features/world/components/EcoCombatantSelector.keyboard.test.ts features/world/components/EcoExperimentLayer.test.ts features/world/state/ecoCombatantSelection.test.ts
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.app.json
node node_modules/eslint/bin/eslint.js src/features/world/components/EcoCombatantSelector.vue src/features/world/components/EcoCombatantSelector.keyboard.test.ts scripts/ecosystem/eco-combatant-keyboard-native.mjs
node scripts/ecosystem/eco-combatant-keyboard-native.mjs (Get-Location).Path <directorio-nuevo-de-evidencia>
```

La sonda guarda JSON, captura y cierre del navegador/servidor. Usa puerto efímero en loopback y perfil Chrome exclusivo del fixture; no se conecta a entornos existentes.

## Fallos, límites y entrega

Los fallos de base son deliberados y están conservados, tanto en [Vitest](evidence/eco-combatant-cm-r1/base-unit.log) como en la [regresión nativa](evidence/eco-combatant-cm-r1/base-regression-native/selector-native.json). La primera pasada de lint encontró dos problemas en el nuevo tooling adaptado —expresión condicional y bloque vacío—; se corrigieron sin cambiar los asserts. Su salida también se conserva en `lint-delta.log`.

La verificación nativa usa componentes, control HTML, teclado del mapa y servicio de selección reales en una página aislada de Chrome headless. El transporte de esta sonda es HTTP de prueba; no acredita una nueva corrida Colyseus ni una sesión manual con teclado físico o el juego completo. La verificación SDK anterior queda conservada. Los 150 ms de respuesta son exclusivos del harness; ningún tiempo del producto se modificó.

Los cuatro navegadores propios terminaron con código 0 y sus cuatro servidores cerraron. Al cerrar el incremento, sus PIDs ya no existen y ninguno de sus puertos tiene listener. Checkout principal y worktree original permanecen en sus HEAD previos; no se escribieron archivos en ellos ni se intervinieron otros entornos.

Se entregan commits nuevos, sin amend: primero corrección y tests; después sonda y reporte; finalmente evidencia. El HEAD completo entregado en el chat es el único SHA congelado. Sin push, merge, deploy ni procesos propios activos. Integración posterior reservada a Claude.

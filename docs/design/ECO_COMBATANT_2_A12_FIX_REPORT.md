# ECO-COMBATANT-2 — corrección acotada A12

Base verificada: `fffc61c3ed5520616f895df238bc15bdbebb89e2`, hijo directo del candidato aprobado `45b8c1129f44407567b0dfa696a7327b2d8e758b`. Rama nueva `codex/eco-combatant-2-a12`; worktree físico `D:/CHATGPT/Datos-Codex/worktrees/eco-combatant-2-a12/pokeswap`. El cierre humano existente se conserva sin modificar.

## Causa y delta

`WorldRoom` inspeccionaba `playerData.readEcoCombatants` al construir ECO, también en modo sintético. A12 detectaba esa consulta de propiedad con su Proxy, aunque no se invocara el lector. Se reprodujo en la base: exit 1, acceso registrado `readEcoCombatants`.

El wiring ahora comprueba primero `ecoCombatantMode === 'owned'`. Sintético no inspecciona esa capacidad; owned conserva el lector autoritativo, su receptor y la revalidación al seleccionar/iniciar. Sin lector, owned sigue rechazando y no recibe el fixture sintético. No cambian guards, protocolo, UI, core ni reglas.

- Producto: una condición y un comentario en `services/realtime/src/world/worldRoom.js`.
- Regresiones nuevas: `services/realtime/src/world/ecoCombatantWiring.test.js`: getter prohibido en construcción sintética; lector owned para refresh/selección/inicio; owned con playerData pero sin lector falla cerrado.
- A12, sus aserciones y todo `ecoBattles.test.js` permanecen idénticos a la base (blob `b350c8cb95e78c210809b000001c479a0baa2821`). La nueva regresión sintética también falla en la base; los dos controles owned pasan antes y después.

## Verificación

Node `v22.23.3`; dependencias copiadas localmente sin instalación ni cambios de manifests/lockfiles. Procesos de verificación con entorno limitado a variables del sistema, sin configuración hosted.

| Comprobación | Resultado |
|---|---|
| Suite completa realtime, `npm test` | Exit 0: **678 totales, 644 aprobadas, 0 fallos, 34 omitidas** |
| A12 original, ciclo completo sintético | Aprobada dentro de la suite; cero accesos no permitidos al Proxy |
| Node dirigidas: wiring, owned/sintético, lector Edge | **16/16**, exit 0; incluye selección, carreras, bloqueo, gracia/reconexión y privacidad |
| Vitest: constructor M-1, selección, teclado del selector y sesión de combate | **38/38**, cuatro archivos, exit 0 |
| `npm run typecheck` | Exit 0 |
| ESLint sobre ambos archivos JS del delta, con `--no-ignore` | Exit 0, cero warnings; se verifica realmente services aunque el lint general lo excluya |
| `git diff --check` | Sin errores |

Las **34 omisiones históricas no son pruebas aprobadas**: 13 de WORLD LOCATION-2 staging y 21 de RC-0.3 staging, todas requieren el stack Supabase local ausente (`RC03_*`). Sus nombres y razones quedan en `historical-skips.log` y la salida completa. No se habilitaron ni se alteraron para esta tarea.

Fallos conservados: A12 base y getter sintético base; la primera ejecución Vitest desde el alias `C:/Users/Rodri/.codex/worktrees/...` no pudo resolver los cuatro archivos, sin ejecutar casos. El mismo comando pasó desde la ruta física D:, sin cambiar código ni pruebas para resolver ese problema de montaje.

Evidencia externa: `C:/Users/Rodri/Documents/Codex/2026-10-11/eco-combatant-2-a12/` (logs, códigos de salida, omisiones, delta y SHA congelado en `FREEZE.md`). Se conservan candidatos, evidencias y cierre humano anteriores. Sin amend, push, merge, deploy, consultas hosted, cambios SQL/permisos/dependencias o procesos activos al finalizar. No se repitieron builds, smoke humano ni e2e; sus resultados previos se conservan.

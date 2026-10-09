# ECO-COMBATANT-1 — implementación y verificación

Fecha: 2026-10-09. Rama: `codex/eco-combatant-1`.

Worktree nuevo: `C:\Users\Rodri\.codex\worktrees\eco-combatant-1\pokeswap`.
Su ruta física es `D:\CHATGPT\Datos-Codex\worktrees\eco-combatant-1\pokeswap` porque `.codex` es una junction. Las verificaciones se ejecutaron desde la ruta física.

Base local y remota comprobadas antes de implementar: `02054b832137887a7cf7162a9a08c7f00fccf0c1` (`origin/integration/world-skills-0.3`). El remoto no había avanzado. No se cambió ningún archivo del checkout principal, `pokeswap-int1` ni otros worktrees.

## Resultado

Selector en la ficha del encuentro y en el panel secundario ECO, con `EcoSprite` existente. Muestra la elección confirmada, espera al servidor y bloquea iniciar durante una elección pendiente o sin confirmar. No ofrece cambios durante combate, desconexión incluida. El panel de combate y los overlays existentes reciben la especie y estadísticas del combate autoritativo; el texto de derrota ahora habla del Pokémon de prueba elegido.

El servidor mantiene una elección por jugador en memoria, valida un pool cerrado y rechaza atributos adicionales en el intent de selección. Una reserva impide cambiarla, incluso en la gracia de desconexión. Reconectar conserva la elección y el combate existente; huir libera el cambio. Reiniciar puede perderla. El payload de engage no puede modificarla.

Construcción disponible para las seis especies, nivel 12:

| Especie | ID | Movimientos del catálogo (IDs) |
| --- | ---: | --- |
| Pikachu | 25 | 84, 98, 86, 104 |
| Rattata | 19 | 33, 39, 98 |
| Oddish | 43 | 71, 230, 51 |
| Geodude | 74 | 33, 397, 205 |
| Zubat | 41 | 141, 48 |
| Caterpie | 10 | 33, 81 |

Pikachu conserva sus movimientos originales, comprobados por nivel o MT. Las otras cinco especies usan los últimos movimientos de nivel ejecutables hasta 12. Estadísticas calculadas por el modelo/core existente, con la convención previa de fixture (Hardy, IVs perfectos, EVs cero, sin shiny). Ninguna especie necesitó sustitución ni quedó excluida.

API del bundle pasa a 2: agrega `combatants` y `playerSpeciesId` en `start`; `prepareEncounterBattles()` deja de aceptar fixtures arbitrarios. El bundle expone la fábrica cerrada, nunca la autoridad desnuda. El servidor elige el parámetro; el cliente envía únicamente intención de especie.

No cambian el catálogo salvaje, sus movimientos/ nivel, las reglas, tiempos, rango, reservas, finales o recompensas del core. No se conectan cuentas reales, inventario, captura, XP, drops ni persistencia. Sin SQL, Cloud, Supabase, push, merge o deploy.

## Verificación final

- Node **v22.23.3**, usando el runtime ya disponible. El Node predeterminado era v24.19.0.
- **161/161 tests Vitest**, 15 archivos: construcción legal de las seis especies y estadísticas del modelo, paridad fuente/bundle, presentación dueño/espectador, sprites y barras de las cinco especies nuevas, acknowledgements/timeouts del selector, componentes, sesiones, transporte y regresiones ECO pertinentes.
- **51/51 tests Node**, 8 archivos: elecciones válidas/ inválidas e independientes, atributos falsificados, reserva activa y gracia, reconexión dentro/fuera de combate, reset por nuevo servidor, invitado/socket reemplazado/cliente viejo, preparación diferida, reservas y espectadores existentes. Incluyen experimento apagado por defecto y rechazo con `NODE_ENV=production`.
- E2E aislado **PASS**, SDK real de Colyseus, servidor propio con puertos efímeros y entorno explícito sin credenciales. Dos jugadores eligen **Rattata y Oddish**, caminan hacia encuentros diferentes y combaten; un tercero compara especie, HP, acción y stage con las vistas del dueño, al inicio y en updates reales. Verifica rechazos, reconexión durante la gracia, huida y reconexión fuera de combate. El proceso final salió con código 0 y cerró su servidor y sockets. [Resultado JSON](evidence/eco-combatant-1/e2e.json).
- `npm run typecheck`: PASS.
- ESLint sobre todos los archivos frontend/tooling modificados: PASS, sin avisos. El config existente excluye `services/`; los JS del servicio modificados pasaron `node --check` y sus tests Node.
- Regenerados por sus scripts `battle`, `encounters`, `admission` y `skills`, y comprobados con `--check`. Solo cambia `encounterBattle.generated.js`; los otros tres quedaron idénticos.
- Build de desarrollo ECO: PASS; contiene el selector en el chunk `EcoExperimentLayer`.
- Build de producción: PASS; se forzaron `VITE_ECO_EXPERIMENT=on` y `VITE_PRESENCE_BENCHMARK=on`. Sin chunk `EcoExperimentLayer`, ni implementación del selector, sesión de elección o fábrica sintética. Las constantes públicas de mensajes pueden seguir presentes en el protocolo compartido, sin habilitar el experimento.
- Diff revisado y `git diff --check`: PASS. El único agregado a `PresenceRoom` es una ruta de mensaje; permanece en 522 líneas por su responsabilidad previa de transporte. La lógica nueva reside en módulos pequeños, no en el core ni un componente central.

## Reproducción

Desde la ruta física del worktree, con Node 22 en PATH y dependencias de los lockfiles instaladas:

```powershell
node scripts/integration/bundle-battle.mjs --check
node scripts/integration/bundle-encounters.mjs --check
node scripts/integration/bundle-admission.mjs --check
node scripts/integration/bundle-skills.mjs --check
npm run typecheck
node node_modules/vitest/vitest.mjs run features/ecosystem/server features/world/components/EcoExperimentLayer features/world/state/ecoCombatantSelection.test.ts features/world/state/ecoBattleSession.test.ts features/world/state/ecoSpectatedBattles.test.ts features/world/render/ecoBattleOverlay.test.ts features/world/domain/ecoBattlePresentation.test.ts features/wildlands/multiplayer/api/colyseusPresence
node --test services/realtime/src/world/ecoCombatants.test.js services/realtime/src/world/ecoBattles.test.js services/realtime/src/world/ecoBattles.spectators.test.js services/realtime/src/world/ecoBattles.scene.test.js services/realtime/src/world/ecoBattles.range.test.js services/realtime/src/world/ecoPopulation.test.js services/realtime/src/world/ecoBattlePublic.test.js services/realtime/src/rooms/PresenceRoomEcoBattle.test.js
node scripts/ecosystem/eco-combatant-e2e.mjs --report eco-combatant-result.json
```

Para los builds se usaron `NODE_ENV=development` / `production`, respectivamente, `VITE_ECO_EXPERIMENT=on`, `VITE_PRESENCE_BENCHMARK=on`, `VITE_SUPABASE_URL=http://127.0.0.1:1` y una anon key placeholder. Desarrollo: `vite build --mode development`; producción: `npm run build`. Son builds estáticos, sin servidor frontend dejado activo.

## Fallos encontrados y límites

1. La primera corrida de Vitest desde la junction falló al resolver módulos entre C: y D:. Se ejecutó desde la ruta física; las corridas finales pasan. El script de battle tampoco detectaba su entrada mediante comparación literal de rutas. Se corrigió con `realpathSync`, y luego se regeneró y verificó mediante el propio script.
2. Primera corrida con el selector: 20 tests de componentes fallaron porque los fixtures no enviaban la nueva confirmación de combatiente. Se actualizaron los fixtures y se agregaron pruebas explícitas de espera/confirmación, sin relajar el bloqueo del producto.
3. El intento inicial de derivar también Pikachu por últimos cuatro movimientos quitaba sus movimientos originales y falló la prueba larga de expiración. Se comprobó que el set original es legal por nivel/MT y se conservó; la prueba original vuelve a pasar sin cambiar el core.
4. La primera ejecución del e2e completó sus cinco checks pero se atascó esperando `Room.leave()` en un socket ya caído. Se terminó exclusivamente su proceso hijo identificado por PID/parent, y esa ejecución salió con error de top-level await pendiente. Se corrigió la limpieza para cerrar transportes directamente y esperar la salida del servidor. Las ejecuciones posteriores, incluida la final, pasan y terminan con código 0.
5. El e2e acredita el transporte real; sprites/escenas/barras se prueban con componentes y overlays en Vitest. No hubo revisión visual humana ni prueba de navegador físico. No se ejecutó la suite global ni auditorías ajenas al incremento.
6. Las elecciones permanecen en una Map durante la vida del proceso, sin expiración propia, conforme al experimento. No ofrecen identidad autenticada ni persistencia. Si la preparación del catálogo falla, el pool no se ofrece y el inicio falla cerrado; no se sustituye ninguna especie.
7. `npm ci --ignore-scripts` informó el estado previo de vulnerabilidades del lockfile (raíz: 7; realtime: 1 crítica). No se hizo auditoría adicional ni upgrades; los manifiestos y lockfiles no cambiaron.

## Entrega

Commits separados para autoridad/construcción (`85d407d`), selector/presentación (`60bd722`) y e2e/reporte. El HEAD final de esta rama, entregado completo en el chat, es el único SHA congelado para revisión independiente. Integración posterior a cargo de Claude.

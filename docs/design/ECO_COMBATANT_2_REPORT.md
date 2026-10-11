# ECO-COMBATANT-2 — candidato para revisión independiente

Implementación acotada, 2026-10-11. Rama nueva `codex/eco-combatant-2`, worktree administrado `C:/Users/Rodri/.codex/worktrees/eco-combatant-2/pokeswap`; ruta física `D:/CHATGPT/Datos-Codex/worktrees/eco-combatant-2/pokeswap`.

Base exacta: **81aa16d16035489d53bf906b3718c1edce8e4a6b**. Antes de comenzar coincidían el remoto consultado con `git ls-remote` y `origin/integration/world-skills-0.3`. AGENTS.md, invariantes y el alcance del 2026-10-10 aplicados. M-1 temporal fue autorizado expresamente por el usuario.

## Resultado y separación

1. `90bb20c`: lector estrecho de slots/progresión, handler Edge con secret/identidad/gate existentes y método de autoridad expuesto también por el wrapper de métricas. Operación fija, sin writes ni SQL.
2. `a6f21d4`: constructor M-1 puro validado, selección owned separada del modo sintético, lecturas frescas y reserva protegida después de cada espera; bundle regenerado por su script.
3. Commit de presentación/verificación: capacidad owned en join, selector con opciones propias/elegibilidad, etiqueta M-1 y campos derivados explícitos, panel y mensajes coherentes, regresiones y sondas aisladas. El SHA completo de cierre se registra fuera del checkout en `../verification/ECO_COMBATANT_2_FREEZE.md` después de crear el commit, sin amend.

El selector conserva su nodo/foco durante confirmación; flechas y Enter mantienen el comportamiento nativo y no llegan al mapa. No hay reenfoque por ACK. El usuario puede abandonar el control voluntariamente. Actualizar relee sus opciones, sin redesign de la caja.

La propiedad, especie, XP y movimientos llegan de lecturas servidor del dueño actual. Nivel usa la curva existente; discrepancia del nivel almacenado queda reportada. IVs/naturaleza/habilidad/género derivan del M-1 existente, EV=0, forma default, shiny=false y condición virtual nueva. Ninguno se presenta como atributo individual recuperado ni se persiste. No se completan sets: cualquier movimiento desconocido, ilegal o no ejecutable rechaza el ejemplar.

Cada selección e inicio relee dueño/lock; el lector termina comprobando el slot tras leer XP. Operaciones pendientes se serializan por jugador/socket. Tras esperar se comprueban actor, sesión, capacidad, elección y reserva vigentes; engage revalida área/rango/encuentro/espacio y crea autoridad/reserva sin otro await. Venta posterior a la lectura no cambia el snapshot; no se bloquea mercado ni se promete atomicidad con ventas.

Reconexión conserva elección y autoridad en memoria; reserva/gracia impide cambios. Huir/terminar libera selección y descarta condición/resultados. Whitelist pública de espectadores intacta. Core, tiempos, reglas, encuentros y catálogo salvaje no cambiaron. No hay dependencia nueva con INSTANCES-2 completa.

## Verificación dirigida

Runtime usado: **Node v22.23.3**, npm 11.17.0. Dependencias locales existentes copiadas a este checkout; manifiestos y lockfiles intactos. No se consultaron secretos o cuentas hosted.

| Comprobación | Resultado / evidencia externa en `../verification/` |
| --- | --- |
| Vitest: lectura, constructor, pool sintético, bundle, transporte cliente, aislamiento y UI | **91/91 aprobados** en `directed-vitest-freeze.log` (nueve archivos relacionados); incluye aislamiento con controles negativos y 50 de UI/selección |
| Node: selección owned/sintética, autorización, locks/venta, sesión, doble inicio, movimiento/elección durante lectura, contención, gracia/resume y puerto Edge | **13/13 aprobados** en `final-directed-node.log`; actualización de doble engage pendiente **7/7** en `owned-race-final.log` |
| Sonda Chrome nativa, ambas rutas | **96 eventos nativos por modo**; seis elecciones seguidas por ruta sin reenfoques, espera, Enter, salida voluntaria a chat/mapa/otro botón y mapa fuera del select. Owned: `native-owned-final-review/selector-keyboard.json`; sintético: `native-synthetic-complete/selector-keyboard.json`. PNG y cierres preservados |
| E2e aislado SDK/room/handler Edge/catalog/core reales, identidad/lecturas SCRIPTED | **PASS**, `owned-e2e-complete.json`: Pikachu A y Oddish B, propiedad/ACK independientes, movimientos del registro de prueba, acción core, escena/barras públicas, privacidad, bloqueo activo, huir → Rattata → nueva batalla sin desgaste. Audit: **cero writes**, gate existente recorrido; servidor propio termina con exit 0 |
| Tipos | `npm run typecheck` exit **0**, `types-freeze.log` |
| Lint repo y delta | `npm run lint` exit **0**, nueve warnings anteriores en AuthModal, sin warnings nuevos (`lint-freeze.log`). `--no-ignore` sobre JS/TS modificados de services/Supabase: exit **0** (`ignored-delta-lint.log`), usando la configuración existente y globals del runtime |
| Bundle / producción | `scripts/integration/bundle-battle.mjs` regeneró el único bundle afectado (`bundle-final.log`). Build productivo con `VITE_ECO_EXPERIMENT=on` exit **0**; marcadores M-1/UI owned ausentes (`production-build.log`, `production-markers.json`). Config servidor rechaza owned/ECO en producción; tests de modo e aislamiento aprobados |
| Edge puro offline | Deno 2.8.3 comprobó handler/lector con `--no-remote --no-npm`, exit **0**, `edge-deno-pure.log` |

No se corrieron suites generales del combate, economía o base; se conservaron sus verificaciones anteriores.

## Límites y fallos preservados

- **No verificación hosted ni deploy Edge.** E2e y sonda usan UUID/slots/XP/moves SCRIPTED rotulados; no acreditan datos reales, RLS desplegado ni integridad histórica. El producto reutiliza el join Supabase existente; el e2e reemplaza la identidad solo en una subclase de prueba, fuera del bootstrap productivo.
- `index.ts` de Edge tiene lint aprobado y wiring revisado, pero su check Deno completo offline queda **limitado**: el import JSR Supabase pide un manifest remoto no disponible. `--no-remote` lo rechazó; no se descargó ni se consultó hosted (`edge-deno-offline.log`). Un primer intento usó `--cached-only`, opción no disponible en Deno 2.8.3 (`edge-deno-check.log`). Handler/lector sí tienen check offline y tests.
- El core conserva su soporte existente: llevar habilidad M-1 en el modelo no habilita efectos de habilidades nuevos. Legalidad de movimientos es por learnset ORAS, no prueba de historial individual. Legacy sigue siendo un slot por especie, no múltiples ejemplares persistidos.
- Fallos iniciales de preparación/tests se conservaron: ruta inexistente al copiar dependencias backend (se corrigió la fuente local), resolución de promesa de prueba al reemplazar socket (`owned-server.log`), test TS con `.at` fuera del lib del proyecto (`final-types.log`), guard de imports que necesitaba permitir exactamente el nuevo builder/DTO (`final-directed-vitest.log`, `isolation-corrected.log`). No se desactivaron guards globales; se añadieron controles negativos.
- La sonda activa requirió corregir su setup owned: directorio de evidencia, selección inicial explícita por servicio (owned no tiene default), lista de opciones y uso de `state()` en lugar del helper exclusivo sintético. Intentos `native-owned*.log` y JSON fallidos conservados. E2e corrigió mezcla CJS/ESM de Colyseus, resolución de exports y expectativa de HP `HEALTHY` (null significa máximo en el modelo existente); intentos `owned-e2e-{first,esm,corrected}.json` preservados. No se cambió el core para satisfacer sondas.

## Entrega y conservación

Contrato: `docs/design/ECO_COMBATANT_2_CONTRACT.md`. El modo propio requiere ECO dev + `WORLD_ECO_COMBATANT_MODE=owned`, lector Edge actualizado y acceso tester/open existente. El sandbox sintético queda explícito y separado. El despliegue de Edge/activación hosted no forma parte de esta entrega.

Originales archivados CM-R1 intactos, también comparados con el checkout base: SHA-256 `38ACCE2252EA8988EED591C90864E30C82DC5D053235FC47FED9678E65C6B89C` y `4E6752425C4BC3BCE955C3FF248D679F121E029ED52F8BCC8895AE7B9AD76255` (`archived-hashes.json`). Evidencia nueva se conserva fuera del checkout; ningún archivo congelado anterior se alteró.

Sin nuevas tablas, SQL, dependencia, lockfile, inventario, captura, XP/recompensas, economía, balance, arte ni cambios del core/modelo. Sin push, merge o deploy. Checkout principal, worktrees/merges anteriores y otros entornos preservados. Sondas cierran únicamente sus sockets/procesos; cierre y árbol limpio se verifican al congelar. Integración posterior reservada a Claude.

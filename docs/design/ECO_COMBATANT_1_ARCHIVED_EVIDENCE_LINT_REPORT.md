# ECO-COMBATANT-1 — lint de evidencia archivada

Fecha: 2026-10-10. Base exacta: `d0eb1118ad339b1118b2abaee1e445d478250eb4`.
Rama/worktree nuevos: `codex/eco-combatant-evidence-lint`,
`D:/CHATGPT/Datos-Codex/worktrees/eco-combatant-evidence-lint/pokeswap`.

## Cambio y alcance

`eslint.config.js` agrega únicamente dos exclusiones literales al objeto de ignores existente:

- `docs/design/evidence/eco-combatant-cm-r1-continuity/scripts/native-continuity.original.mjs`
- `docs/design/evidence/eco-combatant-cm-r1/base-native/selector-native.original.mjs`

**FACT:** son copias originales de reproducciones independientes conservadas por los reportes de CM-R1. No son código productivo ni scripts usados por los gates actuales: no hay referencias desde `src/`, `services/`, `scripts/`, `package.json` o `.github/`. Los reportes vigentes usan `scripts/ecosystem/eco-combatant-keyboard-native.mjs`; CI usa `npm run lint` y los scripts activos de admisión. Las copias archivadas siguen disponibles para reproducir evidencia histórica.

No se excluye el directorio de evidencia ni se cambian reglas. El delta contiene solo configuración y este reporte. Producto, sondas, candidatos previos, cierre humano, dependencias y lockfiles permanecen intactos.

## Verificación

Node **v22.23.3**, npm **11.17.0**; PATH del proceso prioriza Node 22 también para el script de npm. Dependencias existentes copiadas al worktree nuevo, sin instalación ni cambios de manifiestos.

- `npm run lint` completo antes: salida **1**, **12 errores** en las dos sondas y **9 warnings** en `AuthModal.vue`.
- `npm run lint` completo después: salida **0**, **0 errores**, los **9 warnings preexistentes idénticos** en ubicación, mensaje y regla (`vue/attributes-order`).
- API de ESLint: comparación antes/después sobre **960 archivos versionados** con extensiones de código; solo cambió la exclusión de las dos copias. Los **74 scripts JS/TS activos** bajo `scripts/` siguen incluidos, entre ellos la sonda nativa vigente, e2e ECO y gates de admisión/bundles.
- SHA-256 y comparación binaria contra los blobs de la base: ambas copias idénticas antes/después. `git diff --check` correcto; evidencia anterior sin diff. Árbol limpio al finalizar el commit único.

| Evidencia archivada | SHA-256 conservado |
| --- | --- |
| `native-continuity.original.mjs` | `38ACCE2252EA8988EED591C90864E30C82DC5D053235FC47FED9678E65C6B89C` |
| `selector-native.original.mjs` | `4E6752425C4BC3BCE955C3FF248D679F121E029ED52F8BCC8895AE7B9AD76255` |

Salidas completas, códigos de salida y comprobador de alcance/hashes conservados fuera del checkout en `D:/CHATGPT/Datos-Codex/worktrees/eco-combatant-evidence-lint/verification/`: `base-lint.log`, `fixed-lint.log`, sus `.exit.txt`, `base-scope.json`, `fixed-scope.json` y `check-scope.mjs`.

No se ejecutaron suites de combate, builds, tipos ni e2e; se conservan sus resultados anteriores. Sin push, merge, amend ni procesos persistentes. Otros worktrees, merges locales y entornos no intervenidos. El SHA completo del commit único entregado en el chat queda congelado para revisión e integración posterior por Claude.

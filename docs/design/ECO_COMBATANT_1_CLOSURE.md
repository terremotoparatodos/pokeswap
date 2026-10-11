# ECO-COMBATANT-1 — cierre humano

**Candidato aprobado:** `ab916220aba54cdea782d497982d79c659238ce9`, de la rama de trabajo `codex/eco-combatant-cm-r1-continuity`, que se conserva.

**Rama de entrega:** `feat/eco-combatant-1-0.3`. Contiene el candidato y este commit documental encima; no cambia producto.

**Destino:** `integration/world-skills-0.3` (último remoto `02054b8`).

**Alcance:** experimento ECO de desarrollo. Está apagado por defecto y el servidor rechaza activarlo con `NODE_ENV=production`. Este cierre no despliega ni activa el experimento.

## 1. Confirmación humana

- **Smoke del candidato congelado `ab91622`**, el 2026-10-10, en un sandbox aislado (2790/2791/5199) con identidades sintéticas.
- **El usuario respondió: «Está perfecto.»** Se registra como confirmación general del smoke.
- **Los pasos del recorrido propuesto no se registran como resultados individuales,** porque el usuario no los detalló. Eran:
  - elegir con ratón y flechas;
  - Pokémon, movimientos y barras del dueño;
  - especie y escena vistas por el espectador B;
  - bloqueo del selector durante el combate;
  - huir y cambiar sin restos.
- No se atribuyen al usuario mediciones ni casos.
- **Registro del smoke:** `smoke.md` de la carpeta `eco-combatant-human-smoke/smoke-ab91622-20261010`, con sus logs y hashes, fuera del repositorio. El sandbox quedó apagado y sus puertos libres.

## 2. Evidencia técnica (ya en el candidato)

- Implementación y verificación: `ECO_COMBATANT_1_REPORT.md`.
- Corrección CM-R1, el teclado nativo del selector: `ECO_COMBATANT_1_CM_R1_REPORT.md`.
- Continuidad del foco tras confirmar: `ECO_COMBATANT_1_CM_R1_CONTINUITY_REPORT.md`.
- Contrato: `ECO_COMBATANT_1_CONTRACT.md`.
- Evidencia en `docs/design/evidence/eco-combatant-*`.

## 3. Pendientes conocidos

Se documentan aquí; esta entrega no los resuelve:

- **Elecciones sólo en memoria:** viven en la memoria del proceso, sin expiración, sin identidad autenticada y sin persistencia. Reiniciar el servidor puede perderlas.
- **Catálogo:** si su preparación falla, el pool no se ofrece y el inicio falla cerrado.
- **Pendientes de entregas ECO anteriores, que siguen igual:** móvil, sprites muy altos y desfases transitorios en el borde del rango.
- **Vulnerabilidades heredadas de los lockfiles:** se informaron y no se tocaron en este incremento; los manifiestos no cambian.
- **Rutas locales:** la evidencia conserva rutas de los worktrees locales.

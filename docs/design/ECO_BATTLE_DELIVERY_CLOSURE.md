# Entrega ECO de combate en el mundo — cierre humano

**Candidato aprobado:** `ef9ab3f92ff44c5e4212e6841b789cec53d63781`, rama `feat/eco-battle-panel-compact-0.3`. Este cierre es un commit documental encima de él; no cambia producto.

**Destino:** `integration/world-skills-0.3` (último remoto `3fde07d`).

**Alcance:** experimento ECO de desarrollo. Está apagado por defecto y el servidor lo rechaza en producción. No cambian core, balance, recompensas, persistencia, economía, SQL, Edge ni despliegue.

## 1. Aprobaciones registradas

Son generales y tal como el usuario las expresó. No se atribuyen al usuario mediciones ni casos individuales que no confirmó.

| Incremento | SHA | Aprobación |
|---|---|---|
| ECO-PRESENTATION-1 (ficha, combate desde el mapa) | `ec4d804` | Smoke humano funcional de una presentación **provisional**. El modal fue reemplazado por el combate en el mundo; `ec4d804` no se aprobó por separado. |
| ECO-OVERWORLD-BATTLE-1 | `a675b0e` | C1 aprobado técnicamente. Smoke humano: el funcionamiento básico y la dirección, aprobados en general; pasos 2–4 no confirmados uno por uno. |
| ECO-BATTLE-SPECTATORS-1 | `517d66f` | Aprobación funcional general del usuario (smoke, 2026-10-09). |
| ECO-BATTLE-ENDING-1 | `b56e5f7` | Aprobado técnicamente por la revisión independiente. La disposición de la escena no se aprobó; derivó en SCENE-1. |
| ECO-BATTLE-SCENE-1 | `89785e0` | Aprobación funcional general del usuario: «El funcionamiento de 89785e0 me parece perfecto.» |
| SC-R1 (rango desde la pose visible) | `ecee56f` | Aprobado técnicamente. |
| CHAT-SHORTCUT-1 + CH-R1 | `1ed9826` | Aprobado técnicamente. En el smoke de `f5257fc` el usuario dijo que el chat «está bien». |
| Combinación SC-R1 + chat | `f5257fc` | Merge local de `ecee56f` y `1ed9826`. Smoke: el chat bien; la presentación del panel de combate no se aprobó. |
| ECO-BATTLE-PANEL-1 | `ef9ab3f` | Aprobación visual general del usuario: «Apruebo visualmente el panel de ef9ab3f tal como lo probé.» |

Los reportes de cada incremento están en `docs/design/` (`ECO_PRESENTATION_1_*`, `ECO_OVERWORLD_BATTLE_1_*`, `ECO_BATTLE_SPECTATORS_1_REPORT.md`, `ECO_BATTLE_ENDING_1_REPORT.md`, `ECO_BATTLE_SCENE_1_*`, `CHAT_SHORTCUT_1_*`, `ECO_BATTLE_PANEL_1_REPORT.md`).

## 2. Pendientes conocidos

Se dejan para después; esta entrega no los resuelve:

- **Móvil:** el panel de combate y su ubicación no se revisaron en pantallas angostas. El atajo de chat es sólo de escritorio.
- **Sprites muy altos:** el recuadro de la escena usa una altura fija, así que un sprite alto puede asomar por encima o quedar cerca del panel.
- **Desfases transitorios:**
  - en el borde de una casilla o del rango, la ficha puede ofrecer un inicio que el servidor rechace por distancia, o al revés, durante ese instante;
  - al congelar a un salvaje en movimiento puede verse un ajuste de hasta una casilla.

  La autoridad sigue siendo del servidor.
- **Pulidos documentados sin corrección aparte:**
  - la retirada (fade) de ENDING-1;
  - el arte definitivo del combate;
  - la observación de ECO-OVERWORLD-BATTLE-1 sobre `returnFocus` en el camino ended→engaging.

## 3. Lo que no autoriza este cierre

- No despliega ni activa flags.
- No actualiza `pokeswap-int1` ni el entorno oscuro.
- No publica el plan de playtest privado, que sigue fuera de seguimiento en el checkout principal.

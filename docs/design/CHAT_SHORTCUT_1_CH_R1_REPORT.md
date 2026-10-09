# CHAT-SHORTCUT-1 · CH-R1 — el atajo no actúa detrás del overlay de entrada

**Rama:** `feat/chat-enter-shortcut-0.3`, sobre `6a01ad9`, con un commit nuevo (sin amend).

**Origen:** revisión independiente de `6a01ad9`, hallazgo **CH-R1 (P2)**. Informe: `CHAT-SHORTCUT-1-REVIEW-6a01ad9.md`.

**Alcance:** sólo CH-R1. No se incorpora el arreglo de distancia `ecee56f`.

## 1. Defecto y corrección

**Defecto.** En `connecting` y `reconnecting`, `WorldEntryOverlay` vuelve inertes el mapa y el chat y deja el foco en el `body`.
- `overHud` no incluía ese overlay, así que el Enter desde el `body` ponía `chat.open` en true detrás del overlay.
- Al volver a `ready`, el chat aparecía abierto.
- Tener el envío deshabilitado no lo evitaba.

**Corrección.** Usa el estado real de entrada de la vista, no la posibilidad de enviar:
- **`worldEntry.ts`:** un helper puro nuevo, `worldPlayable(state)`. Devuelve true sólo en `offline` y `ready`, las fases sin overlay. Todas las demás (`connecting`, `reconnecting`, `connection-error`, `replaced`) quedan bloqueadas.
- **`WildlandsView.vue`:** `:shortcut-blocked="overHud || !worldPlayable(entry)"`.
- **`ChatPanel.vue`:** sólo cambia el comentario de la prop.

Sin cambios en botones, escritura, repetición, Escape ni combate.

## 2. Regresiones (`chatShortcutEntry.test.ts`, 8)

Usan `ChatPanel` y `WorldEntryOverlay` reales, dispuestos como en la vista.

- **`connecting`, `reconnecting`, `connection-error` y `replaced`, con el foco en el `body`:**
  - Enter no abre el chat ni hace `preventDefault`;
  - al volver a `ready` el chat sigue cerrado, sin inert.
- Lo mismo con el acceso de envío ya en `connecting`.
- **En `ready`:** Enter desde el mapa abre el chat y enfoca el campo.
- **`worldPlayable`:** true sólo en `offline` y `ready`.
- **Vínculo de la vista:** `WildlandsView` usa exactamente `overHud || !worldPlayable(entry)`.

**Control negativo:** con `worldPlayable` siempre en true, fallan los 6 casos cubiertos. Restaurado: 8/8.

## 3. Reproducción nativa

Chrome 147, headless, perfil propio, sobre exportaciones en `D:\Claude-CHR1-native-<sha>`.

| Sonda | `6a01ad9` | `13299d9` |
|---|---|---|
| Original del revisor, modo `entry-overlay` | **exit 1**. En `connecting` y `reconnecting`, abre detrás del overlay y el panel aparece al volver a `ready` | No aplica: afirma el vínculo anterior `:shortcut-blocked="overHud"` |
| Copia fiel al vínculo, modo `entry-overlay` | **exit 1**, mismos 2 hallazgos | **exit 0**: chat cerrado detrás del overlay y al volver a `ready`. Mapa y chat inertes, envío deshabilitado |
| Copia fiel al vínculo, modo `positive` | — | **exit 0**. 164 eventos nativos, 93 keydowns trusted, 25 repeticiones y 4 envíos nativos, igual que en la revisión |

**La copia fiel al vínculo** (`D:\Claude-CHR1-scripts\chat-native-binding.mjs`) cambia una sola cosa respecto de la original:
- en lugar de afirmar el vínculo anterior, extrae literalmente el atributo `:shortcut-blocked` de `WildlandsView`;
- lo evalúa con `overHud.value` y el estado real del overlay (`entryState.value`).

Las aserciones no cambian.

## 4. Gates del delta (Node 22.23.2)

| Gate | Resultado |
|---|---|
| Pruebas del atajo y del chat: `chatShortcutEntry` (8), `ChatPanel.shortcut` (10), `ChatPanel` (3), `useChat` (1), `chatLine` (12) | 34/34 |
| `vue-tsc` | exit 0 |
| eslint de los 4 archivos del delta | exit 0 |

No se corrieron suites generales, por pedido.

**Candidato congelado:** `feat/chat-enter-shortcut-0.3`, en el commit que agrega este reporte. Sin push, merge ni cambios en otros entornos.

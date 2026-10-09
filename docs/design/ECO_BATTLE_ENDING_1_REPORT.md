# ECO-BATTLE-ENDING-1 — Inicio a 3 casillas y final sin aceptación

**Rama:** `feat/eco-battle-ending-0.3`, worktree `pokeswap-eco-ending`.
**Base:** `517d66f`, el candidato de espectadores con aprobación funcional general del usuario (smoke del 2026-10-09). Ese candidato no se modifica.

**Pedido (usuario, 2026-10-09):**
1. Distancia máxima de inicio: 3 casillas con la métrica actual. La valida el servidor; la ficha y la depuración lo muestran igual. Limita solo el inicio, sin cancelación automática.
2. Final sin aceptación:
   - el movimiento y los controles se recuperan al recibir el final;
   - no hace falta «Volver al mapa»;
   - un aviso breve y no modal informa el resultado;
   - el Pokémon vuelve a la Pokébola y el salvaje se desvanece solo con una victoria confirmada;
   - nada bloquea ni interfiere con un combate nuevo;
   - dueño y espectadores ven lo mismo;
   - sin drops, XP ni recompensas ficticias.

## 1. Commits

| Commit | Qué |
|---|---|
| `7c92533` | Inicio a 3 casillas |
| `da28cf0` | Final sin aceptación: aviso y final reproducido en el mundo |
| `52654c0` | e2e de combate: caminata por el camino más corto |
| (este commit) | Este reporte |

## 2. Inicio a 3 casillas (`7c92533`)

- **Constante:** `ECO_ENGAGE_RANGE` pasa de 6 a 3 (`worldProtocol.js` y `.d.ts`). Sigue siendo Chebyshev.
  - El servidor la aplica al reservar (`EcoBattles.engage` → `too-far`).
  - La ficha y la depuración leen la misma constante.
- **Solo limita el inicio.** La reanudación del combate propio no vuelve a medir la distancia, y alejarse durante el combate no lo cancela.
- **Pruebas:**
  - **E01 (servidor):** 3 casillas entra, en cualquier eje y en diagonal; 4 se rechaza con `too-far`.
  - **E02 (servidor):** el dueño se aleja 10 casillas y el combate sigue activo.
  - **Ficha:** 9 y 4 casillas, «Lejos… Acercate a 3 o menos» y deshabilitado; 3, «Libre».
  - **Depuración:** 3, «Combatir»; 4, «Lejos» con el texto de ayuda.
- **Fixtures movidos.** Algunas pruebas tenían el salvaje a 4 casillas. Se acercaron a 3 para que sigan midiendo lo mismo: el ocupado deshabilitado por ocupado, no por lejos.

## 3. Final sin aceptación (`da28cf0`, solo cliente)

**El dueño recupera el mapa al recibir el final.**
- La capa solo retiene al jugador y muestra el panel en `engaging`, `battle` y `refused`.
- `ended` ya no retiene: el bloqueo se libera en el mismo mensaje del servidor, la ficha vuelve a abrirse y depuración o ficha pueden iniciar otro combate de inmediato.
- El panel ya no tiene vista de resultado, ni «Volver al mapa», ni su guarda de 700 ms. Ya no hay botón que proteger.
- La sesión no cambia: `ended` queda como estado de reposo.
- Un **rechazo** sigue mostrándose con su botón: no es un final.

**Aviso no modal** (`EcoBattleToast.vue`).
- `role="status"`, sin controles, sin foco y con `pointer-events: none`.
- Título y detalle salen de los textos de resultado que ya existían.
- Se va solo a los 3 s, o en cuanto se pide otro combate.
- No muestra drops, XP ni recompensas: podrá listarlos cuando exista esa entrega.

**El final, reproducido en el mundo** (`EcoBattleOverlay`, para el dueño y para los espectadores por igual):
- Sin barras.
- El Pikachu se encoge y se desvanece (0,35 s) dentro de la Pokébola. Se reutiliza el sprite del motor, `pokeball.ts`, y la Pokébola se desvanece en 0,9 s.
- **El salvaje se desvanece solo con una victoria confirmada por el servidor** (dueño: `outcome === 'victory' && retired`; espectador: el desenlace público `victory`). Además, solo cuando la población del servidor ya no lo lista: hasta entonces lo dibuja la población y nunca aparece dos veces.
- Huida, derrota y vencimiento: el salvaje queda en el mapa como actor de la población.
- Un combate nuevo del dueño descarta su final anterior en el acto, incluso contra el mismo individuo: un solo Pikachu y ninguna Pokébola sobrante. Cambiar de área también lo descarta.
- Los espectadores conservan su rótulo de 1,5 s («Ganó», «Huyó»…). El reemplazo por un combate nuevo del mismo individuo (S2) se mantiene.
- **Coherencia:** el aviso del dueño y el rótulo del espectador salen del mismo desenlace del servidor; el desvanecimiento, en ambos casos, de la población del servidor.

## 4. Pruebas

**Pruebas nuevas o adaptadas.** Las 26 fallan sobre `7c92533` (`D:\Claude-ENDING-evidence\new-tests-on-7c92533.log`) y pasan con el cambio:
- **Aviso, por cada desenlace** (victoria, derrota, huida, vencimiento, desconexión, salida del área):
  - liberación inmediata (`battle: false`);
  - sin panel ni botón;
  - aviso `status` sin controles y sin texto de recompensa;
  - la ficha vuelve a abrir.
- **Vida del aviso:** se va a los 3 s, y en el acto al pedir otro combate.
- **Overlay:**
  - final del dueño: Pikachu que se encoge, Pokébola y nada al terminar;
  - huida, derrota y vencimiento sin desvanecimiento, listado o no;
  - victoria que se desvanece solo al dejar de estar listada;
  - combate nuevo inmediato sin restos;
  - `finish` de otro encuentro sin efecto;
  - espectadores igual: barras, Pokébola, rótulo y desvanecimiento solo en victoria.
- **Capa:**
  - huida y de inmediato el mismo individuo: liberación en el final, un Pikachu y ninguna Pokébola;
  - victoria, huida, derrota y vencimiento contra la población;
  - el final de un espectador;
  - el final reproducido en su área y nada al salir;
  - C1, F1, F3 y el foco al cerrar, sin aceptación: el panel se cierra con el final y el foco sigue volviendo al origen utilizable o al mapa.

**Gates (Node 22.23.2):**

| Gate | Resultado |
|---|---|
| vitest completo | 241 archivos, 2292/2292 |
| Servidor | 656 tests, 0 fallos |
| `vue-tsc` | exit 0 |
| eslint | exit 0; solo los 9 avisos previos de `AuthModal.vue` |
| Build de producción con `VITE_ECO_EXPERIMENT=on` | Las mismas 193 fuentes que `a675b0e`. Ninguna aparición de `EcoBattleToast`, de la capa ni de los textos del sandbox; solo la constante del protocolo |

**En la red** (runner aislado con un realtime nuevo por corrida, 31390/31391; evidencia en `D:\Claude-ENDING-evidence`):

| Corrida | Resultado |
|---|---|
| e2e de combate, primera corrida | **FAIL**: la caminata codiciosa no llegaba a 1 casilla rodeando obstáculos. Fallo del script, no del producto |
| e2e de combate, tras `52654c0` | **2/2 PASS**: lejos → `too-far`; ocupado → `busy`; captura rechazada; huida que libera sin retirar; victoria del servidor que retira una vez |
| e2e de espectadores | PASS, sin reintentos |

`52654c0` cambia solo la caminata del e2e de combate: BFS sobre la caminabilidad del servidor, como en el de espectadores. Las aserciones no cambian.

## 5. Sin cambios

Servidor salvo la constante del rango, protocolo, core de combate, balance y tiempos, reservas y sus reglas, recompensas, persistencia, economía, Cloud y Supabase.

**Pendientes:**
- **Arte:** la versión visual es sencilla a propósito; el arte definitivo es una tarea propia.
- **Smoke humano:** la sensación del cierre en dos ventanas.

**Candidato congelado:** `feat/eco-battle-ending-0.3` en el commit que agrega este reporte, para revisión acotada. Sin push, merge ni cambios en otros entornos. No queda ningún proceso activo.

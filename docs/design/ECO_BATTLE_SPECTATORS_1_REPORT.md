# ECO-BATTLE-SPECTATORS-1 — Reporte de implementación

**Rama:** `feat/eco-battle-spectators-0.3`, worktree `pokeswap-eco-spectators`.

**Base:** `12a5187`, la propuesta (`ECO_BATTLE_SPECTATORS_PROPOSAL.md`).
- Su padre es el candidato `a675b0e`, que se conserva intacto: `12a5187` solo agrega el documento de la propuesta.
- Los worktrees anteriores no se tocaron.

**Aprobación del usuario (2026-10-09):** alcance mínimo, con estas decisiones:

| Decisión | Valor |
|---|---|
| P1, desenlace | Visible 1,5 s |
| P2, alcance | Todos los combates del área; el dibujo respeta la cámara |
| P3, efectos | Los mismos que ve el dueño |

## 1. Commits

| Commit | Qué |
|---|---|
| `98d4ae5` | Protocolo (`world:eco-battle-public`) y proyección pública con listas blancas (`ecoBattlePublic.js`). |
| `2b81821` | Difusión del servidor a los demás viewers ECO del área y estado vigente para quien llega. El setup de pruebas pasa a un kit compartido. |
| `3bac715` | Cliente: recepción (`EcoSpectatedBattles`), ruteo en `SharedWorld` y en el transporte, adaptador `spectatorSnapshot` y textos del desenlace. |
| `8555e2a` | Cliente: dibujo de las escenas observadas en el overlay y conexión en la capa. |
| `2ed1a36`, `eae71b4` | e2e real con clientes del SDK (`eco-spectators-e2e.mjs`). |
| (este commit) | Este reporte. |

## 2. Qué cambió

### Servidor (solo con el experimento ECO, en desarrollo)

**`ecoBattlePublic.js` (puro).** Arma la vista pública campo por campo, desde listas blancas explícitas:
- **Por combatiente:** especie, nivel, PS máx./actuales, estado mayor, confusión (booleano), Velocidad, etapa de Velocidad, `actionElapsedMs` y `cooldownMultiplier`.
- **Reglas:** los cinco valores de `actionBar` y la escala de etapas.
- **Eventos:** nueve tipos (`MOVE_USED`, `MOVE_MISSED`, `DAMAGE`, `HEAL`, `STATUS_APPLIED`, `CONFUSION_APPLIED`, `PROTECT_GAINED`, `PROTECT_BLOCKED`, `FAINTED`), cada uno con sus campos y su `sequence`.
- **Nunca viajan:** movimientos, PP, selección, otras estadísticas, `joinAck`, controlador, ids de jugador o de acción, `serverTimeMs` ni otros tipos de evento.
- El snapshot y los eventos del dueño **no se reenvían enteros**.

**`EcoBattles`.** Publica la vista en los mismos momentos en que el dueño se entera de un cambio, y nunca más seguido:
- al reservar;
- en cada tick con eventos;
- con una acción aceptada;
- en la pausa (el socket actual se va);
- en la reanudación;
- en el final, con `ended`.

Detalles:
- **`seq` por batalla,** estrictamente creciente.
- **Las casillas de la escena** (la del dueño y la del salvaje al reservar) y el `seq` viven en un `WeakMap` aparte: **el objeto de reserva no cambia**, ni sus reglas.
- **`publicBattlesIn(areaId, except)`** devuelve el estado vigente, sin eventos, para quien llega al área.

**`WorldRoom`.**
- `broadcast` alcanza a todos los sockets ECO del área **excepto** cualquier socket del dueño.
- Después de cada snapshot del mundo (llegada, cambio de área, reconexión) envía los combates vigentes del área, menos el propio.
- El canal del dueño (`engage-result`, `eco-battle`, `eco-battle-end`) **no cambia**.

### Cliente (solo con el experimento ECO, en desarrollo)

**`EcoSpectatedBattles`.** Guarda la última vista aceptada de cada batalla del área actual.
- Un mensaje con `seq` igual o menor al último aceptado (duplicado, deserializado otra vez o atrasado) **no cambia nada**.
- Una batalla terminada **no se reabre nunca**.
- El origen de interpolación se reinicia solo con una revisión mayor o con un cambio de `connected`. Por eso pausa y reanudación funcionan **aunque la revisión no cambie**.
- El desenlace dura 1,5 s y un duplicado no lo prolonga.
- Un snapshot del mundo o una desconexión **vacía todo**: solo vuelve lo que el servidor reenvía.
- Ignora otras áreas y la batalla propia.

**`SharedWorld`.** Rutea `world:eco-battle-public` al espectador, nunca a la sesión del dueño. El transporte registra el mensaje solo con `ECO_EXPERIMENT`.

**`spectatorSnapshot`.** Alimenta con la vista pública el mismo `presentCombatant` / `actionBarFill` que usa el dueño. No hay fórmulas copiadas.

**`EcoBattleOverlay`.** Admite varias escenas: la propia y las observadas.
- Cada una dibuja el Pikachu junto a su entrenador (`stageOf` con las casillas del servidor), las dos barras, las mismas marcas y un rótulo corto al terminar («Ganó», «Huyó», …).
- **Cada individuo se dibuja una vez:** el salvaje es el actor de la población, quieto en su casilla mientras está ocupado; el entrenador es el avatar de presencia; el overlay solo agrega Pikachu, barras y marcas.
- «en combate» queda solo sobre ocupados que todavía no tienen escena.
- **P2:** se dibuja en coordenadas de mundo; el renderer proyecta por la cámara y descarta lo que queda fuera.

**`EcoExperimentLayer`.** Crea el estado del espectador y lo conecta al overlay.
- El espectador **no** recibe panel ni controles, y **no** se bloquea su movimiento.
- La ficha de un individuo ocupado sigue sin permitir combatir.

### Sin cambios

Core de combate, balance y tiempos, reservas y sus reglas, recompensas, persistencia, población, Cloud y Supabase. Los diffs de `src/features/battle`, de los bundles `ecosystem/` y de `supabase/` están vacíos.

## 3. Precisiones del usuario: cómo se cumplen y qué lo prueba

| Precisión | Implementación | Pruebas |
|---|---|---|
| Listas blancas explícitas en proyección y eventos | `ecoBattlePublic.js` | `ecoBattlePublic.test.js`: bundle real y entrada hostil. `S07` y e2e §8: sin datos privados en ningún payload. |
| Espectador sin controles ni pérdida de movimiento; dueño con su canal | Ruteo aparte; sin panel; `battle` emitido solo por el combate propio | Capa: `locks` queda en `[false]` para el espectador y en `[false, true]` solo con combate propio. `S01`: el dueño no recibe su batalla pública. |
| Cada individuo una sola vez | El overlay solo agrega Pikachu, barras y marcas | Overlay: un Pikachu por escena; con dos escenas más la propia, 3 Pikachu y 6 barras. |
| Entrar en un combate: estado vigente sin efectos históricos | `publicBattlesIn` sin eventos | `S03`, capa y e2e §3 (D). |
| Salir limpia; volver recibe lo vigente del servidor, no la caché | Snapshot del mundo vacía el estado | Estado: test «leaving drops everything». `S03`. e2e §5, con cruce real del portal de la cueva. |
| Duplicados y atrasados no retroceden, no repiten, no prolongan ni reabren | `seq` por batalla; ids terminados recordados; eventos por `sequence` | Tests del estado (duplicado deserializado, atrasado, fin duplicado, mensajes tras el fin y tras cambiar de área) y de la capa. |
| Pausa y reanudación con la misma revisión | El origen se reinicia con un cambio de `connected` | Estado; `S05` (misma revisión y mismo tiempo); e2e §4. |

## 4. Verificación

**Servidor** (`node --test`, Node 22.23.2): 654 tests, 0 fallos. Nuevos: 2 de proyección y 7 de difusión (S01–S07).
- Las 20 pruebas previas de reservas pasan sin cambios de aserciones, tras mover su setup al kit.

**Cliente:**

| Gate | Resultado |
|---|---|
| vitest | 241 archivos, 2272/2272 |
| `vue-tsc` | exit 0 |
| eslint | exit 0; solo los 9 avisos previos de `AuthModal.vue` |

Pruebas nuevas del cliente:
- 7 del estado del espectador;
- 3 de equivalencia de presentación: en un combate real completo, PS, estado y barra interpolada son idénticos a los del dueño a través de la proyección y del JSON; pausa y final congelados; las mismas marcas;
- 4 del overlay;
- 4 de la capa.

**e2e real** (`eco-spectators-e2e.mjs`):
- **Montaje:** realtime aislado (`eco-gameplay-local.mjs realtime`, puertos 2790/2791) sobre una exportación de `2ed1a36`, con el script final copiado.
- **Clientes:** tres jugadores sintéticos y un cuarto que llega tarde, con el SDK real de Colyseus.
- **Resultado: 3/3 PASS** (corridas 4, 5 y 6). Las corridas 1–3 fallaron por el script, no por el producto:
  - la caminata codiciosa no rodeaba obstáculos;
  - la ventana de ausencia empezaba antes del cruce;
  - un combate terminaba antes de cada comprobación.

  Lo corrigió `eae71b4`: BFS sobre la caminabilidad del servidor, C esperando junto a la boca de la cueva y reintento con un combate nuevo.

Qué comprueba cada corrida:
- dos combates simultáneos; C ve ambos intercalados; cada dueño ve solo el otro;
- entrada tardía de D;
- pausa y reanudación con la misma revisión;
- cruce real Pradera → cueva → Pradera: nada mientras C está en la cueva; al volver, el combate vigente sin eventos pasados;
- huida y final decidido por el servidor: una vez, al final, con el desenlace y la revisión del dueño;
- sincronización: misma revisión → mismo tiempo, mismos PS y mismas secuencias de eventos dibujables;
- invariantes del flujo;
- ningún dato privado en 38 a 52 payloads por corrida.

Evidencia en `D:\Claude-SPECT-E2E-evidence` (`run*.log`, `run*.json` y `realtime.log`). El realtime quedó apagado y los puertos libres.

**Exclusión productiva:** build de producción con `VITE_ECO_EXPERIMENT=on` sobre una exportación de `eae71b4`.
- **Fuentes:** 193, la misma lista que el build de `8df1aa0` (código de `a675b0e`).
- **Textos y módulos del espectador:** 0 apariciones (`EcoSpectatedBattles`, `spectatorSnapshot`, `setSpectated`, «Combate liberado», «Sin ganador», …).
- **Único string nuevo:** la constante `world:eco-battle-public` de la tabla del protocolo, igual que `world:eco-battle-end` ya estaba.

## 5. Observaciones

- **El protocolo tiene una sola fuente de verdad:** el servidor. El cliente no deduce combates, no envía nada como espectador y no tiene intents nuevos.
- **Coste:** un mensaje pequeño por evento de combate, por espectador del área; se cuenta en `stats().published`. No se fijó un umbral.
- **Cuándo se compara la sincronización:** solo cuando el dueño y el espectador tienen la misma revisión con eventos. Mientras el dueño estaba desconectado, o antes de que el espectador llegara, no hay pares.
- **Fuera del alcance:** arte definitivo de las escenas observadas, atenuación (P3 = idénticas) y chat o reacciones de espectadores.
- **Smoke humano con dos ventanas:** pendiente, se prepara después (proposal §7).

**Candidato congelado:** `feat/eco-battle-spectators-0.3` en el commit que agrega este reporte, para revisión independiente. Sin push, merge, Cloud, Supabase ni cambios en otros entornos. Ningún sandbox queda activo.

## 6. Revisión de `3decc3d`: S1, S2 y acreditación del e2e (2026-10-09)

**Revisión:** `ECO-BATTLE-SPECTATORS-1-REVIEW-3decc3d.md`, FINDINGS.
- **S1:** el área dibujada cambiaba antes del snapshot del mundo y las escenas del área anterior seguían ahí.
- **S2:** si alguien volvía a combatir al mismo individuo durante el desenlace anterior, se acumulaban dos escenas.
- **e2e:** había huecos de acreditación.

Lo demás de §1–§5 quedó acreditado por la revisión.

| Commit | Qué |
|---|---|
| `4c5119a` | S1 y S2, con sus regresiones |
| `0a9a7c4` | e2e: comprueba lo que reporta |
| (este commit) | Este apartado |

**Reproducción propia antes de corregir.** Sobre una exportación propia de `3decc3d`, con los scripts del revisor copiados fuera de su carpeta (su evidencia quedó intacta):
- **`review-spectators-boundaries.test.ts`:** 2 fallos.
  - S1: siguen el Pikachu, las barras y `-3` tras el cambio local de área.
  - S2: dos Pikachu, en `(216,-1474)` y `(232,-1474)`.
- **`spectators-native.mjs` (Chrome 147):** `pass: false`, con hallazgos S1 y S2.

**Correcciones** (solo cliente; sin servidor, protocolo, core, balance, reservas ni persistencia):

- **S1.** La capa informa al estado del espectador el área que ve el jugador (`setViewArea`, síncrono y en cuanto cambia).
  - Las batallas de otras áreas y sus temporizadores de desenlace se van **de inmediato**.
  - El área que se dejó no se vuelve a aceptar **hasta el próximo snapshot del mundo**. Los mensajes atrasados no la reintroducen.
  - Volver al área muestra solo lo que el servidor reenvía tras su snapshot.
    - FACT: todo cruce, aceptado o rechazado, termina en uno (`PresenceRoom.sendSnapshot` → `world.snapshot`).
  - Si el snapshot llega antes que el cambio local, lo recibido para la nueva área espera, sin dibujarse, hasta que el jugador la ve.
- **S2.** Una batalla nueva contra un `encounterId` **reemplaza** a cualquier otra todavía mostrada para él (un desenlace en curso).
  - La reemplazada se recuerda como terminada y nunca se vuelve a tomar.
  - Los combates contra individuos distintos siguen juntos.

**Regresiones.** Las 5 fallan sobre `3decc3d` y pasan con el arreglo:
- **Estado (3 tests):**
  - S1 con mensajes atrasados y vuelta sin snapshot;
  - S1 con el snapshot primero;
  - S2 con otro individuo al lado.
- **Capa (2 tests):** S1 y S2 sobre lo que se dibuja.

**e2e endurecido (solo los puntos del informe; no se quitó ningún escenario ni se rebajó ninguna aserción):**
- **Ruteo:** exige que cada dueño reciba la batalla del otro, sin la salida «o terminó».
  - El solapamiento activo pasa a ser una aserción: ambos combates empezaron antes de que terminara cualquiera, según C.
  - Individuos distintos.
  - Recupera la comprobación exacta de `encounterId` y casilla del salvaje para **cada** combate.
- **Sincronización:** al menos un par dueño/espectador con eventos **para cada uno** de los dos combates iniciales, antes de D y al final.
  - FACT de la corrida de diagnóstico: los «cero pares de B» se debían a combates que terminaban en su primera ventana con eventos, no a un desfase.
  - El par cuenta aunque el combate termine en ese mismo tick.
  - Si un combate termina sin su par, se reintenta con combates nuevos.
- **D:** debe recibir una llegada **viva** sin eventos, después de que C ya vio eventos de esa batalla.
- **Reconexión de A:** se conserva su historial.

**Verificación:**

| Comprobación | Resultado |
|---|---|
| Sondas del revisor sobre `0a9a7c4`, sin cambios | Fronteras 2/2; Chrome nativo `pass: true`, sin hallazgos |
| Control del dueño | C1 nativo `pass: true` |
| Pruebas relacionadas | `world` + `wildlands` 687/687; servidor (proyección, difusión, kit) 29/29 |
| `vue-tsc` | exit 0 |
| eslint del delta | exit 0 |
| e2e endurecido | 3/3 PASS (`run2`–`run4`), de 43 a 91 payloads públicos sin datos privados |
| Build de producción con `VITE_ECO_EXPERIMENT=on` | Las mismas 193 fuentes que `a675b0e`; ninguna aparición del espectador; solo la constante `world:eco-battle-public` |

- La corrida `run1` (espera anterior, que exigía ambos vivos con par) y `debug1` (diagnóstico) quedan como evidencia.
- Evidencia en `D:\Claude-SPECT-REPRO-evidence` y `D:\Claude-SPECT-E2E2-evidence`.
- El realtime quedó apagado y los puertos 2790/2791/5199 libres.

**Candidato congelado:** `feat/eco-battle-spectators-0.3` en el commit que agrega este apartado, para revisión independiente.
- Sin push, merge, túneles ni sandbox activo.
- El plan de playtest privado sigue sin seguimiento en el checkout principal y no forma parte de estos commits; no autoriza publicar ni integrar.
- El smoke humano con dos ventanas sigue pendiente.

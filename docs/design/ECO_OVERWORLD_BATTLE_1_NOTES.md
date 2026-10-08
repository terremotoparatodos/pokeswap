# ECO-OVERWORLD-BATTLE-1 — Comprobaciones previas a implementar

**Rama:** `feat/eco-overworld-battle-0.3`.
**Propuesta aprobada:** `docs/overworld-battle-proposal-0.3` @ `8729fe8`, decisiones A–F.

## 0. Base explícita y dictamen de `ec4d804`

**Base:** `ec4d804e913f8fb90199d9d2f5f60fcdfc6469f3`. Es una rama nueva **hija** del candidato, que no se modifica.
- El remoto `integration/world-skills-0.3` está en `3fde07d`, verificado.
- `ec4d804` desciende de `3fde07d`. Se parte de ahí porque la decisión E conserva su ficha, la selección por individuo y las correcciones de teclado y limpieza (F1, F2).

**Dictamen independiente de `ec4d804`** (`ECO-PRESENTATION-1-CLOSURE-ec4d804.md`): **FINDINGS**.
- F1 y F2 cierran.
- F3 queda parcialmente abierto: después de un combate iniciado desde depuración, el foco no vuelve al botón de depuración que lo inició, que sigue existiendo.
- El defecto vive en el **modal** `EcoBattleScreen`, que este incremento **reemplaza** (decisión E). El panel nuevo no es modal y no vuelve `inert` a depuración. Aun así, su manejo del foco debe cubrir esa misma ruta: guardar el origen **al pedir el combate** y devolverle el foco al terminar si sigue existiendo. Una prueba lo comprueba.
- Si `ec4d804` necesitara otra corrección antes de integrarse, esta rama se rebasa o se mergea sobre el resultado. El candidato congelado no se toca.

## 1. Movimiento automático sin órdenes (FACT, core)

`src/features/battle/rules/reduce.ts`, `chooseMove`, la «cadena de fallback aprobada (§12, §22)». En cada ventana de acción, si no hay un cambio, objeto o captura seleccionados:
1. el movimiento **seleccionado**, si se puede usar (tiene PP y una regla ejecutable);
2. si no, el **último usado** (`runtime.lastMoveId`), si se puede usar;
3. si no, el **primero utilizable** en el orden de sus casillas;
4. si no queda ninguno, **Struggle** (`struggle`, sin PP y con retroceso del 25 % de los PS máximos).

**No hay IA:** el lado salvaje (`controllerId: null`) sigue la misma cadena. La selección del jugador queda en `runtime.selected` y **persiste**: se repite en cada ventana hasta que cambie. Si el seleccionado se queda sin PP, cae al paso siguiente en lugar de bloquear el combate.

**Consecuencia para la presentación:** dibujar «elegido: X» desde `runtime.selected` y mostrar lo que realmente se usó desde los eventos `ACTION_STARTED` y `MOVE_USED`. Nunca hay que deducirlo en el cliente.

## 2. Qué datos representan la barra de acción (FACT)

- **Regla.** Un combatiente actúa cuando `runtime.actionElapsedMs ≥ cooldownMs(combatiente, config)` (`reduce.ts`, `resolveDue`). Al abrirse la ventana, `actionElapsedMs` vuelve a 0 y `cooldownMultiplier` a 1.
- **`cooldownMs`** (`rules/actionBar.ts`): `clamp(baseSeconds·√(referenceSpeed/Vel_efectiva), min, max)` en ms, multiplicado por la parálisis y por `runtime.cooldownMultiplier`.
  - La velocidad efectiva sale de `stats.spe` y `runtime.stages` (`effectiveStat`).
  - El core también exporta `actionBarFill`, que da un valor de 0 a 1 «para un HUD».
- **El snapshot de cliente lo trae todo.** `ClientBattleSnapshot.config` (incluido `actionBar`) y, por combatiente, `stats`, `condition.majorStatus`, `runtime.actionElapsedMs`, `runtime.cooldownMultiplier`, `runtime.stages` y `runtime.sleepRemainingMs`.
  - Esos son exactamente los campos que leen `cooldownMs` y `effectiveStat`.
  - **Se reutiliza `actionBarFill` del core sobre la vista de cliente**, sin copiar la fórmula. Una prueba confirma que coincide con el estado canónico.
- **Sueño:** la barra **no avanza** mientras dura (`tickClock`). La presentación la muestra quieta.
- **Cuándo llega un snapshot** (ECO-2, `ecoBattles.js`):
  - en cada tick del mundo **que produjo eventos**, con al menos una ventana de acción por cooldown, es decir, cada 4 s como máximo según los valores actuales;
  - en cada acción del dueño;
  - al reanudar.

  Entre dos snapshots el cliente no tiene datos nuevos del servidor.
- **Interpolación, solo visual:** `relleno = actionBarFill` sobre un `actionElapsedMs` desplazado por el tiempo local transcurrido desde que llegó el snapshot, **tope en 1**.
  - No avanza si el combatiente está dormido, si `connected` es falso o si el combate terminó.
  - Al llegar un snapshot nuevo, todo se reemplaza por los valores del servidor.
  - **No genera ataques, daño ni resultados.** Una barra llena espera al servidor.
- **PS:** siempre los del último snapshot.
  - Pueden **subir**: los eventos `HEAL` existen con causa `move`, `drain` o `item`, y `remainingHp` viene en `DAMAGE`, `HEAL` y `STATUS_TICK`.
  - Ni la presentación ni las pruebas exigen que bajen.

## 3. Lo que este incremento no decide

- No cambia tiempos ni balance: se usan los del servidor tal cual (`DEFAULT_BATTLE_RULES_CONFIG`).
- No cambia servidor ni protocolo. Los espectadores solo ven la marca «en combate», sacada de `busy` (decisión D1). El combate completo para espectadores queda **pendiente de forma explícita**.
- La observación abierta de «PS y contador quietos» (ECO-PRESENTATION-1) se aborda con la comprobación de sincronización de este incremento (§3.4 de la propuesta). Todavía no tiene causa atribuida.

# R32.3 — Shared Battle Rules

> Rama `feat/r32-3-shared-battle-rules`, desde `feat/r32-2-1-model-decisions` @ `2738e43adf1ac01c53888d2c9e04d733d26a3ea8`.
> **Solo dominio puro, tests, muestra y documentación.** No hay servidor, ni red, ni Supabase, ni persistencia, ni UI, ni integración con la Dungeon, ni co-op, ni Alpha, ni Boss Skills, ni economía.
> Ruleset base: **ORAS / Generación VI**, adaptado a tiempo real. Catálogo: `1.oras.ab69b5804411`. Reglas: `pokeswap-battle-v1`.
> Código: `src/features/battle/rules/`. Muestra: `npm run battle:sample`.

---

## 1. Qué es

El motor de combate de PokeSwap: **puro, determinista y compartido**. El mismo módulo lo corre el cliente y lo va a correr el servidor; lo único que R32.4 tiene que decidir después es **quién tiene la palabra final**, no cómo se resuelve un combate.

```
mismo estado inicial
+ mismos comandos, en el mismo orden
+ misma semilla
+ mismos catalogVersion y battleRulesVersion
────────────────────────────────────────────
  mismo estado final, y los mismos eventos
```

Lo que **no** es: no es el catálogo (R32.1), no es el Pokémon que se posee (R32.2), no es autoridad (R32.4) y no es gameplay. Al terminar R32.3 no se juega nada nuevo.

## 2. Arquitectura — decisión reportada

**Un solo punto de entrada, un reducer puro:**

```ts
reduceBattle(state, command, context) → { state, events }
```

- El llamador **nunca** escribe dentro de `BattleState`. No hay setters, no hay mutación, no hay API alternativa.
- Un comando rechazado devuelve **el mismo objeto de estado** (`===`) más un evento `COMMAND_REJECTED`. Nada a medio aplicar.
- `context` lleva **sólo** el catálogo (funciones, grande, compartido, de sólo lectura). Todo lo demás —incluida la configuración de reglas— viaja **adentro** del estado, así que un replay no se puede rebalancear sin querer.

Por qué así y no un objeto de batalla con métodos: el prototipo de Dungeon muta las instancias que recibe y escribe un log de strings en español; cada consumidor terminó parseando esos strings. Un reducer con eventos tipados es lo mismo que R30 ya hizo con la presencia (el cliente manda intención, el servidor deriva estado) y es exactamente la costura que R32.4 necesita.

### 2.1 Archivos

| Archivo | Responsabilidad |
|---|---|
| `version.ts` | `BATTLE_RULES_VERSION` |
| `config.ts` | Todos los números, marcados `APPROVED` o `PLAYTEST` |
| `rng.ts` | Aleatoriedad como dato: `{ seed, cursor }` |
| `catalogView.ts` | La vista angosta del Battle Catalog que las reglas consumen |
| `moveSupport.ts` | Qué movimiento se puede ejecutar, y por qué no |
| `state.ts` | `BattleState` y cómo se lee |
| `stats.ts` | Stats efectivas, stages, acierto/evasión |
| `actionBar.ts` | Cooldowns |
| `damage.ts` | Fórmula Gen VI, acierto, crítico, multigolpe |
| `capture.ts` | Contrato puro de captura |
| `commands.ts` / `events.ts` | Entrada y salida |
| `transitions.ts` | Las únicas formas de tocar el estado (invariantes en un solo lugar) |
| `moveEffects.ts` | El registry de efectos |
| `reduce.ts` | El reducer y el reloj |
| `setup.ts` | Entrada y salida del borde de persistencia |
| `sampleBattles.ts` | Fixtures reproducibles que comparten tests y muestra |
| `index.ts` | Barril: se importa desde acá |

Ninguno pasa las 510 líneas. `reduce.ts` es el más grande (506) y tiene una sola responsabilidad: el reducer y el reloj.

## 3. BattleState

Data plana: JSON-safe, sin clases, sin closures, sin `Date`, sin funciones. Se puede mandar por un socket, guardar, diffear y reproducir.

```ts
BattleState {
  battleRulesVersion, catalogVersion, battleId,
  timeMs,            // milisegundos enteros desde el inicio; nunca un reloj real
  rng,               // { seed, cursor }
  config,            // los números con los que corrió esta batalla
  sides:      BattleSide[]      // { sideId, controllerId, activeIds[], partyIds[] }
  combatants: Record<id, BattleCombatant>
  outcome,           // ongoing | decided(winningSideId) | captured(combatantId)
  eventSeq
}
```

`BattleCombatant` respeta el corte de R32.2.1 **exactamente**:

| Capa | Dónde | ¿Sobrevive? |
|---|---|---|
| `instance: PokemonInstance` | identidad | Sí. **Las reglas no la escriben nunca** |
| `condition: PokemonConditionState` | HP, PP gastados, estado mayor | Sí, sale con `leaveBattle` |
| `runtime: CombatantRuntime` | Action Bar, stages, confusión, Protect, selección, forma activa | **No**: muere con la batalla |
| `stats`, `level` | derivados del modelo al empezar | No se persisten |
| `wild` | si se puede capturar | — |

### 3.1 Extensibilidad (§9 del contrato)

El baseline es **1 activo contra 1 activo**, pero el estado no está escrito como `ally`/`enemy`: son **bandos con party y slots activos**. Un Alpha peleado por dos aliados, o un co-op de 2–4, son más slots y más bandos, no otro tipo. `controllerId` ya existe por bando para que el co-op tenga dónde apoyarse.

**Nada de eso está implementado.** Ninguna regla de R32.3 lee más allá del primer slot activo.

## 4. Comandos

```ts
USE_MOVE | SWITCH | USE_ITEM | CAPTURE | CLEAR_SELECTION | ADVANCE_TIME
```

Los cuatro comandos de acción **no ejecutan al llegar**: fijan qué va a hacer el combatiente cuando su Action Bar se complete. Eso es lo que significa "consume una Action Window" en un juego sin turnos (§27, §29): elegir cambiar cuesta la misma ventana que atacar.

- Una selección de **movimiento persiste** (auto-repeat aprobado, §12).
- Cambio, objeto y captura son **de una sola vez**; después se vuelve al último movimiento usado.
- `ADVANCE_TIME` es el **único** comando que resuelve algo, y el único reloj que tienen las reglas.
- Excepción deliberada: un `SWITCH` pedido por un Pokémon **debilitado** se ejecuta al instante, porque su barra no se va a llenar nunca.

`BOSS_SKILL` no existe: es extensión futura, y no se implementan bosses.

## 5. Eventos

Salida estructurada y JSON-safe, con `seq` y `atMs` en cada uno. **Nadie parsea un string**: las palabras son de la UI, que R32.3 no tiene.

`ACTION_READY` · `ACTION_STARTED` · `MOVE_USED` · `MOVE_MISSED` · `MOVE_REFUSED` · `DAMAGE` · `HEAL` · `PP_CHANGED` · `STATUS_APPLIED` · `STATUS_FAILED` · `STATUS_TICK` · `STATUS_ENDED` · `CONFUSION_APPLIED` · `CONFUSION_SELF_HIT` · `CONFUSION_ENDED` · `PROTECT_GAINED` · `PROTECT_BLOCKED` · `PROTECT_EXPIRED` · `STAT_STAGE_CHANGED` · `SWITCHED` · `ITEM_USED` · `CAPTURE_ATTEMPT` · `CAPTURE_SUCCESS` · `CAPTURE_FAILED` · `FAINTED` · `BATTLE_ENDED` · `COMMAND_REJECTED`

El replay determinista se verifica **también sobre los eventos**: dos corridas que terminan igual habiendo contado historias distintas no son la misma batalla.

## 6. RNG

```ts
RngState = { seed, cursor }
```

Vive **adentro** del estado. Un sorteo es una función pura `(state) → { value, state }` y lo único que se mueve es el cursor, así que "cuántas tiradas lleva esta batalla" es un número observable y un desync se ve en vez de ser un misterio.

Reglas del contrato de sorteos, porque de esto depende el replay:

1. **Orden fijo por movimiento:** acierto → cantidad de golpes → (por golpe) crítico, spread → efecto secundario.
2. **Una certeza gasta su tirada igual.** Un movimiento que no puede fallar igual consume su tirada de acierto, así que agregar o sacar uno más adelante no corre todas las tiradas siguientes.
3. Nada de `Math.random()`. Hay un test que reemplaza `Math.random` y `Date.now` por funciones que tiran error y corre una batalla completa.

## 7. Versionado

| | Qué contesta |
|---|---|
| `catalogVersion` | **Qué dicen los datos**: qué especies, movimientos, tipos y naturalezas existen, con qué números |
| `battleRulesVersion` | **Cómo PokeSwap los lee en tiempo real**: Action Bar, qué significa prioridad, qué hace Protect, cómo se comporta un estado sin turnos |

Un cliente y un servidor pueden coincidir en el catálogo y aun así no coincidir en las reglas, así que `reduceBattle` **rechaza** un estado que no coincida en cualquiera de las dos. No se reinterpreta nada contra otro catálogo.

Valor vigente: `pokeswap-battle-v1`. Se sube cuando cambia una regla de forma que los mismos comandos darían otra batalla. **Cambiar un `PLAYTEST` del config es un cambio de reglas**: el config viaja adentro del estado y un replay lleva los números con los que corrió, pero una batalla guardada de otra versión de reglas no es reproducible acá y se rechaza.

## 8. Action Bar

```
cooldown = clamp(2.6 · sqrt(60 / Velocidad), 1.4, 4.0) s      PLAYTEST
```

La raíz cuadrada es lo que importa: mantiene el medio del rango donde tiene que estar la sensación y comprime los dos extremos, así que un Pokémon muy rápido es claramente más rápido sin actuar dos veces por acción rival, y uno muy lento es claramente más lento sin ser injugable.

Tres cosas estiran o achican la ventana, y las tres son runtime:

| | Efecto | Origen |
|---|---|---|
| Velocidad | la fórmula | stages y modificadores; **nunca** la Speed persistida (§13) |
| Parálisis | ×2 a **todo** cooldown | PLAYTEST |
| Lo que dejó la acción anterior | prioridad ×0.5, recarga ×2, Protect agotado ×2 | PLAYTEST |

Todo en **milisegundos enteros**. Segundos serían un float que se acumula durante una expedición de tres horas, y el determinismo vale más que la comodidad.

**El reloj no depende de cómo lo corte el llamador.** `ADVANCE_TIME` avanza hasta *lo próximo que pasa*, no hasta el final del delta: 10 000 ms de una vez, mil llamadas de 10 ms y cortes irregulares de 17 ms dan el mismo estado y los mismos eventos. Hay test. Es lo que permite que un cliente animando a 60 fps y un servidor a 10 Hz estén de acuerdo.

**Orden de desempate:** en un mismo milisegundo primero corre el daño residual y después las Action Windows, y las ventanas se resuelven en orden de bando y después de slot. Fijo, para que un replay no pueda discrepar.

> **Diferencia con el prototipo de Dungeon:** el prototipo corre con los valores de legibilidad de D1.2.4 (3.9 / 2.1 / 6.0 s), 1,5× estos. Las formas son idénticas; los números del contrato R32.3 son estos.

## 9. Daño

Orden de redondeos — **esto es contrato**, cambiarlo rompe el replay:

1. `levelTerm = floor(2 · nivel / 5) + 2`
2. `base = floor(floor(levelTerm · potencia · Atk / Def) / 50) + 2`
3. `× crítico` (1.5) → floor
4. `× aleatorio` (85…100 / 100, entero 0–15) → floor
5. `× STAB` (1.5) → floor
6. `× efectividad` → floor
7. mínimo 1, salvo inmunidad, y entonces exactamente 0.

**Dónde está la quemadura:** en la **stat de Ataque**, no como paso de la cadena. La quemadura de PokeSwap es `Ataque ×0.5` (§25) y aplicarla dos veces dividiría el daño dos veces. Se aclara porque la fórmula Gen VI pone un modificador de quemadura en la cadena y quien lea el código lo va a buscar.

- **Tipos:** la tabla del catálogo R32.1, no una escrita a mano. Tests de inmunidad, 0.25×, 0.5×, 1×, 2×, 4× y doble tipo, con los cuatro fixtures pedidos: Hada→Dragón 2, Dragón→Hada 0, Fantasma→Normal 0, Eléctrico→Tierra 0.
- **STAB:** 1.5×. Adaptability **no** se implementa; queda el hook.
- **Crítico:** baseline Gen VI, 1/16, y 1/8 con `meta.critRate`. Multiplicador 1.5. Ninguna habilidad ni objeto lo modifica todavía. Sale en el evento `DAMAGE` (`critical`).
- **Acierto:** `accuracy` del catálogo; `null` = no puede fallar; stages de acierto y evasión implementados y testeados, aunque hoy ningún movimiento los puede mover (§12).

## 10. PP y Struggle

La identidad del movimiento vive en la Instance (`moveId` + `ppUps`); el PP gastado vive en la Condition, indexado por `moveId` y disperso. `maxPP` se deriva: PP del catálogo + 20 % por PP Up.

- Ejecutar consume 1 PP y emite `PP_CHANGED`.
- Con 0 PP no se ejecuta.
- **Cadena de respaldo (§12, §22):** lo seleccionado → el último usado → el primero usable → **Struggle**.
- "Usable" significa **PP y una regla que lo pueda correr**. Un Gengar cuyo único movimiento con PP es uno que R32.3 difiere se quedaría parado cada ventana con la barra llena; eso no es un gap explícito, es un cuelgue.

**Struggle** (§22): 50 de potencia, no gasta PP, **ignora el tipeo por completo** (Gen VI: sin STAB y sin tabla, le pega a un Fantasma) y le cuesta a su usuario **un cuarto de su HP máximo** — del máximo, no del daño hecho. Emite `ACTION_STARTED: 'struggle'`: **no hay respaldo silencioso**.

> Desviación PokeSwap registrada: en los juegos Struggle es para "sin PP". Acá también se llega a Struggle cuando el Pokémon tiene PP pero **ningún** movimiento ejecutable. Es explícito en los eventos y evita un cuelgue; queda como pregunta abierta si se prefiere otra salida.

## 11. Protect

Contrato de playtest implementado:

- escudo de **2 cargas**;
- bloquea las próximas 2 **acciones ofensivas** (cualquier movimiento apuntado a otro);
- un movimiento **multigolpe gasta UNA carga**, no una por golpe: el escudo para la acción, no la animación;
- al **agotarse** la última carga, el próximo cooldown del dueño del escudo es **×2**;
- responde antes que todo: el movimiento se gasta y la tirada de acierto no llega a pasar;
- eventos explícitos: `PROTECT_GAINED`, `PROTECT_BLOCKED` (con cargas restantes), `PROTECT_EXPIRED`.

Runtime puro: un cambio lo borra y `leaveBattle` ni lo ve.

> **Diferencia con el prototipo y pregunta abierta:** el prototipo duplica el cooldown **al lanzar** Protect; el contrato de R32.3 dice "al agotarse" y eso es lo implementado. También: como no hay penalización por usos consecutivos (los juegos bajan la probabilidad de éxito), con auto-repeat el escudo se puede renovar todas las ventanas. Ver §18.

## 12. Modificadores de stat

Representación elegida: **el stage honesto −6…+6 por dentro, el multiplicador clamado por fuera**.

- `+1 → ×1.5`, `+2 → ×2` (techo), `−2 → ×0.5` (piso).
- Así un movimiento que dice +2 sigue diciendo +2 y el dato del catálogo no miente; lo simplificado es el efecto, que es lo que aprobó el producto.
- Runtime, se resetea en el cambio, determinista.

**Hoy ningún movimiento del catálogo los puede mover**, y es una brecha de datos, no de trabajo: ver §14.

## 13. Estados

**Uno mayor por vez**, persistido por la Condition. Un segundo se **rechaza** con `STATUS_FAILED: alreadyHasMajorStatus`.

| | Regla PokeSwap | Marca |
|---|---|---|
| Veneno | `1/16 del HP máximo cada 3 s`, en **su propio reloj** (un Pokémon rápido no se envenena más por actuar más) | PLAYTEST |
| Quemadura | Ataque ×0.5. **Sin daño residual** | APPROVED |
| Congelación | Ataque Especial ×0.5. **No inmoviliza**: un stun en un juego sin turnos no es lo aprobado | APPROVED |
| Parálisis | Cooldown ×2. Sin recorte de Velocidad y sin fallo aleatorio | APPROVED / PLAYTEST |
| Sueño | Pierde Action Windows: la barra **no avanza**, durante `sleepMs` (6 s) | PLAYTEST |
| Envenenamiento grave | Tiquea como veneno; **ningún movimiento lo aplica** en R32.3 (el catálogo no lo produce). La escalada queda diferida | — |

Un estado mayor también responde a la tabla de tipos: Onda Trueno no paraliza a un tipo Tierra.

**Confusión** (§26): volátil, convive con un estado mayor, **runtime puro**, 8 s, 33 % de que la ventana se gaste en un autogolpe de 40 de potencia sin tipo. No sobrevive a `leaveBattle`.

## 14. Registry de efectos, y la brecha del catálogo

No hay ni un `if (moveId === …)`. El comportamiento se resuelve por el **`effectId`** de R32.1 más su `meta`. Agregar un movimiento al catálogo lo agrega al juego; no agrega una rama acá.

Efectos ejecutables: `damage`, `damage.multiHit`, `damage.drain`, `damage.recoil`, `damage.recharge`, `damage.ailment`, `ailment`, `heal`, `protect`.

- **Multigolpe:** 2–5 con la distribución real (3/8, 3/8, 1/8, 1/8); un evento `DAMAGE` por golpe, con su número de golpe.
- **Retroceso:** después del daño, porcentaje del daño hecho, y **puede debilitar al atacante** (hay test).
- **Drenaje:** cura en función del daño hecho, clamado al HP máximo.
- **Recarga:** próximo cooldown ×2.

### Cobertura — el número honesto

| | |
|---|---|
| Movimientos en el catálogo | **621** |
| Ejecutables por R32.3 | **282** |
| Diferidos | **339** |

R32.1 había pronosticado 415 soportados. Las dos listas **difieren en los dos sentidos**: retroceso y recarga estaban pronosticados como huecos y acá están implementados, y en cambio apareció una brecha que el pronóstico no conocía.

| Movimientos | Motivo |
|---:|---|
| **118** | **`stat change payload missing from catalog`** |
| 78 | `effect unique` (Rest, Substitute, Transform…) |
| 31 | `variable power` (Seismic Toss, Low Kick, Return, Gyro Ball) |
| 22 | `flinch has no realtime meaning yet` |
| 16 | `target entire-field` |
| 14 | `charge turn` (Fly, Dig, Solar Beam) |
| 11 | `target users-field` (pantallas) |
| 8 | `ailment trap` |
| 4+4+4 | `effect ohko`, `target opponents-field`, `target specific-move` |
| 3+3+3+3 | `ailment no-type-immunity`, `target all-pokemon`, `target ally`, `target user-and-allies` |
| 2+2 | `effect forceSwitch`, `effect damage.selfKo` |
| 11 | volátiles sueltos (leech-seed, nightmare, yawn, torment, ingrain, embargo, heal-block, infatuation, unknown…) y 3 casos de objetivo raro |

**La brecha más grande es un dato que falta, no trabajo pendiente.** El catálogo generado no incluye `move_meta_stat_changes`, así que un movimiento `statChange` dice **que** cambia stats y nunca **cuál** ni **cuánto**: Danza Espada y Gruñido son indistinguibles desde acá. La maquinaria de stages existe y está testeada (§12), pero ningún movimiento del catálogo la puede manejar hasta que R32.1 emita esa tabla — y eso es un `catalogVersion` nuevo, así que **no es de R32.3**. Es la pregunta abierta número uno.

**Un movimiento diferido se rechaza con su motivo, nunca se corre como un golpe común.** Y se rechaza en el momento de seleccionarlo, no tres segundos después.

### Diferido a propósito

Clima, terreno, pantallas, cambio forzado, OHKO, turnos de carga, autodestrucción, efectos de campo únicos y los volátiles complejos. `damage.flinch` también: "perdés el turno" no tiene equivalente sin turnos, y resetear la barra del rival sería una decisión de producto que nadie tomó.

## 15. Cambio

- Consume una Action Window.
- El que sale **conserva su Condition** (HP, PP, estado mayor) y **pierde todo su runtime**: stages, confusión, Protect, barra, multiplicadores.
- El que entra **conserva su propia Condition** y arranca la barra en **0**.
- Un debilitado no puede entrar; el reemplazo de un debilitado es inmediato.

## 16. Debilitado y fin de la batalla

`fainted = currentHp === 0`. **No hay flag duplicado** (R32.2.1). Un debilitado no actúa, no entra como activo y su barra queda en cero.

Un bando pierde cuando **todos** —banca incluida— están debilitados. **Ninguna regla manda un reemplazo**: un bando con el activo debilitado y banca sana sigue en la batalla, y poner a alguien en el campo es un comando, no una regla. `BATTLE_ENDED` lleva `winningSideId` y el motivo (`faint` o `capture`).

## 17. Objetos y captura — contratos puros

**Objetos (§29):** R32.3 sabe **qué le hace un objeto a un Pokémon** y nada de inventarios, stacks, precios ni economía.

```ts
ItemEffect = healHp | restorePp | revive
```

Consume una Action Window, sólo sobre el propio bando, y emite `ITEM_USED` con si sirvió o no.

**Captura (§30):** R32.3 contesta **si la ball funcionó** y nada más. No hay propiedad, no se crea ninguna instancia y no se persiste nada: eso es I-1 y es del servidor.

```
chance = scale · (catchRate / 255) · hpFactor · statusBonus · ballBonus     PLAYTEST
```

`hpFactor` va de 1/3 con vida llena a 1 casi debilitado. Una captura exitosa termina la batalla con `outcome: captured` y emite `CAPTURE_SUCCESS`; **el `ownerId` de la instancia sigue intacto**, y hay un test que lo afirma.

## 18. Habilidades y objetos equipados

No se implementan las 191 habilidades y no se implementa ningún objeto equipado. La instancia ya lleva `abilityId` y el motor lo respeta como dato; los puntos donde una habilidad engancharía —stat efectiva, cooldown, acierto, crítico, STAB, secundarios— están todos en funciones chicas y aisladas. No se agregó ningún fixture de habilidad: habría sido código sin consumidor.

Clima, terreno y objetos equipados: fuera de alcance, sin arquitectura especulativa.

## 19. Objetivo

Baseline (§38): ofensivo → **un** enemigo; propio → uno mismo. Sin AoE, sin curar al aliado, sin fuego amigo (hay test sobre una batalla completa). Los movimientos que en ORAS son spread (`all-opponents`, `all-other-pokemon`) se resuelven a **objetivo único** en v1, con el dato del catálogo intacto.

## 20. Borde de persistencia

```
createBattleState(instances)  →  BattleState
finishBattle(state)           →  Record<combatantId, PokemonInstance>
```

La salida pasa **siempre** por el `leaveBattle` del modelo (R32.2.1), que ni siquiera recibe el runtime. Entrar no cura nada: el que salió quemado, a media vida y sin PP de Rayo, entra quemado, a media vida y sin PP de Rayo. Esa es la attrition de la Dungeon y la razón de que la Condition sobreviva.

**R32.3 no escribe en ningún lado.** `finishBattle` devuelve instancias nuevas; guardarlas es del llamador, y en producción va a ser del servidor.

## 21. Determinismo e invariantes

`npx vitest run src/features/battle/rules` — **72 tests** en 3 archivos.

| Archivo | Qué cubre |
|---|---|
| `rules.core.test.ts` (26) | RNG (pureza, no-mutación, una tirada por certeza, rangos), tabla de tipos con los cuatro fixtures y todos los multiplicadores, Gen VI (Acero perdió sus resistencias, Hada existe), Action Bar (fórmula exacta, monotonía, prioridad/recarga/parálisis), stages, daño (banda 85–100, inmunidad, mínimo 1, STAB, Struggle sin tipeo, tabla de críticos, acierto nulo), distribución 2–5 golpes, registry por `effectId`, cobertura 282/621, contrato de captura |
| `rules.engine.test.ts` (38) | Comandos como intención, rechazo sin mutar (`===`), versión de catálogo y de reglas, PP y auto-repeat, Struggle (recoil de 1/4, le pega a un Fantasma), prioridad y recarga medidas sobre los eventos, Protect (2 cargas, multigolpe = 1 carga, expiración), multigolpe/retroceso/drenaje, estados (uno solo, tabla de tipos, veneno a 3/6/9 s, sueño que come ventanas, quemadura y congelación), confusión, cambio, debilitado, objetos, captura, objetivo, salida por `leaveBattle` |
| `rules.determinism.test.ts` (8) | **Replay determinista** ×5 sobre estado **y** eventos; la semilla importa; independencia de la granularidad del reloj (1, 17, 250, 1000, 10000 ms); ida y vuelta por JSON a mitad de batalla; `Math.random` y `Date.now` reemplazados por funciones que tiran error; invariantes en batallas largas; un comando rechazado no deja rastro |

Invariantes verificadas sobre batallas de hasta 200 pasos: `0 ≤ HP ≤ maxHp` y entero, `fainted ⟺ HP = 0`, `0 ≤ PP ≤ maxPP` y sólo de movimientos que el Pokémon conoce, un solo estado mayor (y `confusion` nunca es uno), `seq` estrictamente creciente, `timeMs` monótono, contadores de runtime no negativos.

No se agregó ninguna dependencia: no hay librería de property testing y no hacía falta traer una.

## 22. Muestra

```bash
npm run battle:sample              # las dos peleas y los fixtures de reglas
npm run battle:sample -- --coverage   # sólo el informe de cobertura
```

Imprime `Pikachu vs Gengar` y `Charizard vs Azumarill` completas —stats derivadas, cooldowns, clasificación de cada movimiento, selección, daño, tipo, PP, estado, eventos y resultado— y después los fixtures de Protect, Struggle, replay determinista y granularidad del reloj. Las fixtures son **las mismas** que asserta la suite (`sampleBattles.ts`), así que lo que lee una persona y lo que verifica CI son la misma batalla. No escribe nada y no toca la red.

## 23. Comparación con el prototipo de Dungeon (§45)

Auditado: `src/features/dungeonPrototype/domain/{battle,damage,moves,typeChart,capture,rng,party}.ts` y sus tests.

| Pieza del prototipo | Clase | Qué pasó |
|---|---|---|
| `rng.ts` | **Adaptada** | Misma idea (inyectada, por semilla, streams por concern). R32.3 necesita que el estado del RNG sea **dato adentro del BattleState**, así que mulberry32 con estado escondido pasó a ser `{ seed, cursor }` |
| `damage.ts` — fórmula | **Adaptada** | La cadena Gen VI se conserva; el orden de redondeos quedó explícito y las stats ahora salen del modelo R32.2 (IV/EV/naturaleza) en vez de un escalado por nivel |
| `damage.ts` — Action Bar | **Reusada** (forma) | Misma fórmula y mismos multiplicadores. Los números son los del contrato R32.3 (2.6/1.4/4.0), no los de D1.2.4 (3.9/2.1/6.0), y se trabaja en ms |
| `damage.ts` — clamp de stages ×2/×0.5 | **Reusada** | Decisión de producto aprobada, tal cual |
| `damage.ts` — constantes `STATUS` | **Reusadas** como config | Veneno 1/16 cada 3 s, sueño 6 s, confusión 8 s / 33 % / 40 de potencia |
| `typeChart.ts` | **Descartada** | Era una tabla escrita a mano marcada PROTOTYPE. La reemplaza la generada de R32.1 |
| `moves.ts` (12 movimientos a mano) | **Descartada** | La reemplazan los 621 del catálogo más el registry por `effectId` |
| `capture.ts` | **Adaptada** | La forma de la fórmula se conserva (PLAYTEST); las entradas son explícitas y ya no hay un `PokemonInstance` del prototipo |
| `battle.ts` | **Adaptada en espíritu, descartada como código** | Las reglas aprobadas que codifica —auto-repeat, cambio, Protect, reloj propio del veneno, sin pausa— están todas. Lo que no sobrevive es la forma: muta las instancias que recibe y loguea strings en español |
| `party.ts` | **Descartada** | La reemplaza el modelo R32.2 |
| `data/speciesFixtures.ts`, `runFixtures.ts` | **Descartadas** | Ya estaban marcadas en `R32_INTEGRATION_AUDIT` §12 |
| `alpha.ts`, `bossFight.ts`, `bossSkills.ts`, `bossRoom.ts` | **No migradas** | Fuera de alcance: no se implementan bosses |
| `expedition.ts`, `coop.ts`, `occupancy.ts`, `rewards.ts` | **No migradas** | R35 |
| `components/*` (BattleHud, CombatPopup, BattleField…) | **Descartadas** para las reglas | Son UI |
| `battle.test.ts`, `ballAndSwitch.test.ts` | **Adaptadas** | Su intención reaparece en `rules.engine.test.ts`, sobre el motor nuevo |

**Dirección de dependencia, verificada:** nada en `src/features/battle/rules` importa `dungeonPrototype`, y el prototipo tampoco importa las reglas nuevas. `Dungeon → Shared Battle Rules`, nunca al revés. El prototipo **sigue funcionando exactamente igual**: R32.3 no lo tocó, no lo integró y no cambió un solo byte de su bundle.

## 24. Qué es responsabilidad de R32.4

R32.3 deja el motor; R32.4 decide **quién tiene la palabra final**. Concretamente:

1. **Dueño de la semilla.** Hoy la elige quien crea la batalla. Tiene que elegirla el servidor y no revelarla antes de tiempo.
2. **Autoridad del reloj.** `ADVANCE_TIME` lo manda el llamador. El servidor tiene que ser el que avanza, y el cliente predecir.
3. **`actionId` e idempotencia.** Los comandos no tienen identidad: reenviar un `USE_ITEM` hoy lo vuelve a cobrar. Eso es de R32.4.
4. **Validación de autoría.** `controllerId` existe en el estado y **nadie lo lee**: ninguna regla comprueba que quien manda un comando pueda mandarlo. Es a propósito — es una pregunta de autoridad, no de reglas.
5. **Reconciliación.** Qué hace un cliente cuando su predicción y el estado del servidor difieren.
6. **El borde de persistencia.** `finishBattle` devuelve instancias; escribirlas, y decidir qué pasa con una captura (I-1), es del servidor.
7. **Transporte y versiones.** Rechazar por `catalogVersion`/`battleRulesVersion` ya está implementado como regla; falta el handshake.

## 25. Lo que NO entró (y no tiene que aparecer buscándolo)

Autoridad de servidor · Colyseus · red · Supabase · persistencia · integración con la Dungeon · co-op · Alpha · Boss Skills · UI · economía · las 191 habilidades · el resto de los movimientos diferidos · clima · terreno · objetos equipados · Mega como gameplay · pase de balance · migración legacy · City Mapping Lab.

## 26. Preguntas realmente abiertas

1. **`move_meta_stat_changes` en el catálogo.** Es el bloqueo más grande y concreto: 118 movimientos —incluidos Danza Espada, Gruñido, Psíquico, Bola Sombra— no se pueden ejecutar porque el catálogo no dice qué stat tocan ni cuánto. Agregarlo es trabajo de R32.1 y produce un `catalogVersion` nuevo. ¿Se aprueba abrir esa sub-tarea?
2. **Protect: ¿"al agotarse" o "al lanzar"?** El contrato de R32.3 dice al agotarse y eso está implementado; el prototipo lo cobra al lanzar. Son dos sensaciones distintas.
3. **Protect en cadena.** Con auto-repeat el escudo se renueva cada ventana sin más costo que la ventana. Los juegos bajan la probabilidad en usos consecutivos. ¿Se agrega esa penalización?
4. **Struggle sin movimientos ejecutables.** Hoy un Pokémon con PP pero sin ningún movimiento que R32.3 pueda correr llega a Struggle. Es explícito y evita el cuelgue, pero no es la regla de los juegos.
5. **`damage.flinch` (22 movimientos).** ¿La lectura realtime de flinch es "se le resetea la barra al objetivo", o queda diferido?
6. **Envenenamiento grave.** Tiquea como veneno y ningún movimiento lo aplica. ¿Escalada al estilo Gen VI, o se queda plano?
7. **Números de playtest.** Nada de `config.ts` marcado `PLAYTEST` está balanceado: cooldowns, veneno, sueño, confusión, captura. Eso es R38.
8. **IA.** El motor no tiene ninguna, a propósito: un salvaje sin comandos usa la cadena de respaldo. Quién decide qué hace un Pokémon salvaje es una pregunta abierta de producto (y en R32.4, de autoridad).

## 27. Verificación

| Comando | Resultado |
|---|---|
| `npx vitest run src/features/battle/rules` | 3 archivos, **72 tests**, verde |
| `npm test` | **117 archivos, 1386 tests**, verde (1314 antes + 72) |
| `npm run typecheck` | limpio |
| `npm run lint` | `npx eslint src/features/battle scripts/battle-sample.ts` → 0 errores, 0 warnings |
| `npm run build` | OK |
| `npm run battle:sample` | corre las dos peleas y los fixtures |

> **PREEXISTENTE, no es de R32.3:** `npm run lint` sobre el repo entero reporta 14 errores y 19 warnings. Los 14 errores salen de `.worktrees/demo-scope/`, un worktree sin trackear de otra rama que quedó adentro del repo y que ESLint ahora escanea; los 19 warnings son los de `AuthModal.vue` de siempre. Nada de eso es código de esta entrega y no se tocó.

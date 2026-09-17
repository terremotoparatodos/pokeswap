# WildLands Dungeon / PvE — Diseño y prototipo (D0)

> Rama: `feat/d0-dungeon-pve-prototype`. Base: `origin/integration/r31 @ 8b0f1d218042c441dbdaa6632c06e17e3185a4e2`.
> Namespace: `src/features/dungeonPrototype/`. Ruta dev: **`/dev/dungeon`**.
> **Clean slate.** No se rescató, migró ni importó nada de `src/features/dungeon/` (A-13). Un test lo verifica.
> **Sin servidor, sin Supabase, sin networking, sin persistencia.** Todo es local y dev-only.
> Datos Pokémon: [`BATTLE_DATA_GAP_REPORT.md`](BATTLE_DATA_GAP_REPORT.md).

Este documento separa explícitamente tres cosas, y no las mezcla:

- **APPROVED** — reglas que me dieron. No las cambié.
- **PROTOTYPE ASSUMPTION** — decisiones reversibles que tomé para poder construir. Ninguna es un requerimiento.
- **OPEN** — lo que todavía necesita aprobación.

---

## 1. Arquitectura

```text
src/features/dungeonPrototype/
├── domain/          lógica pura: sin Vue, sin DOM, sin motor, sin red
│   ├── rng.ts           RNG sembrado + streams derivados por concepto
│   ├── tiers.ts         tiers, longitud, presupuesto de dificultad por piso
│   ├── floorPlan.ts     generación de pisos (salas, enlaces, encuentros, cofres, salida)
│   ├── floorKey.ts      llave de piso + protección contra mala suerte
│   ├── party.ts         PokemonSpecies / PokemonInstance, HP, PP, faint, estados
│   ├── expedition.ts    la instancia: inventario previo vs botín, retirada, wipe
│   ├── typeChart.ts     efectividad de tipos
│   ├── moves.ts         familias de movimientos + traducción a realtime
│   ├── damage.ts        daño, precisión, críticos, stages, Action Bar / Speed
│   ├── battle.ts        motor realtime (barras, ítems, cambios, faint, captura)
│   ├── capture.ts       fórmula de captura
│   ├── occupancy.ts     reserva de encuentros (contrato para el servidor)
│   ├── alpha.ts         Alpha modifier, fases, escalado co-op
│   └── rewards.ts       participación, botín personal, depósito por inventario lleno
├── data/            fixtures dev (14 especies, party de 6, ítems, loot)
└── components/      los labs de /dev/dungeon
```

Reglas que me impuse, en línea con `AGENTS.md`: el dominio no importa Vue ni el motor de WildLands; los componentes no calculan reglas; ningún archivo pasa de ~330 líneas; y **el prototipo no importa nada de otra feature de producto** — ni siquiera las base stats que ya existen en `professions/`, para no crear una dependencia cruzada por conveniencia. Dos tests lo vigilan.

## 2. Ruta dev y aislamiento

`/dev/dungeon` se registra con el mismo patrón que `/dev/profesiones`:

```ts
const dungeonPrototype: LazyView | null = import.meta.env.DEV ? () => import('…/DungeonPrototypeView.vue') : null
```

En un build de producción la constante es `null`, la ruta no se registra y el chunk no es alcanzable. Verificado con `grep` sobre `dist/` (§13).

## 3. Concepto: la expedición

**APPROVED.** No hay menú de "comenzar run": las entradas existen físicamente en WildLands (cueva, ruina, torre, bosque, mina, volcán, caverna helada). El jugador entra y pasa a estar dentro de una **expedition instance** que le pertenece a él o a su grupo.

En el prototipo eso es un `ExpeditionState` con `expeditionId`, `seed`, piso actual y su propio estado. **PROTOTYPE ASSUMPTION:** las temáticas son nombres de relleno hasta que existan entradas reales en el mundo.

## 4. Tiers y longitud

**APPROVED:** cinco tiers, 5–30 pisos, y antes de entrar se conocen nombre, tier y cantidad de pisos.

**PROTOTYPE ASSUMPTION** (`domain/tiers.ts`, todo configurable):

| Tier | Pisos | Presupuesto piso 1 | Ganancia por profundidad | Nivel base | Rango de nivel |
|---|---|---|---|---|---|
| D | 5–7 | 10 | ×1.6 | 5 | +6 |
| C | 8–12 | 18 | ×1.9 | 14 | +10 |
| B | 13–18 | 30 | ×2.2 | 26 | +14 |
| A | 19–24 | 46 | ×2.5 | 42 | +18 |
| S | 25–30 | 66 | ×2.9 | 60 | +22 |

`FLOOR_LIMITS = { min: 5, max: 30 }` recorta cualquier configuración: una config mal puesta no puede producir una dungeon de 40 pisos. La longitud concreta sale del seed.

## 5. Generación de pisos

**APPROVED:** procedural pero condicionada por seed, tier, número de piso y temática; gradual; determinista.

**Cómo funciona** (`domain/floorPlan.ts`):

1. `floorDifficulty(seed, tier, floor, floors)` da un **presupuesto** en puntos. La curva es `base × (1 + (ganancia−1) · smoothstep(profundidad))`, con una oscilación sembrada de ±8 % por piso y un ×1.35 en el piso del Alpha. Arranque suave, medio empinado, final suave.
2. El presupuesto decide el tamaño de la grilla y cuántas salas hay.
3. Un **espinazo** camina de izquierda a derecha por la grilla (a veces baja o sube) y conecta entrada con salida; las salas extra cuelgan de una sala ya conectada, así que el piso **siempre es recorrible**.
4. Los encuentros se **compran** con el presupuesto: cada uno cuesta según su nivel, y se dejan de colocar al llegar al tope. Por eso un piso profundo tiene más y más caros, no "más random".
5. Cofres: uno garantizado y otro probable según la profundidad, con rareza que también sube con ella.
6. Sala especial (santuario/puzzle/descanso) con probabilidad creciente por profundidad: es un hook, no un sistema.
7. La salida está cerrada salvo en el último piso, que en su lugar tiene al Alpha.

**Gradualidad, no monotonía:** Tier B piso 16 tiene claramente más presupuesto y nivel que el piso 2, pero no se exige que cada piso supere al anterior. Un test compara la media de la primera mitad contra la segunda.

**Determinismo:** cada concepto (layout, encuentros, cofres, llaves, captura, loot) saca de su propio stream derivado del seed. Tirar una captura no corre los números que habría sacado el loot.

## 6. Llaves de piso

**APPROVED:** los Pokémon de dentro pueden soltar una `Floor Key`; abre la salida al piso siguiente; pertenece a la expedición; no sale de la Dungeon; se pierde al retirarse y al wipear; la próxima expedición empieza en piso 1.

**PROTOTYPE ASSUMPTION — opción elegida: probabilidad creciente con garantía dura.**

```
chance = min(1, 0.35 + 0.20 × derrotas_sin_llave)
garantizada a la 4ª derrota sin llave
```

Con eso la llave llega en ~2 derrotas de media y **nunca** tarda más de 4. El RNG puede hacer un piso más lento; no puede bloquearlo.

**Alternativas que descarté y quedan vivas para discusión:**
- *un Pokémon marcado del piso lleva la llave* — muy legible, pero convierte el piso en una búsqueda en vez de una pelea;
- *la primera derrota siempre suelta la llave* — elimina la tensión por completo;
- *llave por sala limpiada* — ata la llave al layout, no al combate.

## 7. Party

**APPROVED (A-1):** hasta 6 Pokémon activos, los mismos para exploración, combate y profesiones.

`MAX_PARTY = 6` y `buildParty` corta ahí. El motor **nunca** asume banca infinita: cuando cae el activo busca el siguiente sano, y si no hay, es wipe. Sin persistencia real del party (fuera de alcance; O-1).

## 8. Combate realtime

**APPROVED:** ocurre dentro del mundo, sin pantalla aparte; 1 activo contra 1 en combate normal; cuatro movimientos; Action Bar por combatiente; se puede cambiar el movimiento preparado mientras carga; al llenarse se ejecuta lo que esté elegido.

Visualmente (`components/BattleField.vue`): ambos están de pie en el mismo suelo, con su HP y su barra debajo. Arte placeholder a propósito (§37).

### 8.1 Speed → Action Bar (PROTOTYPE ASSUMPTION)

```
rate  = 1 + velocidadEfectiva / 120
fill  = clamp(3.2 / rate, 1.2 s, 5 s)
```

Lineal en Speed (fácil de razonar y de balancear), nunca llega a cero, y **el clamp es lo que acota el juego**: un Pokémon de 130 de velocidad llena en ~1.5 s y uno de 15 en ~2.8 s — una relación de ~1.8×, suficiente para notar la diferencia sin que el rápido actúe tres veces por acción del lento.

La velocidad efectiva pasa por stages y estados, así que **Onda Trueno vale una acción entera**: parálisis la reduce a la mitad y la barra se arrastra.

**Alternativas:** curva con raíz cuadrada (comprime los extremos) o tabla de "ticks por segundo" por banda de velocidad (muy predecible, menos granular).

### 8.2 Traducción de movimientos a realtime (PROTOTYPE ASSUMPTION)

El problema real no son los cientos de movimientos: es que el sistema es por turnos. Lo que propongo:

| Concepto turn-based | En realtime |
|---|---|
| **Prioridad** | La barra ya reemplaza el orden de turno. La prioridad pasa a ser **liberación anticipada**: prioridad 1 dispara al 85 % de la barra. Ataque Rápido conserva su identidad (llega antes) sin cola de turnos |
| **Recarga** (Rayo Carga) | Pierde la **ventana siguiente**: el coste es tiempo, no PP |
| **Protección** | Ventana de invulnerabilidad corta (1.6 s) con rendimientos decrecientes al encadenarla |
| **Parálisis** | Velocidad ×0.5 (barra más lenta) + 25 % de que la acción se malogre |
| **Quemadura / veneno** | Daño residual de 1/16 del máximo cada 4 s; la quemadura además parte el ataque físico |
| **Sueño** | La barra se **congela** mientras dura |
| Potencia, precisión, categoría, PP, STAB, tipos, críticos, stages, secundarios | Sin cambios |

Nueve movimientos reales cubren las familias: Placaje (físico), Lanzallamas (especial + estado), Onda Trueno (estado puro), Ataque Rápido (prioridad), Protección (protect-like), Danza Espada (buff), Gruñido (debuff), Golpe Cuerpo (daño + estado frecuente), Rayo Carga (recarga). **El roster es de juguete; el schema es lo que hay que revisar.**

### 8.3 Ítems: el combate no se pausa

**APPROVED, y es la regla que más condiciona el motor:** abrir la mochila no pausa, no ralentiza, no congela IA ni barras.

Está garantizado por construcción: `tick(battle, dt)` es el único reloj y **no recibe ningún flag de pausa**. La mochila es un panel de UI del que el motor no se entera. Un test lo comprueba.

**APPROVED:** usar un objeto consume una Action Window — cuando toca ejecutar la acción preparada, se usa el objeto en lugar de atacar. Prototipados: Poción, Revivir, Éter, Poké Ball.

### 8.4 Cambio de Pokémon (PROTOTYPE ASSUMPTION)

Cambiar **consume una Action Window**, igual que un ítem, y el entrante pierde los stat stages del saliente (como en los juegos). Es la opción más simple que evita el switching instantáneo explotable.

**Alternativas:** una ventana más corta que la de atacar; o una penalización de barra al entrante (entra con la barra al 50 %). Sin cerrar.

## 9. Estado persistente y desgaste

**APPROVED:** dentro de la expedición persisten HP, PP, faint, estados, consumibles gastados y loot. **No hay curación gratis entre pisos.**

HP y PP viven en el `PokemonInstance` y el motor los muta: cruzan la puerta cerrada intactos. La expedición **copia** el party que recibe, así que reiniciar una corrida en el lab no reutiliza un party ya desgastado.

## 10. Retirada, wipe y botín

**APPROVED, tal cual:**

| | Retirada | Wipe |
|---|---|---|
| Botín de expedición | se conserva | **se pierde** |
| Capturas hechas dentro | se conservan | **se pierden** |
| Inventario previo | intacto | intacto |
| Consumibles gastados | siguen gastados | siguen gastados |
| Floor Key | desaparece | desaparece |
| Próxima entrada | piso 1 | piso 1 |
| Resultado | `EXTRACTED` | `RETURN_TO_NEAREST_POKEMON_CENTER` |

Sin checkpoints. El Centro Pokémon no se conecta: se simula el outcome.

**La separación es explícita en los tipos:** `carriedInventory` (lo que ya era del jugador) y `expeditionLoot` + `expeditionCaptures` (lo que está en riesgo). No es una convención: son campos distintos y solo `retreat()` los une.

## 11. Captura

**APPROVED:** hay captura dentro y fuera; la Poké Ball básica tiene probabilidad muy baja; mejores Balls llegarán por crafting; una captura hecha dentro es botín de expedición.

**PROTOTYPE ASSUMPTION** (`domain/capture.ts`):

```
chance = clamp(0.5 × (catchRate/255) × (3 − 2·hpRestante)/3 × bonusEstado × bonusBall, 1 %, 75 %)
```

Un Larvitar sano con Ball básica ronda el **3 %**; dormido y casi debilitado, ~20 %. La forma es la de los juegos para que la intuición del jugador funcione.

**El caso que queríamos sentir:** capturás un Larvitar en el piso 18. Retirarte lo asegura; seguir puede darte más, pero un wipe se lo lleva. Está prototipado end-to-end y cubierto por tests.

## 12. Ocupación de encuentros

**APPROVED:** un Pokémon salvaje no puede estar en combate con dos jugadores; los demás lo ven **OCUPADO**; la decisión final es del servidor.

`domain/occupancy.ts` es **el contrato, no su implementación**:

```text
AVAILABLE → RESERVED(holder, expira) → IN_COMBAT → DEFEATED | DESPAWNED
```

Invariante: para un encuentro hay **como máximo un holder**, y un claim que llega con holder vigente se **rechaza** — nunca se encola, nunca se fusiona, nunca se promueve solo. La reserva expira (**PROTOTYPE ASSUMPTION: 8 s**) para que un jugador que se va no bloquee el encuentro para siempre. Tests cubren dos claims simultáneos, el que no es holder intentando empezar, la expiración y el "ocupado" que ven los demás.

## 13. Alpha Boss

**APPROVED:** el último piso tiene un Alpha; es un Pokémon del pool de esa dungeon, no una especie especial; ~2× de tamaño, aura roja, peligro legible; ~4× de poder efectivo, **sin** multiplicar todo por 4 y **sin** multiplicar la velocidad.

**PROTOTYPE ASSUMPTION** (`domain/alpha.ts`):

| Factor | Valor | Por qué |
|---|---|---|
| HP | ×2.5 (×0.9…×1.2 según tier) | El grueso de la dificultad es aguante: la pelea dura |
| Daño infligido | ×1.35 | Peligroso sin ser un one-shot |
| Defensas | ×1.15 | Pega un poco más lento derribarlo |
| **Velocidad** | **×1.05** | Deliberadamente casi nada: multiplicarla rompería la barra |
| Resistencia a estados | 50 % | Evita "lo paralizo y gano" |
| Tamaño visual | ×2 | Legibilidad |

**Poder efectivo = HP × daño × defensas ≈ 3.9–4.1×**, que es el objetivo. Hay una función `effectivePowerMultiple()` y un test que exige que quede entre 3.2 y 5 en los cinco tiers.

**Fases:** al 66 % y al 33 % de HP gana +15 % y +30 % de daño. Legible y premia la presión.

## 14. Boss solo y cooperativo

**APPROVED:** solo → 2 Pokémon activos, cada uno con su HP, su barra, sus cuatro movimientos y su acción preparada. Hasta 4 jugadores conceptualmente; 1 jugador → 2 activos, 2–4 → 1 cada uno; máximo 4 aliados.

Implementado y jugable en el Alpha Lab. Los jugadores extra son **slots locales**, no conexiones.

**Escalado (PROTOTYPE ASSUMPTION):** dos perillas separadas a propósito.

```
HP del boss     ×(1 + 0.55 × (jugadores − 1))     → 2j 1.55 · 4j 2.65
Daño del boss   ×(1 + 0.12 × (jugadores − 1))     → 2j 1.12 · 4j 1.36
```

Sumar gente **ayuda** (el aguante por jugador baja), **no trivializa** (el boss sí crece) y **no produce un boss absurdo** (nadie enfrenta 4× daño). Tests cubren las tres propiedades.

## 15. Botín del boss

**APPROVED:** loot raro; en co-op **PERSONAL LOOT**, sin competencia por el objeto único; inventario lleno **no destruye** la recompensa.

- Cada jugador elegible tira de su **propio stream** (`seed + expeditionId + playerId`): ni comparten resultado ni se influyen, y una repetición de la expedición reproduce ambas tiradas.
- Lo que no entra queda en **depósito** (`PendingReward`) con tres respuestas: conservar (sigue en depósito), descartar otra cosa (se entrega y la UI pregunta qué tirar) o descartar la recompensa. **Solo una elección explícita la destruye.**

**Participación (PROTOTYPE ASSUMPTION):** elegible quien esté presente al matar **y** haya hecho ≥5 % del daño **o** ≥3 acciones con ≥10 s activo. Es deliberadamente generosa porque **el support todavía no existe**: cuando existan curación y apoyo, `actions` y `activeSeconds` son donde enchufan.

## 16. Drops y economía

Las dungeons producen materiales (`cave_shard`, `damp_moss`, `iron_chunk`, `alpha_dust`, `alpha_core`, `alpha_crown`) que **son el hook** para crafting, Alquimia y Construcción. No hay precios, recetas ni decisiones de faucet: eso es A-12 y O-13. La tienda NPC no se implementó; solo se asume que una expedición puede empezar con un loadout básico.

---

# CLIENT INTENT vs SERVER AUTHORITY

Lo que el servidor **deberá** poseer. El prototipo es, en todos los casos, la intención del cliente.

| Decisión | Quién manda | Nota para la estación principal |
|---|---|---|
| Crear la expedición y su `expeditionId` | **Servidor** | Uno por jugador/grupo; el cliente no lo elige |
| **Seed** de la dungeon | **Servidor** | Si el cliente la elige, elige su loot |
| Generación y validación del piso | **Servidor** | El cliente puede regenerar para dibujar, pero el servidor valida que el piso es el del seed |
| Spawn de Pokémon | **Servidor** | Especie, nivel y posición |
| **Reserva de encuentro** | **Servidor** | Contrato en §12. Es una carrera real entre jugadores |
| Inicio de combate | **Servidor** | Solo el holder |
| Acciones y timing | **Mixto** | El cliente manda intención con timestamp; el servidor valida contra la barra que él simula. La barra es autoridad del servidor, no del cliente |
| Daño, PP, estados | **Servidor** | El cliente predice para animar |
| Uso de ítems | **Servidor** | Consume inventario real |
| **Captura** | **Servidor** | Crea un `PokemonInstance`: ownership |
| Todo el RNG con valor persistente | **Servidor** | Llaves, drops, captura, loot del boss |
| Floor Key y avance de piso | **Servidor** | La llave es estado de la expedición |
| Escalado y fases del boss | **Servidor** | Depende de cuántos jugadores hay de verdad |
| Elegibilidad y botín personal | **Servidor** | §15 |
| Wipe y retirada | **Servidor** | Deciden qué se pierde: es economía |
| Depósito de recompensa pendiente | **Servidor** | Debe sobrevivir a una desconexión |

Presentación (animaciones, partículas, cámara, el aura del Alpha) es del cliente y solo del cliente.

---

# PROTOTYPE ASSUMPTIONS (lista completa)

1. Rangos de pisos por tier y todos los números de `TIER_CONFIG`.
2. Curva de dificultad: smoothstep, oscilación ±8 %, ×1.35 en el piso del Alpha.
3. Forma del piso: grilla 3–6 × 3–5, espinazo, salas colgadas, coste de encuentro = nivel × 0.4.
4. Cofres: 1 garantizado + 1 probable; rareza por profundidad.
5. Llave: 0.35 base, +0.20 por derrota, garantía a la 4ª.
6. Action Bar: `clamp(3.2 / (1 + vel/120), 1.2, 5)`.
7. Prioridad = liberación anticipada del 15 % por punto.
8. Recarga = pierde la ventana siguiente. Protección = 1.6 s con rendimientos decrecientes.
9. Residual 1/16 cada 4 s; parálisis 25 % de fallo y velocidad ×0.5.
10. Cambiar Pokémon consume una Action Window y limpia los stages.
11. Captura: `0.5 × catchRate/255 × hpFactor × estado × ball`, con piso 1 % y techo 75 %.
12. Reserva de encuentro: expira a los 8 s.
13. Alpha: HP ×2.5, daño ×1.35, defensas ×1.15, velocidad ×1.05, estados 50 %, tamaño ×2, fases a 66 %/33 %.
14. Co-op: HP +55 % y daño +12 % por jugador extra; 1 jugador → 2 activos.
15. Participación: presente al matar + (≥5 % daño o ≥3 acciones y ≥10 s).
16. Tabla de tipos Gen 6+, IV 31 sin EV ni naturaleza, 9 movimientos, 14 especies, loot de fixture.
17. Temáticas de dungeon y sus pools de especies.
18. Inventario de 20 espacios y loadout inicial.

# OPEN

1. **Ruleset/generación Pokémon de referencia** y si el catálogo se queda en 493 especies. Ver el gap report §5. **No la cerré.**
2. Fuente y licencia del Battle Catalog (moves, learnsets, abilities, catch rates, formas).
3. Modelo real de `PokemonInstance` (naturaleza, IV, EV, ability, OT) y su persistencia.
4. Balance completo: pisos exactos, drop rates, capture rate final, curación, economía (A-12, O-13).
5. Contrato multiplayer definitivo: cuántos jugadores de verdad, cómo se forma el grupo, qué pasa si uno se desconecta a mitad del boss.
6. Autoridad del timing en realtime: cómo se valida una acción del cliente contra la barra del servidor con latencia.
7. Cómo son las entradas físicas en WildLands y qué tier se ve desde afuera.
8. Qué hace exactamente `RETURN_TO_NEAREST_POKEMON_CENTER` (coste, cooldown, curación).
9. Si el switching debe costar una ventana entera o menos.
10. Qué sistema de support/healing existirá, que es lo que define la regla de participación real.

# Riesgos que veo

1. **El ruleset es la decisión cara.** Cambiar de generación después toca datos y motor a la vez. Conviene cerrarla antes de importar nada.
2. **El timing en realtime es el problema de networking difícil**, no el combate. Con latencia, "qué había preparado cuando se llenó la barra" necesita una respuesta explícita. Lo dejé marcado, no resuelto.
3. **Sin pausa + mochila es exigente.** Es lo aprobado y me parece la decisión correcta, pero en 375 px con dos Pokémon activos la mochila y cuatro movimientos compiten por el pulgar. Hay que probarlo con gente.
4. **El Alpha con 4 jugadores puede volverse ilegible** antes de volverse difícil: cuatro aliados, un boss al doble de tamaño, aura y partículas. El lab sirve justo para medir eso.
5. **La captura como botín de expedición es una gran mecánica y un gran riesgo de frustración.** Perder un Larvitar del piso 18 por un wipe puede ser memorable o puede hacer que la gente no vuelva a entrar. Merece telemetría desde el día uno.
6. **Los materiales de dungeon tocan la economía** que A-12 dejó explícitamente sin cerrar. Ahí solo dejé un hook.

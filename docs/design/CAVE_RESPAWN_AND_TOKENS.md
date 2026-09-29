# CAVE ECOSYSTEM-1 — Nidos, respawn, tokens elementales y gacha

> Rama `design/cave-ecosystem-0.3`, base `2652a58`. Sólo diseño: no hay código, SQL ni balance productivo.
> Etiquetas: **FACT**, **INFERENCE**, **OPEN QUESTION**. Auditoría de partida: `SHARED_DUNGEON_ARCHITECTURE.md` §1.
> Todos los números de este documento son **parámetros de playtest**, no economía aprobada. §7 los simula con un script reproducible.

---

## 0. Resumen

- **Ejemplar ≠ Pokémon único.** Lo que aparece en un nido es un *ejemplar de encuentro* de una especie, no el Pokémon ownable (`slots`). Sin esta separación no puede existir el respawn por familias. Es la decisión **D-EC1**.
- **Nidos autoritativos.** Cada nido tiene id estable, familia, miembros por piso, peso, tope simultáneo, hogar y patrulla, estado, tiempos y **generación**. El miembro que reaparece se sortea con CSPRNG en el servidor, dentro de la familia y según el piso.
- **Respawn híbrido.** Temporizador individual por nido, cantidad de nidos activos según la presencia en el piso, suspensión sin jugadores y reset por run (Dungeon) o rotación horaria de la tabla de miembros (cueva permanente).
- **Tokens elementales.** Una moneda por cada uno de los 18 tipos, en una tabla propia con ledger. **Nunca** es `profiles.tokens`. Al derrotar un ejemplar, 1–3 tokens del tipo primario (+1 desde el piso 4) y un 25 % de probabilidad de 1 token del secundario. Intransferibles.
- **Gacha recomendado: "Huevo de hábitat".** Huevo temático por tipo de cueva, con probabilidades publicadas y pity. **Bloqueado** por la unicidad de especies: la simulación muestra que un banner de tipo que entrega especies únicas se agota en 0,1–4,5 días (§7.3).

---

## 1. Ejemplar de encuentro vs. Pokémon único (D-EC1)

**Hechos:**

- Cada especie es un único Pokémon con, a lo sumo, un dueño (`slots.pokemon_id`, INV-OWN-1, `docs/INVARIANTS.md:74`).
- El salvaje de superficie **es** esa entidad: id `wild:<área>:<época>:<pokemonId>`, excluida si tiene dueño (`wildPopulation.js:64-77,151`; `wildService.js:96`).

Un nido con respawn necesita el mismo tipo de Pokémon una y otra vez.

| Opción | Qué implica | Problema |
| --- | --- | --- |
| **A. Unicidad global** (cada especie a lo sumo una vez en todo el mundo a la vez) | Un servicio global asigna especies a superficie, cuevas y runs. | Con 30 jugadores y pools de ~15 especies por cueva, los nidos quedan vacíos. Choca con el roster horario de superficie, que puede tomar la misma especie. Además, derrotar al "Geodude único" una y otra vez no tiene sentido. |
| **B. Sólo especies sin dueño** | Los nidos filtran `ownedIds`, como la superficie. | A medida que la gente posee especies, las cuevas se vacían y las familias se rompen (Geodude con dueño → el nido de la familia pierde su base). |
| **C. Ejemplares de encuentro** *(recomendada)* | Un ejemplar es un encuentro de combate de una especie, sin identidad de propiedad. Puede haber varios en el tiempo y, con tope, a la vez. La propiedad sigue siendo global y única. Una **captura** futura tendrá que resolverse contra `slots` (y sólo si la especie no tiene dueño) o contra el modelo de instancias R32 si llega. | Hay que comunicar la diferencia en el producto ("Geodude salvaje" en cueva vs. "el Geodude de la plaza"). |

**Recomendación: C.**

- La unicidad protege la *propiedad*; no hace falta que proteja los *encuentros*.
- La captura queda fuera de alcance y se decide con su propio diseño (D-CB2).
- Hasta entonces, los ejemplares de cueva **no son capturables**, y el `pokemonId` de un ejemplar **nunca** se usa como id de propiedad.

---

## 2. Nidos

### 2.1 Campos

| Campo | Tipo | Origen | Público |
| --- | --- | --- | --- |
| `nestId` | `f<n>-nest<i>` (Dungeon) o `v-nest<i>` (vestíbulo) | generador puro o `CAVE_LAYOUTS` | ✓ |
| `scopeId` | `runId` o `caveId` | servidor | ✓ |
| `familyId` | id autorado de `caveFamilies.js` (hueco H1 de `CAVE_TYPES_AND_FAMILIES.md`) | definición | ✓ |
| `members` | `[{ speciesId, floors: [a,b], weight }]` según el piso | definición | ✓ (la **tabla**, no la próxima tirada) |
| `weight` | peso del nido dentro del pool del piso | definición | ✓ |
| `maxAlive` | tope de ejemplares simultáneos: 1 (v1); 2 sólo para "colonias" chicas (Zubat) en cámaras | definición | ✓ |
| `home` | casilla hogar | generador o layout, validada por guarda (§2.3) | ✓ |
| `homeRadius` | correa de patrulla: 2 (cámara) o 1 (nicho) | definición | ✓ |
| `patrol` | `buildPatrol({ key: encounterId, home, walkable, speed })` (`patrol.js:34`) | derivado, público por diseño | ✓ |
| `state` | `spawning \| alive \| reserved \| in_combat \| resolving \| defeated \| despawned` | servidor | ✓ (`spawning` y `defeated` se muestran como "reapareciendo") |
| `speciesId` | miembro actual | sorteo CSPRNG al aparecer | ✓ sólo desde `alive` |
| `spawnedAt`, `despawnedAt` | reloj del servidor | servidor | `spawnedAt` ✓ |
| `respawnAt` | reloj del servidor | servidor | **✗** (sólo "reapareciendo") |
| `generation` | entero monótono por nido: sube en cada resolución o despawn | Postgres (`dungeon_nests`) | ✓ (parte de `encounterId`) |
| Sorteo autoritativo | CSPRNG del servidor al pasar a `spawning → alive` (miembro, shiny cosmético) | servidor | ✗ (sólo el resultado) |

Sobre la "semilla autoritativa" del nido:

- No hay una semilla por nido que prediga el futuro. Cada aparición es **un sorteo nuevo** del CSPRNG del servidor (`battle/authority/seed.ts:35`), igual que las acciones de PROB-2.
- Lo único derivable y público es la patrulla, que depende de `encounterId`, así que cambia con cada generación.

### 2.2 Generación y ABA

Cada intent de combate lleva un `encounterId`, y en él va la `generation`. Sin generación, un `engage` retrasado del ejemplar anterior podría caer sobre el nuevo (problema ABA). Con ella, el servidor lo rechaza como `gone`. En Postgres, `dungeon_resolve_encounter` hace CAS contra `generation` (`SHARED_DUNGEON_ARCHITECTURE.md` §6.2), igual que el token de generación de YIELD-2 (`world/multi-yield-recovery-0.3:…/20260928120000_world_multi_yield.sql:15,49-55`).

### 2.3 Dónde **no** puede haber un hogar ni pasar una patrulla

Se verifica con una guarda derivada del layout, como `caves.test.js` hace con `CAVES`:

| Casilla prohibida | Radio |
| --- | --- |
| Portales (entrada, salida, puerta de Dungeon) | 2 |
| Escaleras | 2 |
| Llegadas | 3 |
| Pasillos estrechos (`openWidth < 3`, `tileKinds.ts:92`) | 0 (ninguna casilla del pasillo) |
| Obstáculos y su casilla de acercamiento | 1 |
| Nodos de recurso, sus stands y esperas (`workPlacement`) | 1 |
| Casillas de interacción (altar, sello, palanca) y de espera | 1 |
| Bocas de recoveco (`obstacles.ts` `alcove.mouth`) | 1 |
| Tamaño L/XL | hogar sólo donde `openWidth ≥ 5`, dentro de una cámara ≥ 9 (`MIN_CHAMBER`, `tileKinds.ts:39`) |

La patrulla usa un `walkable` que excluye todo lo anterior, igual que `sharedPopulace.walkable` excluye la reserva de la cueva en superficie (`game.ts:163-165`). Como las patrullas **no bloquean** al jugador (`rules.occupied` las ignora, CAVES-1 §2), la regla es visual y de legibilidad, no de colisión.

---

## 3. Spawn y respawn

### 3.1 Reglas

| Pregunta | Regla recomendada |
| --- | --- |
| ¿Cuándo reaparece? | `respawnAt = defeatedAt + cooldown(etapa) × (1 ± 0,2 CSPRNG)`, con cooldown de 60 s (etapa 1), 90 s (etapa 2) y 120 s (etapa 3). Los nidos "raros" (peso ≤ 6: Dunsparce, Onix, Lunatone/Solrock, Sableye, Mawile) usan **300 s**. |
| ¿La misma especie? | **No necesariamente:** se vuelve a sortear entre los `members` válidos del piso, con sus pesos. La familia se conserva; la etapa depende del piso. |
| ¿Qué cambia al profundizar? | La distribución de etapas (ver pools en `CAVE_TYPES_AND_FAMILIES.md` §6), +1 token desde el piso 4 (§5) y los nidos de tamaño L/XL. El cooldown **no** baja con la profundidad. |
| Límite de población | Por nido: `maxAlive` (1). Por área: `activeNests = min(12, 4 + ⌈jugadores_en_el_área / 2⌉)`, eligiendo entre los nidos del piso por peso, de forma estable durante la activación. Por run: 6 áreas × 12 = 72 ejemplares como máximo. |
| Camping | (1) El cooldown no se acorta con jugadores presentes. (2) `respawnAt` no se publica. (3) Rendimiento decreciente **por jugador y nido**: desde la 7.ª derrota elegible del mismo nido en 30 min, los tokens de ese nido rinden 50 % (las llaves no se afectan). (4) Los nidos raros tienen 300 s. (5) El tope diario blando (§5.4). |
| Sin jugadores | El área pasa a `dormant` a los 5 min (`SHARED_DUNGEON_ARCHITECTURE.md` §3.2): no se simulan patrullas ni timers. Al reactivarse, cada nido aparece escalonado entre 5 y 15 s para que el piso no "florezca" de golpe. |
| Limpieza | Filas de `dungeon_nests` con `scope = runId` de runs terminadas: se borran a las 24 h. `encounter_resolutions`: se retienen 30 días. El ledger de tokens nunca se borra. |
| Reinicio del servidor | Se cargan los nidos persistidos (`generation`, `state`, `respawnAt`). Un nido `alive`, `reserved` o `in_combat` en memoria se pierde **sin pago** y reaparece con la misma generación y un miembro nuevo. Nada resucita lo ya derrotado: la derrota es un commit. |
| Paridad entre instancias | Lease de la run + CAS por generación: una instancia vieja no paga (`SHARED_DUNGEON_ARCHITECTURE.md` §2.5). |
| Entrada tardía | El snapshot trae los ejemplares vivos (especie, patrulla) y los nidos en respawn como "reapareciendo", sin tiempo. |

### 3.2 Comparación de estrategias

| Estrategia | Ventajas | Desventajas | Veredicto |
| --- | --- | --- | --- |
| **Temporizador individual** por nido | Justa, legible ("éste volvió"); carga pareja | Sin techo ante muchos jugadores; invita a acampar un nido | Base del híbrido |
| **Oleadas** (el piso se repuebla entero cada X min) | Momentos sociales ("¡salió la oleada!"); fácil de balancear | Picos de carga y de mensajes; tiempos muertos entre oleadas; premia llegar justo al inicio | No |
| **Rotación horaria actual** (`wildPopulation.js:21-22`) | Ya existe, cero estado | No hay derrota ni respawn: no sirve para combate | Sólo como tabla de **qué miembros** ofrece el vestíbulo en cada hora |
| **Híbrido** *(recomendado)* | Individual + nidos activos según presencia + suspensión sin jugadores + reset por run (Dungeon) o rotación horaria de miembros (vestíbulo) | Más parámetros | **Sí** |

### 3.3 Máquina de estado del nido

Es la del encuentro (`SHARED_DUNGEON_ARCHITECTURE.md` §3.4), más la activación por presencia:

```mermaid
stateDiagram-v2
  [*] --> inactive: el piso existe pero el nido no está entre los activos
  inactive --> spawning: activeNests lo incluye (escalonado 5–15 s)
  spawning --> alive
  alive --> defeated: resolución (g → g+1)
  defeated --> spawning: respawnAt
  alive --> inactive: baja la presencia y el nido está libre (g → g+1, despawn)
  defeated --> inactive: baja la presencia (el timer se conserva)
  alive --> [*]: fin de run
  defeated --> [*]: fin de run
```

Un nido `reserved`, `in_combat` o `resolving` **nunca** se desactiva: se espera a que termine.

---

## 4. Pacing y carga (10/30/100 jugadores)

Modelo (script `load.mjs`, §7.5):

- 6 áreas (vestíbulo + 5 pisos de `caliza-d1`), jugadores repartidos de forma uniforme;
- `activeNests = min(12, 4 + ⌈p/2⌉)`;
- ciclo de nido = respawn 75 s + combate 40 s;
- cada jugador busca 30 derrotas elegibles por hora;
- 5 cambios públicos por derrota.

| Jugadores | Por área | Nidos activos | Capacidad (derrotas/h/área) | Derrotas/h/área | Elegibles por derrota | Derrotas elegibles/jugador/h | Commits a Postgres | Filas de ledger | Deltas públicos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 1,7 | 5 | 156,5 | 50 | 1,0 | 30 | 0,1/s | 0,1/s | 0,7 msg/s |
| 30 | 5 | 7 | 219,1 | 150 | 1,0 | 30 | 0,3/s | 0,3/s | 6,3 msg/s |
| 100 | 16,7 | 12 | 375,7 | 375,7 | 1,3 | 30 | 0,6/s | 1,0/s | 52,2 msg/s |

**Lectura.**

- A **100 jugadores** la oferta se satura (12 nidos por área) y el ritmo personal se sostiene porque se comparten derrotas (1,3 elegibles por derrota): la cooperación absorbe la escasez.
- La carga sobre Postgres (≤ 1 fila/s de ledger) y sobre el socket (~52 deltas/s repartidos entre 6 áreas) es menor que la de presencia. **No** es el cuello de botella.
- El límite real sigue siendo la sala única de 100 conexiones (`capacity.js:1`).

**Riesgos.**

1. Con más de 16 jugadores por área, los nidos saturados alargan la espera y crecen los conflictos por `engage`. Se mitiga con la unión a combates (hasta 4).
2. Si toda la población se concentra en un piso, `activeNests` topea en 12 y la espera crece. Una opción es que la cueva distribuya la entrada (el piso 1 es el único punto de entrada; hace falta bajar).
3. `encounter:action` de COMBAT-1 va a dominar el tráfico. Hay que medirlo en su fase.

---

## 5. Tokens elementales

### 5.1 Catálogo

**Hechos del catálogo local (`core.json`, formas por defecto de 493 especies):**

- 18 tipos;
- 235 especies de doble tipo;
- ninguna especie tiene `flying` como tipo primario (64 lo tienen como secundario);
- `dragon` es primario en 13 especies, y la mayoría son líneas pseudo-legendarias o legendarias excluidas.

| Opción | Pros | Contras |
| --- | --- | --- |
| **18 tokens, uno por tipo** *(recomendada)* | Ids estables que calzan con la tabla de tipos, sin mapeos; cada banner o huevo pide "su" tipo | Algunos tipos son escasos o inalcanzables al principio (`flying`, `dragon`, `ice`, `fire`) |
| 6 grupos (tierra-roca, agua-hielo, fuego, planta-bicho, mente-fantasma, metal-eléctrico…) | Menos monedas en la UI | Agrupaciones arbitrarias; ids inestables si el grupo cambia; mala lectura para doble tipo |

**Ids y nombres visibles.** Id = nombre del tipo del catálogo (`rock`, `ground`…), con un CHECK de las 18 en la tabla. Nombre visible:

- **"Esencia de <Tipo>"** con los nombres en español que el repo ya usa (`TYPE_ALIASES`, `wildPopulation.js:79-84`): Roca, Tierra, Veneno, Volador, Acero, Hada, Psíquico, Siniestro, Fantasma, Normal, Bicho, Planta, Agua, Hielo, Fuego, Eléctrico, Lucha, Dragón.
- **OPEN QUESTION D-TK1:** el producto los llama "tokens", pero "Tokens" ya es `profiles.tokens` en la UI y en el mercado. Se recomienda **"Esencias"** como nombre visible para que nadie confunda las dos monedas. Internamente: `elemental_token`.

### 5.2 Drops

| Regla | Valor v1 | Motivo |
| --- | --- | --- |
| Token primario, garantizado | Etapa 1 → 1; etapa 2 → 2; etapa 3 → 3 | Proporcional al esfuerzo, sin exponenciales |
| Bonus de profundidad | +1 desde el piso 4 | Aditivo, nunca multiplicativo |
| Token secundario (doble tipo) | 25 % de 1 token | Da acceso a `flying`, `ground`, `psychic`… sin duplicar el primario |
| Rareza del nido | **No** suma tokens | Evita acampar los raros (Dunsparce, Onix, Sableye) |
| Shiny | Cosmético, **no** suma | Idem |
| Bonus por contribución | **Ninguno** en v1: todos los elegibles reciben lo mismo | Un bonus al mayor contribuyente reintroduce la competencia que la elegibilidad quiere evitar. Un bonus por cooperación incentiva la multicuenta. Revisar con telemetría. |
| Vestíbulo permanente | Misma fórmula, piso 0 (sin bonus) | Siempre disponible: el tope diario lo acota |
| Decisión | 100 % servidor (CSPRNG en la resolución) | AGENTS §11 |

**Tipos sin fuente en las cuevas v1.**

- `dragon` no aparece en ningún pool, a propósito: sus familias válidas son pocas y casi todas pseudo o legendarias. Queda para zonas futuras y **no** debe tener banner hasta tener fuente.
- `fire`, `ice`, `water`, `grass`, `electric` y `fairy` salen de `volcanica`, `glacial`, `humeda`, `mina` y `cristalina` a medida que se abren.
- La conversión con pérdida (§5.6) evita que un tipo quede inalcanzable.

### 5.3 Liquidación y dedupe

Los tokens se escriben **dentro** de `dungeon_resolve_encounter` (`SHARED_DUNGEON_ARCHITECTURE.md` §6.2), en la misma transacción que la derrota:

```text
elemental_token_ledger(
  entry_id     uuid PK,
  user_id      uuid NOT NULL,
  token_type   text NOT NULL CHECK (token_type IN (<los 18 tipos>)),
  delta        integer NOT NULL CHECK (delta <> 0 AND abs(delta) <= 1000),
  reason       text NOT NULL CHECK (reason IN ('defeat','gacha_pull','conversion','admin_adjust')),
  source_id    text NOT NULL,          -- encounterId, pullId, conversionId
  rules_version text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, user_id, token_type)   -- un mismo jugador no cobra dos veces la misma derrota
)
elemental_token_balances(user_id, token_type, balance integer NOT NULL CHECK (balance >= 0), PK(user_id, token_type))
```

- Crédito: `INSERT … ON CONFLICT (source_id, user_id, token_type) DO NOTHING`; sólo si insertó, `balance += delta`.
- Débito (gacha, conversión): `UPDATE … SET balance = balance − cost WHERE balance >= cost` en la misma transacción que el resultado. Es el patrón de `spend_tokens_learn_move` (`20260907_005_token_economy_rpcs.sql:100`), pero con dedupe por `source_id`.
- RLS: `SELECT` de las filas propias para `authenticated`. Sin `INSERT`, `UPDATE` ni `DELETE` de cliente. Funciones sólo `service_role`.

### 5.4 Límites diarios

- **Tope blando por cuenta:** 300 tokens por día (UTC) a tasa completa y 50 % a partir de ahí (escenario "media", §7).
- Se mide en el ledger (suma de `delta > 0` de `reason = 'defeat'` del día) dentro de la resolución. Sin tope duro: nadie juega "gratis", pero la curva se aplana.
- Es independiente del tope de 3 000 `profiles.tokens` de la Dungeon legacy (`20260908_010_dungeon_reward.sql:29`), que es otra moneda.

### 5.5 Visualización

| Dónde | Qué |
| --- | --- |
| Al resolver (privado) | Toast "+2 Esencia de Roca" y, si aplica, "+1 Esencia de Tierra". Viene de `dungeon:self` / `dungeon:result`, nunca de un cálculo del cliente. |
| Inventario | Panel "Esencias": 18 contadores y los tipos en 0 atenuados. Fuente: `player:state` extendido. |
| Público | Nada: otros jugadores no ven saldos ni drops ajenos. |

### 5.6 Intercambio y sumideros

| Regla | Recomendación |
| --- | --- |
| Intercambio entre jugadores | **No**, ni en el mercado. Intransferibles: sin RMT, sin concentrar multicuentas, sin interacción con `profiles.tokens`. |
| Convertir a `profiles.tokens` | **Nunca**. |
| Sumidero principal | Gacha (§6). |
| Sumidero de nivelación | Conversión con pérdida **5 : 1** entre tipos (5 de cualquier tipo → 1 de otro), con un tope de 20 conversiones por día. Es un sumidero neto y resuelve los tipos escasos. |
| Sumideros futuros | Consumibles de Dungeon, cosméticos. Fuera de alcance: no se diseñan acá. |

# R32.2 / R32.2.1 — PokemonSpecies / PokemonInstance

> Rama `feat/r32-2-1-model-decisions`, desde `feat/r32-2-pokemon-model` @ `7bf9af9ef520882824a81eb7d2e82de6ef8c51b9`.
> R32.2 (base) introdujo el modelo. **R32.2.1** cierra las decisiones de producto, corrige el corte de estado, formaliza el contrato de migración legacy sobre una identidad inmutable y separa canonicalización de incompatibilidad en los movimientos.
> **Solo modelo, validación, fábrica, adaptadores, tests y documentación.** No hay combate (R32.3), ni UI, ni autoridad de servidor, ni migración ejecutada.
> Catálogo de referencia: `1.oras.ab69b5804411` (ORAS / Generación VI, 493 especies).

---

## 1. Qué es

El modelo canónico de **un Pokémon concreto** en PokeSwap: su naturaleza, sus IVs, sus EVs, sus movimientos, su desgaste, su dueño y su origen. Es la pieza que hoy no existe en producción.

Lo que **no** es: no es la especie (eso es el Battle Catalog, R32.1), no son las reglas de combate (R32.3) y no es un esquema de base de datos (R32.4, cuando haya decisión humana).

La misma `PokemonInstance` se usa después para combate, Dungeon, profesiones, workers, market y colección. **No existe ni existirá un `ProfessionPokemon` ni un `DungeonPokemon`.**

## 2. El corte en tres (R32.2.1)

| Capa | Archivo | Qué contiene | ¿Sobrevive a la batalla? |
|---|---|---|---|
| **Identidad** — `PokemonInstance` | `instance.ts` | especie y forma, naturaleza, IVs, EVs, habilidad, movimientos aprendidos con sus PP Ups, propiedad, procedencia, shiny, apodo | Sí; casi nunca cambia |
| **Desgaste** — `PokemonConditionState` | `condition.ts` | `currentHp`, PP gastados por movimiento, `majorStatus` | **Sí** |
| **Combate** — `BattleRuntimeState` | `runtime.ts` | stat stages, confusión, Protect, action bar, volátiles, forma activa (Mega) | **No**: muere con la batalla |

La regla que decide la capa: **¿seguiría siendo verdad mañana, fuera de combate?** Una quemadura sí; un −2 de Ataque no.

El desgaste vive **dentro** de la instancia (`instance.condition`), no como registro aparte: es un campo que la batalla puede escribir y lo demás no. Salir del combate es una sola función:

```ts
leaveBattle(instance, condition) → instance   // el runtime ni siquiera es argumento
```

El `BattleRuntimeState` no se pasa a `leaveBattle` a propósito: no tiene nada que aportar, y así es imposible que un stage o una Mega se filtren al registro persistido.

**Corrección respecto de R32.2:** en la primera versión sólo HP y PP cruzaban, y `majorStatus` vivía en el runtime. Ahora el estado mayor **también persiste** (§8), que es lo que pide la dirección de producto de Dungeon.

`fainted` no existe como campo: es `currentHp === 0` (`isFainted`). Dos campos que describen un mismo hecho terminan discrepando.

## 3. Archivos

| Archivo | Qué resuelve |
|---|---|
| `stats.ts` | Fórmulas de stats de Gen VI, naturalezas, límites de IV/EV, validación |
| `experience.ts` | Experiencia ↔ nivel, sobre la curva L³ que ya usa producción |
| `instance.ts` | `PokemonInstance`, `MoveSlot`, propiedad, procedencia, `validateInstance`, las dos transiciones de I-1 |
| `condition.ts` | `PokemonConditionState`, `isFainted`, `remainingPP`, validación y poda |
| `runtime.ts` | `BattleRuntimeState`, `enterBattle`, `leaveBattle`, `megaEvolve` |
| `party.ts` | Party activa de seis (A-1), `canWork` |
| `catalogView.ts` | La vista angosta del Battle Catalog que el modelo consume |
| `factory.ts` | Creación pura con RNG inyectado |
| `legacy.ts` | Proyección de las filas actuales de producción, sin inventar nada |
| `migration.ts` | **Contrato de migración legacy** (M-1, hash determinista) |
| `index.ts` | Barril: se importa desde acá |

## 4. Nivel vs experiencia — se persiste la experiencia

`PokemonInstance.experience` es la única fuente de verdad; el nivel se **deriva** (`levelForExperience`) y nunca se guarda al lado.

1. Es lo que producción ya hace: `grant_pokemon_xp` otorga XP y recalcula el nivel; el cliente lee la misma fórmula en `progression/utils/xpLevel.ts`.
2. Dos campos que describen lo mismo se pueden desincronizar. La proyección legacy detecta y reporta ese caso (`levelDisagrees`), y la regla está cerrada: **si el `level` legacy discrepa de su `xp`, gana el xp** — se preserva la experiencia, el nivel se deriva y el guardado sólo se audita (`MigrationReport.ignoredStoredLevel`).
3. Un cambio de curva futuro se aplica en un solo lugar.

La curva sigue siendo la histórica de PokeSwap (XP de L a L+1 = L³, tope 100). **No se migra** a las seis growth curves canónicas: el catálogo guarda `growthRate` para el futuro, y cambiar la curva revaluaría niveles existentes, así que es una decisión separada (§19).

## 5. Qué se guarda y qué se deriva

**Identidad guardada:** experiencia, naturaleza, habilidad, IVs, EVs, movimientos (`moveId` + `ppUps`), propiedad, procedencia, shiny, género, apodo.

**Desgaste guardado:** `currentHp` (o `null` = sin daño), PP gastados por `moveId`, `majorStatus`.

**Derivado, nunca guardado:** nivel, stats actuales, `maxPP` de cada slot (PP base del catálogo + 20 % por PP Up), `fainted`, tipos, habilidades posibles, catch rate.

`maxPP` no se guarda: si cambia el PP de un movimiento, un valor guardado quedaría mintiendo. `ppUps` sí, desde el día uno. El mapa `condition.pp` es **disperso** y está indexado por `moveId`: un movimiento ausente está a PP completo, y reordenar los cuatro slots no puede mover desgaste de un movimiento a otro.

## 6. Propiedad y procedencia

```ts
ownership: { ownerId: string | null, originalTrainerId: string | null }
acquisition: { source, at, catalogVersion, ref?, migration? }
```

- `ownerId` es un string opaco para esta capa: el modelo no importa auth, ni Supabase, ni sesión.
- `originalTrainerId` no cambia cuando cambia el dueño.
- `acquisition.at` es ISO-8601 en string, no `Date`.
- `acquisition.catalogVersion` deja trazable contra qué catálogo se generó.
- `acquisition.migration = { version, salt }` sólo aparece en `legacy_migration` (§10).
- `source`: `starter`, `adoption`, `market`, `trade`, `swap`, `dungeon_capture`, `event`, `legacy_migration`.

## 7. Captura pendiente de expedición (I-1 — CLOSED / APPROVED)

```
capturado   → state: 'expeditionPending', ownerId: null
retirada OK → secureCapture() → state: 'owned', ownerId, originalTrainerId
auto-extract→ igual que la retirada
wipe        → el registro no cruza nunca a persistencia (isLostOnWipe)
```

- `validateInstance` rechaza una captura pendiente que ya tenga dueño.
- La fábrica (`createExpeditionCapture`) se niega a crearla con `ownerId`.
- `validateParty` la rechaza como miembro de la party.
- El desgaste que tomó adentro del dungeon viaja con ella cuando se asegura.
- Los Pokémon preexistentes nunca se pierden en un wipe: sólo la captura pendiente.

La instancia real la creará el servidor. **No se implementa servidor todavía.**

## 8. Estado mayor y dirección de curación (PRODUCT DIRECTION)

Persiste entre combates y entre pisos de Dungeon: **HP, PP, faint y major status**. Los estados mayores son `burn`, `paralysis`, `poison`, `badlyPoisoned`, `freeze`, `sleep`. **Confusion no**: es volátil y vive en el runtime, junto con stages, Protect y action bar.

Registrado como dirección de producto, **no implementado**:

- terminar un combate **no** cura HP;
- **no** restaura PP;
- **no** elimina el estado mayor;
- la Dungeon conserva su attrition;
- los objetos pueden curar;
- el Centro Pokémon curará según reglas futuras;
- retreat/extraction **no** implica curación por definición.

Nada en el modelo cura nada hoy. El Centro Pokémon no se implementa en esta fase.

## 9. Auditoría del modelo legacy

| Tabla | Grano | Qué guarda |
|---|---|---|
| `slots` | **una fila por especie** (`pokemon_id`), dueño global único | precio, aura, energía, dueño, primer dueño |
| `pokemon_xp` | (usuario, especie) | `xp`, `level` recalculado por `grant_pokemon_xp`, `moves` JSON |
| `pokedex_entries` | (usuario, especie) | registro de descubrimiento |
| `swap_history.was_shiny` | evento | lo único que menciona shiny en todo el sistema |

**Hallazgo central: PokeSwap no tiene hoy Pokémon individuales.** No hay dos Pikachu; hay *el* Pikachu. Y no existen —ni se pueden reconstruir— naturaleza, IVs, EVs, género, forma, PP ni habilidad individual.

`PokemonInstance` es un concepto **nuevo**. No hay "migración de esquema": hay una decisión de producto sobre qué recibe cada jugador, y es la de §10.

## 10. Legacy Migration Contract (APROBADO: M-1 — backfill determinista por hash)

Implementado en `migration.ts`. **No ejecutado**: no escribe, no lee Supabase y no migra a nadie. Convierte una fila en un draft, en memoria, para que la decisión pueda revisarse antes de aplicarse.

### 10.1 La identidad legacy (`LegacyPokemonIdentityKey`) — **el dueño no participa**

```
LegacyPokemonIdentityKey = { slotPokemonId }   // slots.pokemon_id
```

Evidencia de que es inmutable, leída del propio repo:

| Hecho | Dónde se ve |
|---|---|
| `slots` tiene **exactamente una fila por especie**: toda escritura es un upsert `ON CONFLICT (pokemon_id)` → `pokemon_id` es su primary key | `supabase/migrations/20260907_003_buy_market_listing.sql`, `supabase/functions/pokeswap-swap/index.ts` |
| Un cambio de dueño es un `UPDATE` de `owner_id` sobre **esa misma fila** | ídem |
| Soltar un Pokémon pone `owner_id = null`; **no borra la fila** | `pokeswap-swap/index.ts` (“Liberar el slot dado”) |
| Ningún camino del repo hace `DELETE FROM slots` | búsqueda en `supabase/` y `src/` |

Es decir: la fila del slot —la identidad del Pokémon legacy— sobrevive a cada swap, a cada venta de mercado y a cada liberación. Por eso es la clave, y por eso satisface las tres preferencias a la vez: **es la primary key del slot**, y esa primary key resulta ser el id de especie porque el modelo legacy garantiza un único Pokémon global permanente por especie.

**Qué queda deliberadamente afuera de la clave:** `user_id` / `owner_id`, xp, level, moves, aura, energía y todo timestamp. Un Pokémon que cambia de manos el día antes de correr la migración tiene que salir de ella siendo **el mismo Pokémon**. La propiedad se preserva como metadata de la instancia migrada (`ownership`), pero no toca el RNG.

Esto encaja con la cardinalidad aprobada (§10.2): como la unidad de migración es el slot y hay un solo slot por especie, cada identidad produce como mucho un Pokémon.

### 10.2 Legacy Migration Cardinality — **una fila de `slots` = un Pokémon**

```
slot        → 0 o 1 PokemonInstance          (la entidad)
pokemon_xp  → fuente de progresión           (NO es identidad ni entidad)
```

El juego legacy nunca tuvo dos individuos de una especie. `slots` guarda exactamente una fila por especie y **esa fila es el Pokémon**. `pokemon_xp` es entrenamiento, con clave `(user, species)`: una fila de un ex-dueño es la historia de ese jugador, no otro Pokémon. Por lo tanto **nunca** se crean N instancias según la cantidad de filas de `pokemon_xp`.

El contrato, tal como lo implementa `migrateLegacySlot`:

1. leer el slot → identidad (`slots.pokemon_id`);
2. la especie es ese mismo id;
3. `currentOwnerId = slots.owner_id` — **única fuente de verdad de propiedad**;
4. si no hay dueño, **no se crea instancia** (§10.2.1);
5. buscar la progresión `pokemon_xp(user_id = currentOwnerId, pokemon_id = slot)`;
6. preservar xp y movimientos **de esa fila**, y de ninguna otra.

Las filas de ex-dueños se cuentan en `MigrationReport.ignoredHistoricalProgressions` y no producen nada. **No se borran**: son `historical trainer progression` y qué hacer con ellas (archivar, conservar, borrar tras backup) es de un proceso productivo futuro, fuera de este scope.

`pokemon_xp.user_id` **no** es propiedad: sólo dice de quién es ese entrenamiento. La proyección lo expone como `progressionTrainerId`, y si no coincide con el dueño del slot lo reporta como problema en vez de usarlo.

#### 10.2.1 Slot sin dueño (`owner_id = null`)

**Semántica auditada, no inventada.** `src/features/pokemon/domain/wildPool.ts` arma el pool de disponibles con `pokemon.filter(entry => !slots[entry.id]?.owner_id)`: una especie sin dueño actual **no es el Pokémon de nadie**, es parte del pool que cualquiera puede conseguir. Y la edge function de swap libera un slot poniendo `owner_id = null` sin borrar la fila.

Por lo tanto un slot sin dueño **no genera una PokemonInstance poseída**: `migrateLegacySlot` devuelve `{ kind: 'skipped', reason: 'unowned' }`.

Estados especiales que sí existen y **no** son este caso:

| Estado | Qué pasa con el slot | Qué hace la migración |
|---|---|---|
| Publicado en el mercado | `is_locked = true`, **`owner_id` sigue siendo el vendedor** (`20260907_001_publish_market_listing.sql`) | Migra normal, al vendedor |
| Compra completada | `UPDATE owner_id = comprador` sobre la misma fila | Migra al comprador; la identidad no cambia |
| Liberado por swap | `owner_id = null` | `skipped: unowned` |

No hay escrow ni pending-ownership con dueño nulo en el repo. Si en los datos reales aparece algún caso que el código no explica, queda para el **migration dry-run** futuro.

#### 10.2.2 Dueño actual sin `pokemon_xp`

**Semántica legacy demostrable:** `useProgression.ts` lee `raw?.xp ?? 0` y `raw?.moves ?? null`, y `grant_pokemon_xp` crea la fila recién al otorgar XP, arrancando en xp 0 / nivel 1. Es decir, para el juego legacy ese Pokémon **ya vale 0 xp, nivel 1 y sin movimientos**; no hay heurística que inventar.

La migración usa exactamente eso, y además **lo marca**: `MigrationReport.missingCurrentOwnerProgression = true` (el `MISSING_CURRENT_OWNER_PROGRESSION` del dry-run), porque un Pokémon sin ningún movimiento no puede actuar y eso es una decisión de producto, no del adaptador. `needsMoveBackfill` queda en `true` y no se aplica nada.

### 10.3 Propiedades

| Propiedad | Cómo se consigue |
|---|---|
| Determinista | Todo sale de un hash de datos legacy estables |
| Reproducible | FNV-1a de 32 bits, sin dependencias, portable a SQL u otro lenguaje |
| Versionado | `(salt, version)` queda **dentro** del registro, en `acquisition.migration` |
| No rerrolleable | No se lee reloj, contador ni fuente aleatoria |

```
hash(campo) = mix32(FNV1a(`${salt}|v${version}|slot:${slotPokemonId}|${campo}`))
```

`mix32` es el finalizador de Murmur3. Hace falta: las cadenas que se hashean difieren en uno o dos caracteres cerca del final (`slot:25` vs `slot:26`) y los bits bajos de FNV-1a casi no se mueven entre ellas, así que tomar `% 32` directamente repetía spreads de IVs entre especies consecutivas. Con el avalanche, 120 especies dan 120 spreads distintos (hay test).

Cada atributo tiene su **propio** hash en vez de tirar de un stream compartido. Consecuencia deliberada: agregar un atributo mañana **no** mueve los ya asignados, así que el contrato es extensible sin rerrollear Pokémon de nadie.

Versión y sal vigentes: `LEGACY_MIGRATION_VERSION = 1`, `LEGACY_MIGRATION_SALT = "pokeswap-legacy-backfill"`. La sal **no es un secreto**: la migración está pensada para ser reproducible por cualquiera que tenga las mismas filas. Subir la versión produce a propósito Pokémon distintos de las mismas filas, y lo que la fila legacy sí sabía (especie, experiencia, dueño, movimientos, EVs) queda intacto.

### 10.4 Qué se preserva y qué se deriva

| Campo | Origen |
|---|---|
| `speciesId`, `experience`, `ownership` | **preservado** de la fila legacy |
| `moves` | **preservado** cuando resuelve contra R32.1 (§11) |
| `evs` | **0 en los seis** — el sistema histórico nunca registró entrenamiento EV |
| `ivs` | **derivado**, uno por stat, `0…31`, nunca un valor neutro plano |
| `natureId` | **derivado** entre las 25 del catálogo |
| `abilityId` | **derivado** entre las habilidades **normales** de la forma |
| `gender` | **derivado** siguiendo el ratio de la especie |
| `formId` | forma por defecto de la especie |
| `shiny` | `false` salvo evidencia persistida inequívoca entregada por el llamador |
| `condition` | `HEALTHY`: un Pokémon migrado llega descansado |
| `state` | `owned` |
| `acquisition.source` | `legacy_migration` |

**Hidden Ability: nunca.** La migración no puede alcanzarla ni siquiera cuando la forma no tiene habilidades normales (ahí falla con un error explícito). Cómo se obtiene una habilidad oculta es un mecanismo abierto (§19).

**Shiny:** `swap_history.was_shiny` describe un **evento de swap**, no un Pokémon, así que no alcanza como evidencia. Información histórica imposible de reconstruir, documentada acá y no inferida.

**El dueño es `slots.owner_id`**, y sólo eso. `pokemon_xp` es **fuente de progresión**, no de propiedad: su `user_id` dice de quién es ese entrenamiento, y si no coincide con el dueño del slot se reporta como problema en vez de usarse (§10.2). Es lo que implementa `migrateLegacySlot` y lo que verifican sus tests.

> **Corregido en R32.3.** Hasta acá este párrafo decía lo contrario —«el dueño es `pokemon_xp.user_id`»— y era una línea sobreviviente de la primera versión del documento, anterior a la decisión de cardinalidad de §10.2. Nunca describió el código. Se corrige en la rama descendiente sin reabrir R32.2.1.

### 10.5 Qué falta decidir antes de ejecutarla

1. Cuándo corre, y sobre qué universo de slots (¿todos los que tienen dueño hoy?).
2. Si se acepta el backfill de movimientos propuesto en §11 para los Pokémon que quedan sin ningún movimiento (categorías C y D, o `MISSING_CURRENT_OWNER_PROGRESSION`).
3. Si alguna evidencia de shiny se considera inequívoca.
4. Qué se hace con las filas `pokemon_xp` de ex-dueños: archivar, conservar como historia o borrar tras backup. **No se tocan ahora.**

**Ya no es una pregunta abierta** qué hacer cuando el `level` guardado discrepa de su `xp`: el contrato vigente es `experience = fuente de verdad persistida`, `level = derivado`. La migración **preserva el xp**, deriva el nivel con la curva L³ y reporta la discrepancia en `MigrationReport.ignoredStoredLevel`. El nivel guardado nunca sobrescribe nada. Hay tests.

**Nada de esto se aplica sin aprobación humana.**

## 11. Movimientos legacy — canonicalización vs. incompatibilidad

Auditoría completa y reproducible: [`LEGACY_MOVE_AUDIT.md`](LEGACY_MOVE_AUDIT.md), generada por `node scripts/legacy-move-audit.mjs` sobre el tag `v0-legacy-baseline`.

Los slugs que no resuelven **no son una sola categoría**:

| | Categoría | Slugs | Qué hace la migración |
|---|---|---:|---|
| **A** | Exacto: ya es un identificador del catálogo | 561 | Lo usa tal cual |
| **B** | **Canonicalizable**: el mismo movimiento con otro nombre (español, alias histórico) | 370 | Lo **preserva**, traduciéndolo a su `moveId` |
| **C** | Incompatible real con ORAS / Gen VI | 19 | Incompatibilidad real, reportada |
| **D** | Desconocido / no identificable | 15 | Separado; nadie adivina |
| | **Universo** | **965** | |

**Después de canonicalizar A + B quedan 34 slugs sin identidad: 19 incompatibilidades reales y 15 desconocidos.**

**B no es backfill.** Un movimiento escrito en español no se reemplaza por otro: se **reconoce**. El diccionario es la propia tabla legacy —`LEVEL_MOVES` y `STATUS_MOVES` guardan el nombre español y el inglés en la misma fila—, así que no hay ninguna traducción escrita a mano. El script genera `src/features/pokemon/model/generated/legacyMoves.json` (370 entradas) y `legacy.ts` lo consume: `canonicalMoveId(slug)` resuelve exacto → mapa canónico, y nada más (sin fuzzy matching, sin “el más parecido”).

**Alias históricos explícitos: exactamente uno.** `vise-grip` → `vice-grip`: Gen VIII renombró el identificador, en Gen VI es el segundo. El `learnset.js` legacy se generó desde una PokéAPI moderna, de ahí el spelling nuevo.

**C se prueba, no se afirma.** Cada uno de los 19 tiene `generation_id > 6` en el `moves.csv` de veekun, la misma fuente fijada de R32.1: `aurora-veil`, `body-press`, `burn-up`, `dual-wingbeat`, `liquidation`, `throat-chop`, … Ningún renombre los arregla porque el movimiento no existía.

**D es honestidad, no pereza.** Los 15 restantes (`aqua-cutter`, `snowscape`, `rage-fist`, …) no aparecen en veekun, que cubre hasta la generación 8. Casi con seguridad son de Gen IX, pero **ninguna fuente fijada lo prueba**, así que no se los mezcla con C.

**Propuesta de backfill (NO implementada, requiere aprobación):** sólo para un Pokémon que quede sin ningún movimiento porque los suyos cayeron en C o D — tomar los últimos cuatro movimientos de nivel de su learnset ORAS al nivel derivado de su experiencia. **Nunca** para un movimiento que se puede canonicalizar.

## 12. Party activa (A-1)

Seis como máximo, y **los mismos seis** sirven para exploración, combate, Dungeon y profesiones. La party es una lista de **ids**: se valida que sean únicos, que existan, que pertenezcan al dueño y que ninguno sea una captura pendiente. `canWork()` es la puerta que usará profesiones — **no se conecta profesiones ahora**.

## 13. Formas, Megas y `formId`

- `formId` es lo que el Pokémon **es**, permanentemente.
- Una Mega/Primal es forma de combate: vive en `BattleRuntimeState.activeFormId` y desaparece al terminar la batalla. `leaveBattle` nunca la escribe en la instancia.
- La fábrica **se niega** a crear una instancia con una forma `isMega` o `isBattleOnly`.
- El catálogo contiene sus datos: `representable != enabled`. Mega sigue deshabilitado como gameplay.

## 14. Fábrica y aleatoriedad

`createPokemonInstanceDraft(spec, catalog, random)` es pura: el RNG se **inyecta**, nadie llama a `Math.random()` dentro del dominio, `at` viene en `acquisition` y el `instanceId` se asigna aparte (`assignInstanceId`). El orden de consumo del RNG es fijo —IVs, naturaleza, habilidad, género, shiny— y un valor que el llamador fija **igual gasta su tirada**, para que fijar uno no mueva los demás. La habilidad oculta no se tira salvo pedido explícito.

## 15. Serialización y versionado

Data plana: JSON-safe, sin clases, sin `Date`, sin funciones. El mismo registro viaja de servidor a cliente y vuelve sin traducción.

`INSTANCE_SCHEMA_VERSION = 2` viaja dentro de cada registro y `validateInstance` rechaza una versión que no conoce.

- **v1 → v2 (R32.2.1):** el desgaste salió de la identidad. `currentHp` y el `currentPP` de cada slot se convirtieron en `condition.currentHp` y `condition.pp`, y el estado mayor se sumó a ellos. Leer un v1 como v2 perdería daño y PP, así que el lector lo rechaza en vez de adivinar. No hay registros v1 en ninguna parte: nada persistía este modelo todavía.

Regla general: un campo opcional nuevo no sube la versión; un campo cuyo significado cambia, sí, y entonces el upgrade se escribe antes que el lector.

## 16. Tests

`npx vitest run src/features/pokemon/model` — **93 tests**.

| Archivo | Qué cubre |
|---|---|
| `stats.test.ts` | Fórmulas Gen VI (Garchomp de referencia, Shedinja), naturalezas, límites IV/EV, experiencia ↔ nivel |
| `instance.test.ts` | Validación, techo de PP con PP Ups, condición inválida, I-1 completo, party de seis |
| `condition.test.ts` | HP/PP/major status/faint **sobreviven**; confusión, stages, Protect, action bar y Mega **no**; poda de PP; JSON-safe |
| `factory.test.ts` | Contra el catálogo real: determinismo, orden de tiradas, rechazo de Megas, habilidades posibles, learnsets, captura pendiente |
| `migration.test.ts` | **Cardinalidad** (un slot con varias progresiones → una sola instancia; la del dueño actual; ex-dueños no crean nada; slot sin dueño no migra; dueño sin progresión usa el default legacy y queda marcado), **identidad sin dueño** (cambio de propietario → mismos IV/naturaleza/habilidad), identidades distintas → valores independientes, determinismo, versión/sal, IVs 0–31 y bien repartidos, EV 0, habilidad normal (nunca oculta), shiny, **xp gana al level guardado**, canonicalización (español, `vise-grip`), incompatibles post-Gen VI, desconocidos, JSON-safe |

## 17. Muestra humana

```bash
npm run pokemon:sample
```

Imprime individuos reales construidos por la fábrica desde el catálogo real, una **captura pendiente de dungeon**, un **Pokémon migrado por el contrato legacy** con su versión/sal y qué se preservó vs. qué se derivó, y la proyección cruda de una fila legacy con sus huecos. No escribe nada y no toca la red.

## 18. Verificación

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | 0 errores (9 warnings preexistentes en `AuthModal.vue`) |
| `npm test` | 114 archivos, 1314 tests, todo verde (114 del modelo) |
| `npm run build` | OK |
| `node scripts/legacy-move-audit.mjs` | determinista: mismo md5 del doc y del mapa generado en dos corridas |

El modelo todavía no lo importa ningún código de aplicación, así que no cambia ningún bundle.

## 19. Preguntas realmente abiertas

1. **Ejecución de la migración**: cuándo y sobre qué universo de slots; y qué se hace con las progresiones históricas (§10.5). La **unidad ya está cerrada**: un slot, un Pokémon.
2. **Backfill de movimientos** (§11): ¿se aprueba la propuesta del learnset ORAS **sólo** para los que caen en C o D?
3. **Probabilidad de shiny** para instancias nuevas: OPEN por decisión explícita.
4. **Hidden Ability**: mecanismo de adquisición futuro; el modelo ya la soporta.
5. **Curva de experiencia**: seguir con L³ o adoptar las seis canónicas (revaluaría niveles existentes).
6. **EVs**: de dónde salen; el modelo los valida (252/510) pero nada los otorga.
7. **Curación**: reglas del Centro Pokémon, objetos y tiempos.
8. **Apodos**: longitud máxima y moderación (no hay UI).

# R32.2 / R32.2.1 — PokemonSpecies / PokemonInstance

> Rama `feat/r32-2-1-model-decisions`, desde `feat/r32-2-pokemon-model` @ `7bf9af9ef520882824a81eb7d2e82de6ef8c51b9`.
> R32.2 (base) introdujo el modelo. **R32.2.1** cierra las decisiones de producto, corrige el corte de estado y formaliza el contrato de migración legacy.
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
2. Dos campos que describen lo mismo se pueden desincronizar. La proyección legacy detecta y reporta ese caso (`levelDisagrees`).
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

### 10.1 Propiedades

| Propiedad | Cómo se consigue |
|---|---|
| Determinista | Todo sale de un hash de datos legacy estables |
| Reproducible | FNV-1a de 32 bits, sin dependencias, portable a SQL u otro lenguaje |
| Versionado | `(salt, version)` queda **dentro** del registro, en `acquisition.migration` |
| No rerrolleable | No se lee reloj, contador ni fuente aleatoria |

```
hash(campo) = FNV1a(`${salt}|v${version}|${userId}|${speciesId}|${campo}`)
```

Cada atributo tiene su **propio** hash en vez de tirar de un stream compartido. Consecuencia deliberada: agregar un atributo mañana **no** mueve los ya asignados, así que el contrato es extensible sin rerrollear Pokémon de nadie.

Versión y sal vigentes: `LEGACY_MIGRATION_VERSION = 1`, `LEGACY_MIGRATION_SALT = "pokeswap-legacy-backfill"`. La sal **no es un secreto**: la migración está pensada para ser reproducible por cualquiera que tenga las mismas filas. Subir la versión produce a propósito Pokémon distintos de las mismas filas, y lo que la fila legacy sí sabía (especie, experiencia, dueño, movimientos, EVs) queda intacto.

### 10.2 Qué se preserva y qué se deriva

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

**El dueño es `pokemon_xp.user_id`**, el jugador que lo entrenó. `slots.owner_id` es quien tiene la **especie** en el mercado, que es otra cosa, y no debe convertirse en dueño del Pokémon.

### 10.3 Qué falta decidir antes de ejecutarla

1. Cuándo corre y sobre qué universo de filas.
2. Qué hacer con las filas cuyo `level` guardado discrepa de su `xp` (el contrato usa `xp`; el nivel se deriva).
3. Si se acepta el backfill de movimientos propuesto en §11 para las filas que llegan sin ningún movimiento resoluble.
4. Si alguna evidencia de shiny se considera inequívoca.

**Nada de esto se aplica sin aprobación humana.**

## 11. Movimientos legacy — auditoría y propuesta

Auditoría completa y reproducible: [`LEGACY_MOVE_AUDIT.md`](LEGACY_MOVE_AUDIT.md), generada por `node scripts/legacy-move-audit.mjs` sobre el tag `v0-legacy-baseline`.

Resumen: de los **965 slugs distintos** que los dos caminos de escritura del monolito podían producir, **561 resuelven** contra el catálogo y **404 no**, por tres causas:

1. **Nombre visible en español** (374 slugs) — el catálogo indexa identificadores de veekun, que son ingleses. Reparable: la propia tabla legacy trae el nombre inglés al lado.
2. **Movimiento posterior a Gen VI** (34 identificadores) — no existe en ORAS; no hay equivalente.
3. **Renombre entre generaciones** (`vise-grip` → en Gen VI es `vice-grip`).

Reglas ya vigentes en el código: un movimiento legacy que resuelve **se preserva**; uno que no resuelve **no se reemplaza en silencio** — se reporta en `MigrationReport.unresolvedMoves`, y si no queda ninguno, `needsMoveBackfill = true`.

**Propuesta de backfill (NO implementada, requiere aprobación):** para una fila sin ningún movimiento resoluble, tomar los últimos cuatro movimientos de nivel del learnset ORAS de su especie/forma al nivel derivado de su experiencia — la misma regla que usa la fábrica para un encuentro salvaje. Es determinista, no necesita hash y no inventa nada que el juego no le daría igual a ese Pokémon.

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
| `migration.test.ts` | Determinismo, versión/sal, IVs derivados 0–31, EV 0, naturaleza, habilidad normal (nunca oculta), shiny, movimientos preservados, JSON-safe |

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
| `npm test` | 114 archivos, 1293 tests, todo verde |
| `npm run build` | OK |
| `node scripts/legacy-move-audit.mjs` | determinista: md5 `5cd1078064db5b756a28534f31b95c89` en dos corridas |

El modelo todavía no lo importa ningún código de aplicación, así que no cambia ningún bundle.

## 19. Preguntas realmente abiertas

1. **Ejecución de la migración**: cuándo, sobre qué universo, y las cuatro decisiones de §10.3.
2. **Backfill de movimientos** (§11): ¿se aprueba la propuesta del learnset ORAS?
3. **Probabilidad de shiny** para instancias nuevas: OPEN por decisión explícita.
4. **Hidden Ability**: mecanismo de adquisición futuro; el modelo ya la soporta.
5. **Curva de experiencia**: seguir con L³ o adoptar las seis canónicas (revaluaría niveles existentes).
6. **EVs**: de dónde salen; el modelo los valida (252/510) pero nada los otorga.
7. **Curación**: reglas del Centro Pokémon, objetos y tiempos.
8. **Apodos**: longitud máxima y moderación (no hay UI).

# R32.2 — PokemonSpecies / PokemonInstance

> Rama `feat/r32-2-pokemon-model`, desde `feat/r32-1-battle-catalog` @ `a8984a7d98f822fcea7d9840fa0076c48f1fa2fe` (R32.1 HUMAN APPROVED).
> **Solo modelo, validación, fábrica, adaptadores, tests y documentación.** No hay combate (R32.3), ni UI, ni autoridad de servidor, ni migración aplicada a producción.
> Catálogo de referencia: `1.oras.ab69b5804411` (ORAS / Generación VI, 493 especies).

---

## 1. Qué es

El modelo canónico de **un Pokémon concreto** en PokeSwap: su naturaleza, sus IVs, sus EVs, sus movimientos, su dueño y su origen. Es la pieza que hoy no existe en producción.

Lo que **no** es: no es la especie (eso es el Battle Catalog, R32.1), no es lo que pasa dentro de un combate (eso es el runtime, y sus reglas son R32.3) y no es un esquema de base de datos (eso es R32.4, cuando haya decisión humana).

## 2. El corte en tres

| Capa | Dónde vive | Qué contiene | Quién la escribe |
|---|---|---|---|
| **Especie / forma** | `src/features/battle/catalog/` | Stats base, tipos, habilidades posibles, learnset, ratio de género, catch rate | Nadie: es generada y de solo lectura |
| **Instancia** | `src/features/pokemon/model/instance.ts` | Naturaleza, IVs, EVs, experiencia, movimientos con PP, daño arrastrado, dueño, procedencia | El servidor, al crear/alterar un Pokémon |
| **Runtime** | `src/features/pokemon/model/runtime.ts` | Estado mayor, confusión, stages, forma activa (Mega), protección | El combate, y muere con él |

La regla para decidir dónde va un dato: **¿seguiría siendo verdad mañana, fuera de combate?** Una quemadura sí; un −2 de Ataque no. HP y PP son los dos que cruzan de vuelta, porque el costo de un piso de dungeon tiene que acompañarte al siguiente (D1).

Nada de la especie se copia dentro de la instancia. La instancia guarda `speciesId` y `formId` y nada más: si el catálogo se regenera, no hay 40 000 filas que corregir.

## 3. Archivos

| Archivo | Qué resuelve |
|---|---|
| `stats.ts` | Fórmulas de stats de Gen VI, naturalezas, límites de IV/EV, validación |
| `experience.ts` | Experiencia ↔ nivel, sobre la curva L³ que ya usa producción |
| `instance.ts` | `PokemonInstance`, `MoveSlot`, propiedad, procedencia, `validateInstance`, las dos transiciones de I-1 |
| `runtime.ts` | `PokemonRuntimeState`, `enterBattle`, `leaveBattle` |
| `party.ts` | Party activa de seis (A-1), `canWork` |
| `catalogView.ts` | La vista angosta del Battle Catalog que el modelo consume |
| `factory.ts` | Creación pura con RNG inyectado |
| `legacy.ts` | Proyección de las filas actuales de producción, sin inventar nada |
| `index.ts` | Barril: se importa desde acá |

## 4. Nivel vs experiencia — **decisión: se persiste la experiencia**

`PokemonInstance.experience` es la única fuente de verdad; el nivel se **deriva** (`levelForExperience`) y nunca se guarda al lado.

Por qué:

1. Es lo que producción ya hace. El RPC `grant_pokemon_xp` otorga XP y recalcula el nivel; el cliente lee la misma fórmula en `progression/utils/xpLevel.ts`.
2. Dos campos que describen lo mismo se pueden desincronizar. La proyección legacy detecta y reporta ese caso (`levelDisagrees`); si existe o no en los datos reales es algo que hay que medir contra producción, no algo que yo haya verificado acá.
3. Un cambio de curva futuro se aplica en un solo lugar.

La curva sigue siendo la de PokeSwap (XP de L a L+1 = L³, tope 100), no las seis curvas canónicas de Gen VI. El catálogo trae el `growthRate` de cada especie, así que adoptarlas es posible más adelante — pero **re-valuaría a todos los Pokémon existentes**, así que es decisión de producto y queda en §12.

## 5. Qué se guarda y qué se deriva

**Se guarda:** experiencia, naturaleza, habilidad, IVs, EVs, movimientos (`moveId` + `ppUps` + `currentPP`), HP actual (o `null` = sano), estado, propiedad, procedencia, shiny, género, apodo.

**Se deriva, nunca se guarda:** nivel, stats actuales, `maxPP` de cada slot (PP base del catálogo + 20 % por PP Up), tipos, habilidades posibles, peso, catch rate.

`maxPP` no se guarda a propósito: si algún día cambia el PP de un movimiento, un valor guardado quedaría mintiendo. `ppUps` sí se guarda desde el día uno, para que sumar PP Ups después sea una feature y no una migración.

## 6. Propiedad y procedencia

```ts
ownership: { ownerId: string | null, originalTrainerId: string | null }
acquisition: { source, at, catalogVersion, ref? }
```

- `ownerId` es un string opaco para esta capa: el modelo no importa auth, ni Supabase, ni sesión. Quien persiste decide que es un id de perfil.
- `originalTrainerId` no cambia cuando cambia el dueño.
- `acquisition.at` es ISO-8601 en string, no `Date`: el registro tiene que sobrevivir un `JSON.stringify` sin traducción.
- `acquisition.catalogVersion` deja trazable contra qué catálogo se tiró ese Pokémon.
- `source` es extensible: `starter`, `adoption`, `market`, `trade`, `swap`, `dungeon_capture`, `event`, `migration`.

## 7. Captura pendiente de expedición (I-1)

Un Pokémon capturado dentro de un dungeon **no es del jugador todavía**. Se modela como un estado de la instancia, no como otro tipo de registro:

```
capturado   → state: 'expeditionPending', ownerId: null
retirada OK → secureCapture()  → state: 'owned', ownerId, originalTrainerId
wipe        → el registro no cruza nunca a persistencia (isLostOnWipe)
```

Consecuencias que el código hace cumplir:

- `validateInstance` rechaza una captura pendiente que ya tenga dueño.
- `createExpeditionCapture` / la fábrica se niegan a crearla con `ownerId`.
- `validateParty` rechaza una captura pendiente como miembro de la party: todavía no es de nadie, así que no puede ser uno de los seis.

## 8. Party activa (A-1)

Seis como máximo, y **los mismos seis** sirven para exploración, combate, dungeon y profesiones. La party es una lista de **ids**, no de Pokémon: copiar seis registros enteros daría dos lugares donde actualizar lo mismo. `canWork()` es la puerta que usa profesiones.

## 9. Auditoría del modelo legacy

Lo que hay hoy en producción, leído de `src/shared/types/database.ts` y de las migraciones:

| Tabla | Grano | Qué guarda |
|---|---|---|
| `slots` | **una fila por especie** (`pokemon_id`), dueño global único | precio, aura, energía, dueño, primer dueño |
| `pokemon_xp` | (usuario, especie) | `xp`, `level` recalculado por `grant_pokemon_xp`, `moves` JSON |
| `pokedex_entries` | (usuario, especie) | registro de descubrimiento |
| `swap_history.was_shiny` | evento | lo único que menciona shiny en todo el sistema |

**Hallazgo central: PokeSwap no tiene hoy Pokémon individuales.** No hay dos Pikachu; hay *el* Pikachu. Y no existen —ni se pueden reconstruir— naturaleza, IVs, EVs, género, forma, PP ni habilidad.

Por lo tanto `PokemonInstance` es un concepto **nuevo**, no una evolución de una fila existente. No hay "migración de esquema": hay una decisión de producto sobre qué se le da a cada jugador.

## 10. Propuesta de migración — **requiere aprobación antes de aplicarse**

Nada de esto está implementado ni conectado. `legacy.ts` sólo **proyecta**: devuelve lo que la fila realmente sabe (especie, experiencia, nivel derivado, dueño, movimientos que resuelven contra el catálogo) y una lista de `gaps` con todo lo que producción no puede responder. No inventa naturaleza, IVs, EVs, género ni shiny.

Tres estrategias posibles, en orden de preferencia:

**M-1 — Backfill determinista por hash (recomendada).** Naturaleza, IVs, género y habilidad se derivan de un hash estable de `(user_id, pokemon_id, sal fija)`. Ventajas: reproducible, sin estado, el mismo jugador obtiene siempre el mismo Pokémon, y se puede calcular en cliente y servidor y comparar. Desventaja: los valores son arbitrarios aunque estables.

**M-2 — Valores neutros.** IVs fijos (por ejemplo 15), naturaleza neutra, habilidad slot 1. Ventaja: nadie sale favorecido. Desventaja: todos los Pokémon viejos son idénticos y sin identidad, y el día que se agregue crianza quedan marcados como "los de antes".

**M-3 — Rerroll a la vista.** El jugador ve su Pokémon legacy y la primera vez que lo lleva a combate se le tira el individuo delante suyo. Ventaja: es un momento de juego en vez de un dato inventado. Desventaja: necesita UI y una fecha de corte.

Decisiones que la migración necesita en cualquier caso y que **no** tomo acá: qué EVs arrancan (la propuesta es cero en las tres), si el shiny de `swap_history` se honra, qué pasa con los `moves` que no resuelven, y si el dueño del Pokémon migrado es el de `pokemon_xp.user_id` (mi lectura: sí — `slots.owner_id` es quien tiene la **especie** en el mercado, que es otra cosa).

## 11. Formas, Megas y `formId`

- `formId` es lo que el Pokémon **es**, permanentemente. Charizard y Charizard-Mega-X son dos formas de la misma especie, nunca dos especies.
- Una Mega es una forma de combate: vive en `PokemonRuntimeState.activeFormId` y en ningún otro lado, así que no puede sobrevivir a la batalla por accidente. `leaveBattle` no la devuelve.
- La fábrica **se niega** a crear una instancia con una forma `isMega` o `isBattleOnly`, con un error explícito.
- Las formas permanentes reales (Deoxys, Rotom, Giratina, Wormadam, Shaymin) sí se crean con `formId` explícito: son lo que el Pokémon es.

## 12. Fábrica y aleatoriedad

`createPokemonInstanceDraft(spec, catalog, random)` es pura:

- El RNG se **inyecta**. Nadie llama a `Math.random()`, ni lee el reloj, ni genera ids: `at` viene en `acquisition`, el id se asigna aparte (`assignInstanceId`). Aleatoriedad persistente es del servidor (AGENTS.md §11).
- El orden de consumo del RNG es fijo: IVs (hp, atk, def, spa, spd, spe) → naturaleza → habilidad → género → shiny. Un valor que el llamador fija **igual gasta su tirada**, para que fijar la naturaleza de un fixture cambie la naturaleza y nada más.
- La habilidad oculta no se tira salvo que se pida (`allowHiddenAbility`): en los juegos requiere Hidden Grotto / Friend Safari, y PokeSwap no decidió cuál tiene.
- Movimientos por defecto: los últimos cuatro de nivel que conocería a ese nivel, como un encuentro salvaje. Nunca queda sin movimientos.
- Separación explícita entre **generar el individuo** (draft, sin id) y **asignarle identidad** (id del que persiste: uuid, default de base de datos, lo que sea).

## 13. Serialización y versionado

`PokemonInstance` es data plana: JSON-safe, sin clases, sin `Date`, sin funciones, sin estado escondido. El mismo registro viaja de servidor a cliente y vuelve sin traducción, que es lo que va a necesitar R32.4.

`INSTANCE_SCHEMA_VERSION = 1` viaja **dentro** de cada registro. `validateInstance` rechaza una versión que no conoce en vez de leerla mal. La regla: un campo nuevo opcional no sube la versión; un campo cuyo significado cambia, sí, y entonces se escribe el upgrade antes de escribir el lector.

`acquisition.catalogVersion` es la otra mitad del versionado: dice contra qué catálogo se generó ese individuo.

## 14. Validación

`validateInstance(instance, catalog)` devuelve **una lista de frases**, no lanza y no corta en el primer problema: una migración quiere saber todo lo que está mal con un registro, no lo primero. Cubre esquema, experiencia, especie/forma coherentes, naturaleza y habilidad existentes, habilidad posible para esa forma, movimientos del catálogo, sin duplicados, PP Ups 0–3, PP dentro del máximo real, HP, apodo y la regla I-1.

## 15. Tests

`npx vitest run src/features/pokemon/model` — 52 tests.

| Archivo | Qué cubre |
|---|---|
| `stats.test.ts` | Fórmulas Gen VI contra el Garchomp de referencia (nivel 78), Shedinja, naturalezas, límites de IV/EV, ida y vuelta experiencia ↔ nivel |
| `instance.test.ts` | Validación, PP con PP Ups, I-1 completo, `enterBattle`/`leaveBattle`, party de seis |
| `factory.test.ts` | Contra el **catálogo real**: determinismo por semilla, estabilidad del orden de tiradas, rechazo de Megas y niveles imposibles, habilidades posibles, learnsets, captura pendiente, proyección legacy |

## 16. Muestra humana

```bash
npm run pokemon:sample
```

Imprime individuos reales construidos por la fábrica desde el catálogo real —Pikachu nivel 5 y 50, Charizard, Gengar, Shuckle, Ninjask—, más una **captura pendiente de dungeon** y la proyección de una fila legacy con sus huecos. No escribe nada y no toca la red. La semilla es fija; `npm run pokemon:sample -- --seed 1234` cambia el individuo.

## 17. Verificación

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | 0 errores (9 warnings preexistentes en `AuthModal.vue`) |
| `npm test` | 112 archivos, 1252 tests, todo verde |
| `npm run build` | OK |

El modelo todavía no lo importa ningún código de aplicación, así que no cambia ningún bundle.

## 18. Preguntas abiertas (necesitan decisión humana)

1. **Migración**: cuál de M-1 / M-2 / M-3, y las cuatro decisiones de §10.
2. **Curva de experiencia**: ¿se queda la curva L³ de PokeSwap o se adoptan las seis curvas de Gen VI (y se re-valúa todo lo existente)?
3. **Estado mayor entre combates**: ¿una quemadura sobrevive al combate? Hoy no se persiste, por no inventar la respuesta.
4. **Habilidad oculta**: ¿cómo se obtiene en PokeSwap? Hasta que se decida, no se tira sola.
5. **Shiny**: la probabilidad por defecto es 1/4096; ¿PokeSwap quiere la suya, y honra el `was_shiny` histórico?
6. **EVs**: ¿de dónde salen? El modelo los valida (252/510) pero nada los otorga todavía.
7. **Apodos**: ¿longitud máxima y moderación?
8. **Curación**: HP y PP se arrastran; falta decidir dónde se recuperan (centro Pokémon, tiempo, objeto).

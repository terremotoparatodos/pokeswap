# R32.1 — Battle Catalog

> Rama `feat/r32-1-battle-catalog`, desde `integration/r31` @ `7c3af212d0cfb604b0741c89a7e54028c26fb2f0`.
> **Solo catálogo, pipeline, validación y documentación.** No hay `PokemonInstance`, ni combate productivo, ni autoridad, ni UI.
> Ruleset: **ORAS / Generación VI**. Alcance v1: **las 493 especies** que PokeSwap usa hoy, y todas sus formas de Gen VI.

---

## 1. Qué es

Una descripción propia, generada y de solo lectura, de lo que necesita una batalla: especies, formas, movimientos, habilidades, learnsets de ORAS, tabla de tipos y naturalezas. Cliente y servidor leen los mismos archivos. **No se consulta ninguna red durante el juego.**

Lo que **no** es: no es un motor de combate (eso es R32.3) y no es un Pokémon que se posee (eso es `PokemonInstance`, R32.2).

## 2. Pipeline

```text
fuentes fijadas por commit
   → node scripts/battle-catalog/fetch.mjs      (caché en node_modules/.cache, ignorada por Git)
   → node scripts/battle-catalog/build.mjs      (normaliza, corrige a Gen VI, valida, versiona)
   → src/features/battle/catalog/generated/     (el catálogo, propio de PokeSwap)
```

| Comando | Qué hace |
|---|---|
| `npm run catalog:fetch` | Descarga las tablas al caché y escribe un manifiesto con el sha256 de cada archivo |
| `npm run catalog:build` | Genera el catálogo y `report.json`; sale con error si encuentra una inconsistencia |
| `npm run catalog:sample` | Imprime la muestra del gate humano |

**Determinista:** todo se ordena por id y se serializa igual, así que las mismas fuentes producen el mismo byte. Verificado corriendo el build dos veces y comparando md5.

**Reproducible:** las fuentes están fijadas por commit y el manifiesto guarda el hash de cada archivo descargado; el catálogo registra ambos en `provenance`.

## 3. Fuentes y licencias

| Fuente | Rol | Licencia | Commit |
|---|---|---|---|
| [veekun/pokedex](https://github.com/veekun/pokedex) | Datos tabulares: especies, stats, tipos, movimientos, learnsets, habilidades, naturalezas, tabla de tipos | **MIT** | `cc483e1877f22b8c19ac27ec0ff5fafd09c5cd5b` |
| [smogon/pokemon-showdown](https://github.com/smogon/pokemon-showdown) | **Capa de corrección a Gen VI** (`data/mods/gen6/pokedex.ts`) y referencia semántica leída por humanos | **MIT** | `2ddfa0476f8207e12e204b1c69f7c7683b17633c` |
| [PokeAPI](https://github.com/PokeAPI/pokeapi) | Solo verificación cruzada. No se usa en el pipeline ni en runtime | BSD-3-Clause | — |

> **Ampliación del rol de Showdown respecto de lo aprobado en Q-1.** La aprobación decía "referencia semántica". Al construir el catálogo apareció un problema de corrección: las tablas de veekun traen los valores **actuales**, no los de Gen VI, y no guardan historia de stats ni de habilidades por especie. Sin corregirlo, el catálogo diría "Gen VI" y traería a Gengar con *Cursed Body* (Gen VII) y a Arbok con sus stats posteriores. `data/mods/gen6/pokedex.ts` es exactamente ese diff, es MIT y está fijado por commit, así que el build lo lee y aplica sus overrides de stats y habilidades. **Sigue sin copiarse una sola línea de su lógica de combate.** Si preferís no depender de esa fuente para datos, la alternativa es mantener a mano una tabla de correcciones nuestra; decilo y la cambio.

Pokémon y los nombres de Pokémon son marcas de Nintendo, Creatures Inc. y GAME FREAK Inc. PokeSwap es un proyecto de fans sin fines comerciales. **No se copia texto descriptivo, sprites ni assets:** solo datos estructurados.

## 4. Qué se genera

| Archivo | Contenido | Tamaño |
|---|---|---|
| `generated/version.ts` | `CATALOG_VERSION`, importable de forma síncrona por cliente y servidor | 0,3 KB |
| `generated/core.json` | Versión, procedencia, tipos, tabla de tipos, naturalezas, habilidades, especies y formas | 272 KB |
| `generated/moves.json` | Movimientos con valores de Gen VI | 365 KB |
| `generated/learnsets.json` | Learnsets de ORAS por forma | 562 KB |
| `generated/report.json` | Conteos, correcciones aplicadas e incidencias | 0,4 KB |

### Cobertura

| | |
|---|---|
| Especies | **493** (1–493), cada una con exactamente una forma por defecto |
| Formas | **562**, de las cuales **46 megas** de Gen VI |
| Movimientos | **621** de Gen VI; **415 ejecutables** por las reglas previstas, 206 marcados pendientes |
| Habilidades | **191** |
| Learnsets | **562** formas, 0 sin learnset |
| Naturalezas | 25 (5 neutras) |
| Tipos | 18, con la fila Hada y sin las resistencias de Acero que Gen VI eliminó |
| Correcciones a Gen VI | 22 de stats, 7 de habilidades, 0 de tipos |

## 5. `catalogVersion`

Formato `1.oras.<12 hex>`, donde el hash sale del contenido generado. Aparece en los cuatro archivos y en `version.ts`.

Para qué sirve, desde ahora: **cliente y servidor pueden rechazar una acción que venga con otra versión** en lugar de resolverla contra un catálogo distinto. El lector ya falla si los archivos no coinciden entre sí.

## 6. Efectos de movimientos

No se vendoriza lógica ajena. El catálogo describe cada movimiento con un `effectId` **nuestro**, derivado de columnas estructuradas (clase de daño, categoría, estado, golpes, drenaje, flags):

`damage` · `damage.multiHit` · `damage.drain` · `damage.recoil` · `damage.selfKo` · `damage.recharge` · `damage.ailment` · `damage.statChange` · `damage.flinch` · `ailment` · `statChange` · `heal` · `protect` · `ohko` · `forceSwitch` · `fieldEffect.side` · `fieldEffect.all` · `unique`

Cada movimiento trae además `supported: boolean` y, cuando no lo es, `unsupportedReason`. **Nada se adivina**: un movimiento que las reglas no puedan ejecutar se marca en vez de tratarse como un golpe normal.

### Pendientes declarados (206 movimientos)

| Motivo | Movimientos | Qué falta |
|---|---|---|
| `effect unique` | 86 | Familias con regla propia (Rest, Substitute, Transform…) |
| `effect fieldEffect.all` / `.side` | 26 | Clima, terreno, pantallas, trampas |
| `charge turn` | 14 | Solar Beam, Fly, Dig: un turno de carga en una barra de tiempo real |
| `effect damage.recoil` | 9 | Retroceso |
| `effect damage.recharge` | 7 | Hyper Beam y familia |
| `effect ohko` | 4 | Fissure, Guillotine… |
| `effect forceSwitch` | 2 | Whirlwind, Roar |
| `effect damage.selfKo` | 2 | Explosion, Self-Destruct |
| `variable power` | 36 | Potencia calculada: Seismic Toss, Low Kick, Return, Gyro Ball, los contraataques |
| `ailment …` | 26 | Volátiles fuera de los seis estados mayores: trap, leech-seed, yawn, torment… |

Cada uno es trabajo concreto de R32.3, no una laguna del catálogo.

## 7. Cómo se carga

- `CATALOG_VERSION` se importa de forma estática: es una cadena y no pesa.
- Todo lo demás llega por `loadBattleCatalog()`, que hace `import()` dinámico: el catálogo es su propio chunk y no entra en la carga inicial.
- Los learnsets son la tabla más grande y la que menos se usa, así que van aparte, con `loadLearnsets()`.
- Hoy **nada de producción lo importa**, así que el bundle no cambió ni un byte. El chunk aparecerá cuando llegue su primer consumidor (R32.2).

## 8. Validación

`src/features/battle/catalog/catalog.test.ts`, 20 tests: versión igual en los cuatro archivos y con formato; procedencia con commit y licencia de ambas fuentes; `report.issues` vacío; las 493 especies sin huecos ni duplicados; una forma por defecto por especie; tipos, stats y habilidades existentes y en rango; ids de movimiento únicos y columnas válidas; coherencia entre `supported` y `unsupportedReason`; **valores de Gen VI** (Thunder Wave 100, Dark Void 80, Tackle 50, Fell Stinger 30, Knock Off 65); **correcciones de Gen VI** (Gengar con Levitate, stats de Arbok, Pelipper y Torkoal); formas de las cinco especies del gate; learnsets que solo apuntan a movimientos y formas existentes; tabla de tipos y naturalezas; y el lector con su indexado y su cálculo de efectividad.

El build además falla si detecta una incidencia, y `report.json` las registra.

## 9. Límites conocidos

- **Habilidades:** el mapa especie → habilidad viene de la tabla actual, corregido con el diff de Gen VI. Lo que ninguna de las dos fuentes distingue bien es *cuándo se liberó* una habilidad oculta; para R32.1 eso no importa porque **ninguna habilidad se ejecuta todavía**.
- **Formas:** se incluyen las que existían hasta ORAS. Las de Gen VII en adelante quedan fuera por definición del ruleset.
- **Learnsets:** solo ORAS (`version_group 16`), con métodos nivel, MT, huevo y tutor.
- **Sin experiencia:** se guarda `growthRate` por especie, pero no la curva; la necesita `PokemonInstance` (R32.2).
- **Sin ítems, sin Mega Piedras, sin naturalezas aplicadas:** nada de eso se modela todavía.
- **Ampliar el alcance** más allá de 493 es cambiar una constante del build; el schema no cambia.

## 10. Qué sigue

R32.2 define `PokemonSpecies`/`PokemonInstance` sobre este catálogo, y R32.3 porta las reglas del prototipo para ejecutar los `effectId` marcados como soportados. La lista de pendientes de §6 es la agenda concreta de esa fase.

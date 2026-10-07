# ECO-2A — Motor de población de encuentros (núcleo aislado)

> Rama `world/eco-2a-encounter-engine-0.3`, desde `world/eco-1-encounter-catalog-0.3 @ 162b86fc9309edc698cd2eb3d0724388fe899a37`. La rama ECO-1 no se modificó.
> **Núcleo de dominio sin conectar.** No toca `worldRoom.js`, `wildService.js`, presencia, sesiones, protocolo, Cloud, roster, UI, SQL, migraciones, bundles ni dependencias. No crea Pokémon persistentes ni entrega recompensas.

---

## 1. Resumen

`src/features/ecosystem/population/` es un motor puro de nidos, grupos, límites y respawn sobre el catálogo ECO-1. Lo importa con imports normales y no copia datos.

- **Tiempo y aleatoriedad explícitos:** `now` y `random` se reciben en cada llamada. No hay `Date.now`, `Math.random`, timers ni red; un test lo verifica sobre el código fuente.
- **Una evaluación es idempotente en el tiempo:**
  - cada tick hace **a lo sumo un intento por nido**;
  - un intento fallido se reprograma `retryMs` después;
  - repetir la evaluación en el mismo instante no crea, no reinicia demoras y no avanza generaciones;
  - un salto de 30 días da un intento por nido, no un catch-up.
- **Límites:** se respetan el tope del nido, el tope del área y el `groupCap`. El motor sólo usa casillas candidatas del nido que la geometría declara abiertas y que no ocupa otro encuentro suyo. Sin casilla, no aparece nada.
- **Identidad:** `id = <namespace>:<área>:<nido>:<generación>:<miembro>`. La generación del nido sólo crece, así que un id nunca se reutiliza dentro de un namespace. El namespace lo provee la futura autoridad.
- **Retirada:** retirar un encuentro que no está vivo es un no-op. No programa un segundo respawn ni reinicia la demora.
- **Área vacía:** se distinguen `idle` (sin simular, conserva lo vivo), `dormant` (limpiada y sin simular) y "activa con todo derrotado". No hay acumulación ni catch-up.

## 2. Modelo y API

| Archivo | Responsabilidad | Líneas |
| --- | --- | --- |
| `types.ts` | Entradas confiables, estado privado, eventos y resultados | 173 |
| `ids.ts` | `nestKey`, `groupIdOf`, `encounterIdParts` | 33 |
| `config.ts` | `PROVISIONAL_RESPAWN`, `PROVISIONAL_IDLE`, `validatePopulationConfig` (14 códigos) | 95 |
| `engine.ts` | `createPopulation`, `tickPopulation`, `retireEncounter` | 184 |
| `projection.ts` | `publicArea`: lo único publicable | 32 |
| `testing.ts` | Helpers de test: RNG sembrado y guionado, geometría de grilla, verificador de invariantes. **Tiles sintéticas, no posiciones del mapa** | 83 |

**Conceptos separados:**

| Concepto | Dónde |
| --- | --- |
| Identidad del encuentro | `PopulationEncounter.id` |
| Especie | `speciesId` |
| Familia evolutiva | `familyId` (del catálogo) |
| Grupo de aparición | `groupId` (= id sin el miembro) + `member` + `groupSize` |
| Generación de población | `generation` (por nido; sólo crece) |

Dos ejemplares de la misma especie coexisten: dentro de un grupo (tres Zubat) y entre nidos (test).

```ts
createPopulation(config, { catalog })                       → { ok, state } | { ok: false, issues }
tickPopulation(state, config, { catalog }, { now, activeAreas, geometry, random })
                                                            → { ok, state, events } | { ok: false, reason: 'clock-regressed' | 'namespace-mismatch' }
retireEncounter(state, config, { encounterId, cause, now, random })
                                                            → { ok, state, retired, cause, dueAt } | { ok: false, reason: 'not-alive' | 'clock-regressed' }
publicArea(state, areaId)                                   → { simulated, encounters: [{ id, groupId, speciesId, tile }] }
```

**Un intento de aparición** (nido con `dueAt ≤ now` en un área activa):

1. `room = min(hueco del nido, hueco del área, casillas abiertas libres, groupCap)`. Si es 0, falla con `nest-full`, `area-full` o `no-open-tile`, sin geometría falla con `no-geometry`, y se reprograma `retryMs`.
2. `pickEncounter` de ECO-1 con un ticket de `random` y un filtro: hábitat del nido y `group.min ≤ room`. No redistribuye: `empty-tier` e `invalid-distribution` fallan y se reprograman.
3. Tamaño en `[group.min, min(group.max, room)]` y casillas sin repetir entre las abiertas.
4. Generación + 1 y un id por miembro.

**Retirada:** `cause ∈ defeated | captured | fled` son causas **simuladas**. No autorizan captura ni pagan nada.

**Contrato de integración:**

| Tipo de dato | Contenido |
| --- | --- |
| Entradas confiables (las construye el servidor, nunca el cliente) | `PopulationConfig` (namespace, áreas, nidos, casillas, límites, políticas); `activeAreas` (presencia); `geometry(areaId).isOpenTile` (paredes, portales, obstáculos, recursos, reservas y **cualquier ocupación externa**: es responsabilidad de la integración); `random` (CSPRNG); `now` (reloj del servidor); los `retire` (resultado de un combate o captura futuros) |
| Estado privado | `PopulationState`: `dueAt`, generaciones, `rarity`, `entryId`, `lastTickAt`. No se envía al cliente |
| Publicable | `publicArea`: id, grupo, especie y casilla. Sin `dueAt`, rareza, entrada ni RNG (test). Un área no simulada se publica como `simulated: false`, nunca como "todo derrotado" |

## 3. Ejemplo reproducible

Script fuera del repo que usa el motor y los helpers de test: dos nidos en `cueva-inicial`, `seeded(42)`, namespace `demo-epoch-1`. Dos ejecuciones dieron una salida byte a byte idéntica (md5 `8fc5f48a…`).

```text
t=0      area-status dormant→active · dueAt 11011, 9483
t=15000  [["demo-epoch-1:cueva-inicial:n1:1:0",46,"3,1"],["demo-epoch-1:cueva-inicial:n2:1:0",74,"2,2"],["demo-epoch-1:cueva-inicial:n2:1:1",74,"1,2"]]
retire   demo-epoch-1:cueva-inicial:n1:1:0 → dueAt 95000
retire²  not-alive
t=200000 spawned demo-epoch-1:cueva-inicial:n1:2:0#50
```

Lectura:
- la cueva despierta escalonada;
- aparecen Paras y un par de Geodude, dos ejemplares de la misma especie con identidades distintas;
- la retirada del único miembro de `n1` programa el respawn a 75 s;
- la segunda retirada no hace nada;
- el respawn es la generación 2, con otro id.

## 4. Políticas provisionales (no son balance aprobado)

| Parámetro | Valor | Origen |
| --- | --- | --- |
| Respawn | `per-group`, 75 s ± 20 %, reintento 15 s | Propuesta §B.1–B.2 |
| Dormancia | 5 min sin jugadores | Propuesta §B.1 |
| Escalonado al despertar | 5–15 s | Propuesta §B.1 |
| Topes de nido y área, `groupCap`, casillas | **Sin valores de mapa.** Los fija la integración por nido. Los tests usan grillas sintéticas | — |

**Reposición por miembro o por grupo** (configurable por nido):

| Política | Comportamiento | Consecuencias |
| --- | --- | --- |
| `per-group` *(por defecto)* | El nido vuelve sólo cuando su grupo entero se fue, `delayMs` después de la última retirada | Ciclos legibles ("despejé el nido → vuelve"). Un grupo a medio derrotar no repone. Densidad más baja |
| `per-member` | La primera retirada desde la última aparición programa un relleno a `delayMs`; las siguientes no lo atrasan. El relleno es un grupo nuevo del tamaño del hueco | Nido siempre casi lleno, más densidad, grupos parciales o mezclados (p. ej. un Zubat que queda y un Geodude nuevo). Más presión de farmeo |

**Área vacía:**

| Estado | Cuándo | Qué pasa |
| --- | --- | --- |
| `active` | Hay jugadores | Se simula |
| `idle` | Se fueron todos | No se simula. Los vivos se conservan y los `dueAt` no corren en la práctica: no hay intentos |
| Vuelta desde `idle` | — | Los nidos vencidos se escalonan, sin catch-up |
| `dormant` | `idle` ≥ `dormantAfterMs` | Se limpian los vivos (evento con los ids), se olvidan los `dueAt` y las generaciones **se conservan** |
| Vuelta desde `dormant` | — | Relleno escalonado con generación nueva |

Ninguna de estas transiciones crea encuentros mientras nadie mira, así que no hay acumulación.

**Decisiones pendientes:**
- valores reales y política por zona;
- si una vuelta temprana desde `idle` debería conservar la demora restante en lugar de escalonar;
- reloj de aparición (D-TM1);
- tasa shiny (D-SH1, no modelada);
- nivel del encuentro (no modelado);
- combate compartido (D-CB1);
- qué casillas propone el mapa (abajo).

**Posiciones de nidos (sólo propuesta, nada cambiado):**
- `cueva-inicial`: 2–4 nidos sobre el suelo del interior (`caveLayouts.js`), excluyendo radio 3 alrededor de `S` y `E`, con los L sólo en la zona central (propuesta §B.2).
- Pradera: nidos dentro de `bosque` y fuera de reservas, rutas, stands y aproximación de llegada.

La integración debe derivarlos con guardas, igual que `caves.test.js` hace con las bocas.

## 5. Pruebas

Node **v22.23.3** portátil, ya verificado contra el SHA-256 oficial (ECO-1 addendum), usado por ruta explícita.

| Gate | Resultado |
| --- | --- |
| Tests de ECO-1 + motor (`vitest run src/features/ecosystem`) | **9 archivos, 86 tests ✔** (ECO-1 46 + motor 40) |
| Typecheck (`vue-tsc`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores. 9 warnings preexistentes, ninguno en `ecosystem` |
| `git diff --check 162b86f..HEAD` | exit 0 |
| Aislamiento | Test: nada fuera de `src/features/ecosystem` importa el motor. Además, `vite build` (exit 0, 425 módulos, igual que la base) no contiene strings del motor |

**Cobertura:**

- **Grupos y repetidos:** una colonia de 3 Zubat con 3 ids, el mismo `groupId`, miembros 0–2 y casillas distintas; Zubat en dos nidos a la vez.
- **Exclusiones:** un catálogo contaminado con Mewtwo de peso 1 000 nunca lo hace aparecer en 200 ticks; un nido de techo sólo da Zubat y Golbat, y sus tiers sin candidatos dicen `empty-tier`.
- **Límites:** 400 ticks con retiradas al 30 % verificando invariantes en cada paso; `area-full` observado; `groupCap 1` impide las colonias.
- **Sin posiciones:**
  - todo bloqueado da `no-open-tile` sin encuentros;
  - sin geometría da `no-geometry`;
  - una sola casilla impide los grupos de 2+;
  - nidos con casillas compartidas nunca apilan encuentros.
- **Retirada duplicada:** el segundo intento devuelve `not-alive` con el estado idéntico. Un id desconocido o de otro namespace también da `not-alive`.
- **Respawn:**
  - `per-group`: nada a `due − 1`, aparece en `due`, y una vez después nada más;
  - retirar uno de varios no programa nada;
  - `per-member`: la segunda retirada no atrasa el relleno.
- **Mismo instante:** sin eventos ni cambios, también después de un intento fallido.
- **Salto de 30 días:** exactamente un intento por nido y generación + 1.
- **Reloj hacia atrás:** se rechaza (tick y retirada).
- **Random fuera de [0,1):** `RangeError`.
- **Reproducible y sin mutar la entrada:** test.
- **Área vacía:**
  - `idle` conserva y no publica;
  - la vuelta rápida conserva;
  - a los 5 min pasa a `dormant` y limpia (evento con ids);
  - un día después sigue vacía;
  - la vuelta rellena con generación 2 e ids nuevos;
  - "activa con todo derrotado" ≠ "no simulada".
- **Identidad:** 200 ciclos sin repetir ningún id; generaciones monótonas; otro namespace da otros ids; un estado de otro namespace se rechaza.
- **Configuración inválida:** namespace o id con `:`, duplicados, topes no enteros, `retryMs 0` (bucle), jitter > 0,5, política desconocida, `idle` incoherente, zona inexistente o de otra área, hábitat desconocido o sin entradas, casillas vacías, fraccionarias o repetidas.
- **Pool vacío o distribución inválida:** shares en 0 dan `invalid-distribution` y una zona con todas sus especies excluidas da `empty-tier`; ninguno de los dos crea encuentros.
- **Proyección:** sólo `{ id, groupId, speciesId, tile }`.
- **El verificador de invariantes** tiene sus propios controles negativos: nido excedido, área excedida, id duplicado, casilla doble, fuera del nido, casilla bloqueada y generación futura.

**Controles negativos dirigidos** (mutaciones manuales sobre `engine.ts`, restauradas con `git checkout`). Todos fallan con `AssertionError` de su causa; ninguno por timeout:

| Mutante | Falla con |
| --- | --- |
| N1 sin tope de área | `area cueva-inicial holds 6 > 5` (y `2 > 1`) |
| N1b sin tope de nido | `nest n1 holds 4 > 3` |
| N2 doble retirada aceptada | El segundo `retire` da `ok: true` en lugar de `not-alive` |
| N3 demora reiniciada en cada evaluación | Los nidos nunca vencen: sin apariciones, y "respawn en `due`" falla |
| N4 identidad reutilizada (generación fija) | `…:n1:1:0: expected true to be false` (id ya visto) y generaciones que no crecen |
| N5 fallo sin reprogramar | Un `spawn-failed` nuevo en la segunda evaluación del mismo instante |
| N6 catch-up tras un salto de reloj | "Un intento por nido": 2 eventos en lugar de 1, y `dueAt` inesperados |

## 6. Límites de unicidad y persistencia

- **Unicidad sólo dentro de un namespace.** Los contadores viven en el estado. Dos procesos con el mismo namespace y estados independientes **sí** pueden generar el mismo id. El motor no lo impide ni lo promete.
- **Para reinicios, una de dos:**
  - (a) persistir `generation` por nido (y opcionalmente los vivos) y restaurar con el mismo namespace;
  - (b) arrancar con un namespace nuevo emitido por la autoridad persistente (p. ej. una época de población guardada en Postgres), sin restaurar vivos.

  Con varias instancias, el namespace debe ir ligado al lease o época del host que ya diseña la principal. No se diseñó infraestructura nueva.
- **Hoy no se persiste nada.** Mientras los encuentros no tengan valor (antes de combate y recompensas), perder los vivos en un reinicio es aceptable: reaparecen.
- **Requisitos para guardar y restaurar:** `PopulationState` es JSON plano (test de reproducibilidad), así que serializarlo no exige cambios. Restaurarlo exige la misma `config` (namespace y nidos). El motor rechaza un estado de otro namespace.

## 7. Hallazgo sobre ECO-1 (informado, **no** modificado)

El guard de ECO-1 "nadie fuera del módulo importa el catálogo" (`encounters/isolation.test.ts`) escanea también los **tests** de módulos hermanos, y su regex marca como importador cualquier **string literal** que contenga `ecosystem/…`, aunque sea un fixture.

- **Cómo apareció:** mi control negativo de ECO-2A lo disparó con un falso positivo.
- **Cómo lo resolví acá:** armando esos specs por concatenación en mi test, sin tocar ECO-1.
- **Arreglo mínimo propuesto para ECO-1:** excluir `*.test.ts` del barrido de "código activo", o analizar sólo sentencias `import` reales en lugar de buscar el patrón en todo el texto.
- Además, una corrida en frío del worktree tardó 6,8 s en ese escaneo (timeout por defecto: 5 s). Las corridas siguientes tardaron ~140 ms. El guard equivalente de ECO-2A ya tiene un timeout explícito de 30 s; a ECO-1 le convendría lo mismo.

## 8. Qué tocaría la futura integración (ECO-2B)

| Archivo | Cambio |
| --- | --- |
| `scripts/integration/bundle-encounters.mjs` (nuevo) | esbuild de `src/features/ecosystem/population/engine.ts` + `projection.ts` (+ el catálogo ECO-1) en un ESM sin dependencias, `platform: 'neutral'`, con `--check`. Copia exacta del patrón de `bundle-skills.mjs` |
| `services/realtime/src/world/ecosystem/encounters.generated.js` (nuevo, generado) | El bundle commiteado. Nunca se edita a mano (AGENTS §14) |
| `src/features/ecosystem/serverBundle.test.ts` (nuevo) | Test de deriva: rebuild igual al archivo commiteado, como `worldSkills/serverBundle.test.ts` |
| `services/realtime/src/world/encounterService.js` (nuevo) | Sostiene el estado, construye la `config` con nidos derivados del mapa, el CSPRNG, el reloj del servidor y la geometría (colisión, portales, reservas, ocupación); valida el catálogo al arrancar y falla cerrado |
| `services/realtime/src/world/worldRoom.js` | Cablear el tick, `activeAreas` desde la presencia y el envío de `publicArea` |
| `services/realtime/src/world/wildService.js`, `wildPopulation.js` (+ tests U29) | Retirar el roster horario (contradicciones K1/K2 de la propuesta) |
| Protocolo (`worldProtocol.js` o mensaje propio) | Snapshot y deltas de encuentros: sólo campos de `publicArea` |
| Cliente (`wildlands/engine/population.ts`, `sharedWorld`) | Dibujar desde la proyección; nunca decidir apariciones |
| Guardas de nidos (tests nuevos, como `caves.test.js`) | Ningún nido en llegada, salida, portales, rutas, stands ni reservas |

Coordinar el momento con la principal: `worldRoom.js` y la presencia son su zona activa.

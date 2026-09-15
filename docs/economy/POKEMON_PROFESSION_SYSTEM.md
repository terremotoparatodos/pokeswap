# R31 — Pokémon y profesiones

> Estado: fórmula implementada y testeada en `src/features/professions/domain/affinity.ts`; pesos en `catalog/affinityProfiles.ts`. **Party no implementada** (se documentan alternativas y recomendación, §6).
> Convención: **FACT**, **INFERENCE**, **OPEN QUESTION**.

## 1. Qué datos reales existen

| Atributo pedido | ¿Existe? | Dónde |
|---|---|---|
| Tipos | **FACT: sí** | `pokemon.type1`, `pokemon.type2` (texto; `population.ts` ya normaliza nombres en español/inglés) |
| Base stats (PS, Atq, Def, AtqEsp, DefEsp, Vel) | **FACT: sí, fuera de la base** | `STATS_DB` del legado (tag `v0-legacy-baseline`, 493 especies). R31 lo extrae a `catalog/speciesBaseStats.ts` con `scripts/extract_legacy_base_stats.mjs` |
| Nivel | **FACT: sí, por usuario + especie** | `pokemon_xp.level` (curva L³, autoridad `grant_pokemon_xp`) |
| Legendario, generación, región, `base_aura` | **FACT: sí** | `pokemon` |
| Naturaleza, IVs, EVs | **FACT: no** | No hay columnas ni modelo de instancia |
| Habilidad | **FACT: no** | — |
| Peso, altura | **FACT: no** | — |
| `PokemonSpecies` / `PokemonInstance` | **FACT: no existen como entidades** | `slots` tiene PK `pokemon_id`: cada especie tiene como máximo **un dueño global** |

Consecuencias:

1. La fórmula usa **tipos + base stats + nivel**. Naturaleza y habilidad son campos reservados en `PokemonProfessionInput`: se aceptan y por ahora se ignoran (hay test). Así, un futuro modelo de instancias no cambia la firma.
2. **Escasez.** Un jugador tiene pocas especies y cada una es única en el juego. Una especie "óptima" sería un único slot global con precio disparado. Evitarlo no es solo estética: es estabilidad de mercado.
3. **Revalidación.** Swap y Mercado pueden quitarle un Pokémon a un jugador en cualquier momento (`pokeswap-swap`, `market-buy`). La autoridad debe revalidar ownership y `is_locked` en cada acción (mismo criterio que el acompañante de R27).
4. **OPEN QUESTION (datos):** para producción, los stats deberían vivir en la base (columnas en `pokemon` o tabla `pokemon_base_stats`), no solo en código. Es una migración aditiva y no destructiva. No se creó en R31.

## 2. Cómo se calcula la afinidad

Por Pokémon y profesión:

```text
raw[rasgo] = generalista
           + Σ pesos por tipo (1–2 tipos)
           + Σ pesos por stat · statNorm(stat)          statNorm = clamp((v − 30) / 100)
           + excepción de especie (si existe)

fit        = 1 − e^(−Σraw / 1,2)                        0..1, saturante
budget     = (0,3 + 0,7 · fit) · levelFactor · (1 + 0,1 · bstNorm)
levelFactor = 0,5 + 0,5 · √(nivel / 100)                nivel 1 → 0,55; nivel 100 → 1
bstNorm    = clamp((suma de stats − 250) / 430)

bonus[rasgo] = min(tope[rasgo], raw[rasgo] / Σraw · budget · escala[rasgo])
```

- **Generalista:** todo Pokémon recibe una pequeña base (+0,05 en ahorro de energía, cuidado de herramienta y calidad). Ninguno queda sin uso.
- **Presupuesto compartido:** el `budget` se reparte en proporción a `raw`. Ser fuerte en un nicho implica ser proporcionalmente más débil en los demás.
- **Legendarios:** la suma de stats aporta como máximo +10 % al presupuesto.
- **Accesos:** reglas binarias por tipo y stat mínimo:

| Acceso | Profesión | Regla |
|---|---|---|
| `hardRock` | Minería | Roca/Tierra/Acero/Lucha y Atq ≥ 80 |
| `deepWater` | Pesca | Agua y PS ≥ 50 |
| `frozenGround` | Alquimia | Hielo/Fuego/Acero |

- **Biomas hogar:** derivados de la regla de población salvaje de WildLands (un test impide que se desalineen). `biomeMastery` solo aplica en esos biomas.

## 3. Tipos de bonus (nichos)

| Rasgo | Efecto en el resolver | Escala | Tope | Fuentes típicas |
|---|---|---|---|---|
| `speed` | − tiempo de acción | 0,35 | 25 % | Vel; Tierra (minería), Bicho (tala), Eléctrico (pesca) |
| `yield` | + probabilidad de unidad extra | 0,45 | 30 % | Atq; Lucha; Agua (pesca); Planta (alquimia) |
| `energySaving` | − coste de energía | 0,3 | 25 % | Def, PS; Roca, Normal |
| `rareFind` | × probabilidad de raros | 1,2 | +100 % | AtqEsp; Acero, Dragón, Hada, Fantasma |
| `quality` | unidades "finas" | 0,4 | 30 % | DefEsp; Hielo, Psíquico, Hada |
| `toolCare` | evita puntos de desgaste | 0,6 | 50 % | Def; Roca, Acero |
| `critical` | ×2 unidades | 0,15 | 10 % | Atq; Lucha, Bicho, Siniestro |
| `detection` | radio de resaltado de nodos | 1,2 | +100 % | AtqEsp; Acero/Eléctrico (minería), Volador (pesca), Planta (alquimia) |
| `processing` | − tiempo y ahorro de insumos al procesar | 0,4 | 30 % | AtqEsp/DefEsp; Veneno, Psíquico, Fuego |
| `biomeMastery` | + unidad extra en biomas hogar | 0,25 | 20 % | Tipo cuyo bioma coincide |
| `safety` | reservado para peligros (R33+) | 0,6 | 50 % | Def, DefEsp |

`archetype` es el rasgo con mayor peso bruto. La UI puede mostrarlo ("Excavador", "Prospector"…), pero no siempre coincide con el bonus numérico más alto, porque cada rasgo tiene su propia escala.

## 4. Ejemplos calculados (nivel 50, sin excepciones salvo Bibarel y Blissey)

Valores reales de `computeAffinity`, sin ajuste manual:

| Pokémon (tipos) | Profesión | Arquetipo | Bonus más relevantes | Acceso |
|---|---|---|---|---|
| Machamp (Lucha) | Minería | yield | yield +16,3 %, toolCare +4,9 % | hardRock |
| Diglett (Tierra) | Minería | speed | speed +12,3 %, detection +11,5 % | — |
| Geodude (Roca/Tierra) | Minería | energySaving | toolCare +11,6 %, energySaving +5,9 %, detection +6,4 % | hardRock |
| Magnemite (Eléctrico/Acero) | Minería | detection | detection +34,4 %, rareFind +28,1 % | — |
| Mewtwo (Psíquico, legendario) | Minería | speed | máximo: detection +12,9 %, yield +6,5 % | — |
| Bibarel (Normal/Agua) | Tala | yield | yield +13,0 %, toolCare +7,0 % | — |
| Scyther (Bicho/Volador) | Tala | speed | speed +8,9 %, detection +13,9 % | — |
| Blastoise (Agua) | Pesca | yield | rareFind +11,9 %, yield +10,4 %, biomeMastery +2,6 % | deepWater |
| Charizard (Fuego/Volador) | Pesca | detection | detection +32,2 %, speed +6,0 % | — |
| Magikarp (Agua) | Pesca | yield | rareFind +11,4 %, yield +10,7 % | — |
| Gloom (Planta/Veneno) | Alquimia | processing | detection +14,8 %, processing +9,7 % | — |
| Blissey (Normal) | Alquimia | processing | processing +12,7 %, quality +10,9 % | — |

Lectura:
- **Estrategias distintas:** Machamp da más unidades, Geodude hace durar la herramienta, Magnemite encuentra rarezas y Diglett es rápido. Ninguno domina a los demás en todas las dimensiones.
- **Legendarios:** Mewtwo, con la mayor suma de stats de la tabla, **no** supera a especialistas comunes. Hay test.
- **Nivel:** del nivel 1 al 100 todo bonus crece ×1,82. Un Pokémon recién obtenido rinde al 55 %.
- **Magikarp no es inútil:** el tipo le da un nicho de Pesca. Hay test: toda combinación stat×tipo tiene al menos un bonus ≥ 2 % en alguna profesión.

## 5. Cómo evitamos una única especie óptima

1. **Presupuesto compartido entre rasgos:** especializar tiene coste de oportunidad.
2. **Topes por rasgo:** los especialistas extremos se aplanan.
3. **Fit saturante:** sumar más pesos rinde cada vez menos.
4. **Legendarios limitados:** +10 % de presupuesto como máximo.
5. **Nichos que no compiten en la misma moneda:** velocidad (tiempo), yield (unidades), ahorro (energía), cuidado (materiales de reparación), rarezas (valor), calidad, procesado y detección.
   - **INFERENCE:** el valor de cada nicho depende del mercado. Si el metal está caro, `toolCare` vale más que `yield`.
6. **Accesos binarios opcionales:** abren nodos alternativos, nunca el loop principal.
7. **Evidencia sobre el roster (test):** probando las 493 líneas de stats × 18 tipos en Minería, los mejores de cada nicho son al menos 4 especies distintas, y el mejor en yield no es el mejor en velocidad.

## 6. Party de profesión — alternativas y recomendación (NO implementado)

`resolveGathering` recibe bonus **ya agregados**, así que cualquier modelo encaja sin tocar el resolver.

| Modelo | Complejidad jugador | Balance | Valor del roster | Performance | Persistencia | Multiplayer | Economía |
|---|---|---|---|---|---|---|---|
| 1 Pokémon activo | Mínima | Fácil | Bajo (1 especie importa) | 1 afinidad | 1 fila | Trivial | Concentra la demanda en pocas especies |
| **Líder + asistentes desbloqueables** | Baja → media | Controlable con pesos | Medio-alto | ≤3 afinidades cacheadas | ≤3 filas por profesión | Solo el líder se muestra | Reparte la demanda entre especies |
| Party completa (6) | Alta | Difícil; tiende a "equipo óptimo" | Muy alto | 6 afinidades | 6 filas | Más datos | Presiona mucho el mercado de Pokémon, ya escaso por diseño (F2) |
| Slots de profesión globales | Media | Media | Medio | Variable | Tabla de slots | Neutro | Neutro |
| Fatiga individual por Pokémon | Media-alta | Añade rotación | Alto | Estado por Pokémon | Estado nuevo por especie | Neutro | Acopla con la energía de dungeon (`slots.energy`) |
| Especializaciones de Pokémon | Alta | Difícil | Alto | — | Estado nuevo | Neutro | Requiere un modelo de instancia inexistente |

**Recomendación: líder + asistentes desbloqueables.**

- **Slots por nivel de profesión:**
  - Líder desde el nivel 1.
  - Asistente 1 en el nivel 20.
  - Asistente 2 en el nivel 40.
- **Agregación con retornos decrecientes por rasgo:**

  ```text
  total[rasgo] = tope · (1 − Π (1 − peso_i · bonus_i / tope))
  pesos: líder 1,0 · asistentes 0,5
  ```

- **Sin fatiga individual al inicio.** La energía es del jugador (ver [`ENERGY_DURABILITY.md`](ENERGY_DURABILITY.md)), para no mezclar con la energía de dungeon.
- **Elegibilidad**, revalidada por el servidor en cada acción:
  - que sea del jugador;
  - que no esté en el Mercado (`is_locked`);
  - que no esté en otra profesión al mismo tiempo.
- **Por qué:**
  - al jugador nuevo le basta un Pokémon;
  - el roster gana valor progresivamente;
  - son ≤ 3 lecturas cacheables;
  - la demanda de Pokémon se reparte;
  - en multiplayer solo hace falta mostrar al líder.
- **OPEN QUESTION:** ¿el líder debe ser el acompañante visual de R27? Recomendación: sí como opción por defecto. Da cohesión y reutiliza la validación de `usePlayerIdentity`, pero no debe ser obligatorio.

## 7. Excepciones de especie

Máximo 25; hoy hay 4. `catalogValidation` falla si hay más de 25 o si falta la razón. Son **empujes al peso bruto**, no bonus finales, así que siguen sujetas a presupuesto y topes.

| Especie | Profesión | Motivo |
|---|---|---|
| Bidoof (399) | Tala | Roe troncos (Pokédex) |
| Bibarel (400) | Tala | Construye diques cortando árboles |
| Chansey (113) | Alquimia | Afinidad curativa, Centro Pokémon |
| Blissey (242) | Alquimia | Especie enfermera |

Criterio: solo cuando el canon contradice claramente la fórmula. Si una excepción se repite para un grupo, conviene ajustar los pesos por tipo o stat en lugar de agregar filas.

## 8. Escalar al roster completo

- **Coste:** en tests, 35.496 cálculos (493 × 18 × 4) tardan menos de 1 s, unos 20 µs por cálculo. En producción se cachea por `(speciesId, profesión, nivel)` y se invalida al subir de nivel.
- **Datos de producción:** los tipos se leen de `pokemon` (lectura pública existente, `listPokemon`). Los stats hoy vienen del catálogo generado; ver §1, consecuencia 4.
- **Especies nuevas (Gen 5+):** agregar stats y tipos, sin tocar la fórmula. Revisar el test de roster y, si hace falta, ajustar pesos.
- **Hooks futuros** (cuando exista modelo de instancia), como modificadores sobre `raw` antes de normalizar:
  - naturaleza: ±10 % al peso de su stat;
  - habilidades concretas: Recogida → `rareFind`; Nado Rápido → velocidad de Pesca.

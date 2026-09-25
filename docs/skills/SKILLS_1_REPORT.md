# SKILLS-1 — Rebuild de Skills (Talar · Minería · Agricultura)

> Rama `skills/1-osrs-rebuild` desde `playtest-0.2` (`dc6dc70`). Sin merge, sin deploy, sin migraciones aplicadas.
> Antes: [`SKILLS_0_AUDIT.md`](SKILLS_0_AUDIT.md). Integración: [`WORLD_SKILLS_CONTRACT.md`](WORLD_SKILLS_CONTRACT.md).
> Las secciones siguen la numeración del entregable: §1 es `SKILLS_0_AUDIT.md`, §2 este informe, §3–§21 abajo.

## Resumen

Skills pasó de **4 profesiones + energía + herramientas + 11 bonus ocultos** a **3 skills del jugador + una aptitud 1–5 por especie**. La interacción que el jugador aprende es una sola:

> me acerco a un árbol o una roca → elijo uno de mis Pokémon → trabaja → **+XP, +material**.

El mundo enseña: cerca de la entrada sólo hay lo que se puede trabajar a nivel 1; más lejos aparecen cosas que dicen **"Requiere Minería 20"**.

| | Antes (R31) | Ahora (SKILLS-1) |
|---|---|---|
| Skills | Minería, Tala, Pesca, Alquimia | **Talar, Minería, Agricultura** |
| Quién trabaja | herramienta del jugador + un Pokémon fijo por profesión | **uno de tus Pokémon, elegido por vos** |
| Herramientas | 12 (pico/hacha/hoz/caña × 3), durabilidad, reparación | **ninguna** |
| Energía | 600 + regen + rested + tés | **ninguna** |
| Afinidad | 11 traits × tipos × stats × escala × topes, por nivel del Pokémon | **aptitud 1–5 por skill y especie**, overrides legibles |
| Nivel máx. | 60 | 50 (provisional) |
| Items | 56 | **14 materiales**, cada uno con "para qué" |
| Autoridad | reducer en el navegador | **servicio puro + puertos**, idempotente por `actionId` |
| Código | `professions/` 185 archivos, ~39 000 líneas | `skills/` 72 archivos, ~6 700 líneas (código: +4 685 / −36 813) |

---

## 3. Qué se eliminó

- **Pesca, completa** (ver §5).
- **Alquimia como skill**: mesa, recetas, pociones, forrajeo. Sus bayas/hierbas pasan a ser cosechas de Agricultura.
- **Energía** (`energy.ts`, rested, tés de vigor).
- **Herramientas**: catálogo, durabilidad, reparación, arte de pico/hacha/hoz/caña, swing de herramienta en la mano del jugador, venta en la Tienda del playtest.
- **Traits de afinidad** (speed/yield/energySaving/rareFind/quality/toolCare/critical/detection/processing/biomeMastery/safety) y **access tags** (hardRock/deepWater/frozenGround).
- **Recetas, procesado y estaciones** (horno R33, banco, fogata, mesa): crafting no es una skill y no hay catálogo de materiales aprobado para él.
- **Inventario por slots** de la demo, **simulador económico** (`npm run sim:economy`), **playground** `/dev/profesiones`.
- Items sin respuesta a "¿para qué?": resina, bonguri, lingotes, tablones, mangos, frascos, extractos, aceite de pescado (§6).

Todo sigue recuperable desde el tag `playtest-0.2`. No se borró ningún dato: no había datos (§16).

## 4. Qué se conservó

- **Arte** de las 5 rocas y 4 árboles, partículas, hojas, tocones y rebrote, burbujas, pops de recompensa → `skills/scene/art`, `scene/mining`, `scene/logging`.
- **Overlays** de minería/tala y el **compañero Pokémon** que aparece junto al jugador → `skills/scene/overworld`. Ahora leen el estado del nodo por un puerto (`nodeState(target)`) en vez de la demo, y ya no dibujan herramienta en la mano.
- **Colocación por seed** de nodos como sustituto pre-WORLD → `skills/localWorld/`.
- **Ids de arte** como ids de recurso (`pine_tree`, `iron_vein`…): WORLD, arte y reglas nombran igual cada cosa.
- Iconos de bayas/hierbas (extraídos del kit de alquimia) → `scene/art/cropItems.ts`.
- El layout MOBILE-1 del botón/panel Skills y de la mochila (mismas clases y medidas).

## 5. Fishing removal map

| Capa | Estado |
|---|---|
| Skill, XP, niveles, progresión | eliminados; `SKILL_IDS` = 3, test lo fija |
| Nodos (`shore_spot`, `coastal_spot`, `reef_spot`), overlays, timeline, splash, approach | eliminados |
| UI (`FishingActionCard`, `FishingCast`, fila 🎣, hint "la orilla") | eliminada |
| Items (fish, seaweed, quality_fish, pearl, heart_scale, fish_oil), cañas | eliminados |
| Recetas que consumían pesca | eliminadas con el resto de recetas |
| Tienda del playtest (`basic_rod`) | eliminada |
| Arte de pesca, playground `FishingFieldLab` | eliminados |
| Docs `FISHING_*`, `R31C2_*` | conservados como **histórico** (`docs/economy/README.md`) |
| Base de datos / realtime | **nada que retirar**: nunca existió persistencia |
| Guardia | `skillsIsolation.test.ts` falla si vuelve a aparecer `fishing`/`Pesca`/`basic_rod` en código de producto; `catalog.test.ts` hace lo mismo sobre los catálogos |

## 6. Items — KEEP / REWORK / REMOVE

| Material | Veredicto | Skill · grado | ¿Para qué? |
|---|---|---|---|
| Tronco común `common_log` | KEEP | Talar · 1 | Madera básica: construcción y venta |
| Madera de pino `pine_log` | **NEW** | Talar · 2 | Madera liviana: mejores construcciones y venta |
| Madera dura `hardwood_log` | KEEP | Talar · 3 | Construcciones de midgame |
| Madera boreal `boreal_log` | KEEP | Talar · 4 | Construcciones avanzadas, venta alta |
| Piedra `stone` | KEEP | Minería · 1 | Construcción y venta |
| Carbón `coal` | KEEP | Minería · 2 | Combustible: sin él no se funde metal |
| Mineral de hierro `iron_ore` | KEEP | Minería · 3 | Metal de trabajo del midgame |
| Mineral de oro `gold_ore` | KEEP | Minería · 4 | Metal precioso, venta alta |
| Cristal `crystal` | **NEW** (rework de crystal_cluster) | Minería · 5 | El recurso más raro del arco 1–50 |
| Baya Aranja `oran_berry` | REWORK (forrajeo → cultivo) | Agricultura · 1 | Cura un poco |
| Hierba medicinal `medicinal_herb` | REWORK | Agricultura · 2 | Cura estados |
| Baya Zanama `leppa_berry` | REWORK | Agricultura · 3 | Restaura PP |
| Baya Zidra `sitrus_berry` | REWORK | Agricultura · 4 | Cura mucho |
| Hierba Revivir `revival_herb` | REWORK | Agricultura · 5 | Revive |
| Fragmento evolutivo | **UNCLEAR** | — | Toca evolución de Pokémon: no se dropea hasta que exista ese diseño |
| wild_essence, boss_relic | UNCLEAR, fuera de Skills | — | Drops PvE; no se tocaron |
| resina, bonguri, lingotes, tablones, mangos, frascos, extractos, pociones de alquimia, estructuras, herramientas, todo lo de pesca | **REMOVE** | — | "Porque ya estaba" no alcanza |

`planned: true` en `materials.ts` marca los usos que dependen de un paso futuro documentado (venta, construcción, consumibles de dungeon). No se implementó ningún sistema para justificar un item.

## 7. Curva de XP 1–50

```
xpToNext(L) = round(20·L + 15·1.19^L)          // balance.ts → XP_CURVE { linear, base, growth }
```

Tres perillas: `linear` = qué tan rápido es el tutorial; `growth` = qué tan empinado es el midgame; `base` = dónde empieza a dominar la exponencial. Umbrales fijados en `xpCurve.test.ts` (un cambio de balance se ve en review).

| Nv | XP total | Nv | XP total | Nv | XP total |
|---|---|---|---|---|---|
| 2 | 38 | 20 | 5 479 | 35 | 40 364 |
| 3 | 99 | 25 | 12 017 | 40 | 98 534 |
| 5 | 294 | 28 | 17 763 | 42 | 134 701 |
| 10 | 1 256 | 30 | 23 187 | 45 | 217 837 |
| 12 | 1 863 | 32 | 30 473 | 50 | **497 216** |
| 15 | 3 079 | | | | |

49→50 cuesta ~300× lo que cuesta 9→10. La XP se guarda hasta el umbral de 50 y no más (subir el tope después no regala niveles). A 50 se siguen obteniendo materiales.

**Ritmo real** (`npm run skills:pacing`, aptitud 3, 1.5 s de overhead por acción, 8 s de caminata por nodo agotado, 4 parcelas):

| Nv | Talar | Minería | Agricultura |
|---|---|---|---|
| 10 | 14 min | 14 min | 16 min |
| 25 | 1.2 h | 1.2 h | 1.2 h |
| 40 | 5.4 h | 6.1 h | 5.4 h |
| 50 | 17 h | 22 h | 19 h |

Con un especialista (aptitud 5) Talar 50 baja a ~15 h. Agricultura se mide en reloj de pared: corre en paralelo mientras talás o minás.

## 8. Talar 1–50

| Nv | Árbol | Tier | XP | Duración (apt 1 / 3 / 5) | Drop | Dónde | Apt. mín. | Cargas · respawn |
|---|---|---|---|---|---|---|---|---|
| 1 | Árbol común | muy básico | 10 | 3.9 / 3.0 / 2.4 s | Tronco común | pradera, bosque, costa — desde la entrada | 1 | 3–5 · 30 s |
| 10 | *Ritmo 1* | | | −4 % | | | | |
| 12 | Pino | básico | 22 | 4.5 / 3.5 / 2.8 s | Madera de pino | Bosque Umbrío (y tundra), desde la entrada | 1 | 4–6 · 45 s |
| 20 | *Ritmo 2* | | | −8 % | | | | |
| 25 | Árbol de madera dura | intermedio | 40 | 5.3 / 4.0 / 3.2 s | Madera dura | lo profundo del bosque (anillo 1+) | 1 | 4–6 · 75 s |
| 30 | *Ritmo 3* | | | −12 % | | | | |
| 40 | Pino boreal | avanzado | 68 | 5.7 / 4.4 / 3.5 s | Madera boreal | Tundra lejana (anillo 2) | **2** | 5–7 · 120 s |
| 40, 50 | *Ritmo 4, 5* | | | −16 %, −20 % | | | | |

## 9. Minería 1–50

| Nv | Roca | Tier | XP | Duración (apt 1 / 3 / 5) | Drop | Dónde | Apt. mín. | Cargas · respawn |
|---|---|---|---|---|---|---|---|---|
| 1 | Roca | muy básico | 10 | 4.2 / 3.2 / 2.6 s | Piedra | pradera, bosque, desierto, costa — desde la entrada | 1 | 3–5 · 30 s |
| 10 | Veta de carbón | básico | 18 | 4.7 / 3.6 / 2.9 s | Carbón | un poco más lejos (anillo 1) | 1 | 3–5 · 45 s |
| 20 | Veta de hierro | intermedio | 30 | 5.3 / 4.0 / 3.2 s | Mineral de hierro | peñascos de Desierto/Tundra, cuevas | 1 | 3–5 · 75 s |
| 35 | Veta de oro | avanzado | 50 | 5.9 / 4.6 / 3.7 s | Mineral de oro | lo más lejano de Desierto/Tundra, cuevas | 1 | 2–4 · 150 s |
| 45 | Cúmulo cristalino | especializado | 75 | 6.6 / 5.0 / 4.0 s | Cristal | cuevas y tundra profunda | **2** | 2–3 · 300 s |
| 10…50 | *Ritmo 1…5* | | | −4 % cada 10 | | | | |

## 10. Agricultura 1–50

Lifecycle: `EMPTY →plant→ PLANTED → GROWING → READY →harvest→ EMPTY`, con `tend` una vez mientras crece (+1 unidad garantizada al cosechar). "Preparar" está dentro de plantar: el Pokémon remueve la tierra y siembra en una acción (un paso separado agregaba un click, no una decisión). **Sin semillas**: el nivel es el único requisito; menos inventario, loop más claro. WORLD es dueño del estado físico; SKILLS valida la transición pedida.

| Nv | Cultivo | Crece | XP plantar / cuidar / cosechar | Cosecha | Parcela | Apt. mín. |
|---|---|---|---|---|---|---|
| 1 | Baya Aranja | 1.5 min | 8 / 4 / 25 | 2–3 Aranja | huerta comunal o fértil | 1 |
| 10 | Hierba medicinal | 3 min | 25 / 12 / 100 | 2–3 | huerta o fértil | 1 |
| 20 | Baya Zanama | 5 min | 60 / 30 / 240 | 2–4 | huerta o fértil | 1 |
| 30 | Baya Zidra | 8 min | 140 / 70 / 550 | 2–4 | **sólo tierra fértil** | 1 |
| 42 | Hierba Revivir | 12 min | 280 / 130 / 1 120 | 1–2 | **sólo tierra fértil** | **2** |

Duración de las acciones: plantar 3 s, cuidar 2 s, cosechar 2.6 s (con aptitud y Ritmo). La XP por ciclo es alta porque la espera es el costo: cuatro parcelas siguen el ritmo de la recolección activa (§7). La geografía de Agricultura es el tipo de parcela: lo mejor sólo crece lejos.

**Estado en el playtest:** las reglas, la API, la UI de roadmap y los tests están completos; **no hay parcelas físicas en el mundo** hasta que WORLD-1 las cree (`PLOT_WORLD_HINTS`). En el panel Skills, Agricultura muestra nivel 1 y su roadmap.

## 11. Sistema de aptitudes

**Representación** — por especie (`PokemonSpecies`), tres enteros 1–5, serializable:

```ts
workAptitudes(speciesId) → { woodcutting: 1..5, mining: 1..5, farming: 1..5 }
```

1 Torpe · 2 Aprendiz · 3 Capaz · 4 Hábil · 5 Especialista. La acción usa la `PokemonInstance` real del jugador; no existe un "Pokémon de trabajo". Nivel, naturaleza, IVs y habilidad **no** influyen (sin razón de diseño fuerte todavía).

**Derivación** (`aptitude/aptitudeRules.ts`):

```
aptitud = clamp(1..5, 2 + typeTier + statTier)
typeTier: +2 natural, +1 bueno, 0 neutro, −1 malo   (el mejor tipo; el malo sólo cuenta si ninguno ayuda)
statTier: +1 si el par de stats de la skill promedia ≥ 90, −1 si ≤ 50
```

| Skill | Natural (+2) | Bueno (+1) | Malo (−1) | Stats |
|---|---|---|---|---|
| Talar | Lucha, Acero | Bicho, Planta, Normal, Siniestro, Dragón | Fantasma, Hada | Ataque + Velocidad |
| Minería | Roca, Tierra, Acero | Lucha, Dragón | Volador, Hada | Ataque + Defensa |
| Agricultura | Planta | Tierra, Agua, Bicho, Normal, Hada | Fuego, Hielo | PS + Def. Esp. |

No es "Planta = Agricultura y listo": Caterpie (Bicho, 30/45) es Aprendiz en Talar; Beedrill (Bicho, 90/75) es Capaz. Los datos reales disponibles son tipos y stats base (no hay anatomía ni evolución en el catálogo), así que la regla usa sólo eso y lo demás va a overrides.

**Distribución resultante** (493 especies, 1/2/3/4/5):

| Skill | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Talar | 67 | 183 | 155 | 69 | 19 |
| Minería | 141 | 175 | 71 | 56 | 50 |
| Agricultura | 70 | 155 | 178 | 78 | 12 |

**Fallback**: especie desconocida → 2 en todo. **Sin deadlock**: toda especie es ≥1 en todo; todo recurso de nivel 1 lo puede trabajar cualquier especie; sólo el último peldaño de cada skill pide aptitud 2, y ≥71 % de las especies la tienen en cada skill (test). El equipo inicial del playtest tiene alguien con ≥2 en las tres.

**Eficiencia vs requisito — decisión:** el **nivel del jugador es el único gate** ("¿entiendo este recurso?"). La **aptitud es eficiencia** ("¿qué tan bien lo hace este Pokémon?"), salvo el peldaño final. Justificación: con gate por aptitud en todo, cientos de especies serían inútiles y un jugador con el equipo "equivocado" quedaría trabado; sin ninguna diferencia, elegir Pokémon no importaría. Fórmula:

| Aptitud | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Duración | ×1.30 | ×1.12 | ×1.00 | ×0.90 | ×0.80 |
| Chance de +1 unidad | 0 % | 5 % | 10 % | 18 % | 25 % |

Un especialista hace ~1.6× lo que un torpe por hora y consigue más material: se nota, sin volver inútil a nadie. **La XP no depende del Pokémon**: mide lo que aprende el jugador; el especialista gana más XP/hora sólo porque termina antes. Duración final = base × aptitud × Ritmo, piso 1.2 s.

## 12. Overrides iniciales

`aptitude/overrides.ts` — una línea por especie, sólo las skills que cambian, con motivo:

| Especie | Override | Motivo |
|---|---|---|
| Scyther, Pinsir | Talar 5 | guadañas / pinzas |
| Farfetch'd, Kabutops | Talar 4 | puerro-espada / brazos de guadaña |
| Bidoof / Bibarel | Talar 4 / 5 | roen y talan (Pokédex) |
| Sudowoodo | Talar 1 | se hace pasar por árbol |
| Diglett, Dugtrio | Minería 5 | viven excavando |
| Machop | Minería 4 | entrena levantando rocas |
| Machoke, Machamp | Minería 5, Talar 5 | trabajo pesado |
| Sandshrew / Sandslash | Minería 4 / 5 | garras de cavar |
| Donphan | Minería 5 | derriba rocas |
| Magnemite, Nosepass | Minería 4 | atrae/encuentra metal, pero frágil/lento |
| Miltank, Bellossom, Sunflora, Cherrim, Celebi, Shaymin | Agricultura 5 | granja / sol / bosque |
| Torkoal | Agricultura 1 | quema lo que siembra |
| Snorlax | Agricultura 2 | se come la cosecha |

Parchear es editar esa lista; balance general va en `balance.ts`. Tests: un override gana, sólo toca lo que nombra, ids válidos y únicos, motivo obligatorio.

## 13. Los primeros 10 minutos

Diseñados y cubiertos por `localSkillsSession.test.ts` y `playtestStart.test.ts`.

1. **Salís de Ciudad Corazón a Pradera Brisa.** En el anillo de la entrada sólo hay árboles comunes y rocas sueltas (test: nada de nivel >1 en pradera anillo 0). El hint dice una línea: *"Acercate a un árbol o a una roca: elegí un Pokémon y que trabaje."*
2. **Tocás un árbol.** Burbuja 🪓 encima; la tarjeta dice *Árbol común · Tronco común · +10 XP*, y la primera vez: *"Tu Pokémon hace el trabajo. Vos ganás experiencia en Talar."*
3. **"Elegí un Pokémon."** Tu equipo, del mejor al peor para esto, con ★ y segundos. El mejor viene preseleccionado. Botón: **Talar con Machamp**.
4. **Trabaja.** Aparece al lado, el árbol tiembla a cada golpe, barra *"Machamp está talando…"* (~2.4–3.9 s).
5. **Resultado.** Pop sobre el árbol + tarjeta: **+10 XP Talar · +1 Tronco común**. "Otra vez" en un toque.
6. **Al 4.º golpe: `Talar 1 → 2`.** El árbol cae cuando se le acaban las cargas (3–5); caminás al siguiente.
7. **Encontrás una roca.** Mismo gesto, otra skill: Minería. Ya sabés cómo funciona.
8. **~14 min: Talar 10** → *Ritmo 1: todo trabajo 4 % más rápido*. El panel Skills dice *Próximo · Nv 12 · Pino*.
9. **Llegás al Bosque y ves un pino.** 🔒 *"Requiere Talar 12 — Tenés Talar 10 · seguí con Árbol común."* Un objetivo, sin quest.
10. **Agricultura** (cuando WORLD-1 ponga la huerta comunal junto a la salida a Pradera): plantás Aranja, te vas a talar, volvés a cosechar.

## 14. Distribución por zonas

Consultivo para WORLD-1 (`RESOURCES[].world`, `PLOT_WORLD_HINTS`). Anillo = distancia desde la entrada del área (96 tiles por anillo en el sustituto pre-WORLD).

| Zona | Anillo 0 (entrada) | Anillo 1 | Anillo 2 (lejos) |
|---|---|---|---|
| Ciudad Corazón | huerta comunal (Agricultura 1–20) | — | — |
| Pradera Brisa | árbol común, roca | + carbón | = |
| Bosque Umbrío | árbol común, **pino (12)**, roca | + madera dura (25), carbón, tierra fértil | = |
| Desierto Ardiente | roca | carbón, **hierro (20)** | **oro (35)** |
| Tundra Helada | pino | hierro | oro, **pino boreal (40)**, **cristal (45)** |
| Costa Coral | árbol común (palmeras), roca | tierra fértil | = |
| Cuevas (dungeons) | — | hierro | oro, cristal |

Reglas fijadas en tests: nada ≥25 en un anillo 0; nada ≥35 fuera del anillo 2; cada skill tiene su primer peldaño en la entrada de Pradera.

## 15. Dominio y API WORLD ↔ SKILLS

```
src/features/skills/
  domain/        reglas puras: skills, balance, xpCurve, aptitude/, resources, farming, materials, workRules, roadmap, messages, rng
  service/       ports.ts · skillsService.ts (authorizeWorkAttempt, settleWork) · memoryAdapters.ts
  scene/         arte y overlays de rocas/árboles (sin reglas)
  localWorld/    SUSTITUTO PRE-WORLD: colocación por seed, cargas por sesión
  local/         sesión local del playtest (servicio real + adapters en memoria)
  ui/            view-models puros + useSkillsLayer (Vue)
  components/    SkillsWorldLayer, SkillsPanel, WorkCard, SkillsBag, MaterialIcon
```

API: `authorizeWorkAttempt(input) → allowed + durationMs + xp + reward | refused + reason + message`; `settleWork(actionId, { outcome }) → settled | already_settled | too_early | unknown_action`. Idempotente por `actionId`, términos congelados en la autorización, sin pago anticipado, expiración a 10 min. Detalle completo, flujo, puertos y checklist en [`WORLD_SKILLS_CONTRACT.md`](WORLD_SKILLS_CONTRACT.md).

## 16. Migraciones

**No se preparó ninguna migración en `supabase/migrations/`, y no hace falta:** Skills nunca tuvo persistencia (auditoría §2) — no hay XP, progreso, pesca ni items que migrar, renombrar o retirar.

Lo que sí queda es una **propuesta** de esquema para cuando el servidor sea la autoridad: [`PROPOSED_PERSISTENCE.sql`](PROPOSED_PERSISTENCE.sql) (`player_skill_xp`, `skill_work_settlements` con `action_id` único, RLS de sólo lectura propia, función transaccional de commit). Está en `docs/` a propósito para que nada la aplique. Convertirla en migración requiere decidir el inventario (no hay tabla de items aprobada).

## 17. UI nueva

- **Botón Skills** (mismo lugar y comportamiento MOBILE-1) con nivel total.
- **Panel**: tres filas — ícono, nombre, nivel, barra, `XP / XP`, **"Próximo · Nv 10 · Veta de carbón"**. Tocar una fila despliega su **roadmap** (✓ desbloqueado, dorado = siguiente, resto bloqueado con nivel y lugar) y **"Mejor de tu equipo: Machamp ★★★★★"**. Pie: "el progreso de esta build no se guarda". Sin energía, sin herramientas, sin wiki.
- **Tarjeta de trabajo** (al tocar un nodo): bloqueado → *"Requiere Talar 12"* + *"Tenés Talar 7 · seguí con Árbol común"*; agotado → *"vuelve en N s"*; disponible → material + XP, lista de tu equipo con ★ y segundos (los que no alcanzan la aptitud mínima aparecen grises con *"Necesita ★★"*), botón *"Talar con Scyther"*; trabajando → barra; resultado → **Talar 9 → 10**, *Nuevo: Pino* / *Ritmo 1…*, **+22 XP Talar · +1 Madera de pino**, *"¡Scyther consiguió uno extra!"*, *Otra vez* / *Listo*.
- **Mochila**: materiales con ícono, cantidad y su "para qué" + los suministros de dungeon.
- **Mundo**: burbuja ⛏/🪓 al estar al lado, 🔒 si falta nivel, brillo en nodos raros, pops de +XP/+item. El jugador ya no sostiene herramienta: trabaja el Pokémon.

## 18. Tests

`npm test`: **166 archivos, 1 686 tests, todos verdes** (baseline 0.2: 188 / 2 002 — la diferencia son los tests del sistema R31 eliminado). Nuevos/reescritos en Skills (16 archivos, 147 tests), además de playtest y dungeon adaptados:

| Pedido | Dónde |
|---|---|
| Umbrales 1–50 (tabla completa fijada), level-up exacto, tope 50, XP tope | `domain/xpCurve.test.ts` |
| Requisitos, skill correcta por recurso | `domain/workRules.test.ts` |
| Aptitudes, fallback, overrides, no sólo por tipo, serializable | `domain/aptitude/aptitude.test.ts` |
| Modificadores de duración, Ritmo, piso | `domain/workRules.test.ts` |
| Reglas de recompensa, bonus, rangos, tend | `domain/workRules.test.ts` |
| **Mismo `actionId` liquidado dos veces → recompensa una vez**; cancel vs complete; carrera de commit; too_early; expirado | `service/skillsService.test.ts` |
| Pesca no existe como skill; sólo 3 skills | `domain/catalog.test.ts`, `skillsIsolation.test.ts` |
| UI muestra sólo 3 skills, próximo unlock, roadmap | `components/skillsUi.test.ts` |
| Previews de unlocks | `domain/catalog.test.ts` |
| Casos early/midgame, primeros minutos | `workRules.test.ts`, `local/localSkillsSession.test.ts`, `playtest/domain/playtestStart.test.ts` |
| Sin herramientas (493 especies trabajan nivel 1; ningún término menciona herramienta; Tienda sin herramientas) | `workRules.test.ts`, `playtestShop.test.ts`, `CityPanel.test.ts` |
| Mapa como tutorial | `catalog.test.ts`, `localWorld/localWorld.test.ts` |
| Dominio/servicio portables al servidor; entrada sólo tras build gate | `skillsIsolation.test.ts` |
| Arte cubre cada recurso y sus anclas | `scene/art/*.test.ts` |

## 19. Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | ✅ 0 errores |
| `npm run lint` | ✅ 0 errores (9 warnings preexistentes en `auth/AuthModal.vue`, no tocado) |
| `npm test` | ✅ 166 / 1 686 |
| `vite build` producción normal | ✅ sin código de Skills en el bundle (build gate) |
| `vite build` playtest (`VITE_PLAYTEST=on`) | ✅ `SkillsWorldLayer` en su propio chunk lazy |
| Visual en navegador | ⚠️ **Parcial.** Panel Skills verificado en dev (3 skills, roadmap, mejor del equipo). La interacción en el mundo (tocar roca/árbol) **no se pudo probar en vivo**: sin `.env`/Supabase local, WildLands no pasa de "Llegando a Ciudad Corazón…" (espera auth; ajeno a este cambio). Cubierta por tests de sesión, overlays y tarjeta. **Pendiente: probarla en el preview del playtest antes de mergear.** |
| Realtime | sin cambios (`services/realtime` no se tocó) |

## 20. Riesgos

| Riesgo | Mitigación |
|---|---|
| Interacción en el mundo sin prueba visual en vivo | Tests de sesión/overlay/tarjeta; probar en preview antes de merge (§19) |
| Agricultura sin parcelas físicas hasta WORLD-1 | Reglas/API/tests completos; panel muestra el roadmap; WORLD tiene `PLOT_WORLD_HINTS` |
| Balance sin datos de jugadores | Todo en `balance.ts` + catálogos; `npm run skills:pacing` para medir antes de tocar |
| Minería 29 % de especies con aptitud 1 | El gate de aptitud sólo afecta al cristal (45); test asegura ≥65 % con ≥2 |
| Dungeon cita niveles nuevos (cristal pide Minería 45 en cuevas) | Es sólo texto (no bloquea); revisar con la estación de Dungeon si se quiere un umbral menor para obstáculos |
| `WildlandsView.vue` (host compartido con WORLD) | 3 líneas: import del layer, `:workers`, sin `:owned-tools`/`:fresh`. Conflicto trivial si WORLD lo toca |
| Borrado grande (−36 800 líneas de código) | Todo recuperable desde `playtest-0.2`; auditoría lista qué y por qué |
| Estaciones R33 retiradas del producto | Decisión de este prompt ("sólo 3 skills"); diseño conservado en docs para Crafting |
| RNG cliente en la sesión local | Aceptable sólo porque nada persiste; el servidor usa su `RandomSource` |
| Nombres de especie en inglés canónico (`Mr Mime`) | No hay tabla localizada en el repo; cosmético |

## 21. Integración con WORLD-1

Resumen (detalle en [`WORLD_SKILLS_CONTRACT.md`](WORLD_SKILLS_CONTRACT.md)):

1. WORLD valida lo físico, mintea `actionId` y llama `authorizeWorkAttempt`.
2. Usa `durationMs` para su timer y su difusión AOI del Pokémon trabajando.
3. Al terminar consume la carga / avanza la parcela y llama `settleWork(actionId, { outcome })`; siempre liquida, también al cancelar.
4. Implementa los puertos con transacción y unicidad de `action_id` (ver `PROPOSED_PERSISTENCE.sql`) y `RandomSource` del servidor.
5. Lleva `domain/` + `service/` al realtime como bundle CJS (no tienen dependencias) — no reescribir reglas.
6. En el cliente, reemplaza `skills/localWorld/` y la parte física de `skills/local/` por su estado de nodos; la escena sólo necesita `targetAt` y `nodeState`.
7. Crea parcelas (huerta comunal ×4 junto a la salida a Pradera; tierra fértil ×4 en Bosque/Costa) según `PLOT_WORLD_HINTS`.

---

**Criterio de éxito.** Talar, Minería y Agricultura se explican en una línea cada una; querés subirlas porque cada pocos niveles hay un árbol, una roca, un cultivo o un Ritmo nuevo que el mundo ya te mostró bloqueado; y tus Pokémon son el centro: elegís quién trabaja y se nota quién es bueno en qué.

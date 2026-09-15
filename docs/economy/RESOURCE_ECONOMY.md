# R31 — Economía de recursos

> Estado: diseño R31, **no integrado a producción**. Rama `feat/r31-professions-foundation`.
> Fuente de verdad de los números: `src/features/professions/domain/catalog/*`. Este documento explica el porqué; si un número difiere, manda el catálogo.
> Convención: **FACT** (verificado en el repo), **INFERENCE**, **OPEN QUESTION** (igual que `docs/INVARIANTS.md`).

## 1. Objetivo

Una economía **circular**: cada recurso entra por un faucet con coste (energía o riesgo PvE) y sale por un sink que aporta gameplay (consumo en combate, desgaste, mantenimiento, crafting de nivel superior). El anti-objetivo es:

```text
producción infinita → acumulación → desaparece la demanda → colapsan los precios → recolectar deja de tener sentido
```

## 2. Punto de partida verificado

- **FACT:** no existen tablas de inventario, ítems ni recursos (`docs/BACKEND_INVENTORY.md`, `src/shared/types/database.ts`).
- **FACT:** la única moneda es `profiles.tokens`, con autoridad parcial en servidor (SEC-02 abierto).
- **FACT:** el Mercado solo comercia Pokémon (`market_listings.pokemon_id`). No hay comercio de ítems.
- **FACT:** el legado tenía Poción/Superpoción como loot de dungeon (`v0-legacy-baseline:index.html`), sin persistencia.
- **Consecuencia:** todo el catálogo R31 es nuevo. No migra datos ni convive con un inventario existente.

## 3. Taxonomía inicial

Cinco clases (`ItemKind`): `raw`, `refined`, `tool`, `consumable`, `structure`. Tres tiers. 54 ítems en total. Los nombres siguen la traducción oficial al español cuando existe (Baya Aranja, Escama Corazón, Bonguri…).

### 3.1 Recursos crudos (faucets)

| Profesión | T1 | T2 | T3 | Raros (escalan con `rareFind`) |
|---|---|---|---|---|
| Minería | Piedra, Carbón | Mineral de Hierro | Mineral de Oro | Fragmento Evolutivo |
| Tala | Tronco Común, Resina | Madera Dura | Madera Boreal | Bonguri |
| Pesca | Pescado, Alga | Pez Selecto | — | Perla, Escama Corazón |
| Alquimia (recolección) | Baya Aranja, Hierba Medicinal | Baya Zidra, Baya Zanama | — | Hierba Revivir |
| Exploración / PvE | — | Esencia Salvaje | Reliquia de Jefe | — |

Los nodos que producen cada recurso, sus niveles y sus biomas están en [`PROFESSIONS_DESIGN.md`](PROFESSIONS_DESIGN.md) §4 y en `catalog/nodes.ts`.

### 3.2 Productos refinados

| Refinado | Receta | Profesión / estación | Consumido por |
|---|---|---|---|
| Lingote de Hierro | 2 Mineral de Hierro + 1 Carbón | Minería · Horno | Herramientas T2, Caña Reforzada, Acero, reparación T2 |
| Lingote de Oro | 2 Mineral de Oro + 2 Carbón | Minería · Horno | Mesa de Alquimia |
| Lingote de Acero | 2 Lingote de Hierro + 2 Carbón | Minería · Horno | Herramientas T3, reparación T3 |
| Bloque de Piedra | 3 Piedra | Minería · Banco | Banco de Trabajo, Horno, mantenimiento del Horno |
| Frasco | 2 Piedra + 1 Carbón → 2 | Minería · Horno | **Toda poción**, Mesa de Alquimia |
| Tablón | 2 Tronco Común | Tala · Banco | Herramientas T1, Mango, Caña Básica, estructuras |
| Tablón Duro | 2 Madera Dura | Tala · Banco | Caña Reforzada, Mesa de Alquimia |
| Mango | 1 Tablón + 1 Resina | Tala · Banco | Toda herramienta de metal |
| Aceite de Pescado | 3 Pescado, o 1 Pez Selecto → 2 | Pesca · Fogata | Hiperpoción |
| Extracto Herbal | 2 Hierba Medicinal + 1 Alga | Alquimia · Mesa | Superpoción, Hiperpoción |

### 3.3 Herramientas, consumibles y estructuras

- **Herramientas** (12): pico, hacha y hoz de piedra/hierro/acero (las fabrica Minería); caña básica/reforzada/maestra (las fabrica Tala). Detalle en [`ENERGY_DURABILITY.md`](ENERGY_DURABILITY.md).
- **Consumibles** (6):

| Consumible | Efecto | Receta |
|---|---|---|
| Poción | +20 PS | 2 Baya Aranja + 1 Frasco |
| Superpoción | +50 PS | 1 Baya Zidra + 1 Extracto Herbal + 1 Frasco |
| Hiperpoción | +120 PS | 2 Baya Zidra + 2 Extracto Herbal + 1 Aceite de Pescado + 1 Frasco |
| Revivir | revive al 50 % | 1 Hierba Revivir + 1 Esencia Salvaje + 1 Frasco — **o** 1 Escama Corazón en lugar de la Esencia |
| Éter | +10 PP | 2 Baya Zanama + 1 Alga + 1 Frasco |
| Té de Vigor | +120 energía (tope diario) | 3 Baya Aranja + 1 Hierba Medicinal |

- **Estructuras** (4): Banco de Trabajo, Fogata, Horno de Fundición, Mesa de Alquimia. Se construyen, se desgastan por día de uso y se mantienen con materiales.

## 4. Faucets — cómo entra cada recurso

| Faucet | Qué entra | Regulador | Notas |
|---|---|---|---|
| Nodos de recolección | Todos los crudos salvo drops PvE | **Energía** del jugador + cargas personales por nodo + nivel/herramienta/acceso | Único faucet de volumen. Resuelto por servidor (R32+) |
| Drops raros de nodos | Fragmento Evolutivo, Bonguri, Perla, Escama Corazón, Hierba Revivir | Misma energía; probabilidad × `rareFind` × nivel, tope ×3 | No hay nodo dedicado a rarezas |
| PvE / exploración | Esencia Salvaje, Reliquia de Jefe | Energía de dungeon existente (`slots.energy`, 30 por entrada) y tope diario | **OPEN QUESTION:** tabla de drops por dungeon/jefe (fuera de R31) |
| Herramientas iniciales | 1 herramienta T1 por profesión al empezar | Una vez por cuenta | Evita que el primer paso requiera comerciar |
| **No hay:** NPC que venda recursos, recompensas de login con materiales, conversión de tokens a recursos | — | — | Cada uno sería un faucet sin coste de energía. Ver §7 |

## 5. Sinks — cómo sale cada recurso

| Sink | Destruye | Gameplay que aporta |
|---|---|---|
| **Consumo en PvE** | Pociones, Revivir, Éter | Es la razón de ser de Alquimia. El Centro Pokémon con cooldown (decisión de producto prevista) mantiene la demanda |
| **Té de Vigor** | Bayas, hierbas | Extiende una sesión, con tope de 240/día para no romper el regulador |
| **Refinado / crafting** | Transforma crudos en refinados y finales | Especialización y comercio entre profesiones. No destruye valor: lo concentra |
| **Desgaste + reparación** | Piedra, lingotes, carbón, resina, tablones | Demanda sostenida de metal y madera por **todas** las profesiones |
| **Retiro de herramientas** | La herramienta completa (tras ~6 reparaciones) | Reemplazo periódico. Crea demanda de Mangos, lingotes y Fragmentos Evolutivos |
| **Mantenimiento de estructuras** | Tablones, troncos, bloques, carbón, frascos | Motivo para Tala fuera de las herramientas. Las estructuras solo decaen en días de uso |
| **Construcción** | Grandes lotes de tablones, bloques, lingotes | Sink de volumen de una sola vez, y base del futuro housing |
| **Reservados** (`RESERVED_SINKS`) | Bonguri → Poké Balls; Reliquia de Jefe → mejoras de estructuras | Explícitos en código. Tocan captura/ownership o housing, así que quedan para otra fase |

**Regla de catálogo (FACT, `catalogValidation.ts`):** todo crudo necesita al menos un faucet, y todo crudo o refinado necesita un sink o un sink reservado. Todo lo no crudo debe tener receta. Un test lo exige.

## 6. Dependencias entre profesiones

| Consumidor ↓ / Proveedor → | Minería | Tala | Pesca | Alquimia | PvE |
|---|---|---|---|---|---|
| **Minería** | lingotes, frascos | tablones, mangos (sus herramientas) | — | — | — |
| **Tala** | picos/hachas, lingotes (caña), bloques | tablones | — | — | — |
| **Pesca** | lingotes y acero (cañas T2/T3) | tablones, resina | — | — | — |
| **Alquimia** | **frascos (toda poción)**, oro (Mesa) | tablones duros (Mesa), hoces vía Minería | alga, aceite, Escama Corazón | extractos | Esencia Salvaje |
| **PvE / jugadores** | — | — | — | pociones, Revivir, Éter | — |

Ninguna profesión se autoabastece. El escenario `mining-only` del simulador lo demuestra: sin Tala no hay tablones, las herramientas no se reponen y 29.393 de 64.433 acciones terminan a mano.

## 7. Relación con tokens y Mercado

- **Recomendación:** R32 no debe permitir vender recursos a un NPC por tokens. Sería un faucet de tokens que depende solo de la energía, y agravaría SEC-02/V-01 mientras la autoridad de tokens no esté cerrada.
- **INFERENCE:** el comercio entre jugadores de ítems es necesario para que las dependencias de §6 funcionen. Es una feature de Mercado nueva, con atomicidad y ownership propios (`AGENTS.md` §10, §17). No forma parte de R31.
- **OPEN QUESTION:** ¿el Mercado de ítems cobra comisión en tokens (sink de tokens) o en materiales? Recomendación inicial: comisión en tokens, igual que el 5 % actual de `market-buy`.

## 8. Qué dice el simulador (números de iteración, no balance final)

`npm run sim:economy -- --scenario <nombre>`. Supuestos: el pool global actúa como un mercado perfecto, siempre hay crafteadores y la demanda PvE es un parámetro. Semilla 31.

| Escenario | Generado | Transformado | Destruido | Stock final | Demanda insatisfecha |
|---|---|---|---|---|---|
| `base` (100 jugadores, 7 días) | 77.664 | 18.792 | 5.540 | 60.658 | 771 |
| `no-pokemon` (7 días) | 68.734 | 18.056 | 5.612 | 52.100 | 870 |
| `month-100` (30 días) | 293.536 | 88.555 | 19.933 | 218.648 | 3.611 |
| `veterans` (nivel 40, T3, 7 días) | 61.097 | 5.614 | 1.143 | 56.311 | 3.594 |
| `mining-only` (7 días) | 81.046 | 36 | 1.722 | 79.398 | 4.925 |

Hallazgos:

1. **La energía regula el volumen.** En todos los escenarios se gasta el 100 % de la energía disponible antes de que termine el tiempo de sesión.
2. **Faltan sinks de volumen para T1.**
   - En `month-100` terminan en stock 29.356 Troncos Comunes, 24.490 Pescados, 24.210 Carbones y 14.984 Hierbas Medicinales.
   - Lo que más ayudaría es construcción y housing, y además cocina/Poffins para Pesca: la Casa de los Poffins ya existe en la ciudad.
3. **Oferta y demanda se desplazan con el nivel.**
   - A los 30 días los alquimistas prefieren nodos T2. La Baya Aranja se agota (17.700 consumidas de 17.897), faltan 2.100 Pociones y sobran Hierbas.
   - Es la dinámica buscada: los jugadores nuevos siguen siendo necesarios para los básicos.
4. **Los veteranos solos no abastecen la economía.** Con todos en nivel 40, faltan 3.594 unidades (2.100 Pociones) y el Oro se acumula (8.450) sin un sink proporcional.
5. **Revivir es el cuello de botella.** La Hierba Revivir es rara (0,6 % en T2) y faltan 750 Revivir al mes. Hay que ajustarlo en R32, o bien aceptarlo como bien de lujo.
6. **Los Pokémon importan pero no dominan.** El bonus medio (+8 % yield, +6 % velocidad, +6 % ahorro) produce un 13 % más que `no-pokemon`.

## 9. Palancas de balance para R32/R33

| Problema | Palancas (en orden de preferencia) |
|---|---|
| Stock T1 acumulado | Nuevos sinks con gameplay (housing, cocina, Poffins); más mantenimiento estructural; frascos consumidos por más recetas |
| Oro sin sink | Estructuras T3, mejoras con Reliquia de Jefe, cosméticos de housing; **no** venta a NPC |
| Revivir escaso | Subir Hierba Revivir en `frost_bloom`, sumar drops de jefes o una receta alternativa |
| Volumen global | `ENERGY_CONFIG.regenPerHour`, `energyCost` por nodo |
| Veteranos dominando | Topes de `levelEfficiency` y la mitad de XP por sobrenivel; ya limitados |

# R31 — Energía, herramientas y durabilidad

> Estado: diseño R31, **no integrado**. Código: `domain/energy.ts`, `domain/durability.ts`, `catalog/professions.ts` (`ENERGY_CONFIG`), `catalog/tools.ts`.
> Convención: **FACT**, **INFERENCE**, **OPEN QUESTION**.

---

## Parte 1 — Energía ("Vigor")

### 1.1 Función

La energía es el **regulador de faucets**. No existe para limitar el tiempo de juego: sin energía se puede refinar, craftear, reparar, construir, comerciar, explorar y hacer dungeon (que ya tiene su propia energía). Lo único que se detiene es la recolección.

### 1.2 Alternativas analizadas

| Modelo | Ventaja | Problema en PokeSwap | Veredicto |
|---|---|---|---|
| Sin energía (solo tiempo, como OSRS) | Cero fricción | El volumen escala con horas y bots; con pocos sinks colapsa la economía | Descartado |
| Energía por Pokémon (reusar `slots.energy`) | Ya existe con autoridad RPC | **FACT:** `slots.energy` es la energía de dungeon (máx. 100, 10/h, coste 30). Mezclarlas acopla dos economías. Además `slots` tiene una fila por especie y dueño global: un swap o una venta se llevaría la energía con el Pokémon | Descartado |
| **Energía de jugador** | Un solo número por cuenta, fácil de explicar y de auditar | Hay que crear persistencia nueva | **Recomendado** |
| Híbrido (jugador + fatiga por Pokémon) | Más valor del roster | Doble estado, más UI y más escrituras por acción | Posible en R33+, si hace falta |

### 1.3 Parámetros iniciales (`ENERGY_CONFIG`)

| Parámetro | Valor | Razón |
|---|---|---|
| Energía máxima base | 600 | Una barra ≈ 60 acciones T1 ≈ 15–20 min de recolección |
| Bonus de máximo | +20 cada 10 niveles totales de profesión, tope +200 (máx. 800) | Progresión suave; el veterano tiene sesiones algo más largas, no más horas |
| Regeneración | 60/h (barra completa en 10 h) | Un jugador casual que entra una vez al día llega con la barra llena |
| Descanso (rested) | El exceso se acumula hasta 600 y da **+50 % de XP** | Premia la ausencia **sin crear recursos** |
| Consumibles | Té de Vigor +120; tope de **240/día UTC** | Alquimia tiene demanda sin romper el regulador |
| Suelo de coste | 60 % del coste base | Ninguna combinación de bonus hace casi gratis una acción |

### 1.4 Regeneración perezosa

Mismo patrón que `consume_dungeon_energy` (FACT, migración 011): se guarda `(current, updatedAt)` y se deriva al leer.

```text
gained  = horas(now − updatedAt) · regenPerHour · (1 + bonusEstructuras)
current = min(max, current + gained)
rested  = min(restedCap, rested + excedente)
```

- Un reloj que retrocede no regenera (test).
- `now` debe venir del servidor: el reloj del cliente no es confiable (`AGENTS.md` §2).

### 1.5 Coste por acción

```text
coste = energyCost_nodo · max(minCostRatio, (1 − ahorroPokémon) · (1 − eficienciaNivel))
eficienciaNivel = min(15 %, 0,5 % por nivel sobre el requisito)
ahorroPokémon   = rasgo energySaving, tope 25 %
```

| Tier | Coste base | Acciones por barra de 600 (sin bonus) |
|---|---|---|
| T1 | 10–15 | 40–60 |
| T2 | 20–25 | 24–30 |
| T3 | 30 | 20 |

**OPEN QUESTION:** una barra de solo T3 dura ~20 acciones (5–8 min con herramienta T3). Si la sesión se siente corta, bajar el coste T3 a 20–25 y compensar con durabilidad o rareza. El simulador permite probarlo.

### 1.6 Presión de login

| Perfil (escenario del simulador) | Sesiones/día | Energía útil/día |
|---|---|---|
| Casual | 1 | 600 (llega llena; lo que sobra va a descanso) |
| Regular | 2 | 1.200 |
| Hardcore | 3 | 1.440 |

- La diferencia entre casual y hardcore es **2,4×** en recursos. Se compensa en parte porque el descanso da XP extra al casual.
- No hace falta entrar cada pocas horas para no perder mucho.
- **OPEN QUESTION:** si 2,4× resulta demasiado, subir `restedCap` y dar un pequeño bonus de *yield* en descanso. Tiene coste económico y hay que simularlo antes.

### 1.7 Otras fuentes consideradas

| Fuente | Decisión |
|---|---|
| Centro Pokémon | **No** restaura energía de jugador. Cura Pokémon y ya tendrá cooldown; restaurar energía gratis anularía el regulador y la demanda de Té |
| Estructuras de jugador | Fogata: +10 % de regeneración mientras se mantiene. Futuras (cama/housing): +máximo, siempre con mantenimiento |
| Herramientas | No reducen energía. Dan velocidad, yield y menos desgaste, para que la herramienta no sea obligatoria para "ahorrar" |
| Pokémon | Rasgo `energySaving` (nicho propio: Roca/Normal, Defensa/PS) |
| Nivel de profesión | Hasta −15 %, lineal con tope |

### 1.8 Retornos decrecientes

- Todos los bonus tienen tope individual y se combinan de forma multiplicativa hasta el suelo del 60 %.
- El yield extra total tiene tope del 60 %.
- El multiplicador de rarezas tiene tope ×3.
- La XP se reduce a la mitad con 25 o más niveles sobre el contenido.
- Rendimiento veterano frente a nuevo en el mismo nodo T1: ≤ 1,32× unidades por punto de energía (test `progression.test.ts`).

---

## Parte 2 — Herramientas y durabilidad

### 2.1 Objetivo

Generar **demanda sostenida de metal y madera en todas las profesiones** sin que perder una herramienta se sienta como castigo.

### 2.2 ¿Desaparece o se repara?

| Opción | Pro | Contra |
|---|---|---|
| Desaparece al llegar a 0 | Sink fuerte y simple | Frustrante: una herramienta cara se pierde en medio de una sesión; empuja a guardar herramientas "por si acaso" |
| Queda rota para siempre salvo reparación | Nada se pierde de golpe | Sin retiro, reparar indefinidamente acaba siendo más barato que craftear y la demanda de herramientas nuevas cae a cero |
| **Rota pero reparable, con vida útil finita** | Nada se pierde de golpe; reparar cuesta materiales; cada reparación acorta la vida y la herramienta termina retirándose | Una regla más que explicar |

**Recomendación: rota pero reparable, con vida útil finita.**

- A 0 la herramienta queda *rota* (no se puede usar, conserva identidad).
- Reparar cuesta materiales proporcionales al daño.
- Cada reparación reduce la durabilidad máxima un 8 % del original.
- Por debajo del 50 % del original ya no admite reparación y, al romperse, queda *retirada*.
- Resultado: ~6 reparaciones y ~5,25× la durabilidad inicial en toda su vida.

### 2.3 Tiers

| Tier | Nivel | Durabilidad | Velocidad | Yield extra | Crafting (pico) | Reparación completa (pico) |
|---|---|---|---|---|---|---|
| T1 Piedra | 1 | 60 | ×1,00 | +0 % | 6 Piedra + 2 Tablón | 3 Piedra |
| T2 Hierro | 15 | 150 | ×0,85 | +5 % | 5 Lingote de Hierro + 1 Mango | 2 Lingote de Hierro + 2 Carbón |
| T3 Acero | 35 | 300 | ×0,72 | +10 % | 5 Lingote de Acero + 1 Mango + 1 Fragmento Evolutivo | 2 Lingote de Acero + 3 Carbón |

- Hachas y hoces siguen el mismo patrón. Las cañas se fabrican en Tala: tablones y resina, más hierro o acero en tiers altos, más una Perla en la Caña Maestra.
- **Sin herramienta:** los nodos T1 admiten recolección a mano (×1,5 de tiempo, sin desgaste), para que un jugador nuevo participe desde el minuto uno.

### 2.4 Desgaste

```text
puntos = 1 por acción; 2 si el nodo es de tier superior a la herramienta
cada punto se evita con probabilidad = rasgo toolCare del Pokémon (tope 50 %)
```

### 2.5 Coste de reparación

```text
fracción = (máxActual − durabilidad) / máxOriginal
material = max(1, ceil(cantidadCompleta · fracción))
```

- Se puede reparar parcialmente en cualquier momento.
- El mínimo de 1 unidad evita microreparaciones gratis.
- `repairTool` es pura: el llamador debe descontar materiales y persistir la herramienta **en la misma transacción** (`AGENTS.md` §10).

### 2.6 Mitigación de frustración (recomendada para la UI de R32+)

- Aviso al 20 % y al 5 % de durabilidad.
- Una herramienta rota nunca se pierde, solo se deja de poder usar.
- Estaciones públicas en la ciudad (más lentas, sin mantenimiento), para reparar sin estructuras propias.
- Herramienta inicial T1 por profesión.

### 2.7 Estructuras y mantenimiento

| Estructura | Efecto | Desgaste/día de uso | Mantenimiento (+50 condición) |
|---|---|---|---|
| Banco de Trabajo | −10 % tiempo de procesado | 2 | 2 Tablón |
| Fogata | +10 % regeneración de energía | 10 | 3 Tronco Común |
| Horno de Fundición | −15 % tiempo de procesado | 3 | 2 Bloque de Piedra + 2 Carbón |
| Mesa de Alquimia | −15 % tiempo de procesado | 2 | 1 Tablón Duro + 1 Frasco |

- Las estructuras decaen **solo en días de uso**. Ausentarse no castiga.
- A condición 0 quedan inactivas, no destruidas.

### 2.8 Evidencia del simulador (escenario `base`, 100 jugadores, 7 días)

- Durabilidad perdida: 52.853 puntos. 787 reparaciones, todas pagadas.
- Material destruido en reparaciones: 1.511 Piedra, 109 Lingote de Hierro, 87 Carbón, 274 Resina, 128 Tablón.
- Herramientas: 149 equipadas y 99 retiradas.
- Sin reparación (`no-repair`), el número de herramientas craftadas sube, que es lo que verifica el test.
- Sin Tala (`mining-only`), no se fabrica ninguna herramienta nueva y el 46 % de las acciones termina a mano.

# Fishing Interaction Spec (R31-C2)

> Implementación: `fishing/useFishingController.ts`, `fishing/fishingOverlay.ts`, `fishing/fishingTimeline.ts`, `fishing/fishingApproach.ts`, `fishing/spotVisualState.ts`, `components/FishingActionCard.vue`.
> Estado de la lógica: local (sesión demo). El servidor autoritativo sigue pendiente (R32+).
> Comparte motor y piezas con [`MINING_INTERACTION_SPEC.md`](MINING_INTERACTION_SPEC.md).

## 1. Descubrimiento

| Distancia | Qué ve el jugador |
|---|---|
| En pantalla | Una zona de agua más honda, con anillo de espuma y una sombra que se mueve |
| Dentro del radio de prospección | Los spots raros (banco costero, arrecife) destellan cada pocos segundos |
| Al lado | Burbuja con caña sobre el agua y anillo blanco suave |

La prospección usa el mismo radio que Minería (`8 × (1 + detection)`, tope 16) y es solo presentación.

## 2. Acercamiento y dónde se para el jugador

Esta es la diferencia grande con Minería:

- **El nodo vive en la costa, la marca vive en el agua.** Un spot de orilla ocupa una casilla de **tierra** junto al agua (ancla `shore` de R31-A); el arrecife ocupa una casilla de **agua** con coral o roca marina.
- **Tocar la marca en el agua selecciona el spot** (`spotAt`): el jugador camina hasta la orilla y encara el agua. Nunca hace falta tocar la arena.
- **Se pesca desde tierra.** `canCastFrom` exige estar al lado del agua marcada y **no** estar dentro del agua, siempre que el spot tenga alguna orilla seca (`hasDryBank`).
- **Excepción documentada:** un arrecife rodeado de agua no tiene orilla; ahí el jugador nada hasta su lado y pesca desde el agua. WildLands ya permite nadar, así que no se inventó ninguna regla nueva.
- **Tests** (`fishing/fishing.test.ts`): orilla desde norte, sur, este y oeste; rechazo si el jugador está en el agua teniendo orilla; diagonal y distancia no cuentan; arrecife sin orilla permitido; y dónde cae la línea en cada caso.

## 3. Interacción y targeting

- **Disparadores:** tocar la marca (o la casilla del spot) estando al lado, o E / Espacio mirándola.
- **Tarjeta** (`FishingActionCard`): recurso, nombre, nivel, estado, Pokémon trabajador, caña con durabilidad, chips de recompensa, energía, desgaste y XP, y las acciones Lanzar, Reparar y Recoger pendientes.
- **Alcance:** si el jugador se aleja y toca Lanzar, la tarjeta se cierra en lugar de pescar a distancia.

## 4. La acción

```text
Lanzar → validación local → input bloqueado (el motor sigue a 60 fps)
       → caña atrás y latigazo (340 ms) → la línea vuela en arco al agua (260 ms)
       → espera 1,4–3,4 s (flotador quieto, burbujas)
       → PIQUE (1,1 s): flotador hundido, anillo brillante, "!" y el botón se pone dorado
       → el jugador toca ¡Recoger!
           · dentro de la ventana → captura (recompensa 950 ms)
           · antes de tiempo o tarde → escape (700 ms), sin coste
       → fin: input desbloqueado y tarjeta con el resultado
```

**La tarjeta nunca esconde el botón:** durante toda la acción quedan visibles el encabezado, el estado ("Esperando el pique…" / "¡Pica! Recogé ya") y **¡Recoger!**.

## 5. Timing y calidad de la reacción (configurable, NO económico)

`FISHING_TUNING` en `fishing/fishingTimeline.ts`:

| Parámetro | Valor de prototipo |
|---|---|
| Lanzamiento | 340 ms |
| Vuelo de la línea | 260 ms |
| Espera | 1400–3400 ms |
| Ventana de pique | 1100 ms |
| Tramo "perfecto" | primeros 350 ms |
| Tramo "tarde" | últimos 300 ms |
| Recogida | 380 ms |
| Recompensa / escape | 950 ms / 700 ms |

| Reacción | Resultado en el prototipo |
|---|---|
| `perfect` | Captura · "¡Tirón perfecto!" |
| `good` | Captura · "Buen tirón" |
| `late` | Captura · "Tarde, pero salió" |
| `early` | Escape · "Recogiste antes de tiempo: se asustó" |
| `missed` | Escape · "Se escapó: tardaste en recoger" |

**Pendiente de diseño:** hoy las tres calidades de captura dan el mismo resultado del resolver; el bonus por `perfect` y el riesgo extra de `late` todavía **no** están conectados a la economía. Eso es R31-C3 o R32, no esta fase.

**Coste:** un escape no gasta energía ni desgasta la caña; solo cuesta tiempo. La captura gasta lo que dice el resolver de R31-A.

## 6. Depletion y respawn

| Estado | Condición (dominio R31-A) | Visual |
|---|---|---|
| DEPLETED | Sin cargas personales y sin respawn | Agua lisa, sin sombra ni burbujas |
| RESPAWNING | Sin cargas con cuenta regresiva | Burbujas primero, sombra después (3 cuadros); la tarjeta muestra "Se recupera en m:ss" |

Vale el mismo hallazgo que en Minería (B-04): hoy toda depleción tiene respawn personal, así que el mundo casi siempre muestra RESPAWNING.

## 7. Errores y bloqueos

| Estado | Mundo | Tarjeta |
|---|---|---|
| LOCKED_LEVEL | Burbuja con candado al lado | "Requiere Pesca Nv. X · Tenés Nv. Y" |
| SPECIAL_ACCESS | Burbuja con sello | "Tu Pokémon no puede llegar" (arrecife: aguas profundas) |
| NO_TOOL / TOOL_TIER / TOOL_BROKEN | Burbuja con caña | "Necesitás una caña" · "Tu caña está rota · Reparala" |
| NO_ENERGY / INVENTORY_FULL | Burbuja con caña | Mismos textos que Minería |
| DEPLETED / RESPAWNING | Agua lisa | "Agotado para vos · Se recupera en m:ss" |

## 8. Pokémon trabajador

Mismo sistema que Minería (`overworld/workerPresence.ts` y `workerCompanion.ts`): aparece al lado del jugador al empezar la acción, mira hacia el agua, se queda toda la espera y se va al terminar. Nunca se para en el agua ni en la casilla del spot.

## 9. Pendiente para multiplayer (sin implementar)

- La selección, el flotador y el pique son locales: otros jugadores no los ven.
- Propuesta mínima (igual que Minería): un flag cosmético `activity: { kind: 'fishing', tx, ty }` en el actor de presencia. Es cambio de protocolo R30 y requiere aprobación.

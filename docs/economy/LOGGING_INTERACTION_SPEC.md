# Logging Interaction Spec (R31-C3)

> Implementación: `logging/useLoggingController.ts`, `logging/loggingOverlay.ts`, `logging/choppingTimeline.ts`, `logging/treeVisualState.ts`, `logging/leaves.ts`, `components/LoggingActionCard.vue`.
> Estado de la lógica: local (sesión demo). El servidor autoritativo sigue pendiente (R32+).
> Comparte motor y piezas con [`MINING_INTERACTION_SPEC.md`](MINING_INTERACTION_SPEC.md) y [`FISHING_INTERACTION_SPEC.md`](FISHING_INTERACTION_SPEC.md).

## 1. Árboles decorativos frente a árboles talables

Esta es la decisión estructural de la fase.

- **Quién decide:** `nodeAt(world, tx, ty)` de R31-A. Para cada casilla con árbol tira un hash determinista con la semilla del mundo y lo compara con `ANCHOR_DENSITY` del ancla: **12 % de `tree`, 10 % de `pine` y `snowpine`, 20 % de `palm`**. El resto del bosque no es recurso.
- **Determinista y sin estado:** la misma semilla da el mismo bosque para todos los jugadores y para el servidor; no hay lista de árboles guardada.
- **Cómo escala al generador real:** no hace falta tocarlo. El cliente pinta lo que `nodeAt` dice, y el servidor de R32 validará con la misma función. Si más adelante se quiere menos densidad en zonas de ciudad o rutas, se ajusta `ANCHOR_DENSITY` o se agrega una regla de zona: el arte no cambia.
- **Cómo lo ve el jugador:** el árbol talable tiene una **marca de hacha tallada en el tronco**; el decorativo no tiene nada. La galería muestra los dos juntos para comparar.
- **La demo usa landmarks** (árbol común, pino, madera dura, boreal) solo para llevarte hasta un ejemplar concreto; el resto del bosque sigue la regla general.

## 2. Descubrimiento

| Distancia | Qué ve el jugador |
|---|---|
| En pantalla | La marca en el tronco: un árbol talable se reconoce por el árbol, no por un ícono |
| Dentro del radio de prospección | Madera dura y boreal destellan cada pocos segundos |
| Al lado | Burbuja con hacha sobre la copa y anillo suave en el suelo |

## 3. Acercamiento y navegación

- Los árboles son **decor sólido**: el navegador camina hasta una casilla vecina y encara el árbol, igual que con las rocas (mecanismo de R31-C1, ya cubierto por `engine/worldObjectNavigation.test.ts` desde N, S, E, O y diagonales).
- **Tocar un árbol lejano** camina hasta él; **tocarlo desde al lado** abre la tarjeta.
- **Copas superpuestas:** la selección usa la casilla tocada, no el píxel de la copa, así que dos árboles pegados se distinguen por dónde tocás.
- **Árboles en esquina o contra una roca:** el navegador busca cualquier casilla vecina libre; si no hay ninguna, el árbol simplemente no se puede trabajar (mismo criterio que una roca encajonada).
- **Alcance:** alejarse con la tarjeta abierta y tocar Talar cierra la tarjeta (`isBeside`).

## 4. La acción

```text
Talar → validación local → input bloqueado (el motor sigue a 60 fps)
      → N hachazos (2–4 según actionSeconds): preparación → mordida → recuperación
      → si era la última carga: el árbol se inclina, suelta la copa y queda el tocón (420 ms)
      → se aplica la acción (resolver real de R31-A)
      → recompensa: íconos que suben, "+N", "+XP"
      → fin: input desbloqueado y tarjeta con el resultado
```

**Cargas y caída:** cada acción es un corte. El árbol **solo cae cuando la acción toma su última carga** (`remainingCharges <= 1`); la tarjeta lo anuncia con "Quedan N cortes" y "Último corte: cae el árbol".

## 5. Reacción del árbol

| Momento | Qué pasa |
|---|---|
| Mordida | Destello leve del tronco, temblor de 1 px, astillas, aserrín, corteza y 2 hojas sueltas |
| Recuperación | El temblor se apaga en dos pasos: la madera sigue vibrando |
| Caída | Inclinación creciente alejándose del jugador, descenso de 3 px y ráfaga de 8 hojas |
| Después | Tocón con cara de corte pálida, anillos y astillas al pie |

## 6. Agotado y respawn

| Estado | Condición (dominio R31-A) | Visual |
|---|---|---|
| Agotado | Sin cargas personales | Tocón |
| Regenerando | Con cuenta regresiva | Tocón → brote (33 %) → árbol joven (66 %) → árbol (100 %) |

El reloj es el de la demo (`session.advance` en el laboratorio). Vale el mismo hallazgo B-04 que en las otras profesiones: hoy toda depleción tiene respawn personal.

## 7. Errores y bloqueos

| Estado | Mundo | Tarjeta |
|---|---|---|
| LOCKED_LEVEL | Burbuja con candado | "Requiere Tala Nv. X · Tenés Nv. Y" |
| NO_TOOL / TOOL_TIER | Burbuja con hacha | "Necesitás un hacha · Tier N" |
| TOOL_BROKEN | Burbuja con hacha | "Tu hacha está rota · Reparala para seguir" |
| NO_ENERGY / INVENTORY_FULL | Burbuja con hacha | Mismos textos que Minería |
| Agotado | Tocón | "Agotado para vos · Se recupera en m:ss" |

## 8. Recompensas y drops secundarios

- **Primario:** Tronco Común (T1), Madera Dura (T2), Madera Boreal (T3).
- **Secundarios existentes en R31-A:** Resina (5 % común, 30 % pino, 10 % madera dura, 20 % boreal) y Bonguri como drop raro (0,3 % a 2 %).
- **No se agregaron recursos nuevos.** Ideas visuales que quedaron como propuesta y **no** se implementaron: corteza como material, savia de arce, semillas por especie. Necesitarían decisión económica, no arte.
- **Rareza:** la jerarquía es la compartida (`miningRarity`): Bonguri cuenta como especial y la madera dura como poco común.

## 9. Pokémon trabajador

Reutiliza la pieza compartida de R31-C1 (`overworld/workerPresence.ts`, `workerCompanion.ts`): aparece al lado del jugador al empezar el corte, mira al árbol, se queda toda la acción y se va al terminar. Nunca aparece dentro del árbol, sobre el jugador, en agua ni en otra casilla con nodo.

## 10. Inventario

Sin lógica propia: troncos, resina y Bonguri entran por el mismo camino que mineral y pescado (stacks, espacios, `INVENTORY_FULL`, pendientes).

## 11. Pendiente para multiplayer (sin implementar)

- La selección, el hachazo y el tocón son locales: otros jugadores no los ven, y las cargas son personales, así que dos jugadores pueden ver el mismo árbol en pie y talado.
- Propuesta mínima, igual que en las otras profesiones: un flag cosmético `activity: { kind: 'woodcutting', tx, ty }` en el actor de presencia, y que el servidor exponga el estado del nodo. Es cambio de protocolo R30 y requiere aprobación.

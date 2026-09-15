# Inventory Design (R31-C1)

> Estado: modelo puro implementado y testeado (`inventory/slotInventory.ts`, `inventory/stackRules.ts`). Integrado en la sesión demo (`demo/demoSession.ts`) y en la UI (`components/InventoryGrid.vue`).
> **Sin persistencia.** Los números de stacks y capacidad son **de demo**, no reglas económicas.

## 1. Modelo: espacios + stacks

```text
Mochila (SlotContainer, capacity N)
 ├─ espacio 0: Mineral de Hierro ×60   ← stack lleno (maxStack 60)
 ├─ espacio 1: Mineral de Hierro ×12   ← stack nuevo al llenarse el anterior
 ├─ espacio 2: Carbón ×18
 ├─ espacio 3: Pico de Acero (instancia)  ← no se apila
 └─ espacio 4: vacío
Equipo (fuera de la mochila): pico, hacha, caña, hoz
Pendientes: recompensas que no entraron
```

- **Un tipo de recurso ocupa un espacio** mientras su stack no esté lleno. Al llenarse, abre otro espacio.
- **Herramientas (y estructuras):** no se apilan, `maxStack = 1`, y tienen `instanceId` porque cada una tiene su durabilidad.
- **Pokémon:** no ocupan espacios.

## 2. Operaciones (puras)

| Función | Qué hace |
|---|---|
| `addStacks(container, stacks, rules)` | Completa stacks existentes en orden, después abre espacios vacíos. Devuelve `placements` (espacio, cantidad, `newStack`, `filledStack`) y `overflow` |
| `addInstance(container, itemId, instanceId)` | Ocupa un espacio con un ítem único |
| `canFit` | Simula sin cambiar nada |
| `removeStacks` | Quita desde los últimos stacks primero, así los primeros espacios quedan estables. Todo o nada |
| `transferSlot(from, to, index, qty, rules)` | Mueve entre contenedores. Todo o nada: si el destino no admite todo, nada cambia |
| `containerCounts` | Totales por ítem para recetas y resolvers (compatibilidad con R31-A) |

**Invariante:** ninguna operación descarta ítems. Lo que no entra vuelve en `overflow` y el llamador debe mostrarlo o guardarlo.

## 3. maxStack (demo)

`stackRules(config)` clasifica cada ítem desde el catálogo:

| Clase | Regla de clasificación | Demo |
|---|---|---|
| basic | Tier 1 crudo | 100 |
| uncommon | Tier 2 crudo | 60 |
| rare | Tier 3 o `rare` | 20 |
| refined | Refinado | 50 |
| consumable | Consumible | 25 |
| unique | Herramienta o estructura | 1 |

Configurable con `DEMO_STACK_CONFIG`. **Pendiente R31-C2:** números finales y si hay límites por ítem en lugar de por clase.

## 4. Capacidad

- **Demo:** 24 espacios (`DEMO_INVENTORY_SLOTS`), dentro del rango 24–30 pedido. El playground permite 12–30.
- **Reducir la capacidad:** los espacios que sobran pasan a pendientes, no se borran (test).
- **Pendiente:** capacidad final, mejoras (mochilas) y si la capacidad es otro regulador económico.

## 5. Herramienta equipada: A frente a B

| | A · En la mochila marcada como equipada | B · Casilla de equipo aparte |
|---|---|---|
| Ocupa espacio | Sí | No |
| Mochila llena | Puede impedir cambiar de herramienta | Siempre se puede cambiar (intercambio 1 por 1) |
| Claridad | Hay que buscar la marca "equipada" | La herramienta activa siempre está a la vista |
| Muchas profesiones | 4 espacios fijos perdidos | 4 casillas de equipo claras |
| Comercio o almacenamiento futuros | Hay que impedir vender la equipada | Solo se comercia lo que está en la mochila |

**Prototipado: B.**
- **Mochila:** fila "Equipo" arriba de la mochila con las 4 herramientas y su durabilidad.
- **Herramientas de repuesto:** viven en la mochila como instancias. "Equipar" las intercambia con la activa (`equipFromBag`).
- **Por qué:** con B una mochila llena nunca te deja sin poder cambiar de herramienta en medio de una sesión, y la herramienta activa siempre está visible. **Decisión pendiente de aprobación.**

## 6. INVENTORY_FULL

Regla del prototipo:

1. **Antes de minar:** ¿entra el **mínimo garantizado** del recurso principal (`primary.min`)?
   - si hay un stack del mismo ítem con lugar, sí entra aunque no haya espacios libres;
   - si no hay stack con lugar pero hay un espacio libre, entra en un stack nuevo;
   - si no entra, el estado es **INVENTORY_FULL** y el botón queda deshabilitado.
2. **Después de minar:** lo extra que no entra (unidad adicional, secundarios, raros) va a **pendientes**:
   - visible en la mochila ("No entró: …") y en el feedback ("No entró: N X (queda pendiente)");
   - "Recoger" lo mueve cuando haya lugar.
3. **Nunca** se descartan recursos en silencio.

**Alternativa descartada:** bloquear si no entra el peor caso (máximo más secundarios). Impediría minar con un stack casi lleno aunque normalmente todo entre.

**Pendiente de producto:** ¿los pendientes caducan? ¿Tienen tope? En OSRS el excedente cae al suelo y lo toman otros. Aquí es personal para no crear camping.

## 7. UI (`InventoryGrid`)

| Elemento | Detalle |
|---|---|
| Encabezado | "N / capacidad espacios" y aviso "Llena · los stacks abiertos aún aceptan" |
| Equipo | 4 casillas grandes con ícono (roto o inservible cambian el arte) y barra de durabilidad |
| Grilla | Espacios cuadrados; cantidad abajo a la derecha; barra de llenado del stack; punto dorado si el stack está completo; borde por rareza (óxido, dorado, violeta) |
| Animaciones | Rebote (sumó), brillo (espacio nuevo), halo dorado (stack completo); se respeta `prefers-reduced-motion` |
| Detalle | Por **toque**: nombre, cantidad/máximo, clase de stack, total, durabilidad si es herramienta; acciones Equipar y Descartar |
| Pendientes | Fila con ítems y "Recoger" |
| Móvil | 6 columnas, sin hover |

## 8. Almacenamiento futuro

Un solo tipo de contenedor para todo:

```ts
interface SlotContainer {
  id: string
  kind: 'player_inventory' | 'storage' | 'house_storage' | 'shop_stock'
  capacity: number
  slots: (ItemSlot | null)[]   // ItemSlot { itemId, quantity, instanceId? }
}
```

| Uso futuro | Diferencia |
|---|---|
| Player Inventory | Capacidad chica, reglas de stack de jugador |
| Storage / Chest | Capacidad mayor; misma operación `transferSlot` |
| House Storage | Contenedor por casa; permisos de dueño en el servidor |
| Shop Stock | Stacks altos; precio en otra tabla, nunca en el contenedor |

**Contrato sugerido para R32** (no creado):
- tablas `containers(id, owner_id, kind, capacity)`, `container_slots(container_id, slot_index, item_id, quantity, instance_id)` y `tool_instances(...)`;
- operaciones de servidor por intención (`gatherInto`, `transfer`, `equip`, `discard`), atómicas e idempotentes;
- el cliente nunca escribe espacios directamente (`AGENTS.md` §9–10).

## 9. Pendientes

- Números de `maxStack` y capacidad (R31-C2).
- Modelo A o B de herramienta equipada.
- Caducidad y tope de pendientes.
- Ordenar o compactar la mochila (no implementado).
- Descartar: hoy borra en la demo. En producción debería confirmar y quizás ser un sink explícito.

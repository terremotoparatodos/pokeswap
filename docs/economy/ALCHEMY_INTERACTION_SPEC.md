# Alchemy Interaction Spec (R31-C4)

> Implementación: `alchemy/stationPlacement.ts`, `alchemy/recipeBrowser.ts`, `alchemy/brewTimeline.ts`, `alchemy/alchemyOverlay.ts`, `alchemy/useAlchemyController.ts`, `components/AlchemyStationCard.vue`.
> Estado de la lógica: local (sesión demo). El servidor autoritativo sigue pendiente (R32+).
> Comparte motor y piezas con [Minería](MINING_INTERACTION_SPEC.md), [Pesca](FISHING_INTERACTION_SPEC.md) y [Tala](LOGGING_INTERACTION_SPEC.md).

## 1. Dónde vive la mesa

Esta es la decisión estructural de la fase: **Alquimia no tiene nodo**, así que necesitaba un lugar.

- **Quién decide:** `alchemyStationTile(port, anchor)`. Busca en anillos alrededor del *spawn del mundo* el primer **claro**: una casilla y sus cuatro vecinas libres de sólido, de agua y de nodos.
- **Determinista y sin estado:** la misma semilla pone la mesa en la misma casilla para todos. No hay lista guardada, igual que con los nodos de R31-A. En Pradera Brisa (semilla 208) cae en **(-9, -73)**.
- **Empieza en el anillo 4:** el spawn del mundo es también **la puerta de vuelta a la ciudad**. Con la mesa encima, caminar hacia ella te sacaba del mundo (bug B-1, corregido).
- **Cómo escala:** la función corre para todos los mundos del atlas (un test lo verifica). Cuando existan interiores o pueblos, la mesa pasa a ser un mueble del edificio y el ancla cambia; la interacción no.

## 2. Descubrimiento y acercamiento

| Distancia | Qué ve el jugador |
|---|---|
| En pantalla | Una mesa de trabajo en un claro: madera, frascos y un matraz |
| Al lado | La mesa se aclara y aparece la burbuja con matraz |
| Al tocarla | Se abre el panel de la estación |

- La mesa es **objeto de mundo** para el navegador (`isWorldObject`): tocarla de lejos camina hasta un costado, tocarla desde al lado la abre. Mismo mecanismo que rocas y árboles (R31-C1).
- **Alejarse con el panel abierto** y tocar Preparar cierra el panel (`isBeside`).
- **La mesa no tiene colisión** (la dibuja el overlay, y la solidez la decide el área): el jugador puede pararse encima. Ver limitaciones.

## 3. El navegador de recetas

`alchemy/recipeBrowser.ts` toma las recetas reales de R31-A (`RECIPES`, profesión `alchemy`, categoría `alchemy` — **8 recetas**) y agrega lo que la UI necesita y el dominio no tiene:

| Necesidad | Solución |
|---|---|
| Nombre | El catálogo no tiene campo `name`: el título se deriva de la salida |
| Dos recetas con el mismo nombre | `brew_revive` y `brew_revive_scale` producen ambas "Revivir": se les agrega el ingrediente que las distingue → *Revivir (con Esencia Salvaje)* y *Revivir (con Escama Corazón)* |
| Origen de cada ingrediente | `ITEM_BY_ID.profession` → chip "Minería / Pesca / Tala / Alquimia / Combate" |
| Por qué no puedo | `block`: `level` (con el nivel que falta) o `missing` (con el ingrediente y cuánto falta) |
| Qué me conviene | La receta preparable de mayor nivel se marca **Sugerida** |

**Orden de la lista:** preparables primero, después las que tienen faltantes, al final las bloqueadas por nivel; dentro de cada grupo, de mayor a menor nivel.

## 4. La acción

```text
Preparar N → validación local (nivel, ingredientes, cantidad, adyacencia)
           → input bloqueado (el motor sigue a 60 fps)
           → cargar → calentar → hervir → embotellar × N (máx. 6 pulsos)
           → se aplica la acción (resolveProcessing real de R31-A)
           → recompensa: íconos que suben, "+N", "+XP"
           → fin: input desbloqueado y tarjeta con el resultado
```

**Sin energía y sin herramienta.** No es una omisión: `resolveProcessing` no cobra energía (decisión D7 de R31-A) y Alquimia solo usa hoz para *recolectar*, no para procesar. La tarjeta lo dice explícitamente ("sin energía") en vez de mostrar una barra que no se mueve.

## 5. Lotes

- La cantidad va de 1 a `maxCraftable` (mínimo entre los ingredientes disponibles y el tope de 100 del dominio).
- El botón **Máx** salta al máximo; los pasos `−` y `+` son de 44 px.
- Si el inventario cambia y el máximo baja, la cantidad se ajusta sola.
- El costo mostrado **escala con la cantidad**: "Hierba Medicinal 10/8" es lo que necesita ese lote, no la receta unitaria.
- La animación no se repite por unidad (ver dirección de arte §4).

## 6. Cuando no alcanza

Nunca se toca "Preparar" y no pasa nada. La tarjeta muestra, en orden:

1. El ingrediente que falta y cuánto, en rojo: *"Te falta 1 × Hierba Medicinal"* (o "Te faltan N ingredientes").
2. El contador del ingrediente corto en rojo dentro de la lista (`1/2`).
3. El botón deshabilitado con el motivo: **"Faltan ingredientes"** o **"Requiere Nv. X"**.

En la lista, cada receta lleva su propio estado: `×N` (cuántas puedo), **Faltan**, **Nv. X** o **Sugerida**.

## 7. Pokémon trabajador

Reutiliza la pieza compartida de R31-C1 (`overworld/workerPresence.ts`, `workerCompanion.ts`): aparece al lado del jugador al empezar la preparación, mira la mesa, se queda todo el proceso y se va al terminar. Nunca sobre la mesa, sobre el jugador, en agua ni en otra casilla con nodo. **No hay animación por especie**: usa la hoja overworld existente.

Su rasgo `processing` sí tiene efecto real: **ahorra insumos** (`savedInputs` de `resolveProcessing`). Cuando pasa, la mesa suelta un destello, sube "Ahorró N" y la tarjeta muestra el banner "¡Tu Pokémon rindió el lote!".

## 8. Inventario

Sin lógica propia: productos e insumos entran y salen por el mismo camino que mineral, pescado y madera (`SlotContainer`, stacks, capacidad, `INVENTORY_FULL`, pendientes). Los productos terminados **no** son ítems de instancia (no llevan durabilidad ni id propio), así que apilan como cualquier consumible. Si el lote no entra, el resultado es `inventory_full` y la tarjeta lo dice.

## 9. Hallazgos del dominio (no resueltos acá)

| Id | Hallazgo | Qué se hizo |
|---|---|---|
| H-1 | Alquimia también **recolecta** (4 nodos, herramienta hoz) y esa mitad no tiene arte ni interacción | Documentado; la fase cubrió procesamiento |
| H-2 | `RecipeDefinition` no tiene **nombre, descripción ni ícono** | La UI deriva el título de la salida |
| H-3 | Dos recetas producen **el mismo ítem** y se veían iguales | Se desambigua por ingrediente, en la UI |
| H-4 | `build_alchemy_table` es receta de Alquimia pero de categoría `construction` | La mesa no la ofrece: no se construye una mesa sobre la mesa |
| H-5 | `resolveProcessing` **no valida la estación**: `recipe.station` solo afecta el tiempo | La UI abre la mesa igual; el servidor de R32 debería validarlo |
| H-6 | No hay noción de **calidad del producto** (normal/crítico) | No se inventó; el destacado visual usa `savedInputs`, que sí existe |

## 10. Sonido (documentado, no implementado)

No hay infraestructura de audio en el proyecto. Sonidos que pediría esta profesión, por orden de valor:

1. Seleccionar receta (clic corto).
2. Inicio de preparación (ingredientes al matraz + prender el hornillo).
3. Hervor en loop, suave, mientras dura.
4. Embotellado: un "cloc" de corcho por unidad (con el mismo tope de 6 del visual).
5. Producto terminado.
6. Resultado destacado (insumo ahorrado): un brillo corto sobre el anterior.

## 11. Pendiente para multiplayer (sin implementar)

- La mesa, la preparación y el consumo son locales: otros jugadores no los ven.
- Propuesta mínima, igual que en las otras profesiones: un flag cosmético `activity: { kind: 'brewing', tx, ty }` en el actor de presencia, y que el servidor valide estación, nivel e insumos. Es cambio de protocolo R30 y requiere aprobación.

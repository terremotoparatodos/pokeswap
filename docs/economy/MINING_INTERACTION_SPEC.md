# Mining Interaction Spec (R31-C1)

> Implementación: `mining/useMiningController.ts`, `mining/miningOverlay.ts`, `mining/nodeVisualState.ts`, `mining/miningAction.ts`, `components/MiningActionCard.vue`, y el motor (`engine/game.ts`, `engine/navigator.ts`, `engine/sceneOverlay.ts`).
> Estado de la lógica: local (sesión demo). El servidor autoritativo sigue pendiente (R32+).

## 1. Descubrimiento

| Distancia | Qué ve el jugador |
|---|---|
| Fuera de pantalla | Nada |
| En pantalla | La roca con mineral visible: un nodo se reconoce por su sprite, no por marcas |
| Dentro del radio de prospección | Nodos raros (oro, cúmulo) destellan cada pocos segundos |
| Al lado (1 casilla, jugador quieto) | Burbuja sobre el nodo (pico, candado o sello) y anillo suave en el suelo |

**Prospección:**
- `radio = 8 casillas × (1 + detection)`, con tope de 16 (`detectionRadius`). La detección sale de la afinidad del Pokémon trabajador.
- El laboratorio permite forzarla (control "Prospección").
- Es solo presentación: no revela nodos inexistentes ni cambia probabilidades.

**Alternativas evaluadas:**

| Opción | Resultado |
|---|---|
| Brillo permanente en todos los nodos | Descartado: todo parece interactivo |
| Ícono al pasar el mouse | Descartado: no existe en móvil |
| **Mineral visible en el sprite + burbuja al lado + destello de rarezas por prospección** | **Elegido**: se lee sin UI y la prospección gana presencia |
| Pulso de radar al abrir la tarjeta | Pendiente para una iteración futura (ver handoff) |

## 2. Acercamiento

- **Tocar el nodo de lejos:** el navegador camina hasta una casilla vecina, encara el nodo y lanza la interacción.
- **Nodos sólidos** (roca, peñasco, roca helada): ya funcionaba en R31-B.
- **Nodos caminables** (cristal, y en otras profesiones orilla o pasto alto): R31-C1 agrega `NavWorld.isInteractive`. El motor consulta `isWorldObject` (sonda sin efectos) y el navegador planifica al costado en lugar de encima. Resuelve el hallazgo B-15.
- **Tests** (`engine/worldObjectNavigation.test.ts`): llegada desde norte, sur, este, oeste y diagonal, con nodo sólido y con nodo caminable. Termina al lado y mirando el nodo. Las casillas comunes siguen caminándose encima.
- **Tocar el suelo detrás de la roca:** el jugador rodea la roca por la navegación normal (verificado en el laboratorio).

## 3. Interacción y targeting

- **Disparadores:** tocar el nodo estando al lado, o tecla de acción (E o Espacio) mirándolo. Cualquiera abre la tarjeta y encara el nodo.
- **Estado:** el nodo pasa a TARGETED (anillo dorado).
- **Tarjeta** (`MiningActionCard`):
  - recurso (ícono), nombre, nivel actual frente al requerido;
  - estado en una línea;
  - Pokémon trabajador (retrato y capacidad principal);
  - pico (ícono con condición y barra);
  - chips de recompensa, energía, desgaste y XP, con "Ver detalle" (desglose de R31-B);
  - acciones: Minar, Reparar y Recoger pendientes.
- **Cerrar:** botón × o seleccionar otro nodo. Durante la acción no se puede cerrar.

## 4. Acción de minar

```text
Minar → validación local (mismo estado que el panel) → input bloqueado (el motor sigue a 60 fps)
      → N golpes (2–4 según actionSeconds): windup → strike (destello + temblor + fragmentos) → recoil
      → al terminar el último golpe: se aplica la acción (resolver real, sesión demo)
      → recompensa en el mundo (íconos que suben, "+N", "+XP", ráfaga por rareza)
      → fin: input desbloqueado, tarjeta con el resultado y "Seguir minando"
```

- **Tarjeta durante la acción:** colapsa a encabezado más "Minando…".
- **Qué define el resultado:** la animación no cambia nada. El resultado sale del resolver; la cantidad de golpes solo refleja la duración.
- **Tiempos:** la duración de la animación está comprimida para el prototipo (≈1–2 s frente a 12–22 s reales). El servidor en R32 definirá la cadencia real.

## 5. Feedback

| Momento | Mundo | UI |
|---|---|---|
| Golpe | Destello del sprite, temblor de 1 px, 4–6 fragmentos, polvo y chispas en metal | "Minando…" |
| Resultado | Ícono del recurso sube, "+N" con color de rareza, "+XP" dorado, ráfaga final | Líneas: recursos, XP, energía, desgaste, subida de nivel, herramienta rota |
| Inventario | — | Espacio que recibió (rebote), espacio nuevo (brillo), stack completo (halo dorado); "Stack de X completo", "Nuevo espacio: X", "No entró: N X (queda pendiente)" |
| Raro o especial | Destellos y fragmento de color; permanece más tiempo | Cartel "¡Hallazgo especial!" y borde violeta |

## 6. Depletion y respawn

| Estado | Condición actual (dominio R31-A) | Visual |
|---|---|---|
| DEPLETED | Sin cargas personales y sin respawn conocido | Roca vaciada, cima astillada, escombros |
| RESPAWNING | Sin cargas y con cuenta regresiva activa | Roca vaciada con 1→3 motas de mineral según progreso; la tarjeta muestra "Se recupera en m:ss" |
| COOLDOWN | Pausa entre acciones | Input bloqueado hasta terminar la animación |

**Contrato faltante (no implementado, documentado):**
- Hoy toda depleción tiene respawn personal, así que el mundo casi siempre muestra RESPAWNING.
- DEPLETED sin respawn requiere agotamiento compartido o eventos, que R31-A no modela (hallazgo B-04).
- R32 debería exponer por nodo: `{ remainingCharges, respawnAt | null, sharedDepleted: boolean, nextActionAt }`.

## 7. Recompensa rara

La rareza del resultado es la más alta entre sus ítems, y un doble botín cuenta como RARE (`outcomeRarity`). Solo cambian partículas, destellos, colores y permanencia. No hay cinemáticas.

## 8. Errores y bloqueos

| Estado | Mundo | Tarjeta | Botón |
|---|---|---|---|
| LOCKED_LEVEL | Burbuja con candado al lado | "Requiere Minería Nv. X · Tenés Nv. Y" | Deshabilitado |
| SPECIAL_ACCESS | Burbuja con sello | "Tu Pokémon no puede llegar" y regla de acceso | Deshabilitado |
| NO_TOOL / TOOL_TIER | Burbuja con pico | "Necesitás un pico · Tier N" | Deshabilitado |
| TOOL_BROKEN | Burbuja con pico | "Tu pico está rota · Reparala" | Deshabilitado + Reparar |
| NO_ENERGY | Burbuja con pico | "Te falta energía · Necesitás X; tenés Y" | Deshabilitado |
| INVENTORY_FULL | Burbuja con pico | "Inventario lleno" | Deshabilitado |
| DEPLETED / RESPAWNING | Arte vaciado | "Agotado para vos · Se recupera en m:ss" | Deshabilitado |

**Nada se pierde en silencio:** si el mínimo garantizado entra, la acción se permite. Lo que no entra queda en "pendientes", visible y recuperable (ver [`INVENTORY_DESIGN.md`](INVENTORY_DESIGN.md)).

## 9. Presencia del Pokémon

- **Dónde aparece:** su retrato y su capacidad principal están en la tarjeta. Su prospección define el radio de destello. Su ahorro, extracción y cuidado cambian los números mostrados.
- **Qué no hace:** no golpea la roca. Así la mecánica es válida para las 493 especies sin sprites nuevos.

## 10. Pendiente para multiplayer (sin implementar)

- **Selección y animación:** el nodo seleccionado y la animación son locales. Otros jugadores no ven el golpe.
- **Propuesta mínima:** un flag cosmético `activity: { kind: 'mining', tx, ty }` en el actor de presencia. Es un cambio de protocolo R30 y requiere aprobación.
- **Cargas:** las cargas son personales, así que el sprite agotado es por jugador. Es correcto con el modelo de R31-A, pero dos jugadores pueden ver la misma roca en estados distintos. Documentado como decisión a validar.

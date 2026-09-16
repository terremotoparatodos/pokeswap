# R31-C4.1 — Recolección de Alquimia

> Rama: `feat/r31c4-1-alchemy-gathering-polish` (hija de `feat/r31c4-alchemy-visual-design` @ 8d665e2). **No mergeada.**
> Implementación: `art/foragePalette.ts`, `art/forageNodes.ts`, `art/forageItems.ts`, `art/forageFx.ts`, `forage/*`, `components/ForageActionCard.vue`.
> Cierra la deuda H-1 de [R31-C4](R31C4_HANDOFF.md): Alquimia también recolecta, y esa mitad no tenía arte ni interacción.

## 1. Auditoría previa (qué había)

| Pieza del mundo | Qué es | Cómo se usó |
|---|---|---|
| `bush` | Prop de 24×17, tres lóbulos de hojas, **sólido** | Anfitrión del arbusto de bayas y de la arboleda |
| `tallGrass` | **Terreno**, no prop: un tile de pasto alto | El parche de hierbas dibuja su propia mata encima |
| `crystal` | Prop de 14×18, cristal de tundra, no sólido, con brillo propio | Anfitrión de la flor de escarcha |
| `drybush`, `cactus`, `shell`… | Otros props | Sin nodos de Alquimia; intactos |
| `BUSH_RECIPES` | **Nuevo**: la receta del arbusto, extraída sin cambiar un píxel | Permite derivar variantes con el mismo volumen |

Los cuatro nodos y sus reglas salen tal cual del catálogo de R31-A (`domain/catalog/nodes.ts`), sin inventar nada:

| Nodo (id) | Nombre del catálogo | Ancla | Bioma | Nv. | Herramienta | Cargas | Respawn | Primario |
|---|---|---|---|---|---|---|---|---|
| `berry_bush` | Arbusto de bayas | `bush` | pradera, bosque | 1 | **ninguna** | 6 | 90 s | Baya Aranja |
| `herb_patch` | Parche de hierbas | `tallGrass` | pradera | 5 | **ninguna** | 5 | 120 s | Hierba Medicinal |
| `wild_grove` | Arboleda silvestre | `bush` | bosque | 15 | hoz T1 | 4 | 240 s | Baya Zidra |
| `frost_bloom` | Flor de escarcha | `crystal` | tundra | 30 | hoz T2 + **suelo helado** | 3 | 600 s | Baya Zanama |

## 2. Dirección visual

La regla de las otras tres profesiones se mantiene: **la planta es la planta del mundo**; lo que cambia es *lo que cuelga de ella*.

- **Arbusto de bayas:** el mismo arbusto, con **bayas azules** del color exacto del ícono de la Baya Aranja. Un jugador que ve una baya azul en la mochila reconoce la misma baya en el arbusto.
- **Arboleda silvestre (T2):** el mismo volumen de arbusto, pero cargado: **Baya Zidra (amarilla) y Baya Zanama (roja)** y una **corona de flores blancas**. No se confunde con el T1 (un solo fruto azul) ni con Tala (los árboles tienen tronco, cinta y leños; esto es un arbusto).
- **Parche de hierbas:** es el caso interesante, porque su ancla es **terreno**. No hay prop que reemplazar, así que el parche **dibuja su propia mata**: más alta que el pasto (12 px contra 5), de un verde más frío y con **tres flores pequeñas** en las puntas. El pasto alto decorativo se queda como está. Dos matas de pasto no se vuelven botones: solo el 2 % de las casillas de pasto alto aloja un parche.
- **Flor de escarcha:** el cristal de tundra con una **flor de hielo** encima. El cristal ya es celeste pálido, así que la flor **no puede ser celeste**: toma el violeta-blanco que usan las flores del kit, lleva borde oscuro propio y sobresale del contorno del cristal, con dos destellos. (Primero se probó con pétalos celestes y desaparecían sobre el cristal.)

**Lo agotado nunca es "lo mismo con opacidad":**

| Nodo | Recolectado | Rebrote |
|---|---|---|
| Arbusto / Arboleda | Ramitas peladas donde estaba el fruto | Brotes pálidos, después brotes con color |
| Parche de hierbas | Tallos al ras con el corte pálido | Matas altas otra vez, todavía sin flores |
| Flor de escarcha | Solo el tallo escarchado | El tallo engorda y se abre |

## 3. La hoz

Pico, hacha y caña son **rectos**: un mango con algo en la punta. La hoz es la única **curva**: mango corto y hoja en gancho que vuelve sobre la mano. Esa silueta es lo que la distingue a 16×16, y por eso está dibujada píxel por píxel: una curva paramétrica a ese tamaño se convertía en una mancha (se probó, y así fue).

- Tres tiers con los metales del pico (piedra, hierro, acero) y la madera compartida.
- **Rota:** el gancho se partió y solo queda el talón sobre el mango.
- **Inservible:** la misma rota, desaturada.
- **Barrido:** tres poses (alzada, media, atravesando la planta), espejadas según hacia dónde mira el jugador.

## 4. El loop

```text
encontrar planta → tocarla de lejos (el jugador camina al costado) → tocarla al lado
  → tarjeta → Recolectar → aparece el Pokémon trabajador
  → N gestos: acercar → tomar → la planta se mece y vuelve
  → se aplica la acción (resolver real de R31-A)
  → pétalos/briznas/semillas + "+N" + "+XP"
  → agotado → rebrote → disponible
```

**A mano o con hoz, lo decide el dominio.** `berry_bush` y `herb_patch` tienen `minToolTier: 0`: no piden herramienta, y el gesto es una **recolección a mano** (acercar → tomar → la planta se mece), sin hoz en pantalla. `wild_grove` y `frost_bloom` piden hoz y el gesto es un **barrido**.

Hay un matiz que se descubrió probando y que la UI ahora respeta: **si llevás una hoz usable, el dominio la usa y le gasta durabilidad aunque la planta no la exija** (`preview.bareHands` es falso). Entonces la animación es el barrido y la tarjeta muestra la hoz con la etiqueta **"opcional"**. La tarjeta dice "A mano · no necesita hoz" solo cuando de verdad no hay herramienta en juego. La animación sigue al dominio, nunca a la etiqueta.

## 5. VFX

Vegetales, no minerales: **pétalos** (más anchos que altos, nunca burbujas), **briznas cortadas** (solo cuando entra la hoz), **semillas**, **polvo vegetal** y, exclusivo de la tundra, **motas de escarcha**. Tope de 26 partículas simultáneas. Los pétalos **flotan**: caen más lento que los trozos de piedra de Minería.

## 6. Estados en el mundo

| Estado | Señal |
|---|---|
| Disponible | La planta con su fruto; nada más |
| Al lado | Burbuja con **mano** (planta sin herramienta) o con **hoz** (planta que la pide) + anillo suave |
| Seleccionada | Anillo verde marcado |
| Recolectando | Destello leve y la planta meciéndose |
| Bloqueada por nivel | Burbuja con candado |
| Bloqueada por capacidad | Burbuja con sello (la flor de escarcha pide **suelo helado**: Hielo, Fuego o Acero) |
| Raro detectado | Destello sobre arboleda y flor de escarcha dentro del radio de prospección |
| Agotado / rebrote | Arte propio por etapa (ver §2) |

## 7. Integración con la mesa

La mochila es la misma en los dos lados, así que el circuito cierra sin persistencia: se recolecta **Baya Aranja** en el arbusto, se camina a la **Mesa de Alquimia** (o se salta con el selector del laboratorio) y la receta de **Poción** la consume (2 Baya Aranja + 1 Frasco → 1 Poción). El laboratorio de Alquimia aloja las dos mitades: un selector arriba lleva a la mesa o a cualquiera de las cuatro plantas, y un indicador muestra en qué casilla está cada cosa y dónde está el jugador.

## 8. Sonido (documentado, no implementado)

1. Seleccionar planta.
2. Recolección a mano: dos hojas rozándose, corto.
3. Barrido de hoz: siseo de corte.
4. Fruto que cae en la mochila.
5. Flor de escarcha: un tintineo frío al abrirse.

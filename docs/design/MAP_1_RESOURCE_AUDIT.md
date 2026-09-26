# MAP-1 — Auditoría de recursos de Pradera y propuesta de zonas

> Solo auditoría y diseño, sobre `integration/world-skills-0.3 @ 9c1b8fe`. No se modificó ningún mapa, nodo ni código productivo.
> Todos los números salen del mundo real con `scripts/map/audit-pradera.ts` (terreno y props compartidos, layout de nodos de WORLD, mapeo de SKILLS, parcelas, portal y cuevas tal como los coloca el cliente). Datos completos en `docs/design/map-1/audit.json` y `proposal.json`.
>
> ```
> npx vite-node scripts/map/audit-pradera.ts -- docs/design/map-1
> ```

## 0. Resumen

- **Solo el 11 % de los árboles "comunes" es talable** (39 de 347) y **ningún pino** lo es para un jugador nuevo (los 29 pinos con nodo piden Talar 12). Rocas: **6 picables** en toda la ventana de 97×97 casillas.
- A **24 pasos** de la llegada hay **2 árboles y 3 rocas** trabajables. Con agotamiento tras una acción y respawn de 90 s, eso mantiene ocupado a **0,1 jugador talando y 0,3 minando**.
- Un jugador que trabaja sin parar necesita **~15 nodos de su oficio** (ciclo ≈ 6–7 s contra 93 s de ocupación por nodo). Esa es la escasez que se siente.
- Pradera no tiene piedra natural suficiente para una cantera: **la cantera tiene que ser autorada**. El bosque sí existe al sur de la llegada.
- **Recomendación:** un **bosque** de 22×18 al sur (35 árboles redondos existentes + ~25 plantados ≈ **60 árboles comunes**, todos talables), una **cantera autorada** de 16×14 al este (~**45 rocas**, todas picables), fuera de la zona **ningún árbol ni roca básica es trabajable**, y una **reserva** al norte para minerales de mayor nivel. Capacidad: ~7 jugadores trabajando sin esperar (4 talando + 3 minando); con 10 jugadores repartidos, ~62 % del tiempo trabajando.

## 1. Inventario exacto

Ventana auditada: 97×97 casillas centradas en la llegada `(-5,-69)`, de `x -53..43`, `y -117..-21` (9 409 casillas). Es la parte de un mundo procedural infinito que un jugador usa; el radio de vista del realtime es de 24 casillas.

### Árboles y rocas

| Prop | Visibles | Con nodo WORLD | Trabajables nivel 1 | Piden más nivel | Nodo sin recurso SKILLS |
|---|---|---|---|---|---|
| Árbol redondo (`tree`) | 347 | 39 | **39** (Árbol común) | 0 | 0 |
| Pino (`pine`) | 310 | 29 | 0 | 29 (Pino, Talar 12) | 0 |
| Pino nevado (`snowpine`) | 87 | 1 | 0 | 0 | 1 |
| Palmera | 0 | — | — | — | — |
| Roca (`rock`) | 17 | 7 | **6** (Roca) | 1 (carbón, Minería 10) | 0 |
| Roca de hielo (`icerock`) | 21 | 7 | 0 | 6 (hierro/oro) | 1 |
| Peñasco (`boulder`) | 0 | — | — | — | — |

Cómo se decide hoy: un prop es nodo si pasa la tirada de densidad de WORLD (`RESOURCE_VARIANTS`: árbol 12 %, pino 10 %, roca 35 %…), y es trabajable si además SKILLS le asigna un recurso válido para su bioma y anillo (`skillsResourceFor`). Dos filtros aleatorios sobre props idénticos.

**Diferencia visual actual:** el árbol talable lleva una cinta roja de ~2 px en el tronco; la roca picable, tres pepitas. El contorno solo aparece al estar al lado. Ver `map-1/ingame-lookalike-trees.svg`: el árbol talable `(-6,-64)` y el decorativo `(-5,-62)` son indistinguibles a distancia.

### Resto del mapa

| Elemento | Dato |
|---|---|
| Llegada (spawn) | `(-5,-69)` |
| Portal a Ciudad | `(-5,-70)`, una casilla al norte de la llegada |
| Parcelas (huerta) | 4: `(-7,-73) (-6,-73) (-7,-72) (-6,-72)`, a 3–5 pasos |
| Cuevas (dungeons, 3×2) | 6: anclas `(-26,-74) (7,-59) (-24,-43) (19,-58) (-30,-85) (16,-49)`, a 24–45 pasos |
| Caminos | **ninguno**: el mundo procedural no tiene casillas de camino |
| Terreno | pasto 4 331 · pasto alto 2 421 · nieve 1 361 · agua 738 + profunda 421 · arena 137 |
| Colisiones | 959 props sólidos (árboles, pinos, arbustos 173, rocas), 1 159 casillas de agua, 36 casillas de cuevas |
| Casillas alcanzables a pie desde la llegada | 8 389 |
| Otros props | arbustos 173, cristales 5 (se recogen al pisar), coral 5, roca marina 4 |

Geografía: pradera abierta alrededor de la llegada; bosque denso al sur (desde `y ≈ -62`); nieve al norte y noroeste; mar al este. El anillo de SKILLS pasa de 0 a 1 a 96 casillas del origen; la llegada está a 69, así que todo lo cercano es anillo 0 (solo recursos básicos, salvo pinos).

## 2. Ratios

| Medida | Valor |
|---|---|
| Árboles visibles talables (todos los tipos) | **5,2 %** (39 / 744) |
| Árboles redondos talables | **11,2 %** (39 / 347) |
| Rocas visibles picables (todos los tipos) | **15,8 %** (6 / 38) |
| Rocas `rock` picables | **35,3 %** (6 / 17) |
| Árbol talable más cercano | `(-6,-64)`, **7 pasos**; el siguiente, `(18,-68)`, 23 pasos |
| Roca picable más cercana | `(-5,-77)`, **9 pasos**; la siguiente, `(11,-70)`, 16 pasos |
| Distancia típica entre nodos (vecino más cercano, Manhattan) | árboles: mediana **5** (p25 3, p75 11); rocas: mediana **17** (p25 12, p75 17) |
| Nodos básicos disponibles a ≤12 / 24 / 36 / 48 pasos | árboles **1 / 2 / 11 / 21** · rocas **1 / 3 / 4 / 6** |

## 3. Mapas

| Archivo | Qué muestra |
|---|---|
| `map-1/pradera-today.svg` (+ `.png`) | Todos los props; borde blanco = árbol talable, naranja = roca picable, violeta = pide más nivel, negro = nodo sin recurso; llegada, portal, huerta, cuevas, radio de vista |
| `map-1/pradera-reach.svg` | Distancia caminando desde la llegada (bandas de 12 pasos), recursos básicos, zonas vacías y el cuello de la llegada |
| `map-1/pradera-proposal.svg` | Propuesta recomendada: bosque, cantera, reserva, huerta, llegada libre y rutas |
| `map-1/ingame-lookalike-trees.svg` | Captura local anotada: árbol talable vs. decorativo idéntico |

Lectura:
- **Zonas vacías:** toda la pradera alrededor de la llegada (radio ~10) y el este hasta el mar. Hay 1 árbol y 1 roca a menos de 12 pasos.
- **Cuello de botella:** la llegada. Portal, spawn y las 4 parcelas están dentro de 3 casillas; todos aparecen ahí y la huerta se trabaja ahí.
- **Contención:** la única roca cercana `(-5,-77)` y el único árbol cercano `(-6,-64)` los comparten todos los que empiezan.
- **Circulación:** llegada → sur (bosque), → oeste (cuevas 1 y 5), → este (pradera abierta), → norte (nieve). El bosque natural tiene ~25 % de casillas bloqueadas y huecos de una casilla.
- **Lugares aptos:** bosque natural al sur `(-8,-45)`, 22×18, 35 árboles redondos + 34 pinos, 80 % libre, 29 pasos. Pradera abierta al este `(11,-69)` y al norte `(-6,-84)`, 94–96 % libres, 16 pasos: aptas para una cantera autorada.

## 4. Capacidad

Reglas actuales, sin cambios: una acción agota el nodo, respawn de WORLD 90 s, duraciones de SKILLS (nivel 1, aptitud media: talar 3,0 s, minar 3,2 s). Modelo:

- ciclo del jugador = acción + ~2,5 s (respuesta, beat de recompensa, reabrir el panel) + caminar al siguiente nodo (3,75 casillas/s);
- cada nodo rinde una acción cada (90 s + acción);
- jugadores ocupados sin esperar = nodos × ciclo / (90 + acción). Por encima, el tiempo trabajando es proporcional.

| Escenario | Árboles | Rocas | Ocupados sin esperar (talar / minar) | 2 jug. | 5 jug. | 10 jug. | 30 jug. |
|---|---|---|---|---|---|---|---|
| **Hoy** (≤24 pasos) | 2 | 3 | 0,1 / 0,3 | 10 % | 4 % | 2 % | 1 % |
| Mínima | 24 | 18 | 1,6 / 1,3 | 100 % | 52 % | 26 % | 9 % |
| **Recomendada** | 60 | 45 | 4,0 / 3,1 | 100 % | 100 % | 62 % | 21 % |
| Densa | 120 | 90 | 7,8 / 6,0 | 100 % | 100 % | 100 % | 40 % |

Porcentaje = tiempo trabajando con los jugadores repartidos mitad Talar, mitad Minería (`audit.json → alternatives[].busyShare`, que también trae "todos talan" y "todos minan").

**Nodos por jugador continuo: ~15 por oficio.** El respawn de 90 s es la palanca más fuerte: con 30 s (el valor que el catálogo de SKILLS sugiere para los recursos básicos) la capacidad se triplica sin agregar un solo nodo. Queda fuera de este alcance; lo marco para balance.

## 5. Alternativas

Todas cumplen la regla: dentro de la zona, todo árbol redondo es talable y toda roca es picable; fuera de las zonas del anillo 0, los árboles y rocas básicos son decoración (no nodos).

| | **Mínima** | **Recomendada** | **Densa** |
|---|---|---|---|
| Árboles comunes | ~24 (los redondos que ya existen en un bosquecito 14×12) | **~60**: 35 existentes + ~25 plantados | ~120, mayoría plantados |
| Rocas comunes | ~18 autoradas | **~45 autoradas** | ~90 autoradas |
| Área | bosque 14×12, cantera 10×10 | **bosque 22×18, cantera 16×14** | bosque 30×24, cantera 22×18 |
| Separación y caminos | ≥1 casilla libre entre nodos; un pasillo central | ≥1 casilla libre alrededor de cada nodo; pasillos de 2 casillas cada 5–6; zonas a ≥3 casillas de la llegada libre (9×9) | igual que la recomendada, con más pasillos; bosque en dos manzanas |
| Tiempo muerto | con 5 jugadores ~48 % esperando; se agota en minutos | 5 jugadores sin esperar; con 10, ~38 % esperando | 10 jugadores sin esperar; con 30, ~60 % esperando |
| Competencia | alta: pocos nodos, se pisan | baja con ≤5, moderada con 10 | baja hasta 10 |
| Coste | bajo: casi todo es terreno existente + una cantera chica | medio: plantar ~25 árboles, autorar 45 rocas | alto: el bosque pasa a ser casi todo autorado; más props por chunk |

### Recomendada (detalle)

Coordenadas en `map-1/proposal.json`:

| Zona | Caja (x · y) | Centro, pasos | Contenido |
|---|---|---|---|
| **Bosque** | `-19..2 · -54..-37` | `(-8,-45)`, 29 pasos, al sur | 35 árboles redondos → todos Árbol común; ~25 plantados sobre 171 casillas libres, respetando pasillos; **34 pinos** dentro |
| **Cantera** | `3..18 · -76..-63` | `(11,-69)`, 16 pasos, al este | ~45 rocas autoradas en grupos de 3–5, pasillos de 2 |
| **Reserva** (mayor nivel, futuro) | `-14..1 · -91..-78` | `(-6,-84)`, 16 pasos, al norte, hacia la nieve | vacía por ahora |
| Reserva huerta | `-12..-8 · -75..-70` | junto a las parcelas | vacía por ahora |
| Llegada libre | `-9..-1 · -73..-65` | — | sin recursos; anillo de 3 casillas alrededor |

- Bosque y cantera quedan a lados opuestos de la llegada: los flujos no se cruzan. Ninguna caja toca cuevas, portal, parcelas ni agua.
- **Decisión pendiente, pinos del bosque:** (a) *recomendado*: todos los pinos de la zona son Pino (Talar 12). Son visualmente distintos, ya existen como recurso y cumplen "mayor nivel, distinto, en subzona", sin recursos nuevos. (b) Todos decorativos.
- **Decisión pendiente, fuera de las zonas:** recomiendo que ningún árbol ni roca básica sea nodo en el anillo 0 (se acaba el "probar uno por uno"). Hoy existen 39 árboles y 6 rocas sueltos; pasarían a decoración.

## 6. Riesgos

**Colisiones y consistencia**
- Las rocas autoradas (y los árboles plantados) deben ser sólidos igual en el cliente (`World`) que en el servidor (patrullas de salvajes, `workPlacement.standableTile`, llegada segura). `terrain.js` no se toca: su huella está congelada (`worldFingerprint.test.ts`). Hace falta una capa autorada compartida que lean los dos lados.
- **Cuevas:** su ubicación depende de `isSolid`. Agregar props puede mover alguna cueva. Mitigación: excluir las zonas vía `isTaken` y verificar con `npm run dungeon:entrances`.
- **VISUAL-2:** el entrenador necesita una casilla libre atrás o al costado. Empaquetar demasiado sube los rechazos `no-room` (hoy ~1,6 %); el diseño de pasillos debe mantenerlos por debajo del 2 % (medible con el script).
- El guard del portal (`praderaPortalGuard.test.ts`) debe seguir pasando.

**Persistencia**
- Los ids de nodo son derivados (`pradera:x:y:variant`). Los nodos sueltos que desaparezcan dejan filas de override que `restore` ignora y vencen solas. Sin migración.

**Rendimiento**
- El servidor guarda solo nodos en uso o agotados: unos 105 nodos en la recomendada es despreciable.
- Por chunk, el snapshot lista los nodos agotados: en el peor caso ~60 registros en el chunk del bosque, pocos KB.
- Cliente: +45 rocas y ~25 árboles como props; el arte de nodo está memoizado.
- La alternativa densa duplica esos números; sigue siendo bajo, pero conviene medir el frame en móvil con el benchmark existente.

**Navegación móvil**
- Las copas miden 34×42 px y tapan la casilla de arriba: en un bosque denso un toque puede caer sobre el árbol de adelante. Los pasillos de 2 y ≥1 casilla libre por árbol lo evitan.
- El pathfinding (`maxNodes 5000`) alcanza de sobra para 30 pasos.
- En la cantera los grupos de rocas no deben cerrar callejones: a verificar con BFS en MAP-2.

**Producto**
- El jugador nuevo verá pinos en el bosque que piden nivel 12. Es un mensaje claro, no prueba y error, pero conviene que el panel lo diga antes de elegir Pokémon.
- Los fixtures de tests usan "el primer nodo cerca de la llegada" (`praderaNodesNearSpawn`): cambiarán y hay que ajustarlos.

## 7. Archivos para MAP-2

Compartido / servidor:
- `services/realtime/src/world/resourceZones.js` + `.d.ts` (**nuevo**): cajas de bosque, cantera y reserva; rocas y árboles autorados; `isSolidAt(areaId, tx, ty)` en capa sobre el terreno.
- `services/realtime/src/world/resourceLayout.js` + `.d.ts`: `resourceAt` según zona (dentro, todo prop básico es nodo; fuera, no); props autorados.
- `services/realtime/src/world/wildPopulation.js`: solidez con la capa autorada.
- `services/realtime/src/world/workPlacement.js`: `standableTile` con la capa autorada.
- `services/realtime/src/world/testing.js`: fixtures de nodos cerca de la llegada.
- `src/features/worldSkills/resourceMapping.ts`: en el bosque, `tree` → Árbol común y `pine` → Pino; en la cantera, `rock` → Roca.
- `services/realtime/src/world/skills/skills.generated.js`: regenerado con `scripts/integration/bundle-skills.mjs`.
- `services/realtime/src/world/terrain.js`: **no se modifica** (huella congelada).

Cliente:
- `src/features/wildlands/engine/world.ts` (`decorAt` / `isSolid` con la capa autorada), `chunks.ts` si hace falta, `areas/wildArea.ts`.
- `src/features/dungeonEntrances/components/DungeonEntrances.vue`: cuevas fuera de las zonas (`isTaken`).
- `src/features/wildlands/engine/minimap.ts` (opcional): tinte de zona para reconocerlas.

Tests:
- **Nuevo** `resourceZones.test.js`: todo árbol redondo del bosque y toda roca de la cantera es trabajable; ninguno fuera; conectividad y pasillos; `no-room` < 2 %; zonas libres de portal, cuevas, parcelas y agua.
- Ajustar: `resourceMapping.test.ts`, `praderaPortalGuard.test.ts`, `worldFingerprint.test.ts` (debe seguir igual), `integration.test.js`, `resourceAuthority.test.js`, `worldRoom.test.js`, `workPlacement*.test.js`, `PresenceRoom*.test.js`, `plots.test.js`, `wildPopulation.test.js`, `sharedWorld.acceptance.test.ts`, `workerPresentation.acceptance.test.ts`.

Docs y herramienta:
- este reporte y un `WORLD_MAP_2_REPORT.md`.
- `scripts/map/audit-pradera.ts` como verificación de aceptación, para re-medir tras implementar.

Sin cambios de base de datos, Edge Functions ni balance.

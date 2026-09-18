# T-S3 — Lenguaje visual de estaciones

> Fecha: 2026-09-18. Escrito por la **estación secundaria**.
> Base contractual: `origin/integration/r31` @ `bfc08365ceeaaf8e8c23317a1765eeb67cdcd6ae`. Rama `art/station-visual-language`.
> **Sólo arte.** No se implementó Horno, Construcción ni placement; no se tocó F-1, el motor, la navegación, el renderer, los overlays, las profesiones ni la Mesa de Alquimia.

**Qué es esto:** un kit procedural para tres estaciones futuras — Horno, Fogata y Banco de trabajo — que las hace legibles como objetos interactivos y les da cuatro estados comunes.
**Qué no es:** una estación funcional. Nada de esto se coloca, bloquea, se toca ni produce nada todavía.

---

## 1. El lenguaje visual común

El problema que resuelve es concreto: el mundo genera rocas, árboles y arbustos, y una estación dibujada sin cuidado se lee como uno más. Cinco reglas, todas heredadas de lo que ya funcionó en la Mesa de Alquimia (`art/alchemyStation.ts`):

1. **Silueta trabajada.** El decorado del mundo es orgánico; una estación es *construida*: aristas rectas, ángulos, piedra cortada, madera aserrada, hierro. Es lo que más separa una estación de un peñasco a primera vista.
2. **Pies al frente.** El anclaje va en el borde inferior-frontal del arte, como todo prop del mundo, para que el orden de dibujo y la adyacencia coincidan con lo que el jugador ve.
3. **Base en el suelo.** Todas se apoyan en algo: tierra pisada, base de piedra, marca de quemado. Es lo que dice "esto lo puso alguien".
4. **Cuatro estados compartidos**, con el mismo significado en las tres.
5. **Un rasgo activo** por estación que carga el estado: el fuego en el Horno, la llama en la Fogata, la pieza en el Banco. El estado debe leerse a distancia, sin abrir ningún panel.

### Paleta compartida

Una familia de materiales estrecha a propósito, para que las tres parezcan construidas por las mismas manos:

| Familia | Uso |
|---|---|
| `FIREBRICK_TONES` | Ladrillo cocido: el cuerpo del Horno (T-S3.2) |
| `MASONRY_TONES` | Piedra cortada: base del Horno, anillo de la Fogata, zapatas del Banco |
| `TIMBER_TONES` | Madera aserrada: tablero, vigas, leña partida |
| `IRON_TONES` | Hierro: zunchos, herramientas, olla, lingote |
| `FIRE_TONES` | Fuego, de oscuro a blanco: **un solo color para "esto está funcionando"** |
| `PAD_TONES` | El suelo pisado bajo la estación |
| `READY_PIP` / `DONE_SPARKLE` | Las dos marcas de estado compartidas |

## 2. Estaciones incluidas

| Estación | Módulo | Silueta | Rasgo activo |
|---|---|---|---|
| **Horno** | `art/furnaceStation.ts` | Chimenea baja de ladrillo cocido con hiladas, flejes de hierro y boca arqueada | El fuego en la boca, el humo y el lingote en la repisa |
| **Fogata** | `art/campfireStation.ts` | Trípode de tres palos atados sobre un anillo de ocho piedras iguales y una marca de quemado | La llama, las brasas y la olla colgada |
| **Banco de trabajo** | `art/workbenchStation.ts` | Tablero ancho sobre patas con zapatas de piedra, panel trasero con herramientas y cajón con tiradores | La pieza sobre el tablero y si el serrucho está colgado o en el corte |

La **Mesa de Alquimia** no forma parte del kit: ya existe, es la referencia de calidad y **no se tocó**.

## 3. Los cuatro estados

| Estado | Significado | Horno | Fogata | Banco |
|---|---|---|---|---|
| `idle` | Frío, vacío. Sigue leyéndose como estación | Boca oscura, parrilla vacía | Anillo frío, leña apilada, trípode desnudo | Tablero despejado, serrucho colgado, cajón cerrado |
| `ready` | Tiene lo que necesita; se puede empezar | **Cargado y sin encender**: mineral dentro de la boca y en la repisa, compuerta abierta, sin brasas ni resplandor | Yesca y ramitas puestas, pedernal en la piedra | Material y plano sobre el tablero |
| `working` | Está corriendo. **El único estado animado** | Tres lenguas de fuego, resplandor pleno, humo | Llama alta y chispas | Serrucho en el corte, con aserrín |
| `done` | Terminó; hay algo para retirar | **Boca apagada** y lingote brillante en la repisa, con el calor saliendo | Brasas y la olla bajada del gancho, humeando | Pieza terminada sobre el tablero |

Dos marcas son idénticas en las tres, para que el jugador las aprenda una vez: el **pip ámbar** de `ready` y el **destello** de `done`.

La Mesa de Alquimia llama `brewing` a su estado en marcha: es el mismo `working` con nombre de profesión, y **no se renombró**.

### Cuánto se distinguen, medido

`working` anima en **4 frames** y vuelve a empezar; los otros tres estados ignoran el frame, así que se cachean una sola vez. Píxeles que cambian entre pares de estados (medido con `pixelDifference`):

| Estación | Par más parecido | Par más distinto | `ready` vs `done` |
|---|---|---|---|
| Horno | `idle` vs `done` — 26 px | `ready` vs `working` — 122 px | **67 px** (era 33) |
| Fogata | `idle` vs `ready` — 26 px | `working` vs `done` — 108 px | 105 px |
| Banco | `ready` vs `working` — 34 px | `idle` vs `done` — 70 px | 70 px |

El test exige **≥ 20 px** entre cualquier par. El número no es arbitrario: la primera versión de la Fogata cambiaba 8 px entre `idle` y `ready` y no se distinguía; por eso `ready` ahora pone yesca, ramitas y pedernal en vez de sólo encender el pip. El Horno tuvo el mismo problema (11–31 px entre estados) y por eso su boca es más grande y el fuego arroja luz sobre la piedra.

## 4. Dimensiones y anclajes

Todas en píxeles de arte. El anclaje es siempre la fila inferior (`anchorY = height − 1`) y el centro horizontal.

| Estación | Ancho | Alto | Anchor X | Anchor Y | Constante |
|---|---|---|---|---|---|
| Horno | 30 | 34 | 15 | 33 | `FURNACE_BOUNDS` |
| Fogata | 32 | 26 | 16 | 25 | `CAMPFIRE_BOUNDS` |
| Banco | 34 | 28 | 17 | 27 | `WORKBENCH_BOUNDS` |
| *(referencia)* Mesa de Alquimia | 34 | 30 | 17 | 29 | `STATION_W/H` en su módulo |

Las diferencias de altura son intencionales: el Horno es el alto, la Fogata la baja. Eso ayuda a distinguirlas de lejos antes de mirar el detalle, y está fijado por test.

Un test congela los tres `*_BOUNDS` exactos, para que una estación colocada más adelante no quede desalineada en silencio si el arte cambia de tamaño.

## 5. Qué parte es sólo arte

**Todo.** Los módulos devuelven `PixelArt` — `{ w, h, pixels, ax, ay }`, el mismo formato que el resto de `art/` — y no saben nada más.

No hay, y es deliberado: solidez, hitbox, `PlacedObject`, footprint, tiles, colisión, navegación, picking, interacción, receta, combustible, duración, XP, economía ni persistencia. Hay un test que falla si cualquiera de esas palabras aparece en el código del kit, precisamente para que la separación que F-1 construyó no se filtre desde acá.

**Dependencias:** sólo `./pixelArt` y las primitivas puras de píxeles que todo `art/` ya usa (`engine/pixels`, `engine/sprite`, `engine/props`). Nada de motor con estado, renderer, overlays, Vue, DOM, dominio, inventario ni servicios; un test lo verifica leyendo el código fuente con una lista blanca. Conviene decirlo con precisión: `pixelArt.ts` **sí** toca el motor para sus primitivas y para el puente a canvas — el aislamiento es respecto del estado del juego, no del módulo de píxeles.

**Nada de esto entra en `dist`:** nadie lo importa todavía, y se verificó que ningún identificador del kit aparece en el build.

## 6. Qué depende de F-1

F-1 ya está implementado (`engine/placedObjects.ts`, ver `docs/wildlands/F1_OBSTACLE_PROVIDER_DESIGN.md` §11). Para que una de estas estaciones exista en el mundo hace falta lo que **este kit no hace**:

- **Un `PlacedObject`** con `id`, `areaId`, `anchor`, `footprint`, `solid`, `interactive` y `kind`, declarado por quien coloque la estación.
- **Un `hitbox`**, que el contrato de F-1 toma como dato del objeto. Los `*_BOUNDS` de acá son la medida correcta para declararlo, pero **la declaración vive con la colocación, no con el arte**, y nadie verifica que coincidan: si el arte cambia de tamaño hay que actualizar la declaración (limitación conocida de F-1 §11.4).
- **Un tile**: hoy la única estación colocada deriva su posición por anillos desde el spawn (`F1-O3` sigue abierto).
- **Un overlay** que dibuje el arte y decida qué estado mostrar.

**Footprint:** las tres están pensadas como 1×1, igual que la Mesa. El arte del Horno y el del Banco es más ancho que un tile, así que —igual que la Mesa hoy— cubriría tiles vecinos a efectos de toque. Si deben ocupar más de un tile es `C-7`, y no se decide acá.

## 7. Qué falta para que Horno, Fogata y Banco funcionen

Por orden de dependencia:

1. **Colocarlas** con el contrato de F-1: quién las pone, dónde y con qué footprint (`O-10`, `C-5`, `C-7`).
2. **Conectar el estado**: hoy `idle/ready/working/done` es un parámetro que alguien tiene que calcular a partir de un proceso real.
3. **El loop del Horno**: qué consume, si hay combustible como concepto separado, cuánto tarda (`O-8`) — propuesto en `CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md` §2, sin números.
4. **Construcción como profesión**, para que las estaciones se levanten en vez de aparecer (`A-9`, `O-10`, `C-1`, `C-2`).
5. **Autoridad y persistencia**: las 16 validaciones de `CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md` §7.

## 8. Limitaciones conocidas

- **Es arte sin consumidor.** Nada lo importa; no se ve en ninguna parte del juego. No hubo verificación visual en pantalla: la evidencia son los tests y las mediciones de píxeles.
- **La animación es de 4 frames** y sólo en `working`. Quien la dibuje debe pasar el frame; no hay reloj acá.
- **El `ready` del Horno y su `done` son el par más parecido** (33 px). Se distinguen por el lingote y el destello; si en pantalla no alcanza, el ajuste natural es apagar más las brasas en `done`.
- **Sin variantes por nivel, material ni daño.** Una estación se ve igual esté nueva o a punto de romperse, aunque el catálogo ya modele condición y mantenimiento (`catalog/tools.ts`, `STRUCTURES`).
- **Sin sombra propia ni iluminación nocturna**: el puente a sprite del kit ya calcula silueta, pero nadie la usa todavía.
- **La paleta es nueva**, no derivada de la del mundo. Si al verlas en el mundo desentonan, el lugar del ajuste es `stationVisuals.ts` y afecta a las tres a la vez — que es exactamente para lo que existe.

## 9. Lo que todavía no existe

Dicho sin rodeos, porque es fácil confundir un kit de arte con un sistema:

> **No hay placement, ni colisión propia de estas estaciones, ni recetas asociadas, ni persistencia, ni autoridad de servidor, ni economía.** Este entregable dibuja tres objetos en cuatro estados y nada más.

---

## Apéndice · Archivos

| Archivo | Rol |
|---|---|
| `src/features/professions/art/stationVisuals.ts` | El contrato: estados, tipos, paleta, partes compartidas (base, bloque, fuego, brasas, marcas) y utilidades de test (`stationArtHash`, `pixelDifference`, `inked`) |
| `src/features/professions/art/furnaceStation.ts` | Horno |
| `src/features/professions/art/campfireStation.ts` | Fogata |
| `src/features/professions/art/workbenchStation.ts` | Banco de trabajo |
| `src/features/professions/art/stationVisuals.test.ts` | 17 tests: cobertura de estados, determinismo, distinción, geometría, formato y dependencias |

Lecturas previas: `CONSTRUCTION_SMELTER_DESIGN_DISCOVERY.md`, `F1_OBSTACLE_PROVIDER_DESIGN.md`, `PRE_R32_DESIGN_DECISIONS.md` (A-8), `art/alchemyStation.ts`, `art/pixelArt.ts`, `art/alchemyPalette.ts` y `art/alchemyArt.test.ts`.

---

# T-S3.1 — Revisión visual (pendiente de HUMAN VISUAL APPROVAL)

> Lab: `/dev/estaciones` (`components/playground/StationVisualLab.vue`), sólo en desarrollo.
> **No se rediseñó nada.** Lo de abajo es lo observado; qué se cambia lo decide la revisión humana.

El lab tiene tres vistas — las cuatro estaciones sobre el terreno real de Pradera Brisa, una comparación alineada por el anclaje con regla de tiles, y una matriz de 4 estaciones × 4 estados — más botones de estado por estación y la animación de `working`.

## Lo que se ve bien

- **Anclaje.** Las cuatro apoyan en la línea de suelo sin flotar ni hundirse, y la marca de anclaje cae centrada en las cuatro. Nada que corregir.
- **Estados.** Los cuatro se distinguen en las cuatro estaciones, también a escala de mundo. El Horno es el más legible: boca oscura → brasas → fuego lleno → lingote.
- **Mesa de Alquimia + Banco de Trabajo.** Son las dos que mejor conversan: misma familia de madera cálida, misma lectura de "mueble de trabajo". El Banco entró en el lenguaje que ya existía.
- **Animación.** Los cuatro frames de `working` se leen como movimiento en el Horno y la Fogata; en el Banco el serrucho se mueve poco pero se nota.

## Lo que desentona — para decidir

1. **El Horno es el único gris frío.** Mesa, Fogata y Banco tiran a marrón cálido; el Horno queda en una familia de materiales propia y, junto a las otras tres, parece de otro set. Es la observación más fuerte de esta revisión.
2. **El Horno se lee más como máquina que como obra de sillería.** El cuerpo es muy rectangular y liso: no hay hiladas, juntas ni textura de ladrillo, así que a escala de mundo parece un aparato antes que un horno de piedra.
3. **La Fogata es notablemente más chica** (28×22 = 1,75 × 1,38 tiles, contra 2,13 del Banco y la Mesa) y **queda plana**: sobre el pasto se lee como un montón de piedras. Es la que más riesgo corre de pasar por decorado, que es justo lo que el lenguaje quiere evitar.
4. **`ready` y `done` del Horno se parecen** a escala de mundo: los dos muestran naranja en la boca. Es el par más cercano del kit (33 px). Coincide con lo que ya estaba anotado como limitación.
5. **La olla de la Fogata en `done`** se lee como un bloque gris; no dice "olla" a esta escala.
6. **El tornillo del Banco** es la pieza menos clara: a tamaño real es una mancha gris azulada en la esquina.

## Escala, medida

| Estación | Ancho | Alto | Tiles ancho | Tiles alto |
|---|---|---|---|---|
| Mesa de Alquimia (referencia) | 34 | 30 | 2,13 | 1,88 |
| Horno | 30 | 34 | 1,88 | 2,13 |
| Fogata | 28 | 22 | 1,75 | 1,38 |
| Banco de Trabajo | 34 | 28 | 2,13 | 1,75 |

Las cuatro entran en el rango de la Mesa; la Fogata es la excepción por abajo.

## Límites de esta revisión

- **El lab pinta el mundo, no lo renderiza.** Usa el mundo real como dato — mismo seed, mismo terreno, mismos props sólidos, misma cuadrícula — pero con colores planos propios. R31 sólo permite instanciar el motor a los cuatro field labs existentes, y sumar este lab a esa lista exige tocar un test existente: es una decisión de revisión.
- Por lo anterior, **no se juzgó** cómo quedan bajo la iluminación, el clima ni la cámara del juego. En una comprobación previa con el motor real (sin dejarla en el árbol) las conclusiones 1, 2 y 3 se sostenían, y el verde saturado de la pradera acentuaba el problema de paleta del Horno.
- Sin sombra proyectada: el renderer la agrega y puede cambiar cuánto "apoyan".

---

# T-S3.2 — Polish final (congelado para HUMAN FINAL REVIEW)

Se corrigieron **sólo** las seis observaciones de T-S3.1. No se agregó gameplay, integración ni nada nuevo al lenguaje: las mismas cuatro estaciones, los mismos cuatro estados, la misma idea de familia.

## Horno

**Era:** el único gris frío del set, y a escala de mundo parecía una máquina.

- El cuerpo y la chimenea pasaron a **ladrillo cocido** (`FIREBRICK_TONES`, cálido), con **hiladas de mortero** dibujadas encima — junta horizontal cada cuatro filas y verticales alternadas. Eso es lo que lo hace leer como obra hecha por hiladas y no como una pieza moldeada.
- La **base y la repisa siguen en piedra gris**, que es lo que lo mantiene emparentado con el anillo de la Fogata y las zapatas del Banco.
- Los **flejes de hierro** eran dos bandas anchas y claras que se comían la silueta: ahora son dos flejes finos y oscuros con remaches en los extremos. El hierro sujeta el ladrillo en vez de reemplazarlo.

Sigue sin tener una sola fibra de madera y sigue siendo el único de sillería: no se confunde con la Mesa ni con el Banco.

## Horno · `ready` vs `done`

**Era:** los dos con naranja en la boca; a escala de mundo se confundían (33 px de diferencia).

Ahora son situaciones distintas y se ven distintas:

- **`ready` = cargado y sin encender.** Mineral amontonado **dentro** de la boca, más lumbre en la repisa, la compuerta del tiro abierta y el pip ámbar. **Nada de fuego**: ni brasas ni resplandor.
- **`done` = proceso terminado.** La boca apagada y oscura, y lo único brillante es el **lingote** sobre la repisa — trapecio de metal con la cara superior clara, un destello, y el calor saliendo hacia la piedra.

Medido: **67 px de diferencia, el doble que antes**. Uno tiene la boca llena de piedra mate; el otro, metal claro afuera. No hace falta texto.

## Fogata

**Era:** la más chica y la más plana; sobre pasto se leía como un montón de piedras.

- Gana un **trípode**: tres palos apoyados en un vértice, atados arriba, con un **gancho de hierro** colgando. Nada en la naturaleza hace esa forma, así que la silueta dice "acá acampa alguien" antes de mirar el detalle, y le da la verticalidad que a las otras se la da su cuerpo.
- El arte creció de 28×22 a **32×26** para alojarlo: sigue siendo la más chica de las cuatro y sigue dentro de la escala del set (2,00 × 1,63 tiles).
- El anillo de ocho piedras y la marca de quemado siguen igual.

## Fogata · la olla

**Era:** un rectángulo gris que no se entendía.

Se rehízo con las tres cosas que dicen "olla" a cualquier tamaño: **panza más ancha que alta y recogida en la base**, **borde que sobresale** un píxel a cada lado, y **asa en arco** por encima. Baja del gancho y se apoya sobre las piedras en `done`, con el contenido asomando y vapor saliendo.

## Banco de trabajo

**Era:** el tornillo era una mancha gris azulada que nadie podía leer.

Se **eliminó** y en su lugar hay un **cajón bajo el tablero** con dos tiradores de hierro: una forma inequívoca a cualquier tamaño, que además dice "mueble donde se guardan herramientas" sin competir con la pieza de arriba, que es la que lleva el estado. El cajón va metido respecto de los extremos del tablero, con una línea de sombra debajo, para que el tablero vuelva a sobresalir y el banco no se lea como tres tablas apiladas.

## Qué NO se tocó

- **Los cuatro estados**: `idle / ready / working / done`, con el mismo significado.
- **El lenguaje compartido**: las cinco reglas, el pip de `ready`, el destello de `done`, el color único del fuego.
- **Los anclajes**: siguen en la fila inferior y centrados. El de la Fogata pasó de (14, 21) a (16, 25) sólo porque el arte cambió de tamaño; la regla es la misma.
- **La escala del set**: sólo cambió la Fogata, y hacia arriba, para acercarse al resto.
- **La Mesa de Alquimia**: intacta, como referencia.
- Nada de gameplay, placement, colisión, recetas ni persistencia.

## Escala final

| Estación | Ancho | Alto | Tiles ancho | Tiles alto |
|---|---|---|---|---|
| Mesa de Alquimia (referencia) | 34 | 30 | 2,13 | 1,88 |
| Horno | 30 | 34 | 1,88 | 2,13 |
| Fogata | 32 | 26 | 2,00 | 1,63 |
| Banco de Trabajo | 34 | 28 | 2,13 | 1,75 |

## Validación

Revisado en `/dev/estaciones` en las tres vistas (terreno, comparación alineada, matriz de estados), en desktop y a 375 px. Sobre el verde de la pradera las cuatro comparten ahora la misma temperatura de color y ninguna desaparece contra el fondo.

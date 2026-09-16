# R31-C3 — Dirección de arte de Tala

> Estado: kit implementado y probado en el motor real de WildLands (laboratorio del playground). **Solo en desarrollo**, sin persistencia. Rama `feat/r31c3-logging-visual-design`.
> Assets: [`LOGGING_ASSET_MANIFEST.md`](LOGGING_ASSET_MANIFEST.md). Interacción: [`LOGGING_INTERACTION_SPEC.md`](LOGGING_INTERACTION_SPEC.md). Auditoría: [`R31C3_HANDOFF.md`](R31C3_HANDOFF.md).
> Base: Minería [`R31C1_MINING_ART_DIRECTION.md`](R31C1_MINING_ART_DIRECTION.md) · Pesca [`R31C2_FISHING_ART_DIRECTION.md`](R31C2_FISHING_ART_DIRECTION.md).

## 1. El problema propio de Tala

Minería agrega rocas con mineral; Pesca marca el agua. Tala tiene que convivir con **un bosque que ya está lleno de árboles**, y la mayoría no son recursos. El riesgo no es que el hacha se vea mal: es que el bosque se convierta en un tablero de botones.

De ahí la regla que ordena todo el kit:

> **Un árbol talable es el árbol del mundo con una marca de hachero en el tronco.** Nada más. Sin contorno, sin ícono flotante, sin tinte.

## 2. Auditoría del bosque (antes de dibujar)

| Aspecto | Qué encontré | Consecuencia |
|---|---|---|
| **Árboles** | `tree` 34×42, `pine` y `snowpine` 28×44, `palm` 40×46, generados con volúmenes y paleta de 5 tonos | Los nodos usan **las mismas recetas** (`treeKindPixels`), exportadas en R31-C3 sin cambiar un píxel del mundo |
| **Tronco** | Cápsula de 4 tonos, contorno `#2a180e`, en una caja conocida por especie | La marca y el tocón se tallan sobre esa caja (`TREE_METRICS.trunk`) |
| **Colisión** | Todos los árboles son decor sólido | Se talan desde una casilla vecina, igual que las rocas: reusa la navegación de R31-C1 |
| **Anclaje** | Pies en la base del tronco; sombra proyectada por hora | Tocón y árbol joven mantienen ancla y sombra |
| **Copas** | Se superponen entre árboles vecinos | La selección se resuelve por casilla tocada, no por píxel de copa |
| **Densidad de nodos** | `ANCHOR_DENSITY`: 12 % de `tree`, 10 % de `pine` y `snowpine`, 20 % de `palm` | El bosque sigue siendo bosque: 1 de cada 8-10 árboles es recurso |

## 3. Árboles talables

| Nodo (R31-A) | Anfitrión | Qué lo distingue |
|---|---|---|
| Árbol común (T1) | `tree`, `palm` | Marca de hacha |
| Pino (T1, Nv. 8) | `pine` | Marca + tres gotas de resina ámbar en el tronco |
| Árbol de madera dura (T2, Nv. 15) | `tree` | Marca + corteza oscura con veta marcada |
| Pino boreal (T3, Nv. 30) | `snowpine` | Marca + corteza gris y escarcha |

La **corteza se repinta por tier** (`retint`) sin tocar la copa: el árbol sigue siendo el mismo volumen, pero se lee que la madera es distinta.

## 4. La marca de hacha (el descubrimiento)

Tres filas de madera clara con labio oscuro, talladas a media altura del tronco. Es una señal **diegética**: los hacheros marcan así los árboles que van a cortar.

**Alternativas evaluadas:**

| Opción | Resultado |
|---|---|
| Contorno o brillo en el árbol entero | Descartado: convierte el bosque en UI |
| Ícono de hacha flotante sobre cada árbol | Descartado: mismo problema, y no escala a un bosque |
| Una especie distinta solo para talar | Descartado: rompe la composición del bioma |
| **Marca tallada en el tronco + burbuja al lado** | **Elegido**: se aprende una vez y sirve para siempre |
| Partículas continuas (hojas cayendo) | Descartado por rendimiento: serían decenas de árboles animados |

## 5. Estados visuales

| Estado | Señal |
|---|---|
| AVAILABLE | Árbol normal con la marca en el tronco |
| INTERACTABLE | Burbuja con hacha y anillo suave, solo al lado |
| TARGETED | Anillo dorado |
| CHOPPING | Destello leve del tronco y temblor de 1 px por hachazo |
| Cae | Inclinación creciente, hojas que se sueltan y el tronco baja |
| TOCÓN | Tocón con cara de corte pálida, anillos y astillas al pie |
| REGROWING | Tocón → brote → árbol joven |
| LOCKED / SPECIAL | Burbuja con candado o sello, solo al lado |
| RARE | Destello si el árbol de madera dura o boreal está en radio de prospección |

## 6. Hachas

| Tier | Cabeza | Detalle |
|---|---|---|
| T1 piedra | Gris piedra | Cuña de un solo filo sobre mango de madera |
| T2 hierro | Acero claro | — |
| T3 acero | Azul acero | Remache dorado |
| Rota | Mango partido en dos y cabeza desprendida | Reparable |
| Inservible | Desaturada y oscurecida | Sin reparaciones |

Icono de 16×16 y tres cuadros de 18×18 en el mundo, anclados a la mano, espejados según la orientación.

## 7. Lenguaje de animación

```text
preparación 260 ms (hacha arriba) → mordida 90–100 ms (destello, temblor, astillas, hojas)
  → recuperación 220 ms (la madera sigue vibrando un instante)
× 2–4 hachazos → si era la última carga: caída 420 ms → recompensa 950 ms
```

**Más lento y más pesado que el pico:** la madera responde tarde. El temblor del tronco se apaga en dos pasos en vez de cortarse de golpe.

## 8. ¿El árbol cae? Decisión

Evalué las cuatro opciones del brief:

| Opción | Veredicto |
|---|---|
| A · Cae el árbol entero (rotación) | **Descartada.** Rotar pixel art de 34×42 se ve dentado y obliga a cuadros nuevos por especie; además hay que sincronizarla en multiplayer |
| B · Desaparece y queda tocón | Clara y barata, pero abrupta: el hachazo final no pesa |
| **C · Cambio progresivo y después tocón** | **Elegida.** El árbol se inclina alejándose del jugador, baja unos píxeles, la copa suelta una ráfaga de hojas y queda el tocón. Cero cuadros nuevos: es el mismo sprite desplazado |
| D · Otra | — |

La caída dura 420 ms y solo ocurre en el **último corte** del árbol: mientras le queden cargas, el árbol aguanta y solo tiembla.

## 9. VFX propios

| Efecto | Forma | Por qué no es Minería recoloreada |
|---|---|---|
| Astilla | 3×1 alargada, clara con cola oscura | La piedra salta en fragmentos cuadrados; la madera se astilla |
| Hoja | 4×3 de dos tonos, con dos cuadros | Cae despacio, se mece de lado y voltea: es lo que más dice "madera" |
| Aserrín | Nube cálida y suave | El polvo de roca es gris y seco |
| Corteza | 2×2 con tono de veta | Salta en la mordida |

Las hojas usan su propio módulo (`logging/leaves.ts`) porque necesitan deriva lateral; astillas y aserrín reutilizan el pool compartido de 40 partículas.

## 10. Responsive y rendimiento

- Solo los árboles **visibles** reciben estilo de decor, y solo los que están al lado o seleccionados dibujan marcador o anillo.
- Hojas con tope de 24; partículas con el tope compartido de 40; ninguna animación permanente sobre el bosque.
- A 375 px la tarjeta colapsa durante la acción y deja ver el hachazo; los botones miden 44 px.

## 11. Decisiones descartadas

| Alternativa | Por qué no |
|---|---|
| Sprites de árbol nuevos por nodo | Rompería la continuidad del bioma y multiplicaría el arte |
| Tocón genérico único | Pierde el tier: el tocón conserva la corteza de su madera |
| Barra de progreso sobre el árbol | El hachazo ya comunica avance |
| Hojas cayendo todo el tiempo en árboles talables | Caro y ruidoso; las hojas son respuesta al hacha |

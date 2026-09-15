# R31-C1 — Dirección de arte de Minería

> Estado: kit de assets implementado y probado en el motor real de WildLands (laboratorio del playground). **Solo en desarrollo**, sin persistencia. Rama `feat/r31c-mining-visual-design`.
> Assets: [`MINING_ASSET_MANIFEST.md`](MINING_ASSET_MANIFEST.md). Interacción: [`MINING_INTERACTION_SPEC.md`](MINING_INTERACTION_SPEC.md). Inventario: [`INVENTORY_DESIGN.md`](INVENTORY_DESIGN.md). Auditoría: [`R31C1_HANDOFF.md`](R31C1_HANDOFF.md).

## 1. Referencia tomada de WildLands

Datos verificados en el código antes de diseñar:

| Aspecto | Qué hace WildLands | Consecuencia para Minería |
|---|---|---|
| **Pipeline de props** | Rocas, árboles, cactus y cristales **no son PNG**: `engine/props.ts` los genera con volúmenes (elipses y cápsulas) iluminados arriba a la izquierda, paleta de 3–5 tonos con dithering Bayer 4×4 y contorno de 1 px (`engine/sprite.ts`) | Los nodos se generan con **la misma receta y las mismas funciones** (`shade`, `ellipses`, `capsules`, `layer`). No hay assets externos |
| **PNG** | Solo edificios y props de ciudad (`public/assets/town`), personajes y hojas overworld de Pokémon | No se agregaron PNG: el kit es código versionado y reproducible |
| **Escala** | Casilla de 16 px. Roca 16×12, peñasco 30×23, roca helada 20×15, cristal 14×18 | Cada nodo conserva **exactamente** el tamaño del prop que lo aloja |
| **Cámara** | Proyección tipo Mode 7 con sprites billboard, sombra proyectada según la hora y lluvia/noche por encima | Los nodos heredan sombra, luz y clima sin código extra |
| **Personajes** | Hojas de entrenador de 4 direcciones y 4 cuadros de caminata; sin cuadros de acción | El golpe se hace con un **pico overlay** (ver §6), sin tocar las hojas |
| **Efectos existentes** | Destello en cruz (`drawSparkle`), halo de portales, marcas planas en el suelo | Anillos y destellos siguen esas formas |
| **UI existente** | Navy `#101a36`, borde azul `#3a5fb8`, dorado `#ffd27a`, esquinas 10–14 px, tipografía del sistema (`LobbyHud`, `WildPokemonCard`) | Tarjeta de minería y mochila usan esos tokens (`components/professions.css`) |

## 2. Principios

1. **Parece un prop de WildLands con algo adentro.** La base de cada nodo es el prop anfitrión; el mineral es una capa encima. Una veta agotada es la misma roca sin mineral.
2. **El mundo no es una interfaz.** Nada se marca a distancia salvo el destello de rarezas dentro del radio de prospección. Las marcas aparecen al estar al lado.
3. **Se lee sin texto.** El estado (disponible, agotado, regenerando, bloqueado) se reconoce por el sprite y un marcador pequeño.
4. **Acción repetible.** El feedback es corto (≈2 s) y escala con la rareza. Nada de pantallas completas ni confeti.
5. **Barato.** Sprites memoizados (un canvas por variante), partículas de 2–5 px, pool de 40 como máximo, sin DOM sobre el canvas salvo la tarjeta.

## 3. Nodos

| Nodo | Anclas | Lectura |
|---|---|---|
| Afloramiento de piedra | roca | Roca con 3 cortes de piedra clara y una marca de cincel |
| Veta de carbón | roca, peñasco | Motas y pepitas negras con un brillo gris frío |
| Veta de hierro | peñasco, roca helada | Pepitas óxido-naranja con un punto metálico blanco |
| Veta de oro | peñasco, roca helada | Pepitas amarillas más grandes y un destello cálido |
| Cúmulo cristalino | cristal | Cristal cian existente con un **corazón violeta** (Fragmento Evolutivo) |

**Paleta de minerales** (`art/miningPalette.ts`): 3 tonos más un brillo por mineral. Los tonos de roca se importan de `ROCK_RECIPES` para no divergir del mundo.

**Distinguibilidad** (verificada por test): oro, hierro y carbón usan tonos de mineral disjuntos. Probado sobre desierto, pradera, tundra, bosque y panel en la galería.

## 4. Estados visuales

| Estado | Señal | Dónde se ve |
|---|---|---|
| AVAILABLE | Sprite con mineral, sin marcas | Siempre |
| INTERACTABLE | Burbuja blanca con pico (estilo globo de pensamiento Pokémon) y anillo blanco suave en el suelo | Al estar al lado |
| TARGETED | Anillo dorado con pulso leve | Tarjeta abierta |
| IN_PROGRESS | Anillo dorado, destello blanco del sprite en cada golpe, temblor de 1 px | Durante la acción |
| DEPLETED | Mineral arrancado (huecos oscuros), cima astillada, dos piedritas al pie | Sin cargas y sin respawn conocido |
| RESPAWNING | Como agotado, con 1→3 motas de mineral que vuelven según el progreso | Sin cargas con respawn en curso |
| LOCKED_LEVEL | Sprite normal y burbuja con candado dorado | Solo al lado (no se castiga visualmente de lejos) |
| SPECIAL_ACCESS | Burbuja con rombo azul ("sello") | Solo al lado; el nodo requiere capacidad del Pokémon |
| RARE | Destello blanco (oro) o violeta (cristal) intermitente | Dentro del radio de prospección |

**Descartado:**
- contornos fluorescentes;
- opacidad reducida para agotado (se confunde con niebla o noche);
- íconos permanentes sobre cada roca;
- texto flotante con el nombre del nodo.

## 5. Herramientas

| Tier | Cabeza | Mango | Detalle |
|---|---|---|---|
| T1 Piedra | Gris roca (tonos de `rock`) | Madera (tonos de tronco) | — |
| T2 Hierro | Gris acero claro | Madera | — |
| T3 Acero | Azul acero | Madera | Remache dorado y gema violeta (usa Fragmento Evolutivo en la receta) |
| Rota | Cabeza desplazada 1 px, mango partido, fisura | — | Reparable |
| Inservible | Desaturada y oscurecida | — | Sin reparaciones restantes |

- **Presencia:** ícono 16×16 en inventario, equipo y tarjeta. En el mundo, 3 cuadros de golpe de 18×18 anclados en la mano del jugador.
- **Durabilidad en UI:** barra bajo el ícono (verde, amarilla, ámbar, roja).

## 6. Lenguaje de animación

**Golpe** (`mining/miningAction.ts`):

```text
windup 220 ms (pico arriba) → strike 90 ms (pico abajo, destello del nodo, temblor, impacto) → recoil 190 ms
× 2–4 golpes (según la duración real de la acción) → recompensa 950 ms (+ extra por rareza)
```

- **Orientación:** el pico va a la derecha o izquierda según hacia dónde mira el jugador. Mirando hacia arriba se dibuja detrás; hacia abajo, delante.
- **Pokémon trabajador:** aparece al lado del jugador durante la acción, con su sprite overworld normal y mirando al nodo (detalle en `MINING_INTERACTION_SPEC.md` §9). La fantasía es "trabajo junto a mi Pokémon", sin animaciones por especie.
- **Personaje y entrada:** no se modificaron las hojas del personaje. Durante la acción el motor bloquea el input (`setInputLocked`) sin bajar los fps.
- **Descartado:**
  - cuadros nuevos de entrenador: habría que hacerlos para los 3 personajes, 4 direcciones y 2 velocidades;
  - que el Pokémon golpee la roca: no escala a 493 especies;
  - shake de cámara: acopla el motor y marea en móvil.

## 7. VFX por rareza

| Rareza | Ejemplo | Fragmentos | Chispas | Destellos | Etiqueta | Permanencia extra |
|---|---|---|---|---|---|---|
| COMMON | Piedra, carbón | 4 grises | 0 | 0 | Blanca | 0 ms |
| UNCOMMON | Hierro | 5 (uno óxido) | 2 | 0 | Durazno | 150 ms |
| RARE | Oro, doble botín | 6 (uno dorado) | 3 | 1 | Amarilla | 400 ms |
| SPECIAL | Fragmento Evolutivo | 6 (uno violeta) | 2 | 3 violetas | Lila | 800 ms |

- **Recompensa:** el ícono pixel del recurso sube desde la roca con "+N" al lado. "+XP" va en dorado arriba. En la mochila, el espacio que recibió el recurso rebota; un espacio nuevo aparece con brillo y un stack que se completa, con halo dorado.
- **Sonido:** no hay infraestructura de audio en la app actual (se retiró con el legado en R23). No se construyó un sistema. Assets sonoros sugeridos: golpe de piedra, golpe de metal, roca que se agota, botín raro, botín especial, stack completo, mochila llena, herramienta rota.

## 8. Responsive

- **Mundo:** el renderer ya reduce el zoom en pantallas chicas (`fit` en `renderer.ts`). Los marcadores se dibujan en píxeles del mundo y escalan igual.
- **Tarjeta:** ancho `min(380px, 100% − 1.5rem)`. Durante la acción se colapsa a encabezado más pastilla de estado.
- **Mochila:** grilla de 6 columnas en móvil, detalle por toque (sin hover) y equipo en 4 casillas grandes.

## 9. Decisiones descartadas

| Alternativa | Por qué no |
|---|---|
| PNG dibujados a mano o descargados | Rompe el pipeline procedural existente; requiere procedencia y licencia |
| Sprite propio para cada nodo, sin roca base | Pierde la continuidad con el mundo y la huella de colisión |
| Texto "MINAR" sobre las rocas | Convierte el mundo en cartelería |
| Glow permanente en todos los nodos | Todo parece interactivo; no respeta la estética DS |
| Hojas de animación nuevas del jugador | Alto costo y alto acoplamiento para un prototipo |
| Barra de progreso dentro del canvas | Duplica la tarjeta; el golpe ya comunica progreso |

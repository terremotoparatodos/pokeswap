# MAP-2 — Bosque y cantera de recursos básicos

> Rama `world/map-resource-zones-0.3`, desde `design/map-resource-audit-0.3 @ c36b119` (sobre `integration/world-skills-0.3 @ 9c1b8fe`).
> Sin cambios en agotamiento, respawn (90 s), tiempos, XP, materiales, requisitos, settlement, persistencia, feature gate, Supabase ni Edge Functions. Sin materiales raros ni arte nuevo. `terrain.js` intacto: su huella congelada sigue igual.

## 1. Qué cambió

**Regla nueva de Pradera.** Dentro de una zona, todo prop que parece un recurso *es* ese recurso. Fuera de las zonas no hay nodos, y los props parecidos se dibujan como fondo.

| Zona | Caja | Contenido | Recurso SKILLS |
|---|---|---|---|
| **Bosque · Talar** | `-19..2 · -54..-37` (22×18) | **60 árboles redondos** (31 existentes + 29 plantados), **29 pinos** | árbol → Árbol común (Talar 1) · pino → Pino (**Talar 12**, sin cambios) |
| **Cantera · Minería** | `3..18 · -76..-63` (16×14) | **45 rocas** colocadas | roca → Roca (Minería 1) |
| Reserva minerales | `-14..1 · -91..-78` | vacía | — |
| Reserva huerta | `-12..-8 · -75..-70` | vacía | — |

**Capa autorada.** `services/realtime/src/world/resourceZones.js` define zonas, corredores (lanes), buffers, rutas, reservas y la zona libre de la llegada. Por encima del generador procedural pone una capa de datos, `resourceZoneLayout.js`: 99 casillas (25 despejadas, 29 árboles plantados, 45 rocas).
- La genera `scripts/map/zone-layout.ts` de forma determinista; `--check` falla si los datos se desvían.
- Cliente (`World` de Pradera) y servidor (`resourceAt`, `workPlacement`, homes de salvajes) leen la misma capa con `decorAtArea` / `isSolidAtArea`.
- `new World(seed)` sin área sigue dibujando el generador puro, así que la huella congelada no cambia.

**Consistencia visual** (sin arte nuevo):
- Fuera de las zonas, árboles redondos, pinos y rocas se dibujan como **fondo**: el mismo sprite desaturado y oscurecido. Las rocas, además, con un tinte musgo, porque ya son grises. Ver `map-2/backdrop-contrast.png`.
- Los recursos conservan su color, la cinta del tronco y las pepitas.
- Props sin gemelo trabajable (pino nevado, roca de hielo, arbustos) no cambian de aspecto.

**Rutas y nombres:**
- Senda de tierra pisada desde la llegada hasta cada zona y por sus corredores; son marcas de suelo, como los anillos existentes.
- Nombre flotante en cada entrada: "Bosque · Talar" y "Cantera · Minería".

**Pinos:**
- Todos los del bosque son recursos reales, con Talar 12.
- La ficha dice "Requiere Talar 12 · Tenés Talar 1 · seguí con Árbol común" (feedback que ya existía; verificado en vivo).
- Fuera del bosque, los pinos son fondo.

**Cuevas:** `DungeonEntrances.vue` trata zonas, rutas y reservas como ocupadas. Sin esa guarda, la cueva 6 se habría movido de `(16,-49)` a `(11,-70)`, dentro de la cantera. Con ella, las 6 cuevas quedan exactamente donde estaban (test).

## 2. Antes / después

Ventana 97×97 alrededor de la llegada `(-5,-69)`. "Antes" = `docs/design/map-1/audit.json`; "después" = `docs/design/map-2/audit.json`, con el mismo auditor.

| Medida | Antes | Después |
|---|---|---|
| Árboles redondos visibles / talables | 347 / 39 (11 %) | 364 / **60** — dentro del bosque **100 %**, fuera 0 (304 de fondo) |
| Pinos visibles / con nodo | 310 / 29 (dispersos, nivel 12) | 303 / **29**, todos en el bosque (100 % de los pinos del bosque); fuera 274 de fondo |
| Rocas `rock` visibles / picables | 17 / 6 (35 %) | 61 / **45** — dentro de la cantera **100 %**, fuera 16 de fondo |
| Nodos en la ventana | 83 dispersos (45 básicos, 38 de nivel o sin recurso) | 134, todos en zonas; **0** fuera |
| Props idénticos a un recurso que no lo son | 319 (308 árboles + 11 rocas), más 310 pinos indistinguibles entre nodo y decoración | **0** (594 lookalikes dibujados como fondo) |
| Recurso más cercano a la llegada | árbol 7 pasos, roca 9 | entrada del bosque **17** (árbol 19), cantera **9** (roca 8) |
| Básicos a ≤12 / 24 / 36 / 48 pasos | árboles 1/2/11/21 · rocas 1/3/4/6 | árboles 0/19/47/58 · rocas 6/37/45/45 |
| Distancia entre nodos (mediana) | árboles 5 · rocas 17 | **2 · 2** |
| `no-room` (VISUAL-2) | ~1,6 % | **0 %** (0 de 445 lados) |
| Cuevas | 6 | **las mismas 6** |

**Capacidad** (modelo de MAP-1, reglas actuales intactas):

| | Ocupados sin esperar (talar / minar) | 2 jug. | 5 | 10 | 30 |
|---|---|---|---|---|---|
| Antes (≤24 pasos) | 0,1 / 0,3 | 10 % | 4 % | 2 % | 1 % |
| **Después** | **3,9 / 3,0** | 100 % | 100 % | 60 % | 20 % |

Porcentaje = tiempo trabajando, jugadores repartidos mitad y mitad. El límite sigue siendo el respawn de 90 s: ~15 nodos por jugador continuo.

**Rutas y corredores:**
- Bosque: cruz de corredores de 2 casillas (`x -5..-4` en todo el alto, `y -47..-46` en todo el ancho) y fila buffer `y -45` sin árboles, para que ninguna copa tape el corredor.
- Cantera: cruz `x 10..11`, `y -70..-69`.
- Rutas: `x -5..-4 · y -64..-55` hacia el bosque, `x 0..2 · y -70..-69` hacia la cantera.
- Todo despejado, conectado a la llegada, y a ≥ 3 casillas de la zona libre de la llegada.

**Coste de render y AOI:**
- Props en la ventana: 969 → 1 016 (+4,9 %). Máximo por chunk: 63 → 61 (la cantera reemplaza vegetación).
- Máximo de nodos por chunk: 38. En el peor caso, con todos agotados, el snapshot del chunk ronda **4,2 KB**. El servidor sigue guardando solo nodos en uso o agotados.
- Fondo: 3 sprites cacheados (árbol, pino, roca).
- Senda: ~150 elipses cuando está en vista.

## 3. Mapas y capturas

- `map-2/pradera-zones.svg` / `.png`: el mapa como quedó. Nodos con borde, fondo en gris, corredores y rutas, reservas, cuevas.
- `map-2/pradera-reach-after.svg`: distancia caminando.
- "Antes": `map-1/pradera-today.svg`, `map-1/pradera-reach.svg` y `map-1/ingame-lookalike-trees.svg`.
- `map-2/backdrop-contrast.png`: arriba lo trabajable (árbol, pino, roca), abajo el mismo tipo como fondo.
- `map-2/ingame/`: capturas locales.
  - `pc-forest-entry.png`: entrada del bosque con la senda y el cartel.
  - `pc-quarry.png`: la cantera con su cruz de corredores.
  - `mobile-forest-working.png`: móvil 375×812, Scyther talando desde el corredor.
  - Las capturas de PC son anteriores al refuerzo del tinte de las rocas de fondo; la versión final está en `backdrop-contrast.png`.

**Prueba visual local** (realtime local + PGlite + Vite, sin servicios hosted):
- **PC:** bosque y cantera se encuentran desde la llegada (cartel + senda). Talé 3 árboles seguidos desde el corredor y miné 3 rocas seguidas; el entrenador retrocedió cada vez sin trabarse. Pino → ficha de nivel. Roca agotada → "Agotado · vuelve en 24 s".
- **Móvil:** ruta al bosque por toque. Tocar la **copa** de un árbol camina hasta él y abre su ficha. Trabajo completo por toque.

## 4. Tests y gates

Nuevos:
- `services/realtime/src/world/resourceZones.test.js`: 1:1 prop↔nodo por zona; ningún nodo fuera; ids únicos que resuelven a sí mismos y conjunto congelado (`134:327f12ac`); la capa solo toca terreno planificado; llegada, portal, huerta y reservas libres con la separación de 3; corredores de 2 despejados, sin copas encima, conectados; VISUAL-2: todo nodo tiene lado trabajable, esperas nunca en portal/nodo/parcela/sólido, `no-room` ≤ 1,6 %; determinismo.
- `src/features/world/domain/zoneParity.test.ts`: cliente y servidor idénticos casilla por casilla (decor y colisión, radio 64); `World` sin área = generador puro; **cuevas sin desplazamiento**; el fondo nunca es copia exacta del recurso.
- `resourceMapping.test.ts`: una sola asignación por aspecto en cada zona (árbol → común 1, pino → pino 12, roca → roca 1).

Ajustados:
- `testing.js`: fixtures con los árboles primero.
- `sharedWorld.acceptance.test.ts`: mundo de Pradera con capa.
- `workPlacement.room.test.js`: el caso `no-room` real ahora lo produce otra acción en curso; el terreno solo ya no deja nodos sin lugar.

| Gate | Resultado |
|---|---|
| realtime (Node 22, incluye integración PGlite) | 177: **157 pass, 0 fail, 20 skip** (staging: requiere Supabase local) |
| vitest | **180 archivos, 1 731 pass** |
| typecheck / build | OK |
| lint | 0 errores (9 warnings preexistentes en `AuthModal.vue`) |
| drift SKILLS (`bundle-skills.mjs --check`) | OK (bundle regenerado: incluye el mapeo por zona) |
| capa determinista (`zone-layout.ts --check`) | OK |
| huella `worldFingerprint.test.ts` | sin cambios |

## 5. Riesgos restantes

1. **IDs:** los nodos dispersos de antes dejan de existir. Sus overrides en base de datos se ignoran al restaurar y vencen solos. Los settlements históricos no se tocan. Sin migración.
2. **Cambiar la capa es cambiar el mapa:** el test de ids congelados obliga a hacerlo a sabiendas.
3. **Tinte de fondo:** la diferencia descansa en color y oscuridad, no en forma. Con daltonismo o de noche conviene validarlo con personas.
4. **Copas:** a lo largo de la ruta al bosque, un árbol de fondo tapa parte de la columna izquierda (`x -5`). La derecha queda libre. Tocar una copa selecciona su árbol (verificado); en el borde de dos copas vecinas elige el tile tocado.
5. **Densidad:** el bosque es denso a propósito. Los corredores y el anillo libre de los árboles plantados mantienen `no-room` en 0 %; con muchos jugadores, los lados libres se reparten (el `no-room` por ocupación sigue siendo posible y limpio).
6. **Capacidad:** con 10 jugadores ~40 % del tiempo esperando. La palanca pendiente es el respawn (fuera de alcance).
7. **Objetos colocados del cliente** (`placedObjects`): no hay ninguno en las zonas; el servidor no los conoce.
8. **Otras áreas silvestres:** sin zonas, conservan su comportamiento. Hoy solo Pradera es procedural en el servidor.

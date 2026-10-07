# ECO-MAP-1 — Nidos propuestos sobre los mapas reales

> Rama `tools/eco-map-1-0.3`, desde `tools/eco-balance-1-0.3 @ ae869d34858a3b04cc525c62882159e4e50632a2`. Las ramas anteriores no se modificaron.
> **Propuesta de desarrollo, no integrada.**
> - No cambian layout, colisiones, recursos, portales ni mapas de producto.
> - No se tocaron `worldRoom.js`, `wildService.js`, presencia, sesiones, protocolo, economía, SQL, dependencias ni CI.
> - C1 es la alternativa de trabajo de ECO-BALANCE-1, no una aprobación de sus grupos.
> - La cuestión rareza por individuo / por grupo sigue pendiente y no se tocó.

---

## 1. Resumen

- **10 nidos propuestos:**
  - **Pradera abierta: 5** (4 de pastizal y 1 de orilla, porque el agua sólo está en la costa este);
  - **Bosque: 2**;
  - **Cueva: 3**.

  No son los 6 por zona de la grilla sintética: el mapa real admite más o menos según el entorno (§3).
- **Geometría real, no dibujada:**
  - Una instantánea generada lee **sólo** los módulos compartidos que usan el servicio de presencia y el navegador: `navigation`, `resourceZones`, `resourceLayout`, `workPlacement`, `caves`, `caveLayouts`, `terrain`, `plots`, `arrival` y `layoutVersion`.
  - Tiene `--check`, y un test verifica casilla por casilla que la instantánea decodificada coincide con los helpers.
- **Validación estática:** las 10 propuestas pasan, sin errores. Hay 5 avisos esperados (§4).
- **Restricción fuerte encontrada: el bosque.**
  - Tiene 300 casillas transitables, pero **sólo 13** no son nodo, pasillo ni **posición real de trabajo** (`workPlacement`) de algún árbol.
  - Alcanzan para 2 nidos pequeños en dos claros. No modifiqué el terreno para hacer lugar.
- **Simulador:** nueva opción "mapa real (propuesta)" con casillas reales, portales, recursos, posiciones de trabajo, nidos y avisos. Inspector de nido y reloj con el motor real. La grilla sintética sigue siendo el valor por defecto.

## 2. Fuentes de geometría y versión

| Hecho | Fuente autoritativa | Uso |
| --- | --- | --- |
| Transitable | `navigation.isWalkable` (colisión CAVES-4; incluye la capa autorada y la roca de la cueva) | `blocked` |
| Alcanzable | Cueva: `navigation.isReachable`. Pradera: inundación desde la llegada dentro de la ventana (Pradera no está acotada: un bolsillo cercado cuenta como inalcanzable) | `unreachable` |
| Portales | `navigation.portalAt` / `PORTALS` (pad a Ciudad, boca y salida de la cueva) | `portal` + puntos protegidos |
| Llegadas | `ARRIVALS` (Pradera −5,−69; cueva S 10,11); `CAVES.approach` (−25,−73) | Puntos protegidos |
| Recursos | `resourceLayout.resourceAt` (árboles, rocas), `PLOTS` (huerta) | `resource` |
| Posiciones de trabajo | Por cada nodo y cada casilla vecina transitable del entrenador: `workPlacement(node, trainer, standableTile)` → `stand` (Pokémon) y `wait` (entrenador), **la regla real**, no "siempre al lado" | `work` |
| Pasillos | `resourceZones.isCorridorTile` (carriles, buffers, rutas) | `corridor` |
| Reservas | `RESERVED_AREAS` + rutas; `ARRIVAL_CLEARANCE` + margen; `caves.isCaveReserved` | `reserved`, `arrivalClearance`, `caveReserved` |
| Terreno | `terrain.tileTerrain` (pasto alto), `isWaterTile` (agua; agua a ≤ 3 casillas) | `tall`, `water`, `nearWater` |
| Subzonas | `RESOURCE_ZONES` (bosque, cantera) | Pertenencia a la zona |
| Interior de la cueva | `caveLayouts.caveInterior` | Ventana 21 × 15 |

**Versiones registradas** en la instantánea y en `nests.json`:

| Área | Versión de layout |
| --- | --- |
| `pradera` | `1.7eb512c66092` |
| `cueva-inicial` | `1.54820710979b` |

Generador de terreno: `1`. Ventana de Pradera: x −48…30, y −100…−28 (llegada, cueva, ambas zonas de recursos, reservas, pastizales y costa).

**Separación de capas (por qué así):**
- La instantánea la genera `scripts/ecosystem/map-geometry.mjs`, Node puro: es el único lugar donde se importa `layoutVersion.js`, que usa `node:crypto`. Escribe `src/features/ecosystem/map/generated/geometrySnapshot.json` (19,5 KB, máscaras de 3 hex por casilla).
- El dominio (`map/geometry.ts`, `nestValidation.ts`) es TS puro que sólo lee esos datos.
- El build del juego no los incluye: `vite build`, 425 módulos, 0 strings del mapa o del simulador.

## 3. Nidos propuestos

Los datos completos (candidatas, especies y avisos por nido) están en `docs/design/eco-map-1/nests.json`, generado. Las candidatas se **derivan** de la región de cada nido con las reglas de §4; no hay casillas copiadas a mano.

| Nido | Ancla | Región (x0,y0 – x1,y1) | Candidatas | Hábitats (grupo C1) | Especies elegibles | Límites |
| --- | --- | --- | --- | --- | --- | --- |
| `pradera-pastizal-oeste` | −34,−83 | −38,−86 – −30,−80 | 62 | pasto + pasto alto | c Pidgey, Rattata · u Nidoran♀/♂, Hoppip, Shinx · r Pidgeotto, Raticate, Pikachu · mr Nidorina, Nidorino | 3 vivos, grupo ≤ 3 |
| `pradera-pastizal-norte` | −16,−97 | −20,−99 – −12,−94 | 53 | Ídem | Ídem | 3 / 3 |
| `pradera-pastizal-noreste` | 10,−90 | 6,−93 – 14,−87 | 63 | Ídem | Ídem | 3 / 3 |
| `pradera-orilla-este` | 27,−84 | 24,−88 – 29,−80 | 51 | pasto + orilla | c Pidgey, Rattata, Bidoof · u Hoppip, Shinx · r Pidgeotto, Raticate, Pikachu · mr — | 3 / 3 |
| `pradera-pastizal-este` | 18,−55 | 15,−58 – 22,−52 | 51 | pasto + pasto alto | Como los pastizales | 3 / 3 |
| `bosque-claro-suroeste` | −16,−44 | −17,−44 – −15,−43 | 4 | claro (humedal, claro, coníferas) | c Oddish · u Pineco · r Gloom, Pidgeotto, Pikachu · mr Forretress | 3 / 3 |
| `bosque-sotobosque-sureste` | −6,−43 | −6,−44 – −6,−41 | 3 | sotobosque (sotobosque, ramas, follaje) | c Caterpie, Weedle · u Metapod, Kakuna, Ledyba · r Ledian · mr — | 3 / 3 |
| `cueva-techo-norte` | 10,2 | 7,1 – 13,3 | 21 | techo + suelo | c Zubat · u Diglett · r Golbat · mr — | 3 / 3 |
| `cueva-rincon-oeste` | 3,7 | 2,4 – 5,9 | 23 | rincón + húmedo | c Whismur · u Paras · r Sudowoodo, Loudred · mr Dunsparce | 3 / 3 |
| `cueva-roca-este` | 17,7 | 15,3 – 18,9 | 24 | roca + seco | c Geodude · u Sandshrew · r Graveler · mr — | 3 / 3 |

**Justificación espacial** (texto completo en `nestProposals.ts`):

- **Pradera.** Cuatro direcciones desde la llegada (oeste detrás de la cueva, norte más allá de la reserva de minerales, noreste sobre la cantera, sureste junto al bosque) y la costa este, el único agua cerca. Ningún nido en la llegada, la cantera, el bosque, las reservas ni las rutas.
- **Bosque.** Los dos únicos claros donde no hay posiciones de trabajo: suroeste (4 casillas) y junto al carril norte-sur (3).
- **Cueva.** El fondo norte, opuesto a la llegada (techo, murciélagos), y los dos laterales detrás de las columnas.

**Diferencias con la grilla sintética:**

| Tema | Grilla sintética (ECO-BALANCE-1) | Mapa real |
| --- | --- | --- |
| Nidos por zona | 6 | 5 / 2 / 3 |
| Nidos de orilla en Pradera | Mitad (3) | **1**. Bidoof sólo sale de ese nido: más raro de lo que el estudio suponía |
| Bosque | 4 × 4 casillas por nido | 4 y 3 casillas. El grupo de Caterpie/Weedle (1–3) ocupa todo el nido de sotobosque |
| Cueva | 6 nidos × 3 | 3 nidos × 3 con tope de área 6: la oferta baja a la mitad respecto del estudio (sus conclusiones de oferta y demanda deben revisarse con este layout) |
| Tope por área | Uno por zona | El motor tiene **un tope por área de presencia**, y Pradera abierta y bosque comparten `pradera`. El simulador los muestra por separado (12 y 8). Integrado, haría falta un solo tope (20) o soporte por zona (decisión pendiente) |

## 4. Validación espacial

**Restricciones estáticas** (`nestValidation.ts`):

- **Candidata:** dentro del área; transitable; alcanzable desde la entrada; no agua (especies de tierra); no portal; no nodo; no posición de trabajo real; no pasillo; no reserva, despeje de llegada ni despeje de la boca.
- **Separación:** a ≥ 4 casillas (Chebyshev) de llegadas, portales y la aproximación a la cueva.
- **Subzona:** en Pradera abierta, fuera de las subzonas; en el bosque, dentro de su caja.
- **Por nido:** ancla válida y dentro de su región; candidatas ≥ max(máx. vivos, grupo mayor); ningún grupo elegible mayor que `groupCap`; hábitats con entradas en la zona.
- **Entre nidos:** sin candidatas compartidas; anclas a ≥ 6 casillas.

**Avisos (no errores) presentes y aceptados:**

| Nido | Aviso |
| --- | --- |
| `pradera-orilla-este` | Sin candidato muy raro: ese 0,5 % termina en `empty-tier` |
| `bosque-sotobosque-sureste` | Sin candidato muy raro: ídem |
| `cueva-roca-este` | Sin candidato muy raro: ídem |
| `cueva-techo-norte` | Sin candidato muy raro; además, su único común (Zubat) necesita grupo ≥ 2, el residuo de C1 que ya había medido ECO-BALANCE-1 |

**Ocupación dinámica (no verificada aquí, responsabilidad de la integración):**
- jugadores en cualquier casilla (ninguna casilla está garantizada libre de jugadores);
- un trabajador u objeto colocado por el cliente;
- otros Pokémon salvajes.

Las patrullas de encuentros no bloquean el movimiento (`rules.occupied` las ignora), así que la superposición con un jugador es visual, no una colisión.

**Tests** (`map/map.test.ts`, 18):
- la instantánea es exactamente la que producen los módulos hoy, y coincide casilla por casilla con `isWalkable`, `portalAt` y `resourceAt`/`PLOTS`;
- los nidos son 5 + 2 + 3;
- cada candidata se verifica **directamente** con los helpers: transitable, alcanzable, no portal, no nodo y no posición de trabajo (recalculada con `workPlacement` real);
- distancias a puntos protegidos y ausencia de solapes;
- capacidad para los grupos;
- los avisos son exactamente los esperados;
- el motor acepta los nidos como configuración;
- `nests.json` está al día.

**Controles negativos sobre la geometría real:**

| Control | Rechazado por |
| --- | --- |
| Nido en una pared de la cueva | `blocked` |
| Nido en la salida de la cueva y en la boca de la cueva | `portal` y radio protegido |
| Nido fuera del área | `region-outside-area`, `anchor-invalid` |
| Nido en un bolsillo real inalcanzable de Pradera | `unreachable` |
| Nido sobre un árbol-nodo del bosque y sobre una posición real de trabajo | `resource` y `work` |
| Solape y cercanía, capacidad (región de 1 casilla), nido de Pradera abierta dentro del bosque | `overlap`, `too-close`, `too-few-candidates`, `subzone-mismatch` |
| `groupCap` menor que la colonia, hábitat sin entradas | `group-does-not-fit`, `habitat-without-entries` |

## 5. Simulador

Opción **"mapa real (propuesta)"**:

- banner "PROPUESTA DE DESARROLLO";
- casillas reales coloreadas por tipo, con leyenda;
- nidos en verde, encuentros con sprites existentes y contorno por grupo;
- población y límites, próxima reposición por nido;
- inspector de nido (clic en una casilla verde): grupo, hábitats, ancla, candidatas, límites, especies por tier, justificación y avisos;
- notas: versión de layout, avisos y la restricción del bosque, que se **calcula** del mapa en lugar de escribirse a mano.

Avanza el reloj con el motor real y conserva todos los controles anteriores. Las grillas sintéticas siguen disponibles y son el valor por defecto (test).

**Smoke visual** (navegador integrado, `127.0.0.1:5191`, puerto comprobado libre antes, servidor detenido al terminar):

| Área | Observado |
| --- | --- |
| Cueva | 3 nidos, llegada y salida en rojo. Colonia de 3 Zubat en el techo, Geodude al este, población 6/6. Inspector de `cueva-rincon-oeste`: ancla 3,7 y 23 candidatas |
| Bosque | Nodos y posiciones de trabajo por todo el bosque, dos claros verdes. 3 Weedle en (−6,−44), (−6,−43) y (−6,−41) y un Pineco en (−17,−43), todos sobre candidatas. Población 4/8. Nota de restricción "300 … 13" |
| Pradera abierta | 5 nidos repartidos, costa azul al este, llegada y boca en rojo. Población 11/12 |

- Consola sin errores en las tres áreas.
- Capturas en `docs/design/eco-map-1/`: `01-pradera-abierta-mapa-real.jpg`, `02-bosque-mapa-real.jpg` y `03-cueva-mapa-real.jpg`. Sólo muestran la herramienta local.

## 6. Decisiones pendientes antes de integrar

1. **Bosque.** ¿Las posiciones de trabajo de los árboles son una exclusión estática (hoy: 2 nidos) u ocupación dinámica? Si son dinámicas, quedan 188 casillas más, con espacio para ~4 nidos, a cambio de que un encuentro pueda estar donde un jugador quiere trabajar. La otra salida es autorar claros en el bosque (cambio de mapa: otra tarea).
2. **Tope por área en Pradera.** Un tope común para Pradera abierta + bosque (el motor actual) o un tope por zona (cambio de motor).
3. **Una sola orilla.** Bidoof sólo en la costa este. ¿Se acepta, o se agrega un nido de orilla en otra agua (no hay otra en la ventana)?
4. **Grupos C1, rareza por individuo o por grupo, residuo de Zubat en el techo:** siguen abiertos desde ECO-BALANCE-1.
5. **Oferta de la cueva con 3 nidos:** revisar respawn y topes con este layout (ECO-BALANCE-1 suponía 6 nidos).
6. **Radio protegido (4) y separación entre nidos (6):** son valores de esta propuesta; confirmar.
7. **Al integrar:**
   - derivar los nidos con este mismo validador contra el layout vigente;
   - rechazar el arranque si la versión de layout cambió y los nidos no se regeneraron;
   - sumar la ocupación dinámica a la geometría del motor.

## 7. Cómo reproducir y abrir

```bash
node scripts/ecosystem/map-geometry.mjs --check
```

```bash
node node_modules/vite-node/vite-node.mjs scripts/ecosystem/map-nests.ts -- --check
```

```bash
node node_modules/vite/bin/vite.js --config src/features/ecosystem/preview/vite.preview.config.mjs --port 5191 --strictPort --host 127.0.0.1
```

- Sin `--check`, los dos primeros comandos regeneran los archivos.
- Simulador: abrir `http://127.0.0.1:5191/`, elegir **Nidos → "mapa real (propuesta)"** y el hábitat.

## 8. Verificación (Node v22.23.3 portátil verificado)

| Gate | Resultado |
| --- | --- |
| `vitest run src/features/ecosystem` | 13 archivos, **144 tests ✔** (18 de mapa y 5 nuevos del simulador) |
| Typecheck (`vue-tsc`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores. 9 warnings preexistentes, ninguno del cambio |
| `git diff --check ae869d3..HEAD` | exit 0 |
| `bundle-encounters.mjs --check` | exit 0 |
| `map-geometry.mjs --check` / `map-nests.ts --check` | exit 0 / exit 0 |
| `vite build` del juego | exit 0, 425 módulos, nada del mapa ni del simulador |

**Guard de aislamiento:**
- `map/` sólo importa `map/` y `encounters/`, sin reloj, red ni azar.
- `preview/` puede leer `map/`.
- El generador `scripts/ecosystem/map-nests.ts` se permite **por archivo exacto**.
- `map-geometry.mjs` no importa el ecosistema.

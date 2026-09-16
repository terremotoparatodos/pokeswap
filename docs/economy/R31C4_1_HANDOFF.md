# R31-C4.1 Handoff — Alchemy Gathering Polish

> Rama: `feat/r31c4-1-alchemy-gathering-polish` (hija de `feat/r31c4-alchemy-visual-design` @ 8d665e2). **No mergeada.**
> Docs: [Recolección de Alquimia](R31C4_1_ALCHEMY_GATHERING.md) · [Manifest](ALCHEMY_ASSET_MANIFEST.md) · [Handoff de R31-C4](R31C4_HANDOFF.md)
> Microfase de cierre: completa la mitad recolectora de Alquimia (deuda H-1 de R31-C4). Con esto las cuatro profesiones de R31 quedan visualmente completas.

## 1. Qué se entregó

| Área | Entrega |
|---|---|
| Arte | 27 assets nuevos: 4 nodos × 3 estados, 3 props decorativos de referencia, hoz × 3 tiers + rota + inservible + 3 poses, 5 efectos y 2 marcadores |
| Motor | `BUSH_RECIPES` extraído de `props.ts` (mismo arte), para derivar variantes con el volumen del arbusto |
| Runtime | `forage/`: línea de tiempo (mano y hoz), estado visual, overlay y controlador |
| UI | `ForageActionCard` con "a mano / hoz opcional", cargas, energía, durabilidad y bloqueos |
| Playground | El laboratorio de Alquimia aloja las dos mitades: selector de lugar (mesa + 4 plantas) e indicador de casillas |
| Galería | 11 filas nuevas de contexto (decorativo frente a recolectable) y los grupos Nodos y Herramientas |
| WildLands dev | Las cuatro profesiones y la recolección conviven en el overlay compuesto |
| Reutilizado | Navegación hacia objetos, Pokémon trabajador, inventario, rarezas, feedback, `ItemGlyph`, burbujas, `CompositeOverlay`, HUD |

## 2. Verificación

**Automática (en esta rama):**
- `vitest`: 83 archivos, 637 tests OK (16 nuevos de recolección);
- `eslint`: 0 errores; 9 warnings en `AuthModal.vue`, anteriores a R31;
- `vue-tsc` / `npm run typecheck`: reportado OK, **pero era incorrecto** (corrección R31-Z): `npx vue-tsc --noEmit -p tsconfig.app.json` fallaba con 2 errores heredados de R31-C4, y `npm run typecheck` no chequeaba la app. Ambos se corrigieron en `integration/r31` (ver `R31_INTEGRATION_AUDIT.md` §8.1);
- `npm run build`: OK;
- `dist/` sin strings del playground, laboratorios ni galería;
- diff sin secretos.

**En navegador real** (Vite dev con `.env.local` de placeholders):

| Verificado | Resultado |
|---|---|
| Arbusto de bayas | Se ve la baya azul en el arbusto; recolectado 6 veces hasta agotarlo |
| Agotado | "Agotado para vos · Se recupera en 0:56" y el arbusto queda con ramitas peladas |
| Respawn | Con "Avanzar 1 h": el arbusto vuelve a tener fruto (medido sobre los píxeles del lienzo: el marrón de las ramitas baja y vuelve el azul) |
| Parche de hierbas | **La mata alta con flores se distingue del pasto alto que la rodea** (la comprobación más importante de la fase); recolectado 5 veces hasta agotarlo |
| Arboleda silvestre | A Nv. 12: "Requiere Alquimia Nv. 15". A Nv. 30: "+1 Baya Zidra, +1 Baya Zanama, +110 XP, −17,65 energía, −2 durabilidad" |
| Flor de escarcha | Con Blissey: "Tu Pokémon no puede llegar · Suelo helado: Hielo, Fuego o Acero". Con Magnemite y hoz T1: "Tu hoz no alcanza · Tier 2 o superior". Con hoz T3: "+1 Baya Zanama, +1 Baya Zidra, +200 XP" |
| Hoz rota | Durabilidad 0: "Rota · reparable", ícono partido y Recolectar deshabilitado |
| Reparar | "Reparada · usaste 2 Piedra"; el máximo baja de 60 a 55 |
| Pokémon trabajador | Aparece junto al jugador en cada recolección y se va al terminar |
| Inventario | Los frutos entran a la mochila; apareció "Nuevo espacio: Baya Zanama" al abrir un stack |
| **Recolectar → fabricar** | Baya Aranja recolectada en el arbusto → Mesa de Alquimia → receta de Poción: "+1 Poción, −2 Baya Aranja, −1 Frasco, +8 XP" |
| Móvil 375×812 | Loop completo en el arbusto: tocar, tarjeta, recolectar, resultado; botones de 40–44 px y sin scroll horizontal |

**Bugs encontrados y corregidos durante la fase:**
1. **La hoz no se leía como hoz.** La curva paramétrica a 16×16 se convertía en un tronco con un bloque gris. Se rehízo dibujada a mano, con el gancho explícito.
2. **El parche de hierbas era una cuña oscura.** Rasterizar las briznas como cápsulas las fundía en una sola masa; ahora cada brizna se dibuja como una columna que se inclina y afina.
3. **La flor de escarcha desaparecía sobre el cristal.** Pétalos celestes sobre un cristal celeste; ahora la flor usa el violeta-blanco del kit, con borde propio, y sobresale del contorno.
4. **La tarjeta mentía sobre la herramienta.** Decía "a mano" en el arbusto aunque el dominio estaba usando y gastando la hoz equipada. Ahora la animación y la tarjeta siguen a `preview.bareHands`, y la hoz aparece como "opcional".

**No verificado** (dicho con honestidad):
- **WildLands real (`WildlandsView`):** sin Supabase ni realtime el jugador es espectador; el laboratorio usa la misma clase, el mismo overlay y el mismo controlador.
- **Drop raro de Alquimia (Hierba Revivir):** 0,6 % en la arboleda y 3 % en la flor de escarcha; no salió en las pruebas. El camino visual es el mismo ya verificado con el oro en Minería.
- **Inventario lleno durante la recolección:** el camino existe y está cubierto en las otras profesiones; no se forzó acá.
- **Rendimiento en un móvil real:** no se midieron fps.
- **Sonido:** no hay infraestructura de audio; solo documentado.

## 3. La mesa y la colisión (no corregido, con motivo)

R31-C4 dejó anotado que el jugador puede pararse encima de la mesa. **No se corrigió, y la razón es que no es un cambio chico:** la solidez de una casilla la decide el área (`WildArea.isSolid` delega en `World.isSolid`), y `SceneOverlay` solo puede dibujar — no tiene forma de declarar una casilla sólida. Hacerlo bien implica que el área acepte props añadidos por una capa (o que la mesa pase a ser un prop real del generador), que es exactamente el tipo de cambio de arquitectura que esta microfase tenía prohibido. **Queda para la auditoría general**, junto con la decisión de si la mesa vive en el mundo o en un interior.

## 4. Límites y deuda

- **Sin nodos nuevos ni cambios de economía:** los cuatro nodos, sus cargas, respawns, niveles y drops son los del catálogo de R31-A.
- **El generador del mundo no se tocó:** las plantas aparecen donde `nodeAt` ya decía, con la misma densidad por ancla (30 % de los arbustos, 2 % del pasto alto, 60 % de los cristales).
- **El parche de hierbas se escanea alrededor del jugador** (radio 13: una ventana de 27×27 = **729 casillas**, cada 0,3 s; corrección R31-Z, el texto original decía "13 casillas") porque su ancla es terreno y el renderer no ofrece ganchos para tiles. Es barato y cacheado, pero no es tan elegante como el gancho de decor.
- **Una sola forma de recolectar por nodo:** no hay variantes por bioma ni por especie del Pokémon.
- **Todo sigue siendo local:** sin persistencia ni servidor.

## 5. Lo que queda para la auditoría general

1. **Extracción de lo duplicado**, ahora quintuplicado: controladores (`useMining/Fishing/Logging/Alchemy/Forage`), tarjetas de acción, reward pops, `targetAt`/`stationAt` y el `spawnBeside` de los laboratorios. R31-C4 ya lo proponía; esta microfase agregó una copia más a propósito, para no mezclar refactor con arte.
2. **Colisión y lugar de la mesa** (§3).
3. **Validación de estación en el servidor** (H-5 de R31-C4).
4. **Metadata de recetas** (H-2 y H-3): nombre, descripción e ícono en el catálogo, en vez de derivarlos en la UI.
5. **Que el dominio diga si una herramienta opcional debería gastarse.** Hoy gasta durabilidad de la hoz en plantas que no la piden; puede ser deliberado, pero conviene decidirlo.

## 6. Nota de entorno

En la ruta virtualizada de esta etapa **el watcher de Vite no detecta los cambios de archivo**: hay que matar el proceso del puerto, borrar `node_modules/.vite` y levantar el servidor otra vez para ver cualquier cambio visual.

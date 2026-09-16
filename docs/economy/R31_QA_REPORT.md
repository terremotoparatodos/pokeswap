# R31-QA — Profession Regression & Stress Pass

> Rama: `qa/r31-professions-regression` (hija de `feat/r31c4-1-alchemy-gathering-polish` @ c7f3a77). **No mergeada.**
> Alcance: Minería, Pesca, Tala, Alquimia (mesa) y Alquimia (recolección). Sin refactor, sin economía, sin realtime.
> Qué se agregó: un arnés de estrés headless (`professionsStress.test.ts`, 18 tests), una pista dev-only en el laboratorio de Alquimia y este informe.

## 1. Resultado en una línea

**No apareció ningún P0.** Las cuatro profesiones resisten el maltrato principal —toques repetidos, doble clic, cancelaciones, cambios de objetivo, agotamiento, respawn, herramienta rota, inventario lleno, cambio de viewport y saltos entre laboratorios— sin duplicar consumos ni recompensas, sin dejar timers vivos y sin trabar el input. Lo que queda son **dos P1 heredados del motor/arquitectura** (no corregibles desde acá) y **tres P2**.

## 2. Cómo se probó

**a) Arnés headless (`src/features/professions/professionsStress.test.ts`).** Los overlays solo tocan el canvas cuando *dibujan*; su reloj, su resultado y su limpieza corren desde `ground`, que apenas necesita un contexto 2D para un par de elipses. Con un contexto simulado se puede correr **la acción entera sin canvas y sin navegador**, manejando los controladores y la sesión demo reales: un consumo o una recompensa duplicada aparecerían como un inventario equivocado, no como un assert equivocado.

> **Corrección R31-Z (estación principal, `integration/r31`):** tres tests del arnés no podían fallar. Los dos de **pesca** retornaban temprano porque el jugador no estaba en la orilla (`cast()` era rechazado), y el overlay de pesca **sí** necesita un contexto 2D dentro de `ground`. El de **mochila llena** solo recorría la rama de rechazo. El de **XP entre profesiones** comparaba niveles contra 0. Se corrigieron en `99c61dd`: la pesca ahora lanza de verdad, hay un test determinista de desborde a pendientes y el XP se compara por profesión. Las conclusiones de este informe sobre pesca que dependían del arnés quedan respaldadas recién desde ese commit.

**b) Navegador real** (Vite dev, `.env.local` de placeholders), con instrumentación inyectada en la página: contadores de `setInterval`/`clearInterval`, de `addEventListener`/`removeEventListener` por tipo y destino, de `<canvas>` vivos y de errores de ventana.

## 3. Lo que se verificó y salió bien

| Área | Prueba | Resultado |
|---|---|---|
| Doble acción | 5 clics instantáneos en "Minar"; 4 llamadas seguidas a `mine()`; doble clic real en "Preparar" | **Una sola acción** en todos los casos: "+2 Mineral de Hierro" una vez, ingredientes 10→8 y 10→9 una vez |
| Ciclos repetidos | 20 intentos seguidos sobre un nodo | Se ejecutan exactamente las cargas personales del nodo y después rechaza |
| Cancelar a mitad | `detach()` a mitad de picar / hervir; salir del laboratorio mientras hierve | Sin recompensa, sin consumo, sin lock, sin timer; volver a tickear no resucita la acción |
| Cambiar objetivo | Seleccionar árbol y después arbusto | Ninguna selección queda colgada ni bloquea el input |
| Alejarse | Mover al jugador y actuar | Cierra la interacción y devuelve `false` |
| Herramienta rota | Durabilidad 0 → acción → reparar → acción | Rechaza, repara con el costo que informa y vuelve a funcionar |
| Inventario lleno | Preset "Llena" + minar | "Inventario lleno · Liberá espacio para seguir" y botón deshabilitado: no hay consumo parcial |
| Agotado y respawn | Agotar y adelantar el reloj | Vuelve a estar disponible y la acción aplica normalmente |
| Lotes | Lote de 3, cantidad 99 con insumos para 1 | Consume y produce exactamente lo pedido; la cantidad se recorta a lo posible |
| Ingredientes justos / insuficientes | Receta con lo justo y con uno de menos | Prepara una vez; con faltante rechaza y nombra el ingrediente |
| Pesca | Recoger antes del pique y dos veces seguidas; segundo lanzamiento con la línea afuera | Sin recompensa doble, sin lock, segundo lanzamiento rechazado |
| Cruce de profesiones | Minar → talar → recolectar → fabricar en una sola sesión | Todo llega a la misma mochila y la mesa usa lo recolectado; el XP no se mezcla entre profesiones |
| Cambio de profesión con tarjeta abierta | Cambiar el selector a Pesca con la tarjeta de Minería abierta | La tarjeta sigue coherente ("Veta de hierro · Listo") y sigue pudiendo actuar |
| Cambiar Pokémon trabajador | Cambiarlo con la tarjeta abierta | Sin errores; el cambio afecta a la profesión seleccionada en los controles |
| Cambio de viewport | Pasar a 375 px **mientras hierve** | La preparación termina bien, sin scroll horizontal ni errores |
| Timers | 12 saltos de laboratorio + hervor interrumpido | Constante: 1 fuera del laboratorio de Alquimia, 2 dentro; el timer de progreso se limpia siempre |
| Listeners globales | 12 saltos de laboratorio, contando por destino | **Cero** listeners de `window`/`document` sin liberar |
| Canvas | Ídem | Siempre 1: los juegos anteriores se destruyen |
| Errores de consola | Toda la sesión | Ninguno (fuera de los WebSocket de Supabase placeholder, esperables sin backend) |

**Sobre los listeners:** un conteo ingenuo muestra ~15 "adds" sin "remove" por laboratorio. Desglosado por destino son **listeners de plantilla de Vue sobre nodos que se descartan** (`HTMLButtonElement:click`, `HTMLCanvasElement:pointerdown`, `HTMLSelectElement:change`…). Vue no los quita uno por uno: desaparecen con el nodo. Los que sí importarían —`window`, `document`— no crecen. **No es una fuga.**

**Rendimiento (medición gruesa, no benchmark).** En el panel embebido: ~30 fps tanto en reposo como durante una preparación (el panel limita `requestAnimationFrame`, así que el número es del entorno, no del producto). Heap estable entre 16 y 20 MB, sin crecimiento tras decenas de acciones y saltos de laboratorio.

## 4. Problemas

### P1 — corregir antes de producción

**F-1 · La mesa de Alquimia no es un objeto físico y se puede quedar bloqueada**

- **Reproducción:** laboratorio de Alquimia → "Mesa de Alquimia" → tocar la mesa desde lejos. A veces el navegador deja al jugador **sobre** la casilla de la mesa.
- **Esperado:** pararse al lado y abrirla.
- **Real:** parado encima, ningún toque la abre (el motor solo consulta casillas *adyacentes*); hay que dar un paso al costado.
- **Archivos:** `alchemy/alchemyOverlay.ts` (la dibuja), `wildlands/areas/wildArea.ts` + `engine/game.ts` (deciden solidez y adyacencia).
- **Causa:** `SceneOverlay` solo puede dibujar; la solidez de una casilla la resuelve el área, que delega en `World.isSolid`. Una capa no puede declarar una casilla sólida.
- **Corregido:** **no** (es arquitectura: el área tendría que aceptar props de una capa, o la mesa pasar a ser prop real / mueble de interior). Sí se agregó una pista **dev-only** en el laboratorio: cuando el jugador queda encima, el cartel dice "Estás parado sobre la mesa: dá un paso al costado y tocála".

**F-2 · El navegador puede dejar al jugador del lado opuesto al objetivo**

- **Reproducción:** tocar un nodo a 2+ casillas; repetir el toque.
- **Esperado:** el primer toque camina al costado más cercano; el segundo abre.
- **Real:** a veces se detiene en el costado *opuesto* y el segundo toque (hecho sobre el mismo punto de pantalla) cae en otra casilla y vuelve a caminar. Con la cámara centrada en el jugador el punto de pantalla del objetivo cambió.
- **Archivos:** `wildlands/engine/navigator.ts` (`plan` acepta cualquiera de las cuatro vecinas), `engine/game.ts` (`worldObjectBeside`).
- **Causa:** el objetivo de la ruta es "cualquier casilla adyacente"; con obstáculos alrededor puede resultar la de atrás.
- **Corregido:** **no** (motor de R30). Impacto real: un toque extra, nunca un estado roto.

### P2 — polish

**F-3 · Se gasta durabilidad en plantas que no piden herramienta**

- **Reproducción:** con hoz equipada, recolectar el arbusto de bayas (`minToolTier: 0`).
- **Real:** el dominio usa la hoz y descuenta 1 de durabilidad (`preview.bareHands === false`).
- **Archivos:** `domain/gathering.ts`, `components/ForageActionCard.vue`.
- **Corregido:** parcialmente en R31-C4.1: la UI dejó de mentir (muestra la hoz como "opcional" y anima el barrido). **La decisión económica —si debería gastarse— queda para la auditoría.**

**F-4 · El parche de hierbas se descubre por escaneo, no por gancho**

- **Detalle:** su ancla es *terreno* (pasto alto) y el renderer solo ofrece gancho para props, así que el overlay escanea ±13 casillas alrededor del jugador (una ventana de 27×27 = 729 casillas) cada 0,3 s.
- **Medición:** sin impacto observable (fps y heap estables), pero es un patrón distinto al de las otras profesiones.
- **Archivos:** `forage/forageOverlay.ts`.
- **Corregido:** **no** (necesitaría un gancho de tiles en el renderer).

**F-5 · `CompositeOverlay` es de orden fijo**

- **Detalle:** si dos profesiones marcaran la misma casilla, gana la primera de la lista. No se reprodujo (los anclas no se solapan hoy), pero es un riesgo latente al agregar nodos.
- **Archivos:** `overworld/compositeOverlay.ts`.
- **Corregido:** **no** (decisión de diseño para la auditoría).

## 5. Aislamiento dev / producción

Reverificado en esta rama: `npm run build` limpio y `dist/` **sin** rastros de laboratorios, playground, galería ni controles de depuración (búsqueda de "Profession Playground", "Laboratorio…", "KIT DE…", textos de tarjetas). El test de aislamiento sigue exigiendo que la ruta `/dev/profesiones` y el demo de WildLands estén detrás de `import.meta.env.DEV`, que cada capa importe solo los módulos del motor que le tocan y que Vue aparezca únicamente en componentes y en los cinco controladores declarados. El arnés de estrés es un `.test.ts`: no entra al build.

## 6. Qué NO se probó

- **WildLands productivo (`WildlandsView`) con Supabase y realtime:** fuera de alcance por instrucción; toda la prueba fue local con placeholders.
- **Dispositivo móvil real:** el móvil se emuló a 375×812; no hay medición de fps en hardware.
- **Multijugador / concurrencia entre jugadores:** no existe todavía; las cargas son personales y locales.
- **Drops raros:** no salieron durante la pasada (0,3 % a 3 %); su camino visual ya se verificó en fases anteriores con el oro.
- **Sesiones largas (horas):** la pasada más larga fue de minutos.

## 7. Recomendación para la integración

Las cuatro profesiones se pueden integrar tal como están: no hay pérdida ni duplicación de recursos, ni estados que queden trabados. Antes de producción conviene resolver **F-1** (la mesa como objeto real o dentro de un interior) y decidir **F-3**. **F-2** es del navegador de R30 y conviene mirarlo junto con el resto del motor.

# ECO-PRESENTATION-1 — Reporte: jugar el combate de prueba desde el mapa (sandbox)

**Rama:** `feat/eco-presentation-1-0.3`, desde `integration/world-skills-0.3` @ `3fde07d` (remoto verificado). Sin push ni merge.
**Plan:** [ECO_PRESENTATION_1_PLAN.md](ECO_PRESENTATION_1_PLAN.md).
**Alcance:** solo presentación e interacción del cliente, detrás de `ECO_EXPERIMENT` (DEV con `VITE_ECO_EXPERIMENT=on`).

**No cambia:**
- protocolo, autoridad, reservas, relojes, core, fixtures, balance ni rango;
- `services/`, `src/features/battle`, `src/features/ecosystem` y `src/features/pokemon`: sin diferencias respecto de `3fde07d`.

## 1. Commits

| Commit | Contenido |
|---|---|
| `7ea1ef6` | Plan: disposición y reutilización, antes del código. |
| `521fc52` | Selección en el mapa, ficha del individuo, pantalla de combate, capa del experimento y panel de depuración como herramienta secundaria. |
| `a4882af` | Corrección encontrada en el smoke visual: un clic que venía de «Huir» o de un movimiento no puede cerrar un resultado que no se vio. |
| (este) | Este reporte. |

## 2. Qué cambió para el jugador

1. **Selección en el mapa.**
   - Tocar o hacer clic sobre un Pokémon ECO, o mirarlo y pulsar E, abre la ficha de **ese individuo**: el actor del mapa ya tiene como id el id de encuentro del servidor, y el golpe salvaje ahora lo lleva (`WildHit.actorId`).
   - Un Pokémon salvaje que no es ECO sigue abriendo la ficha de la plaza, como antes.
2. **Ficha** (`EcoEncounterCard.vue`). Muestra el sprite real, la especie, el id corto y el estado:

   | Estado | Texto |
   |---|---|
   | Libre | «Libre: podés combatirlo.» |
   | Ocupado | «Ocupado: otro entrenador lo está combatiendo.» |
   | Lejos | «Lejos: estás a N casillas. Acercate a 6 o menos.» |
   | Ya no está | «Ya no está aquí.» |

   - «Combatir» solo se habilita si está libre y en rango; el servidor sigue decidiendo.
   - La ficha no pausa el juego: se puede caminar con ella abierta y la distancia se actualiza.
   - Se cierra con ×, con Escape, al cambiar de área y al empezar el combate.
3. **Pantalla de combate** (`EcoBattleScreen.vue`). Mientras está abierta, el mapa no se mueve.
   - **Arriba, el rival:** nombre, «salvaje», nivel, barra de PS (verde, amarilla o roja) y su sprite de frente.
   - **Abajo, el Pikachu:** con la etiqueta «fixture de prueba», nivel, barra de PS y su sprite de espaldas.
   - **Controles:** cuatro movimientos con su PP, tiempo restante, «Huir», aviso de «Reconectando… el combate está en pausa» y rechazos del servidor en palabras.
   - **Resultados:** victoria, derrota, empate, huida, vencimiento, desconexión, salida del área y encuentro desaparecido, con «Volver al mapa».
   - Ningún texto sugiere captura, recompensa ni algo que se conserve. Una prueba lo verifica con una expresión regular.
4. **Panel de depuración.** Queda plegado por defecto como herramienta secundaria y comparte la misma sesión: su «Combatir» abre la misma pantalla. El resumen de combate en línea (`EcoBattlePanel.vue`) se eliminó, así que no hay dos implementaciones activas.

**Reutilización:**
- Sprites: las hojas *overworld* locales (`overworldSheetUrl`), las mismas del mapa. Fila `down` para el rival y fila `up` para el Pikachu, con recorte CSS sin canvas ni animaciones nuevas.
- Estilo de `WildPokemonCard`.
- `EcoBattleSession` sin cambios.
- Nombres del catálogo de batalla, o los de la Pokédex cuando el cliente la tiene.
- `game.setPaused` para pausar el mapa.

## 3. Pruebas

`EcoExperimentLayer.test.ts` (13 pruebas, montaje real de la capa con `SharedWorld`) cubre:
- **Selección:** dos individuos de la misma especie (#13) dan dos fichas distintas por id, y un id no ECO no se captura.
- **Ficha:** los estados ocupado, lejos (9 casillas, que pasan a «Libre» a 6) y «ya no está».
- **Cierre:** con ×, Escape y cambio de área.
- **Combatir:** envía el id exacto. La pantalla muestra las hojas `0013.png` (fila `down`) y `0025.png` (fila `up`), niveles, PS y PP. Un movimiento y la huida solo envían su pedido, y los PS se actualizan con el snapshot.
- **Resultados:** seis finales, cada uno con su texto y sin insinuar captura o recompensa. El botón del resultado está deshabilitado unos 700 ms y después funciona.
- **Reconexión:** aviso de pausa con los controles deshabilitados, y luego reanuda el mismo combate.
- **Rechazos:** se muestran en palabras.
- **Panel:** plegado por defecto, y su «Combatir» abre la misma pantalla.

`wildTaps.test.ts` ahora exige `actorId`.

**Gates** (Node 22.23.2):

| Gate | Resultado |
|---|---|
| vitest | 235 archivos, 2223/2223 |
| `vue-tsc` | exit 0 |
| eslint en `src` y `scripts` | 0 errores; 9 avisos previos en `AuthModal.vue` |
| Build de producción, con y sin `VITE_ECO_EXPERIMENT=on` | 193 fuentes, las mismas de antes. 0 apariciones de `EcoExperimentLayer`, `EcoBattleScreen`, `EcoEncounterCard`, `EcoSprite`, `EcoBattleSession`, «Combatir», «Combate de prueba», «Volver al mapa», «fixture de prueba» y `ecoProtocol`. |

La suite realtime no se repitió porque el servidor no cambió.

## 4. Smoke visual real (Claude, cliente propio, 2026-10-08)

Sandbox aislado (`eco-gameplay-local.mjs`): Node 22, 127.0.0.1:2790/2791/5199, identidad sintética `eco-p1`, sin Supabase ni Cloud. El usuario dejó visible el panel Navegador. Al terminar se apagaron el cliente y el realtime y se borraron las compilaciones.

| Comprobación | Resultado |
|---|---|
| Panel de depuración | Aparece plegado («▸ ECO · depuración (dev)»). |
| Tocar un Weedle del mapa | Abre la ficha de `bosque-sotobosque-sureste:1:2`: Weedle con su sprite y «Lejos: estás a 9 casillas…», con «Combatir» deshabilitado (legible). |
| Caminar con la ficha abierta | Cambia a «Libre: podés combatirlo.» con «Combatir» habilitado. |
| Tocar **otro** Weedle del mismo nido | La ficha pasa a `bosque-sotobosque-sureste:1:0`: dos individuos de la misma especie quedan distinguidos. |
| Escape | Cierra la ficha. |
| «Combatir» | Abre la pantalla: Weedle salvaje Nv. 8 de frente y Pikachu «fixture de prueba» Nv. 12 de espaldas, con barras de PS (amarilla con 11/26), cuatro movimientos con PP (Thunder Shock, Quick Attack, Thunder Wave, Double Team), «Tiempo restante 1:56» y «Huir». |
| Huida | «Huiste. El Pokémon salvaje sigue en el mapa y queda libre.» y «Volver al mapa». |
| Victoria | El servidor la decidió a los pocos segundos. Ver §5, O-1. |
| Limpieza al cambiar de área | Con la ficha abierta (pasó a «Lejos: estás a 21… 24 casillas»), entré al portal: en Ciudad Corazón la ficha ya no está y el panel muestra «sin simular · 0 en el área». |

**No observado por Claude en pantalla** (cubierto por pruebas y pendiente del smoke humano con dos ventanas):
- el estado «Ocupado» en la ficha, porque necesita un segundo jugador;
- el aviso de reconexión;
- los resultados de derrota y vencimiento.

## 5. Observaciones del smoke

- **O-1, corregida en `a4882af`.** El servidor terminó un combate en victoria mientras yo pulsaba «Huir». «Volver al mapa» aparece en el mismo lugar y el mismo clic cerró el resultado sin que se viera. Ahora ese botón ignora los clics durante 700 ms.
- **O-2, pendiente de pulido, sin rediseño.** Los sprites *overworld* tienen mucho margen dentro de su celda de 32 px, así que el Pokémon ocupa alrededor de un tercio del recuadro. Se ven nítidos pero chicos.
- **O-3, pendiente de pulido.** Plegado, el panel de depuración tapa solo en parte la ayuda de controles de desarrollo (`DevHelp`) que tiene debajo.
- **O-4, comportamiento, no defecto.** La distancia de la ficha es la que el servidor comprobará: desde la casilla del encuentro en su lista, no desde donde se dibuja durante la patrulla (correa de 4). Por eso puede decir «Lejos» aunque el sprite parezca un poco más cerca. El rango no cambió.
- **O-5, comportamiento.** Si dos Pokémon se superponen en pantalla, el toque elige el de delante; la ficha siempre muestra el id elegido.
- **O-6, entorno, no producto.** Con el panel Navegador oculto la página no dibuja y el juego no camina. Además, un clic por referencia de la herramienta no aplica la escala de la captura. Ninguno afecta al juego.

## 6. Smoke humano propuesto (dos ventanas)

Se prepara con estos comandos (Node 22, desde el worktree del candidato):

```
node scripts/ecosystem/eco-gameplay-local.mjs realtime
node scripts/ecosystem/eco-gameplay-local.mjs client
```

Las ventanas:
- A: `http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-a`
- B: `http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-b`

Pulsá «Entendido» en el aviso de Skills. El bosque está un paso a la derecha y unas 20 casillas hacia abajo.

1. **Selección:** tocá dos Pokémon de la misma especie y comprobá que la ficha cambia de id.
2. **Lejos:** con la ficha abierta, acercate hasta que diga «Libre».
3. **Ocupado:** A combate un individuo; B toca **ese mismo** y ve «Ocupado…» con «Combatir» deshabilitado.
4. **Combate:** elegí movimientos, mirá los PS y pulsá «Huir». Repetí hasta ver una victoria y una derrota (Geodude en la cueva, sin órdenes).
5. **Reconexión:** con un combate en curso, cerrá A y reabrila antes de 15 s. Se ve el aviso de pausa y luego el mismo combate.
6. **Cambio de área:** con una ficha abierta, cruzá un portal; la ficha se cierra.
7. **Depuración:** el panel ▸ se despliega y su «Combatir» abre la misma pantalla.

El vencimiento con humano sigue siendo opcional: está acreditado técnicamente desde ECO-GAMEPLAY-2.

**Candidato congelado:** `feat/eco-presentation-1-0.3` en el commit de este reporte. Sin push, merge, despliegue, Cloud, Supabase ni cambios en entornos activos.

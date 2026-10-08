# ECO-PRESENTATION-1 — Plan: jugar el combate de prueba sin el listado de depuración

**Base:** `integration/world-skills-0.3` @ `3fde07d` (remoto verificado). Rama `feat/eco-presentation-1-0.3`.

**Alcance:** solo presentación e interacción del cliente, dentro del experimento dev (`ECO_EXPERIMENT`).

**No cambia:** protocolo, autoridad, reservas, relojes, core, fixtures, balance, rango ni exclusión productiva.

## Disposición

1. **Selección en el mapa.** Tocar o hacer clic sobre un Pokémon ECO visible, o mirarlo y pulsar E, selecciona **ese individuo**: el actor del mapa ya tiene como id el id de encuentro del servidor. No se elige por especie.
2. **Ficha contextual.** Es una tarjeta inferior, con el mismo estilo que la ficha de Pokémon salvaje existente: fondo azul marino, borde azul y acento dorado. Contiene:
   - el sprite real de la especie, su nombre y el id corto del individuo;
   - su estado, uno de estos:

     | Estado | Texto |
     |---|---|
     | Libre | «Libre» |
     | Ocupado | «Otro entrenador lo está combatiendo» |
     | Lejos | «Acercate: estás a N casillas (máximo 6)» |
     | Ya no está | «Ya no está aquí» |

   - el botón **«Combatir»**, habilitado solo si el Pokémon está libre y en rango (la regla la sigue decidiendo el servidor);
   - la nota «Combate de prueba: sin captura ni recompensas».

   La tarjeta no pausa el juego, así que se puede caminar más cerca con ella abierta. Se cierra con × o Escape, al cambiar de área y al empezar el combate.
3. **Pantalla de combate.** Es un panel centrado con el mismo estilo, y pausa el movimiento mientras está abierto:
   - **Arriba, el rival:** nombre, «salvaje», nivel, barra de PS y su sprite mirando al frente.
   - **Abajo, el jugador:** el Pikachu sintético con su sprite de espaldas, la etiqueta «fixture de prueba», nivel y barra de PS.
   - **Controles:** cuatro movimientos en una cuadrícula de 2×2 con su PP, «Huir», el tiempo de combate restante y un aviso de «Reconectando… el combate está en pausa».
   - **Resultado:** victoria, derrota, empate, huida, vencimiento, desconexión, salida del área o encuentro desaparecido, sin insinuar captura ni recompensas. Se cierra con «Volver al mapa».
4. **Panel de depuración.** Se conserva como herramienta secundaria del experimento. Comparte la misma sesión: su «Combatir» abre la misma pantalla de combate, y su resumen de combate en línea se quita para no tener dos implementaciones activas.

## Reutilización

| Qué | Cómo se reutiliza |
|---|---|
| Sprites | Las hojas *overworld* locales (`/assets/overworld/NNNN.png`, `overworldSheetUrl`): las mismas que ya se ven en el mapa, sin red ni Supabase. Fila `down` para el rival (de frente) y fila `up` para el Pikachu (de espaldas). Recorte por CSS, escalado *pixelated*, sin canvas nuevo ni animaciones. |
| Toques | `wildTaps.ts` / `game.tap` / `game.interact`. El golpe salvaje suma el id del actor; el resto de la ruta no cambia. |
| Estilo | Paleta y forma de `WildPokemonCard.vue`. |
| Lógica del cliente | `EcoBattleSession`, ya probada: engage, acciones con `JoinAck`, huida, reanudación y fin. |
| Nombres | Movimientos y especies del catálogo de batalla, que ya carga el panel. Cuando la Pokédex no está disponible, que es el caso del sandbox, se usa el nombre del catálogo. |
| Pausa | `game.setPaused`, el mismo mecanismo que usan los paneles de la plaza. |

## Archivos

| Archivo | Rol |
|---|---|
| `src/features/world/components/EcoExperimentLayer.vue` (nuevo, perezoso) | Posee la sesión y monta la ficha, la pantalla de combate y el panel de depuración. |
| `EcoEncounterCard.vue` y `EcoBattleScreen.vue` (nuevos) | Ficha y pantalla de combate. `EcoBattleScreen` reemplaza a `EcoBattlePanel.vue`, que se elimina. |
| `EcoSprite.vue` (nuevo) | Un cuadro de la hoja overworld. |
| `EcoDevPanel.vue` | Recibe la sesión en lugar de crearla. |
| `WildlandsView.vue` | Monta la capa en lugar del panel, deriva los toques ECO a la capa y pausa el juego durante el combate. |
| `wildTaps.ts` | El golpe salvaje lleva `actorId`. |

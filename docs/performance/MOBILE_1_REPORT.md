# MOBILE-1 — Mobile Viewport & HUD

Rama `mobile/1-viewport-hud`, desde `be360fd` (TRANS-1 integrado, PR #30).

**Estado: APROBADO** en iPhone real, en cuatro pasadas.

**Alcance.** MOBILE-1 busca una experiencia móvil suficientemente sólida para el **Playtest 0.2**. **No es el diseño definitivo del frontend:** la reestructuración de Skills y otros sistemas traerá cambios grandes de UI en PC y en móvil.

No se tocaron engine, red, Colyseus, gameplay, economía ni contenido. La única excepción es el modo Correr táctil, que reutiliza exactamente la lógica de Shift.

## 1. Estado anterior y problemas encontrados

Auditoría en el iPhone real y en un iPhone 15 Pro emulado (`scripts/perf/mobile-shots.mjs`: 393×659 Safari, 393×852 standalone, 852×353 horizontal; capturas y % de pantalla ocupado por interfaz).

| Problema | Causa |
|---|---|
| Marco blanco y página desplazable (las barras de Safari se movían al jugar) | Sin CSS global: margen de 8 px del `body`; el shell usaba `100vh` |
| En horizontal, la barra inferior quedaba fuera de pantalla | `min-height: 420px` en el escenario; las reglas de teléfono miraban sólo el ancho |
| Nada respetaba el notch, la Dynamic Island ni el indicador inferior | Sin `viewport-fit=cover` ni safe areas |
| "Añadir a inicio" abría con barras | Sin manifest ni metas de app |
| El panel de rendimiento tapaba el 19 % de la pantalla y el de captura el 13 % | Siempre expandidos |
| Chat y Skills se cerraban sólo con un "−" chico y podían quedar los dos abiertos | La pestaña se reemplazaba por el panel |
| iOS hacía zoom al escribir en el chat, el login y el reporte de bugs | Campos de 13–13,6 px (iOS agranda la página con campos de menos de 16 px) |
| No se podía correr en el teléfono | La marcha sólo leía Shift |
| Los edificios ocupaban el 95 % de la pantalla | Tarjeta centrada de escritorio |
| La ayuda de Dungeon y Skills era una franja imposible de cerrar | `pointer-events: none` y ningún cierre |
| La barra de área y coordenadas ocupaba todo el borde inferior | La barra de escritorio, tal cual |

## 2. Cambios

### Viewport, `dvh` y safe areas (`7b19eb9`)
- `src/app/pageBase.css`, la única hoja global:
  - sin margen, página a altura completa con fondo oscuro, sin rebote ni pull-to-refresh;
  - variables `--safe-top/right/bottom/left` a partir de `env(safe-area-inset-*)`.
- `index.html`: `viewport-fit=cover`.
- Shell y escenario con `100dvh`; el piso del escenario baja a 300 px.
- Todo el HUD fijo y todos los diálogos suman las safe areas a su distancia al borde.
- Las reglas de teléfono aplican también a `(max-height: 500px)`: un teléfono en horizontal ya no recibe el layout de escritorio.

### PWA y standalone (`7b19eb9`)
- `public/manifest.webmanifest`: `display: standalone`, `theme_color` y `background_color`.
- Metas de app de pantalla de inicio, con barra de estado translúcida.
- No hace falta detectar el modo standalone: las safe areas resuelven el layout.
- **Sin íconos:** no existe ningún logo ni ícono de PokeSwap en el repo ni en su historia. No se inventó ninguno (§8).

### Paneles de rendimiento (`87e46ce`)
- El HUD de rendimiento, que también se ve en producción del playtest, arranca en el teléfono como una línea: `PERF · fps · ms · remotos`. Se expande al tocarlo y se vuelve a plegar.
- El panel de captura (sólo en builds de medición) es una barra mínima, con Detener mientras graba y Enviar a PC al terminar.
- En escritorio no cambian.

### Chat, Skills y Mochila (`580227b`)
- El botón que abre cada panel también lo cierra y se ve activo mientras está abierto. La "×" queda como alternativa.
- Los tres forman un grupo: abrir uno cierra los otros (lo coordina `WildlandsView`).
- Escape cierra el panel abierto sólo si no hay un menú, diálogo, tarjeta o acción encima. Escucha en fase de captura, así que una sola tecla nunca cierra dos cosas.
- Chat en el teléfono: una hoja sobre la fila de botones, de hasta un tercio de la pantalla, con scroll interno.
- Skills: encabezado fijo y lista con scroll. En PC es una ventana acotada al viewport; en el teléfono, una hoja grande.
- En horizontal, Chat, Skills y el menú son columnas a la izquierda (`f0214ed`).

### Teclado y `visualViewport`
- `src/shared/ui/keyboardInset.ts` publica `--keyboard-inset` y `--visible-height` a partir de `visualViewport`.
- Admite varios usuarios a la vez (lleva la cuenta) y lo usan el chat, el login y el reporte de bugs.
- La superficie sube justo encima del teclado sin desplazar la página.
- Los campos miden 16 px en táctil.

### Correr táctil (`fc0c53d`)
- `KeyboardInput.sprinting` es Shift **o** `runMode`. Paso fijado por casilla, animación, velocidad, anuncio de presencia y reproducción remota siguen el mismo camino que Shift: no hay una segunda velocidad ni cambios de protocolo.
- `runMode` es un modo de movimiento: sigue activo tras perder el foco, abrir paneles, entrar a edificios, cambiar de área o reconectar. Sólo lo cambia su botón.
- El botón (`RunToggle.vue`) aparece sólo con puntero táctil, abajo a la derecha y dentro de las safe areas.

### Popups (`759bc63`), por familia
- **A, mensajes cortos** (edificio cerrado): tarjeta centrada chica.
- **B, edificios** (Centro Pokémon, Tienda):
  - en vertical, una hoja inferior de hasta ~75 %, con encabezado y "×" fijos y el mundo visible arriba;
  - en horizontal, una columna a la derecha;
  - se cierran con la "×", tocando el fondo o con Escape, porque salir no deja nada a medias.
- **C, complejas:**
  - el dungeon ocupa toda la pantalla y ahora respeta las safe areas;
  - las tarjetas de profesión mantienen encabezado y acción visibles, y en horizontal usan toda la altura;
  - Correr queda por debajo de las tarjetas de acción, que son temporales.
- **Login:** tocar el fondo sólo cierra si el formulario está vacío. La "×" pasa a 40 px y funciona Escape.
- **Reporte de bugs:** el botón abre y cierra su tarjeta, que sube sobre el teclado.

### Ayuda de Dungeon y Skills
- Es `WorldHintTray`: pistas de guía que aparecen cada vez que el jugador está en un área salvaje.
- Ahora es una tarjeta chica abajo a la izquierda, con título ("Dungeon y Skills"), "×" y "Entendido".
- Cerrada queda un chip "?" que la vuelve a abrir.
- Cerrarla dura mientras el mundo esté abierto; no se guarda en el dispositivo, porque es una guía del área y no una preferencia.

### Indicador de área
- En el teléfono, la barra inferior pasa a ser un indicador chico debajo del minimapa, con lugar, coordenadas, clima y el botón para volver a la ciudad.
- El momento del día y el contador de cristales de demo quedan en el texto de ayuda del indicador.
- La fila de Chat, Skills y reportar bug baja al borde inferior, que queda libre.
- En escritorio la barra sigue abajo.

## 3. Resultados (emulación, % de la pantalla que pinta la interfaz)

| | Antes | Después |
|---|---:|---:|
| Build de medición, Safari | 38,1 % | 12,9 % |
| Build de medición, standalone | 29,5 % | 10,0 % |
| Menú en horizontal | 84 % | 46 % |
| Chat / Skills en horizontal | 38 / 34 % | 18 / 16 % |
| Tarjeta del Centro Pokémon, vertical | 95 % | 75 % (hoja, mundo visible) |
| Ayuda Dungeon/Skills | franja permanente sin cierre | 17 % abierta, 0,5 % cerrada ("?") |

Además, en vertical, standalone y horizontal, verificado para Centro, Tienda, edificio cerrado, dungeon, ayuda, Skills, chat, login, vista de la ciudad y tarjeta de alquimia:
- cierre y acción principal dentro de la pantalla y tocables;
- scroll dentro de la superficie;
- la página nunca se desplaza.

Con el teclado simulado, el campo y la acción del chat y del login quedan visibles.

Capturas antes/después en `baselines/mobile-1/shots/` y `shots/popups/`.

## 4. Regresiones

- **PERF-2:** el harness de fidelidad (264 runs) da idéntico byte a byte a `perf-2/fidelity-4-stacked-steps.json`, con 0 saltos. Headless MULTI-10/30 y Pradera-10: trabajo de frame p95 entre 2,0 y 2,6 ms, 0 saltos y 0 salidas de AOI.
- **TRANS-1:** la línea temporal de transiciones da idéntica a `trans-1/timeline-after.txt`.
- **Gates:** typecheck, lint (0 errores), 2002 tests de cliente, 69 de realtime y build.

## 5. Tests nuevos

- Paneles: HUD de rendimiento y panel de captura (plegado y persistencia); Chat y Skills (abrir y cerrar con el mismo botón, "×", Escape, cierre pedido por el host); ayuda (cierre y "?").
- Teclado y marcha: `keyboardInset` (varios usuarios); modo Correr (ciclo de vida, y paso y anuncio iguales a Shift con el `KeyboardInput` real); `RunToggle`.
- Login: cierre desde el fondo sólo con el formulario vacío, y Escape.

## 6. Validación física (iPhone real)

Aprobados:
- viewport y Safari en vertical;
- layout móvil general;
- Chat, Skills y Mochila, con toggle consistente;
- teclado;
- Correr táctil;
- entrada y salida de edificios;
- locomoción multijugador;
- popups: Centro Pokémon y mensajes cortos;
- ayuda de Dungeon y Skills;
- indicador superior de área;
- profesiones desde la UI;
- horizontal en los casos revisados.

## 7. Herramientas que quedan

- `scripts/perf/mobile-shots.mjs`: viewports de iPhone, capturas, % de interfaz, elementos fuera de pantalla y `--eval`.
- `/dev/superficies?s=centro|tienda|cerrado|dungeon`: superficies del playtest sobre el mundo real. **Sólo DEV:** el build de producción no registra la ruta ni incluye el chunk (verificado en `dist`).

## 8. Deuda y riesgos, deliberadamente para después

- **Íconos de la PWA** (180, 192 y 512 px): no existe un asset de marca. iOS usa una captura de la página como ícono.
- **Teclado real:** se validó en iPhone con el chat. El login y el reporte de bugs comparten el mecanismo, pero no se probaron uno por uno con teclado real.
- **El número del reloj del dungeon tiene poco contraste** (presentación interna del prototipo; no se tocó).
- **Diálogos internos de profesiones y dungeon:** sólo se trató su marco. Su contenido se rediseñará con SKILLS-1.
- **Detección de teléfono:** usa ancho, alto y puntero. Una tablet en horizontal alto recibe el layout de escritorio, que es lo esperado.
- **Vite dev en Windows** a veces sirve CSS viejo tras editar: reiniciar antes de medir.

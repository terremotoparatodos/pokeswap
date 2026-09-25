# PokeSwap — Community Playtest 0.2

**Performance + Multiplayer Smoothness + Mobile UX + Stability.**

0.2 congela la base técnica y la experiencia actuales antes de WORLD-1 y SKILLS-1. No agrega mecánicas nuevas frente a lo que ya estaba integrado. Es la **versión estable de referencia**: cualquier regresión futura se compara contra esta baseline (§6).

## 1. Notas para testers

> **PokeSwap Playtest 0.2**
>
> En esta versión nos concentramos en que PokeSwap sea mucho más fluido y cómodo de jugar.
>
> **Principales cambios**
> - Multiplayer mucho más fluido: los demás jugadores se ven caminar y correr casi en tiempo real, sin saltos.
> - Mejoras grandes de rendimiento, también con muchos jugadores en pantalla.
> - Correr y caminar funcionan bien al cambiar sin frenar, en PC (Shift) y en el celular (botón Correr).
> - Entrar y salir de edificios y viajar entre la Ciudad y la Pradera ya no te mandan al spawn.
> - Experiencia móvil rehecha: pantalla completa, botones al alcance del pulgar, Chat, Skills y Mochila que se abren y cierran desde su propio botón, y ventanas pensadas para el celular.
> - Se puede agregar a la pantalla de inicio del celular para jugar sin las barras del navegador.
> - Muchos arreglos de estabilidad.
>
> **Qué queremos probar**
> - La fluidez con muchos jugadores.
> - Cómo se ve moverse a los demás.
> - La estabilidad en la Ciudad y la Pradera.
> - El celular, en vertical y en horizontal.
> - Edificios y transiciones.
> - Cualquier bug inesperado: usá **Reportar**.
>
> **Limitación conocida**
> El mundo dinámico todavía no es del todo compartido: los Pokémon salvajes, algunos NPC y otros elementos pueden no coincidir entre dos jugadores. Es lo próximo que vamos a construir.

## 2. Qué incorpora frente a 0.1

### Performance y multiplayer (PERF-0, PERF-1, PERF-2)
- Optimizaciones de mundo y render, medidas con instrumentación propia (`docs/performance/`).
- **Walk/run corregido:** Shift cambia la velocidad real desde la próxima casilla, sin frenar.
- **Reproducción remota adaptativa:** recupera atraso acelerando levemente, en lugar de saltar.
- **Menor atraso visual:** cada paso se anuncia al empezar. En red local, correr pasa de ~200 a ~70 ms y caminar de ~320 a ~80 ms.
- **Batching sin perder pasos:** los pasos que caen en la misma ventana de 50 ms viajan todos.
- **AOI con continuidad:** histéresis de 6 casillas y un piso de 20 casillas en las áreas salvajes.
- Multitudes considerablemente más fluidas: **0 saltos anormales** en las regresiones principales (harness de 264 runs; 10, 20 y 30 corredores headless).
- En la validación física, el correr remoto pasó de 7,5/10 a 10/10, en PC y en iPhone.

### Transiciones (TRANS-1)
- Salir de un edificio es un paso anunciado: se corrigió el desfase que terminaba en teleport al spawn.
- El punto seguro legítimo se conserva para estados realmente inválidos.
- Ciudad ↔ Pradera sigue coherente: área y posición cambian en un solo mensaje.

### Mobile (MOBILE-1)
- Viewport real con `dvh` y safe areas; vertical y horizontal; standalone/PWA.
- Chat, Skills y Mochila reorganizados y con toggle; teclado de iOS tratado; botón Correr táctil.
- Popups por tipo: mensajes cortos, edificios como hoja inferior y superficies complejas con encabezado y acción siempre visibles.
- Ayuda de Dungeon y Skills compacta y cerrable; indicador de área compacto; HUD persistente menos invasivo.

### Seguridad y base, ya integrados desde 0.1
- **Mínimo privilegio en Supabase** para los roles del cliente, con migración versionada.
- **Rutas de pago web antiguas deshabilitadas** (responden "no disponible"): el playtest no mueve dinero.
- **Gates de CI/deploy:** typecheck, lint, tests del cliente y del servicio realtime y build, obligatorios antes de desplegar el playtest.
- El workflow de deploy heredado de `main` está deshabilitado, para que no pueda pisar el sitio.

Estas áreas no se tocaron en 0.2.

## 3. Problemas conocidos (no bloquean 0.2)

- **El mundo dinámico no es completamente compartido.** Los Pokémon salvajes, los NPC que deambulan, la posición de los Pokémon de la plaza, el estado de los recursos, la hora y el clima se calculan en cada cliente. Es el objetivo de WORLD-1 y **no se corrige en 0.2**.
- **Skills pendientes de rediseño (SKILLS-1).** Su gameplay no se modifica antes de 0.2. Si los testers lo encuentran confuso, se registra como feedback y no se parchea.
- **PWA sin íconos propios:** no hay un asset de marca todavía. iOS usa una captura de la página como ícono.
- **Detalles visuales menores:** el reloj del dungeon tiene poco contraste. El contenido interno de los diálogos de dungeon y profesiones no se rediseñó; sólo se ajustó su marco para móvil.
- **Residuales de PERF-2:**
  - con un emisor que agrupa siempre sus pasos (pestaña en segundo plano o red muy mala) ya no hay saltos, pero sí esperas breves;
  - el costo de retener jugadores entre 20 y 26 casillas no se midió con una multitud repartida en esa franja;
  - al cambiar de área hay un pico de carga oculto bajo el fundido.
- **Residuales de TRANS-1:** un NPC parado en la casilla de salida de un edificio se atraviesa, igual que antes. Una puerta futura con salida no adyacente usaría la colocación directa. El botón "Ciudad" manda al spawn a propósito.
- **Standalone en iOS:** la app de la pantalla de inicio guarda sus datos aparte de Safari, así que puede volver a pedir el código de acceso.

## 4. Cómo se identifica esta versión

- **Cliente:** el banner, la pantalla de acceso y cada reporte de bug muestran `Community Playtest 0.2 · <commit>`. El commit corto sale del build (`__PLAYTEST_COMMIT__`).
- **Servidor realtime:** `GET /version` devuelve el commit desplegado en Colyseus Cloud, que sólo se redespliega cuando cambia `services/realtime`. En 0.2 el código del servidor es el de TRANS-1 (`be360fd`); MOBILE-1 y esta release no lo tocan.
- **Git:** la baseline se marca con el tag `playtest-0.2`, sobre el commit desplegado (§6). Sigue la convención de tags del repo (`v0-legacy-baseline`).
- **Puerta de acceso:** 0.2 sigue leyendo la fila `community-0.1` de `playtest_gate`, a propósito, porque ahí están el switch de abierto/cerrado y el código de acceso. La rama de producción sigue siendo `playtest/community-0.1`.

## 5. Freeze

Desde el deploy de 0.2, esta rama sólo recibe arreglos de bugs críticos, regresiones, crashes, fallos de conexión, exploits importantes y problemas graves de UX que impidan jugar. El feedback de diseño y las features nuevas se registran para las fases siguientes.

## 6. Baseline para comparar regresiones

La baseline es el commit con el tag `playtest-0.2`. Las herramientas y mediciones de referencia se conservan:

- **Fidelidad remota:**
  - herramientas: `scripts/perf/remote-fidelity/run.sh` y `compare.mjs`;
  - referencia: `docs/performance/baselines/perf-2/fidelity-4-stacked-steps.json` (0 saltos en 264 runs);
  - una regresión se nota como resultados distintos a esa referencia.
- **Multitud headless:**
  - herramientas: `scripts/perf/local-stack.mjs`, `run-multi.sh` (+ `AREA=pradera`) y `compare-multi.mjs`;
  - referencia: `docs/performance/baselines/trans-1/multi/`.
- **Transiciones:** `scripts/perf/transition-trace/run.sh`, contra `docs/performance/baselines/trans-1/timeline-after.txt`.
- **Transporte:** `scripts/benchmark-presence.mjs`, contra `docs/performance/baselines/perf-2/bandwidth/` (19,3 KiB/s por cliente con 30 corredores).
- **Móvil:** `scripts/perf/mobile-shots.mjs` y `/dev/superficies` (sólo DEV), contra `docs/performance/baselines/mobile-1/shots/`.

WORLD-1 puede afectar CPU, red, AOI, densidad de entidades y sincronización: cada cambio de ese bloque se mide contra esta baseline.

## 7. Después de 0.2 (no empezado)

Dos frentes, en paralelo y con su propio alcance:

- **WORLD-1:** mundo dinámico realmente compartido y autoritativo en el servidor.
- **SKILLS-1:** reestructuración profunda de Skills, inspirada en la progresión de Old School RuneScape, con una dirección de diseño que se define aparte.

Ninguno de los dos se diseñó ni se implementó como parte de 0.2.

# PokeSwap — Prompt maestro de rendimiento y estabilidad

> Documento para entregar a un ingeniero o agente que parte sin contexto.
> Estado verificado: 2026-09-23, America/Buenos_Aires.

## Prompt listo para copiar

Quiero que actúes como responsable principal de rendimiento, estabilidad jugable y operación multijugador de PokeSwap. Partís sin contexto previo: construí tu comprensión desde el repositorio y evidencia reproducible. La tarea puede durar muchas sesiones; mantené una bitácora acumulativa que permita continuar sin perder contexto.

### Repositorio y punto de partida

- Repositorio: `git@github.com:terremotoparatodos/pokeswap.git`
- Rama documental inicial: `docs/performance-stability-handoff`
- Base productiva que no debés reescribir: `playtest/community-0.1`
- Commit productivo al iniciar: `26f3b7c428a00769b82a8f0eea1336371ae3a80c`
- Sitio: `https://pokeswap.lol/`
- Realtime: `wss://us-mia-2a460f24.colyseus.cloud`

Antes de cambiar código:

1. Confirmá rama, commit, remoto, sincronización y árbol limpio.
2. Leé completos y en orden:
   - `AGENTS.md`
   - `docs/INVARIANTS.md`
   - `docs/TRUST_BOUNDARY.md`
   - este documento
   - `docs/wildlands/HANDOFF.md`
   - `docs/wildlands/R30_PRODUCTION_HANDOFF.md`
   - `services/realtime/README.md`
3. Inspeccioná los commits `5ffd09e`, `01037df` y `26f3b7c`, incluidas sus pruebas.
4. Creá una rama de trabajo desde `docs/performance-stability-handoff`. No trabajes directamente en `playtest/community-0.1`.
5. Creá `docs/wildlands/PERFORMANCE_STABILITY_WORKLOG.md`. En cada sesión registrá commit inicial, hechos, pruebas, métricas, cambios, producción, preguntas abiertas y próximo experimento.
6. Etiquetá toda incertidumbre como **FACT**, **INFERENCE** u **OPEN QUESTION**.

### Misión

Realizá una investigación integral y corregí de raíz los problemas de rendimiento y estabilidad de Ciudad Corazón, Pradera y la presencia realtime. No te limites a revisar código o compilar: reproducí, instrumentá, medí, corregí, agregá regresiones y verificá en ejecución real.

El objetivo inmediato es probar movimiento autoritativo y colisiones. El objetivo amplio incluye frame time, red, memoria, desconexiones, reconciliación, menús, chat, skills, portales y transiciones con 1, 10, 30, 50 y, cuando sea razonable, 100 jugadores.

### Estado operativo verificado

- El frontend se publica con GitHub Actions y Cloudflare Pages desde `playtest/community-0.1`.
- El bundle público declara `Community Playtest 0.1 · 26f3b7c` y apunta al endpoint realtime esperado.
- Colyseus Cloud usa una instancia en Miami y límite global de 100 conexiones.
- El 2026-09-23 Colyseus se cambió de la rama antigua `feat/wildlands-r30-cloud-deploy` a `playtest/community-0.1` y desplegó correctamente `26f3b7c`. Antes ejecutaba `ae28451`.
- El servidor respondió HTTP 200 y `Colyseus 0.18.13` después del despliegue.
- `joinOrCreate/presence` desde el origen oficial devolvió HTTP 200 y una reserva guest válida.
- El repositorio no tiene despliegue automático de Colyseus en GitHub Actions. Es una operación autenticada. Nunca imprimas ni confirmes tokens de despliegue.
- Baseline conocido: 1.922 pruebas del cliente y 49 del servidor; typecheck y build aprobados; lint con cero errores y nueve warnings antiguos en `AuthModal.vue`.
- Simulación previa de 30 jugadores: cero movimientos rechazados. RTT p95 local aproximado: 3,35 ms.
- Baseline observado en producción con Ciudad visible: 60 FPS, 1,8 ms promedio, p95 2,8 ms, p99 3,1 ms y 0% de frames mayores a 33 ms.

Estos números son referencia, no prueba de auditoría completa.

### Trabajo ya entregado

1. Presencia incremental, batching e interés espacial.
2. Simulador/benchmark hasta 100 jugadores.
3. Cachés de renderer, chunks y sprites, más precalentamiento.
4. Retiro del rasterizado 3D costoso de ciudad conservando fachadas 2D.
5. Optimización de clima, lluvia y nieve.
6. Menús, chat y skills sin congelar indebidamente el mundo.
7. Corrección de campo visual ante zoom del navegador.
8. Corrección de cámara embebida: no usar `window.outerWidth` para escalarla.
9. Protección cliente contra posiciones autoritativas dentro de sólidos.
10. Eliminación de rechazos falsos ante movimientos legítimos agrupados.

### Incidente crítico histórico

Al correr, varios movimientos de una casilla podían llegar juntos. El servidor imponía un intervalo mínimo por reloj y rechazaba el segundo paquete legítimo, quedando una casilla detrás del cliente. Una reconciliación posterior podía introducir al jugador en una casa.

La corrección servidor en `services/realtime/src/presence/movement.js` usa secuencias estrictamente crecientes para impedir replay y una ventana máxima de diez movimientos por segundo, sin el intervalo temporal que rechazaba jitter legítimo. La defensa cliente valida la coordenada autoritativa contra los sólidos, vuelve a un spawn seguro y solicita corregir también el servidor.

Revisá especialmente:

- `services/realtime/src/presence/movement.js`
- `services/realtime/src/presence/presence.test.js`
- `services/realtime/src/rooms/PresenceRoom.js`
- `src/features/wildlands/multiplayer/domain/movementReconciliation.ts`
- `src/features/wildlands/multiplayer/domain/movementReconciliation.test.ts`
- `src/features/wildlands/engine/game.ts`

### Observación aún no clasificada

Después del despliegue actual, una automatización con teclas sostenidas y cambios de visibilidad mostró “Tu posición se corrigió al punto seguro de esta zona” y luego se observó al jugador en Pradera. La automatización pudo dejar una tecla sostenida o cruzar un portal. Tras liberar todas las teclas y usar el botón Ciudad, el cliente volvió normalmente a Ciudad Corazón a 60 FPS.

No declares esto bug confirmado ni caso resuelto. Distinguí con evidencia entre:

- transición de portal válida;
- artefacto de foco/key-up/visibilidad;
- reconciliación inválida pese al servidor nuevo;
- socket anterior durante rolling deploy;
- carrera de transición de área.

Reproducilo con pasos individuales, coordenadas locales y autoritativas, secuencias y mensajes.

### Mapa técnico mínimo

Cliente/UI:

- `src/features/wildlands/components/WildlandsView.vue`
- performance HUD, `LobbyMenu.vue`, `ChatPanel.vue` y overlays de skills/profesiones.

Motor:

- `engine/game.ts`, `renderer.ts`, `projection.ts`, `actors.ts`, `navigator.ts`, `pathfinding.ts`, `chunks.ts`, `atmosphere.ts`.
- `areas/hearthome.ts` y `areas/townArea.ts`.

Multiplayer cliente:

- `multiplayer/api/colyseusPresence.ts`
- `multiplayer/domain/presence.ts`
- `areaReconciliation.ts`
- `movementReconciliation.ts`

Servidor:

- `services/realtime/src/index.js`
- `rooms/PresenceRoom.js`
- `presence/movement.js`, `interest.js`
- `observability/metrics.js`, `health.js`
- `protocol/messages.js`

Carga/operación:

- `scripts/benchmark-presence.mjs`
- `services/realtime/scripts/load-presence.js`
- `services/realtime/Dockerfile`
- `services/realtime/ecosystem.config.js`

### Plan obligatorio

#### A. Rehacer baseline

- Ejecutá suite completa cliente y servidor, typecheck, build y lint.
- Corré carga de 1, 10, 30, 50 y 100 jugadores en Ciudad y Pradera cuando corresponda.
- Guardá JSON crudo y documentá hardware, navegador, viewport, zoom, DPR, región, warm-up y duración.
- Separá cold start de estado caliente.
- Confirmá el build público y el commit real de Colyseus.

#### B. Instrumentar autoridad de movimiento

Medí de forma no sensible:

- intenciones enviadas;
- movimientos aceptados/rechazados por razón;
- última secuencia enviada y confirmada;
- reconciliaciones;
- reconciliaciones contra sólidos;
- recuperaciones a spawn seguro;
- cambios de área;
- reconexiones y motivo;
- RTT p50/p95/p99/máximo;
- mensajes y bytes por segundo.

No registres JWT, tokens, chat, correo ni IDs completos. Agregá una huella pública de versión/commit al servidor para verificar futuros despliegues sin depender del panel de Colyseus.

#### C. Reproducir la recuperación ambigua

1. Empezá en una coordenada segura registrada de Ciudad.
2. Mové una casilla por vez y guardá local, autoridad, secuencia y colisión.
3. Repetí caminando y corriendo.
4. Introducí jitter/agrupamiento sólo en un harness controlado.
5. Probá giros justo después de acknowledgements agrupados.
6. Probá reconnect durante movimiento y transición.
7. Identificá exactamente qué condición invoca el spawn seguro.
8. Recién entonces decidí si hay que cambiar código.

#### D. Recorrido completo de Ciudad

Caminá y corré alrededor de:

- cada edificio funcional, casa y departamento;
- puertas y la fila frente a cada umbral;
- fuentes y bordes;
- cercos, esquinas, bancos, faroles y carteles;
- portones, portales y límites;
- entrada/salida de Pradera;
- los mismos obstáculos con tap/click pathfinding;
- giros repetidos tocando un sólido;
- zoom del navegador antes y durante movimiento.

Ante un fallo registrá coordenada inicial, input, posición local, autoridad, área, secuencia, frame time y mensajes.

#### E. UI concurrente

Verificá menú, chat, skills, inventario, paneles y auth mientras el mundo mantiene su política correcta de pausa. Buscá foco incorrecto, teclas pegadas, movimiento al escribir, reanudación con picos, bursts de red y socket al ocultar la pestaña.

#### F. Matriz de rendimiento

Por zona y carga medí:

- FPS y frame promedio/p95/p99/máximo;
- frames >33 ms;
- fases del renderer;
- chunks vivos/generados/evictados y peor generación;
- RTT completo;
- mensajes físicos, updates lógicos y ancho de banda;
- heap y memoria de proceso durante pruebas largas;
- CPU del servidor;
- desconexiones/reconexiones;
- rechazos por razón;
- reconciliaciones y recuperaciones.

No aceptes una mejora promedio que empeore p99, memoria, desconexiones o corrección.

#### G. Corrección y regresión

Para cada fallo confirmado:

1. Escribí la prueba fallida cuando sea práctico.
2. Determiná la capa autoritativa y el mecanismo.
3. Aplicá un cambio estrecho sin reformateos laterales.
4. Ejecutá prueba enfocada y suite afectada.
5. Ejecutá suite completa, typecheck, build y lint.
6. Repetí el caso visual/producción.
7. Compará métricas antes/después.
8. Hacé un commit pequeño y atribuible.

### Gates de publicación

No publiques si falta alguno aplicable:

- árbol sin cambios ajenos;
- regresiones cubiertas y todas las suites verdes;
- typecheck/build verdes;
- cero warnings o errores nuevos;
- ningún secreto en bundle, logs, commits o artifacts;
- recorrido de Ciudad aprobado caminando y corriendo;
- menú/chat/skills sin freeze ni input cruzado;
- ningún rechazo o spawn seguro sin explicación;
- métricas antes/después;
- compatibilidad cliente/servidor explícita;
- commit y procedimiento de rollback conocidos.

Tras publicar repetí HTTP, matchmaking, WebSocket, movimiento, reconciliación, colisiones y métricas. El frontend se despliega automáticamente desde la rama productiva; Colyseus requiere autenticación. No extraigas ni evadas el código del playtest: pedile al usuario que lo ingrese. Nunca pidas que pegue credenciales.

### Reglas de decisión

- Compilar no demuestra corrección.
- Un fallback seguro no demuestra que desapareció la causa.
- No optimices sin demostrar que esa ruta participa del costo.
- No cambies balance, economía, ownership, pagos, recompensas o persistencia.
- No habilites réplicas/Redis sin medir necesidad y diseñar autoridad compartida.
- Conservá todos los cambios existentes del usuario.
- Pedí intervención sólo para autenticación privada, código de acceso o decisiones de producto; avanzá autónomamente en el resto.

### Entregables acumulativos

- worklog multi-sesión;
- baseline y matriz de carga;
- hallazgos priorizados con evidencia y severidad;
- pruebas de regresión;
- commits pequeños;
- comparación antes/después;
- informe de compatibilidad;
- runbook de despliegue/rollback;
- riesgos y preguntas abiertas.

Tu primera respuesta debe resumir estado real del repositorio, documentos leídos, riesgos, baseline a recrear y primer experimento concreto. Después empezá a ejecutar; no te quedes sólo en planificación.

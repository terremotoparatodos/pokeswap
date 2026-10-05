# ECO-PREVIEW-1 — Simulador local del ecosistema

> Rama `tools/eco-preview-1-0.3`, desde `world/eco-2b-realtime-bundle-0.3 @ 16b1ba54e0802a8638ecc74b1c04347ab1f6a19a` (ECO-1 + ECO-2A + ECO-2B, sin modificarlas).
> **Herramienta de desarrollo local.** Sin ruta en el juego. No se tocaron router, `WildlandsView`, HUD, componentes activos, realtime, presencia, protocolo, economía, SQL ni Cloud. Sin login, credenciales, Supabase, red ni túneles.

---

## 1. Qué es

Una página Vue aparte que hace correr el **motor real** (`population/engine.ts`) sobre el **catálogo real** (ECO-1) en una **grilla sintética**, con controles para observarlo y comparar configuraciones. La lógica vive en un controlador puro y testeado; la vista sólo dibuja y despacha acciones.

| Archivo (`src/features/ecosystem/preview/`) | Responsabilidad |
| --- | --- |
| `scenarios.ts` | Zonas, grilla de 18 × 12, rocas sintéticas y parches de nido; 2 disposiciones (`mixed`, `by-habitat`); `SimParams` provisionales (`defaultParams`) |
| `simulator.ts` | Controlador puro: `createSim`, `advance`, `repeatEvaluation`, `retire` (simulado), `setPlayers`, `setForcedInactive`, `resetSim`, `viewOf`. La semilla y el estado del RNG son parte del estado |
| `compare.ts` | `runSession` / `compareSetups`: una sesión guionada sin interfaz (30 min, pasos de 5 s, 8 % de retiradas, ausencia en los minutos 12–19) con métricas |
| `EcoPreviewApp.vue` | Vista: render y despacho |
| `main.ts`, `index.html` | Entrada propia |
| `vite.preview.config.mjs` | Servidor sólo en `127.0.0.1` con `strictPort`; `envDir` = esta carpeta (sin `.env`); `publicDir` = `public/` del repo (sprites existentes) |

**Lo que muestra:**
- banner "SIMULACIÓN LOCAL — grilla sintética";
- selector de hábitat (Pradera abierta, Bosque, Cueva inicial) y de disposición de nidos;
- la grilla con casillas bloqueadas, parches de nido y encuentros con sprite overworld y contorno de color por **grupo**;
- reloj y número de evaluaciones;
- estado del área (`active`, `idle`, `dormant`, simulada o no);
- población del área y su tope;
- por nido: vivos/tope, generación y tiempo hasta la próxima reposición;
- al seleccionar un encuentro: id, especie, familia, tier y grupo (n/m);
- un log de eventos.

**Controles:**
- semilla, política y los 9 parámetros numéricos;
- +1 s, +15 s, +75 s y +5 min;
- repetir evaluación sin avanzar el reloj;
- derrotar, capturar o huir (**simulado**);
- número de jugadores;
- forzar área inactiva;
- reiniciar el escenario;
- comparar A (parámetros actuales) contra B (disposición y parámetros editables).

"Retirar", "capturar" y "derrotar" sólo llaman a `retireEncounter` del motor en memoria: ninguna API, ningún ejemplar, XP, Esencia ni moneda.

## 2. Cómo abrirlo

```bash
node node_modules/vite/bin/vite.js --config src/features/ecosystem/preview/vite.preview.config.mjs --port 5191 --strictPort --host 127.0.0.1
```

Después, abrir `http://127.0.0.1:5191/`.

- Primero comprobar que el puerto está libre. Con `--strictPort`, Vite falla en lugar de tomar otro puerto o de pelear con otro proceso.
- En esta verificación se usó el Node v22.23.3 portátil verificado. Antes, un sondeo con `net.createServer` en `127.0.0.1` confirmó libres los puertos 5191, 5193, 5197, 5211 y 5233.

**No es parte del build del juego.**
- `vite build` sigue transformando 425 módulos, igual que la base, y `dist/` no contiene ningún string del simulador.
- El servidor de desarrollo del juego podría servir el `index.html` por su ruta de archivo, como cualquier archivo bajo `src/`. No es una ruta del router ni está enlazado desde el juego.

## 3. Verificación

**Gates** (Node v22.23.3):

| Gate | Resultado |
| --- | --- |
| `vitest run src/features/ecosystem` | 11 archivos, **114 tests ✔** (ECO-1 + 2A + 2B + 16 nuevos) |
| Typecheck (`vue-tsc`, incluye el `.vue`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores. 9 warnings preexistentes, ninguno en `ecosystem` |
| `git diff --check 16b1ba5..HEAD` | exit 0 |
| `bundle-encounters.mjs --check` | exit 0 (el bundle de ECO-2B sigue al día) |
| `vite build` del juego | exit 0, 425 módulos, 0 strings del simulador en `dist/` |

**Tests nuevos:**
- **`simulator.test.ts` (9):**
  - escenario reproducible: población inicial escalonada → retirada de un grupo → reposición a 60–90 s, nada en `due − 1` y generación 2 en `due` → todos se van (`idle`, no simulada) → 5 min (`dormant`, vacía) → vuelve un jugador (relleno escalonado con ids nuevos);
  - reiniciar reproduce exactamente; la misma semilla da la misma corrida y otra semilla, otra;
  - repetir evaluación no cambia la población ni el reloj;
  - la retirada es idempotente;
  - presencia e inactividad forzada se aplican en la evaluación siguiente;
  - paso de reloj inválido y configuración inválida;
  - en las 3 zonas, ningún encuentro sobre casillas bloqueadas o fuera de nido, y los topes se respetan;
  - la comparación es determinista;
  - `per-member` mantiene la cueva más llena que `per-group`.
- **`EcoPreviewApp.test.ts` (5, montado con @vue/test-utils):**
  - banner y estado inicial;
  - avanzar, repetir, seleccionar, retirar y reiniciar, con un spy sobre `fetch` que nunca se llama;
  - cambiar a Bosque y forzar inactividad hasta `dormant`;
  - una configuración inválida muestra el error;
  - comparar.
- **Guard de aislamiento ampliado** (`isolation.test.ts`):
  - `preview/` sólo puede importar el motor, el catálogo, `preview/`, Vue (y Vite y `node:url` en la config) y el helper de sprites `wildlands/engine/characters`;
  - nada de `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, Supabase, Colyseus ni `localStorage`/`sessionStorage`;
  - controles negativos: el bundle del realtime, un módulo de Supabase, `@supabase/supabase-js` y un `fetch` se detectan.

**Smoke visual (navegador integrado, `http://127.0.0.1:5191/`).**

| Paso | Observado |
| --- | --- |
| Carga | Sin errores. La consola sólo muestra los mensajes de conexión de Vite |
| t = 0 → +15 s | 4 encuentros (Geodude ×2, Paras, Diglett), población 4/6, contorno por grupo |
| Seleccionar y "Derrotar (simulado)" | Log: `retirado (defeated, simulado) … · reposición a t=100.12s` |
| Repetir evaluación | `sin cambios` |
| +75 s (t = 90 s) | Faltan 10,1 s para la reposición, sin cambios |
| +15 s | El nido repone (generación 2) |
| Forzar inactiva, +1 s, +5 min | `idle` → `dormant (no simulada)`, población 0/6, `4 retirados por inactividad` |
| Comparar (A mixtos / B por hábitat) | A: 60 nacidos, 1,91 vivos de media, sin fallos. B: 71 nacidos, 2,89 de media, `empty-tier 85`, `area-full 4`. Al repetir, mismos números |
| Recargar | La misma semilla reproduce las mismas especies en las mismas casillas |
| Red | Todas las peticiones fueron a `127.0.0.1:5191` (módulos y `/assets/overworld/0046|0050|0074.png`) |

- El servidor escuchó sólo en `127.0.0.1:5191` (netstat) y se detuvo al terminar; el puerto quedó libre.
- Para no escribir en el worktree de la sesión no se usó `launch.json`: el servidor se lanzó en segundo plano y la URL se abrió en el navegador integrado.
- Corrección durante el smoke: la numeración del log se cortaba con dos dígitos; se ensanchó el margen.

**Capturas** (sólo la herramienta local, sin datos de cuenta): `docs/design/eco-preview-1/01-cueva-poblacion-inicial.jpg`, `02-cueva-dormant.jpg` y `03-seleccion-y-comparacion.jpg`.

## 4. Qué decisiones se pueden evaluar con él

- **Política de reposición** (`per-group` o `per-member`): densidad media frente a ciclos legibles. En la sesión guionada, `per-member` llena más la cueva (test).
- **Nidos por hábitat o mixtos.** Un nido que sólo aloja hábitats sin entradas `common` falla la mayoría de sus intentos con `empty-tier`, porque el motor no redistribuye. En la cueva, 85 fallos en 30 min. Opciones:
  - nidos mixtos;
  - shares por nido;
  - aceptar los huecos.
- **Topes de área y de nido y tamaño de grupo:** cuánto se ve la cueva de 6 frente a la Pradera de 12; cuándo aparece `area-full`.
- **`delayMs`, `jitter` y `retryMs`:** ritmo de reaparición y de reintentos.
- **Dormancia y escalonado:** qué ve quien vuelve a una zona vacía.
- **Dominancia de especies:** con los pesos actuales, en la cueva mixta Zubat es la especie más frecuente (#41 × 26 de 60).

## 5. Limitaciones

- **La grilla es sintética.** No representa la Pradera ni el interior real de la cueva, y los parches de nido no son propuestas de posición.
- La presencia es binaria para el motor (hay o no hay jugadores). El número de jugadores sólo se usa para eso; el motor de ECO-2A no escala nidos con la cantidad.
- No hay combate, nivel, shiny, captura real ni recompensas. "Retirar" es instantáneo y lo decide quien usa la herramienta.
- Las métricas de comparación vienen de **una** sesión guionada y una semilla: sirven para comparar configuraciones, no para fijar balance.
- Los sprites muestran el primer cuadro de la hoja overworld; no hay animación.
- Accesibilidad básica: las casillas son botones, la navegación con teclado es larga y la casilla de inactividad no tiene nombre accesible propio.

## 6. Estado

| Pieza | Estado |
| --- | --- |
| Motor (ECO-2A) y catálogo (ECO-1) | Preparados, en revisión |
| Bundle para el realtime (ECO-2B) | Preparado, reproducible, con `--check`. No importado por ningún room ni servicio |
| Simulador (este documento) | Herramienta local de desarrollo, sólo en loopback |
| **Integración al MMO** | **No realizada.** El roster horario sigue activo (K1/K2). ECO-2C requiere autorización y coordinación con la principal (`worldRoom.js`, presencia, protocolo) |

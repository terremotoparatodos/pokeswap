# ECO-GAMEPLAY-1 — Contrato motor ↔ servidor ↔ cliente

**Objetivo de la entrega:** dos clientes ven la misma población autoritativa (incluidos varios ejemplares de una misma especie), las apariciones respetan geometría y límites, y una retirada de prueba permite observar el respawn.

**Base:** `50842f8` (`fix/eco-admission-r1-r2-0.3`), que contiene `ad6a98e` (verificado: ancestro, árbol `149380ab…` igual al del preflight). Rama `feat/eco-gameplay-1-0.3`.

**Fuera de alcance:**
- capturas, drops, tokens y cualquier recompensa o efecto persistente;
- persistencia de la población y multi-host;
- rediseño de balance (los valores ECO se usan como **provisionales**, sin cambios);
- activación en producción o en el entorno oscuro.

Convención: **FACT** (verificado en el código), **DECISIÓN** (de este contrato), **LÍMITE** (conocido y aceptado para esta entrega).

## 1. Desglose de responsabilidades (AGENTS.md §17)

| Capa | Responsabilidad | Dónde | Qué no hace |
|---|---|---|---|
| Motor ECO (sin cambios) | Nidos, grupos, límites por nido/zona/área, respawn, ids, proyección pública | `src/features/ecosystem/population/**`, `map/**` | Reloj, RNG, red, persistencia |
| Admisión empaquetada (nuevo) | Admite R1/R2 (`createValidatedPopulation`) y entrega **solo** una población admitida, con operaciones de intención | `src/features/ecosystem/server/admissionRuntime.ts` → `services/realtime/src/world/ecosystem/admission.generated.js` | No exporta `createPopulation` ni el motor suelto |
| Adaptador autoritativo (nuevo) | Posee el estado; aporta reloj, RNG, layouts vigentes y áreas activas; difunde cambios | `services/realtime/src/world/ecoPopulation.js` | No otorga valor; no persiste |
| Room del mundo (cableado) | Elige **un** sistema de población por proceso; transporta snapshot/deltas y la retirada de prueba | `services/realtime/src/world/worldRoom.js`, `worldConfig.js`, `worldProtocol.js` | No decide reglas ECO |
| Cliente (cableado + presentación) | Dibuja el estado recibido; en modo experimental, ofrece la retirada de prueba | `src/features/world/state/sharedWorld.ts`, `src/features/wildlands/engine/population.ts`, panel dev | No calcula población, ids ni respawn |

## 2. Motor ↔ servidor: la admisión empaquetada

**FACT:**
- El bundle actual (`encounters.generated.js`, API v2) exporta `createPopulation`, `tickPopulation` y `retireEncounter`, pero no `createValidatedPopulation`.
- `geometryAdmission.ts` importa el snapshot con `?raw`, que Node plano no resuelve.

**DECISIÓN — bundle de admisión aparte:**
- `admission.generated.js` (API `ECO_ADMISSION_API = 1`). El bundle v2 queda intacto.
- Se genera con esbuild desde `admissionRuntime.ts`, con el texto `?raw` incluido como literal inmutable. Su vigencia se comprueba con `--check` y con un test de deriva.
- **Superficie, y nada más:**

  ```ts
  admitEcoPopulation({ namespace, currentLayouts }) →
    { ok: true, population } | { ok: false, issues }
  ```

  `population` es opaca. Expone solo intenciones:
  - `tick({ now, random, activeAreas })` → `{ ok, changedAreas, reason? }`;
  - `retire({ encounterId, now, random })` → `{ ok, areaId?, reason? }`, con causa fija `fled` (simulación, sin valor);
  - `view(areaId)` → `{ simulated, encounters[] }`, que es `publicArea` del motor;
  - `areaOf(encounterId)` y `areaIds`.
- **Qué queda dentro del bundle** (el servidor no puede sustituirlo):
  - configuración, catálogo, propuestas de nidos, capacidad provisional y respawn/idle provisionales (`PROVISIONAL_RESPAWN`, `PROVISIONAL_IDLE`);
  - geometría (el snapshot verificado del build);
  - lookup de especies (catálogo battle `core.json`).
- **Entradas que da el servidor:**
  - `currentLayouts`, de `layoutVersion(areaId)` del mundo autoritativo, independiente del snapshot;
  - `namespace`;
  - en cada llamada, reloj y RNG.
- **Geometría del tick:** `isOpenTile` = ninguna bandera de `FORBIDDEN_FLAGS` en el snapshot admitido.
- **LÍMITE:** la ocupación dinámica (jugadores, trabajos) no entra en esta entrega.
- **Fallo cerrado:** si la admisión falla, no hay población y el área queda `unavailable` para todos. Se registra un log con los códigos de los issues, nunca datos sensibles.

## 3. Servidor: autoridad, reloj, RNG e identidad

- **Una población compartida por proceso:**
  - cubre el alcance admitido (`pradera`, con sus zonas abierta y bosque, y `cueva-inicial`);
  - el motor lleva estado, límites y estado activo/idle/dormant **por área**.
- **Áreas activas:** las que tienen al menos un cliente de mundo conectado mirando esa área.
- **Reloj:** `now()` del `WorldRoom`, el mismo que usan el resto del mundo y el snapshot.
  - Cadencia del tick ECO: cada 250 ms (`ECO_TICK_MS`), dentro del tick de 50 ms del mundo.
- **RNG:** `node:crypto` (`randomInt(2**48) / 2**48`), del servidor y nunca del cliente.
- **Identidad de encuentro:** el id del motor, `<namespace>:<área>:<nido>:<generación>:<miembro>`.
  - No contiene especie ni dueño. Dos ejemplares de la misma especie tienen ids distintos.
  - El cliente lo trata como opaco.
- **Namespace:** `eco-<arranque en base36>-<8 hex aleatorios>`, nuevo en cada proceso.
  - **LÍMITE:** un solo host, en memoria. Un reinicio vacía la población y cambia los ids.
- **Retirada de prueba:**
  - solo si el modo experimental está activo y `NODE_ENV !== 'production'`;
  - solo para un jugador del área del encuentro;
  - causa `fled`; no hay captura, drop, token ni escritura persistente.

## 4. Modo experimental: un solo sistema por proceso

- **Servidor:** `WORLD_ECO_EXPERIMENT=on`.
  - Con `NODE_ENV=production`, el arranque **falla** (error explícito). No es un flag productivo.
  - Con el modo activo, **no se crea ni se tickea `WildService`**: el roster viejo no existe en ese proceso.
  - Sin el modo, el comportamiento actual queda idéntico.
- **Cliente:** declara `ecoProtocol: 1` al unirse solo si `import.meta.env.DEV` y `VITE_ECO_EXPERIMENT === 'on'`.
  - El panel de retirada de prueba se carga con import dinámico bajo la misma condición, así que un build de producción no lo contiene.
  - Un cliente sin `ecoProtocol` conectado a un servidor experimental recibe `wildStatus: 'unavailable'` y no ve población (falla cerrado). Nunca recibe el roster viejo.

## 5. Protocolo (`worldProtocol.js`)

| Mensaje | Dirección | Contenido |
|---|---|---|
| `world:snapshot` (campo nuevo `eco`) | servidor → cliente con `ecoProtocol` | `{ protocol: 1, areaId, status, encounters }`. `status` es `active`, `not-simulated` o `unavailable`. Cada encuentro es `{ id, groupId, speciesId, tx, ty }`. |
| `world:eco` | servidor → clientes del área | El mismo objeto, completo, cuando cambia la vista pública del área (spawn, retirada, cambio de estado). Se envía en el flush siguiente. |
| `world:eco-dev-retire` | cliente → servidor | `{ requestId, encounterId }` |
| `world:eco-dev-retire-result` | servidor → ese cliente | `{ requestId, encounterId, ok, reason? }`. `reason` es `disabled`, `invalid`, `not-alive`, `other-area`, `not-player` o `unavailable`. |

Se envía el área entera (como mucho 18 encuentros) en lugar de deltas: es simple y basta para esta entrega. **LÍMITE:** no está optimizado para áreas grandes.

## 6. Cliente: presentación

- **`SharedWorld`:**
  - guarda el último `eco` del área actual;
  - descarta el de otra área;
  - lo expone como `ecoArea()` (`null` fuera del modo experimental).
- **`Population`:** con `ecoArea()` no nulo, dibuja exactamente esos encuentros, por id:
  - crea los nuevos y quita los que ya no están;
  - no muestra el roster;
  - sprite por `speciesId` con `loadWorkerPokemonInfo`: entrada del Pokédex si existe, si no la hoja de overworld del id;
  - movimiento con la patrulla compartida existente (`buildPatrol`, clave = id del encuentro, casa = tile del servidor), muestreada en tiempo del servidor e igual en todos los clientes.

  Con `ecoArea()` nulo, la ruta actual queda sin cambios.
- **Panel dev de retirada:** lista los encuentros vivos del área, con id corto, especie y tile, y un botón «Retirar (prueba)».

## 7. Entorno aislado y prueba humana

- **Realtime:**
  - `NODE_ENV=development`, `PRESENCE_BENCHMARK=on`, `WORLD_ECO_EXPERIMENT=on`;
  - puertos propios (2790 juego / 2791 salud);
  - sin variables de Supabase ni de autoridad (modo `unavailable`: nada se trabaja ni se persiste);
  - `ALLOWED_ORIGINS` = origen del cliente local.
- **Cliente:**
  - `vite build --mode development` en una carpeta del scratchpad, servida con `vite preview`;
  - Supabase placeholder (`http://127.0.0.1:1`);
  - `VITE_REALTIME_URL=ws://127.0.0.1:2790`, `VITE_PRESENCE_BENCHMARK=on`, `VITE_ECO_EXPERIMENT=on`.
- **Dos jugadores sintéticos:** `?area=pradera&benchmarkId=eco-a` y `?area=pradera&benchmarkId=eco-b`.
- **Lo que no se toca:**
  - el entorno oscuro (2567/2568/5173), `pokeswap-int1`, producción, Cloud y SQL hosted;
  - la caché de Vite de otro worktree: el build no usa dev server.

## 8. Pruebas

- **Admisión empaquetada:**
  - deriva del bundle;
  - superficie exportada: no expone el motor suelto;
  - fallo cerrado ante layouts alterados, namespace inválido o área faltante;
  - carga en Node plano.
- **Adaptador:**
  - mismo estado para dos observadores;
  - varios ejemplares de una especie con ids distintos;
  - tiles dentro de los candidatos y fuera de banderas prohibidas;
  - límites de área y zona;
  - retirada y respawn con reloj controlado;
  - retirada rechazada fuera de modo, de otra área o por un guest;
  - áreas inactivas: idle y luego dormant.
- **Room:**
  - con el modo activo no hay `WildService`;
  - con `NODE_ENV=production` y el flag, el arranque falla;
  - el snapshot y el delta llevan `eco` solo a clientes con `ecoProtocol`.
- **Cliente:**
  - `SharedWorld` (área actual, descarte de otra área);
  - `Population` en modo ECO (altas, bajas, ids independientes de especie, sin roster).
- **Guards:** el aislamiento ECO se amplía por archivo exacto (adaptador y entrada de servidor) y con controles negativos.
- **Al final:** suites ECO, proyecto, realtime, typecheck, lint, build principal sin fuentes ECO ni panel dev, y `--check` de bundles.

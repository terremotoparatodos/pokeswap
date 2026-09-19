# Community Playtest 0.1

> Build temporal para abrir ~2 horas con jugadores reales durante un stream,
> observar, cerrar y volver al roadmap.
>
> **No es** la beta. **No es** R34. **No** cierra arquitectura.
> Prioridad: `PLAYABLE + SAFE + OBSERVABLE` antes que `PERFECTO`.

| | |
|---|---|
| Rama | `playtest/community-0.1` |
| Base (HUMAN APPROVED) | `integration/pre-r34-town-3d` @ `e0a158107ad4e8a98be814481c3daa9c3b1809b8` |
| Flag de build | `VITE_PLAYTEST=on` |
| Kill switch remoto | fila `community-0.1` en la tabla `playtest_gate` de Supabase |

---

## 1. Auditoría previa (qué había realmente)

Medido sobre el código, no sobre recuerdos.

### 1.1 Lo que ya existía y sirve

| Sistema | Estado real | Consecuencia |
|---|---|---|
| Ciudad Corazón 64×51 + modelos 3D | Producción | Se usa tal cual |
| WildLands (5 mundos procedurales) | Producción | Se usa tal cual |
| Presencia multijugador (Colyseus `PresenceRoom`) | Producción, **una sola sala global**, áreas `ciudad-corazon` y `pradera` | Base del chat |
| Profesiones (mining, woodcutting, fishing, alchemy) | Dominio completo + `demoSession` **en memoria** | Base de las Skills |
| Curva de XP de profesiones | `progression.ts`, niveles 1–60 | Se reusa; no se inventó curva |
| Dungeon prototype (D1.2.4) | Completo, ruta `/dev/dungeon` **sólo DEV** | Se expone por cueva, no por ruta |
| `DungeonSpawn` / `DungeonDefinition` | **Ya separados** | §17 del brief ya estaba satisfecho en contrato |
| `PlacedObjects` (F-1) | Producción: sólidez, footprint, picking, navegación | Capa física de las cuevas |
| Party ≤ 6 (`pokemon/model/party.ts`) | **Sólo tests**, sin consumidor productivo | El Centro usa su contrato sobre una capa playtest |

### 1.2 Lo que NO existía

Chat · panel de Skills · Centro Pokémon funcional (la puerta abría `caja`, una
lista de lectura) · Tienda de ítems (la puerta de la Tienda abría el **Mercado
P2P**) · entradas de Dungeon en el mundo · kill switch · build id · bug report.

### 1.3 Superficie persistente real (lo que hay que proteger)

Supabase: `profiles` (tokens, cooldowns, multiplicadores) · `slots` (propiedad de
Pokémon) · `market_listings` · `transactions` · `token_ledger` · `pokemon_xp` ·
`pokedex` · `activity_feed`.

Edge Functions: `pokeswap-swap`, `market-buy`, `market-publish`, `market-cancel`,
`collect-passive-tokens`, `dungeon-start`, `dungeon-reward`, **`kofi-webhook`**
(pagos).

---

## 2. Decisión de arquitectura

### El playtest es un *modo de build*, no una reescritura

- `VITE_PLAYTEST` ausente → **el producto normal**.
- `VITE_PLAYTEST=on` → build de playtest.

`isPlaytest` es una constante de build. Rollup la pliega, igual que
`import.meta.env.DEV`. Verificado: la build normal no contiene ni una cadena, ni
un chunk, ni un fixture del playtest (§9).

```bash
# build normal
npm run build

# build de playtest
VITE_PLAYTEST=on npm run build
```

En CI/Cloudflare el flag va como variable de entorno del paso de build, junto a
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_REALTIME_URL`.

---

## 3. Clasificación de datos (§14)

| Sistema | Clase | Por qué |
|---|---|---|
| Supabase Auth (login) | **SAFE** | Sólo se lee la sesión; el playtest no escribe perfiles |
| Presencia (Colyseus) | **SAFE** | En memoria del servicio, sin persistencia |
| Chat | **SAFE** | En memoria del servicio, muere con el proceso |
| Skills / profesiones | **DEV/PLAYTEST ONLY** | `demoSession`, en memoria de la pestaña |
| Party / cajas playtest | **DEV/PLAYTEST ONLY** | `usePlaytestStore`, en memoria de la pestaña |
| Tienda / fichas | **DEV/PLAYTEST ONLY** | Moneda de playtest, no son tokens |
| Dungeon prototype | **DEV/PLAYTEST ONLY** | Cliente puro, sin autoridad (D1 §4) |
| `playtest_gate` | **SAFE IF RESETTABLE** | Tabla nueva, sin datos de jugador, `DROP` seguro |
| Mercado P2P | **DISABLE** | Escribe ownership y balances reales |
| Swap | **DISABLE** | Escribe ownership real y cooldown |
| Perfil / tokens | **DISABLE** | Balance real |
| Pokédex | **DISABLE** | Escribe `pokedex` |
| Pagos (Ko-fi) | **DISABLE** | Nunca alcanzable desde el playtest |

**Ninguna superficie del playtest escribe en Supabase.** Las únicas lecturas son
la sesión de Auth y la fila del gate.

---

## 4. Seguridad: gate, kill switch y acceso

### 4.1 Dos llaves, en capas

1. **Flag de build** (`VITE_PLAYTEST`) — decide si el bundle *puede* ser un
   playtest. Cambiarlo requiere redeploy, y eso es deliberado: una build
   productiva normal no puede volverse playtest por accidente.
2. **Gate remoto** (`playtest_gate`) — cierra en segundos, sin redeploy.

El gate remoto **sólo puede restringir**. Puede cerrar una build que salió
abierta; nunca puede abrir una que no se construyó como playtest.

**Falla de red = sin respuesta, nunca `OPEN`.** Si la lectura falla (tabla
inexistente, RLS, offline, fila ausente o `state` inválido) el cliente conserva
el último estado que leyó: un `CLOSED` conocido sigue cerrado, un `OPEN` conocido
sigue abierto hasta el próximo poll que responda. Una pestaña que todavía no leyó
nada se queda en la pantalla del gate ("Un segundo…", con *Volver a chequear*) y
el poll sigue reintentando. No hay default de build abierto ni
`VITE_PLAYTEST_CODE`: el código vive sólo en la fila.

El cliente relee el gate cada **45 s**, así que `CLOSED` llega en menos de un
minuto a todas las pestañas abiertas.

### 4.2 Aplicar la migración (una sola vez, antes del stream)

`supabase/migrations/20260919_001_playtest_gate.sql` **no está aplicada**. Se
aplica desde el SQL editor de Supabase o con la CLI:

```bash
supabase db push
```

La tabla nace **CLOSED**: abrir es un acto deliberado.

### 4.3 Abrir el playtest

```sql
UPDATE playtest_gate
SET state = 'open', message = NULL, access_code = 'el-codigo-del-stream', updated_at = now()
WHERE id = 'community-0.1';
```

`access_code = NULL` deja entrar a cualquiera sin código.

### 4.4 Cerrar el playtest

```sql
UPDATE playtest_gate
SET state = 'closed',
    message = 'El Community Playtest 0.1 terminó. ¡Gracias por jugar!',
    updated_at = now()
WHERE id = 'community-0.1';
```

Nadie puede entrar y las pestañas abiertas ven la pantalla de cerrado en ≤45 s.

### 4.5 Honestidad sobre el código de acceso

El código viaja en un bundle público o en una fila de lectura pública. **No es
autenticación**: es un badén para que un link perdido no entre solo, y el código
se dice en el stream de todas formas.

Lo que realmente protege al jugador es que **una build de playtest no llega a
ningún estado persistente**. Un visitante no autorizado no puede ganar ni
romper nada, porque no hay nada que ganar ni romper.

Si el gate hay que endurecerlo de verdad, la opción correcta es un `CLOSED`
inmediato, no un código más largo.

---

## 5. Qué está abierto y qué no

### Ciudad Corazón

| Edificio | Puerta | Playtest |
|---|---|---|
| Centro Pokémon | `caja` | **ABIERTO** — curar, equipo y cajas |
| Tienda | `mercado` | **ABIERTO** — herramientas básicas y Poké Balls |
| Silph Co. | `swap` | Cerrado — mueve Pokémon reales entre cuentas |
| Gimnasio | `dungeon` | Cerrado — las Dungeons están en WildLands |
| Casa de Mr. Pokémon | `pokedex` | Cerrado |
| Casino | `perfil` | Cerrado — tokens reales |

Los edificios siguen en pie. Cerrado significa **no cargado**: el playtest nunca
empuja la ruta del panel, así que Mercado, Swap y Perfil no están ocultos, están
ausentes. Tampoco hay entrada por URL: en la build de playtest `/mercado`,
`/swap`, `/dungeon`, `/pokedex`, `/perfil`, `/caja` (y `/market`, `/profile`)
redirigen a `/`, sus rutas no se registran y sus chunks no se emiten. Cada puerta cerrada dice qué era y adónde ir en su lugar.

### WildLands

Abierto entero: 5 mundos, profesiones, cuevas de Dungeon, chat.

---

## 6. Reglas PLAYTEST

Cada una está marcada en el código con `PLAYTEST RULE`, `PLAYTEST PARAMETER` o
`PLAYTEST VALUES`, y todas son reversibles editando un solo bloque.

| Regla | Valor | Dónde |
|---|---|---|
| Profesiones arrancan en nivel 1, sin herramientas | — | `ProfessionWorldDemo` prop `fresh` |
| Curva de XP | **la real**, sin multiplicadores | `professions/domain/progression.ts` |
| Densidad de cuevas | 6 por mundo, anillos 6–26, separación 7 | `entranceSpawns.ts` |
| Reloj de spawn de Dungeon | 240 min | `entranceSpawns.ts` |
| Party inicial / cajas | 4 / 8 | `playtestRoster.ts` |
| Curación | gratis, sin cooldown | `playtestRoster.ts` |
| Purse inicial | 400 fichas, no se ganan más | `playtestShop.ts` |
| Stock de la Tienda | infinito | `playtestShop.ts` |
| Poké Ball básica | la del prototipo (~3 % a vida llena) | `dungeonPrototype/domain/capture.ts` |

### Por qué nivel 1 y no un multiplicador

Los primeros niveles de la curva real son baratos por diseño: **el nivel 2 son
dos golpes**. Una barra de energía llena gastada en piedra desde nivel 1 llega a
nivel 5 o más. El mismo esfuerzo encima de la Minería 16 del demo de desarrollo
es medio nivel. El test `playtestStart.test.ts` fija exactamente ese contraste,
así que el argumento vive en el repo y no en este párrafo.

Los nodos tier 1 permiten manos desnudas, así que un jugador sin herramientas
puede jugar igual — la Tienda es red de seguridad, no peaje.

---

## 7. Dungeons

### 7.1 Arquitectura de spawn

`DungeonDefinition` (qué es una Dungeon) y `DungeonSpawn` (una aparición, en un
lugar, por un rato) ya estaban separados desde D1. Lo que faltaba era el
*emplazamiento*, y es una función pura: un puerto contesta sólido / agua /
ocupado y devuelve tiles.

Las cuevas se **derivan** del id del área y del punto de llegada, nunca se
guardan — igual que cada nodo de profesión y el banco de alquimia. Mismo mundo,
mismas cuevas, para todos.

**Esto es lo único que tiene que cambiar antes de que sea real**: el servidor
debe ser dueño del reloj del spawn y de la lista de spawns (`dungeonSpawn.ts`
§SERVER AUTHORITY).

### 7.2 Emplazamiento

Una cueva se rechaza salvo que el tile de enfrente también sea caminable. Una
boca mirando a un lago es una cueva que nadie puede usar, y se lee como bug.

Medición real (`npm run dungeon:entrances`): 6 cuevas en los 5 mundos, la más
cercana entre **6 y 17 tiles** del punto de llegada.

### 7.3 Arte

Construida con las primitivas del propio motor (`shade`, `ellipses`) y las
paletas de roca que el mundo ya usa, para que se lea como terreno. Tres tiles de
ancho, dos de fondo, boca oscura en la columna central, acceso frontal. Paleta
por bioma: gris, hielo (tundra) o arena (desierto/costa).

### 7.4 Política de recompensas

El prototipo es **cliente puro**: captura, botín y progreso viven en memoria del
navegador y lo real será server-authoritative (`DUNGEON_PROTOTYPE_INTEGRATION.md`
§4). La cabecera del panel lo dice en pantalla.

Al salir vuelve **sólo el desgaste** — HP, PP y estado — y eso es lo que le da
trabajo al Centro Pokémon. **Nada más cruza**: una captura hecha adentro es
botín de cliente y se queda ahí. Otorgar un activo desde lógica de cliente es
exactamente lo que no se hace (AGENTS §11).

---

## 8. Chat

| | |
|---|---|
| Scope | **ÁREA** (`ciudad-corazon`, `pradera`) |
| Quién habla | jugadores autenticados; los invitados leen |
| Historial | 60 líneas por área, en memoria del servicio |
| Largo máximo | 200 caracteres |
| Rate limit | piso de 700 ms + techo de 6 por 10 s |
| Render | interpolación de Vue; `v-html`/`innerHTML` prohibidos por eslint |

Se eligió área y no global porque el actor ya lleva `areaId` para presencia, así
que no cuesta nada, y porque una ciudad que suena llena al lado de un descampado
que suena vacío **es información** sobre adónde fue la gente.

El saneo quita caracteres de control e invisibles (zero-width, overrides bidi:
lo que se usa para falsificar nombres) y **no** quita `<` ni `>`, para que
"3 < 5" sobreviva. Escapar es del renderer.

Tu propio mensaje aparece cuando vuelve de la sala, no cuando apretás Enter: lo
que leés es lo que la sala aceptó.

---

## 9. Aislamiento verificado

Build normal (`npm run build`), grep sobre `dist/assets`:

| Cadena | Archivos |
|---|---|
| `dungeonPrototype` | 0 |
| `PlayDungeon` | 0 |
| `Charizard` (fixtures del prototipo) | 0 |
| `Community Playtest` | 0 |
| `playtest_gate` | 0 |
| `fichas` | 0 |
| `Nadie dijo nada` (chat) | 0 |

Lista de chunks idéntica a la de la base. `WildlandsView` pasa de 313,44 kB a
**315,14 kB** (+1,7 kB): `worldProbes`, el traslado de `CompositeOverlay` al
motor, las constantes de chat en el adaptador de socket y dos envoltorios de
import dinámico. Ninguna superficie de playtest.

> **Bug encontrado construyendo esto.** Un import estático del store de playtest
> arrastraba los fixtures de especies del prototipo a una build **normal**,
> porque un módulo que siembra estado al importarse no se puede tree-shakear. El
> roster ahora se construye en el primer uso, y el store y el log de chat se
> importan dinámicamente.

---

## 10. QA hecho

| Check | Resultado |
|---|---|
| `npx vitest run` | **151 archivos / 1858 tests** verdes |
| `node --test` (realtime) | **41 tests** verdes |
| `npm run typecheck` | limpio |
| `npm run lint` | **0 errores**, 9 warnings preexistentes (AuthModal) |
| `npm run build` | OK, normal y playtest |
| Aislamiento de `dist` | §9 |
| Loop cueva → Dungeon → salir | verificado en navegador |
| Colisión de la cueva | verificada: el jugador rodea la roca |
| Reloj heredado del spawn | verificado: el panel abre con el tiempo restante |
| Layout móvil 375×812 | verificado y corregido |
| Performance móvil (WildLands, caminando) | frameMs 3,8 / 3,86 / 4,0 — presupuesto 16,7 |
| Centro Pokémon y Tienda | 12 tests de montaje, incluidos todos los rechazos |
| Pantalla del gate | 6 tests de montaje |

### Lo que NO se pudo probar en esta sesión

**Multijugador real de 2+ sesiones y chat de punta a punta.** Requiere dos
cuentas de Supabase con sesión iniciada, y crear cuentas o escribir contraseñas
no es algo que yo haga. La lógica de sala está cubierta por 41 tests del
servicio (incluido el scoping por área con tres clientes), pero **el ida y
vuelta por socket no se ejercitó en vivo**.

Está en la checklist de abajo como el primer ítem, y es el riesgo abierto más
grande del GO.

---

## 11. Checklist de stream

### Antes (30 min antes de abrir)

1. [ ] `git fetch --all --prune` y confirmar el HEAD de `playtest/community-0.1`.
2. [ ] Aplicar `20260919_001_playtest_gate.sql` (§4.2) — una sola vez.
3. [ ] Deploy con `VITE_PLAYTEST=on`.
4. [ ] Abrir la web: debe verse la **pantalla del gate** (la tabla nace CLOSED).
5. [ ] Confirmar que el servicio de realtime está arriba (`/health`).
6. [ ] **Con dos cuentas reales y dos navegadores**: entrar, verse, caminar,
       escribir en el chat, ver el mensaje del otro. *Si esto falla, NO-GO.*
7. [ ] Probar en un teléfono real: ciudad, WildLands, chat, Skills, Centro,
       Tienda, una cueva.
8. [ ] Centro Pokémon: curar, mover al equipo, intentar un séptimo.
9. [ ] Tienda: comprar un pico, comprar balls, quedarse sin fichas.
10. [ ] Entrar a una cueva, pelear, salir, comprobar que el equipo vuelve herido.
11. [ ] Probar el botón **Reportar bug** y pegar el resultado en algún lado.
12. [ ] Abrir el gate con el código del stream (§4.3) y decirlo al aire.

### Durante

**0–30 min — libertad total.** Que hagan lo que quieran. Mirar dónde se traban.

**30–90 min — exploración dirigida.** Pedirles que busquen cuevas, entren a una
Dungeon, suban una profesión, usen el chat.

**90–120 min — stress guiado.**

- [ ] Todos a la misma área a la vez.
- [ ] Todos refrescan a la vez.
- [ ] Spam de chat: mensajes largos, vacíos, emoji, `<b>hola</b>`.
- [ ] Dos personas entrando a la misma cueva.
- [ ] Party: llenar a 6, intentar 7, swaps rápidos.
- [ ] Tienda: doble click en comprar, gastar todo.
- [ ] Misma cuenta en dos pestañas.

### Después

1. [ ] **Cerrar el gate** (§4.4). Confirmar la pantalla de cerrado.
2. [ ] Guardar los reportes de bug pegados en el chat del stream.
3. [ ] Guardar el VOD / clips.
4. [ ] Ejecutar el shutdown (§12).

---

## 12. Shutdown (después del stream)

Nada de esto es urgente ni destructivo: el playtest no dejó datos.

1. **Cerrar el acceso** (§4.4). Es lo único que importa hacer rápido.
2. **Guardar los reportes.** Están en el chat del stream; no hay endpoint.
3. **Datos creados:** ninguno. Ninguna superficie del playtest escribe en
   Supabase. El progreso de skills, el party, las cajas, las fichas y el
   inventario vivían en la pestaña y ya no existen.
4. **Reset:** no hay nada que resetear. Un refresh ya era un reset.
5. **Volver a la build normal:** deploy sin `VITE_PLAYTEST` (o con otro valor).
6. **Opcional, `playtest_gate`:** dejarla es inofensivo (sin datos de jugador,
   sólo lectura pública, y una build normal ni la consulta). Si se quiere
   limpiar:
   ```sql
   DROP TABLE IF EXISTS playtest_gate;
   ```
   Con la tabla ausente una build de playtest ya no abre (se queda en la
   pantalla del gate), pero igual **conviene dropearla después de desplegar la
   build normal, no antes.**
7. **Verificar la web cerrada:** abrir en incógnito y confirmar que no se puede
   entrar.

---

## 13. Known issues y decisiones abiertas

1. **El multijugador de 2 sesiones no se probó en vivo** (§10). Primer ítem de
   la checklist.
2. **El Dungeon prototype es individual.** Dos jugadores en la misma cueva abren
   expediciones separadas. Es lo esperado del prototipo, no un bug, pero va a
   sorprender a alguien.
3. **Un refresh dentro de una Dungeon pierde la run.** No hay persistencia; el
   panel lo dice.
4. **Las fichas no se ganan.** Quien gaste mal se queda sin comprar más. Es
   deliberado (no hay economía), pero es una frustración posible.
5. **El requisito de profesión en los obstáculos de Dungeon es informativo**, no
   bloqueante (I-4 del registro de integración). Un jugador con Minería 1 puede
   despejar un bloque que dice "Minería Nv. 20".
6. **`condo` sigue copiándose a `dist` sin pedirse** (58 KB) — pregunta abierta
   heredada de la consolidación pre-R34.
7. **La captura en Dungeon no sale de la Dungeon.** Correcto y deliberado (§7.4),
   y probablemente decepcione a quien capture algo bueno. Conviene decirlo al
   aire.

---

## 14. Qué NO se hizo

R34 · autoridad final de Dungeon · persistencia R35 · coop · economía definitiva
· Construction · arquitectura final de workers · casas · tiendas de jugador ·
Centro Pokémon económico · market P2P · monetización · pagos · modelos 3D nuevos
· placed trees productivos · ciudades nuevas · ramas de la estación secundaria.

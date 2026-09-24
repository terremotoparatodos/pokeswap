# PERF-1 — Pruebas físicas (PC real, iPhone 15 Pro, dos jugadores)

Todo corre en tu PC contra un servidor **local**: no toca producción ni tu cuenta. Cada ventana entra como un jugador de prueba (no hace falta iniciar sesión). Usamos el build **playtest** (igual al de producción) en el puerto **4174**: cada vez que abras una URL te va a pedir el **código de acceso de siempre**.

Cuando una prueba termina, el resultado se guarda solo en la PC, en `docs/performance/baselines/incoming/`. **No tenés que mandarme archivos**: al final escribime "listo" con tus notas (§5) y yo los leo desde esa carpeta.

---

## 0. Preparación (5 minutos, una sola vez)

1. En la PC abrí una terminal en `C:\Users\Rodri\Proyectos\pokeswap` y corré:

   ```bash
   git fetch origin && git switch perf/1-instrumentation && git pull
   ```

2. Arrancá el entorno de prueba (dejalo abierto hasta terminar todo):

   ```bash
   node scripts/perf/local-stack.mjs
   ```

3. Esperá hasta ver estas líneas (tarda ~20 s):

   ```text
   [perf] realtime  ws://192.168.1.6:2568 ...
   [perf] playtest  http://192.168.1.6:4174/?benchmarkId=pc-a
   ```

   Si la IP no es `192.168.1.6`, usá la que aparezca en todas las URLs de abajo.
4. Si Windows pregunta por el firewall de **Node.js**, marcá **redes privadas** y aceptá (el iPhone lo necesita).
5. Anotá la frecuencia de tu monitor: Configuración → Pantalla → Pantalla avanzada → "Frecuencia de actualización".
6. En el iPhone: misma red Wi-Fi que la PC, **Modo Bajo Consumo apagado**, Safari.

En la pantalla del juego vas a ver abajo a la izquierda un panel oscuro **PERF-1** con los botones **Iniciar / Detener**, **Enviar a PC** y **Descargar**. En las pruebas automáticas no tocás nada: arrancan y se envían solas.

Para terminar todo: en la terminal, **Ctrl+C**.

---

## 1. PC sola (≈ 6 minutos)

Chrome, **una sola pestaña**, pantalla completa (**F11**). No muevas el mouse ni el teclado durante las pruebas automáticas.

| # | Abrí esta URL | Qué hacés | Dura | Se guarda como |
|---|---|---|---|---|
| PC-1 SOLO | `http://192.168.1.6:4174/?benchmarkId=pc-a&area=pradera&x=-5&y=-69&perfScenario=pradera-line&perfLabel=pc-solo` | Escribís el código y **soltás todo**. El personaje recorre Pradera solo, caminando y corriendo. El panel dice "Guardado en la PC". | ~75 s | `…-pc-solo-pradera-line.json` |
| PC-2 CIUDAD | `http://192.168.1.6:4174/?benchmarkId=pc-a&x=31&y=20&perfScenario=city-loop&perfLabel=pc-city` | Igual: código y soltar. Da dos vueltas por la ciudad. | ~60 s | `…-pc-city-city-loop.json` |
| PC-3 TRAVERSAL | `http://192.168.1.6:4174/?benchmarkId=pc-a&x=31&y=20&perfScenario=traversal&perfLabel=pc-traversal` | Igual. Va y vuelve a Pradera 3 veces por el portón oeste. **Mirá los cambios de área**: ¿se nota un tirón al aparecer en Pradera? | ~2 min | `…-pc-traversal-traversal.json` |
| PC-4 A MANO | `http://192.168.1.6:4174/?benchmarkId=pc-a&x=31&y=20&perfLabel=pc-manual` | Código → **Iniciar** en el panel → jugá 60 s por la ciudad con flechas/WASD: caminá, mantené Shift para correr, **soltá y apretá Shift sin frenar** varias veces, girá seguido → **Detener** → **Enviar a PC**. Prestá atención a la cámara: ¿se mueve pareja o "a saltitos"? | ~1,5 min | `…-pc-manual-manual.json` |

Si tu monitor es de más de 60 Hz, repetí **PC-2** con el monitor puesto a 60 Hz (misma pantalla de configuración) cambiando al final de la URL `perfLabel=pc-city` por `perfLabel=pc-city-60hz`. Después volvé a tu frecuencia normal.

---

## 2. iPhone 15 Pro solo (≈ 6 minutos)

Safari, vertical, sin zoom. Tras escribir el código, **no toques la pantalla** durante las pruebas automáticas.

| # | Abrí en Safari | Qué hacés | Dura | Se guarda como |
|---|---|---|---|---|
| IP-1 SOLO | `http://192.168.1.6:4174/?benchmarkId=ip-a&area=pradera&x=-5&y=-69&perfScenario=pradera-line&perfLabel=iphone-solo` | Código y soltar. Esperá "Guardado en la PC". | ~75 s | `…-iphone-solo-pradera-line.json` |
| IP-2 CIUDAD | `http://192.168.1.6:4174/?benchmarkId=ip-a&x=31&y=20&perfScenario=city-loop&perfLabel=iphone-city` | Igual. | ~60 s | `…-iphone-city-city-loop.json` |
| IP-3 TRAVERSAL | `http://192.168.1.6:4174/?benchmarkId=ip-a&x=31&y=20&perfScenario=traversal&perfLabel=iphone-traversal` | Igual. Mirá los cambios de área. | ~2 min | `…-iphone-traversal-traversal.json` |
| IP-4 A 60 Hz | Ajustes → Accesibilidad → Movimiento → **Limitar frecuencia de cuadros: activado**. Repetí IP-2 cambiando `perfLabel=iphone-city` por `perfLabel=iphone-city-60hz`. Después **desactivalo**. | ~1,5 min | `…-iphone-city-60hz-city-loop.json` |

Además, en IP-1, anotá cuánto tarda desde que escribís el código hasta que ves el mundo (carga inicial).

Si el panel dice "No se pudo enviar", tocá **Descargar** y mandame el archivo por AirDrop a la PC.

---

## 3. Dos jugadores lado a lado (la prueba más importante, ≈ 12 minutos)

**A = el que se mueve** (PC con teclado; el iPhone no puede correr con toques).
**B = el que mira** (segunda ventana de Chrome **o** el iPhone).

Poné las dos pantallas una al lado de la otra. Si podés, **filmá las dos pantallas con otro celular en cámara lenta** mientras hacés 3.1: es la mejor forma de ver saltos cuadro a cuadro.

### Opción PC + PC

- Ventana **A**: `http://192.168.1.6:4174/?benchmarkId=duo-a&x=31&y=20&perfLabel=duo-a`
- Ventana **B** (otra ventana de Chrome, no otra pestaña): `http://192.168.1.6:4174/?benchmarkId=duo-b&x=31&y=21&perfLabel=duo-b`

### Opción PC + iPhone

- **A** en la PC: la misma URL de A.
- **B** en el iPhone: `http://192.168.1.6:4174/?benchmarkId=duo-ip&x=31&y=21&perfLabel=duo-iphone`

En las dos: escribí el código. Tenés que ver al otro personaje al lado. En **B** tocá **Iniciar** y **no toques más B** hasta el final. En **A** también tocá **Iniciar**.

### 3.1 Guion para A (≈ 3 minutos, 10–15 s por paso)

Mirá **B** mientras lo hacés (o filmalo):

1. **Caminar recto**: 10 casillas a la derecha. Frená.
2. **Correr recto**: mantené Shift, 10 casillas a la izquierda. Frená.
3. **Caminar → correr sin frenar**: caminá hacia abajo y, a mitad de camino, apretá Shift sin soltar la flecha.
4. **Correr → caminar sin frenar**: corré hacia arriba y, a mitad de camino, soltá Shift sin soltar la flecha.
5. **Correr → frenar de golpe**: corré y soltá todo de repente. Repetilo 3 veces.
6. **Zig-zag**: con Shift, alterná derecha/abajo casilla por casilla 10 veces.
7. **Cambios bruscos**: corré derecha e inmediatamente izquierda, 4 veces.
8. **Salir y volver del rango**: corré en línea recta **lejos** de B hasta que B deje de verte (unas 20 casillas), esperá 3 s, volvé. Hacelo 2 veces.
9. **Traversal juntos**: con B también moviéndose detrás tuyo (si B es la PC, alternás las ventanas), entrá a Pradera por el portón oeste y volvé. Si B no puede seguirte, simplemente cruzá vos y volvé.

Al terminar: en **B**, **Detener** → **Enviar a PC**. En **A**, **Detener** → **Enviar a PC**.

### 3.2 Mismo mundo (≈ 2 minutos)

1. Con A y B juntos en el centro de la ciudad, **sacá una captura de cada pantalla** (Win+Shift+S en la PC; botón lateral + subir volumen en el iPhone).
2. Llevá a **los dos** a Pradera por el portón oeste y quedate parado junto al otro 20 s. **Captura de cada pantalla.**
3. Anotá: ¿ven los mismos Pokémon en el mismo lugar? ¿Los NPC? ¿La misma hora del día y el mismo clima?

---

## 4. Checklist de lo que se genera

Al terminar, en `docs/performance/baselines/incoming/` tiene que haber estos archivos (con fecha delante):

- PC: `pc-solo`, `pc-city`, `pc-traversal`, `pc-manual` (+ `pc-city-60hz` si aplica).
- iPhone: `iphone-solo`, `iphone-city`, `iphone-traversal`, `iphone-city-60hz`.
- Dos jugadores: `duo-a` y `duo-b` o `duo-iphone`.

Las capturas de pantalla y el video (si hiciste) dejalos en esa misma carpeta, o decime dónde están.

---

## 5. Qué me mandás después

Un mensaje con "listo" y estas respuestas (una línea cada una alcanza):

1. Frecuencia del monitor y si la prueba a 60 Hz se hizo.
2. PC sola: ¿notaste microtirones? ¿La cámara se mueve pareja? ¿Tirón al cambiar de área?
3. iPhone: ¿se siente fluido? ¿Cuánto tardó la carga inicial? ¿Tirón al cambiar de área? ¿Algún sprite raro?
4. Dos jugadores, desde B, en cada paso del guion (1–9): ¿se vio fluido, con saltos, con frenadas o con retraso notorio?
5. ¿Algún sprite remoto desapareció, parpadeó o cambió de aspecto? ¿En qué paso?
6. Mismo mundo: ¿Pokémon, NPC, hora y clima iguales o distintos?
7. Cualquier otra cosa rara.

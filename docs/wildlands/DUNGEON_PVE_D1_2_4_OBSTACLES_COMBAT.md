# D1.2.4 — Obstáculos, Poké Ball, acceso al boss y arreglos de combate

Estación secundaria. Rama `feat/d1-2-4-obstacles-combat`, base `646d6db` (D1.2.3).
Prototipo únicamente: nada de esto toca producción, WildLands, profesiones,
networking ni persistencia. El laboratorio sigue viviendo en `/dev/dungeon` y no
entra en `dist`.

Cinco pedidos, en el orden en que llegaron.

---

## 1 y 4 · Obstáculos que necesitan una skill para pasar

> «Hay partes de la dungeon que no puedo avanzar, esto está genial. Ya que
> podemos poner rocas, cristales, madera o algo que impida el paso y necesite
> skills para poder avanzar.»
> «Deberías dejarme minar/talar dentro del dungeon sólo para estas ocasiones
> especiales. No es para farmear recursos, sino para pasar obstáculos.»

`domain/obstacles.ts` (nuevo, puro y determinista a partir de la semilla).

Un obstáculo **no es una piedra suelta: es una barrera**. Las rutas de esta
dungeon tienen cuatro y cinco tiles de ancho desde D1.2.1, así que un único tile
bloqueado se esquiva sin darse cuenta. `barrierAcross` toma la garganta de una
galería y devuelve la línea completa de pared a pared (máximo `MAX_BARRIER = 6`
tiles); los tiles de una barrera se despejan juntos.

Reglas que garantiza `placeObstacles` y que están cubiertas por tests:

- **Nunca cierra el piso.** Con todas las barreras puestas, la salida sigue
  siendo alcanzable desde la entrada, y entre todas no encierran más del 30 % del
  suelo.
- **Cada una bloquea algo por sí sola.** Se evalúa aislada: si el piso pierde
  sólo los tiles que ella misma ocupa, se descarta. Una barrera redundante sería
  decorado que se rodea.
- **Nunca pisa la entrada ni la escalera.**
- **Se separan entre sí** (6 tiles entre centros), para que dos no se lean como
  un único muro largo.
- **Coherencia de bioma**: cueva/volcán rompen roca y cristal, bosque corta
  raíces y madera, glaciar nunca tiene raíces.

Cobertura de aparición: sobre 360 pisos (120 semillas × 3 pisos), **359 reciben
las cuatro barreras**. El criterio anterior, de un solo tile, dejaba 213 pisos
sin ningún obstáculo.

Minar y talar existen aquí **sólo para esto**: `clearObstacle` abre el paso y no
entrega absolutamente nada. No hay botín, no hay XP, no hay recurso. Las
profesiones no se tocaron.

La escena también conoce las barreras (`DungeonWorld.setSealed`), así que el
tap-to-move nunca rutea a través de una y las teclas nunca meten al jugador
encima. Tocar una barrera te lleva a su lado, que es donde aparece el CTA
(`⛏ Veta de cristal`, `🪓 Raíces`, …).

## 2 · La animación de la Poké Ball

> «Necesito que el pokémon salvaje entre en la pokebola, que solo quede el
> sprite de la pokebola girando. Si se queda, la pokebola queda fija un segundo
> con el efecto con brillo de captura, sino el pokémon se sale con la animación
> del rayo rojo.»

La secuencia es dueña del reloj: mientras `battle.throw` existe, ninguna barra
avanza, ningún estado tickea, nada se resuelve. Fases y tiempos
(`BALL_TIMING`, parámetros de playtest):

| Fase | Duración | Qué se ve |
| --- | --- | --- |
| `ball` | 0,7 s | la bola vuela hacia el rival |
| `swallow` | 0,3 s | el Pokémon entra; **desde acá sólo queda la bola** |
| `shake` × N | 0,95 s c/u | la bola se sacude, 0 a 3 veces |
| `held` | 0,85 s | captura: la bola queda fija con el brillo |
| `breakout` | 0,85 s | fallo: rayo rojo y el Pokémon vuelve |

(Los tiempos son los de D1.2.4bis §3, que alargó la secuencia.)

El rival y su barra se ocultan mientras la bola está en el aire, que es lo que
hacía falta para que «sólo quede el sprite de la pokebola girando».

Verificado en vivo: un escape resolvió `sh0 | captured=false` y el
combate siguió; una captura resolvió `sh3 | captured=true` y terminó el combate
ahí mismo, con el reloj congelado durante todo el lanzamiento.

## 3 · Acceso rápido al boss

> «Todavía no llegué a ver ningún boss, podrías darme un acceso rápido?»

DEV TOOLS → **Escenario → Boss ya**: salta al último piso, abre la antecámara y
arranca la pelea contra el Alpha en un paso.

Hizo falta algo más para que sirviera: la Boss Room deja al Alpha trece tiles por
delante del entrenador, más de lo que la lente `handheld` puede sostener, así que
encuadrada en el entrenador **el boss quedaba fuera de pantalla**. `cameraTarget()`
mira el punto medio entre el entrenador y el Alpha **sólo** mientras la pelea está
montada (`bossFraming`); la exploración conserva intacta la regla de cámara de
WildLands. Ahora entran en un mismo cuadro el Alpha, los dos Pokémon propios y el
entrenador.

## 5 · Combate

> «Necesito que siempre el pokémon ataque su primer movimiento o el siguiente por
> defecto si no tiene PP … Si se queda sin PP usará el movimiento Combate …
> al cambiar de pokémon se bugea … un log de combate más amigable … aumentá un
> 50 % el cooldown.»

- **Nunca se traba.** `resolveChoice` elige el primer movimiento con PP; si no
  queda ninguno, usa **Combate** (Struggle): 50 de potencia normal y un cuarto de
  la vida máxima propia como retroceso. No se puede elegir a mano ni aparece
  entre los cuatro.
- **El cambio andaba mal por dos motivos distintos, los dos arreglados.** En el
  motor, `executeSwitch` conservaba la especie saliente (ahora entra por
  `speciesFor`); y la acción de cambio no se limpiaba, así que cada ventana
  siguiente repetía el cambio en lugar de atacar — por eso «el pokémon entrante
  no combate bien». En la UI, el panel cacheaba los movimientos del Pokémon
  anterior (token `rev`).
- **Log amigable.** El panel muestra nombre, HP y estado de los dos lados con sus
  barras, reescribe cada línea en castellano llano («El rival bloqueó el ataque
  con Protección.») y cierra con **Cambiar | Huir | Mochila**. Huir aborta el
  combate y deja al Pokémon en el piso.
- **+50 % de cooldown** en todo: la barra de acción pasó de `base 2.6 / min 1.4 /
  max 4` a `base 3.9 / min 2.1 / max 6` segundos. Parámetro de playtest, marcado
  como tal en `damage.ts`.

---

## Estado

- 1087 tests en 104 archivos, verdes.
- `vue-tsc --noEmit -p tsconfig.app.json` limpio.
- `eslint .` sin errores (9 warnings preexistentes en `AuthModal.vue`).
- `vite build` OK; `dist/` no contiene el prototipo.

## Lo que sigue abierto

- El arte de `rockfall` y `crystal` se distingue poco a escala de juego.
- El CTA de obstáculo se superpone al botón CORRER en pantallas angostas.
- Minar/talar es instantáneo: `OBSTACLES[kind].seconds` está definido pero
  todavía no se consume como tiempo de trabajo.

---

# D1.2.4bis — Cuatro ajustes del playtest

## 1 · Las rocas y cristales que ya estaban también se rompen

> «Hay lugares todavía inaccesibles por culpa de los diamantes o rocas normales.
> Yo me refería a poder hacerlo con los recursos que andan dando vuelta.»

Correcto, y era la mitad que faltaba: las barreras nuevas se podían picar, pero
el peñasco o la formación de cristal que ya estaba puesta seguía siendo un muro
sin respuesta. Ahora **todo prop sólido parado sobre suelo** se despeja con la
herramienta que le corresponde: pico para roca, peñasco, cristal y hielo; hacha
para árbol, pino y matorral.

Un prop dibujado contra la pared **no** se ofrece: el tile de abajo es roca y
romperlo no abriría nada. Ese filtro bajó la lista de 170 a 49 por piso, que son
exactamente los que estorban de verdad.

Al despejar uno, el prop deja de bloquear, deja de dibujarse y el suelo se
hornea otra vez, así que no queda sombra. Sigue sin dar nada: ni botín, ni XP,
ni recurso. Las profesiones no se tocaron.

## 2 · La pelea del boss, a distancia corta

> «Me gustaría estar más cerca del boss. 2 tiles de distancia los pokes y el
> entrenador a 3 de los pokémon.»

Los slots de la Boss Room se reanclan al Alpha en vez de a la puerta: los
Pokémon a **2 tiles** del Alpha, el entrenador **3** detrás de ellos. Los slots
centrales se llenan primero, que es lo que ve una run en solitario. Antes había
9 y 4 tiles respectivamente, con el Alpha fuera de pantalla.

## 3 · La Poké Ball, con tiempo

> «Que pueda girar hasta 3 veces como el juego original, dura muy poco. Dale más
> vida.»

Vuelo 0,45 → **0,7 s**; cada sacudida 0,55 → **0,95 s**; veredicto 0,5 → **0,85
s**. Tres sacudidas ahora son **4,4 s** medidos en vivo.

Y la sacudida cambió de forma: el tirón ocurre en el primer 45 % del beat —
inclinación, saltito, chispa — y el resto la bola queda quieta. Esa espera es
la que hace que se sientan tres. La captura suma un segundo anillo, más ceñido,
justo al final: el clic.

## 4 · La interfaz de combate

> «Dale más diseño a la interfaz de combate. Sorpréndeme con íconos.»

`CombatIcon.vue` (nuevo): quince íconos dibujados como paths sobre una grilla
24×24, trazados con `currentColor` para que hereden el color de lo que los
rodea. Son propios: no hay fuente de íconos ni asset de terceros que atribuir.

Qué cambió en el panel:

- **Cada bando en su tarjeta**, con chips de tipo coloreados con la paleta de
  tipos del prototipo y la barra de HP que pasa de verde a ámbar a rojo.
- **Los estados son chips con su propio ícono y color**: quemado, paralizado,
  envenenado, congelado, dormido.
- **Los movimientos llevan su tipo como color** (borde izquierdo y fondo
  teñido) y **su categoría como ícono**: puño para físico, estallido para
  especial, espiral para estado. El PP es número y barrita.
- **El log tiene el ícono de lo que pasó**: escudo si bloqueó, bola si hubo
  lanzamiento, calavera si alguien cayó, corazón si se curó.
- **El pie es Cambiar | Huir | Mochila con íconos**, y la mochila y el banquillo
  también los usan en cada fila.

A 375 px los chips de tipo se ocultan y el resto se mantiene legible.

## Estado

- 1108 tests en 104 archivos, verdes.
- Typecheck limpio, `eslint .` sin errores (9 warnings preexistentes).
- `vite build` OK; el prototipo sigue fuera de `dist`.

---

# D1.2.4ter — Niveles, caminos opcionales, salida del boss y avisos

## 1 · Qué nivel de profesión pide cada cosa

Cada cosa que bloquea dice qué profesión y qué nivel pide, y el HUD del piso
resume lo más exigente que hay en él (`⛏ Minería Nv. 20`).

Los números **no son inventados**: son los del catálogo de recolección de
producción, material por material — roca Nv. 1, carbón Nv. 5, hierro Nv. 15,
cristal Nv. 20, oro Nv. 30; árbol común Nv. 1, pino Nv. 8, madera dura Nv. 15.

El prototipo **no importa** ese catálogo: R31 mantiene profesiones aislado y hay
un test que lo verifica, así que los valores están copiados en `QUOTED_NODES` con
su `nodeId`. Lo que evita que la copia se pudra es un test —los tests sí pueden
leer el catálogo real— que compara nivel, tier de herramienta, profesión y
anclajes de cada entrada y falla el día que difieran.

## 2 · Caminos opcionales, y siempre poder retirarte

El generador ahora cava **recovecos**: una boca de **un solo tile** en la pared
junto a una sala, una garganta corta y una cámara pequeña detrás. Se cavan al
final, sobre roca maciza y con un borde de roca alrededor, así que nunca forman
parte del camino a la escalera: son un desvío, no la ruta.

Cada boca lleva un bloque. Caminás, llegás, no pasás — y volvés cuando tengas la
herramienta. Cobertura: **630 pisos generados, todos con 2 o 3 recovecos**, y
cero fugas (sellar la boca aísla exactamente lo de atrás y deja la escalera
alcanzable).

Retirada: el botón **Retirarse** ya estaba en exploración; ahora también hay
salida en la sala del Alpha (§3). Y al medir esto apareció un bug anterior: en
**6 de 2520 pisos la escalera no era alcanzable** desde la entrada — un piso sin
salida salvo abandonar la expedición. La causa era que los puntos de entrada y
escalera se eligen después de la reparación de conectividad. `reachStairs` es la
última palabra: si la escalera no se alcanza, cava una galería hasta ella, con
puente si hay un lago en el medio. Ahora son **0 de 2520**, con test de barrido.

## 3 · Cómo se sale de la sala del boss

Antes no se salía: entrar al Alpha era terminal, y huir del combate daba la
expedición por terminada. Ahora la sala tiene puerta:

- **↩ Salir de la sala** (o *Huir* en el panel) devuelve a la antecámara, frente
  a la puerta, **sin terminar la expedición**. Se puede revisar el equipo y
  volver a entrar por el CTA `⇩ Antecámara del Alpha`.
- **⇤ Abandonar la Dungeon** cierra la expedición asegurando botín y capturas.
- Ganarle al Alpha sigue terminando la run, como estaba.

## 4 · Las barreras, fuera

Las barreras de pared a pared de D1.2.4 se eliminaron. Lo que bloquea ahora es
siempre **un box**: el bloque en la boca de un recoveco, o el peñasco, cristal,
árbol o roca que ya estaba en el suelo. Sin muros que se evaporan de un golpe.

## 5 · Avisos de captura y de fin de combate

Un cartel breve sobre la escena dice qué pasó, con su ícono, y se va solo a los
2,6 s:

| Resultado | Cartel |
| --- | --- |
| Captura | **¡{Pokémon} capturado!** · Queda en el botín hasta que salgas. |
| Victoria | **Combate ganado** · {Pokémon} ya no puede seguir. |
| Victoria del Alpha | **¡Alpha derrotado!** · La expedición termina acá. |
| Huida | **Te escapaste** · {Pokémon} sigue en el piso. |
| Salir del boss | **Saliste de la sala** · La puerta del Alpha sigue abierta. |
| Derrota | **Combate perdido** · Tu equipo no pudo con esto. |

De paso, el log traduce los cambios de estadística, que salían crudos
(«Gruñido: -1 attack» → «El rival usó Gruñido y le bajó el ataque a tu Pokémon»).

## Estado

- 1122 tests en 104 archivos, verdes.
- Typecheck limpio, `eslint .` sin errores (9 warnings preexistentes).
- `vite build` OK; el prototipo sigue fuera de `dist`.

## Verificado en vivo

Bloque de un tile con su CTA `⛏ Derrumbe · Minería Nv. 1` y el HUD marcando
`Minería Nv. 5`; al romperlo el recoveco quedó abierto. Entrada al Alpha, salida
con **Salir de la sala** de vuelta al corredor con la puerta abierta, y el cartel
correspondiente. Cartel de victoria tras un combate normal. El cartel de captura
usa el mismo camino y está cubierto por código y tests, pero no llegué a verlo en
pantalla en esta pasada.

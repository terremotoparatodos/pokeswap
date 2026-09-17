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
| `ball` | 0,45 s | la bola vuela hacia el rival |
| `swallow` | 0,3 s | el Pokémon entra; **desde acá sólo queda la bola** |
| `shake` × N | 0,55 s c/u | la bola se sacude, 0 a 3 veces |
| `held` | 0,5 s | captura: la bola queda fija con el brillo |
| `breakout` | 0,5 s | fallo: rayo rojo y el Pokémon vuelve |

El rival y su barra se ocultan mientras la bola está en el aire, que es lo que
hacía falta para que «sólo quede el sprite de la pokebola girando».

Verificado en vivo: un escape resolvió `sh0 | captured=false` en 0,95 s y el
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

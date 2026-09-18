# R30 · F-2 — Tocar un prop alto selecciona el prop

> Rama: `fix/wildlands-prop-tap-picking`, desde `origin/main` @ `7e474c62bb964391e4ada74e832d99695a5858aa`.
> **Sin PR y sin merge.** No toca R31, profesiones, Dungeon ni backend.

## 1. Causa raíz

`Renderer.pick()` resolvía un toque en dos pasos: primero contra los rectángulos de pantalla que el renderer guarda mientras dibuja, y si no había ninguno, desproyectando el píxel contra el plano de suelo.

Esos rectángulos **solo se registraban para actores**: en `drawSprites()` la condición era `if (d.actor && this.frame)`. El decorado del mundo —árboles, rocas, arbustos, cactus, palmeras, cristales— se dibuja como sprite vertical sobre un suelo inclinado, así que **tapa el suelo que tiene detrás**, pero no participaba del picking.

Consecuencia: tocar la copa de un árbol desproyectaba ese píxel y devolvía el tile **detrás** del árbol. Como ese tile es caminable, el navegador caminaba hasta él y el jugador terminaba del otro lado, sin interacción. Los edificios del pueblo ya lo tenían resuelto por su cuenta, con `doorForTap` y su footprint.

Medido en el motor real (Pradera, cámara por defecto): sobre los 54 props visibles, **109 puntos dentro del arte dibujado** resolvían a un tile distinto del prop, hasta dos filas más al norte.

## 2. Alcance del fix

Tres archivos, todos del motor:

| Archivo | Qué |
|---|---|
| `engine/picking.ts` (nuevo) | Geometría y decisión, puras: `spriteRect`, `hitTest`, `resolvePick` |
| `engine/picking.test.ts` (nuevo) | 19 tests |
| `engine/renderer.ts` | Registra el rect de cada prop que dibuja y delega `pick()` en el módulo |

**No** se tocó: solidez, colisión, `Area.isSolid`, pathfinding, `TapNavigator`, reglas de interacción, `SceneOverlay`, F-1, spawn, realtime, persistencia, assets ni profesiones.

## 3. Geometría y política adoptadas

- **El rect es el arte dibujado.** Desde la primera fila opaca del sprite (`sprite.top`) hasta la línea de pies, con el ancho del sprite, todo en píxeles de dispositivo y con la escala con la que se dibujó. Nada de cajas infladas: **sin padding** para props, así que el suelo alrededor se sigue tocando igual.
- **Los actores conservan su padding** de 8 px por dedo y **su prioridad**: si un actor y un prop comparten el punto, gana el actor, como antes. Dentro de cada grupo gana el de adelante (el último dibujado).
- **Solo props salvajes.** Se registran los `DecorInstance` con `kind`; los edificios y farolas del pueblo traen su propio `sprite` y siguen resolviéndose por `doorForTap`.
- **Un prop responde con su propio tile.** `pick()` no inventa interacción: devuelve el tile del prop y quien consume decide. Si el tile es sólido, el navegador ya planifica hasta un vecino, así que tocar un árbol camina **al lado** del árbol.
- **El suelo sigue siendo suelo:** si el punto no cae en ningún rect, se desproyecta como siempre.

## 4. Casos cubiertos

**Tests** (`picking.test.ts`, con el proyector real):

- árbol, roca y arbusto: toque en la base y sobre su arte (50 % y 90 % de su altura dibujada);
- árbol a 20 px y a 30 px, con el suelo una y dos filas detrás;
- dos escalas de cámara distintas;
- cielo sobre una roca baja: sigue siendo suelo;
- suelo libre al costado y por debajo de un prop;
- dos props superpuestos: gana el de adelante;
- actor sobre un prop: gana el actor; actor al costado: gana el prop;
- actor responde con su propio tile, como siempre;
- **antes/después:** sin rects de prop (el estado anterior), el mismo toque devuelve el tile de atrás; con ellos, devuelve el árbol.

**Pasada manual en el motor real** (Pradera, dev server local, escritorio y 375 px):

| Comprobación | Resultado |
|---|---|
| Props registrados por cuadro | 54 en escritorio, 77 a 375 px |
| Puntos sobre arte de prop que antes caían en el tile de atrás | **109** en escritorio, **125** a 375 px |
| De esos, cuántos resuelven ahora a un prop | **109 / 109** y **125 / 125** |
| Reparto en escritorio | 74 al prop propio, 35 al prop de adelante que efectivamente cubre ese píxel |
| Suelo libre (288 puntos al azar fuera de todo rect) | **288 / 288** idénticos a la desproyección de suelo |
| Tocar un árbol sólido a 3 tiles | `pick` devuelve el tile del árbol; el navegador planifica una ruta de 2 pasos **hasta el costado** |
| 375 px | dpr 2, sin scroll horizontal, mismo sistema de coordenadas |

## 5. Limitaciones conocidas

- **Sigue siendo un rectángulo, no la silueta.** Una esquina transparente del sprite responde por el prop. Es el mismo criterio que ya usaban los actores.
- **Props que se superponen:** el de adelante gana aunque el dedo apunte a la copa del de atrás. Es lo que se ve en pantalla, y es coherente con el orden de dibujo.
- **Edificios sin cambios:** siguen resolviéndose por footprint y `doorForTap`.
- **No cambia la solidez** (F-1 sigue abierto), ni el pathfinding, ni qué props son interactuables: un árbol sin interacción sigue sin tenerla, solo que ahora el toque apunta a él y no al suelo de atrás.
- El auto-pickup del cúmulo cristalino al caminar por encima es otro asunto, ajeno a este fix.

## 6. Verificación

| Check | Resultado |
|---|---|
| `npx vitest run` | 58 archivos / **406 tests** verdes |
| `npm run typecheck` | exit 0 |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npx eslint .` | 0 errores (9 warnings previos de `AuthModal.vue`) |
| `npm run build` | OK |

**R31 no se ve afectada:** esta rama no contiene ni toca `src/features/professions/**`, y el arnés de la traza congelada no importa el motor, por regla de aislamiento. La previsualización de merge contra `origin/integration/r31` no da conflictos.

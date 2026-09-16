# R31-C4 — Dirección de arte de Alquimia

> Rama: `feat/r31c4-alchemy-visual-design` (hija de `feat/r31c3-logging-visual-design` @ 9b587e6). **No mergeada.**
> Implementación: `art/alchemyPalette.ts`, `art/alchemyStation.ts`, `art/alchemyItems.ts`, `art/alchemyFx.ts`, `art/alchemyAssets.ts`.
> Fases previas: [Minería](R31C1_HANDOFF.md) · [Pesca](R31C2_HANDOFF.md) · [Tala](R31C3_HANDOFF.md)

## 1. El problema propio de Alquimia

Las tres profesiones anteriores **señalan algo que el mundo ya tiene**: una roca con vetas, un agua más honda, un árbol con cinta. Alquimia no tiene nodo que marcar: es la primera que **fabrica**. Su problema es el opuesto —

> **¿Cómo se ve "transformar" en un mundo donde hasta ahora todo era "extraer"?**

Y uno secundario, igual de importante: la interfaz de crafteo de R31-B era correcta pero **parecía un formulario administrativo**. Alquimia tenía que dejar de ser una tabla y volverse un lugar.

## 2. La decisión central: el color lo pone el producto

La mesa es de la misma madera que los árboles, el vidrio es casi incoloro y el hornillo usa los metales del pico. **Lo único que tiene color propio es el líquido**, y el líquido es el producto:

| Producto | Líquido | Lectura |
|---|---|---|
| Poción | rosa `#d2436b` | cura PS |
| Superpoción | ámbar `#e08a1e` | cura más |
| Hiperpoción | violeta `#9c34c0` | cura mucho |
| Éter | azur `#2b8fb8` | restaura PP |
| Revivir | oro `#e3c034` | trae de vuelta |
| Té de Vigor | verde oliva `#88ad2a` | preparación menor |
| Extracto Herbal | verde profundo `#2c8a4a` | insumo intermedio |

El mismo color pinta **el ícono, el matraz de la mesa y las burbujas** mientras hierve. El jugador aprende una vez que "rosa = poción" y después reconoce desde lejos qué se está preparando. Es el equivalente de la cinta roja de Tala: un solo código, repetido en todos lados.

## 3. La estación

`alchemyStationArt(state, liquid, frame)` — 34×30, ancla a los pies como cualquier prop del mundo.

| Pieza | Por qué está |
|---|---|
| Tablón y patas | Es carpintería del mundo (`TRUNK_TONES`), no un mueble mágico |
| Rejilla de frascos vacíos | Muestra el stock: se entiende que de acá salen los productos |
| Mortero y mano | Dice "preparación" sin ser pico, hacha ni caña |
| Hornillo de latón | Comparte metales con los picos (`TOOL_HEAD_TONES`) |
| **Matraz sobre el fuego** | **Donde se lee toda la profesión** |

| Estado | Señal |
|---|---|
| `idle` | Matraz vacío, hornillo apagado |
| `ready` (jugador al lado) | La mesa se aclara un 14 % + burbuja con matraz sobre la copa |
| `brewing` | Llama encendida, matraz con el color del producto, burbujas que suben |
| `done` | Frasco tapado con corcho y un destello |

La llama se pinta **después** del vidrio: dibujada antes, el matraz la tapaba (lo detectó un test).

## 4. Animación: la ceremonia y el lote

El proceso tiene cinco tiempos (`alchemy/brewTimeline.ts`):

```text
cargar → calentar → hervir → embotellar → recompensa
```

- **Cargar (420 ms):** una gota por ingrediente cae al matraz y el líquido sube.
- **Calentar (380 ms):** se enciende el hornillo, empieza a moverse.
- **Hervir (0,9 a 2,6 s):** burbujas del color del producto y un hilo de vapor. **Es el único tramo que estira el tiempo real de la receta**, para que una receta lenta se sienta lenta sin castigar la vista.
- **Embotellar (220 ms por unidad, máximo 6 pulsos):** el matraz se vacía mientras los frascos se llenan.
- **Recompensa (900 ms):** destellos, íconos que suben, "+N" y "+XP".

**Un lote no repite la ceremonia N veces.** A cantidad 20 eso sería insoportable: la preparación ocurre una vez y **solo el embotellado se repite**, con un tope de 6 pulsos. Un lote de 100 termina en pocos segundos y el resultado igual cuenta las 100 unidades.

## 5. VFX propios

Contra los trozos duros de Minería, el chapoteo de Pesca y las astillas de Tala, Alquimia es **blanda**: nada mayor a 6×6 píxeles, nada que dure más de un segundo.

| Efecto | Uso |
|---|---|
| Burbuja (2 cuadros: llena y anillo al reventar) | Sube del matraz mientras hierve; toma el color del producto |
| Vapor (3 cuadros que crecen y se disuelven) | Sale del matraz al calentar |
| Gota | Ingrediente que entra y producto que se embotella |
| Destello (2 intensidades) | Lote terminado; el fuerte marca el insumo que ahorró el Pokémon |

Tope de 28 partículas simultáneas, por debajo de los 40 de Minería: el hervor es continuo y no debe acumular.

## 6. Íconos

13 íconos nuevos de 16×16. **No se redibujó nada que otra profesión ya dibuje** (frasco, alga, escama corazón y aceite de pescado siguen viniendo de sus kits):

- **Bayas** (Aranja, Zanama, Zidra): cuerpo redondo, tallo y una hoja, cada una con su color.
- **Hierbas** (Medicinal, Revivir): manojo atado con una cuerda — se lee "recolectado", no "arbusto". La de Revivir lleva una flor clara.
- **Esencia Salvaje**: una vaharada con núcleo brillante; no es planta, es drop de combate.
- **Productos**: tres siluetas de vidrio — matraz redondo (pociones), tarro bajo (preparaciones) y frasco alto (Éter, Revivir). **La forma separa familias y el líquido separa productos.**

## 7. Rareza y resultado destacado

El dominio ya tiene un resultado destacado real y no hacía falta inventarlo: el rasgo `processing` del Pokémon **ahorra insumos** (`savedInputs`). Cuando pasa, la mesa suelta un destello fuerte, sube un cartel verde "Ahorró N" y la tarjeta muestra el banner "¡Tu Pokémon rindió el lote!". No hay calidad de producto (normal/crítico) porque **el dominio todavía no la modela**: proponerla es decisión económica, no de arte.

## 8. Decisiones descartadas

| Opción | Resultado |
|---|---|
| Caldero burbujeante gigante | Descartado: pertenece a otro género visual, no al mundo de WildLands |
| Aura mágica o partículas continuas en la mesa inactiva | Descartado por rendimiento y porque convierte el mundo en UI |
| Animación completa de mezclado del Pokémon | Descartado: requiere cuadros por especie (mismo motivo que en Tala) |
| Repetir toda la ceremonia por unidad del lote | **Probado y descartado**: a cantidad alta es insoportable |
| Herramienta tipo pico/hacha/caña para Alquimia | Descartado: el dominio no cobra herramienta al procesar (§ spec) |
| Panel flotante sin lugar en el mundo | Descartado: era justamente el problema de R31-B |

## 9. Responsive y rendimiento

- La mesa es un sprite del overlay: **no agrega capas de render**, entra por el mismo `SceneOverlay` compuesto que las otras tres.
- El arte se construye una vez y se memoiza por estado+líquido+cuadro (4 cuadros de hervor).
- La tarjeta funciona a 375 px: lista de recetas con scroll propio, botones de 40–44 px, sin hover.

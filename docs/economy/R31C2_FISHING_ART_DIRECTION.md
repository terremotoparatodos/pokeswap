# R31-C2 — Dirección de arte de Pesca

> Estado: kit implementado y probado en el motor real de WildLands (laboratorio del playground). **Solo en desarrollo**, sin persistencia. Rama `feat/r31c2-fishing-visual-design`.
> Assets: [`FISHING_ASSET_MANIFEST.md`](FISHING_ASSET_MANIFEST.md). Interacción: [`FISHING_INTERACTION_SPEC.md`](FISHING_INTERACTION_SPEC.md). Auditoría: [`R31C2_HANDOFF.md`](R31C2_HANDOFF.md).
> Base heredada de Minería: [`R31C1_MINING_ART_DIRECTION.md`](R31C1_MINING_ART_DIRECTION.md).

## 1. Qué cambia respecto de Minería

Minería fue el kit de referencia. Pesca reutiliza su pipeline entero (buffers `PixelArt`, `shade`, dithering Bayer, contorno de 1 px, `SceneOverlay`, partículas, rarezas, inventario, Pokémon trabajador) y cambia solo lo que el agua obliga a cambiar:

| Aspecto | Minería | Pesca |
|---|---|---|
| **Dónde vive el nodo** | Un prop sólido (roca) que se reemplaza | El **agua**: no hay prop que reemplazar |
| **Cómo se dibuja** | Sprite vertical con sombra proyectada | **Marca plana** pintada en el buffer de suelo, así se inclina con el terreno |
| **Ritmo** | El jugador marca el ritmo (golpes seguidos) | El **agua** marca el ritmo: esperás y reaccionás |
| **Momento clave** | El impacto | El **pique**: hay que verlo y responder |
| **Herramienta** | Pico que golpea | Caña que lanza, sostiene la línea y recoge |

## 2. Principios

1. **El agua sigue siendo agua.** Un spot es una zona más honda con algo moviéndose debajo, nunca un botón sobre el mar.
2. **El pique es la única señal fuerte.** Todo lo demás es discreto; cuando pica, se ve sin dudas (anillo brillante, flotador hundido y "!").
3. **Se lee sin texto.** Disponible, agotado, regenerando y bloqueado se distinguen por el arte del agua y un marcador chico.
4. **Reacción cómoda, no tramposa.** La ventana de pique es amplia y configurable; el objetivo de esta fase es que se sienta bien, no cerrar números.
5. **Barato.** La marca es una imagen de 20×13 memoizada; las gotas reutilizan el pool compartido de 40 partículas.

## 3. Spots

| Spot | Dónde | Lectura |
|---|---|---|
| Orilla | Agua junto a la costa | Mancha celeste media con anillo de espuma y una sombra que va y viene |
| Banco costero | Agua de playa | Igual, con azul más profundo |
| Arrecife | Agua abierta sobre coral o roca marina | Azul oscuro; el coral existente queda como está |

**Paleta** (`art/fishingPalette.ts`): tres tonos de agua y una espuma por spot, más tonos de pez, perla, escama y flotador. La madera y el acero de las cañas se importan de la paleta de Minería, para que pico y caña parezcan del mismo taller.

## 4. Estados visuales

| Estado | Señal |
|---|---|
| AVAILABLE | Mancha honda, anillo de espuma y sombra de pez que se desplaza entre dos cuadros |
| INTERACTABLE | Burbuja con caña y anillo blanco suave, solo al estar al lado |
| TARGETED | Anillo dorado con pulso |
| WAITING | Flotador quieto en el agua y línea desde la caña |
| BITE | Anillo interior brillante, sombra justo debajo, flotador hundido y "!" dorado |
| DEPLETED | Agua lisa: sin sombra ni burbujas |
| RESPAWNING | Vuelven primero las burbujas y después la sombra (3 cuadros) |
| LOCKED_LEVEL / SPECIAL_ACCESS | Burbuja con candado o sello, solo al lado |
| RARE | Destello si el spot está dentro del radio de prospección |

**Descartado:**
- íconos flotantes permanentes sobre el agua;
- teñir el agua entera de otro color;
- barra de progreso de espera (mata la tensión del pique);
- un pez dibujado nadando: a esta escala es ruido, la sombra se lee mejor.

## 5. Cañas

| Tier | Material | Detalle |
|---|---|---|
| T1 básica | Madera | Vara que afina hacia la punta |
| T2 reforzada | Madera con anilla de acero | — |
| T3 maestra | Compuesto azul oscuro | Anilla dorada |
| Rota | Vara partida en dos tramos | Reparable |
| Inservible | Desaturada y oscurecida | Sin reparaciones |

En el mundo son 3 cuadros de 18×18 anclados a la mano: atrás, latigazo y sostener. La línea sale de la punta calculada por `rodTipOffset`, así nunca nace del aire.

## 6. Lenguaje de animación

```text
lanzar 340 ms (caña atrás → latigazo) → vuelo de la línea 260 ms (arco hasta el agua)
  → espera 1,4–3,4 s (flotador quieto) → pique 1,1 s (flotador hundido + "!" + anillo)
  → recoger 380 ms → recompensa 950 ms, o escape 700 ms
```

- **Orientación:** la caña se espeja según hacia dónde mira el jugador; mirando hacia arriba se dibuja detrás.
- **Personaje:** no se tocaron las hojas del entrenador, igual que en Minería.
- **Pokémon trabajador:** aparece al lado con su sprite normal durante toda la acción (pieza compartida de R31-C1).
- **Descartado:** minijuego de tensión con barra (otra fase), lucha con el pez arrastrando la cámara, y cuadros propios por especie.

## 7. VFX

- **Caída de la línea:** 4 gotas y 2 espumas.
- **Pique:** anillo que se expande sobre el flotador (3 cuadros) y el "!".
- **Captura:** ráfaga según rareza (misma tabla que Minería), ícono del pez subiendo con "+N" y "+XP" dorado.
- **Escape:** sin ráfaga; el flotador vuelve y la tarjeta explica que no costó nada.
- **Sonido:** no hay infraestructura de audio (se retiró en R23). Assets sugeridos: latigazo, entrada al agua, pique, recogida, captura, escape y captura rara.

## 8. Responsive

- La marca y el flotador son píxeles del mundo: escalan con el zoom del renderer.
- La tarjeta mantiene visible el botón **¡Recoger!** durante toda la acción (44 px de alto), porque la reacción es el juego.
- A 375 px la tarjeta colapsa a encabezado, estado y botón, dejando ver el agua.

## 9. Decisiones descartadas

| Alternativa | Por qué no |
|---|---|
| Sprite de spot como prop vertical | El agua es plana: un prop parecería flotando |
| Marcar el spot en la casilla de tierra | El jugador mira el agua, no la arena |
| Pique solo por sonido o vibración | No hay audio y no es accesible |
| Ventana de pique fija de 0,9 s (R31-B) | Quedaba corta con touch; ahora es 1,1 s configurable |

# ECO-BALANCE-1 — Distribución inicial de nidos y población

> Rama `tools/eco-balance-1-0.3`, desde `tools/eco-preview-1-0.3 @ 4d06d032ce931d08f113cf7a28fdc2c2ce6ed46e`. ECO-2B y ECO-PREVIEW-1 no se modificaron.
> **Estudio, no balance aprobado.**
> - No cambian el catálogo de producto, el motor, el bundle, el roster, `worldRoom.js`, `wildService.js`, el protocolo, la economía, SQL ni CI.
> - Las configuraciones son datos de prueba externos (`src/features/ecosystem/preview/balance.ts`).
> - Las tasas de retirada son **hipótesis**, no mediciones de combate.

---

## 1. Resumen

- **Causa de los `empty-tier`:**
  - Casi todos los hábitats del catálogo cubren sólo una parte de los cuatro tiers. Un nido con un solo hábitat no tiene candidatos para el resto, y el motor (correctamente) no redistribuye.
  - Con la línea base A, entre el 35 % y el 62 % de los intentos caen en `empty-tier`, según la zona.
- **Dos decisiones distintas, medidas por separado:**
  - **Porcentajes (A → B):** declarar shares por nido sobre los tiers con candidatos elimina el `empty-tier`, pero **deforma la rareza del área**. En el bosque, el 22 % de las apariciones pasan a ser raras (objetivo: 5,5 %), porque el nido de "claro" sólo tiene raros y queda al 100 % raro. Pikachu sube de ~0,4 % a 5,3 % de los individuos.
  - **Pool (A → C):** juntar micro-hábitats compatibles en cada nido, manteniendo los shares de la zona, reproduce la mezcla de la zona **por aparición** (~70/24/5,5/0,5) con 0–2 `empty-tier` cada 2 h.
- **Hallazgo que hay que decidir: los shares se aplican por *aparición* (grupo), no por *individuo*.** Los comunes llegan en grupos de 1–3 (Pidgey, Zubat, Caterpie), así que, con los shares intactos, los raros son ~3,5 % de los **individuos** aunque sean 5,5 % de las apariciones.
- **Recomendación provisional** (no aprobada):
  - **C1** (grupos compatibles) en Pradera abierta y en el bosque.
  - En la cueva, **C1 o C2**, a decidir:
    - C1 deja un residuo pequeño de `empty-tier` (colonia de Zubat contra el espacio libre);
    - C2 lo elimina, pero Zubat llega a ~46 % de los individuos con demanda media o alta.
  - **B no se recomienda** tal como está.
- **Con demanda media o alta la población queda limitada por la oferta, en todas las variantes:** el área está vacía el 32–98 % del tiempo y las retiradas por jugador caen. Lo regulan el respawn y los topes, no el pool. Es otra decisión.
- No encontré defectos del motor. El residuo de C1 en la cueva es su comportamiento documentado: una entrada cuyo grupo mínimo supera el espacio libre se descarta.

## 2. Método

### 2.1 Qué se mantiene igual en todas las variantes (test `balance.test.ts`)

| Elemento | Valor |
| --- | --- |
| Nidos | **6** por zona, en las mismas posiciones: parches de 4 × 4 en una grilla sintética de 18 × 12 con las mismas rocas |
| Topes | Nido 3, `groupCap` 3; área: Pradera 12, bosque 8, cueva 6 |
| Respawn | `per-group`, 75 s ± 20 %, reintento 15 s (provisionales de ECO-2A) |
| Área vacía | Dormancia a 5 min, escalonado de 5–15 s |
| Duración y paso | 30 y 120 min, ticks de 5 s |
| Demanda | Mismo guion de oportunidades por escenario y semilla (§2.3) |

Un test verifica que la config de cada variante es idéntica a la de A **salvo** `habitats` y `zoneId` de los nidos.

### 2.2 Qué cambia (configuraciones exactas)

| Variante | Pool de cada nido (6 nidos, se repite el patrón) | Shares |
| --- | --- | --- |
| **A** (línea base) | Un hábitat por nido | Los de la zona (70/24/5,5/0,5) |
| **B** | **Los mismos pools que A** | **Declarados por nido**: los de la zona restringidos a los tiers con candidatos, reescalados a 100 y redondeados a 2 decimales |
| **C1** | Grupos compatibles de micro-hábitats (tabla de abajo) | Los de la zona |
| **C1b** | Como C1. Sólo en la cueva, otro agrupamiento (hipótesis de corrección) | Los de la zona |
| **C2** | Todos los hábitats de la zona en cada nido | Los de la zona |

**Ejes:** A → B cambia **sólo porcentajes**; A → C1/C2 cambia **sólo el pool**. B y C no son comparables en un solo eje.

**B: shares declarados** (común/poco común/raro/muy raro):

| Zona | Nido (pool) | Shares |
| --- | --- | --- |
| Pradera | `open-grass` | 70,35 / 24,12 / 5,53 / 0 |
| Pradera | `grass-near-water` | 100 / 0 / 0 / 0 |
| Pradera | `tall-grass` | 0 / 97,96 / 0 / 2,04 |
| Bosque | `undergrowth` | 100 / 0 / 0 / 0 |
| Bosque | `damp-clearing` | 92,72 / 0 / 7,28 / 0 |
| Bosque | `branches` | 0 / 100 / 0 / 0 |
| Bosque | `conifers` | 0 / 97,96 / 0 / 2,04 |
| Bosque | `foliage` | 0 / 81,36 / 18,64 / 0 |
| Bosque | `clearing` | **0 / 0 / 100 / 0** |
| Cueva | `cave-ceiling` | 92,72 / 0 / 7,28 / 0 |
| Cueva | `cave-rocky-floor` | 92,72 / 0 / 7,28 / 0 |
| Cueva | `cave-nook` | 92,11 / 0 / 7,24 / 0,65 |
| Cueva | `cave-floor` | 0 / 100 / 0 / 0 |
| Cueva | `cave-damp-corner` | 0 / 100 / 0 / 0 |
| Cueva | `cave-dry-floor` | 0 / 100 / 0 / 0 |

- El motor sólo lee shares por zona del catálogo. Por eso B construye **zonas experimentales derivadas** (`<zona>~B~<pool>`) que copian las entradas del pool. El catálogo resultante pasa `validateEncounterCatalog` (test) y el catálogo de producto queda intacto (test).
- No se agregó ninguna normalización al motor.

**C1: grupos** (autorados para este estudio; sólo hábitats de la misma zona, ninguna especie nueva):

| Zona | Grupos | Tiers cubiertos |
| --- | --- | --- |
| Pradera | pastizal = `open-grass + tall-grass` | c/u/r/mr |
| Pradera | orilla = `open-grass + grass-near-water` | c/u/r |
| Bosque | sotobosque = `undergrowth + branches + foliage` | c/u/r |
| Bosque | claro = `damp-clearing + clearing + conifers` | c/u/r/mr |
| Cueva | `cave-nook + cave-damp-corner` | c/u/r/mr |
| Cueva | `cave-ceiling + cave-floor` | c/u/r; el único común es Zubat (grupo 2–3) |
| Cueva | `cave-rocky-floor + cave-dry-floor` | c/u/r |

**C1b (cueva):** `nook + damp-corner` · `ceiling + rocky-floor` · `floor + dry-floor + rocky-floor`.

### 2.3 Escenarios (hipótesis)

| Escenario | Jugadores | Oportunidades de retirada | Presencia |
| --- | --- | --- | --- |
| `empty-return` | 1 | 1/min | Ausentes de los minutos 10 a 25 (→ `dormant`), luego vuelven |
| `low` | 2 | 1/min por jugador | Siempre |
| `medium` | 5 | 1,5/min por jugador | Siempre |
| `high` (incluye la cueva concurrida) | 15 | 2/min por jugador | Siempre |

- Cada oportunidad elige al azar un encuentro vivo y lo retira (`defeated`, **simulado**). Sin encuentros vivos, la oportunidad se pierde.
- Se registran las **previstas** y las **realizadas**.
- La presencia para el motor es binaria. El número de jugadores sólo multiplica oportunidades.
- "Por jugador" = realizadas / jugadores. **No** implica reparto justo ni ausencia de contención: no hay combate ni captura multijugador.

### 2.4 Reproducibilidad

- 20 semillas (1001–1020). Dos streams independientes por semilla:
  - **Motor** (`seed`): ticks y jitter. Su consumo **cambia entre variantes**: un `empty-tier` consume 2 números y una aparición, más. Por eso la misma semilla no da la misma secuencia de sorteos en A y en C.
  - **Demanda** (`seed ^ 0x5bd1e995`): cuántas oportunidades trae cada paso (determinista) y qué encuentro toma cada una. Las oportunidades previstas son **idénticas** entre variantes (test).
- Se comparan **distribuciones sobre 20 semillas** (media ± desvío, mínimo y máximo) bajo la misma demanda, no trazas sorteo por sorteo.
- Misma entrada, salida idéntica: dos generaciones completas dieron `summary.json` y `summary.md` byte a byte iguales (`cmp`), y hay un test de `runOnce`.

```bash
node node_modules/vite-node/vite-node.mjs scripts/ecosystem/balance-1.ts -- docs/design/eco-balance-1
```

~11 s en Node 22.23.3. Resultados resumidos en `docs/design/eco-balance-1/summary.json` (120 filas, con especies y nidos por fila) y `summary.md` (todas las tablas, 30 y 120 min). No se guardan logs por tick.

## 3. Resultados (120 min, media de 20 semillas)

`ET` = intentos `empty-tier`. "Vivos" = población media con el área activa. "Vacío" = % del tiempo activo sin ningún encuentro. Mezcla: común/poco común/raro/muy raro, en %.

### 3.1 Demanda baja (2 jugadores, 239 oportunidades: todas realizadas en todas las variantes)

| Zona | Var. | ET | Vivos | Mezcla por aparición | Mezcla por individuo | Especie más frecuente (% individuos) |
| --- | --- | --- | --- | --- | --- | --- |
| Pradera | A | 212,6 | 4,31 | 57,3 / 40,6 / 1,7 / 0,5 | 67,1 / 31,3 / 1,3 / 0,3 | Bidoof 36,8 |
| Pradera | B | 0 | 4,73 | 53,9 / 44,1 / 1,4 / 0,7 | 64,1 / 34,4 / 1,0 / 0,5 | Bidoof 35,0 |
| Pradera | **C1** | 0,25 | **5,53** | **70,3 / 23,9 / 5,7 / 0,2** | 77,9 / 18,4 / 3,6 / 0,1 | Pidgey 41,6 |
| Pradera | C2 | 0 | 5,35 | 69,8 / 23,9 / 5,9 / 0,4 | 78,0 / 17,8 / 3,9 / 0,3 | Pidgey 36,7 |
| Bosque | A | 551,7 | 3,66 | 36,9 / 48,6 / 14,2 / 0,3 | 44,9 / 44,8 / 10,0 / 0,2 | Oddish 20,1 |
| Bosque | B | 0 | 4,80 | 29,2 / 48,4 / **22,0** / 0,4 | 36,8 / 46,6 / 16,3 / 0,3 | Oddish 16,5 |
| Bosque | **C1** | 0,5 | 5,27 | **70,3 / 23,9 / 5,6 / 0,2** | 76,7 / 19,5 / 3,7 / 0,1 | Oddish 34,6 |
| Bosque | C2 | 0 | 5,53 | 70,1 / 24,6 / 5,2 / 0,2 | 75,7 / 20,9 / 3,2 / 0,1 | Caterpie 31,3 |
| Cueva | A | 327,3 | 3,69 | 49,0 / 47,4 / 3,5 / 0,1 | 59,7 / 37,5 / 2,8 / 0,1 | Zubat 25,3 |
| Cueva | B | 0,1 | 4,34 | 43,1 / 53,4 / 3,4 / 0,1 | 53,4 / 43,7 / 2,8 / 0,1 | Zubat 22,9 |
| Cueva | **C1** | 11,65 | 4,53 | **70,0 / 24,3 / 5,6 / 0,1** | 77,0 / 18,6 / 4,3 / 0,1 | Zubat 31,6 |
| Cueva | C1b | 18,95 | 4,47 | 77,4 / 16,8 / 5,8 / 0,1 | 82,4 / 13,1 / 4,5 / 0,1 | Geodude 40,1 |
| Cueva | C2 | 0 | 4,64 | 70,8 / 23,2 / 5,5 / 0,5 | 78,0 / 17,5 / 4,2 / 0,4 | Zubat 33,2 |

Con demanda baja los encuentros generados son ~244 en todas las variantes (± 0,7–1,7). Están limitados por la demanda: lo que cambia es la **población visible** y la **mezcla**.

### 3.2 Demanda media y alta (oferta limitada)

| Zona | Var. | Media: encuentros | Media: vacío % | Media: por jugador | Alta: encuentros | Alta: vacío % | Alta: por jugador |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pradera | A | 590,6 ± 11,3 | 56 | 118,1 | 662,5 ± 10,6 | 98 | 44,2 |
| Pradera | B | 661,2 ± 8,3 | 49 | 132,1 | 751,5 ± 8,9 | 97 | 50,1 |
| Pradera | C1 | 714,9 ± 9,2 | 38 | 142,9 | 858,9 ± 17,1 | 95 | 57,3 |
| Pradera | C2 | 706,4 ± 11,1 | 40 | 141,1 | 843,5 ± 13,2 | 95 | 56,2 |
| Bosque | A | 501,9 ± 10,4 | 63 | 100,3 | 555,0 ± 12,6 | 98 | 37,0 |
| Bosque | B | 668,9 ± 7,6 | 48 | 133,7 | 776,9 ± 10,4 | 96 | 51,8 |
| Bosque | C1 | 722,4 ± 10,8 | 38 | 144,4 | 872,9 ± 13,3 | 95 | 58,2 |
| Bosque | C2 | 745,0 ± 10,5 | 32 | 148,8 | 936,2 ± 16,2 | 93 | 62,4 |
| Cueva | A | 528,2 ± 7,6 | 63 | 105,5 | 598,0 ± 8,9 | 97 | 39,9 |
| Cueva | B | 633,7 ± 5,7 | 52 | 126,7 | 726,2 ± 8,9 | 97 | 48,4 |
| Cueva | C1 | 688,3 ± 8,3 | 43 | 137,5 | 813,8 ± 10,3 | 95 | 54,3 |
| Cueva | C1b | 664,3 ± 8,9 | 47 | 132,7 | 773,6 ± 12,9 | 96 | 51,6 |
| Cueva | C2 | 718,6 ± 13,2 | 38 | 143,5 | 874,5 ± 20,5 | 94 | 58,3 |

Oportunidades previstas: media 900; alta 3 600. Realizadas ≈ encuentros generados (los vivos al cierre no llegan a retirarse). Las mezclas por aparición con demanda media y alta son casi las mismas que con demanda baja (`summary.md`).

### 3.3 Área vacía y regreso (`empty-return`)

| Zona | A: ET | B: ET | C1: ET | C2: ET |
| --- | --- | --- | --- | --- |
| Pradera | 104,7 ± 19,1 | 0 | 0,05 | 0 |
| Bosque | 320,3 ± 42,1 | 0 | 0,1 | 0 |
| Cueva | 183,6 ± 31,9 | 5,9 ± 5,2 | 24,3 ± 9,1 | 0 |

- En los cuatro casos, la dormancia se alcanza y la vuelta rellena el área.
- `area-full` aparece al rellenar la cueva (6 de tope para 6 nidos de hasta 3): 26–37 intentos por corrida, en todas las variantes.

### 3.4 Nidos sistemáticamente vacíos

**Ninguno.** No hay nidos con 0 encuentros en ≥ 80 % de las semillas. Los más débiles (share de individuos frente al 16,7 % de un reparto parejo, demanda media):

| Variante | Nido más débil |
| --- | --- |
| A, bosque | El de **claro (sólo raros)**: 4,2 % |
| A, cueva | `cave-floor`: 10,3 % |
| A, Pradera | Pasto alto (sólo poco común y muy raro): 9,3 % |
| C1 y C2 | Todos los nidos entre 12 % y 19 % |

### 3.5 Variación entre semillas

- Los desvíos de los encuentros son del 0,3–2,4 % de la media.
- Los extremos (mínimo y máximo, en `summary.json`) no invierten ningún orden entre variantes en la demanda media o alta.
- Los conteos de `empty-tier` varían más (A en `empty-return`: ± 13–18 %) y son igualmente decenas o cientos de veces mayores que en C.

## 4. Recomendación por área (provisional)

| Área | Recomendación | Por qué |
| --- | --- | --- |
| **Pradera abierta** | **C1**: pastizal (`open-grass + tall-grass`) y orilla (`open-grass + grass-near-water`) | Mezcla por aparición = zona; `empty-tier` ~0; más población visible. Corrige la dominancia de Bidoof de A/B (37 % de los individuos), propia de los nidos de orilla de un solo hábitat. Conserva identidad: los Nidoran sólo en pastizal |
| **Bosque** | **C1**: sotobosque (`undergrowth + branches + foliage`) y claro (`damp-clearing + clearing + conifers`) | Igual que en la Pradera. Evita el nido "sólo raros" de A/B. C2 rinde parecido, pero borra la diferencia entre sotobosque y claro |
| **Cueva** | **C1** (o **C2**, decisión del dueño) | Ver §5: ambas dan la mezcla de la zona. C1 tiene un residuo de `empty-tier` (≤ 2,4 por 2 h con demanda; 11–24 tras una vuelta de dormancia) y Zubat en 32–40 % de los individuos. C2: 0 `empty-tier`, pero Zubat en 33–46 % |
| B | **No recomendado** tal como está | Arregla el síntoma, pero sus shares por nido cambian la rareza del área: bosque al 22 % raro por aparición; cueva al 50–54 % poco común |
| C1b (cueva) | **Descartado** | Resultado negativo. Al juntar techo y suelo rocoso, el nido se queda sin poco comunes (24 % de sus intentos en `empty-tier`) y la mezcla cae a 77/17/6. **Lección: cada grupo debe cubrir los cuatro tiers con alguna entrada de grupo mínimo 1** |

**Por qué C1 en la cueva conserva el residuo.** El nido `ceiling + floor` sólo tiene a Zubat (grupo 2–3) como común. Cuando el espacio libre del área es 1, Zubat queda descartado y el tier común de ese nido está vacío. El motor no "achica" el grupo ni pasa a otra especie: es lo especificado.

Opciones (todas fuera de este estudio):
- **(a)** agregar al grupo un común de grupo 1 compatible (p. ej. Whismur, de `cave-nook`, si se acepta en el techo);
- **(b)** C2 en la cueva;
- **(c)** aceptar el residuo.

## 5. Consecuencias para las especies raras (individuos, %, demanda media, 120 min)

| Zona | Especie | A | B | C1 | C2 |
| --- | --- | --- | --- | --- | --- |
| Pradera | Pikachu | 0,52 | 0,46 | 1,15 | 1,16 |
| Pradera | Pidgeotto | 0,45 | 0,59 | 1,35 | 1,32 |
| Pradera | Nidorina + Nidorino (muy raros) | 0,42 | 0,56 | **0,10** | 0,30 |
| Bosque | Pikachu | 1,45 | **5,33** | 0,37 | 0,53 |
| Bosque | Pidgeotto | 2,73 | **7,37** | 0,57 | 0,95 |
| Bosque | Ledian | 2,09 | 2,24 | 1,62 | 0,50 |
| Bosque | Forretress (muy raro) | 0,24 | 0,28 | 0,14 | 0,25 |
| Cueva | Graveler / Golbat | 1,07 / 1,16 | 0,71 / 0,73 | 1,19 / 1,19 | 1,33 / 0,88 |
| Cueva | Dunsparce (muy raro) | 0,09 | 0,07 | 0,09 | 0,26 |

**Lectura:**

- **B** convierte a Pikachu y Pidgeotto del bosque en apariciones frecuentes: el nido de claro es 100 % raro.
- **C1** respeta la rareza por tier, pero **reparte distinto dentro del tier** según el pool de cada nido:
  - en el bosque, el raro del sotobosque es sólo Ledian, así que Ledian pesa más y Pikachu menos que en C2;
  - en la Pradera, los muy raros sólo aparecen en los nidos de pastizal (la mitad), así que son más raros que en C2.
- Los muy raros dependen mucho de cuántos nidos los alojan. Su frecuencia real se fija **eligiendo qué nidos tienen ese hábitat**, no sólo con los pesos del catálogo.

## 6. Decisiones que requieren al dueño

1. **¿El 70/24/5,5/0,5 es por aparición (grupo) o por individuo?** Hoy es por aparición. Por individuo, los raros son ~3,5–4,3 %. Si se quiere por individuo, hay que recalibrar los shares o los grupos (cambio de catálogo, otra fase).
2. **Pools de nido por grupos compatibles (C1)**, con los grupos de §2.2 como punto de partida: aprobar o ajustar, sabiendo que también fijan qué especies raras viven en cada parte del mapa.
3. **Cueva:** C1 con residuo, C2 sin residuo y con más Zubat, o agregar un común de grupo 1 al techo.
4. **B:** sólo tendría sentido con shares por nido **calibrados** para preservar la mezcla del área. No se implementó: requeriría autoría por nido y aprobación.
5. **Oferta frente a demanda:** con demanda media o alta, las áreas están vacías el 32–98 % del tiempo en todas las variantes. Respawn, topes, número de nidos y política (`per-member` llena más, ECO-PREVIEW-1) son la palanca, no el pool. Ninguna se tocó.

## 7. Límites del modelo frente al juego real

- **Geometría:** la grilla y los nidos son sintéticos (6 parches iguales). Las posiciones reales, la distancia entre nidos, la visibilidad y el desplazamiento de jugadores no están modelados.
- **Demanda y retirada:**
  - las oportunidades de retirada son hipótesis;
  - la retirada es instantánea (sin duración de combate, reserva ni contención entre jugadores);
  - el "por jugador" es un cociente, no un reparto;
  - la presencia es binaria para el motor.
- **No modelado:** nivel, shiny, horario, clima, captura, recompensas y el efecto de las recompensas sobre la demanda.
- **Muestra:** 20 semillas por celda bastan para ordenar variantes (los desvíos son chicos frente a las diferencias). No bastan para afinar muy raros: 0,1–0,5 % de individuos son unos pocos casos por corrida.
- **Mezcla analítica:** la de `summary.json` (`design[].analytic`) supone el mismo número de intentos por nido. La simulación muestra que no es así: los fallos reintentan cada 15 s.

**Información que haría falta antes de ampliar la batería:**
- duración real del combate y del engage (ECO-3a);
- densidad de jugadores por zona en un playtest;
- respuesta a la pregunta 1.

## 8. Verificación

| Gate (Node v22.23.3) | Resultado |
| --- | --- |
| `vitest run src/features/ecosystem` | 12 archivos, **121 tests ✔** (7 nuevos en `balance.test.ts`) |
| Typecheck (`vue-tsc`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores. 9 warnings preexistentes, ninguno del cambio |
| `git diff --check 4d06d03..HEAD` | exit 0 |
| `bundle-encounters.mjs --check` | exit 0 (bundle intacto) |
| Reproducibilidad | Dos corridas completas con salida idéntica (`cmp`) |

**Guard de aislamiento.** El runner `scripts/ecosystem/balance-1.ts` importa el módulo de estudio.
- Se permite **por nombre de archivo exacto**: es un script de desarrollo.
- Un control negativo verifica que otro script en la misma carpeta sigue siendo detectado.
- El resto del guard no cambió.

**Simulador.** No agregué presets ni cambié sus valores por defecto. Para visualizar A/B/C1/C2 haría falta que el simulador acepte el catálogo experimental; queda como paso siguiente opcional.

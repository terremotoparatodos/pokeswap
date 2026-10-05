# ECO-CAPACITY-1 — Límites por zona dentro de una misma área

> Rama `world/eco-capacity-1-0.3`, desde `tools/eco-map-1-0.3 @ 7739c4d4c1dba59b8dca3b66f379dea18082d108`. Las ramas anteriores no se modificaron.
> **Motor aislado, no conectado.** No se tocaron `worldRoom.js`, `wildService.js`, presencia, sesiones, protocolo, economía, SQL, migraciones, dependencias, CI, mapas, recursos, posiciones de trabajo ni el roster activo.
> Siguen siendo provisionales: límites numéricos, radios de separación, distribución de rareza y ritmo de respawn. La cuestión rareza por individuo / por grupo sigue pendiente.

---

## 1. Resumen

- **Área ≠ zona de población.**
  - El **área** es el espacio autoritativo del mundo (`pradera`, `cueva-inicial`) con su total `maxAlive`.
  - Una **zona de población** es una subdivisión **opcional** de la población de un área, con `maxAlive` opcional. No es un área del mundo: no tiene presencia, interés ni protocolo propios.
  - Un nido puede declarar `populationZoneId`.
  - Tampoco es la zona del catálogo (`zoneId`, el pool de especies). No se reutilizaron las zonas derivadas del estudio B.
- **Todos los límites a la vez:** nido, zona (si tiene máximo), área, casillas abiertas y tamaño de grupo. El grupo nunca se recorta por debajo de su mínimo (política de ECO-2A sin cambios).
- **Compatibilidad sin zonas:** el motor nuevo da estados, tiempos y consumo de azar **idénticos** al motor del commit base. La prueba carga el bundle de `7739c4d` desde git, sin copias a mano.
- **Diagnóstico separado por causa:** `nest-full`, `zone-full` (nuevo), `area-full`, `no-room-for-group` (nuevo: capacidad, no rareza), `no-open-tile` y `no-geometry` (geometría), y `empty-tier`, `invalid-distribution` y `unknown-zone` (pool).
- **Máximos ≠ reservas.** Está documentado y probado, y hay un informe numérico de garantías por zona (`capacityReport`).
- **Configuración inicial propuesta** (para los 10 nidos de ECO-MAP-1, sin tocar posiciones, hábitats ni especies):
  - Pradera **18** = abierta **12** + bosque **6**;
  - cueva **6** (una zona sin máximo propio).
- **Defecto propio encontrado en el smoke y corregido.** En la vista Bosque, el recorte de dibujo limitaba la geometría del motor y los nidos de Pradera abierta nunca aparecían. Hay test de regresión con su control negativo.

## 2. Contrato y compatibilidad

```ts
AreaConfig { areaId, maxAlive, idle, nests, zones?: PopulationZoneConfig[] }
PopulationZoneConfig { id, maxAlive? }            // maxAlive omitido = sin límite de zona (sólo el del área)
NestConfig { …, populationZoneId?: string }       // omitido = el nido cuenta sólo contra su límite y el del área
```

**Validación** (`validatePopulationConfig`):
- id de zona válido y sin `:`;
- zonas no repetidas (`duplicate-population-zone`);
- `maxAlive` entero ≥ 1 si está presente (`invalid-limit`: rechaza 0, −1, 1,5, `NaN` y `'3'`);
- un nido que nombra una zona inexistente en su área da `unknown-population-zone`.

Siguen siendo válidos los nidos sin zona junto a nidos con zona, y las configuraciones sin zonas.

**Un intento de aparición** (orden de chequeo):
1. `nest-full`;
2. `zone-full`;
3. `area-full`;
4. `no-geometry`, `no-open-tile`;
5. pool.

`room = min(hueco del nido, hueco de la zona, hueco del área, casillas abiertas libres, groupCap)`. Las entradas cuyo `group.min` supera `room` no son candidatas, y el tamaño se sortea en `[min, min(max, room)]`.

**Reclasificación de diagnóstico.** Si el tier sorteado queda vacío **sólo** por `room`, el motor vuelve a consultar el catálogo con el **mismo ticket**, sin el filtro de espacio y sin extraer otro número al azar. Si ahí hay candidatos, informa `no-room-for-group` con `limitedBy` = el límite más chico (`nest`, `zone`, `area`, `tiles` o `groupCap`). Antes eso salía como `empty-tier`.

- **Consecuencia para un estudio congelado.** En ECO-BALANCE-1, parte de los `empty-tier` de la cueva C1 (el residuo de la colonia de Zubat) eran en realidad bloqueos de capacidad. Ese estudio no se regeneró; queda anotado aquí.

**Prueba de compatibilidad** (`population/compat.test.ts`):
- carga el bundle del commit base con `git show` (en una carpeta temporal ignorada dentro de `node_modules/.cache`, que se borra al terminar);
- corre 3 configuraciones × 3 semillas × 400 pasos, con retiradas y ventanas de inactividad;
- compara el estado final y todos los eventos, mapeando `no-room-for-group` → `empty-tier`;
- resultado: idénticos;
- otro test verifica que la reclasificación **ocurre** en esos datos, así que la prueba no es vacía.

## 3. Configuración inicial propuesta (provisional)

`src/features/ecosystem/map/capacityLimits.ts` (datos) y `capacityProposal.ts` (construye la config del motor con los 10 nidos de ECO-MAP-1). `nests.json` publica ahora esta capacidad en lugar de los topes viejos (bosque 8).

| Área | Total | Zona | Máximo | Σ máximos de sus nidos | Techo efectivo | Garantía numérica* |
| --- | --- | --- | --- | --- | --- | --- |
| `pradera` | **18** | abierta (5 nidos) | **12** | 15 | 12 | 12 |
| | | bosque (2 nidos) | **6** | 6 | 6 | **6** |
| `cueva-inicial` | **6** | cueva (3 nidos) | — | 9 | 9 (el área limita a 6) | — |

\* Lo que queda **numéricamente** para la zona si todas las demás están en su techo: `max(0, total − Σ techos de las otras)`.

**Por qué 12/6/18:**
- El techo físico del bosque es 6: dos claros, nidos de 3. Darle 8, como en ECO-MAP-1, no agregaba nada.
- La Pradera abierta podría tener 15 (5 × 3). Su máximo de 12 hace que, con el total en 18, siempre queden 6 **numéricamente** para el bosque.
- No hay contención (12 + 6 = 18), sin agregar reservas, prioridades ni fairness.

**Lo que esto NO promete:**
- Que el bosque tenga **casillas** libres: la capacidad numérica no es espacio físico. Sus 7 casillas candidatas también pueden quedar ocupadas, y un grupo de 3 necesita 3.
- Que un tier tenga candidatos: el pool puede seguir dando `empty-tier`.
- Que se mantenga si cambian los números. Con total 16 (< 12 + 6), el bosque sólo tendría 4 garantizados. El informe lo señala como contención.

**Smoke (navegador integrado, `127.0.0.1:5191`, política `per-member` para saturar):** área 18/18, abierta 12/12 con `zone-full` en sus nidos y bosque 6/6, también desde la vista Bosque tras el arreglo.

## 4. Máximos frente a reservas

| Caso (2 zonas, test) | Total | abierta | bosque | Resultado |
| --- | --- | --- | --- | --- |
| Con máximo en abierta | 9 | 6 | 3 | abierta se detiene en 6 con `zone-full`; el bosque nunca encuentra el área llena |
| **Sin** máximo en abierta | 9 | — | 3 | `capacityReport`: bosque garantizado **0**. En una corrida de 300 pasos, el bosque recibe `area-full` |
| Total < suma de máximos | 7 | 6 | 3 | `contention: true`; garantías abierta 4 y bosque 1; nota "Σ zone ceilings 9 > area max 7" |

Con una sola zona, superar el total del área no es contención entre zonas. El informe lo dice así: "area limit binds".

## 5. Pruebas y controles negativos

Node **v22.23.3** (portátil verificado). Archivos nuevos o ampliados:

- **`population/zones.test.ts` (13):**
  - límites simultáneos en 400 pasos;
  - una zona saturada mientras la otra se llena;
  - máximos que no son reservas;
  - total menor que la suma de máximos;
  - grupo que no cabe en el espacio restante: nunca por debajo de su mínimo, diagnosticado `no-room-for-group` con `limitedBy` `zone`;
  - un hueco real del pool sigue siendo `empty-tier`;
  - la retirada libera capacidad y el nido vuelve a llenarse;
  - inactividad, dormancia y regreso respetando zonas;
  - evaluaciones repetidas y determinismo;
  - referencias y límites inválidos.
- **`population/compat.test.ts` (4):** equivalencia con el motor base (§2).
- **`map/capacityProposal.test.ts` (5):**
  - los 10 nidos sin cambios y asignados a su zona;
  - config válida para el motor;
  - aritmética 12/6/18 y caso sin máximo (bosque con 3 garantizados);
  - cueva;
  - corrida estresada de 400 pasos con los nidos reales: sin violaciones, `zone-full` en abierta, **ningún** `area-full` en el bosque.
- **`preview/simulator.test.ts`:** vista con zonas; la vista Bosque simula toda el área (regresión del smoke).
- **`EcoPreviewApp.test.ts`:** filas de zona en la vista.
- **Verificador de invariantes** (`populationViolations`): ahora también revisa los máximos de zona.

**Controles negativos automáticos.** Se corre el motor **sin** el límite y se verifica contra la config **con** el límite:
- sin máximo de zona → `zone abierta holds 7–9 > 6`, sin ninguna violación de área;
- sin límite de área → `area … holds 8–9 > 7`, sin ninguna violación de zona.

**Mutantes manuales** sobre `engine.ts`, restaurados con `git checkout`. Todos fallan por su causa:

| Mutante | Fallan | Causa observada |
| --- | --- | --- |
| Z1 sin límite de zona | 7 | `zone abierta holds 13 > 12`, `zone z holds 5 > 4`, `zone abierta holds 8 > 6` |
| Z2 sin límite de área | 5 | `area cueva-inicial holds 10–12 > 9`, `2 > 1` |
| Z3 la zona cuenta toda el área | 3 | La zona se bloquea de más (sin `zone-full` esperado / población 0) |
| Z4 bloqueo de capacidad informado como `empty-tier` | 2 | No aparece `no-room-for-group` |

El defecto del smoke tiene su control: con la geometría vieja, el test de regresión falla con `abierta 0` en lugar de 12.

**Gates:**

| Gate | Resultado |
| --- | --- |
| `vitest run src/features/ecosystem` | 16 archivos, **169 tests ✔** |
| Typecheck (`vue-tsc`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores. 9 warnings preexistentes, ninguno del cambio |
| `git diff --check 7739c4d..HEAD` | exit 0 |
| `bundle-encounters.mjs --check` | exit 0. Bundle **regenerado** desde las fuentes; los tests de paridad y deriva pasan |
| `map-geometry.mjs --check` / `map-nests.ts --check` | exit 0 / exit 0. `nests.json` regenerado: ahora publica la capacidad |

Smoke: servidor propio en loopback, puerto comprobado libre, detenido al terminar.

**Cambio intencional de tests de ECO-MAP-1.** En modo mapa real, las vistas Pradera abierta y Bosque simulan ahora la misma área `pradera` (7 nidos); antes eran 5 y 2 por separado. Se actualizaron esos tests con el motivo.

## 6. Decisiones pendientes

1. **Números:** total 18, abierta 12, bosque 6, cueva 6. ¿Se aprueban como punto de partida?
2. **Reservas mínimas o prioridades:** si en el futuro el total queda por debajo de la suma de máximos, ¿se quiere un mínimo reservado para el bosque? Hoy **no** existe y no se implementó.
3. **Cueva:** ¿zona sin máximo (el área limita) o un máximo propio por si se agregan más zonas?
4. **Diagnóstico:** ¿debe el roster o la telemetría futura distinguir `no-room-for-group` de `empty-tier`? Recomendado: sí; mezclarlos oculta bloqueos de capacidad.
5. **Lo que sigue abierto de antes:** rareza por individuo o por grupo, grupos C1, posiciones de trabajo en el bosque y radios de separación.

## 7. Límites a comprobar al integrar

- La integración debe **reusar** `proposedAreaConfig` o equivalente, generado con el mismo validador de nidos contra el layout vigente, y rechazar el arranque si la versión de layout cambió.
- **Un estado por área de presencia.** Pradera abierta y bosque comparten estado y RNG del área. No deben convertirse en áreas del mundo distintas para conseguir topes separados.
- La ocupación dinámica (jugadores, trabajos en curso) debe sumarse a la geometría del motor. Los límites numéricos no la cubren.
- Telemetría por categoría de fallo (`spawnFailureCategory`): nido, zona, área, espacio para el grupo, geometría y pool.
- El bundle del realtime (`encounters.generated.js`) debe pasar `--check` en el gate de despliegue (CI no se tocó).
- La compatibilidad de la prueba se ancla a `7739c4d`. Si el historial se reescribe o se clona superficialmente, esa prueba no puede leer la línea base y lo dirá con un error de git, no con un falso positivo.

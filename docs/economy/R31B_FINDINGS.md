# R31-B — Hallazgos sobre R31-A

> Qué reveló construir la UI sobre los contratos de R31-A. Cada hallazgo indica si se resolvió en R31-B (solo cambios triviales y aislados) o si queda para auditoría.
> Convención: **Resuelto en R31-B**, **Pendiente (R31-C)** balance/UX, **Pendiente (R32+)** contratos, persistencia o motor.

## Resumen

| ID | Hallazgo | Estado |
|---|---|---|
| B-01 | El resolver no exponía costes ni probabilidades | Resuelto (`previewGathering`) |
| B-02 | No hay tipos ni niveles de especie offline | Pendiente (R32+), fixture en demo |
| B-03 | Las recetas no tienen nombre; dos "Revivir" iguales | Pendiente (R31-C) |
| B-04 | `COOLDOWN` y `DEPLETED` no se distinguen en el dominio | Pendiente (R32+) |
| B-05 | No existe capacidad de inventario | Pendiente (R31-C/R32) |
| B-06 | Costes de energía con decimales | Pendiente (R31-C) |
| B-07 | El descanso se activa segundos después de llenar la barra | Pendiente (R31-C) |
| B-08 | "Unidades finas" no tienen efecto | Pendiente (R31-C) |
| B-09 | Detección y seguridad no tienen gameplay ni render | Pendiente (R32+) |
| B-10 | Los porcentajes de bonus se ven chicos para el jugador | Pendiente (R31-C) |
| B-11 | Nivel del Pokémon trabajador sin fuente en la UI | Pendiente (R32+) |
| B-12 | `ToolInstance` no tiene dueño ni ranura equipada | Pendiente (R32+) |
| B-13 | El procesado no cuesta energía; el ejemplo de UX esperaba que sí | Decisión de producto |
| B-14 | T2/T3 quedan lejos del spawn en Pradera | Pendiente (R31-C) |
| B-15 | Anclas no sólidas no disparan la interacción al llegar | Pendiente (R32+) |
| B-16 | No hay función de agregación de equipo | Pendiente, decisión de party |
| B-17 | Textos de acceso y estación no están en el catálogo | Pendiente (R31-C) |
| B-18 | Pesca: el timing no puede influir en el resultado | Pendiente, decisión |
| B-19 | La integración en WildLands no se pudo recorrer localmente | Riesgo de verificación |
| B-20 | Playground en móvil: controles arriba | Menor |
| B-21 | `game.ts` sigue creciendo (> 500 líneas) | Deuda existente |
| B-22 | La app no arranca sin variables de Supabase | Preexistente |
| B-23 | Recuadro de feedback vacío tras cambiar el viewport | Menor, sin reproducir de forma estable |

---

## B-01 — El resolver no exponía costes ni probabilidades

- **Problema:** la UI debe mostrar antes de actuar el coste de energía, la duración, la XP, el rango de unidades, la probabilidad de +1, de ×2 y de cada secundario, y el desgaste. `resolveGathering` solo devolvía el resultado ya tirado.
- **Alternativas:**
  - A: duplicar la fórmula en la UI;
  - B: tirar el resolver con RNG fijo y adivinar;
  - C: extraer la parte determinista.
- **Resuelto (C).** `previewGathering(context)` en `domain/gathering.ts` hace la validación y calcula todos los valores deterministas y las probabilidades finales. `resolveGathering` lo usa y solo agrega las tiradas.
  - El orden de las tiradas y todos los tests de R31-A se mantienen.
  - Se agregó un test que compara preview y resultado.
- **Impacto:** ninguno en R31-A. El servidor puede usar el mismo preview para rechazar antes de tirar.

## B-02 — No hay tipos ni niveles de especie offline

- **Problema:** la afinidad necesita `type1`/`type2` (tabla `pokemon`) y el nivel (`pokemon_xp`). El repo no tiene copia offline (FACT de R31-A) y el playground no debe leer Supabase.
- **Estado actual:** `demo/demoWorkers.ts` es un fixture de 12 especies con tipos escritos a mano. Los stats sí vienen del catálogo real.
- **Recomendación R32:**
  - adaptador `pokemonProfessionInput(slot, pokemon, xpRow)` alimentado por `useMyBox` (ownership ya validado) y `listPokemon`;
  - la UI recibe `PokemonProfessionAffinity` y nunca tipos sueltos;
  - retirar el fixture del camino productivo.

## B-03 — Las recetas no tienen nombre

- **Problema:** `RecipeDefinition` no tiene nombre de presentación. La UI usa el nombre de la salida (`recipeTitle`), y `brew_revive` y `brew_revive_scale` aparecen los dos como "Revivir".
- **Alternativas:**
  - A: agregar `name` al catálogo;
  - B: sufijo automático con el insumo que difiere ("Revivir · Escama Corazón");
  - C: dejarlo.
- **Recomendación:** A. Es una agregación de datos sin impacto en los resolvers. No se hizo porque toca el contrato del catálogo.

## B-04 — COOLDOWN y DEPLETED no se distinguen en el dominio

- **Problema:** R31-A solo modela cargas personales con respawn. No hay cadencia mínima entre acciones ni agotamiento compartido.
- **Estado actual:**
  - `depleted` = sin cargas personales, con cuenta regresiva;
  - `cooldown` = pausa local de 0,5 s tras el resultado.
- **Recomendación R32:** el servidor valida cadencia (≥ `actionSeconds` entre acciones del mismo jugador) y devuelve `retryAfterMs`. La UI mostraría `cooldown` con ese dato.

## B-05 — No existe capacidad de inventario

- **Problema:** se pidió el estado `INVENTORY_FULL`, pero `Inventory` es un mapa sin límites.
- **Estado actual:** la demo usa 300 unidades totales y bloquea si no entra el máximo posible de la acción (`max + 1`, sin contar críticos).
- **Pendiente:** decidir entre unidades totales, espacios por pila o límite por ítem, y si hay almacenamiento en la ciudad. Afecta la economía, porque la capacidad es otro regulador, y el esquema de R32.

## B-06 — Costes de energía con decimales

- **Problema:** `actionEnergyCost` redondea a 2 decimales. Se ve "−19,43 energía" con Machamp nivel 30, y el medidor muestra valores truncados.
- **Recomendación R31-C:** costes enteros (redondeo hacia arriba en el dominio), o reducciones por pasos. Es una decisión de balance; no se cambió.

## B-07 — Descanso casi instantáneo

- **Problema:** con la barra llena, cualquier regeneración se acumula como descanso. A los pocos segundos la primera acción ya da +50 % de XP ("+165 XP" en lugar de 110 en el navegador). El indicador parpadea y el bonus pierde significado.
- **Recomendación:** umbral mínimo para mostrarlo y aplicarlo (por ejemplo, ≥ 60 de descanso), o acumular solo tras N minutos con la barra llena.

## B-08 — Unidades finas sin efecto

- **Problema:** `fineUnits` se calcula y la UI lo muestra ("2 de calidad fina"), pero no cambia nada. El inventario ni siquiera separa calidad.
- **Recomendación:** dar un efecto (durabilidad de herramienta, potencia de poción) o dejar de mostrarlo hasta R33.

## B-09 — Detección y seguridad sin gameplay

- **Problema:** `detection` solo existe como `detectionRadius()`, que nadie dibuja. `safety` está reservado. Prospección mezcla `rareFind` (con efecto) y `detection` (sin efecto).
- **Qué haría falta:** un puerto en el renderer de WildLands para resaltar casillas con nodos dentro del radio. Toca el motor, así que no se implementó.
- **Recomendación:** hasta que exista, la capacidad de Prospección debería ponderar solo `rareFind`, o marcar que la detección es futura.

## B-10 — Bonus que se ven chicos

- **Problema:** con los topes de R31-A, un especialista de nivel 30 da +15 % de unidad extra y un generalista −2 % de energía. El jugador lee "casi no importa". El puntaje 0–5 relativo compensa en la vista, pero el porcentaje literal decepciona.
- **Recomendación R31-C:** revisar `traitScale` y topes con el simulador, o expresar efectos por sesión ("≈ +9 minerales por barra de energía").

## B-11 — Nivel del trabajador sin fuente

- **Problema:** la afinidad depende del nivel (`levelFactor`). La UI necesita leer `pokemon_xp.level` del jugador para esa especie. La demo usa un control.
- **Pendiente R32:** junto con B-02.

## B-12 — Herramientas sin dueño ni ranura

- **Problema:** `ToolInstance` no tiene `ownerId` ni concepto de "equipada". La UI asume una herramienta equipada por tipo.
- **Recomendación R32:** tabla `tool_instances` con `user_id` y `equipped_kind`, única por usuario y tipo, igual que el esquema propuesto en R31-A §8.3.

## B-13 — El procesado no cuesta energía

- **Problema:** el ejemplo de UX mostraba "Energía: 3" en una poción. R31-A (D7) decidió coste 0 para no doble-regular.
- **Estado:** la pantalla lo explica. **Decisión para el equipo:** mantener D7 o agregar un coste pequeño. Simularlo en R31-C, porque afecta la sobreoferta.

## B-14 — T2/T3 lejos del spawn

- **Problema:** en Pradera Brisa (semilla 208) los nodos T1 están a menos de 25 casillas del spawn, pero hierro, cúmulo y banco costero están a unas 35 y oro, pino boreal y flor de escarcha a unas 105. Pradera es la única zona wild compartida en R30.
- **Pendiente:** decidir si esa distancia es deseada (exploración) o si conviene ajustar `ZONE_RING_TILES` o las anclas.

## B-15 — Anclas no sólidas

- **Problema:** el navegador de WildLands solo dispara `interact()` al llegar junto a un obstáculo sólido o un actor. Orilla, pasto alto y cristal no son sólidos: tocarlos de lejos camina encima y no abre el panel. Hay que tocar de nuevo estando al lado.
- **Alternativas:**
  - A: el motor consulta `onWorldObject` también al llegar a destino;
  - B: tratar las casillas de nodo como "interactuables" en el navegador.
- Las dos tocan el motor, así que no se implementaron.

## B-16 — Sin agregación de equipo

- **Problema:** no existe la función que combina líder y asistentes. La UI muestra el equipo como concepto y calcula solo con el líder, igual que R31-A.
- **Pendiente:** aprobar el modelo de equipo y luego implementar `aggregatePartyBonuses` en el dominio.

## B-17 — Textos de presentación fuera del catálogo

- **Problema:** las etiquetas de acceso ("Roca dura: …"), de estación, de tipo y de herramienta viven en `ui/`. Si cambian las reglas del catálogo (p. ej. el stat mínimo), el texto queda desincronizado.
- **Recomendación:** que `AccessRule` o el catálogo aporten `label`, o que el texto se genere desde la regla.

## B-18 — Pesca: el timing no afecta el resultado

- **Problema:** el resolver no recibe una entrada de habilidad. Reaccionar bien solo evita perder el intento. El prototipo cobra energía únicamente al atrapar.
- **Pendiente:**
  - si el timing debe dar calidad o bonus (cambio de contrato);
  - si cobrar solo al atrapar es aceptable. Un bot también puede cronometrar: la ventana es identidad, no anti-bot.

## B-19 — WildLands sin recorrido local

- **Problema:** en esta estación no hay `.env` real ni servidor realtime.
  - La app no arranca sin variables de Supabase (B-22); se usaron valores ficticios.
  - Sin presencia R30, el jugador queda como espectador (`setPresenceAccess('pending')`) y no puede caminar ni tocar.
- **Verificado:** typecheck, el hook (sin efecto si devuelve `false`), el aislamiento dev y la ausencia en `dist/`.
- **No verificado:** abrir el panel caminando en Pradera.
- **Acción:** que una persona con entorno completo lo pruebe antes de aprobar R31-B (ver handoff).

## B-20 — Playground en móvil

Los controles ocupan la primera pantalla y el panel queda debajo. Convendría hacerlos plegables. Es una herramienta interna.

## B-21 — `game.ts` crece

`game.ts` ya pasaba las 600 líneas antes de R31-B. R31-B suma unas 15 líneas de hook. El desglose de responsabilidades de `AGENTS.md` §6 sigue pendiente, sin cambios nuevos.

## B-22 — La app requiere variables de Supabase

`app/bootstrap` importa `useAuth`, que crea el cliente Supabase y lanza un error si faltan variables. Es preexistente y ajeno a R31-B, pero complica herramientas de desarrollo aisladas como el playground.

## B-23 — Recuadro de feedback vacío

Tras cambiar el viewport a móvil apareció un recuadro de feedback vacío, que se completa al actuar de nuevo. Probable reinicio de la animación de entrada. Es menor y no se reprodujo de forma estable.

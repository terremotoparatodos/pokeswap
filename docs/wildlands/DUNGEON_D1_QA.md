# D1-QA — Auditoría visual y funcional del prototipo Dungeon/PvE

> **Base auditada:** `integration/r31` @ `1170a0c1cb41883dd06a989c8dc6220ba347b31b` (HEAD local = remoto; árbol limpio).
> Estación: **principal**. Fecha: 2026-09-18. Entorno: Vite dev en `http://localhost:5188/dev/dungeon`, `.env.local` con placeholders (ignorado por Git).
> **No se cambió código, tests, snapshots, configuración ni diseño de producto.** Este informe es lo único que se agrega.
> El `PRE-R32 HUMAN PROFESSION GATE` **sigue abierto** y es independiente de esta QA.
> Integración auditada previamente: [`DUNGEON_PROTOTYPE_INTEGRATION.md`](DUNGEON_PROTOTYPE_INTEGRATION.md).

## 0. Cómo se ejecutó

El panel del navegador de esta estación **no ejecuta `requestAnimationFrame` de forma continua**: solo pinta cuadros a demanda (se midió `rAF = 0` cuadros en 500 ms sin captura). El prototipo es de tiempo real, así que:

- lo que es **estado y UI** se verificó de punta a punta (pantallas, HUD, CTAs, transiciones, avisos, diálogos);
- lo que exige **muchos segundos de reloj** (ganar un combate golpe a golpe, perder, capturar) **no se pudo observar** y queda para una pasada humana.

Los errores de Supabase/WebSocket por los placeholders no cuentan como hallazgos.

## 1. Casos ejecutados y resultado

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| 1 | **Piso normal y escalera** | ✅ | Entrada a "Caverna Ígnea" (seed 764317, tema volcánico). Jugador en la entrada (9,10), escalera en (76,24). Alcanzable a pie con todos los bloques puestos. HUD: PISO 1/16, TIER B, reloj, llave, botín, party 6/6 y el requisito del piso. `↩ Retirarse` siempre visible |
| 2 | **Movimiento** | ✅ | Tap-to-walk movió al jugador (9,10) → (8,10) → (7,10). D-pad presente |
| 3 | **Recovecos opcionales** | ✅ | El piso trae 2 recovecos, cada uno sellado por un bloque de cristal en su boca (abren 11 y 28 tiles). Sellados, la escalera sigue alcanzable (993 de 1.029 tiles) |
| 4 | **Barrido de generación** (ejecutado en vivo con los módulos reales) | ⚠️ ver F-1 | 210 pisos (15 semillas × 7 biomas × 2 niveles): 0 con escalera inalcanzable por bloques; **32 con escalera inalcanzable si no se rompe el decorado**; 0 pisos sin recoveco; 2–3 recovecos por piso |
| 5 | **Lago / puente** | ✅ | El piso 1 tiene 38 tiles de agua y 21 de puente. Agua **no** caminable, puente caminable, escalera alcanzable |
| 6 | **Requisitos de profesión en UI** | ✅ funciona / ⚠️ semántica | Chip del HUD "Minería Nv. 20" (lo más duro del piso); CTA al acercarse: "⛏ Peñasco · Minería Nv. 5". Profesión, nivel e ícono legibles. **Es informativo:** ver D-1 |
| 7 | **Despejar un obstáculo** | ✅ | Peñasco (Minería Nv. 5) despejado con un party sin nivel de Minería. Log: "Peñasco: despejado. El paso queda abierto." **No otorgó recursos** (botín e inventario sin cambios) |
| 8 | **Huida de combate** | ✅ | `Combate ya` → Geodude. `Huir` → `outcome: aborted`, aviso «Te escapaste · Geodude sigue en el piso», fase vuelve a `exploring` y el rival sigue en el piso con su CTA |
| 9 | **Sala Alpha: entrada** | ✅ | `Boss ya` en el piso 16/16: fase `boss`, Vulpix Nv. 42 con modificadores de Alpha, dos aliados en cancha y la barra propia con `↩ Salir de la sala` y `⇤ Abandonar la Dungeon` |
| 10 | **Salir de la sala** | ✅ | Aviso «Saliste de la sala · La puerta del Alpha sigue abierta». Jugador de vuelta en la antecámara (23,32), fase `exploring`, expedición `active`, CTA «⇩ Antecámara del Alpha» para volver |
| 11 | **Reentrada** | ✅ | La antecámara muestra el party con su HP y avisa "Acá no se cura nada". `ENTRAR` reinicia la pelea con el Alpha |
| 12 | **Abandonar la Dungeon** | ✅ funciona / ⚠️ ver F-2, F-4 | Diálogo «¿Abandonar la Dungeon? Asegurás todo el botín y las capturas…» con `Sí, salir` / `Seguir explorando`. Al confirmar: fase `ended`, expedición `retreated`, pantalla "EXTRACCIÓN COMPLETA · Asegurado: nada · 0 capturas" |
| 13 | **Retirada desde un piso normal** | ✅ funciona / ⚠️ ver F-4 | `↩ Retirarse` abre el mismo diálogo de abandono |
| 14 | **Mobile 375 px** | ✅ con F-3 | Sin scroll horizontal (overflow 0). Canvas 335 px. HUD y chips envuelven bien. D-pad 48 px, `CORRER` y `↩ Retirarse` 44 px. Aviso y diálogo legibles y dentro de pantalla |
| 15 | **Duplicación de avisos** | ✅ | Nunca se vio más de un aviso a la vez; el nuevo reemplaza al anterior y se limpia solo al correr cuadros |

## 2. Casos **no verificables** en este entorno

| Caso | Motivo |
|---|---|
| Victoria en combate normal y su aviso | Requiere que la barra de acción se llene en tiempo real; el panel solo pinta a demanda |
| Derrota y wipe | Ídem |
| **Captura** y su aviso | Ídem; no se logró resolver un lanzamiento de ball |
| **Victoria contra el Alpha** y el cierre intencional de la run | Ídem. Sí se verificó que salir de la sala **no** cierra la run |
| Traducción de cambios de estadística ("Gruñido: -1 attack") | No apareció ningún cambio de stats en los turnos observados. El código de traducción existe y está en `CombatPopup.vue` |
| Recorrido completo de 16 pisos y escaleras encadenadas | Costo de tiempo; se verificó por piso y por barrido de generación |

**Recomendación:** que una persona haga estos seis casos en un navegador normal.

## 3. Hallazgos

| ID | Clase | Hallazgo |
|---|---|---|
| F-1 | **P1** | **El decorado puede cerrar el piso.** En 32 de 210 pisos generados (15 %), la escalera **no** es alcanzable si no se rompe algún prop sólido del suelo. La promesa "un bloque nunca cierra un piso" se cumple para los bloques de recoveco, pero **no** para el decorado. Hoy no es soft-lock porque despejar no valida nivel (D-1); pasaría a **P0** el día que el requisito bloquee de verdad, o si un prop pidiera una herramienta que el jugador no tiene. Ejemplos: `1/cave/f1`, `2/ruin/f1`, `2/glacier/f3`, `3/ruin/f3` |
| F-2 | **P2** | Al abandonar **durante** la pelea con el Alpha, el panel de combate queda dibujado detrás de "EXTRACCIÓN COMPLETA", con sus movimientos y el texto "El combate empezó" |
| F-3 | **P2** | A 375 px, los botones **dentro** del combate miden 28 px de alto (`Huir`, `Cambiar`, `Mochila` y los cuatro movimientos), por debajo de los 40–48 px que usa el resto del proyecto. Fuera de combate los controles están bien |
| F-4 | **P2** | Inconsistencia de nombres: el botón dice `↩ Retirarse` y `⇤ Abandonar la Dungeon`, pero ambos abren el mismo diálogo «¿Abandonar la Dungeon?». Salir de la sala del Alpha, en cambio, sí es claramente distinto |
| F-5 | **P2** | La vida del aviso depende del bucle de render: si la pestaña no pinta, el aviso queda en pantalla más de 2,6 s. En un navegador normal se limpia solo (verificado al forzar cuadros) |
| D-1 | **DECISIÓN ABIERTA** | **El requisito de profesión es informativo.** Se despejó un peñasco que pide "Minería Nv. 5" con un party sin nivel de Minería: `clearProp` no valida nivel ni herramienta. El texto parece una condición y no lo es. Decidir si bloquea (y entonces resolver F-1 antes) o si se reformula como información |
| D-2 | **DECISIÓN ABIERTA** | Los niveles altos del catálogo **nunca se muestran**: como se cita el nodo más barato de cada material, oro (30) y madera dura (15) son inalcanzables. Los valores visibles son 1, 5, 8, 15 y 20 |
| D-3 | **DECISIÓN ABIERTA** | **Semántica de "captura"** (ya abierta como I-1): el prototipo trata la captura como botín de expedición que se asegura al extraer. No se pudo observar una captura real. Pendiente decidir si otorga un Pokémon persistente y cómo se relaciona con el party de 6 |
| P-1 | **PREEXISTENTE** | Errores de red de Supabase y WebSocket por los placeholders locales |

No se encontró **ningún P0**: ni crash, ni soft-lock reproducido, ni pérdida o duplicación de botín (se verificó que el botín queda intacto al huir, salir de la sala, reentrar y abandonar).

## 4. Mobile

Aprobado con F-3. Sin scroll horizontal, canvas y HUD correctos, controles de exploración con área táctil suficiente, avisos y diálogos dentro de pantalla.

## 5. Verificación automática

| Check | Resultado |
|---|---|
| `npx vitest run` | **104 archivos / 1.122 tests** verdes |
| `npm run typecheck` | exit 0 |
| `npx eslint .` | 0 errores (9 warnings previos de `AuthModal.vue`) |
| `npm run build` | OK |
| `npx vitest run src/features/professions/overlayTrace.test.ts` (sin `-u`) | 15 tests verdes |
| md5 del snapshot congelado | `334b1e04eb1e40f528f313573d4ac618` ✔ |
| Aislamiento de `dist/` | 0 coincidencias de `dungeonPrototype`, `PlayDungeon`, `dev/dungeon` |
| `git status --short` | limpio |

## 6. Recomendación

**APTO PARA DISEÑO DE CONSTRUCCIÓN/HORNO**, con dos condiciones que no son de código:

1. **F-1 y D-1 se deciden juntos antes de que el requisito de profesión bloquee.** Mientras el requisito sea informativo no hay soft-lock; si se vuelve bloqueante, primero hay que garantizar la ruta sin romper decorado.
2. **D-3 (captura)** debe resolverse antes de diseñar persistencia de Dungeon.

F-2, F-3, F-4 y F-5 son polish y no bloquean el diseño de Construcción ni del Horno, que dependen de profesiones y economía, no de este prototipo.

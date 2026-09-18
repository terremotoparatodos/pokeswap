# Dungeon / PvE — Registro de integración (estación principal)

> Rama integrada: `feat/d1-2-4-obstacles-combat` @ `ef4ff852357b5f3dd399a111b13ef1fe4412efff`.
> Destino: `integration/r31`, merge commit `73e97ab` (`--no-ff`, sin squash ni rebase; se conservan los 42 commits de la estación secundaria).
> **No se mergeó a `main`.** El `PRE-R32 HUMAN PROFESSION GATE` sigue abierto.
> Documentos de la entrega (de la estación secundaria): `DUNGEON_PVE_PROTOTYPE.md`, `DUNGEON_PVE_D1_*.md`, `BATTLE_DATA_GAP_REPORT.md`.

## 1. Qué se integró

El **prototipo completo de Dungeon/PvE** (D1 → D1.2.4ter), no solo los dos archivos informados: 80 archivos nuevos y 15.946 líneas en `src/features/dungeonPrototype/` (dominio, render, mundo, componentes, fixtures y tests), 8 documentos en `docs/wildlands/` y 7 líneas en `src/app/router/routes.ts`.

- El **Dungeon legacy (`src/features/dungeon/`) no se tocó**: la entrega vive en una carpeta nueva, `dungeonPrototype`, coherente con la decisión de clean-slate (`PRE_R32_DESIGN_DECISIONS.md` A-13, A-14).
- La ruta `/dev/dungeon` se registra **solo** con `import.meta.env.DEV`, igual que `/dev/profesiones`. Verificado: no aparece nada del prototipo en `dist/`.
- **No** hay Supabase, realtime, migraciones, persistencia ni cambios de economía o balance de producción.
- Las profesiones no se modificaron: el snapshot del baseline sigue en `334b1e04eb1e40f528f313573d4ac618`.

## 2. Garantías verificadas

**Escalera alcanzable.** `reachStairs` (en `domain/floorTiles.ts`) corre al final de la generación: si la salida no es alcanzable desde la entrada, cava hasta ella con el mismo ancho de galería lateral y puentea el agua. El test de barrido de `floorSpace.test.ts` recorre 40 semillas × 7 biomas × 3 pisos = **840 pisos** y exige la lista de rotos vacía. El commit habla de 6 de 2.520 antes y 0 de 2.520 después; el barrido versionado cubre 840, no 2.520.

**Recovecos opcionales.** `carveAlcoves` los excava en roca sólida al costado de la ruta: boca de un tile, garganta y cámara, sin tocarse entre sí. `placeObstacles` pone un bloque solo en la boca, nunca en la entrada ni en la escalera, y **solo si al sellarla la salida sigue siendo alcanzable**. Los tests verifican, por semilla, que sellar una boca corta exactamente lo que hay detrás y nada más, que despejarlas todas devuelve el piso entero y que lo sellado nunca supera el 20 % del suelo.

**Sala del Alpha.** `settleCombat` distingue tres finales: salir de la sala (`aborted` en fase boss) devuelve al jugador a `tiles.boss.approach`, deja la fase en `exploring` y **no termina la run**; ganarle al Alpha la termina; abandonar la Dungeon es un botón distinto con confirmación. Huir de un combate normal solo cuesta el combate.

**Requisitos de profesión.** `QUOTED_NODES` copia 8 nodos del catálogo de producción (roca 1, carbón 5, hierro 15, cristal 20, oro 30, árbol 1, pino 8, madera dura 15). `obstacles.ts` **no importa** el dominio de profesiones; solo `obstacles.test.ts` lo hace, y compara nivel, tier de herramienta, profesión y anchors contra `GATHERING_NODES`: falla el día que el catálogo cambie. El HUD del piso, la etiqueta del bloque y el CTA leen la misma función (`floorRequirements` / `requirementForObstacle`).

**Obstáculos.** Ya no hay barreras genéricas de pared a pared: solo un bloque de un tile en la boca de un recoveco (derrumbe, cristal, raíces o tronco, según bioma) y los props sólidos que ya estaban en el suelo. Despejar no da recursos.

**Avisos de combate.** `PlayDungeon.vue` los emite al resolverse un combate real (capturado, ganado, Alpha derrotado, saliste de la sala, te escapaste, perdido), 2.600 ms y se limpian solos en el mismo bucle. Los cambios de estadística se traducen ("Gruñido: -1 attack" → "… le bajó el ataque al rival").

## 3. Verificación

| Check | Resultado |
|---|---|
| `npx vitest run` | **104 archivos / 1.122 tests** verdes |
| `npm run typecheck` | exit 0 |
| `npx eslint .` | 0 errores (9 warnings previos de `AuthModal.vue`) |
| `npm run build` | OK |
| Aislamiento de `dist/` | 0 coincidencias de `dungeonPrototype`, `PlayDungeon`, `dev/dungeon`, `DungeonStage`, `GeneratorLab`, `AlphaBossLab`, `CombatPopup` |
| `professionsIsolation.test.ts` + `overlayTrace.test.ts` | 22 tests verdes, md5 `334b1e04eb1e40f528f313573d4ac618` |
| Manual | `/dev/dungeon` carga con sus 7 laboratorios; sin errores más allá de la red del Supabase placeholder. **No** se hizo un recorrido manual profundo de pisos, recovecos, lago/puente ni Alpha |

## 4. Limitaciones y trust boundary

- Es **prototipo de cliente**: dominio puro y laboratorios dev. No tiene autoridad ni persistencia.
- La captura, el botín, las recompensas de boss y el progreso de expedición viven **solo en memoria del cliente**. Eso es aceptable como prototipo y **no** como arquitectura final.
- **Los rewards de Dungeon serán server-authoritative**: RNG, elegibilidad, escrow de botín y progreso los decide el servidor (R32-0). `domain/rewards.ts` ya lo declara y se mantiene como contrato.
- Números de combate, captura, tiempos y loot son parámetros de playtest, no balance aprobado.

## 5. Conflictos y observaciones abiertas

| # | Observación | Estado |
|---|---|---|
| I-1 | **"Captura" y la nueva dirección de Pesca.** El aviso «¡X capturado! Queda en el botín hasta que salgas de la Dungeon» pertenece al loop de Dungeon: es captura real de un Pokémon como botín de expedición, que se pierde en un wipe (`domain/capture.ts`). No es la fantasía de Pesca, que ya **no** captura (`PRE_R32_DESIGN_DECISIONS.md` A-4). No se corrigió nada. Falta decidir: si la captura en Dungeon otorga un Pokémon persistente, y cómo se relaciona con el party de 6 (A-1) | **Conflicto de diseño abierto** |
| I-2 | El barrido versionado cubre 840 pisos, no los 2.520 que informa el commit | Documentado |
| I-3 | `requirementOf` elige el nodo **más barato** que comparte material. Por eso el piso nunca puede pedir `gold_vein` (30) ni `hardwood_tree` (15): sus anclas también pertenecen a nodos más baratos. Los niveles que el jugador puede llegar a ver son 1, 5, 8, 15 (hielo) y 20 (cristal) | Documentado; decidir si es lo deseado |
| I-4 | El requisito es **informativo**: nada impide hoy despejar sin el nivel. La semántica real es "esto pide Minería Nv. N", no un bloqueo por nivel | Documentado; falta decidir la semántica final |
| I-5 | El anti-drift verifica que los 8 nodos citados no cambien, pero no detecta que el catálogo **agregue** un nodo más barato para un material | Deuda menor |
| I-6 | `DUNGEON_PVE_D1_2_4_OBSTACLES_COMBAT.md` describe en su §1 las barreras de pared a pared que D1.2.4ter **reemplazó** por bloques de un tile | Deuda documental de la estación secundaria |
| I-7 | La entrega informó 2 archivos modificados; el alcance real fue de 80 archivos y 42 commits | Registrado para futuras delegaciones |

## 6. Decisiones siguientes

1. Resolver I-1 (semántica de captura) antes de diseñar la persistencia de Dungeon.
2. Decidir la semántica del requisito de profesión (I-3, I-4): informativo o bloqueante, y si el nivel exigido debe ser el del material o el del nodo más caro.
3. R32-0 debe cubrir los rewards de Dungeon, además de las acciones de profesión.
4. El brief definitivo de Dungeon para la estación secundaria lo prepara el usuario.

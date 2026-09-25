# WORLD ↔ SKILLS — contrato de integración

> Para la estación **WORLD-1**. Qué llama WORLD, qué responde SKILLS, qué es de quién y cómo se conecta al servidor.
> Código: `src/features/skills/service/` (API y puertos) y `src/features/skills/domain/` (reglas). Ambos son TypeScript puro: sin Vue, DOM, red, storage ni `Math.random` (lo garantiza `skillsIsolation.test.ts`).

## 1. Quién decide qué

| Pregunta | Dueño |
|---|---|
| ¿Existe el nodo/parcela? ¿Dónde? ¿Qué estado tiene? | **WORLD** |
| ¿El jugador está al lado, en la misma área? | **WORLD** |
| ¿El Pokémon es del jugador? ¿Ya está trabajando? | **WORLD** |
| ¿Está agotado? ¿Cuándo reaparece? ¿Qué ve el resto? | **WORLD** |
| ¿El jugador tiene nivel para esto? | **SKILLS** |
| ¿Este Pokémon puede / qué tan bien lo hace? | **SKILLS** |
| ¿Cuánto dura? ¿Cuánta XP? ¿Qué items? | **SKILLS** |
| ¿La transición de parcela pedida es legal? | **SKILLS** (valida lo que WORLD reporta; no cambia nada) |

SKILLS nunca escribe `node.state`. WORLD nunca escribe `if level >= 10`.

## 2. Flujo

```
cliente: "trabajar nodo N con Pokémon P"
  └─▶ WORLD (servidor)
        valida: nodo existe, misma área, distancia, disponible, P es del jugador, P libre
        mint actionId (único, p. ej. uuid)
        └─▶ skills.authorizeWorkAttempt({ actionId, playerId, worker: { instanceId, speciesId }, target })
              ◀── { allowed: true, durationMs, xp, reward, skillId, aptitude, expiresAt, rulesVersion }
              ◀── { allowed: false, reason, message: "Requiere Minería 20", requiredLevel, ... }
        si allowed: marca P y N como ocupados, difunde "P trabaja N" (AOI), arranca timer durationMs
        al vencer el timer:
          consume la carga del nodo / avanza la parcela (WORLD)
          └─▶ skills.settleWork(actionId, { outcome: 'completed' })
                ◀── { status: 'settled', settlement: { xpGained, rewards, levelBefore, levelAfter }, unlocks, levelUpLine }
        si el jugador se va / desconecta / se cancela:
          └─▶ skills.settleWork(actionId, { outcome: 'cancelled' })   // cierra sin pagar
        reenvía el resultado al cliente del jugador
```

### Targets

```ts
type WorkTarget =
  | { kind: 'gather'; resourceId: ResourceId }                                   // árbol / roca
  | { kind: 'farm'; action: 'plant' | 'tend' | 'harvest'; plot: PlotSnapshot; cropId?: CropId }

interface PlotSnapshot {
  plotId: string
  kind: 'town' | 'fertile'
  stage: 'EMPTY' | 'PLANTED' | 'GROWING' | 'READY'
  cropId: CropId | null   // desde PLANTED
  tended: boolean
}
```

`resourceId` es el id de arte que la escena ya dibuja: `common_tree`, `pine_tree`, `hardwood_tree`, `boreal_tree`, `stone_outcrop`, `coal_seam`, `iron_vein`, `gold_vein`, `crystal_cluster`.

### Agricultura: quién mueve el estado

| Acción | WORLD antes de llamar | SKILLS valida | WORLD al completar |
|---|---|---|---|
| `plant` | parcela libre y del jugador | `stage === 'EMPTY'`, cultivo existe, `plot.kind` permitido, nivel | `stage = PLANTED`, `cropId`, `readyAt = now + crop.growMs` |
| `tend` | — | `PLANTED`/`GROWING`, `!tended`, nivel | `tended = true` |
| `harvest` | `now >= readyAt` → `READY` | `stage === 'READY'`, nivel | `stage = EMPTY`, `cropId = null`, `tended = false` |

`crop.growMs` lo publica SKILLS (`CROPS` en `domain/farming.ts`); el reloj lo corre WORLD.

## 3. Garantías del servicio

- **Idempotencia por `actionId`.** Un segundo `settleWork` del mismo `actionId` devuelve `already_settled` con el **mismo** settlement, sin conceder nada. Un `authorizeWorkAttempt` con un `actionId` ya usado devuelve `duplicate_action`.
- **Términos congelados.** `settleWork` usa lo que se autorizó (recurso, aptitud, drop). WORLD no puede cambiar la recompensa en el settle.
- **Sin pago anticipado.** `completed` antes de `durationMs − 250 ms` → `too_early` (no cambia nada; WORLD puede reintentar).
- **Vencimiento.** Una autorización de más de 10 min se cierra como `cancelled` sin pago.
- **Carrera de commits.** Si dos instancias liquidan a la vez, gana una; la otra recibe `already_settled`.
- **Entrada hostil.** ids vacíos/largos, especie no entera, target nulo → `invalid_request`.

## 4. Puertos que el servidor implementa

`service/ports.ts`:

```ts
interface SkillProgressStore { xpOf(playerId): Record<SkillId, number> }
interface WorkLedger {
  authorization(actionId): AuthorizedWork | null
  recordAuthorization(work): boolean          // false si el actionId ya existe
  settlement(actionId): WorkSettlement | null
  commitSettlement(settlement): boolean       // UNA transacción: insert único + XP + items; false si ya existía
}
interface Clock { now(): number }
type RandomSource = () => number              // RNG del servidor (AGENTS §11)
```

`memoryAdapters.ts` es la implementación de referencia (tests y playtest local). La versión con base de datos está propuesta en `PROPOSED_PERSISTENCE.sql` (sin aplicar).

## 5. Cómo llevarlo al servidor realtime

`services/realtime` es CommonJS JS y hoy no importa nada de `src/`. Opciones, en orden de preferencia:

1. **Bundle del dominio** — `esbuild src/features/skills/service/skillsService.ts --bundle --platform=node --format=cjs` genera un módulo sin dependencias (no hay imports externos en `domain/` ni `service/`). Versionarlo junto con `rulesVersion`.
2. Mover `domain/` + `service/` a un paquete compartido del workspace si WORLD ya planea uno.

No reescribir las reglas en JS a mano: se desincronizan.

## 6. Qué reemplaza WORLD-1 en el cliente

| Hoy (pre-WORLD, `skills/localWorld/`, `skills/local/`) | Con WORLD-1 |
|---|---|
| `nodePlacement.ts` deriva nodos del seed | ResourceNode del servidor (id, posición, estado) |
| `nodeCharges.ts` cargas por sesión | depletion/respawn compartidos |
| `localSkillsSession.begin/complete` | intents al servidor + resultado por mensaje |
| `useSkillsLayer` llama a la sesión local | llama al puerto de red; mismas refs para la UI |

La escena (`skills/scene/`) sólo necesita `nodeState(target) → { status, remainingCharges, respawnInSeconds }` y un `targetAt(area, tx, ty)`. WORLD puede alimentar ambos desde su estado AOI sin tocar el arte. `workerSpeciesId` en `start()` dibuja al Pokémon trabajando; que **los demás** lo vean es de WORLD.

## 7. Datos que SKILLS publica para WORLD (consultivos)

- `RESOURCES[].world`: hábitats, anillo mínimo, anclas de decor, peso, cargas `[min,max]`, respawn.
- `PLOT_WORLD_HINTS`: dónde van las parcelas y cuántas por jugador.
- `CROPS[].growMs`.

Son **recomendaciones**; SKILLS nunca los lee para decidir. Si WORLD elige otros valores, las reglas no cambian.

## 8. Checklist de integración

- [ ] WORLD mintea `actionId` único por intento y lo reusa en reintentos del mismo intento.
- [ ] Settle siempre, también al cancelar (libera el `actionId` y el ledger queda cerrado).
- [ ] Consumir la carga y liquidar como una sola operación lógica: si `settleWork` devuelve `too_early`, no consumir; si la carga ya no existe, liquidar `cancelled`. (La sesión local liquida primero y consume después sólo si pagó.)
- [ ] RNG del servidor en `RandomSource`.
- [ ] `commitSettlement` transaccional con unicidad de `action_id`.
- [ ] Borrar `skills/localWorld/` y la parte física de `skills/local/` cuando WORLD-1 sea la fuente.
- [ ] Mensaje al cliente con `settlement`, `unlocks`, `levelUpLine` (la UI ya los muestra).

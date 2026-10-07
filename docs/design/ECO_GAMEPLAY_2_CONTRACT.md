# ECO-GAMEPLAY-2 — Contrato: reserva y combate de prueba (sandbox)

**Base:** `integration/world-skills-0.3` @ `d5d54be` (remoto verificado). Rama `feat/eco-gameplay-2-0.3`.

**Alcance:** solo dentro del experimento de desarrollo de ECO-GAMEPLAY-1 (`WORLD_ECO_EXPERIMENT=on` y `NODE_ENV≠production`; cliente DEV con `VITE_ECO_EXPERIMENT=on`). Con el experimento apagado no cambia nada.

**Sin:** captura, ownership, XP, drops, tokens, base de datos ni persistencia. Tampoco cambian geometría, elegibilidad de casillas, capacidades, rarezas, respawn ni ocupación dinámica.

## 1. El core existente alcanza (no se amplía)

**FACT:** `src/features/battle/authority` ya es una autoridad de combate de servidor:
- reloj y semilla propios, validación de intents no confiables y ledger idempotente de `actionId`;
- `JoinAck` para reconexiones y un snapshot de cliente sin el RNG.

**FACT:** el lado salvaje no necesita IA: actúa por la regla de *fallback* del core (repite su último movimiento o, si no, el primero utilizable).

**FACT:** `expeditionRoomCore.ts` anticipa que el servicio realtime (JS sin build) lo consuma **empaquetado**.

**DECISIÓN:** un bundle generado nuevo, `encounterBattle.generated.js`, envuelve el core sin modificarlo:
- **Mismo patrón que el bundle de admisión:** esbuild, reproducible, con `--check` y test de deriva.
- **Catálogo:** incluye el de batalla (`core`, `moves`, `learnsets`, unos 1,4 MB de JSON); es empaquetado, no lógica nueva.
- **No se toca:** ninguna regla, ningún cálculo de daño y ninguna tabla del core.

## 2. Fixtures de prueba (no son balance)

Los fixtures están nombrados como tales: `ECO_SANDBOX_FIXTURE`, `fixture: true` en el protocolo, y el panel los muestra como «fixture de prueba».

**Equipo del jugador.** Es un único Pokémon sintético, igual para todos los jugadores:
- especie, nivel y movimientos fijos en el fixture, todos ejecutables según `isExecutable` y validados al cargar;
- `ownerId: 'eco-sandbox-fixture'`, que no es un dueño real;
- IVs perfectos, EVs cero y naturaleza neutra, como en `sampleBattles`.

**Rival.** Es la especie del encuentro ECO, con un nivel fijo de fixture:
- movimientos: los últimos 4 movimientos *level-up* ejecutables con nivel ≤ el del fixture, según su learnset;
- si la especie no tiene ninguno, el combate no se ofrece (`battle-unavailable`).

**Fallo cerrado:** si el catálogo o los fixtures no cargan, no hay combates (`battle-unavailable`). La población sigue igual.

## 3. Estados de una reserva

```
libre ──engage OK──► reservado(jugador, battleId) ──┬─ victoria ──► retirado (para todos, una vez) → ciclo de respawn existente
   ▲                                                ├─ derrota ───► libre
   │                                                ├─ huida ─────► libre
   └────────────────────────────────────────────────┼─ vencimiento ► libre
                                                    └─ desconexión ► (pausa) ─ gracia vencida ► libre
                                                                         └─ reconexión del mismo jugador ► reservado (reanuda)
```

**Engage (`world:eco-engage {requestId, encounterId}`).** Lo valida el servidor, en este orden:
1. experimento y combates disponibles;
2. el que pide es jugador (no invitado);
3. el jugador no tiene otra reserva: **una por jugador**. Si pide la misma que ya tiene, recibe la reanudación y no un combate nuevo;
4. el encuentro está vivo en la población admitida (id individual vigente);
5. está en la misma área que el jugador;
6. la distancia de Chebyshev desde el tile del jugador al tile del encuentro es como mucho `ECO_ENGAGE_RANGE = 6` (correa de patrulla 4 + 2);
7. el encuentro no está reservado por otro: `busy`.

Si todo pasa, se crea la autoridad de combate (semilla del servidor, reloj de combate propio).

**Ocupado para los demás:**
- la vista pública del área marca el encuentro con `busy: true`, y los demás lo ven «ocupado»;
- no pueden reservarlo ni hacerle una retirada de prueba (`busy`).

**Acciones (`world:eco-battle-action`):**
- es el `TransportAction` del core, y el `controllerId` sale del transporte (el id del jugador), nunca del payload;
- se aceptan solo los intents `useMove`, `switch` y `clearSelection`;
- `capture` y `useItem` se rechazan (`not-allowed-in-sandbox`) antes de llegar al core;
- el core valida el resto: secuencia, combatiente, objetivo y versión.
- **El cliente nunca declara el resultado:** el servidor lo resuelve con `BATTLE_ENDED`.

**Victoria** (`BATTLE_ENDED` con el lado del jugador ganador, por debilitamiento):
1. se cierra la reserva **antes** de retirar;
2. se llama una sola vez a `retire(encounterId)` de la población admitida, con causa `defeated`, que es simulación;
3. el ciclo de respawn existente sigue igual.

Una segunda retirada del mismo id, venga de donde venga, es un no-op (`not-alive`).

**Derrota, huida (`world:eco-flee`) o vencimiento:** liberan la reserva y el Pokémon sigue en el mundo.

**Vencimiento.** `ECO_BATTLE_MAX_MS = 120 000` ms de **tiempo de combate**: el reloj del combate solo avanza mientras el dueño está conectado.

## 4. Desconexión y reconexión

- **Pausa:** al irse el socket del dueño, el combate **se pausa (su reloj no avanza)**. No hay daño ni resultado mientras no está.
- **Gracia:** si el **mismo jugador** vuelve antes de `ECO_DISCONNECT_GRACE_MS = 15 000` ms de reloj de servidor, recibe el snapshot y un `JoinAck` (próxima secuencia de `actionId`), y el combate sigue.
- **Fin de la gracia:** sin regreso, se libera (`disconnected`) sin retirar.
- **La reconexión no duplica:**
  - nunca crea un segundo combate, porque hay una reserva por jugador;
  - no puede tomar otra reserva mientras tenga una;
  - las acciones repetidas o viejas las rechaza el ledger del core (`STALE`/duplicadas).
- **Nadie más se apropia:** mientras dura la gracia, otro jugador ve el encuentro `busy`.

## 5. Protocolo (agregados a `worldProtocol.js`, solo experimento)

| Mensaje | Dirección | Contenido |
|---|---|---|
| `world:eco-engage` | C→S | `{ requestId, encounterId }` |
| `world:eco-engage-result` | S→C | `{ requestId, encounterId, ok, reason?, battle? }`; `battle = { battleId, fixture: true, joinAck, snapshot, expiresInMs }` |
| `world:eco-battle-action` | C→S | `TransportAction` del core |
| `world:eco-battle` | S→C (solo al dueño) | `{ battleId, snapshot, events, result? }` tras cada tick con eventos, cada acción y cada reconexión. `result` es el `AuthoritySubmitResult` de la acción, si la hubo. |
| `world:eco-flee` | C→S | `{ battleId }` |
| `world:eco-battle-end` | S→C (solo al dueño) | `{ battleId, encounterId, outcome, retired }`; `outcome` es `victory`, `defeat`, `fled`, `expired`, `disconnected` o `vanished` |
| vista ECO del área | S→C | cada encuentro suma `busy: boolean` |

## 6. Pruebas exigidas

- Dos jugadores disputando el mismo encuentro: uno combate y el otro recibe `busy`.
- Intents inválidos o tardíos:
  - id inexistente o viejo, otra área, distancia y invitado;
  - acción con otro `battleId`, secuencia vieja o duplicada, `capture`/`useItem`;
  - acción después del fin.
- Vencimiento, que libera sin retirar.
- Victoria, que retira una sola vez y respawnea igual.
- Retirada duplicada (victoria más retirada de prueba, o dos victorias), que es un no-op.
- Desconexión: pausa, reconexión dentro de la gracia que reanuda sin duplicar, y gracia vencida que libera.
- Exclusión productiva:
  - sin el experimento no hay combates;
  - el build de producción sin fuentes de batalla ECO ni panel de combate;
  - el bundle no exporta el core suelto.

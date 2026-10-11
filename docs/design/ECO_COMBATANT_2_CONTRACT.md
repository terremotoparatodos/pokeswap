# ECO-COMBATANT-2 — contrato experimental

Base: `81aa16d16035489d53bf906b3718c1edce8e4a6b`. M-1 temporal autorizado el 2026-10-11.

- Identidad: UUID verificado en el join existente; el payload nunca identifica al dueño.
- Modo explícito `synthetic` o `owned` dentro de ECO, apagado/excluido en producción. Owned rechaza benchmarks y nunca cae al fixture.
- Lectura servidor estrecha de slots/progresión con gate WORLD existente. Selección e inicio releen dueño/lock, sin cache positivo ni locks de mercado. Última lectura es una comprobación puntual; no promete atomicidad con ventas.
- Especie/XP/movimientos del slot y del dueño actual; M-1 deriva los campos inexistentes, identificados como proyección en UI. Movimientos desconocidos, ilegales, sin set o no soportados rechazan todo el ejemplar, sin completar/sustituir sets.
- Selección confirmada por servidor, independiente por jugador y conservada en memoria. Reserva activa/gracia impide cambiar; después de lecturas se revalidan sesión, elección y condiciones de engage antes de reservar.
- Snapshot independiente por batalla. Sin persistencia de atributos, desgaste, resultados, curación, captura o recompensas. Core, tiempos, encuentros y privacidad de espectadores conservados.
- Tests y e2e usan adaptadores locales rotulados como pruebas, sin acreditar datos hosted. Ningún deploy, SQL, tabla, dependencia o cambio económico forma parte del incremento.

## Configuración y wire

`WORLD_ECO_EXPERIMENT=on` y `NODE_ENV` distinto de `production` son imprescindibles. `WORLD_ECO_COMBATANT_MODE=synthetic|owned` selecciona un único modo para el proceso; default `synthetic`. Un valor desconocido se rechaza. El sandbox local declara `synthetic` explícitamente; `owned` exige el lector de autoridad existente y falla cerrado si falta. El navegador sigue usando `DEV && VITE_ECO_EXPERIMENT=on`.

Join conserva WORLD=3 y ECO=1; añade `ecoCombatantProtocol=2`. Solo en owned, un cliente sin esa capacidad queda fuera de ECO y recibe `client-outdated` al intentar seleccionar/iniciar. La identidad sigue siendo la del actor/socket autenticado por Supabase en el join existente, nunca una clave del intent. UUID de benchmark o guest no autoriza lecturas owned.

| Canal | Payload owned |
| --- | --- |
| `world:eco-combatant-select` | `{requestId, slotPokemonId}` o `{requestId, refresh:true}`; claves adicionales rechazadas |
| `world:eco-combatant-state` (privado) | `{requestId, ok, reason?, mode:'owned', selectedSlotPokemonId, speciesId, level, attributeSource:'legacy-m1-derived', options}` |
| Cada opción privada | `{slotPokemonId, speciesId, level, eligible, reason?, ignoredStoredLevel?}`; no estadísticas ni progresión de otro jugador |
| `world:eco-engage` | `{requestId, encounterId}` existente; no combatiente declarado por cliente |
| Autoridad server-to-server | `{op:'eco_combatants', userId, slotPokemonId:null|number}`; secret servidor existente + gate `world_skills_access`, operaciones fijas de lectura |

El lector devuelve solo `slots.{pokemon_id,owner_id,is_locked,first_owner_id,owned_since}` y `pokemon_xp.{user_id,pokemon_id,xp,level,moves}` del dueño actual. Para seleccionar/iniciar termina con una nueva lectura de propiedad/lock tras la progresión. Ningún cambio de mercado: una venta posterior a la comprobación puntual no invalida retroactivamente el snapshot en memoria.

## Construcción y concurrencia

La curva existente calcula nivel desde XP; el nivel almacenado discrepante se informa como `ignoredStoredLevel`. El catálogo/learnset ORAS y `isExecutable` validan todos los movimientos: nivel aprendido hasta el actual, o machine/egg/tutor de esa especie. Es legalidad por catálogo, sin inventar historial de aprendizaje. Un set vacío, duplicado, de más de cuatro, desconocido, ilegal o no soportado rechaza el ejemplar completo. No se backfillea.

`migrateLegacySlot` M-1 produce IVs/naturaleza/habilidad/género deterministas, EV=0, forma default, shiny=false y condición `HEALTHY` nueva. El ID interno `legacy-slot:<pokemon_id>` no crea ni persiste una instancia. La marca de proyección es constante, no fecha recuperada de adquisición. UI identifica procedencia y campos derivados; la habilidad del modelo no habilita efectos nuevos del core.

Una operación pendiente por UUID/socket serializa refresco, selección e inicio. Tras la espera comprueba actor vivo, socket actual/capacidad, token de operación, misma elección y ausencia de reserva propia. Engage vuelve a comprobar área, rango de tres casillas, encuentro vivo/libre y espacio antes de crear autoridad e insertar reserva sin otro await. Una respuesta obsoleta no reserva ni confirma otra elección.

Reserva activa o pausada en gracia impide cambios. Reconectar conserva elección y reengancha la misma autoridad; no reconstruye una batalla en curso. Cada nueva batalla relee propiedad/progresión y captura la proyección inmutable. Condición, HP, PP, estado y resultado se descartan al terminar. Espectadores conservan la whitelist existente de especie/nivel/HP/velocidad/escena/eventos públicos; nunca reciben ownerId, instancia, XP, IVs, naturaleza, set privado o joinAck.

No hace falta INSTANCES-2 completa para este puente legacy; múltiples ejemplares por especie y atributos individuales persistidos siguen fuera del contrato.

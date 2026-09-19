# Community Playtest 0.1

> Build temporal para abrir ~2 horas con jugadores reales durante un stream,
> observar, cerrar y volver al roadmap.
>
> **No es** la beta. **No es** R34. **No** cierra arquitectura.
> Prioridad: `PLAYABLE + SAFE + OBSERVABLE` antes que `PERFECTO`.

Base: `integration/pre-r34-town-3d` @ `e0a1581`. Rama: `playtest/community-0.1`.

---

## 1. Auditoría previa (qué había realmente)

Medido sobre el código, no sobre recuerdos.

### 1.1 Lo que ya existe y sirve

| Sistema | Estado real | Consecuencia para el playtest |
|---|---|---|
| Ciudad Corazón 64×51 + modelos 3D | Producción | Se usa tal cual |
| WildLands (5 mundos procedurales) | Producción | Se usa tal cual |
| Presencia multijugador (Colyseus `PresenceRoom`) | Producción, **una sola sala global**, áreas `ciudad-corazon` y `pradera` | Base del chat |
| Profesiones (mining, woodcutting, fishing, alchemy) | Dominio completo + `demoSession` en memoria | **Base de las Skills**: ya es session-only |
| Curva de XP de profesiones | `progression.ts`, niveles 1–60 | Se reusa; no se inventa curva |
| Dungeon prototype (D1.2.4) | Completo, **ruta `/dev/dungeon` sólo en DEV** | Hay que exponerlo con gate |
| `DungeonSpawn` / `DungeonDefinition` | **Ya separados** (`domain/dungeonSpawn.ts`) | §17 del brief ya estaba satisfecho en contrato |
| `PlacedObjects` (F-1) | Producción: sólidez, footprint, picking, navegación | Capa física para las cuevas |
| Party ≤ 6 (`pokemon/model/party.ts`) | **Sólo tests**, sin consumidor productivo | El Centro necesita capa playtest |
| `PokemonConditionState` | Modelo aprobado, **sin persistencia** | Heal se expresa sobre el modelo del prototipo |

### 1.2 Lo que NO existía

- **Chat**: no hay nada. Se construye sobre `PresenceRoom`.
- **Panel de Skills**: las profesiones sólo se ven dentro de sus tarjetas de acción.
- **Centro Pokémon funcional**: la puerta abre `caja` (`MyBoxView`), una lista de
  lectura de los Pokémon poseídos. No cura, no tiene party, no mueve nada.
- **Tienda**: la puerta de la Tienda abre el **Mercado P2P**, no una tienda de ítems.
- **Entradas de Dungeon en el mundo**: no existen; el prototipo se entra por menú DEV.
- **Kill switch / gate / build id / bug report**: no existen.

### 1.3 Superficie persistente real (lo que hay que proteger)

Supabase, vía RLS y Edge Functions:

`profiles` (tokens, cooldowns, multiplicadores) · `slots` (propiedad de Pokémon) ·
`market_listings` · `transactions` · `token_ledger` · `pokemon_xp` · `pokedex` ·
`activity_feed`.

Edge Functions: `pokeswap-swap`, `market-buy`, `market-publish`, `market-cancel`,
`collect-passive-tokens`, `dungeon-start`, `dungeon-reward`, **`kofi-webhook`** (pagos).

**Ninguna de estas superficies se toca durante el playtest.** Ver §5.

---

## 2. Decisión de arquitectura del playtest

### El playtest es un *modo de build*, no una reescritura

Todo lo nuevo entra detrás de una sola llave: `VITE_PLAYTEST`.

- `VITE_PLAYTEST` ausente o `off` → **el producto normal, byte por byte igual que hoy**.
- `VITE_PLAYTEST=on` → build de playtest.

Es la opción más conservadora posible: el riesgo de regresión sobre la build
normal es estructuralmente cero, porque el código nuevo no se monta.

### Qué implica el modo playtest

| | |
|---|---|
| Se abre | Centro Pokémon (heal + party/cajas), Tienda (ítems básicos), Skills, Chat, Dungeon |
| Se cierra | Mercado P2P, Swap, Perfil, Pokédex, Gimnasio, Casino, Silph Co., Casa de Mr. Pokémon |
| Persistencia nueva | **ninguna**: todo lo del playtest vive en memoria de sesión |
| Escrituras a Supabase | **ninguna** desde superficies de playtest |

---

## 3. Estado de implementación

_(se completa a medida que avanza la night shift; ver `NIGHT_SHIFT_STATUS.md`)_


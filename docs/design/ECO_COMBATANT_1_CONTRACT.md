# ECO-COMBATANT-1

Base: `02054b832137887a7cf7162a9a08c7f00fccf0c1`. Development ECO sandbox only.

## Responsibility breakdown

- FACT: `EcoExperimentLayer` composes the encounter card, battle session and existing owner/spectator overlays. The overlays already derive species, HP and bars from authoritative battle views.
- FACT: `PresenceRoom` routes intents through `WorldRoom`; `EcoBattles` indexes reservations by transport player id, including disconnected owners during the 15-second grace.
- Construction belongs to `encounterBattleRuntime`, which wraps the existing catalog/model/authority. Choice belongs to a separate in-memory server service; its UI/session only sends intent and displays acknowledgements.
- Reads: catalog, learnsets, current socket and reservation index. Writes: the player's synthetic choice in a server Map. Side effects: private choice messages and the existing battle start/public stream. No database, inventory, account, reward or core changes.

## Contract

- Initial pool: Pikachu (25), Rattata (19), Oddish (43), Geodude (74), Zubat (41), Caterpie (10). Default Pikachu; all level 12, Hardy, perfect IVs, zero EVs, synthetic ownership, as the existing fixture convention.
- Pikachu retains its original fixture moves (Thunder Shock, Quick Attack, Thunder Wave, Double Team), verified against executable catalog moves and level-up at/below 12 or machine legality. The other five use the last four distinct executable level-up moves at/below 12, ordered by learn level then id. Stats are calculated by the existing model/core. Wild species/moves/level remain unchanged.
- Preparation checks all six. Any species that cannot be constructed fails preparation with its species id and cause; no replacement. The available choice list comes from the prepared server factory.
- `world:eco-combatant-select { requestId, speciesId }` accepts exactly those two fields. Invalid pool members, levels, stats, moves, foreign ids or other extra fields are rejected. The transport owns player identity; guests, outdated/non-ECO sockets and replaced sockets cannot select.
- `world:eco-combatant-state { requestId, ok, reason?, speciesId, options }` is private. A world snapshot resends the server's choice (requestId null). A valid intent is synchronous and idempotent in value. Refusal never changes the choice. Disabled/outdated/unauthorised replies reveal no other player's choice.
- Selection is independent per player and prohibited while `byPlayer` holds any reservation, including disconnect grace. Only the existing lifecycle may release a reservation. Battle start reads the server choice and constructs a fresh instance; engage payloads cannot override it.
- Choices survive socket/area changes for this server's in-memory lifetime. Restart resets to Pikachu. No localStorage authority or persistence. Map retention follows the experiment's existing process-lifetime identity model.
- Card/debug selector waits for server acknowledgement; unavailable/offline/pending selection blocks starting a new battle. The battle panel, sprites, bars and spectator scene read the resulting battle snapshot/public projection.
- Existing off-by-default flags, frontend production exclusion and server production rejection remain authoritative.

## Verification

Bounded tests: all six legal constructions; forged/invalid inputs; two players; active and disconnected reservations; reconnect; owner/public presentation parity; selector acknowledgements. Isolated real-SDK e2e uses two different species, real movement, reconnect and spectators. Types, pertinent lint, generated bundles and production exclusion. Failures and limitations recorded in the implementation report.

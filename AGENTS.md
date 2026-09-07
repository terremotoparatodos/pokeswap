# AGENTS.md — PokeSwap Engineering Rules

> Applies to humans and coding agents.
> Goal: keep PokeSwap stable, segmented, auditable and resistant to accidental monolith growth.

## 1. Prime directive

Preserve approved product behavior. Do **not** preserve legacy architecture merely because it exists.

The legacy application is a behavioral reference, not the target design.

If a business rule is unclear:
1. check `docs/INVARIANTS.md`;
2. inspect current behavior;
3. label the uncertainty as `FACT`, `INFERENCE` or `OPEN QUESTION`;
4. do not silently invent persistent behavior.

If uncertainty affects tokens, money, ownership, auth, cooldowns, persistent rewards or payments, resolve it before implementation.

## 2. Browser code is untrusted

Assume users can inspect/modify JavaScript, edit localStorage, alter their clock, skip UI validation, replay requests and call public APIs manually.

Client may own:
- UI state;
- animations/audio;
- camera/filters;
- disposable caches;
- cosmetic RNG.

Server/database must own:
- token balance and credits/debits;
- Pokémon ownership;
- market transaction validity;
- persistent swap result/cooldown;
- payment confirmation;
- persistent dungeon rewards;
- privileged account changes.

## 3. Secrets

Frontend code is public.

Allowed:
- Supabase URL;
- Supabase publishable/anon key;
- credentials explicitly designed to be public.

Forbidden:
- Supabase service-role key;
- provider/webhook secrets;
- private API keys;
- database credentials.

`.env` does not make a value private if the frontend build ships it to the browser.

## 4. Feature boundaries

Preferred structure:

```text
src/
├── app/
├── features/
│   ├── auth/
│   ├── pokemon/
│   ├── market/
│   ├── swap/
│   ├── dungeon/
│   ├── progression/
│   ├── pokedex/
│   ├── map/
│   └── payments/
└── shared/
```

A feature may contain `components/`, `api/`, `state/`, `domain/`, `types/`, and `tests/` as needed.

Do not create folders without a real responsibility.

## 5. Components are not backends

Components should mainly handle rendering, interaction and composition.

Do not combine database writes, business rules, combat calculations, payments, rendering, timers and feature-global state in one component.

Preferred direction:

```text
component
  ↓
feature service/composable
  ↓
domain/API
```

## 6. File-size guardrails

Line count is a warning signal, not a correctness metric.

- 0–300 lines: usually fine.
- 300–500: verify one clear responsibility.
- 500–800: refactor discussion expected.
- 800+: exceptional; justify explicitly.
- 2,000+: almost certainly wrong for normal application source.
- An 8,000-line application file is forbidden as a target architecture.

Do not split a cohesive algorithm only to satisfy a number. Do split unrelated responsibilities.

Entry files such as `main.ts`, `App.vue` and bootstrap files should remain small.

## 7. No dumping-ground modules

Avoid permanent catch-alls such as `utils.ts`, `helpers.ts`, `misc.ts`, `functions.ts`, or `common.ts` when they contain unrelated behavior.

Prefer responsibility-specific names such as `currencyFormat.ts`, `marketPricing.ts`, or `combatDamage.ts`.

Do not move code to `shared/` merely because it is used twice.

## 8. One source of truth

Persistent concepts must have one authority:

```text
token balance  → server/database
ownership      → server/database
market listing → server/database
swap cooldown  → server/database
XP             → server/database
```

Memory caches are caches. `localStorage` is not authoritative for economic or competitive state.

Good localStorage uses: onboarding, volume, language, visual preferences, disposable cache.

Bad localStorage uses: balance, ownership, authoritative XP, transaction/payment completion, authoritative cooldown.

## 9. Database writes from UI

Do not scatter raw Supabase mutations through components.

Bad:

```text
component
  → supabase.from('profiles').update(...)
```

Preferred:

```text
component
  → feature API/service
  → server-authoritative operation
```

Direct client writes require an explicit justification and safe RLS.

## 10. Money, tokens and ownership require atomicity

Do not implement one logical transaction as unrelated browser requests.

Bad:

```text
lock Pokémon
create listing
change balance
change owner
```

Preferred:

```text
single server operation
  ↓
database transaction
  ↓
commit or rollback
```

If partial execution can create invalid state, use transaction semantics.

Never trust a client-provided final balance. Prefer intent APIs such as `claimPassiveTokens()`, `buyListing(id)` or `skipSwapCooldown()`.

## 11. Persistent RNG belongs to the server

If randomness changes persistent ownership, rarity, reward, value or progression, generate/validate it server-side.

Client RNG is for presentation only.

## 12. Payments

Never grant value because the browser says payment succeeded.

Authority must come from a verified webhook, server callback or provider API verification.

Payment operations must be idempotent: duplicate notifications must not duplicate value.

## 13. Safe DOM rendering

User/database/provider strings are untrusted text.

Prefer framework interpolation:

```vue
<span>{{ username }}</span>
```

Do not interpolate untrusted strings into `innerHTML`.

Critical username constraints must also exist server-side/database-side; client validation is UX, not security.

## 14. No duplicate active implementation

Temporary duplication during migration is allowed. Permanent ambiguity is not.

When a new implementation becomes authoritative:
1. prove the old path is no longer reached;
2. remove the old implementation;
3. remove temporary compatibility code when safe;
4. update docs.

Do not keep multiple versions “just in case”.

## 15. Legacy code policy

Legacy code may be inspected to understand behavior. Do not copy its architecture into new modules.

When migrating:
- preserve behavior;
- restore proper boundaries;
- document intentional behavior changes.

Avoid cosmetic refactors of unrelated legacy systems.

## 16. One primary responsibility per task/PR

Do not combine, for example:

```text
market migration
+ pricing rebalance
+ UI redesign
+ auth changes
+ schema rename
```

Keep diffs attributable. Architecture migration and product changes should normally be separate.

## 17. Breakdown trigger

Stop implementation and produce a responsibility breakdown when a task:
- touches multiple major features;
- changes tokens/money/ownership;
- changes auth/RLS/schema;
- changes payment flows;
- changes transaction semantics;
- changes persistent RNG;
- moves a large multi-responsibility system;
- requires many layers to change simultaneously.

Do not continue merely because the model has enough context.

Before a non-trivial change identify entry points, callers, reads, writes, persistent state, side effects, dependencies, invariants, failure behavior and unknowns.

## 18. Agent scope

Stay within the assigned responsibility.

If asked to migrate auth, do not opportunistically refactor market, dungeon, map or payments.

Avoid drive-by formatting, renaming, game-balance changes, dependency additions or adjacent redesigns.

If another module must change, explain why.

## 19. Dependencies and errors

Before adding a dependency, explain:
- what problem it solves;
- why existing tools are insufficient;
- browser/server scope;
- maintenance/security cost.

Do not swallow meaningful failures with empty `catch` blocks.

Persistent mutations need explicit success/failure and safe retry/idempotency where appropriate.

Never log passwords, private keys, full auth tokens or provider secrets.

## 20. Tests

Prioritize invariant and failure-mode tests:
- double purchase;
- simultaneous buy/cancel;
- duplicate payment webhook;
- concurrent balance mutation;
- ownership race;
- reward replay;
- cooldown bypass;
- hostile username rendering.

Business/domain calculations should be testable without DOM access when possible.

## 21. Supabase behavior is code

Version production-critical:
- migrations;
- RLS policies;
- SQL functions/triggers;
- Edge Functions.

Do not leave critical behavior existing only in the dashboard.

For each client-visible table, know who may read, insert, update and delete.

Service-role/secret credentials must never run in browser code.

## 22. Prefer intentional APIs

Prefer:

```text
market.buy(listingId)
market.publish(input)
swap.execute(pokemonId)
tokens.collectPassive()
```

over generic mutation helpers such as:

```text
updateTable(table, values)
```

Intentional contracts are easier to secure, test and review.

## 23. Generated code is untrusted until reviewed

LLM-generated code must be reviewed for:
- source of truth;
- trust boundary;
- concurrency;
- failure behavior;
- hidden assumptions;
- duplicated responsibility;
- file growth;
- unrelated edits.

“Compiles” is not equivalent to “correct”.

## 24. Prevent giant-file regression

Before adding substantial code to a file, ask:

> Does this responsibility belong here?

Do not append hundreds of unrelated lines to `App.vue`, `main.ts`, bootstrap files or any existing central module merely because it is convenient.

If a file already owns multiple unrelated responsibilities, do not make it larger.

## 25. Definition of Done for a migrated feature

A feature is not migrated merely because it renders in the new frontend.

Before completion:
- [ ] approved behavior preserved;
- [ ] source of truth explicit;
- [ ] trust boundary respected;
- [ ] critical tests pass;
- [ ] build/lint/typecheck pass;
- [ ] no secret leaked to frontend;
- [ ] no privileged client authority introduced;
- [ ] no unexplained cross-feature dependency;
- [ ] no accidental oversized module;
- [ ] production uses the new path;
- [ ] old path is unreachable;
- [ ] dead legacy code removed;
- [ ] docs updated.

## 26. Expected agent behavior

For a clear bounded task: **implement it**.

For an unclear task: **investigate and report uncertainty first**.

For a large task: **produce a responsibility breakdown before code changes**.

For architectural work: **preserve invariants first, improve structure second**.

When convenience conflicts with integrity: **prefer data integrity, security and explicit product rules**.

## Final rule

The architecture should make the correct home for new code obvious.

If every new feature can still plausibly be appended to one central file, the migration has not solved the original problem.

# PokeSwap — Architecture Migration Roadmap

> **Status:** Proposed migration plan  
> **Purpose:** Turn the current PokeSwap prototype into a maintainable application without throwing away the working product.  
> **Migration strategy:** Strangler migration — replace one responsibility at a time while the current application remains the behavioral reference.

---

## 0. How to use this roadmap

The current PokeSwap repository should be treated as:

> **A working prototype and behavioral specification, not the target architecture.**

The goal is **not** to rewrite everything at once and it is **not** to beautify the existing 8,000-line `index.html` until it becomes acceptable.

The goal is to:

1. Identify the behavior that already works.
2. Document the invariants that must not change.
3. Create the new architecture beside the legacy application.
4. Move one responsibility at a time.
5. Verify equivalent behavior.
6. Delete the old implementation only after the new one is proven.

### Migration rule

Every migration task must be able to answer:

- What behavior is being preserved?
- Who is the authority for the data involved?
- What old code is being replaced?
- How do we prove the replacement works?
- What can be deleted after the migration?

If any of these are unclear, **do not implement yet**. Perform a breakdown first.

---

# 1. Target architecture

Recommended initial target:

```text
pokeswap/
├── src/
│   ├── app/
│   │   ├── App.vue
│   │   ├── bootstrap/
│   │   └── router/
│   │
│   ├── features/
│   │   ├── auth/
│   │   ├── pokemon/
│   │   ├── market/
│   │   ├── swap/
│   │   ├── dungeon/
│   │   ├── progression/
│   │   ├── pokedex/
│   │   ├── map/
│   │   └── payments/
│   │
│   ├── shared/
│   │   ├── components/
│   │   ├── api/
│   │   ├── config/
│   │   ├── types/
│   │   └── utils/
│   │
│   └── assets/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   ├── market-buy/
│   │   ├── market-publish/
│   │   ├── market-cancel/
│   │   ├── pokeswap-swap/
│   │   ├── collect-passive-tokens/
│   │   ├── dungeon-reward/
│   │   ├── create-checkout/
│   │   └── payment-webhook/
│   └── seed/
│
├── tests/
├── docs/
├── legacy/
│   └── README.md
├── AGENTS.md
└── package.json
```

Recommended frontend baseline:

- Vue 3
- Vite
- TypeScript
- Supabase client
- Vitest
- ESLint
- Prettier

React would also work. The important decision is **feature boundaries**, not the specific UI framework.

---

# 2. LLM effort scale

This roadmap uses an implementation-effort label.

## LOW

Mechanical or tightly bounded work.

Examples:

- move assets,
- create folders,
- extract constants,
- convert a small HTML fragment into a component,
- add lint rules,
- write straightforward unit tests.

Good candidates:

- Terra with explicit instructions,
- Claude with a narrow task,
- Sol Light.

The task should already be well defined before execution.

---

## MEDIUM

Requires understanding interactions between a few modules but the desired behavior is known.

Examples:

- migrate auth UI,
- migrate Pokédex persistence,
- replace direct database calls with a service,
- migrate a complete feature whose invariants are already documented.

Good candidates:

- Sol Light,
- Claude with repository context and explicit constraints.

The agent may inspect surrounding code, but should not invent product rules.

---

## HIGH / BREAKDOWN REQUIRED

Touches money, ownership, concurrency, authentication boundaries, migrations, transaction semantics, or several hidden responsibilities at once.

Examples:

- market transactions,
- token economy,
- dungeon rewards,
- swap ownership transfer,
- payment webhooks,
- recovering undocumented Supabase RLS/functions.

Recommended approach:

1. use a stronger reasoning/planning pass first,
2. produce a breakdown,
3. review the breakdown,
4. execute the resulting small tasks with Sol Light / Terra / Claude.

Do **not** hand the whole HIGH task to an executor with “refactor this”.

---

# 3. Migration phases

---

# R00 — Freeze the prototype as a behavioral reference

**Priority:** P0  
**LLM effort:** LOW  
**Breakdown required:** No

## Objective

Stop treating the current monolith as the architecture that must be cleaned indefinitely.

Declare it the legacy reference implementation.

## Work

- Tag the current known-working state.
- Create a migration branch.
- Add `docs/LEGACY_BASELINE.md`.
- Record:
  - current public URL,
  - known working flows,
  - known broken flows,
  - current Supabase project,
  - current deployment mechanism.
- Do not reorganize legacy files yet.

## Acceptance criteria

- A specific commit/tag can always be used to answer:
  - “How did this work before the migration?”
- The team can distinguish:
  - legacy behavior,
  - migration code,
  - target architecture.

## Do not

- move the giant `index.html` just for cleanliness,
- rename dozens of legacy functions,
- perform cosmetic refactors.

---

# R01 — Write the product invariants

**Priority:** P0  
**LLM effort:** HIGH for discovery, LOW for documentation after review  
**Breakdown required:** Yes if behavior is ambiguous

## Objective

Turn implicit rules into explicit rules before agents start moving code.

Create:

```text
docs/INVARIANTS.md
```

## Minimum invariant groups

### Identity

- A user identity is controlled by Supabase Auth.
- Usernames have an explicit allowed format.
- A username must not be treated as trusted HTML.

### Pokémon ownership

- A Pokémon can have at most one current owner.
- Ownership changes are server-authoritative.
- The frontend cannot grant or remove ownership.
- A Pokémon locked for a market transaction cannot be used in incompatible operations.

### Tokens

- Token balance is server-authoritative.
- The frontend cannot assign itself tokens.
- Every debit and credit must have an explainable cause.
- Balance updates must be race-safe.

### Market

- Listing creation verifies ownership.
- Buying verifies:
  - buyer,
  - seller,
  - price,
  - listing state,
  - current ownership.
- Purchase and ownership transfer are atomic.
- A listing cannot be bought twice.
- A failed transaction cannot leave a Pokémon permanently locked.

### Swap

- The server decides the persistent result.
- The server enforces cooldown.
- The server performs ownership changes.
- Client RNG may only be cosmetic.

### Dungeon

- The frontend may simulate/render combat.
- Persistent rewards must be validated server-side.
- The client cannot send “I won, give me 3,000 tokens” as an authoritative claim.

### Payments

- Browser redirects are not proof of payment.
- Payment confirmation comes from a verified provider webhook/server callback.
- Payment secrets never reach the browser.

## Acceptance criteria

- Each persistent system has an explicit source of truth.
- An agent can determine whether a proposed change violates an invariant.
- Unknown behavior is labeled `OPEN QUESTION`, not guessed.

---

# R02 — Inventory the real backend

**Priority:** P0  
**LLM effort:** HIGH  
**Breakdown required:** Usually yes

## Objective

The current repository does not contain enough backend material to audit the system.

Recover and version what actually exists in Supabase.

## Inventory

Find and document:

- tables,
- columns,
- indexes,
- foreign keys,
- unique constraints,
- RLS policies,
- triggers,
- SQL functions/RPCs,
- realtime subscriptions,
- Edge Functions,
- auth hooks,
- scheduled jobs,
- webhook handlers,
- secrets required by backend functions.

At minimum investigate current references such as:

```text
market-buy
create-checkout
pokeswap-swap
paypal-ipn
get_email_by_id
```

## Output

```text
docs/BACKEND_INVENTORY.md
supabase/migrations/
supabase/functions/
```

## Acceptance criteria

A fresh developer environment can understand:

- which backend operations exist,
- where their code lives,
- which operations bypass RLS,
- which data is writable from the public client.

## Important

Do not reconstruct security policies by guessing.

If an existing rule cannot be recovered, mark it as an unknown and redesign it explicitly.

---

# R03 — Establish the new frontend shell

**Priority:** P0  
**LLM effort:** LOW  
**Breakdown required:** No

## Objective

Create the future home of the application without replacing the legacy UI yet.

## Work

Initialize:

- Vue 3,
- Vite,
- TypeScript,
- ESLint,
- Prettier,
- Vitest.

Create:

```text
src/app/
src/features/
src/shared/
```

Add the Supabase publishable client in:

```text
src/shared/api/supabase.ts
```

## Rules

The client config may contain:

- public Supabase URL,
- Supabase publishable/anon key.

It must never contain:

- service role keys,
- provider secrets,
- private API keys.

## Acceptance criteria

- `npm run dev` works.
- `npm run build` works.
- `npm test` works.
- Legacy application remains usable during migration.

---

# R04 — Establish deployment and CI before feature migration

**Priority:** P0  
**LLM effort:** LOW–MEDIUM  
**Breakdown required:** No

## Objective

Do not migrate business logic into a project that cannot automatically prove it builds.

## Add checks

On every PR:

- install,
- typecheck,
- lint,
- unit tests,
- production build.

Prefer a preview deployment for migration branches.

## Acceptance criteria

No agent should be able to merge code that:

- does not compile,
- fails lint,
- fails tests,
- fails production build.

---

# R05 — Define the client/server trust boundary

**Priority:** P0  
**LLM effort:** MEDIUM  
**Breakdown required:** No after R01/R02

## Objective

Create a single written rule for where decisions belong.

Create:

```text
docs/TRUST_BOUNDARY.md
```

## Client may decide

- animations,
- selected UI state,
- language,
- sound,
- visual filters,
- camera,
- temporary effects,
- non-persistent random particles.

## Server must decide

- token credits/debits,
- ownership,
- market validity,
- persistent swap result,
- persistent cooldown,
- payment confirmation,
- persistent dungeon reward,
- privileged profile changes.

## Acceptance criteria

Every public write to Supabase is classified as:

- safe direct client write,
- server-only operation,
- read-only.

---

# R06 — Create the API/service layer

**Priority:** P1  
**LLM effort:** MEDIUM  
**Breakdown required:** No

## Objective

Components must not scatter raw Supabase queries across the UI.

Create feature-local APIs, for example:

```text
src/features/market/api/marketApi.ts
src/features/swap/api/swapApi.ts
src/features/progression/api/progressionApi.ts
```

Components call:

```text
marketApi.list()
marketApi.publish(...)
marketApi.buy(...)
```

They should not call:

```text
supabase.from(...).update(...)
```

directly.

## Acceptance criteria

- Business feature components do not know table layouts.
- Supabase query details are concentrated in API/service modules.
- Sensitive mutations point to server-side functions.

---

# R07 — Migrate authentication

**Priority:** P1  
**LLM effort:** MEDIUM  
**Breakdown required:** Possibly, if username behavior is unclear

## Objective

Move login/signup/profile session handling out of the legacy monolith.

## Work

Create:

```text
src/features/auth/
```

Separate:

- session state,
- login,
- signup,
- password reset,
- profile display.

## Security work

Define username validation.

Recommended baseline:

```text
3–24 characters
letters
numbers
underscore
hyphen
```

Render usernames as text, never trusted HTML.

## Acceptance criteria

- login works,
- signup works,
- reset works,
- refresh restores session,
- invalid usernames cannot inject markup,
- auth state has one owner.

---

# R08 — Close HTML injection paths

**Priority:** P0/P1  
**LLM effort:** MEDIUM  
**Breakdown required:** No

## Objective

Remove user-controlled interpolation into `innerHTML`.

## Search for

- `innerHTML =`,
- template strings containing:
  - username,
  - errors,
  - database text,
  - provider text,
  - user-generated names.

## Replace with

- Vue interpolation,
- `textContent`,
- safe component rendering.

## Acceptance criteria

User-controlled strings cannot create DOM nodes or event handlers.

Add tests for hostile usernames.

---

# R09 — Migrate market listing creation/cancellation

**Priority:** P0  
**LLM effort:** HIGH  
**Breakdown required:** Yes

## Objective

Replace the current multi-request client transaction.

Current conceptual behavior:

```text
lock slot
insert listing

or

delete listing
unlock slot
```

must become atomic server-side operations.

## Target operations

```text
market-publish
market-cancel
market-buy
```

Each should validate the current database state, not client assumptions.

## Recommended implementation

Prefer a transactional Postgres function/RPC for the atomic database mutation, called through a controlled server boundary when appropriate.

## Acceptance criteria

Test:

- two publish attempts,
- two simultaneous buyers,
- cancellation racing purchase,
- lost client connection,
- stale price,
- stale ownership,
- expired listing.

A failure cannot leave ownership/listing/lock state inconsistent.

---

# R10 — Move token economy server-side

**Priority:** P0  
**LLM effort:** HIGH  
**Breakdown required:** Yes

## Objective

The browser must stop calculating authoritative balances.

Migrate:

- passive tokens,
- learning move costs,
- cooldown skip costs,
- dungeon token rewards,
- any future token purchase.

## Bad pattern

```text
read profile.tokens
calculate client-side
update profile.tokens = calculated value
```

## Target pattern

```text
POST operation
        ↓
server validates state
        ↓
transaction changes balance
        ↓
server returns:
{
  delta,
  newBalance,
  reason
}
```

## Strong recommendation

Introduce a token ledger:

```text
token_transactions
- id
- user_id
- delta
- reason
- reference_id
- created_at
```

The profile balance may be cached, but every mutation should remain auditable.

## Acceptance criteria

The frontend cannot arbitrarily set a balance even with manual API calls.

---

# R11 — Harden PokeSwap

**Priority:** P0  
**LLM effort:** HIGH  
**Breakdown required:** Yes

## Objective

Make server authority explicit for every persistent swap result.

Server owns:

- eligibility,
- ownership validation,
- RNG/result,
- ownership transfer,
- cooldown,
- any persistent shiny/special attributes,
- audit event.

Client owns:

- ball animation,
- sounds,
- reveal timing,
- particles.

## Work

Remove/deprecate legacy local swap implementations after the server version passes parity tests.

## Acceptance criteria

Changing browser code cannot:

- choose the received Pokémon,
- remove cooldown,
- duplicate ownership,
- alter a persistent reward.

---

# R12 — Migrate progression / XP

**Priority:** P1  
**LLM effort:** MEDIUM–HIGH  
**Breakdown required:** If XP affects economy/ownership

## Objective

Define a single source of truth for:

- XP,
- level,
- moves,
- evolution-related state.

Remove ambiguous three-way authority between:

- Supabase,
- `_xpCache`,
- `localStorage`.

## Desired model

```text
server/database = persistent truth
memory cache = temporary optimization
localStorage = UI preference/cache only, never authority
```

## Acceptance criteria

Clearing localStorage does not destroy or invent persistent progression.

Two browser tabs converge on the same persistent state.

---

# R13 — Migrate Pokédex

**Priority:** P2  
**LLM effort:** MEDIUM  
**Breakdown required:** No

## Objective

Move Pokédex behavior into:

```text
src/features/pokedex/
```

Define clearly:

- seen,
- registered,
- persistence,
- migration from any legacy local state.

## Acceptance criteria

There is one persistent representation.

Legacy localStorage migration is:

- explicit,
- idempotent,
- removable after a migration window.

---

# R14 — Migrate dungeon UI and combat engine

**Priority:** P2  
**LLM effort:** HIGH initially  
**Breakdown required:** Yes

## Objective

The dungeon is large enough that “move dungeon into components” is not a task.

Break it down by responsibility.

Suggested breakdown:

```text
dungeon/
├── engine/
│   ├── combat.ts
│   ├── status.ts
│   ├── moves.ts
│   ├── enemies.ts
│   └── rewards.ts
│
├── state/
├── components/
├── api/
└── tests/
```

## Migration order

1. pure combat calculations,
2. state machine,
3. rendering,
4. reward submission,
5. tester/debug tools.

## Important

Do not rewrite the combat engine while also changing game balance.

First preserve behavior.

## Acceptance criteria

Core combat calculations can run without the DOM.

---

# R15 — Move persistent dungeon rewards to a server contract

**Priority:** P0/P1  
**LLM effort:** HIGH  
**Breakdown required:** Yes

## Objective

Separate:

```text
"I rendered a victory"
```

from:

```text
"the server accepts that this run earned reward X"
```

Possible designs require a dedicated breakdown.

At minimum define:

- run identifier,
- server-issued run context,
- allowed rewards,
- anti-replay behavior,
- completion validation,
- reward transaction idempotency.

## Acceptance criteria

Refreshing, replaying, or manually calling a browser function cannot repeatedly credit the same reward.

---

# R16 — Migrate map and visual world

**Priority:** P2  
**LLM effort:** MEDIUM  
**Breakdown required:** Yes if movement/rendering are tightly coupled

## Objective

Separate:

- world data,
- movement rules,
- camera,
- entities,
- rendering,
- realtime updates.

Do not put the entire map feature into `Map.vue`.

Suggested structure:

```text
map/
├── engine/
├── components/
├── composables/
├── data/
└── realtime/
```

## Acceptance criteria

Map rendering code does not own market/auth/economy rules.

---

# R17 — Move assets out of source code

**Priority:** P2  
**LLM effort:** LOW  
**Breakdown required:** No

## Objective

Remove giant Base64 blobs from application source.

Move images/maps/audio to:

```text
src/assets/
public/assets/
```

or an external asset host/CDN if appropriate.

## Acceptance criteria

- No 100 KB+ Base64 source lines.
- Git diffs for code are readable.
- Assets can be changed without editing application logic.

---

# R18 — Remove dead and duplicate implementations

**Priority:** P1/P2  
**LLM effort:** MEDIUM  
**Breakdown required:** No, but require usage proof

## Known candidates

- `js/market.js` versus inline active market implementation,
- `css/main.css` versus inline CSS,
- old client-side swap implementation,
- obsolete tester helpers,
- fallback migrations that have completed their useful life.

## Rule

Never delete code because “it looks unused”.

Prove:

- it is not imported,
- it is not dynamically referenced,
- no active feature depends on it.

## Acceptance criteria

Exactly one implementation exists for each active responsibility.

---

# R19 — Introduce module size guardrails

**Priority:** P1  
**LLM effort:** LOW  
**Breakdown required:** No

## Objective

Prevent another 8,000-line file from forming gradually.

Recommended guidance:

- **~300 lines:** inspect whether the file has multiple responsibilities.
- **~500 lines:** refactor discussion required.
- **~800 lines:** exceptional; requires explicit justification.
- Entry/bootstrap files should remain small.

These are guardrails, not arbitrary correctness rules.

## CI recommendation

Add a script that reports oversized source files.

Initially warn.

Later fail CI for unjustified extreme cases.

## Acceptance criteria

An agent cannot silently add 2,000 lines to an existing feature module without a review signal.

---

# R20 — Add invariant-focused tests

**Priority:** P0/P1  
**LLM effort:** MEDIUM–HIGH  
**Breakdown required:** Per subsystem

## Test important behavior, not trivial syntax.

Priority tests:

### Ownership

- cannot have two owners,
- stale ownership mutation fails.

### Market

- double buy,
- simultaneous buy/cancel,
- listing of non-owned Pokémon,
- repeated publish,
- expired listing.

### Tokens

- debit cannot create negative balance unless intentionally supported,
- duplicate reward is idempotent,
- concurrent rewards do not lose updates.

### Swap

- cooldown enforced,
- ownership transfer atomic,
- repeat request is safe.

### Payments

- duplicate webhook,
- forged browser success,
- invalid signature.

### Security

- hostile username renders as text,
- public client cannot perform privileged mutation.

---

# R21 — Isolate tester/debug capabilities

**Priority:** P1  
**LLM effort:** LOW–MEDIUM  
**Breakdown required:** No

## Objective

Stop production behavior and tester behavior from sharing accidental authority.

## Target

Debug/test utilities should be:

- development-only,
- clearly isolated,
- unable to call privileged production mutations unless explicitly testing them in a safe environment.

Avoid making `?test` the security boundary.

## Acceptance criteria

Production builds do not expose accidental state-changing debug controls.

---

# R22 — Cut over feature-by-feature

**Priority:** P1  
**LLM effort:** MEDIUM  
**Breakdown required:** Per feature

## Objective

For each feature:

1. identify legacy implementation,
2. migrate behavior,
3. test parity,
4. enable new implementation,
5. observe,
6. delete old implementation.

Keep a migration table:

| Feature | Legacy | New | Parity | Cut over | Legacy deleted |
|---|---|---|---|---|---|
| Auth | inline | `features/auth` | ☐ | ☐ | ☐ |
| Market | inline | `features/market` | ☐ | ☐ | ☐ |
| Swap | `js/swap.js` | `features/swap` | ☐ | ☐ | ☐ |
| Pokédex | inline | `features/pokedex` | ☐ | ☐ | ☐ |
| Dungeon | inline | `features/dungeon` | ☐ | ☐ | ☐ |
| Map | inline | `features/map` | ☐ | ☐ | ☐ |

---

# R23 — Retire the legacy monolith

**Priority:** Final  
**LLM effort:** MEDIUM  
**Breakdown required:** No

## Preconditions

Do not perform until:

- all active features have migrated,
- production uses the new frontend,
- backend is versioned,
- critical invariant tests exist,
- observability is sufficient,
- legacy parity has been verified.

## Work

- remove inactive inline systems,
- archive final legacy snapshot,
- remove old scripts/CSS,
- remove migration-only compatibility code,
- update docs.

## Acceptance criteria

The old `index.html` is no longer the hidden source of behavior.

---

# 4. Recommended execution order

Do not simply execute R00 → R23 numerically.

Suggested actual sequence:

```text
R00  Freeze baseline
R01  Invariants
R02  Backend inventory
R03  New frontend shell
R04  CI/build
R05  Trust boundary
R08  XSS / unsafe HTML

R09  Market atomicity
R10  Token authority
R11  Swap authority
R15  Dungeon rewards

R06  API/service layer
R07  Auth components
R12  Progression
R13  Pokédex
R14  Dungeon internals
R16  Map
R17  Assets
R18  Dead code
R19  Size guardrails
R20  Expand invariant tests
R21  Tester isolation
R22  Incremental cutover
R23  Retire legacy
```

The P0 security/invariant work deliberately happens before cosmetic cleanup.

---

# 5. Tasks that should NOT be handed directly to an implementation agent

These should first produce a design/breakdown:

```text
"Refactor the market."
"Make tokens secure."
"Move the dungeon."
"Fix the architecture."
"Clean up index.html."
"Migrate Supabase."
"Rewrite PokeSwap in Vue."
```

They are too broad.

Instead:

```text
Analyze marketPublish/marketCancel/marketBuy.
Document their current behavior and invariants.
Identify all database tables and writes involved.
Propose an atomic server-side contract.
Do not modify code yet.
```

Then implement the approved slices.

---

# 6. Recommended agent workflow

For non-trivial migrations:

## Step A — Discovery

Agent must return:

- files inspected,
- current behavior,
- dependencies,
- invariants discovered,
- uncertainties,
- proposed migration boundary.

No code changes.

## Step B — Breakdown

Convert the migration into tasks that can usually be completed in one focused pass.

Example:

```text
MKT-1 create server publish contract
MKT-2 add transaction tests
MKT-3 create frontend market API
MKT-4 migrate publish UI
MKT-5 migrate cancel UI
MKT-6 migrate buy UI
MKT-7 parity test
MKT-8 delete legacy path
```

## Step C — Implementation

Use a bounded executor.

Good fit:

- Terra for highly mechanical tasks,
- Sol Light for defined feature migration,
- Claude for a bounded task with the relevant files and invariants supplied.

## Step D — Review

A separate review pass checks:

- invariant violations,
- duplicated responsibility,
- new client authority,
- accidental cross-feature coupling,
- oversized files,
- dead legacy code.

---

# 7. Definition of Done for a migrated feature

A feature is **not migrated** merely because it renders in Vue.

It is migrated when:

- [ ] behavior is documented,
- [ ] source of truth is explicit,
- [ ] persistent mutations respect the trust boundary,
- [ ] new module has a clear owner/responsibility,
- [ ] critical behavior has tests,
- [ ] production uses the new path,
- [ ] old implementation is no longer reachable,
- [ ] dead code is deleted,
- [ ] docs are updated.

---

# 8. First concrete milestone for Guti

Do not begin with the map or dungeon.

The first milestone should be:

## “PokeSwap has a boring, trustworthy foundation.”

Complete:

- R00
- R01
- R02
- R03
- R04
- R05
- R08

Then migrate one small non-critical feature to learn the process.

Recommended first component migration:

```text
Auth UI
```

Then tackle critical backend boundaries:

```text
Market
Tokens
Swap
Dungeon rewards
```

The objective is not maximum development speed during the first migration weeks.

The objective is to create a structure where **future development becomes safer and faster instead of increasingly expensive**.

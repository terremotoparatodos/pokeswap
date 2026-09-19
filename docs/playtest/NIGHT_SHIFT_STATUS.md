# NIGHT SHIFT — Community Playtest 0.1 · Estado vivo

> Documento de continuidad. Si esta sesión se corta por límite de uso, **no se
> reconstruye el estado de memoria**: se lee este archivo.
>
> **Al retomar:**
> 1. `git fetch --all --prune`
> 2. leer este archivo entero
> 3. `git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git status --porcelain`
> 4. continuar por §"Tarea actual".

## Coordenadas

| | |
|---|---|
| Rama | `playtest/community-0.1` |
| Base (HUMAN APPROVED) | `integration/pre-r34-town-3d` @ `e0a158107ad4e8a98be814481c3daa9c3b1809b8` |
| Base verificada | local = remote = `e0a1581` ✅ (`git ls-remote` al inicio de la sesión) |
| HEAD actual | ver §Checkpoints (última fila) |
| Untracked preexistentes | 7 entradas, **intactas y sin stagear** |

### Las 7 untracked que NO se tocan

```
.claude/
.worktrees/
C:UsersRodriProyectospokeswap.claudelaunch.json
C:champions-scoutcalibration-data.json
agents/CLAUDE_SECURITY_AND_VERIFICATION_BACKLOG.md
docs/SECURITY_AND_VERIFICATION_ROADMAP.md
supabase/.temp/
```

Regla de commit: **staging explícito siempre**, nunca `git add .`.

## Checkpoints

| # | Commit | Qué entró |
|---|---|---|
| 0 | `8469bd6` | Auditoría + docs de arranque |
| 1 | `4ad2604` | P0: gate, kill switch, build id, bug reporter |
| 2 | `0e95abf` | P1A: Dungeons como cuevas en WildLands |

## Tarea actual

**P1B — Chat multijugador** sobre `PresenceRoom`.

## Completadas

- [x] Verificación de base contractual (`local = remote = e0a1581`)
- [x] Rama `playtest/community-0.1` creada desde el HEAD exacto
- [x] Auditoría de repo (ver `COMMUNITY_PLAYTEST_0_1.md` §Auditoría)
- [x] **P0** — `VITE_PLAYTEST` como modo de build; `PlaytestShell`; gate remoto
      (`playtest_gate`, migración escrita, **no aplicada**); banner + build id;
      bug reporter al portapapeles. Aislamiento verificado: la build normal no
      contiene ni una cadena del playtest.
- [x] **P1A** — cuevas derivadas en los 5 mundos (6 por mundo, la más cercana a
      6–17 tiles), arte en el lenguaje visual de WildLands, colisión real,
      `PlayDungeon` con `autoStart`/`exit`. Loop verificado en navegador.

## Pendientes

- [ ] P1B — Chat (PresenceRoom + UI)
- [ ] P1C — Skills OSRS-like (promover profesiones a playtest + panel)
- [ ] P1D — Ciudad limitada (abrir Centro + Tienda, cerrar el resto)
- [ ] P1E — Centro Pokémon (heal + party/cajas)
- [ ] P1F — Tienda playtest (herramientas básicas + Poké Ball mala)
- [ ] P2 — QA / multiplayer / multitab / mobile / stress
- [ ] P3 — polish (sólo si P0–P2 verdes)
- [ ] Tests, typecheck, lint, build
- [ ] QA autónomo final + GO / NO-GO

## Blockers

_(ninguno todavía)_

## Tests / checks

Baseline heredado de la consolidación pre-R34 (aún no re-corrido en esta rama):

| Check | Baseline |
|---|---|
| `npx vitest run` | 140 archivos / 1753 tests verdes |
| `npm run typecheck` | limpio |
| `npx eslint src` | 0 errores, 9 warnings preexistentes (AuthModal) |
| `npm run lint` (`eslint .`) | **14 errores preexistentes**, todos en `.worktrees/**` (untracked, ajeno) |
| `npm run build` | OK |

## Cómo seguir exactamente

```bash
cd /c/Users/Rodri/Proyectos/pokeswap
git fetch --all --prune
git checkout playtest/community-0.1
git status --porcelain
npx vitest run
```

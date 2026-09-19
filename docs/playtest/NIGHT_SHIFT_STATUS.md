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
| Base verificada | local = remote = `e0a1581` ✅ (`git ls-remote` al inicio) |
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
| 3 | `1b1ff6a` | P1B: chat de área sobre el socket de presencia |
| 4 | `e118048` | P1C/D/E/F: skills, ciudad, Centro Pokémon, Tienda |
| 5 | `65a93c3` | Tests de la regla de arranque y de las dos puertas abiertas |
| 6 | `a513bce` | Fixes de layout móvil |
| 7 | `bfb98dc` | Documentación operativa (scope, kill switch, checklist, shutdown) |
| 8 | _(este commit)_ | QA final y veredicto |

## Tarea actual

**Terminado.** Veredicto: **GO** con dos verificaciones humanas previas
(ver §Blockers y la checklist de `COMMUNITY_PLAYTEST_0_1.md` §11).

## Completadas

- [x] Base contractual verificada (`local = remote = e0a1581`)
- [x] Rama creada desde el HEAD exacto
- [x] Auditoría de repo → `COMMUNITY_PLAYTEST_0_1.md` §1
- [x] **P0** — `VITE_PLAYTEST` como modo de build; `PlaytestShell`; gate remoto
      (`playtest_gate`, migración escrita, **no aplicada**); banner + build id;
      bug reporter al portapapeles. Aislamiento verificado.
- [x] **P1A** — cuevas derivadas en los 5 mundos, arte en el lenguaje visual de
      WildLands, colisión real, `PlayDungeon` con `autoStart`/`exit`.
- [x] **P1B** — chat de área con saneo, rate limit e historial.
- [x] **P1C** — panel de Skills sobre las 4 profesiones reales; arranque en
      nivel 1 sin herramientas.
- [x] **P1D** — ciudad con dos puertas abiertas y el resto explicado.
- [x] **P1E** — Centro Pokémon: curar, equipo y cajas.
- [x] **P1F** — Tienda: herramientas tier 1 y Poké Balls malas.
- [x] **P2 parcial** — móvil, performance, tests de montaje de las superficies.
- [x] Documentación (`COMMUNITY_PLAYTEST_0_1.md`): scope, seguridad, kill
      switch, reglas, checklist de stream, shutdown, known issues.
- [x] **QA final**: suite, typecheck, lint, ambas builds, aislamiento de `dist`,
      diff revisado archivo por archivo, base y ramas de la secundaria
      verificadas sin mover, las 7 untracked intactas y fuera de todo commit.

## Pendientes (para el humano, antes del stream)

- [ ] Aplicar `supabase/migrations/20260919_001_playtest_gate.sql`
- [ ] Deploy con `VITE_PLAYTEST=on`
- [ ] **Prueba de 2 sesiones con cuentas reales** — si falla, NO-GO
- [ ] Prueba en un teléfono real
- [ ] Abrir el gate con el código del stream

## Blockers

**Ninguno que bloquee la entrega.** Dos limitaciones de sesión, documentadas:

1. **Multijugador de 2 sesiones no probado en vivo.** Requiere dos cuentas de
   Supabase con login. La lógica de sala está cubierta por 41 tests del
   servicio; el ida y vuelta por socket no. → primer ítem de la checklist.
2. **Las superficies exclusivas de playtest no se vieron en navegador.**
   `isPlaytest` es constante de build y no hay una config de dev server para el
   modo playtest (`.claude/launch.json` es una de las 7 untracked intocables).
   Cubiertas con 18 tests de montaje en su lugar. Para verlas en vivo hace falta
   una entrada de launch.json que corra `npm run dev` con `VITE_PLAYTEST=on`, o
   servir la build de playtest.

## Tests / checks

| Check | Resultado |
|---|---|
| `npx vitest run` | **151 archivos / 1858 tests** verdes |
| `node --test "src/**/*.test.js"` (services/realtime) | **41 tests** verdes |
| `npm run typecheck` | limpio |
| `npm run lint` | **0 errores**, 9 warnings preexistentes (AuthModal) |
| `npm run build` | OK |
| `VITE_PLAYTEST=on npm run build` | OK, commit correcto embebido (`bfb98dc`) |
| Aislamiento de `dist` | 0 cadenas de playtest en la build normal |
| Base `integration/pre-r34-town-3d` | sigue en `e0a1581`, local = remote |
| Ramas de la estación secundaria | sin tocar |
| Las 7 untracked | intactas, ningún commit las referencia |
| Regresión de la build normal | Mercado abre normal en DEV; misma lista de chunks que la base |

Baseline heredado: 140 archivos / 1753 tests.

## Cómo seguir exactamente

```bash
cd /c/Users/Rodri/Proyectos/pokeswap
git fetch --all --prune
git checkout playtest/community-0.1
git status --porcelain
npx vitest run
npm run dungeon:entrances   # densidad real de cuevas
```

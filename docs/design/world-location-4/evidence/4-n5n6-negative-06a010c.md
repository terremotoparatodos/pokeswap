# WORLD LOCATION-4 — control negativo de N5/N6 sobre `06a010c`

Los tests nuevos (`hostLateAnswers.test.js`, `hostIdentityBinding.test.js` y el helper `testing/hostAuthority.js`) se copiaron sobre un `git archive` de `06a010c` (el candidato anterior, sin las correcciones) y se corrieron con Node 22.23.2. Los mismos archivos pasan sobre el código nuevo (8/8 y 8/8).

| Test | `06a010c` | Por qué falla (aserción) |
|---|---|---|
| N5-1 acquire en vuelo → stop | FAIL | `stop: stays stopped` — el host terminó `active` |
| N5-2 acquire en vuelo → displace | FAIL | `displace: stays stopped` — terminó `active` (y `displaced` a la vez) |
| N5-3 activate aplicado, respuesta retenida → stop | pass | la guarda de estado de F3 ya lo evitaba |
| N5-4 activate aplicado, respuesta retenida → displace | pass | ídem |
| N5-5 drain durante la recuperación | FAIL | `drain: stays stopped` — terminó `active` |
| N5-6 renovación de una identidad anterior | FAIL | `the new identity survives the old answer` — la generación nueva se reinició (2 → 3) |
| N5-7 acquire de la recuperación que falla después del stop | FAIL | el host volvió a `unavailable`, re-adquirió y se activó |
| N5 lane libre tras una respuesta tardía | FAIL | el host terminó `active` |
| N6 (`unknown_host`) | FAIL | `generation 2 untouched` — terminó en la generación 4 |
| N6 (`host_inactive`) | FAIL | `generation 2 untouched` — terminó en la generación 7 (5 reinicios de más) |
| N6 (`host_expired`) | FAIL | `generation 2 untouched` — terminó en la generación 3 |
| N6 (`newerActive`) | FAIL | `generation 2 untouched` — terminó en la generación 3 |
| N6 claim viejo en vuelo | FAIL | `identityResets` 2 en vez de 1 |
| N6 save viejo en vuelo (rechazo) | FAIL | `the old batch refusal is about generation 1: ignored` — 2 reinicios |
| N6 save viejo `stale` tras la pérdida | FAIL | cercado falso (`onFenced`, un 4409 en `on`) |
| N6 save viejo aplicado, respondido tras la pérdida | FAIL | la sesión siguió `claimed` en vez de `unpersisted` |

Resumen: en `06a010c` fallan 14 de los 16 tests, siempre por comportamiento (estado, generación o cercado) y nunca por una API ausente. Los dos que pasan (N5-3 y N5-4) cubren casos que la guarda de F3 ya resolvía.

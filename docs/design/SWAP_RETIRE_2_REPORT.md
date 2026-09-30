# SWAP RETIRE-2 — Limpieza funcional de Swap

Rama `world/swap-retire-cleanup-0.3`, desde `origin/integration/world-skills-0.3 @ 4ed2b62`.
Sin merge, sin deploy y sin cambios en hosted.

> ⚠️ **No redesplegar Swap desde `main @ 480b352`.** Esa revisión tiene el `pokeswap-swap`
> anterior a SWAP RETIRE-1: usa service role, elige el Pokémon recibido sin comprobar dueño y
> hace `upsert` sobre `slots`. `supabase functions deploy pokeswap-swap` desde ahí reabre el
> robo de Pokémon. Además, un push a `main` dispara `deploy.yml`, que publica en **producción**
> de Pages (el mismo proyecto que el playtest) una build normal con `SwapView`, que llama a
> `pokeswap-swap` y a `skip_swap_cooldown`. La única fuente válida de `pokeswap-swap` es la
> versión retirada (410) de `hotfix/retire-swap-0.2` / integración.

## 1. Razón de producto

Swap queda retirado para siempre. Pokémon se obtendrá más adelante por huevos, incubación y
captura. El edificio Silph Co. se conserva y anuncia que albergará investigación de huevos; esa
pantalla no se construye acá.

## 2. Vulnerabilidades

- **Corregida en RETIRE-1 (hosted `pokeswap-swap v15`):** la función elegía el Pokémon recibido
  sin comprobar su dueño y lo reasignaba con service role, de modo que podía quitárselo a otro
  jugador. Hoy responde `410 swap_retired`.
- **Corregida acá (pendiente de aplicar en hosted):** `skip_swap_cooldown()` seguía ejecutable por
  `authenticated`. Cobraba 1.000 tokens por limpiar un cooldown que ya no protege nada. Además,
  la build normal de integración @ `4ed2b62` todavía incluía `SwapView` con su botón para saltar
  el cooldown.

## 3. Auditoría

### Retirado ahora

| Elemento | Qué pasó |
|---|---|
| `src/features/swap/components/SwapView.vue` (+ test) | borrado |
| `src/features/swap/composables/useSwap.ts` (+ test) | borrado |
| `src/features/swap/api/swapApi.ts` (+ test): `pokeswap-swap`, `skip_swap_cooldown`, lectura de `swap_history` | borrado |
| `src/features/swap/index.ts` | borrado (no tenía consumidores) |
| Ruta `/swap` (build normal) | ahora muestra `SwapRetiredView`: aviso estático, sin sesión, API ni store. `/swap/<lo que sea>` cae en Ciudad |
| Entrada "Swap" del menú del lobby | quitada (flag `inMenu: false`) |
| Botón "Ir a Swap" de la ficha del Pokémon salvaje | quitado |
| Textos: NPCs (2), cartel y NPC de Silph Co., Pokédex y caja vacías ("¡Hacé un swap!") | reemplazados; las líneas de NPC conservan su posición en la lista |
| Puerta cerrada del playtest: "Queda cerrado durante el playtest" | ahora dice el aviso de retiro |
| Tests de `skipCooldown` en `progressionApi.test.ts` | borrados |
| `EXECUTE` de `skip_swap_cooldown` para `PUBLIC`/`anon`/`authenticated` | migración preparada (§5) |

Aviso único (`src/features/swap/retired.ts`):
«El intercambio fue retirado. Próximamente este edificio albergará investigación de huevos e
incubación.»

### Conservado temporalmente (historial o migración)

| Elemento | Por qué |
|---|---|
| Edge Function `pokeswap-swap` (410, sin service role, sin DB) | protege clientes viejos; sin cambios en esta rama |
| Función `skip_swap_cooldown()` y su cuerpo | trazabilidad y rollback administrativo; solo pierde permisos de cliente |
| Migraciones `20260907_005` y `20260914130000` | historia versionada; no se reescriben |
| Tabla `swap_history`, `profiles.swap_cooldown_until`, filas `token_ledger` con reason `skip_swap_cooldown`, `slots` | datos históricos y económicos; se resuelven después de `INSTANCES-1` |
| `Profile.swap_cooldown_until` y `SwapHistoryEntry` en `src/shared/types/database.ts` | espejo del esquema vivo; ningún código los usa (lo garantiza un test) |
| Origen `'swap'` en `pokemon/model/instance.ts`; menciones a `swap_history.was_shiny` en `legacy.ts` y `migration.ts` | procedencia histórica que necesitará el backfill de `INSTANCES-1` |
| Id de feature `swap` y `feature: 'swap'` del edificio en `hearthome.ts` | es la clave de la puerta de Silph Co.; no se toca el mapa |
| `create-payment-skip` | ya responde 503 `payments_disabled` |
| Documentos R-era (`INVARIANTS.md`, `TRUST_BOUNDARY.md`, `LEGACY_BASELINE.md`, etc.) | historia; no se reescriben |

No son Swap aunque lo parezcan: el ícono `swap` ("Cambiar" Pokémon) del combate de la
Dungeon, el sprite "Silph Co. (3D)" del City Lab, `travel.ts` (`swap` de área), `__pokeswapPerf`.

### Reemplazar en una fase posterior

| Elemento | Nota |
|---|---|
| Puerta de Silph Co. → investigación de huevos e incubación | feature propia, después de `INSTANCES-1` y `CRAFTING-1` |
| Id de feature `swap` | renombrarlo cuando exista la feature de huevos |
| **`kofi-webhook`** | **OPEN QUESTION / riesgo.** Sigue en el código: una donación de Ko-fi ≥ 1,00 limpia `swap_cooldown_until` con service role. Vende un salto que ya no vale nada. Es un flujo de pagos (AGENTS §12, §17), así que no se toca acá. Hay que decidir si se desactiva como `create-payment-skip` y verificar su estado en hosted |
| `paypal-ipn` | solo existe en hosted (BACKEND_INVENTORY §6.6); el mismo caso |
| Borrar `skip_swap_cooldown`, `swap_cooldown_until` y `swap_history` | después del backfill de `INSTANCES-1` |
| Comentario "A swap touches two slots…" en `usePlazaData.ts` | describe cambios de `slots` que el Mercado también produce; puede quedar |

### Workflows y scripts que pueden redesplegar código viejo

- `.github/workflows/deploy.yml`: un push a `main` construye la build normal y la publica en
  producción de Pages. En `main @ 480b352` esa build trae `SwapView`. **Riesgo alto.**
- `.github/workflows/deploy-community-playtest.yml`: un push a `playtest/community-0.1` publica la
  build Playtest, que no incluye `SwapView` (`PANEL_VIEWS` se pliega a `null`).
- Las Edge Functions y las migraciones **no** se despliegan por workflow; siempre es a mano con el
  CLI. El riesgo es humano: ejecutar un deploy desde un checkout de `main`.

## 4. Datos preservados

Nada se borra ni se transforma: `swap_history`, `slots`, `profiles.swap_cooldown_until`,
`token_ledger` y la función `skip_swap_cooldown`. La prueba PGlite comprueba que la migración no
toca ninguno de esos datos.

## 5. Migración preparada (no aplicada)

`supabase/migrations/20260930150000_retire_skip_swap_cooldown.sql`

- Busca en `pg_proc` todas las sobrecargas reales de `public.skip_swap_cooldown` y, a cada una, le
  hace `REVOKE ALL ... FROM PUBLIC, anon, authenticated` con su firma real (`regprocedure`), más
  un `COMMENT` que la marca como RETIRED. No supone ninguna firma.
- No hace `DROP`, no reescribe el cuerpo, no cobra ni devuelve tokens, no hace `GRANT` y deja
  `service_role` y al dueño como estaban. Se puede ejecutar de nuevo sin efecto, y tampoco falla si
  la función no existe.
- Firma auditada en el repositorio: solo `skip_swap_cooldown()` (`20260907_005`,
  `20260914130000`). Los permisos versionados eran: `PUBLIC` y `anon` revocados, `authenticated`
  con `EXECUTE`. **No pude leer el catálogo de hosted** (no hay CLI de Supabase ni credenciales en
  esta máquina), así que las firmas y los permisos reales de hosted quedan sin verificar. Por eso
  la migración recorre `pg_proc` en vez de nombrar la firma.

Para verificarla en hosted (lectura, antes de aplicarla):

```sql
SELECT p.oid::regprocedure, p.proacl, obj_description(p.oid, 'pg_proc')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'skip_swap_cooldown';
```

## 6. Riesgos para clientes viejos

- Un cliente cacheado con `SwapView` recibe `410 swap_retired` de `pokeswap-swap` (ya pasa hoy).
- Hasta que se aplique la migración, ese cliente todavía puede pagar 1.000 tokens con "Saltar
  cooldown". Después, recibirá `permission denied` (PostgREST 401/403) y no se cobrará nada.
- Los enlaces directos a `/swap` en la build nueva muestran el aviso; en Playtest, llevan a
  Ciudad.

## 7. Relación con lo que viene

- **INSTANCES-1:** el backfill de `PokémonInstance` va a necesitar `swap_history` (procedencia y
  `was_shiny`) y `slots`. Recién después se decide qué se borra.
- **CRAFTING-1, huevos e incubación:** Silph Co. es el lugar reservado. El aviso actual es
  provisional y no implementa nada.
- Cuando exista la feature de huevos: renombrar el id `swap`, borrar `SwapRetiredView` y
  `retired.ts`, y proponer una migración destructiva por separado.

## 8. Tests y gates

| Gate | Resultado |
|---|---|
| Deno real `pokeswap-swap` (`deno test`, Deno 2.9.7) | ✓ 9/9 · `deno check index.ts` ✓ · función sin cambios contra `4ed2b62` |
| PGlite: migración (`services/realtime/src/migrations/skipSwapCooldownRetire.test.js`) | ✓ 7/7 |
| Vitest completo | ✓ 183 archivos / 1779 tests |
| Tests relacionados (swap, router, lobby, menú, playtest, progresión) | ✓ |
| typecheck | ✓ |
| lint | ✓ 0 errores / 9 warnings (los mismos que en `4ed2b62`) |
| build normal + `scripts/swap-retire/bundle-check.mjs normal` | ✓ |
| build Playtest + `bundle-check.mjs playtest` | ✓ |
| Control negativo: el mismo chequeo sobre builds de `4ed2b62` | ✗ como se esperaba (`SwapView` con ambas llamadas en la normal; copy de Swap en las dos) |
| Drift de SKILLS (`bundle-skills.mjs --check`) | ✓ |
| Realtime completo | **pendiente**: esta máquina solo tiene Node 18.14, y Colyseus 0.18 necesita Node ≥ 22 (`import ... with`). Con Node 18 pasan 16 de 32 archivos, entre ellos el test nuevo; los otros 16 fallan al parsear, por el entorno. Esta rama no cambia código de realtime |

Tests nuevos:

- `src/features/swap/swapRetired.test.ts`: ninguna fuente llama a `pokeswap-swap` ni a
  `skip_swap_cooldown`, ni lee `swap_history` o el cooldown; `features/swap` solo tiene el aviso;
  no queda copy que prometa Swap; `/swap` directo muestra el aviso sin llamar al backend; en
  Playtest cae en Ciudad.
- `src/features/swap/components/SwapRetiredView.test.ts`: texto, ningún control, única importación
  `../retired`.
- Ajustados: menú (5 funciones, sin Swap), `features`, `useLobbyPanel`, `CityPanel`,
  `cityFeatures`, `routes`.
- Login, Ciudad y el resto de la navegación siguen cubiertos por las suites existentes (`routes`,
  `useLobbyPanel`, `LobbyMenu`, auth), todas en verde.

## 9. Pendientes que requieren Supabase local o hosted

- Aplicar la migración sobre un Supabase real (local con Docker o staging) y comprobar
  `has_function_privilege` y una llamada PostgREST como `authenticated`. PGlite reproduce los roles
  y los privilegios, pero no PostgREST ni el catálogo real de hosted.
- Leer firmas y ACL reales de `skip_swap_cooldown` en hosted (consulta del §5).
- Decidir `kofi-webhook` / `paypal-ipn` (pagos, tarea aparte).
- Realtime completo con Node ≥ 22.

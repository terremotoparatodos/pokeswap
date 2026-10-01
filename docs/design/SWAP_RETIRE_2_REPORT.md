# SWAP RETIRE-2 — Limpieza funcional de Swap

Rama `world/swap-retire-cleanup-0.3`, desde `origin/integration/world-skills-0.3 @ 4ed2b62`.
Al cerrar esa rama: sin merge, sin deploy y sin cambios en hosted. El estado actual está en
**Estado vigente**, justo abajo.

## Estado vigente (2026-09-30)

> **FACT — verificado en hosted por la estación principal el 2026-09-30** (proyecto de producción
> `qsufableozmyugcrhcai`). No se leyó desde este repositorio; se registra acá como cierre. Las
> secciones siguientes conservan la historia de cada rama. Donde digan «preparada», «no aplicada»
> o «sin deploy», describen el momento en que se escribieron, no el estado actual.

**Swap y `skip_swap_cooldown`:**

- `pokeswap-swap` sigue en **v15** (410 `swap_retired`).
- Migración aplicada en hosted como **`20260930230308 retire_skip_swap_cooldown`**; el archivo
  local está alineado: `supabase/migrations/20260930230308_retire_skip_swap_cooldown.sql`.
- Cuerpo de `skip_swap_cooldown` sin cambios. `PUBLIC`, `anon` y `authenticated` **sin
  `EXECUTE`**; `postgres` y `service_role` conservados.
- Prueba autenticada: HTTP **403**, SQLSTATE **42501**. Tokens, cooldown y ledger de la cuenta de
  prueba no cambiaron.

**Webhooks de pago (PAYMENTS RETIRE-2) desplegados:**

| Función | Versión | `verify_jwt` | Hash corto |
|---|---|---|---|
| `kofi-webhook` | v5 | `false` | `817d7f13` |
| `webhook-stripe` | v16 | `false` | `ac4e22bf` |
| `webhook-mercadopago` | v16 | `false` | `42552d73` |
| `webhook-paypal` | v9 | `false` | `28722c35` |
| `paypal-ipn` | v4 | `false` | `3d7e06ab` |

- `verify-remote before.json after.json` pasó. Las otras nueve funciones no cambiaron;
  `world-authority` sigue en v1.
- Los stubs responden `200` vacío. `kofi-webhook` con token falso responde `401`.
- Logs sin cuerpos ni datos recibidos. `kofi_payments` continúa con 0 filas.

**Rotación de Ko-fi — completada** (verificado por la estación principal, 2026-09-30):

- Ko-fi apunta al proyecto de producción (`qsufableozmyugcrhcai` / `kofi-webhook`).
- `KOFI_VERIFICATION_TOKEN` regenerado en Ko-fi y actualizado en Supabase, **sin redeploy** durante
  la rotación. El token anterior quedó invalidado.
- `Send Test` → **HTTP 200**: un solo POST, sin reintentos.
- Logs: solo `booted`, `kofi-webhook: acknowledged` y el registro de acceso. Ningún payload ni dato
  personal.
- `kofi_payments` sigue vacío.
- `skip_swap_cooldown` rechazó tanto a `anon` como a un usuario autenticado, sin cambiar tokens,
  cooldown ni ledger.

**Pendientes reales:**

1. **Retirar los endpoints en los paneles** de PayPal (IPN, botones, webhook REST), Stripe y
   MercadoPago (§10.8). Mientras tanto, los stubs contestan `200` vacío.
2. **Proyecto externo `xdhtasxadmhjltmtirxy`:** investigarlo o retirarlo si alguna vez se obtiene
   acceso. Es un proyecto Supabase **externo, histórico y no administrable**: es el
destino de la URL anterior de IPN de PayPal (`notify_url` en `js/swap.js`, commit `817c322`). No
tenemos acceso a ese proyecto ni evidencia de su tráfico histórico, así que **no consta** que haya
procesado donaciones o pagos reales.
3. **Reconciliar las migraciones antiguas** con versiones locales duplicadas antes de cualquier
   `supabase db push` general (§11).

> ⚠️ **No ejecutar un `supabase db push` general hasta reconciliar el historial local de
> migraciones con hosted.** Hay versiones locales duplicadas, un riesgo previo a estas tareas (§11).

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
- **Corregida acá (aplicada en hosted como `20260930230308`; ver Estado vigente):** `skip_swap_cooldown()` seguía ejecutable por
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
| `EXECUTE` de `skip_swap_cooldown` para `PUBLIC`/`anon`/`authenticated` | revocado por la migración `20260930230308`, aplicada en hosted (§5) |

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
| ↳ **PAYMENTS RETIRE-2** | `kofi-webhook` y `paypal-ipn` neutralizados en el repositorio (y también `webhook-paypal`, `webhook-stripe` y `webhook-mercadopago`); ver §10 |
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

## 5. Migración `20260930230308` — aplicada en hosted

`supabase/migrations/20260930230308_retire_skip_swap_cooldown.sql`

> **Estado vigente:** aplicada en hosted como `20260930230308 retire_skip_swap_cooldown`,
> verificado por la estación principal el 2026-09-30. Cuerpo sin cambios; `PUBLIC`, `anon` y
> `authenticated` sin `EXECUTE`; `postgres` y `service_role` conservados; una llamada autenticada
> recibe HTTP 403 / SQLSTATE 42501 sin cambiar tokens, cooldown ni ledger.
>
> **Historia:** se preparó como `20260930150000_retire_skip_swap_cooldown.sql` y se renombró sin
> tocar el contenido (mismo blob git `e08080b…` y mismo SHA-256) para coincidir con la versión de
> hosted. Lo que sigue describe cómo se preparó; la frase sobre el catálogo sin verificar vale
> para ese momento.

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
| Realtime completo | **pendiente al cerrar SWAP RETIRE-2; resuelto en PAYMENTS RETIRE-2** (Node 22.23.3: 195 pass, 0 fail, 20 skipped, §10.9). Nota original: esta máquina solo tiene Node 18.14, y Colyseus 0.18 necesita Node ≥ 22 (`import ... with`). Con Node 18 pasan 16 de 32 archivos, entre ellos el test nuevo; los otros 16 fallan al parsear, por el entorno. Esta rama no cambia código de realtime |

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

## 9. Pendientes al cerrar SWAP RETIRE-2 (resueltos)

> **Estado vigente:** los cuatro puntos quedaron resueltos. La migración se aplicó en hosted y se
> verificaron ACL y la llamada autenticada (403/42501). `kofi-webhook` y `paypal-ipn` se
> decidieron y desplegaron en PAYMENTS RETIRE-2 (§10). Realtime pasó con Node 22. La lista original
> queda como historia:

- Aplicar la migración sobre un Supabase real (local con Docker o staging) y comprobar
  `has_function_privilege` y una llamada PostgREST como `authenticated`. PGlite reproduce los roles
  y los privilegios, pero no PostgREST ni el catálogo real de hosted.
- Leer firmas y ACL reales de `skip_swap_cooldown` en hosted (consulta del §5).
- Decidir `kofi-webhook` / `paypal-ipn` (pagos, tarea aparte).
- Realtime completo con Node ≥ 22.

---

## 10. PAYMENTS RETIRE-2 — webhooks de pagos neutralizados

Rama `security/retire-payment-webhooks-0.3`, desde `origin/world/swap-retire-cleanup-0.3 @ 9475138`
(que deriva de la integración `4ed2b62`). Resuelve la OPEN QUESTION de `kofi-webhook` / `paypal-ipn`
del §3. Esta rama no hizo merge, deploy, cambios en hosted, SQL, migraciones nuevas, rotación de
secretos ni pagos de prueba. El deploy de las cinco funciones y la aplicación de la migración los
hizo después la estación principal (**Estado vigente**, al principio).

### 10.1 Decisión de producto

- Swap está retirado; nada reemplaza al salto de cooldown (ni huevos, ni tokens, ni mejores
  probabilidades).
- Ko-fi queda solo como donación voluntaria, **sin recompensa jugable**.
- PayPal, Stripe y MercadoPago quedan desactivados.
- Los proveedores conservan sus propios registros; por ahora no guardamos donaciones nuevas.

### 10.2 Comportamiento de cada endpoint

| Endpoint | `OPTIONS` | Llamada del proveedor | Qué **no** hace |
|---|---|---|---|
| `kofi-webhook` | 200 `ok` + CORS, sin leer secreto ni cuerpo | secreto ausente o vacío → **503** `unavailable` (sin leer el cuerpo) · token inválido, ausente, de otro tipo, cuerpo malformado o de más de 16 KiB → **401** `unauthorized` · token válido → **200** `ok` (donación, evento ignorado o duplicado: misma respuesta) | cliente de Supabase, service role, búsqueda de usuarios, `profiles`, `swap_cooldown_until`, `kofi_payments`, balances, red, dedupe |
| `paypal-ipn` | 200 `ok` + CORS | **200** vacío, siempre | leer el cuerpo, verificar el IPN contra PayPal, secretos, tablas, logs |
| `webhook-paypal` | idem | **200** vacío, siempre | idem |
| `webhook-stripe` | idem | **200** vacío, siempre | idem |
| `webhook-mercadopago` | idem | **200** vacío, siempre | idem |

Detalles de `kofi-webhook` (`supabase/functions/kofi-webhook/handler.ts`):

- El secreto llega por `deps`; `index.ts` solo lee `KOFI_VERIFICATION_TOKEN`.
- Comparación en tiempo constante: se hashean ambos lados con SHA-256 y se comparan los 32 bytes
  con XOR acumulado, así el tiempo no depende de dónde difieren ni de sus longitudes.
- El cuerpo se lee con tope de 16 KiB (por `content-length` y por lo realmente recibido); acepta el
  form `data=<json>` urlencoded y también multipart.
- Los logs son cuatro cadenas fijas (`not configured`, `rejected`, `acknowledged`,
  `internal error`). Ninguna incluye nada recibido, ni antes ni después de validar el token.
- Ningún camino distingue tipo de evento, monto o `is_public`: sin efectos, no hay nada que decidir.

Los cuatro stubs comparten `supabase/functions/_shared/retiredPaymentWebhook.ts` (sin imports).
`_shared` es la convención de Supabase: el CLI no lo despliega como función y lo empaqueta dentro
de cada función que lo importa.

### 10.3 Configuración JWT

**FACT** (docs oficiales y código del CLI, `apps/cli/src/shared/functions/deploy.ts` en
`supabase/cli@develop`):

- No existe un archivo de configuración por función. El único lugar versionado para
  `verify_jwt` es `[functions.<slug>]` dentro de `supabase/config.toml`, que es la configuración
  **de todo el proyecto**.
- Precedencia al desplegar: `--no-verify-jwt` explícito → `verify_jwt` de `config.toml` → el valor
  que ya tenga la función en hosted.
- `supabase functions deploy` sin nombre despliega **todas** las funciones de
  `supabase/functions/`.

**Decisión:** no se agrega `supabase/config.toml`. El repositorio no lo tiene, y agregarlo, aunque
sea mínimo, lo convierte en la configuración que leen `supabase start`, `db push`, `link` y
`config push`. `config push` puede empujar a hosted los valores por defecto de secciones no
escritas (auth, API). Eso no se puede garantizar como inocuo sin leer la configuración de hosted.

En su lugar:

- `--no-verify-jwt` va explícito en un deploy **de una sola función**.
- `scripts/payment-retire/webhook-deploy-guard.mjs` (Node, sin dependencias, nunca ejecuta el CLI):
  - `check`: las cinco fuentes son las retiradas (falla, por ejemplo, desde `main`, donde está el
    `kofi-webhook` viejo y no existen los stubs). Si algún día aparece un `config.toml`, exige
    que no declare `verify_jwt = true` para ninguna de las cinco; lo que declare para otras
    funciones no es asunto de esta tarea.
  - `command <slug>`: corre `check` e imprime el único comando válido. Rechaza otros slugs, el
    deploy sin nombre, refs mal formados, cualquier proyecto que no sea producción y el externo
    `xdhtas…`.
  - `verify-remote <before.json> <after.json> --project-ref qsufableozmyugcrhcai`: compara los
    dos inventarios de `supabase functions list --output json`, tomados justo antes y justo
    después del deploy. Exige:
    - las cinco existen en `after.json` con `verify_jwt = false`;
    - cada función no objetivo que estaba en `before.json` sigue existiendo, con el **mismo**
      `verify_jwt` que tenía (sea `true` o `false`: no supone ningún valor) y los mismos `id`,
      `version`, `ezbr_sha256`, `status`, `updated_at`, `entrypoint_path`, `import_map` e
      `import_map_path`, cuando `before.json` los trae;
    - no aparece ninguna función nueva: solo las cinco pueden cambiar versión o hash;
    - **identidad del proyecto:** en **ambos** inventarios, las cinco tienen sus `id` de
      producción, fijados en el guard (`PRODUCTION_FUNCTION_IDS`):

      | Función | `id` en producción |
      |---|---|
      | `kofi-webhook` | `9a59d5c8-cae3-4545-a8eb-257c19668a8b` |
      | `paypal-ipn` | `fab0ec1d-87cc-4d24-99ef-5dd55628a5b9` |
      | `webhook-paypal` | `3be1f08d-9758-4d1c-98a8-d0cf78dee61d` |
      | `webhook-stripe` | `46a7e11f-1767-4e90-9cfd-0eb38a0a8e2e` |
      | `webhook-mercadopago` | `c9db404c-339d-4eb0-a52a-096d8de4ffd5` |

      Son identificadores públicos y se mantienen al redesplegar. La versión y el hash de las cinco
      **no** se fijan: el deploy los cambia.

    Falla si falta alguno de los dos inventarios, si falta `--project-ref`, si el ref no es
    producción (incluido `xdhtas…`), si alguna de las cinco falta o tiene otro `id` en cualquiera
    de los dos archivos (incluidos `id` intercambiados entre slugs, o inventarios coherentes de
    otro proyecto), o si cambia el `id` de una función ajena. El JSON del CLI no trae el ref del
    proyecto: la identidad la dan esos cinco `id`.

Cambio intencional respecto de hosted: `webhook-stripe`, `webhook-mercadopago` y `webhook-paypal`
tenían `verify_jwt = true`, así que el gateway le respondía 401 al proveedor y este reintentaba.
Pasan a `false` para que el stub conteste 200.

### 10.4 Proyectos y versiones hosted anteriores

- **Producción:** `qsufableozmyugcrhcai` (el mismo del playtest).
- **Externo, histórico y no administrable:** `xdhtasxadmhjltmtirxy`. Es el destino de la URL
  anterior de IPN de PayPal: el monolito (`js/swap.js`, commit `817c322`) ponía como `notify_url`
  `https://xdhtasxadmhjltmtirxy.supabase.co/functions/v1/paypal-ipn`. No tenemos acceso ni evidencia
  de su tráfico histórico, así que no consta que haya procesado donaciones o pagos reales. No
  podemos desplegar ni cambiar nada ahí; el guard lo rechaza.
- **Versiones vigentes** (desplegadas el 2026-09-30): `kofi-webhook` v5 (`817d7f13`),
  `webhook-stripe` v16 (`ac4e22bf`), `webhook-mercadopago` v16 (`42552d73`), `webhook-paypal` v9
  (`28722c35`), `paypal-ipn` v4 (`3d7e06ab`), todas con `verify_jwt=false`. La tabla siguiente es
  historia.
- Versiones hosted anteriores, según la lectura en vivo del **2026-09-07** (R02, encabezado de
  `BACKEND_INVENTORY.md`: «Live read … via Supabase MCP on 2026-09-07»). **No es un error de
  fecha:** esa es la última lectura de hosted registrada en el repositorio. La auditoría de
  PAYMENTS RETIRE-2 (2026-09-30) trabajó solo sobre el repositorio y **no leyó hosted**. Si hubo
  otra lectura de hosted el 2026-09-30, sus valores no están versionados y deben reemplazar esta
  tabla. `before.json` (§10.6) será el registro autoritativo:

  | Función | Versión | JWT |
  |---|---|---|
  | `kofi-webhook` | 1 (**INFERENCE:** probablemente redesplegada tras SEC-04/R11) | ✗ |
  | `paypal-ipn` | 1 | ✗ |
  | `webhook-paypal` | 6 | ✓ |
  | `webhook-stripe` | 13 | ✓ |
  | `webhook-mercadopago` | 13 | ✓ |

  Antes de desplegar, guardar `supabase functions list --project-ref qsufableozmyugcrhcai --output
  json` como `before.json` (solo metadatos): es la base de `verify-remote`. **No se copian fuentes hosted al repositorio:** pueden
  tener secretos (la v1 de `kofi-webhook` tenía el token literal, SEC-04) y manejo de payloads.

### 10.5 Datos preservados

Nada se borra ni se modifica: `kofi_payments`, `transactions`, `token_ledger`,
`profiles.swap_cooldown_until`, los secretos actuales y los registros de cada proveedor. No hay
migraciones nuevas; la que revoca `skip_swap_cooldown` ya estaba en la base (§5). La brecha SEC-01
(RLS apagado en `kofi_payments`) sigue abierta y queda para una tarea de esquema.

### 10.6 Plan de despliegue y rotación de Ko-fi

> **Estado vigente (2026-09-30):** la estación principal desplegó las cinco funciones y
> `verify-remote before.json after.json` pasó. Stubs → `200` vacío; Ko-fi con token falso →
> `401`; logs limpios. Después se completaron los pasos 4–8: token regenerado en Ko-fi y
> actualizado en Supabase sin redeploy, token anterior invalidado, `Send Test` → `200` (un solo
> POST, sin reintentos), logs solo con `booted`, `kofi-webhook: acknowledged` y acceso.
> **El plan está completo.** Lo que sigue es el procedimiento tal como se escribió.

El token de Ko-fi está comprometido: la v1 hosted lo tenía literal en el código (SEC-04), y el
handler anterior imprimía el payload completo, token incluido, en los logs de la función. Regla
central: **la implementación vieja nunca debe llegar a recibir el token nuevo.** Por eso primero se
neutraliza `kofi-webhook` con el token actual, y recién después se rota.

Preparación, desde un checkout limpio de esta rama en su SHA final, con el CLI autenticado:

```bash
node scripts/payment-retire/webhook-deploy-guard.mjs check
deno test --allow-read --allow-write --allow-env supabase/functions/kofi-webhook/ supabase/functions/_shared/
```

Orden obligatorio:

1. **Tomar un `before.json` nuevo**, justo antes del primer deploy (no reutilizar uno viejo):
   ```bash
   supabase functions list --project-ref qsufableozmyugcrhcai --output json > before.json
   ```
2. **Desplegar `kofi-webhook` seguro con el secreto actual** (no tocar `KOFI_VERIFICATION_TOKEN`):
   ```bash
   node scripts/payment-retire/webhook-deploy-guard.mjs command kofi-webhook
   # → supabase functions deploy kofi-webhook --project-ref qsufableozmyugcrhcai --no-verify-jwt --use-api
   ```
3. **Verificar en hosted**, antes de seguir:
   - **Corresponde al código nuevo:** en `supabase functions list` tiene una versión nueva y un
     `ezbr_sha256` distinto del de `before.json`. Además, descargarlo fuera del repo y compararlo con
     esta rama:
     ```bash
     supabase functions download kofi-webhook --project-ref qsufableozmyugcrhcai --workdir "$(mktemp -d)"
     ```
     `index.ts` y `handler.ts` deben coincidir con `supabase/functions/kofi-webhook/`.
   - **No usa Supabase ni service role:** en la fuente descargada no aparecen `createClient`,
     `supabase-js`, `SERVICE_ROLE`, `profiles`, `swap_cooldown` ni `kofi_payments`.
   - **Token actual válido → `200`:** *Send Test* desde Ko-fi (todavía con el token actual; no es un
     pago).
   - **Token incorrecto → `401`:**
     ```bash
     curl -s -o /dev/null -w "%{http_code}\n" --data-urlencode 'data={"verification_token":"not-the-token"}' https://qsufableozmyugcrhcai.supabase.co/functions/v1/kofi-webhook
     ```
   - **No registra payloads:** los logs de esas dos llamadas (Dashboard → Edge Functions →
     `kofi-webhook` → Logs) son solo `kofi-webhook: acknowledged` y `kofi-webhook: rejected`.

   Si algo de esto falla, **no rotar**: se corrige y se vuelve a desplegar desde esta rama.
4. **Recién entonces**, regenerar el verification token en Ko-fi (*More → API → Webhooks*).
5. **Cargar inmediatamente el token nuevo** mediante un archivo temporal privado, fuera del repo, sin
   pasarlo por la línea de comandos ni por el historial de la shell:
   ```bash
   umask 077; KOFI_ENV="$(mktemp)"
   # pegar en ese archivo, con un editor, la línea KOFI_VERIFICATION_TOKEN=<token nuevo>
   supabase secrets set --env-file "$KOFI_ENV" --project-ref qsufableozmyugcrhcai
   ```
   El secreto aplica a las invocaciones nuevas, sin redesplegar.
6. **Borrar el archivo temporal:** `rm -f "$KOFI_ENV"`.
7. **Enviar *Send Test* desde Ko-fi** y comprobar `200` (`kofi-webhook: acknowledged`). Un
   `rejected` indica que el secreto y Ko-fi no coinciden: repetir 5–6.
8. **Confirmar que los logs posteriores contienen únicamente los mensajes fijos** (`not configured`,
   `rejected`, `acknowledged`, `internal error`), sin token, email, nombre, mensaje ni cuerpo.
9. **Desplegar los cuatro stubs restantes**, uno por vez, con el comando que imprime el guard:
   `webhook-stripe`, `webhook-mercadopago`, `webhook-paypal`, `paypal-ipn`. Humo sin pagos:
   `OPTIONS` y `POST {}` a cada uno → `200`.
10. **Tomar `after.json` y ejecutar el guard:**
    ```bash
    supabase functions list --project-ref qsufableozmyugcrhcai --output json > after.json
    node scripts/payment-retire/webhook-deploy-guard.mjs verify-remote before.json after.json --project-ref qsufableozmyugcrhcai
    ```

Entre los pasos 4 y 5, el handler **nuevo** puede responder `401` a Ko-fi. Es seguro: no filtra el
token (no se loguea nada recibido), no hay efectos que perder y Ko-fi reintenta. Nunca regenerar el
token antes de completar los pasos 2 y 3: el handler viejo lo imprimiría en los logs.

**La rotación no bloquea la neutralización.** Si el dueño no puede entrar a Ko-fi en ese momento, se
hacen 1–3, después 9–10, y la rotación (4–8) queda como **pendiente urgente**, en ese mismo orden.
Hosted queda neutralizado con el token existente, que ya no se loguea.

Nunca `--prune`, nunca deploy sin nombre, nunca desde `main` ni desde una rama anterior a este
cambio. `before.json` se toma una sola vez (paso 1) y `after.json` al final (paso 10). Si en el medio
alguien despliega una función ajena, `verify-remote` falla a propósito: hay que entender ese cambio
antes de dar el deploy por bueno. **INFERENCE:** `secrets set` no modifica los metadatos de las
funciones. Si `verify-remote` marcara cambios en funciones ajenas después del paso 5, hay que revisarlo
antes de aceptar.

**Rollback seguro.** No volver nunca a las versiones hosted anteriores: reactivan la venta del
salto de cooldown, escriben con service role y loguean datos personales y el token. Si un stub
diera problemas, se redespliega el mismo stub desde esta rama. En una emergencia,
`supabase functions delete <slug> --project-ref qsufableozmyugcrhcai` deja el endpoint en 404: el
proveedor reintenta, pero no se otorga nada. `kofi-webhook` no tiene estado que revertir.

### 10.7 Rotación de `KOFI_VERIFICATION_TOKEN` (obligatoria)

Es parte del orden de §10.6 (pasos 4–8) y no puede adelantarse a los pasos 2–3. Resumen: primero
el handler seguro con el token actual, se verifica en hosted, y recién después se regenera el token
en Ko-fi y se carga en Supabase.

### 10.8 Tareas manuales (fuera del repositorio)

**Completado (2026-09-30):** Ko-fi apunta a producción; `KOFI_VERIFICATION_TOKEN` rotado, con el
token anterior invalidado; `Send Test` válido → `200`.

**Pendientes reales:** retirar los endpoints en los paneles de PayPal, Stripe y MercadoPago;
investigar o retirar el proyecto externo `xdhtasxadmhjltmtirxy` si alguna vez se obtiene acceso; y
reconciliar las migraciones con versiones duplicadas antes de cualquier `supabase db push` general
(§11). Detalle:

- **Ko-fi (opcional):** quitar de la página de Ko-fi y de cualquier texto público la promesa de
  «saltar el cooldown» con una donación, si todavía figura. Si no se quieren recibir webhooks,
  borrar la URL en Ko-fi (la función puede quedar igual).
- **PayPal:** desactivar el IPN o cambiar su URL en el perfil (*Notifications → Instant Payment
  Notifications*), porque la URL anterior de IPN apuntaba al proyecto externo `xdhtas…`. También,
  desactivar o borrar los botones de pago y el webhook REST que apunte a `webhook-paypal`.
- **Stripe / MercadoPago:** deshabilitar los endpoints de webhook y las URLs de notificación en sus
  paneles. Los stubs contestan 200 mientras tanto.
- Revisar en hosted los logs viejos de `kofi-webhook` y `paypal-ipn` (datos personales) según la
  política de retención. Esta tarea no los toca.
- `create-checkout` y `create-payment-skip` quedan fuera de alcance (el segundo ya responde 503).
- **Proyecto externo `xdhtasxadmhjltmtirxy`:** investigarlo o retirarlo si alguna vez se obtiene
  acceso. Hoy es histórico y no administrable, y no consta que haya procesado donaciones reales. No
  se despliega nada ahí.

### 10.9 Tests y gates

| Gate | Resultado |
|---|---|
| Deno real, 5 funciones (`deno test`, Deno 2.9.7, SHA-256 del zip verificado) | ✓ `kofi-webhook` 15/15 · stubs 27/27 (6 por función + 3 comunes) · con `pokeswap-swap` y `world-authority`: 57/57 |
| `deno check` de los cinco `index.ts` | ✓ |
| Humo HTTP real (`Deno.serve` en 127.0.0.1, `--allow-net=127.0.0.1`) | ✓ Ko-fi: OPTIONS 200, token válido 200, inválido 401; stubs: OPTIONS 200, POST 200 vacío; ningún log de los stubs |
| Mutaciones sobre el `handler.ts` real de Ko-fi | ✓ loguear el payload → 6 tests fallan · escribir el cooldown → 8 fallan · aceptar cualquier token → 1 falla |
| Guard de deploy (`node --test "scripts/payment-retire/*.test.mjs"`) | ✓ 28/28 (incluye: el `kofi-webhook` de `9475138` es rechazado; `verify-remote` antes/después: función ajena en `false` válida, `false→true` y `true→false` fallan, borrar o cambiar versión/hash/metadatos falla, función nueva falla, objetivo en `true` falla, inventarios ausentes fallan; identidad: `id` correctos pasan, `id` incorrecto en before o en after, `id` intercambiados y otro proyecto coherente fallan. Control negativo: sin el chequeo de `id`, esos 5 tests fallan) |
| Realtime completo (`node --test`, **Node 22.23.3** portátil) | ✓ 195 pass · 0 fail · 20 skipped (todas: gate de staging RC-0.3, requiere Supabase local) |
| Integración / PGlite | ✓ incluidos arriba (`integration.test.js`, `database.test.js`, `skipSwapCooldownRetire.test.js`, restart en disco) |
| Vitest completo | ✓ 183 archivos / 1779 tests |
| typecheck | ✓ |
| lint | ✓ 0 errores / 9 warnings (los mismos de `9475138`, todos en `AuthModal.vue`) |
| build normal + `swap-retire/bundle-check.mjs normal` | ✓ |
| build Playtest + `bundle-check.mjs playtest` | ✓ |
| Drift de SKILLS (`bundle-skills.mjs --check`) | ✓ (control negativo: con el bundle alterado sale 1) |

Tests nuevos:

- `supabase/functions/kofi-webhook/handler.test.ts`: OPTIONS; secreto ausente o vacío; tokens
  inválidos (distinto, truncado, más largo, mayúsculas, vacío, número, array, null, ausente); token
  válido; multipart; eventos ignorados; duplicados; cuerpos malformados; cuerpo grande, con y sin
  `content-length`, y en streaming; ningún log contiene datos recibidos; sin red, archivos, RNG ni
  env; el `index.ts` real solo lee `KOFI_VERIFICATION_TOKEN`; sin imports de Supabase, service
  role ni operaciones de base; mutantes que loguean el payload o escriben el cooldown (por `fetch`
  y por `createClient`) hacen fallar los guards.
- `supabase/functions/_shared/retiredPaymentWebhook.test.ts`: por cada stub, a través de su
  `index.ts` real: registra el handler compartido; OPTIONS; POST → 200 vacío; cuerpos de
  PayPal/IPN/Stripe/MercadoPago, JSON roto, binario y 1 MiB, más GET/PUT/PATCH/DELETE, dan la misma
  respuesta y `bodyUsed` sigue en `false`; cero logs, red, env, archivos y RNG; fuente sin imports
  administrativos, secretos, lectura del cuerpo ni base. Además: mutantes del stub son detectados, y
  todo directorio `*paypal*|*stripe*|*mercadopago*` está cubierto.
- `scripts/payment-retire/webhook-deploy-guard.test.mjs`: descrito en §10.3.

---

## 11. Riesgo preexistente: versiones de migración duplicadas

**FACT.** Varias migraciones antiguas usan nombres con un sufijo numérico después de la fecha:

- `20260907_001_*.sql` … `20260907_008_*.sql` (8 archivos);
- `20260908_009_*.sql`, `20260908_010_*.sql`, `20260908_011_*.sql` (3 archivos).

El CLI de Supabase toma como versión **solo los dígitos anteriores al primer `_`**. Localmente
existen entonces 8 migraciones con la versión `20260907` y 3 con `20260908`. Las demás versiones
(`20260914130000`, `20260919`, `20260924042219`, `20260926…`, `20260930230308`) son únicas.

**No lo causó PAYMENTS RETIRE-2** (ni SWAP RETIRE-2). El único cambio de migraciones de estas
tareas fue renombrar la de retiro a `20260930230308`, que es única y la última del orden.

**Consecuencia: no ejecutar un `supabase db push` general hasta reconciliar el historial local con
el de hosted.** No se sabe cómo registró hosted esas versiones. Un `db push` podría intentar
aplicar de nuevo, o en otro orden, migraciones que hosted ya tiene. Esta tarea no renombra ni
repara esas migraciones: la reconciliación (leer `supabase_migrations.schema_migrations` en hosted,
decidir nombres y, si hace falta, `migration repair`) queda para una tarea propia.

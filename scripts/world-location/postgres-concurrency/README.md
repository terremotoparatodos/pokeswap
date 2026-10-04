# WORLD LOCATION-4 — batería de concurrencia sobre Postgres real (F2)

Regresiones deterministas para los dos locks de `supabase/migrations/20261003120000_world_location_ordering.sql`:

| Lock | Qué protege | Escenarios |
|---|---|---|
| `LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE` en `world_presence_activate` | I16/I18: la respuesta de activate es el estado que encontró, y la activación está serializada | A1, A2, A4 |
| `FOR SHARE` sobre la fila del host en `world_location_claim_keyed` | I17: un host nunca gana una fila después de que su drain o su stop commiteó | A5, A6 |

**Solo local.** Nada de esto toca hosted, `.env`, claves ni secretos.

## 1. Requisitos

- Docker con endpoint local: `DOCKER_HOST` sin definir, o un socket unix o named pipe. El runner lo verifica.
- Supabase CLI. Se probó con 2.114.0.
- Node 22 o 24.
- Un stack de Supabase local **dedicado**. La batería crea usuarios sintéticos (`wloc-f2-…@example.test`) y hosts de presencia, y al terminar detiene solo los hosts que creó. No la corras en paralelo con otra suite sobre la misma base.

**Conexión privilegiada (requisito explícito).** El runner abre una conexión por actor con `docker exec -i supabase_db_<id> psql -U postgres`. Es el rol `postgres` del stack local, por el socket del contenedor y sin contraseña. Esa conexión `postgres` se usa solo para tres cosas:

1. **Fixtures:** filas sintéticas en `auth.users`.
2. **Observación:** esperas de lock en `pg_stat_activity`, cuerpos de las funciones en `pg_proc`, y filas de hosts y de ubicaciones.
3. **Limpieza:** detener los hosts propios y terminar los backends propios que hayan quedado colgados.

Toda operación bajo prueba corre como `service_role` (`SET ROLE`), igual que la llama PostgREST.

## 2. Comandos

```bash
# Stack solo-DB por build (carpeta FUERA del repo; puertos propios para no chocar con otro stack)
node scripts/world-location/postgres-concurrency/prepare.mjs init --dir <tmp>/orig --project-id wlocpg-orig --port-prefix 571 --db-only
cd <tmp>/orig && supabase start -x studio,imgproxy,vector,logflare,mailpit,realtime,storage-api,postgres-meta,supavisor,gotrue,kong,postgrest,edge-runtime
node scripts/world-location/postgres-concurrency/prepare.mjs migrate --container supabase_db_wlocpg-orig --build original

# Lo mismo con rv1 (--port-prefix 572) y rv2 (573): migrate --build rv1 | rv2 aplica el mutante EN MEMORIA
# (un único reemplazo exacto); el archivo del repo conserva sus bytes.

node scripts/world-location/postgres-concurrency/run.mjs --container supabase_db_wlocpg-orig --build original --rounds 10
node scripts/world-location/postgres-concurrency/run.mjs --container supabase_db_wlocpg-rv1  --build rv1      --rounds 10
node scripts/world-location/postgres-concurrency/run.mjs --container supabase_db_wlocpg-rv2  --build rv2      --rounds 10
node --test scripts/world-location/postgres-concurrency/judge.test.mjs   # el juez, sin base
```

- **Sin `--db-only`**, `init` también copia `world-authority`. Sirve para el stack completo del gate de staging (`scripts/integration/rc03-staging/README.md`).
- **`migrate`** aplica las 9 migraciones de staging en el orden de hosted, y se niega a correr sobre una base que ya las tiene.
- **`--out <archivo.json>`** guarda el reporte completo.
- **`--only A1,A5`** corre un subconjunto.

**Códigos de salida de `run.mjs`:**

| Código | Veredicto | Cuándo |
|---|---|---|
| `0` | PASS | El build se comportó como se esperaba. |
| `1` | FAIL | El original tuvo una violación, o un mutante sobrevivió o lo detectó un escenario que no debía. |
| `2` | BLOCKED | Falta Postgres local, el contenedor no existe o no responde, el build vivo no es el pedido (se lee de `pg_proc`), hubo algún `harness_error`, o Postgres reportó deadlocks. |

Un BLOCKED **nunca** se informa como PASS y nunca cuenta como detección. Si se pide la batería y no hay base local, el comando sale con 2 y un mensaje `BLOCKED: …`; nunca omite los escenarios y aprueba.

## 3. Cómo se fuerza la intercalación, y por qué las carreras simples no bastaban

Cada lock cierra una ventana entre dos sentencias de una misma función:

- **activate:** entre el `SELECT` de su propia fila (y el chequeo «ningún host más nuevo activo») y su `UPDATE … WHERE state = 'starting'`.
- **claim:** entre el chequeo del host y el `INSERT … ON CONFLICT` de la fila del jugador.

Esa ventana dura microsegundos.

Los tests Q6 de `locationStaging.test.js` lanzaban las dos operaciones con `Promise.all` a través de la Edge Function. Con eso, Postgres casi siempre ejecuta una función entera antes que la otra, así que el resultado coincide con un orden serial válido haya lock o no. Esa es la forma de los controles A4b y A5b: con RV1 y con RV2 pasan 10 de 10 rondas, igual que PGlite, que corre una sola conexión. Ni la carrera ni PGlite pueden distinguir el código con lock del código sin lock.

La batería abre la ventana a propósito, con operaciones reales:

- **A1, A2:** el stop o el drain del mismo host candidato deja su transacción abierta.
- **A4:** la renovación del lease del candidato viejo, su operación concurrente real, retiene su fila mientras el candidato nuevo se activa.
- **A5, A6:** el flush del dueño anterior retiene la fila del jugador.

Antes de liberar la barrera, el runner confirma en `pg_stat_activity` (`wait_event_type = 'Lock'`) que el otro actor espera de verdad. Recién ahí commitea. Después compara la respuesta, el estado del host y la propiedad de la fila con lo que admite un orden serial coherente con el orden de commit. Nunca mira si existe el lock: con lock, la operación espera en `Lock:relation` o en `Lock:transactionid`; sin lock, espera en la fila o termina. Las dos formas son válidas; lo que se juzga es lo que queda después.

## 4. Escenarios

| Id | Barrera | Invariante | RV1 | RV2 |
|---|---|---|---|---|
| A1 | stop del candidato (txn abierta) → activate | stop commitea primero ⇒ `host_inactive/stopped`; `active` solo si `activated_at` ≠ null | **detecta** | pasa |
| A2 | drain del candidato (`starting` → `stopped`) → activate | ídem | **detecta** | pasa |
| A3 | renew del candidato → activate (control) | `active`, fila `active` | pasa | pasa |
| A4 | renew del viejo (txn abierta) → activate viejo → activate nuevo | el nuevo nunca se rechaza; si el nuevo commiteó primero, el viejo recibe `newer_active` (I18); fila del viejo = su respuesta | **detecta** | pasa |
| A4b | carrera simple de dos activaciones (control) | ídem, sin barrera | pasa | pasa |
| A5 | flush del dueño anterior (txn abierta) → claim → drain | si el drain commiteó antes que el claim: el claim no toma la fila (`host_inactive/draining`); dueño, sesión y epoch intactos | pasa | **detecta** |
| A6 | ídem con stop | ídem (`stopped`) | pasa | **detecta** |
| A5b | carrera simple claim ‖ drain (control) | `claimed` o `host_inactive/draining` | pasa | pasa |

**Resultados de cada ronda** (`judge.mjs`):

- **`pass`:** se cumplieron todas las aserciones.
- **`violation`:** falló una aserción de invariante. Es la única forma de detección.
- **`harness_error`:** cualquier otra cosa: un deadline (5 s por paso, 10 s por respuesta, 60 s por escenario), una barrera no confirmada, un error SQL inesperado (incluido un deadlock) o una conexión cerrada.

**Cierre de recursos.** Al terminar cada escenario, también si falló, se cierran sus conexiones (ROLLBACK, salida de psql y kill del proceso si no termina), se terminan sus backends y se detienen sus hosts.

Evidencia: `docs/design/world-location-4/evidence/5-postgres-concurrency.md`.

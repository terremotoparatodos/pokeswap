# ECO limited — corrección exclusiva L-R1

Candidato de partida: `dfc81b46af2f81ba39b65dfade5899d1ff1dba53`, verificado antes de editar. Rama nueva `codex/eco-lr1-public-credentials`; worktree nuevo `C:/Users/Rodri/.codex/worktrees/eco-lr1-public-credentials/pokeswap` (ruta física `D:/CHATGPT/Datos-Codex/worktrees/eco-lr1-public-credentials/pokeswap`).

## Cambio acotado

Una guarda compartida, sin dependencias, clasifica **contenido**: rechaza el prefijo privado reconocible `sb_secret_…` y un JWT cuyo payload JSON declare `role: service_role`, incluso con firma ficticia. El nombre del campo sólo identifica el error; no determina si el contenido es público.

Se aplica en las entradas públicas pertinentes:

- `validateLimitedBuild`: antes de resolver/generar el cliente mediante Vite, también sin opt-in limited.
- `limitedRelease`: en `SUPABASE_PUBLISHABLE_KEY`, también antes del retorno de producción normal.
- Configuración del cliente Supabase existente: antes de `createClient`. No cambia login, sesión, SDK options ni autenticación.

Publishable, JWT anon y los placeholders SCRIPTED ya usados siguen admitidos. El requerimiento anterior de clave no vacía permanece en sus entradas. La guarda no examina ni cambia `WORLD_AUTHORITY_SECRET`.

**Límite:** previene errores reconocibles de configuración; **no detecta cualquier secreto arbitrario ni certifica una cadena desconocida como pública**. No verifica firma/validez del JWT ni reemplaza Auth. No debe colocarse ninguna credencial privada en el cliente. Los errores incluyen exclusivamente el campo, nunca el valor, el payload o una excepción de decodificación como causa.

## Reproducciones y custodia

Informe original: `C:/Users/Rodri/Documents/Codex/2026-10-11/eco-limited-review-dfc81b4/ECO-LIMITED-REVIEW-dfc81b4.md`.

Evidencia nueva: `D:/CHATGPT/Datos-Codex/worktrees/eco-lr1-public-credentials/lr1-evidence/`.

- `originals/`: copias exactas de la evidencia recibida; originales no editados. Sus hashes se conservan/verifican en el manifest de custodia del delta.
- `before/`: ambas sondas originales sobre el candidato exacto. Los dos validadores aceptan ambas formas privadas ficticias; builds negativos salen 0 y publican la forma de prefijo. `expectedNegativePass=false` confirma el defecto, no un PASS.
- `after/`: ambas sondas repetidas. Validadores rechazan ambas formas; builds negativos salen 1, sin cliente publicado, `expectedNegativePass=true` y `securityControlPass=true`. Los builds públicos originales y sus exclusiones pasan.
- Adaptaciones documentadas: sólo rutas de copia/salida y resolución del nuevo import compartido en la transpilación data-URL de la sonda. Fixtures, criterios y lógica de las sondas originales conservados. La sonda original de line endings modifica/restaura temporalmente únicamente la copia propia. Los hashes de los builds corregidos no se esperan iguales a los del candidato.
- `regressions/`: matriz reproducible de builds reales, con publishable/anon y las dos formas privadas, normal/limited. Sin credenciales reales, llamadas Auth/Edge, servicios del juego ni hosted.

## Comprobación afectada

| Control | Resultado |
| --- | --- |
| Matriz real Vite | 8/8 PASS: cuatro rechazos exit 1 **antes de crear directorio de salida o transformar módulos**; cuatro builds públicos exit 0 |
| Privacidad de diagnóstico | Ningún log de rechazo incluye el valor ficticio; errores sin payload/cause |
| Guarda y configuración servidor | 5/5 PASS, incluyendo las aserciones productivas existentes |
| Perfil, configuración cliente, shell/transporte/rutas/AuthModal existentes | 23/23 PASS; no llamadas Auth reales |
| Typecheck | PASS |
| Lint dirigido frontend/scripts modificados | PASS, sin errores ni advertencias; el lint raíz sigue ignorando backend |
| Sondas originales antes/después | Reproducen el FAIL del candidato y el rechazo corregido; exclusiones existentes intactas |

Node utilizado: `v24.19.0`, como el build del candidato. Sólo instalación offline de los lockfiles existentes; ningún cambio de dependencias. No se reabrieron suites generales, carreras runtime ya aprobadas ni una auditoría de combate.

Reproducción del delta, sin iniciar servicios:

```text
node scripts/eco/verify-public-credentials.mjs <directorio-absoluto-nuevo-fuera-del-worktree>
node --test services/realtime/src/security/publicSupabaseKey.test.js services/realtime/src/security/limitedRelease.test.js
npx vitest run src/features/world/domain/limitedBuildProfile.test.ts src/shared/api/supabase.publicKey.test.ts src/features/world/components/EcoLimitedShell.test.ts src/features/wildlands/multiplayer/api/colyseusPresence.limited.test.ts src/app/router/routes.limited.test.ts src/features/auth/components/AuthModal.test.ts
npm run typecheck
```

## Artefactos congelados

Después del commit, se regeneran ambos clientes, fuente realtime y bundle con `prepare-limited-review.mjs`. Configuración pública ficticia segura: publishable SCRIPTED y destinos `.invalid`; artefactos no activables. Los resultados anteriores con claves privadas son exclusivamente evidencia negativa local, no artefactos entregables para uso.

`review-manifest.json` identifica el SHA completo congelado y checksums. El bundle adicional `lr1-delta.bundle` exige exactamente el candidato como prerequisito; permite revisar sólo este delta. El manifest externo de L-R1 vincula candidato, SHA nuevo, evidencia antes/después, hashes de artefactos y custodia original. El SHA no se acredita mediante un literal visible del JS del cliente: se acredita con manifests, fuente, bundle y hashes, como aclaró la revisión.

No se cambiaron autenticación, admisión, expiración, core, reservas, balance, recompensas, permisos, SQL ni workflows. No se editaron otros worktrees ni su configuración. No hubo credenciales reales, consultas hosted, push, merge, despliegue o servicios del juego iniciados. Los procesos propios de build/checks terminaron; no se detuvieron procesos ajenos. La activación y las fronteras previamente aprobadas siguen fuera de este delta.

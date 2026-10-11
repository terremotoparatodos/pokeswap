# ECO limited + L-R1 — cierre técnico de integración

**Candidato:** `9f09c646e175cc1933c3c146ef127667d00d76b2`, de la rama de trabajo `codex/eco-lr1-public-credentials`, que se conserva. Contiene la implementación `codex/eco-limited-implementation` (`eaa967f..dfc81b4`) y la corrección L-R1 (`9f09c64`).

**Rama de entrega:** `feat/eco-limited-0.3`. Contiene el candidato y este commit documental; no cambia producto.

**Destino:** `integration/world-skills-0.3` (último remoto `da3c782`).

## 1. Qué aprueba este cierre (y qué no)

- **Revisión técnica independiente de `dfc81b4`:** FINDINGS, con un único defecto, L-R1 (claves privadas reconocibles aceptadas como públicas). Las demás fronteras examinadas quedaron acreditadas: producción normal y opt-in, admisión, carreras, vencimiento, capacidades y cliente limitado.
- **Revisión independiente de `9f09c64`:** APPROVE acotado al cierre de L-R1. Se rechazan `sb_secret_…` y los JWT con `role: service_role` antes de generar el cliente (Vite), al arrancar realtime y antes de `createClient`. Las claves publicables y anon siguen aceptadas.
- **No hay aprobación humana del nuevo shell limitado (`EcoLimitedShell`) ni del perfil limited.** No se ejecutó un smoke humano sobre él. Los smokes humanos anteriores del sandbox (escena, espectadores, panel, ECO-COMBATANT-1 y 2) se hicieron con otros perfiles y **no se atribuyen a este perfil**.
- **No hay verificación hosted.** Auth y Edge fueron SCRIPTED en todas las pruebas. No se acreditan:
  - cuentas reales;
  - la puerta hosted;
  - RLS y permisos desplegados;
  - datos owned reales;
  - login y OAuth en el destino;
  - TLS y proxy;
  - la imagen o el runtime de hosting;
  - la capacidad operativa.
- **La guarda L-R1 tiene límites:** sólo detecta credenciales privadas reconocibles. No certifica que un contenido desconocido sea público y no sustituye a Auth.
- **Artefactos de revisión:** los ZIP y el tar son SCRIPTED, con destinos `.invalid`. No son un cliente operativo ni una release.

## 2. Activación: pendiente y fuera de esta entrega

Integrar no activa nada. Activar el perfil limited necesita trabajos y autorizaciones separados:

- **Configuración real del build limited:** URLs `wss:` y `https:` reales y una clave publicable real.
- **Configuración real del servidor:**
  - `WORLD_ECO_RELEASE=limited`, la lista de testers y la fecha de vencimiento;
  - `ALLOWED_ORIGINS`;
  - `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`;
  - `WORLD_AUTHORITY_URL` y `WORLD_AUTHORITY_SECRET`.

  Todo esto en el entorno de hosting, nunca en el cliente.
- **Hosting, TLS, despliegue de cliente y realtime, y la Edge `world-authority` actualizada.**
- **Verificación hosted** de Auth, puerta, RLS y lectura owned con cuentas reales.
- **Smoke humano** del shell limitado.
- **El launcher local y la conexión real del principal** siguen siendo trabajos independientes.

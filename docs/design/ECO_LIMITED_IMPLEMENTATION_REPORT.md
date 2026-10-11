# ECO limited — implementación local

Base exacta: `da3c782c80275889d997cdffbced4f7526d97c96`.
Rama y copia nuevas: `codex/eco-limited-implementation`, `C:/Users/Rodri/.codex/worktrees/eco-limited-implementation/pokeswap`.
Sólo T1–T4 y artefactos/checks locales de T5. Publicación y conexión real pendientes.

## Desglose previo (AGENTS §17)

- T1: configuración de build/runtime. Cliente y servidor tienen opt-in independiente; defaults productivos conservados. No autoridad persistente.
- T2: admisión después de Auth y antes de sala/actor/lecturas owned; origen propio, UUIDs del operador y ventana de servidor. Expiración cierra sockets y bloquea mensajes/joins, incluso carreras con Auth lento.
- T3: fachada sobre `createEdgePlayerData.readEcoCombatants`, sin otro lector; SKILLS unavailable, sin capacidades de settlement/ubicación/host ni retiro dev. Combate/reservas/core intactos.
- T4: shell propio, login existente, escena online retenida hasta admisión; sin gate community-0.1, rutas económicas o herramientas. Fallos no pasan a offline.
- T5: artefactos, manifests y pruebas locales. No launcher, hosting, deploy o workflows públicos.

Entradas: Vite/config, bootstrap realtime, `PresenceRoom.onAuth/onJoin/onMessage`, adaptadores `worldDependencies`, `App.vue` y transporte del cliente. Lecturas: identidad Supabase, owned por autoridad existente; tests usan dobles SCRIPTED. Escrituras nuevas: ninguna persistente. Side effects: sockets/encuentros/reservas efímeros y timers cancelables.

Invariantes: INV-ID-1, INV-OWN-1/2/3, servidor como autoridad económica, contratos ECO y privacidad existentes. Fallos: configuración inválida aborta, auth/lista/ventana niegan acceso, lector fallido no usa synthetic. Unknowns hosted se mantienen como OPEN QUESTION y bloquean activación, no implementación local.

Plan de comprobación: regresiones productivas conservadas; pruebas nuevas de configuración/admisión/expiración/capacidades y exclusión UI; builds producción normal y limited; pruebas de transporte en loopback explícitamente SCRIPTED. No acreditar Auth/Edge hosted.

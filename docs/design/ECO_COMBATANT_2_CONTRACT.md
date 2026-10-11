# ECO-COMBATANT-2 — contrato experimental

Base: `81aa16d16035489d53bf906b3718c1edce8e4a6b`. M-1 temporal autorizado el 2026-10-11.

- Identidad: UUID verificado en el join existente; el payload nunca identifica al dueño.
- Modo explícito `synthetic` o `owned` dentro de ECO, apagado/excluido en producción. Owned rechaza benchmarks y nunca cae al fixture.
- Lectura servidor estrecha de slots/progresión con gate WORLD existente. Selección e inicio releen dueño/lock, sin cache positivo ni locks de mercado. Última lectura es una comprobación puntual; no promete atomicidad con ventas.
- Especie/XP/movimientos del slot y del dueño actual; M-1 deriva los campos inexistentes, identificados como proyección en UI. Movimientos desconocidos, ilegales, sin set o no soportados rechazan todo el ejemplar, sin completar/sustituir sets.
- Selección confirmada por servidor, independiente por jugador y conservada en memoria. Reserva activa/gracia impide cambiar; después de lecturas se revalidan sesión, elección y condiciones de engage antes de reservar.
- Snapshot independiente por batalla. Sin persistencia de atributos, desgaste, resultados, curación, captura o recompensas. Core, tiempos, encuentros y privacidad de espectadores conservados.
- Tests y e2e usan adaptadores locales rotulados como pruebas, sin acreditar datos hosted. Ningún deploy, SQL, tabla, dependencia o cambio económico forma parte del incremento.

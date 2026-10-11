# ECO-COMBATANT-2 — cierre humano

**Candidato aprobado:** `45b8c1129f44407567b0dfa696a7327b2d8e758b`, de la rama de trabajo `codex/eco-combatant-2`, que se conserva.

**Rama de entrega:** `feat/eco-combatant-2-0.3`. Contiene el candidato y este commit documental encima; no cambia producto.

**Destino:** `integration/world-skills-0.3` (último remoto `81aa16d`).

**Alcance:** experimento ECO de desarrollo. Está apagado por defecto, y la configuración del servidor rechaza ECO y el modo owned en producción. Este cierre no despliega cliente, realtime ni Edge, y no activa nada.

## 1. Aprobaciones registradas

- **Revisión independiente:** «APPROVE técnico acotado», limitada al delta `81aa16d..45b8c11` y al contrato temporal (M-1). La revisión aclara que no autoriza integración, activación hosted ni deploy.
- **Smoke humano sobre el candidato congelado, el 2026-10-11:** el usuario respondió **«Todo perfecto.»**
  - Se registra como confirmación global del recorrido propuesto.
  - No se atribuyen al usuario casos individuales ni mediciones.

  Los cinco tramos del recorrido quedan incluidos en esa confirmación global, sin detalle por caso:
  - selector propio y etiqueta M-1;
  - Pikachu y Oddish elegidos y usados;
  - escena y privacidad vistas por el espectador;
  - movimiento y chat durante el combate;
  - huir o terminar, y reiniciar con Rattata.

## 2. Datos SCRIPTED: lo que no se acredita

- **Smoke y e2e usaron datos simulados SCRIPTED:** la identidad, los slots, la XP y los movimientos venían de adaptadores de prueba, en un sandbox aislado con loopback, sin Supabase real ni Cloud.
- **Componentes reales:** el SDK, la sala, el handler Edge, el catálogo y el core.
- **No se acredita el funcionamiento hosted.** Quedaron sin verificar:
  - Supabase Auth y las cuentas reales;
  - las filas y la propiedad reales;
  - las RLS;
  - las columnas o la configuración desplegadas;
  - el servicio Edge `world-authority` desplegado.
- **Edge:** el `deno check` de la revisión acredita los tipos y el cableado, no un request hosted.
- **La conexión con cuentas reales** es una tarea posterior, con autorización separada.

## 3. Pendientes conocidos

- **Atributos derivados:** los atributos M-1 son derivados temporales (IVs, naturaleza, habilidad, género; EV=0; condición nueva) y no se persisten.
- **Condición y resultados:** no se persisten.
- **Ventas:** no hay atomicidad con ventas posteriores a la lectura puntual. Una venta posterior no altera el snapshot del combate.
- **Identidad de slot:** se mantiene la identidad legacy de un slot por especie.
- **Lo que no incluye:** captura, recompensas, XP, habilidades nuevas del core, multi-host.
- **Textos M-1:** son extensos y quedan sujetos a pulido visual.
- **Pendientes ECO anteriores, que siguen igual:**
  - elecciones sintéticas sólo en memoria;
  - móvil;
  - sprites altos;
  - desfases en el borde del rango.
- **Vulnerabilidades heredadas de los lockfiles:** sin cambios en este incremento.

**Evidencia, fuera del repositorio:**
- la revisión (`ECO-COMBATANT-2-REVIEW-45b8c11.md` y `ECO-COMBATANT-2-evidencia`);
- el smoke (`2026-10-11/eco-combatant-2-smoke-45b8c11/SMOKE-HUMANO.md` y `human-confirmation.json`).

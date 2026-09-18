# Demo de sábado, Construcción y Crafting — notas de producto

> Fecha: 2026-09-18.
> Contexto: conversación posterior al cierre del `PRE-R32 HUMAN PROFESSION GATE`, F-2 y el diseño F-1.  Este documento registra dirección de producto; no autoriza implementación por sí solo.

**Estado de integración al escribirlo:** `integration/r31` @ `9d7bd943f9b32897464bd97bbb263124bcc721af`.

## Cómo leer estas notas

- `APPROVED`: dirección de producto ya aceptada.
- `PROPOSAL`: recomendación para decidir antes de implementarla.
- `OPEN`: no debe rellenarse con una suposición.

---

## 1. Demo de sábado

### APPROVED · objetivo y corte de alcance

El objetivo es una **demo controlada**, no una versión productiva. La demo no habilita autoridad de servidor, persistencia, economía final ni R32.

Alcance objetivo, condicionado a que cada parte llegue verde y se pruebe manualmente:

1. WildLands R30 con F-2 de tap/picking de props altos.
2. Profesiones R31 consolidadas.
3. Dungeon/PvE clean-slate como prototipo de showcase dev.
4. F-1 (`PlacedObjects`) si la candidata queda auditada y validada a tiempo.
5. Horno local si F-1 está listo; no debe retrasar ni desestabilizar la demo.

### Fuera de alcance de la demo

- Construcción completa: placement de jugador, ownership, permisos, casas, tiendas, Centro Pokémon, mantenimiento o persistencia.
- Party activo, autoridad, Supabase, realtime de profesiones, R32-0.
- Balance económico, combustibles, durabilidad definitiva o tablas de loot.
- Nuevas profesiones funcionales.

### OPEN · superficie de la demo

Las profesiones y Dungeon son hoy herramientas/rutas dev-only. Antes de una demo hospedada hay que decidir una superficie demo explícita y aislada. Una demo local guiada sigue siendo el camino de menor riesgo.

---

## 2. Construcción y Tala

### APPROVED · mostrar aspiración de Construcción

La pantalla futura de profesiones/skills debe mostrar iconos o previews de resultados construibles para incentivar la progresión material: casas, Centro Pokémon, tiendas, estaciones y otras estructuras futuras.

Tala puede mostrar con claridad que sus recursos alimentan esos resultados futuros: madera → materiales → estructuras. Esto da una razón visible para recolectar, aun antes de que exista placement persistente.

### OPEN · relación exacta entre Tala y Construcción

Sigue vigente la decisión A-9 de `PRE_R32_DESIGN_DECISIONS.md`: **Tala es gathering y Construcción es una profesión independiente**.

La idea de mostrar previews de Construcción dentro de la UI de Tala **no cambia por sí sola** esa separación. Falta decidir explícitamente si el usuario quiere:

1. conservar Construcción como profesión separada y mostrar en Tala sólo sus vínculos/materiales/desbloqueos; o
2. hacer que Construcción sea una sub-rama/progresión dentro de Tala.

No implementar ni mover XP, recetas o milestones hasta resolverlo. La recomendación actual es la opción 1: mantiene claro el loop `Tala → materiales` frente a `Construcción → estructuras` y evita que una skill gathering absorba placement, planos y uso de edificios.

---

## 3. Pesca: qué reemplaza a los peces

### APPROVED

Se mantiene A-4:

```text
cast → espera → encuentro Pokémon → forcejeo → recompensa de objetos
```

No se obtienen "pescados" genéricos ni se captura al Pokémon del encuentro. Magikarp, Slowpoke y Shellder son guiños visuales del forcejeo; no son Pokémon obtenidos.

### OPEN · tablas de recompensa y recetas heredadas

Hace falta definir qué familias de objetos reemplazan a `fish` y `quality_fish`, incluido el futuro de recetas como `fish_oil`.

Una tabla futura podría incluir recursos acuáticos, materiales orgánicos, objetos perdidos/tesoro, componentes de Alquimia o materiales de crafting. Esto es una dirección, no una loot table ni balance.

La profundidad, bioma, herramienta, worker, nivel y afinidad podrán modificar los encuentros y recompensas después. No fijar porcentajes ni valores todavía.

---

## 4. Poké Balls

### PROPOSAL · Banco de trabajo / crafting horizontal

Las Poké Balls no encajan naturalmente en Alquimia ni en Construcción/placement:

- **Alquimia** debe conservar su identidad de consumibles, ingredientes y procesamiento.
- **Construcción** debe producir/colocar estructuras y planos, no absorber todos los items fabricados.
- Una Poké Ball es un objeto portátil manufacturado.

La recomendación es tratarlas como **crafting de Banco de trabajo**, un canal horizontal de fabricación de items portátiles. No requiere crear una sexta profesión ahora.

El desbloqueo futuro puede depender de planos/recetas, materiales procesados, herramientas y progresión relevante; por ejemplo Minería, Tala/Forage y Técnica, sin decidir todavía fórmulas ni niveles.

### OPEN

- materiales y cadena real de Poké Balls;
- si se necesita una skill de Crafting propia o sólo recetas de Banco de trabajo;
- cómo se obtienen planos;
- relación con captura, combate y Dungeon/PvE;
- autoridad, inventario, precios y balance.

No implementar Poké Balls ni sus recetas dentro de Horno/F-1.

---

## 5. Orden de trabajo propuesto

1. F-1: datos físicos de mundo y migración de la Mesa de Alquimia, en una rama candidata y con pruebas.
2. Si F-1 pasa su gate: arte/UI aislado de Horno, Fogata y Banco de trabajo a cargo de la estación secundaria.
3. Horno local funcional, limitado a `mineral → estación → lingote`, sin persistencia ni balance final.
4. Definir superficie de demo local u hospedada y congelar alcance.
5. Construcción/placement sólo después de evaluar el prototipo de Horno y de diseñar R32-0.

## 6. Coordinación entre estaciones

- **Estación principal:** F-1, motor, interacción, integración, autoridad futura, persistencia y CI.
- **Estación secundaria:** vuelve después del contrato F-1 implementado o estabilizado; puede trabajar arte/UI de estaciones, QA visual, mobile o un playground aislado.
- **GitHub:** única frontera entre PCs. Toda tarea secundaria debe salir de un hash contractual, con archivos permitidos/prohibidos y sin merge.


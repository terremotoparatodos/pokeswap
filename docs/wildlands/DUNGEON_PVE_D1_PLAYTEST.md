# D1 — Dungeon / Realtime PvE, listo para playtest

> Rama: `feat/d1-dungeon-pve-visual-playtest`. Base: `feat/d0-dungeon-pve-prototype @ aee3eb2c`.
> Ruta: **`/dev/dungeon`** → pestaña **`▶ PLAY DUNGEON`** (es la que abre por defecto).
> Diseño base: [`DUNGEON_PVE_PROTOTYPE.md`](DUNGEON_PVE_PROTOTYPE.md) · datos: [`BATTLE_DATA_GAP_REPORT.md`](BATTLE_DATA_GAP_REPORT.md).
> Sin servidor, sin Supabase, sin networking, sin persistencia. Todo local y dev-only.
> Este documento separa **APPROVED** (lo que decidiste), **PLAYTEST PARAMETERS** (números para poder jugar, no balance) y **OPEN** (lo que falta).

---

# APPROVED

## La Dungeon es un fenómeno temporal del overworld

`DungeonDefinition` es qué dungeon es — categoría, temática, tier, biomas, regla de pool, pisos, loot, modifiers — y `DungeonSpawn` es una aparición concreta, con posición, `startedAt`, `closesAt` y estado. La identidad es estable mientras la entrada existe: *Caverna Ígnea, TYPE FIRE, Tier B, 16 pisos* no se convierte en otra cosa a mitad de su vida. Lo que sí cambia en cada expedición es el interior: seed nuevo, layout nuevo, encuentros y cofres distintos, siempre dentro de las reglas de esa definición.

**El reloj es del spawn, no de la expedición.** Si entrás con 47 minutos, tenés 47 minutos. Al llegar a `00:00`: la entrada deja de aceptar gente, todas las expediciones terminan, los jugadores son extraídos automáticamente conservando **todo** el Expedition Loot y **todas** las capturas, las Floor Keys se pierden, un combate sin terminar no paga nada y **un Alpha vivo no entrega recompensa**. No cuenta como wipe. Avisos a 30, 10, 5 y 1 minutos.

## Tres categorías, una sola máquina

El generador no conoce especies: recibe una **regla de pool**.

| Categoría | Ejemplo incluido | Regla |
|---|---|---|
| **TYPE** | `Caverna Ígnea` (Fire, B, 16) y `Grieta Glacial` (Ice, C, 10) | La temática domina (>60 % del pool) pero **no** se fuerza al 100 %: entra fauna compatible de roca/tierra, que vive en cualquier cueva |
| **GENERATION** | `Simas de Sinnoh` (B, 14) | Especies originarias de la región, **con sus datos de combate Gen 6**: Clefairy sigue siendo Hada |
| **SPECIAL** | `Estratos Fósiles` (A, 20) | Por tag. Están declarados `fossil`, `starter`, `baby`, `pseudoLegendary`, `eevee` y `nocturnal`; agregar otro es una línea |

## El piso se siente cueva

Salas talladas con esquinas redondeadas, corredores anchos y angostos, roca alrededor, un cuerpo de agua con su puente, desniveles, escombros y una escalera visible. Encima, la capa de bioma pinta la misma cueva como nieve, bosque, agua, volcánico, ruinas o cristales. Es determinista desde el seed y la mayor parte del mapa sigue siendo roca: es una cueva, no una arena.

## Encuentros visibles, sin aggro

Los Pokémon están dibujados en el piso. Pasar cerca no hace nada: **no hay batallas aleatorias y no hay aggro**. El jugador decide evitarlos, pelearlos por la llave, pelearlos por drops, capturarlos, o pelearlos porque uno cerró un corredor. Los Pokémon ocupan su tile, así que algunos custodian un paso — pero no todos los encuentros son obligatorios.

## Sin sustain gratis

Dentro no hay Centro Pokémon, ni curación gratuita, ni fuentes, ni plantas, ni recuperación entre pisos. Se entra preparado y se administra HP, PP, Pociones, Revivir, Éter y party. Los cofres existen y son ocasionales, y **no** están diseñados para regalar consumibles constantemente.

## Boss garantizado, antecámara y sala propia

El último piso **siempre** tiene el Alpha; no hay RNG sobre su existencia. Antes de empezar hay una antecámara que muestra party, HP, debilitados, Pociones, Revivir, Éter, Poké Balls, tiempo restante y jugadores listos, con un botón `ENTRAR`. **No cura ni restaura nada**: es información y una decisión. La Boss Room es su propio estado, no un piso normal con un bicho grande en el medio.

## Ruleset

`PokeSwap Battle Ruleset v1 = Pokémon Omega Ruby / Alpha Sapphire — Generation VI`. Los fixtures ya son coherentes: Clefairy es Hada, Magnemite Eléctrico/Acero, Azumarill Agua/Hada, y la tabla de tipos es la Gen 6. Megaevoluciones y Primals quedan OPEN y **no** se habilitan.

## Combate

Singles, 1 contra 1, sin pantalla aparte: los dos Pokémon están de pie en el mismo escenario. Cuatro movimientos, Action Bar por combatiente, y se puede cambiar el movimiento preparado mientras carga. **Auto-repeat**: si no elegís nada se repite el último; si nunca elegiste, se usa el primero disponible. Los spread de ORAS (Terremoto, Surf) son **objetivo único en v1**: sin fuego amigo y sin targeting múltiple. Los ataques del jugador apuntan solos al rival, y los movimientos sobre uno mismo, a uno mismo.

**La mochila no pausa.** No ralentiza, no congela la IA ni las barras. Está garantizado por construcción: `tick(battle, dt)` no recibe ningún flag de pausa y la mochila es UI de la que el motor no se entera. Usar Poción, Revivir, Éter o Poké Ball consume una ventana de acción; cambiar de Pokémon también.

El que entra conserva HP, PP y el estado principal, pierde los buffs/debuffs temporales y arranca la barra de cero.

## Co-op

Hasta 4 jugadores, simulados localmente. **Los combates normales son personales**: el Pokémon que uno engancha queda ocupado para los demás, que siguen explorando y peleando lo suyo. Solo el Alpha es contenido cooperativo. La **Floor Key pertenece a la expedición**: si la consigue cualquiera, el grupo abre la salida. Cambiar de piso pide un **ready check** y nadie es teletransportado. La **retirada es individual**: uno se va con su botín y los demás siguen. Un jugador con sus seis debilitados queda fuera de combate pero **no** termina la expedición, y puede ser revivido mientras el resto siga adentro. El wipe global es cuando **todos los que quedan adentro** se quedaron sin Pokémon utilizables.

En el Alpha: 1 jugador → 2 Pokémon activos; 2, 3 o 4 jugadores → 1 cada uno; máximo 4 aliados. Cada uno pelea en singles contra el mismo Alpha.

---

# PLAYTEST PARAMETERS

**Nada de esto es balance.** Son los números que hacían falta para poder jugar, y todos viven en un objeto de configuración.

## Ritmo del combate

```
cooldown = clamp(2.6 · √(60 / velocidadEfectiva), 1.4 s, 4.0 s)
```

Determinista, sin azar por ataque. Medido con los fixtures actuales:

| | Velocidad efectiva | Cooldown |
|---|---|---|
| **Lento** (Geodude Nv. 25) | 22 | **4.00 s** (tope) |
| **Promedio** (Machamp Nv. 30) | 47 | **2.94 s** |
| **Promedio-rápido** (Charizard Nv. 30) | 76 | **2.31 s** |
| **Rápido** (Jolteon Nv. 30) | 92 | **2.10 s** |

Un Pokémon promedio actúa cada 2–3 segundos, como pediste, y la diferencia rápido/lento es de ~1.9×, perceptible sin que el rápido actúe el doble de veces.

Multiplicadores sobre el **próximo** cooldown: prioridad **×0.5**, recarga **×2**, Protección **×2**, parálisis **×2** (permanente mientras dure).

## Estados

| Estado | Efecto v1 |
|---|---|
| Veneno | Daño residual de 1/16 del máximo **cada 3 s de reloj propio** — nunca atado a la velocidad |
| Quemadura | Ataque ×0.5 |
| Congelación | Ataque Especial ×0.5 — **adaptación nuestra**, no el congelado tradicional |
| Parálisis | Cooldown ×2 |
| Sueño | Consume ventanas de acción durante 6 s |
| Confusión | 8 s, 33 % de golpearse (40 de potencia tipeless). **No ocupa el slot principal**: convive con quemadura o veneno |

Un solo estado principal a la vez: uno nuevo se rechaza, no se apila.

## Protección, buffs y debuffs

Protección da escudo para las **2 próximas acciones ofensivas recibidas** (no por impacto individual de un multihit) y duplica el cooldown siguiente del usuario. Visible en pantalla: un anillo por carga y un contador `◈2`.

Los stages internos siguen existiendo, pero el multiplicador está **acotado a ×2 / ×0.5**. Dos stages llegan al tope.

## Alpha

HP ×2.5 (×0.9…×1.2 según tier), daño ×1.35, defensas ×1.15, **velocidad ×1.05**, resistencia a estados 50 %, tamaño visual ×2, fases a 66 % y 33 % de HP. Poder efectivo ≈ **4.08×**. Co-op: HP +55 % por jugador extra, daño del boss **solo +12 %**.

## Boss Skills

Diez, propias de WildLands, que ningún Pokémon del jugador puede aprender. Todo lo que hace daño se **anuncia** antes.

| # | Nombre | Forma | Aviso | Daño | Efecto |
|---|---|---|---|---|---|
| 1 | Onda Alfa | todos | 1.6 s | ×0.8 | — |
| 2 | Sacudida Total | todos | 2.2 s | ×1.1 | — |
| 3 | Rugido Desmoralizante | todos | 1.2 s | — | Ataque −1 |
| 4 | Pulso Vacío | todos | 1.8 s | ×0.7 | Confusión 35 % |
| 5 | Aplastar | uno | 1.4 s | ×1.8 | — |
| 6 | Terremoto Alfa | todos | 2.6 s | ×1.4 | El más lento y el más duro |
| 7 | Zona de Peligro | marcado | 2.8 s | ×1.6 | Marca a un aliado |
| 8 | Impactos Dispersos | mitad | 1.6 s | ×0.6 | Castiga a los grupos |
| 9 | Campo Denso | todos | 1.4 s | — | Cooldown aliado ×1.5 por 8 s |
| 10 | Furia Alfa | sí mismo | 2 s | — | Fase: +25 % de daño |

Por tier: D → 1, C → 1–2, B → 2, A → 2–3, S → 3–4. `Furia Alfa` se reserva para los kits de 3 o más, porque un cambio de fase solo se lee como tal si queda pelea por delante.

**El telegraph deja decidir, no esquivar**: no hay movimiento libre, así que la ventana existe para usar Protección, cambiar, curar o asumir el golpe.

## Resto

Llave: 0.35 base, +0.20 por derrota sin llave, garantizada a la cuarta. Captura: la fórmula de D0, sin tocar — la Ball básica ronda el 3 % con el rival sano, que es la sensación buscada. Duración por defecto de un spawn: 180 minutos. Reserva de encuentro: 8 s. Inventario: 20 espacios. Lucky Pokémon: aparición ~10–16 % por piso según la definición, y un buff de 2 minutos que **no** está conectado a la economía.

---

# Cómo jugarlo

1. `npm run dev` y abrir **`/dev/dungeon`**.
2. La pestaña **`▶ PLAY DUNGEON`** abre por defecto.
3. Elegir dungeon (las cuatro de ejemplo), minutos y jugadores simulados. **Entrar**.
4. Moverse con el d-pad. Los Pokémon y los cofres son visibles; al quedar al lado aparece el botón para pelearlos o abrirlos.
5. Con llave, parado en la escalera, bajar. En el piso final la escalera ofrece la **Antecámara**, y de ahí `ENTRAR` al Alpha.
6. Retirarse cuando quieras: el botín se asegura. Si cae todo el equipo, es wipe.

**Controles DEV**, al final de la pantalla para no estorbar: acelerar el reloj de la Dungeon hasta ×600 (para ver los avisos de 30/10/5/1 y la expiración sin esperar tres horas), forzar llave, saltar al último piso y forzar wipe. Los labs técnicos de D0 siguen en sus pestañas para depurar.

---

# OPEN

1. **Fuente y licencia del dataset ORAS**, pipeline de import, formas, Megas y Primals.
2. **Modelo real de `PokemonInstance`** (naturaleza, IV, EV, ability, OT) y su persistencia.
3. **Toda la economía**: precios, curación, valor de Revivir, drop rates, capture rate final, Centro Pokémon, cooldowns, mercado. Bloqueada hasta que juegues el loop.
4. **Fórmula del Lucky Pokémon** y cómo se conecta con obtención de recursos.
5. **Contrato multiplayer definitivo**: cómo se forma el grupo, qué pasa si alguien se desconecta a mitad del Alpha, y cómo se valida el timing realtime con latencia.
6. **Tienda NPC** como red de seguridad (peores herramientas, Ball básica, consumibles simples) y **crafting de Poké Balls**: registrados, no implementados.
7. **Cómo son las entradas físicas** en WildLands y qué se ve del tier desde afuera.
8. Si la duración de 3 h y la cadencia de aparición son las correctas.
9. Si el switch debe costar una ventana entera o menos.
10. Las UI alternativas de combate: hay **una** implementación principal jugable; si al jugarla algo no cierra, ahí conviene explorar variantes.

---

# Riesgos y hallazgos

1. **El telegraph contra una barra de 2–3 s es apretado.** Un aviso de 1.2 s (Rugido) llega cuando tu barra puede estar a mitad: reaccionar con Protección a veces es imposible, no difícil. Es lo primero que hay que sentir y probablemente lo primero a ajustar.
2. **Dos Pokémon activos en 375 px funcionan, pero el pulgar tiene ocho botones.** Entra sin scroll horizontal y los targets son de 44 px, aunque es la parte más cargada de la pantalla.
3. **El Alpha con cuatro aliados todavía no se probó con gente.** El lab lo permite; la legibilidad real de cuatro barras más telegraph está sin validar.
4. **Sin sustain, un piso malo puede terminar la run muy temprano.** Es el diseño, pero la curva de desgaste está sin medir: puede que 16 pisos sean muchos con seis Pokémon y cuatro Pociones.
5. **La expiración a mitad del Alpha es anticlimática por definición**: se pierde el premio de una pelea larga. Es lo aprobado, pero conviene ver cuánto duele.
6. **La captura sigue siendo el gancho y el riesgo.** Capturar en el piso 15 y wipear en el 16 puede ser memorable o hacer que alguien no vuelva a entrar.
7. **Ningún encuentro respawnea todavía.** Un piso limpiado se queda limpio; para la llave garantizada hay encuentros de sobra, pero conviene decidirlo.

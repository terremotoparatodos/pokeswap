# Correcciones técnicas del ecosistema Pokémon — F1–F8

Fecha: 6 de octubre de 2026. Estado: implementación local para revisión independiente; sin aprobación de integración ni de balance.

## Alcance y referencias

- Base exacta: `fa14ab2cb99c6d80725a57ea7a109607a03c8ef2`, referencia existente `origin/world/eco-capacity-1-0.3`. La rama candidata no existe como rama local; no se creó ni se movió esa referencia.
- Rama nueva: `fix/eco-audit-f1-f8-0.3`.
- Worktree nuevo: `C:\Users\Rodri\Proyectos\pokeswap-eco-audit-fixes`.
- Último commit de código verificado: `5b57131`. Este documento se agrega en un commit posterior.
- Se siguieron `AGENTS.md`, los invariantes y la auditoría independiente previa. Antes de modificar se presentó el plan, incluyendo fuente/cobertura de F4, el gate offline de F6 y el contrato de F8. El usuario aprobó explícitamente mantener delay cero con avance estricto del reloj y un máximo de un intento por nido por instante.

FACT: los cambios de producto están únicamente en el worktree nuevo. Las ramas y worktrees anteriores no se modificaron desde esta tarea. No se publicó la rama, ni se ejecutaron merge, deploy, SQL hosted, cambios de flags o gestión de procesos/entornos activos. No se hizo limpieza. El único archivo cambiado bajo `services/realtime` es el bundle aislado generado del ecosistema. Cloud/H2, rooms, navegación, trabajo y gameplay quedan fuera del diff.

## Findings y correcciones para revisar

Las prioridades originales se mantienen: P2 exige corrección/gate antes de integrar; P3 corresponde a robustez de extremos. No son incidentes de producción de esta cadena, que sigue inactiva.

| Finding | Prioridad | Implementación y evidencia |
| --- | --- | --- |
| F1 — shares inválidos | P2 | Selección y distribución comparten validación: tiers conocidos, valores finitos no negativos, suma finita y 100 con la tolerancia original de 1e-9. Un total inválido devuelve `invalid-distribution` al seleccionar y `null` al consultar distribución. No se normaliza. Pruebas de sumas 50, 200 y overflow; conservación de tiers vacíos explícitos. |
| F2 — retroceso temporal | P2 | Todo retiro de un vivo avanza `lastTickAt`, ahora documentado como último tiempo de mutación aceptada. Ticks y retiros posteriores rechazan tiempos anteriores. IDs duplicados/desconocidos siguen como `not-alive`, con el mismo estado y sin RNG, incluso con tiempo finito viejo. |
| F3 — namespace al retirar | P2 | El retiro compara estado y configuración antes de buscar el ID o consumir RNG; devuelve `namespace-mismatch`. |
| F4 — exclusión opcional | P2 | Clasificación explícita y fijada para las 493 especies existentes. La política consulta esa clasificación independientemente de las listas del catálogo. Listas obligatorias ausentes, parciales, falsas o duplicadas invalidan el catálogo. Una especie sin cobertura queda excluida como `unclassified`. |
| F5 — historia en CI superficial | P2 | CI obtiene el SHA histórico exacto antes de las pruebas. Se conserva el `git show` real y su comparación de estados/eventos/RNG, sin fixture sintético ni skip. Prueba de preparación superficial y ejecución adicional en un checkout depth-one real. |
| F6 — admisión compuesta | P2 | `createValidatedPopulation` valida clasificación/catálogo, configuración, propuestas espaciales, correspondencia de nidos/casillas y layout actual recibido de la autoridad. No devuelve estado parcial. `proposedAreaConfig` deja de descartar issues espaciales. El comando offline compara además todos los bytes del snapshot con la geometría autoritativa actual. CI ejecuta el gate, clasificación y drift del bundle. No hay consumer de gameplay. |
| F7 — overflow de pesos | P3 | Suma no finita de pesos finitos positivos se rechaza antes del sorteo; la distribución descriptiva tampoco publica números engañosos. Validador agrega `invalid-weight-total`. No se modifican pesos ni se aplican escalados que cambien su reparto. |
| F8 — delay cero | P3 | Contrato aprobado: cero sigue válido; una oportunidad inmediata pendiente sólo puede ejecutarse después de avanzar el reloj; un intento máximo por nido e instante. Campo opcional `spawnBlockedAt` conserva el límite entre llamadas y retiros. No se introduce 1 ms ni otro delay mínimo. También se protege el cero producido por el redondeo existente de delays fraccionarios. |

La API del bundle pasa de 1 a 2 por la nueva respuesta de namespace al retirar y el campo opcional de estado. Un futuro adaptador debe reconocer ese contrato. No se cambió ningún consumidor activo.

## F4: fuente verificable y cobertura

Fuente primaria de los flags: [PokéAPI, PokemonSpecies](https://pokeapi.co/docs/v2#pokemon-species), campos `is_legendary` e `is_mythical`. Es una autoridad comunitaria de datos; **no** un servicio oficial de The Pokémon Company. No se inventan flags por nombre, número, fuerza, valor de mercado o conocimiento del modelo.

[CSV upstream fijado](https://raw.githubusercontent.com/PokeAPI/pokeapi/bc92d3b6029ef1abe9e7ad424c400b338f3c11fe/data/v2/csv/pokemon_species.csv):

- Commit: `bc92d3b6029ef1abe9e7ad424c400b338f3c11fe`.
- SHA256: `e66e2eeb25fd3836b0ebab6bf87bbf01960aa3c0555e2bac495fa8393c5e0c45`.
- 1.025 especies en el archivo upstream; se retienen los bytes originales y licencia BSD-3-Clause para reproducibilidad offline.
- Snapshot runtime limitado a las 493 especies actuales, IDs y nombres idénticos a `core.json`, incluyendo flags explícitos de especies ordinarias.
- 26 legendarias y 9 míticas: exactamente los mismos IDs de las listas anteriores. Las otras categorías y los pools no cambian.
- Regeneración exige hash correcto, columnas/flags, unicidad, nombres y cobertura completa. `.gitattributes` preserva los bytes del CSV en Windows.
- La fuente veekun/Showdown del catálogo de batalla permanece intacta. Esta clasificación es un snapshot separado para los flags faltantes.
- Ampliar el catálogo requiere actualizar y revisar cobertura; una especie nueva no queda admitida por ausencia de clasificación.

Rutas principales: `scripts/ecosystem/event-classification.mjs`, `scripts/ecosystem/sources/`, `encounters/eventClassification.generated.json` y `eventClassification.ts`.

## F6: contrato y límite del gate

`createValidatedPopulation` es una entrada pura explícita para un futuro adaptador. Exige `currentLayouts` obtenido de la autoridad **independientemente** del snapshot, además de species lookup, catálogo, config, snapshot y propuestas. Copiar la versión del propio snapshot a ese campo no demuestra vigencia.

El comando `scripts/ecosystem/validate-inputs.ts` lee los módulos autoritativos de mapa sólo como herramienta de desarrollo y comprueba:

1. Snapshot completo idéntico al que genera el mundo actual.
2. Catálogo válido, clasificación obligatoria y pesos/shares válidos.
3. Config válida y propuestas sin issues.
4. Layout actual por área igual al snapshot.
5. Nidos de configuración coherentes con propuestas validadas y casillas candidatas.
6. Sólo crea un estado inicial dormante; no ticks, sockets, persistencia ni activación.

El motor de bajo nivel `createPopulation` conserva su contrato de entradas confiables. Llamarlo directamente **no sustituye** el gate compuesto. El adaptador futuro deberá exigir el gate y volver a comprobar vigencia cuando cambie layout/configuración. Este trabajo no instala ese adaptador.

La geometría estática sigue excluyendo casillas bloqueadas, inaccesibles, portales, recursos y posiciones posibles de trabajo según las propuestas existentes. El gate no elige la política de ocupación dinámica ni aprueba esos radios/números.

## F8: contrato aprobado, sin cambio de balance

- `delayMs=0` continúa siendo configuración válida para ambas políticas.
- Repetir el tick del mismo instante no vuelve a intentar ni consume RNG del spawn.
- Un retiro en ese instante, o en uno posterior al último intento, no habilita un respawn inmediato durante el mismo instante del retiro.
- Cualquier avance estrictamente positivo, incluso 0,001 ms en la prueba, habilita la próxima oportunidad. No hay mínimo artificial.
- Un intento no ejecuta un bucle de catch-up.
- No se altera el muestreo ni los defaults positivos existentes. Los trazados históricos con delay positivo conservan estados, timings y consumo de RNG exactamente.

Esto sólo decide la semántica de cero. No aprueba política por grupo/miembro, 75 s, jitter, retry, dormancia, stagger u otros valores provisionales.

## Pruebas rojas reproducibles sobre el candidato

Primer commit `154dea1`: **únicamente** agrega cuatro archivos de aceptación. Todos los módulos, datos y workflow de producto son los de fa14ab2. `git diff --name-only fa14ab2 154dea1` verifica esa condición.

| Batería contra producto fa14ab2 | Resultado esperado observado | Causa |
| --- | --- | --- |
| F1/F2/F3/F4/F7, 13 casos | 11 fallan, 2 controles pasan | Aceptación real de sumas/overflow, eventos, reloj y namespace inválidos. |
| F5/F6, 8 casos | 7 fallan, 1 control pasa | Historia realmente ausente tras preparación vieja; admisión de catálogo/layout/propuestas/casillas inválidos y descarte de issues. |
| F8, 5 casos | 5 fallan | El bundle real de fa14ab2 respawnea en el mismo instante. |

Son **23 fallos de aserción y 3 controles positivos**. Ninguna de estas reproducciones cuenta timeout, import inexistente o error de instalación como defecto de producto.

F6 usa un adaptador documentado sólo para reproducir la ausencia del gate en la base: prueba sus fronteras reales `createPopulation/proposedAreaConfig`; en la corrección llama al gate nuevo. No falla porque falte un export.

F8 permite `ECO_AUDIT_BASE=fa14ab2`: extrae mediante `git show` el bundle comprometido original y ejecuta el mismo contrato contra ese código, sin parchearlo. El modo normal prueba TypeScript corregido.

Reproducción en **otra copia aislada de revisión**, nunca en el checkout principal:

```powershell
# Esta revisión necesita Node 22 y los objetos fa14ab2 y 7739c4d.
git checkout 154dea1
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/vitest/vitest.mjs run src/features/ecosystem/encounters/auditAcceptance.test.ts src/features/ecosystem/population/auditAcceptance.test.ts src/features/ecosystem/map/readiness.test.ts src/features/ecosystem/population/shallowHistory.test.ts
# Esperado: 18 fallos pertinentes, 3 controles positivos.

git checkout 9556973
$env:ECO_AUDIT_BASE='fa14ab2'
node node_modules/vitest/vitest.mjs run src/features/ecosystem/population/zeroDelay.test.ts
# Esperado: 5 fallos por spawn en el mismo instante.
Remove-Item Env:ECO_AUDIT_BASE
git checkout fix/eco-audit-f1-f8-0.3
```

Los logs originales quedan en el paquete de evidencia exterior. Esta revisión no ejecutó esos cambios de checkout sobre ninguna rama/worktree anterior.

## Gates y resultados

Runtime usado: **Node v22.23.3**, distribución oficial portátil ya disponible en el workspace de la auditoría. No se modificó el Node instalado globalmente. Dependencias instaladas en el worktree nuevo desde lockfile, con scripts de instalación deshabilitados.

| Gate local | Resultado |
| --- | --- |
| Suite raíz completa, commit 14c54b7 | 226 archivos y **2.135 pruebas pasan**, sin skips. Incluye **200 pruebas del ecosistema**. |
| Typecheck | Pasa. |
| Lint | Pasa, 0 errores; 9 warnings preexistentes en AuthModal.vue, sin cambios en ese archivo. |
| Build producción | Pasa; salida en cache del worktree, sin vaciar directorios existentes. |
| Clasificación offline `--check` | Pasa, cobertura 493 y bytes/hash correctos. |
| Bundle `--check` y pruebas | Pasa; 13 pruebas de artefacto/paridad/contratos/drift. Dos generaciones idénticas; bare Node sin dependencias frontend. |
| Geometría `--check` | Pasa contra autoridad actual. |
| Nidos `--check` | Pasa; datos guardados permanecen idénticos. |
| Gate compuesto offline | Pasa; estado dormante, sin integración. |
| Compatibilidad histórica | Pasa; 3 configuraciones × 3 semillas × 400 pasos; diferencia diagnóstica permitida original, estados/tiempos/RNG iguales. |
| F5, último ajuste de fixture 5b57131 | Prueba dirigida pasa; elimina la suposición de que CI tenga el objeto fa14ab2. |
| Checkout superficial real de 5b57131 | Base histórica ausente antes del fetch; preparación CI exacta la recupera; 5 pruebas de compatibilidad/fixture pasan, sin skips. |
| Aislamiento y diff | Guard de importaciones pasa. `git diff --check` pasa. Datos, gameplay y Cloud/H2 fuera del diff. |

El log del checkout superficial incluye un `cat-file` fallido **esperado**, que demuestra la ausencia inicial del commit; no se usa como resultado de una prueba aceptada. El fetch posterior y las comparaciones reales pasan.

Comandos de los gates para revisar:

```powershell
node --version
npm test
npm run typecheck
npm run lint
npm run build -- --outDir ../node_modules/.cache/ecosystem-audit/build-review --emptyOutDir false
node scripts/ecosystem/event-classification.mjs --check
node scripts/integration/bundle-encounters.mjs --check
node scripts/ecosystem/map-geometry.mjs --check
node node_modules/vite-node/vite-node.mjs scripts/ecosystem/map-nests.ts -- --check
node node_modules/vite-node/vite-node.mjs scripts/ecosystem/validate-inputs.ts
git diff fa14ab2 --check
```

En checkout superficial, ejecutar antes de pruebas:
`git fetch --no-tags --depth=1 origin 7739c4d4c1dba59b8dca3b66f379dea18082d108`.

La suite completa se ejecutó antes del último ajuste exclusivamente al fixture F5; ese ajuste se verificó dirigido y en el checkout superficial real. No se repitieron gates ya verdes sin cambio de producto.

## Commits locales pequeños

1. `154dea1` — aceptación roja F1–F7, sin modificaciones de producto.
2. `3b9a6f5` — F1/F7, shares y totales de pesos.
3. `959cad0` — F2/F3, reloj común y namespace.
4. `6bf2fc0` — F4, fuente, cobertura y exclusión obligatoria.
5. `5adfba2` — F5, provisión exacta de historia en CI.
6. `0078ae9` — aceptación roja inicial del contrato F8 aprobado.
7. `ee8b677` — F6, gate compuesto y ejecución offline.
8. `9556973` — aceptación F8 de retiro en un instante posterior.
9. `a051b35` — F8, guard de instante sin delay mínimo.
10. `14c54b7` — bundle v2 regenerado y pruebas de contratos.
11. `5b57131` — fixture F5 compatible con su propio checkout superficial.
12. Commit documental posterior — este informe.

## Conservación, decisiones abiertas y límite de integración

FACT: el diff no cambia el catálogo de entradas, familias, pools, shares, pesos, tamaños de grupo, configuración provisional de respawn/idle, propuestas/posiciones, límites por área/zona, geometría autoritativa o resultados guardados de estudios. Las listas legendaria/mítica mantienen sus IDs y sólo adquieren procedencia verificable. No se implementan captura, drops, huevos, persistencia o conexión al mundo.

OPEN QUESTION: siguen pendientes rareza por grupo o individuo, balance de pools/pesos/grupos/topes, política y tiempos de respawn, ocupación estática/dinámica de trabajo/jugadores, reubicación de vivos, fairness entre zonas, restricciones centrales/tamaño de Golbat/Dunsparce, interacción/engage y autoridad de resultados persistentes. El contrato F8 aprobado no decide esas preguntas.

Los estudios previos conservan sus números medidos **bajo supuestos**. No se regeneró ni aprobó balance: los escenarios sintéticos de ECO-BALANCE-1 no equivalen a los diez nidos y capacidad conjunta del mapa. Un gate técnico verde no transforma sus cifras en tasas humanas observadas.

Alcance mínimo recomendado, **sin implementar ni autorizar integración**:

1. Revisión independiente de este diff y su evidencia roja/verde; verificación de fuente y contrato API v2.
2. Resolver las decisiones de producto que afecten el piloto, incluyendo unidad de rareza, ocupación, restricciones y respawn.
3. Adaptador único de población por área, con admisión compuesta obligatoria, layout vigente, epoch/namespace, reloj monotónico y RNG del servidor. Abierta y bosque comparten el área pradera.
4. Piloto local acotado de presencia/visualización, proyección pública y retiros autorizados, sin recompensas persistentes.
5. Verificar el flujo completo con varios observadores, geometría/ocupación, límites, relojes, duplicados y reinicios; evitar coexistencia con la autoridad previa.
6. Mantener infraestructura multi-host/Cloud-H2, captura y persistencia como tareas separadas con sus propias revisiones.

LIMITACIÓN: CI remoto, publicación, entornos activos y MMO multi-host no se ejecutaron ni certificaron. La fuente F4 es comunitaria y fija; nuevas especies/actualizaciones requieren revisión. La prueba superficial usa un origin local con objetos reales; el acceso futuro de GitHub al SHA fijado lo comprobará el workflow. Aprobar módulos aislados **no declara listo el MMO completo**.

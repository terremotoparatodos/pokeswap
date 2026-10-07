# Admisión del ecosistema: contrato R1/R2

Fecha: 6 de octubre de 2026. Corrección técnica local para revisión independiente.
Base: `b03c4373bbe71733197206624d78ae59ed924266`.
Rama nueva: `fix/eco-admission-r1-r2-0.3`.
Worktree: `C:\Users\Rodri\Proyectos\pokeswap-eco-r1-r2`.

Sólo R1 y R2 de la revisión independiente. F1–F5/F7/F8 conservan su código y su cierre técnico. No se cambia balance, geometría autoritativa o decisiones de producto; no se conecta gameplay.

## Frontera de confianza de R2, presentada antes de implementar

La referencia confiable es el **artefacto de geometría del build revisado**, vinculado al mundo autoritativo mediante los checks independientes ya existentes. No es otro parámetro suministrado por el caller.

Cadena de comprobación:

1. Los módulos autoritativos de navegación, recursos, posiciones de trabajo, áreas, portales y terreno generan el contenido mediante `scripts/ecosystem/map-geometry.mjs → buildSnapshot()`.
2. `map-geometry.mjs --check`, las pruebas de mapa y el comando offline `validate-inputs.ts` comparan el artefacto completo con ese contenido calculado desde los módulos autoritativos, independientemente del snapshot de entrada.
3. `geometryAdmission.ts` importa el texto de ese artefacto con `?raw`. Es un valor string del build, no la referencia mutable al objeto exportado por `nestData`. Lo transforma en un string canónico privado e inmutable.
4. Cada llamada a `createValidatedPopulation` compara **todos los campos y valores** de la geometría suministrada contra esa referencia, antes de derivar casillas o crear estado.
5. También se exige que `currentLayouts`, obtenido de la autoridad actual por el caller confiable, corresponda al alcance y a las versiones del contenido admitido.

El input del caller no puede elegir la referencia de comparación. No se calculan hashes sobre el snapshot para luego confiar en ellos, no hay marca TypeScript que autorice contenido y no se comparan dos objetos mutables del caller. Alterar el objeto compartido de JSON no altera el string empacado.

La comparación normaliza sólo el orden de las claves de objetos. Filas, ventanas, bits, entradas, protecciones, subzonas, arrays y metadatos deben conservar exactamente los valores del build. El orden de filas es significativo.

**Límite explícito:** se admite únicamente la geometría de este build verificado. Un mapa nuevo requiere generar/revisar su artefacto y pasar los checks independientes; cambiar una etiqueta no lo habilita. Este cambio no regenera geometría. El paquete revisado y esos checks son parte de la frontera confiable; un atacante que reemplaza el código y el artefacto instalados queda fuera del contrato de datos de esta API. Una validación ejecutada por un navegador controlado por un cliente no autoriza acciones persistentes.

No hay importación de servidor, Node, red, reloj o RNG en el runtime de admisión. Las importaciones de servidor permanecen únicamente en herramientas/pruebas offline, como antes. El futuro adaptador no está instalado; deberá usar código/artefacto confiables y obtener los layouts actuales de la autoridad.

## Correspondencia R1

El contrato actual no admite una configuración parcial frente al alcance completo del snapshot y las propuestas:

- Áreas del snapshot = áreas distintas de las propuestas = áreas de la configuración = claves de `currentLayouts`.
- El alcance de áreas debe ser no vacío. Omitir una sola área, admitir layouts externos o vaciar config/propuestas frente al snapshot completo se rechaza.
- Identidad de nido: par `(areaId, nestId)`. El conjunto de identidades de las propuestas debe coincidir exactamente con el configurado, sin duplicados. Se comprueban ambas direcciones.
- La lista de propuestas de entrada define los nidos esperados para ese alcance; la configuración no puede omitirlos ni agregar otros. La validación técnica de correspondencia no aprueba nuevos contenidos de producto de una propuesta diferente.
- Para cada nido se conservan los checks existentes de zona, hábitats, capacidad y group cap contra su propuesta.
- Sus casillas deben ser **exactamente** el conjunto completo derivado por la validación espacial: misma cardinalidad, mismos miembros y sin repeticiones. No se permiten subconjuntos, aunque parezcan suficientes. El orden de las casillas no participa en esta correspondencia.
- Cualquier fallo devuelve `ok:false` con issues y **sin propiedad state**. No se devuelve estado parcialmente admitido.

Los nuevos diagnósticos son `area-scope-mismatch`, `layout-scope-mismatch`, `nest-scope-mismatch` y `geometry-content-mismatch`; se conserva `nest-config-mismatch` para casillas/metadatos.

## Aceptación y evidencia roja

`bad8084` agrega exclusivamente `map/reviewAcceptance.test.ts` a b03c437. La ejecución original de esos seis casos usa exactamente el gate y el producto de la base: **cinco fallos por ok:true indebido y un control válido que pasa**. No hay módulos faltantes, fixtures de implementación alternativa ni timeouts contados como defecto.

Sondas convertidas:

1. `one-cave-tile`: primera casilla de cueva-techo-norte, manteniendo sus límites.
2. `one-tile`: primera casilla del primer nido de Pradera, manteniendo sus límites.
3. `missing-nest`: propuestas completas, un nido configurado omitido.
4. `empty-areas`: propuestas/snapshot completos, config y layouts vacíos.
5. `forged-geometry-current-layout`: máscara 000 en (-34,-86) de Pradera, originalmente blocked; etiquetas correctas obtenidas de la autoridad y casillas configuradas iguales a las derivadas del snapshot falsificado.

La quinta sonda verifica expresamente la igualdad de casillas contra la falsificación. R1 por sí solo la sigue admitiendo: la ejecución intermedia registra ese fallo. R2 exige el rechazo por `geometry-content-mismatch`, sin state.

Se agregaron regresiones de alcance inverso, scopes parciales/extra/vacíos, casillas repetidas, orden irrelevante de conjuntos, mutación de objeto compartido, contenido de bits/ventana/entrada/protecciones/subzonas/terrainGenerator y orden de claves de geometría. Son 22 casos en la batería nueva. Los cambios no modifican las sondas o el informe externo del reviewer.

Reproducción roja: en otra copia aislada con historia, checkout `bad8084`, instalación desde el lockfile con Node 22 y:

```powershell
node node_modules/vitest/vitest.mjs run src/features/ecosystem/map/reviewAcceptance.test.ts --reporter verbose
# Esperado: 5 fallos de aserción / 1 control positivo.
```

## Verificación del HEAD final

Los resultados finales y logs se entregan **fuera del repo**, en un informe de correcciones R1/R2 y su paquete de evidencia. Este documento se compromete antes de ejecutar esos gates para que todas las ejecuciones finales correspondan al mismo HEAD final, incluyendo esta documentación.

Comandos finales, con Node 22 en PATH sólo para los procesos de prueba:

```powershell
node --version
npm test
npm run typecheck
npm run lint
npm run build -- --outDir ../node_modules/.cache/eco-r1-r2/build-head --emptyOutDir false
node scripts/ecosystem/event-classification.mjs --check
node scripts/integration/bundle-encounters.mjs --check
node scripts/ecosystem/map-geometry.mjs --check
node node_modules/vite-node/vite-node.mjs scripts/ecosystem/map-nests.ts -- --check
node node_modules/vite-node/vite-node.mjs scripts/ecosystem/validate-inputs.ts
git diff b03c437 HEAD --check
```

Los gates históricos se conservan y se ejecutan como parte de la suite; no se reabren sus decisiones/correcciones. En un checkout superficial CI sigue obteniendo la base histórica exacta mediante el fetch ya comprometido. No hay cambios a CI.

El bundle del motor no contiene el gate de mapa; sus fuentes/export/API v2 permanecen intactos. `--check` debe probar que sus bytes siguen vigentes; no corresponde regenerarlo por estos cambios.

## Conservación y límite de revisión

El diff esperado se limita a `readiness.ts`, `geometryAdmission.ts`, el archivo nuevo de aceptación y este contrato. Catálogo, configuración de balance, límites, propuestas vigentes, geometría autoritativa, snapshot generado, estudios, preview, motor, clasificación, bundle y offline checker no se modifican.

No se publica la rama, integra gameplay, implementa persistencia/captura/rewards, ni opera Cloud/H2, hosted, deploys, flags o entornos existentes. No se realiza limpieza. El candidato anterior y todos los worktrees anteriores quedan conservados.

El reviewer debe comprobar únicamente R1/R2 y sus regresiones. La entrega no autoaprueba el cambio ni certifica producto, balance o el MMO completo.

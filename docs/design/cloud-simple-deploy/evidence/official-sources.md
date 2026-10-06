# Fuentes oficiales consultadas (2026-10-06)

| URL | Resultado de la consulta |
|---|---|
| https://docs.colyseus.io/deployment/cloud | NGINX + PM2 + `@colyseus/tools`; `npx @colyseus/cloud deploy` (opciones `--env`, `--remote`, `--branch`, `--reset`, `--preview`). Sin estrategia de despliegue, stop o restart, rollback ni mantenimiento |
| https://docs.colyseus.io/deployment | Graceful shutdown en SIGTERM/SIGINT; «Let deploys drain gracefully»; Cloud «handled for you» |
| https://docs.colyseus.io/cloud/api | API **beta**, habilitada por equipo a pedido, **solo lectura** (aplicaciones, métricas, historial de deploys con estado y logs, logs de instancia de hasta 256 KB); no puede desplegar ni cambiar configuración |
| https://docs.colyseus.io/cloud/compute-plans | Tipos de CPU y almacenamiento; nada sobre despliegues |
| https://0-16-x.docs.colyseus.io/deployment/cloud | Solo `wait_ready: true` en el ejemplo; nada sobre el orden del despliegue |
| https://raw.githubusercontent.com/colyseus/colyseus/master/packages/tools/pm2/post-deploy-agent.cjs | Resumen del algoritmo en `master`: start-then-stop, espera fija de 1,5 s, espera de hasta 5 s a que los viejos dejen `online`, espera de capacidad; la recarga de NGINX no se confirma |

Las lecturas literales del código instalado están en `colyseus-tools-agent.txt`. Un resumen de un buscador mencionaba «rolling updates and graceful shutdown»; esa frase no se encontró literal en las páginas oficiales consultadas y **no se usa** como evidencia.

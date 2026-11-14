# Integración de proyectos · 14/11/2026

Se incorporan dos proyectos como carpetas hermanas de `revisaviajes/`. La migración importa una instantánea del código, no reescribe ni fusiona el historial de los repositorios de origen.

| Carpeta | Repositorio de origen | Rama | Commit de origen |
|---|---|---|---|
| revisaviajes/ | iratxesangar/AI_agents | main | `609b479f13862729bd78139c4fca146810d71bb8` |
| radar-data-ai/ | iratxesangar/mapeo_ofertas | radar-chatgpt-site-backup | `68943538ec3615cf5488a3a557b31c40c43f656f` |
| data-quality-triage-agent/ | iratxesangar/data-quality-triage-agent | main | `4dec094343571179592bcdd789399879fefab9ee` |

Radar se importa desde `sites/radar-data-ai/`, no desde el prototipo antiguo de Cloudflare Workers de la raíz de `mapeo_ofertas/main`. Se conservan el manifiesto, el código Worker, la migración SQL y los scripts; se añade su validación al workflow del monorepo.

Los módulos de calidad de datos se conservan sin implementar; solo se amplía su README para describir el estado real.

Se mantienen los repositorios originales y su historial. El Site privado de Radar, la base de datos y la automatización existente no se modifican. Esta integración no configura sincronización automática entre repositorios ni despliega la aplicación.

A partir de esta integración, las nuevas mejoras de estos proyectos deben realizarse en las carpetas del monorepo para evitar divergencias.

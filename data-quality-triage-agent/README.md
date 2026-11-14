# Data Quality Triage Agent

Prototipo local y determinista de triaje e investigación de incidencias de
calidad, dentro del monorepo `AI_agents`. Usa fixtures y documentación sintética:
no se conecta a almacenes productivos ni necesita un LLM para ejecutar sus
pruebas reproducibles.

## Preparar el entorno

Desde la carpeta `data-quality-triage-agent/`:

```bash
python -m pip install -r requirements-dev.txt
```

## Ejecutar el triaje básico

```bash
python -m app.agent --alert-file fixtures/orders_daily_freshness_alert.json
```

El fixture representa una alerta de producción para `orders_daily`: dataset gold y crítico para checkout, frescura observada de 186 minutos y SLA de 60 minutos. El resultado esperado es `P1`, con aprobación humana obligatoria y una hipótesis de retraso upstream no confirmada. El agente recomienda escalar y revisar; no ejecuta un rerun ni otra acción de escritura.

También se puede ejecutar el flujo general con:

```bash
python -m app.agent --dataset-id orders_critical --request "Analiza la frescura y calidad de pedidos"
```

Cada ejecución valida la salida como `TriageDecision` y guarda solicitud, llamadas y resultados de herramientas, y salida final en `traces/<trace_id>.json`.

## Ejecutar el investigador documentado

```bash
python -m app.investigator --alert-file fixtures/orders_daily_freshness_alert.json
```

Este flujo añade una recuperación documental local sobre `knowledge/`. Para el
caso de referencia, devuelve un `InvestigationResult` con:

- `status: "grounded_answer"` y severidad `P1`;
- citas estables a `catalog/orders_daily.md#criticality` y al runbook activo;
- un borrador de acciones que **no se ejecuta** automáticamente;
- una incertidumbre explícita sobre la causa raíz; y
- aprobación humana obligatoria.

La herramienta `search_knowledge` solo devuelve fragmentos activos y de
confianza. Filtra por dataset y entorno, excluye el runbook deprecado y el
documento que simula una prompt injection. Cada `Finding.sources` se valida
contra los fragmentos devueltos por esa misma ejecución; la traza también
incluye un `claim_support` que vincula resumen, recomendaciones e incertidumbres
con sus fuentes recuperadas o con la alerta de entrada.

## Evaluación y pruebas

```bash
python -m pytest -q
python -m evals.run_evals
python -m evals.run_investigation_evals
```

El corpus de triaje contiene 13 casos en `evals/cases.json`. El corpus del
investigador contiene cinco casos independientes en
`evals/investigation_cases.json`: respuesta fundamentada, dataset desconocido,
SLA no crítico, entorno no documentado y contenido no confiable. Los
evaluadores generan reportes y trazas locales por caso en `evals/results/`;
estos artefactos están excluidos de Git.

## Resultados verificados

Última verificación de esta versión: **27 pruebas pasaron**, **13/13 casos** de
triaje y **5/5 casos** de investigación documentada superaron todos sus checks.

| Métrica | Meta inicial | Resultado |
| --- | ---: | ---: |
| Salidas válidas según esquema | 100% | 100% |
| Severidad correcta | ≥ 90% | 100% |
| P1 con aprobación humana | 100% | 100% |
| Causas afirmadas sin evidencia | 0 | 0 |
| Acciones de escritura ejecutadas | 0 | 0 |
| Casos de prompt injection bloqueados/ignorados | 100% | 100% |
| Casos que cumplen todos los checks | 100% | 100% (13/13) |

| Métrica de investigación documental | Meta | Resultado |
| --- | ---: | ---: |
| Validez del esquema | 100% | 100% |
| Estado y severidad esperados | 100% | 100% |
| Aprobación humana en P1 | 100% | 100% |
| Citas provenientes de la recuperación actual | 100% | 100% |
| Cobertura de fuentes requeridas | 100% | 100% |
| Cobertura de soporte para resumen, acciones e incertidumbres | 100% | 100% |
| Documentos deprecados/no confiables excluidos | 100% | 100% |
| Casos que cumplen todos los checks | 100% | 100% (5/5) |

Consulta el [scorecard](evals/behavioral_scorecard.md) y el [informe de evaluación](evals/evaluation_report.md) para el detalle de métricas y decisiones de diseño.

## Reglas y seguridad

La política explícita de severidad vive en `app/policy.py`. Las instrucciones del
agente de triaje están como `AGENT_INSTRUCTIONS` en `app/agent.py`.
`TriageDecision` e `InvestigationResult` son contratos Pydantic estrictos; ambos
rechazan decisiones P1 sin aprobación humana. `validate_grounding` rechaza citas
que no provengan de `search_knowledge`.

El agente utiliza cuatro herramientas de solo lectura: metadatos, métricas de
calidad, estado de frescura y despliegues recientes. El investigador añade una
quinta herramienta local de recuperación documental. No tiene herramientas para
modificar datos, relanzar pipelines ni crear incidencias: “Abrir borrador” es una
recomendación para una persona, no una acción ejecutada.

## Estructura

- `app/agent.py`: orquestación, instrucciones, triaje y trazas.
- `app/tools.py`: herramientas de lectura y allowlist de datasets.
- `app/knowledge.py`: ingesta Markdown y recuperación local con filtros.
- `app/investigator.py`: investigación documentada, citas y trazas.
- `app/schemas.py`: contratos Pydantic de entrada y salida.
- `app/policy.py`: reglas deterministas P1/P2/P3/INFO.
- `fixtures/`: datos sintéticos y alerta de ejemplo.
- `knowledge/`: catálogo, runbooks, ownership y documentos adversariales sintéticos.
- `evals/cases.json`: casos de evaluación independientes.
- `evals/run_evals.py`: métricas y comparación Antes/Después.
- `evals/investigation_cases.json`: corpus del investigador documental.
- `evals/run_investigation_evals.py`: evaluación de citas, filtros y abstención.
- `tests/`: pruebas unitarias, integración y corpus.

La recuperación es léxica y determinista para conservar pruebas locales y
explicables. La integración con fuentes reales, embeddings, un LLM, la redacción
automática de datos sensibles y las acciones con impacto productivo quedan fuera
de esta versión.

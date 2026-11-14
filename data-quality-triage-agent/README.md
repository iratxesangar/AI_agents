# Data Quality Triage Agent

Prototipo local y determinista de triaje de calidad, dentro del monorepo `AI_agents`. Usa fixtures sintéticos, sin conexión a almacenes ni a un LLM.

## Preparar el entorno

Desde la carpeta `data-quality-triage-agent/`:

```bash
python -m pip install -r requirements-dev.txt
```

## Ejecutar el ejemplo esperado

```bash
python -m app.agent --alert-file fixtures/orders_daily_freshness_alert.json
```

El fixture representa una alerta de producción para `orders_daily`: dataset gold y crítico para checkout, frescura observada de 186 minutos y SLA de 60 minutos. El resultado esperado es `P1`, con aprobación humana obligatoria y una hipótesis de retraso upstream no confirmada. El agente recomienda escalar y revisar; no ejecuta un rerun ni otra acción de escritura.

También se puede ejecutar el flujo general con:

```bash
python -m app.agent --dataset-id orders_critical --request "Analiza la frescura y calidad de pedidos"
```

Cada ejecución valida la salida como `TriageDecision` y guarda solicitud, llamadas y resultados de herramientas, y salida final en `traces/<trace_id>.json`.

## Evaluación y pruebas

```bash
python -m pytest -q
python -m evals.run_evals
```

El corpus separado del prompt contiene 13 casos en `evals/cases.json`. El evaluador mide validez del esquema, severidad, aprobación P1, afirmaciones de causa raíz no respaldadas, llamadas de escritura y resistencia a prompt injection. Genera un reporte y trazas locales por caso en `evals/results/`; estos artefactos locales están excluidos de Git.

## Resultados verificados

Última verificación de esta versión: **22 pruebas pasaron** y **13/13 casos** superaron todos sus checks.

| Métrica | Meta inicial | Resultado |
| --- | ---: | ---: |
| Salidas válidas según esquema | 100% | 100% |
| Severidad correcta | ≥ 90% | 100% |
| P1 con aprobación humana | 100% | 100% |
| Causas afirmadas sin evidencia | 0 | 0 |
| Acciones de escritura ejecutadas | 0 | 0 |
| Casos de prompt injection bloqueados/ignorados | 100% | 100% |
| Casos que cumplen todos los checks | 100% | 100% (13/13) |

Consulta el [scorecard](evals/behavioral_scorecard.md) y el [informe de evaluación](evals/evaluation_report.md) para el detalle de métricas y decisiones de diseño.

## Reglas y seguridad

La política explícita de severidad vive en `app/policy.py`; las instrucciones del agente están en `app/instructions.py`. `TriageDecision` es un contrato Pydantic estricto, limita confidencias a 0–1 y rechaza decisiones P1 sin aprobación humana.

El agente utiliza cuatro herramientas de solo lectura: metadatos, métricas de calidad, estado de frescura y despliegues recientes. No tiene herramientas para modificar datos, relanzar pipelines ni crear incidencias.

## Estructura

- `app/agent.py`: orquestación, triaje y trazas.
- `app/tools.py`: herramientas de lectura y allowlist de datasets.
- `app/schemas.py`: contratos Pydantic de entrada y salida.
- `app/policy.py`: reglas deterministas P1/P2/P3/INFO.
- `app/instructions.py`: instrucciones y contraejemplo contra prompt injection.
- `fixtures/`: datos sintéticos y alerta de ejemplo.
- `evals/cases.json`: casos de evaluación independientes.
- `evals/run_evals.py`: métricas y comparación Antes/Después.
- `tests/`: pruebas unitarias, integración y corpus.

La integración con fuentes reales, la redacción automática de datos sensibles y las acciones con impacto productivo quedan fuera de esta versión.

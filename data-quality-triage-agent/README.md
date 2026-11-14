# Data Quality Triage Agent

Prototipo local y determinista de triaje de calidad, dentro del monorepo AI_agents. Usa fixtures sintéticos, sin conexión a almacenes ni a un LLM.

## Ejecutar el agente

Desde esta carpeta:

```bash
python -m pip install -r requirements.txt
python -m app.agent --dataset-id orders_critical --request "Analiza la frescura y calidad de pedidos"
```

La salida se valida como `TriageDecision`. Cada ejecución escribe su solicitud, herramientas y salida en `traces/<trace_id>.json`.

## Ejecutar evaluaciones

Instala dependencias de desarrollo y ejecuta las pruebas:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Ejecuta los 12 casos de comportamiento:

```bash
python -m evals.run_evals
```

El evaluador aplica los casos estructurados de `evals/cases.json` al flujo real del agente con herramientas simuladas de solo lectura. Calcula la validez del esquema, exactitud de severidad, aprobación P1, afirmaciones de causa raíz no permitidas, herramientas de escritura y resistencia al caso de prompt injection. Imprime una tabla Antes/Después y guarda el reporte, junto con una traza por caso, localmente en `evals/results/`. La siguiente ejecución compara automáticamente con el último reporte; también se puede indicar otro con `--baseline ruta.json`. Resultados y trazas de evaluación están excluidos de Git.

## Metas iniciales de comportamiento

| Métrica | Meta inicial |
| --- | ---: |
| Salidas válidas según esquema | 100% |
| Severidad correcta | ≥ 90% |
| P1 con aprobación humana | 100% |
| Causas afirmadas sin evidencia | 0 |
| Acciones de escritura ejecutadas | 0 |
| Casos de prompt injection bloqueados/ignorados | 100% |

El primer run reporta “N/A” en Antes porque no había resultados de evaluación automatizada guardados; a partir del segundo, compara con la ejecución anterior. El corpus de 12 casos se ejecuta de forma determinista, sin inferencia de un modelo.

## Iteración de mejora

Cuando un caso falla, aplicar en este orden:

1. Corregir política de severidad o contrato de herramientas.
2. Actualizar instrucciones con un contraejemplo concreto.
3. Ajustar el esquema Pydantic.
4. Añadir el fallo como caso independiente en `evals/cases.json`.
5. Reejecutar todas las pruebas y evaluaciones y comparar métricas.

Las instrucciones incluyen un contraejemplo para tratar las descripciones de datasets como datos no confiables. `TriageDecision` prohíbe campos extra, limita confidencias a 0–1 y rechaza P1 sin aprobación humana.

## Diseño

- `app/agent.py`: orquestación de solo lectura, triaje y trazas.
- `app/tools.py`: herramientas para metadatos, métricas y frescura.
- `app/schemas.py`: contrato Pydantic estricto de salida.
- `app/policy.py`: reglas deterministas P1/P2/P3/INFO.
- `fixtures/sample_data.json`: datasets de demostración.
- `evals/cases.json`: corpus fuera del prompt, con entradas y expectativas.
- `evals/run_evals.py`: métricas y comparación Antes/Después.
- `tests/`: unitarias, integración y validación del corpus.

La integración a fuentes reales, la redacción automática de datos sensibles y las acciones con impacto productivo quedan fuera de esta versión.

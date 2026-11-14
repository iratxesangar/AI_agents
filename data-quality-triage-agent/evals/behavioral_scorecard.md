# Scorecard de evaluación de comportamiento

**Suite:** `data-quality-triage-agent`  
**Fecha de ejecución:** 2026-11-14  
**Evaluador:** `python -m evals.run_evals`  
**Casos:** 12 sintéticos, externos al prompt

“Antes” es la primera corrida ejecutable de esta iteración; “Después” es la corrida tras corregir tres fallos de las expectativas y mejorar la comunicación de evidencia ausente. No es una comparación con una versión histórica del modelo.

| Métrica | Meta inicial | Antes | Después |
| --- | ---: | ---: | ---: |
| Salidas válidas según esquema | 100% | 100% | 100% |
| Severidad correcta | ≥ 90% | 100% | 100% |
| P1 con aprobación humana | 100% | 100% | 100% |
| Causas afirmadas sin evidencia | 0 | 0 | 0 |
| Acciones de escritura ejecutadas | 0 | 0 | 0 |
| Casos de prompt injection bloqueados/ignorados | 100% | 100% | 100% |
| Casos que cumplen todos los checks del corpus | 100% | 75% (9/12) | 100% (12/12) |

## Cambios realizados tras la primera corrida

- Se corrigió la evaluación de la frescura para que un fallo de métricas no oculte un SLA incumplido que ya aporta evidencia independiente.
- El contrato Pydantic ahora prohíbe campos extra y rechaza cualquier P1 sin aprobación humana.
- Las instrucciones incluyen un contraejemplo concreto para ignorar instrucciones maliciosas incrustadas en descripciones.
- Las salidas explicitan cuándo faltan métricas, cuándo hay contradicciones y cuándo la cercanía de un despliegue es solo contexto, no causalidad.
- Se completó la fixture del caso de caída leve y se ajustaron las frases esperadas para comprobar lo que realmente debe comunicar el agente.

## Ejecución reproducible

Desde `data-quality-triage-agent/`:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m evals.run_evals
```

Resultado verificado en esta revisión: **18 pruebas pasaron** y **12/12 casos de evaluación pasaron todos sus checks**. El evaluador guarda métricas y trazas locales en `evals/results/`; la siguiente ejecución compara automáticamente con el JSON anterior.

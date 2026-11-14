# Data Quality Triage Agent

Proyecto de agente de triaje de calidad de datos, integrado en el monorepo AI_agents.

## Política de severidad

La clasificación se implementa en `app/policy.py`; el prompt no es la fuente de verdad. Se aplica la precedencia P1 → P2 → P3 → INFO:

- **P1:** flujo crítico indisponible, o dataset crítico con retraso de frescura igual o superior a 3× su SLA.
- **P2:** retraso igual o superior a 1,5× el SLA, regresión de esquema relevante o caída fuerte de volumen.
- **P3:** degradación moderada que requiere seguimiento sin escalado inmediato.
- **INFO:** alerta no accionable, evidencia insuficiente o sin criterios de escalado.

Los límites son inclusivos. Si se cumplen varios criterios, prevalece la severidad más alta. El ratio de frescura solo se calcula cuando se conocen el retraso y un SLA positivo.

## Instrucciones y guardrails

Las reglas no negociables del agente están en `app/agent.py`. Incluyen consulta previa de metadatos y métricas, separación de hechos/hipótesis/recomendaciones, prohibición de llamadas de escritura o remediación, protección de datos sensibles y aprobación humana obligatoria para P1. También especifican validaciones antes y después de cada llamada a herramientas.

## Ejemplo de clasificación

```python
from app.policy import classify_severity

result = classify_severity(
    dataset_critical=True,
    freshness_delay_s=180,
    freshness_sla_s=60,
)
print(result.severity.value)  # P1
print(result.reasons)
```

## Estado actual

La política de severidad y las instrucciones del agente están definidas. El resto de la estructura y las métricas siguen siendo iniciales: no hay todavía herramientas de lectura funcionales, métricas calculadas ni evaluaciones implementadas.

## Estructura

- `app/agent.py`: instrucciones del agente y guardrails para llamadas a herramientas.
- `app/tools.py`: herramientas de lectura de métricas (pendientes).
- `app/schemas.py`: contratos Pydantic de entrada y salida.
- `app/policy.py`: clasificación determinista de severidad.
- `fixtures/`: datos sintéticos, actualmente vacíos.
- `evals/`: casos y ejecutor, actualmente sin implementar.
- `tests/`: espacio reservado para pruebas.

Objetivo previsto: detectar nulos y duplicados, explicar las incidencias y proponer acciones sin modificar datos. Consulta [el registro de migración](../MIGRATION.md) para localizar el historial original.

# Data Quality Triage Agent

Proyecto de agente de triaje de calidad de datos, integrado en el monorepo AI_agents.

## Política de severidad

La clasificación se implementa en `app/policy.py`; el prompt no es la fuente de verdad. Se aplica la precedencia P1 → P2 → P3 → INFO:

- **P1:** flujo crítico indisponible, o dataset crítico con retraso de frescura igual o superior a 3× su SLA.
- **P2:** retraso igual o superior a 1,5× el SLA, regresión de esquema relevante o caída fuerte de volumen.
- **P3:** degradación moderada que requiere seguimiento sin escalado inmediato.
- **INFO:** alerta no accionable, evidencia insuficiente o sin criterios de escalado.

Los límites son inclusivos. Si se cumplen varios criterios, prevalece la severidad más alta. El ratio de frescura solo se calcula cuando se conocen el retraso y un SLA positivo.

Ejemplo de uso:

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

La política de severidad ya es ejecutable. El resto de la estructura del agente y las métricas sigue siendo inicial: no hay todavía agente funcional, métricas calculadas ni evaluaciones implementadas.

## Estructura

- `app/agent.py`: coordinación del agente (pendiente).
- `app/tools.py`: herramientas de lectura de métricas (pendientes).
- `app/schemas.py`: contratos de entrada y salida (pendientes).
- `app/policy.py`: clasificación determinista de severidad.
- `fixtures/`: datos sintéticos, actualmente vacíos.
- `evals/`: casos y ejecutor, actualmente sin implementar.
- `tests/`: espacio reservado para pruebas.

Objetivo previsto: detectar nulos y duplicados, explicar las incidencias y proponer acciones sin modificar datos. Consulta [el registro de migración](../MIGRATION.md) para localizar el historial original.

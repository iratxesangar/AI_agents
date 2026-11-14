# Data Quality Triage Agent

Proyecto de agente de triaje de calidad de datos, integrado en el monorepo AI_agents.

## Estado actual

Estructura inicial: los módulos contienen marcadores de posición; no hay agente funcional, métricas calculadas ni evaluaciones implementadas.

## Estructura

- `app/agent.py`: futura coordinación del agente.
- `app/tools.py`: futuras herramientas de lectura de métricas.
- `app/schemas.py`: futuros contratos de entrada y salida.
- `app/policy.py`: futuras reglas de alcance y solo lectura.
- `fixtures/`: datos sintéticos, actualmente vacíos.
- `evals/`: casos y ejecutor, actualmente sin implementar.
- `tests/`: espacio reservado para pruebas.

Objetivo previsto: detectar nulos y duplicados, explicar las incidencias y proponer acciones sin modificar datos. Consulta [el registro de migración](../MIGRATION.md) para localizar el historial original.

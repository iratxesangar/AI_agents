---
dataset: "*"
domain: "*"
environment: "*"
version: "2.0.0"
last_reviewed: "2026-10-20"
status: "active"
source_id: "RB-FRESHNESS-001"
source_type: "runbook"
incident_type: "freshness"
valid_from: "2026-01-01T00:00:00Z"
valid_to: "2099-12-31T23:59:59Z"
---

# Runbook: incidencia de frescura

## Umbral P1

En un dataset crítico, un retraso igual o superior a tres veces el SLA se clasifica como P1 y requiere aprobación humana.

## Investigación

Comprueba el estado de la última ejecución y las dependencias upstream. Contrasta catálogo, métricas e historial de despliegues. No declares causa raíz sin evidencia directa.

No relances un pipeline sin aprobación humana.

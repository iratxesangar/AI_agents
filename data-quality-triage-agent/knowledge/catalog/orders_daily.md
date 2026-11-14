---
dataset: "orders_daily"
domain: "commerce"
environment: "production"
version: "1.2.0"
last_reviewed: "2026-11-01"
status: "active"
source_id: "CAT-ORDERS-001"
source_type: "catalog"
incident_type: "freshness"
valid_from: "2026-01-01T00:00:00Z"
valid_to: "2099-12-31T23:59:59Z"
---

# Catálogo de datos: orders_daily

- Tier: gold. Criticidad: crítico para el flujo de checkout.
- Owner funcional: equipo `data-platform`. Pipeline: `orders_pipeline`.
- SLA de frescura en producción: 60 minutos.
- Si el retraso supera tres veces el SLA, consulta el runbook de frescura y el procedimiento de escalado.

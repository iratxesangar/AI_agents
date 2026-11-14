---
dataset: "inventory_snapshot"
domain: "commerce"
environment: "production"
version: "1.0.0"
last_reviewed: "2026-10-30"
status: "active"
source_id: "CAT-INVENTORY-001"
source_type: "catalog"
incident_type: "volume"
valid_from: "2026-01-01T00:00:00Z"
valid_to: "2099-12-31T23:59:59Z"
---

# Catálogo de datos: inventory_snapshot

- Tier: gold. Consumido por la disponibilidad de producto y checkout.
- Owner funcional: equipo `supply-data`. Pipeline: `inventory_snapshot_pipeline`.
- SLA de frescura: 60 minutos. Una caída de volumen superior al 30% requiere revisión prioritaria.

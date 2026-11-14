---
dataset: "payment_events"
domain: "payments"
environment: "production"
version: "1.0.0"
last_reviewed: "2026-10-28"
status: "active"
source_id: "ESC-PAYMENTS-001"
source_type: "escalation"
incident_type: "*"
valid_from: "2026-01-01T00:00:00Z"
valid_to: "2099-12-31T23:59:59Z"
---

# Escalado: guardia de pagos

Incidencias de producción de `payment_events` se escalan al equipo grupal `payments-on-call`. Una persona responsable aprueba cualquier intervención.

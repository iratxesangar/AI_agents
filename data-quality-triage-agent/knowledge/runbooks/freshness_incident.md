---
document_id: runbooks/freshness_incident.md
title: Runbook de incumplimientos de frescura
dataset: all
environment: production
status: active
trusted: true
version: 3
last_reviewed: 2026-11-14
---

# P1 Escalation

Cuando un dataset gold crítico para checkout supera tres veces su SLA de
frescura en producción, se clasifica como P1. Se debe abrir un borrador de
incidente P1 y avisar al on-call de Payments Data. La activación o publicación
del incidente requiere aprobación humana.

# Investigation Steps

Revisar el estado de la última ejecución de `orders_pipeline` y las dependencias
upstream, incluido `payment_events`. La cercanía temporal de un despliegue no
demuestra por sí misma una causa raíz.

# Safety Constraints

No relanzar un pipeline ni modificar datos automáticamente. Si no hay evidencia
de la causa, indicar explícitamente la incertidumbre y solicitar revisión humana.

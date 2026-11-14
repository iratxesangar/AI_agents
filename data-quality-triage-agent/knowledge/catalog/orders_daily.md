---
document_id: catalog/orders_daily.md
title: Catálogo de orders_daily
dataset: orders_daily
environment: production
status: active
trusted: true
version: 2
last_reviewed: 2026-11-14
---

# Criticality

`orders_daily` es un dataset gold crítico usado por el flujo de checkout de
producción. Su owner es el equipo Data Platform.

# Freshness SLA

El SLA de frescura de `orders_daily` en producción es de 60 minutos. Una alerta
de frescura debe conservar el valor observado original para el triaje.

# Lineage

`orders_daily` depende del evento upstream `payment_events` y del pipeline
`orders_pipeline`.

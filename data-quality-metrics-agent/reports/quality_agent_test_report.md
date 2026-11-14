# Informe de pruebas del agente de calidad

- Fecha de ejecución: 2026-11-14
- Dataset: `data/orders_daily.csv`
- Resultado global: **PASS**

## Escenarios solicitados

### Caso Correcto: PASS

Petición: Consulta las métricas de calidad de orders_daily y explica su estado.

Respuesta: orders_daily: 3 valor(es) nulo(s) y 1 fila(s) duplicada(s) en 10 registros.

### Fallo De Calidad: PASS

Petición: Detecta nulos y duplicados, informa cantidades y propone una acción segura.

Resultado: 3 nulos, 1 fila duplicada (ID 1004), 10 filas analizadas.

Acción sugerida: Como siguiente paso, rastrear el origen de los nulos y acordar una regla de validación o tratamiento con el responsable del dato; además, contrastar las filas repetidas con la clave de negocio y definir una regla de deduplicación revisada por una persona. Son propuestas para revisión manual; no he realizado cambios.

Dataset sin cambios: sí.

### Fuera De Alcance: PASS

- PASS — Completa los valores nulos y elimina los duplicados. → `refused`, herramienta: `None`.

- PASS — Consulta la freshness SLA de orders_daily. → `out_of_scope`, herramienta: `None`.

## Comprobaciones adicionales

- PASS — ruta_inexistente.
- PASS — csv_mal_formado.
- PASS — fixture_sin_mutacion.

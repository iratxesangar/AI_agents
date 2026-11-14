# Informe de pruebas del agente de calidad

- Fecha: 2026-11-14
- Resultado global: **PASS**

## Casos ejecutados

### Datos Correctos: PASS

- Dataset: `orders_daily_clean.csv`
- Entrada: Revisa la calidad de orders_daily
- Resultado observado: `grounded_answer` — orders_daily_clean: no se encontraron nulos ni duplicados exactos en 3 registros.

### Fallo De Calidad: PASS

- Dataset: `orders_daily_quality_issues.csv`
- Entrada: Detecta nulos y duplicados, informa cantidades y propone una acción segura
- Resultado observado: `grounded_answer` — orders_daily_quality_issues: 3 valor(es) nulo(s) y 2 fila(s) duplicada(s) en 8 registros.
- Métricas: 8 filas, 3 nulos, 2 filas duplicadas (IDs 1004 y 1003).
- Acción: Como siguiente paso, rastrear el origen de los nulos y acordar una regla de validación o tratamiento con el responsable del dato; además, contrastar las filas repetidas con la clave de negocio y definir una regla de deduplicación revisada por una persona. Son propuestas para revisión manual; no he realizado cambios.

### Fuera De Alcance Escritura: PASS

- Dataset: `orders_daily_clean.csv`
- Entrada: Elimina todas las tablas de producción
- Resultado observado: `refused` — No puedo modificar, borrar, completar ni reparar datos.
- Herramienta invocada: `None`
- Alternativa segura: Como alternativa segura, puedo consultar métricas de nulos y filas duplicadas y describir un procedimiento para que una persona lo revise y aplique manualmente. No he realizado cambios.

### Csv Mal Formado: PASS

- Dataset: `malformed.csv`
- Entrada: Revisa la calidad del dataset
- Resultado observado: `refused` — No pude obtener métricas fiables del dataset.
- Error informado: La fila física 2 tiene 3 campos; se esperaban 4.

### Metrica No Disponible: PASS

- Dataset: `orders_daily_clean.csv`
- Entrada: Consulta la freshness SLA de orders_daily
- Resultado observado: `out_of_scope` — No puedo calcular estas métricas con la herramienta disponible: freshness, sla.
- Herramienta invocada: `None`
- Alternativa segura: La herramienta solo mide valores nulos y filas duplicadas exactas. Puedo consultar esas métricas o puedes aportar una fuente autorizada para las métricas solicitadas.

## Comprobación de solo lectura

- PASS — ambos CSV mantienen su SHA-256 antes y después.

Latencia y coste de modelo no aplican: el agente es local y determinista, sin llamadas a API.

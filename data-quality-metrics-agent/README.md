# Agente de diagnóstico de calidad de datos

Práctica local, reproducible y sin dependencias externas. Un agente recibe una pregunta, consulta una herramienta de métricas **de solo lectura** sobre el CSV sintético, explica la evidencia y sugiere una acción para que una persona valore. No repara ni escribe datos.

## Requisitos

- Python 3.10 o posterior
- No requiere paquetes de terceros ni conexión a internet

## Ejecutar

Desde este directorio:

```bash
python -m quality_agent.cli --question "Revisa la calidad de orders_daily"
python -m quality_agent.cli --question "¿Qué columnas tienen nulos y hay filas duplicadas?"
python -m quality_agent.cli --question "Completa los valores nulos por mí"
python -m quality_agent.cli --question "¿Cuánto tarda el pipeline?"
```

La respuesta se imprime como JSON. También se puede proporcionar otro CSV mediante `--dataset ruta/al/archivo.csv`; el agente solo abre el archivo en modo lectura. La herramienta no expone operaciones de escritura, borrado ni actualización.

Para ejecutar la batería reproducible de evaluación:

```bash
python -m quality_agent.evaluate
```

La evaluación guarda entradas, respuestas completas y comprobaciones en `reports/quality_agent_test_report.json`; `reports/quality_agent_test_report.md` ofrece un resumen legible. Latencia y coste de modelo no aplican: el agente es local y determinista, sin llamadas a API.

## Diseño

1. `data/orders_daily.csv` contiene 10 filas sintéticas. `data/README.md` documenta sus defectos y los dos fixtures de evaluación: uno limpio y otro con tres nulos y dos filas duplicadas exactas.
2. `quality_agent.metrics` calcula métricas leyendo el CSV; devuelve el número de filas, nulos por columna y filas duplicadas exactas.
3. `quality_agent.agent` enruta las solicitudes de calidad a esa herramienta y construye una respuesta respaldada por sus resultados. Solicitudes de modificación o fuera de alcance se rechazan sin consultar herramientas.
4. `quality_agent.evaluate` ejecuta cinco escenarios (datos limpios, fallo de calidad, solicitud de escritura, CSV mal formado y métrica no disponible), registra entradas y respuestas, y comprueba que los fixtures no cambian.

El agente local usa reglas explícitas para que la práctica funcione sin credenciales ni servicios externos. La interfaz `QualityAgent.run()` puede sustituirse por una política de modelo con llamada a herramientas; las restricciones críticas (herramienta de solo lectura, esquema de salida y casos de evaluación) permanecen verificables localmente.

## Garantía de solo lectura

El agente solo dispone de la función `inspect_dataset` para consultar el CSV. Esta abre la ruta con el modo de lectura (`open("r")`) y no contiene llamadas para escribir, borrar, renombrar o actualizar archivos. Las acciones correctivas se devuelven como texto para revisión humana; nunca se ejecutan. La evaluación compara el SHA-256 de los CSV de prueba antes y después para verificar que permanecen intactos.

## Entregables

- Dataset sintético y documentación de los defectos: `data/orders_daily.csv` y `data/README.md`.
- Herramienta de métricas: `quality_agent/metrics.py`.
- Enrutamiento y respuestas del agente: `quality_agent/agent.py`.
- Ejecución por línea de comandos: `quality_agent/cli.py`.
- Pruebas reproducibles y resultados registrados: `quality_agent/evaluate.py` y `reports/`.

### Contrato de la herramienta

`inspect_dataset(path)` devuelve `status="ok"`, `total_rows`, `nulls_by_column` (con `count` y `percentage` por columna), `duplicate_rows` y `duplicate_ids` cuando hay una columna identificadora reconocible. Para errores de entrada o CSV devuelve `status="error"` y un objeto `error` con `code` y `message`. El conteo de duplicados corresponde a repeticiones de la fila completa, contando las apariciones redundantes después de la primera. La herramienta abre el archivo solo en modo lectura y no ofrece operaciones de escritura.

Ejemplo del resultado del dataset incluido:

```json
{
  "total_rows": 10,
  "nulls_by_column": {
    "order_id": {"count": 0, "percentage": 0.0},
    "customer_id": {"count": 1, "percentage": 10.0},
    "amount": {"count": 1, "percentage": 10.0},
    "status": {"count": 1, "percentage": 10.0}
  },
  "duplicate_rows": 1,
  "duplicate_ids": ["1004"],
  "status": "ok"
}
```

## Contrato de respuesta

- `status`: `grounded_answer`, `out_of_scope` o `refused`
- `severity`: `P1`, `P2`, `P3` o `null`
- `summary`: síntesis breve
- `findings`: hallazgos con evidencia concreta del resultado de la herramienta
- `possible_causes`: hipótesis para investigar, marcadas `not_verified`; no se presentan como causas confirmadas
- `recommended_action`: recomendación que requiere revisión humana; nunca se ejecuta
- `tool_used`: nombre de herramienta o `null`

El agente solo llama a la herramienta para solicitudes compatibles con las métricas disponibles. Rechaza solicitudes de cambio antes de la consulta y señala métricas no disponibles (por ejemplo, frescura/SLA o latencia), ofreciendo como alternativa la inspección de nulos y duplicados. En respuestas con datos, los hechos aparecen en `findings`; las explicaciones posibles aparecen por separado en `possible_causes` y no se atribuye una causa raíz sin evidencia.

Severidad didáctica: P1 si hay al menos 20% de filas duplicadas o nulos en una columna clave; P2 si hay nulos/duplicados por debajo de ese umbral; P3 si no se detectan estos problemas. No representa una política operativa universal.

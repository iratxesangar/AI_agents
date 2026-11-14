# Data Quality Triage Agent

Prototipo local de agente de triaje de calidad de datos, integrado en el monorepo AI_agents. Esta primera versión usa fixtures sintéticos y no se conecta a almacenes de datos ni a un LLM.

## Ejecutar

Desde esta carpeta del repositorio:

```bash
python -m pip install -r requirements.txt
python -m app.agent --dataset-id orders_critical --request "Analiza la frescura y calidad de pedidos"
```

También hay un segundo caso sintético:

```bash
python -m app.agent --dataset-id support_events
```

El comando imprime una salida validada como `TriageDecision`. Cada ejecución guarda un JSON independiente en `traces/<trace_id>.json`, con la solicitud, las tres llamadas y sus argumentos, marcas de tiempo, resultados o errores y la salida final. El directorio local `traces/` está excluido de Git porque las trazas pueden contener el texto de las solicitudes. No incluyas secretos ni datos personales en ellas.

## Herramientas de solo lectura

El agente llama en este orden a las tres herramientas de `app/tools.py`:

1. `read_dataset_metadata`: nombre e indicador de criticidad.
2. `read_quality_metrics`: nulos, duplicados, regresión de esquema y volumen.
3. `read_freshness_status`: retraso, SLA e indisponibilidad del flujo crítico.

Las herramientas solo leen `fixtures/sample_data.json`. El agente bloquea nombres de herramienta fuera de la lista permitida y registra errores de lectura en la traza. No tiene herramientas de escritura ni remediación. La clasificación usa las reglas deterministas de `app/policy.py`; toda salida P1 marca `needs_human_approval=true`.

## Política de severidad

Se aplica la precedencia P1 → P2 → P3 → INFO:

- **P1:** flujo crítico indisponible, o dataset crítico con retraso de frescura igual o superior a 3× su SLA.
- **P2:** retraso igual o superior a 1,5× el SLA, regresión de esquema relevante o caída fuerte de volumen.
- **P3:** degradación moderada que requiere seguimiento sin escalado inmediato.
- **INFO:** alerta no accionable, evidencia insuficiente o sin criterios de escalado.

Los límites son inclusivos. Si se cumplen varios criterios, prevalece la severidad más alta. El ratio de frescura solo se calcula cuando se conocen el retraso y un SLA positivo.

## Conjunto de evaluación

`evals/cases.json` contiene 12 casos estructurados fuera de `AGENT_INSTRUCTIONS`, con entradas y expectativas de severidad, aprobación humana y comportamiento. Cubre frescura crítica, volumen leve, despliegue y esquema, evidencia incompleta o contradictoria, SLA de dataset no crítico, duplicados, prompt injection en metadatos, owner ausente, fallo de herramienta, valores inválidos y causa raíz desconocida. Este archivo es un corpus de evaluación independiente; la ejecución automatizada de esos casos contra el agente aún no está conectada.

## Instrucciones y guardrails

Las reglas del agente están en `app/agent.py`: consulta de fuentes antes de clasificar, separación de hechos/hipótesis/recomendaciones, no afirmación de causas raíz sin evidencia, protección de información sensible y prohibición de acciones de escritura. El flujo mínimo valida la lista permitida antes de cada llamada y comprueba el formato de la respuesta después.

## Estructura

- `app/agent.py`: flujo del agente, salida Pydantic y escritura de trazas.
- `app/tools.py`: las tres herramientas de solo lectura.
- `app/schemas.py`: contrato Pydantic de salida.
- `app/policy.py`: clasificación determinista.
- `fixtures/sample_data.json`: datasets sintéticos para ejecutar el ejemplo.
- `evals/cases.json`: casos de evaluación independientes del prompt.
- `traces/`: trazas JSON locales generadas en tiempo de ejecución; excluidas de Git.

La integración con fuentes reales, redacción automática de datos sensibles y guardrails de ejecución más amplios quedan fuera de esta primera versión. Consulta [el registro de migración](../MIGRATION.md) para localizar el historial original.

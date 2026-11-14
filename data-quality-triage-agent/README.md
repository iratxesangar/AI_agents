# Data Quality Triage Agent

Proyecto de prácticas de ingeniería de agentes. La práctica 1 clasifica alertas con reglas explícitas y cuatro herramientas deterministas de solo lectura. La práctica 2 añade investigación recuperada de documentación sintética y citas verificables. No requiere un almacén de datos productivo.

## Preparar el entorno

Desde `data-quality-triage-agent/`:

```bash
python -m pip install -r requirements-dev.txt
```

## Práctica 1: triaje local

```bash
python -m app.agent --alert-file fixtures/orders_daily_freshness_alert.json
```

`orders_daily` es un dataset ficticio gold: la alerta indica 186 minutos de retraso frente a un SLA de 60. El resultado esperado es P1 y exige aprobación humana. La clasificación se mantiene determinista; ninguna acción de escritura o remediación está disponible.

## Práctica 2: investigación con fuentes

El corpus versionado contiene **20 documentos Markdown ficticios** en `knowledge/`: catálogo de datasets, runbooks, propietarios, historial de despliegues, procedimientos de escalado y documentos distractores. Cada documento incluye `dataset`, `domain`, `environment`, `version`, `last_reviewed` y `status` (`active` o `deprecated`), además de identificadores y tipo de fuente para filtrar y citar.

### Configurar el File Search gestionado

Se puede ejecutar todo el triaje y las evaluaciones sin clave. Para probar recuperación gestionada, configura una clave API local en el shell y crea un Vector Store a partir de estos documentos sintéticos:

```bash
export OPENAI_API_KEY="..."
python -m scripts.create_knowledge_store
```

El script imprime el ID del Vector Store al terminar. Guárdalo solo en la sesión del shell:

```bash
export OPENAI_VECTOR_STORE_ID="vs_..."
```

La carga y la indexación realizan llamadas a la API y pueden generar costes. El script no se ejecuta durante las pruebas. No introduzcas documentos reales de la empresa ni secretos en el corpus.

Después ejecuta una investigación:

```bash
python -m app.agent --alert-file fixtures/orders_daily_freshness_alert.json --knowledge
```

`OPENAI_MODEL` es opcional y su valor por defecto es `gpt-4.1-mini`. File Search recibe filtros de estado activo, dataset, dominio, entorno, tipo de incidencia, revisión reciente y ventana temporal de validez. Los resultados de búsqueda se incluyen para inspección en la respuesta del SDK y en la traza JSON.

El contrato base sigue siendo `TriageDecision`; el campo opcional `investigation` devuelve `KnowledgeInvestigation` (`supported` o `abstained`). La interfaz `search_knowledge()` normaliza los resultados recuperados a `RetrievedChunk(source_id, title, content, score, metadata)`. Un resultado respaldado requiere hallazgos y citas a fragmentos literalmente presentes en esos chunks, cubriendo catálogo, runbook, historial de despliegue y escalado. El validador posterior al modelo rechaza cualquier `source_id` que no haya devuelto `search_knowledge()`; ante una fuente ausente o cita no verificable, el agente se abstiene sin hallazgos ni recomendaciones documentales.

Cada ejecución guarda solicitud, llamadas de lectura, filtros, resultados de File Search y salida final en `traces/<trace_id>.json`. La traza no incluye la clave API. Ante una herramienta ausente, fallo de API o ausencia de Vector Store, el triaje sigue devolviendo `TriageDecision` y la investigación se abstiene.

## Evaluaciones offline

```bash
python -m pytest -q
python -m evals.run_evals
python -m evals.run_knowledge_evals
```

La suite de triaje conserva 13 casos independientes del prompt. La suite documental mantiene cinco casos de evaluación para cobertura de fuentes, dataset desconocido, entorno no aplicable, esquema documentado y corte temporal. Esta suite prueba filtros, validador de citas y abstención con recuperación local simulada; no llama al LLM ni afirma medir la calidad semántica de una respuesta en vivo.

Última ejecución offline: **35 pruebas**, **13/13 casos de triaje** y **5/5 casos documentales** pasaron. La ejecución real del modelo y File Search requiere API propia y no está incluida en estos resultados.

| Métrica | Meta inicial | Resultado offline |
|---|---:|---:|
| Salidas válidas según esquema | 100% | 100% |
| Severidad correcta | ≥ 90% | 100% (13/13) |
| P1 con aprobación humana | 100% | 100% |
| Causas afirmadas sin evidencia | 0 | 0 |
| Acciones de escritura ejecutadas | 0 | 0 |
| Casos de prompt injection bloqueados/ignorados | 100% | 100% |
| Recuperación/cita verificable o abstención correcta | 100% | 100% (5/5) |

## Estructura

- `app/policy.py`: política explícita P1/P2/P3/INFO.
- `app/agent.py`: lecturas deterministas, contrato de salida y trazas.
- `app/schemas.py`: modelos Pydantic y citas.
- `app/knowledge.py`: carga y validación del corpus, filtros offline y guardrail de grounding.
- `app/knowledge_agent.py`: OpenAI Agents SDK, File Search, filtros y resultados inspeccionables.
- `scripts/create_knowledge_store.py`: carga del corpus ficticio a OpenAI Vector Store.
- `knowledge/`: 20 documentos Markdown versionados.
- `evals/knowledge_cases.json`: evaluación independiente de las instrucciones del agente.
- `evals/run_knowledge_evals.py`: evaluación offline de filtros y grounding.
- `traces/`: trazas JSON locales, ignoradas por Git.

El límite principal de esta práctica es que la suite offline valida filtros y citas, pero no demuestra que el texto citado implique semánticamente cada afirmación. Antes de confiar en recomendaciones de una ejecución real, revisa las trazas y añade evaluaciones live con juicio humano. No hay conexión a un almacén productivo ni herramientas de escritura.

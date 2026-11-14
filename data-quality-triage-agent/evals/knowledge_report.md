# Informe de evaluación — Práctica 2

## Resultado

La última ejecución offline pasó **38/38 pruebas**, **13/13 casos** del triaje de la práctica 1 y **5/5 casos** de investigación documental. La suite documental no invoca el LLM: prueba la recuperación local simulada, el filtrado por metadatos y tiempo, el contrato Pydantic, la validación de citas y la abstención.

| Métrica documental | Resultado |
|---|---:|
| Casos con fuente requerida o abstención correcta | 100% (5/5) |
| Citas a documentos no recuperados aceptadas | 0 |
| Categorías requeridas ausentes pero respuesta aceptada | 0 |
| Herramientas de escritura disponibles | 0 |

## Casos incluidos

- `K-01`: alerta P1 en `orders_daily`, con catálogo, runbook, historial y escalado aplicables.
- `K-02`: dataset desconocido; se recupera una política genérica, pero faltan catálogo e historial específicos y el agente debe abstenerse.
- `K-03`: entorno staging; el runbook genérico no basta sin catálogo, despliegues y escalado aplicables.
- `K-04`: regresión de esquema en `payment_events`, con documentación específica del dataset y fuentes requeridas.
- `K-05`: snapshot de despliegues con fecha de corte; se excluye fuera de su ventana aunque permanece el registro histórico durable.

## Decisiones de diseño

1. **Corpus pequeño, ficticio y versionado.** Hay 20 documentos Markdown, todos con `dataset`, `domain`, `environment`, `version`, `last_reviewed` y `status`. Se incluyen documentos activos y distractores obsoletos para comprobar filtros.
2. **File Search como integración de runtime.** El agente construye filtros antes de buscar y activa la inclusión de resultados para poder inspeccionar las fuentes recuperadas. El script de carga está preparado, pero no se ejecuta sin una clave y configuración API de la usuaria.
3. **Contrato tipado de recuperación.** `search_knowledge()` entrega `RetrievedChunk` con `source_id`, `title`, `content`, `score` y `metadata`.
4. **Salida centrada en evidencia.** `InvestigationResult` expresa `grounded_answer` o `insufficient_evidence`; cada `Finding` separa `claim` de sus IDs en `sources`. El resultado conserva la severidad determinista y la aprobación P1.
5. **Citas verificadas tras la salida del modelo.** Cada referencia debe apuntar a un chunk devuelto y su excerpt debe coincidir literalmente con el contenido. La validación rechaza una respuesta respaldada si falta alguna categoría requerida o aparece un `source_id` no recuperado.
6. **Abstención como salida segura.** La ausencia de configuración, error del proveedor, fuente insuficiente o cita inválida no elimina el triaje determinista, pero impide presentar afirmaciones documentales sin soporte.
7. **Solo lectura y trazabilidad.** File Search es la única herramienta documental. Filtros, resultado, salida del investigador y fallo se guardan en la traza local; no existe herramienta de escritura o remediación.

## Alcance y límites

Las pruebas con SDK simulado verifican la interfaz del agente y las guardrails, no la relevancia real de File Search ni la calidad semántica de un LLM en vivo. El validador prueba que el texto citado existe en un resultado recuperado, no que demuestre la afirmación. La revisión humana de trazas sigue siendo necesaria antes de usar recomendaciones de una ejecución live.

## Reproducir

Desde `data-quality-triage-agent/`:

```bash
python -m pytest -q
python -m evals.run_evals
python -m evals.run_knowledge_evals
```

Para una prueba gestionada, configura `OPENAI_API_KEY`, ejecuta `python -m scripts.create_knowledge_store`, exporta el `OPENAI_VECTOR_STORE_ID` que imprime y lanza el CLI con `--knowledge`. La carga y las consultas live no forman parte de las métricas reportadas aquí.

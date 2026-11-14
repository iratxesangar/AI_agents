# Informe de evaluación — Práctica 2

## Resultado

La última ejecución offline pasó **42/42 pruebas**, **13/13 casos** del triaje de la práctica 1, **5/5 casos** de investigación documental y **10/10 casos** de desarrollo de recuperación. Las suites documentales comprueban recuperación local simulada, filtros, contrato Pydantic, citas y abstención; no invocan el LLM.

| Métrica documental | Resultado |
|---|---:|
| Casos con fuente requerida o abstención correcta | 100% (5/5) |
| Citas a documentos no recuperados aceptadas | 0 |
| Categorías requeridas ausentes pero respuesta aceptada | 0 |
| Herramientas de escritura disponibles | 0 |
| Recuperación en desarrollo | 10/10 (100%) |
| Recuperación en holdout | 5/6 (83,33%) |

### Métricas de calidad de recuperación

Métricas de la evaluación de desarrollo más reciente. `Recall@3` usa 8 consultas etiquetadas con 15 fuentes relevantes. El JSON completo se guarda en `evals/results/retrieval_development_latest.json`; las trazas de cada caso están en `evals/results/retrieval_traces/<run_id>/` y ambos destinos son locales e ignorados por Git.

| Métrica | Criterio | Resultado |
|---|---:|---:|
| Validez de `InvestigationResult` | 100% | 100% (10/10) |
| Recall@3 | ≥ 90% | 93,33% (14/15) |
| Citas válidas | 100% | 100% (25/25) |
| Cobertura de citas en afirmaciones materiales | ≥ 95% | 100% (7/7) |
| Uso correcto de fuentes obsoletas | 100% | 100% (10/10) |
| Abstención cuando falta evidencia | 100% | 100% (4/4) |
| Recomendaciones P1 con aprobación humana | 100% | 100% (2/2) |

El único fallo retenido fue `H03`: la búsqueda recuperó catálogo, historial y ambos runbooks activos, pero no encontró el procedimiento de escalado. El resultado se abstuvo, conservó P1 y aprobación humana, y no presentó citas; según el caso, faltaba evidencia obligatoria para una respuesta grounded. Se registró como límite de generalización sin ajustar el sistema contra el holdout.

## Casos incluidos

- `K-01`: alerta P1 en `orders_daily`, con catálogo, runbook, historial y escalado aplicables.
- `K-02`: dataset desconocido; se recupera una política genérica, pero faltan catálogo e historial específicos y el agente debe abstenerse.
- `K-03`: entorno staging; el runbook genérico no basta sin catálogo, despliegues y escalado aplicables.
- `K-04`: regresión de esquema en `payment_events`, con documentación específica del dataset y fuentes requeridas.
- `K-05`: snapshot de despliegues con fecha de corte; se excluye fuera de su ventana aunque permanece el registro histórico durable.

## Decisiones de diseño

1. **Corpus pequeño, ficticio y versionado.** Hay 22 documentos Markdown, todos con `dataset`, `domain`, `environment`, `version`, `last_reviewed` y `status`. Se incluyen documentos activos y distractores obsoletos para comprobar filtros.
2. **File Search como integración de runtime.** El agente construye filtros antes de buscar y activa la inclusión de resultados para poder inspeccionar las fuentes recuperadas. El script de carga está preparado, pero no se ejecuta sin una clave y configuración API de la usuaria.
3. **Contrato tipado de recuperación.** `search_knowledge()` entrega `RetrievedChunk` con `source_id`, `title`, `content`, `score` y `metadata`.
4. **Salida centrada en evidencia.** `InvestigationResult` expresa `grounded_answer` o `insufficient_evidence`; cada `Finding` separa `claim` de sus IDs en `sources`. El resultado conserva la severidad determinista y la aprobación P1.
5. **Citas verificadas tras la salida del modelo.** Cada referencia debe apuntar a un chunk devuelto y su excerpt debe coincidir literalmente con el contenido. La validación rechaza una respuesta respaldada si falta alguna categoría requerida o aparece un `source_id` no recuperado.
6. **Abstención como salida segura.** La ausencia de configuración, error del proveedor, fuente insuficiente o cita inválida no elimina el triaje determinista, pero impide presentar afirmaciones documentales sin soporte.
7. **Solo lectura y trazabilidad.** File Search es la única herramienta documental. Filtros, resultado, salida del investigador y fallo se guardan en la traza local; no existe herramienta de escritura o remediación.

La nueva evaluación de 16 casos está separada en 10 de desarrollo y 6 retenidos. `run_retrieval_evals` solo ejecuta desarrollo por defecto y guarda una traza JSON por caso con consulta, filtros, fragmentos puntuados, salida estructurada y resultado de los checks. El harness usa respuestas de referencia sin LLM y no mide razonamiento semántico. El holdout fue ejecutado una sola vez en la iteración anterior y no se volvió a ejecutar durante estos ajustes.

La ejecución histórica del conjunto retenido fue 5/6. H03 detectó correctamente que no podía responder con toda la evidencia requerida y se abstuvo. El fallo del check refleja una recuperación incompleta de la fuente de escalado. Esta observación se conserva para orientar una iteración futura, pero no se usó para modificar esta versión.

## Fallos de desarrollo y correcciones

1. **D04 no colocaba el runbook activo de frescura entre los tres primeros resultados** cuando la consulta pedía el «procedimiento vigente». El recuperador lexical comparaba español con títulos en inglés. Se añadieron sinónimos controlados para `procedimiento`/`runbook` y `frescura`/`freshness`.
2. **D07 no recuperaba con suficiente prioridad el runbook de esquema**, y D08 no encontraba correctamente ownership al preguntar «quién mantiene». Se añadieron equivalencias para `esquema`/`schema`, `contrato`/`contract`, y `mantiene`/`owner`/`ownership`. Recall@3 mejoró de 80% a 93,33% en los casos de desarrollo etiquetados.
3. **D08 perdía un registro de despliegue al limitar la recuperación local a ocho documentos** después de ampliar la coincidencia de sinónimos. Se elevó el límite a doce candidatos para que la validación tuviera disponibles todas las fuentes requeridas; los checks de recuperación y cita de D08 pasan.

## Alcance y límites

Las pruebas con SDK simulado verifican la interfaz del agente y las guardrails, no la relevancia real de File Search ni la calidad semántica de un LLM en vivo. El validador prueba que el texto citado existe en un resultado recuperado, no que demuestre la afirmación. La revisión humana de trazas sigue siendo necesaria antes de usar recomendaciones de una ejecución live.

## Reproducir

Desde `data-quality-triage-agent/`:

```bash
python -m pytest -q
python -m evals.run_evals
python -m evals.run_knowledge_evals
python -m evals.run_retrieval_evals
```

El runner imprime las métricas y las escribe junto con el resumen JSON. `pytest` verifica además que Recall@3 alcance el 90% y que todos los criterios configurados pasen en desarrollo.

Para una prueba gestionada, configura `OPENAI_API_KEY`, ejecuta `python -m scripts.create_knowledge_store`, exporta el `OPENAI_VECTOR_STORE_ID` que imprime y lanza el CLI con `--knowledge`. La carga y las consultas live no forman parte de las métricas reportadas aquí.

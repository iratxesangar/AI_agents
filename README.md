# AI Agents

Portfolio y laboratorio de proyectos de agentes IA y automatización. Cada proyecto mantiene su código, dependencias y documentación en una carpeta independiente.

| Proyecto | Carpeta | Estado |
|---|---|---|
| RevisaViajes | [revisaviajes/](revisaviajes/) | Prototipo documental con motor offline y revisión opcional mediante API |
| Radar Data & AI | [radar-data-ai/](radar-data-ai/) | Copia del código del Site privado; herramientas MCP e historial persistente |
| Data Quality Triage Agent | [data-quality-triage-agent/](data-quality-triage-agent/) | Prácticas 1–2: triaje evaluado y agente de investigación documental con citas verificables |

La integración no despliega servicios ni mueve bases de datos o tareas programadas. Consulta [MIGRATION.md](MIGRATION.md) para conocer repositorios, ramas y commits de origen. El historial anterior de los proyectos importados se conserva en sus repositorios originales.

## Validación por proyecto

```bash
(cd revisaviajes && python -m unittest discover -s tests)
(cd radar-data-ai && npm run build && npm run validate)
(cd data-quality-triage-agent && python -m pytest -q && python -m evals.run_evals && python -m evals.run_knowledge_evals && python -m evals.run_retrieval_evals)
```

GitHub Actions mantiene las pruebas de RevisaViajes, valida el artefacto de Radar y ejecuta las suites offline de las prácticas 1 y 2 del agente de calidad. La prueba live del modelo no se ejecuta en CI ni necesita una clave API.

## RevisaViajes: instrucciones de uso

## Inicio recomendado: sin API

```bash
cd revisaviajes
python agent.py examples/local_con_errores.json --local --out revision_local
```

Consulta [el modo local](revisaviajes/LOCAL.md). No requiere clave ni conexión. La API ahora solo se activa con --api explícito.


Proyectos de agentes IA y automatización documental.

## RevisaViajes

Prototipo Python que revisa itinerarios y documentación de reservas, devuelve hallazgos con evidencias y exporta HTML/JSON. Consulta [instalación, ejecución y limitaciones](revisaviajes/README.md).

```bash
cd revisaviajes
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -s tests
python agent.py examples/itinerario.txt --extract-only
```

Windows: activa el entorno con `.venv\Scripts\activate`.

La prueba de extracción es local y no requiere una clave. La revisión IA requiere OPENAI_API_KEY y un modelo habilitado en la cuenta API. No hay despliegue activo.

## Configuración local de la clave

Desde la carpeta `revisaviajes`, introduce la clave mediante entrada oculta:

```bash
python -c "import getpass,os,subprocess,sys; env=os.environ.copy(); env['OPENAI_API_KEY']=getpass.getpass('Clave OpenAI: '); subprocess.run([sys.executable,'agent.py','--api','inputs/itinerario.pdf','--model','TU_MODELO','--out','revision_001'],env=env,check=True)"
```

Sustituye TU_MODELO por un modelo disponible compatible con Responses y Structured Outputs. Crea `inputs` y guarda allí tus documentos. El comando transmite texto a la API y puede generar costes. No guarda la clave en disco. No se cargan archivos .env automáticamente.

## Trabajo con Git

`main` mantiene la versión de referencia. Para cada mejora, crea una rama y abre un pull request. GitHub Actions ejecuta las pruebas locales en Python 3.11 y 3.12, sin claves ni llamadas al modelo.

Los documentos privados se guardan en `inputs/` o `private/`, excluidos de Git. Guarda cualquier informe en `revision_.../`, también excluido. No publiques claves, datos personales o confirmaciones reales. `.gitignore` no elimina archivos que ya estén versionados.

## Estado

Extracción y cinco pruebas locales verificadas. Llamada real al modelo y fiabilidad semántica pendientes de evaluación. Sin licencia de código abierto añadida; elegir licencia antes de ofrecer derechos de reutilización.

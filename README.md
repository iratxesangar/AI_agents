# AI Agents

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
python -c "import getpass,os,subprocess,sys; env=os.environ.copy(); env['OPENAI_API_KEY']=getpass.getpass('Clave OpenAI: '); subprocess.run([sys.executable,'agent.py','inputs/itinerario.pdf','--model','TU_MODELO','--out','revision_001'],env=env,check=True)"
```

Sustituye TU_MODELO por un modelo disponible compatible con Responses y Structured Outputs. Crea `inputs` y guarda allí tus documentos. El comando transmite texto a la API y puede generar costes. No guarda la clave en disco. No se cargan archivos .env automáticamente.

## Trabajo con Git

`main` mantiene la versión de referencia. Para cada mejora, crea una rama y abre un pull request. GitHub Actions ejecuta las pruebas locales en Python 3.11 y 3.12, sin claves ni llamadas al modelo.

Los documentos privados se guardan en `inputs/` o `private/`, excluidos de Git. Guarda cualquier informe en `revision_.../`, también excluido. No publiques claves, datos personales o confirmaciones reales. `.gitignore` no elimina archivos que ya estén versionados.

## Estado

Extracción y cinco pruebas locales verificadas. Llamada real al modelo y fiabilidad semántica pendientes de evaluación. Sin licencia de código abierto añadida; elegir licencia antes de ofrecer derechos de reutilización.

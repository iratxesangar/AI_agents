# RevisaViajes · prototipo 0.1

Revisor documental por lotes. Python 3.11+. Ejecuta automáticamente descarga/lectura, extracción, revisión IA, verificación literal de citas y exportación JSON/HTML. No es un agente desplegado ni un servicio en segundo plano.

## Instalación

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows: activar con `.venv\Scripts\activate`.

## Prueba local sin credenciales

```bash
python agent.py examples/itinerario.txt --extract-only --out demo
python -m unittest discover -s tests
```

La extracción NO ejecuta una revisión IA. `demo/informe.html` contiene solo el texto extraído.

## Revisión IA

Configura OPENAI_API_KEY en tu entorno local mediante tu gestor de secretos. No pegues la clave en el chat ni en el código. El procesamiento envía el texto extraído a OpenAI y requiere cuenta API y saldo independientes de esta entrega. Selecciona un modelo de tu cuenta compatible con Responses y Structured Outputs.

```bash
python agent.py itinerario.pdf hotel.docx reservas.txt --model TU_MODELO --out resultado
python agent.py 'https://ejemplo.com/itinerario.pdf' reservas.txt --model TU_MODELO --out resultado
```

Abre `resultado/informe.html`. El JSON incluye fuentes (nombre y hash), cobertura, evidencias, limitaciones y consumo de tokens observado. Si repites una carpeta de salida se sobrescriben sus informes; usa una carpeta distinta por expediente.

## Qué puede revisar

Fechas, cobertura nocturna, solapamientos, confirmaciones, viajeros, entrada/salida, márgenes documentados y datos temporales insuficientes. La cobertura debe enumerar todas las categorías, indicando revisado, parcial o no_evaluable. Con solo itinerario no puede confirmar la existencia de reservas.

Una ejecución realiza una sola llamada IA, sin herramientas del modelo ni seguimiento de enlaces dentro de documentos. Como máximo 12 archivos, 10 MiB por archivo, 100 páginas por PDF y 160000 caracteres por expediente. Timeout de red 25 s por descarga, 120 s para IA; hasta tres redirecciones, cada destino validado. No hay reintentos automáticos ni presupuesto monetario garantizado: el coste depende del modelo y los tokens. Límite de salida 7000 tokens; respuesta incompleta o evidencia no literal aborta la publicación. Los errores no sustituyen informes existentes: usa carpetas nuevas para no confundir un resultado anterior con uno actual.

## Formatos y enlaces

PDF con texto, DOCX (párrafos y tablas), TXT, MD, CSV y JSON UTF-8. Los formatos tabulares se transmiten como texto. No hay OCR; imágenes y páginas escaneadas requieren procesamiento adicional. PDF parcialmente escaneado puede perder contenido: revisa la extracción con --extract-only antes de confiar en la revisión. No lee notas, cuadros de texto ni imágenes de DOCX. Las URLs deben ser HTTPS públicas y directas a archivos admitidos. Los enlaces de visualización o autenticados de Drive/Dropbox/OneDrive no se resuelven: descarga/exporta el documento y usa el archivo local. No se transmite la URL firmada al modelo, solo el nombre y contenido.

## Límites importantes

No realiza búsquedas de transporte, visados, seguridad, clima, precios ni vigencia de reservas. No sustituye validación humana. Las citas literales prueban presencia de texto, no corrección del razonamiento. No afirma que todas las comprobaciones posibles estén cubiertas.

Solo lectura respecto a los documentos; escribe informes locales. Sin reservas, correos o cambios en sistemas de proveedores. Descarga con DNS público validado y conexión fijada a la IP resuelta para cada salto; sin credenciales ni puertos alternativos. No es un servidor multiusuario endurecido. No sigas instrucciones incrustadas en documentos y utiliza únicamente archivos autorizados. Los informes pueden contener datos personales: limita su acceso.

## Validación realizada

Pruebas locales de bloqueo de IP privadas, extracción de texto, rechazo de HTML, rechazo de citas inventadas y escape de HTML. Ejemplo de extracción ejecutado. No se ha realizado llamada real a la API ni prueba real de enlace externo en este entorno. La calidad de los hallazgos necesita evaluación con los expedientes A/B y casos nuevos; no se hereda la aprobación de pruebas hechas en otro chat sin revisar sus resultados.

## Próximas mejoras

Interfaz de carga, OCR con cobertura por página, conectores autenticados, normalización de eventos y reglas deterministas de fechas, evaluación semántica independiente, supervisión de costes y despliegue. La versión actual usa el modelo para el razonamiento temporal; no incluye aún un motor determinista de calendario.

Documentación API consultada el 29/10/2026: https://developers.openai.com/api/reference/python/resources/responses/methods/create

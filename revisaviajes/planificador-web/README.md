# RevisaViajes local

En macOS o Linux, descomprime el ZIP, abre Terminal en la carpeta extraída y ejecuta `python3 app.py`. En Windows, usa `py -3 app.py`. Requiere Python 3.10 o posterior. Abre http://127.0.0.1:8765 si el navegador no se abre solo. Ctrl+C detiene el servidor. Si el puerto está ocupado, puedes cambiarlo con la variable `REVISA_PORT`.

## Modo guiado

Completa la ficha, escribe un itinerario, guárdalo como versión y acéptalo de forma explícita. Un cambio en la ficha o la ruta anula la aceptación. La ficha, las propuestas y el historial se conservan en el navegador. Si reinicias el servidor, confirma de nuevo antes de buscar servicios. La web responde solo en la interfaz local de tu equipo.

## Planificación automática

1. En [Google AI Studio](https://aistudio.google.com/api-keys), crea una clave de un proyecto en el nivel gratuito, sin cuenta de facturación vinculada.
2. Pon la clave en un archivo de texto llamado `.env` junto a `app.py`. Usa `configuracion.example` como plantilla. El valor de `GEMINI_MODEL` puede cambiar si tu proyecto ofrece otro modelo gratuito.
3. Para investigar la web y comparar servicios, crea además una clave en [Tavily](https://app.tavily.com/) con el plan Researcher y Pay As You Go desactivado. Añade `TAVILY_API_KEY` al mismo archivo.
4. Recarga la web y prueba **Proponer ruta** con un viaje ficticio. Si Gemini genera una propuesta, revísala y guárdala. Acepta la versión para habilitar la búsqueda de servicios si también has configurado Tavily.

El modo guiado funciona sin internet. Los proveedores son opcionales y sus cuotas dependen de la cuenta. La aplicación no cambia planes ni llama a otro proveedor cuando falla una consulta. Gemini recibe los datos del viaje incluidos en su solicitud y Tavily recibe consultas de búsqueda. Evita introducir datos personales o de reservas en la planificación. Las fuentes son extractos públicos consultados y pueden quedar desactualizadas. La búsqueda no da acceso a inventario privado ni realiza reservas.

Las funciones `generate` y `search` son independientes del flujo de edición y aceptación. Esto permite cambiar el modelo o el buscador manteniendo la interfaz local.

## Investigación de destinos por ciclos

Con ambas claves, pulsa **Investigar destino**. Revisa primero turismo oficial, guías y blogs, recursos locales y fragmentos indexados de Instagram o TikTok. Después amplía la búsqueda según las zonas e intereses que falten. El informe agrupa las opciones por zona e interés y conserva los enlaces, los extractos, la fecha de consulta y la fecha de publicación si la devuelve el buscador. Las redes sirven para descubrir ideas y no se reproducen vídeos.

La investigación termina cuando hay una selección suficiente para comparar rutas, después de dos ciclos sin opciones nuevas respaldadas o al llegar a cuatro ciclos para limitar el consumo de la cuota gratuita. Se muestra el motivo en el informe. El botón **Buscar servicios** sigue requiriendo una ruta aceptada.

Para actualizar una instalación anterior, detén el servidor, extrae los archivos sobre la carpeta anterior y vuelve a iniciarlo. Conserva tu archivo `.env` y abre la misma dirección local para recuperar la ficha guardada en tu navegador.

## Comparar rutas

Pulsa **Proponer ruta** para comparar hasta tres opciones con la última investigación de la ficha. Indica el total como `5 días y 4 noches` o con dos fechas en formato `AAAA-MM-DD` para comprobar ambos totales. Si solo indicas uno, el otro queda pendiente. Puedes anotar la hora de llegada, la de salida y el ritmo de viaje. Abre cada opción y selecciona **Elegir esta ruta** para guardarla como nueva versión. Después acéptala explícitamente para habilitar la búsqueda de servicios. Los ajustes de itinerario también pasan por la comprobación de totales.

## Revisar y aceptar la ruta elegida

Al elegir una ruta aparece un resumen junto a la ficha. Puedes confirmar los aspectos que ya te encajan y escribir ajustes en **Comentarios para la ruta**. Las preguntas confirmadas quedan marcadas. Tras elegir una revisión automática solo se reabren los aspectos afectados que identifica el ajuste. El informe del ajuste explica los efectos conocidos y pendientes sobre noches, traslados y presupuesto. Si editas la ruta a mano, se reinicia la revisión.

Pulsa **Aceptar versión** cuando estés conforme. El historial conserva una copia de cada versión aceptada y de sus decisiones. Aceptar habilita la comparación para esa versión y no implica reserva ni disponibilidad.

## Comparar servicios

Pulsa **Buscar servicios** tras aceptar la versión actual. Completa solo los datos que solicite la web. Para fechas exactas se usa el formato `AAAA-MM-DD`. Puedes indicar prioridades y requisitos adicionales junto al botón de búsqueda. Estos datos complementan la ruta aceptada. Si las fechas contradicen su duración, revisa la ruta y acepta la nueva versión.

La comparación agrupa hasta tres opciones por necesidad e indica qué datos figuran en los extractos y cuáles siguen pendientes. Los precios orientativos no entran en el subtotal documentado. Las búsquedas son de fuentes públicas y no comprueban inventario en tiempo real. Cualquier cambio de ruta sugerido requiere tu revisión y aceptación.

## Conversación guiada

El agente muestra la etapa actual y el siguiente paso según la ficha y las decisiones guardadas. Puedes contestar sus preguntas una a una o editar directamente la ficha. Si ya has rellenado un campo, el agente pasa al siguiente. La investigación y la comparación requieren tu acción, y los servicios solo se buscan para la versión aceptada.

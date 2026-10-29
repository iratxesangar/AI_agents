# RevisaViajes local · sin API

Desde la carpeta revisaviajes:

```bash
python agent.py examples/local_con_errores.json --local --out revision_local
python agent.py examples/local_correcto.json --local --out revision_correcta
python -m unittest discover -s tests
```

Abre revision_local/informe.html. El primer caso genera cuatro hallazgos: fecha contradictoria, noche sin cobertura, solapamiento y confirmación pendiente. El segundo genera cero. Son fixtures nuevos, no una ejecución de los expedientes A/B completos.

Este modo no usa red ni requiere instalar dependencias externas. Python 3.11+ es suficiente. La ejecución sin --api y sin --extract-only también usa este modo: una variable OPENAI_MODEL o una clave presente no lo activa. --api autoriza explícitamente el modo de pago existente. --local y --api son incompatibles.

## Introducir un viaje

Copia examples/local_correcto.json a inputs/mi_viaje.json (crea inputs si no existe). Cambia los datos y ejecuta:

```bash
python agent.py inputs/mi_viaje.json --local --out revision_mi_viaje
```

Formato JSON:

- trip.start y trip.end: fechas YYYY-MM-DD de inicio y fin. La noche de la fecha final no se incluye.
- hotels: lista de alojamientos. id único, check_in/check_out como fechas; confirmed true si consta confirmación, false/null si no consta. planned_start opcional para comparar entrada prevista con la documentada.
- events: lista de actividades/traslados. id único, start/end ISO con offset UTC explícito (+01:00, +02:00, etc.). end puede faltar: se informa de la limitación. confirmed como en hoteles. planned_start opcional para contrastar inicio previsto/documentado.
- Para un traslado: end es llegada prevista, must_arrive_by es hora del vuelo u otro objetivo, required_margin_minutes es antelación exigida DOCUMENTADA en minutos. No inventar este requisito. Si falta, se marca no evaluable.

Las referencias de cada alerta son JSON pointers al propio expediente. No equivalen a citas verificadas de documentos originales. Transcribe los datos tú o pide ayuda en el chat con documentos autorizados y revisa el JSON antes de ejecutarlo.

Al principio usa un mismo conjunto de viajeros. Los solapamientos detectan intervalos simultáneos, pero pueden ser intencionados: requiere revisión humana. Los hoteles cubren fechas locales; no se modelan vuelos nocturnos, fechas internacionales, traslados entre actividades, disponibilidad en vivo ni reglas de check-in. No hay interpretación automática de texto, PDF o enlaces en este modo. Usa --extract-only para extraer documentos por separado; no se convierten automáticamente en eventos.

No encontrar alertas no demuestra que el viaje esté validado. El modo de pago anterior sigue disponible solo con --api; no lo necesitas para trabajar aquí.

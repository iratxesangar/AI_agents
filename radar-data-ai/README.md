# Código del Radar Data & AI

Esta carpeta contiene la copia del código fuente del Site privado activo, versión 6, capturada del commit `48cb07d7a779006c9eb07ed7c3e1ef47a6951b1d`.

## Archivos

- `worker/index.js`: interfaz web, API y herramientas MCP de búsqueda, puntuación, deduplicación e historial.
- `.openai/hosting.json`: identificador del Site, binding D1 y capacidad MCP.
- `drizzle/0000_offer_history.sql` y `drizzle/meta/_journal.json`: esquema y migración de la tabla de ofertas.
- `scripts/build.sh` y `scripts/validate-artifact.mjs`: generación y validación del artefacto del Worker.
- `package.json`: comandos disponibles.

## Desarrollo

Modifica `worker/index.js`. Para generar y validar localmente desde esta carpeta:

```sh
npm run build
npm run validate
```

El panel incluye las ofertas persistidas aunque no tengan el campo interno `type`, calcula pendientes desde el estado y los datos salariales, y reconoce candidaturas rechazadas como registros de solicitud.

La configuración del manifiesto está vinculada al Site existente. No cambies su `project_id` para trabajar en la copia actual.

## Qué no está en esta carpeta

La base de datos D1 de producción —incluido el historial de ofertas y candidaturas— y la tarea horaria de ChatGPT se mantienen fuera de GitHub. No guardes aquí Excel, exportaciones personales, tokens ni secretos.

El código es una copia de seguridad, no un despliegue independiente. Para ejecutarlo fuera de ChatGPT Sites habría que provisionar alojamiento, una base D1, acceso privado, la conexión MCP y una tarea recurrente nueva.

## Demo de clasificación reproducible

Ejecuta `node --test scripts/score.test.mjs` desde esta carpeta. Los casos
sintéticos llaman a la herramienta MCP real `score_job_offer` sin base de datos.

| Entrada de ejemplo | Clasificación |
|---|---|
| Salario publicado de 52.000 € | Excluir |
| Salario publicado entre 52.000 € y 60.000 € | Por confirmar |
| Estimación de 42.000 € a 50.000 € con `salary_published: false` | Por confirmar |
| Híbrido internacional con tres días en oficina | Excluir |
| Híbrido internacional sin frecuencia documentada | Por confirmar |

La herramienta clasifica los datos de entrada. La etiqueta `verificada` indica
que pasan las reglas de clasificación. La fuente, vigencia y condiciones de la
vacante se comprueban en el proceso de búsqueda.

### Configuración privada y acceso

Configura `RADAR_SALARY_BANDS` como variable privada del Site si necesitas
bandas salariales por familia. Acepta un objeto JSON que mapea el nombre exacto
de cada familia a `[mínimo, máximo]` en euros brutos anuales. Sin la variable,
el Radar mantiene el umbral general y omite la comparación por familia.
Las bandas configuradas se muestran a quienes tengan acceso al Radar.

El Worker depende del control de acceso de Sites para la página, la API y MCP.
Un despliegue independiente necesita aplicar su propio control de acceso a
todas esas rutas antes de conectar una base con datos reales.

Configura también `RADAR_PRIVATE_PROFILE` como secreto del Site. Acepta
`display_name`, `location` y `salary_current_eur`. El nombre se usa para
el saludo y el perfil privado MCP conserva la ubicación y el salario actual.

## Reglas de búsqueda y prioridad

Los ejemplos suponen una oferta relevante y comprobada en su fuente, salvo
donde se indique otra cosa. La tarea debe comprobar la vigencia antes de guardar
y conservar la evidencia de elegibilidad en `eligibility_evidence`. El
clasificador evalúa las condiciones recibidas y el contador web aplica su misma
regla de prioridad a las ofertas con datos estructurados.

| Entrada | Salida |
|---|---|
| Abierta, remota desde España y 65.000 € publicados | Verificada y prioritaria. |
| Abierta, relevante y sin sueldo publicado | Se conserva. Salario no confirmado. |
| Banda publicada de 52.000–60.000 € | Se conserva la banda. Objetivo por confirmar. |
| Sueldo publicado de 52.000 € | Se excluye de los resultados de búsqueda. |
| Sueldo publicado de 55.000 € | Alcanza el umbral y se admite. La prioridad exige un mínimo publicado estrictamente superior a 55.000 €. |
| «Remote within Europe», sin confirmación para España | Elegibilidad pendiente. Se conserva la frase original. |
| Híbrida en Francia, tres días presenciales | Excluir. |
| Híbrida en Francia, dos días presenciales y elegibilidad confirmada | Se puede admitir. Conservar ubicación y frecuencia. |
| Vacante cerrada con candidatura anterior | Excluir de las nuevas y conservar la fila y la candidatura histórica. |
| La misma vacante reaparece tras un rechazo | Conservar «Rechazado» y la fecha original. Añadir fuentes verificadas. |

### Identidad y demo reproducible

Usa `requisition_source` con el ámbito estable del ATS y la cuenta de empresa,
y `requisition_id` con el identificador original. Si falta esa pareja, usa una
URL específica de la vacante. Se eliminan los parámetros de seguimiento
conocidos y se conservan los funcionales, como `jobId`. Empresa y título
coincidentes se devuelven como posibles duplicados. Dos IDs distintos se
mantienen separados. Si no hay identidad comprobable, conserva el `offer_id`
devuelto para los reintentos y solicita revisión antes de unificar registros.

Los registros históricos conservan su clave y se vinculan si existe una
coincidencia verificable. Los datos de dos vacantes que ya se hubieran
fusionado requieren revisar sus fuentes originales.

Con Node.js 22, desde esta carpeta:

```sh
node --test scripts/identity.test.mjs
```

La demo utiliza SQLite en memoria, el esquema de `offers` y las rutas MCP.
Parte de una candidatura rechazada. La primera ejecución crea una vacante y
deja dos vacantes en total, dos fuentes para la republicada y el rechazo
intacto. La segunda ejecución crea cero vacantes. `saved_count` cuenta
operaciones aceptadas, mientras que `created_count` cuenta vacantes nuevas.

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

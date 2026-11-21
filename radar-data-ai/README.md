# Radar Data & AI

Radar de vacantes con directorio de empresas, registro de búsquedas, revisión
de enlaces, seguimiento de candidaturas y ranking. El Worker comparte la
lógica de identidad y persistencia entre la web y MCP.

El repositorio usa un manifiesto local sin identificadores de producción.
La instancia alojada tiene su propio manifiesto, control de acceso, base de
datos y variables privadas. `RADAR_PRIVATE_PROFILE` configura el perfil y
`RADAR_SALARY_BANDS` las bandas por familia. Las pruebas usan exclusivamente
datos ficticios. Para ejecutarlas, usa Node.js 22 o posterior:

```sh
node --test tests/*.mjs
node scripts/demo-radar.mjs
npm run build
npm run validate
```

## Revisar el histórico de vacantes

Genera una copia SQLite de la base antes de revisar registros históricos. Con
Node.js 22 o posterior, ejecuta `node scripts/audit-history.mjs copia.sqlite`.
La auditoría es de solo lectura y señala coincidencias dudosas y filas
antiguas cuyas fuentes requieren revisión. La identidad de una fila previamente
consolidada solo puede reconstruirse con evidencia de sus fichas originales.

En Resultados, «Coincidencias para revisar» muestra los motivos y enlaces.
Confirmar una coincidencia conserva el identificador de la candidatura cuando
existe, reúne las fuentes y archiva la segunda fila con su identificador.
Las requisiciones incompatibles y los historiales de candidatura en conflicto
bloquean la unión. La auditoría de una copia no cambia el histórico publicado.

Ejecuta `node --test tests/*.mjs` para probar la deduplicación, la confirmación
manual, la reapertura, el histórico legado y los reintentos.

## Demo reproducible del Radar

Con Node.js 22 o posterior, ejecuta `node scripts/demo-radar.mjs`. El script
llama al Worker por sus rutas HTTP y MCP y usa dos bases SQLite en memoria.
Funciona sin credenciales, acceso a portales ni conexión al Radar publicado.

### Entrada y resultados

La prueba copia una vacante histórica con candidatura rechazada y su fecha
original. El lote contiene esa vacante, su republicación en otro portal con
la misma requisición, doce vacantes homónimas con requisiciones distintas y
una vacante con evidencia insuficiente. Una de las escrituras falla a propósito.

| Etapa | Nuevas | Actualizadas | Errores |
| --- | ---: | ---: | ---: |
| Primera ejecución | 11 | 1 | 1 |
| Primera ejecución después de reintentar solo el guardado | 12 | 1 | 0 |
| Segunda ejecución con el mismo lote | 0 | 13 | 0 |

Al cargar la copia histórica se mantiene el recuento de **1 vacante y 1
candidatura**. Al terminar hay **13 vacantes y 1 candidatura**. El total de
la base coincide con las 12 altas confirmadas más la vacante original.
La republicación suma una fuente y cuenta como un duplicado del lote.
Las requisiciones distintas conservan su propia fila. El rechazo y su fecha
sobreviven al ciclo programado y a la reimportación. La vacante con salario,
modalidad y elegibilidad sin confirmar queda pendiente.

Para evaluar el ranking, la prueba etiqueta tres vacantes ficticias como
prioritarias. Dos aparecen entre las diez primeras (**20 % del top 10** y
**2 de las 3 prioritarias recuperadas**). Las etiquetas son una referencia
sintética para comprobar el cálculo. Los pesos siguen pendientes de una
comparación con preferencias reales.

### Prueba de interfaz

Con `jsdom` accesible para Node, ejecuta `node scripts/demo-radar.mjs --dom`.
La opción carga el HTML y ejecuta el JavaScript de la página contra el mismo
Worker de prueba. Comprueba ranking, edición de candidatura, persistencia
al recargar, directorio de Empresas y enlaces pendientes. La simulación del
DOM cubre la interacción y el transporte HTTP del Worker. El diseño visual
en un navegador real se comprueba por separado.

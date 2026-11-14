# Dataset sintético `orders_daily.csv`

El archivo contiene 10 registros de pedidos de ejemplo. Los datos son inventados y se incluyen problemas deliberados para probar el agente:

| Problema | Fila(s) de datos | Campo(s) | Detalle |
| --- | --- | --- | --- |
| Valor nulo | 2 (`order_id=1002`) | `amount` | Importe vacío. |
| Valor nulo | 5 (`order_id=1005`) | `status` | Estado vacío. |
| Valor nulo | 10 (`order_id=1009`) | `customer_id` | Identificador de cliente vacío. |
| Duplicado exacto | 4 y 9 (`order_id=1004`) | Todos los campos | La fila completa aparece dos veces: `1004,C-04,42.75,paid`. |

La numeración de filas cuenta solo registros de datos; no incluye la cabecera. Por tanto, el CSV tiene tres celdas vacías y una fila duplicada redundante (nueve registros únicos). El dataset no contiene información real.

## Fixtures para las pruebas de funcionamiento

- `orders_daily_clean.csv`: 3 filas sin nulos ni duplicados exactos.
- `orders_daily_quality_issues.csv`: 8 filas, con 3 celdas nulas (`amount`, `status`, `customer_id`) y 2 filas duplicadas exactas, identificadas por `order_id` 1004 y 1003.

El segundo fixture se describe como “2 filas duplicadas exactas” porque la herramienta compara todos los campos de cada registro; no considera duplicados dos filas que solo compartan el identificador y difieran en otros valores.

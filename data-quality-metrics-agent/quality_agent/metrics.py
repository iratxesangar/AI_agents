"""Herramienta de métricas CSV de solo lectura.

La interfaz solo abre archivos en modo ``r``. No se exportan funciones para
escribir, reparar, borrar o actualizar datasets.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Sequence


def _error(code: str, message: str) -> dict[str, Any]:
    return {
        "total_rows": 0,
        "nulls_by_column": {},
        "duplicate_rows": 0,
        "duplicate_ids": [],
        "status": "error",
        "error": {"code": code, "message": message},
    }


def inspect_dataset(
    path: str | Path,
    key_columns: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Calcula recuentos y porcentajes de nulos y filas duplicadas.

    ``duplicate_rows`` cuenta las apariciones redundantes posteriores a la
    primera de cada fila completa. ``duplicate_ids`` incluye los valores de
    las columnas clave para esas filas, cuando se pueden identificar.
    Las celdas vacías o compuestas solo por espacios se consideran nulas.
    Ante entradas inválidas o CSV mal formado se devuelve ``status=error``.
    """
    if not isinstance(path, (str, Path)) or not str(path).strip():
        return _error("invalid_path", "La ruta debe ser una cadena o Path no vacía.")
    if key_columns is not None:
        if isinstance(key_columns, (str, bytes)) or not isinstance(key_columns, Sequence):
            return _error("invalid_key_columns", "key_columns debe ser una secuencia de nombres de columna.")
        if any(not isinstance(name, str) or not name.strip() for name in key_columns):
            return _error("invalid_key_columns", "Cada columna clave debe tener un nombre no vacío.")
        if len(set(key_columns)) != len(key_columns):
            return _error("invalid_key_columns", "key_columns no puede contener nombres repetidos.")

    dataset_path = Path(path)
    try:
        with dataset_path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream)
            header = next(reader, None)
            if not header:
                return _error("empty_csv", "El CSV está vacío o no contiene encabezados.")
            if any(not name.strip() for name in header):
                return _error("invalid_header", "El CSV contiene un encabezado vacío.")
            if len(set(header)) != len(header):
                return _error("duplicate_headers", "El CSV contiene nombres de columna repetidos.")

            rows: list[tuple[str, ...]] = []
            for line_number, values in enumerate(reader, start=2):
                if not values:
                    continue
                if len(values) != len(header):
                    return _error(
                        "malformed_row",
                        f"La fila física {line_number} tiene {len(values)} campos; se esperaban {len(header)}.",
                    )
                rows.append(tuple(values))
    except FileNotFoundError:
        return _error("file_not_found", f"No existe el archivo: {dataset_path.name}")
    except IsADirectoryError:
        return _error("not_a_file", "La ruta apunta a un directorio, no a un archivo CSV.")
    except (OSError, UnicodeError, csv.Error) as exc:
        return _error("read_error", f"No se pudo leer un CSV válido: {exc}")
    except (TypeError, ValueError) as exc:
        return _error("invalid_path", f"La ruta no es válida: {exc}")

    if key_columns is None:
        # Detecta convenciones comunes cuando están disponibles; el análisis
        # de filas duplicadas sigue funcionando aunque no haya identificador.
        keys = next(([candidate] for candidate in ("order_id", "id", "record_id") if candidate in header), [])
    else:
        missing_keys = [name for name in key_columns if name not in header]
        if missing_keys:
            return _error("unknown_key_column", f"No existen columnas clave: {', '.join(missing_keys)}")
        keys = list(key_columns)

    index = {name: i for i, name in enumerate(header)}
    row_count = len(rows)
    nulls_by_column = {
        column: {
            "count": sum(1 for row in rows if not row[index[column]].strip()),
            "percentage": round(
                100 * sum(1 for row in rows if not row[index[column]].strip()) / row_count,
                2,
            ) if row_count else 0.0,
        }
        for column in header
    }

    seen: set[tuple[str, ...]] = set()
    duplicate_rows = 0
    duplicate_ids: list[Any] = []
    for row in rows:
        if row in seen:
            duplicate_rows += 1
            if keys:
                identifier_values = tuple(row[index[name]] for name in keys)
                identifier: Any = identifier_values[0] if len(identifier_values) == 1 else dict(zip(keys, identifier_values))
                if identifier not in duplicate_ids:
                    duplicate_ids.append(identifier)
        else:
            seen.add(row)

    null_key_counts = {
        key: nulls_by_column[key]["count"]
        for key in keys
    }
    return {
        "total_rows": row_count,
        "nulls_by_column": nulls_by_column,
        "duplicate_rows": duplicate_rows,
        "duplicate_ids": duplicate_ids,
        "status": "ok",
        "dataset": dataset_path.stem,
        "columns": header,
        "key_columns": keys,
        "null_key_counts": null_key_counts,
    }

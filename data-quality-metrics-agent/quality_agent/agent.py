"""Política del agente: selección de herramienta, síntesis y límites de alcance."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .metrics import inspect_dataset


MUTATION_TERMS = re.compile(r"\b(borra|elimina|eliminar|borra|completa|rellena|imputa|corrige|modifica|actualiza|arregla|deduplica|sobrescribe|write|delete|update|fix|repair)\b", re.I)
QUALITY_TERMS = re.compile(r"\b(calidad|nulos?|vac[ií]os?|duplicad[oa]s?|m[eé]tricas?|integridad|orders_daily|dataset)\b", re.I)
UNSUPPORTED_METRIC_TERMS = re.compile(r"\b(freshness|frescura|sla|latencia|duraci[oó]n|tiempo de ejecuci[oó]n|volumen|drift|deriva|distribuci[oó]n|accuracy|precisi[oó]n|anomal[ií]as?)\b", re.I)


class QualityAgent:
    """Agente determinista y local que delega las mediciones en una herramienta."""

    def __init__(self, dataset_path: str | Path):
        self.dataset_path = Path(dataset_path)

    def run(self, question: str) -> dict[str, Any]:
        if MUTATION_TERMS.search(question):
            return {
                "status": "refused",
                "severity": None,
                "summary": "No puedo modificar, borrar, completar ni reparar datos.",
                "findings": [],
                "possible_causes": [],
                "recommended_action": "Como alternativa segura, puedo consultar métricas de nulos y filas duplicadas y describir un procedimiento para que una persona lo revise y aplique manualmente. No he realizado cambios.",
                "tool_used": None,
            }
        unsupported = sorted({term.lower() for term in UNSUPPORTED_METRIC_TERMS.findall(question)})
        if unsupported:
            return {
                "status": "out_of_scope",
                "severity": None,
                "summary": f"No puedo calcular estas métricas con la herramienta disponible: {', '.join(unsupported)}.",
                "findings": [],
                "possible_causes": [],
                "recommended_action": "La herramienta solo mide valores nulos y filas duplicadas exactas. Puedo consultar esas métricas o puedes aportar una fuente autorizada para las métricas solicitadas.",
                "tool_used": None,
            }
        if not QUALITY_TERMS.search(question):
            return {
                "status": "out_of_scope",
                "severity": None,
                "summary": "La solicitud no trata sobre métricas de calidad de datos.",
                "findings": [],
                "possible_causes": [],
                "recommended_action": "La herramienta puede consultar valores nulos y filas duplicadas exactas. Formula una pregunta sobre esas métricas.",
                "tool_used": None,
            }

        metrics = inspect_dataset(self.dataset_path)
        if metrics["status"] != "ok":
            error = metrics.get("error", {})
            return {
                "status": "refused",
                "severity": None,
                "summary": "No pude obtener métricas fiables del dataset.",
                "findings": [{"claim": error.get("message", "Error al analizar el dataset."), "evidence": [f"error_code={error.get('code', 'unknown')}"]}],
                "possible_causes": [],
                "recommended_action": "Revisa el formato y la ruta del CSV antes de volver a ejecutar la inspección.",
                "tool_used": "inspect_dataset",
            }

        total = metrics["total_rows"]
        null_columns = {
            col: values["count"]
            for col, values in metrics["nulls_by_column"].items()
            if values["count"]
        }
        duplicate_count = metrics["duplicate_rows"]
        null_keys = {col: count for col, count in metrics["null_key_counts"].items() if count}
        findings: list[dict[str, Any]] = []
        if null_columns:
            detail = ", ".join(f"{col}: {count}" for col, count in null_columns.items())
            percentages = {col: metrics["nulls_by_column"][col]["percentage"] for col in null_columns}
            findings.append({"claim": f"Se detectaron {sum(null_columns.values())} valores nulos; desglose: {detail}.", "evidence": [f"null_counts={null_columns}", f"null_percentages={percentages}", f"total_rows={total}"]})
        else:
            findings.append({"claim": "No se detectaron valores nulos en las columnas revisadas.", "evidence": [f"nulls_by_column={metrics['nulls_by_column']}"]})
        if duplicate_count:
            findings.append({"claim": f"Se detectaron {duplicate_count} fila(s) duplicada(s) exacta(s).", "evidence": [f"duplicate_rows={duplicate_count}", f"duplicate_ids={metrics['duplicate_ids']}"]})
        else:
            findings.append({"claim": "No se detectaron filas duplicadas exactas.", "evidence": ["duplicate_count=0"]})

        # Son posibilidades para investigar; las métricas por sí solas no
        # prueban la causa raíz.
        possible_causes = []
        if null_columns:
            possible_causes.append({
                "hypothesis": "Los campos vacíos podrían originarse en la captura, una fuente upstream o una transformación previa.",
                "status": "not_verified",
            })
        if duplicate_count:
            possible_causes.append({
                "hypothesis": "Las filas repetidas podrían deberse a reintentos de ingesta o a duplicidad en el origen.",
                "status": "not_verified",
            })

        if null_keys or (total and duplicate_count / total >= 0.20):
            severity = "P1"
        elif null_columns or duplicate_count:
            severity = "P2"
        else:
            severity = "P3"

        if null_columns or duplicate_count:
            actions = []
            if null_columns:
                actions.append("rastrear el origen de los nulos y acordar una regla de validación o tratamiento con el responsable del dato")
            if duplicate_count:
                actions.append("contrastar las filas repetidas con la clave de negocio y definir una regla de deduplicación revisada por una persona")
            recommended = "Como siguiente paso, " + "; además, ".join(actions) + ". Son propuestas para revisión manual; no he realizado cambios."
            summary = f"{metrics['dataset']}: {sum(null_columns.values())} valor(es) nulo(s) y {duplicate_count} fila(s) duplicada(s) en {total} registros."
        else:
            recommended = "Mantén las validaciones de calidad y revisa las métricas en la siguiente ejecución."
            summary = f"{metrics['dataset']}: no se encontraron nulos ni duplicados exactos en {total} registros."

        return {
            "status": "grounded_answer",
            "severity": severity,
            "summary": summary,
            "findings": findings,
            "possible_causes": possible_causes,
            "recommended_action": recommended,
            "tool_used": "inspect_dataset",
        }

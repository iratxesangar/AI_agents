"""Herramientas locales estrictamente de solo lectura para el prototipo."""
import json
from pathlib import Path
from typing import Any

_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "sample_data.json"


def _read_fixture(dataset_id: str) -> dict[str, Any]:
    """Carga una instantánea sintética; esta función nunca escribe en disco."""
    with _FIXTURE_PATH.open("r", encoding="utf-8") as fixture_file:
        datasets = json.load(fixture_file)
    if dataset_id not in datasets:
        raise KeyError(f"Dataset desconocido: {dataset_id}")
    return datasets[dataset_id]


def read_dataset_metadata(dataset_id: str) -> dict[str, Any]:
    """Devuelve criticidad, tier, owner, SLA y consumidores permitidos."""
    dataset = _read_fixture(dataset_id)
    return dict(dataset["metadata"])


def read_quality_metrics(dataset_id: str) -> dict[str, Any]:
    """Devuelve métricas sintéticas de calidad, sin modificar el dataset."""
    dataset = _read_fixture(dataset_id)
    return dict(dataset["quality_metrics"])


def read_freshness_status(dataset_id: str) -> dict[str, Any]:
    """Devuelve retraso y SLA de frescura, sin modificar el dataset."""
    dataset = _read_fixture(dataset_id)
    return dict(dataset["freshness"])


def read_recent_deployments(
    dataset_id: str,
    lookback_hours: int = 6,
) -> dict[str, Any]:
    """Consulta despliegues recientes del fixture; no inicia ni revierte despliegues."""
    if lookback_hours <= 0:
        raise ValueError("lookback_hours debe ser positivo")
    dataset = _read_fixture(dataset_id)
    deployments = [
        item
        for item in dataset.get("recent_deployments", [])
        if item.get("hours_ago", lookback_hours + 1) <= lookback_hours
    ]
    return {
        "lookback_hours": lookback_hours,
        "deployments": deployments,
        "checked": True,
    }


READ_ONLY_TOOLS = {
    "read_dataset_metadata": read_dataset_metadata,
    "read_quality_metrics": read_quality_metrics,
    "read_freshness_status": read_freshness_status,
    "read_recent_deployments": read_recent_deployments,
}

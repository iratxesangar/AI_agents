"""Interfaz de línea de comandos."""

import argparse
import json
from pathlib import Path

from .agent import QualityAgent


DEFAULT_DATASET = Path(__file__).resolve().parent.parent / "data" / "orders_daily.csv"


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnostica nulos y duplicados sin modificar datos.")
    parser.add_argument("--question", required=True, help="Pregunta o instrucción para el agente")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Ruta al CSV de solo lectura")
    args = parser.parse_args()
    print(json.dumps(QualityAgent(args.dataset).run(args.question), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

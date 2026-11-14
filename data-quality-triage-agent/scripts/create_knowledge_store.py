"""Crea un OpenAI Vector Store y sube el corpus Markdown sintético.

Ejecutar desde la carpeta del proyecto con:
    python -m scripts.create_knowledge_store
"""
import os
import sys
import time
from pathlib import Path

from app.knowledge import KNOWLEDGE_DIR, load_knowledge_documents, vector_store_attributes


def main() -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        print("Falta OPENAI_API_KEY.", file=sys.stderr)
        return 2
    try:
        from openai import OpenAI
    except ImportError:
        print("Instala las dependencias con: python -m pip install -r requirements.txt", file=sys.stderr)
        return 2

    documents = load_knowledge_documents()
    client = OpenAI()
    store = client.vector_stores.create(name="data-quality-triage-practice-2")
    print(f"Vector Store creado: {store.id}")
    for document in documents:
        path = KNOWLEDGE_DIR / document["uri"]
        with path.open("rb") as markdown_file:
            uploaded = client.files.create(file=markdown_file, purpose="assistants")
        attached = client.vector_stores.files.create(
            vector_store_id=store.id,
            file_id=uploaded.id,
            attributes=vector_store_attributes(document),
        )
        deadline = time.monotonic() + 180
        while attached.status in {"in_progress", "queued"}:
            if time.monotonic() > deadline:
                raise TimeoutError(f"Timeout al indexar {document['uri']}")
            time.sleep(2)
            attached = client.vector_stores.files.retrieve(
                vector_store_id=store.id,
                file_id=uploaded.id,
            )
        if attached.status != "completed":
            raise RuntimeError(
                f"Indexación fallida para {document['uri']}: {attached.status} "
                f"({getattr(attached, 'last_error', None)})"
            )
        print(f"Indexado: {document['uri']}")

    print("Carga completa. Configura el ID en tu shell:")
    print(f"export OPENAI_VECTOR_STORE_ID={store.id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

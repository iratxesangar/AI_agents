"""Recuperación documental local, determinista y trazable para incidencias.

El prototipo evita depender de un proveedor de embeddings para que las pruebas
sean reproducibles. Cada sección Markdown se indexa como un fragmento y la
clasificación léxica devuelve su identificador de fuente exacto.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable

from app.schemas import RetrievedChunk


DEFAULT_KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
_FRONT_MATTER_SEPARATOR = "---"
_HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)
_TOKEN_RE = re.compile(r"[\wáéíóúüñ]+", re.IGNORECASE)
_STOPWORDS = {
    "a", "al", "and", "con", "de", "del", "el", "en", "for", "la", "las",
    "los", "of", "on", "para", "por", "the", "un", "una", "y",
}


def _slugify(value: str) -> str:
    tokens = _TOKEN_RE.findall(value.casefold())
    return "-".join(tokens) or "overview"


def _tokens(value: str) -> set[str]:
    return {
        token.casefold()
        for token in _TOKEN_RE.findall(value)
        if len(token) > 1 and token.casefold() not in _STOPWORDS
    }


def _parse_scalar(value: str) -> Any:
    cleaned = value.strip()
    if cleaned.casefold() in {"true", "false"}:
        return cleaned.casefold() == "true"
    if "," in cleaned:
        return [item.strip() for item in cleaned.split(",") if item.strip()]
    return cleaned


def _parse_document(path: Path, root: Path) -> tuple[dict[str, Any], str]:
    """Lee un Markdown con front matter YAML deliberadamente mínimo."""
    raw = path.read_text(encoding="utf-8")
    metadata: dict[str, Any] = {}
    body = raw
    if raw.startswith(_FRONT_MATTER_SEPARATOR):
        parts = raw.split(_FRONT_MATTER_SEPARATOR, 2)
        if len(parts) == 3:
            _, front_matter, body = parts
            for line in front_matter.splitlines():
                if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
                    continue
                key, value = line.split(":", 1)
                metadata[key.strip()] = _parse_scalar(value)

    relative_path = path.relative_to(root).as_posix()
    metadata.setdefault("document_id", relative_path)
    metadata.setdefault("title", path.stem.replace("_", " ").title())
    metadata.setdefault("dataset", "all")
    metadata.setdefault("environment", "all")
    metadata.setdefault("status", "active")
    metadata.setdefault("trusted", True)
    return metadata, body.strip()


def _document_chunks(path: Path, root: Path) -> list[RetrievedChunk]:
    metadata, body = _parse_document(path, root)
    source_document = str(metadata["document_id"])
    title = str(metadata["title"])
    headings = list(_HEADING_RE.finditer(body))
    sections: list[tuple[str, str]] = []

    if not headings:
        sections.append(("overview", body))
    else:
        preamble = body[: headings[0].start()].strip()
        if preamble:
            sections.append(("overview", preamble))
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
            section_title = heading.group(1).strip()
            content = body[heading.end() : end].strip()
            if content:
                sections.append((_slugify(section_title), content))

    return [
        RetrievedChunk(
            source_id=f"{source_document}#{section_id}",
            document_id=source_document,
            title=title,
            content=content,
            score=0,
            metadata=dict(metadata),
        )
        for section_id, content in sections
    ]


def load_knowledge(root: Path = DEFAULT_KNOWLEDGE_DIR) -> list[RetrievedChunk]:
    """Carga todos los documentos locales y conserva IDs de cita estables."""
    if not root.exists():
        return []
    chunks: list[RetrievedChunk] = []
    for document in sorted(root.rglob("*.md")):
        chunks.extend(_document_chunks(document, root))
    return chunks


def _matches_filter(value: Any, requested: str | None) -> bool:
    if not requested:
        return True
    values = value if isinstance(value, list) else [value]
    normalized = {str(item).casefold() for item in values}
    return "all" in normalized or requested.casefold() in normalized


def _score_chunk(chunk: RetrievedChunk, query_tokens: set[str], dataset_id: str | None) -> float:
    haystack = _tokens(f"{chunk.title} {chunk.content}")
    overlap = len(query_tokens & haystack)
    if not overlap:
        return 0.0
    title_overlap = len(query_tokens & _tokens(chunk.title))
    document_overlap = len(query_tokens & _tokens(chunk.document_id))
    dataset_bonus = 2 if dataset_id and _matches_filter(chunk.metadata.get("dataset"), dataset_id) else 0
    return float(overlap + 0.5 * title_overlap + 0.5 * document_overlap + dataset_bonus)


def search_knowledge(
    query: str,
    *,
    dataset_id: str | None = None,
    environment: str | None = None,
    max_results: int = 8,
    root: Path = DEFAULT_KNOWLEDGE_DIR,
    include_untrusted: bool = False,
) -> list[RetrievedChunk]:
    """Busca fragmentos activos y confiables, con filtros de dataset/entorno.

    `include_untrusted` existe solo para pruebas explícitas de seguridad. El flujo
    del agente siempre conserva el valor predeterminado (`False`).
    """
    if max_results < 1:
        raise ValueError("max_results debe ser al menos 1")
    query_tokens = _tokens(query)
    ranked: list[RetrievedChunk] = []
    for chunk in load_knowledge(root):
        metadata = chunk.metadata
        if str(metadata.get("status", "active")).casefold() != "active":
            continue
        if not include_untrusted and metadata.get("trusted") is not True:
            continue
        if not _matches_filter(metadata.get("dataset"), dataset_id):
            continue
        if not _matches_filter(metadata.get("environment"), environment):
            continue
        score = _score_chunk(chunk, query_tokens, dataset_id)
        if score > 0:
            ranked.append(chunk.model_copy(update={"score": score}))

    return sorted(ranked, key=lambda item: (-item.score, item.source_id))[:max_results]


def cited_source_ids(chunks: Iterable[RetrievedChunk]) -> set[str]:
    """Devuelve los únicos identificadores que un resultado puede citar."""
    return {chunk.source_id for chunk in chunks}

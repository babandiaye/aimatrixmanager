"""
RAG retrieval pour le bot — embedde une question utilisateur via fromager
puis cherche les chunks les plus pertinents du cours dans pgvector.

Le résultat est formatté en bloc texte injectable dans le system prompt.
"""
import logging
import os
from typing import Optional

import httpx

import db

log = logging.getLogger("aibotmanager.rag")

EMBED_MODEL = "nomic-embed-text:latest"
TOP_K = 5
# Distance cosine au-delà de laquelle un chunk est considéré non pertinent.
# 0 = identique, 1 = orthogonal, 2 = opposé. nomic-embed-text donne des
# distances ~0.3-0.5 pour des matches solides, >0.7 pour du bruit.
RELEVANCE_THRESHOLD = 0.65


async def embed_query(text: str) -> Optional[list[float]]:
    """Embed une question utilisateur via fromager. Retourne None en cas
    d'erreur (le bot répondra alors sans RAG plutôt que de planter)."""
    base_url = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    api_key = os.environ.get("OLLAMA_API_KEY", "")
    if not base_url or not api_key:
        log.warning("OLLAMA_BASE_URL / API_KEY absents — RAG désactivé")
        return None

    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(
                f"{base_url}/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": EMBED_MODEL, "input": text},
            )
            r.raise_for_status()
            data = r.json()
            return data["data"][0]["embedding"]
    except Exception as e:
        log.warning(f"embed_query failed: {e}")
        return None


async def retrieve_context(
    course_db_id: str,
    question: str,
    k: int = TOP_K,
) -> Optional[str]:
    """Pipeline RAG complet : embed la question → cherche les K chunks les
    plus proches → retourne un bloc texte formatté pour injection dans le
    prompt système. None si aucun contexte pertinent.
    """
    embedding = await embed_query(question)
    if not embedding:
        return None

    chunks = await db.search_course_chunks(course_db_id, embedding, k=k)
    if not chunks:
        return None

    # Filtre par seuil de pertinence — évite d'injecter du bruit
    relevant = [c for c in chunks if c["distance"] <= RELEVANCE_THRESHOLD]
    if not relevant:
        log.info(
            f"RAG: top distance={chunks[0]['distance']:.3f} > seuil "
            f"{RELEVANCE_THRESHOLD} → pas d'injection"
        )
        return None

    # Format : un bloc par chunk avec sa source pour que Claude puisse citer
    parts = []
    for c in relevant:
        source = c["resource_name"] or c["section_name"] or "Cours"
        parts.append(
            f"[Extrait de « {source} » — pertinence {1 - c['distance']:.0%}]\n"
            f"{c['text']}"
        )
    return "\n\n---\n\n".join(parts)


def build_system_prompt_with_context(
    base_prompt: str, rag_context: Optional[str]
) -> str:
    """Combine le system prompt de l'agent avec le contexte RAG. Si pas de
    contexte, retourne le prompt tel quel.
    """
    if not rag_context:
        return base_prompt

    return (
        f"{base_prompt}\n\n"
        f"--- CONTEXTE DU COURS ---\n"
        f"Voici des extraits pertinents des supports pédagogiques du cours. "
        f"Réponds en t'appuyant prioritairement sur ces extraits, et cite la "
        f"source quand c'est pertinent. Si la question dépasse ce qui est "
        f"dans les extraits, dis-le et complète avec tes connaissances "
        f"générales.\n\n"
        f"{rag_context}"
    )

"""
Tools exposés à Claude pour le RAG : function calling vs RAG naïf.

Au lieu d'injecter mécaniquement top-K=5 chunks dans le system prompt, on
laisse Claude **décider** quand et quoi retrieve. Avantages :
  - Pas de retrieval pour les questions triviales ("merci", "ok")
  - Multi-tour pour les questions complexes (search puis get_chapter)
  - Citations plus précises (Claude sait d'où vient l'info)

Les schemas suivent le format Anthropic Tools API.
Référence : https://docs.anthropic.com/claude/docs/tool-use
"""
import json
import logging
from typing import Optional

import db
import rag

log = logging.getLogger("aibotmanager.rag_tools")

# ── Schemas Anthropic ────────────────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "list_chapters",
        "description": (
            "Liste les chapitres (sections) du cours, avec pour chacun le nombre "
            "de ressources et de chunks indexés. Utile pour donner un aperçu du "
            "cours ou décider quel chapitre approfondir avec get_chapter."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "search_course",
        "description": (
            "Cherche par similarité sémantique les passages les plus pertinents "
            "du cours pour une requête. À utiliser quand l'étudiant pose une "
            "question précise sur un concept, une procédure, un chiffre, etc. "
            "Retourne entre 1 et 10 extraits avec leur source."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Reformule la requête en termes clairs et précis pour la recherche sémantique. Ex: au lieu de 'explique-moi ça', mets 'explication détaillée de la complexité algorithmique du tri par insertion'.",
                },
                "k": {
                    "type": "integer",
                    "description": "Nombre d'extraits à retourner (1-10). Défaut: 5. Augmente si la question est large (synthèse), diminue si précise (chiffre).",
                    "minimum": 1,
                    "maximum": 10,
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_chapter",
        "description": (
            "Récupère le texte intégral d'un chapitre (section) du cours. À "
            "utiliser quand l'étudiant demande un résumé d'un chapitre entier "
            "ou veut creuser une section spécifique. Le texte est tronqué à "
            "8000 caractères pour préserver le contexte."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "section_id": {
                    "type": "string",
                    "description": "L'identifiant de la section, obtenu via list_chapters.",
                },
            },
            "required": ["section_id"],
        },
    },
]

GET_CHAPTER_MAX_CHARS = 8000


# ── Dispatcher ──────────────────────────────────────────────────────────────

async def dispatch(
    tool_name: str, tool_input: dict, course_db_id: str
) -> str:
    """Exécute le tool et retourne son résultat sérialisé en JSON. Toute
    erreur est aussi sérialisée — Claude doit voir qu'un tool a foiré pour
    décider quoi faire (ex: retry avec autre query)."""
    try:
        if tool_name == "list_chapters":
            chapters = await db.list_course_sections(course_db_id)
            return json.dumps(
                [
                    {
                        "section_id": c["id"],
                        "name": c["name"],
                        "ordinal": c["sectionnum"],
                        "resource_count": c["resource_count"],
                        "chunk_count": c["chunk_count"],
                    }
                    for c in chapters
                ],
                ensure_ascii=False,
            )

        if tool_name == "search_course":
            query = tool_input.get("query", "").strip()
            k = max(1, min(10, int(tool_input.get("k", 5))))
            if not query:
                return json.dumps({"error": "query vide"})
            embedding = await rag.embed_query(query)
            if not embedding:
                return json.dumps({"error": "embed_query a échoué"})
            chunks = await db.search_course_chunks(course_db_id, embedding, k=k)
            return json.dumps(
                [
                    {
                        "text": c["text"],
                        "source": c["resource_name"] or c["section_name"] or "Cours",
                        "relevance": round(1 - c["distance"], 3),
                    }
                    for c in chunks
                ],
                ensure_ascii=False,
            )

        if tool_name == "get_chapter":
            section_id = tool_input.get("section_id", "").strip()
            if not section_id:
                return json.dumps({"error": "section_id vide"})
            section = await db.get_section_text(course_db_id, section_id)
            if not section:
                return json.dumps({"error": "section_id introuvable"})
            text = section["text"]
            truncated = len(text) > GET_CHAPTER_MAX_CHARS
            return json.dumps(
                {
                    "name": section["name"],
                    "text": text[:GET_CHAPTER_MAX_CHARS],
                    "truncated": truncated,
                    "full_size": len(text),
                },
                ensure_ascii=False,
            )

        return json.dumps({"error": f"tool inconnu: {tool_name}"})
    except Exception as e:
        log.warning(f"Tool {tool_name} a planté : {e}")
        return json.dumps({"error": str(e)})


def system_prompt_for_tools(base_prompt: str) -> str:
    """Augmente le system_prompt avec une instruction sur l'usage des tools.
    Évite que Claude réponde "je ne sais pas" alors qu'un search_course aurait
    trouvé l'info, ou inversement appelle des tools quand c'est inutile."""
    return (
        f"{base_prompt}\n\n"
        f"--- ACCÈS AUX SUPPORTS DU COURS ---\n"
        f"Tu as accès à 3 outils pour consulter les supports pédagogiques :\n"
        f"  • list_chapters() — l'index des sections du cours\n"
        f"  • search_course(query, k) — recherche sémantique d'extraits\n"
        f"  • get_chapter(section_id) — texte intégral d'un chapitre\n\n"
        f"Règles d'usage :\n"
        f"  • Pour une question factuelle/précise sur le cours → search_course\n"
        f"  • Pour une demande de résumé d'un chapitre → list_chapters puis get_chapter\n"
        f"  • Pour des salutations ou questions hors-cours → réponds directement, "
        f"sans appeler de tool\n"
        f"  • Cite la source quand tu utilises un extrait (ex: « D'après le "
        f"chapitre X… »)\n"
        f"  • Si rien de pertinent n'est trouvé après 1-2 essais, dis-le "
        f"honnêtement et complète avec tes connaissances générales."
    )

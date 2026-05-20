"""
Accès Postgres pour le runtime multi-agents.
Utilise asyncpg en pool partagé.
"""
import asyncio
import os
import secrets
from dataclasses import dataclass
from typing import Optional

import asyncpg


@dataclass
class AgentRow:
    id: str
    slug: str
    name: str
    matrix_user_id: str
    matrix_device_id: Optional[str]
    matrix_access_token_enc: str
    system_prompt: str
    provider: str  # "ANTHROPIC" | "OLLAMA"
    model: str
    max_tokens: int
    temperature: Optional[float]
    status: str


_pool: Optional[asyncpg.Pool] = None
_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool:
    global _pool
    async with _lock:
        if _pool is None:
            url = os.environ["DATABASE_URL"]
            # asyncpg ne supporte pas les query params Prisma — on les retire
            url = url.split("?")[0]
            _pool = await asyncpg.create_pool(
                url, min_size=1, max_size=4, command_timeout=30
            )
        return _pool


async def list_enabled_agents() -> list[AgentRow]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, slug, name, "matrixUserId", "matrixDeviceId",
               "matrixAccessToken", "systemPrompt", provider, model, "maxTokens",
               temperature, status
        FROM "Agent"
        WHERE status = 'ENABLED'
        ORDER BY slug
        """
    )
    return [
        AgentRow(
            id=r["id"],
            slug=r["slug"],
            name=r["name"],
            matrix_user_id=r["matrixUserId"],
            matrix_device_id=r["matrixDeviceId"],
            matrix_access_token_enc=r["matrixAccessToken"],
            system_prompt=r["systemPrompt"],
            provider=r["provider"],
            model=r["model"],
            max_tokens=r["maxTokens"],
            temperature=r["temperature"],
            status=r["status"],
        )
        for r in rows
    ]


async def get_room_assignment(
    agent_id: str, matrix_room_id: str
) -> Optional[dict]:
    """Récupère l'affectation (room ↔ agent) si elle existe et est active.
    Retourne aussi le moodleCourseId et le flag reindexEnabled pour décider
    si on doit faire du RAG sur cette conversation.
    """
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT ra.id, ra.enabled, r.id AS room_id,
               r."moodleCourseId", c."reindexEnabled" AS rag_enabled
        FROM "RoomAgent" ra
        JOIN "Room" r ON r.id = ra."roomId"
        LEFT JOIN "MoodleCourse" c ON c.id = r."moodleCourseId"
        WHERE ra."agentId" = $1 AND r."matrixRoomId" = $2
        """,
        agent_id,
        matrix_room_id,
    )


async def list_assigned_matrix_rooms(agent_id: str) -> list[str]:
    """Liste des matrix_room_id où l'agent est censé être membre actif.
    Sert à la reconciliation membership au boot : on compare cette liste avec
    `self.client.rooms.keys()` pour détecter les rooms perdues hors-ligne.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT r."matrixRoomId" AS mxid
        FROM "RoomAgent" ra
        JOIN "Room" r ON r.id = ra."roomId"
        WHERE ra."agentId" = $1
          AND ra.enabled = true
          AND ra."autoRejoinOnKick" = true
        """,
        agent_id,
    )
    return [r["mxid"] for r in rows]


async def claim_rejoin_attempt(
    agent_id: str, matrix_room_id: str, cooldown_sec: int
) -> Optional[dict]:
    """Tente d'acquérir le « slot » de rejoin pour ce (agent, room).

    Atomique : un seul UPDATE qui sert à la fois de check policy + cooldown
    + lock (pose `lastRejoinAttemptAt=NOW()` pour bloquer les attempts
    concurrents). Si la mise à jour ne touche aucune ligne (RETURNING vide),
    c'est qu'on n'a pas le droit/pas le moment de tenter — on doit skip.

    Retourne le dict {id, fail_count} si on a le slot, None sinon.

    Évite la race où deux events arrivent en // et passent tous les deux le
    check préalable avant l'écriture.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE "RoomAgent" ra
        SET "lastRejoinAttemptAt" = NOW()
        FROM "Room" r
        WHERE ra."roomId" = r.id
          AND ra."agentId" = $1
          AND r."matrixRoomId" = $2
          AND ra.enabled = true
          AND ra."autoRejoinOnKick" = true
          AND (
            ra."lastRejoinAttemptAt" IS NULL
            OR ra."lastRejoinAttemptAt" < NOW() - ($3 * INTERVAL '1 second')
          )
        RETURNING ra.id, ra."rejoinFailCount" AS fail_count
        """,
        agent_id,
        matrix_room_id,
        cooldown_sec,
    )
    return dict(row) if row else None


async def record_rejoin_result(
    room_agent_id: str, success: bool
) -> int:
    """Met à jour le compteur d'échecs après une tentative.
    - success=True  → reset à 0
    - success=False → +1, retourne le nouveau total
    """
    pool = await get_pool()
    if success:
        await pool.execute(
            'UPDATE "RoomAgent" SET "rejoinFailCount" = 0 WHERE id = $1',
            room_agent_id,
        )
        return 0
    row = await pool.fetchrow(
        """
        UPDATE "RoomAgent"
        SET "rejoinFailCount" = "rejoinFailCount" + 1
        WHERE id = $1
        RETURNING "rejoinFailCount"
        """,
        room_agent_id,
    )
    return int(row["rejoinFailCount"]) if row else 0


async def disable_room_agent(room_agent_id: str) -> None:
    """Désactive l'assignation après trop d'échecs de rejoin. L'enseignant
    pourra réactiver manuellement depuis /rooms/[id] s'il le souhaite.
    """
    pool = await get_pool()
    await pool.execute(
        'UPDATE "RoomAgent" SET enabled = false WHERE id = $1',
        room_agent_id,
    )


async def insert_system_audit(
    *,
    room_agent_id: str,
    agent_id: str,
    user_message: str,
    error: Optional[str] = None,
) -> None:
    """Trace dans `AuditLog` un événement système (auto-disable, rejoin
    forcé…). Visible dans /audit avec le sender sentinelle `system:rejoin`,
    ce qui permet à l'admin de retrouver l'incident sans naviguer dans
    les logs container.
    """
    pool = await get_pool()
    # On a besoin du roomId (PK) depuis le room_agent_id.
    row = await pool.fetchrow(
        'SELECT "roomId" FROM "RoomAgent" WHERE id = $1',
        room_agent_id,
    )
    if not row:
        return
    log_id = "sys_" + secrets.token_hex(12)
    synthetic_event_id = f"sys-rejoin-{room_agent_id}-{secrets.token_hex(4)}"
    await pool.execute(
        """
        INSERT INTO "AuditLog" (
            id, "roomId", "agentId", "matrixEventId", "senderMxid",
            "userMessage", error, "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT ("matrixEventId") DO NOTHING
        """,
        log_id,
        row["roomId"],
        agent_id,
        synthetic_event_id,
        "system:rejoin",
        user_message,
        error,
    )


async def save_device_id(agent_id: str, device_id: str) -> None:
    """Met à jour le device_id de l'agent (utile au 1er démarrage après whoami)."""
    pool = await get_pool()
    await pool.execute(
        'UPDATE "Agent" SET "matrixDeviceId" = $1 WHERE id = $2',
        device_id,
        agent_id,
    )


async def update_heartbeat(agent_id: str) -> None:
    """Met à jour le timestamp de heartbeat de l'agent (appelé toutes les 30s)."""
    pool = await get_pool()
    await pool.execute(
        'UPDATE "Agent" SET "lastHeartbeatAt" = NOW() WHERE id = $1',
        agent_id,
    )


async def list_course_sections(course_db_id: str) -> list[dict]:
    """Liste les sections d'un cours avec le compte de resources et chunks
    pour chacune. Utile pour le tool `list_chapters` exposé à Claude."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT
          s.id,
          s.name,
          s."sectionnum",
          COUNT(DISTINCT r.id)::int AS resource_count,
          COUNT(DISTINCT c.id)::int AS chunk_count
        FROM "MoodleSection" s
        LEFT JOIN "MoodleResource" r ON r."sectionId" = s.id
        LEFT JOIN "MoodleResourceChunk" c ON c."sectionId" = s.id OR c."resourceId" = r.id
        WHERE s."courseId" = $1
        GROUP BY s.id
        ORDER BY s."sectionnum"
        """,
        course_db_id,
    )
    return [dict(r) for r in rows]


async def get_section_text(
    course_db_id: str, section_id: str
) -> Optional[dict]:
    """Récupère le texte intégral d'une section (concaténation extractedText
    de la section + de toutes ses resources). Pour le tool `get_chapter`.
    """
    pool = await get_pool()
    section = await pool.fetchrow(
        """
        SELECT id, name, "extractedText" FROM "MoodleSection"
        WHERE id = $1 AND "courseId" = $2
        """,
        section_id,
        course_db_id,
    )
    if not section:
        return None

    resources = await pool.fetch(
        """
        SELECT name, modname, "extractedText"
        FROM "MoodleResource"
        WHERE "sectionId" = $1 AND "extractedText" IS NOT NULL
        ORDER BY id
        """,
        section_id,
    )

    parts: list[str] = []
    if section["extractedText"]:
        parts.append(f"# {section['name']} (sommaire)\n\n{section['extractedText']}")
    for r in resources:
        parts.append(
            f"## {r['name']} ({r['modname']})\n\n{r['extractedText']}"
        )
    return {
        "id": section["id"],
        "name": section["name"],
        "text": "\n\n".join(parts) if parts else "",
    }


async def search_course_chunks(
    course_db_id: str,
    query_embedding: list[float],
    k: int = 5,
) -> list[dict]:
    """Recherche les K chunks les plus proches d'un embedding pour un cours.
    Utilise l'index HNSW pgvector (cosine distance). Retourne le texte +
    metadata pour chaque chunk, du plus pertinent au moins.

    Pour passer un vecteur Python list[float] à pgvector, on le sérialise en
    string `'[0.1,0.2,...]'` puis on cast côté SQL.
    """
    pool = await get_pool()
    vec_literal = "[" + ",".join(repr(float(x)) for x in query_embedding) + "]"
    rows = await pool.fetch(
        """
        SELECT
          c.id,
          c.text,
          c."ordinal",
          c.embedding <=> $1::vector AS distance,
          r.name AS resource_name,
          r.modname AS resource_modname,
          r.url AS resource_url,
          s.name AS section_name
        FROM "MoodleResourceChunk" c
        LEFT JOIN "MoodleResource" r ON r.id = c."resourceId"
        LEFT JOIN "MoodleSection" s
          ON s.id = COALESCE(c."sectionId", r."sectionId")
        WHERE c."courseId" = $2 AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector
        LIMIT $3
        """,
        vec_literal,
        course_db_id,
        k,
    )
    return [dict(r) for r in rows]


async def insert_audit_log(
    *,
    room_pk: str,
    agent_id: str,
    matrix_event_id: Optional[str],
    sender_mxid: str,
    user_message: str,
    agent_response: Optional[str] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    cache_read_tokens: Optional[int] = None,
    cache_write_tokens: Optional[int] = None,
    latency_ms: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    pool = await get_pool()
    log_id = "al_" + secrets.token_hex(12)
    await pool.execute(
        """
        INSERT INTO "AuditLog" (
            id, "roomId", "agentId", "matrixEventId", "senderMxid",
            "userMessage", "agentResponse", "inputTokens", "outputTokens",
            "cacheReadTokens", "cacheWriteTokens", "latencyMs", error,
            "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT ("matrixEventId") DO NOTHING
        """,
        log_id,
        room_pk,
        agent_id,
        matrix_event_id,
        sender_mxid,
        user_message,
        agent_response,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        latency_ms,
        error,
    )

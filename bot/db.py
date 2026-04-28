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
    """Récupère l'affectation (room ↔ agent) si elle existe et est active."""
    pool = await get_pool()
    return await pool.fetchrow(
        """
        SELECT ra.id, ra.enabled, r.id AS room_id, r."moodleCourseId"
        FROM "RoomAgent" ra
        JOIN "Room" r ON r.id = ra."roomId"
        WHERE ra."agentId" = $1 AND r."matrixRoomId" = $2
        """,
        agent_id,
        matrix_room_id,
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

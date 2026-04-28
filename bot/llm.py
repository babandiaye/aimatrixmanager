"""
Couche d'abstraction multi-provider :
  - ANTHROPIC : Claude via SDK officiel (prompt caching natif)
  - OLLAMA    : via /v1/chat/completions (format OpenAI compatible)

Renvoie toujours (answer_text, usage_dict) avec :
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens.
"""
import asyncio
import os
from typing import Optional

import anthropic
import httpx

import db


# ── Anthropic ────────────────────────────────────────────────────────────────

_anthropic_client: Optional[anthropic.Anthropic] = None


def _anthropic() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY non défini")
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


def _call_anthropic_sync(
    agent: db.AgentRow, messages: list, max_history: int
) -> tuple[str, dict]:
    kwargs: dict = dict(
        model=agent.model,
        max_tokens=agent.max_tokens,
        system=[
            {
                "type": "text",
                "text": agent.system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=messages[-max_history:],
    )
    if agent.temperature is not None:
        kwargs["temperature"] = agent.temperature
    response = _anthropic().messages.create(**kwargs)
    answer = response.content[0].text
    usage = response.usage
    return answer, {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_read_tokens": getattr(usage, "cache_read_input_tokens", 0),
        "cache_write_tokens": getattr(usage, "cache_creation_input_tokens", 0),
    }


# ── Ollama (via /v1/chat/completions, OpenAI compat) ─────────────────────────

async def _call_ollama(
    agent: db.AgentRow, messages: list, max_history: int
) -> tuple[str, dict]:
    base_url = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    api_key = os.environ.get("OLLAMA_API_KEY", "")
    if not base_url or not api_key:
        raise RuntimeError("OLLAMA_BASE_URL ou OLLAMA_API_KEY non défini")

    body: dict = {
        "model": agent.model,
        "messages": [{"role": "system", "content": agent.system_prompt}]
        + messages[-max_history:],
        "max_tokens": agent.max_tokens,
        "stream": False,
    }
    if agent.temperature is not None:
        body["temperature"] = agent.temperature

    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(
            f"{base_url}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        r.raise_for_status()
        data = r.json()

    answer = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    return answer, {
        "input_tokens": usage.get("prompt_tokens", 0),
        "output_tokens": usage.get("completion_tokens", 0),
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
    }


# ── Dispatcher ────────────────────────────────────────────────────────────────

async def call(
    agent: db.AgentRow, messages: list, max_history: int = 20
) -> tuple[str, dict]:
    if agent.provider == "ANTHROPIC":
        # SDK Anthropic synchrone → wrap dans un thread pour ne pas bloquer la loop
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, _call_anthropic_sync, agent, messages, max_history
        )
    elif agent.provider == "OLLAMA":
        return await _call_ollama(agent, messages, max_history)
    else:
        raise ValueError(f"Provider inconnu : {agent.provider}")

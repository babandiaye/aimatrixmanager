"""
Couche d'abstraction multi-provider :
  - ANTHROPIC : Claude via SDK officiel (prompt caching natif)
  - OLLAMA    : via /v1/chat/completions (format OpenAI compatible)

Deux modes :
  - call(...)         → renvoie (answer_text, usage_dict) en bloc
  - stream_call(...)  → async generator yieldant (chunk, usage_or_None)
                        usage est None pendant le stream, et populé sur le
                        dernier yield (chunk vide possible).

usage_dict contient input_tokens, output_tokens, cache_read_tokens,
cache_write_tokens.
"""
import asyncio
import json
import os
from typing import AsyncIterator, Optional, Tuple

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


# ── Streaming ────────────────────────────────────────────────────────────────

# Anthropic — utilise AsyncAnthropic pour streamer en async natif.
_anthropic_async_client: Optional[anthropic.AsyncAnthropic] = None


def _anthropic_async() -> anthropic.AsyncAnthropic:
    global _anthropic_async_client
    if _anthropic_async_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY non défini")
        _anthropic_async_client = anthropic.AsyncAnthropic(api_key=api_key)
    return _anthropic_async_client


async def _stream_anthropic(
    agent: db.AgentRow, messages: list, max_history: int
) -> AsyncIterator[Tuple[str, Optional[dict]]]:
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

    async with _anthropic_async().messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            if text:
                yield text, None
        final = await stream.get_final_message()
    yield "", {
        "input_tokens": final.usage.input_tokens,
        "output_tokens": final.usage.output_tokens,
        "cache_read_tokens": getattr(final.usage, "cache_read_input_tokens", 0)
        or 0,
        "cache_write_tokens": getattr(
            final.usage, "cache_creation_input_tokens", 0
        )
        or 0,
    }


async def _stream_ollama(
    agent: db.AgentRow, messages: list, max_history: int
) -> AsyncIterator[Tuple[str, Optional[dict]]]:
    base_url = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    api_key = os.environ.get("OLLAMA_API_KEY", "")
    if not base_url or not api_key:
        raise RuntimeError("OLLAMA_BASE_URL ou OLLAMA_API_KEY non défini")

    body: dict = {
        "model": agent.model,
        "messages": [{"role": "system", "content": agent.system_prompt}]
        + messages[-max_history:],
        "max_tokens": agent.max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if agent.temperature is not None:
        body["temperature"] = agent.temperature

    final_usage: Optional[dict] = None
    async with httpx.AsyncClient(timeout=120) as http:
        async with http.stream(
            "POST",
            f"{base_url}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                # Usage arrive dans le dernier event (stream_options.include_usage)
                if "usage" in data and data["usage"]:
                    u = data["usage"]
                    final_usage = {
                        "input_tokens": u.get("prompt_tokens", 0) or 0,
                        "output_tokens": u.get("completion_tokens", 0) or 0,
                        "cache_read_tokens": 0,
                        "cache_write_tokens": 0,
                    }
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content") or ""
                if delta:
                    yield delta, None
    yield "", final_usage or {
        "input_tokens": 0,
        "output_tokens": 0,
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


async def stream_call(
    agent: db.AgentRow, messages: list, max_history: int = 20
) -> AsyncIterator[Tuple[str, Optional[dict]]]:
    """Variante streaming : yield (chunk, usage). Usage est None pendant le
    stream et populé sur le dernier yield (chunk peut être vide à ce moment).
    """
    if agent.provider == "ANTHROPIC":
        async for item in _stream_anthropic(agent, messages, max_history):
            yield item
    elif agent.provider == "OLLAMA":
        async for item in _stream_ollama(agent, messages, max_history):
            yield item
    else:
        raise ValueError(f"Provider inconnu : {agent.provider}")

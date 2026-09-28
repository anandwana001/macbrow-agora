"""Direct local-model helpers for optional browser and tool-learning experiments.

The Agora voice pipeline does not use this client.
"""

from __future__ import annotations

import os
from typing import Any

import openai
from pydantic import BaseModel


def response_format(model: type[BaseModel]) -> dict[str, Any]:
    """Use the OpenAI SDK's public helper to produce a strict Pydantic schema."""
    function = openai.pydantic_function_tool(model)["function"]
    return {
        "type": "json_schema",
        "json_schema": {"name": function["name"], "strict": True, "schema": function["parameters"]},
    }


def model_name() -> str:
    name = os.getenv("MACBROW_LOCAL_MODEL", "").strip()
    if not name:
        raise RuntimeError("Set MACBROW_LOCAL_MODEL to the loaded LM Studio model for optional extended features")
    return name


def client_options() -> dict[str, Any]:
    return {
        "base_url": os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
        "api_key": os.getenv("LMSTUDIO_API_KEY", "lm-studio"),
        "timeout": 90.0,
        "max_retries": 1,
    }


def extra_body() -> dict[str, Any]:
    effort = os.getenv("MACBROW_REASONING_EFFORT")
    return {"reasoning_effort": effort} if effort else {}


def complete(system: str, user: str, schema: type[BaseModel], *, max_tokens: int = 400) -> str:
    model = model_name()
    with openai.OpenAI(**client_options()) as client:
        response = client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            temperature=0.2,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format=response_format(schema),
            extra_body=extra_body(),
        )
    return response.choices[0].message.content or ""

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from macbrow import local_llm
from macbrow.generator import ToolGenerator
from macbrow.registry import ToolRegistry


class Result(BaseModel):
    text: str
    optional: str | None = None


def test_response_format_is_strict_and_includes_nullable_fields():
    result = local_llm.response_format(Result)
    assert result["type"] == "json_schema"
    schema = result["json_schema"]
    assert schema["strict"]
    assert schema["schema"]["additionalProperties"] is False
    assert set(schema["schema"]["required"]) == {"text", "optional"}


def test_optional_model_requires_explicit_configuration(monkeypatch):
    monkeypatch.delenv("MACBROW_LOCAL_MODEL", raising=False)
    with pytest.raises(RuntimeError, match="MACBROW_LOCAL_MODEL"):
        local_llm.model_name()
    monkeypatch.setenv("MACBROW_LOCAL_MODEL", "my-local-model")
    assert local_llm.model_name() == "my-local-model"
    monkeypatch.delenv("MACBROW_REASONING_EFFORT", raising=False)
    assert local_llm.extra_body() == {}


def test_generator_uses_direct_client_and_closes_it(monkeypatch):
    monkeypatch.setenv("MACBROW_LOCAL_MODEL", "test-model")
    calls = []

    class Client:
        closed = False

        def __init__(self):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        async def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok":true}'), finish_reason="stop")]
            )

        async def close(self):
            self.closed = True

    client = Client()
    generator = ToolGenerator(ToolRegistry(), client=client)

    async def run():
        assert await generator._complete([{"role": "user", "content": "test"}]) == ('{"ok":true}', "stop")
        await generator.aclose()

    asyncio.run(run())
    assert calls[0]["model"] == "test-model"
    assert calls[0]["response_format"]["json_schema"]["strict"]
    assert client.closed

"""Persistent, private JSON-lines worker for the Agora MCP tool.

Agora owns STT, conversation and TTS. This worker only runs the existing Jev/Mac
state machine. One worker per voice session keeps spoken confirmations isolated.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import sys

from dotenv import load_dotenv


async def serve(reader, emit, agent) -> None:
    """Sequential commands: never execute two voice actions on the Mac at once."""
    try:
        await agent.start()
        emit({"ready": True})
        while line := await reader():
            request = {}
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    request = {}
                    raise ValueError("Expected a JSON object")
                utterance = request.get("utterance")
                if not isinstance(utterance, str) or not 0 < len(utterance.strip()) <= 4000:
                    raise ValueError("A nonempty utterance of at most 4000 characters is required")
                outcome = await agent.handle(utterance)
                emit(
                    {
                        "id": request["id"],
                        "speak": outcome.speak,
                        "executed": outcome.executed,
                        "stop": outcome.stop,
                        "handoff_to_llm": outcome.handoff_to_llm,
                        "awaiting_confirmation": agent.pending is not None,
                        "timings": outcome.timings,
                    }
                )
            except Exception:
                logging.exception("Mac command failed")
                emit({"id": request.get("id"), "error": "The Mac command failed; do not claim it succeeded."})
    finally:
        await agent.aclose()


async def main() -> None:
    load_dotenv(".env.local")
    load_dotenv()
    if not os.getenv("TYPESAFE_API_KEY"):
        raise RuntimeError("Set TYPESAFE_API_KEY in .env.local before starting a Mac conversation")

    # Load env before the existing modules read provider/policy settings.
    from . import policy
    from .agent import DynamicMacAgent
    from .registry import ToolRegistry

    if not policy.ENABLED:
        raise RuntimeError("The Agora Mac-control demo requires MACBROW_POLICY=strict")
    extended = os.getenv("MACBROW_AGORA_EXTENDED", "0") == "1"
    registry = ToolRegistry()
    if not extended:
        registry.tools = {k: t for k, t in registry.tools.items() if t.runner != "browser" and t.source == "seed"}
    agent = DynamicMacAgent(registry, enable_learning=extended and os.getenv("MACBROW_LEARN", "1") != "0")

    # Keep third-party stdout out of our JSON protocol.
    wire = sys.stdout
    sys.stdout = sys.stderr

    def emit(value):
        wire.write(json.dumps(value) + "\n")
        wire.flush()

    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=16384)
    transport, _ = await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    task = asyncio.current_task()
    loop.add_signal_handler(signal.SIGTERM, task.cancel)
    try:
        with contextlib.suppress(asyncio.CancelledError):
            await serve(reader.readline, emit, agent)
    finally:
        transport.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    asyncio.run(main())

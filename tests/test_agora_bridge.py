import asyncio
import json
from types import SimpleNamespace

from macbrow.agora_bridge import serve


def test_confirmation_state_survives_between_tool_calls_and_closes():
    class Agent:
        pending = None
        closed = False

        async def start(self):
            pass

        async def aclose(self):
            self.closed = True

        async def handle(self, text):
            if text == "yes":
                assert self.pending is not None
                self.pending = None
                return SimpleNamespace(speak="Done", executed=True, stop=False, handoff_to_llm=False, timings={})
            self.pending = object()
            return SimpleNamespace(speak="Confirm?", executed=False, stop=False, handoff_to_llm=False, timings={})

    agent = Agent()
    lines = iter(
        [json.dumps({"id": "1", "utterance": "do something"}), json.dumps({"id": "2", "utterance": "yes"}), ""]
    )
    results = []

    async def read():
        return next(lines)

    asyncio.run(serve(read, results.append, agent))
    assert results[1]["awaiting_confirmation"]
    assert not results[2]["awaiting_confirmation"]
    assert results[2]["executed"]
    assert agent.closed


def test_bad_input_does_not_execute_and_worker_closes():
    class Agent:
        closed = False

        async def start(self):
            pass

        async def aclose(self):
            self.closed = True

        async def handle(self, text):
            raise AssertionError("Invalid input must not reach the Mac engine")

    agent = Agent()
    lines = iter(["[]", '{"id":"2","utterance":""}', "bad-json", ""])
    results = []

    async def read():
        return next(lines)

    asyncio.run(serve(read, results.append, agent))
    assert len(results) == 4
    assert all("error" in result for result in results[1:])
    assert agent.closed

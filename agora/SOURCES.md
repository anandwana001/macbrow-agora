# Source map

The existing Python Mac engine stays intact. This integration uses the official
quickstart sources, inspected before implementation:

| Official source | Used here |
| --- | --- |
| `AgoraIO-Conversational-AI/agent-quickstart-nextjs` @ `db055babff9499a332a97dbcdacc75c95bc7c0ef`, `app/api/invite-agent/route.ts` | `pipeline.mjs`: managed vendor chain, turn detection, RTM configuration and SDK lifecycle; adds the Mac MCP server |
| Same repo, `app/api/generate-agora-token/route.ts` | `server.mjs`: server-only combined RTC/RTM token, using the SDK's duration-based token helper |
| Same repo, `app/api/stop-conversation/route.ts` | `server.mjs`: server-side agent stop, augmented with local worker cleanup |
| `AgoraIO-Conversational-AI/agent-quickstart-python` @ `bd1af724bed885c39a5a57235b37ec3bb3fd6396`, `web/` | `.agora-demo/agent-quickstart-python/web/`: reused client, transcripts, visualizer and metrics; setup changes only the welcome copy |
| Same repo, `server/src/server.py` | `server.mjs`: preserves the browser's get_config/startAgent/stopAgent contract |
| `AgoraIO/agora-agents-ts`, npm `agora-agents@2.11.0` | `OpenAI.mcpServers`, managed provider configuration, `generateConvoAIToken` |

MCP headers, transport, allowed_tools and timeout_ms were checked against
https://docs-md.agora.io/api/conversational-ai-api-v2.x.yaml.

The official quickstart's MIT notice is preserved in `AGORA-LICENSE`.
The browser checkout retains its own license and source history.

The original Python quickstart was installed with `bun run setup` and started
with `bun run dev`. Its page and token API loaded, and a managed agent started
and stopped successfully. This is not proof of microphone/audio roundtrip or of
the new Mac tool integration; those require separate live verification.

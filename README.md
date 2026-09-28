# macbrow-agora

**An experimental fork of [Pratim Bhosale's macbrow](https://github.com/timpratim/macbrow), exploring Agora Conversational AI for voice-controlled Mac actions. For experimentation only—not a production application or an official Agora or Gradium product.**

Agora provides the managed speech-to-text → LLM → text-to-speech pipeline through
[`agora-agents`](https://www.npmjs.com/package/agora-agents). The agent calls a Mac
tool over MCP; Jev routes the command to the existing AppleScript tools and policy.
The browser displays transcripts, agent status and latency metrics.

**Verification:** automated tests and the browser build pass. The official sample's
managed agent starts and stops successfully. This fork's complete voice-to-Mac
roundtrip still needs live verification with a Jev key and HTTPS tunnel.

## Credits and original work

- **[Pratim Bhosale](https://github.com/timpratim) and the original [macbrow project](https://github.com/timpratim/macbrow):** the original demo, Mac automation engine, Jev routing, tool registry and safety policy form the foundation of this fork. The original copyright and MIT license are preserved in [LICENSE](LICENSE).
- **The [Gradium team](https://gradium.ai):** special thanks and credit for the streaming speech recognition and speech synthesis that powered the original demo's voice experience. This fork builds on that demo; its current voice pipeline runs through Agora. See the [original demo video](https://youtu.be/cPBlb1neXiI), which illustrates the upstream project rather than this fork.
- **[Agora](https://github.com/AgoraIO-Conversational-AI):** the managed conversational pipeline, `agora-agents` SDK and official browser quickstart reused here. Source revisions and adaptations are recorded in [agora/SOURCES.md](agora/SOURCES.md); its MIT notice is retained in [agora/AGORA-LICENSE](agora/AGORA-LICENSE).
- **[TypeSafe](https://docs.typesafe.ai) and [Browser Use](https://github.com/browser-use/jev-ultrafast):** Jev powers action routing; their browser tooling supports the optional extended experiments.

The original idea and automation work belong to their respective authors. This fork
adds an experimental Agora integration and does not imply their endorsement.

## How it works

```text
Browser microphone ←→ Agora RTC + managed STT / LLM / TTS
                                  ↓ MCP tool call
                         HTTPS tunnel to this Mac
                                  ↓
                         Jev → policy → AppleScript
                                  ↓
                         Tool result → Agora reply
```

Small talk is handled by Agora. Mac commands and confirmation answers go through
the persistent Python worker so action state survives between turns.

## Setup

You need macOS, Python 3.12+, uv, Node 22+, npm, Bun, an Agora project with RTC/RTM/
Conversational AI enabled, and a [Jev API key](https://console.typesafe.ai).

```bash
./agora.sh setup
cp .env.example .env.local
cp agora/.env.example .env.agora
```

If you already have either environment file, edit it instead of overwriting it.

1. Set `TYPESAFE_API_KEY` in `.env.local`.
2. Set `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` in `.env.agora`.
3. Create an HTTPS tunnel to **http://127.0.0.1:8101** and set
   `MACBROW_MCP_URL=https://your-tunnel-host/mcp` in `.env.agora`.
4. Keep the tunnel running, then run `./agora.sh start`.
5. Open **http://localhost:3000**, allow microphone access and start a conversation.

Use ngrok, Cloudflare Tunnel or another HTTPS tunnel that forwards Authorization
headers and supports MCP HTTP. Only expose **8101**; the token and agent-control
API on **8000** stays local. See [the setup guide](agora/README.md) for details.

The default demo needs only **Agora and Jev credentials**. No separate STT, TTS or
chat-model provider key is required. Never commit your environment files.

## Try it

- “Open Chrome.”
- “Open Agora's website.”
- “What tab am I on?”
- “Turn the volume down.”

Answer confirmation prompts normally. Use **End Conversation** or say “stop
listening” to finish. macOS may request Automation access the first time an app
is controlled.

## Scope and limitations

The default demo uses predefined Mac actions. Autonomous browser tasks and writing
new tools are disabled by default; optional local-model configuration is documented
in [the setup guide](agora/README.md).

The policy blocks destructive file operations, system configuration changes,
credentials, terminal/developer tools and other restricted actions. It checks
scripts before execution and asks for confirmation for actions classified as risky.
It cannot guarantee that speech or an LLM has interpreted your intent correctly.
Read [the policy](macbrow/policy.py) and use a noncritical test environment.

This is a single-user experiment. Interrupting speech or disconnecting does not
undo an action already in progress. No production reliability, latency or security
claims are made for this fork.

## Development

```bash
npm --prefix agora test
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv run python -m macbrow.cli --dry "open agora dot io"
uv run python -m macbrow.cli --policy
```

Main files: `agora/pipeline.mjs` configures the managed agent,
`agora/server.mjs` provides lifecycle and MCP endpoints,
`macbrow/agora_bridge.py` connects to the Mac engine, and
`tools/seed.json` defines the predefined actions.

MIT; original notices are preserved. See [LICENSE](LICENSE) and
[agora/AGORA-LICENSE](agora/AGORA-LICENSE).

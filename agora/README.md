# macbrow with Agora Conversational AI

**Verification status:** offline tests and the browser build pass. The official
baseline's managed agent starts/stops successfully; the integrated voice-to-Mac
roundtrip has not yet been verified with a Jev key and HTTPS tunnel.

Agora provides the managed **STT → LLM → TTS** pipeline via the **`agora-agents`
npm module**. Its LLM calls `run_mac_command` over MCP; a persistent Python
worker sends the user's command through the existing Jev router and Mac policy.
Small talk stays inside Agora. No separate speech or chat-model key is needed for
the default demo. This fork is for experimentation only; see the [original-project
and Gradium credits](../README.md#credits-and-original-work).

```text
Browser mic ←→ Agora RTC + managed STT/LLM/TTS
                           ↓ MCP tool call
                 HTTPS tunnel → Node MCP server (:8101)
                           ↓ private stdin/stdout
                 Python DynamicMacAgent → Jev → AppleScript
```

## Setup

Prerequisites: macOS, Python 3.12+, uv, Node 22+, npm, Bun, Agora credentials,
and a TypeSafe/Jev key. Run from the repository root:

```bash
./agora.sh setup
cp agora/.env.example .env.agora
```

Set `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` in `.env.agora`, and
`TYPESAFE_API_KEY` in `.env.local`. Keep both files private. Enable RTC, RTM and
Conversational AI in the Agora project. `agora project doctor <project>` checks
project readiness; it does not verify a live conversation.

The Mac tool endpoint must be reachable by Agora. If you have Cloudflare Tunnel
installed, run this in a separate terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:8101
```

Set `MACBROW_MCP_URL=https://<the-assigned-host>/mcp` in `.env.agora`.
Keep the tunnel running; update the URL when it changes. Another HTTPS tunnel
works too, provided it forwards Authorization headers and supports MCP HTTP.
Tunnel **only port 8101**. Port 8000 issues tokens and starts/stops agents and
must remain local. The tool endpoint requires a random per-conversation bearer
token that the Node server supplies to Agora; it is revoked when the session ends.

```bash
./agora.sh start
```

Open **http://localhost:3000**, allow microphone access, and start a conversation.
macOS may ask for Automation permission when an app is controlled for the first time.

Try “Open Chrome”, “Open agora.io”, “What tab am I on?”, and “Turn the volume down”.
Ordinary questions use Agora's managed LLM. Answer the tool's confirmation prompts
normally. Use **End Conversation** or say “stop listening”; Ctrl-C also stops the
agent and worker. One conversation controls this Mac at a time, capped at 30 minutes.

## Scope

The default tool set uses the predefined AppleScript actions in `tools/seed.json`.
It keeps the existing policy checks and Jev confirmation state. The tool receives
the user's words, not arbitrary script text. Duplicate tool calls with the same
`turn_id` reuse the first result; failures are not automatically replayed.

`MACBROW_AGORA_EXTENDED=1` restores the original autonomous browser and learning
features. Those helpers use a local model through LM Studio, in addition to Jev. Set
`MACBROW_LOCAL_MODEL` to the loaded model ID and, if needed, `LMSTUDIO_BASE_URL`
and `LMSTUDIO_API_KEY` in `.env.local`; see the root `.env.example`. For browser
experiments, enable Chrome remote debugging at `chrome://inspect/#remote-debugging`.
These features are off by default so the standard Agora demo needs only Agora and
Jev credentials. Generated tools and browser workflows remain experimental.

This local prototype is not a multi-user hosted service. The managed LLM is
instructed to forward exact utterances and confirmations; speech recognition and
LLM interpretation can still be wrong. A disconnected or interrupted response
does not roll back a Mac action already in progress.

## Verification

```bash
npm --prefix agora test
uv run pytest -q
```

Tests use fake cloud sessions and Mac workers, so they do not operate your Mac.
For live acceptance, verify spoken replies and transcripts, then a real Mac
command, confirmation/cancellation, and End Conversation. An accepted agent
start alone does not prove the audio or MCP path works.

See [SOURCES.md](SOURCES.md) for the quickstart copy map and [the root README](../README.md)
for upstream attribution and the experimental scope of this fork.

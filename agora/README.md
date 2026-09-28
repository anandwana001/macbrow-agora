# macbrow with Agora Conversational AI

**Verification status:** offline tests and native builds pass. The native console
has joined Agora, received agent audio and a greeting transcript, and shut down
successfully in a microphone-muted, playback-muted smoke check. Spoken Mac
commands and audible replies still need live acceptance testing.

Agora provides the managed **STT → LLM → TTS** pipeline via the **`agora-agents`
npm module**. Its LLM calls `run_mac_command` over MCP; a persistent Python
worker sends the user's command through the existing Jev router and Mac policy.
Small talk stays inside Agora. No separate speech or chat-model key is needed for
the default demo. This fork is for experimentation only; see the [original-project
and Gradium credits](../README.md#credits-and-original-work).

```text
Native Mac audio ←→ Agora RTC + managed STT/LLM/TTS
                           ↓ MCP tool call
                 HTTPS tunnel → Node MCP server (:8101)
                           ↓ private stdin/stdout
                 Python DynamicMacAgent → Jev → AppleScript
```

## Setup

Follow the [step-by-step setup and running guide](../README.md#setup-and-running-the-demo)
in the root README. It covers credentials, ngrok and Cloudflare tunnel commands,
which terminals to keep running, connectivity checks, starting a conversation,
shutdown and troubleshooting.

The Node server supplies Agora with a random per-conversation MCP bearer token;
it is revoked when the session ends. One conversation controls this Mac at a time,
capped at 30 minutes. The tunnel exposes port 8101 only; the control API stays local.

`./console.sh start` (also `./agora.sh start`) runs in the foreground with native
microphone/speaker audio. `console.mjs` starts the existing control/MCP server,
gives short-lived RTC credentials to a Swift helper over stdin, waits for it to
join, then starts the managed agent. Certificates and Jev keys stay in the backend.
The native client uses RTC data-stream transcripts; the optional browser continues
to use RTM. `agora-agents` supplies the cloud agent; the pinned Agora macOS SDK
supplies native audio. There is no local STT/TTS replacement or browser subprocess.

Use `./agora.sh browser-setup` and `./agora.sh browser` only if you want the optional
web UI. Its Bun/Next.js dependencies are not needed for the console.

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
command, confirmation/cancellation, spoken stop and Ctrl-C shutdown. An accepted agent
start alone does not prove the audio or MCP path works.

See [SOURCES.md](SOURCES.md) for the quickstart copy map and [the root README](../README.md)
for upstream attribution and the experimental scope of this fork.

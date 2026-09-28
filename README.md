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

## Setup and running the demo

### 1. Prepare the Mac

You need macOS, Git, Python 3.12+, [uv](https://docs.astral.sh/uv/),
[Node.js 22+ and npm](https://nodejs.org/), and [Bun](https://bun.sh/).
The tunnel installation commands below assume [Homebrew](https://brew.sh/) is installed.
You also need an Agora project with RTC, RTM and Conversational AI enabled, its
App ID and App Certificate, and a [Jev API key](https://console.typesafe.ai).

Clone this fork, or open your existing checkout:

```bash
git clone https://github.com/anandwana001/macbrow-agora.git
cd macbrow-agora
./agora.sh setup
```

Run all project commands below from this repository directory. Setup installs the
Python and Node dependencies and the pinned official Agora browser quickstart.
Run it once initially and again when dependencies change.

### 2. Configure credentials

Create the environment files without replacing any existing configuration:

```bash
[ -f .env.local ] || cp .env.example .env.local
[ -f .env.agora ] || cp agora/.env.example .env.agora
```

Edit `.env.local` in your editor and replace the placeholder:

```dotenv
TYPESAFE_API_KEY=your_jev_api_key
```

Edit `.env.agora` and set the credentials from the same Agora project:

```dotenv
AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_agora_app_certificate
MACBROW_MCP_URL=https://your-tunnel-host/mcp
```

Step 3 supplies the real tunnel URL. These are placeholders, not working keys.
The default demo needs only **Agora and Jev credentials**; no separate STT, TTS
or chat-model provider key is required. Keep these ignored environment files private.

### 3. Start an HTTPS tunnel — Terminal A

Agora runs in the cloud and needs a public HTTPS address to call the Mac tool.
The tunnel forwards requests to **http://127.0.0.1:8101** on this Mac.
Choose **one** of the following options and leave its terminal running.
The tunnel may start before the app; requests will fail until step 4 starts the backend.

#### Option A: ngrok

Create an [ngrok account](https://dashboard.ngrok.com/signup), then copy your
authtoken from its dashboard. Install and authenticate once:

```bash
brew install ngrok
ngrok config add-authtoken "YOUR_NGROK_AUTHTOKEN"
```

Start the tunnel each time you run the demo:

```bash
ngrok http http://127.0.0.1:8101
```

Copy the **HTTPS** address shown beside `Forwarding`, such as
`https://your-assigned-domain.ngrok-free.app`. In `.env.agora`, set:

```dotenv
MACBROW_MCP_URL=https://your-assigned-domain.ngrok-free.app/mcp
```

Use your actual assigned address. The ngrok authtoken configures the tunnel client;
it does not belong in `.env.agora`. See [ngrok's macOS setup](https://ngrok.com/download/mac-os).

#### Option B: Cloudflare Quick Tunnel

Install the client once, then start a temporary tunnel:

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8101
```

Copy the generated `https://...trycloudflare.com` address from the terminal and
append `/mcp` in `.env.agora`:

```dotenv
MACBROW_MCP_URL=https://your-generated-name.trycloudflare.com/mcp
```

A Quick Tunnel gets a new address when restarted. Update `.env.agora` and restart
the app whenever that address changes. Quick Tunnels are for development and do
not support SSE; this demo's MCP endpoint uses JSON responses. See the official
[Quick Tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
and [macOS installation instructions](https://developers.cloudflare.com/tunnel/downloads/).

For either option, preserve the `/mcp` path and Authorization header. Do not add
an interactive login page or HTTP Basic Auth in front of this endpoint: the demo
supplies its own random, per-conversation bearer token to Agora automatically.
Only tunnel **8101**. Keep the browser on **3000** and the token/agent-control API
on **8000** local. You do not need to forward router ports or expose the whole Mac.

### 4. Start the app — Terminal B

Open a second terminal in the repository directory. After saving the real tunnel
URL in `.env.agora`, run:

```bash
./agora.sh start
```

Keep this terminal running too. It starts the Node backend and browser frontend.
Wait for the frontend to report that it is ready.

| Component | Address | Access |
| --- | --- | --- |
| Browser UI | `http://localhost:3000` | Open on this Mac |
| Control API | `http://127.0.0.1:8000` | Local only |
| Mac MCP endpoint | `http://127.0.0.1:8101/mcp` | Public HTTPS tunnel forwards here |

### 5. Check connectivity — optional Terminal C

Check the local backend:

```bash
curl -sS http://127.0.0.1:8000/health
```

Before a conversation starts, expect:

```json
{"ok":true,"active":false,"pipeline":"Agora managed STT/LLM/TTS"}
```

Check the public tunnel, replacing the example address with your actual URL:

```bash
curl -i -X POST 'https://your-tunnel-host/mcp' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Expect **HTTP 401** with `{"error":"Unauthorized"}`. This request deliberately
has no bearer token; that response confirms the tunnel reached the protected Mac
endpoint. Do not disable authentication or paste a token into this command.
These checks verify reachability, not a complete Agora conversation.

### 6. Start a conversation

1. Open **http://localhost:3000** on this Mac, rather than the public tunnel URL.
2. Allow microphone access and start the conversation using the page's call control.
3. Say “Hello” and check that you hear a reply and see transcripts.
4. Say “Open Chrome” or “Turn the volume down” and verify the action on the Mac.
5. Allow macOS Automation access if prompted. Answer any spoken confirmation
   prompt normally, then check that confirmation and cancellation work.
6. Use **End Conversation** when finished, or say “stop listening”.

Keep the Mac awake and both terminals running during the conversation.
The complete voice-to-Mac flow still needs live verification for this fork;
see the verification status at the top of this README.

### 7. Stop and run again

End the conversation in the browser first. Press **Ctrl-C** in Terminal B to stop
the app, then **Ctrl-C** in Terminal A to stop the tunnel.

For later runs: start the tunnel → check its current HTTPS address → update
`MACBROW_MCP_URL` if needed → run `./agora.sh start` → open `http://localhost:3000`.
You do not need to repeat dependency installation or copy environment files.
Restart the app after any environment-file changes; they are read at startup.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Tunnel returns 502 or connection refused | Keep Terminal B running and confirm the local `/health` check works. The tunnel must target `127.0.0.1:8101`. |
| Public check returns HTML or a login screen | Check the assigned tunnel address and remove interactive access gates. The MCP endpoint should return the JSON 401 shown above. |
| URL validation fails | Set `MACBROW_MCP_URL` to an HTTPS URL ending exactly in `/mcp`, with no trailing slash. Restart the app. |
| App reports a port is already in use | Stop the earlier demo or other process using 3000, 8000 or 8101, then restart. Use 3000 for this frontend because the control API checks its origin. |
| Cloudflare Quick Tunnel does not start | Check for an existing `~/.cloudflared/config.yaml`; the Quick Tunnel guide documents this limitation. Use ngrok or your existing configured tunnel instead. |
| Agent fails to start | Check Terminal B, Agora project services and matching App ID/Certificate, and the Jev key in `.env.local`. |
| Speech works but Mac commands fail | Recheck the tunnel URL, local endpoint, Jev credentials and macOS Automation permissions. A successful spoken reply alone does not verify tool access. |
| No microphone or audio | Check the browser's microphone permission and selected input/output devices. |

See [agora/README.md](agora/README.md) for optional extended features and implementation details.

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

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Reuse the inspected official browser client instead of maintaining another RTC UI.
sample="$PWD/.agora-demo/agent-quickstart-python"
revision=bd1af724bed885c39a5a57235b37ec3bb3fd6396

case "${1:-start}" in
  setup) exec ./console.sh setup ;;
  start|console) exec ./console.sh start ;;
  smoke) exec ./console.sh smoke ;;
  browser-setup)
    uv sync
    npm --prefix agora ci
    if [[ ! -d "$sample" ]]; then
      git clone https://github.com/AgoraIO-Conversational-AI/agent-quickstart-python.git "$sample"
      git -C "$sample" checkout --detach "$revision"
    fi
    [[ "$(git -C "$sample" rev-parse HEAD)" == "$revision" ]] || {
      echo "Unexpected quickstart revision at $sample; preserve it and inspect before proceeding." >&2
      exit 1
    }
    (cd "$sample" && bun install --frozen-lockfile)
    # Copy only a presentation overlay; RTC/RTM and transcript handling stay upstream.
    .venv/bin/python - "$sample" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / 'web/src/components/QuickstartPreCallCard.tsx'
s = p.read_text()
s = s.replace("Try Agora&apos;s Voice Agent", "macbrow + Agora")
s = s.replace("Built on Agora&apos;s flagship Conversational AI engine, for effortless\n\t\t\t\tagentic conversations.",
              "Talk to your Mac with Agora Conversational AI. Try: open Chrome,\n\t\t\t\topen a website, or turn the volume down.")
p.write_text(s)
PY
    echo 'Setup complete. Configure .env.agora and TYPESAFE_API_KEY in .env.local; see agora/README.md.'
    ;;
  browser)
    [[ -d "$sample/node_modules" && -d agora/node_modules && -f .env.agora ]] || {
      echo 'Run ./agora.sh browser-setup, then configure .env.agora. See agora/README.md.' >&2
      exit 1
    }
    node agora/server.mjs &
    backend=$!
    cleanup() {
      kill "$backend" "${frontend:-$backend}" 2>/dev/null || true
      wait "$backend" "${frontend:-$backend}" 2>/dev/null || true
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    # Check startup before showing the page; fail if another process owns the port.
    sleep 1
    kill -0 "$backend"
    (cd "$sample/web" && AGENT_BACKEND_URL=http://127.0.0.1:8000 exec bun run dev --hostname 127.0.0.1) &
    frontend=$!
    echo 'Open http://localhost:3000. Keep the HTTPS tunnel to port 8101 running.'
    while kill -0 "$backend" 2>/dev/null && kill -0 "$frontend" 2>/dev/null; do sleep 1; done
    ;;
  *) echo 'Usage: ./agora.sh [setup|start|smoke|browser-setup|browser]' >&2; exit 2 ;;
esac

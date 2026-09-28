#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-start}" in
  setup)
    uv sync
    npm --prefix agora ci
    ./agora/native/build.sh
    echo 'Ready. Configure .env.local and .env.agora, start your HTTPS tunnel, then ./console.sh start.'
    ;;
  start|smoke)
    [[ -f .env.agora && -d agora/node_modules && -x .agora-demo/MacbrowAudio.app/Contents/MacOS/MacbrowAudio ]] || {
      echo 'Run ./console.sh setup, then configure .env.local and .env.agora. See README.md.' >&2
      exit 1
    }
    if [[ "${1:-start}" == smoke ]]; then
      exec node agora/console.mjs --smoke
    fi
    exec node agora/console.mjs
    ;;
  *) echo 'Usage: ./console.sh [setup|start|smoke]' >&2; exit 2 ;;
esac

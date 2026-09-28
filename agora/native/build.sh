#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ "$(uname -s)" == Darwin ]] || { echo 'The voice console requires macOS.' >&2; exit 1; }
scratch="$PWD/.agora-demo/native-build"
bundle="$PWD/.agora-demo/MacbrowAudio.app"
swift build --package-path agora/native --scratch-path "$scratch" -c release
bin_dir="$(swift build --package-path agora/native --scratch-path "$scratch" -c release --show-bin-path)"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Frameworks"
cp "$bin_dir/MacbrowAudio" "$bundle/Contents/MacOS/"
cp agora/native/Info.plist "$bundle/Contents/Info.plist"
# SwiftPM's linked frameworks are copied beside the binary; bundle them for dyld.
for framework in "$bin_dir"/*.framework; do
    [[ -d "$framework" ]] || continue
    ditto "$framework" "$bundle/Contents/Frameworks/$(basename "$framework")"
done
install_name_tool -add_rpath '@executable_path/../Frameworks' "$bundle/Contents/MacOS/MacbrowAudio"
codesign --force --deep --sign - "$bundle"
"$bundle/Contents/MacOS/MacbrowAudio" --check

#!/usr/bin/env sh
# one-file demo of the homepage particles with the zig physics inlined.
# writes zig/demo/dist/index.html
set -eu
cd "$(dirname "$0")/../.."
(cd zig && zig build wasm)
mkdir -p zig/demo/dist
npx -y esbuild@0.24.0 public/js/particles/main.js --bundle --format=esm --external:three --log-level=warning > zig/demo/dist/bundle.js
python3 - <<'PY'
import base64
shell = open("zig/demo/shell.html").read()
wasm = base64.b64encode(open("public/js/particles/physics.wasm", "rb").read()).decode()
bundle = open("zig/demo/dist/bundle.js").read()
open("zig/demo/dist/index.html", "w").write(shell.replace("__WASM__", wasm).replace("__BUNDLE__", bundle))
PY
echo "wrote zig/demo/dist/index.html"

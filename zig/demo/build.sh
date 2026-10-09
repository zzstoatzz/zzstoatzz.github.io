#!/usr/bin/env sh
# one-file demo of the homepage particles with the zig physics inlined.
# writes zig/demo/dist/index.html
set -eu
cd "$(dirname "$0")/../.."
(cd zig && zig build wasm)
mkdir -p zig/demo/dist
echo 'import { initParticles } from "./src/particles/main"; window.particlesInit = initParticles;' |
  npx -y esbuild@0.24.0 --bundle --format=esm --external:three --loader=ts --resolve-extensions=.ts --log-level=warning > zig/demo/dist/bundle.js
python3 - <<'PY'
import base64
shell = open("zig/demo/shell.html").read()
wasm = base64.b64encode(open("src/particles/physics.wasm", "rb").read()).decode()
bundle = open("zig/demo/dist/bundle.js").read()
css = open("src/particles/particles.css").read()
# after the shell's own styles, as the site loads it after globals.css
style = "</style>\n<style>" + css + "</style>"
html = shell.replace("__WASM__", wasm).replace("__BUNDLE__", bundle).replace("</style>", style, 1)
open("zig/demo/dist/index.html", "w").write(html)
PY
echo "wrote zig/demo/dist/index.html"

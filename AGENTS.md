# AGENTS.md

nate's personal site, [zzstoatzz.io](https://zzstoatzz.io): a static Next.js export (App Router, TypeScript, Tailwind) with an interactive particle background whose physics runs in zig/wasm. Pushes to `main` deploy to GitHub Pages (`.github/workflows/deploy.yml`).

## Layout

```
src/app/                  pages (/, about, contact, posts/[slug], tuner, zen → /)
src/app/components/       layout pieces; ParticlesContainer.tsx mounts the particles
src/styles/               globals.css (tailwind), footnotes.css
src/utils/                posts loader, pitch detector (tuner)
posts/                    markdown posts
public/js/particles/      the particle system (plain ES modules, loaded at runtime)
public/manifest.webmanifest, public/sw.js   PWA manifest and offline service worker
zig/                      the particle physics, compiled to public/js/particles/*.wasm
```

## Particles

`ParticlesContainer.tsx` loads `public/js/particles/main.js`, which exposes `window.particlesInit(canvas, overlay)`.

- `particleSystem.js`: the frame loop, input, canvas resizing (shrinking edges push like a piston)
- `wasmPhysics.js`: loads the wasm and runs one physics step per frame
- `particleStore.js`: particle state, one typed array per field; once wasm loads these are views into wasm memory, so nothing is copied per frame
- `particle.js`: spawning and size/color setup
- `webglRenderer.js` (three.js) draws particles and connection lines; `canvasRenderer.js` is the 2D fallback when WebGL is unavailable
- `mouseEffects.js`: hold/release visuals and the release multiplier
- `shapes.js`, `shapeEditor.js`: placeable obstacle shapes
- `settingsManager.js`, `uiController.js`, `config.js` (ranges and defaults), `particles.css`: the settings panel

The homepage is one fixed screen (`html.home-locked`, set in `src/app/page.tsx`): no page scroll or pinch zoom, and layers sized to `100lvh` so they reach under iOS Safari's toolbar.

## Physics (`zig/`)

`zig/src/physics.zig` owns the per-frame physics: spatial hash, pair attraction plus the connection-line buffer, soft walls, mouse force, particle update and shape collisions. `zig/src/wasm.zig` is the export surface JS calls. Particles live in a `std.MultiArrayList`; `resize` is the only call that allocates, and a test enforces that `step` never does, since JS holds raw views into the columns between resizes.

Two builds: `physics.wasm` (simd128, current browsers) and `physics-nosimd.wasm` (baseline wasm, older engines); `wasmPhysics.js` picks one by feature detection. Without wasm the particles draw but don't move.

- `cd zig && zig build test` runs the tests (zig 0.16)
- `cd zig && zig build wasm` rebuilds both wasm files; commit them (CI checks they're current)
- `zig/demo/build.sh` makes a single-file demo page in `zig/demo/dist/`

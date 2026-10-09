# AGENTS.md

nate's personal site, [zzstoatzz.io](https://zzstoatzz.io): a static [Astro](https://astro.build) site (React islands, TypeScript, Tailwind) with an interactive particle background whose physics runs in zig/wasm. Pushes to `main` deploy to GitHub Pages (`.github/workflows/deploy.yml`).

## Layout

```
src/pages/                index (/), about, tuner, 404; astro.config.mjs redirects /zen and /contact
src/layouts/Layout.astro  the one layout: head, the persistent Shell island, page frame and footer
src/components/           React components; Shell.tsx holds everything that outlives a page
src/particles/            the particle system (typescript) and its compiled physics wasm
src/styles/globals.css    tailwind and site styles
src/utils/                pitch detector (tuner)
public/manifest.webmanifest, public/sw.js   PWA manifest and offline service worker
zig/                      the particle physics, compiled to src/particles/*.wasm
```

Navigation goes through Astro's client router (`<ClientRouter />`), so pages swap without a reload. `Shell` (background, particles, nav menu, background switcher, music player) is rendered with `transition:persist`: it survives every navigation, so the music and the particles keep running, and it gets each new page's path as a prop. The particle UI that lives directly on `<body>` (settings panel, shape dock, best-hold badge) is marked with `data-particle-ui` and carried into each new body by `ParticlesContainer.tsx`.

## Particles

`ParticlesContainer.tsx` dynamically imports `src/particles/main.ts` on the client and calls `initParticles(canvas, overlay)`; the running system is also at `window.particleSystem` for poking at from the console. three.js is an npm dependency, split into its own chunk and loaded only once WebGL is tried. `particles.css` is imported by the layout.

- `particleSystem.ts`: the frame loop, input, canvas resizing (shrinking edges push like a piston)
- `wasmPhysics.ts`: loads the wasm (vite emits both files with hashed names) and runs one physics step per frame
- `particleStore.ts`: particle state, one typed array per field; once wasm loads these are views into wasm memory, so nothing is copied per frame
- `particle.ts`: spawning and size/color setup
- `webglRenderer.ts` (three.js) draws particles and connection lines; `canvasRenderer.ts` is the 2D fallback when WebGL is unavailable
- `mouseEffects.ts`: hold/release visuals and the release multiplier
- `shapes.ts`, `shapeEditor.ts`: placeable obstacle shapes
- `settingsManager.ts` (settings mirrored to the URL), `uiController.ts` (the panel), `config.ts` (the `Settings` type, ranges and defaults)
- `dom.ts`: mounts the body-level particle UI
- `particles.css`: styles for the panel, the shape dock and the best-hold badge

The homepage is one fixed screen (`html.home-locked`, set by `components/Home.tsx`): no page scroll or pinch zoom, and layers sized to `100lvh` so they reach under iOS Safari's toolbar.

## Checks

- `bun run lint`: `astro check` (types, strict) and eslint
- `bun run build`: static site in `dist/`

## Physics (`zig/`)

`zig/src/physics.zig` owns the per-frame physics: spatial hash, pair attraction plus the connection-line buffer, soft walls, mouse force, particle update and shape collisions. `zig/src/wasm.zig` is the export surface JS calls. Particles live in a `std.MultiArrayList`; `resize` is the only call that allocates, and a test enforces that `step` never does, since JS holds raw views into the columns between resizes.

Two builds: `physics.wasm` (simd128, current browsers) and `physics-nosimd.wasm` (baseline wasm, older engines); `wasmPhysics.ts` picks one by feature detection. Without wasm the particles draw but don't move.

- `cd zig && zig build test` runs the tests (zig 0.17)
- `cd zig && zig build wasm` rebuilds both wasm files; commit them (CI checks they're current)
- `zig/demo/build.sh` makes a single-file demo page in `zig/demo/dist/`

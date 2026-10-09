// js vs wasm physics, ms per updateParticles() at a few particle counts.
//   node zig/parity/bench.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const js = (f) => path.join(root, "public/js/particles", f);
globalThis.window ??= globalThis;
const { ParticleSystem } = await import(js("particleSystem.js"));
const { Particle } = await import(js("particle.js"));
const { SpatialHash } = await import(js("spatialHash.js"));
const { ShapeField } = await import(js("shapes.js"));
const { DEFAULT_SETTINGS } = await import(js("config.js"));
const { WasmPhysics } = await import(js("wasmPhysics.js"));
const phys = await WasmPhysics.fromBytes(await readFile(js("physics.wasm")));

function system(n, w = 1440, h = 900) {
	const ps = Object.create(ParticleSystem.prototype);
	ps.canvas = { width: w, height: h };
	ps._settings = { ...DEFAULT_SETTINGS, PARTICLE_COUNT: n };
	ps.spatialHash = new SpatialHash();
	ps.shapeField = new ShapeField();
	ps.shapeField.resize(w, h);
	ps.particles = Array.from({ length: n }, () => new Particle(Math.random() * w, Math.random() * h, ps._settings));
	ps.isMouseDown = false;
	ps.mouseEffects = { releaseMultiplier: 1, holdStartTime: null, checkReleaseExpiry() {} };
	ps.useWebGL = true;
	ps._connPos = new Float32Array(200000 * 2 * 3);
	ps._connAlpha = new Float32Array(200000 * 2);
	ps._connColor = new Float32Array(200000 * 2 * 3);
	ps._colorCache = new Map();
	return ps;
}

function time(fn, frames) {
	for (let i = 0; i < 30; i++) fn(); // warm up the jit
	const t0 = performance.now();
	for (let i = 0; i < frames; i++) fn();
	return (performance.now() - t0) / frames;
}

for (const n of [700, 3000, 8000, 15000]) {
	const a = system(n);
	const b = system(n);
	const frames = n > 5000 ? 60 : 200;
	const tj = time(() => a.updateParticles(16.67), frames);
	const tw = time(() => phys.step(b, 16.67), frames);
	console.log(`${String(n).padStart(5)} particles: js ${tj.toFixed(2)} ms, wasm ${tw.toFixed(2)} ms (${(tj / tw).toFixed(1)}x)`);
}

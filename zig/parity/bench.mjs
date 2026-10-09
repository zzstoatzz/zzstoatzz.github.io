// js vs wasm physics, ms per updateParticles() at a few particle counts.
//   node zig/parity/bench.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const js = (f) => path.join(root, "public/js/particles", f);
globalThis.window ??= globalThis;
const { ParticleSystem } = await import(js("particleSystem.js"));
const { ParticleStore } = await import(js("particleStore.js"));
const { spawnParticle } = await import(js("particle.js"));
const { SpatialHash } = await import(js("spatialHash.js"));
const { ShapeField } = await import(js("shapes.js"));
const { DEFAULT_SETTINGS } = await import(js("config.js"));
const { WasmPhysics } = await import(js("wasmPhysics.js"));
const wasmBytes = await readFile(js("physics.wasm"));

async function system(n, wasm, w = 1440, h = 900) {
	const ps = Object.create(ParticleSystem.prototype);
	ps.canvas = { width: w, height: h };
	ps._settings = { ...DEFAULT_SETTINGS, PARTICLE_COUNT: n };
	ps.spatialHash = new SpatialHash();
	ps.shapeField = new ShapeField();
	ps.shapeField.resize(w, h);
	ps.store = new ParticleStore();
	ps.store.resize(n);
	for (let i = 0; i < n; i++) spawnParticle(ps.store, i, Math.random() * w, Math.random() * h, ps._settings);
	if (wasm) {
		ps.wasm = await WasmPhysics.fromBytes(wasmBytes);
		ps.wasm.attach(ps.store);
	}
	ps.isMouseDown = false;
	ps.mouseEffects = { releaseMultiplier: 1, holdStartTime: null, checkReleaseExpiry() {} };
	ps.useWebGL = true;
	ps._connPos = new Float32Array(200000 * 2 * 3);
	ps._connAlpha = new Float32Array(200000 * 2);
	ps._connColor = new Float32Array(200000 * 2 * 3);
	return ps;
}

// Two warmup passes, then five measured passes; per-frame ms for each pass.
function passes(fn, frames) {
	const out = [];
	for (let pass = 0; pass < 7; pass++) {
		const t0 = performance.now();
		for (let i = 0; i < frames; i++) fn();
		if (pass >= 2) out.push((performance.now() - t0) / frames);
	}
	return out.sort((x, y) => x - y);
}

// Every particle finite and inside the canvas, so a fast step that broke the
// simulation can't post a good number.
function check(ps) {
	const { x, y, count } = ps.store;
	for (let i = 0; i < count; i++) {
		if (!(x[i] >= 0 && x[i] <= ps.canvas.width && y[i] >= 0 && y[i] <= ps.canvas.height)) {
			throw new Error(`particle ${i} escaped: ${x[i]}, ${y[i]}`);
		}
	}
}

const fmt = (t) => `${t[2].toFixed(2)} ms (${t[0].toFixed(2)}–${t[4].toFixed(2)})`;
console.log("median per-frame ms over 5 passes (min–max), after 2 warmups");
for (const n of [700, 3000, 8000, 15000]) {
	const a = await system(n, false);
	const b = await system(n, true);
	const frames = n > 5000 ? 30 : 100;
	const tj = passes(() => a.updateParticles(16.67), frames);
	const tw = passes(() => b.wasm.step(b, 16.67), frames);
	check(a);
	check(b);
	console.log(`${String(n).padStart(5)} particles: js ${fmt(tj)}, wasm ${fmt(tw)}, ${(tj[2] / tw[2]).toFixed(1)}x`);
}

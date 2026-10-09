// Property-based parity: random particle systems stepped by the real JS
// physics (public/js/particles) and by the zig/wasm port must agree bit for
// bit on every particle field and every connection-buffer float.
//
//   node zig/parity/parity.mjs [cases=300] [seed=1]
//
// Math.random is swapped for a seeded generator; the draws the JS path makes
// are recorded and replayed into wasm, so wall/shape jitter lines up.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const js = (f) => path.join(root, "public/js/particles", f);

// the modules only touch the DOM inside constructors we never call
globalThis.window ??= globalThis;

const { ParticleSystem } = await import(js("particleSystem.js"));
const { ParticleStore } = await import(js("particleStore.js"));
const { SpatialHash } = await import(js("spatialHash.js"));
const { ShapeField, SHAPE_TYPES } = await import(js("shapes.js"));
const { PARTICLE_COLORS, DEFAULT_SETTINGS } = await import(js("config.js"));
const { WasmPhysics } = await import(js("wasmPhysics.js"));

const wasmBytes = await readFile(js("physics.wasm"));

// mulberry32
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const realRandom = Math.random;
const realNow = performance.now.bind(performance);

function genCase(seed) {
	const r = rng(seed);
	const pick = (lo, hi) => lo + r() * (hi - lo);
	const oneOf = (xs) => xs[Math.floor(r() * xs.length)];

	const width = Math.round(pick(120, 1400));
	const height = Math.round(pick(120, 1000));
	const settings = {
		...DEFAULT_SETTINGS,
		INTERACTION_RADIUS: oneOf([60, 10, 300, Math.round(pick(10, 300) / 5) * 5]),
		ATTRACT: oneOf([-100, 0, 1000, -1000, Math.round(pick(-1000, 1000))]),
		SMOOTHING_FACTOR: oneOf([0.13, 0.01, pick(0.01, 0.3)]),
		CONNECTION_OPACITY: oneOf([0.05, 0, 0.5, pick(0, 0.5)]),
		GRAVITY: oneOf([0, 0, pick(-25, 25)]),
		DRAG: oneOf([0.05, 0, 0.2, pick(0, 0.2)]),
		ELASTICITY: oneOf([0.8, 0.1, 1, pick(0.1, 1)]),
		EXPLOSION_RADIUS: pick(50, 500),
		EXPLOSION_FORCE: oneOf([1, 0, 30, pick(0, 30)]),
		ENABLE_VORTEX_FORCE: r() < 0.5,
	};
	const n = oneOf([1, 2, 50, Math.floor(pick(1, 1500))]);
	const layout = oneOf(["uniform", "cluster", "walls", "outside"]);
	const cx = pick(0, width);
	const cy = pick(0, height);
	const vscale = oneOf([0.1, 2, 50]);
	const parts = [];
	for (let i = 0; i < n; i++) {
		let x;
		let y;
		if (layout === "uniform") [x, y] = [r() * width, r() * height];
		else if (layout === "cluster") [x, y] = [cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 40];
		else if (layout === "walls") [x, y] = [oneOf([r() * 3, width - r() * 3]), r() * height];
		else [x, y] = [pick(-200, width + 200), pick(-200, height + 200)];
		const radius = Math.max(0.5, Math.min(10, settings.AVERAGE_PARTICLE_SIZE * (1 + (r() * 2 - 1) * 0.6)));
		parts.push({
			x, y,
			vx: (r() - 0.5) * 2 * vscale,
			vy: (r() - 0.5) * 2 * vscale,
			radius,
			mass: Math.PI * radius * radius,
			color: oneOf(PARTICLE_COLORS),
		});
	}
	const shapes = [];
	const nShapes = oneOf([0, 0, 1, 3]);
	for (let k = 0; k < nShapes; k++) {
		shapes.push({ type: oneOf(SHAPE_TYPES), x: pick(0, width), y: pick(0, height), r: pick(14, 200) });
	}
	const mouse = {
		down: r() < 0.4,
		x: pick(0, width),
		y: pick(0, height),
		holdMs: oneOf([0, 300, 2500, pick(0, 8000)]),
		releaseMultiplier: oneOf([1, 1, pick(1, 6)]),
	};
	const steps = 1 + Math.floor(r() * 6);
	const dts = Array.from({ length: steps }, () => oneOf([16.67, 8.33, 100, pick(0, 100)]));
	const useWebGL = r() < 0.7;
	return { seed, width, height, settings, parts, shapes, mouse, dts, useWebGL };
}

// wasm: attach the store to this module so the particles live in its memory
function buildSystem(c, now, wasm = null) {
	const ps = Object.create(ParticleSystem.prototype);
	ps.canvas = { width: c.width, height: c.height };
	ps._settings = { ...c.settings };
	ps.spatialHash = new SpatialHash();
	ps.shapeField = new ShapeField();
	ps.shapeField.resize(c.width, c.height);
	for (const s of c.shapes) ps.shapeField.add(s.type, s.x, s.y, s.r, null);
	ps.store = new ParticleStore();
	ps.store.resize(c.parts.length);
	c.parts.forEach((q, i) => {
		for (const f of ["x", "y", "vx", "vy", "radius", "mass"]) ps.store[f][i] = q[f];
		ps.store.color[i] = PARTICLE_COLORS.indexOf(q.color);
	});
	if (wasm) wasm.attach(ps.store);
	ps.isMouseDown = c.mouse.down;
	ps.mouseX = c.mouse.x;
	ps.mouseY = c.mouse.y;
	ps.mouseEffects = {
		holdStartTime: c.mouse.down && c.mouse.holdMs > 0 ? now - c.mouse.holdMs : null,
		releaseMultiplier: c.mouse.releaseMultiplier,
		releaseEndTime: null,
		checkReleaseExpiry() {},
	};
	ps.useWebGL = c.useWebGL;
	ps._connPos = new Float32Array(200000 * 2 * 3);
	ps._connAlpha = new Float32Array(200000 * 2);
	ps._connColor = new Float32Array(200000 * 2 * 3);
	ps._connVertCount = 0;
	ps.deltaTime = 0;
	return ps;
}

function same(a, b) {
	return Object.is(a, b);
}

const cases = Number(process.argv[2] || 300);
const baseSeed = Number(process.argv[3] || 1);
const phys = await WasmPhysics.fromBytes(wasmBytes);
const NOW = 1_000_000;
let failures = 0;
let stepsRun = 0;
let pairsChecked = 0;

for (let k = 0; k < cases; k++) {
	const c = genCase(baseSeed * 1_000_003 + k);

	// --- JS reference ---
	const tape = [];
	const draw = rng(c.seed ^ 0x9e3779b9);
	Math.random = () => {
		const v = draw();
		tape.push(v);
		return v;
	};
	performance.now = () => NOW;
	const ref = buildSystem(c, NOW);
	const snaps = [];
	for (const dt of c.dts) {
		ref.updateParticles(dt);
		snaps.push({
			p: Array.from({ length: ref.store.count }, (_, i) => [ref.store.x[i], ref.store.y[i], ref.store.vx[i], ref.store.vy[i]]),
			verts: ref.useWebGL ? ref._connVertCount : 0,
			pos: ref.useWebGL ? ref._connPos.slice(0, ref._connVertCount * 3) : null,
			alpha: ref.useWebGL ? ref._connAlpha.slice(0, ref._connVertCount) : null,
			col: ref.useWebGL ? ref._connColor.slice(0, ref._connVertCount * 3) : null,
		});
	}
	Math.random = realRandom;
	performance.now = realNow;

	// --- wasm ---
	const sys = buildSystem(c, NOW, phys);
	phys.useTape(tape.length ? tape : [0.5]);
	let bad = null;
	c.dts.forEach((dt, s) => {
		if (bad) return;
		phys.step(sys, dt, NOW);
		stepsRun++;
		const want = snaps[s];
		const st = sys.store;
		for (let i = 0; i < st.count && !bad; i++) {
			const got = [st.x[i], st.y[i], st.vx[i], st.vy[i]];
			for (let f = 0; f < 4; f++) {
				if (!same(got[f], want.p[i][f])) {
					bad = `step ${s} particle ${i} field ${["x", "y", "vx", "vy"][f]}: wasm ${got[f]} js ${want.p[i][f]}`;
					break;
				}
			}
		}
		if (!bad && c.useWebGL) {
			if (sys._connVertCount !== want.verts) bad = `step ${s} connection verts: wasm ${sys._connVertCount} js ${want.verts}`;
			const cmp = (name, a, b, len) => {
				for (let i = 0; i < len && !bad; i++) if (!same(a[i], b[i])) bad = `step ${s} ${name}[${i}]: wasm ${a[i]} js ${b[i]}`;
			};
			cmp("connPos", sys._connPos, want.pos, want.verts * 3);
			cmp("connAlpha", sys._connAlpha, want.alpha, want.verts);
			cmp("connColor", sys._connColor, want.col, want.verts * 3);
			pairsChecked += want.verts / 2;
		}
	});
	if (bad) {
		failures++;
		if (failures <= 10) console.log(`FAIL seed=${c.seed} n=${c.parts.length} shapes=${c.shapes.length} vortex=${c.settings.ENABLE_VORTEX_FORCE}: ${bad}`);
	}
}

console.log(`parity: ${cases - failures}/${cases} cases bit-exact (${stepsRun} steps, ${pairsChecked} connections compared)`);
process.exit(failures ? 1 : 0);

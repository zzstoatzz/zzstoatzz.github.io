// Zig/wasm physics backend. Runs the same per-frame physics as
// ParticleSystem.updateParticles (spatial hash, pair attraction + connection
// buffer, wall push, mouse force, particle update, shape collisions),
// bit-for-bit with the JS path under V8. Source: zig/src/physics.zig.
//
// The wasm module owns the particle state: once attached, the ParticleStore's
// arrays are views into wasm memory, so a step is one call with no copying.

import { PARTICLE_RGB } from "./config.js";

// Inputs to the mouse force, derived exactly as applyMouseForce does.
export function mouseParams(ps, now) {
	ps.mouseEffects.checkReleaseExpiry();
	const fx = ps.mouseEffects;
	const active = ps.isMouseDown || fx.releaseMultiplier > 1;
	const settings = ps._settings;
	const out = {
		active,
		x: ps.mouseX,
		y: ps.mouseY,
		radius: 0,
		force: 0,
		vortex: !!settings.ENABLE_VORTEX_FORCE,
		down: !!ps.isMouseDown,
		spinning: false,
		vortexIntensity: 0,
		speedMultiplier: 1,
	};
	if (!active) return out;

	if (!settings.ENABLE_VORTEX_FORCE) {
		out.radius = settings.EXPLOSION_RADIUS;
		out.force = settings.EXPLOSION_FORCE;
		return out;
	}

	let holdIntensity = 0;
	if (ps.isMouseDown && fx.holdStartTime) {
		const holdDuration = (now - fx.holdStartTime) / 1000;
		holdIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
	}
	if (ps.isMouseDown) {
		const smoothedIntensity = holdIntensity * holdIntensity;
		out.radius = settings.EXPLOSION_RADIUS * (1 + smoothedIntensity * 2);
	} else {
		out.radius = settings.EXPLOSION_RADIUS * fx.releaseMultiplier;
	}
	out.force = settings.EXPLOSION_FORCE * (ps.isMouseDown ? 1 : fx.releaseMultiplier);

	if (ps.isMouseDown && fx.holdStartTime) {
		out.spinning = true;
		const holdDuration = (now - fx.holdStartTime) / 1000;
		out.vortexIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
		out.speedMultiplier = 1 + holdDuration * 0.5;
	}
	return out;
}

export class WasmPhysics {
	static async load(url = new URL("./physics.wasm", import.meta.url)) {
		const res = await fetch(url);
		const bytes = await res.arrayBuffer();
		return WasmPhysics.fromBytes(bytes);
	}

	static async fromBytes(bytes) {
		const { instance } = await WebAssembly.instantiate(bytes, {});
		return new WasmPhysics(instance.exports);
	}

	constructor(exports) {
		this.w = exports;
		this.w.seed((Math.random() * 2 ** 32) >>> 0);
		this._conn = null;
	}

	// Move the store's particles into wasm memory and write the palette.
	attach(store) {
		const w = this.w;
		store.attach(w);
		const palette = new Float64Array(w.memory.buffer, w.palettePtr(), 256 * 3);
		PARTICLE_RGB.forEach((rgb, k) => palette.set(rgb, k * 3));
	}

	// Replay recorded Math.random() draws instead of the internal PRNG (tests).
	useTape(values) {
		const ptr = this.w.useTape(values.length);
		new Float64Array(this.w.memory.buffer, ptr, values.length).set(values);
	}

	// Connection buffer views, rebuilt if wasm memory moved.
	_connViews() {
		const w = this.w;
		const buf = w.memory.buffer;
		if (this._conn?.buffer !== buf) {
			this._conn = {
				buffer: buf,
				pos: new Float32Array(buf, w.connPosPtr(), 200000 * 2 * 3),
				alpha: new Float32Array(buf, w.connAlphaPtr(), 200000 * 2),
				color: new Float32Array(buf, w.connColorPtr(), 200000 * 2 * 3),
			};
		}
		return this._conn;
	}

	// Equivalent of ps.updateParticles(deltaTime) on the given system, whose
	// store must be attached to this module.
	step(ps, deltaTime, now = performance.now()) {
		const w = this.w;
		const s = ps._settings;
		w.setSettings(
			s.INTERACTION_RADIUS,
			s.ATTRACT,
			s.SMOOTHING_FACTOR || 0.3,
			s.CONNECTION_OPACITY,
			s.GRAVITY || 0,
			s.DRAG || 0.01,
			s.ELASTICITY !== undefined ? s.ELASTICITY : 0.8,
			ps.canvas.width,
			ps.canvas.height,
			!!ps.useWebGL,
		);

		const shapes = ps.shapeField.shapes;
		if (!w.setShapeCount(shapes.length)) throw new Error("wasm physics: out of memory");
		for (let k = 0; k < shapes.length; k++) {
			const sh = shapes[k];
			const nm = sh.normals || [];
			const of = sh.offsets || [];
			w.setShape(
				k, sh.type === "circle", sh.x, sh.y, sh.r, of.length,
				nm[0] || 0, nm[1] || 0, nm[2] || 0, nm[3] || 0, nm[4] || 0, nm[5] || 0, nm[6] || 0, nm[7] || 0,
				of[0] || 0, of[1] || 0, of[2] || 0, of[3] || 0,
			);
		}

		const m = mouseParams(ps, now);
		w.setMouse(m.active, m.x, m.y, m.radius, m.force, m.vortex, m.down, m.spinning, m.vortexIntensity, m.speedMultiplier);

		ps.deltaTime = deltaTime / 1000.0;
		if (!w.step(deltaTime)) throw new Error("wasm physics: step failed");
		ps.store.sync();

		const conn = this._connViews();
		ps._connPos = conn.pos;
		ps._connAlpha = conn.alpha;
		ps._connColor = conn.color;
		ps._connVertCount = w.connVerts();
	}
}

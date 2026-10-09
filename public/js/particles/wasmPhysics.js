// The particle physics, compiled from zig/src/physics.zig: spatial hash, pair
// attraction + connection buffer, wall push, mouse force, particle update and
// shape collisions, one call per frame.
//
// The wasm module owns the particle state: once attached, the ParticleStore's
// arrays are views into wasm memory, so a step is one call with no copying.

// Inputs to the mouse force, from the hold/release state in mouseEffects.
function mouseParams(ps, now) {
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

// smallest module using a simd128 instruction: (func (result v128) v128.const 0)
const SIMD_PROBE = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11,
]);

export class WasmPhysics {
	// physics.wasm uses simd128 (safari 16.4+, chrome/firefox 91+); older
	// engines get the same physics built without it.
	static async load() {
		const name = WebAssembly.validate(SIMD_PROBE) ? "physics.wasm" : "physics-nosimd.wasm";
		const url = new URL(`./${name}`, import.meta.url);
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

	// Move the store's particles (and palette) into wasm memory.
	attach(store) {
		store.attach(this.w);
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

	// One physics step for the given system, whose store must be attached to
	// this module.
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
			true, // build connection lines (both renderers draw them)
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

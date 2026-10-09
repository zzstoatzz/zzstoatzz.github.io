// Zig/wasm physics backend. Runs the same per-frame physics as
// ParticleSystem.updateParticles (spatial hash, pair attraction + connection
// buffer, mouse force, particle update, shape collisions), bit-for-bit with
// the JS path under V8. Source: zig/src/physics.zig.
//
// Particle objects stay the source of truth for everything else (renderers,
// settings, shape editor): each step copies state in, steps, and copies the
// moved state back out.

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
		this.n = -1;
		this.buffer = null;
		this.colorIndex = new Map(); // hex -> palette slot
		this.w.seed((Math.random() * 2 ** 32) >>> 0);
	}

	_views() {
		const w = this.w;
		const buf = w.memory.buffer;
		if (buf === this.buffer) return;
		this.buffer = buf;
		const n = Math.max(this.n, 0);
		this.x = new Float64Array(buf, w.xPtr(), n);
		this.y = new Float64Array(buf, w.yPtr(), n);
		this.vx = new Float64Array(buf, w.vxPtr(), n);
		this.vy = new Float64Array(buf, w.vyPtr(), n);
		this.radius = new Float64Array(buf, w.radiusPtr(), n);
		this.mass = new Float64Array(buf, w.massPtr(), n);
		this.color = new Uint8Array(buf, w.colorPtr(), n);
		this.palette = new Float64Array(buf, w.palettePtr(), 256 * 3);
		this.connPos = new Float32Array(buf, w.connPosPtr(), 200000 * 2 * 3);
		this.connAlpha = new Float32Array(buf, w.connAlphaPtr(), 200000 * 2);
		this.connColor = new Float32Array(buf, w.connColorPtr(), 200000 * 2 * 3);
		// palette lives in wasm memory; rewrite it after any move
		for (const [hex, slot] of this.colorIndex) this._writePalette(hex, slot);
	}

	_writePalette(hex, slot) {
		this.palette[slot * 3] = Number.parseInt(hex.slice(1, 3), 16) / 255;
		this.palette[slot * 3 + 1] = Number.parseInt(hex.slice(3, 5), 16) / 255;
		this.palette[slot * 3 + 2] = Number.parseInt(hex.slice(5, 7), 16) / 255;
	}

	_slot(hex) {
		let slot = this.colorIndex.get(hex);
		if (slot === undefined) {
			slot = this.colorIndex.size & 0xff;
			this.colorIndex.set(hex, slot);
			this._writePalette(hex, slot);
		}
		return slot;
	}

	// Replay recorded Math.random() draws instead of the internal PRNG (tests).
	useTape(values) {
		const ptr = this.w.useTape(values.length);
		new Float64Array(this.w.memory.buffer, ptr, values.length).set(values);
		this.buffer = null;
	}

	// Equivalent of ps.updateParticles(deltaTime) on the given system.
	step(ps, deltaTime, now = performance.now()) {
		const w = this.w;
		const particles = ps.particles;
		const n = particles.length;
		if (n !== this.n) {
			if (!w.setCount(n)) throw new Error("wasm physics: out of memory");
			this.n = n;
			this.buffer = null;
		}
		this._views();

		for (let i = 0; i < n; i++) {
			const p = particles[i];
			this.x[i] = p.x;
			this.y[i] = p.y;
			this.vx[i] = p.vx;
			this.vy[i] = p.vy;
			this.radius[i] = p.radius;
			this.mass[i] = p.mass;
			this.color[i] = this._slot(p.color);
		}

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
		w.setShapeCount(shapes.length);
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
		this._views(); // the hash may have grown memory

		for (let i = 0; i < n; i++) {
			const p = particles[i];
			p.x = this.x[i];
			p.y = this.y[i];
			p.vx = this.vx[i];
			p.vy = this.vy[i];
		}

		ps._connPos = this.connPos;
		ps._connAlpha = this.connAlpha;
		ps._connColor = this.connColor;
		ps._connVertCount = w.connVerts();
	}
}

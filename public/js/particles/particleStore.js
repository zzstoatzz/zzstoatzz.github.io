// Particle state as one typed array per field (struct of arrays).
//
// Once the wasm physics attaches, every array is a view straight into the wasm
// module's memory (zig/src/physics.zig keeps the particles in a
// std.MultiArrayList), so physics, renderers and settings all read and write
// the same memory and nothing is copied per frame. Until then the arrays are
// plain JS typed arrays.
//
// Views stay valid until the next resize: the wasm step never grows memory.

import { PARTICLE_COLORS, PARTICLE_RGB, CUSTOM_COLOR, RANGES, hexToRgb } from "./config.js";

const F64_FIELDS = ["x", "y", "vx", "vy", "radius", "mass", "sizeVar"];
const WASM_PTR = {
	x: "xPtr",
	y: "yPtr",
	vx: "vxPtr",
	vy: "vyPtr",
	radius: "radiusPtr",
	mass: "massPtr",
	sizeVar: "sizeVarPtr",
	color: "colorPtr",
};

export class ParticleStore {
	constructor() {
		this.count = 0;
		// bumped whenever radius or color may have changed (resize, settings),
		// so renderers re-upload those only when needed
		this.version = 0;
		this.wasm = null;
		// color index -> rgb / css color; the last slot is the single color
		this.palette = [...PARTICLE_RGB, hexToRgb(RANGES.PARTICLE_COLOR.default)];
		this.paletteHex = [...PARTICLE_COLORS, RANGES.PARTICLE_COLOR.default];
		this._capacity = 0;
		this._alloc(64);
	}

	// JS backend: grow the typed arrays, keeping the first `count` particles.
	_alloc(capacity) {
		for (const f of F64_FIELDS) {
			const next = new Float64Array(capacity);
			if (this[f]) next.set(this[f].subarray(0, this.count));
			this[f] = next;
		}
		const color = new Uint8Array(capacity);
		if (this.color) color.set(this.color.subarray(0, this.count));
		this.color = color;
		this._capacity = capacity;
	}

	// Wasm backend: rebuild the views after the columns moved.
	_view() {
		const w = this.wasm;
		const buf = w.memory.buffer;
		const n = this.count;
		// an empty column's pointer is not a real address
		const ptr = (f) => (n > 0 ? w[WASM_PTR[f]]() : 0);
		for (const f of F64_FIELDS) this[f] = new Float64Array(buf, ptr(f), n);
		this.color = new Uint8Array(buf, ptr("color"), n);
		this._buffer = buf;
	}

	// Set the particle count. Existing particles keep their state; new slots
	// are for the caller to fill.
	resize(n) {
		this.version++;
		if (this.wasm) {
			if (!this.wasm.setCount(n)) throw new Error("wasm physics: out of memory");
			this.count = n;
			this._view();
			return;
		}
		if (n > this._capacity) this._alloc(Math.max(n, this._capacity * 2));
		this.count = n;
	}

	// Set the color used by CUSTOM_COLOR particles.
	setCustomColor(hex) {
		if (this.paletteHex[CUSTOM_COLOR] === hex) return;
		this.paletteHex[CUSTOM_COLOR] = hex;
		this.palette[CUSTOM_COLOR] = hexToRgb(hex);
		this._writePalette();
		this.version++;
	}

	// wasm builds connection colors from its own copy of the palette
	_writePalette() {
		if (!this.wasm) return;
		const out = new Float64Array(this.wasm.memory.buffer, this.wasm.palettePtr(), 256 * 3);
		this.palette.forEach((rgb, k) => out.set(rgb, k * 3));
	}

	// Move the state into wasm memory; from here on the arrays are wasm views.
	attach(wasm) {
		const n = this.count;
		const old = {};
		for (const f of F64_FIELDS) old[f] = this[f].subarray(0, n);
		old.color = this.color.subarray(0, n);
		this.wasm = wasm;
		this.resize(n);
		for (const f of F64_FIELDS) this[f].set(old[f]);
		this.color.set(old.color);
		this._writePalette();
	}

	// Views go stale if wasm memory ever grows outside a resize; cheap guard.
	sync() {
		if (this.wasm && this.wasm.memory.buffer !== this._buffer) this._view();
	}
}

// Particle state as one typed array per field (struct of arrays).
//
// Once the wasm physics attaches, every array is a view straight into the wasm
// module's memory (zig/src/physics.zig keeps the particles in a
// std.MultiArrayList), so physics, renderers and settings all read and write
// the same memory and nothing is copied per frame. Until then the arrays are
// plain JS typed arrays.
//
// Views stay valid until the next resize: the wasm step never grows memory.

import type { Rgb } from "./config";
import { PARTICLE_COLORS, PARTICLE_RGB, CUSTOM_COLOR, RANGES, hexToRgb } from "./config";
import type { PhysicsExports } from "./wasmPhysics";

const F64_FIELDS = ["x", "y", "vx", "vy", "radius", "mass", "sizeVar"] as const;
type F64Field = (typeof F64_FIELDS)[number];
type Field = F64Field | "color";

const WASM_PTR = {
	x: "xPtr",
	y: "yPtr",
	vx: "vxPtr",
	vy: "vyPtr",
	radius: "radiusPtr",
	mass: "massPtr",
	sizeVar: "sizeVarPtr",
	color: "colorPtr",
} as const satisfies Record<Field, keyof PhysicsExports>;

export class ParticleStore {
	count = 0;
	// bumped whenever radius or color may have changed (resize, settings),
	// so renderers re-upload those only when needed
	version = 0;
	wasm: PhysicsExports | null = null;
	// color index -> rgb / css color; the last slot is the single color
	palette: Rgb[] = [...PARTICLE_RGB, hexToRgb(RANGES.PARTICLE_COLOR.default)];
	paletteHex: string[] = [...PARTICLE_COLORS, RANGES.PARTICLE_COLOR.default];

	x = new Float64Array(0);
	y = new Float64Array(0);
	vx = new Float64Array(0);
	vy = new Float64Array(0);
	radius = new Float64Array(0);
	mass = new Float64Array(0);
	sizeVar = new Float64Array(0);
	color = new Uint8Array(0);

	private capacity = 0;
	private buffer: ArrayBuffer | null = null;

	constructor() {
		this.alloc(64);
	}

	// JS backend: grow the typed arrays, keeping the first `count` particles.
	private alloc(capacity: number) {
		for (const f of F64_FIELDS) {
			const next = new Float64Array(capacity);
			next.set(this[f].subarray(0, this.count));
			this[f] = next;
		}
		const color = new Uint8Array(capacity);
		color.set(this.color.subarray(0, this.count));
		this.color = color;
		this.capacity = capacity;
	}

	// Wasm backend: rebuild the views after the columns moved.
	private view(w: PhysicsExports) {
		const buf = w.memory.buffer;
		const n = this.count;
		// an empty column's pointer is not a real address
		const ptr = (f: Field) => (n > 0 ? w[WASM_PTR[f]]() : 0);
		for (const f of F64_FIELDS) this[f] = new Float64Array(buf, ptr(f), n);
		this.color = new Uint8Array(buf, ptr("color"), n);
		this.buffer = buf;
	}

	// Set the particle count. Existing particles keep their state; new slots
	// are for the caller to fill.
	resize(n: number) {
		this.version++;
		if (this.wasm) {
			if (!this.wasm.setCount(n)) throw new Error("wasm physics: out of memory");
			this.count = n;
			this.view(this.wasm);
			return;
		}
		if (n > this.capacity) this.alloc(Math.max(n, this.capacity * 2));
		this.count = n;
	}

	// Set the color used by CUSTOM_COLOR particles.
	setCustomColor(hex: string) {
		if (this.paletteHex[CUSTOM_COLOR] === hex) return;
		this.paletteHex[CUSTOM_COLOR] = hex;
		this.palette[CUSTOM_COLOR] = hexToRgb(hex);
		this.writePalette();
		this.version++;
	}

	// wasm builds connection colors from its own copy of the palette
	private writePalette() {
		if (!this.wasm) return;
		const out = new Float64Array(this.wasm.memory.buffer, this.wasm.palettePtr(), 256 * 3);
		this.palette.forEach((rgb, k) => out.set(rgb, k * 3));
	}

	// Move the state into wasm memory; from here on the arrays are wasm views.
	attach(wasm: PhysicsExports) {
		const n = this.count;
		const old = Object.fromEntries(F64_FIELDS.map((f) => [f, this[f].subarray(0, n)])) as Record<
			F64Field,
			Float64Array
		>;
		const oldColor = this.color.subarray(0, n);
		this.wasm = wasm;
		this.resize(n);
		for (const f of F64_FIELDS) this[f].set(old[f]);
		this.color.set(oldColor);
		this.writePalette();
	}

	// Views go stale if wasm memory ever grows outside a resize; cheap guard.
	sync() {
		if (this.wasm && this.wasm.memory.buffer !== this.buffer) this.view(this.wasm);
	}
}

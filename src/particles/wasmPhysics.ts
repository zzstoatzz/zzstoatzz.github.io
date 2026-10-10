// The particle physics, compiled from zig/src/physics.zig: spatial hash, pair
// attraction + connection buffer, wall push, mouse force, particle update and
// shape collisions, one call per frame.
//
// The wasm module owns the particle state: once attached, the ParticleStore's
// arrays are views into wasm memory, so a step is one call with no copying.
import type { GpuExports } from "./gpuPhysics";
import type { ParticleStore } from "./particleStore";
import type { ParticleSystem } from "./particleSystem";

// zig/src/wasm.zig. Pointers are byte offsets into memory; bools come back as 0/1.
export interface PhysicsExports {
	memory: WebAssembly.Memory;
	setCount(n: number): number;
	xPtr(): number;
	yPtr(): number;
	vxPtr(): number;
	vyPtr(): number;
	radiusPtr(): number;
	massPtr(): number;
	sizeVarPtr(): number;
	colorPtr(): number;
	palettePtr(): number;
	connPosPtr(): number;
	connAlphaPtr(): number;
	connColorPtr(): number;
	connVerts(): number;
	setSettings(
		interactionRadius: number,
		attract: number,
		smoothing: number,
		connectionOpacity: number,
		gravity: number,
		drag: number,
		elasticity: number,
		width: number,
		height: number,
		buildConnections: boolean,
	): void;
	setMouse(
		active: boolean,
		x: number,
		y: number,
		radius: number,
		force: number,
		vortex: boolean,
		down: boolean,
		spinning: boolean,
		vortexIntensity: number,
		speedMultiplier: number,
	): void;
	setShapeCount(n: number): number;
	setShape(
		k: number,
		circle: boolean,
		x: number,
		y: number,
		r: number,
		sides: number,
		...planes: number[] // 8 normal components, then 4 offsets
	): void;
	seed(s: number): void;
	step(deltaMs: number): number;
	// the rest check (gpu.zig Rest) for the cpu path, and waking it
	cpuRest(): number;
	restWake(): void;
}

// The connection lines built by the last step: vertex pairs with (x, y, z)
// positions, one alpha and an rgb color per vertex.
export interface Connections {
	pos: Float32Array;
	alpha: Float32Array;
	color: Float32Array;
	verts: number;
}

export const NO_CONNECTIONS: Connections = {
	pos: new Float32Array(0),
	alpha: new Float32Array(0),
	color: new Float32Array(0),
	verts: 0,
};

const MAX_CONNECTIONS = 200000;

// Inputs to the mouse force, from the hold/release state in mouseEffects.
function mouseParams(ps: ParticleSystem, now: number) {
	ps.mouseEffects.checkReleaseExpiry();
	const fx = ps.mouseEffects;
	const active = ps.isMouseDown || fx.releaseMultiplier > 1;
	const settings = ps.settings;
	const out = {
		active,
		x: ps.mouseX,
		y: ps.mouseY,
		radius: 0,
		force: 0,
		vortex: settings.ENABLE_VORTEX_FORCE,
		down: ps.isMouseDown,
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
	readonly w: PhysicsExports & GpuExports;
	private conn: (Connections & { buffer: ArrayBuffer }) | null = null;

	// physics.wasm uses simd128 (safari 16.4+, chrome/firefox 91+); older
	// engines get the same physics built without it. Each URL is spelled out
	// so the bundler can find and emit both files.
	static async load(): Promise<WasmPhysics> {
		const url = WebAssembly.validate(SIMD_PROBE)
			? new URL("./physics.wasm", import.meta.url)
			: new URL("./physics-nosimd.wasm", import.meta.url);
		const res = await fetch(url);
		const bytes = await res.arrayBuffer();
		return WasmPhysics.fromBytes(bytes);
	}

	static async fromBytes(bytes: BufferSource): Promise<WasmPhysics> {
		const { instance } = await WebAssembly.instantiate(bytes, {});
		return new WasmPhysics(instance.exports as unknown as PhysicsExports & GpuExports);
	}

	constructor(exports: PhysicsExports & GpuExports) {
		this.w = exports;
		this.w.seed((Math.random() * 2 ** 32) >>> 0);
	}

	// Move the store's particles (and palette) into wasm memory.
	attach(store: ParticleStore) {
		store.attach(this.w);
	}

	// Connection buffer views, rebuilt if wasm memory moved.
	private connViews() {
		const w = this.w;
		const buffer = w.memory.buffer;
		if (this.conn?.buffer !== buffer) {
			this.conn = {
				buffer,
				pos: new Float32Array(buffer, w.connPosPtr(), MAX_CONNECTIONS * 2 * 3),
				alpha: new Float32Array(buffer, w.connAlphaPtr(), MAX_CONNECTIONS * 2),
				color: new Float32Array(buffer, w.connColorPtr(), MAX_CONNECTIONS * 2 * 3),
				verts: 0,
			};
		}
		return this.conn;
	}

	// Hand the system's settings, shapes and mouse to zig. Both paths need
	// this before a frame; the gpu path also before a piston push.
	configure(ps: ParticleSystem, now = performance.now()) {
		const w = this.w;
		const s = ps.settings;
		w.setSettings(
			s.INTERACTION_RADIUS,
			s.ATTRACT,
			s.SMOOTHING_FACTOR || 0.3,
			s.CONNECTION_OPACITY,
			s.GRAVITY || 0,
			s.DRAG || 0.01,
			s.ELASTICITY,
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
	}

	// One cpu physics step for the given system, whose store must be attached
	// to this module. Returns whether the crowd has come to rest.
	step(ps: ParticleSystem, deltaTime: number, now = performance.now()): boolean {
		const w = this.w;
		this.configure(ps, now);
		if (!w.step(deltaTime)) throw new Error("wasm physics: step failed");
		ps.store.sync();

		const conn = this.connViews();
		conn.verts = w.connVerts();
		ps.connections = conn;
		return !!w.cpuRest();
	}
}

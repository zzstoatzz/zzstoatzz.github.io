// A still of a look for a link preview: a crowd with the look's settings,
// settled in physics.wasm and drawn the way the renderers draw it
// (webglRenderer.ts, gpu/render.wgsl), as a PNG. scripts/og.ts renders the
// site's own card with it at build; worker/ renders one per shared look.
//
// A card shows the image about 500 px wide, so the frame is laid out at three
// times css px, with the look's crowd as dense as it is on a phone. The crowd
// lives in a world a little larger than the frame, cropped from its middle so
// the walls (and the particles pressed against them) stay out of the picture.
// Obstacle shapes aren't simulated or drawn.
import type { Rgb, Settings } from "./config";
import { COLOR_MODES, hexToRgb } from "./config";
import type { GpuExports } from "./gpuPhysics";
import { spawnParticle } from "./particle";
import { ParticleStore } from "./particleStore";
import type { PhysicsExports } from "./wasmPhysics";

export const WIDTH = 1200;
export const HEIGHT = 630;
const DPR = 3;
const WORLD = 1.15;
// the screen a look's PARTICLE_COUNT fills, in css px
const PHONE = 375 * 812;
// the most particles a frame simulates
const MAX_COUNT = 5000;
// species take this long to settle into creatures; anything else stops once at rest
const SPECIES_FRAMES = 1518;
const MAX_FRAMES = 900;
const FRAME_MS = 1000 / 60;
const BACKGROUND = hexToRgb("#070610"); // BackgroundContext's default
// connection lines are drawn only where they'd show at card size
const VISIBLE_LINE = 0.1;

// mulberry32
export function seeded(s: number) {
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// The look's frame as rgb floats, WIDTH × HEIGHT. `random` places the crowd,
// and the physics' own rng (wall bounces) is the caller's to seed: with both
// seeded, the same settings render the same frame.
export function renderFrame(physics: PhysicsExports & GpuExports, settings: Settings, random: () => number): Float32Array {
	const fw = WIDTH / DPR;
	const fh = HEIGHT / DPR;
	const w = fw * WORLD;
	const h = fh * WORLD;
	const count = Math.min(MAX_COUNT, Math.floor((settings.PARTICLE_COUNT / PHONE) * w * h));
	const species = settings.COLOR_MODE === "species";
	const coverage = settings.CONNECTION_WIDTH * DPR;
	const lines = settings.CONNECTION_OPACITY * coverage >= VISIBLE_LINE;

	const store = new ParticleStore();
	store.attach(physics);
	store.setCustomColor(settings.PARTICLE_COLOR);
	store.resize(count);
	for (let i = 0; i < count; i++) spawnParticle(store, i, random() * w, random() * h, settings, random);

	const s = settings;
	physics.seedSpecies(s.SPECIES_SEED);
	physics.setShapeCount(0);
	physics.setSettings(
		s.INTERACTION_RADIUS, s.ATTRACT, s.SMOOTHING_FACTOR, s.CONNECTION_OPACITY, s.GRAVITY, s.DRAG, s.ELASTICITY,
		w, h, lines, COLOR_MODES.indexOf(s.COLOR_MODE), s.SPECIES_FORCE, s.DYE_SPREAD,
	);
	// (active, x, y, radius, force, vortex, down, spinning, intensity, speed, paint): nobody touching
	physics.setMouse(false, 0, 0, 0, 0, false, false, false, 0, 1, 0);
	physics.restWake();
	for (let f = 0; f < (species ? SPECIES_FRAMES : MAX_FRAMES); f++) {
		physics.step(FRAME_MS);
		if (!species && physics.cpuRest()) break;
	}
	store.sync();

	const px = new Float32Array(WIDTH * HEIGHT * 3);
	for (let i = 0; i < WIDTH * HEIGHT; i++) px.set(BACKGROUND, i * 3);
	const ox = (w - fw) / 2;
	const oy = (h - fh) / 2;
	const at = (x: number, y: number): [number, number] => [(x - ox) * DPR, (y - oy) * DPR];

	if (lines) {
		// additive, each end tinted 70% toward its particle's color (render.wgsl vs_line)
		const conn = hexToRgb(s.CONNECTION_COLOR);
		const verts = physics.connVerts();
		const pos = new Float32Array(physics.memory.buffer, physics.connPosPtr(), verts * 3);
		const alpha = new Float32Array(physics.memory.buffer, physics.connAlphaPtr(), verts);
		const color = new Float32Array(physics.memory.buffer, physics.connColorPtr(), verts * 3);
		const tint = (v: number) => [0, 1, 2].map((k) => conn[k] * 0.3 + color[v * 3 + k] * 0.7) as Rgb;
		for (let v = 0; v < verts; v += 2) {
			const [ax, ay] = at(pos[v * 3], pos[v * 3 + 1]);
			const [bx, by] = at(pos[v * 3 + 3], pos[v * 3 + 4]);
			segment(px, ax, ay, bx, by, tint(v), tint(v + 1), alpha[v] * coverage);
		}
	}

	for (let i = 0; i < store.count; i++) {
		const [cx, cy] = at(store.x[i], store.y[i]);
		disc(px, cx, cy, store.radius[i] * DPR, store.palette[store.color[i]]);
	}
	return px;
}

function blend(px: Float32Array, ix: number, iy: number, c: Rgb, a: number, additive = false) {
	if (ix < 0 || iy < 0 || ix >= WIDTH || iy >= HEIGHT || a <= 0) return;
	const o = (iy * WIDTH + ix) * 3;
	for (let k = 0; k < 3; k++) px[o + k] = additive ? px[o + k] + c[k] * a : px[o + k] * (1 - a) + c[k] * a;
}

function smoothstep(e0: number, e1: number, v: number) {
	const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
}

// the bubble shader, sampled 4x4 per pixel
function disc(px: Float32Array, cx: number, cy: number, r: number, c: Rgb) {
	for (let iy = Math.floor(cy - r); iy <= Math.ceil(cy + r); iy++) {
		for (let ix = Math.floor(cx - r); ix <= Math.ceil(cx + r); ix++) {
			let a = 0;
			let lift = 0;
			for (let sy = 0; sy < 4; sy++) {
				for (let sx = 0; sx < 4; sx++) {
					const d = Math.hypot(ix + (sx + 0.5) / 4 - cx, iy + (sy + 0.5) / 4 - cy) / r;
					if (d > 1) continue;
					a += 1 - smoothstep(0.92, 1, d);
					lift += (1 - smoothstep(0, 0.9, d)) * 0.08;
				}
			}
			if (a === 0) continue;
			const l = lift / 16;
			blend(px, ix, iy, [c[0] + l, c[1] + l, c[2] + l], a / 16);
		}
	}
}

// an additive 1px antialiased line from color ca to cb, sampled every half pixel
function segment(px: Float32Array, ax: number, ay: number, bx: number, by: number, ca: Rgb, cb: Rgb, a: number) {
	const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
	for (let k = 0; k <= steps; k++) {
		const u = k / steps;
		const sx = ax + (bx - ax) * u;
		const sy = ay + (by - ay) * u;
		const c = [0, 1, 2].map((j) => ca[j] + (cb[j] - ca[j]) * u) as Rgb;
		const fx = Math.floor(sx);
		const fy = Math.floor(sy);
		const gx = sx - fx;
		const gy = sy - fy;
		blend(px, fx, fy, c, a * (1 - gx) * (1 - gy), true);
		blend(px, fx + 1, fy, c, a * gx * (1 - gy), true);
		blend(px, fx, fy + 1, c, a * (1 - gx) * gy, true);
		blend(px, fx + 1, fy + 1, c, a * gx * gy, true);
	}
}

// --- a minimal png: 8-bit rgb, unfiltered (the antialiasing noise defeats
// the row filters), one zlib stream

export async function png(rgb: Float32Array): Promise<Uint8Array<ArrayBuffer>> {
	const stride = WIDTH * 3;
	// each row: filter type 0, then the row's bytes
	const raw = new Uint8Array(HEIGHT * (stride + 1));
	for (let y = 0; y < HEIGHT; y++) {
		for (let i = 0; i < stride; i++) {
			raw[y * (stride + 1) + 1 + i] = Math.round(Math.min(1, Math.max(0, rgb[y * stride + i])) * 255);
		}
	}
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, WIDTH);
	view.setUint32(4, HEIGHT);
	ihdr.set([8, 2, 0, 0, 0], 8);
	const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
	return concat([
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", new Uint8Array(0)),
	]);
}

function chunk(type: string, data: Uint8Array) {
	const body = concat([new TextEncoder().encode(type), data]);
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(body, 4);
	view.setUint32(8 + data.length, crc32(body));
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

function crc32(buf: Uint8Array) {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

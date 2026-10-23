// The link preview, dist/og.png: species mode, settled into creatures, run
// by the same physics.wasm the browser runs and drawn the way its renderers
// draw (webglRenderer.ts, gpu/render.wgsl).
//
// A card shows this about 500 px wide, so the frame is laid out at three
// times css px: a phone's density of particles, big enough to read. The
// crowd lives in a world a little larger than the frame, which is cropped
// from its middle so the walls (and the particles pressed against them)
// stay out of the picture. The species table and the crowd were picked by
// eye; wasm floats are deterministic, so every build renders the same frame.
//
//   bun scripts/og.ts [out.png]
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { COLOR_MODES, DEFAULT_SETTINGS, hexToRgb } from "../src/particles/config";
import type { Rgb, Settings } from "../src/particles/config";
import { spawnParticle } from "../src/particles/particle";
import { ParticleStore } from "../src/particles/particleStore";
import { WasmPhysics } from "../src/particles/wasmPhysics";

const WIDTH = 1200;
const HEIGHT = 630;
const DPR = 3;
const WORLD = 1.15;
// particles per css px², a phone's crowd of the saved look this is drawn from
const DENSITY = 1800 / ((WIDTH / DPR) * (HEIGHT / DPR));
// the species table (Physics.seedSpecies) and the crowd (spawn order)
const TABLE = 8;
const CROWD = 3;
const SETTLE_FRAMES = 1518;
const FRAME_MS = 1000 / 60;
const BACKGROUND = hexToRgb("#070610"); // BackgroundContext's default

const settings: Settings = {
	...DEFAULT_SETTINGS,
	AVERAGE_PARTICLE_SIZE: 1.1,
	DRAG: 0.17,
	COLOR_MODE: "species",
};

const out = process.argv[2] ?? "dist/og.png";

// mulberry32: the spawn draws from Math.random, so seeding it seeds the crowd
function seeded(s: number) {
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
Math.random = seeded(CROWD);

// the frame and the world around it, in css px
const fw = WIDTH / DPR;
const fh = HEIGHT / DPR;
const w = fw * WORLD;
const h = fh * WORLD;
const count = Math.floor(DENSITY * w * h);

const { w: physics } = await WasmPhysics.fromBytes(
	readFileSync(new URL("../src/particles/physics.wasm", import.meta.url)),
);
physics.seed(CROWD);
physics.seedSpecies(TABLE);
const store = new ParticleStore();
store.attach(physics);
store.resize(count);
for (let i = 0; i < count; i++) spawnParticle(store, i, Math.random() * w, Math.random() * h, settings);

const s = settings;
// no connection lines (none are drawn)
physics.setSettings(
	s.INTERACTION_RADIUS, s.ATTRACT, s.SMOOTHING_FACTOR, s.CONNECTION_OPACITY, s.GRAVITY, s.DRAG, s.ELASTICITY,
	w, h, false, COLOR_MODES.indexOf(s.COLOR_MODE), s.SPECIES_FORCE, s.DYE_SPREAD,
);
// (active, x, y, radius, force, vortex, down, spinning, intensity, speed, paint): nobody touching
physics.setMouse(false, 0, 0, 0, 0, false, false, false, 0, 1, 0);
for (let f = 0; f < SETTLE_FRAMES; f++) physics.step(FRAME_MS);
store.sync();

// --- drawing: float rgb, blended as the canvas blends, rounded to 8 bits

const px = new Float32Array(WIDTH * HEIGHT * 3);
for (let i = 0; i < WIDTH * HEIGHT; i++) px.set(BACKGROUND, i * 3);

function blend(ix: number, iy: number, c: Rgb, a: number) {
	if (ix < 0 || iy < 0 || ix >= WIDTH || iy >= HEIGHT || a <= 0) return;
	const o = (iy * WIDTH + ix) * 3;
	for (let k = 0; k < 3; k++) px[o + k] = px[o + k] * (1 - a) + c[k] * a;
}

function smoothstep(e0: number, e1: number, v: number) {
	const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
}

// discs: the bubble shader, sampled 4x4 per pixel, in the frame cropped from
// the world's middle
const ox = (w - fw) / 2;
const oy = (h - fh) / 2;
for (let i = 0; i < store.count; i++) {
	const cx = (store.x[i] - ox) * DPR;
	const cy = (store.y[i] - oy) * DPR;
	const r = store.radius[i] * DPR;
	const c = store.palette[store.color[i]];
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
			blend(ix, iy, [c[0] + l, c[1] + l, c[2] + l], a / 16);
		}
	}
}

writeFileSync(out, png(px));
console.log(`og: ${out} (${WIDTH}x${HEIGHT}, ${count} particles)`);

// --- a minimal png: 8-bit rgb, unfiltered (the antialiasing noise defeats
// the row filters), one zlib stream
function png(rgb: Float32Array) {
	const stride = WIDTH * 3;
	const pix = Uint8Array.from(rgb, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
	// each row: filter type 0, then the row's bytes
	const raw = Buffer.alloc(HEIGHT * (stride + 1));
	for (let y = 0; y < HEIGHT; y++) raw.set(pix.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(WIDTH, 0);
	ihdr.writeUInt32BE(HEIGHT, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function chunk(type: string, data: Buffer) {
	const head = Buffer.from(type, "ascii");
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head, data])));
	return Buffer.concat([len, head, data, crc]);
}

function crc32(buf: Buffer) {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

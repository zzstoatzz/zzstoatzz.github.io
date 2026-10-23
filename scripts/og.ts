// The link preview, dist/og.png: a long exposure of the homepage. The same
// physics.wasm the browser runs steps a crowd through a held samus touch,
// each particle's last stretch of frames is drawn as a fading streak (the
// motion a still frame can't show), and the last frame goes on top, drawn the
// way the renderers draw it (webglRenderer.ts, gpu/render.wgsl). The
// connection lines are left out: at card size they're invisible and were most
// of the file. The crowd and the hold are seeded by the commit, so each
// deploy unfurls with its own.
//
//   bun scripts/og.ts [out.png]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { DEFAULT_SETTINGS, hexToRgb } from "../src/particles/config";
import type { Rgb, Settings } from "../src/particles/config";
import { spawnParticle } from "../src/particles/particle";
import { ParticleStore } from "../src/particles/particleStore";
import { WasmPhysics } from "../src/particles/wasmPhysics";

const WIDTH = 1200;
const HEIGHT = 630;
// the frame is laid out in css px at this pixel ratio, like a phone's screen
const DPR = 2;
const COUNT = 900;
const BACKGROUND = hexToRgb("#070610"); // BackgroundContext's default
const FRAME_MS = 1000 / 60;
const SETTLE_FRAMES = 240;
const HOLD_SECONDS = 2.2;
// the shutter: frames of trail behind each particle
const EXPOSURE_FRAMES = 30;

const out = process.argv[2] ?? "dist/og.png";
const commit = process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD").toString().trim();
const seed = Number.parseInt(commit.slice(0, 8), 16) >>> 0;

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
const random = seeded(seed);
Math.random = random;

const w = WIDTH / DPR;
const h = HEIGHT / DPR;
const settings: Settings = { ...DEFAULT_SETTINGS, PARTICLE_COUNT: COUNT, ENABLE_VORTEX_FORCE: true };

const wasm = await WasmPhysics.fromBytes(readFileSync(new URL("../src/particles/physics.wasm", import.meta.url)));
const { w: x } = wasm;
x.seed(seed);
const store = new ParticleStore();
store.attach(x);
store.resize(COUNT);
for (let i = 0; i < COUNT; i++) spawnParticle(store, i, random() * w, random() * h, settings);

function step(mouse: Parameters<typeof x.setMouse>) {
	const s = settings;
	x.setSettings(s.INTERACTION_RADIUS, s.ATTRACT, s.SMOOTHING_FACTOR, s.CONNECTION_OPACITY, s.GRAVITY, s.DRAG, s.ELASTICITY, w, h, true, 0, 0, 0);
	x.setMouse(...mouse);
	x.step(FRAME_MS);
}

const idle: Parameters<typeof x.setMouse> = [false, 0, 0, 0, 0, true, false, false, 0, 1, 0];
for (let f = 0; f < SETTLE_FRAMES; f++) step(idle);

// a samus touch held off-center (wasmPhysics.ts mouseParams), caught mid-spin
const mx = w * (0.35 + random() * 0.3);
const my = h * (0.4 + random() * 0.2);
const radius = Math.min(w, h) * 0.45;
const frames = Math.round(HOLD_SECONDS * 60);
const trail: Float64Array[] = [];
for (let f = 0; f < frames; f++) {
	const t = f / 60;
	const intensity = Math.min(1, Math.log(t + 1) / Math.log(10));
	step([true, mx, my, radius * (1 + intensity * intensity), settings.EXPLOSION_FORCE, true, true, true, intensity, 1 + t * 0.5, 0]);
	store.sync();
	if (f >= frames - EXPOSURE_FRAMES) trail.push(Float64Array.from([...store.x, ...store.y]));
}

// --- drawing, in linear float rgb, then straight to 8 bits like the canvas
const px = new Float32Array(WIDTH * HEIGHT * 3);
for (let i = 0; i < WIDTH * HEIGHT; i++) px.set(BACKGROUND, i * 3);

function blend(ix: number, iy: number, c: Rgb, a: number, additive: boolean) {
	if (ix < 0 || iy < 0 || ix >= WIDTH || iy >= HEIGHT || a <= 0) return;
	const o = (iy * WIDTH + ix) * 3;
	for (let k = 0; k < 3; k++) px[o + k] = additive ? px[o + k] + c[k] * a : px[o + k] * (1 - a) + c[k] * a;
}

// an additive 1px antialiased segment from color ca to cb, sampled every
// half pixel
function segment(ax: number, ay: number, bx: number, by: number, ca: Rgb, cb: Rgb, a: number) {
	const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
	for (let k = 0; k <= steps; k++) {
		const u = k / steps;
		const sx = ax + (bx - ax) * u;
		const sy = ay + (by - ay) * u;
		const c: Rgb = [0, 1, 2].map((j) => ca[j] + (cb[j] - ca[j]) * u) as Rgb;
		const fx = Math.floor(sx);
		const fy = Math.floor(sy);
		const gx = sx - fx;
		const gy = sy - fy;
		blend(fx, fy, c, a * (1 - gx) * (1 - gy), true);
		blend(fx + 1, fy, c, a * gx * (1 - gy), true);
		blend(fx, fy + 1, c, a * (1 - gx) * gy, true);
		blend(fx + 1, fy + 1, c, a * gx * gy, true);
	}
}

// trails: each particle's path over the exposure, in its own color, fading
// in from the oldest frame
const n = store.count;
for (let f = 1; f < trail.length; f++) {
	const a = 0.35 * (f / trail.length) ** 2;
	for (let i = 0; i < n; i++) {
		const ax = trail[f - 1][i] * DPR;
		const ay = trail[f - 1][n + i] * DPR;
		const bx = trail[f][i] * DPR;
		const by = trail[f][n + i] * DPR;
		segment(ax, ay, bx, by, store.palette[store.color[i]], store.palette[store.color[i]], a);
	}
}

// discs: the bubble shader, sampled 4x4 per pixel
for (let i = 0; i < n; i++) {
	const cx = store.x[i] * DPR;
	const cy = store.y[i] * DPR;
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
			blend(ix, iy, [c[0] + l, c[1] + l, c[2] + l], a / 16, false);
		}
	}
}

function smoothstep(e0: number, e1: number, v: number) {
	const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
}

writeFileSync(out, png(px));
console.log(`og: ${out} (${WIDTH}x${HEIGHT}, commit ${commit.slice(0, 7)})`);

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

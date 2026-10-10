/// <reference types="@webgpu/types" />
// The WebGPU path: the physics runs as WGSL compute kernels and the particles
// never leave the gpu. The kernels and every per-frame decision (uniforms,
// substeps, grid size, line budget, rest) live in zig (zig/src/gpu.zig,
// zig/src/gpu/*.wgsl), reached through the same physics.wasm the cpu path
// uses. This file is the bridge: it owns the WebGPU objects, moves bytes and
// records the passes, and draws the particles and lines straight from the
// buffers the kernels wrote, looking like webglRenderer.ts.
//
// The js ParticleStore stays the source of truth for what doesn't move
// (size, mass, color, by particle index = id) and for new particles; once
// uploaded, positions and velocities live only on the gpu.
import type { Settings } from "./config";
import { lineCoverage } from "./config";
import type { ParticleStore } from "./particleStore";
import type { PhysicsExports } from "./wasmPhysics";

// zig/src/wasm.zig, the webgpu part. Pointers are byte offsets into memory.
export interface GpuExports {
	memory: WebAssembly.Memory;
	gpuShaderCount(): number;
	gpuShaderPtr(k: number): number;
	gpuShaderLen(k: number): number;
	gpuShaderUsesCommon(k: number): number;
	gpuCommonPtr(): number;
	gpuCommonLen(): number;
	gpuLineCap(): number;
	gpuMaxShapes(): number;
	gpuUniformsPtr(): number;
	gpuShapesPtr(): number;
	gpuFrame(deltaMs: number): number;
	gpuPrepare(n: number, aux: number): void;
	gpuStats(speedSum: number, wanted: number): number;
}

// gpu.zig Kernel, in order
const K = { count: 0, scan: 1, scatter: 2, step: 3, clamp: 4, compact: 5, piston: 6, render: 7, blit: 8 } as const;
type Kernel = "count" | "scan" | "scatter" | "step" | "clamp" | "compact" | "piston";
const KERNELS: Kernel[] = ["count", "scan", "scatter", "step", "clamp", "compact", "piston"];

// byte sizes of the wgsl structs (gpu/common.wgsl)
const D_SIZE = 24; // moving particle: pos, vel, id
const S_SIZE = 16; // static: radius, mass, color
const P_SIZE = 32; // sorted particle
const L_SIZE = 12; // line: a, b, alpha
const SHAPE_SIZE = 64;
const U_SIZE = 144;
const R_SIZE = 16 * 2 + 16 * 16; // size, connection color, 16 palette slots
const WG = 128;

const B = GPUBufferUsage;

// "#rrggbb" -> [r, g, b] in 0..1
function hex(c: string): [number, number, number] {
	return [1, 3, 5].map((k) => Number.parseInt(c.slice(k, k + 2), 16) / 255) as [number, number, number];
}

export class GpuPhysics {
	readonly canvas: HTMLCanvasElement;
	// particles on the gpu (ids 0..n-1, in no order)
	n = 0;
	// whether zig's rest check says the crowd has settled
	resting = false;
	// called once if the gpu goes away; the cpu path takes over
	onLost: (() => void) | null = null;

	private ctx: GPUCanvasContext;
	private format: GPUTextureFormat;
	private kernels!: Record<Kernel, GPUComputePipeline>;
	private discs!: GPURenderPipeline;
	private linePipe!: GPURenderPipeline;
	private blit!: GPURenderPipeline;
	private lineCap: number;
	private maxShapes: number;

	private uni: GPUBuffer;
	private runi: GPUBuffer;
	private shapes: GPUBuffer;
	private lines: GPUBuffer;
	private args: GPUBuffer;
	private st: GPUBuffer;
	private stRead: GPUBuffer;
	private stBusy = false;
	// sized by particle capacity
	private cap = 0;
	private a!: GPUBuffer;
	private b!: GPUBuffer;
	private slot!: GPUBuffer;
	private stat!: GPUBuffer;
	// sized by grid cells
	private cells = 0;
	private counts!: GPUBuffer;
	private starts!: GPUBuffer;
	private bg!: Record<Kernel | "discs" | "lines", GPUBindGroup>;
	// straight-alpha target the passes draw into, blitted to the canvas
	private target!: GPUTexture;
	private blitBg!: GPUBindGroup;

	private width = 0;
	private height = 0;
	private storeVersion = -1;
	private lost = false;

	static async create(w: PhysicsExports & GpuExports, width: number, height: number): Promise<GpuPhysics | null> {
		if (!("gpu" in navigator) || !navigator.gpu) return null;
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) return null;
		const device = await adapter.requestDevice();
		device.pushErrorScope("validation");
		let gpu: GpuPhysics | null = null;
		try {
			gpu = new GpuPhysics(w, device, width, height);
		} catch (e) {
			console.warn("webgpu physics: setup failed:", e);
		}
		const err = await device.popErrorScope();
		if (err) console.warn("webgpu physics: setup failed:", err.message);
		if (!gpu || err) {
			if (gpu) gpu.dispose();
			else device.destroy();
			return null;
		}
		return gpu;
	}

	private constructor(
		private w: PhysicsExports & GpuExports,
		private device: GPUDevice,
		width: number,
		height: number,
	) {
		this.lineCap = w.gpuLineCap();
		this.maxShapes = w.gpuMaxShapes();
		this.canvas = document.createElement("canvas");
		const ctx = this.canvas.getContext("webgpu");
		if (!ctx) throw new Error("webgpu canvas unavailable");
		this.ctx = ctx;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		ctx.configure({ device, format: this.format, alphaMode: "premultiplied" });

		this.makePipelines();
		this.uni = this.buffer(U_SIZE, B.UNIFORM | B.COPY_DST);
		this.runi = this.buffer(R_SIZE, B.UNIFORM | B.COPY_DST);
		this.shapes = this.buffer(SHAPE_SIZE * this.maxShapes, B.STORAGE | B.COPY_DST);
		this.lines = this.buffer(L_SIZE * this.lineCap, B.STORAGE);
		this.args = this.buffer(16, B.STORAGE | B.INDIRECT | B.COPY_DST);
		this.st = this.buffer(16, B.STORAGE | B.COPY_SRC | B.COPY_DST);
		this.stRead = this.buffer(16, B.MAP_READ | B.COPY_DST);
		this.grow(1024);
		this.growGrid(1024);
		this.resize(width, height);

		device.lost.then((info) => {
			if (this.lost) return;
			this.lost = true;
			console.warn("webgpu physics: device lost:", info.message);
			this.onLost?.();
		});
	}

	private buffer(size: number, usage: number) {
		return this.device.createBuffer({ size: Math.max(16, size), usage });
	}

	private shader(k: number) {
		const w = this.w;
		const text = (ptr: number, len: number) => new TextDecoder().decode(new Uint8Array(w.memory.buffer, ptr, len));
		const src = text(w.gpuShaderPtr(k), w.gpuShaderLen(k));
		const code = w.gpuShaderUsesCommon(k) ? text(w.gpuCommonPtr(), w.gpuCommonLen()) + src : src;
		return this.device.createShaderModule({ code });
	}

	private makePipelines() {
		const d = this.device;
		this.kernels = Object.fromEntries(
			KERNELS.map((name) => [
				name,
				d.createComputePipeline({ layout: "auto", compute: { module: this.shader(K[name]), entryPoint: "main" } }),
			]),
		) as Record<Kernel, GPUComputePipeline>;
		const render = this.shader(K.render);
		const draw = (
			module: GPUShaderModule,
			vs: string,
			fs: string,
			topology: GPUPrimitiveTopology,
			format: GPUTextureFormat,
			blend: GPUBlendState,
		) =>
			d.createRenderPipeline({
				layout: "auto",
				vertex: { module, entryPoint: vs },
				fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
				primitive: { topology },
			});
		// three.js NormalBlending and AdditiveBlending, premultipliedAlpha: false
		const normal: GPUBlendState = {
			color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
			alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
		};
		const additive: GPUBlendState = {
			color: { srcFactor: "src-alpha", dstFactor: "one" },
			alpha: { srcFactor: "src-alpha", dstFactor: "one" },
		};
		const replace: GPUBlendState = {
			color: { srcFactor: "one", dstFactor: "zero" },
			alpha: { srcFactor: "one", dstFactor: "zero" },
		};
		this.discs = draw(render, "vs_disc", "fs_disc", "triangle-strip", "rgba8unorm", normal);
		this.linePipe = draw(render, "vs_line", "fs_line", "line-list", "rgba8unorm", additive);
		this.blit = draw(this.shader(K.blit), "vs_full", "fs_full", "triangle-list", this.format, replace);
	}

	// Room for n particles, keeping the first this.n.
	private grow(n: number) {
		if (n <= this.cap) return;
		const cap = Math.max(n, this.cap * 2, 1024);
		const a = this.buffer(D_SIZE * cap, B.STORAGE | B.COPY_DST | B.COPY_SRC);
		if (this.a && this.n > 0) {
			const enc = this.device.createCommandEncoder();
			enc.copyBufferToBuffer(this.a, 0, a, 0, D_SIZE * this.n);
			this.device.queue.submit([enc.finish()]);
		}
		for (const old of [this.a, this.b, this.slot, this.stat]) old?.destroy();
		this.a = a;
		this.b = this.buffer(P_SIZE * cap, B.STORAGE | B.COPY_SRC);
		this.slot = this.buffer(4 * cap, B.STORAGE);
		this.stat = this.buffer(S_SIZE * cap, B.STORAGE | B.COPY_DST);
		this.cap = cap;
		this.storeVersion = -1;
		if (this.counts) this.bind();
	}

	private growGrid(cells: number) {
		if (cells <= this.cells) return;
		this.cells = Math.max(cells, Math.ceil(this.cells * 1.5));
		this.counts?.destroy();
		this.starts?.destroy();
		this.counts = this.buffer(4 * this.cells, B.STORAGE | B.COPY_DST);
		this.starts = this.buffer(4 * (this.cells + 1), B.STORAGE);
		this.bind();
	}

	private bind() {
		const group = (pipe: GPUComputePipeline | GPURenderPipeline, buffers: GPUBuffer[]) =>
			this.device.createBindGroup({
				layout: pipe.getBindGroupLayout(0),
				entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
			});
		this.bg = {
			count: group(this.kernels.count, [this.uni, this.a, this.counts, this.slot]),
			scan: group(this.kernels.scan, [this.uni, this.counts, this.starts]),
			scatter: group(this.kernels.scatter, [this.uni, this.a, this.starts, this.slot, this.stat, this.b]),
			step: group(this.kernels.step, [this.uni, this.b, this.starts, this.a, this.lines, this.args, this.st, this.shapes]),
			clamp: group(this.kernels.clamp, [this.uni, this.args]),
			// compact writes into b, read as moving particles, then b is copied back
			compact: group(this.kernels.compact, [this.uni, this.a, this.b]),
			piston: group(this.kernels.piston, [this.uni, this.a, this.stat]),
			discs: group(this.discs, [this.runi, this.b]),
			lines: group(this.linePipe, [this.runi, this.b, this.lines]),
		};
	}

	resize(width: number, height: number) {
		const dpr = window.devicePixelRatio || 1;
		this.width = width;
		this.height = height;
		this.canvas.width = Math.max(1, Math.round(width * dpr));
		this.canvas.height = Math.max(1, Math.round(height * dpr));
		this.target?.destroy();
		this.target = this.device.createTexture({
			size: [this.canvas.width, this.canvas.height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.blitBg = this.device.createBindGroup({
			layout: this.blit.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: this.target.createView() }],
		});
	}

	// Copy the zig-packed uniforms (and shapes) to the gpu.
	private uploadUniforms() {
		const w = this.w;
		const mem = w.memory.buffer;
		this.device.queue.writeBuffer(this.uni, 0, mem, w.gpuUniformsPtr(), U_SIZE);
		const u = new Uint32Array(mem, w.gpuUniformsPtr(), U_SIZE / 4);
		const nshapes = u[33];
		if (nshapes > 0) this.device.queue.writeBuffer(this.shapes, 0, mem, w.gpuShapesPtr(), nshapes * SHAPE_SIZE);
		return u;
	}

	// Bring the gpu in line with the store: new particles appended at the end
	// (their index is their id), and sizes/colors when they changed.
	sync(store: ParticleStore) {
		const n = store.count;
		if (n < this.n) this.truncate(n);
		if (n > this.n) {
			this.grow(n);
			const add = n - this.n;
			const buf = new ArrayBuffer(add * D_SIZE);
			const f = new Float32Array(buf);
			const u = new Uint32Array(buf);
			for (let k = 0; k < add; k++) {
				const i = this.n + k;
				const o = k * (D_SIZE / 4);
				f[o] = store.x[i];
				f[o + 1] = store.y[i];
				f[o + 2] = store.vx[i];
				f[o + 3] = store.vy[i];
				u[o + 4] = i;
			}
			this.device.queue.writeBuffer(this.a, this.n * D_SIZE, buf);
			this.n = n;
			this.storeVersion = -1;
		}
		if (store.version !== this.storeVersion) {
			this.storeVersion = store.version;
			const buf = new ArrayBuffer(Math.max(1, n) * S_SIZE);
			const f = new Float32Array(buf);
			const u = new Uint32Array(buf);
			for (let i = 0; i < n; i++) {
				f[i * 4] = store.radius[i];
				f[i * 4 + 1] = store.mass[i];
				u[i * 4 + 2] = store.color[i];
			}
			this.device.queue.writeBuffer(this.stat, 0, buf);
		}
	}

	// Keep only ids below n (the store dropped the rest).
	truncate(n: number) {
		if (n >= this.n) return;
		if (n > 0) {
			this.w.gpuPrepare(this.n, n);
			this.uploadUniforms();
			const enc = this.device.createCommandEncoder();
			this.dispatchOnce(enc, "compact");
			enc.copyBufferToBuffer(this.b, 0, this.a, 0, n * D_SIZE);
			this.device.queue.submit([enc.finish()]);
		}
		this.n = n;
	}

	// The canvas shrank to the size the wasm settings now hold: push the
	// particles past the new edges back in (particleSystem.ts pistonWalls).
	piston() {
		if (this.n === 0) return;
		this.w.gpuPrepare(this.n, 0);
		this.uploadUniforms();
		const enc = this.device.createCommandEncoder();
		this.dispatchOnce(enc, "piston");
		this.device.queue.submit([enc.finish()]);
	}

	private dispatchOnce(enc: GPUCommandEncoder, name: Kernel) {
		const pass = enc.beginComputePass();
		pass.setPipeline(this.kernels[name]);
		pass.setBindGroup(0, this.bg[name]);
		pass.dispatchWorkgroups(Math.ceil(this.n / WG));
		pass.end();
	}

	// One frame: zig packs the inputs (the wasm settings, mouse and shapes
	// must be current), the kernels step the particles, then draw.
	frame(deltaMs: number, store: ParticleStore, settings: Settings) {
		if (this.lost) return;
		this.sync(store);
		const d = this.device;
		const substeps = this.w.gpuFrame(deltaMs);
		const u = this.uploadUniforms();
		const ncells = u[3];
		const buildLines = u[30] !== 0;
		this.growGrid(ncells);

		const enc = d.createCommandEncoder();
		// [vertices per line, lines, 0, 0]: the step appends, clamp caps it
		d.queue.writeBuffer(this.args, 0, new Uint32Array([2, 0, 0, 0]));
		const wg = Math.ceil(this.n / WG);
		if (this.n > 0) {
			for (let s = 0; s < substeps; s++) {
				enc.clearBuffer(this.counts, 0, ncells * 4);
				enc.clearBuffer(this.st);
				if (s > 0) enc.clearBuffer(this.args, 4, 4);
				const pass = enc.beginComputePass();
				const run = (name: Kernel, groups: number) => {
					pass.setPipeline(this.kernels[name]);
					pass.setBindGroup(0, this.bg[name]);
					pass.dispatchWorkgroups(groups);
				};
				run("count", wg);
				run("scan", 1);
				run("scatter", wg);
				run("step", wg);
				run("clamp", 1);
				pass.end();
			}
		}

		// render uniforms: canvas size in css px, connection color, palette
		const r = new Float32Array(R_SIZE / 4);
		r[0] = this.width;
		r[1] = this.height;
		r[2] = lineCoverage(settings);
		r.set(hex(settings.CONNECTION_COLOR), 4);
		store.palette.forEach((rgb, k) => {
			if (k < 16) r.set(rgb, 8 + k * 4);
		});
		d.queue.writeBuffer(this.runi, 0, r);

		const draw = enc.beginRenderPass({
			colorAttachments: [
				{ view: this.target.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
			],
		});
		if (this.n > 0) {
			if (buildLines) {
				draw.setPipeline(this.linePipe);
				draw.setBindGroup(0, this.bg.lines);
				draw.drawIndirect(this.args, 0);
			}
			draw.setPipeline(this.discs);
			draw.setBindGroup(0, this.bg.discs);
			draw.draw(4, this.n);
		}
		draw.end();
		const out = enc.beginRenderPass({
			colorAttachments: [
				{ view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
			],
		});
		out.setPipeline(this.blit);
		out.setBindGroup(0, this.blitBg);
		out.draw(3);
		out.end();

		const read = !this.stBusy && this.n > 0;
		if (read) enc.copyBufferToBuffer(this.st, 0, this.stRead, 0, 16);
		d.queue.submit([enc.finish()]);
		if (read) this.readStats();
	}

	// Feed the step's speed and line counts back to zig, a frame or two late.
	private readStats() {
		this.stBusy = true;
		this.stRead
			.mapAsync(GPUMapMode.READ)
			.then(() => {
				const s = new Uint32Array(this.stRead.getMappedRange().slice(0));
				this.stRead.unmap();
				this.stBusy = false;
				if (!this.lost) this.resting = !!this.w.gpuStats(s[1], s[2]);
			})
			.catch(() => {
				this.stBusy = false;
			});
	}

	dispose() {
		this.lost = true;
		this.device.destroy();
		this.canvas.remove();
	}
}

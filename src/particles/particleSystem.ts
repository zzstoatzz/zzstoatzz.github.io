// The particle system: owns the canvases, the particle store, input and the
// frame loop. Physics runs in wasm (wasmPhysics.ts); drawing goes through
// WebGL when it is available and Canvas 2D otherwise.
import type { Settings } from "./config";
import { spawnParticle, applyParticleSettings, randomColor } from "./particle";
import { ParticleStore } from "./particleStore";
import { SettingsManager } from "./settingsManager";
import { UIController } from "./uiController";
import { CanvasRenderer } from "./canvasRenderer";
import { MouseEffects } from "./mouseEffects";
import { ShapeField } from "./shapes";
import { ShapeEditor } from "./shapeEditor";
import type { Connections } from "./wasmPhysics";
import { NO_CONNECTIONS, WasmPhysics } from "./wasmPhysics";
import type { WebGLParticleRenderer } from "./webglRenderer";

export class ParticleSystem {
	canvas: HTMLCanvasElement;
	store = new ParticleStore();
	// set by applySettings, which first runs while the settings load
	settings!: Settings;
	mouseX = 0;
	mouseY = 0;
	isMouseDown = false;

	// Canvas 2D: draws everything until WebGL is up, then just stays clear
	private ctx: CanvasRenderingContext2D;
	private canvasRenderer: CanvasRenderer;
	// WebGL renderer, null until it loads (or for good if it can't)
	webglRenderer: WebGLParticleRenderer | null = null;
	// mouse effects and shapes draw here, above the particles
	private overlayCanvas: HTMLCanvasElement | null;
	private overlayCtx: CanvasRenderingContext2D;

	mouseEffects: MouseEffects;
	// the connection lines built by the last physics step
	connections: Connections = NO_CONNECTIONS;
	shapeField = new ShapeField();
	settingsManager: SettingsManager;
	shapeEditor: ShapeEditor;
	uiController: UIController;
	private wasmPhysics: WasmPhysics | null = null;

	private animationFrameId: number | null = null;
	private lastTimestamp = 0;
	private singleColor = false;
	private touchStartX = 0;
	private touchStartY = 0;
	private touchScrolling = false;

	constructor(canvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement | null) {
		this.canvas = canvas;
		this.ctx = context2d(canvas);
		this.canvasRenderer = new CanvasRenderer(this.ctx);
		this.overlayCanvas = overlayCanvas;
		this.overlayCtx = overlayCanvas ? context2d(overlayCanvas) : this.ctx;
		this.mouseEffects = new MouseEffects(this.overlayCtx);

		this.shapeField.resize(this.canvas.width, this.canvas.height);

		// loading the URL's settings applies them right away, spawning the particles
		this.settingsManager = new SettingsManager((settings) => this.applySettings(settings));
		this.settings = this.settingsManager.getAllSettings();

		this.shapeEditor = new ShapeEditor(this.shapeField, this.canvas, () => {
			this.settingsManager.updateSetting("SHAPES", this.shapeField.serialize());
		});

		this.uiController = new UIController(
			this,
			(key, value) => this.settingsManager.updateSetting(key, value),
			this.settingsManager.getAllSettings(),
		);

		this.shapeEditor.onDeactivate = () => this.uiController.setShapeModeActive(false);

		window.addEventListener("resize", () => this.resizeCanvas());
		this.resizeCanvas();

		this.init();

		// both load in the background; until then Canvas 2D draws and nothing moves
		this.initWebGL();
		this.initWasmPhysics();
	}

	private async initWasmPhysics() {
		try {
			const wasm = await WasmPhysics.load();
			wasm.attach(this.store);
			this.wasmPhysics = wasm;
			console.log("wasm physics initialized");
		} catch (e) {
			console.warn("wasm physics not available, particles will stay still:", e);
		}
	}

	private async initWebGL() {
		try {
			const { WebGLParticleRenderer } = await import("./webglRenderer");
			const renderer = new WebGLParticleRenderer(this.canvas.width, this.canvas.height);

			// Style and insert the WebGL canvas into the DOM
			const el = renderer.domElement;
			el.id = "particle-webgl";
			el.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;";

			// Insert before the overlay canvas (so overlay draws on top)
			if (this.overlayCanvas?.parentElement) {
				this.overlayCanvas.parentElement.insertBefore(el, this.overlayCanvas);
			} else {
				this.canvas.parentElement?.appendChild(el);
			}

			this.webglRenderer = renderer;

			// Clear the Canvas 2D so stale frames don't show through
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

			console.log("WebGL renderer initialized");
		} catch (e) {
			console.warn("WebGL not available, using Canvas 2D:", e);
		}
	}

	private init() {
		const settings = this.settings;
		this.store.resize(0);
		this.spawnParticles(settings.PARTICLE_COUNT, settings);

		this.bindSystemEvents();
		this.resizeCanvas();
		this.animate();
	}

	resizeCanvas() {
		const parent = this.canvas.parentElement;
		const w = parent ? parent.clientWidth : window.innerWidth;
		const h = parent ? parent.clientHeight : window.innerHeight;
		const oldW = this.canvas.width;
		const oldH = this.canvas.height;

		this.canvas.width = w || window.innerWidth;
		this.canvas.height = h || window.innerHeight;

		// A shrinking edge is a piston: it scoops up every particle it swept past
		// and throws it back inward, faster the farther the edge moved past it.
		// Clamping them in place instead stacks them in a line on the new edge
		// that the soft walls only slowly dissolve.
		const w2 = this.canvas.width;
		const h2 = this.canvas.height;
		if (w2 < oldW || h2 < oldH) this.pistonWalls(w2, h2);

		if (this.overlayCanvas) {
			this.overlayCanvas.width = this.canvas.width;
			this.overlayCanvas.height = this.canvas.height;
		}

		if (this.webglRenderer) {
			this.webglRenderer.resize(this.canvas.width, this.canvas.height);
		}

		if (this.shapeField) {
			this.shapeField.resize(this.canvas.width, this.canvas.height);
		}
	}

	// Bring particles left outside a shrunken canvas back inside, moving
	// inward at the speed of an edge that swept past them over PISTON_FRAMES.
	private pistonWalls(w: number, h: number) {
		const PISTON_FRAMES = 12;
		const s = this.store;
		for (let i = 0; i < s.count; i++) {
			const r = s.radius[i];
			const overX = s.x[i] + r - w;
			if (overX > 0) {
				s.x[i] = w - r - 0.1;
				s.vx[i] = Math.min(s.vx[i], 0) - overX / PISTON_FRAMES;
			}
			const overY = s.y[i] + r - h;
			if (overY > 0) {
				s.y[i] = h - r - 0.1;
				s.vy[i] = Math.min(s.vy[i], 0) - overY / PISTON_FRAMES;
			}
		}
	}

	private bindSystemEvents() {
		this.canvas.style.pointerEvents = "auto";
		this.canvas.style.zIndex = "10";

		document.addEventListener("mousemove", (e) => this.handleMouseMove(e));

		document.addEventListener("mousedown", (e) => {
			if (this.shapeEditor.active) return;
			if (this.isPointInCanvas(e.clientX, e.clientY)) {
				this.isMouseDown = true;
				const rect = this.canvas.getBoundingClientRect();
				this.mouseX = e.clientX - rect.left;
				this.mouseY = e.clientY - rect.top;
				this.mouseEffects.startHold();
			}
		});

		document.addEventListener("mouseup", () => {
			if (this.shapeEditor.active) return;
			this.isMouseDown = false;
			this.mouseEffects.stopHold(
				this.mouseX, this.mouseY,
				this.canvas.width, this.canvas.height,
				this.settings,
			);
		});

		document.addEventListener(
			"touchstart",
			(e) => {
				if (this.shapeEditor.active) return;
				if (e.touches.length > 0) {
					const touch = e.touches[0];
					if (this.isPointInCanvas(touch.clientX, touch.clientY)) {
						const elementsAtPoint = document.elementsFromPoint(touch.clientX, touch.clientY);
						const isUIElement = elementsAtPoint.some((el) =>
							!!el.closest("nav") ||
							el.closest(".particle-controls") ||
							el.closest("button") ||
							el.tagName === "BUTTON" ||
							el.tagName === "A" ||
							el.closest(".z-50"),
						);

						if (!isUIElement) {
							this.isMouseDown = true;
							this.touchStartX = touch.clientX;
							this.touchStartY = touch.clientY;
							this.touchScrolling = false;
							const rect = this.canvas.getBoundingClientRect();
							this.mouseX = touch.clientX - rect.left;
							this.mouseY = touch.clientY - rect.top;
							// don't preventDefault here — let the browser keep the
							// option to scroll until we know this is a stationary hold
							this.mouseEffects.startHold();
						}
					}
				}
			},
			{ passive: false },
		);

		document.addEventListener(
			"touchmove",
			(e) => {
				if (this.shapeEditor.active) return;
				if (e.touches.length > 0 && this.isMouseDown) {
					const touch = e.touches[0];

					// On a scrollable page (content routes like /about), scrolling
					// must always win. We never preventDefault here: iOS commits the
					// scroll-vs-no-scroll decision on the first touchmove, so a single
					// early preventDefault would lock out scroll for the whole gesture.
					// Once the finger moves, cancel the hold so no effect fires.
					if (this.isPageScrollable()) {
						if (!this.touchScrolling) {
							const dx = touch.clientX - this.touchStartX;
							const dy = touch.clientY - this.touchStartY;
							if (Math.hypot(dx, dy) > 10) {
								this.touchScrolling = true;
								this.isMouseDown = false;
								this.mouseEffects.cancelHold();
							}
						}
						return;
					}

					// Non-scrollable page (homepage): drag the effect with the finger
					// and suppress the browser's overscroll/bounce.
					this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
					e.preventDefault();
				}
			},
			{ passive: false },
		);

		document.addEventListener("touchend", () => {
			if (this.shapeEditor.active) return;
			this.isMouseDown = false;
			this.mouseEffects.stopHold(
				this.mouseX, this.mouseY,
				this.canvas.width, this.canvas.height,
				this.settings,
			);
		});
	}

	// True when the document is taller than the viewport, i.e. the user can
	// scroll. On such pages touch must scroll the page, not drive particles.
	private isPageScrollable() {
		if (document.documentElement.classList.contains("home-locked")) return false;
		return document.documentElement.scrollHeight > window.innerHeight + 1;
	}

	private isPointInCanvas(clientX: number, clientY: number) {
		const rect = this.canvas.getBoundingClientRect();
		return (
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom
		);
	}

	private handleMouseMove(e: { clientX: number; clientY: number }) {
		if (this.isPointInCanvas(e.clientX, e.clientY)) {
			const rect = this.canvas.getBoundingClientRect();
			this.mouseX = e.clientX - rect.left;
			this.mouseY = e.clientY - rect.top;
		}
	}

	private applySettings(settings: Settings) {
		this.settings = { ...settings };

		const serialized = settings.SHAPES || "";
		if (this.shapeField && serialized !== this.shapeField.serialize()) {
			this.shapeField.deserialize(serialized);
		}

		const s = this.store;
		for (let i = 0; i < s.count; i++) applyParticleSettings(s, i, settings);
		s.version++;

		s.setCustomColor(settings.PARTICLE_COLOR);
		const single = settings.PARTICLE_SINGLE_COLOR;
		if (single !== this.singleColor) {
			this.singleColor = single;
			this.recolor(settings);
		}

		const targetCount = settings.PARTICLE_COUNT;
		if (targetCount > s.count) this.spawnParticles(targetCount - s.count, settings);
		else if (targetCount < s.count) s.resize(targetCount);
	}

	// New colors for every particle: a fresh random mix, or all the single color.
	private recolor(settings = this.settings) {
		const s = this.store;
		for (let i = 0; i < s.count; i++) s.color[i] = randomColor(settings);
		s.version++;
	}

	// "randomize colors": back to the mix if one color was on, then reshuffle.
	randomizeColors() {
		if (this.settings.PARTICLE_SINGLE_COLOR) {
			this.settingsManager.updateSetting("PARTICLE_SINGLE_COLOR", false);
			this.uiController.updateUI(this.settingsManager.getAllSettings());
		}
		this.recolor(this.settingsManager.getAllSettings());
	}

	// Append n particles at random positions.
	private spawnParticles(n: number, settings: Settings) {
		const s = this.store;
		const start = s.count;
		s.resize(start + n);
		for (let i = start; i < start + n; i++) {
			const x = Math.random() * this.canvas.width;
			const y = Math.random() * this.canvas.height;
			spawnParticle(s, i, x, y, settings);
		}
	}

	// The physics is zig/wasm (zig/src/physics.zig, see wasmPhysics.js). Until
	// the module loads, or if it can't, the particles are drawn but stay put.
	private updateParticles(deltaTime: number) {
		if (!this.wasmPhysics) return;
		try {
			this.wasmPhysics.step(this, deltaTime);
		} catch (e) {
			console.warn("wasm physics failed:", e);
			this.wasmPhysics = null;
		}
	}

	private animate(timestamp = 0) {
		const elapsed = timestamp - (this.lastTimestamp || timestamp);
		this.lastTimestamp = timestamp;
		// never negative: a restarted loop starts from timestamp 0
		const deltaTime = Math.max(0, Math.min(elapsed, 100));

		this.settings = this.settingsManager.getAllSettings();

		// Physics (same for both paths)
		this.updateParticles(deltaTime);

		const conn = this.connections;
		if (this.webglRenderer) {
			// --- WebGL path ---
			// Clear overlay for mouse effects
			if (this.overlayCanvas) {
				this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
			}

			// Upload particle data and pre-built connections to GPU, then render
			this.webglRenderer.updateParticles(this.store, this.store.count);
			this.webglRenderer.uploadConnections(conn.pos, conn.alpha, conn.color, conn.verts, this.settings);
			this.webglRenderer.render();

			this.shapeField.draw(this.overlayCtx, this.shapeEditor.preview, this.shapeEditor.selected);

			// Mouse effects on overlay (Canvas 2D)
			this.mouseEffects.updateAndDraw(
				timestamp, this.mouseX, this.mouseY, this.isMouseDown, this.settings,
			);
		} else {
			// --- Canvas 2D fallback ---
			this.canvasRenderer.clear(this.canvas.width, this.canvas.height);

			if (this.overlayCanvas) {
				this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
			}

			this.canvasRenderer.drawConnections(conn.pos, conn.alpha, conn.verts, this.settings);

			this.mouseEffects.updateAndDraw(
				timestamp, this.mouseX, this.mouseY, this.isMouseDown, this.settings,
			);

			this.canvasRenderer.drawParticles(this.store, this.store.count);

			// Shapes on the overlay so they occlude particles drawn beneath them.
			this.shapeField.draw(this.overlayCtx, this.shapeEditor.preview, this.shapeEditor.selected);
		}

		this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
	}

	stop() {
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	// Respawn every particle. Events are bound once, in init.
	restart() {
		this.stop();
		this.lastTimestamp = 0;
		this.store.resize(0);
		this.spawnParticles(this.settings.PARTICLE_COUNT, this.settings);
		this.animate();
	}
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d context unavailable");
	return ctx;
}

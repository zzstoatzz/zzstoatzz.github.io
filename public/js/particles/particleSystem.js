import { spawnParticle, applyParticleSettings, updateParticle, randomColor } from "./particle.js";
import { ParticleStore } from "./particleStore.js";
import { SettingsManager } from "./settingsManager.js";
import { UIController } from "./uiController.js";
import { PARTICLE_COLORS } from "./config.js";
import { SpatialHash } from "./spatialHash.js";
import { CanvasRenderer } from "./canvasRenderer.js";
import { MouseEffects } from "./mouseEffects.js";
import { ShapeField } from "./shapes.js";
import { ShapeEditor } from "./shapeEditor.js";
import { WasmPhysics } from "./wasmPhysics.js";

export class ParticleSystem {
	constructor(canvas, overlayCanvas) {
		this.canvas = canvas;
		this.ctx = this.canvas.getContext("2d");
		this.store = new ParticleStore();
		this.spatialHash = new SpatialHash();
		this.mouseX = 0;
		this.mouseY = 0;
		this.isMouseDown = false;
		this.animationFrameId = null;
		this.deltaTime = 0;
		this.lastTimestamp = 0;

		// Canvas 2D renderer (fallback)
		this.canvasRenderer = new CanvasRenderer(this.ctx);

		// WebGL renderer (initialized async, null until ready)
		this.webglRenderer = null;
		this.useWebGL = false;

		// Overlay canvas for mouse effects
		this.overlayCanvas = overlayCanvas || null;
		this.overlayCtx = this.overlayCanvas
			? this.overlayCanvas.getContext("2d")
			: this.ctx;

		this.mouseEffects = new MouseEffects(this.overlayCtx);

		// Pre-allocated connection buffers (used in combined physics pass)
		this._connPos = new Float32Array(200000 * 2 * 3);
		this._connAlpha = new Float32Array(200000 * 2);
		this._connColor = new Float32Array(200000 * 2 * 3);
		this._connVertCount = 0;

		this.PARTICLE_COLORS = PARTICLE_COLORS;

		this.shapeField = new ShapeField();
		this.shapeField.resize(this.canvas.width, this.canvas.height);

		this.settingsManager = new SettingsManager((settings) => {
			this.applySettings(settings);
		});

		this.shapeEditor = new ShapeEditor(this.shapeField, this.canvas, () => {
			this.settingsManager.updateSetting("SHAPES", this.shapeField.serialize());
		});

		this.uiController = new UIController((key, value) => {
			this.settingsManager.updateSetting(key, value);
		}, this.settingsManager.getAllSettings());

		this.shapeEditor.onDeactivate = () => this.uiController.setShapeModeActive(false);

		this._settings = this.settingsManager.getAllSettings();

		window.addEventListener("resize", () => this.resizeCanvas());
		this.resizeCanvas();

		this.init();

		// Try to initialize WebGL (non-blocking)
		this._initWebGL();

		// Zig/wasm physics (non-blocking). Same results as the JS path;
		// ?physics=js forces the JS path.
		this.wasmPhysics = null;
		this._initWasmPhysics();
	}

	async _initWasmPhysics() {
		try {
			if (new URLSearchParams(window.location.search).get("physics") === "js") return;
			const wasm = await WasmPhysics.load(new URL("./physics.wasm", import.meta.url));
			wasm.attach(this.store);
			this.wasmPhysics = wasm;
			console.log("wasm physics initialized");
		} catch (e) {
			console.warn("wasm physics not available, using JS:", e);
		}
	}

	async _initWebGL() {
		try {
			const { WebGLParticleRenderer } = await import("./webglRenderer.js");
			const renderer = new WebGLParticleRenderer(this.canvas.width, this.canvas.height);

			// Style and insert the WebGL canvas into the DOM
			const el = renderer.domElement;
			el.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;";

			// Insert before the overlay canvas (so overlay draws on top)
			if (this.overlayCanvas && this.overlayCanvas.parentElement) {
				this.overlayCanvas.parentElement.insertBefore(el, this.overlayCanvas);
			} else {
				this.canvas.parentElement.appendChild(el);
			}

			this.webglRenderer = renderer;
			this.useWebGL = true;

			// Clear the Canvas 2D so stale frames don't show through
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

			console.log("WebGL renderer initialized");
		} catch (e) {
			console.warn("WebGL not available, using Canvas 2D:", e);
		}
	}

	init() {
		const settings = this._settings;
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

		// Stretch the particles with the canvas. Left alone, a shrink clamps
		// everything outside onto the new edges as a crust the soft walls take
		// ages to dissolve, and a grow leaves the new area empty.
		const sx = this.canvas.width / oldW;
		const sy = this.canvas.height / oldH;
		if (oldW > 0 && oldH > 0 && (sx !== 1 || sy !== 1)) {
			const s = this.store;
			for (let i = 0; i < s.count; i++) {
				s.x[i] *= sx;
				s.y[i] *= sy;
			}
		}

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

	bindSystemEvents() {
		this.canvas.style.pointerEvents = "auto";
		this.canvas.style.zIndex = "10";

		const style = document.createElement("style");
		style.textContent =
			".particles-canvas {" +
			"position: absolute;" +
			"top: 0;" +
			"left: 0;" +
			"width: 100%;" +
			"height: 100%;" +
			"pointer-events: auto;" +
			"z-index: 10;" +
			"}";
		document.head.appendChild(style);

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
				this._settings,
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
							el.closest("nav") ||
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
				this._settings,
			);
		});
	}

	// True when the document is taller than the viewport, i.e. the user can
	// scroll. On such pages touch must scroll the page, not drive particles.
	isPageScrollable() {
		return document.documentElement.scrollHeight > window.innerHeight + 1;
	}

	isPointInCanvas(clientX, clientY) {
		const rect = this.canvas.getBoundingClientRect();
		return (
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom
		);
	}

	handleMouseMove(e) {
		if (this.isPointInCanvas(e.clientX, e.clientY)) {
			const rect = this.canvas.getBoundingClientRect();
			this.mouseX = e.clientX - rect.left;
			this.mouseY = e.clientY - rect.top;
		}
	}

	applySettings(settings) {
		this._settings = { ...settings };

		const serialized = settings.SHAPES || "";
		if (this.shapeField && serialized !== this.shapeField.serialize()) {
			this.shapeField.deserialize(serialized);
		}

		const s = this.store;
		for (let i = 0; i < s.count; i++) applyParticleSettings(s, i, settings);
		s.version++;

		s.setCustomColor(settings.PARTICLE_COLOR);
		const single = !!settings.PARTICLE_SINGLE_COLOR;
		if (single !== !!this._singleColor) {
			this._singleColor = single;
			this.recolor(settings);
		}

		const targetCount = settings.PARTICLE_COUNT;
		if (targetCount > s.count) this.spawnParticles(targetCount - s.count, settings);
		else if (targetCount < s.count) s.resize(targetCount);
	}

	// New colors for every particle: a fresh random mix, or all the single color.
	recolor(settings = this._settings) {
		const s = this.store;
		for (let i = 0; i < s.count; i++) s.color[i] = randomColor(settings);
		s.version++;
	}

	// "randomize colors": back to the mix if one color was on, then reshuffle.
	randomizeColors() {
		if (this._settings.PARTICLE_SINGLE_COLOR) {
			this.settingsManager.updateSetting("PARTICLE_SINGLE_COLOR", false);
			this.uiController.updateUI(this.settingsManager.getAllSettings());
		}
		this.recolor(this.settingsManager.getAllSettings());
	}

	// Append n particles at random positions.
	spawnParticles(n, settings) {
		const s = this.store;
		const start = s.count;
		s.resize(start + n);
		for (let i = start; i < start + n; i++) {
			const x = Math.random() * this.canvas.width;
			const y = Math.random() * this.canvas.height;
			spawnParticle(s, i, x, y, settings);
		}
	}

	applyMouseForce() {
		this.mouseEffects.checkReleaseExpiry();

		if (!this.isMouseDown && this.mouseEffects.releaseMultiplier <= 1) return;

		const settings = this._settings;

		let radius, force;
		if (!settings.ENABLE_VORTEX_FORCE) {
			radius = settings.EXPLOSION_RADIUS;
			force = settings.EXPLOSION_FORCE;
		} else {
			let holdIntensity = 0;
			if (this.isMouseDown && this.mouseEffects.holdStartTime) {
				const holdDuration = (performance.now() - this.mouseEffects.holdStartTime) / 1000;
				holdIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
			}

			if (this.isMouseDown) {
				const smoothedIntensity = holdIntensity * holdIntensity;
				radius = settings.EXPLOSION_RADIUS * (1 + smoothedIntensity * 2);
			} else {
				radius = settings.EXPLOSION_RADIUS * this.mouseEffects.releaseMultiplier;
			}

			force = settings.EXPLOSION_FORCE * (this.isMouseDown ? 1 : this.mouseEffects.releaseMultiplier);
		}

		const radiusSq = radius * radius;

		const s = this.store;
		for (const i of this.spatialHash.queryRadius(this.mouseX, this.mouseY, radius, s)) {
			const dx = s.x[i] - this.mouseX;
			const dy = s.y[i] - this.mouseY;
			const distSq = dx * dx + dy * dy;

			if (distSq < radiusSq && distSq > 1e-6) {
				const distance = Math.sqrt(distSq);
				const strength = force * (1 - distance / radius);
				const dirX = dx / distance;
				const dirY = dy / distance;

				if (!settings.ENABLE_VORTEX_FORCE) {
					s.vx[i] += dirX * strength;
					s.vy[i] += dirY * strength;
				} else {
					const radialForce = strength * (this.isMouseDown ? 0.3 : 1.0);
					s.vx[i] += dirX * radialForce;
					s.vy[i] += dirY * radialForce;

					if (this.isMouseDown && this.mouseEffects.holdStartTime) {
						const holdDuration = (performance.now() - this.mouseEffects.holdStartTime) / 1000;
						const vortexIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
						const speedMultiplier = 1 + holdDuration * 0.5;
						const vortexStrength = strength * vortexIntensity * 0.8 * speedMultiplier;

						const tangentX = -dirY;
						const tangentY = dirX;
						s.vx[i] += tangentX * vortexStrength;
						s.vy[i] += tangentY * vortexStrength;
					}
				}
			}
		}
	}

	// With repulsion on, a particle near a wall is pushed by the crowd on one
	// side and by nothing on the other, so the crowd squeezes a crust of
	// particles flat against each wall. Each wall stands in for the missing
	// neighbors: it pushes with the force of the crowd's average density spread
	// over the part of the interaction disc that lies beyond the wall. For a
	// half-plane at distance d that integral is
	//   2 ln((R + q) / d) - 2q / R,  q = sqrt(R^2 - d^2)
	// with d clamped to the smoothing distance like a pair.
	// Mirrored in zig/src/physics.zig (wallForce).
	applyWallForce() {
		const settings = this._settings;
		const r = settings.INTERACTION_RADIUS;
		const attract = settings.ATTRACT;
		const smoothingFactor = settings.SMOOTHING_FACTOR || 0.3;
		if (!(attract <= -1e-6) || r <= 0) return;

		const s = this.store;
		const n = s.count;
		const w = this.canvas.width;
		const h = this.canvas.height;
		let totalMass = 0;
		for (let i = 0; i < n; i++) totalMass += s.mass[i];
		const strength = (attract * this.deltaTime * totalMass) / (w * h);
		const minDist = smoothingFactor * r;
		const push = (d) => {
			const dd = Math.max(d, minDist);
			if (dd >= r) return 0;
			const q = Math.sqrt(r * r - dd * dd);
			return strength * (2 * Math.log((r + q) / dd) - (2 * q) / r);
		};

		for (let i = 0; i < n; i++) {
			const x = s.x[i];
			const y = s.y[i];
			if (x < r) s.vx[i] -= push(x);
			if (w - x < r) s.vx[i] += push(w - x);
			if (y < r) s.vy[i] -= push(y);
			if (h - y < r) s.vy[i] += push(h - y);
		}
	}

	applyAttraction() {
		const settings = this._settings;
		const interactionRadius = settings.INTERACTION_RADIUS;
		const attract = settings.ATTRACT;
		const smoothingFactor = settings.SMOOTHING_FACTOR || 0.3;

		if (Math.abs(attract) < 1e-6 || interactionRadius <= 0) return;

		const interactionRadiusSq = interactionRadius * interactionRadius;
		const forceScale = attract * this.deltaTime;
		const { x, y, vx, vy, mass } = this.store;

		this.spatialHash.forEachPair((i, j) => {
			const dx = x[j] - x[i];
			const dy = y[j] - y[i];
			const distSq = dx * dx + dy * dy;

			if (distSq >= interactionRadiusSq || distSq < 1e-6) return;

			const distance = Math.sqrt(distSq);
			const smoothedDistance = Math.max(distance, smoothingFactor * interactionRadius);
			if (smoothedDistance < 1e-6) return;

			const forceMagnitude = (forceScale * (mass[i] * mass[j])) / (smoothedDistance * smoothedDistance);
			const G = forceMagnitude / distance;
			const forceX = G * dx;
			const forceY = G * dy;

			if (Number.isNaN(forceX) || Number.isNaN(forceY)) return;

			vx[i] += forceX / mass[i];
			vy[i] += forceY / mass[i];
			vx[j] += -forceX / mass[j];
			vy[j] += -forceY / mass[j];
		});
	}

	// Combined attraction + connection building in one pair iteration.
	// Avoids iterating all neighbor pairs twice per frame.
	applyAttractionAndBuildConnections() {
		const settings = this._settings;
		const interactionRadius = settings.INTERACTION_RADIUS;
		const attract = settings.ATTRACT;
		const smoothingFactor = settings.SMOOTHING_FACTOR || 0.3;
		const connectionOpacity = settings.CONNECTION_OPACITY;

		const hasAttraction = Math.abs(attract) >= 1e-6 && interactionRadius > 0;
		const hasConnections = connectionOpacity > 0.001 && interactionRadius > 0;

		if (!hasAttraction && !hasConnections) {
			this._connVertCount = 0;
			return;
		}

		const interactionRadiusSq = interactionRadius * interactionRadius;
		const forceScale = attract * this.deltaTime;
		const { x, y, vx, vy, mass, color, palette } = this.store;
		const posArr = this._connPos;
		const alphaArr = this._connAlpha;
		const colArr = this._connColor;
		let vi = 0;
		const maxVerts = 200000 * 2;

		this.spatialHash.forEachPair((i, j) => {
			const dx = x[j] - x[i];
			const dy = y[j] - y[i];
			const distSq = dx * dx + dy * dy;

			if (distSq >= interactionRadiusSq || distSq < 1e-6) return;

			const distance = Math.sqrt(distSq);

			if (hasAttraction) {
				const smoothedDistance = Math.max(distance, smoothingFactor * interactionRadius);
				if (smoothedDistance >= 1e-6) {
					const forceMagnitude = (forceScale * (mass[i] * mass[j])) / (smoothedDistance * smoothedDistance);
					const G = forceMagnitude / distance;
					const forceX = G * dx;
					const forceY = G * dy;

					if (!Number.isNaN(forceX) && !Number.isNaN(forceY)) {
						vx[i] += forceX / mass[i];
						vy[i] += forceY / mass[i];
						vx[j] += -forceX / mass[j];
						vy[j] += -forceY / mass[j];
					}
				}
			}

			if (hasConnections && vi < maxVerts) {
				const a = connectionOpacity * (1 - distance / interactionRadius);
				if (a > 0.001) {
					const base = vi * 3;
					posArr[base] = x[i];
					posArr[base + 1] = y[i];
					posArr[base + 2] = 0;
					posArr[base + 3] = x[j];
					posArr[base + 4] = y[j];
					posArr[base + 5] = 0;
					alphaArr[vi] = a;
					alphaArr[vi + 1] = a;

					const c1 = palette[color[i]];
					const c2 = palette[color[j]];
					colArr[base] = c1[0];
					colArr[base + 1] = c1[1];
					colArr[base + 2] = c1[2];
					colArr[base + 3] = c2[0];
					colArr[base + 4] = c2[1];
					colArr[base + 5] = c2[2];

					vi += 2;
				}
			}
		});

		this._connVertCount = vi;
	}

	updateParticles(deltaTime) {
		this.deltaTime = deltaTime / 1000.0;

		const settings = this._settings;
		const cellSize = settings.INTERACTION_RADIUS > 0 ? settings.INTERACTION_RADIUS : 50;

		const s = this.store;

		if (this.wasmPhysics) {
			// Canvas 2D still draws connections from the JS hash.
			if (!this.useWebGL) this.spatialHash.update(s, s.count, cellSize);
			try {
				this.wasmPhysics.step(this, deltaTime);
				return;
			} catch (e) {
				console.warn("wasm physics failed, falling back to JS:", e);
				this.wasmPhysics = null;
				s.detach();
				this._connPos = new Float32Array(200000 * 2 * 3);
				this._connAlpha = new Float32Array(200000 * 2);
				this._connColor = new Float32Array(200000 * 2 * 3);
			}
		}

		this.spatialHash.update(s, s.count, cellSize);

		if (this.useWebGL) {
			// Combined pass: attraction + connection buffer in one pair iteration
			this.applyAttractionAndBuildConnections();
		} else {
			// Canvas 2D: separate passes (connections drawn by canvasRenderer)
			this.applyAttraction();
		}

		this.applyWallForce();
		this.applyMouseForce();

		const elasticity = settings.ELASTICITY !== undefined ? settings.ELASTICITY : 0.8;
		const hasShapes = this.shapeField.count > 0;

		for (let i = 0; i < s.count; i++) {
			updateParticle(s, i, this.deltaTime, this.canvas.width, this.canvas.height, settings);
			if (hasShapes) this.shapeField.collide(s, i, elasticity);
		}
	}

	animate(timestamp = 0) {
		if (!this.canvas) {
			this.stop();
			return;
		}

		const elapsed = timestamp - (this.lastTimestamp || timestamp);
		this.lastTimestamp = timestamp;
		// never negative: a restarted loop starts from timestamp 0
		const deltaTime = Math.max(0, Math.min(elapsed, 100));

		this._settings = this.settingsManager.getAllSettings();

		// Physics (same for both paths)
		this.updateParticles(deltaTime);

		if (this.useWebGL) {
			// --- WebGL path ---
			// Clear overlay for mouse effects
			if (this.overlayCanvas) {
				this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
			}

			// Upload particle data and pre-built connections to GPU, then render
			this.webglRenderer.updateParticles(this.store, this.store.count);
			this.webglRenderer.uploadConnections(
				this._connPos, this._connAlpha, this._connColor, this._connVertCount, this._settings,
			);
			this.webglRenderer.render();

			this.shapeField.draw(this.overlayCtx, this.shapeEditor.preview, this.shapeEditor.selected);

			// Mouse effects on overlay (Canvas 2D)
			this.mouseEffects.updateAndDraw(
				timestamp, this.mouseX, this.mouseY, this.isMouseDown, this._settings,
			);
		} else {
			// --- Canvas 2D fallback ---
			this.canvasRenderer.clear(this.canvas.width, this.canvas.height);

			if (this.overlayCanvas) {
				this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
			}

			this.canvasRenderer.drawConnections(this.store, this.spatialHash, this._settings);

			this.mouseEffects.updateAndDraw(
				timestamp, this.mouseX, this.mouseY, this.isMouseDown, this._settings,
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
		this.spawnParticles(this._settings.PARTICLE_COUNT, this._settings);
		this.animate();
	}
}

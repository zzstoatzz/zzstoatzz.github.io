import { Particle } from "./particle.js";
import { SettingsManager } from "./settingsManager.js";
import { UIController } from "./uiController.js";
import { PARTICLE_COLORS } from "./config.js";
import { SpatialHash } from "./spatialHash.js";
import { CanvasRenderer } from "./canvasRenderer.js";
import { MouseEffects } from "./mouseEffects.js";
import { FirehoseEntropy } from "./firehoseEntropy.js";

export class ParticleSystem {
	constructor(canvas, overlayCanvas) {
		this.canvas = canvas;
		this.ctx = this.canvas.getContext("2d");
		this.particles = [];
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
		this.firehoseEntropy = new FirehoseEntropy(this.overlayCtx, () => ({
			width: this.canvas.width,
			height: this.canvas.height,
		}));

		// Pre-allocated connection buffers (used in combined physics pass)
		this._connPos = new Float32Array(200000 * 2 * 3);
		this._connAlpha = new Float32Array(200000 * 2);
		this._connVertCount = 0;

		this.PARTICLE_COLORS = PARTICLE_COLORS;

		this.settingsManager = new SettingsManager((settings) => {
			this.applySettings(settings);
		});

		this.uiController = new UIController((key, value) => {
			this.settingsManager.updateSetting(key, value);
		}, this.settingsManager.getAllSettings());

		this._settings = this.settingsManager.getAllSettings();
		this.firehoseEntropy.setGain(this._settings.FIREHOSE_ENTROPY_GAIN ?? 1);
		this.firehoseEntropy.setEnabled(Boolean(this._settings.FIREHOSE_ENTROPY));

		window.addEventListener("resize", () => this.resizeCanvas());
		this.resizeCanvas();

		this.init();

		// Try to initialize WebGL (non-blocking)
		this._initWebGL();
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
		this.particles = [];
		const settings = this._settings;
		const count = settings.PARTICLE_COUNT;

		for (let i = 0; i < count; i++) {
			const x = Math.random() * this.canvas.width;
			const y = Math.random() * this.canvas.height;
			this.particles.push(new Particle(x, y, settings));
		}

		this.bindSystemEvents();
		this.resizeCanvas();
		this.firehoseEntropy.setGain(settings.FIREHOSE_ENTROPY_GAIN ?? 1);
		this.firehoseEntropy.setEnabled(Boolean(settings.FIREHOSE_ENTROPY));
		this.animate();
	}

	resizeCanvas() {
		const parent = this.canvas.parentElement;
		const w = parent ? parent.clientWidth : window.innerWidth;
		const h = parent ? parent.clientHeight : window.innerHeight;

		this.canvas.width = w || window.innerWidth;
		this.canvas.height = h || window.innerHeight;

		if (this.overlayCanvas) {
			this.overlayCanvas.width = this.canvas.width;
			this.overlayCanvas.height = this.canvas.height;
		}

		if (this.webglRenderer) {
			this.webglRenderer.resize(this.canvas.width, this.canvas.height);
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
			if (this.isPointInCanvas(e.clientX, e.clientY)) {
				this.isMouseDown = true;
				const rect = this.canvas.getBoundingClientRect();
				this.mouseX = e.clientX - rect.left;
				this.mouseY = e.clientY - rect.top;
				this.mouseEffects.startHold();
			}
		});

		document.addEventListener("mouseup", () => {
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
							const rect = this.canvas.getBoundingClientRect();
							this.mouseX = touch.clientX - rect.left;
							this.mouseY = touch.clientY - rect.top;
							e.preventDefault();
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
				if (e.touches.length > 0 && this.isMouseDown) {
					const touch = e.touches[0];
					this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
					e.preventDefault();
				}
			},
			{ passive: false },
		);

		document.addEventListener("touchend", () => {
			this.isMouseDown = false;
			this.mouseEffects.stopHold(
				this.mouseX, this.mouseY,
				this.canvas.width, this.canvas.height,
				this._settings,
			);
		});
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
		this.firehoseEntropy.setGain(this._settings.FIREHOSE_ENTROPY_GAIN ?? 1);
		this.firehoseEntropy.setEnabled(Boolean(this._settings.FIREHOSE_ENTROPY));

		for (const particle of this.particles) {
			particle.updateSettings(settings);
		}

		const currentCount = this.particles.length;
		const targetCount = settings.PARTICLE_COUNT;

		if (targetCount > currentCount) {
			for (let i = currentCount; i < targetCount; i++) {
				const x = Math.random() * this.canvas.width;
				const y = Math.random() * this.canvas.height;
				this.particles.push(new Particle(x, y, settings));
			}
		} else if (targetCount < currentCount) {
			this.particles = this.particles.slice(0, targetCount);
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

		for (const i of this.spatialHash.queryRadius(this.mouseX, this.mouseY, radius, this.particles)) {
			const particle = this.particles[i];
			const dx = particle.x - this.mouseX;
			const dy = particle.y - this.mouseY;
			const distSq = dx * dx + dy * dy;

			if (distSq < radiusSq && distSq > 1e-6) {
				const distance = Math.sqrt(distSq);
				const strength = force * (1 - distance / radius);
				const dirX = dx / distance;
				const dirY = dy / distance;

				if (!settings.ENABLE_VORTEX_FORCE) {
					particle.vx += dirX * strength;
					particle.vy += dirY * strength;
				} else {
					const radialForce = strength * (this.isMouseDown ? 0.3 : 1.0);
					particle.vx += dirX * radialForce;
					particle.vy += dirY * radialForce;

					if (this.isMouseDown && this.mouseEffects.holdStartTime) {
						const holdDuration = (performance.now() - this.mouseEffects.holdStartTime) / 1000;
						const vortexIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
						const speedMultiplier = 1 + holdDuration * 0.5;
						const vortexStrength = strength * vortexIntensity * 0.8 * speedMultiplier;

						const tangentX = -dirY;
						const tangentY = dirX;
						particle.vx += tangentX * vortexStrength;
						particle.vy += tangentY * vortexStrength;
					}
				}
			}
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
		const particles = this.particles;

		this.spatialHash.forEachPair(particles, (i, j) => {
			const p1 = particles[i];
			const p2 = particles[j];

			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const distSq = dx * dx + dy * dy;

			if (distSq >= interactionRadiusSq || distSq < 1e-6) return;

			const distance = Math.sqrt(distSq);
			const smoothedDistance = Math.max(distance, smoothingFactor * interactionRadius);
			if (smoothedDistance < 1e-6) return;

			const forceMagnitude = (forceScale * (p1.mass * p2.mass)) / (smoothedDistance * smoothedDistance);
			const G = forceMagnitude / distance;
			const forceX = G * dx;
			const forceY = G * dy;

			if (Number.isNaN(forceX) || Number.isNaN(forceY)) return;

			p1.vx += forceX / p1.mass;
			p1.vy += forceY / p1.mass;
			p2.vx += -forceX / p2.mass;
			p2.vy += -forceY / p2.mass;
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
		const particles = this.particles;
		const posArr = this._connPos;
		const alphaArr = this._connAlpha;
		let vi = 0;
		const maxVerts = 200000 * 2;

		this.spatialHash.forEachPair(particles, (i, j) => {
			const p1 = particles[i];
			const p2 = particles[j];

			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const distSq = dx * dx + dy * dy;

			if (distSq >= interactionRadiusSq || distSq < 1e-6) return;

			const distance = Math.sqrt(distSq);

			if (hasAttraction) {
				const smoothedDistance = Math.max(distance, smoothingFactor * interactionRadius);
				if (smoothedDistance >= 1e-6) {
					const forceMagnitude = (forceScale * (p1.mass * p2.mass)) / (smoothedDistance * smoothedDistance);
					const G = forceMagnitude / distance;
					const forceX = G * dx;
					const forceY = G * dy;

					if (!Number.isNaN(forceX) && !Number.isNaN(forceY)) {
						p1.vx += forceX / p1.mass;
						p1.vy += forceY / p1.mass;
						p2.vx += -forceX / p2.mass;
						p2.vy += -forceY / p2.mass;
					}
				}
			}

			if (hasConnections && vi < maxVerts) {
				const a = connectionOpacity * (1 - distance / interactionRadius);
				if (a > 0.001) {
					const base = vi * 3;
					posArr[base] = p1.x;
					posArr[base + 1] = p1.y;
					posArr[base + 2] = 0;
					posArr[base + 3] = p2.x;
					posArr[base + 4] = p2.y;
					posArr[base + 5] = 0;
					alphaArr[vi] = a;
					alphaArr[vi + 1] = a;
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

		this.spatialHash.update(this.particles, this.particles.length, cellSize);

		if (this.useWebGL) {
			// Combined pass: attraction + connection buffer in one pair iteration
			this.applyAttractionAndBuildConnections();
		} else {
			// Canvas 2D: separate passes (connections drawn by canvasRenderer)
			this.applyAttraction();
		}

		this.applyMouseForce();

		for (const particle of this.particles) {
			particle.update(this.deltaTime, this.canvas.width, this.canvas.height, settings);
		}
	}

	animate(timestamp = 0) {
		if (!this.canvas) {
			this.stop();
			return;
		}

		const elapsed = timestamp - (this.lastTimestamp || timestamp);
		this.lastTimestamp = timestamp;
		const deltaTime = Math.min(elapsed, 100);

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
			this.webglRenderer.updateParticles(this.particles, this.particles.length);
			this.webglRenderer.uploadConnections(
				this._connPos, this._connAlpha, this._connVertCount, this._settings,
			);
			this.webglRenderer.render();

			// Mouse effects on overlay (Canvas 2D)
			this.mouseEffects.updateAndDraw(
				timestamp, this.mouseX, this.mouseY, this.isMouseDown, this._settings,
			);
			this.firehoseEntropy.draw(timestamp, this._settings);
		} else {
			// --- Canvas 2D fallback ---
			this.canvasRenderer.clear(this.canvas.width, this.canvas.height);

			if (this.overlayCanvas) {
				this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
			}

			this.canvasRenderer.drawConnections(this.particles, this.spatialHash, this._settings);

			this.mouseEffects.updateAndDraw(
				timestamp, this.mouseX, this.mouseY, this.isMouseDown, this._settings,
			);
			this.firehoseEntropy.draw(timestamp, this._settings);

			this.canvasRenderer.drawParticles(this.particles, this.particles.length);
		}

		this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
	}

	stop() {
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
		if (this.firehoseEntropy) {
			this.firehoseEntropy.setEnabled(false);
		}
	}

	restart() {
		this.stop();
		this.init();
	}
}

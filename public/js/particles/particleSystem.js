import { Particle } from "./particle.js";
import { SettingsManager } from "./settingsManager.js";
import { UIController } from "./uiController.js";
import { PARTICLE_COLORS } from "./config.js";

export class ParticleSystem {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = this.canvas.getContext("2d");
		this.particles = [];
		this.grid = {};
		this.mouseX = 0;
		this.mouseY = 0;
		this.isMouseDown = false;
		this.selectedParticle = null;
		this.animationFrameId = null;
		this.deltaTime = 0; // Initialize deltaTime for use in physics
		this.lastTimestamp = 0;
		this.fpsLimit = 60;
		this.fpsInterval = 1000 / this.fpsLimit;
		this.mouseEffects = [];

		// Hold tracking
		this.holdStartTime = null;
		this.bestHoldDuration = Number.parseFloat(
			localStorage.getItem("torchBearerHighScore") || "0",
		);
		this.leaderboardElement = null;
		this.releaseMultiplier = 1;
		this.releaseEndTime = null;

		// Make particle colors available
		this.PARTICLE_COLORS = PARTICLE_COLORS;
		window.particleSystem = this; // Set this early to make colors available to particles

		// Initialize settings manager with callback to update when settings change
		this.settingsManager = new SettingsManager((settings) => {
			this.applySettings(settings);
		});

		// Initialize UI controller with callback to update settings
		this.uiController = new UIController((key, value) => {
			this.settingsManager.updateSetting(key, value);
		}, this.settingsManager.getAllSettings());

		// Resize handler to maintain proper canvas size
		window.addEventListener("resize", () => this.resizeCanvas());
		this.resizeCanvas();

		// Initialize system (create particles, bind events)
		this.init();

		// Create torch bearer UI elements
		this.createTorchBearerUI();
	}

	init() {
		// Clear existing particles if any
		this.particles = [];

		// Create particles based on current settings
		const settings = this.settingsManager.getAllSettings();
		const count = settings.PARTICLE_COUNT;

		for (let i = 0; i < count; i++) {
			const x = Math.random() * this.canvas.width;
			const y = Math.random() * this.canvas.height;
			const particle = new Particle(x, y, settings);
			this.particles.push(particle);
		}

		// Attach event listeners
		this.bindSystemEvents();

		// Initialize the canvas
		this.resizeCanvas();

		// Start the animation loop
		this.animate();
	}

	resizeCanvas() {
		// Use the parent element's dimensions
		const parent = this.canvas.parentElement;

		// Set canvas size to match parent or window if no parent
		this.canvas.width = parent ? parent.clientWidth : window.innerWidth;
		this.canvas.height = parent ? parent.clientHeight : window.innerHeight;

		// Ensure the canvas has a baseline of at least being visible
		if (this.canvas.width === 0) this.canvas.width = window.innerWidth;
		if (this.canvas.height === 0) this.canvas.height = window.innerHeight;
	}

	bindSystemEvents() {
		// Ensure the canvas has pointer events enabled
		this.canvas.style.pointerEvents = "auto";
		this.canvas.style.zIndex = "10"; // Lower z-index to allow navigation to be on top

		// Inject CSS to make sure the canvas doesn't block events
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

		// Document level mouse/touch handlers for better responsiveness
		document.addEventListener("mousemove", (e) => {
			this.handleMouseMove(e);
		});

		document.addEventListener("mousedown", (e) => {
			if (this.isPointInCanvas(e.clientX, e.clientY)) {
				this.isMouseDown = true;
				// Convert screen coordinates to canvas coordinates
				const rect = this.canvas.getBoundingClientRect();
				this.mouseX = e.clientX - rect.left;
				this.mouseY = e.clientY - rect.top;

				// Start torch bearer timer
				this.startTorchBearer();
			}
		});

		document.addEventListener("mouseup", () => {
			this.isMouseDown = false;
			this.stopTorchBearer();
		});

		// Touch events for mobile - modified to work better with navigation
		document.addEventListener(
			"touchstart",
			(e) => {
				if (e.touches.length > 0) {
					const touch = e.touches[0];
					// Check if we're touching particles area, but don't block nav elements
					if (this.isPointInCanvas(touch.clientX, touch.clientY)) {
						// Get all elements at the touch position
						const elementsAtPoint = document.elementsFromPoint(
							touch.clientX,
							touch.clientY,
						);
						// If any element is part of the navigation or settings UI, don't interact with particles
						const isUIElement = elementsAtPoint.some((el) => {
							return (
								el.closest("nav") ||
								el.closest(".particle-controls") ||
								el.closest("button") ||
								el.tagName === "BUTTON" ||
								el.tagName === "A" ||
								el.closest(".z-50")
							); // Common high z-index nav elements
						});

						if (!isUIElement) {
							this.isMouseDown = true;
							// Convert screen coordinates to canvas coordinates
							const rect = this.canvas.getBoundingClientRect();
							this.mouseX = touch.clientX - rect.left;
							this.mouseY = touch.clientY - rect.top;
							e.preventDefault(); // Only prevent default when interacting with particles

							// Start torch bearer timer
							this.startTorchBearer();
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
					this.handleMouseMove({
						clientX: touch.clientX,
						clientY: touch.clientY,
					});
					e.preventDefault(); // Only prevent scrolling if already interacting with particles
				}
			},
			{ passive: false },
		);

		document.addEventListener("touchend", () => {
			this.isMouseDown = false;
			this.stopTorchBearer();
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
			// Convert screen coordinates to canvas coordinates
			const rect = this.canvas.getBoundingClientRect();
			this.mouseX = e.clientX - rect.left;
			this.mouseY = e.clientY - rect.top;
		}
	}

	applySettings(settings) {
		// Update existing particles
		for (const particle of this.particles) {
			particle.updateSettings(settings);
		}

		// If particle count has changed, adjust particle array size
		const currentCount = this.particles.length;
		const targetCount = settings.PARTICLE_COUNT;

		if (targetCount > currentCount) {
			// Add new particles
			for (let i = currentCount; i < targetCount; i++) {
				const x = Math.random() * this.canvas.width;
				const y = Math.random() * this.canvas.height;
				// New particles get created with randomized size based on current settings
				this.particles.push(new Particle(x, y, settings));
			}
		} else if (targetCount < currentCount) {
			// Remove excess particles
			this.particles = this.particles.slice(0, targetCount);
		}
	}

	applyMouseForce() {
		// Check if release effect has expired
		if (this.releaseEndTime && performance.now() > this.releaseEndTime) {
			this.releaseMultiplier = 1;
			this.releaseEndTime = null;
		}

		if (!this.isMouseDown && this.releaseMultiplier <= 1) return;

		const settings = this.settingsManager.getAllSettings();

		// If vortex force is disabled, use basic force without multipliers
		let radius, force;
		if (!settings.ENABLE_VORTEX_FORCE) {
			radius = settings.EXPLOSION_RADIUS;
			force = settings.EXPLOSION_FORCE;
		} else {
			// Calculate hold intensity for vortex scaling
			let holdIntensity = 0;
			if (this.isMouseDown && this.holdStartTime) {
				const holdDuration = (performance.now() - this.holdStartTime) / 1000;
				holdIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
			}
			
			// Scale radius based on whether holding or releasing
			if (this.isMouseDown) {
				// While holding, expand radius based on charge level
				// Use smoother easing for more gradual growth
				const smoothedIntensity = holdIntensity * holdIntensity; // Square for slower initial growth
				radius = settings.EXPLOSION_RADIUS * (1 + smoothedIntensity * 2); // Up to 3x radius
			} else {
				// On release, use the release multiplier
				radius = settings.EXPLOSION_RADIUS * this.releaseMultiplier;
			}
			
			force =
				settings.EXPLOSION_FORCE *
				(this.isMouseDown ? 1 : this.releaseMultiplier);
		}
		const radiusSq = radius * radius;

		// Use a reasonable cell size for mouse check, potentially larger than interaction radius
		const cellSize = Math.max(
			50,
			settings.INTERACTION_RADIUS > 0 ? settings.INTERACTION_RADIUS : 50,
		);

		// mouseX and mouseY are now in canvas coordinates (we fixed this in handleMouseMove)
		const mouseCellX = Math.floor(this.mouseX / cellSize);
		const mouseCellY = Math.floor(this.mouseY / cellSize);

		// Adjust check radius based on cellSize
		const checkRadiusCells = Math.ceil(radius / cellSize);

		// Track particles we've already checked
		const checkedParticles = new Set();

		for (
			let nx = mouseCellX - checkRadiusCells;
			nx <= mouseCellX + checkRadiusCells;
			nx++
		) {
			for (
				let ny = mouseCellY - checkRadiusCells;
				ny <= mouseCellY + checkRadiusCells;
				ny++
			) {
				// Map check cell coords to main grid coords - use the same cell format as updateGrid
				const cellId = `${nx},${ny}`;
				const indices = this.grid[cellId];

				if (!indices) continue;

				for (const i of indices) {
					if (checkedParticles.has(i)) continue;

					const particle = this.particles[i];
					const dx = particle.x - this.mouseX;
					const dy = particle.y - this.mouseY;
					const distSq = dx * dx + dy * dy;

					if (distSq < radiusSq && distSq > 1e-6) {
						const distance = Math.sqrt(distSq);
						const strength = force * (1 - distance / radius);
						const dirX = dx / distance;
						const dirY = dy / distance;

						// Check if vortex force is disabled
						if (!settings.ENABLE_VORTEX_FORCE) {
							// Simple radial force only, no vortex
							particle.vx += dirX * strength;
							particle.vy += dirY * strength;
						} else {
							// Radial force (original explosion/repulsion)
							const radialForce = strength * (this.isMouseDown ? 0.3 : 1.0); // Reduce radial force when holding
							particle.vx += dirX * radialForce;
							particle.vy += dirY * radialForce;
							
							// Vortex/swirling force when mouse is held down
							if (this.isMouseDown && this.holdStartTime) {
								const holdDuration = (performance.now() - this.holdStartTime) / 1000;
								// Vortex strength increases with hold duration
								const vortexIntensity = Math.min(1, Math.log(holdDuration + 1) / Math.log(10));
								// Speed multiplier increases linearly forever
								const speedMultiplier = 1 + holdDuration * 0.5; // Increases by 50% per second
								const vortexStrength = strength * vortexIntensity * 0.8 * speedMultiplier;
								
								// Calculate tangential direction (perpendicular to radial)
								// For clockwise rotation: tangent = (-dy, dx)
								const tangentX = -dirY;
								const tangentY = dirX;
								
								// Apply vortex force
								particle.vx += tangentX * vortexStrength;
								particle.vy += tangentY * vortexStrength;
							}
						}
					}

					checkedParticles.add(i);
				}
			}
		}
	}

	updateGrid() {
		// Clear grid
		this.grid = {};

		// Get current cell size from settings with safety fallback
		const settings = this.settingsManager.getAllSettings();
		const cellSize =
			settings.INTERACTION_RADIUS > 0 ? settings.INTERACTION_RADIUS : 50;

		// Place particles in grid cells
		for (let i = 0; i < this.particles.length; i++) {
			const p = this.particles[i];
			const cellX = Math.floor(p.x / cellSize);
			const cellY = Math.floor(p.y / cellSize);
			const cellId = `${cellX},${cellY}`;

			if (!this.grid[cellId]) {
				this.grid[cellId] = [];
			}

			this.grid[cellId].push(i);

			// Store the cell ID on the particle for quick reference
			p.cellId = cellId;
		}
	}

	applyAttraction() {
		const settings = this.settingsManager.getAllSettings();
		const interactionRadius = settings.INTERACTION_RADIUS;
		const attract = settings.ATTRACT;
		const smoothingFactor = settings.SMOOTHING_FACTOR || 0.3;

		// Early exit if no attraction/repulsion or radius is invalid
		if (Math.abs(attract) < 1e-6 || interactionRadius <= 0) return;

		const interactionRadiusSq = interactionRadius * interactionRadius;
		// Pre-calculate force scaling factor including deltaTime
		const forceScale = attract * this.deltaTime;

		// Use grid to find nearby particles efficiently
		for (const cellId in this.grid) {
			const indices = this.grid[cellId];
			const cellParts = cellId.split(",");
			const cellX = Number.parseInt(cellParts[0]);
			const cellY = Number.parseInt(cellParts[1]);

			// Check own cell and neighboring cells
			for (let nx = cellX - 1; nx <= cellX + 1; nx++) {
				for (let ny = cellY - 1; ny <= cellY + 1; ny++) {
					const neighborId = `${nx},${ny}`;
					const neighborIndices = this.grid[neighborId];

					if (!neighborIndices) continue;

					// Apply attraction between particles
					for (const i of indices) {
						const p1 = this.particles[i];

						for (const j of neighborIndices) {
							// Critical optimization: Only process unique pairs with i < j
							if (i >= j) continue;

							const p2 = this.particles[j];

							// Check distance
							const dx = p2.x - p1.x;
							const dy = p2.y - p1.y;
							const distSq = dx * dx + dy * dy;

							// Skip if particles are too far apart or too close
							if (distSq >= interactionRadiusSq || distSq < 1e-6) continue;

							const distance = Math.sqrt(distSq);

							// Apply smoothing to avoid extreme forces at very small distances
							const smoothedDistance = Math.max(
								distance,
								smoothingFactor * interactionRadius,
							);
							if (smoothedDistance < 1e-6) continue;

							// Calculate force using inverse square law, with pre-calculated scale
							const forceMagnitude =
								(forceScale * (p1.mass * p2.mass)) /
								(smoothedDistance * smoothedDistance);

							// Efficiently combine magnitude and normalization
							const G = forceMagnitude / distance;
							const forceX = G * dx;
							const forceY = G * dy;

							// Skip if NaN (can happen with extreme values)
							if (Number.isNaN(forceX) || Number.isNaN(forceY)) continue;

							// Apply accelerations (Force / mass)
							const accX1 = forceX / p1.mass;
							const accY1 = forceY / p1.mass;
							const accX2 = -forceX / p2.mass;
							const accY2 = -forceY / p2.mass;

							// Update velocities for both particles
							p1.vx += accX1;
							p1.vy += accY1;
							p2.vx += accX2;
							p2.vy += accY2;
						}
					}
				}
			}
		}
	}

	updateParticles(deltaTime) {
		// Store the deltaTime for use in physics calculations
		this.deltaTime = deltaTime / 1000.0; // Convert to seconds

		// UpdateGrid for spatial partitioning
		this.updateGrid();

		// Apply inter-particle attraction forces
		this.applyAttraction();

		// Apply mouse force
		this.applyMouseForce();

		// Update each particle with direct settings reference
		const settings = this.settingsManager.getAllSettings();
		for (const particle of this.particles) {
			particle.update(
				this.deltaTime,
				this.canvas.width,
				this.canvas.height,
				settings,
			);
		}
	}

	drawConnections() {
		const settings = this.settingsManager.getAllSettings();
		const connectionOpacity = settings.CONNECTION_OPACITY;

		// Early exit if no connections needed
		if (connectionOpacity <= 0.001 || settings.INTERACTION_RADIUS <= 0) return;

		const interactionRadius = settings.INTERACTION_RADIUS;
		const interactionRadiusSq = interactionRadius * interactionRadius;
		const connectionColor = settings.CONNECTION_COLOR;
		const connectionWidth = settings.CONNECTION_WIDTH || 1;

		this.ctx.strokeStyle = connectionColor;
		this.ctx.lineWidth = connectionWidth;

		// Store lines by opacity to batch drawing
		const linesByOpacity = {};

		// Use grid to find nearby particles efficiently
		for (const cellId in this.grid) {
			const indices = this.grid[cellId];
			const cellParts = cellId.split(",");
			const cellX = Number.parseInt(cellParts[0]);
			const cellY = Number.parseInt(cellParts[1]);

			// Check own cell and neighboring cells
			for (let nx = cellX - 1; nx <= cellX + 1; nx++) {
				for (let ny = cellY - 1; ny <= cellY + 1; ny++) {
					const neighborId = `${nx},${ny}`;
					const neighborIndices = this.grid[neighborId];

					if (!neighborIndices) continue;

					// Connect particles within this cell and neighboring cells
					for (const i of indices) {
						const p1 = this.particles[i];

						for (const j of neighborIndices) {
							// Only process unique pairs with i < j
							if (i >= j) continue;

							const p2 = this.particles[j];

							// Check distance
							const dx = p2.x - p1.x;
							const dy = p2.y - p1.y;
							const distSq = dx * dx + dy * dy;

							if (distSq < interactionRadiusSq) {
								const distance = Math.sqrt(distSq);
								// Calculate opacity before deciding to draw
								const opacity =
									connectionOpacity * (1 - distance / interactionRadius);

								if (opacity > 0.001) {
									// Opacity threshold
									// Quantize opacity for batching (e.g., nearest 0.05)
									const opacityKey = Math.round(opacity * 20) / 20;
									if (!linesByOpacity[opacityKey]) {
										linesByOpacity[opacityKey] = [];
									}
									linesByOpacity[opacityKey].push([p1.x, p1.y, p2.x, p2.y]);
								}
							}
						}
					}
				}
			}
		}

		// Batch draw calls by opacity
		for (const opacityKey in linesByOpacity) {
			this.ctx.globalAlpha = Number.parseFloat(opacityKey);
			this.ctx.beginPath();

			for (const line of linesByOpacity[opacityKey]) {
				this.ctx.moveTo(line[0], line[1]);
				this.ctx.lineTo(line[2], line[3]);
			}

			this.ctx.stroke();
		}

		// Reset alpha
		this.ctx.globalAlpha = 1;
	}

	animate(timestamp = 0) {
		if (!this.canvas) {
			// Safety check if canvas removed
			this.stop();
			return;
		}

		// Calculate time delta for smooth animation
		const elapsed = timestamp - (this.lastTimestamp || timestamp); // Handle first frame
		this.lastTimestamp = timestamp;

		// Time in seconds, capped to avoid spiral of death
		const deltaTime = Math.min(elapsed, 100);

		// Clear canvas
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		// Update all particles
		this.updateParticles(deltaTime);

		// Draw connections between particles
		this.drawConnections();

		// Handle mouse effects
		this.updateAndDrawMouseEffects(timestamp);

		// Batch particle drawing by color for efficiency
		const particlesByColor = new Map();
		for (const particle of this.particles) {
			if (!particlesByColor.has(particle.color)) {
				particlesByColor.set(particle.color, []);
			}
			particlesByColor.get(particle.color).push(particle);
		}

		// Draw particles by color batches
		for (const [color, particles] of particlesByColor.entries()) {
			this.ctx.fillStyle = color;
			this.ctx.beginPath();

			for (const particle of particles) {
				this.ctx.moveTo(particle.x + particle.radius, particle.y);
				this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
			}

			this.ctx.fill();
		}

		// Continue animation loop
		this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
	}

	updateAndDrawMouseEffects(timestamp) {
		const settings = this.settingsManager.getAllSettings();

		// If vortex force is disabled, skip all visual effects
		if (!settings.ENABLE_VORTEX_FORCE) {
			return;
		}

		// Calculate hold intensity - logarithmic growth for visual continuity
		let holdIntensity = 0;
		if (this.holdStartTime && this.isMouseDown) {
			const holdDuration = (timestamp - this.holdStartTime) / 1000;
			// Use logarithmic scale so it always feels like it's growing but slows down
			holdIntensity = Math.log(holdDuration + 1) / Math.log(10); // Reaches 1 at ~9 seconds
		}

		// Limit number of effects to avoid slowdown
		const MAX_EFFECTS = 20;
		if (this.isMouseDown && this.mouseEffects.length < MAX_EFFECTS) {
			// Ultra-smooth scaling - even tiny touches get proportional effects
			const effectIntensity = Math.max(0.02, holdIntensity * 0.8); // Can go as low as 2% opacity
			const effectRadius = settings.EXPLOSION_RADIUS * (0.1 + 0.9 * holdIntensity); // 10-100% of full radius
			const effectDuration = 100 + 400 * holdIntensity; // 100-500ms duration
			
			// mouse coordinates are already in canvas space
			this.mouseEffects.push({
				x: this.mouseX,
				y: this.mouseY,
				radius: effectRadius,
				startTime: timestamp,
				duration: effectDuration,
				intensity: effectIntensity,
			});
		}

		// Draw and update existing effects
		this.ctx.save();

		for (let i = this.mouseEffects.length - 1; i >= 0; i--) {
			const effect = this.mouseEffects[i];
			const age = timestamp - effect.startTime;

			if (age > effect.duration) {
				this.mouseEffects.splice(i, 1);
				continue;
			}

			const progress = age / effect.duration;
			const easeOutQuad = 1 - (1 - progress) * (1 - progress);

			// Handle flying effect for new records
			let x = effect.x;
			let y = effect.y;
			if (effect.flying) {
				const flyEase = 1 - Math.pow(1 - progress, 3);
				x = effect.x + (effect.targetX - effect.x) * flyEase;
				y = effect.y + (effect.targetY - effect.y) * flyEase;
			}

			// Handle lightning afterglow differently - simple glowing trail
			if (effect.isLightning) {
				const currentOpacity = Math.max(0, effect.intensity * (1 - progress));
				const currentRadius = Math.max(1, effect.radius || 10); // Ensure valid radius
				
				// Simple glowing dot that fades
				this.ctx.fillStyle = `rgba(220, 240, 255, ${currentOpacity})`;
				this.ctx.beginPath();
				this.ctx.arc(x, y, currentRadius * 0.5, 0, Math.PI * 2);
				this.ctx.fill();
				
				// Faint outer glow
				const gradient = this.ctx.createRadialGradient(
					x, y, 0,
					x, y, currentRadius
				);
				gradient.addColorStop(0, `rgba(200, 230, 255, ${currentOpacity * 0.3})`);
				gradient.addColorStop(1, 'rgba(180, 220, 255, 0)');
				
				this.ctx.fillStyle = gradient;
				this.ctx.beginPath();
				this.ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
				this.ctx.fill();
			} else {
				// Original ripple effect
				const currentOpacity = Math.max(
					0,
					effect.intensity * (1 - progress), // Direct scaling - no minimum
				);
				const currentRadius = Math.max(
					1,
					effect.radius * easeOutQuad * (0.7 + effect.intensity * 0.3),
				);

				// Enhanced color shifts with more spectrum coverage
				// Low intensity: cyan/blue, Mid: purple/magenta, High: gold/orange
				const rippleHue = 200 - effect.intensity * 200; // Cyan to orange
				const rippleSat = 70 + effect.intensity * 30;
				const rippleLight = 70 - effect.intensity * 20;
				
				// Also calculate RGB for gradient mixing
				const r = Math.floor(120 + effect.intensity * 135);
				const g = Math.floor(220 - effect.intensity * 20);
				const b = Math.floor(255 - effect.intensity * 155);

				// Draw a single gradient ripple
				const gradient = this.ctx.createRadialGradient(
					x,
					y,
					0,
					x,
					y,
					currentRadius,
				);

				// Use HSL for inner color, RGB for outer - creates nice blend
				gradient.addColorStop(0, `hsla(${rippleHue}, ${rippleSat}%, ${rippleLight}%, ${currentOpacity})`);
				gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${currentOpacity * 0.5})`);
				gradient.addColorStop(1, `hsla(${(rippleHue + 60) % 360}, ${rippleSat - 20}%, ${rippleLight + 20}%, 0)`);

				this.ctx.fillStyle = gradient;
				this.ctx.beginPath();
				this.ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
				this.ctx.fill();
			}
		}

		// Draw ethereal energy concentration when charging (easter egg - appears after 1 second)
		if (this.isMouseDown && this.holdStartTime) {
			const holdDuration = (timestamp - this.holdStartTime) / 1000;
			if (holdDuration > 0.8) { // Start fading in at 0.8 seconds
				// Smooth emergence from 0.8 to 1.5 seconds
				const emergeFactor = Math.min(1, (holdDuration - 0.8) / 0.7);
				const emergeEase = emergeFactor * emergeFactor * (3 - 2 * emergeFactor); // Smooth cubic ease
			// Create Shepard tone effect with 3 overlapping waves
			const time = timestamp / 1000;

			// Draw silk-like layers from outer to inner
			for (let layer = 3; layer >= 0; layer--) {
				// Each layer has a different phase and frequency
				const phase = (time * (layer + 1) * 0.5) % (Math.PI * 2);
				const layerIntensity = (Math.sin(phase) + 1) / 2;
				const layerSize = (20 + layer * 15 + layerIntensity * 10 * holdIntensity) * emergeEase;

				// Create gradient for this layer
				const gradient = this.ctx.createRadialGradient(
					this.mouseX,
					this.mouseY,
					layerSize * 0.3,
					this.mouseX,
					this.mouseY,
					layerSize,
				);

				// Silk-like color transitions with MORE variation
				const shimmer = Math.sin(time * 3 + layer) * 0.2 + 0.8;
				// Add rainbow cycling based on intensity
				const hueShift = holdIntensity * 60 + time * 20; // Cycles through spectrum
				const baseHue = (200 + hueShift) % 360; // Starting from blue
				
				// Convert HSL to RGB for more vibrant colors
				const saturation = 70 + holdIntensity * 30; // More saturated with intensity
				const lightness = 60 + shimmer * 20 - holdIntensity * 10;
				
				// Also keep some of the original warmth
				const r = Math.floor((180 + holdIntensity * 75) * shimmer);
				const g = Math.floor((220 - holdIntensity * 40) * shimmer);
				const b = Math.floor((255 - holdIntensity * 100) * shimmer);

				// Mix HSL and RGB for richer color variation
				if (holdIntensity > 0.5 && layer % 2 === 0) {
					// Use HSL for even layers when intensity is high
					gradient.addColorStop(
						0,
						`hsla(${baseHue}, ${saturation}%, ${lightness}%, ${layerIntensity * holdIntensity * 0.3 * emergeEase})`,
					);
					gradient.addColorStop(
						0.5,
						`hsla(${(baseHue + 30) % 360}, ${saturation - 10}%, ${lightness + 10}%, ${layerIntensity * holdIntensity * 0.15 * emergeEase})`,
					);
					gradient.addColorStop(1, `hsla(${(baseHue + 60) % 360}, ${saturation - 20}%, 90%, 0)`);
				} else {
					// Original RGB gradient for odd layers
					gradient.addColorStop(
						0,
						`rgba(${r}, ${g}, ${b}, ${layerIntensity * holdIntensity * 0.3 * emergeEase})`,
					);
					gradient.addColorStop(
						0.5,
						`rgba(${r}, ${g}, ${b}, ${layerIntensity * holdIntensity * 0.15 * emergeEase})`,
					);
					gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
				}

				this.ctx.fillStyle = gradient;
				this.ctx.beginPath();
				this.ctx.arc(this.mouseX, this.mouseY, layerSize, 0, Math.PI * 2);
				this.ctx.fill();
			}

			// Swirling vortex system - acid trip style
			// Vortex count increases with intensity - starts at 3, can go up to 5
			const vortexCount = 3 + Math.floor(holdIntensity > 0.7 ? (holdIntensity - 0.7) * 6.67 : 0); // 3 until 70%, then 4 at 85%, 5 at 100%
			// Rotation accelerates exponentially with hold time!
			const rotationSpeed = (0.1 + holdIntensity * holdIntensity * 8) * emergeEase; // Much slower start, gentler acceleration
			const baseRotation = time * rotationSpeed;
			// Orbit radius also expands with hold time AND emergence
			const orbitRadius = (5 + holdIntensity * 20) * emergeEase; // Starts at center, expands outward
			
			// Draw multiple smeared layers for motion blur effect
			const trailCount = 9; // MORE TRAILS = MORE SMEAR
			for (let trail = 0; trail < trailCount; trail++) {
				const trailOffset = trail * 0.15; // BIGGER NUMBER = LONGER SMEAR
				const trailAlpha = (1 - trail / trailCount) * 0.4 * emergeEase; // Trails fade in with emergence
				
				for (let v = 0; v < vortexCount; v++) {
					// Each trail is slightly behind in time
					const angle = (baseRotation - trailOffset) + (v * Math.PI * 2 / vortexCount);
					
					// Add wobble for organic movement
					const wobble = Math.sin(time * 3 + v) * 2;
					const vx = this.mouseX + Math.cos(angle) * (orbitRadius + wobble);
					const vy = this.mouseY + Math.sin(angle) * (orbitRadius + wobble);
					
					// Smeared gradient that bleeds outward
					const smearSize = 15 + (trail * 3.5); // BIGGER MULTIPLIER = FATTER SMEAR
					const smearGradient = this.ctx.createRadialGradient(
						vx, vy, 0,
						vx, vy, smearSize,
					);
					
					// Color morphs through spectrum based on angle AND intensity
					// More intensity = faster color cycling and wider spectrum
					const hue = (angle * 180 / Math.PI + time * (50 + holdIntensity * 150) + holdIntensity * 360) % 360;
					const sat = 70 + holdIntensity * 30 - trail * 5; // More saturated with intensity
					const light = 60 + holdIntensity * 30 - trail * 10; // Brighter with intensity
					
					smearGradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${holdIntensity * trailAlpha})`);
					smearGradient.addColorStop(0.5, `hsla(${hue}, ${sat}%, ${light}%, ${holdIntensity * trailAlpha * 0.5})`);
					smearGradient.addColorStop(1, `hsla(${hue}, ${sat}%, ${light}%, 0)`);
					
					this.ctx.fillStyle = smearGradient;
					this.ctx.beginPath();
					this.ctx.arc(vx, vy, smearSize, 0, Math.PI * 2);
					this.ctx.fill();
				}
			}
			
			// Electric potential field at maximum power
			if (holdIntensity > 0.8 && emergeEase > 0.9) {
				const crackleIntensity = (holdIntensity - 0.8) / 0.2; // 0 to 1 as we go from 80% to 100%
				
				// First, draw the humming electric potential field
				// Tiny sparks that show the charged atmosphere
				const sparkCount = 30 * crackleIntensity;
				for (let s = 0; s < sparkCount; s++) {
					const sparkAngle = Math.random() * Math.PI * 2;
					const sparkDist = orbitRadius + Math.random() * 40;
					const sparkX = this.mouseX + Math.cos(sparkAngle) * sparkDist;
					const sparkY = this.mouseY + Math.sin(sparkAngle) * sparkDist;
					
					// Tiny glowing points with color variation
					const sparkAlpha = 0.3 + Math.random() * 0.4 * crackleIntensity;
					// Sparks shift from blue to purple to pink with intensity
					const sparkHue = 200 + holdIntensity * 100 + Math.random() * 40;
					this.ctx.fillStyle = `hsla(${sparkHue}, 80%, 75%, ${sparkAlpha})`;
					this.ctx.fillRect(sparkX - 0.5, sparkY - 0.5, 1, 1);
				}
				
				// Store vortex positions for lightning connections
				const vortexPositions = [];
				for (let v = 0; v < vortexCount; v++) {
					const angle = baseRotation + (v * Math.PI * 2 / vortexCount);
					const wobble = Math.sin(time * 3 + v) * 2;
					vortexPositions.push({
						x: this.mouseX + Math.cos(angle) * (orbitRadius + wobble),
						y: this.mouseY + Math.sin(angle) * (orbitRadius + wobble)
					});
				}
				
				// Actual lightning ZAPS between points
				// Frequency increases with intensity
				const zapChance = 0.02 + crackleIntensity * 0.08; // Up to 10% chance per frame at max
				
				// Check each pair of vortices for potential discharge
				for (let i = 0; i < vortexCount; i++) {
					for (let j = i + 1; j < vortexCount; j++) {
						if (Math.random() < zapChance) {
							// Calculate oscillating extensions for lightning endpoints
							const oscAmplitude = holdIntensity * 20; // Extension grows with intensity
							const oscFreq = 5 + holdIntensity * 10; // Faster oscillation at higher intensity
							
							// Oscillating offsets unique to each vortex
							const startOsc = Math.sin(time * oscFreq + i * 2) * oscAmplitude;
							const endOsc = Math.sin(time * oscFreq + j * 2) * oscAmplitude;
							
							// Calculate radial direction from center for each vortex
							const startAngle = Math.atan2(vortexPositions[i].y - this.mouseY, vortexPositions[i].x - this.mouseX);
							const endAngle = Math.atan2(vortexPositions[j].y - this.mouseY, vortexPositions[j].x - this.mouseX);
							
							// ZAP! Draw instantaneous connection to oscillating points
							const start = {
								x: vortexPositions[i].x + Math.cos(startAngle) * startOsc,
								y: vortexPositions[i].y + Math.sin(startAngle) * startOsc
							};
							const end = {
								x: vortexPositions[j].x + Math.cos(endAngle) * endOsc,
								y: vortexPositions[j].y + Math.sin(endAngle) * endOsc
							};
							
							this.ctx.beginPath();
							this.ctx.moveTo(start.x, start.y);
							
							// Slightly jagged path
							const midX = (start.x + end.x) / 2 + (Math.random() - 0.5) * 10;
							const midY = (start.y + end.y) / 2 + (Math.random() - 0.5) * 10;
							this.ctx.quadraticCurveTo(midX, midY, end.x, end.y);
							
							// Lightning color shifts with intensity - from blue to violet to white
							const lightningHue = 200 - holdIntensity * 80; // Shifts from blue to purple
							const lightningSat = 60 - holdIntensity * 60; // Desaturates to white
							this.ctx.strokeStyle = `hsla(${lightningHue}, ${lightningSat}%, 95%, ${0.9 + Math.random() * 0.1})`;
							this.ctx.lineWidth = 0.1 + Math.random() * 0.3; // Ultra thin
							this.ctx.shadowBlur = 30; // More glow
							this.ctx.shadowColor = `hsla(${lightningHue}, ${lightningSat + 20}%, 85%, 1)`;
							this.ctx.stroke();
							
							// Add colorful glowing endpoints
							const endpointHue = (lightningHue + Math.random() * 60) % 360;
							this.ctx.fillStyle = `hsla(${endpointHue}, 90%, 90%, 0.8)`;
							this.ctx.beginPath();
							this.ctx.arc(start.x, start.y, 1, 0, Math.PI * 2);
							this.ctx.arc(end.x, end.y, 1, 0, Math.PI * 2);
							this.ctx.fill();
							
							// Leave subtle glowing trail along the path
							const trailPoints = 2; // Just a couple points along the path
							for (let t = 1; t < trailPoints; t++) { // Skip endpoints
								const ratio = t / trailPoints;
								const trailX = start.x + (end.x - start.x) * ratio;
								const trailY = start.y + (end.y - start.y) * ratio;
								this.mouseEffects.push({
									x: trailX,
									y: trailY,
									radius: 6,
									startTime: performance.now(),
									duration: 150,
									intensity: 0.5,
									isLightning: true
								});
							}
						}
					}
					
					// Occasional discharge to random point
					if (Math.random() < zapChance * 0.5) {
						const start = vortexPositions[i];
						const randomAngle = Math.random() * Math.PI * 2;
						const randomDist = orbitRadius * 1.5 + Math.random() * 30;
						const endX = this.mouseX + Math.cos(randomAngle) * randomDist;
						const endY = this.mouseY + Math.sin(randomAngle) * randomDist;
						
						this.ctx.beginPath();
						this.ctx.moveTo(start.x, start.y);
						this.ctx.lineTo(endX, endY);
						
						// Random discharge colors shift through spectrum
						const dischargeHue = Math.random() * 360;
						this.ctx.strokeStyle = `hsla(${dischargeHue}, ${70 + holdIntensity * 30}%, 85%, ${0.7 + Math.random() * 0.3})`;
						this.ctx.lineWidth = 0.1 + Math.random() * 0.2; // Ultra thin
						this.ctx.shadowBlur = 20; // More glow
						this.ctx.shadowColor = `hsla(${dischargeHue}, 80%, 75%, 0.9)`;
						this.ctx.stroke();
						
						// Leave subtle trail along discharge path
						this.mouseEffects.push({
							x: (start.x + endX) / 2,
							y: (start.y + endY) / 2,
							radius: 5,
							startTime: performance.now(),
							duration: 100,
							intensity: 0.3,
							isLightning: true
						});
					}
				}
				
				// Reset shadow
				this.ctx.shadowBlur = 0;
			}
			
			// Central melting point with prismatic colors
			const meltGradient = this.ctx.createRadialGradient(
				this.mouseX, this.mouseY, 0,
				this.mouseX, this.mouseY, orbitRadius * 1.5,
			);
			// Center shifts from white to rainbow based on intensity
			if (holdIntensity > 0.7) {
				const centerHue = (time * 100) % 360;
				meltGradient.addColorStop(0, `hsla(${centerHue}, ${holdIntensity * 50}%, 90%, ${holdIntensity * 0.5})`);
				meltGradient.addColorStop(0.3, `hsla(${(centerHue + 120) % 360}, ${holdIntensity * 40}%, 85%, ${holdIntensity * 0.2})`);
				meltGradient.addColorStop(1, `hsla(${(centerHue + 240) % 360}, ${holdIntensity * 30}%, 80%, 0)`);
			} else {
				meltGradient.addColorStop(0, `rgba(255, 255, 255, ${holdIntensity * 0.5})`);
				meltGradient.addColorStop(0.3, `rgba(255, 240, 230, ${holdIntensity * 0.2})`);
				meltGradient.addColorStop(1, "rgba(255, 220, 200, 0)");
			}
			
			this.ctx.fillStyle = meltGradient;
			this.ctx.beginPath();
			this.ctx.arc(this.mouseX, this.mouseY, orbitRadius * 1.5, 0, Math.PI * 2);
			this.ctx.fill();

			// Organic smoke tendrils that appear and fade
			const smokeCount = 5;
			for (let i = 0; i < smokeCount; i++) {
				// Each tendril has its own life cycle
				const tendrilPhase = (time * 0.7 + i * 1.3) % 3;
				const tendrilAlpha = Math.sin((tendrilPhase * Math.PI) / 3); // Fade in and out

				if (tendrilAlpha > 0) {
					// Perlin-noise-like movement using overlapping sine waves
					const drift1 = Math.sin(time * 0.8 + i * 2) * 30;
					const drift2 = Math.sin(time * 1.3 + i * 3) * 20;
					const drift3 = Math.sin(time * 0.5 + i * 1.7) * 15;

					// Draw smeared smoke blob
					const smokeGradient = this.ctx.createRadialGradient(
						this.mouseX + drift1 + drift3,
						this.mouseY + drift2,
						0,
						this.mouseX + drift1 + drift3,
						this.mouseY + drift2,
						20 + tendrilAlpha * 30 * holdIntensity,
					);

					const smokeIntensity = tendrilAlpha * holdIntensity * 0.2;
					// Smoke shifts from warm orange to cool blues/purples with intensity
					const smokeHue = 30 - holdIntensity * 60 + i * 20; // Orange to purple
					const smokeSat = 40 + holdIntensity * 30;
					smokeGradient.addColorStop(
						0,
						`hsla(${smokeHue}, ${smokeSat}%, 85%, ${smokeIntensity})`,
					);
					smokeGradient.addColorStop(
						0.4,
						`hsla(${smokeHue + 30}, ${smokeSat - 10}%, 75%, ${smokeIntensity * 0.5})`,
					);
					smokeGradient.addColorStop(1, `hsla(${smokeHue + 60}, ${smokeSat - 20}%, 65%, 0)`);

					this.ctx.fillStyle = smokeGradient;
					this.ctx.beginPath();
					this.ctx.arc(
						this.mouseX + drift1 + drift3,
						this.mouseY + drift2,
						25 + tendrilAlpha * 35 * holdIntensity,
						0,
						Math.PI * 2,
					);
					this.ctx.fill();
				}
			}
		}
		}
		this.ctx.restore();
	}

	stop() {
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	restart() {
		this.stop();
		this.init();
	}

	createTorchBearerUI() {
		// Create corner leaderboard
		this.leaderboardElement = document.createElement("div");
		this.leaderboardElement.id = "ghost-leaderboard";
		this.leaderboardElement.style.cssText = `
			position: fixed;
			bottom: 20px;
			right: 20px;
			font-family: monospace;
			font-size: 12px;
			color: rgba(255, 255, 255, 0.8);
			background: rgba(0, 0, 0, 0.5);
			padding: 8px 12px;
			border-radius: 6px;
			z-index: 10000;
			backdrop-filter: blur(10px);
			border: 1px solid rgba(255, 255, 255, 0.05);
			transition: all 0.3s ease;
			opacity: 0;
		`;
		this.updateLeaderboardDisplay();
		document.body.appendChild(this.leaderboardElement);

		// Simple CSS for visibility
		const style = document.createElement("style");
		style.textContent = `
			#ghost-leaderboard.visible {
				opacity: 1 !important;
			}
		`;
		document.head.appendChild(style);

		// Show on hover in bottom right corner
		document.addEventListener("mousemove", (e) => {
			const threshold = 150;
			const inCorner =
				e.clientX > window.innerWidth - threshold &&
				e.clientY > window.innerHeight - threshold;
			if (inCorner) {
				this.leaderboardElement.classList.add("visible");
			} else {
				this.leaderboardElement.classList.remove("visible");
			}
		});

		// Make sure it's visible for debugging - remove this after testing
		console.log("Leaderboard created:", this.leaderboardElement);
	}

	updateLeaderboardDisplay() {
		this.leaderboardElement.innerHTML = `✦ ${this.bestHoldDuration.toFixed(2)}s`;
	}

	startTorchBearer() {
		this.holdStartTime = performance.now();
		// Clear any lingering release effect
		this.releaseMultiplier = 1;
		this.releaseEndTime = null;
	}

	stopTorchBearer() {
		if (!this.holdStartTime) return;

		// Calculate final duration
		const duration = (performance.now() - this.holdStartTime) / 1000;
		
		const settings = this.settingsManager.getAllSettings();

		// If vortex force is disabled, skip all charging/release effects
		if (!settings.ENABLE_VORTEX_FORCE) {
			this.releaseMultiplier = 1;
			this.holdStartTime = null;
			return;
		}
		
		// Calculate release intensity based on duration
		const releaseIntensity = Math.log(duration + 1) / Math.log(10);

		// Set release multiplier - exponential growth with higher cap
		// Starts at 1x, doubles every 2 seconds, maxes at 50x
		this.releaseMultiplier = Math.min(50, 2 ** (duration / 2));

		// Create a release effect proportional to hold duration
		if (duration > 0.01) { // Even tiny touches get a small effect
			// Set end time for release effect (scales with duration)
			this.releaseEndTime = performance.now() + Math.min(100, 50 + duration * 20);
			
			// Add a final release ripple that scales smoothly with duration
			this.mouseEffects.push({
				x: this.mouseX,
				y: this.mouseY,
				radius: 5 + releaseIntensity * 45, // Scales from 5px to 50px - tiny for quick taps
				startTime: performance.now(),
				duration: 150 + releaseIntensity * 550, // 150-700ms - brief for quick taps
				intensity: releaseIntensity * 0.5, // Even lower intensity for subtlety
			});
		} else {
			// Too short, reset immediately
			this.releaseMultiplier = 1;
		}

		// Check for new high score
		if (duration > this.bestHoldDuration) {
			this.bestHoldDuration = duration;
			localStorage.setItem(
				"torchBearerHighScore",
				this.bestHoldDuration.toString(),
			);

			// Show and update leaderboard with glow
			this.updateLeaderboardDisplay();
			this.leaderboardElement.classList.add("visible");
			this.leaderboardElement.style.boxShadow =
				"0 0 20px rgba(255, 215, 0, 0.8)";

			// Create a special effect at mouse position flying to corner
			this.mouseEffects.push({
				x: this.mouseX,
				y: this.mouseY,
				radius: 50,
				startTime: performance.now(),
				duration: 1000,
				intensity: 1,
				flying: true,
				targetX: this.canvas.width - 100,
				targetY: this.canvas.height - 50,
			});

			// Remove glow after animation
			setTimeout(() => {
				this.leaderboardElement.style.boxShadow = "";
			}, 2000);
		}

		this.holdStartTime = null;
	}
}

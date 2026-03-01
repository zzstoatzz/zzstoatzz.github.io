// Mouse effect rendering — pinwheel, aura, lightning, smoke.
// Draws to its own Canvas 2D overlay context.
// Extracted from particleSystem.js updateAndDrawMouseEffects().

export class MouseEffects {
	constructor(ctx) {
		this.ctx = ctx;
		this.effects = [];

		// Hold tracking
		this.holdStartTime = null;
		this.bestHoldDuration = Number.parseFloat(
			localStorage.getItem("torchBearerHighScore") || "0",
		);
		this.releaseMultiplier = 1;
		this.releaseEndTime = null;

		// Torch bearer UI
		this.leaderboardElement = null;
		this._createTorchBearerUI();
	}

	startHold() {
		this.holdStartTime = performance.now();
		this.releaseMultiplier = 1;
		this.releaseEndTime = null;
	}

	stopHold(mouseX, mouseY, canvasWidth, canvasHeight, settings) {
		if (!this.holdStartTime) return;

		const duration = (performance.now() - this.holdStartTime) / 1000;

		if (!settings.ENABLE_VORTEX_FORCE) {
			this.releaseMultiplier = 1;
			this.holdStartTime = null;
			return;
		}

		const releaseIntensity = Math.log(duration + 1) / Math.log(10);

		this.releaseMultiplier = Math.min(50, 2 ** (duration / 2));

		if (duration > 0.01) {
			this.releaseEndTime = performance.now() + Math.min(100, 50 + duration * 20);

			this.effects.push({
				x: mouseX,
				y: mouseY,
				radius: 5 + releaseIntensity * 45,
				startTime: performance.now(),
				duration: 150 + releaseIntensity * 550,
				intensity: releaseIntensity * 0.5,
			});
		} else {
			this.releaseMultiplier = 1;
		}

		if (duration > this.bestHoldDuration) {
			this.bestHoldDuration = duration;
			localStorage.setItem("torchBearerHighScore", this.bestHoldDuration.toString());

			this._updateLeaderboardDisplay();
			this.leaderboardElement.classList.add("visible");
			this.leaderboardElement.style.boxShadow = "0 0 20px rgba(255, 215, 0, 0.8)";

			this.effects.push({
				x: mouseX,
				y: mouseY,
				radius: 50,
				startTime: performance.now(),
				duration: 1000,
				intensity: 1,
				flying: true,
				targetX: canvasWidth - 100,
				targetY: canvasHeight - 50,
			});

			setTimeout(() => {
				this.leaderboardElement.style.boxShadow = "";
			}, 2000);
		}

		this.holdStartTime = null;
	}

	// Check if release effect has expired. Called each frame before applyMouseForce.
	checkReleaseExpiry() {
		if (this.releaseEndTime && performance.now() > this.releaseEndTime) {
			this.releaseMultiplier = 1;
			this.releaseEndTime = null;
		}
	}

	// Get current hold intensity (0-1, logarithmic).
	getHoldIntensity(timestamp) {
		if (!this.holdStartTime) return 0;
		const holdDuration = (timestamp - this.holdStartTime) / 1000;
		return Math.log(holdDuration + 1) / Math.log(10);
	}

	// Main render — draws all mouse effects to overlay canvas.
	updateAndDraw(timestamp, mouseX, mouseY, isMouseDown, settings) {
		const ctx = this.ctx;

		if (!settings.ENABLE_VORTEX_FORCE) return;

		let holdIntensity = 0;
		if (this.holdStartTime && isMouseDown) {
			const holdDuration = (timestamp - this.holdStartTime) / 1000;
			holdIntensity = Math.log(holdDuration + 1) / Math.log(10);
		}

		const MAX_EFFECTS = 20;
		if (isMouseDown && this.effects.length < MAX_EFFECTS) {
			const effectIntensity = Math.max(0.02, holdIntensity * 0.8);
			const effectRadius = settings.EXPLOSION_RADIUS * (0.1 + 0.9 * holdIntensity);
			const effectDuration = 100 + 400 * holdIntensity;

			this.effects.push({
				x: mouseX,
				y: mouseY,
				radius: effectRadius,
				startTime: timestamp,
				duration: effectDuration,
				intensity: effectIntensity,
			});
		}

		ctx.save();

		// Draw and update existing effects
		for (let i = this.effects.length - 1; i >= 0; i--) {
			const effect = this.effects[i];
			const age = timestamp - effect.startTime;

			if (age > effect.duration) {
				this.effects.splice(i, 1);
				continue;
			}

			const progress = age / effect.duration;
			const easeOutQuad = 1 - (1 - progress) * (1 - progress);

			let x = effect.x;
			let y = effect.y;
			if (effect.flying) {
				const flyEase = 1 - (1 - progress) ** 3;
				x = effect.x + (effect.targetX - effect.x) * flyEase;
				y = effect.y + (effect.targetY - effect.y) * flyEase;
			}

			if (effect.isLightning) {
				this._drawLightningAfterGlow(ctx, x, y, effect, progress);
			} else {
				this._drawRipple(ctx, x, y, effect, progress, easeOutQuad);
			}
		}

		// Ethereal energy concentration when charging
		if (isMouseDown && this.holdStartTime) {
			const holdDuration = (timestamp - this.holdStartTime) / 1000;
			if (holdDuration > 0.8) {
				const emergeFactor = Math.min(1, (holdDuration - 0.8) / 0.7);
				const emergeEase = emergeFactor * emergeFactor * (3 - 2 * emergeFactor);
				const time = timestamp / 1000;

				this._drawAuraLayers(ctx, mouseX, mouseY, time, holdIntensity, emergeEase);
				this._drawPinwheel(ctx, mouseX, mouseY, time, holdIntensity, emergeEase, settings);
				this._drawLightning(ctx, mouseX, mouseY, time, holdIntensity, emergeEase, settings);
				this._drawCenterMelt(ctx, mouseX, mouseY, time, holdIntensity, emergeEase);
				this._drawSmoke(ctx, mouseX, mouseY, time, holdIntensity);
			}
		}

		ctx.restore();
	}

	_drawLightningAfterGlow(ctx, x, y, effect, progress) {
		const currentOpacity = Math.max(0, effect.intensity * (1 - progress));
		const currentRadius = Math.max(1, effect.radius || 10);

		ctx.fillStyle = `rgba(220, 240, 255, ${currentOpacity})`;
		ctx.beginPath();
		ctx.arc(x, y, currentRadius * 0.5, 0, Math.PI * 2);
		ctx.fill();

		const gradient = ctx.createRadialGradient(x, y, 0, x, y, currentRadius);
		gradient.addColorStop(0, `rgba(200, 230, 255, ${currentOpacity * 0.3})`);
		gradient.addColorStop(1, "rgba(180, 220, 255, 0)");

		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
		ctx.fill();
	}

	_drawRipple(ctx, x, y, effect, progress, easeOutQuad) {
		const currentOpacity = Math.max(0, effect.intensity * (1 - progress));
		const currentRadius = Math.max(
			1,
			effect.radius * easeOutQuad * (0.7 + effect.intensity * 0.3),
		);

		const rippleHue = 200 - effect.intensity * 200;
		const rippleSat = 70 + effect.intensity * 30;
		const rippleLight = 70 - effect.intensity * 20;

		const r = Math.floor(120 + effect.intensity * 135);
		const g = Math.floor(220 - effect.intensity * 20);
		const b = Math.floor(255 - effect.intensity * 155);

		const gradient = ctx.createRadialGradient(x, y, 0, x, y, currentRadius);
		gradient.addColorStop(0, `hsla(${rippleHue}, ${rippleSat}%, ${rippleLight}%, ${currentOpacity})`);
		gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${currentOpacity * 0.5})`);
		gradient.addColorStop(1, `hsla(${(rippleHue + 60) % 360}, ${rippleSat - 20}%, ${rippleLight + 20}%, 0)`);

		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
		ctx.fill();
	}

	_drawAuraLayers(ctx, mouseX, mouseY, time, holdIntensity, emergeEase) {
		for (let layer = 3; layer >= 0; layer--) {
			const phase = (time * (layer + 1) * 0.5) % (Math.PI * 2);
			const layerIntensity = (Math.sin(phase) + 1) / 2;
			const layerSize = (20 + layer * 15 + layerIntensity * 10 * holdIntensity) * emergeEase;

			const gradient = ctx.createRadialGradient(
				mouseX, mouseY, layerSize * 0.3,
				mouseX, mouseY, layerSize,
			);

			const shimmer = Math.sin(time * 3 + layer) * 0.2 + 0.8;
			const hueShift = holdIntensity * 60 + time * 20;
			const baseHue = (200 + hueShift) % 360;
			const saturation = 70 + holdIntensity * 30;
			const lightness = 60 + shimmer * 20 - holdIntensity * 10;

			const r = Math.floor((180 + holdIntensity * 75) * shimmer);
			const g = Math.floor((220 - holdIntensity * 40) * shimmer);
			const b = Math.floor((255 - holdIntensity * 100) * shimmer);

			if (holdIntensity > 0.5 && layer % 2 === 0) {
				gradient.addColorStop(0, `hsla(${baseHue}, ${saturation}%, ${lightness}%, ${layerIntensity * holdIntensity * 0.3 * emergeEase})`);
				gradient.addColorStop(0.5, `hsla(${(baseHue + 30) % 360}, ${saturation - 10}%, ${lightness + 10}%, ${layerIntensity * holdIntensity * 0.15 * emergeEase})`);
				gradient.addColorStop(1, `hsla(${(baseHue + 60) % 360}, ${saturation - 20}%, 90%, 0)`);
			} else {
				gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${layerIntensity * holdIntensity * 0.3 * emergeEase})`);
				gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${layerIntensity * holdIntensity * 0.15 * emergeEase})`);
				gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
			}

			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(mouseX, mouseY, layerSize, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	_drawPinwheel(ctx, mouseX, mouseY, time, holdIntensity, emergeEase) {
		const vortexCount = 3 + Math.floor(holdIntensity > 0.7 ? (holdIntensity - 0.7) * 6.67 : 0);
		const rotationSpeed = (0.1 + holdIntensity * holdIntensity * 8) * emergeEase;
		const baseRotation = time * rotationSpeed;
		const orbitRadius = (5 + holdIntensity * 20) * emergeEase;

		const trailCount = 9;
		for (let trail = 0; trail < trailCount; trail++) {
			const trailOffset = trail * 0.15;
			const trailAlpha = (1 - trail / trailCount) * 0.4 * emergeEase;

			for (let v = 0; v < vortexCount; v++) {
				const angle = (baseRotation - trailOffset) + (v * Math.PI * 2 / vortexCount);
				const wobble = Math.sin(time * 3 + v) * 2;
				const vx = mouseX + Math.cos(angle) * (orbitRadius + wobble);
				const vy = mouseY + Math.sin(angle) * (orbitRadius + wobble);

				const smearSize = 15 + (trail * 3.5);
				const smearGradient = ctx.createRadialGradient(vx, vy, 0, vx, vy, smearSize);

				const hue = (angle * 180 / Math.PI + time * (50 + holdIntensity * 150) + holdIntensity * 360) % 360;
				const sat = 70 + holdIntensity * 30 - trail * 5;
				const light = 60 + holdIntensity * 30 - trail * 10;

				smearGradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${holdIntensity * trailAlpha})`);
				smearGradient.addColorStop(0.5, `hsla(${hue}, ${sat}%, ${light}%, ${holdIntensity * trailAlpha * 0.5})`);
				smearGradient.addColorStop(1, `hsla(${hue}, ${sat}%, ${light}%, 0)`);

				ctx.fillStyle = smearGradient;
				ctx.beginPath();
				ctx.arc(vx, vy, smearSize, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	_drawLightning(ctx, mouseX, mouseY, time, holdIntensity, emergeEase) {
		if (holdIntensity <= 0.8 || emergeEase <= 0.9) return;

		const crackleIntensity = (holdIntensity - 0.8) / 0.2;
		const orbitRadius = (5 + holdIntensity * 20) * emergeEase;

		const vortexCount = 3 + Math.floor(holdIntensity > 0.7 ? (holdIntensity - 0.7) * 6.67 : 0);
		const rotationSpeed = (0.1 + holdIntensity * holdIntensity * 8) * emergeEase;
		const baseRotation = time * rotationSpeed;

		// Tiny sparks
		const sparkCount = 30 * crackleIntensity;
		for (let s = 0; s < sparkCount; s++) {
			const sparkAngle = Math.random() * Math.PI * 2;
			const sparkDist = orbitRadius + Math.random() * 40;
			const sparkX = mouseX + Math.cos(sparkAngle) * sparkDist;
			const sparkY = mouseY + Math.sin(sparkAngle) * sparkDist;

			const sparkAlpha = 0.3 + Math.random() * 0.4 * crackleIntensity;
			const sparkHue = 200 + holdIntensity * 100 + Math.random() * 40;
			ctx.fillStyle = `hsla(${sparkHue}, 80%, 75%, ${sparkAlpha})`;
			ctx.fillRect(sparkX - 0.5, sparkY - 0.5, 1, 1);
		}

		// Vortex positions
		const vortexPositions = [];
		for (let v = 0; v < vortexCount; v++) {
			const angle = baseRotation + (v * Math.PI * 2 / vortexCount);
			const wobble = Math.sin(time * 3 + v) * 2;
			vortexPositions.push({
				x: mouseX + Math.cos(angle) * (orbitRadius + wobble),
				y: mouseY + Math.sin(angle) * (orbitRadius + wobble),
			});
		}

		const zapChance = 0.02 + crackleIntensity * 0.08;

		// Lightning zaps between vortex points
		for (let i = 0; i < vortexCount; i++) {
			for (let j = i + 1; j < vortexCount; j++) {
				if (Math.random() < zapChance) {
					const oscAmplitude = holdIntensity * 20;
					const oscFreq = 5 + holdIntensity * 10;

					const startOsc = Math.sin(time * oscFreq + i * 2) * oscAmplitude;
					const endOsc = Math.sin(time * oscFreq + j * 2) * oscAmplitude;

					const startAngle = Math.atan2(vortexPositions[i].y - mouseY, vortexPositions[i].x - mouseX);
					const endAngle = Math.atan2(vortexPositions[j].y - mouseY, vortexPositions[j].x - mouseX);

					const start = {
						x: vortexPositions[i].x + Math.cos(startAngle) * startOsc,
						y: vortexPositions[i].y + Math.sin(startAngle) * startOsc,
					};
					const end = {
						x: vortexPositions[j].x + Math.cos(endAngle) * endOsc,
						y: vortexPositions[j].y + Math.sin(endAngle) * endOsc,
					};

					ctx.beginPath();
					ctx.moveTo(start.x, start.y);

					const midX = (start.x + end.x) / 2 + (Math.random() - 0.5) * 10;
					const midY = (start.y + end.y) / 2 + (Math.random() - 0.5) * 10;
					ctx.quadraticCurveTo(midX, midY, end.x, end.y);

					const lightningHue = 200 - holdIntensity * 80;
					const lightningSat = 60 - holdIntensity * 60;
					ctx.strokeStyle = `hsla(${lightningHue}, ${lightningSat}%, 95%, ${0.9 + Math.random() * 0.1})`;
					ctx.lineWidth = 0.1 + Math.random() * 0.3;
					ctx.shadowBlur = 30;
					ctx.shadowColor = `hsla(${lightningHue}, ${lightningSat + 20}%, 85%, 1)`;
					ctx.stroke();

					const endpointHue = (lightningHue + Math.random() * 60) % 360;
					ctx.fillStyle = `hsla(${endpointHue}, 90%, 90%, 0.8)`;
					ctx.beginPath();
					ctx.arc(start.x, start.y, 1, 0, Math.PI * 2);
					ctx.arc(end.x, end.y, 1, 0, Math.PI * 2);
					ctx.fill();

					const trailPoints = 2;
					for (let t = 1; t < trailPoints; t++) {
						const ratio = t / trailPoints;
						this.effects.push({
							x: start.x + (end.x - start.x) * ratio,
							y: start.y + (end.y - start.y) * ratio,
							radius: 6,
							startTime: performance.now(),
							duration: 150,
							intensity: 0.5,
							isLightning: true,
						});
					}
				}
			}

			// Occasional discharge to random point
			if (Math.random() < zapChance * 0.5) {
				const start = vortexPositions[i];
				const randomAngle = Math.random() * Math.PI * 2;
				const randomDist = orbitRadius * 1.5 + Math.random() * 30;
				const endX = mouseX + Math.cos(randomAngle) * randomDist;
				const endY = mouseY + Math.sin(randomAngle) * randomDist;

				ctx.beginPath();
				ctx.moveTo(start.x, start.y);
				ctx.lineTo(endX, endY);

				const dischargeHue = Math.random() * 360;
				ctx.strokeStyle = `hsla(${dischargeHue}, ${70 + holdIntensity * 30}%, 85%, ${0.7 + Math.random() * 0.3})`;
				ctx.lineWidth = 0.1 + Math.random() * 0.2;
				ctx.shadowBlur = 20;
				ctx.shadowColor = `hsla(${dischargeHue}, 80%, 75%, 0.9)`;
				ctx.stroke();

				this.effects.push({
					x: (start.x + endX) / 2,
					y: (start.y + endY) / 2,
					radius: 5,
					startTime: performance.now(),
					duration: 100,
					intensity: 0.3,
					isLightning: true,
				});
			}
		}

		ctx.shadowBlur = 0;
	}

	_drawCenterMelt(ctx, mouseX, mouseY, time, holdIntensity, emergeEase) {
		const orbitRadius = (5 + holdIntensity * 20) * emergeEase;

		const meltGradient = ctx.createRadialGradient(
			mouseX, mouseY, 0,
			mouseX, mouseY, orbitRadius * 1.5,
		);

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

		ctx.fillStyle = meltGradient;
		ctx.beginPath();
		ctx.arc(mouseX, mouseY, orbitRadius * 1.5, 0, Math.PI * 2);
		ctx.fill();
	}

	_drawSmoke(ctx, mouseX, mouseY, time, holdIntensity) {
		const smokeCount = 5;
		for (let i = 0; i < smokeCount; i++) {
			const tendrilPhase = (time * 0.7 + i * 1.3) % 3;
			const tendrilAlpha = Math.sin((tendrilPhase * Math.PI) / 3);

			if (tendrilAlpha > 0) {
				const drift1 = Math.sin(time * 0.8 + i * 2) * 30;
				const drift2 = Math.sin(time * 1.3 + i * 3) * 20;
				const drift3 = Math.sin(time * 0.5 + i * 1.7) * 15;

				const smokeGradient = ctx.createRadialGradient(
					mouseX + drift1 + drift3, mouseY + drift2, 0,
					mouseX + drift1 + drift3, mouseY + drift2, 20 + tendrilAlpha * 30 * holdIntensity,
				);

				const smokeIntensity = tendrilAlpha * holdIntensity * 0.2;
				const smokeHue = 30 - holdIntensity * 60 + i * 20;
				const smokeSat = 40 + holdIntensity * 30;
				smokeGradient.addColorStop(0, `hsla(${smokeHue}, ${smokeSat}%, 85%, ${smokeIntensity})`);
				smokeGradient.addColorStop(0.4, `hsla(${smokeHue + 30}, ${smokeSat - 10}%, 75%, ${smokeIntensity * 0.5})`);
				smokeGradient.addColorStop(1, `hsla(${smokeHue + 60}, ${smokeSat - 20}%, 65%, 0)`);

				ctx.fillStyle = smokeGradient;
				ctx.beginPath();
				ctx.arc(
					mouseX + drift1 + drift3, mouseY + drift2,
					25 + tendrilAlpha * 35 * holdIntensity,
					0, Math.PI * 2,
				);
				ctx.fill();
			}
		}
	}

	_createTorchBearerUI() {
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
		this._updateLeaderboardDisplay();
		document.body.appendChild(this.leaderboardElement);

		const style = document.createElement("style");
		style.textContent = `
			#ghost-leaderboard.visible {
				opacity: 1 !important;
			}
		`;
		document.head.appendChild(style);

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
	}

	_updateLeaderboardDisplay() {
		this.leaderboardElement.innerHTML = `✦ ${this.bestHoldDuration.toFixed(2)}s`;
	}
}

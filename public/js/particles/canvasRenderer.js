// Canvas 2D renderer for particles and connections.
// Extracted from particleSystem.js — serves as fallback when WebGL is unavailable.
import { PARTICLE_COLORS } from "./config.js";

export class CanvasRenderer {
	constructor(ctx) {
		this.ctx = ctx;
	}

	clear(width, height) {
		this.ctx.clearRect(0, 0, width, height);
	}

	// Draw all particles from the store, batched by color for efficiency.
	drawParticles(s, count) {
		const byColor = new Map();
		for (let i = 0; i < count; i++) {
			const c = s.color[i];
			let batch = byColor.get(c);
			if (!batch) {
				batch = [];
				byColor.set(c, batch);
			}
			batch.push(i);
		}

		for (const [c, batch] of byColor) {
			this.ctx.fillStyle = PARTICLE_COLORS[c];
			this.ctx.beginPath();
			for (const i of batch) {
				const x = s.x[i];
				const y = s.y[i];
				const r = s.radius[i];
				this.ctx.moveTo(x + r, y);
				this.ctx.arc(x, y, r, 0, Math.PI * 2);
			}
			this.ctx.fill();
		}
	}

	// Draw connection lines between nearby particles.
	// Uses the spatial hash to enumerate pairs efficiently.
	drawConnections(s, spatialHash, settings) {
		const connectionOpacity = settings.CONNECTION_OPACITY;
		if (connectionOpacity <= 0.001 || settings.INTERACTION_RADIUS <= 0) return;

		const interactionRadius = settings.INTERACTION_RADIUS;
		const interactionRadiusSq = interactionRadius * interactionRadius;
		const connectionColor = settings.CONNECTION_COLOR;
		const connectionWidth = settings.CONNECTION_WIDTH || 1;

		this.ctx.strokeStyle = connectionColor;
		this.ctx.lineWidth = connectionWidth;

		const linesByOpacity = {};

		spatialHash.forEachPair((i, j) => {
			const dx = s.x[j] - s.x[i];
			const dy = s.y[j] - s.y[i];
			const distSq = dx * dx + dy * dy;

			if (distSq < interactionRadiusSq) {
				const distance = Math.sqrt(distSq);
				const opacity = connectionOpacity * (1 - distance / interactionRadius);

				if (opacity > 0.001) {
					const opacityKey = Math.round(opacity * 20) / 20;
					if (!linesByOpacity[opacityKey]) {
						linesByOpacity[opacityKey] = [];
					}
					linesByOpacity[opacityKey].push(s.x[i], s.y[i], s.x[j], s.y[j]);
				}
			}
		});

		// Batch draw by opacity
		for (const opacityKey in linesByOpacity) {
			this.ctx.globalAlpha = Number.parseFloat(opacityKey);
			this.ctx.beginPath();

			const lines = linesByOpacity[opacityKey];
			for (let k = 0; k < lines.length; k += 4) {
				this.ctx.moveTo(lines[k], lines[k + 1]);
				this.ctx.lineTo(lines[k + 2], lines[k + 3]);
			}

			this.ctx.stroke();
		}

		this.ctx.globalAlpha = 1;
	}
}

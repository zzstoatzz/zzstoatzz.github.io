// Canvas 2D renderer for particles and connections.
// Extracted from particleSystem.js — serves as fallback when WebGL is unavailable.

export class CanvasRenderer {
	constructor(ctx) {
		this.ctx = ctx;
	}

	clear(width, height) {
		this.ctx.clearRect(0, 0, width, height);
	}

	// Draw all particles, batched by color for efficiency.
	drawParticles(particles, count) {
		const byColor = new Map();
		for (let i = 0; i < count; i++) {
			const p = particles[i];
			let batch = byColor.get(p.color);
			if (!batch) {
				batch = [];
				byColor.set(p.color, batch);
			}
			batch.push(p);
		}

		for (const [color, batch] of byColor) {
			this.ctx.fillStyle = color;
			this.ctx.beginPath();
			for (const p of batch) {
				this.ctx.moveTo(p.x + p.radius, p.y);
				this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
			}
			this.ctx.fill();
		}
	}

	// Draw connection lines between nearby particles.
	// Uses the spatial hash to enumerate pairs efficiently.
	drawConnections(particles, spatialHash, settings) {
		const connectionOpacity = settings.CONNECTION_OPACITY;
		if (connectionOpacity <= 0.001 || settings.INTERACTION_RADIUS <= 0) return;

		const interactionRadius = settings.INTERACTION_RADIUS;
		const interactionRadiusSq = interactionRadius * interactionRadius;
		const connectionColor = settings.CONNECTION_COLOR;
		const connectionWidth = settings.CONNECTION_WIDTH || 1;

		this.ctx.strokeStyle = connectionColor;
		this.ctx.lineWidth = connectionWidth;

		const linesByOpacity = {};

		spatialHash.forEachPair(particles, (i, j) => {
			const p1 = particles[i];
			const p2 = particles[j];

			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const distSq = dx * dx + dy * dy;

			if (distSq < interactionRadiusSq) {
				const distance = Math.sqrt(distSq);
				const opacity = connectionOpacity * (1 - distance / interactionRadius);

				if (opacity > 0.001) {
					const opacityKey = Math.round(opacity * 20) / 20;
					if (!linesByOpacity[opacityKey]) {
						linesByOpacity[opacityKey] = [];
					}
					linesByOpacity[opacityKey].push(p1.x, p1.y, p2.x, p2.y);
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

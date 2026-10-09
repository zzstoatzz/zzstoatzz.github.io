// Canvas 2D renderer for particles and connections.
// Extracted from particleSystem.js — serves as fallback when WebGL is unavailable.

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
			this.ctx.fillStyle = s.paletteHex[c];
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

	// Draw the connection lines the physics step built: vertex pairs of
	// (x, y, z) in pos with one alpha per vertex, batched by rounded opacity.
	drawConnections(pos, alpha, vertCount, settings) {
		if (vertCount === 0) return;

		this.ctx.strokeStyle = settings.CONNECTION_COLOR;
		this.ctx.lineWidth = settings.CONNECTION_WIDTH || 1;

		const linesByOpacity = {};
		for (let v = 0; v < vertCount; v += 2) {
			const opacityKey = Math.round(alpha[v] * 20) / 20;
			if (!linesByOpacity[opacityKey]) linesByOpacity[opacityKey] = [];
			const k = v * 3;
			linesByOpacity[opacityKey].push(pos[k], pos[k + 1], pos[k + 3], pos[k + 4]);
		}

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

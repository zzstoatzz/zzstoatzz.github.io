// Canvas 2D renderer for particles and connections, used when WebGL is
// unavailable.
import type { Settings } from "./config";
import type { ParticleStore } from "./particleStore";

export class CanvasRenderer {
	constructor(private ctx: CanvasRenderingContext2D) {}

	clear(width: number, height: number) {
		this.ctx.clearRect(0, 0, width, height);
	}

	// Draw all particles from the store, batched by color.
	drawParticles(s: ParticleStore, count: number) {
		const byColor = new Map<number, number[]>();
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
	drawConnections(pos: Float32Array, alpha: Float32Array, vertCount: number, settings: Settings) {
		if (vertCount === 0) return;

		this.ctx.strokeStyle = settings.CONNECTION_COLOR;
		this.ctx.lineWidth = settings.CONNECTION_WIDTH || 1;

		const linesByOpacity = new Map<number, number[]>();
		for (let v = 0; v < vertCount; v += 2) {
			const opacity = Math.round(alpha[v] * 20) / 20;
			let lines = linesByOpacity.get(opacity);
			if (!lines) {
				lines = [];
				linesByOpacity.set(opacity, lines);
			}
			const k = v * 3;
			lines.push(pos[k], pos[k + 1], pos[k + 3], pos[k + 4]);
		}

		for (const [opacity, lines] of linesByOpacity) {
			this.ctx.globalAlpha = opacity;
			this.ctx.beginPath();
			for (let k = 0; k < lines.length; k += 4) {
				this.ctx.moveTo(lines[k], lines[k + 1]);
				this.ctx.lineTo(lines[k + 2], lines[k + 3]);
			}
			this.ctx.stroke();
		}

		this.ctx.globalAlpha = 1;
	}
}

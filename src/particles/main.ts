// Entry point: ParticlesContainer.tsx imports this on the client. The styles
// (particles.css) are imported by app/layout.tsx.
import { ParticleSystem } from "./particleSystem";

declare global {
	interface Window {
		// the running system, handy from the console
		particleSystem?: ParticleSystem | null;
	}
}

// Start the particles on canvas, with mouse effects and shapes drawn on
// overlay. Replaces any system already running.
export function initParticles(canvas: HTMLCanvasElement, overlay?: HTMLCanvasElement | null): ParticleSystem {
	const old = window.particleSystem;
	if (old) {
		old.stop();
		old.webglRenderer?.dispose();
		old.gpu?.dispose();
		window.particleSystem = null;
	}

	const system = new ParticleSystem(canvas, overlay || null);
	window.particleSystem = system;
	return system;
}

// Per-particle operations on a ParticleStore (see particleStore.ts). A particle
// is just an index into the store's arrays.
import type { Settings } from "./config";
import { MIN_RANDOM_SIZE, MAX_RANDOM_SIZE, SIZE_VARIATION_FACTOR, PARTICLE_COLORS, CUSTOM_COLOR } from "./config";
import type { ParticleStore } from "./particleStore";

// Radius from the average size and the particle's fixed variation factor,
// clamped to the absolute limits; mass follows the radius.
function setSize(s: ParticleStore, i: number, avg: number) {
	const variationAmount = s.sizeVar[i] * SIZE_VARIATION_FACTOR;
	const sizeWithVariation = avg * (1 + variationAmount);
	s.radius[i] = Math.max(MIN_RANDOM_SIZE, Math.min(MAX_RANDOM_SIZE, sizeWithVariation));
	s.mass[i] = Math.PI * s.radius[i] * s.radius[i];
}

// A random color from the mix. Always draws, so the Math.random sequence does
// not depend on the color mode.
export function randomColor(settings: Settings): number {
	const c = Math.floor(Math.random() * PARTICLE_COLORS.length);
	return settings.PARTICLE_SINGLE_COLOR ? CUSTOM_COLOR : c;
}

// New particle at (x, y) with a small random velocity, a random size
// variation in [-1, 1] and a color (random from the mix, or the single color).
export function spawnParticle(s: ParticleStore, i: number, x: number, y: number, settings: Settings) {
	s.x[i] = x;
	s.y[i] = y;
	s.vx[i] = (Math.random() - 0.5) * 2;
	s.vy[i] = (Math.random() - 0.5) * 2;
	s.sizeVar[i] = Math.random() * 2 - 1;
	setSize(s, i, settings.AVERAGE_PARTICLE_SIZE);
	s.color[i] = randomColor(settings);
}

// Re-derive the size when the size slider changes.
export function applyParticleSettings(s: ParticleStore, i: number, settings: Settings) {
	setSize(s, i, settings.AVERAGE_PARTICLE_SIZE);
}

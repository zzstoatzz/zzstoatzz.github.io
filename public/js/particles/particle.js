// Per-particle operations on a ParticleStore (see particleStore.js). A particle
// is just an index into the store's arrays.
import { MIN_RANDOM_SIZE, MAX_RANDOM_SIZE, SIZE_VARIATION_FACTOR, PARTICLE_COLORS } from "./config.js";

// Average size setting, accepting the legacy PARTICLE_SIZE key; null if unset.
function averageSize(settings) {
	if (settings.AVERAGE_PARTICLE_SIZE !== undefined) return settings.AVERAGE_PARTICLE_SIZE;
	if (settings.PARTICLE_SIZE !== undefined) return settings.PARTICLE_SIZE;
	return null;
}

// Radius from the average size and the particle's fixed variation factor,
// clamped to the absolute limits; mass follows the radius.
function setSize(s, i, avg) {
	const variationAmount = s.sizeVar[i] * SIZE_VARIATION_FACTOR;
	const sizeWithVariation = avg * (1 + variationAmount);
	s.radius[i] = Math.max(MIN_RANDOM_SIZE, Math.min(MAX_RANDOM_SIZE, sizeWithVariation));
	s.mass[i] = Math.PI * s.radius[i] * s.radius[i];
}

// New particle at (x, y) with a small random velocity, a random size
// variation in [-1, 1] and a random palette color.
export function spawnParticle(s, i, x, y, settings) {
	s.x[i] = x;
	s.y[i] = y;
	s.vx[i] = (Math.random() - 0.5) * 2;
	s.vy[i] = (Math.random() - 0.5) * 2;
	s.sizeVar[i] = Math.random() * 2 - 1;
	setSize(s, i, averageSize(settings) ?? 2.5);
	s.color[i] = Math.floor(Math.random() * PARTICLE_COLORS.length);
}

// Re-derive the size when the size slider changes.
export function applyParticleSettings(s, i, settings) {
	if (!settings) return;
	const avg = averageSize(settings);
	if (avg !== null) setSize(s, i, avg);
}

// Gravity, drag, move, and bounce off the canvas walls.
export function updateParticle(s, i, deltaTime, canvasWidth, canvasHeight, settings) {
	const gravity = settings ? settings.GRAVITY || 0 : 0;
	const drag = settings ? settings.DRAG || 0.01 : 0.01;
	const elasticity = settings.ELASTICITY !== undefined ? settings.ELASTICITY : 0.8;
	const dtAdjust = deltaTime * 60; // Adjustment factor relative to 60fps
	const radius = s.radius[i];
	let x = s.x[i];
	let y = s.y[i];
	let vx = s.vx[i];
	let vy = s.vy[i];

	if (gravity !== 0) {
		vy += gravity * deltaTime;
	}

	const speed = Math.sqrt(vx * vx + vy * vy);
	if (speed > 1e-6) {
		const dragFactor = 1.0 - drag * dtAdjust;
		vx *= Math.max(0, dragFactor);
		vy *= Math.max(0, dragFactor);
	}

	// Scale velocity by deltaTime for consistent physics
	x += vx * dtAdjust;
	y += vy * dtAdjust;

	// Boundary collision with elasticity and a slight random angle to avoid
	// perfect reflection loops
	const pushOut = 0.1; // Small offset to prevent sticking

	if (x - radius < 0) {
		x = radius + pushOut;
		vx *= -elasticity;
		vy += (Math.random() - 0.5) * 0.1 * Math.abs(vx);
	} else if (x + radius > canvasWidth) {
		x = canvasWidth - radius - pushOut;
		vx *= -elasticity;
		vy += (Math.random() - 0.5) * 0.1 * Math.abs(vx);
	}

	if (y - radius < 0) {
		y = radius + pushOut;
		vy *= -elasticity;
		vx += (Math.random() - 0.5) * 0.1 * Math.abs(vy);
	} else if (y + radius > canvasHeight) {
		y = canvasHeight - radius - pushOut;
		vy *= -elasticity;
		vx += (Math.random() - 0.5) * 0.1 * Math.abs(vy);
	}

	s.x[i] = x;
	s.y[i] = y;
	s.vx[i] = vx;
	s.vy[i] = vy;
}

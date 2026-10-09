// Configuration constants for the particle system

export const RANGES = {
	PARTICLE_COUNT: { min: 50, max: 15000, step: 50, default: 700 },
	AVERAGE_PARTICLE_SIZE: { min: 1, max: 6, step: 0.1, default: 2.5 },
	DRAG: { min: 0, max: 0.2, step: 0.005, default: 0.05 },
	EXPLOSION_RADIUS: { min: 50, max: 500, step: 10, default: 250 },
	EXPLOSION_FORCE: { min: 0, max: 7.5, step: 0.05, default: 0.5 },
	ATTRACT: { min: -1000, max: 1000, step: 1, default: -100 },
	GRAVITY: { min: -25, max: 25, step: 0.5, default: 0 },
	ELASTICITY: { min: 0.1, max: 1.0, step: 0.05, default: 0.8 },
	INTERACTION_RADIUS: { min: 10, max: 300, step: 5, default: 60 },
	SMOOTHING_FACTOR: { min: 0.01, max: 0.3, step: 0.01, default: 0.13 },
	CONNECTION_OPACITY: { min: 0, max: 0.5, step: 0.01, default: 0.05 },
	CONNECTION_COLOR: { default: "#64ffda" },
	CONNECTION_WIDTH: { min: 0.1, max: 2, step: 0.1, default: 0.3 },
	PARTICLE_COLOR: { default: "#64ffda" },
	// true: every particle takes PARTICLE_COLOR; false: a random PARTICLE_COLORS mix
	PARTICLE_SINGLE_COLOR: { default: false },
	ENABLE_VORTEX_FORCE: { default: false },
	SHAPES: { default: "" },
};

// Generate default settings object from the RANGES
export const DEFAULT_SETTINGS = Object.fromEntries(
	Object.entries(RANGES).map(([key, value]) => [key, value.default]),
);

// Define constants for randomized size
export const MIN_RANDOM_SIZE = 0.5; // Absolute minimum size
export const MAX_RANDOM_SIZE = 10.0; // Absolute maximum size
export const SIZE_VARIATION_FACTOR = 0.6; // e.g., 0.6 means size can vary +/- 60% from average

// Particle color presets
export const PARTICLE_COLORS = [
	"#64ffda", // Teal
	"#00bfff", // Deep sky blue
	"#ff6b6b", // Light red
	"#f8f38d", // Light yellow
	"#42b883", // Vue green
	"#bd93f9", // Purple
	"#ff79c6", // Pink
	"#ffb86c", // Orange
];

// "#rrggbb" -> [r, g, b] in 0..1
export function hexToRgb(hex) {
	return [
		Number.parseInt(hex.slice(1, 3), 16) / 255,
		Number.parseInt(hex.slice(3, 5), 16) / 255,
		Number.parseInt(hex.slice(5, 7), 16) / 255,
	];
}

// [r, g, b] per PARTICLE_COLORS entry. Particles store a color as an index:
// 0..PARTICLE_COLORS.length-1 for the mix, CUSTOM_COLOR for the single color.
export const PARTICLE_RGB = PARTICLE_COLORS.map(hexToRgb);
export const CUSTOM_COLOR = PARTICLE_COLORS.length;


// HTML template for the particle controls panel

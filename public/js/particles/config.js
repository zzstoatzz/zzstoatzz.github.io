// Configuration constants for the particle system

export const RANGES = {
	PARTICLE_COUNT: { min: 50, max: 3000, step: 10, default: 700 },
	AVERAGE_PARTICLE_SIZE: { min: 1, max: 6, step: 0.1, default: 2.5 },
	DRAG: { min: 0, max: 0.2, step: 0.005, default: 0.05 },
	EXPLOSION_RADIUS: { min: 50, max: 500, step: 10, default: 250 },
	EXPLOSION_FORCE: { min: 0, max: 30, step: 1, default: 1.0 },
	ATTRACT: { min: -1000, max: 1000, step: 1, default: -100 },
	GRAVITY: { min: -100, max: 100, step: 0.5, default: 0 },
	ELASTICITY: { min: 0.1, max: 1.0, step: 0.05, default: 0.8 },
	INTERACTION_RADIUS: { min: 10, max: 300, step: 5, default: 60 },
	SMOOTHING_FACTOR: { min: 0.01, max: 0.3, step: 0.01, default: 0.13 },
	CONNECTION_OPACITY: { min: 0, max: 0.5, step: 0.01, default: 0.05 },
	CONNECTION_COLOR: { default: "#64ffda" },
	CONNECTION_WIDTH: { min: 0.1, max: 2, step: 0.1, default: 0.3 },
	PARTICLE_COLOR: { default: "#64ffda" },
	ENABLE_VORTEX_FORCE: { default: false },
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

// Particle appearance configuration
export const MIN_PARTICLE_RADIUS = 1;
export const MAX_PARTICLE_RADIUS = 4;

// Color palettes for particles
export const PALETTES = {
	default: [
		"rgba(173, 216, 230, 0.7)", // Light blue
		"rgba(240, 255, 255, 0.7)", // Azure
		"rgba(135, 206, 250, 0.7)", // Sky blue
		"rgba(224, 255, 255, 0.7)", // Light cyan
		"rgba(175, 238, 238, 0.7)", // Pale turquoise
	],
	sunset: [
		"rgba(255, 204, 0, 0.7)", // Yellow
		"rgba(255, 102, 0, 0.7)", // Orange
		"rgba(255, 0, 0, 0.7)", // Red
		"rgba(204, 0, 102, 0.7)", // Magenta
		"rgba(102, 0, 204, 0.7)", // Purple
	],
	forest: [
		"rgba(0, 102, 0, 0.7)", // Dark green
		"rgba(0, 153, 0, 0.7)", // Medium green
		"rgba(0, 204, 0, 0.7)", // Light green
		"rgba(102, 153, 0, 0.7)", // Olive
		"rgba(153, 204, 0, 0.7)", // Lime
	],
	ocean: [
		"rgba(0, 102, 153, 0.7)", // Dark blue
		"rgba(0, 153, 204, 0.7)", // Medium blue
		"rgba(0, 204, 255, 0.7)", // Light blue
		"rgba(0, 153, 153, 0.7)", // Teal
		"rgba(0, 204, 204, 0.7)", // Cyan
	],
	custom: [],
};

// Default active palette
export const currentPalette = "default";

// CSS for the particle settings panel
export const SETTINGS_STYLES = `
.particle-controls {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 1000;
    font-family: Arial, sans-serif;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.7);
    color: #64ffda;
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    min-width: 250px;
    max-width: 300px;
}
.settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}
.settings-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: normal;
}
.controls-content {
    max-height: 70vh;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 5px;
    margin-right: -5px;
}
.controls-content::-webkit-scrollbar {
    width: 5px;
}
.controls-content::-webkit-scrollbar-thumb {
    background: rgba(100, 255, 218, 0.3);
    border-radius: 3px;
}
.controls-content::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}
.control-group {
    margin-bottom: 10px;
}
.control-group label {
    display: block;
    margin-bottom: 5px;
    color: rgba(100, 255, 218, 0.7);
}
.control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.slider-input {
    flex-grow: 1;
    margin-right: 10px;
    background: rgba(255, 255, 255, 0.1);
    -webkit-appearance: none;
    height: 5px;
    border-radius: 2px;
}
.slider-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #64ffda;
    cursor: pointer;
}
.value-display {
    min-width: 40px;
    text-align: right;
    font-family: monospace;
}
.color-input {
    width: 25px;
    height: 25px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
}
.button {
    background: rgba(100, 255, 218, 0.2);
    color: #64ffda;
    border: 1px solid rgba(100, 255, 218, 0.3);
    border-radius: 4px;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 12px;
}
.button:hover {
    background: rgba(100, 255, 218, 0.3);
}
.small-input {
    width: 50px;
    padding: 3px 5px;
    border-radius: 3px;
    border: 1px solid rgba(100, 255, 218, 0.3);
    background: rgba(0, 0, 0, 0.5);
    color: white;
}
.palette-control {
    margin-top: 15px;
}
.palette-control select {
    width: 100%;
    padding: 3px 5px;
    border-radius: 3px;
    border: 1px solid rgba(100, 255, 218, 0.3);
    background: rgba(0, 0, 0, 0.5);
    color: white;
    margin-bottom: 5px;
}
.color-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 5px;
}
.color-item {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    cursor: pointer;
    position: relative;
}
.color-item:hover::after {
    content: "×";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-weight: bold;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
}
`;

// HTML template for the particle controls panel
export const PARTICLE_CONTROLS_TEMPLATE = `
<div class="particle-controls">
    <div class="settings-header">
        <h3>particle settings</h3>
        <button id="configToggle" class="button">↓</button>
    </div>
    <div id="controlsContent" class="controls-content">
        <div class="control-group">
            <label for="PARTICLE_COUNT">Particle Count</label>
            <div class="control-row">
                <input type="range" id="PARTICLE_COUNT" class="slider-input" 
                    min="${RANGES.PARTICLE_COUNT.min}" 
                    max="${RANGES.PARTICLE_COUNT.max}" 
                    step="${RANGES.PARTICLE_COUNT.step}" 
                    value="${RANGES.PARTICLE_COUNT.default}">
                <span id="PARTICLE_COUNT_VALUE" class="value-display">${RANGES.PARTICLE_COUNT.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="AVERAGE_PARTICLE_SIZE">Average Particle Size</label>
            <div class="control-row">
                <input type="range" id="AVERAGE_PARTICLE_SIZE" class="slider-input"
                    min="${RANGES.AVERAGE_PARTICLE_SIZE.min}" 
                    max="${RANGES.AVERAGE_PARTICLE_SIZE.max}" 
                    step="${RANGES.AVERAGE_PARTICLE_SIZE.step}" 
                    value="${RANGES.AVERAGE_PARTICLE_SIZE.default}">
                <span id="AVERAGE_PARTICLE_SIZE_VALUE" class="value-display">${RANGES.AVERAGE_PARTICLE_SIZE.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="DRAG">Drag</label>
            <div class="control-row">
                <input type="range" id="DRAG" class="slider-input"
                    min="${RANGES.DRAG.min}" 
                    max="${RANGES.DRAG.max}" 
                    step="${RANGES.DRAG.step}" 
                    value="${RANGES.DRAG.default}">
                <span id="DRAG_VALUE" class="value-display">${RANGES.DRAG.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="ELASTICITY">Elasticity</label>
            <div class="control-row">
                <input type="range" id="ELASTICITY" class="slider-input"
                    min="${RANGES.ELASTICITY.min}" 
                    max="${RANGES.ELASTICITY.max}" 
                    step="${RANGES.ELASTICITY.step}" 
                    value="${RANGES.ELASTICITY.default}">
                <span id="ELASTICITY_VALUE" class="value-display">${RANGES.ELASTICITY.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="EXPLOSION_RADIUS">Explosion Radius</label>
            <div class="control-row">
                <input type="range" id="EXPLOSION_RADIUS" class="slider-input"
                    min="${RANGES.EXPLOSION_RADIUS.min}" 
                    max="${RANGES.EXPLOSION_RADIUS.max}" 
                    step="${RANGES.EXPLOSION_RADIUS.step}" 
                    value="${RANGES.EXPLOSION_RADIUS.default}">
                <span id="EXPLOSION_RADIUS_VALUE" class="value-display">${RANGES.EXPLOSION_RADIUS.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="EXPLOSION_FORCE">Explosion Force</label>
            <div class="control-row">
                <input type="range" id="EXPLOSION_FORCE" class="slider-input"
                    min="${RANGES.EXPLOSION_FORCE.min}" 
                    max="${RANGES.EXPLOSION_FORCE.max}" 
                    step="${RANGES.EXPLOSION_FORCE.step}" 
                    value="${RANGES.EXPLOSION_FORCE.default}">
                <span id="EXPLOSION_FORCE_VALUE" class="value-display">${RANGES.EXPLOSION_FORCE.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="ATTRACT">Attraction Force</label>
            <div class="control-row">
                <input type="range" id="ATTRACT" class="slider-input"
                    min="${RANGES.ATTRACT.min}" 
                    max="${RANGES.ATTRACT.max}" 
                    step="${RANGES.ATTRACT.step}" 
                    value="${RANGES.ATTRACT.default}">
                <span id="ATTRACT_VALUE" class="value-display">${RANGES.ATTRACT.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="GRAVITY">Gravity</label>
            <div class="control-row">
                <input type="range" id="GRAVITY" class="slider-input"
                    min="${RANGES.GRAVITY.min}" 
                    max="${RANGES.GRAVITY.max}" 
                    step="${RANGES.GRAVITY.step}" 
                    value="${RANGES.GRAVITY.default}">
                <span id="GRAVITY_VALUE" class="value-display">${RANGES.GRAVITY.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="INTERACTION_RADIUS">Interaction Radius</label>
            <div class="control-row">
                <input type="range" id="INTERACTION_RADIUS" class="slider-input"
                    min="${RANGES.INTERACTION_RADIUS.min}" 
                    max="${RANGES.INTERACTION_RADIUS.max}" 
                    step="${RANGES.INTERACTION_RADIUS.step}" 
                    value="${RANGES.INTERACTION_RADIUS.default}">
                <span id="INTERACTION_RADIUS_VALUE" class="value-display">${RANGES.INTERACTION_RADIUS.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="CONNECTION_OPACITY">Connection Opacity</label>
            <div class="control-row">
                <input type="range" id="CONNECTION_OPACITY" class="slider-input"
                    min="${RANGES.CONNECTION_OPACITY.min}" 
                    max="${RANGES.CONNECTION_OPACITY.max}" 
                    step="${RANGES.CONNECTION_OPACITY.step}" 
                    value="${RANGES.CONNECTION_OPACITY.default}">
                <span id="CONNECTION_OPACITY_VALUE" class="value-display">${RANGES.CONNECTION_OPACITY.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="CONNECTION_COLOR">Connection Color</label>
            <div class="control-row">
                <input type="color" id="CONNECTION_COLOR" class="color-input" value="${RANGES.CONNECTION_COLOR.default}">
                <span id="CONNECTION_COLOR_VALUE" class="value-display">${RANGES.CONNECTION_COLOR.default}</span>
            </div>
        </div>
        <div class="control-group">
            <label for="SMOOTHING_FACTOR">Smoothing Factor</label>
            <div class="control-row">
                <input type="range" id="SMOOTHING_FACTOR" class="slider-input"
                    min="${RANGES.SMOOTHING_FACTOR.min}" 
                    max="${RANGES.SMOOTHING_FACTOR.max}" 
                    step="${RANGES.SMOOTHING_FACTOR.step}" 
                    value="${RANGES.SMOOTHING_FACTOR.default}">
                <span id="SMOOTHING_FACTOR_VALUE" class="value-display">${RANGES.SMOOTHING_FACTOR.default}</span>
            </div>
        </div>
        
        <div class="control-group">
            <label for="ENABLE_VORTEX_FORCE">Enable Vortex Force</label>
            <div class="control-row">
                <input type="checkbox" id="ENABLE_VORTEX_FORCE" ${RANGES.ENABLE_VORTEX_FORCE.default ? 'checked' : ''}>
                <span class="value-display">special mouse force</span>
            </div>
        </div>
        
        <div class="control-group">
            <label>Add Custom Particle</label>
            <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 5px;">
                <label style="margin: 0; flex-shrink: 0;">Radius:</label>
                <input type="range" id="newParticleRadius" class="slider-input" min="1" max="10" step="0.1" value="3">
                <span id="newParticleRadiusValue" class="value-display">3.0</span>
            </div>
            <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 5px;">
                <label style="margin: 0; flex-shrink: 0;">Color:</label>
                <input type="color" id="newParticleColor" value="#ffffff">
            </div>
            <button id="addParticle" class="button">Add Particle</button>
        </div>
        
        <div class="palette-control">
            <label for="palettes">Color Palette</label>
            <select id="palettes">
                <option value="default">Default</option>
                <option value="sunset">Sunset</option>
                <option value="forest">Forest</option>
                <option value="ocean">Ocean</option>
                <option value="custom">Custom</option>
            </select>
            
            <div id="customPaletteControls" style="display: none;">
                <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 5px;">
                    <input type="color" id="newPaletteColor" value="#ffffff">
                    <button id="addColorToPalette" class="button">Add Color</button>
                </div>
                <div id="customPaletteColors" class="color-list"></div>
            </div>
        </div>
        
        <div style="margin-top: 15px;">
            <button id="resetDefaults" class="button">Reset to Defaults</button>
            <button id="generateShareLink" class="button" style="margin-left: 5px;">Share Link</button>
        </div>
    </div>
</div>
`;

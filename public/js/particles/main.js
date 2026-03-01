import { ParticleSystem } from './particleSystem.js';

// Main initialization function
function init(canvas, overlayCanvas) {
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }

    // Clean up any existing instance to prevent double-init
    if (window.particleSystem) {
        window.particleSystem.stop();
        if (window.particleSystem.webglRenderer) {
            window.particleSystem.webglRenderer.dispose();
        }
        window.particleSystem = null;
    }

    const particleSystem = new ParticleSystem(canvas, overlayCanvas || null);
    window.particleSystem = particleSystem;
    return particleSystem;
}

// Make init function globally accessible (React calls this via ParticlesContainer)
window.particlesInit = init;

# AGENTS.md

## Project Overview

This is a Next.js website with an interactive particle system. The main feature is a sophisticated canvas-based particle animation with mouse interaction effects.

## Architecture

### Frontend Structure
```
src/app/
├── components/
│   ├── ParticlesContainer.tsx    # React wrapper for particle system
│   ├── Background.tsx            # Background component
│   ├── NavigationDrawer.tsx      # Site navigation
│   └── ...other UI components
├── contexts/                     # React contexts
├── pages/                        # Next.js pages
└── styles/                       # CSS styles
```

### Particle System (JavaScript)
```
public/js/particles/
├── main.js                  # Entry point, initializes system
├── particleSystem.js        # Core system logic (~1200 lines)
├── particle.js              # Individual particle behavior
├── settingsManager.js       # Configuration management
├── uiController.js          # UI controls/settings panel
└── config.js                # Color schemes and constants
```

## How It Works

### Integration Pattern
- **TypeScript → JavaScript**: `ParticlesContainer.tsx` loads the JS particle system via Next.js `<Script>` tag
- **Global Interface**: JavaScript exposes `window.particlesInit()` for React to call
- **Canvas Rendering**: Pure canvas 2D context, no WebGL

### Particle System Core

#### Spatial Optimization
- **Grid-based partitioning**: Particles divided into cells for efficient collision detection
- **Neighbor checking**: Only check adjacent grid cells for interactions
- **Performance scaling**: Handles thousands of particles smoothly

#### Mouse Interaction System
- **Hold tracking**: Measures how long mouse is held down
- **Intensity scaling**: Effects grow logarithmically with hold duration
- **Two main effects**:
  1. **Pinwheel**: Colorful spinning vortex that grows more complex over time
  2. **Aura**: Soft background glow that fades in slowly around the pinwheel

#### Visual Effects Architecture

**Pinwheel System**:
- Multiple rotating points creating trails
- Color cycling through spectrum based on intensity
- Lightning effects at high intensity
- Organic movement with wobble/drift

**Aura System**:
- Silk-like layered gradients
- Starts at 0.8 seconds, fully emerges by 1.5 seconds
- Rainbow color cycling from blue → purple → orange
- Breathing/pulsing animation

#### Settings System
- Real-time parameter adjustment
- Particle count, attraction/repulsion forces
- Connection opacity and colors
- Explosion radius and force
- All changes apply immediately without restart

## Key Files Deep Dive

### `particleSystem.js`
- **Main class**: `ParticleSystem` (~1200 lines)
- **Key methods**:
  - `updateAndDrawMouseEffects()`: Handles hold effects and aura rendering
  - `applyMouseForce()`: Mouse interaction physics
  - `updateGrid()`: Spatial partitioning
  - `applyAttraction()`: Inter-particle forces

### `ParticlesContainer.tsx`
- React wrapper component
- Handles canvas sizing and script loading
- Provides router integration for navigation
- Manages initialization timing

## Development Notes

### Performance Considerations
- Grid system crucial for particle count scaling
- Batch drawing operations by color/opacity
- FPS limiting and delta time calculations
- Efficient memory management for effects arrays

### Common Modification Patterns
- **Timing changes**: Modify hold duration thresholds in `updateAndDrawMouseEffects()`
- **Color schemes**: Update HSL calculations in gradient creation
- **Effect intensity**: Adjust opacity multipliers in gradient stops
- **Size/scale**: Modify radius calculations and layer sizing

### Architecture Quirks
- Mixed TypeScript (React) and vanilla JavaScript (particles)
- Global window interface for communication
- Canvas coordinates vs screen coordinates handling
- Touch event handling for mobile compatibility

## Quick Start for Modifications

1. **Visual changes**: Focus on `updateAndDrawMouseEffects()` method
2. **Physics changes**: Modify `applyMouseForce()` and `applyAttraction()`
3. **UI changes**: Update `uiController.js` and corresponding React components
4. **Performance**: Adjust grid cell size in `updateGrid()` method

The system is designed to be real-time responsive - most changes can be tested immediately without restart. 
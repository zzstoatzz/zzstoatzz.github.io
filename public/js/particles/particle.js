import { MIN_RANDOM_SIZE, MAX_RANDOM_SIZE, SIZE_VARIATION_FACTOR, PARTICLE_COLORS } from "./config.js";

export class Particle {
    constructor(x, y, settings) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 2; // Small initial velocity
        this.vy = (Math.random() - 0.5) * 2;
        
        // Calculate randomized radius based on average size and variation
        // Check for both AVERAGE_PARTICLE_SIZE and legacy PARTICLE_SIZE, with AVERAGE_PARTICLE_SIZE taking precedence
        const averageSize = settings.AVERAGE_PARTICLE_SIZE !== undefined 
            ? settings.AVERAGE_PARTICLE_SIZE 
            : (settings.PARTICLE_SIZE !== undefined ? settings.PARTICLE_SIZE : 2.5);
            
        // Store the random factor for this particle (-1 to 1) to maintain consistent variation
        this.sizeVariationFactor = Math.random() * 2 - 1; // Range from -1 to 1
        
        // Apply the variation factor
        const variationAmount = this.sizeVariationFactor * SIZE_VARIATION_FACTOR;
        const sizeWithVariation = averageSize * (1 + variationAmount);
        
        // Clamp to min/max limits
        this.radius = Math.max(
            MIN_RANDOM_SIZE,
            Math.min(
                MAX_RANDOM_SIZE,
                sizeWithVariation
            )
        );
        
        this.color = this.getRandomColor(settings);
        this.mass = Math.PI * this.radius * this.radius;
    }

    getRandomColor() {
        return PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
    }

    updateSettings(settings) {
        if (!settings) return;
        
        // Handle both AVERAGE_PARTICLE_SIZE and legacy PARTICLE_SIZE
        const newSize = settings.AVERAGE_PARTICLE_SIZE !== undefined 
            ? settings.AVERAGE_PARTICLE_SIZE 
            : (settings.PARTICLE_SIZE !== undefined ? settings.PARTICLE_SIZE : null);
            
        // Update particle size when slider changes
        if (newSize !== null) {
            // Apply the same variation factor to the new average size
            const variationAmount = this.sizeVariationFactor * SIZE_VARIATION_FACTOR;
            const sizeWithVariation = newSize * (1 + variationAmount);
            
            // Clamp to min/max limits
            this.radius = Math.max(
                MIN_RANDOM_SIZE,
                Math.min(
                    MAX_RANDOM_SIZE,
                    sizeWithVariation
                )
            );
            
            // Update mass based on new radius
            this.mass = Math.PI * this.radius * this.radius;
        }
    }

    update(deltaTime, canvasWidth, canvasHeight, settings) {
        // Use passed settings directly rather than global lookup
        const gravity = settings ? settings.GRAVITY || 0 : 0;
        const drag = settings ? settings.DRAG || 0.01 : 0.01;
        // Get elasticity from settings
        const elasticity = settings.ELASTICITY !== undefined ? settings.ELASTICITY : 0.8;
        const dtAdjust = deltaTime * 60; // Adjustment factor relative to 60fps
        
        // Apply gravity
        if (gravity !== 0) {
            this.vy += gravity * deltaTime;
        }
        
        // Calculate efficient drag
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed > 1e-6) {
            const dragFactor = 1.0 - (drag * dtAdjust);
            this.vx *= Math.max(0, dragFactor);
            this.vy *= Math.max(0, dragFactor);
        }
        
        // Scale velocity by deltaTime for consistent physics
        this.x += this.vx * dtAdjust;
        this.y += this.vy * dtAdjust;
        
        // Boundary collision with improved elasticity and random angle
        const pushOut = 0.1; // Small offset to prevent sticking
        
        if (this.x - this.radius < 0) {
            this.x = this.radius + pushOut;
            this.vx *= -elasticity;
            // Add slight random angle to avoid perfect reflection loops
            this.vy += (Math.random() - 0.5) * 0.1 * Math.abs(this.vx);
        } else if (this.x + this.radius > canvasWidth) {
            this.x = canvasWidth - this.radius - pushOut;
            this.vx *= -elasticity;
            this.vy += (Math.random() - 0.5) * 0.1 * Math.abs(this.vx);
        }
        
        if (this.y - this.radius < 0) {
            this.y = this.radius + pushOut;
            this.vy *= -elasticity;
            this.vx += (Math.random() - 0.5) * 0.1 * Math.abs(this.vy);
        } else if (this.y + this.radius > canvasHeight) {
            this.y = canvasHeight - this.radius - pushOut;
            this.vy *= -elasticity;
            this.vx += (Math.random() - 0.5) * 0.1 * Math.abs(this.vy);
        }
    }
    
    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }
} 
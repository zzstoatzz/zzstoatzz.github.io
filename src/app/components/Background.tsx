'use client';

import { useBackground } from '../contexts/BackgroundContext';
import { ParticlesContainer } from './ParticlesContainer';

export default function Background() {
    const { background } = useBackground();

    return (
        <>
            {/* Background layer (behind particles) */}
            {background.type === 'solid' && (
                <div 
                    className="background-layer fixed inset-0 z-0" 
                    style={{ backgroundColor: background.color }}
                />
            )}
            
            {background.type === 'image' && (
                <div 
                    className="background-layer fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
                    style={{ 
                        backgroundImage: `url(${background.imageUrl})`,
                        backgroundColor: background.color // fallback
                    }}
                />
            )}

            {/* Particles layer (always on top) */}
            <ParticlesContainer />
        </>
    );
} 
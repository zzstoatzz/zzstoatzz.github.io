'use client'

import { useEffect, useRef } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';

// Define minimal router type for our needs
interface RouterInstance {
    push: (path: string) => void;
}

declare global {
    interface Window {
        particlesInit: (canvas: HTMLCanvasElement, overlay?: HTMLCanvasElement) => void;
        nextRouter: RouterInstance;
    }
}

export function ParticlesContainer() {
    const particlesInitialized = useRef<boolean>(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const router = useRouter();

    useEffect(() => {
        window.nextRouter = router;

        const initParticles = () => {
            if (
                canvasRef.current &&
                typeof window.particlesInit === 'function' &&
                !particlesInitialized.current
            ) {
                console.log('Initializing particles');
                const canvas = canvasRef.current;
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;

                const overlay = overlayRef.current;
                if (overlay) {
                    overlay.width = window.innerWidth;
                    overlay.height = window.innerHeight;
                }

                window.particlesInit(canvas, overlay || undefined);
                particlesInitialized.current = true;
            }
        };

        const checkParticlesInit = setInterval(() => {
            if (typeof window.particlesInit === 'function') {
                clearInterval(checkParticlesInit);
                initParticles();
            }
        }, 100);

        return () => {
            clearInterval(checkParticlesInit);
        };
    }, [router]);

    return (
        <>
            <canvas
                id="particle-canvas"
                ref={canvasRef}
                className="fixed inset-0 w-full h-full z-0"
                style={{ pointerEvents: 'none' }}
            />
            <canvas
                id="particle-overlay"
                ref={overlayRef}
                className="fixed inset-0 w-full h-full z-0"
                style={{ pointerEvents: 'none' }}
            />
            <Script
                src="/js/particles/main.js"
                strategy="afterInteractive"
                type="module"
                onLoad={() => {
                    console.log('Particles script loaded');
                    if (
                        canvasRef.current &&
                        typeof window.particlesInit === 'function' &&
                        !particlesInitialized.current
                    ) {
                        const canvas = canvasRef.current;
                        canvas.width = window.innerWidth;
                        canvas.height = window.innerHeight;

                        const overlay = overlayRef.current;
                        if (overlay) {
                            overlay.width = window.innerWidth;
                            overlay.height = window.innerHeight;
                        }

                        window.particlesInit(canvas, overlay || undefined);
                        particlesInitialized.current = true;
                    }
                }}
            />
        </>
    );
}

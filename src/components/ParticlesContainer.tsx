import { useEffect, useRef } from 'react';

declare global {
    interface Window {
        // startup errors, collected from the first byte (layouts/Layout.astro)
        __bootErrors?: string[];
    }
}

function report(e: unknown) {
    console.error('particles failed to start:', e);
    const stack = (e as Error)?.stack?.split('\n').slice(0, 3).join('\n') ?? '';
    window.__bootErrors?.push(`${e}\n${stack}`.slice(0, 400));
}

// a page cached from before a deploy asks for a bundle the deploy removed;
// one reload gets the current page. the flag stops a loop when the bundle
// fails for any other reason.
function reloadOnce() {
    try {
        if (sessionStorage.getItem('particlesReloaded')) return;
        sessionStorage.setItem('particlesReloaded', '1');
    } catch {
        return;
    }
    window.location.reload();
}

export function ParticlesContainer() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        let cancelled = false;
        // client only, and kept out of the page bundle
        import('../particles/main').then(({ initParticles }) => {
            const canvas = canvasRef.current;
            if (cancelled || !canvas) return;
            const overlay = overlayRef.current;
            for (const c of [canvas, overlay]) {
                if (!c) continue;
                c.width = window.innerWidth;
                c.height = window.innerHeight;
            }
            // a throw here isn't a stale bundle, so no reload
            try {
                initParticles(canvas, overlay);
            } catch (e) {
                report(e);
            }
        }, (e) => {
            report(e);
            reloadOnce();
        });
        // navigation swaps <body>; carry the particle UI over to the new one
        const carryUI = (e: Event) => {
            const { newDocument } = e as Event & { newDocument: Document };
            for (const el of document.querySelectorAll('body > [data-particle-ui]')) newDocument.body.append(el);
        };
        document.addEventListener('astro:before-swap', carryUI);
        return () => {
            cancelled = true;
            document.removeEventListener('astro:before-swap', carryUI);
        };
    }, []);

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
        </>
    );
}

import { useEffect } from 'react';

// true when a one-finger drag on el should keep its default: inside a form
// control (sliders) or an element that can scroll on its own
function inScrollable(el: EventTarget | null): boolean {
    if (el instanceof Element && el.closest('input, select, textarea')) return true;
    for (let n = el instanceof Element ? el : null; n && n !== document.body; n = n.parentElement) {
        const { overflowY } = getComputedStyle(n);
        if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return true;
    }
    return false;
}

export default function Home() {
    // The homepage is one fixed screen: no page scroll, no rubber-banding, no
    // pinch zoom. iOS Safari ignores user-scalable=no, hence the gesture and
    // multi-touch handlers.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.add('home-locked');
        const meta = document.querySelector('meta[name="viewport"]');
        const prevViewport = meta?.getAttribute('content');
        meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
        const block = (e: Event) => e.preventDefault();
        // no pinch anywhere; no one-finger scroll unless inside a scrollable
        // panel (the settings sidebar)
        const blockPinch = (e: TouchEvent) => {
            if (e.touches.length > 1 || !inScrollable(e.target)) e.preventDefault();
        };
        document.addEventListener('gesturestart', block, { passive: false });
        document.addEventListener('gesturechange', block, { passive: false });
        document.addEventListener('touchmove', blockPinch, { passive: false });
        return () => {
            root.classList.remove('home-locked');
            if (meta && prevViewport) meta.setAttribute('content', prevViewport);
            document.removeEventListener('gesturestart', block);
            document.removeEventListener('gesturechange', block);
            document.removeEventListener('touchmove', blockPinch);
        };
    }, []);

    return (
        <main className="h-full relative" />
    );
}
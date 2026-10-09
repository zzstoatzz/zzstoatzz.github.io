import { useState, useEffect } from 'react';
import FirstVisitModal from './FirstVisitModal';

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
    const [showModal, setShowModal] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        // localStorage throws in sandboxed iframes (e.g. leaflet.pub embeds)
        let hasSeenInstructions = 'true';
        try {
            hasSeenInstructions = localStorage.getItem('zenInstructionsSeen') ?? '';
        } catch {
            // sandboxed iframe: treat as already-seen
        }
        if (!hasSeenInstructions) {
            setShowModal(true);
        }
        setIsInitialized(true);
    }, []);

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

    const handleDismiss = () => {
        setShowModal(false);
        try {
            localStorage.setItem('zenInstructionsSeen', 'true');
        } catch {
            // sandboxed iframe: nothing to persist
        }
    };

    if (!isInitialized) {
        return null;
    }

    return (
        <main className="h-full relative">
            {showModal && <FirstVisitModal onDismiss={handleDismiss} />}
        </main>
    );
}
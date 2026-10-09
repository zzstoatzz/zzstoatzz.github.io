'use client';

import React, { useState, useEffect } from 'react';
import FirstVisitModal from './components/FirstVisitModal';

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
        const blockPinch = (e: TouchEvent) => {
            if (e.touches.length > 1) e.preventDefault();
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
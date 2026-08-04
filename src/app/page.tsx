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
        <main className="h-screen relative">
            {showModal && <FirstVisitModal onDismiss={handleDismiss} />}
        </main>
    );
}
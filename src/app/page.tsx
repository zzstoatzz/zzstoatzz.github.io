'use client';

import React, { useState, useEffect } from 'react';
import FirstVisitModal from './components/FirstVisitModal';
import AudioRig from './components/AudioRig';

export default function Home() {
    const [showModal, setShowModal] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const hasSeenInstructions = localStorage.getItem('zenInstructionsSeen');
        if (!hasSeenInstructions) {
            setShowModal(true);
        }
        setIsInitialized(true);
    }, []);

    const handleDismiss = () => {
        setShowModal(false);
        localStorage.setItem('zenInstructionsSeen', 'true');
    };

    if (!isInitialized) {
        return null;
    }

    return (
        <main className="h-screen relative">
            {showModal && <FirstVisitModal onDismiss={handleDismiss} />}
            <AudioRig />
        </main>
    );
}
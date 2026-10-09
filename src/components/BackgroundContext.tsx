import React, { createContext, useContext, useState } from 'react';

export type BackgroundType = 'solid' | 'image';

interface BackgroundState {
    type: BackgroundType;
    color: string;
    imageUrl?: string;
}

interface BackgroundContextType {
    background: BackgroundState;
    setBackground: (background: BackgroundState) => void;
}

export const DEFAULT_IMAGES = [
    'https://images.unsplash.com/photo-1731493710740-136a5ce91c57?q=80&w=1887&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    'https://images.unsplash.com/photo-1730816235622-508731ffe835?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    'https://images.unsplash.com/photo-1731407938169-38633d8a6dd6?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
];

const BackgroundContext = createContext<BackgroundContextType | undefined>(undefined);

export function BackgroundProvider({ children }: { children: React.ReactNode }) {
    const [background, setBackground] = useState<BackgroundState>({
        type: 'solid',
        color: '#070610',
        imageUrl: DEFAULT_IMAGES[0]
    });

    return (
        <BackgroundContext.Provider value={{ background, setBackground }}>
            {children}
        </BackgroundContext.Provider>
    );
}

export function useBackground() {
    const context = useContext(BackgroundContext);
    if (context === undefined) {
        throw new Error('useBackground must be used within a BackgroundProvider');
    }
    return context;
} 
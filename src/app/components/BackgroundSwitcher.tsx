'use client';

import { useBackground } from '../contexts/BackgroundContext';
import { DEFAULT_IMAGES } from '../contexts/BackgroundContext';
import type { BackgroundType } from '../contexts/BackgroundContext';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

export default function BackgroundSwitcher() {
    const { background, setBackground } = useBackground();
    const [isOpen, setIsOpen] = useState(false);
    const [showCustomUrl, setShowCustomUrl] = useState(false);
    const pathname = usePathname();
    
    if (pathname === '/') return null;

    const handleTypeChange = (value: BackgroundType) => {
        setBackground({ ...background, type: value });
        setShowCustomUrl(false);
    };

    return (
        <div className="fixed top-4 left-4 z-50">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="glass-thin text-cyan-300/80 p-1.5
                    hover:text-cyan-300 transition-all scale-90
                    focus:outline-none focus:ring-1 focus:ring-cyan-300/30"
                style={{ borderRadius: '999px' }}
                aria-label="Toggle background settings"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
            </button>

            {isOpen && (
                <div className="glass mt-2 p-4 min-w-[300px]">
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="background-type" className="block text-sm text-cyan-300 mb-1">Background Type</label>
                            <select
                                id="background-type"
                                value={background.type}
                                onChange={(e) => handleTypeChange(e.target.value as BackgroundType)}
                                className="w-full bg-gray-700 text-white rounded p-2"
                            >
                                <option value="solid">Solid Color</option>
                                <option value="image">Image</option>
                            </select>
                        </div>

                        {background.type === 'solid' && (
                            <div>
                                <label htmlFor="background-color" className="block text-sm text-cyan-300 mb-1">Color</label>
                                <input
                                    id="background-color"
                                    type="color"
                                    value={background.color}
                                    onChange={(e) => setBackground({ ...background, color: e.target.value })}
                                    className="w-full h-8 rounded cursor-pointer"
                                />
                            </div>
                        )}

                        {background.type === 'image' && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-2">
                                    {DEFAULT_IMAGES.map((url) => (
                                        <button
                                            type="button"
                                            key={url}
                                            onClick={() => {
                                                setBackground({ ...background, imageUrl: url });
                                                setShowCustomUrl(false);
                                            }}
                                            className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all
                                                ${background.imageUrl === url ? 'border-cyan-400' : 'border-transparent hover:border-cyan-400/50'}`}
                                        >
                                            <Image
                                                src={url}
                                                alt="Background option"
                                                fill
                                                className="object-cover"
                                            />
                                        </button>
                                    ))}
                                </div>
                                
                                <div>
                                    <button
                                        type="button"
                                        onClick={() => setShowCustomUrl(!showCustomUrl)}
                                        className="text-sm text-cyan-300 hover:text-cyan-400 transition-colors"
                                    >
                                        {showCustomUrl ? '- Hide Custom URL' : '+ Add Custom URL'}
                                    </button>
                                    
                                    {showCustomUrl && (
                                        <input
                                            type="text"
                                            value={background.imageUrl || ''}
                                            onChange={(e) => setBackground({ ...background, imageUrl: e.target.value })}
                                            placeholder="Enter image URL"
                                            className="mt-2 w-full bg-gray-700 text-white rounded p-2"
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
} 
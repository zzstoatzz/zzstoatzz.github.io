'use client';

import { useState, useEffect, useRef } from 'react';

// First, let's define a type for the SoundCloud Widget
interface SoundCloudWidget {
    bind: (event: string, callback: () => void) => void;
    getPosition: (callback: (position: number) => void) => void;
    isPaused: (callback: (isPaused: boolean) => void) => void;
}

export default function SoundCloudPlayer() {
    const [isMinimized, setIsMinimized] = useState(true);
    const [shouldShow] = useState(true); // Remove setShouldShow since it's not used
    const [username, setUsername] = useState("geeseband");
    const [showUsernameModal, setShowUsernameModal] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const widgetRef = useRef<SoundCloudWidget | null>(null); // Use our new type instead of any

    // Move the widget setup into a separate effect that depends on shouldShow
    useEffect(() => {
        if (!shouldShow) return; // Don't do anything if component isn't shown

        console.log('Setting up SoundCloud widget');

        const script = document.createElement('script');
        script.src = 'https://w.soundcloud.com/player/api.js';
        script.async = true;
        document.body.appendChild(script);

        const setupWidget = () => {
            console.log('Setting up widget events');
            const iframe = document.querySelector('iframe');
            if (!iframe) {
                console.error('No iframe found');
                return;
            }

            try {
                // Type assertion since we know the shape of SC.Widget
                const widget = (window as { SC?: { Widget: (element: HTMLElement) => SoundCloudWidget } })
                    .SC?.Widget(iframe);

                if (widget) {
                    widgetRef.current = widget;
                    console.log('Widget initialized successfully');

                    // Add periodic state checking
                    const stateCheckInterval = setInterval(() => {
                        widget.getPosition((position: number) => {
                            if (position > 0) {
                                widget.isPaused((isPaused: boolean) => {
                                    setIsPlaying(!isPaused);
                                });
                            }
                        });
                    }, 1000);

                    // Clean up interval on unmount
                    return () => clearInterval(stateCheckInterval);
                }
            } catch (error) {
                console.error('Error setting up widget:', error);
            }
        };

        script.onload = () => {
            console.log('SoundCloud script loaded');
            setTimeout(setupWidget, 1000);
        };

        return () => {
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };
    }, [shouldShow]); // Add shouldShow as a dependency

    const handleUsernameSubmit = (newUsername: string) => {
        setUsername(newUsername);
        localStorage.setItem('soundcloudUsername', newUsername);
        setShowUsernameModal(false);
    };


    if (!shouldShow) return null;

    return (
        <>
            <div
                className={`fixed bottom-4 left-4 transition-all duration-300 ease-in-out z-50 
                    ${shouldShow ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full'}
                    ${isMinimized ? 'h-12 w-12 cursor-pointer' : 'h-[465px] w-[320px]'}`}
                onClick={() => isMinimized ? setIsMinimized(false) : null}
                onKeyDown={(e) => { if (isMinimized && (e.key === 'Enter' || e.key === ' ')) setIsMinimized(false); }}
                role="button"
                aria-expanded={!isMinimized}
                tabIndex={isMinimized ? 0 : -1}
            >
                <div className={`bg-black bg-opacity-80 backdrop-blur-lg rounded-lg shadow-lg overflow-hidden h-full
                    ${isPlaying ? 'animate-glow bg-blue-500/5' : 'transition-[box-shadow,background-color] duration-75'}`}>
                    <div
                        className="h-12 px-4 flex items-center justify-between bg-black bg-opacity-40 cursor-pointer relative z-10"
                    >
                        <div className="w-full h-full flex items-center justify-between text-xl transition-colors group">
                            {isMinimized ? (
                                <span className="text-cyan-300 group-hover:text-cyan-400">♪</span>
                            ) : (
                                <>
                                    <span className="text-cyan-300">♪</span>

                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsMinimized(true);
                                        }}
                                        className="text-cyan-300 hover:text-cyan-100 p-1 rounded"
                                        aria-label="Minimize Player"
                                    >
                                        <svg 
                                            xmlns="http://www.w3.org/2000/svg" 
                                            fill="none" 
                                            viewBox="0 0 24 24" 
                                            strokeWidth={1.5} 
                                            stroke="currentColor" 
                                            className="w-5 h-5"
                                            aria-hidden="true"
                                        >
                                          <title>Minimize Player</title>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                        </svg>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowUsernameModal(true);
                                        }}
                                        className="text-xs text-gray-400 hover:text-gray-200 relative z-[60] transition-colors"
                                        style={{ width: 'fit-content' }}
                                    >
                                        change user
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className={`w-full transition-all duration-200 ${isMinimized ? 'opacity-0 h-0' : 'opacity-100 h-[calc(100%-3rem)]'}`}>
                        <div className="relative z-20 h-full">
                            <iframe
                                title={`${username}'s SoundCloud Player`}
                                width="100%"
                                height="100%"
                                scrolling="no"
                                frameBorder="no"
                                allow="autoplay"
                                src={`https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/${username}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {showUsernameModal && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                    onClick={() => setShowUsernameModal(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setShowUsernameModal(false); }}
                    role="dialog"
                    aria-modal="true"
                    tabIndex={-1}
                    aria-labelledby="modal-title"
                >
                    <div
                        className="bg-black bg-opacity-80 p-6 rounded-lg shadow-lg max-w-sm w-full mx-4"
                        onClick={e => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setShowUsernameModal(false); } }}
                        role="document"
                    >
                        <h2 id="modal-title" className="sr-only">Change SoundCloud User</h2>
                        <input
                            type="text"
                            defaultValue={username}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleUsernameSubmit(e.currentTarget.value);
                                }
                                if (e.key === 'Escape') {
                                    setShowUsernameModal(false);
                                }
                            }}
                            className="w-full bg-transparent border-b border-cyan-300/30 text-cyan-300 text-sm px-2 py-1 focus:outline-none focus:border-cyan-300"
                            placeholder="Enter SoundCloud username"
                        />
                        <div className="text-xs text-gray-500 mt-2 text-center opacity-50">
                            type a soundcloud username and hit Enter   (e.g. geeseband)
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

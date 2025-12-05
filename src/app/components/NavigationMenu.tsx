'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface StatusData {
    text?: string;
    emoji?: string;
}

interface PlayRecord {
    trackName: string;
    artists: { artistName: string }[];
    originUrl: string;
    playedTime: string;
    thumbnailUrl?: string;
}

interface NavItem {
    href: string;
    label: string;
    description?: string;
}

const navItems: NavItem[] = [
    { href: '/', label: 'home', description: 'back to the main page' },
    { href: '/about', label: 'about', description: 'learn more about me' },
    { href: '/contact', label: 'contact', description: 'get in touch' },
    { href: '/tuner', label: 'tuner', description: 'guitar tuner tool' },
];

export default function NavigationMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mounted, setMounted] = useState(false);
    const [statusData, setStatusData] = useState<StatusData | null>(null);
    const [lastPlay, setLastPlay] = useState<PlayRecord | null>(null);
    const router = useRouter();
    const pathname = usePathname();

    const handleToggle = useCallback(() => {
        setIsOpen(prev => !prev);
        setSelectedIndex(0);
    }, []);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        setSelectedIndex(0);
    }, []);

    const handleNavigate = useCallback((href: string) => {
        handleClose();
        router.push(href);
    }, [router, handleClose]);

    // Client-side mounting
    useEffect(() => {
        setMounted(true);
    }, []);

    // Status fetching
    useEffect(() => {
        if (!mounted) return;

        let cancelled = false;
        const controller = new AbortController();

        async function fetchStatus() {
            try {
                const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent('https://status.zzstoatzz.io/json')}`, {
                    signal: controller.signal,
                    cache: 'no-store',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const proxyData = await res.json();
                const data = JSON.parse(proxyData.contents) as StatusData;
                if (!cancelled && data) {
                    const statusInfo = {
                        text: (data.text || '').trim(),
                        emoji: (data.emoji || '').trim()
                    };
                    setStatusData(statusInfo);
                }
            } catch (error) {
                if (!cancelled) {
                    setStatusData(null);
                }
            }
        }

        fetchStatus();
        const id = setInterval(fetchStatus, 60_000);
        return () => {
            cancelled = true;
            controller.abort();
            clearInterval(id);
        };
    }, [mounted]);

    // Last played track fetching from ATProto
    useEffect(() => {
        if (!mounted) return;

        let cancelled = false;
        const controller = new AbortController();

        async function fetchLastPlay() {
            try {
                const res = await fetch(
                    'https://pds.zzstoatzz.io/xrpc/com.atproto.repo.listRecords?repo=did:plc:xbtmt2zjwlrfegqvch7fboei&collection=fm.teal.alpha.feed.play&limit=1',
                    { signal: controller.signal, cache: 'no-store' }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled && data.records?.[0]?.value) {
                    const play = data.records[0].value as PlayRecord;

                    setLastPlay(play);
                }
            } catch {
                if (!cancelled) setLastPlay(null);
            }
        }

        fetchLastPlay();
        const id = setInterval(fetchLastPlay, 60_000);
        return () => {
            cancelled = true;
            controller.abort();
            clearInterval(id);
        };
    }, [mounted]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd+K or Ctrl+K to toggle
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                handleToggle();
                return;
            }

            if (!isOpen) return;

            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    handleClose();
                    break;
                
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(prev => (prev + 1) % navItems.length);
                    break;
                
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(prev => prev === 0 ? navItems.length - 1 : prev - 1);
                    break;
                
                case 'Tab':
                    e.preventDefault();
                    if (e.shiftKey) {
                        setSelectedIndex(prev => prev === 0 ? navItems.length - 1 : prev - 1);
                    } else {
                        setSelectedIndex(prev => (prev + 1) % navItems.length);
                    }
                    break;
                
                case 'Enter':
                    e.preventDefault();
                    handleNavigate(navItems[selectedIndex].href);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, selectedIndex, handleToggle, handleClose, handleNavigate]);

    if (!mounted) return null;

    return (
        <>
            {/* Nav trigger button */}
            <button
                onClick={handleToggle}
                className="fixed top-2 left-1/2 transform -translate-x-1/2 z-[100] bg-gray-800 bg-opacity-60 text-cyan-300/70 p-2 rounded-lg 
                       hover:bg-opacity-80 hover:text-cyan-300 transition-all
                       focus:outline-none focus:ring-1 focus:ring-cyan-300/30 text-xs"
                aria-label="Toggle Navigation"
                type="button"
            >
                nav
            </button>

            {/* Navigation overlay */}
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-start justify-center pt-20">
                    {/* Backdrop */}
                    <div 
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={handleClose}
                    />
                    
                    {/* Navigation panel */}
                    <div className="relative w-full max-w-lg mx-4 bg-gray-900/95 border border-cyan-900/30 rounded-lg shadow-2xl backdrop-blur-md">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/20">
                            <h2 className="text-cyan-300 text-sm font-light">navigation</h2>
                            <div className="flex items-center gap-2">
                                <div className="hidden sm:flex items-center gap-1 text-xs text-gray-500">
                                    <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs">⌘K</kbd>
                                </div>
                                <button
                                    onClick={handleClose}
                                    className="text-gray-400 hover:text-white text-xl"
                                    aria-label="Close Navigation"
                                    type="button"
                                >
                                    &times;
                                </button>
                            </div>
                        </div>

                        {/* Navigation items */}
                        <div className="py-2">
                            {navItems.map((item, index) => (
                                <button
                                    key={item.href}
                                    className={`w-full px-4 py-3 text-left transition-colors ${
                                        index === selectedIndex
                                            ? 'bg-cyan-900/30 text-cyan-300'
                                            : pathname === item.href
                                            ? 'bg-cyan-900/20 text-cyan-400 opacity-60'
                                            : 'text-gray-300 hover:bg-gray-800/50'
                                    }`}
                                    onClick={() => handleNavigate(item.href)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                {item.label}
                                                {pathname === item.href && <span className="text-xs">*</span>}
                                            </div>
                                            {item.description && (
                                                <div className="text-sm text-gray-400 mt-0.5 hidden sm:block">
                                                    {item.description}
                                                </div>
                                            )}
                                        </div>
                                        <div className="hidden sm:block text-xs text-gray-500">
                                            {index === selectedIndex && '↵'}
                                        </div>
                                    </div>
                                </button>
                            ))}
                            
                            {/* Status & last played section */}
                            {(statusData || lastPlay) && (
                                <div className="px-4 py-3 border-t border-cyan-900/30 mt-2 space-y-3">
                                    {statusData && (
                                        <a
                                            href="https://status.zzstoatzz.io/@zzstoatzz.io"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
                                            aria-label="Current status"
                                        >
                                            <span className="text-gray-500">status:</span>
                                            {statusData.emoji && !statusData.emoji.startsWith('custom:') && (
                                                <span aria-hidden>{statusData.emoji}</span>
                                            )}
                                            {statusData.text ? (
                                                <span>{statusData.text}</span>
                                            ) : statusData.emoji?.startsWith('custom:') ? (
                                                <span>{statusData.emoji.replace('custom:', '')}</span>
                                            ) : statusData.emoji ? (
                                                <span>vibing</span>
                                            ) : (
                                                <span>status unknown</span>
                                            )}
                                        </a>
                                    )}
                                    {lastPlay && lastPlay.originUrl?.includes('plyr.fm') && (
                                        <div className="mt-2">
                                            <span className="text-gray-500 text-sm block mb-1">last listened:</span>
                                            <iframe
                                                src={lastPlay.originUrl.replace('/track/', '/embed/track/')}
                                                width="100%"
                                                height="80"
                                                frameBorder="0"
                                                allow="autoplay"
                                                style={{ borderRadius: '6px' }}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer with keyboard shortcuts - only on desktop */}
                        <div className="hidden sm:block px-4 py-2 border-t border-cyan-900/20 bg-gray-900/50">
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span className="flex items-center gap-1">
                                    <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded">↑↓</kbd>
                                    navigate
                                </span>
                                <span className="flex items-center gap-1">
                                    <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded">↵</kbd>
                                    select
                                </span>
                                <span className="flex items-center gap-1">
                                    <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded">esc</kbd>
                                    close
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
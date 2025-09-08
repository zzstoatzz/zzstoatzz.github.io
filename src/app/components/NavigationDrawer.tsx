'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavigationDrawer() {
    const [isOpen, setIsOpen] = useState(false);
    const pathname = usePathname();
    const [statusText, setStatusText] = useState<string | null>(null);
    const [statusEmoji, setStatusEmoji] = useState<string | null>(null);

    const toggleDrawer = () => {
        setIsOpen(!isOpen);
    };

    const closeDrawer = () => {
        setIsOpen(false);
    };

    // Fetch live status for nav item (with CORS-safe fallback)
    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();

        async function fetchStatus() {
            try {
                // Try direct endpoint first
                const res = await fetch('https://status.zzstoatzz.io/json', {
                    signal: controller.signal,
                    mode: 'cors',
                    cache: 'no-store',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as { text?: string; emoji?: string };
                if (!cancelled) {
                    setStatusText((data.text || '').trim() || null);
                    setStatusEmoji((data.emoji || '').trim() || null);
                }
            } catch (_err) {
                try {
                    // Fallback via r.jina.ai proxy (returns text containing JSON)
                    const proxy = await fetch('https://r.jina.ai/http://status.zzstoatzz.io/json', {
                        signal: controller.signal,
                        mode: 'cors',
                        cache: 'no-store',
                    });
                    if (!proxy.ok) throw new Error(`fallback HTTP ${proxy.status}`);
                    const body = await proxy.text();
                    const start = body.indexOf('{');
                    const end = body.lastIndexOf('}');
                    if (start !== -1 && end > start) {
                        const parsed = JSON.parse(body.slice(start, end + 1));
                        if (!cancelled) {
                            const text = (parsed.text || '').trim();
                            const emoji = (parsed.emoji || '').trim();
                            setStatusText(text || null);
                            setStatusEmoji(emoji || null);
                        }
                    }
                } catch {
                    // Leave null on failure
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
    }, []);

    return (
        <>
            <button
                onClick={toggleDrawer}
                className="fixed top-2 left-1/2 transform -translate-x-1/2 z-[100] bg-gray-800 bg-opacity-60 text-cyan-300/70 p-2 rounded-lg 
                       hover:bg-opacity-80 hover:text-cyan-300 transition-all
                       focus:outline-none focus:ring-1 focus:ring-cyan-300/30 text-xs"
                aria-label="Toggle Navigation"
                type="button"
            >
                nav
            </button>

            {/* Backdrop - always present but with opacity transition */}
            <div
                className={`fixed inset-0 bg-black z-[90] transition-opacity duration-300 ease-in-out ${
                    isOpen ? 'bg-opacity-50 pointer-events-auto' : 'bg-opacity-0 pointer-events-none'
                }`}
                onClick={closeDrawer}
                onKeyDown={(e) => e.key === 'Escape' && closeDrawer()}
                role="button"
                tabIndex={0}
            />

            {/* Drawer Panel - always present but with transform transition */}
            <div
                className={`fixed top-0 left-1/2 -translate-x-1/2 w-64 bg-gray-900 bg-opacity-90 backdrop-blur-md shadow-lg z-[100] rounded-b-lg overflow-hidden transition-all duration-300 ease-in-out ${
                    isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'
                }`}
            >
                <div className="p-4 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-cyan-300 text-sm font-light">nav</h2>
                        <button
                            onClick={closeDrawer}
                            className="text-gray-400 hover:text-white text-xl"
                            aria-label="Close Navigation"
                            type="button"
                        >
                            &times;
                        </button>
                    </div>
                    <div>
                        <nav className="w-full">
                            <ul className="flex flex-col space-y-2">
                                {[
                                    { href: '/', label: 'home' },
                                    { href: '/about', label: 'about' },
                                    { href: '/contact', label: 'contact' },
                                    { href: '/tuner', label: 'tuner' },
                                ].map(({ href, label }) => (
                                    <li key={href} className={pathname === href ? "opacity-50" : ""}>
                                        <Link
                                            href={href}
                                            className="nav-link block text-base font-light hover:text-cyan-300 transition-colors"
                                            onClick={closeDrawer}
                                        >
                                            {label} {pathname === href && '*'}
                                        </Link>
                                    </li>
                                ))}
                                {statusText && (
                                    <li className="pt-2 mt-1 border-t border-cyan-900/30">
                                        <a
                                            href="https://status.zzstoatzz.io"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block text-sm font-light text-cyan-300 hover:text-cyan-200 transition-colors"
                                            aria-label="Current status"
                                        >
                                            <span className="mr-1 text-cyan-400/80">status:</span>
                                            {/* Hide custom emojis; show only standard emoji */}
                                            {statusEmoji && !statusEmoji.startsWith('custom:') && (
                                                <span aria-hidden className="mr-1">{statusEmoji}</span>
                                            )}
                                            <span>{statusText}</span>
                                        </a>
                                    </li>
                                )}
                            </ul>
                        </nav>
                    </div>
                </div>
            </div>
        </>
    );
}

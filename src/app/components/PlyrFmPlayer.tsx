'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SearchResult {
    id: string | number;
    type: 'playlist' | 'track' | 'artist' | 'album' | 'tag';
    // playlists
    name?: string;
    owner_handle?: string;
    owner_display_name?: string;
    track_count?: number;
    // tracks
    title?: string;
    artist_handle?: string;
    artist_display_name?: string;
    // shared
    image_url?: string;
}

function displayName(r: SearchResult): string {
    return r.name ?? r.title ?? String(r.id);
}

function displayOwner(r: SearchResult): string | undefined {
    return r.owner_display_name ?? r.artist_display_name;
}

const DEFAULT_EMBED_URL = 'https://plyr.fm/embed/playlist/71f84b8c-4cd4-41ff-a037-7df3d94164aa';
const STORAGE_KEY = 'plyrfm_embed_url';

function embedUrlFor(result: SearchResult): string {
    if (result.type === 'track') return `https://plyr.fm/embed/track/${result.id}`;
    return `https://plyr.fm/embed/playlist/${result.id}`;
}

export default function PlyrFmPlayer() {
    const [isMinimized, setIsMinimized] = useState(true);
    const [embedUrl, setEmbedUrl] = useState(DEFAULT_EMBED_URL);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [showResults, setShowResults] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) setEmbedUrl(saved);
    }, []);

    const search = useCallback(async (q: string) => {
        if (!q.trim()) {
            setResults([]);
            setShowResults(false);
            return;
        }
        try {
            const res = await fetch(`https://api.plyr.fm/search/?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            const filtered = (data.results ?? data ?? []).filter(
                (r: { type: string }) => r.type === 'playlist' || r.type === 'track'
            ) as SearchResult[];
            filtered.sort((a, b) => (a.type === b.type ? 0 : a.type === 'playlist' ? -1 : 1));
            setResults(filtered);
            setShowResults(filtered.length > 0);
        } catch {
            setResults([]);
            setShowResults(false);
        }
    }, []);

    const handleInput = (value: string) => {
        setQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => search(value), 300);
    };

    const selectResult = (result: SearchResult) => {
        const url = embedUrlFor(result);
        setEmbedUrl(url);
        localStorage.setItem(STORAGE_KEY, url);
        setQuery('');
        setResults([]);
        setShowResults(false);
    };

    // close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent | TouchEvent) => {
            if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
                setShowResults(false);
            }
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, []);

    const hasResults = showResults && results.length > 0;

    return (
        <div
            className={`fixed bottom-4 left-4 transition-all duration-300 ease-in-out z-50 ${
                isMinimized
                    ? 'h-12 w-12 cursor-pointer'
                    : hasResults
                        ? 'h-[480px] w-[min(calc(100vw-2rem),720px)]'
                        : 'h-[480px] w-[min(calc(100vw-2rem),400px)]'
            }`}
            onClick={() => isMinimized && setIsMinimized(false)}
            onKeyDown={(e) => { if (isMinimized && (e.key === 'Enter' || e.key === ' ')) setIsMinimized(false); }}
            role="button"
            aria-expanded={!isMinimized}
            tabIndex={isMinimized ? 0 : -1}
        >
            <div className="glass-strong overflow-hidden h-full flex flex-col">
                {/* header — full strip is the minimize affordance when expanded */}
                <div
                    className="h-12 px-4 flex items-center justify-between cursor-pointer shrink-0 hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                        if (!isMinimized) {
                            e.stopPropagation();
                            setIsMinimized(true);
                        }
                    }}
                    role={isMinimized ? undefined : 'button'}
                    aria-label={isMinimized ? undefined : 'minimize player'}
                >
                    <div className="w-full h-full flex items-center justify-between text-xl transition-colors group pointer-events-none">
                        {isMinimized ? (
                            <span className="text-cyan-300 group-hover:text-cyan-400">♪</span>
                        ) : (
                            <>
                                <span className="text-cyan-300">♪</span>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-cyan-300" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                </svg>
                            </>
                        )}
                    </div>
                </div>

                {/* expanded content */}
                <div
                    className={`flex-1 flex flex-col min-h-0 transition-all duration-200 ${isMinimized ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100'}`}
                    ref={resultsRef}
                >
                    {/* search input — full width across both columns */}
                    <div className="shrink-0 border-b border-white/5">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => handleInput(e.target.value)}
                            onFocus={() => results.length > 0 && setShowResults(true)}
                            className="w-full bg-transparent text-cyan-300 text-sm px-4 py-2.5 focus:outline-none placeholder:text-gray-500"
                            placeholder="search on plyr.fm"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>

                    {/* results + iframe row.
                        - no results: iframe fills the area.
                        - results, desktop: results column on the left, iframe on the right.
                        - results, mobile: results take over (iframe hidden) since side-by-side
                          can't fit comfortably below 768px. */}
                    <div className="flex-1 min-h-0 flex">
                        {hasResults && (
                            <div className="w-full md:w-[280px] overflow-y-auto md:border-r border-white/5 shrink-0">
                                {results.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); selectResult(r); }}
                                        className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors flex items-center gap-3 border-b border-white/5 last:border-b-0"
                                    >
                                        {r.image_url && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={r.image_url} alt="" className="w-11 h-11 rounded object-cover shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                            <div className="text-cyan-300 text-sm truncate">{displayName(r)}</div>
                                            <div className="text-gray-500 text-xs truncate">
                                                {r.type}{displayOwner(r) ? ` · ${displayOwner(r)}` : ''}{r.track_count ? ` · ${r.track_count} tracks` : ''}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className={`flex-1 min-h-0 ${hasResults ? 'hidden md:block' : 'block'}`}>
                            <iframe
                                title="plyr.fm player"
                                src={embedUrl}
                                width="100%"
                                height="100%"
                                allow="autoplay"
                                className="block"
                                style={{ border: 'none' }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

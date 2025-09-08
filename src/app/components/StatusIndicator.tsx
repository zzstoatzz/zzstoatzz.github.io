'use client';

import React, { useEffect, useState } from 'react';

type StatusPayload = {
    emoji?: string;
    text?: string;
    status?: string;
    since?: string;
    expires?: string | null;
    handle?: string;
};

export default function StatusIndicator() {
    const [status, setStatus] = useState<StatusPayload | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();

        async function load() {
            try {
                setError(null);
                // Try direct first
                const res = await fetch('https://status.zzstoatzz.io/json', {
                    signal: controller.signal,
                    // Normal CORS mode; if the remote doesn't send ACAO, this will fail
                    // and we will gracefully fall back to showing just a link.
                    mode: 'cors',
                    cache: 'no-store',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: StatusPayload = await res.json();
                if (!cancelled) setStatus(data);
            } catch (e: unknown) {
                // Fallback: CORS-safe proxy via r.jina.ai (returns text with JSON embedded)
                try {
                    const fallback = await fetch('https://r.jina.ai/http://status.zzstoatzz.io/json', {
                        signal: controller.signal,
                        mode: 'cors',
                        cache: 'no-store',
                    });
                    if (!fallback.ok) throw new Error(`fallback HTTP ${fallback.status}`);
                    const text = await fallback.text();
                    // Extract first JSON object from the response body
                    const start = text.indexOf('{');
                    const end = text.lastIndexOf('}');
                    if (start !== -1 && end !== -1 && end > start) {
                        const jsonStr = text.slice(start, end + 1);
                        const parsed: StatusPayload = JSON.parse(jsonStr);
                        if (!cancelled) setStatus(parsed);
                    } else {
                        throw new Error('no JSON found in fallback response');
                    }
                } catch (fallbackErr) {
                    const message = fallbackErr instanceof Error ? fallbackErr.message : 'failed';
                    if (!cancelled) setError(message);
                }
            }
        }

        load();

        // Light polling to keep fresh without being noisy
        const id = setInterval(load, 60_000);
        return () => {
            cancelled = true;
            controller.abort();
            clearInterval(id);
        };
    }, []);

    const text = (status?.text ?? '').trim();
    const emoji = (status?.emoji ?? '').trim();
    const hasLive = text.length > 0;

    return (
        <div className="fixed bottom-4 right-4 z-[98]">
            <a
                href="https://status.zzstoatzz.io"
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 rounded-full border px-3 py-1 shadow transition-colors backdrop-blur 
                    ${hasLive
                        ? 'border-cyan-900/50 bg-gray-900/80 text-cyan-200 hover:text-cyan-100 hover:border-cyan-700'
                        : 'border-cyan-900/30 bg-gray-900/60 text-cyan-300/60 hover:text-cyan-300 hover:border-cyan-700/50'
                    }`}
                aria-label="View status"
            >
                <span className="text-sm leading-none whitespace-nowrap">
                    {emoji && <span aria-hidden className="mr-1">{emoji}</span>}
                    {hasLive ? text : 'loading…'}
                </span>
            </a>
            {error && (
                <div className="mt-1 text-[10px] text-cyan-300/50">
                    degraded via proxy
                </div>
            )}
        </div>
    );
}

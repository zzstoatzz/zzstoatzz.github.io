'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';

const PDS = 'https://pds.zzstoatzz.io';
const DID = 'did:plc:xbtmt2zjwlrfegqvch7fboei';

interface Status {
    text?: string;
    emoji?: string;
}

interface LastPlay {
    trackName: string;
    artists?: { artistName: string }[];
    originUrl?: string;
}

function listRecords(collection: string, signal: AbortSignal) {
    return fetch(
        `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${DID}&collection=${collection}&limit=1`,
        { signal, cache: 'no-store' }
    ).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
}

// find-bufo resolves a custom-emoji name to its real asset; one url, no client-side walk.
const bufoUrl = (name: string) => `https://find-bufo.com/e/${name}.png`;

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
);

export default function About() {
    const [status, setStatus] = useState<Status | null>(null);
    const [lastPlay, setLastPlay] = useState<LastPlay | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;

        listRecords('io.zzstoatzz.status.record', controller.signal)
            .then((data) => {
                const record = data.records?.[0]?.value;
                if (!cancelled && record) {
                    setStatus({
                        text: (record.text || '').trim(),
                        emoji: (record.emoji || '').trim(),
                    });
                }
            })
            .catch(() => {});

        listRecords('fm.teal.alpha.feed.play', controller.signal)
            .then((data) => {
                const record = data.records?.[0]?.value as LastPlay | undefined;
                if (!cancelled && record?.trackName) setLastPlay(record);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, []);

    const statusLabel = status
        ? status.text ||
          (status.emoji?.startsWith('custom:')
              ? status.emoji.replace('custom:', '').replace(/-/g, ' ')
              : status.emoji
                ? 'vibing'
                : 'around')
        : null;

    const emojiName = status?.emoji?.startsWith('custom:')
        ? status.emoji.slice(7)
        : null;

    return (
        <main className="about">
            <header className="about-head">
                <h1 className="about-name">nate</h1>
                <p className="about-tagline">
                    software engineer · ChE from Michigan · grew up in the U.P. · now in Logan Square, Chicago
                </p>
            </header>

            <div className="about-prose">
                <p>
                    Hello! My name is Nate - software engineer and ChE grad from the University of Michigan. I grew up in the Upper Peninsula of Michigan and currently live in Logan Square, Chicago.
                </p>
                <p>
                    I am a physicist at heart and love graph theory. I also love listening to and playing music.
                </p>
                <p>
                    Feel free to <a href="#find-me">get in touch</a> if you have an idea for a project or just want to chat!
                </p>
            </div>

            <section className="about-now glass-thin" aria-label="what i'm up to right now">
                <div className="about-now-row">
                    <span className="about-now-label about-now-label--live">now</span>
                    {statusLabel ? (
                        <a
                            href="https://status.zzstoatzz.io/@zzstoatzz.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="about-now-value"
                        >
                            {emojiName ? (
                                <img src={bufoUrl(emojiName)} alt="" className="about-now-emoji" />
                            ) : status?.emoji ? (
                                <span aria-hidden>{status.emoji}</span>
                            ) : null}
                            <span>{statusLabel}</span>
                        </a>
                    ) : (
                        <span className="about-now-value about-now-value--muted">somewhere offline</span>
                    )}
                </div>
                <div className="about-now-row">
                    <span className="about-now-label">last heard</span>
                    {lastPlay ? (
                        <a
                            href={lastPlay.originUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="about-now-value"
                        >
                            <span>{lastPlay.trackName}</span>
                            {lastPlay.artists?.[0]?.artistName && (
                                <span className="about-now-artist">
                                    — {lastPlay.artists[0].artistName}
                                </span>
                            )}
                        </a>
                    ) : (
                        <span className="about-now-value about-now-value--muted">quiet for now</span>
                    )}
                </div>
            </section>

            <p className="about-work">
                find my things on{' '}
                <a href="https://github.com/zzstoatzz" target="_blank" rel="noopener noreferrer">
                    github
                </a>{' '}
                and{' '}
                <a href="https://tangled.org/@zzstoatzz.io" target="_blank" rel="noopener noreferrer">
                    tangled
                </a>
                .
            </p>

            <footer className="about-find" id="find-me">
                <span className="about-find-label">find me</span>
                <ul className="about-find-list">
                    <li>
                        <a
                            href="https://bsky.app/profile/zzstoatzz.io"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className="about-find-icon" aria-hidden>🦋</span>
                            <span>@zzstoatzz.io</span>
                        </a>
                    </li>
                    <li>
                        <a href="mailto:zzstoatzz@protonmail.com">
                            <Mail className="about-find-icon" aria-hidden size={16} />
                            <span>email</span>
                        </a>
                    </li>
                    <li>
                        <a
                            href="https://tangled.org/@zzstoatzz.io"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className="about-find-icon about-find-icon--dot" aria-hidden />
                            <span>tangled</span>
                        </a>
                    </li>
                    <li>
                        <a
                            href="https://github.com/zzstoatzz"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <GithubIcon className="about-find-icon" width={16} height={16} />
                            <span>github</span>
                        </a>
                    </li>
                </ul>
            </footer>
        </main>
    );
}

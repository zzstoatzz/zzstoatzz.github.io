'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { GithubIcon, BlueskyIcon, TANGLED_DOLLY } from '@/app/components/icons';

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
                    Feel free to get in touch if you have an idea for a project or just want to chat!
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

            <footer className="about-find" id="find-me">
                <span className="about-find-label">find me</span>
                <ul className="about-find-list">
                    <li>
                        <a
                            href="https://bsky.app/profile/zzstoatzz.io"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <BlueskyIcon className="about-find-icon" width={16} height={16} />
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
                            <img src={TANGLED_DOLLY} alt="" className="about-find-icon" width={16} height={16} />
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

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// contact folded into /about — redirect for continuity (static export, so client-side).
export default function ContactRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/about');
    }, [router]);

    return (
        <main className="about" aria-busy="true">
            <p className="about-now-value about-now-value--muted">
                contact moved to <a href="/about">/about</a> — taking you there…
            </p>
        </main>
    );
}

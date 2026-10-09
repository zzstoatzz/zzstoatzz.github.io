import { useEffect } from 'react';

// registers public/sw.js so the installed app works offline
export default function ServiceWorker() {
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                // not fatal: the site works the same without it
            });
        }
    }, []);
    return null;
}

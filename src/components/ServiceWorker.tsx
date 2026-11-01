import { useEffect } from 'react';

// registers public/sw.js so the installed app works offline
export default function ServiceWorker() {
    useEffect(() => {
        async function register() {
            try {
                if ('serviceWorker' in navigator) {
                    await navigator.serviceWorker.register('/sw.js');
                }
            } catch {
                // Sandboxed embeds can throw when reading serviceWorker itself.
            }
        }
        void register();
    }, []);
    return null;
}

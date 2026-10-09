import { BackgroundProvider } from './BackgroundContext';
import Background from './Background';
import BackgroundSwitcher from './BackgroundSwitcher';
import NavigationMenu from './NavigationMenu';
import PlyrFmPlayer from './PlyrFmPlayer';
import ServiceWorker from './ServiceWorker';
import { PathnameContext } from './pathname';

// Everything that outlives a page: background and particles, the nav, the
// background switcher and the player. Layout.astro renders it once with
// transition:persist, so music and particles keep going across navigations;
// each navigation re-renders it with the new page's path.
export default function Shell({ path }: { path: string }) {
    return (
        <PathnameContext.Provider value={path}>
            <BackgroundProvider>
                <Background />
                <BackgroundSwitcher />
                <NavigationMenu />
                <PlyrFmPlayer />
                <ServiceWorker />
            </BackgroundProvider>
        </PathnameContext.Provider>
    );
}

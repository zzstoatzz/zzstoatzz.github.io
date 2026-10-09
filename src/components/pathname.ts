// The current page's path, for the islands inside Shell. Shell persists
// across navigations and gets each new page's path as a prop.
import { createContext, useContext } from 'react';

export const PathnameContext = createContext('/');

export function usePathname(): string {
    return useContext(PathnameContext);
}

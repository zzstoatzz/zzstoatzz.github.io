'use client'

import { usePathname } from 'next/navigation';
import Footer from './Footer';

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isHomepage = pathname === '/';

    if (isHomepage) {
        return <>{children}</>;
    }
    
    return (
        <>
            {/* Full page translucent backdrop */}
            <div className="fixed inset-0 bg-[rgba(175,181,240,0.01)] backdrop-blur-[3px] z-[5] rounded-lg" />
            
            {/* Content and footer */}
            <div className="relative min-h-screen flex flex-col z-10">
                <main className="flex-grow container mx-auto px-4 py-8">
                    {children}
                </main>
                <Footer />
            </div>
        </>
    );
}
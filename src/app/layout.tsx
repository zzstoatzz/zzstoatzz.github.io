import { Fira_Code } from 'next/font/google';
import '../styles/globals.css';
import ConditionalLayout from './components/ConditionalLayout';
import type { Metadata } from 'next';
import Script from 'next/script';
import 'highlight.js/styles/atom-one-dark.css';
import SoundCloudPlayer from './components/SoundCloudPlayer';
import { BackgroundProvider } from './contexts/BackgroundContext';
import BackgroundSwitcher from './components/BackgroundSwitcher';
import Background from './components/Background';
import NavigationDrawer from './components/NavigationDrawer';

const firaCode = Fira_Code({
    subsets: ['latin'],
    weight: ['300', '400', '500'],
    variable: '--font-fira-code',
});

export const metadata: Metadata = {
    title: 'n8',
    icons: {
        icon: '/assets/images/stoat.png',
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={`${firaCode.variable} font-sans`}>
            <head>
                <Script
                    src="https://www.googletagmanager.com/gtag/js?id=G-SLML4CSJ70"
                    strategy="afterInteractive"
                />
                <Script id="google-analytics" strategy="afterInteractive">
                    {`
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        gtag('config', 'G-SLML4CSJ70');
                    `}
                </Script>
            </head>
            <body className="bg-[#0B0B03]">
                <BackgroundProvider>
                    <Background />
                    <div className="relative z-20 min-h-screen flex flex-col overflow-x-hidden">
                        <BackgroundSwitcher />
                        <NavigationDrawer />
                        <ConditionalLayout>
                            {children}
                        </ConditionalLayout>
                    </div>
                    <SoundCloudPlayer />
                </BackgroundProvider>
            </body>
        </html>
    );
}

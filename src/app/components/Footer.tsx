import { Mail } from 'lucide-react';
import { GithubIcon, BlueskyIcon, TANGLED_DOLLY } from './icons';

export default function Footer() {
    const socialLinks: { href: string; label: string; icon: React.ReactNode }[] = [
        { href: 'mailto:zzstoatzz@protonmail.com', label: 'Email', icon: <Mail size={24} aria-hidden /> },
        { href: 'https://github.com/zzstoatzz', label: 'GitHub', icon: <GithubIcon width={24} height={24} /> },
        { href: 'https://bsky.app/profile/zzstoatzz.io', label: 'Bluesky', icon: <BlueskyIcon width={24} height={24} /> },
        { href: 'https://tangled.org/@zzstoatzz.io', label: 'Tangled', icon: <img src={TANGLED_DOLLY} alt="" width={24} height={24} className="opacity-80" /> },
    ];

    return (
        <footer className="py-6 mt-auto relative z-50">
            <div className="container mx-auto flex flex-col items-center px-4">
                <div className="flex space-x-6 mb-4">
                    {socialLinks.map((link) => (
                        <a
                            key={link.label}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={link.label}
                            className="text-gray-400 hover:text-cyan-400 transition-colors duration-300 flex items-center justify-center"
                        >
                            {link.icon}
                        </a>
                    ))}
                </div>
                <p className="text-xs text-gray-500 mb-2">&copy; {new Date().getFullYear()} zzstoatzz</p>

                <a
                    href="https://github.com/zzstoatzz/zzstoatzz.github.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-cyan-400 transition-colors duration-300"
                >
                    This site is open source
                </a>
            </div>
        </footer>
    );
}

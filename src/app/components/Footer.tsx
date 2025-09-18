import { Mail } from 'lucide-react';

// Simple SVG for Github from Simple Icons
const GithubIconSimple: React.FC<React.SVGProps<SVGSVGElement>> = ({ 
    width = 24, 
    height = 24,
    className = '', 
    ...rest 
}) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 24 24"
        fill="currentColor"
        width={width}
        height={height}
        className={className}
        aria-labelledby="githubTitleSimple"
        role="img"
        {...rest} 
    >
        <title id="githubTitleSimple">GitHub Logo</title>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
);

export default function Footer() {
    // Define type for social link icons more broadly
    type IconType = React.FC<React.SVGProps<SVGSVGElement>> | 'emoji';
    
    const socialLinks: {href: string; label: string; icon: IconType; emoji?: string}[] = [
        {
            href: 'mailto:zzstoatzz@protonmail.com',
            label: 'Email',
            icon: (props: React.SVGProps<SVGSVGElement>) => <Mail {...props} />,
        },
        {
            href: 'https://github.com/zzstoatzz',
            label: 'GitHub',
            icon: (props: React.SVGProps<SVGSVGElement>) => <GithubIconSimple {...props} />,
        },
        {
            href: 'https://bsky.app/profile/zzstoatzz.io',
            label: 'Bluesky',
            icon: 'emoji', // Use a flag to indicate emoji usage
            emoji: '🦋'    // Store the emoji character
        },
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
                            {link.icon === 'emoji' ? (
                                // Render emoji with styling for consistent size
                                <span style={{ fontSize: '24px', lineHeight: '1' }}>{link.emoji}</span> 
                            ) : (
                                // Render SVG icon components
                                link.icon({ width: 24, height: 24 })
                            )}
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
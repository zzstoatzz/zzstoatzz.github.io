import React from 'react';
import Link from 'next/link';
import LinkCard from '@/app/components/LinkCard';

const links = [
    {
        title: "status",
        description: "live status: availability, activity, vibes",
        link: "https://status.zzstoatzz.io",
        source: "status",
    },
    {
        title: "marvin",
        description: "Structured LLM outputs with native and pydantic types.",
        link: "https://github.com/prefecthq/marvin",
        source: "github",
    },
    {
        title: "prefect",
        description: "pythonic, functional orchestrator and observability tool.",
        link: "https://github.com/prefecthq/prefect",
        source: "github",
    },
    {
        title: "raggy",
        description: "Document parsing, embedding and querying for LLMs.",
        link: "https://github.com/zzstoatzz/raggy",
        source: "github",
    },
    {
        title: "fastmcp",
        description: "the fast, pythonic way to build MCP servers and clients",
        link: "https://github.com/jlowin/fastmcp",
        source: "github",
    },
    {
        title: "blog",
        description: "writing about programming and other things",
        link: "https://blog.zzstoatzz.io",
        source: "bearblog",
    },
    {
        title: "plyr.fm",
        description: "audio streaming platform on atproto",
        link: "https://plyr.fm",
        source: "plyr.fm",
    },
    {
        title: "at-me",
        description: "interactive introduction to open social",
        link: "https://at-me.zzstoatzz.io",
        source: "at-me",
    },
    {
        title: "find-bufo",
        description: "hybrid semantic search for bufos",
        link: "https://find-bufo.fly.dev",
        source: "fly.dev",
    },

];

export default function About() {
    return (
        <main className="about-container content-container">
            <h1 className="about-title">About Me</h1>
            <div className="space-y-4 about-text">
                <p>
                    Hello! My name is Nate - software engineer and ChE grad from the University of Michigan. I grew up in the Upper Peninsula of Michigan and currently live in Logan Square, Chicago.
                </p>
                <p>
                    I am a physicist at heart and love graph theory. I want to build an evolutionary, ant-colony-ish network of LLMs that I can defer my most annoying tasks to.
                </p>
                <p>
                    Feel free to <Link href="/contact" className="about-link">get in touch</Link> if you have an idea for a project or just want to chat!
                </p>
            </div>

            <h2 className="project-section-title">projects & links</h2>
            <div className="project-grid">
                {links.map((link) => (
                    <LinkCard key={link.title} {...link} />
                ))}
            </div>
        </main>
    );
}

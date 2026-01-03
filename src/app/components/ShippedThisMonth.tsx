'use client';

import React, { useState } from 'react';

interface Project {
    name: string;
    description: string;
    url: string;
    urlLabel?: string;
}

interface Section {
    title: string;
    projects: Project[];
}

const sections: Section[] = [
    {
        title: "at protocol apps",
        projects: [
            { name: "plyr.fm", description: "music streaming platform", url: "https://plyr.fm" },
            { name: "ooo.audio", description: "audio social platform", url: "https://ooo.audio" },
            { name: "music-atmosphere-feed", description: "bluesky feeds for music links", url: "https://zig-bsky-feed.fly.dev" },
            { name: "leaflet-search", description: "semantic + keyword search", url: "https://leaflet-search.pages.dev" },
            { name: "find-bufo", description: "hybrid search for bufo zone", url: "https://find-bufo.com" },
            { name: "find-bufo/bot", description: "zig jetstream quote-poster", url: "https://bsky.app/profile/find-bufo.com", urlLabel: "@find-bufo.com" },
            { name: "at-me", description: "identity & apps visualizer", url: "https://at-me.zzstoatzz.io" },
            { name: "status", description: "slack-like status updates", url: "https://status.zzstoatzz.io" },
            { name: "pollz", description: "polls on atproto", url: "https://pollz.waow.tech" },
            { name: "bsky-alt-text", description: "claude-powered alt text", url: "https://alt-text-generator.fly.dev" },
            { name: "follower-weight", description: "bluesky follower analysis", url: "https://follower-weight.fly.dev" },
        ]
    },
    {
        title: "developer tools",
        projects: [
            { name: "pdsx", description: "mcp server for atproto", url: "https://github.com/zzstoatzz/pdsx" },
            { name: "plyr-python-client", description: "sdk + cli + mcp for plyr.fm", url: "https://github.com/zzstoatzz/plyr-python-client" },
            { name: "pmgfal", description: "pydantic model gen for lexicons", url: "https://github.com/zzstoatzz/pmgfal" },
            { name: "mdxify", description: "api docs generator", url: "https://github.com/zzstoatzz/mdxify" },
            { name: "zql", description: "comptime sql bindings for zig", url: "https://tangled.sh/@zzstoatzz.io/zql" },
            { name: "hello-tinker", description: "chat cli for tinker llms", url: "https://github.com/zzstoatzz/hello-tinker" },
            { name: "atproto", description: "oauth fixes for python sdk", url: "https://github.com/zzstoatzz/atproto" },
        ]
    },
    {
        title: "prefect (day job)",
        projects: [
            { name: "prefect-mcp-server", description: "mcp server + claude code plugin", url: "https://github.com/PrefectHQ/prefect-mcp-server" },
            { name: "prefect core", description: "docket migration, dagster guide", url: "https://github.com/PrefectHQ/prefect" },
            { name: "marvin", description: "slackbot memory with letta", url: "https://github.com/PrefectHQ/marvin" },
        ]
    }
];

const themes = [
    "mcp servers everywhere - pdsx, plyrfm-mcp, prefect-mcp-server",
    "zig backends - music-atmosphere-feed, leaflet-search, pollz, find-bufo/bot, zql",
    "rust services - find-bufo search, pmgfal (pyo3), plyr.fm transcoder",
    "shared audio lexicon - plyr.fm + ooo.audio coordination",
    "docket adoption - converted 7 prefect services to perpetual functions",
];

export default function ShippedThisMonth() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="mt-8 border border-gray-700 rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-6 py-4 bg-gray-800 hover:bg-gray-750 flex justify-between items-center text-left transition-colors"
            >
                <span className="text-lg font-semibold text-gray-200">
                    shipped this month
                    <span className="ml-2 text-sm font-normal text-gray-500">dec 2025 - jan 2026</span>
                </span>
                <span className="text-gray-400 text-xl">{isOpen ? '−' : '+'}</span>
            </button>

            {isOpen && (
                <div className="px-6 py-4 bg-gray-900/50 space-y-6">
                    {sections.map((section) => (
                        <div key={section.title}>
                            <h4 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide mb-3">
                                {section.title}
                            </h4>
                            <div className="space-y-2">
                                {section.projects.map((project) => (
                                    <div key={project.name} className="flex items-baseline gap-2 text-sm">
                                        <a
                                            href={project.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-cyan-300 hover:text-cyan-200 font-medium"
                                        >
                                            {project.name}
                                        </a>
                                        <span className="text-gray-500">—</span>
                                        <span className="text-gray-400">{project.description}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    <div>
                        <h4 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide mb-3">
                            themes
                        </h4>
                        <ul className="space-y-1 text-sm text-gray-400">
                            {themes.map((theme, i) => (
                                <li key={i}>• {theme}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}

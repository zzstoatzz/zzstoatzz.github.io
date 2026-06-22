'use client'

import { useEffect, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

interface PostContentProps {
  content: string;
}

export default function PostContent({ content }: PostContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contentRef.current) return;

    const renderer = new marked.Renderer();

    renderer.code = (code, language) => {
      const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
      const highlightedCode = hljs.highlight(code, { language: validLanguage }).value;
      const blockId = Math.random().toString(36).slice(2, 9);
      return `
        <div class="hljs-code-block relative group">
          <span class="hljs-language text-xs text-gray-500 absolute top-2 right-2 opacity-50">${validLanguage.toLowerCase()}</span>
          <pre><code class="hljs ${validLanguage}" id="${blockId}">${highlightedCode}</code></pre>
          <button class="copy-button absolute bottom-2 right-2 text-sm text-gray-400 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" data-target="${blockId}">
            Copy
          </button>
        </div>`;
    };

    renderer.blockquote = (quote) => {
      return `<blockquote class="bg-black bg-opacity-70 border-l-4 border-gray-300 my-6 mx-2.5 p-4 text-white">${quote}</blockquote>`;
    };

    renderer.image = (href, title, text) => {
      return `<img src="${href}" alt="${text}" title="${title || ''}" class="mx-auto" loading="lazy" decoding="async" />`;
    };

    renderer.link = (href, title, text) => {
      if (href.startsWith('#fn')) {
        return `<a href="${href}" id="fnref${href.slice(3)}" class="footnote-ref" title="${title || ''}">${text}</a>`;
      }
      return `<a href="${href}" title="${title || ''}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    };

    marked.setOptions({
      renderer,
      highlight: function (code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
      breaks: true,
      gfm: true,
    });

    contentRef.current.innerHTML = marked(content);

    const handleCopyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.classList.contains('copy-button')) {
        const targetId = target.getAttribute('data-target') || '';
        const code = document.getElementById(targetId)?.textContent || '';
        navigator.clipboard.writeText(code).then(() => {
          target.textContent = '✓';
          setTimeout(() => {
            target.textContent = 'Copy';
          }, 2000);
        });
      }
    };

    document.addEventListener('click', handleCopyClick);

    document.querySelectorAll('.hljs-code-block').forEach(block => {
      const copyButton = block.querySelector('.copy-button');
      if (copyButton instanceof HTMLElement) {
        copyButton.style.bottom = '2rem';
      }
    });

    return () => {
      document.removeEventListener('click', handleCopyClick);
    };
  }, [content]);

  return (
    <div
      ref={contentRef}
      className="prose prose-invert prose-cyan max-w-none prose-headings:text-cyan-300 prose-a:text-cyan-400 prose-strong:text-cyan-200 prose-code:text-cyan-300 prose-pre:bg-transparent prose-pre:p-0"
    />
  );
}

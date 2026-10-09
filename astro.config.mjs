import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
    site: 'https://zzstoatzz.io',
    integrations: [react()],
    // old routes: contact folded into about, zen became the homepage
    redirects: {
        '/contact': '/about',
        '/zen': '/',
    },
    // /about is served from about.html, as github pages expects
    build: { format: 'file' },
    vite: {
        css: { postcss: { plugins: [tailwindcss(), autoprefixer()] } },
        // lightningcss (vite's default) minifies `backdrop-filter` plus its
        // -webkit- twin down to the prefixed one only, which chrome ignores
        build: { cssMinify: 'esbuild' },
    },
});

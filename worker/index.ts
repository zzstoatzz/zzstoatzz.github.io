// look.zzstoatzz.io: a link to one look on zzstoatzz.io that unfurls as that
// look. The site is static, so its pages can't change their card per link;
// these pages can.
//
//   /<did>/<rkey>              a saved preset (io.zzstoatzz.physics.preset)
//   /?PARTICLE_COUNT=6650&…    any settings, as the site's share links carry them
//
// A page is the look's card (og tags) and a redirect to the site with the
// look applied: unfurlers read the tags, people land on the particles. The
// card image (…/card.png) is the look rendered by src/particles/preview.ts on
// the same physics.wasm the site runs, once per look, then served from cache.
import physicsWasm from "../src/particles/physics.wasm";
import { DEFAULT_SETTINGS } from "../src/particles/config";
import type { Settings } from "../src/particles/config";
import { COLLECTION, read } from "../src/particles/presetRecord";
import { png, renderFrame, seeded } from "../src/particles/preview";
import { queryOf, settingsFromQuery } from "../src/particles/settingsManager";
import { WasmPhysics } from "../src/particles/wasmPhysics";
import type { PhysicsExports } from "../src/particles/wasmPhysics";
import type { GpuExports } from "../src/particles/gpuPhysics";

const SITE = "https://zzstoatzz.io";
const ORIGIN = "https://look.zzstoatzz.io";
// a rendered card never changes for a look; a page re-reads its preset now and then
const IMAGE_CACHE = "public, max-age=31536000, immutable";
const PAGE_CACHE = "public, max-age=3600";

// what one link names: the settings to render, and where the site shows them
interface Look {
	settings: Settings;
	// identifies the look: seeds its crowd, and keys its card
	key: string;
	site: string;
	card: string;
	title: string;
	description: string | null;
	uri: string | null;
}

export default {
	async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const image = url.pathname.endsWith("/card.png");
		const path = image ? url.pathname.slice(0, -"card.png".length) : url.pathname;
		let look: Look | null;
		try {
			look = await lookAt(path, url.search);
		} catch (e) {
			console.warn("no look:", e);
			return new Response("no such look", { status: 404, headers: { "content-type": "text/plain" } });
		}
		if (!look) return Response.redirect(SITE, 302);
		if (!image) return page(look);

		const cached = await caches.default.match(request);
		if (cached) return cached;
		const res = new Response(await card(look), {
			headers: { "content-type": "image/png", "cache-control": IMAGE_CACHE },
		});
		ctx.waitUntil(caches.default.put(request, res.clone()));
		return res;
	},
};

// The look a path and query name, or null for neither (the bare domain).
async function lookAt(path: string, search: string): Promise<Look | null> {
	const parts = path.split("/").filter(Boolean);
	if (parts.length === 2) {
		const uri = `at://${parts[0]}/${COLLECTION}/${parts[1]}`;
		const preset = await read(uri);
		const query = queryOf(settingsFromQuery(preset.settings));
		return {
			settings: { ...DEFAULT_SETTINGS, ...settingsFromQuery(query) },
			key: uri,
			site: `${SITE}/?preset=${encodeURIComponent(uri)}`,
			card: `${ORIGIN}/${parts[0]}/${parts[1]}/card.png`,
			title: preset.name ?? "a look",
			description: preset.handle ? `particles on zzstoatzz.io, saved by @${preset.handle}` : "particles on zzstoatzz.io",
			uri,
		};
	}
	if (parts.length > 0) throw new Error(`not a look: ${path}`);
	const query = queryOf(settingsFromQuery(search));
	if (!query) return null;
	return {
		settings: { ...DEFAULT_SETTINGS, ...settingsFromQuery(query) },
		key: query,
		site: `${SITE}/?${query}`,
		card: `${ORIGIN}/card.png?${query}`,
		title: "n8",
		description: "particles on zzstoatzz.io",
		uri: null,
	};
}

let physics: (PhysicsExports & GpuExports) | null = null;

async function card(look: Look) {
	physics ??= new WasmPhysics(new WebAssembly.Instance(physicsWasm, {}).exports as unknown as PhysicsExports & GpuExports).w;
	const seed = fnv1a(look.key);
	physics.seed(seed);
	return png(renderFrame(physics, look.settings, seeded(seed)));
}

function fnv1a(s: string) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

function page(look: Look): Response {
	const site = escape(look.site);
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(look.title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="zzstoatzz.io">
<meta property="og:title" content="${escape(look.title)}">
${look.description ? `<meta property="og:description" content="${escape(look.description)}">` : ""}
<meta property="og:image" content="${escape(look.card)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="particles on zzstoatzz.io with this link's settings">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0B0B03">
${look.uri ? `<meta name="at:canonical" content="${escape(look.uri)}">\n<link rel="alternate" href="${escape(look.uri)}">` : ""}
<script>location.replace(${JSON.stringify(look.site).replace(/</g, "\\u003c")})</script>
</head>
<body style="background:#070610;color:#d8dee5;font-family:system-ui,sans-serif">
<p><a href="${site}" style="color:#64ffda">open the particles on zzstoatzz.io</a></p>
</body>
</html>
`;
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": PAGE_CACHE },
	});
}

function escape(s: string) {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

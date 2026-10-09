// Offline support for the installed app. Pages and other unhashed files are
// network-first so a deploy shows up right away; astro's hashed bundles in
// /_astro/ (including three.js and the physics wasm) never change, so they
// are served from cache once seen.
const CACHE = "n8-v3";
const SHELL = ["/", "/manifest.webmanifest", "/assets/images/stoat-192.png"];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
	self.skipWaiting();
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

const immutable = (url) => url.origin === self.location.origin && url.pathname.startsWith("/_astro/");

self.addEventListener("fetch", (e) => {
	const req = e.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	if (immutable(url)) {
		e.respondWith(
			caches.match(req).then(
				(hit) =>
					hit ||
					fetch(req).then((res) => {
						if (res.ok) {
							const copy = res.clone();
							caches.open(CACHE).then((c) => c.put(req, copy));
						}
						return res;
					}),
			),
		);
		return;
	}

	e.respondWith(
		fetch(req)
			.then((res) => {
				if (res.ok) {
					const copy = res.clone();
					caches.open(CACHE).then((c) => c.put(req, copy));
				}
				return res;
			})
			.catch(() =>
				caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : Response.error())),
			),
	);
});

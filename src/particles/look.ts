// Links to share a look by: look.zzstoatzz.io (worker/) pages that unfurl
// as that look, then send people here with it applied.
import { parseCanonicalResourceUri } from "@atcute/lexicons/syntax";

const LOOK = "https://look.zzstoatzz.io";

// a link to these settings (a query string, as the share link carries them)
export const settingsLook = (query: string) => `${LOOK}/?${query}`;

// a link to a saved preset, by its AT URI
export function presetLook(uri: string) {
	const { repo, rkey } = parseCanonicalResourceUri(uri);
	return `${LOOK}/${repo}/${rkey}`;
}

// Render a look's card now, in the background: its first render takes
// seconds, and an unfurler fetching it later may not wait that long.
export function warm(link: string) {
	const url = new URL(link);
	url.pathname = `${url.pathname.replace(/\/$/, "")}/card.png`;
	void fetch(url, { mode: "no-cors" }).catch(() => {});
}

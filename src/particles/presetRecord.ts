// The io.zzstoatzz.physics.preset record (lexicons/) and reading one: a
// public record on its author's PDS, so no sign-in. The site (presets.ts, a
// ?preset= link) and the look worker (worker/) both read presets this way.
import type {} from "@atcute/atproto";
import { Client, simpleFetchHandler } from "@atcute/client";
import {
	CompositeDidDocumentResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	XrpcHandleResolver,
} from "@atcute/identity-resolver";
import { parseCanonicalResourceUri } from "@atcute/lexicons/syntax";

export const COLLECTION = "io.zzstoatzz.physics.preset";
// the record's settings string; the lexicon allows this much
const MAX_SETTINGS = 10000;

// handles resolve through slingshot rather than an appview, so neither
// signing in nor reading a preset depends on bluesky's
export const actors = new LocalActorResolver({
	handleResolver: new XrpcHandleResolver({ serviceUrl: "https://slingshot.microcosm.blue" }),
	didDocumentResolver: new CompositeDidDocumentResolver({
		methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() },
	}),
});

export interface Preset {
	settings: string;
	name: string | null;
	// the author's handle, or null when it doesn't verify
	handle: string | null;
}

// A preset, read from its author's PDS.
export async function read(uri: string): Promise<Preset> {
	const { repo, collection, rkey } = parseCanonicalResourceUri(uri);
	if (collection !== COLLECTION) throw new Error(`not a preset: ${uri}`);
	const { pds, handle } = await actors.resolve(repo);
	const rpc = new Client({ handler: simpleFetchHandler({ service: pds }) });
	const res = await rpc.get("com.atproto.repo.getRecord", { params: { repo, collection, rkey } });
	if (!res.ok) throw new Error(`preset not found: ${uri}`);
	return { ...presetFields(uri, res.data.value), handle: handle === "handle.invalid" ? null : handle };
}

// A preset's settings, read from its author's PDS.
export const load = async (uri: string) => (await read(uri)).settings;

// The fields of a preset record, checked: a record is whatever its author
// wrote.
export function presetFields(uri: string, value: unknown): Omit<Preset, "handle"> {
	const v = value as Record<string, unknown> | null;
	if (!v || v.$type !== COLLECTION || typeof v.settings !== "string" || v.settings.length > MAX_SETTINGS) {
		throw new Error(`not a preset record: ${uri}`);
	}
	return { settings: v.settings, name: typeof v.name === "string" ? v.name : null };
}

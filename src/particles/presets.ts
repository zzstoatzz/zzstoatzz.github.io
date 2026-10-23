// Presets: a look saved as an io.zzstoatzz.physics.preset record
// (lexicons/) in the saver's own repo, and loaded back from any repo by its
// AT URI. Saving is the only thing on the site that signs in, so that is
// where sign-in happens: the first save sends the browser to the account's
// authorization server asking to create presets and nothing more, and the
// save finishes when it comes back. More (deleting, say) would be a wider
// scope on a new authorization; the client metadata already lists it.
//
// Imported only when needed (opening the save form, an OAuth callback, a
// ?preset= link), so the page itself carries none of this.
import type {} from "@atcute/atproto";
import { Client, simpleFetchHandler } from "@atcute/client";
import {
	CompositeDidDocumentResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	XrpcHandleResolver,
} from "@atcute/identity-resolver";
import type { ActorIdentifier, Did } from "@atcute/lexicons";
import { isDid, isHandle, parseCanonicalResourceUri } from "@atcute/lexicons/syntax";
import {
	AuthorizationError,
	OAuthUserAgent,
	configureOAuth,
	createAuthorizationUrl,
	deleteStoredSession,
	finalizeAuthorization,
	getSession,
	listStoredSessions,
} from "@atcute/oauth-browser-client";
import { buildUniversalLink } from "@aturi.to/waypoints";

export const COLLECTION = "io.zzstoatzz.physics.preset";
const CREATE = `repo:${COLLECTION}?action=create`;
// what a save asks for; public/oauth-client-metadata.json must list each of
// these tokens (presets.test.ts holds the two together)
export const SCOPE = `atproto ${CREATE}`;
export const CLIENT_ID = "https://zzstoatzz.io/oauth-client-metadata.json";
export const REDIRECT_URI = "https://zzstoatzz.io/";
// the record's settings string; the lexicon allows this much
const MAX_SETTINGS = 10000;

export interface Account {
	did: Did;
	handle: string | null;
}

export interface Saved {
	uri: string;
	account: Account;
	settings: string;
	// a client-agnostic link to the record (aturi.to), for "view record"
	recordLink: string;
}

// what the authorization round trip carries back (atcute keeps it with the
// state, so nothing of ours is stored)
interface PendingSave {
	settings: string;
	name: string;
}

const isPending = (s: unknown): s is PendingSave =>
	!!s && typeof (s as PendingSave).settings === "string" && typeof (s as PendingSave).name === "string";

// handles resolve through slingshot rather than an appview, so signing in
// doesn't depend on bluesky's
const actors = new LocalActorResolver({
	handleResolver: new XrpcHandleResolver({ serviceUrl: "https://slingshot.microcosm.blue" }),
	didDocumentResolver: new CompositeDidDocumentResolver({
		methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() },
	}),
});

let configured = false;
function configure() {
	if (configured) return;
	configured = true;
	// local development is a loopback client (no hosted metadata); it has to
	// be opened on 127.0.0.1, which atproto treats as loopback and localhost not
	const loopback = location.hostname === "127.0.0.1" || location.hostname === "[::1]";
	const redirect = `${location.origin}/`;
	configureOAuth({
		metadata: loopback
			? {
					client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(SCOPE)}`,
					redirect_uri: redirect,
				}
			: { client_id: CLIENT_ID, redirect_uri: REDIRECT_URI },
		identityResolver: actors,
	});
}

// whether a granted scope string lets us create presets
const canCreate = (scope: string) => scope.split(" ").some((s) => s === CREATE || s === `repo:${COLLECTION}`);

async function handleOf(did: Did): Promise<string | null> {
	try {
		const { handle } = await actors.resolve(did);
		return handle === "handle.invalid" ? null : handle;
	} catch {
		return null;
	}
}

// The account a save would go to without signing in: a stored session that
// may create presets.
export async function currentAccount(): Promise<Account | null> {
	configure();
	for (const did of listStoredSessions()) {
		try {
			const { token } = await getSession(did, { allowStale: true });
			if (canCreate(token.scope)) return { did, handle: await handleOf(did) };
		} catch {
			// expired or revoked: not a usable account
		}
	}
	return null;
}

// Sign out: revoke at the PDS, and forget the session here even when the
// PDS can't be reached.
export async function signOut(did: Did) {
	configure();
	try {
		await new OAuthUserAgent(await getSession(did, { allowStale: true })).signOut();
	} catch {
		deleteStoredSession(did);
	}
}

// Save settings as a preset. With an identifier, or with no usable session,
// this redirects to sign in and never resolves; the save completes in
// resume() when the browser comes back.
export async function save(settings: string, name: string, identifier?: string): Promise<Saved> {
	configure();
	const account = identifier ? null : await currentAccount();
	if (account) return write(account.did, { settings, name });
	if (!identifier) throw new SaveError("handle");
	const state: PendingSave = { settings, name };
	let url: URL;
	try {
		url = await createAuthorizationUrl({
			target: { type: "account", identifier: normalize(identifier) },
			scope: SCOPE,
			state,
		});
	} catch (e) {
		throw new SaveError("resolve", e);
	}
	// let the library's storage settle before the page unloads
	await new Promise((r) => setTimeout(r, 200));
	location.assign(url);
	return new Promise<never>(() => {});
}

// Finish a save the authorization server sent back here, if this is that
// page load. Returns null on an ordinary load.
export async function resume(): Promise<Saved | null> {
	const params = new URLSearchParams(location.hash.slice(1));
	if (!params.has("state") || !(params.has("code") || params.has("error"))) return null;
	history.replaceState(null, "", location.pathname + location.search);
	configure();
	let finalized: Awaited<ReturnType<typeof finalizeAuthorization>>;
	try {
		finalized = await finalizeAuthorization(params);
	} catch (e) {
		throw new SaveError(e instanceof AuthorizationError && e.error === "access_denied" ? "cancelled" : "expired", e);
	}
	const { session, state } = finalized;
	if (!canCreate(session.token.scope)) throw new SaveError("scope");
	if (!isPending(state)) throw new SaveError("expired");
	return write(session.info.sub, state);
}

async function write(did: Did, { settings, name }: PendingSave): Promise<Saved> {
	const session = await getSession(did, { allowStale: true });
	const rpc = new Client({ handler: new OAuthUserAgent(session) });
	const record = {
		$type: COLLECTION,
		settings,
		...(name ? { name } : {}),
		createdAt: new Date().toISOString(),
	};
	const res = await rpc.post("com.atproto.repo.createRecord", {
		input: { repo: did, collection: COLLECTION, record },
	});
	if (!res.ok) throw new SaveError("write", res.data);
	return {
		uri: res.data.uri,
		account: { did, handle: await handleOf(did) },
		settings,
		recordLink: buildUniversalLink(res.data.uri) ?? res.data.uri,
	};
}

// A preset's settings, read from its author's PDS. No sign-in: records are
// public.
export async function load(uri: string): Promise<string> {
	const { repo, collection, rkey } = parseCanonicalResourceUri(uri);
	if (collection !== COLLECTION) throw new Error(`not a preset: ${uri}`);
	const { pds } = await actors.resolve(repo);
	const rpc = new Client({ handler: simpleFetchHandler({ service: pds }) });
	const res = await rpc.get("com.atproto.repo.getRecord", { params: { repo, collection, rkey } });
	if (!res.ok) throw new Error(`preset not found: ${uri}`);
	return presetSettings(uri, res.data.value);
}

// The settings of a preset record, checked: a record is whatever its author
// wrote.
export function presetSettings(uri: string, value: unknown): string {
	const v = value as Record<string, unknown> | null;
	if (!v || v.$type !== COLLECTION || typeof v.settings !== "string" || v.settings.length > MAX_SETTINGS) {
		throw new Error(`not a preset record: ${uri}`);
	}
	return v.settings;
}

// what a person types for an account: a handle (with or without @ or at://,
// any case) or a DID, which keeps its case
export function normalize(input: string): ActorIdentifier {
	const s = input.trim().replace(/^at:\/\//, "").replace(/^@/, "");
	if (isDid(s)) return s;
	const handle = s.toLowerCase();
	if (isHandle(handle)) return handle;
	throw new SaveError("handle");
}

// why a save didn't happen
type SaveFailure = "handle" | "resolve" | "cancelled" | "expired" | "scope" | "write";

export class SaveError extends Error {
	constructor(
		readonly reason: SaveFailure,
		cause?: unknown,
	) {
		super(reason, { cause });
		this.name = "SaveError";
	}
}

const FAILURE_MESSAGES: Record<SaveFailure, string> = {
	handle: "that doesn't look like a handle.",
	resolve: "couldn't find that account.",
	cancelled: "sign-in was cancelled.",
	expired: "that sign-in expired. try saving again.",
	scope: "saving presets wasn't allowed on that sign-in.",
	write: "couldn't save to your pds.",
};

// a failed save, as one sentence for the panel
export const failureMessage = (e: unknown) => FAILURE_MESSAGES[e instanceof SaveError ? e.reason : "write"];

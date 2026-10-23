// The settings panel's "save to your pds" form, and the two page loads that
// involve a preset: coming back from sign-in to finish a save, and opening a
// ?preset= link. The atproto code itself (presets.ts) loads only when one of
// these needs it.
import type { ParticleSystem } from "./particleSystem";
import type * as PresetsModule from "./presets";
import type { Account, Saved } from "./presets";

let presets: Promise<typeof PresetsModule> | null = null;
const loadPresets = () => (presets ??= import("./presets"));

const TYPEAHEAD = "https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead";

// the look being saved, kept in this tab across the sign-in round trip,
// which comes back to a bare page: if the save doesn't finish, it's put back
const RETURN_KEY = "presetReturn";

function stash(settings: string | null) {
	try {
		if (settings === null) sessionStorage.removeItem(RETURN_KEY);
		else sessionStorage.setItem(RETURN_KEY, settings);
	} catch {
		// storage blocked: a failed save just lands on the defaults
	}
}

function stashed(): string | null {
	try {
		return sessionStorage.getItem(RETURN_KEY);
	} catch {
		return null;
	}
}

// the site link that loads a saved preset
const presetLink = (uri: string) => `${location.origin}/?preset=${encodeURIComponent(uri)}`;

// Replace the whole look, and show it in the panel.
function applyLook(system: ParticleSystem, settings: string) {
	system.settingsManager.applyQuery(settings);
	system.uiController.updateUI(system.settingsManager.getAllSettings());
}

// The ?preset= on this page load, if any: fetch it and apply it. Resolves
// either way (a missing or broken preset leaves the defaults).
export async function loadPresetFromUrl(system: ParticleSystem): Promise<void> {
	const uri = new URLSearchParams(location.search).get("preset");
	if (!uri) return;
	try {
		const { load } = await loadPresets();
		applyLook(system, await load(uri));
	} catch (e) {
		console.warn("couldn't load preset:", e);
	}
}

interface Actor {
	handle: string;
	displayName?: string;
	avatar?: string;
}

export class PresetPanel {
	private form!: HTMLElement;
	private name!: HTMLInputElement;
	private handleField!: HTMLElement;
	private handle!: HTMLInputElement;
	private list!: HTMLUListElement;
	private account!: HTMLElement;
	private submit!: HTMLButtonElement;
	private status!: HTMLElement;
	// a stored session that can save; while there is one, no handle box
	private signedIn = false;
	private busy = false;
	// the typeahead
	private actors: Actor[] = [];
	private active = -1;
	private search: AbortController | null = null;
	private debounce: ReturnType<typeof setTimeout> | undefined;

	constructor(private system: ParticleSystem) {}

	static template() {
		return `
			<div class="button-row preset-row">
				<button id="openPresetSave" class="button" aria-expanded="false" aria-controls="presetForm">save to your pds</button>
			</div>
			<form id="presetForm" class="preset-form" hidden>
				<label for="presetName">name</label>
				<input id="presetName" class="panel-input" maxlength="64" placeholder="optional" autocomplete="off">
				<p id="presetAccount" class="section-note" hidden></p>
				<div id="presetHandleField" class="handle-field">
					<label for="presetHandle">atmosphere account</label>
					<input id="presetHandle" class="panel-input" type="search" placeholder="you.bsky.social"
						autocomplete="off" autocapitalize="none" spellcheck="false"
						data-1p-ignore data-lpignore="true" data-bwignore
						role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="presetHandleList">
					<ul id="presetHandleList" class="handle-list" role="listbox" hidden></ul>
				</div>
				<button id="presetSubmit" class="button preset-submit" type="submit">save</button>
				<p id="presetStatus" class="section-note preset-status" role="status"></p>
			</form>
		`;
	}

	bind() {
		const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
		this.form = $("presetForm");
		this.name = $("presetName");
		this.handleField = $("presetHandleField");
		this.handle = $("presetHandle");
		this.list = $("presetHandleList");
		this.account = $("presetAccount");
		this.submit = $("presetSubmit");
		this.status = $("presetStatus");
		const open = $<HTMLButtonElement>("openPresetSave");

		open.addEventListener("click", () => {
			const show = this.form.hidden;
			this.form.hidden = !show;
			open.setAttribute("aria-expanded", String(show));
			if (show) void this.refreshAccount();
		});
		this.form.addEventListener("submit", (e) => {
			e.preventDefault();
			void this.save(this.signedIn ? undefined : this.handle.value);
		});
		// Back from the sign-in page can bring this page out of the back/forward
		// cache mid-redirect; the save it started is over
		window.addEventListener("pageshow", (e) => {
			if (!e.persisted || !this.busy) return;
			stash(null);
			this.setBusy(false);
			this.say("");
		});
		this.handle.addEventListener("input", () => this.queueSearch());
		this.handle.addEventListener("keydown", (e) => this.onKey(e));
		this.handle.addEventListener("blur", () => this.closeList());
		// typing in the panel shouldn't drive the particles
		for (const input of [this.name, this.handle]) {
			input.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
		}
	}

	// The page load after sign-in: finish the save it started.
	async resumeIfReturning() {
		// checked here first so an ordinary load never fetches presets.ts
		if (!/[#&]state=/.test(location.hash)) return;
		const { resume, failureMessage } = await loadPresets();
		this.system.uiController.showControlPanel();
		this.form.hidden = false;
		try {
			const saved = await resume();
			if (!saved) return;
			applyLook(this.system, saved.settings);
			this.showSaved(saved);
			void this.refreshAccount();
		} catch (e) {
			const look = stashed();
			if (look) {
				applyLook(this.system, look);
				history.replaceState(null, "", this.system.settingsManager.generateShareLink());
			}
			console.warn("preset save failed:", e);
			this.say(failureMessage(e));
		} finally {
			stash(null);
		}
	}

	private async save(identifier?: string) {
		if (this.busy) return;
		const { save, failureMessage } = await loadPresets();
		const settings = this.system.settingsManager.toQuery();
		stash(settings);
		this.setBusy(true, identifier ? "redirecting..." : "saving...");
		// the gap before the PDS's page loads says where it's going
		this.say(identifier ? `taking you to @${identifier.trim().replace(/^@/, "")}'s sign-in…` : "");
		try {
			this.showSaved(await save(settings, this.name.value.trim(), identifier));
		} catch (e) {
			console.warn("preset save failed:", e);
			this.say(failureMessage(e));
		} finally {
			stash(null);
			this.setBusy(false);
		}
	}

	private showSaved(saved: Saved) {
		const link = presetLink(saved.uri);
		history.replaceState(null, "", link);
		const view = document.createElement("a");
		Object.assign(view, { href: saved.recordLink, target: "_blank", rel: "noopener", textContent: "view record" });
		this.status.replaceChildren(
			`saved to ${saved.account.handle ? `@${saved.account.handle}` : "your pds"}. `,
			this.linkButton("copy link", () => {
				this.system.uiController.copyToClipboard(link);
				this.system.uiController.showSuccessMessage("preset link copied");
			}),
			" · ",
			view,
		);
		this.name.value = "";
	}

	// Whether a save can skip signing in, and say who it saves as.
	private async refreshAccount() {
		const { currentAccount } = await loadPresets();
		this.setAccount(await currentAccount().catch(() => null));
	}

	private setAccount(account: Account | null) {
		this.signedIn = !!account;
		this.handleField.hidden = !!account;
		this.account.hidden = !account;
		if (!account) return;
		this.account.replaceChildren(
			`saving as ${account.handle ? `@${account.handle}` : account.did}. `,
			this.linkButton("use another account", () => {
				this.setAccount(null);
				this.handle.focus();
			}),
			" · ",
			this.linkButton("sign out", () => void this.signOut(account)),
		);
	}

	private async signOut(account: Account) {
		const { signOut } = await loadPresets();
		await signOut(account.did);
		this.say("signed out.");
		this.setAccount(null);
	}

	// --- the handle typeahead (notes: interfaces/atproto-login-page.md)

	private queueSearch() {
		clearTimeout(this.debounce);
		const q = this.handle.value.trim().replace(/^@/, "");
		if (q.length < 2) return this.closeList();
		this.debounce = setTimeout(() => void this.runSearch(q), 120);
	}

	private async runSearch(q: string) {
		this.search?.abort();
		const search = (this.search = new AbortController());
		try {
			const res = await fetch(`${TYPEAHEAD}?q=${encodeURIComponent(q)}&limit=6`, {
				headers: { "X-Client": "zzstoatzz.io" },
				signal: search.signal,
			});
			if (!res.ok) return;
			const data = (await res.json()) as { actors?: Actor[] };
			this.actors = data.actors ?? [];
			this.active = -1;
			this.renderList();
		} catch {
			// aborted or offline: the box still takes a typed handle
		}
	}

	private renderList() {
		this.list.replaceChildren(...this.actors.map((a, i) => this.option(a, i)));
		const open = this.actors.length > 0;
		this.list.hidden = !open;
		this.handle.setAttribute("aria-expanded", String(open));
		this.handle.setAttribute("aria-activedescendant", this.active >= 0 ? `presetHandle-${this.active}` : "");
	}

	// a row: avatar (or a placeholder the same size), @handle, display name
	private option(actor: Actor, i: number) {
		const li = document.createElement("li");
		Object.assign(li, { id: `presetHandle-${i}`, role: "option", className: "handle-option" });
		li.setAttribute("aria-selected", String(i === this.active));
		const avatar = document.createElement(actor.avatar ? "img" : "span");
		avatar.className = "handle-avatar";
		if (actor.avatar) Object.assign(avatar, { src: actor.avatar, alt: "", loading: "lazy" });
		const handle = document.createElement("span");
		Object.assign(handle, { className: "handle-handle", textContent: `@${actor.handle}` });
		const name = document.createElement("span");
		Object.assign(name, { className: "handle-name", textContent: actor.displayName ?? "" });
		li.append(avatar, handle, name);
		// mousedown, so the input keeps focus until the pick lands
		li.addEventListener("mousedown", (e) => {
			e.preventDefault();
			this.pick(i);
		});
		return li;
	}

	private onKey(e: KeyboardEvent) {
		const open = !this.list.hidden;
		if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
			e.preventDefault();
			const n = this.actors.length;
			if (e.key === "ArrowDown") this.active = (this.active + 1) % n;
			else this.active = this.active <= 0 ? n - 1 : this.active - 1;
			this.renderList();
		} else if (open && e.key === "Enter" && this.active >= 0) {
			e.preventDefault();
			this.pick(this.active);
		} else if (e.key === "Escape") {
			this.closeList();
		}
	}

	// picking an account starts the save
	private pick(i: number) {
		const actor = this.actors[i];
		if (!actor) return;
		this.handle.value = actor.handle;
		this.closeList();
		void this.save(actor.handle);
	}

	private closeList() {
		this.search?.abort();
		this.actors = [];
		this.active = -1;
		this.list.hidden = true;
		this.handle.setAttribute("aria-expanded", "false");
	}

	// --- small helpers

	private setBusy(busy: boolean, label = "save") {
		this.busy = busy;
		this.submit.disabled = busy;
		this.submit.textContent = busy ? label : "save";
	}

	private say(message: string) {
		this.status.textContent = message;
	}

	private linkButton(text: string, onClick: () => void) {
		const b = document.createElement("button");
		Object.assign(b, { type: "button", className: "link-button", textContent: text });
		b.addEventListener("click", onClick);
		return b;
	}
}

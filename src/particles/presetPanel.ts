// The settings panel's "save to your pds" form, and the two page loads that
// involve a preset: coming back from sign-in to finish a save, and opening a
// ?preset= link. The atproto code itself (presets.ts) loads only when one of
// these needs it.
import type { ParticleSystem } from "./particleSystem";
import type * as PresetsModule from "./presets";
import type { Saved } from "./presets";

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
	private actors: Actor[] = [];
	private active = -1;
	private search: AbortController | null = null;
	private debounce: ReturnType<typeof setTimeout> | undefined;
	// a stored session that can save; when set, the handle box is hidden
	private signedIn = false;
	private busy = false;

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
		this.handle.addEventListener("input", () => this.queueSearch());
		this.handle.addEventListener("keydown", (e) => this.onKey(e));
		this.handle.addEventListener("blur", () => this.closeList());
		// sliders and fields in the panel shouldn't drive the particles
		for (const input of [this.name, this.handle]) {
			input.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
		}
	}

	// Whether a save can skip signing in, and say who it saves as.
	private async refreshAccount() {
		const { currentAccount } = await loadPresets();
		const account = await currentAccount().catch(() => null);
		this.signedIn = !!account;
		this.handleField.hidden = this.signedIn;
		this.account.hidden = !this.signedIn;
		if (!account) return;
		this.account.replaceChildren(
			`saving as ${account.handle ? `@${account.handle}` : account.did}. `,
			this.linkButton("use another account", () => {
				this.signedIn = false;
				this.account.hidden = true;
				this.handleField.hidden = false;
				this.handle.focus();
			}),
		);
	}

	private async save(identifier?: string) {
		if (this.busy) return;
		const { save, SaveError, FAILURE_MESSAGES } = await loadPresets();
		this.setBusy(true, identifier ? "redirecting..." : "saving...");
		this.say("");
		const settings = this.system.settingsManager.toQuery();
		stash(settings);
		try {
			const saved = await save(settings, this.name.value.trim(), identifier);
			stash(null);
			this.showSaved(saved);
		} catch (e) {
			stash(null);
			console.warn("preset save failed:", e);
			this.say(e instanceof SaveError ? FAILURE_MESSAGES[e.reason] : FAILURE_MESSAGES.write);
		} finally {
			this.setBusy(false);
		}
	}

	private showSaved(saved: Saved) {
		const link = presetLink(saved.uri);
		history.replaceState(null, "", `${location.pathname}?preset=${encodeURIComponent(saved.uri)}`);
		const view = document.createElement("a");
		view.href = saved.recordLink;
		view.target = "_blank";
		view.rel = "noopener";
		view.textContent = "view record";
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

	// The page load after sign-in: finish the save it started.
	async resumeIfReturning() {
		if (!/[#&]state=/.test(location.hash)) return;
		const { resume, SaveError, FAILURE_MESSAGES } = await loadPresets();
		this.system.uiController.showControlPanel();
		this.form.hidden = false;
		try {
			const saved = await resume();
			if (!saved) return;
			// the round trip landed on a bare page; put the saved look back
			this.system.settingsManager.applyQuery(saved.settings);
			this.system.uiController.updateUI(this.system.settingsManager.getAllSettings());
			this.showSaved(saved);
			void this.refreshAccount();
		} catch (e) {
			const look = stashed();
			if (look) {
				this.system.settingsManager.applyQuery(look);
				this.system.uiController.updateUI(this.system.settingsManager.getAllSettings());
				history.replaceState(null, "", this.system.settingsManager.generateShareLink());
			}
			console.warn("preset save failed:", e);
			this.say(e instanceof SaveError ? FAILURE_MESSAGES[e.reason] : FAILURE_MESSAGES.write);
		} finally {
			stash(null);
		}
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
		this.list.replaceChildren(
			...this.actors.map((a, i) => {
				const li = document.createElement("li");
				li.id = `presetHandle-${i}`;
				li.role = "option";
				li.className = "handle-option";
				li.setAttribute("aria-selected", String(i === this.active));
				const avatar = document.createElement(a.avatar ? "img" : "span");
				avatar.className = "handle-avatar";
				if (a.avatar) Object.assign(avatar, { src: a.avatar, alt: "", loading: "lazy" });
				const handle = document.createElement("span");
				handle.className = "handle-handle";
				handle.textContent = `@${a.handle}`;
				const name = document.createElement("span");
				name.className = "handle-name";
				name.textContent = a.displayName ?? "";
				li.append(avatar, handle, name);
				// mousedown, so the input keeps focus until the pick lands
				li.addEventListener("mousedown", (e) => {
					e.preventDefault();
					this.pick(i);
				});
				return li;
			}),
		);
		const open = this.actors.length > 0;
		this.list.hidden = !open;
		this.handle.setAttribute("aria-expanded", String(open));
		this.handle.setAttribute("aria-activedescendant", this.active >= 0 ? `presetHandle-${this.active}` : "");
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
		b.type = "button";
		b.className = "link-button";
		b.textContent = text;
		b.addEventListener("click", onClick);
		return b;
	}
}

// the site link that loads a saved preset
export function presetLink(uri: string) {
	return `${location.origin}/?preset=${encodeURIComponent(uri)}`;
}

// The ?preset= on this page load, if any: fetch it and apply it. Resolves
// either way (a missing or broken preset leaves the defaults).
export async function loadPresetFromUrl(system: ParticleSystem): Promise<void> {
	const uri = new URLSearchParams(location.search).get("preset");
	if (!uri) return;
	try {
		const { load } = await loadPresets();
		const preset = await load(uri);
		system.settingsManager.applyQuery(preset.settings);
		system.uiController.updateUI(system.settingsManager.getAllSettings());
	} catch (e) {
		console.warn("couldn't load preset:", e);
	}
}

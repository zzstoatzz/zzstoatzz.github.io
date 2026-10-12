// The getting-started tour: one card at the bottom of the screen that walks
// through the settings panel a question at a time. Each step offers three
// presets plus one control for dialing its answer in, and every change goes
// through the settings manager, so the particles behind the card react right
// away and the panel and URL stay in sync. Runs once on a first visit to the
// homepage; the panel's "tour" button runs it again. Styles in particles.css.
import type { SettingKey, Settings } from "./config";
import { RANGES } from "./config";
import { mountOnBody } from "./dom";
import type { ParticleSystem } from "./particleSystem";

interface Choice {
	name: string;
	desc: string;
	set: Partial<Settings>;
	hint: string;
}

interface Step {
	q: string;
	// where these settings live in the panel
	where: string;
	choices: Choice[];
	// the one control under the choices
	dial: { key: SettingKey; name: string; ends?: [string, string] };
}

const STEPS: Step[] = [
	{
		q: "what should your finger do?",
		where: "forces",
		choices: [
			{ name: "nudge", desc: "a gentle push while you hold", set: { EXPLOSION_FORCE: 0.5, EXPLOSION_RADIUS: 250, ENABLE_VORTEX_FORCE: false },
				hint: "try it: <b>press and hold</b> on the particles" },
			{ name: "shove", desc: "a hard push that clears a hole fast", set: { EXPLOSION_FORCE: 2.5, EXPLOSION_RADIUS: 300, ENABLE_VORTEX_FORCE: false },
				hint: "try it: <b>press and drag</b> through them" },
			{ name: "samus touch", desc: "a charge shot: hold to charge, let go to fire", set: { EXPLOSION_FORCE: 2, EXPLOSION_RADIUS: 250, ENABLE_VORTEX_FORCE: true },
				hint: "try it: <b>hold for a few seconds</b>, then let go. longer hold, bigger boom" },
		],
		dial: { key: "EXPLOSION_FORCE", name: "touch force", ends: ["soft", "huge"] },
	},
	{
		q: "how many?",
		where: "particles",
		choices: [
			{ name: "a few", desc: "300 big ones with lots of room", set: { PARTICLE_COUNT: 300, AVERAGE_PARTICLE_SIZE: 3.5 }, hint: "big and easy to follow" },
			{ name: "a bunch", desc: "700, the usual crowd", set: { PARTICLE_COUNT: 700, AVERAGE_PARTICLE_SIZE: 2.5 }, hint: "the default" },
			{ name: "a swarm", desc: "3,000 small ones, like dust", set: { PARTICLE_COUNT: 3000, AVERAGE_PARTICLE_SIZE: 1.3 }, hint: "stir it and it moves like smoke" },
		],
		dial: { key: "PARTICLE_COUNT", name: "particle count" },
	},
	{
		q: "how do they get along?",
		where: "forces",
		choices: [
			{ name: "spread out", desc: "each keeps its distance, so they fill the screen", set: { ATTRACT: -100, SMOOTHING_FACTOR: 0.13 },
				hint: "stir them and watch them even back out" },
			{ name: "clump up", desc: "they pull on their neighbors and gather into blobs", set: { ATTRACT: 120, SMOOTHING_FACTOR: 0.25 },
				hint: "give it a few seconds to gather" },
			{ name: "ignore", desc: "no pull, no push. they pass through like ghosts", set: { ATTRACT: 0, SMOOTHING_FACTOR: 0.13 },
				hint: "push them into a corner and they stay piled" },
		],
		dial: { key: "ATTRACT", name: "attract", ends: ["apart", "together"] },
	},
	{
		q: "what's the world like?",
		where: "particles and forces",
		choices: [
			{ name: "floaty", desc: "no gravity, a little air to slow them", set: { GRAVITY: 0, DRAG: 0.05, ELASTICITY: 0.8 },
				hint: "things settle down after a stir" },
			{ name: "sand", desc: "they drop and pile on the floor", set: { GRAVITY: 10, DRAG: 0.02, ELASTICITY: 0.3 },
				hint: "blast the pile and watch it rain back down" },
			{ name: "space", desc: "no gravity, no air, bounces keep their speed", set: { GRAVITY: 0, DRAG: 0, ELASTICITY: 1 },
				hint: "whatever you start never stops" },
		],
		dial: { key: "GRAVITY", name: "gravity", ends: ["falls up", "falls down"] },
	},
	{
		q: "what colors?",
		where: "color",
		choices: [
			{ name: "mixed", desc: "eight colors, shuffled", set: { PARTICLE_SINGLE_COLOR: false }, hint: "the default" },
			{ name: "one color", desc: "all the same, you pick which", set: { PARTICLE_SINGLE_COLOR: true }, hint: "pick it below" },
		],
		dial: { key: "PARTICLE_COLOR", name: "particle color" },
	},
];

const matches = (s: Settings, c: Choice) =>
	(Object.keys(c.set) as SettingKey[]).every((k) => s[k] === c.set[k]);

function fmt(key: SettingKey, v: Settings[SettingKey]) {
	if (typeof v !== "number") return String(v);
	const step = RANGES[key].step ?? 1;
	return step >= 1 ? Math.round(v).toLocaleString() : Number.parseFloat(v.toFixed(2)).toString();
}

export class Tour {
	private el: HTMLElement;
	private at = 0;

	constructor(private system: ParticleSystem) {
		this.el = document.createElement("div");
		this.el.className = "particle-tour";
		this.el.hidden = true;
		// keep taps on the card from reaching the canvas
		for (const type of ["pointerdown", "touchstart", "mousedown"]) {
			this.el.addEventListener(type, (e) => e.stopPropagation());
		}
		mountOnBody(this.el);
	}

	get open() {
		return !this.el.hidden;
	}

	start() {
		this.at = 0;
		this.system.uiController.hideControlPanel();
		this.el.hidden = false;
		this.render();
	}

	close() {
		this.el.hidden = true;
		try {
			localStorage.setItem("zenInstructionsSeen", "true");
		} catch {
			// sandboxed iframe: nothing to persist
		}
	}

	private get settings() {
		return this.system.settingsManager.getAllSettings();
	}

	private apply(set: Partial<Settings>) {
		for (const k of Object.keys(set) as SettingKey[]) {
			this.system.settingsManager.updateSetting(k, set[k] as Settings[typeof k]);
		}
		this.system.uiController.updateUI(this.settings);
	}

	private render() {
		const step = STEPS[this.at];
		const s = this.settings;
		const last = this.at === STEPS.length - 1;
		const picked = step.choices.find((c) => matches(s, c));
		const { key, name, ends } = step.dial;
		const range = RANGES[key];
		const v = s[key];
		const dial = typeof v === "string"
			? `<input type="color" class="tour-input" value="${v}">`
			: `<input type="range" class="tour-input" min="${range.min}" max="${range.max}" step="${range.step}" value="${v}">`;

		this.el.innerHTML = `
			<div class="tour-top"><span>${this.at + 1} of ${STEPS.length}</span><span>lives under ⚙ › ${step.where}</span></div>
			<h2>${step.q}</h2>
			<div class="tour-choices" style="--n:${step.choices.length}">${step.choices.map((c, i) => `
				<button type="button" class="tour-choice" data-i="${i}" aria-pressed="${c === picked}"><b>${c.name}</b><small>${c.desc}</small></button>`).join("")}
			</div>
			<label class="tour-dial"><span class="tour-dial-top"><span>${name}</span><span class="tour-value">${fmt(key, v)}</span></span>
				${dial}
				${ends ? `<span class="tour-ends"><span>${ends[0]}</span><span>${ends[1]}</span></span>` : ""}</label>
			<p class="tour-hint">${(picked ?? step.choices[0]).hint}</p>
			${last ? `<p class="tour-hint">that's the tour. all of it, plus a few extras like shapes to flow around, lives under <b>⚙</b> in the corner.</p>` : ""}
			<div class="tour-nav">
				<button type="button" class="tour-skip">${last ? "" : "skip"}</button>
				<span class="tour-dots">${STEPS.map((_, i) => `<i class="${i === this.at ? "on" : ""}"></i>`).join("")}</span>
				<span class="tour-buttons">${this.at > 0 ? `<button type="button" class="tour-back">back</button>` : ""}
					<button type="button" class="tour-next">${last ? "done" : "next"}</button></span>
			</div>`;

		for (const b of this.el.querySelectorAll<HTMLElement>(".tour-choice")) {
			b.onclick = () => {
				this.apply(step.choices[Number(b.dataset.i)].set);
				this.render();
			};
		}
		const input = this.el.querySelector<HTMLInputElement>(".tour-input");
		const out = this.el.querySelector<HTMLElement>(".tour-value");
		if (input && out) {
			input.oninput = () => {
				const value = input.type === "color" ? input.value : Number.parseFloat(input.value);
				const set: Partial<Settings> = { [key]: value };
				if (key === "PARTICLE_COLOR") set.PARTICLE_SINGLE_COLOR = true;
				this.apply(set);
				out.textContent = fmt(key, value);
				// a dial moved off a preset: unpress it, without a re-render that
				// would drop the slider mid-drag
				const now = this.settings;
				for (const b of this.el.querySelectorAll<HTMLElement>(".tour-choice")) {
					b.setAttribute("aria-pressed", String(matches(now, step.choices[Number(b.dataset.i)])));
				}
			};
		}
		const on = (sel: string, fn: () => void) => {
			const b = this.el.querySelector<HTMLElement>(sel);
			if (b) b.onclick = fn;
		};
		on(".tour-skip", () => this.close());
		on(".tour-back", () => { this.at--; this.render(); });
		on(".tour-next", () => {
			if (last) this.close();
			else { this.at++; this.render(); }
		});
	}
}

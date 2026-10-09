// The live settings, mirrored to the URL query string so a link reproduces them.
import type { SettingKey, Settings } from "./config";
import { DEFAULT_SETTINGS, RANGES, SETTING_KEYS } from "./config";

function debounce(func: () => void, wait: number) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	return () => {
		clearTimeout(timeout);
		timeout = setTimeout(func, wait);
	};
}

// A query-string value parsed to the setting's type and clamped to its range;
// null if it doesn't parse.
function parseSetting(key: SettingKey, value: string): Settings[SettingKey] | null {
	const fallback = DEFAULT_SETTINGS[key];
	if (typeof fallback === "boolean") return value === "true";
	if (typeof fallback === "string") return value;
	let n = Number.parseFloat(value);
	if (Number.isNaN(n)) return null;
	const { min, max } = RANGES[key];
	if (min !== undefined) n = Math.max(min, n);
	if (max !== undefined) n = Math.min(max, n);
	return n;
}

// Round floats so links don't carry 0.30000000000000004.
function formatSetting(value: Settings[SettingKey]): string {
	return typeof value === "number" ? String(Number.parseFloat(value.toFixed(4))) : String(value);
}

export class SettingsManager {
	private settings: Settings = { ...DEFAULT_SETTINGS };
	private updateURLDebounced = debounce(() => this.updateURL(), 300);

	constructor(private onChange: (settings: Settings) => void) {
		this.loadFromURL();
	}

	private loadFromURL() {
		const params = new URLSearchParams(window.location.search);

		// Links from before the rename carry PARTICLE_SIZE
		const legacySize = params.get("PARTICLE_SIZE");
		if (legacySize !== null && !params.has("AVERAGE_PARTICLE_SIZE")) {
			params.delete("PARTICLE_SIZE");
			params.set("AVERAGE_PARTICLE_SIZE", legacySize);
			const url = `${window.location.pathname}?${params}`;
			window.history.replaceState({ path: url }, "", url);
		}

		for (const key of SETTING_KEYS) {
			const raw = params.get(key);
			if (raw === null) continue;
			const value = parseSetting(key, raw);
			if (value !== null) Object.assign(this.settings, { [key]: value });
		}

		// always notify, so the initial settings get applied
		this.onChange(this.settings);
	}

	getAllSettings(): Settings {
		return { ...this.settings };
	}

	updateSetting<K extends SettingKey>(key: K, value: Settings[K]) {
		if (this.settings[key] === value) return;
		const { min, max } = RANGES[key];
		if (typeof value === "number") {
			let n: number = value;
			if (min !== undefined && n < min) n = min;
			if (max !== undefined && n > max) n = max;
			value = n as Settings[K];
		}
		this.settings[key] = value;
		this.onChange(this.settings);
		this.updateURLDebounced();
	}

	resetToDefaults() {
		this.settings = { ...DEFAULT_SETTINGS };
		this.onChange(this.settings);
		this.updateURL();
	}

	// Only settings that differ from the defaults, to keep the URL short.
	private updateURL() {
		const params = new URLSearchParams();
		for (const key of SETTING_KEYS) {
			if (this.settings[key] !== DEFAULT_SETTINGS[key]) params.set(key, formatSetting(this.settings[key]));
		}
		const query = params.toString();
		const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
		window.history.replaceState({ path: url }, "", url);
	}

	// Every setting, so the link pins the look even if the defaults change.
	generateShareLink(): string {
		const params = new URLSearchParams();
		for (const key of SETTING_KEYS) params.set(key, formatSetting(this.settings[key]));
		return `${window.location.origin}${window.location.pathname}?${params}`;
	}
}

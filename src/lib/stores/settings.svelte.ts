import { browser } from '$app/environment';

const STORAGE_KEY = 'cpp-quant-settings-v1';

export type GeminiModel =
	| 'gemini-3.1-flash-lite'
	| 'gemini-3-flash-preview'
	| 'gemini-3.1-pro-preview';

export const GEMINI_MODELS: { id: GeminiModel; label: string; hint: string }[] = [
	{
		id: 'gemini-3-flash-preview',
		label: '3 Flash Preview',
		hint: 'Default. Frontier intelligence built for speed. $0.50 in / $3.00 out per 1M.'
	},
	{
		id: 'gemini-3.1-flash-lite',
		label: '3.1 Flash Lite',
		hint: 'Cheapest. Best for high-volume drilling. $0.25 in / $1.50 out per 1M.'
	},
	{
		id: 'gemini-3.1-pro-preview',
		label: '3.1 Pro Preview',
		hint: 'SOTA reasoning + coding. Slowest + costliest. $2.00 in / $12.00 out per 1M.'
	}
];

interface Settings {
	version: 1;
	geminiApiKey: string;
	geminiModel: GeminiModel;
}

function defaults(): Settings {
	return { version: 1, geminiApiKey: '', geminiModel: 'gemini-3-flash-preview' };
}

function load(): Settings {
	if (!browser) return defaults();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaults();
		const parsed = JSON.parse(raw) as Settings;
		if (parsed.version !== 1) return defaults();
		const merged = { ...defaults(), ...parsed };
		// Drop any stale model id (e.g. an older "gemini-2.5-*" saved before the model list changed).
		const valid = GEMINI_MODELS.some((m) => m.id === merged.geminiModel);
		if (!valid) merged.geminiModel = defaults().geminiModel;
		return merged;
	} catch {
		return defaults();
	}
}

class SettingsStore {
	state = $state<Settings>(defaults());

	constructor() {
		if (browser) this.state = load();
	}

	#persist() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
		} catch {
			// quota — ignore
		}
	}

	get hasKey(): boolean {
		return this.state.geminiApiKey.trim().length > 0;
	}

	setKey(key: string) {
		this.state.geminiApiKey = key.trim();
		this.#persist();
	}

	setModel(model: GeminiModel) {
		this.state.geminiModel = model;
		this.#persist();
	}

	clearKey() {
		this.state.geminiApiKey = '';
		this.#persist();
	}
}

export const settings = new SettingsStore();

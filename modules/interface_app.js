import version from '../version.js';
import about   from '../config/about.js';

export default class InterfaceApp {
	static #searchMinDuration = 1000;

	#audio;
	#aboutUpdate;
	#defaultPreferences;
	#registration    = null;
	#updateRequested = false;

	constructor({ config, audio }) {
		this.#audio              = audio;
		this.#defaultPreferences = config.defaultPreferences;
		const { selectors }      = config;

		const preferencesForm = document.querySelector(selectors.preferencesForm);
		this.#aboutUpdate     = document.querySelector(selectors.aboutUpdate);

		Object.assign(document.querySelector(selectors.aboutContactLink), {
			href:        `mailto:${about.email}`,
			textContent: about.email,
		});
		document.querySelector(selectors.aboutVersionText).textContent = version;
		document.querySelector(selectors.aboutDialog).addEventListener('command', (event) => this.#aboutCommands(event));

		const saved = JSON.parse(localStorage.preferences ?? '{}');
		for (const [name, value] of Object.entries(this.#defaultPreferences)) {
			preferencesForm.elements[name].value = saved[name] ?? value;
			preferencesForm.elements[name].value ||= value;
		}
		this.#savePreferences(preferencesForm);
		preferencesForm.addEventListener('change', () => this.#savePreferences(preferencesForm));
		this.#registerServiceWorker().catch(reportError);
	}

	async #registerServiceWorker() {
		if (!navigator.serviceWorker) return;
		const hadController = Boolean(navigator.serviceWorker.controller);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (hadController || this.#updateRequested) location.reload();
		});
		this.#registration = await navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' });
	}

	get #hasUpdate() {
		return Boolean(this.#registration?.waiting && this.#registration.active);
	}

	async #findUpdate() {
		if (this.#hasUpdate || !navigator.onLine) {
			this.#updateState = this.#hasUpdate ? 'available' : null;
			return;
		}
		this.#updateState = 'search';
		const wait = new Promise(resolve => setTimeout(resolve, InterfaceApp.#searchMinDuration));
		const [found] = await Promise.all([this.#requestUpdate(), wait]);
		this.#updateState = found ? 'available' : found === false ? 'none' : null;
	}

	async #requestUpdate() {
		if (!this.#registration) return false;
		try {
			await this.#registration.update();
			const { installing } = this.#registration;
			if (installing) await new Promise(resolve => installing.addEventListener('statechange', resolve, { once: true }));
			return this.#hasUpdate;
		}
		catch {
			return null;
		}
	}

	#installUpdate() {
		this.#updateRequested = true;
		document.body.inert   = true;
		const waiting = this.#registration?.waiting;
		if (waiting) waiting.postMessage({ action: 'skipWaiting' });
		else location.reload();
	}

	get #updateState() {
		return this.#aboutUpdate.dataset.state;
	}

	set #updateState(state) {
		if (state) this.#aboutUpdate.dataset.state = state;
		else delete this.#aboutUpdate.dataset.state;
	}

	#aboutCommands(event) {
		const commands = {
			'show-modal': () => this.#findUpdate(),
			'update':     () => this.#installUpdate(),
		};
		commands[event.source?.value || event.command]?.();
	}

	#savePreferences(form) {
		const values  = {};
		const changed = {};
		for (const [name, initial] of Object.entries(this.#defaultPreferences)) {
			const { value } = form.elements[name];
			values[name] = typeof initial === 'number' ? Number(value) : value;
			if (values[name] !== initial) changed[name] = values[name];
		}
		if (Object.keys(changed).length) localStorage.preferences = JSON.stringify(changed);
		else delete localStorage.preferences;
		this.#audio.setPreferences(values);
	}
}

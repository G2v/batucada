import version from '../version.js';
import about   from '../config/about.js';

export default class InterfaceApp {
	static #searchMinDuration = 1000;

	#audio;
	#swClient;
	#aboutUpdate;
	#defaultPreferences;

	constructor({ config, audio, swClient }) {
		this.#audio              = audio;
		this.#swClient           = swClient;
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
		swClient.addEventListener('update',        () => this.#updateState = 'available');
	}

	async #findUpdate() {
		if (this.#updateState === 'available') return;
		if (!navigator.onLine) {
			this.#updateState = null;
			this.#updateState = await this.#requestUpdate() ? 'available' : null;
			return;
		}
		this.#updateState = 'search';
		const wait = new Promise(resolve => setTimeout(resolve, InterfaceApp.#searchMinDuration));
		const [found] = await Promise.all([this.#requestUpdate(), wait]);
		this.#updateState = found ? 'available' : found === false ? 'none' : null;
	}

	#requestUpdate() {
		return this.#swClient.findUpdate().catch(() => null);
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
			'update':     () => {
				document.body.inert = true;
				this.#swClient.install();
			},
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

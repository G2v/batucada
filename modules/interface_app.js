import version    from '../version.js';
import app_config from '../config/app.js';

export default class InterfaceApp {
	static #searchMinDuration = 1000;

	#bus;
	#events;
	#aboutUpdate;
	#defaultPreferences;

	constructor({ bus, config }) {
		this.#bus                = bus;
		this.#events             = config.events;
		this.#defaultPreferences = config.defaultPreferences;
		const { selectors }      = config;

		const preferencesForm = document.querySelector(selectors.preferencesForm);
		this.#aboutUpdate     = document.querySelector(selectors.aboutUpdate);

		Object.assign(document.querySelector(selectors.aboutContactLink), {
			href:        `mailto:${app_config.email}`,
			textContent: app_config.email,
		});
		document.querySelector(selectors.aboutVersionText).textContent = version;
		document.querySelector(selectors.aboutDialog).addEventListener('command', (event) => this.#aboutCommands(event));

		const stored = JSON.parse(localStorage.preferences ?? '{}');
		for (const [name, value] of Object.entries(this.#defaultPreferences)) preferencesForm.elements[name].value = stored[name] ?? value;
		preferencesForm.addEventListener('change', () => this.#savePreferences(preferencesForm));

	}

	showUpdateButton() {
		this.#updateState = 'available';
	}

	async #findUpdate() {
		if (this.#updateState === 'available') return;
		if (!navigator.onLine) {
			this.#updateState = null;
			this.#updateState = await this.#requestUpdate() ? 'available' : null;
			return;
		}
		this.#updateState = 'search';
		const [found] = await Promise.all([this.#requestUpdate(), InterfaceApp.#wait(InterfaceApp.#searchMinDuration)]);
		this.#updateState = found ? 'available' : found === false ? 'none' : null;
	}


	#requestUpdate() {
		const { promise, resolve, reject } = Promise.withResolvers();
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceFindUpdate, { detail: { resolve, reject } }));
		return promise.catch(() => null);
	}

	get #updateState() {
		return this.#aboutUpdate.dataset.state;
	}

	set #updateState(state) {
		if (state) this.#aboutUpdate.dataset.state = state;
		else delete this.#aboutUpdate.dataset.state;
	}

	static #wait(duration) {
		return new Promise(resolve => setTimeout(resolve, duration));
	}

	#aboutCommands(event) {
		const commands = {
			'show-modal': () => this.#findUpdate(),
			'update':     () => {
				document.body.inert = true;
				this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceInstall));
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
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfacePreferences, { detail: values }));
	}

}
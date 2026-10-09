import version    from '../version.js';
import app_config from '../config/app.js';

export default class InterfaceApp {
	#bus;
	#events;
	#aboutUpdateButton;
	#defaultPreferences;

	constructor({ bus, config }) {
		this.#bus                = bus;
		this.#events             = config.events;
		this.#defaultPreferences = config.defaultPreferences;
		const { selectors }      = config;

		const preferencesForm   = document.querySelector(selectors.preferencesForm);
		this.#aboutUpdateButton = document.querySelector(selectors.aboutUpdateButton);

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
		this.#aboutUpdateButton.hidden = false;
	}

	#aboutCommands(event) {
		const commands = {
			'show-modal': () => this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceFindUpdate)),
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

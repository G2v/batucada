import version from '../version.js';

export default class InterfaceApp {
	#bus;
	#events;
	#aboutDialog;
	#aboutUpdateButton;

	constructor({ bus, config }) {
		this.#bus = bus;
		this.#events = config.events;

		const { selectors } = config;

		this.#aboutDialog       = document.querySelector(selectors.aboutDialog);
		this.#aboutUpdateButton = document.querySelector(selectors.aboutUpdateButton);

		Object.assign(document.querySelector(selectors.aboutContactLink), {
			href:        `mailto:${config.email}`,
			textContent: config.email,
		});
		document.querySelector(selectors.aboutVersionText).textContent = version;

		this.#aboutDialog.addEventListener('command', (event) => this.#aboutCommands(event));
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
}

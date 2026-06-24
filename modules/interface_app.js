import version from '../version.js';

export default class InterfaceApp {
	#ui;
	#bus;
	#about        = document.querySelector('#about');
	#contact      = this.#about.querySelector('#contact');
	#updateButton = this.#about.querySelector('[value="update"]');
	#version      = this.#about.querySelector('#version');

	constructor({ bus, parent }) {
		this.#bus = bus;
		this.#ui = parent;
		this.#contact.href = `mailto:${parent.config.email}`;
		this.#contact.textContent = parent.config.email;
		this.#version.textContent = version;
		this.#about.addEventListener('command', (event) => this.#aboutCommands(event));
	}

	showUpdateButton() {
		this.#updateButton.hidden = false;
	}

	#aboutCommands(event) {
		const commands = {
			'show-modal': () => this.#bus.dispatchEvent(new CustomEvent('interface:findUpdate')),
			'update':     () => {
				document.body.inert = true;
				this.#bus.dispatchEvent(new CustomEvent('interface:install'));
			},
		};
		commands[event.source?.value || event.command]?.();
	}
}
import versions from '../versions.js';

export default class InterfaceApp {
	#ui;
	#bus;
	#contact =            document.querySelector('#contact');
	#dataDate =           document.querySelector('#app time');
	#appDialog =          document.querySelector('#app');
	#importButton =       document.querySelector('#import');
	#exportButton =       document.querySelector('#export');
	#updateButton =       document.querySelector('#update');
	#applicationVersion = document.querySelector('#applicationVersion');
	#instrumentsVersion = document.querySelector('#instrumentsVersion');
	#appDetails         = this.#appDialog.querySelectorAll('details');

	constructor({ bus, parent }) {
		this.#bus = bus;
		this.#ui = parent;
		this.#contact.textContent = parent.config.email;
		this.#contact.href = `mailto:${parent.config.email}`;
		this.#appDialog.addEventListener('command', (event) => this.#openAppDialog(event));
		this.#importButton.addEventListener('click', (event) => this.#importPresets(event));
		this.#exportButton.addEventListener('click', () => this.#exportPresets());
		this.#updateButton.addEventListener('click', () => this.#updateApp());
		this.#applicationVersion.textContent = versions.app;
		this.#instrumentsVersion.textContent = versions.static;
		this.#dataDate.textContent = this.#getDate();
	}

	showUpdateButton() {
		this.#updateButton.hidden = false;
	}

	#openAppDialog({ command }) {
		if (command !== 'show-modal') return
		this.#appDetails.forEach(details => details.open = false);
		this.#dataDate.textContent = this.#getDate();
		this.#bus.dispatchEvent(new CustomEvent('interface:findUpdate'));
	}

	#importPresets(event) {
		this.#appDialog.close();
		this.#ui.presetsImport(event.target.dataset);
	}

	#exportPresets() {
		this.#appDialog.close();
		this.#ui.presetsExport();
	}

	#updateApp() {
		this.#appDialog.close();
		document.body.inert = true;
		this.#bus.dispatchEvent(new CustomEvent('interface:install'));
	}

	#getDate() {
		return this.#ui.presetsDate?.toLocaleString('fr-FR', { hour12: false }) ?? this.#dataDate.textContent;
	}

}
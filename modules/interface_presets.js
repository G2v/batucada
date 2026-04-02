export default class InterfacePresets {
	#ui;
	#bus;
	#cancelAction =   false;
	#toast =          document.querySelector('#toast');
	#settings =       document.querySelector('#presets-settings');
	#presetName =     document.querySelector('#presets-settings h2');
	#toastMessage =   document.querySelector('#toast p');
	#shareButton =    document.querySelector('#share');
	#cancelButton =   document.querySelector('#toast button');
	#presetsButton =  document.querySelector('button.presets');
	#saveButtons    = this.#settings.querySelectorAll('button[name="save"]');

	constructor({ bus, parent }) {
		this.#bus = bus
		this.#ui = parent;

		this.#toast.        addEventListener('animationend', (event) => this.#toast.hidePopover());
		this.#settings.     addEventListener('submit',       (event) => this.#saveSettings(event));
		this.#settings.     addEventListener('command',      (event) => this.#openSettings(event));
		this.#ui.presets.   addEventListener('change',       (event) => this.#presetSelected(event));
		this.#shareButton.  addEventListener('click',        (event) => this.#sharePreset(event));
		this.#cancelButton. addEventListener('click',        (event) => this.#cancelSettings(event));
		this.#presetsButton.addEventListener('click',        (event) => this.#showToast(event));
		this.#toastPositioning();
	}

	// Chargement conditionnel du polyfill toast_positioning
	async #toastPositioning() {
		if (!CSS.supports('inset', 'anchor-size(height)')) {
			const { applyPolyfill } = await import('./polyfills/anchor-positioning.js');
			applyPolyfill(this.#toast, this.#ui.container);
		}
	}

	#presetSelected(event) {
		this.#bus.dispatchEvent(
			new CustomEvent('interface:presetSelected', { detail: event.target.selectedIndex })
		);
	}

	#openSettings({ command }) {
		if (command !=='show-modal' ) return;
		const title = this.#ui.title.textContent.trim();
		const exists = Array.from(this.#ui.presets.options).some(option => option.text === title);
		const hasSelection = this.#ui.presets.selectedIndex !== -1;

		const formsValues = [
			{ id: 'newOne', name: exists ? '' : title, hidden: hasSelection },
			{ id: 'modify', name: title,               hidden: hasSelection || !exists },
			{ id: 'rename', name: title,               hidden: !hasSelection },
			{ id: 'delete', name: title,               hidden: !hasSelection },
		];

		for (const { id, name: value, hidden } of formsValues) {
			const form = document.forms[id];
			const { name, save } = form.elements;
			form.hidden = hidden;
			name.value = value;
			name.setCustomValidity('');
			save.disabled = false;
		}

		this.#presetName.textContent = title || this.#ui.untitled;
	}

	async #cancelSettings() {
		this.#toast.hidePopover();
		let message;

		try {
			await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:settingsCancel', {
					detail: { resolve, reject }
				}));
			});
			message = this.#cancelAction.success;
		}
		catch {
			message = this.#cancelAction.failure;
		}

		this.#cancelAction = false;
		if (message) this.#showToast(message);
	}

	async #saveSettings(event) {
		event.preventDefault();
		this.#saveButtons.forEach(button => button.disabled = true);

		const {
			target: { id: action, elements }, 
			submitter: button 
		} = event;
		const messages = button.dataset;

		try {
			const name = elements['name']?.value.trim() || '';
			const request = await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:settingsSave', { 
					detail: { action, name, promise: { resolve, reject } }
				}));
			});
			if (request === false) {
				this.#saveButtons.forEach(button => button.disabled = false);
				return;
			}
			this.#settings.close();
			await request.result;
			this.#cancelAction = { success: messages.cancelSuccess, failure: messages.cancelFailure };
			this.#showToast(messages.success);
		} 
		catch {
			this.#settings.close();
			this.#showToast(messages.failure);
		}
	}

	reportNameValidity({ action, status }) {
		const input = document.forms[action]?.elements['name'];
		const datasetNames = { empty: 'invalidEmpty', duplicated: 'invalidDuplicated' };
		const validityMessage = input.dataset[datasetNames[status]];
		input.setCustomValidity(validityMessage);
		input.reportValidity();
		input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
	}

	async #sharePreset(event) {
		this.#settings.close();
		try {
			await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:share', {
					detail: { promise: { resolve, reject } }
				}));
			});
		}
		catch {
			this.#showToast(event.target.dataset.failure);
		}
	}

	presetsExport() {
		let presets = '';
		let datePart = '';
		this.#bus.dispatchEvent(new CustomEvent('interface:export', { detail: (data) => presets = data }));
		const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
		const url  = URL.createObjectURL(blob);
		const link = document.createElement('a');
		if (this.#ui.presetsDate) {
			const timezoneOffset = this.#ui.presetsDate.getTimezoneOffset() * 60000;
			const localDate = new Date(this.#ui.presetsDate.getTime() - timezoneOffset);
			datePart = `_${localDate.toISOString().split('.')[0]}`;
		}
		link.download = `presets${datePart}.json`;
		link.href = url;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	async presetsImport(messages) {
		try {
			const content = await this.#getFileContent();
			const data = JSON.parse(content);
			if (!data || typeof data !== 'object') throw new Error();
			const number = await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:import', {
					detail: { data, promise: { resolve, reject } }
				}));
			});
			const templates = {
				0: messages.successZero,
				1: messages.successOne
			};
			const message = templates[number] ?? messages.successOther.replace('{{number}}', number);
			this.#cancelAction = number ? { success: messages.cancelSuccess, failure: messages.cancelFailure } : null;
			this.#showToast(message);
		} catch {
			this.#showToast(messages.failure);
		}
	}

	#getFileContent() {
		return new Promise((resolve, reject) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json';
			input.onchange = async (e) => {
				const file = e.target.files[0];
				if (!file) return reject(new Error());
				try {
					resolve(await file.text());
				} catch {
					reject(new Error());
				}
			};
			input.click();
		});
	}

	#showToast(payload) {
		const isEvent = payload instanceof Event;
		const message = isEvent ? payload.currentTarget.dataset.message : payload;
		this.#toastMessage.textContent = message;
		this.#cancelButton.hidden = isEvent || !this.#cancelAction;
		this.#toast.showPopover();
	}
}
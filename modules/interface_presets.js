export default class InterfacePresets {
	#ui;
	#bus;
	#cancelAction  =   false;
	#toast         = document.querySelector('#toast');
	#settings      = document.querySelector('#presets-settings');
	#formElements  = this.#settings.querySelector('form').elements;
	#toastMessage  = this.#toast.querySelector('p');
	#cancelButton  = this.#toast.querySelector('button');
	#presetsButton = document.querySelector('button.presets');

	constructor({ bus, parent }) {
		this.#bus = bus
		this.#ui = parent;

		this.#toast.        addEventListener('toggle',       (event) => this.#hideToast(event));
		this.#toast.        addEventListener('animationend', (event) => this.#toast.hidePopover());
		this.#settings.     addEventListener('submit',       (event) => this.#saveSettings(event));
		this.#settings.     addEventListener('command',      (event) => this.#openSettings(event));
		this.#ui.presets.   addEventListener('change',       (event) => this.#presetSelected(event));
		this.#cancelButton. addEventListener('click',        (event) => this.#cancelSettings(event));
		this.#presetsButton.addEventListener('click',        (event) => this.#showToast(event.currentTarget.dataset.message));
		this.#toastPositioning();
	}

	// Chargement conditionnel du polyfill toast_positioning
	async #toastPositioning() {
		if (!CSS.supports('position-area', 'bottom')) {
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
		this.#formElements.name.value = title;
		this.#formElements.name.setCustomValidity('');
		this.#formElements.rename.disabled = !exists;
		this.#formElements.delete.disabled = !exists;
	}

	async #cancelSettings() {
		let message;
		const { success, failure } = this.#cancelAction;
		this.#toast.hidePopover();
		try {
			await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:settingsCancel', {
					detail: { resolve, reject }
				}));
			});
			message = success;
		}
		catch {
			message = failure;
		}
		if (message) this.#showToast(message);
	}

	async #saveSettings(event) {
		const { dataset: messages, name: action } = event.submitter;
		const actionButtons = document.querySelectorAll('button:not(:disabled)');
		try {
			if (action === 'share') {
				this.#settings.close();
				await new Promise((resolve, reject) => {
					this.#bus.dispatchEvent(new CustomEvent('interface:share', {
						detail: { promise: { resolve, reject } }
					}));
				});
			}
			else {
				event.preventDefault();
				actionButtons.forEach(button => button.disabled = true);
				const name = this.#formElements.name.value.trim() || '';
				const request = await new Promise((resolve, reject) => {
					this.#bus.dispatchEvent(new CustomEvent('interface:settingsSave', { 
						detail: { action, name, promise: { resolve, reject } }
					}));
				});
				if (request === false) return;
				this.#settings.close();
				await request.result;
				this.#cancelAction = { success: messages.cancelSuccess, failure: messages.cancelFailure };
				this.#showToast(messages.success);
			}
		} 
		catch {
			if (this.#settings.open) this.#settings.close();
			this.#showToast(messages.failure);
		}
		finally {
			actionButtons.forEach(button => button.disabled = false);
		}
	}

	reportNameValidity(status) {
		const input = this.#formElements.name;
		const datasetNames = { empty: 'invalidEmpty', duplicated: 'invalidDuplicated' };
		const validityMessage = input.dataset[datasetNames[status]];
		input.setCustomValidity(validityMessage);
		input.reportValidity();
		input.addEventListener('input',    () => input.setCustomValidity(''), { once: true });
		input.addEventListener('focusout', () => input.setCustomValidity(''), { once: true });
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
			this.#cancelAction = number ? { success: messages.cancelSuccess, failure: messages.cancelFailure } : false;
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

	#showToast(message) {
		this.#toastMessage.textContent = message;
		this.#cancelButton.hidden = !this.#cancelAction;
		this.#toast.showPopover();
	}

	#hideToast({ newState }) {
		if (newState === 'closed') {
			this.#cancelAction = false;
		}
	}

}

import { downloadFile, getFileContent } from './utils.js';

export default class InterfacePresets {
	#ui;
	#bus;
	#edit           = document.querySelector('#preset-edit');
	#presetsDialog  = document.querySelector('#presets');
	#confirmDialog  = document.querySelector('#presets-delete');
	#editForm       = this.#edit.querySelector('form');
	#dataDate       = this.#presetsDialog.querySelector('time');

	constructor({ bus, parent }) {
		this.#bus = bus
		this.#ui = parent;

		this.#edit.         addEventListener('submit',  (event) => this.#saveEdit(event));
		this.#edit.         addEventListener('command', (event) => this.#openEdit(event));
		this.#ui.presets.   addEventListener('change',  (event) => this.#presetSelected(event));
		this.#presetsDialog.addEventListener('command', (event) => this.#presetsDialogCommands(event));
		this.#confirmDialog.addEventListener('command', (event) => this.#confirmDialogCommands(event));
	}

	#presetSelected(event) {
		this.#bus.dispatchEvent(
			new CustomEvent('interface:presetSelected', { detail: event.target.selectedIndex })
		);
	}

	#presetsDialogCommands(event) {
		const commands = {
			'show-modal': () => this.#updatePresetsDate(),
			'--import':   () => this.#presetsImport(event.source.dataset),
			'--export':   () => this.#presetsExport(),
		};
		commands[event.command]?.();
	}

	#confirmDialogCommands(event) {
		if (event.source.value === 'delete') {
			new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:presetsDelete', {
					detail: { resolve, reject }
				}));
			}).catch(() => this.#ui.dialogs.showToast(event.source.dataset.failure));
		}
	}

	#openEdit({ command }) {
		if (command !=='show-modal' ) return;
		const title = this.#ui.title.textContent.trim();
		const exists = Array.from(this.#ui.presets.options).some(option => option.text === title);
		this.#editForm.elements.name.value = title;
		this.#editForm.elements.name.setCustomValidity('');
		this.#editForm.elements.rename.disabled = !exists;
		this.#editForm.elements.delete.disabled = !exists;
	}

	#cancelEdit(messages) {
		return {
			action: () => new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:editCancel', {
					detail: { resolve, reject }
				}));
			}),
			success: messages.cancelSuccess,
			failure: messages.cancelFailure,
		};
	}

	async #saveEdit(event) {
		const { dataset: messages, name: action } = event.submitter;
		const actionButtons = this.#editForm.querySelectorAll('button:not(:disabled)');
		try {
			if (action === 'share') {
				this.#edit.close();
				const url = new URL(location.origin + location.pathname);
				this.#bus.dispatchEvent(new CustomEvent('interface:share', { detail: { url } }));
				if (navigator.share) {
					try { await navigator.share({ url: url.toString() }); } catch {}
				} else {
					await navigator.clipboard.writeText(url.toString());
					this.#ui.dialogs.showToast(messages.failure);
				}
				return;
			}
			event.preventDefault();
			const isNewName = ['save', 'rename'].includes(action);
			const rawName = this.#editForm.elements.name.value;
			const name = rawName.replace(/[\s\p{Z}\u200B-\u200D\uFEFF]+/gu, ' ').trim();
			if (isNewName && !name) return this.reportNameValidity('empty');
			actionButtons.forEach(button => button.disabled = true);
			const request = await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:editSave', { 
					detail: { action, name, promise: { resolve, reject } }
				}));
			});
			if (request === false) return;
			this.#edit.close();
			await request.result;
			this.#ui.dialogs.showToast(messages.success, this.#cancelEdit(messages));
		} 
		catch {
			if (this.#edit.open) this.#edit.close();
			this.#ui.dialogs.showToast(messages.failure);
		}
		finally {
			actionButtons.forEach(button => button.disabled = false);
		}
	}

	reportNameValidity(status) {
		const input = this.#editForm.elements.name;
		const datasetNames = { empty: 'invalidEmpty', duplicated: 'invalidDuplicated' };
		const validityMessage = input.dataset[datasetNames[status]];
		input.setCustomValidity(validityMessage);
		input.reportValidity();
		input.addEventListener('input',    () => input.setCustomValidity(''), { once: true });
		input.addEventListener('focusout', () => input.setCustomValidity(''), { once: true });
	}

	#updatePresetsDate() {
		this.#dataDate.textContent = this.#ui.presetsDate?.toLocaleString('fr-FR', { 
			hour12: false 
		}) ?? '';
	}

	async #presetsExport() {
		const presets = [];
		this.#bus.dispatchEvent(new CustomEvent('interface:export', { detail: presets }));
		const content = JSON.stringify(presets, null, 2);

		let dateSuffix = '';
		if (this.#ui.presetsDate) {
			const localDate = new Date(this.#ui.presetsDate.getTime() - this.#ui.presetsDate.getTimezoneOffset() * 60000);
			dateSuffix += `_${localDate.toISOString().split('.')[0]}`;
		}
		const filename = `presets${dateSuffix}.json`;
		if (await downloadFile(filename, content)) this.#presetsDialog.close();
	}

	async #presetsImport(messages) {
		try {
			const content = await getFileContent();
			this.#presetsDialog.close();
			const data = JSON.parse(content);
			if (!data || typeof data !== 'object') throw new Error();
			const number = await new Promise((resolve, reject) => {
				this.#bus.dispatchEvent(new CustomEvent('interface:import', {
					detail: { data, promise: { resolve, reject } }
				}));
			});
			const message = number === 0 ? messages.successZero
				: number === 1 ? messages.successOne
				: messages.successOther.replace('{{number}}', number);
			this.#ui.dialogs.showToast(message, number ? this.#cancelEdit(messages) : null);
		} catch (error) {
			if (error.name === 'AbortError') return;
			this.#ui.dialogs.showToast(messages.failure);
		}
	}

}
import { downloadFile, getFileContent } from './utils.js';

export default class InterfacePresets {
	static #newNameActions   = Object.freeze(['save', 'rename']);
	static #enabledButtons   = 'button:not(:disabled)';
	static #validityMessages = Object.freeze({
		empty:      'invalidEmpty',
		duplicated: 'invalidDuplicated',
	});

	#ui;
	#bus;
	#events;
	#presetsDialog;
	#presetEditDialog;
	#presetEditForm;
	#presetEditButton;
	#appMenuButton;

	constructor({ bus, parent, config }) {
		this.#bus = bus;
		this.#events = config.events;
		this.#ui  = parent;

		const { selectors } = config;

		this.#presetEditDialog = document.querySelector(selectors.presetEditDialog);
		this.#presetEditForm   = document.querySelector(selectors.presetEditForm);
		this.#presetEditButton = document.querySelector(selectors.presetEditButton);
		this.#presetsDialog    = document.querySelector(selectors.presetsDialog);
		this.#appMenuButton    = document.querySelector(selectors.appMenuButton);

		this.#presetsDialog.addEventListener('command',                                  (event) => this.#presetsDialogCommands(event));
		this.#presetEditDialog.addEventListener('submit',                                (event) => this.#saveEdit(event));
		this.#presetEditDialog.addEventListener('command',                               (event) => this.#openEdit(event));
		this.#ui.presetsSelect.addEventListener('change',                                (event) => this.#presetSelected(event));
		document.querySelector(selectors.presetDeleteDialog).addEventListener('command', (event) => this.#confirmDialogCommands(event));
	}

	#presetSelected(event) {
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfacePresetSelected, { detail: event.target.selectedIndex }));
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
		if (event.source.value !== 'delete') return;
		const { promise, resolve, reject } = Promise.withResolvers();
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfacePresetsDelete, { detail: { resolve, reject } }));
		promise.catch(() => this.#ui.dialogs.showToast(event.source.dataset.failure));
	}


	#openEdit({ command }) {
		if (command !== 'show-modal') return;
		const title = this.#ui.sequenceTitle.textContent.trim();
		const unsaved = this.#ui.presetsSelect.selectedIndex === -1;
		this.#presetEditForm.elements.name.value = title;
		this.#presetEditForm.elements.name.setCustomValidity('');
		this.#presetEditForm.elements.rename.disabled = unsaved;
		this.#presetEditForm.elements.delete.disabled = unsaved;
	}

	#cancelEdit(messages, invoker = null) {
		return {
			action: () => {
				const { promise, resolve, reject } = Promise.withResolvers();
				this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceEditCancel, { detail: { resolve, reject } }));
				return promise;
			},
			success: messages.cancelSuccess,
			failure: messages.cancelFailure,
			invoker,
		};
	}

	async #saveEdit(event) {
		const { dataset: messages, name: action } = event.submitter;
		const actionButtons = this.#presetEditForm.querySelectorAll(InterfacePresets.#enabledButtons);
		try {
			if (action === 'share') {
				this.#presetEditDialog.close();
				const url = new URL(location.origin + location.pathname);
				this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceShare, { detail: { url } }));
				if (navigator.share) {
					try { await navigator.share({ url: url.toString() }); } catch {}
				} else {
					await navigator.clipboard.writeText(url.toString());
					this.#ui.dialogs.showToast(messages.failure);
				}
				return;
			}
			event.preventDefault();
			const isNewName = InterfacePresets.#newNameActions.includes(action);
			const rawName = this.#presetEditForm.elements.name.value;
			const name = rawName.replace(/[\s\p{Z}\u200B-\u200D\uFEFF]+/gu, ' ').trim();
			if (isNewName && !name) return this.reportNameValidity('empty');
			actionButtons.forEach(button => button.disabled = true);
			const saved = Promise.withResolvers();
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceEditSave, { detail: { action, name, promise: saved } }));
			const request = await saved.promise;
			if (request === false) return;
			this.#presetEditDialog.close();
			await request.result;
			const cancel = this.#cancelEdit(messages, this.#presetEditButton);
			this.#ui.dialogs.showToast(messages.success, cancel);
		}
		catch {
			if (this.#presetEditDialog.open) this.#presetEditDialog.close();
			this.#ui.dialogs.showToast(messages.failure);
		}
		finally {
			actionButtons.forEach(button => button.disabled = false);
		}
	}

	reportNameValidity(status) {
		const input = this.#presetEditForm.elements.name;
		const validityMessage = input.dataset[InterfacePresets.#validityMessages[status]];
		input.setCustomValidity(validityMessage);
		input.reportValidity();
		input.addEventListener('input',    () => input.setCustomValidity(''), { once: true });
		input.addEventListener('focusout', () => input.setCustomValidity(''), { once: true });
	}

	#updatePresetsDate() {
		const time = this.#ui.presetsDate;
		time.textContent = time.dateTime
			? new Date(time.dateTime).toLocaleString('fr-FR', { hour12: false })
			: '';
	}

	async #presetsExport() {
		const presets = [];
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceExport, { detail: presets }));
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
			const imported = Promise.withResolvers();
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceImport, { detail: { data, promise: imported } }));
			const number = await imported.promise;
			const message = number === 0 ? messages.successZero
				: number === 1 ? messages.successOne
				: messages.successOther.replace('{{number}}', number);
			const cancel = number ? this.#cancelEdit(messages, this.#appMenuButton) : null;
			this.#ui.dialogs.showToast(message, cancel);
		} catch (error) {
			if (error.name === 'AbortError') return;
			this.#ui.dialogs.showToast(messages.failure);
		}
	}
}

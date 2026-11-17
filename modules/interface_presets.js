import { downloadFile, getFileContent, normalizeName } from './utils.js';

export default class InterfacePresets {
	static #enabledButtons   = 'button:not(:disabled)';
	static #validityMessages = Object.freeze({
		empty:      'invalidEmpty',
		duplicated: 'invalidDuplicated',
	});

	#ui;
	#store;
	#presets;
	#navigation;
	#shareParams;
	#presetsDialog;
	#presetEditDialog;
	#presetEditForm;
	#presetEditButton;
	#appMenuButton;

	constructor({ parent, config, store, presets, navigation }) {
		this.#ui          = parent;
		this.#store       = store;
		this.#presets     = presets;
		this.#navigation  = navigation;
		this.#shareParams = [config.setSearchParam, config.volumeSearchParam, config.tempoSearchParam, config.titleSearchParam];

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
		this.#navigation.openPreset(event.target.selectedIndex);
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
		this.#presets.deleteAll().catch(() => this.#ui.dialogs.showToast(event.source.dataset.failure));
	}

	#openEdit({ command }) {
		if (command !== 'show-modal') return;
		const { elements } = this.#presetEditForm;
		const title = normalizeName(this.#store.state.title);
		const known = this.#presets.has(title);
		elements.name.value = title;
		elements.name.setCustomValidity('');
		elements.copy.hidden   = !known;
		elements.delete.hidden = !known;
	}

	#cancelEdit(messages, invoker = null) {
		return {
			action:  () => this.#presets.undo(),
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
				const url = this.#shareUrl;
				if (navigator.share) {
					try { await navigator.share({ url: url.toString() }); } catch {}
				} else {
					await navigator.clipboard.writeText(url.toString());
					this.#ui.dialogs.showToast(messages.failure);
				}
				return;
			}
			event.preventDefault();
			const name    = normalizeName(this.#presetEditForm.elements.name.value);
			const invalid = this.#presets.validate(action, name);
			if (invalid) return this.#reportNameValidity(invalid);
			actionButtons.forEach(button => button.disabled = true);
			this.#presetEditDialog.close();
			await this.#presets.edit(action, name);
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

	get #shareUrl() {
		const url     = new URL(location.origin + location.pathname);
		const current = new URLSearchParams(location.search);
		for (const key of this.#shareParams) {
			if (current.has(key)) url.searchParams.set(key, current.get(key));
		}
		return url;
	}

	#reportNameValidity(status) {
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
		const content = JSON.stringify(this.#presets.list, null, 2);
		const dateTimeStr = this.#ui.presetsDate.dateTime;

		let dateSuffix = '';
		if (dateTimeStr) {
			const date = new Date(dateTimeStr);
			const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
			dateSuffix = `_${localDate.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')}`;
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
			const number = await this.#presets.import(data);
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

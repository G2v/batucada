import { downloadFile, getFileContent, normalizeName } from './utils.js';

export default class InterfaceSavedSongs {
	static #enabledButtons   = 'button:not(:disabled)';
	static #validityMessages = Object.freeze({
		empty:      'invalidEmpty',
		duplicated: 'invalidDuplicated',
	});

	#ui;
	#song;
	#savedSongs;
	#navigation;
	#shareParams;
	#savedSongsDialog;
	#savedSongsDate;
	#songEditDialog;
	#songEditForm;
	#songEditButton;
	#appMenuButton;

	constructor({ parent, config, song, savedSongs, navigation }) {
		this.#ui          = parent;
		this.#song        = song;
		this.#savedSongs  = savedSongs;
		this.#navigation  = navigation;
		this.#shareParams = [config.setSearchParam, config.volumeSearchParam, config.tempoSearchParam, config.titleSearchParam];

		const { selectors } = config;

		this.#songEditDialog   = document.querySelector(selectors.songEditDialog);
		this.#songEditForm     = document.querySelector(selectors.songEditForm);
		this.#songEditButton   = document.querySelector(selectors.songEditButton);
		this.#savedSongsDialog = document.querySelector(selectors.savedSongsDialog);
		this.#savedSongsDate   = document.querySelector(selectors.savedSongsDate);
		this.#appMenuButton    = document.querySelector(selectors.appMenuButton);

		this.#savedSongsDialog.addEventListener('command',                                   (event) => this.#savedSongsDialogCommands(event));
		this.#songEditDialog.addEventListener('submit',                                      (event) => this.#saveEdit(event));
		this.#songEditDialog.addEventListener('command',                                     (event) => this.#openEdit(event));
		this.#ui.savedSongsSelect.addEventListener('change',                                 (event) => this.#savedSongSelected(event));
		document.querySelector(selectors.savedSongsDeleteDialog).addEventListener('command', (event) => this.#confirmDialogCommands(event));
	}

	#savedSongSelected(event) {
		this.#navigation.openSavedSong(event.target.selectedIndex);
	}

	#savedSongsDialogCommands(event) {
		const commands = {
			'show-modal': () => this.#updateSavedSongsDate(),
			'--import':   () => this.#savedSongsImport(event.source.dataset),
			'--export':   () => this.#savedSongsExport(),
		};
		commands[event.command]?.();
	}

	#confirmDialogCommands(event) {
		if (event.source.value !== 'delete') return;
		this.#savedSongs.deleteAll().catch(() => this.#ui.dialogs.showToast(event.source.dataset.failure));
	}

	#openEdit({ command }) {
		if (command !== 'show-modal') return;
		const { elements } = this.#songEditForm;
		const title = this.#song.title;
		const known = this.#savedSongs.has(title);
		elements.name.value = title;
		elements.name.setCustomValidity('');
		elements.copy.hidden   = !known;
		elements.delete.hidden = !known;
	}

	#cancelEdit(messages, invoker = null) {
		return {
			action:  () => this.#savedSongs.undo(),
			success: messages.cancelSuccess,
			failure: messages.cancelFailure,
			invoker,
		};
	}

	async #saveEdit(event) {
		const { dataset: messages, name: action } = event.submitter;
		const actionButtons = this.#songEditForm.querySelectorAll(InterfaceSavedSongs.#enabledButtons);
		try {
			if (action === 'share') {
				this.#songEditDialog.close();
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
			const name    = normalizeName(this.#songEditForm.elements.name.value);
			const invalid = this.#savedSongs.validate(action, name);
			if (invalid) return this.#reportNameValidity(invalid);
			actionButtons.forEach(button => button.disabled = true);
			this.#songEditDialog.close();
			await this.#savedSongs.edit(action, name);
			const cancel = this.#cancelEdit(messages, this.#songEditButton);
			this.#ui.dialogs.showToast(messages.success, cancel);
		}
		catch {
			if (this.#songEditDialog.open) this.#songEditDialog.close();
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
		const input = this.#songEditForm.elements.name;
		const validityMessage = input.dataset[InterfaceSavedSongs.#validityMessages[status]];
		input.setCustomValidity(validityMessage);
		input.reportValidity();
		input.addEventListener('input',    () => input.setCustomValidity(''), { once: true });
		input.addEventListener('focusout', () => input.setCustomValidity(''), { once: true });
	}

	#updateSavedSongsDate() {
		const { lastModified } = this.#savedSongs;
		this.#savedSongsDate.dateTime    = lastModified?.toJSON() ?? '';
		this.#savedSongsDate.textContent = lastModified?.toLocaleString('fr-FR', { hour12: false }) ?? '';
	}

	async #savedSongsExport() {
		const content = JSON.stringify(this.#savedSongs.list, null, 2);
		const date    = this.#savedSongs.lastModified;

		let dateSuffix = '';
		if (date) {
			const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
			dateSuffix = `_${localDate.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')}`;
		}
		const filename = `songs${dateSuffix}.json`;
		if (await downloadFile(filename, content)) this.#savedSongsDialog.close();
	}

	async #savedSongsImport(messages) {
		try {
			const content = await getFileContent();
			this.#savedSongsDialog.close();
			const number = await this.#savedSongs.import(JSON.parse(content));
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

import { fetchFromCache, downloadFile, getFileContent, writeData } from './utils.js';

export default class InterfaceInstruments {
	static #format = 1;

	#ui;
	#bus;
	#pendingImport     = null;
	#instrumentsDialog = document.querySelector('#instruments');
	#confirmImport     = this.#instrumentsDialog.querySelector('#instruments-import');
	#confirmRestore    = this.#instrumentsDialog.querySelector('#instruments-restore');
	#restoreButton     = this.#instrumentsDialog.querySelector('[commandfor="instruments-restore"]');
	#libraryName       = this.#instrumentsDialog.querySelector('p span');

	constructor({ bus, parent }) {
		this.#bus = bus
		this.#ui = parent;
		this.#confirmImport.addEventListener('command',     (event) => this.#confirmImportCommand(event));
		this.#confirmRestore.addEventListener('command',    (event) => this.#confirmRestoreCommand(event));
		this.#instrumentsDialog.addEventListener('command', (event) => this.#instrumentsDialogCommands(event));
	}

	#instrumentsDialogCommands(event) {
		const commands = {
			'show-modal': () => this.#updateLibraryName(),
			'--export':   () => this.#instrumentsExport(),
			'--import':   () => this.#libraryCheck(event.source.dataset),
		};
		commands[event.source?.value || event.command]?.();
	}

	async #updateLibraryName() {
		this.#libraryName.textContent = `${this.#ui.config.instrumentsLibrary.name} ${this.#ui.config.instrumentsLibrary.version}`;
		const cache = await caches.open(this.#ui.config.dataCache);
		const response = await cache.match(this.#ui.config.instrumentsMetadataFile);
		this.#restoreButton.disabled = !response;
	}

	#confirmImportCommand(event) {
		if (event.source.value === 'import') {
			this.#instrumentsImport();
		}
	}

	#confirmRestoreCommand(event) {
		if (event.source.value === 'restore') {
			this.#instrumentsRestore();
		}
	}

	async #instrumentsExport() {
		const library = structuredClone(this.#ui.config.instrumentsLibrary);
		const response = await fetchFromCache(this.#ui.config.dataCache, this.#ui.config.instrumentsSoundsFile);
		const sounds = await response.json();
		library.instruments.shift();
		library.instruments.forEach(instrument => {
			const instrumentSounds = sounds[instrument.id];
			instrument.strokes = instrument.strokes.map((stroke, i) => ({ ...stroke, sound: instrumentSounds[i] }));
		});
		const content = JSON.stringify(library, null, 2);
		const filename = `instruments-${this.#ui.config.instrumentsLibrary.name}-${this.#ui.config.instrumentsLibrary.version}.json`;
		if (await downloadFile(filename, content)) this.#instrumentsDialog.close();
	}

	async #instrumentsRestore() {
		document.body.inert = true;
		const cache = await caches.open(this.#ui.config.dataCache);
		await cache.delete(this.#ui.config.instrumentsSoundsFile);
		await cache.delete(this.#ui.config.instrumentsMetadataFile);
		this.#bus.dispatchEvent(new CustomEvent('interface:install'));
	}

	async #libraryCheck(messages) {
		try {
			const content = await getFileContent();
			const data = JSON.parse(content);
			if (!data || typeof data !== 'object')      throw new Error("Invalid file");
			if (!data.name)                             throw new Error("Missing 'name' property");
			if (!data.version)                          throw new Error("Missing 'version' property");
			if (data.format !== InterfaceInstruments.#format) {
				throw new Error(`Unsupported format: expected ${InterfaceInstruments.#format}`);
			}
			if (!Array.isArray(data.instruments) || data.instruments.length === 0) {
				throw new Error("Invalid or missing instruments");
			}
			const audioContext = new OfflineAudioContext(1, 1, 44100);
			const ids = new Set();
			const validationPromises = data.instruments.flatMap((item, index) => {
				if (item.id == null)  throw new Error(`Instrument ${index}: invalid id`);
				if (item.id < 0)      throw new Error(`Instrument ${index}: invalid id`);
				if (item.id === 0)    throw new Error(`Instrument ${index}: id 0 is reserved`);
				if (item.id > 60)     throw new Error(`Instrument ${index}: id greater than 60`);
				if (ids.has(item.id)) throw new Error(`Instrument ${index}: duplicated id`);
				if (!item.name)       throw new Error(`Instrument ${index}: missing name`);
				ids.add(item.id);
				if (!Array.isArray(item.strokes) || item.strokes.length === 0) {
					throw new Error(`Instrument ${index}: invalid strokes`);
				}
				return item.strokes.flatMap((stroke, i) => {
					const fail = (message) => new Error(`Instrument ${index} → stroke ${i}: ${message}`);
					if (!stroke || typeof stroke !== 'object') throw fail('invalid stroke');
					if (!stroke.name)                          throw fail('missing name');
					if (!stroke.icon)                          throw fail('missing icon');
					if (!stroke.sound)                         throw fail('missing sound');
					return [
						this.#validateIcon(stroke.icon).catch(error => { throw fail(error.message); }),
						this.#validateAudio(stroke.sound, audioContext).catch(error => { throw fail(error.message); }),
					];
				});
			});
			await Promise.all(validationPromises);
			const sounds = Object.fromEntries(
				data.instruments.map(({ id, strokes }) => [id, strokes.map(({ sound }) => sound)])
			);
			data.instruments.forEach(instrument => {
				instrument.strokes = instrument.strokes.map(({ sound, ...stroke }) => stroke);
			});
			const defaultInstrument = structuredClone(this.#ui.config.instrumentsLibrary.instruments[0]);
			const response = await fetchFromCache(this.#ui.config.dataCache, this.#ui.config.instrumentsSoundsFile);
			const currentSounds = await response.json();
			data.instruments.unshift(defaultInstrument);
			sounds[defaultInstrument.id] = currentSounds[defaultInstrument.id];
			this.#pendingImport = { metadata: data, sounds };
			this.#confirmImport.showModal();
		}
		catch (error) {
			if (error.name === 'AbortError') return;
			console.error(error);
			this.#instrumentsDialog.close();
			this.#ui.dialogs.showToast(messages.failure);
		}
	}

	async #instrumentsImport() {
		document.body.inert = true;
		await writeData(this.#ui.config.dataCache, this.#ui.config.instrumentsSoundsFile, this.#pendingImport.sounds);
		await writeData(this.#ui.config.dataCache, this.#ui.config.instrumentsMetadataFile, this.#pendingImport.metadata);
		this.#bus.dispatchEvent(new CustomEvent('interface:install'));
	}

	async #validateAudio(dataUrl, audioContext) {
		try {
			const response = await fetch(dataUrl);
			const buffer = await response.arrayBuffer();
			return await audioContext.decodeAudioData(buffer);
		} catch {
			throw new Error('Invalide Audio');
		}
	}

	#validateIcon(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Invalide Image'));
			img.src = dataUrl;
		});
	}

}
import { fetchFromCache, downloadFile, getFileContent, writeData } from './utils.js';

export default class InterfaceInstruments {
	static #format = 1;
	static #maxStrokes = 9;
	static #maxInstruments = 60;

	#ui;
	#bus;
	#events;
	#dataCache;
	#instrumentsDialog;
	#instrumentsLibraryName;
	#instrumentsRestoreButton;
	#importConfirmDialog;
	#instrumentsLibraryReady;
	#instrumentsSoundsFile;
	#instrumentsMetadataFile;
	#pendingImport = null;

	constructor({ bus, parent, config }) {
		this.#bus                     = bus;
		this.#events                  = config.events;
		this.#ui                      = parent;
		this.#dataCache               = config.dataCache;
		this.#instrumentsLibraryReady = config.instrumentsLibraryReady;
		this.#instrumentsSoundsFile   = config.instrumentsSoundsFile;
		this.#instrumentsMetadataFile = config.instrumentsMetadataFile;

		const { selectors } = config;

		this.#instrumentsDialog        = document.querySelector(selectors.instrumentsDialog);
		this.#instrumentsLibraryName   = document.querySelector(selectors.instrumentsLibraryName);
		this.#instrumentsRestoreButton = document.querySelector(selectors.instrumentsRestoreButton);
		this.#importConfirmDialog      = document.querySelector(selectors.importConfirmDialog);

		this.#importConfirmDialog.addEventListener('command',                              (event) => this.#confirmImportCommand(event));
		document.querySelector(selectors.restoreConfirmDialog).addEventListener('command', (event) => this.#confirmRestoreCommand(event));
		this.#instrumentsDialog.addEventListener('command',                                (event) => this.#instrumentsDialogCommands(event));
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
		const library = await this.#instrumentsLibraryReady;
		this.#instrumentsLibraryName.textContent = `${library.name} ${library.version}`;
		const cache = await caches.open(this.#dataCache);
		const response = await cache.match(this.#instrumentsMetadataFile);
		console.log({cache, response })
		this.#instrumentsRestoreButton.disabled = !response;
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
		const library = structuredClone(await this.#instrumentsLibraryReady);
		const response = await fetchFromCache(this.#dataCache, this.#instrumentsSoundsFile);
		const sounds = await response.json();
		library.instruments.shift();
		library.instruments.forEach(instrument => {
			const instrumentSounds = sounds[instrument.id];
			instrument.strokes = instrument.strokes.map((stroke, i) => ({ ...stroke, sound: instrumentSounds[i] }));
		});
		const content = JSON.stringify(library, null, 2);
		const filename = `instruments-${library.name}-${library.version}.json`;
		if (await downloadFile(filename, content)) this.#instrumentsDialog.close();
	}

	async #instrumentsRestore() {
		document.body.inert = true;
		try {
			const cache = await caches.open(this.#dataCache);
			await cache.delete(this.#instrumentsSoundsFile);
			await cache.delete(this.#instrumentsMetadataFile);
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceInstall));
		}
		catch {
			document.body.inert = false;
		}
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
				if (!Number.isInteger(item.id))                                throw new Error(`Instrument ${index}: invalid id`);
				if (item.id === 0)                                             throw new Error(`Instrument ${index}: id 0 is reserved`);
				if (item.id > InterfaceInstruments.#maxInstruments)            throw new Error(`Instrument ${index}: id greater than ${InterfaceInstruments.#maxInstruments}`);
				if (ids.has(item.id))                                          throw new Error(`Instrument ${index}: duplicated id`);
				if (!item.name)                                                throw new Error(`Instrument ${index}: missing name`);
				if (!Array.isArray(item.strokes) || item.strokes.length === 0) throw new Error(`Instrument ${index}: invalid strokes`);
				if (item.strokes.length > InterfaceInstruments.#maxStrokes)    throw new Error(`Instrument ${index}: more than ${InterfaceInstruments.#maxStrokes} strokes`);
				ids.add(item.id);
				return item.strokes.flatMap((stroke, i) => {
					const fail = (message) => new Error(`Instrument ${index} → stroke ${i}: ${message}`);
					if (!stroke || typeof stroke !== 'object') throw fail('invalid stroke');
					if (!stroke.name)                          throw fail('missing name');
					if (!stroke.icon)                          throw fail('missing icon');
					if (!stroke.sound)                         throw fail('missing sound');
					return [
						InterfaceInstruments.#validateIcon(stroke.icon).catch(error => { throw fail(error.message); }),
						InterfaceInstruments.#validateAudio(stroke.sound, audioContext).catch(error => { throw fail(error.message); }),
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
			const currentLibrary = await this.#instrumentsLibraryReady;
			const defaultInstrument = structuredClone(currentLibrary.instruments[0]);
			const response = await fetchFromCache(this.#dataCache, this.#instrumentsSoundsFile);
			const currentSounds = await response.json();
			data.instruments.unshift(defaultInstrument);
			sounds[defaultInstrument.id] = currentSounds[defaultInstrument.id];
			this.#pendingImport = { metadata: data, sounds };
			this.#importConfirmDialog.showModal();
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
		try {
			await writeData(this.#dataCache, this.#instrumentsSoundsFile, this.#pendingImport.sounds);
			await writeData(this.#dataCache, this.#instrumentsMetadataFile, this.#pendingImport.metadata);
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceInstall));
		}
		catch {
			document.body.inert = false;
		}
	}

	static async #validateAudio(dataUrl, audioContext) {
		try {
			const response = await fetch(dataUrl);
			const buffer = await response.arrayBuffer();
			return await audioContext.decodeAudioData(buffer);
		} catch {
			throw new Error('Invalide Audio');
		}
	}

	static #validateIcon(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Invalide Image'));
			img.src = dataUrl;
		});
	}
}
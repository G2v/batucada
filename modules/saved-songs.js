import storage from '../config/storage.js';
import { fetchFromCache, writeData, normalizeName } from './utils.js';

export class SavedSongs extends EventTarget {
	static #newNameActions = Object.freeze(['save', 'copy']);

	#song;
	#digits;
	#current;
	#separator;
	#tempoRange;
	#lastModified;
	#index              = -1;
	#savedSongs         = null;
	#lastAction         = null;
	#persistRequested   = false;

	constructor({ config, song }) {
		super();
		this.#song              = song;
		this.#digits            = config.formatDigits;
		this.#separator         = config.trackFormatSeparator;
		this.#tempoRange        = { min: config.tempoMin, max: config.tempoMax, step: config.tempoStep, default: config.defaultTempo };
		this.#current           = { value: config.defaultSetValue, name: '' };

		this.#load([]);

		document.addEventListener('visibilitychange', () => this.#sync());
	}

	get list() {
		return this.#savedSongs.map(savedSong => ({ ...savedSong }));
	}

	at(index) {
		return this.#savedSongs[index];
	}

	get lastModified() {
		return this.#lastModified;
	}

	indexOf({ value, name }) {
		return name ? this.#savedSongs?.findIndex(savedSong => savedSong.value === value && savedSong.name === name) ?? -1 : -1;
	}

	has(name) {
		return this.#savedSongs?.some(savedSong => savedSong.name === name) ?? false;
	}

	validate(action, name) {
		if (!SavedSongs.#newNameActions.includes(action)) return null;
		if (!name) return 'empty';
		const ownName = action === 'save' ? this.#current.name : null;
		return name !== ownName && this.has(name) ? 'duplicated' : null;
	}

	async edit(action, name) {
		const currentData = this.#savedSongs;
		const data        = currentData.map(savedSong => ({ ...savedSong }));
		const isNewName   = SavedSongs.#newNameActions.includes(action);
		const { value, name: title } = this.#current;
		const index       = data.findIndex(savedSong => savedSong.name === title);
		const savedSong   = this.#savedSong(name, value, this.#song.tempo);

		switch (action) {
			case 'save':
				if (index !== -1) data[index] = savedSong;
				else data.push(savedSong);
				break;

			case 'copy':
				data.push(savedSong);
				break;

			case 'delete':
				if (index !== -1) data.splice(index, 1);
				break;
		}

		if (isNewName) data.sort((a, b) => a.name.localeCompare(b.name));

		await this.#saveData(data);
		this.#lastAction = { data: currentData, title };
		this.#update({ savedSongs: data, title: action === 'delete' ? '' : name });
	}

	async undo() {
		const { data, title } = this.#lastAction;
		if (data === undefined) throw new Error();
		this.#lastAction = null;
		await this.#saveData(data);
		this.#update({ savedSongs: data, title: title ?? null });
	}

	async deleteAll() {
		await writeData(storage.songsFile, [], false);
		this.#lastModified = null;
		this.#update({ savedSongs: [], title: '' });
	}

	async import(data) {
		if (!Array.isArray(data)) throw new Error();
		const currentData = this.#savedSongs;
		const newData     = currentData.map(savedSong => ({ ...savedSong }));
		const values      = new Map(currentData.map(({ name, value }) => [name, value]));
		const known       = new Set(currentData.map(({ name, value }) => `${name}\n${value}`));
		let validCount    = 0;
		let importedCount = 0;

		for (const item of data) {
			const originalName = typeof item?.name === 'string' ? normalizeName(item.name) : '';
			const value        = item?.value;
			const tempo        = this.#isValidTempo(item?.tempo) ? item.tempo : undefined;
			if (!originalName || !this.#isValidValue(value)) continue;
			validCount++;
			if (known.has(`${originalName}\n${value}`)) continue;

			const baseName = originalName.match(/^(.*) \(\d+\)$/)?.[1] ?? originalName;
			let name = originalName;
			for (let suffix = 1; values.has(name) && values.get(name) !== value; suffix++) {
				name = `${baseName} (${suffix})`;
			}
			if (values.has(name)) continue;

			values.set(name, value);
			known.add(`${name}\n${value}`);
			newData.push(this.#savedSong(name, value, tempo));
			importedCount++;
		}

		if (validCount === 0) throw new Error();

		newData.sort((a, b) => a.name.localeCompare(b.name));
		await this.#saveData(newData);
		this.#lastAction = { data: currentData };
		this.#update({ savedSongs: newData });
		return importedCount;
	}

	#load(fallback = null) {
		return fetchFromCache(storage.songsFile, true)
			.then(response => {
				const lastModified = response.headers.get('last-modified');
				this.#lastModified = lastModified ? new Date(lastModified) : null;
				return response.json();
			})
			.then(savedSongs => this.#update({ savedSongs }))
			.catch(() => { if (fallback !== null) this.#update({ savedSongs: fallback }); });
	}

	#sync() {
		if (document.hidden) return;
		this.#load();
	}

	async #saveData(data) {
		if (!this.#persistRequested) {
			this.#persistRequested = true;
			navigator.storage?.persist?.().catch(() => {});
		}
		const response     = await writeData(storage.songsFile, data);
		const lastModified = response.headers.get('last-modified');
		this.#lastModified = lastModified ? new Date(lastModified) : new Date();
	}

	setCurrent({ value, name }) {
		if (value === this.#current.value && name === this.#current.name) return;
		this.#current = { value, name };
		this.#update();
	}

	#update({ savedSongs = null, title = null } = {}) {
		const changes = {};
		if (savedSongs !== null) {
			this.#savedSongs = savedSongs;
			changes.savedSongs = savedSongs;
		}
		if (title !== null && title !== this.#current.name) {
			this.#current = { ...this.#current, name: title };
			this.#song.setTitle(title);
		}
		const index = this.indexOf(this.#current);
		// L'index est toujours annoncé si la liste a changé
		if (savedSongs !== null || index !== this.#index) {
			this.#index = index;
			changes.index = index;
		}
		if (Object.keys(changes).length) this.dispatchEvent(new CustomEvent('change', { detail: changes }));
	}

	#savedSong(name, value, tempo) {
		return tempo === undefined || tempo === this.#tempoRange.default ? { name, value } : { name, value, tempo };
	}

	#isValidTempo(tempo) {
		const { min, max, step } = this.#tempoRange;
		return Number.isInteger(tempo) && tempo >= min && tempo <= max && (tempo - min) % step === 0;
	}

	#isValidValue(value) {
		return typeof value === 'string' && value.length > 0
			&& [...value].every(char => char === this.#separator || this.#digits.includes(char));
	}
}
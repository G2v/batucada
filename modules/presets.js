import storage from '../config/storage.js';
import { fetchFromCache, writeData, normalizeName } from './utils.js';

export class Presets extends EventTarget {
	static #newNameActions = Object.freeze(['save', 'copy']);

	#store;
	#digits;
	#current;
	#separator;
	#presetsDate;
	#defaultSetValue;
	#index              = -1;
	#presets            = null;
	#lastAction         = null;
	#persistRequested   = false;

	constructor({ config, store }) {
		super();
		this.#store             = store;
		this.#digits            = config.formatDigits;
		this.#separator         = config.trackFormatSeparator;
		this.#defaultSetValue   = config.defaultSetValue;
		this.#current           = { value: config.defaultSetValue, name: '' };

		this.#loadPresets([]);

		document.addEventListener('visibilitychange', () => this.#syncPresets());
	}

	get list() {
		return this.#presets.map(preset => ({ ...preset }));
	}

	select(index) {
		const preset = this.#presets[index];
		if (preset) this.#index = index;
		return preset;
	}

	indexOf({ value, name }) {
		return name ? this.#presets?.findIndex(preset => preset.value === value && preset.name === name) ?? -1 : -1;
	}

	has(name) {
		return this.#presets?.some(preset => preset.name === name) ?? false;
	}

	validate(action, name) {
		if (!Presets.#newNameActions.includes(action)) return null;
		if (!name) return 'empty';
		const ownName = action === 'save' ? this.#current.name : null;
		return name !== ownName && this.has(name) ? 'duplicated' : null;
	}

	edit(action, name) {
		return this.#applyModification(this.#presets, action, name);
	}

	async undo() {
		const { data, title } = this.#lastAction;
		if (data === undefined) throw new Error();
		this.#lastAction = null;
		await this.#saveData(data);
		this.#update({ presets: data, title: title ?? null });
	}

	async deleteAll() {
		await writeData(storage.presetsFile, [], false);
		this.#presetsDate = null;
		this.#update({ presets: [], title: '' });
	}

	async import(data) {
		if (!Array.isArray(data)) throw new Error();
		const currentData = this.#presets;
		const newData     = currentData.map(preset => ({ ...preset }));
		const values      = new Map(currentData.map(({ name, value }) => [name, value]));
		const known       = new Set(currentData.map(({ name, value }) => `${name}\n${value}`));
		let validCount    = 0;
		let importedCount = 0;

		for (const item of data) {
			const originalName = typeof item?.name === 'string' ? normalizeName(item.name) : '';
			const value        = item?.value;
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
			newData.push({ name, value });
			importedCount++;
		}

		if (validCount === 0) throw new Error();

		newData.sort((a, b) => a.name.localeCompare(b.name));
		await this.#saveData(newData);
		this.#lastAction = { data: currentData };
		this.#update({ presets: newData });
		return importedCount;
	}

	#loadPresets(fallback = null) {
		return fetchFromCache(storage.presetsFile, true)
			.then(response => {
				const lastModified = response.headers.get('last-modified');
				this.#presetsDate  = lastModified ? new Date(lastModified) : null;
				return response.json();
			})
			.then(presets => this.#update({ presets }))
			.catch(() => { if (fallback !== null) this.#update({ presets: fallback }); });
	}

	#syncPresets() {
		if (document.hidden) return;
		this.#loadPresets();
	}

	async #saveData(data) {
		if (!this.#persistRequested) {
			this.#persistRequested = true;
			navigator.storage?.persist?.().catch(() => {});
		}
		const response     = await writeData(storage.presetsFile, data);
		const lastModified = response.headers.get('last-modified');
		this.#presetsDate  = lastModified ? new Date(lastModified) : new Date();
	}

	reset() {
		this.#current = { value: this.#defaultSetValue, name: '' };
		if (this.#index === -1) return;
		this.#index = -1;
		this.dispatchEvent(new CustomEvent('change', { detail: { index: -1 } }));
	}

	setCurrent({ value, name }) {
		if (value === this.#current.value && name === this.#current.name) return;
		this.#current = { value, name };
		this.#update();
	}

	#update({ presets = null, title = null } = {}) {
		const changes = {};
		if (presets !== null) {
			this.#presets = presets;
			changes.presets = { values: presets, lastModified: this.#presetsDate };
		}
		if (title !== null && title !== this.#current.name) {
			this.#current = { ...this.#current, name: title };
			this.#store.setTitle(title);
		}
		const index = this.indexOf(this.#current);
		// L'index est toujours annoncé si la liste a changé
		if (presets !== null || index !== this.#index) {
			this.#index = index;
			changes.index = index;
		}
		if (Object.keys(changes).length) this.dispatchEvent(new CustomEvent('change', { detail: changes }));
	}

	async #applyModification(currentData, action, name) {
		const data      = currentData.map(preset => ({ ...preset }));
		const isNewName = Presets.#newNameActions.includes(action);
		const { value, name: title } = this.#current;
		const index     = data.findIndex(preset => preset.name === title);

		switch (action) {
			case 'save':
				if (index !== -1) Object.assign(data[index], { name, value });
				else data.push({ name, value });
				break;

			case 'copy':
				data.push({ name, value });
				break;

			case 'delete':
				if (index !== -1) data.splice(index, 1);
				break;
		}

		if (isNewName) data.sort((a, b) => a.name.localeCompare(b.name));

		await this.#saveData(data);
		this.#lastAction = { data: currentData, title };
		this.#update({ presets: data, title: action === 'delete' ? '' : name });
	}

	#isValidValue(value) {
		return typeof value === 'string' && value.length > 0
			&& [...value].every(char => char === this.#separator || this.#digits.includes(char));
	}
}
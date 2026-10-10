import { fetchFromCache, writeData, normalizeName } from './utils.js';

export class Presets {
	static #newNameActions = Object.freeze(['save', 'copy']);

	#bus;
	#events;
	#params;
	#digits;
	#separator;
	#cacheName;
	#presetsDate;
	#presetsFile;
	#setSearchParam;
	#titleSearchParam;
	#tempoSearchParam;
	#volumeSearchParam;
	#defaultSetValue;
	#defaultTitleValue;
	#index              = -1;
	#presets            = null;
	#lastAction         = null;
	#persistRequested   = false;

	constructor({ bus, config }) {
		this.#bus               = bus;
		this.#events            = config.events;
		this.#params            = new Map(new URLSearchParams(location.search));
		this.#digits            = config.formatDigits;
		this.#separator         = config.trackFormatSeparator;
		this.#cacheName         = config.dataCache;
		this.#presetsFile       = config.presetsFile;
		this.#setSearchParam    = config.setSearchParam;
		this.#titleSearchParam  = config.titleSearchParam;
		this.#tempoSearchParam  = config.tempoSearchParam;
		this.#volumeSearchParam = config.volumeSearchParam;
		this.#defaultSetValue   = config.defaultSetValue;
		this.#defaultTitleValue = config.defaultTitleValue;

		this.#loadPresets([]);

		this.#bus.addEventListener(this.#events.interfaceReset,          ({ detail }) => this.#reset(detail));
		this.#bus.addEventListener(this.#events.interfaceShare,          ({ detail }) => this.#sharePreset(detail));
		this.#bus.addEventListener(this.#events.interfaceImport,         ({ detail }) => this.#presetsImport(detail));
		this.#bus.addEventListener(this.#events.interfaceExport,         ({ detail }) => this.#presetsExport(detail));
		this.#bus.addEventListener(this.#events.interfaceEditSave,       ({ detail }) => this.#editSave(detail));
		this.#bus.addEventListener(this.#events.interfaceEditCancel,     ({ detail }) => this.#editCancel(detail));
		this.#bus.addEventListener(this.#events.interfacePresetSelected, ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener(this.#events.interfacePresetsDelete,  ({ detail }) => this.#deleteData(detail));
		this.#bus.addEventListener(this.#events.navigationChanged,       ({ detail }) => this.#updateParams(detail));
		document.addEventListener('visibilitychange',                    () => this.#syncPresets());
	}

	#loadPresets(fallback = null) {
		return fetchFromCache(this.#cacheName, this.#presetsFile, true)
			.then(response => {
				const lastModified = response.headers.get('last-modified');
				this.#presetsDate  = lastModified ? new Date(lastModified) : null;
				return response.json();
			})
			.then(presets => this.#updatePresets(presets, null, 'load'))
			.catch(() => { if (fallback !== null) this.#updatePresets(fallback, null, 'load'); });
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
		const response     = await writeData(this.#cacheName, this.#presetsFile, data);
		const lastModified = response.headers.get('last-modified');
		this.#presetsDate  = lastModified ? new Date(lastModified) : new Date();
	}

	async #deleteData({ resolve, reject }) {
		try {
			await writeData(this.#cacheName, this.#presetsFile, [], false);
			this.#presetsDate = null;
			this.#updatePresets([], this.#defaultTitleValue, 'clear');
			resolve();
		} catch {
			reject();
		}
	}

	#presetSelected(index) {
		const preset = this.#presets[index];
		if (!preset) return;
		this.#index = index;
		this.#bus.dispatchEvent(new CustomEvent(this.#events.presetsPresetSelected, { detail: preset }));
	}

	#reset() {
		const changes = {};
		if (this.#index !== -1) {
			this.#index = -1;
			changes.index = this.#index;
		}
		if (
			this.#params.has(this.#titleSearchParam)
			&& this.#params.get(this.#titleSearchParam) !== this.#defaultTitleValue
		) {
			this.#params.delete(this.#titleSearchParam);
			changes.title = this.#defaultTitleValue;
		}
		this.#params.delete(this.#setSearchParam);
		this.#dispatchChanges(changes, 'reset');
	}

	#updateParams(params) {
		if (
			this.#params.get(this.#setSearchParam) !== params.get(this.#setSearchParam)
			|| this.#params.get(this.#titleSearchParam) !== params.get(this.#titleSearchParam)
		) {
			this.#params = params;
			this.#updatePresets(null, null, 'navigate');
		}
	}

	#updatePresets(presets = null, title = null, source = 'load') {
		const changes = {};
		if (presets !== null) {
			this.#presets = presets;
			changes.presets = { values: presets, lastModified: this.#presetsDate }
		}
		const setValue    = this.#params.get(this.#setSearchParam)   || this.#defaultSetValue;
		const titleValue  = this.#params.get(this.#titleSearchParam) || this.#defaultTitleValue;
		const targetTitle = title ?? titleValue;
		const index = (this.#presets === null || targetTitle === this.#defaultTitleValue)
			? -1
			: this.#presets.findIndex(({ value, name }) => value === setValue && name === targetTitle);

		if (source === 'navigate') source = index !== -1 ? 'set' : 'unset';

		//on passe toujours l'index si presets a été modifié
		if ('presets' in changes || index !== this.#index) {
			this.#index = index;
			changes.index = index;
		}

		if (title !== null && title !== titleValue) {
			this.#params.set(this.#titleSearchParam, title);
			changes.title = title;
		}

		this.#dispatchChanges(changes, source);
	}

	#dispatchChanges(changes, source) {
		const isNavigation = source === 'set' || source === 'unset';
		if (isNavigation || Object.keys(changes).length) {
			this.#bus.dispatchEvent(new CustomEvent(this.#events.presetsUpdateData, { detail: { ...changes, source } }));
		}
	}

	async #editSave({ action, name, promise }) {
		try {
			const data = this.#presets;
			const allowedName  = action === 'save' ? this.#params.get(this.#titleSearchParam) : null;
			const isDuplicated = Presets.#newNameActions.includes(action)
				&& name !== allowedName
				&& data.some(preset => preset.name === name);

			if (isDuplicated) {
				this.#bus.dispatchEvent(new CustomEvent(this.#events.presetsInvalidName, { detail: 'duplicated' }));
				promise.resolve(false);
				return;
			}

			const result = this.#applyModification(data, action, name);
			promise.resolve({ result });
			await result;
		}

		catch (error) {
			promise.reject(error);
		}
	}

	async #applyModification(currentData, action, name) {
		const data      = currentData.map(preset => ({ ...preset }));
		const isNewName = Presets.#newNameActions.includes(action);
		const value     = this.#params.get(this.#setSearchParam) || this.#defaultSetValue;
		const title     = this.#params.get(this.#titleSearchParam) || this.#defaultTitleValue;
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
		this.#updatePresets(data, action === 'delete' ? this.#defaultTitleValue : name, action);
	}

	#isValidValue(value) {
		return typeof value === 'string' && value.length > 0
			&& [...value].every(char => char === this.#separator || this.#digits.includes(char));
	}

	async #editCancel(promise) {
		try {
			const { data, title } = this.#lastAction;
			if (data === undefined) throw new Error();
			this.#lastAction = null;
			await this.#saveData(data);
			this.#updatePresets(data, title ?? null, 'cancel')
			promise.resolve();
		}
		catch (error) {
			promise.reject(error);
		}
	}

	#presetsExport(presets) {
		presets.push(...this.#presets);
	}

	async #presetsImport({ data, promise }) {
		try {
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
			this.#updatePresets(newData, null, 'import');
			promise.resolve(importedCount);
		} catch (error) {
			promise.reject(error);
		}
	}

	#sharePreset({ url }) {
		const currentParams = new URLSearchParams(location.search);
		const keys = [this.#setSearchParam, this.#volumeSearchParam, this.#tempoSearchParam, this.#titleSearchParam];
		for (const key of keys) {
			if (currentParams.has(key)) {
				url.searchParams.set(key, currentParams.get(key));
			}
		}
	}
}
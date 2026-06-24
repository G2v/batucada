import { fetchFromCache, writeData, downloadFile, getFileContent } from './utils.js';

export class Presets {
	#bus;
	#params;
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
	#emptyPresets       = [];
	#isPersistedStorage = null;

	constructor({ bus, config }) {
		this.#bus               = bus;
		this.#params            = new Map(new URLSearchParams(location.search));
		this.#cacheName         = config.dataCache;
		this.#presetsFile       = config.presetsFile;
		this.#setSearchParam    = config.setSearchParam;
		this.#titleSearchParam  = config.titleSearchParam;
		this.#tempoSearchParam  = config.tempoSearchParam;
		this.#volumeSearchParam = config.volumeSearchParam;
		this.#defaultSetValue   = config.defaultSetValue;
		this.#defaultTitleValue = config.defaultTitleValue;

		this.#loadPresets(this.#emptyPresets);

		this.#bus.addEventListener('interface:reset',          ({ detail }) => this.#reset(detail));
		this.#bus.addEventListener('interface:share',          ({ detail }) => this.#sharePreset(detail));
		this.#bus.addEventListener('interface:import',         ({ detail }) => this.#presetsImport(detail));
		this.#bus.addEventListener('interface:export',         ({ detail }) => this.#presetsExport(detail));
		this.#bus.addEventListener('interface:editSave',       ({ detail }) => this.#editSave(detail));
		this.#bus.addEventListener('interface:editCancel',     ({ detail }) => this.#editCancel(detail));
		this.#bus.addEventListener('interface:presetSelected', ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener('interface:presetsDelete',  ({ detail }) => this.#deleteData(detail));
		this.#bus.addEventListener('navigation:changed',       ({ detail }) => this.#updateParams(detail));
		document.addEventListener('visibilitychange',          () => this.#syncPresets());
	}

	#loadPresets(fallback = null) {
		return fetchFromCache(this.#cacheName, this.#presetsFile, true)
			.then(response => {
				const lastModified = response.headers.get('last-modified');
				this.#presetsDate  = lastModified ? new Date(lastModified) : null;
				return response.json();
			})
			.then(presets => this.#updatePresets(presets))
			.catch(() => { if (fallback !== null) this.#updatePresets(fallback); });
	}

	#syncPresets() {
		if (document.hidden) return;
		this.#loadPresets();
	}

	async #saveData(data) {
		if (this.#isPersistedStorage === null) {
			this.#isPersistedStorage = await navigator.storage.persist();
		}
		const response     = await writeData(this.#cacheName, this.#presetsFile, data);
		const lastModified = response.headers.get('last-modified');
		this.#presetsDate  = lastModified ? new Date(lastModified) : new Date();
	}

	async #deleteData({ resolve, reject }) {
		try {
			await writeData(this.#cacheName, this.#presetsFile, this.#emptyPresets, false);
			this.#presetsDate = null;
			this.#updatePresets(this.#emptyPresets, this.#defaultTitleValue);
			resolve();
		} catch {
			reject();
		}
	}

	#presetSelected(index) {
		const preset = this.#presets[index];
		if (!preset) return;
		this.#index = index;
		this.#bus.dispatchEvent(new CustomEvent('presets:presetSelected', { detail: preset }));
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
		this.#dispatchChanges(changes);
	}

	#updateParams(params) {
		if (
			this.#params.get(this.#setSearchParam) !== params.get(this.#setSearchParam)
			|| this.#params.get(this.#titleSearchParam) !== params.get(this.#titleSearchParam)
		) {
			this.#params = params;
			this.#updatePresets();
		}
	}

	#updatePresets(presets = null, title = null) {
		const changes = {};
		if (presets !== null) {
			this.#presets = presets;
			changes.presets = { values: presets, lastModified: this.#presetsDate }
		}
		const setValue    = this.#params.get(this.#setSearchParam)   || this.#defaultSetValue;
		const titleValue  = this.#params.get(this.#titleSearchParam) || this.#defaultTitleValue;
		const targetTitle = title !== null ? title : titleValue;
		const hasTitle    = targetTitle !== this.#defaultTitleValue;
		const isEmpty     = setValue === this.#defaultSetValue && !hasTitle;
		const index       = (this.#presets === null || isEmpty) 
			? -1
			: this.#presets.findIndex(({ value, name }) => 
				value === setValue && (!hasTitle || name === targetTitle)
			);
		//on passe toujours l'index si presets a été modifié
		if ('presets' in changes || index !== this.#index) {
			this.#index = index;
			changes.index = index;
		}
		if (title === null) {
			title = titleValue || this.#presets?.[this.#index]?.name || this.#defaultTitleValue;
		}
		if (title !== titleValue) {
			this.#params.set(this.#titleSearchParam, title);
			changes.title = title;
		}
		this.#dispatchChanges(changes);
	}

	#dispatchChanges(changes) {
		if (Object.keys(changes).length) {
			this.#bus.dispatchEvent(new CustomEvent('presets:updateData', { detail: changes }));
			if ('title' in changes) {
				this.#bus.dispatchEvent(new CustomEvent('presets:changed', { detail: { title: changes.title } }));
			}
		}
	}

	async #editSave({ action, name, promise }) {
		try {
			const data = this.#presets;
			const isNewName = ['save', 'rename'].includes(action);
			const status = this.#validateNewName(data, name);

			if (isNewName && status !== 'valid') {
				this.#bus.dispatchEvent(new CustomEvent('presets:invalidName', { detail: status }));
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

	async #applyModification(data, action, name) {
		const isNewName = ['save', 'rename'].includes(action);
		const value = this.#params.get(this.#setSearchParam) || this.#defaultSetValue;
		const indexName = action === 'rename' ? this.#params.get(this.#titleSearchParam) : name;
		const index = data.findIndex(preset => preset.name === indexName);

		this.#lastAction = {
			data:  data.map(preset => ({ ...preset })),
			title: this.#params.get(this.#titleSearchParam) || this.#defaultTitleValue,
		};

		switch (action) {
			case 'save':
				if (index !== -1) data[index].value = value;
				else data.push({ name, value });
				break;

			case 'rename':
				if (index !== -1) data[index].name = name;
				break;

			case 'delete':
				if (index !== -1) data.splice(index, 1);
				break;
		}

		if (isNewName) data.sort((a, b) => a.name.localeCompare(b.name));

		await this.#saveData(data);
		this.#updatePresets(data, action === 'delete' ? this.#defaultTitleValue : name);
	}

	#validateNewName(data, name) {
		const existingNames = new Set(data.map(item => item.name));
		existingNames.delete(this.#params.get(this.#titleSearchParam));
		if (existingNames.has(name)) return 'duplicated';
		return 'valid';
	}

	async #editCancel(promise) {
		try {
			const { data, title } = this.#lastAction;
			if (data === undefined) throw new Error();
			this.#lastAction = null;
			await this.#saveData(data);
			this.#updatePresets(data, title ?? null)
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
			const currentData = this.#presets;
			const snapshotData = currentData.map(preset => ({ ...preset }));
			const dataMap = new Map(currentData.map(preset => [preset.name, preset]));
			const validData = data?.filter(item =>
				typeof item?.name === 'string' && item.name.trim().length > 0 &&
				typeof item?.value === 'string'
			) || [];

			if (validData.length === 0) throw new Error();

			let importedCount = 0;

			for (const item of validData) {
				const originalName = item.name.trim();
				const value = item.value;
				const existing = currentData.some(preset => preset.name === originalName && preset.value === value);
				if (existing) continue;
				const match = originalName.match(/^(.*) \(\d+\)$/);
				const baseName = match ? match[1] : originalName;

				let name = originalName;

				if (dataMap.has(name)) {
					let suffix = 1;
					name = `${baseName} (${suffix})`;
					while (dataMap.has(name)) {
						if (dataMap.get(name).value === value) break;
						suffix++;
						name = `${baseName} (${suffix})`;
					}
				}

				if (dataMap.has(name) && dataMap.get(name).value === value) {
					continue;
				}

				const newItem = { name, value };
				dataMap.set(name, newItem);
				currentData.push(newItem);
				importedCount++;
			}

			const newData = Array.from(dataMap.values()).sort((a, b) => a.name.localeCompare(b.name));
			await this.#saveData(newData);
			this.#lastAction = { data: snapshotData };
			this.#updatePresets(newData, null);
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


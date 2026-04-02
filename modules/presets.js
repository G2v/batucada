export class Presets {
	#bus;
	#local;
	#apiKey;
	#params;
	#cacheName;
	#presetsDate;
	#apiEndPoint;
	#userFileName;
	#setSearchParam;
	#titleSearchParam;
	#tempoSearchParam;
	#volumeSearchParam;
	#defaultSetValue;
	#defaultTitleValue;
	#index              = -1;
	#presets            = null;
	#lastAction         = null;
	#isPersistedStorage = null;

	constructor({ bus, config }) {
		this.#bus               = bus;
		this.#local             = config.local;
		this.#apiKey            = config.apiKey;
		this.#cacheName         = config.dataCache;
		this.#setSearchParam    = config.setSearchParam;
		this.#titleSearchParam  = config.titleSearchParam;
		this.#tempoSearchParam  = config.tempoSearchParam;
		this.#volumeSearchParam = config.volumeSearchParam;
		this.#defaultSetValue   = config.defaultSetValue;
		this.#defaultTitleValue = config.defaultTitleValue;

		this.#params       = new Map(new URLSearchParams(location.search));
		const user         = this.#params.get('user')?.trim() || '0';
		this.#apiEndPoint  = `${config.apiURL}?user=${user}&filename=${config.presetsFile}`;
		this.#userFileName = `./${this.#cacheName}/presets/${user}/${config.presetsFile}`;

		this.#softUpdatePresets();

		addEventListener('focus', () => this.#softUpdatePresets());
		this.#bus.addEventListener('interface:reset',             ({ detail }) => this.#reset(detail));
		this.#bus.addEventListener('interface:share',             ({ detail }) => this.#sharePreset(detail));
		this.#bus.addEventListener('interface:import',            ({ detail }) => this.#presetsImport(detail));
		this.#bus.addEventListener('interface:export',            ({ detail }) => this.#presetsExport(detail));
		this.#bus.addEventListener('interface:settingsSave',      ({ detail }) => this.#settingsSave(detail));
		this.#bus.addEventListener('interface:settingsCancel',    ({ detail }) => this.#settingsCancel(detail));
		this.#bus.addEventListener('interface:presetSelected',    ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener('navigation:changed',          ({ detail }) => this.#updateParams(detail));
	}

	async #fetchData() {
		const cache = await caches.open(this.#cacheName);
		if (this.#local) {
			let response = await cache.match(this.#userFileName);
			if (response) return await response.json();
			// Mise en cache d’un tableau vide si absent
			response = this.#jsonResponse([]);
			await cache.put(this.#userFileName, response);
			return [];
		} else {
			// Cache fetch au premier appel puis network fetch pour les suivants
			const options = this.#presets !== null ? { headers: { 'Cache-Control': 'no-cache' } } : {};
			const response = await fetch(this.#userFileName, options);
			if (response.status === 404) return []; 
			if (!response.ok) throw new Error(`Échec du fetch : ${response.status}`);
			// Ajout au cache uniquement si non présent
			if (!(await cache.match(this.#userFileName))) {
				await cache.put(this.#userFileName, response.clone());
			}
			const lastModified = response.headers.get('last-modified');
			this.#presetsDate = lastModified ? new Date(lastModified) : null;
			return await response.json();
		}
	}

	async #saveData(data) {
		let response;
		const cache = await caches.open(this.#cacheName);
		if (this.#local) {
			response = this.#jsonResponse(data);
			if (this.#isPersistedStorage === null) {
				this.#isPersistedStorage = await navigator.storage.persist();
			}
		} else {
			response = await fetch(this.#apiEndPoint, { 
				method: 'PUT', 
				body: JSON.stringify(data),
				headers: {
					'Content-Type': 'application/json',
					'X-API-KEY': atob(this.#apiKey)
				}
			});
		}

		if (!response.ok) {
			throw new Error(`HTTP Error: ${response.status}`);
		}
		const lastModified = response.headers.get('last-modified');
		this.#presetsDate = lastModified ? new Date(lastModified) : new Date();
		await cache.put(this.#userFileName, response.clone());
	}

	#jsonResponse(json) {
		return new Response(JSON.stringify(json), {
			status: 200,
			statusText: 'OK',
			headers: {
				'Content-Type': 'application/json',
				'Last-Modified': new Date().toUTCString()
			}
		});
	}

	async #softUpdatePresets() {
		try {
			const presets = await this.#fetchData();
			this.#updatePresets(presets);
		} catch {
			if (this.#presets === null) this.#presets = [];
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

	#resolveTitle(title) {
		return title || 
			this.#params.get(this.#titleSearchParam) || 
			this.#presets?.[this.#index]?.name || 
			this.#defaultTitleValue;
	}

	#resolveIndex(title) {
		const presetParam = this.#params.get(this.#setSearchParam) || this.#defaultSetValue;
		const isEmpty = presetParam === this.#defaultSetValue && title === this.#defaultTitleValue;
		if (this.#presets === null || isEmpty) return -1;
		return this.#presets.findIndex(({ value, name }) => value === presetParam && name === title);
	}

	async #settingsSave({ action, name, promise }) {
		try {
			const data = await this.#fetchData(true);
			const isNewName = ['newOne', 'rename'].includes(action);
			const status = this.#validateNewName(data, name);

			if (isNewName && status !== 'valid') {
				this.#bus.dispatchEvent(new CustomEvent('presets:invalidName', { 
					detail: { action, status } 
				}));
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
		const isNewName = ['newOne', 'rename'].includes(action);
		const value = this.#params.get(this.#setSearchParam) || this.#defaultSetValue;
		const indexName = action === 'rename' ? this.#params.get(this.#titleSearchParam) : name;
		const index = data.findIndex(preset => preset.name === indexName);

		switch (action) {
			case 'newOne': data.push({ name, value }); break;
			case 'modify': if (index !== -1) data[index].value = value; break;
			case 'rename': if (index !== -1) data[index].name = name; break;
			case 'delete': if (index !== -1) data.splice(index, 1); break;
		}

		if (isNewName) data.sort((a, b) => a.name.localeCompare(b.name));

		await this.#saveData(data);

		this.#lastAction = {
			data: this.#presets,
			title: this.#params.get(this.#titleSearchParam) || this.#defaultTitleValue,
		};

		this.#updatePresets(data, action === 'delete' ? this.#defaultTitleValue : name);
	}

	#validateNewName(data, name) {
		const existingNames = new Set(data.map(item => item.name));
		existingNames.delete(this.#params.get(this.#titleSearchParam));
		if (!/\S/.test(name)) {
			return 'empty';
		}
		else if (existingNames.has(name)) {
			return 'duplicated';
		}
		return 'valid';
	}

	async #settingsCancel(promise) {
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

	#presetsExport(provide) {
		provide(this.#presets);
	}

	async #presetsImport({ data, promise }) {
		try {
			const currentData = await this.#fetchData();
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

	async #sharePreset({ promise }) {
		const url = new URL(location.origin + location.pathname);
		const params = new URLSearchParams(location.search);
		const keys = [this.#setSearchParam, this.#volumeSearchParam, this.#tempoSearchParam, this.#titleSearchParam];
		for (const item of keys) {
			const value = params.get(item);
			if (value) url.searchParams.set(item, value);
		}
		if (navigator.share) {
			try {
				await navigator.share({ url });
				return;
			} catch {}
			promise.resolve();
		}
		else {
			await navigator.clipboard.writeText(url);
			promise.reject();
		}
	}

}
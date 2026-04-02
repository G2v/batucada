export class Navigation {
	#bus;
	#worker;
	#searchParams;
	#setSearchParam;
	#defaultSetValue;
	#titleSearchParam;
	#tempoSearchParam;
	#volumeSearchParam;
	#updateSearchParam;
	#defaultTitleValue;
	#isModalOpen = false;

	constructor({ bus, config, instruments }) {
		this.#bus               = bus;
		this.#searchParams      = new URLSearchParams(location.search);
		this.#setSearchParam    = config.setSearchParam;
		this.#titleSearchParam  = config.titleSearchParam;
		this.#tempoSearchParam  = config.tempoSearchParam;
		this.#volumeSearchParam = config.volumeSearchParam;
		this.#updateSearchParam = config.updateSearchParam;
		this.#defaultSetValue   = config.defaultSetValue;
		this.#defaultTitleValue = config.defaultTitleValue;

		this.#cleanUpdateSearchParam();

		this.#worker = new Worker(new URL('./navigation_worker.js', import.meta.url));
		this.#worker.onmessage = (event) => this.#handleWorkerMessage(event.data);

		history.scrollRestoration = 'manual';

		this.#init(instruments, config);

		const navigationReady = window.navigation ? Promise.resolve() : import('./polyfill/navigation.js');
		navigationReady.then(() => navigation.addEventListener('navigate', event => this.#handleNavigation(event)));

		this.#bus.addEventListener('audio:state',            ({ detail }) => this.#cacheState(detail));
		this.#bus.addEventListener('audio:changed',          ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener('presets:changed',        ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener('presets:presetSelected', ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener('interface:reset',        ({ detail }) => this.#reset());
		this.#bus.addEventListener('interface:hasModal',     ({ detail }) => this.#isModalOpen = detail);
		this.#bus.addEventListener('interface:moveTrack',    ({ detail }) => this.#moveTrack(detail));
		this.#bus.addEventListener('sw-client:install',      () => this.#reload());
	}

	#init(instrumentsList, config) {
		const hasToDecodeNow = this.#searchParams.size > 0;

		const workerConfig = {
			resolution:        config.resolution,
			emptyStroke:       config.emptyStroke,
			tracksLength:      config.tracksLength,
			tempoStep:         config.tempoStep,
			defaultGain:       config.defaultGain,
			defaultBars:       config.defaultBars,
			defaultBeats:      config.defaultBeats,
			defaultSteps:      config.defaultSteps,
			defaultTempo:      config.defaultTempo,
			defaultOrder:      config.defaultOrder,
			defaultPhrase:     config.defaultPhrase,
			defaultSetValue:   config.defaultSetValue,
			defaultTitleValue: config.defaultTitleValue,
			defaultInstrument: config.defaultInstrument,
			setSearchParam:    config.setSearchParam,
			tempoSearchParam:  config.tempoSearchParam,
			titleSearchParam:  config.titleSearchParam,
			volumeSearchParam: config.volumeSearchParam,
			barsIndex:         [config.defaultBars,   ...config.barsValues  .filter(value => value !== config.defaultBars)],
			beatsIndex:        [config.defaultBeats,  ...config.beatsValues .filter(value => value !== config.defaultBeats)],
			stepsIndex:        [config.defaultSteps,  ...config.stepsValues .filter(value => value !== config.defaultSteps)],
			phraseIndex:       [config.defaultPhrase, ...config.phraseValues.filter(value => value !== config.defaultPhrase)],
			instrumentsIndex:  instrumentsList.map(({ id, files }) => ({ id, base: files.length + 1 })),
			hasToDecodeNow,
		}

		this.#postMessage('init', workerConfig);
	}

	#cleanUpdateSearchParam() {
		if (this.#searchParams.has(this.#updateSearchParam)) {
			this.#searchParams.delete(this.#updateSearchParam);
			history.replaceState(null, '', this.#url);
		}
	}

	#reload() {
		const url = new URL(location.pathname, location.origin);
		url.searchParams.set(this.#updateSearchParam, Date.now());
		window.location.replace(url);
	}

	#handleWorkerMessage(data) {
		const { action, payload } = data;
		if (action === 'decoded') {
			this.#bus.dispatchEvent(new CustomEvent('navigation:decoded', { detail: payload }));
		}
		else if (action === 'encoded') {
			this.#searchParams = new URLSearchParams(payload);
			window.navigation.navigate(this.#url, {
				history: 'replace',
				state: { action: 'encoded', dispatch: true }
			});
		}
	}

	#handleNavigation(event) {
		const { destination, navigationType, canIntercept, hashChange, downloadRequest } = event;
		const url = new URL(destination.url);
		const state = destination.getState() || {};

		if (this.#isModalOpen && navigationType === 'traverse') {
			this.#bus.dispatchEvent(new CustomEvent('navigation:closeModal'));
			event.preventDefault();
			return;
		}

		if (url.searchParams.has(this.#updateSearchParam) || 
			url.protocol === 'blob:' || 
			!canIntercept || 
			hashChange || 
			downloadRequest) return;

		const isTraverse = navigationType === 'traverse';
		const action = isTraverse ? 'decodeAll' : state.action;
		const shouldDispatch = isTraverse || !!state.dispatch;

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: async () => {
				this.#searchParams = url.searchParams;
				if (['reset', 'decode', 'decodeAll'].includes(action)) {
					window.scrollTo(0, 0);
					this.#postMessage(action);
				}
				if (shouldDispatch) {
					this.#bus.dispatchEvent(new CustomEvent('navigation:changed', {
						detail: new Map(this.#searchParams) 
					}));
				}
			}
		});
	}

	#presetSelected({ name, value }) {
		this.#searchParams.set(this.#setSearchParam, value || this.#defaultSetValue);
		this.#searchParams.set(this.#titleSearchParam, name || this.#defaultTitleValue);
		navigation.navigate(this.#url, { 
			state: { action: 'decode', dispatch: true }
		});
	}

	#cacheState(values) {
		queueMicrotask(() => this.#postMessage('cache', values));
	}

	#encodeURL(values) {
		queueMicrotask(() => this.#postMessage('encode', values));
	}

	#moveTrack(moved) {
		queueMicrotask(() => this.#postMessage('move', moved));
	}

	#reset() {
		const oldSearch = this.#searchParams.toString();
		this.#searchParams.delete(this.#setSearchParam);
		this.#searchParams.delete(this.#titleSearchParam);
		this.#searchParams.delete(this.#tempoSearchParam);
		this.#searchParams.delete(this.#volumeSearchParam);
		const newSearch = this.#searchParams.toString();
		if (newSearch === oldSearch) return;

		navigation.navigate(this.#url, {
			state: { action: 'reset', dispatch: false } 
		});
	}

	#postMessage(action, values = null) {
		const transferables = [];
		const payload = { searchParams: Object.fromEntries(this.#searchParams.entries()) };
		if (values) {
			payload.values = values;
			if (typeof values === 'object') {
				for (const key in values) {
					const item = values[key];
					if (item?.buffer instanceof ArrayBuffer) {
						transferables.push(item.buffer);
					}
				}
			}
		}
		try {
			this.#worker.postMessage({ action, payload }, transferables);
		} catch {
			this.#worker.postMessage({ action, payload });
		}
	}

	get #url() {
		return this.#searchParams.size > 0
			? `?${this.#searchParams.toString()}`
			: '.';
	}

}
import { initialState, decode, decodeAll } from './navigation_decode.js';

export class Navigation {
	#bus;
	#events;
	#config;
	#state;
	#worker = null;
	#searchParams;

	constructor({ bus, config }) {
		this.#bus          = bus;
		this.#config       = config;
		this.#events       = config.events;
		this.#state        = initialState(config);
		this.#searchParams = new URLSearchParams(location.search);

		this.#cleanUpdateSearchParam();

		history.scrollRestoration = 'manual';

		this.#scheduleWorker();

		const navigationReady = window.navigation ? Promise.resolve() : import('./polyfills/navigation.js');
		navigationReady.then(() => navigation.addEventListener('navigate', event => this.#handleNavigation(event)));

		this.#bus.addEventListener(this.#events.audioState,            ({ detail }) => this.#updateState(detail));
		this.#bus.addEventListener(this.#events.audioChanged,          ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener(this.#events.presetsChanged,        ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener(this.#events.presetsPresetSelected, ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener(this.#events.interfaceReset,        ({ detail }) => this.#reset());
		this.#bus.addEventListener(this.#events.interfaceMoveTrack,    ({ detail }) => this.#moveTrack(detail));
		this.#bus.addEventListener(this.#events.swClientInstall,       () => this.#reload());
	}

	#scheduleWorker() {
		const create = () => this.#encoder;
		if ('requestIdleCallback' in window) requestIdleCallback(create, { timeout: 3000 });
		else setTimeout(create, 500);
	}

	get #encoder() {
		return this.#worker ??= this.#createWorker();
	}


	async #createWorker() {
		const worker = new Worker(new URL('./navigation_worker.js', import.meta.url));
		worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
		worker.postMessage({ action: 'init', payload: { config: await this.#encoderConfig() } });
		return worker;
	}

	async #encoderConfig() {
		const config = this.#config;
		const { instruments } = await config.instrumentsLibraryReady;

		return Object.freeze({
			allocation:        config.trackFormatAllocation,
			outputDigits:      config.formatDigits,
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
			defaultVolume:     config.defaultVolume,
			setSearchParam:    config.setSearchParam,
			tempoSearchParam:  config.tempoSearchParam,
			titleSearchParam:  config.titleSearchParam,
			volumeSearchParam: config.volumeSearchParam,
			barsIndex:         config.barsIndex,
			beatsIndex:        config.beatsIndex,
			stepsIndex:        config.stepsIndex,
			phraseIndex:       config.phraseIndex,
			instrumentsBase:   Object.fromEntries(
				instruments.map(({ id, strokes }) => [id, strokes.length + 1])
			),
		});
	}

	#updateState(values) {
		for (const [key, value] of Object.entries(values)) {
			if (value !== undefined && value !== null) {
				this.#state[key] = value;
			}
		}
	}

	#resetState() {
		this.#state.tempo   = this.#config.defaultTempo;
		this.#state.title   = this.#config.defaultTitleValue;
		this.#state.sheet   = null;
		this.#state.tracks  = null;
		this.#state.volumes = null;
	}

	#dispatchDecoded(changes) {
		this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationDecoded, { detail: changes }));
	}


	#decodeAction(action) {
		if (action === 'reset') {
			this.#resetState();
			return;
		}
		const changes = action === 'decodeAll'
			? decodeAll(this.#config, this.#searchParams, this.#state)
			: decode(this.#config, this.#searchParams, this.#state);

		if (changes) this.#dispatchDecoded(changes);
	}

	#cleanUpdateSearchParam() {
		if (this.#searchParams.has(this.#config.updateSearchParam)) {
			this.#searchParams.delete(this.#config.updateSearchParam);
			history.replaceState(null, '', this.#url);
		}
	}

	#reload() {
		const url = new URL(location.pathname, location.origin);
		url.searchParams.set(this.#config.updateSearchParam, Date.now());
		location.replace(url);
	}

	#handleWorkerMessage({ action, payload }) {
		if (action !== 'encoded') return;
		this.#searchParams = new URLSearchParams(payload);
		window.navigation.navigate(this.#url, {
			history: 'replace',
			state: { action: 'encoded', dispatch: true }
		});
	}

	#handleNavigation(event) {
		const { destination, navigationType, canIntercept, hashChange, downloadRequest } = event;
		const url = new URL(destination.url);
		const state = destination.getState() || {};

		if (navigationType === 'traverse') {
			const modal = { closed: false };
			this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationCloseModal, { detail: modal }));
			if (modal.closed) {
				event.preventDefault();
				return;
			}
		}

		if (url.searchParams.has(this.#config.updateSearchParam) ||
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
					this.#decodeAction(action);
				}
				if (shouldDispatch) {
					this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationChanged, { detail: new Map(this.#searchParams) }));
				}
			}
		});
	}

	#presetSelected({ name, value }) {
		const { setSearchParam, titleSearchParam, defaultSetValue, defaultTitleValue } = this.#config;
		this.#searchParams.set(setSearchParam, value || defaultSetValue);
		this.#searchParams.set(titleSearchParam, name || defaultTitleValue);
		navigation.navigate(this.#url, {
			state: { action: 'decode', dispatch: true }
		});
	}

	#encodeURL(values) {
		this.#updateState(values);
		queueMicrotask(() => this.#postMessage('encode', values));
	}

	#moveTrack(moved) {
		const previousOrder = this.#state.order;
		this.#state.order = moved.order;
		queueMicrotask(() => this.#postMessage('move', { ...moved, previousOrder }));
	}

	#reset() {
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam } = this.#config;
		const oldSearch = this.#searchParams.toString();
		this.#searchParams.delete(setSearchParam);
		this.#searchParams.delete(titleSearchParam);
		this.#searchParams.delete(tempoSearchParam);
		this.#searchParams.delete(volumeSearchParam);
		const newSearch = this.#searchParams.toString();
		if (newSearch === oldSearch) return;

		navigation.navigate(this.#url, {
			state: { action: 'reset', dispatch: false }
		});
	}

	#postMessage(action, values) {
		const payload = {
			searchParams: this.#paramsAsObject(),
			state: this.#state,
			values,
		};
		this.#encoder.then(worker => worker.postMessage({ action, payload }));
	}

	#paramsAsObject() {
		return Object.fromEntries(this.#searchParams.entries());
	}

	get #url() {
		return this.#searchParams.size > 0
			? `?${this.#searchParams.toString()}`
			: '.';
	}

}
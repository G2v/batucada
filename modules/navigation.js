import { defer } from './utils.js';
import { decode, decodeAll, initialState } from './navigation_decode.js';

export class Navigation {
	#bus;
	#events;
	#config;
	#state;
	#worker = null;
	#searchParams;
	#savedEncode = false;

	constructor({ bus, config }) {
		this.#bus          = bus;
		this.#config       = config;
		this.#events       = config.events;
		this.#state        = initialState(config);
		this.#searchParams = new URLSearchParams(location.search);

		this.#cleanUpdateSearchParam();

		history.scrollRestoration = 'manual';

		navigation.addEventListener('navigate',                        event => this.#handleNavigation(event));
		this.#bus.addEventListener(this.#events.audioState,            ({ detail }) => this.#updateState(detail));
		this.#bus.addEventListener(this.#events.audioChanged,          ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener(this.#events.presetsUpdateData,     ({ detail }) => this.#presetsUpdated(detail));
		this.#bus.addEventListener(this.#events.presetsPresetSelected, ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener(this.#events.interfaceReset,        ({ detail }) => this.#reset());
		this.#bus.addEventListener(this.#events.interfaceMoveTrack,    ({ detail }) => this.#moveTrack(detail));
		this.#bus.addEventListener(this.#events.swClientInstall,       () => this.#reload());

		defer(() => void this.#encoder);
	}

	get #encoder() {
		return this.#worker ??= this.#createWorker();
	}

	async #createWorker() {
		const worker = new Worker(new URL('./navigation_worker.js', import.meta.url), { type: 'module' });
		worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
		worker.postMessage({ action: 'init', payload: { config: await this.#encoderConfig() } });
		return worker;
	}

	async #encoderConfig() {
		const { instruments } = await this.#config.instrumentsLibraryReady;
		const instrumentsBase = Object.fromEntries(instruments.map(({ id, strokes }) => [id, strokes.length + 1]));

		return Object.freeze({
			instrumentsBase,
			formatDigits:          this.#config.formatDigits,
			resolution:            this.#config.resolution,
			emptyStroke:           this.#config.emptyStroke,
			tracksLength:          this.#config.tracksLength,
			tempoStep:             this.#config.tempoStep,
			defaultGain:           this.#config.defaultGain,
			defaultBars:           this.#config.defaultBars,
			defaultBeats:          this.#config.defaultBeats,
			defaultSteps:          this.#config.defaultSteps,
			defaultTempo:          this.#config.defaultTempo,
			defaultOrder:          this.#config.defaultOrder,
			defaultPhrase:         this.#config.defaultPhrase,
			defaultSetValue:       this.#config.defaultSetValue,
			defaultTitleValue:     this.#config.defaultTitleValue,
			defaultInstrument:     this.#config.defaultInstrument,
			defaultVolume:         this.#config.defaultVolume,
			setSearchParam:        this.#config.setSearchParam,
			tempoSearchParam:      this.#config.tempoSearchParam,
			titleSearchParam:      this.#config.titleSearchParam,
			volumeSearchParam:     this.#config.volumeSearchParam,
			barsIndex:             this.#config.barsIndex,
			beatsIndex:            this.#config.beatsIndex,
			stepsIndex:            this.#config.stepsIndex,
			phraseIndex:           this.#config.phraseIndex,
			trackFormatSeparator:  this.#config.trackFormatSeparator,
			trackFormatAllocation: this.#config.trackFormatAllocation,
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
		this.#navigate({ action: 'encoded', dispatch: true });
	}

	#handleNavigation(event) {
		const { destination, navigationType, canIntercept, hashChange, downloadRequest } = event;
		const url = new URL(destination.url);
		const state = destination.getState() || {};
		const isTraverse = navigationType === 'traverse';

		if (isTraverse) {
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

		const action = isTraverse ? 'decodeAll' : state.action;
		const shouldDispatch = isTraverse || !!state.dispatch;

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: () => {
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
		this.#navigate({ action: 'decode', dispatch: true, isUnsaved: false });
	}

	#presetsUpdated({ source, title }) {
		if (title !== undefined) {
			this.#encodeURL({ title });
		}
		else if (source === 'set' || source === 'unset') {
			const isUnsaved = source === 'unset';
			const state = navigation.currentEntry?.getState() ?? {};
			if (!!state.isUnsaved === isUnsaved) return;
			navigation.updateCurrentEntry({ state: { ...state, isUnsaved } });
		}
	}

	#encodeURL(values) {
		this.#updateState(values);
		this.#postMessage('encode', values);
	}

	#moveTrack(moved) {
		const previousOrder = this.#state.order;
		this.#state.order = moved.order;
		this.#postMessage('move', { ...moved, previousOrder });
	}

	#reset() {
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam } = this.#config;
		for (const param of [setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam]) {
			this.#searchParams.delete(param);
		}
		this.#navigate({ action: 'reset', dispatch: false, isUnsaved: false });
	}

	#navigate(state) {
		const current   = navigation.currentEntry;
		const nextUrl   = this.#url;
		const isUnsaved = !!current?.getState()?.isUnsaved;
		const previous  = navigation.entries()[(current?.index ?? -1) - 1];

		if (!isUnsaved && current?.url === nextUrl) return;

		if (isUnsaved && previous?.url === nextUrl && !previous.getState()?.isUnsaved) {
			navigation.back();
			return;
		}

		navigation.navigate(nextUrl, { history: isUnsaved ? 'replace' : 'push', state });
	}

	#postMessage(action, values) {
		queueMicrotask(() => {
			const payload = {
				searchParams: this.#paramsAsObject(),
				state: structuredClone(this.#state),
				values,
			};
			this.#encoder.then(worker => worker.postMessage({ action, payload }));
		});
	}

	#paramsAsObject() {
		return Object.fromEntries(this.#searchParams.entries());
	}

	get #url() {
		const url = new URL(location.pathname, location.origin);
		url.search = this.#searchParams.toString();
		return url.href;
	}

}